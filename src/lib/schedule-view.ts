import type { BookableSlot } from "@/lib/booking/slots";
import { limitBands, type BookingLimits, type Unbookable } from "@/lib/booking/unbookable";
import {
  expandWindows,
  normalizedEndMinute,
  subtractIntervals,
  type Interval,
  type WindowRule,
} from "@/lib/booking/windows";
import {
  MINUTES_PER_DAY,
  addCivilDays,
  civilToISODate,
  civilToInstant,
  compareCivil,
  formatRange,
  instantToCivil,
  instantToMinutes,
  minutesToClock,
  type CivilDate,
} from "@/lib/time";
import { campusDays, type CampusDay } from "@/lib/week";
import { windowHours } from "@/lib/window-copy";

/**
 * Everything the week grid draws, worked out on the server.
 *
 * Laid out as in the Calendar artboard: a time grid covering only the hours that
 * matter, with whole-block windows (overnight runs) as a row of their own underneath
 * rather than fifteen hours of mostly-empty column.
 */

export type ScheduleTone = "student" | "mine" | "class" | "maintenance";

export type ScheduleBooking = {
  id: string;
  start: Date;
  end: Date;
  label: string;
  sublabel?: string;
  tone: ScheduleTone;
};

export type GridDay = Omit<CampusDay, "date" | "start" | "end"> & {
  isWeekend: boolean;
  /** The visible part of the day, as instants, so DST days still line up. */
  start: Date;
  end: Date;
};

export type GridBlock = ScheduleBooking & {
  /** "14:00 – 15:00" for the block itself. */
  time: string;
  /** "Mon, Oct 26, 2:00 PM – 3:00 PM" for screen readers and the tooltip. */
  when: string;
};

export type GridBand = { key: string; start: Date; end: Date };

/** Time inside a window that the clock rules out (past, too soon, not open yet). */
export type GridShade = GridBand & { why: Unbookable };

/** A start time the viewer can click, with its labels formatted on the server. */
export type GridSlot = { slot: BookableSlot; time: string; when: string };

export type BlockCell =
  | { day: string; state: "none" }
  | {
      day: string;
      state: "open";
      slot: BookableSlot | null;
      when: string;
      /** Why no one can book it, when that's the case. */
      unbookable?: Unbookable;
    }
  | { day: string; state: "taken"; label: string; tone: ScheduleTone; when: string };

export type BlockRow = { id: string; name: string; hours: string; cells: BlockCell[] };

export type ScheduleView = {
  days: GridDay[];
  /** Minutes from midnight, on whole hours. `endMinute` may be 1440. */
  startMinute: number;
  endMinute: number;
  /** Visible time no timed window covers — greyed out, so open time reads as open. */
  closed: GridBand[];
  /** Open-looking time no one can book; shaded so only bookable time looks open. */
  shaded: GridShade[];
  blocks: GridBlock[];
  slots: GridSlot[];
  rows: BlockRow[];
};

const DEFAULT_RANGE = { start: 8 * 60, end: 17 * 60 };

