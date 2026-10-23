import type { WindowOccurrence } from "@/lib/booking/windows";
import { subtractIntervals } from "@/lib/booking/windows";
import {
  civilToISODate,
  compareCivil,
  formatDurationMinutes,
  instantToCivil,
  instantToMinutes,
  minutesToClock,
} from "@/lib/time";
import type { CampusDay } from "@/lib/week";

const MINUTE_MS = 60_000;

type Tone = "student" | "class" | "maintenance";

export type AgendaBooking = {
  id: string;
  start: Date;
  end: Date;
  label: string;
  tone: Tone;
};

type Clock = {
  /** Epoch ms of the start, for ordering — clock strings can't sort across midnight. */
  at: number;
  start: string;
  end: string;
  /** A gap in an overnight window can begin after midnight; flagged so it reads right. */
  startsNextDay: boolean;
  endsNextDay: boolean;
};

export type AgendaItem =
  | ({ kind: "open"; key: string; free: string; windowName: string } & Clock)
  | ({ kind: "taken"; key: string; label: string; tone: Tone } & Clock);

export type AgendaDay = {
  key: string;
  weekday: string;
  dayOfMonth: number;
  /** "Monday, Oct 26" */
  title: string;
  isToday: boolean;
  /** The windows that open on this day, e.g. "Daytime 08:00–17:00". */
  windows: string[];
  hasOpen: boolean;
  items: AgendaItem[];
};

/**
 * The phone layout's day-by-day list: open time and taken time in order, as in the
 * "Phone · Day schedule" artboard.
 *
 * Everything belongs to the day it *starts*: an overnight window is one 17:00 → 08:00
 * entry on the evening it opens, not two halves split at midnight. That matches how
 * students think about overnight runs, and how the booking rules count them.
 *
 * "Open" means bookable, not merely empty: a gap shorter than the window's minimum
 * length, part of a whole-block-only window, or time already past is left out, so
 * the list never advertises a slot the booking form would refuse.
 */
export function buildAgenda(args: {
  days: CampusDay[];
  occurrences: WindowOccurrence[];
  bookings: AgendaBooking[];
  now: Date;
}): AgendaDay[] {
  const { days, occurrences, bookings, now } = args;
  const busy = bookings.map((b) => ({ start: b.start, end: b.end }));

  return days.map((day) => {
    const startsToday = (instant: Date) =>
      compareCivil(instantToCivil(instant), day.date) === 0;
    const clock = (start: Date, end: Date): Clock => ({
      at: start.getTime(),
      start: minutesToClock(instantToMinutes(start)),
      end: minutesToClock(instantToMinutes(end)),
      startsNextDay: !startsToday(start),
      endsNextDay: !startsToday(new Date(end.getTime() - 1)),
    });

    const todays = occurrences.filter(
      (o) => civilToISODate(o.date) === day.key,
    );

    const open: AgendaItem[] = todays.flatMap((o) => {
      const gaps = subtractIntervals({ start: o.start, end: o.end }, busy)
        .map((g) => ({ start: g.start < now ? now : g.start, end: g.end }))
        .filter((g) => g.end > g.start);

      const usable = o.window.wholeBlockOnly
        ? gaps.filter(
            (g) =>
              g.start.getTime() === o.start.getTime() &&
              g.end.getTime() === o.end.getTime(),
          )
        : gaps.filter(
            (g) =>
              (g.end.getTime() - g.start.getTime()) / MINUTE_MS >=
              o.window.minDurationMinutes,
          );

      return usable.map((g) => ({
        kind: "open" as const,
        key: `open-${g.start.getTime()}`,
        free: `${formatDurationMinutes(Math.round((g.end.getTime() - g.start.getTime()) / MINUTE_MS))} free`,
        windowName: o.window.name,
        ...clock(g.start, g.end),
      }));
    });

    const taken: AgendaItem[] = bookings
      .filter((b) => startsToday(b.start))
      .map((b) => ({
        kind: "taken" as const,
        key: b.id,
        label: b.label,
        tone: b.tone,
        ...clock(b.start, b.end),
      }));

    return {
      key: day.key,
      weekday: day.weekday,
      dayOfMonth: day.dayOfMonth,
      title: new Date(
        Date.UTC(day.date.y, day.date.m - 1, day.date.d),
      ).toLocaleDateString("en-US", {
        weekday: "long",
        month: "short",
        day: "numeric",
        timeZone: "UTC",
      }),
      isToday: day.isToday,
      windows: todays.map((o) => {
        const c = clock(o.start, o.end);
        return `${o.window.name} ${c.start}–${c.end}${c.endsNextDay ? " next day" : ""}`;
      }),
      hasOpen: open.length > 0,
      items: [...open, ...taken].sort((a, b) => a.at - b.at),
    };
  });
}
