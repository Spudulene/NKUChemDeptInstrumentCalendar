import { computeBookableSlots } from "@/lib/booking/slots";
import type { Interval, WindowRule } from "@/lib/booking/windows";
import { formatDayLabel, formatDurationMinutes, instantToMinutes, minutesToClock } from "@/lib/time";

/** Why open time can't be booked: a short label for tight cells, and a sentence. */
export type Unbookable = { label: string; detail: string };

export type SlotRules = Parameters<typeof computeBookableSlots>[0];

/**
 * Explains open time that no student can book, so the schedule doesn't show "Open"
 * with no way in. These rules are the same for everyone (weekly caps are per-student
 * and checked on submit), so the answer holds whoever is looking.
 *
 * Works by relaxing the slot rules one at a time, cumulatively, until the gap yields a
 * start: the first rule whose removal frees it is the reason. Returns null when the
 * gap is bookable, or when nothing explains it.
 */
export function whyUnbookable(
  rules: SlotRules & { now: Date; leadMinutes: number },
  gap: Interval,
  window: WindowRule,
): Unbookable | null {
  const { now, leadMinutes, latest, bufferMinutes = 0 } = rules;

  if (gap.end <= now) return { label: "Past", detail: "This time has passed." };
  if (gap.start < now && window.wholeBlockOnly) {
    return { label: "Started", detail: "Already under way. This block is booked whole, from its start." };
  }

  const startsIn = (overrides: Partial<SlotRules>) =>
    computeBookableSlots({ ...rules, from: gap.start, to: gap.end, ...overrides }).filter(
      (s) => s.windowId === window.id && s.start >= gap.start && s.start < gap.end,
    );

  if (startsIn({}).length > 0) return null;

  const farFuture = new Date(8.64e15);
  const beyondHorizon = startsIn({ latest: farFuture });
  if (beyondHorizon.length > 0) {
    // The horizon rolls forward with the clock: a start becomes bookable once it is
    // within the same distance of now that `latest` is.
    const opensAt = new Date(beyondHorizon[0].start.getTime() - (latest.getTime() - now.getTime()));
    const day = formatDayLabel(opensAt);
    return {
      label: `Opens ${day.split(", ")[1]}`,
      detail: `Too far ahead to book yet. Opens for booking ${day} at ${minutesToClock(instantToMinutes(opensAt))}.`,
    };
  }

  if (leadMinutes > 0 && startsIn({ latest: farFuture, earliest: now }).length > 0) {
    return {
      label: "Too soon",
      detail: `Too soon to book. Bookings must be made at least ${formatDurationMinutes(leadMinutes)} ahead.`,
    };
  }

  if (bufferMinutes > 0 && startsIn({ latest: farFuture, earliest: now, bufferMinutes: 0 }).length > 0) {
    return {
      label: "Changeover",
      detail: `No room for the ${formatDurationMinutes(bufferMinutes)} changeover between bookings.`,
    };
  }

  return null;
}
