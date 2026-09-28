import {
  expandWindows,
  slotStarts,
  subtractIntervals,
  windowSpanMinutes,
  type Interval,
  type WindowOccurrence,
  type WindowRule,
} from "@/lib/booking/windows";
import { addCivilDays, instantToCivil } from "@/lib/time";

/**
 * A start time a student could actually pick, with the lengths available from it.
 *
 * Computed on the server and handed to the calendar so clicking a slot opens a form
 * with real choices instead of a free-text time picker that mostly produces errors.
 * The server action re-validates on submit regardless — this exists to make the UI
 * honest, not to enforce anything.
 */
export type BookableSlot = {
  start: Date;
  windowId: string;
  windowName: string;
  /** Selectable lengths in minutes, ascending. Never empty. */
  durations: number[];
  /** Overnight blocks: the single duration is the whole window. */
  wholeBlock: boolean;
};

export function computeBookableSlots(args: {
  windows: readonly WindowRule[];
  busy: readonly Interval[];
  from: Date;
  to: Date;
  /** Nothing starting before this is offered (lead time, or simply "now"). */
  earliest: Date;
  /** Nothing starting after this is offered (booking horizon). */
  latest: Date;
  bufferMinutes?: number;
}): BookableSlot[] {
  const { windows, busy, from, to, earliest, latest, bufferMinutes = 0 } = args;

  const bufferMs = bufferMinutes * 60_000;
  const blocked: Interval[] = busy.map((b) => ({
    start: new Date(b.start.getTime() - bufferMs),
    end: new Date(b.end.getTime() + bufferMs),
  }));

  // A day early: an overnight window that opened yesterday may still be bookable.
  const occurrences = expandWindows(
    windows,
    addCivilDays(instantToCivil(from), -1),
    instantToCivil(to),
  );

  const slots: BookableSlot[] = [];

  for (const occurrence of occurrences) {
    if (occurrence.end <= from || occurrence.start >= to) continue;
    slots.push(...slotsInOccurrence(occurrence, blocked, earliest, latest));
  }

  return slots.sort((a, b) => a.start.getTime() - b.start.getTime());
}

function slotsInOccurrence(
  occurrence: WindowOccurrence,
  blocked: readonly Interval[],
  earliest: Date,
  latest: Date,
): BookableSlot[] {
  const { window } = occurrence;
  const free = subtractIntervals(occurrence, blocked);
  if (free.length === 0) return [];

  const label = { windowId: window.id, windowName: window.name };

  if (window.wholeBlockOnly) {
    const span = windowSpanMinutes(window);
    const intact = free.some(
      (f) => f.start <= occurrence.start && f.end >= occurrence.end,
    );

    if (!intact || occurrence.start < earliest || occurrence.start > latest) {
      return [];
    }

    return [{ start: occurrence.start, durations: [span], wholeBlock: true, ...label }];
  }

  // A student may not chain more slots than the window allows, whatever the gap.
  const cap = window.maxConsecutiveSlots
    ? Math.min(
        window.maxDurationMinutes,
        window.maxConsecutiveSlots * window.slotSizeMinutes,
      )
    : window.maxDurationMinutes;

  const results: BookableSlot[] = [];

  for (const start of slotStarts(occurrence, window.minDurationMinutes)) {
    if (start < earliest || start > latest) continue;

    const gap = free.find((f) => f.start <= start && f.end > start);
    if (!gap) continue;

    // How long this start can run before hitting a booking, the buffer, or the cap.
    const available = Math.min(
      cap,
      (gap.end.getTime() - start.getTime()) / 60_000,
    );
    if (available < window.minDurationMinutes) continue;

    const durations: number[] = [];
    for (
      let d = window.minDurationMinutes;
      d <= available;
      d += window.slotSizeMinutes
    ) {
      durations.push(d);
    }

    if (durations.length > 0) {
      results.push({ start, durations, wholeBlock: false, ...label });
    }
  }

  return results;
}