export function buildScheduleView(args: {
  weekStart: CivilDate;
  today: CivilDate;
  windows: readonly WindowRule[];
  bookings: ScheduleBooking[];
  slots: BookableSlot[];
  /** Explains open time no one can book; see `whyUnbookable`. */
  explain?: (gap: Interval, window: WindowRule) => Unbookable | null;
  /** The clock limits on booking; without them nothing is shaded. */
  limits?: BookingLimits;
}): ScheduleView {
  const { weekStart, today, windows, bookings, slots, explain, limits } = args;
  const weekEnd = addCivilDays(weekStart, 7);

  // A day early, so a window that opened Saturday night still reaches Sunday.
  const occurrences = expandWindows(windows, addCivilDays(weekStart, -1), weekEnd);
  const whole = occurrences.filter((o) => o.window.wholeBlockOnly);
  const timed = occurrences.filter((o) => !o.window.wholeBlockOnly);

  // --- Visible hours: the timed windows, stretched to fit any stray booking --------
  const timedRules = windows.filter((w) => w.isActive && !w.wholeBlockOnly);
  let start = timedRules.length ? Math.min(...timedRules.map((w) => w.startMinute)) : DEFAULT_RANGE.start;
  let end = timedRules.length
    ? Math.max(...timedRules.map((w) => normalizedEndMinute(w)))
    : DEFAULT_RANGE.end;
  if (end > MINUTES_PER_DAY) {
    // A timed window crossing midnight: only the whole day shows all of it.
    start = 0;
    end = MINUTES_PER_DAY;
  }

  const overlapsWhole = (b: ScheduleBooking) => whole.some((o) => o.start < b.end && o.end > b.start);
  for (const b of bookings) {
    // A booking the overnight row will show doesn't need to stretch the grid.
    if (overlapsWhole(b)) continue;
    const sameDay = compareCivil(instantToCivil(b.start), instantToCivil(new Date(b.end.getTime() - 1))) === 0;
    if (!sameDay) {
      start = 0;
      end = MINUTES_PER_DAY;
      break;
    }
    const s = instantToMinutes(b.start);
    const e = instantToMinutes(b.end) || MINUTES_PER_DAY;
    start = Math.min(start, s);
    end = Math.max(end, e);
  }
  start = Math.floor(start / 60) * 60;
  end = Math.min(MINUTES_PER_DAY, Math.ceil(end / 60) * 60);

  // --- Days ------------------------------------------------------------------------
  const campus = campusDays(weekStart, 7, today);
  const days: GridDay[] = campus.map((d) => {
    const weekday = new Date(Date.UTC(d.date.y, d.date.m - 1, d.date.d)).getUTCDay();
    return {
      key: d.key,
      weekday: d.weekday,
      dayOfMonth: d.dayOfMonth,
      isToday: d.isToday,
      isWeekend: weekday === 0 || weekday === 6,
      start: civilToInstant(d.date, start),
      end: civilToInstant(d.date, end),
    };
  });

  // --- Grid contents ---------------------------------------------------------------
  const clock = (instant: Date) => minutesToClock(instantToMinutes(instant));
  const blocks: GridBlock[] = bookings.map((b) => ({
    ...b,
    time: `${clock(b.start)} – ${clock(b.end)}`,
    when: formatRange(b.start, b.end),
  }));

  // --- One row per whole-block window that occurs this week --------------------------
  const rules = [...new Map(whole.map((o) => [o.window.id, o.window])).values()];
  const rows: BlockRow[] = rules
    .map((rule) => {
      const cells: BlockCell[] = campus.map((d) => {
        const occ = whole.find(
          (o) => o.window.id === rule.id && civilToISODate(o.date) === d.key,
        );
        if (!occ) return { day: d.key, state: "none" };

        const when = formatRange(occ.start, occ.end);
        const taker = bookings
          .filter((b) => b.start < occ.end && b.end > occ.start)
          .sort((a, b) => a.start.getTime() - b.start.getTime())[0];
        if (taker) {
          return { day: d.key, state: "taken", label: taker.label, tone: taker.tone, when };
        }
        const slot =
          slots.find((s) => s.wholeBlock && s.start.getTime() === occ.start.getTime()) ?? null;
        const unbookable = slot ? null : explain?.(occ, rule);
        return { day: d.key, state: "open", slot, when, ...(unbookable && { unbookable }) };
      });
      return { id: rule.id, name: rule.name, hours: windowHours(rule), cells };
    })
    .filter((row) => row.cells.some((c) => c.state !== "none"));

  const closed: GridBand[] = days.flatMap((d) =>
    subtractIntervals({ start: d.start, end: d.end }, timed).map((gap) => ({
      key: `${d.key}-${gap.start.getTime()}`,
      ...gap,
    })),
  );

  const shaded: GridShade[] = limits
    ? timed.flatMap((o) =>
        limitBands(o, limits).map((band) => ({ key: `${band.why.kind}-${band.start.getTime()}`, ...band })),
      )
    : [];

  return {
    days,
    startMinute: start,
    endMinute: end,
    closed,
    shaded,
    blocks,
    slots: slots
      .filter((s) => !s.wholeBlock)
      .map((slot) => ({
        slot,
        time: clock(slot.start),
        when: formatRange(slot.start, new Date(slot.start.getTime() + slot.durations[0] * 60_000)),
      })),
    rows,
  };
}
