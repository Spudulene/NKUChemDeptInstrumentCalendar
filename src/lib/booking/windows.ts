import type { BookingWindowModel } from "@/generated/prisma/models";
import {
  addCivilDays,
  civilToInstant,
  civilWeekday,
  compareCivil,
  instantToCivil,
  MINUTES_PER_DAY,
  type CivilDate,
} from "@/lib/time";

/**
 * Only the fields that describe when a window is open and what may be booked in it.
 * Structural rather than the full model so this is testable without a database.
 */
export type WindowRule = Pick<
  BookingWindowModel,
  | "id"
  | "name"
  | "daysOfWeek"
  | "startMinute"
  | "endMinute"
  | "minDurationMinutes"
  | "maxDurationMinutes"
  | "slotSizeMinutes"
  | "wholeBlockOnly"
  | "maxConsecutiveSlots"
  | "maxBookingsPerUserPerWeek"
  | "isActive"
>;

/** One concrete appearance of a recurring window on the calendar. */
export type WindowOccurrence = {
  window: WindowRule;
  /** The civil date the window opens on. An overnight FRI window ends on Saturday. */
  date: CivilDate;
  start: Date;
  end: Date;
};

export type Interval = { start: Date; end: Date };

/**
 * End time as minutes-from-midnight on the window's start date, so an overnight
 * window reads as a single ascending span rather than a wrap.
 *
 *   08:00 -> 17:00  becomes  480 -> 1020
 *   17:00 -> 08:00  becomes  1020 -> 1920   (08:00 the next day)
 *   08:00 -> 24:00  becomes  480 -> 1440
 *
 * Every downstream calculation works on this normalized form, which is why nothing
 * else in the codebase needs a special case for crossing midnight.
 */
export function normalizedEndMinute(window: {
  startMinute: number;
  endMinute: number;
}): number {
  return window.endMinute <= window.startMinute
    ? window.endMinute + MINUTES_PER_DAY
    : window.endMinute;
}

export function windowSpanMinutes(window: {
  startMinute: number;
  endMinute: number;
}): number {
  return normalizedEndMinute(window) - window.startMinute;
}

export function crossesMidnight(window: {
  startMinute: number;
  endMinute: number;
}): boolean {
  return normalizedEndMinute(window) > MINUTES_PER_DAY;
}

/**
 * Every occurrence of these windows that opens between `from` and `to` inclusive.
 *
 * The real span of an occurrence is computed from wall-clock endpoints, so on the
 * spring-forward date an overnight window is genuinely one hour shorter. That is the
 * correct answer — the instrument really is available for one hour less that night.
 */
export function expandWindows(
  windows: readonly WindowRule[],
  from: CivilDate,
  to: CivilDate,
): WindowOccurrence[] {
  const active = windows.filter((w) => w.isActive);
  if (active.length === 0 || compareCivil(from, to) > 0) return [];

  const occurrences: WindowOccurrence[] = [];

  for (let date = from; compareCivil(date, to) <= 0; date = addCivilDays(date, 1)) {
    const weekday = civilWeekday(date);

    for (const window of active) {
      if (!window.daysOfWeek.includes(weekday)) continue;

      occurrences.push({
        window,
        date,
        start: civilToInstant(date, window.startMinute),
        end: civilToInstant(date, normalizedEndMinute(window)),
      });
    }
  }

  return occurrences.sort((a, b) => a.start.getTime() - b.start.getTime());
}

/**
 * Occurrences overlapping an instant range.
 *
 * Expansion starts a day early because an overnight window that opened yesterday can
 * still be running this morning — dropping it would make 6am look unbookable.
 */
export function expandWindowsOverlapping(
  windows: readonly WindowRule[],
  rangeStart: Date,
  rangeEnd: Date,
): WindowOccurrence[] {
  const from = addCivilDays(instantToCivil(rangeStart), -1);
  const to = instantToCivil(rangeEnd);

  return expandWindows(windows, from, to).filter(
    (o) => o.start < rangeEnd && o.end > rangeStart,
  );
}

/** True when [start, end) sits entirely inside the occurrence. */
export function occurrenceContains(
  occurrence: WindowOccurrence,
  start: Date,
  end: Date,
): boolean {
  return occurrence.start <= start && occurrence.end >= end;
}

/**
 * The occurrence a proposed booking belongs to, or null if it spans a gap between
 * windows or falls outside operating hours entirely.
 */
export function findContainingOccurrence(
  windows: readonly WindowRule[],
  start: Date,
  end: Date,
): WindowOccurrence | null {
  const candidates = expandWindowsOverlapping(windows, start, end);
  return candidates.find((o) => occurrenceContains(o, start, end)) ?? null;
}

/**
 * Candidate start times inside an occurrence, on the window's slot grid.
 *
 * The grid is measured from the window's own start, not from midnight — a window
 * opening at 08:15 with 30-minute slots offers 08:15, 08:45, and so on. Anchoring to
 * midnight instead would make the first slot unbookable.
 */
export function slotStarts(
  occurrence: WindowOccurrence,
  durationMinutes: number,
): Date[] {
  const { window } = occurrence;

  if (window.wholeBlockOnly) {
    const span = windowSpanMinutes(window);
    return durationMinutes === span ? [occurrence.start] : [];
  }

  const span = windowSpanMinutes(window);
  if (durationMinutes > span) return [];

  const starts: Date[] = [];
  for (
    let offset = 0;
    offset + durationMinutes <= span;
    offset += window.slotSizeMinutes
  ) {
    starts.push(civilToInstant(occurrence.date, window.startMinute + offset));
  }

  return starts;
}

/** Merge overlapping/adjacent intervals into a minimal sorted set. */
export function mergeIntervals(intervals: readonly Interval[]): Interval[] {
  if (intervals.length === 0) return [];

  const sorted = [...intervals].sort(
    (a, b) => a.start.getTime() - b.start.getTime(),
  );
  const merged: Interval[] = [{ ...sorted[0] }];

  for (const current of sorted.slice(1)) {
    const last = merged[merged.length - 1];
    if (current.start <= last.end) {
      if (current.end > last.end) last.end = current.end;
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * `base` minus `busy`. Used to turn "the window is open 17:00–08:00" plus "someone
 * booked 20:00–22:00" into the two gaps that remain.
 */
export function subtractIntervals(
  base: Interval,
  busy: readonly Interval[],
): Interval[] {
  const blockers = mergeIntervals(busy).filter(
    (b) => b.end > base.start && b.start < base.end,
  );

  const free: Interval[] = [];
  let cursor = base.start;

  for (const block of blockers) {
    if (block.start > cursor) {
      free.push({ start: cursor, end: block.start });
    }
    if (block.end > cursor) cursor = block.end;
  }

  if (cursor < base.end) free.push({ start: cursor, end: base.end });

  return free;
}
