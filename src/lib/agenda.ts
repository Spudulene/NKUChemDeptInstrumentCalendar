import type { BookableSlot } from "@/lib/booking/slots";
import type { Unbookable } from "@/lib/booking/unbookable";
import type { Interval, WindowOccurrence, WindowRule } from "@/lib/booking/windows";
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

type Tone = "student" | "mine" | "class" | "maintenance";

export type AgendaBooking = {
  id: string;
  start: Date;
  end: Date;
  label: string;
  /** A class's instructor, or what maintenance is for. */
  sublabel?: string;
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
  | ({
      kind: "open";
      key: string;
      /** "Open · 9 hours free", or "Open tonight" for a whole overnight block. */
      headline: string;
      windowName: string;
      /** Every start the viewer could book in this gap; empty where no one can book here. */
      starts: BookableSlot[];
      /** Why no one can book this gap, when that's the case. */
      unbookable?: Unbookable;
    } & Clock)
  | ({ kind: "taken"; key: string; label: string; sublabel?: string; tone: Tone } & Clock);

export type AgendaDay = {
  key: string;
  weekday: string;
  dayOfMonth: number;
  /** "Monday, Oct 26" */
  title: string;
  isToday: boolean;
  /** The timed windows that open on this day, e.g. "Daytime 08:00–17:00". */
  windows: string[];
  /** Something is still bookable: open time no one can book doesn't count. */
  hasOpen: boolean;
  /** The viewer has a booking starting this day. */
  hasMine: boolean;
  /** Open and taken time in the day's timed windows. */
  items: AgendaItem[];
  /**
   * Whole-block windows (overnight) opening this day, each in its own section as in
   * the artboard: one block is one booking, so it reads apart from the timed list.
   */
  blocks: AgendaBlock[];
};

export type AgendaBlock = {
  key: string;
  name: string;
  /** "17:00 → 08:00 next day" */
  hours: string;
  items: AgendaItem[];
  /** What to say when there's nothing to list: the block is past or under way. */
  empty: string;
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
 *
 * `slots` are the viewer's own bookable starts (lead time, horizon and changeover
 * applied); each open gap carries the ones that fall inside it, for the booking dialog.
 * A gap with none is passed to `explain`, so the list can say why instead of offering it.
 */
export function buildAgenda(args: {
  days: CampusDay[];
  occurrences: WindowOccurrence[];
  bookings: AgendaBooking[];
  slots?: BookableSlot[];
  explain?: (gap: Interval, window: WindowRule) => Unbookable | null;
  now: Date;
}): AgendaDay[] {
  const { days, occurrences, bookings, slots = [], explain, now } = args;
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

    const openIn = (o: WindowOccurrence): AgendaItem[] => {
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

      return usable.map((g) => {
        const starts = slots.filter(
          (s) => s.windowId === o.window.id && s.start >= g.start && s.start < g.end,
        );
        const unbookable = starts.length === 0 ? explain?.(g, o.window) : null;
        return {
          kind: "open" as const,
          key: `open-${g.start.getTime()}`,
          // A block is all or nothing, so how much of it is free says nothing.
          headline: o.window.wholeBlockOnly
            ? instantToMinutes(g.start) >= 12 * 60
              ? "Open tonight"
              : "Open"
            : `Open · ${formatDurationMinutes(Math.round((g.end.getTime() - g.start.getTime()) / MINUTE_MS))} free`,
          windowName: o.window.name,
          starts,
          ...(unbookable && { unbookable }),
          ...clock(g.start, g.end),
        };
      });
    };

    const taken: AgendaItem[] = bookings
      .filter((b) => startsToday(b.start))
      .map((b) => ({
        kind: "taken" as const,
        key: b.id,
        label: b.label,
        sublabel: b.sublabel,
        tone: b.tone,
        ...clock(b.start, b.end),
      }));

    // Whatever starts inside a block opening today belongs to that block's section.
    const timed = todays.filter((o) => !o.window.wholeBlockOnly);
    const wholeBlocks = todays.filter((o) => o.window.wholeBlockOnly);
    const inBlock = (item: AgendaItem, o: WindowOccurrence) =>
      item.at >= o.start.getTime() && item.at < o.end.getTime();
    const blocks: AgendaBlock[] = wholeBlocks.map((o) => {
      const c = clock(o.start, o.end);
      return {
        key: `${o.window.id}-${o.start.getTime()}`,
        name: o.window.name,
        hours: `${c.start} → ${c.end}${c.endsNextDay ? " next day" : ""}`,
        items: [...openIn(o), ...taken.filter((t) => inBlock(t, o))].sort((a, b) => a.at - b.at),
        empty: o.end <= now ? "This block has passed." : "Already under way. Blocks are booked from their start.",
      };
    });
    const items = [
      ...timed.flatMap(openIn),
      ...taken.filter((t) => !wholeBlocks.some((o) => inBlock(t, o))),
    ].sort((a, b) => a.at - b.at);
    const everything = [...items, ...blocks.flatMap((b) => b.items)];

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
      windows: timed.map((o) => {
        const c = clock(o.start, o.end);
        return `${o.window.name} ${c.start}–${c.end}${c.endsNextDay ? " next day" : ""}`;
      }),
      hasOpen: everything.some((o) => o.kind === "open" && !o.unbookable),
      hasMine: taken.some((t) => t.kind === "taken" && t.tone === "mine"),
      items,
      blocks,
    };
  });
}
