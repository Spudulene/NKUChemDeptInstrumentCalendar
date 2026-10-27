import { horizonEnd, opensForBooking } from "@/lib/booking/horizon";
import { computeBookableSlots } from "@/lib/booking/slots";
import type { Interval, WindowRule } from "@/lib/booking/windows";
import { civilToInstant, formatDayLabel, formatDurationMinutes, instantToCivil } from "@/lib/time";

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
  rules: SlotRules & { now: Date; leadMinutes: number; horizonDays: number },
  gap: Interval,
  window: WindowRule,
): Unbookable | null {
  const { now, leadMinutes, horizonDays, bufferMinutes = 0 } = rules;

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
    // Whole days open at midnight, so the start's own day decides when.
    const opens = opensForBooking(instantToCivil(beyondHorizon[0].start), horizonDays);
    const day = formatDayLabel(civilToInstant(opens, 0));
    return {
      label: `Opens ${day.split(", ")[1]}`,
      detail: `Too far ahead to book yet. Opens for booking on ${day}.`,
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

/** The parts of an instrument the slot rules read. */
type InstrumentRules = {
  windows: readonly WindowRule[];
  minLeadTimeMinutes: number;
  bookingHorizonDays: number;
  bufferMinutes: number;
};

/**
 * One instrument's slot rules as of `now` over [from, to), and `whyUnbookable` bound to
 * them in the shape the schedule builders take. Shared by the instrument page and the
 * embed, so both explain open time the same way.
 */
export function instrumentRules(args: {
  instrument: InstrumentRules;
  busy: readonly Interval[];
  from: Date;
  to: Date;
  now: Date;
}): { rules: SlotRules; explain: (gap: Interval, window: WindowRule) => Unbookable | null } {
  const { instrument, busy, from, to, now } = args;
  const rules: SlotRules = {
    windows: instrument.windows,
    busy,
    from,
    to,
    earliest: new Date(now.getTime() + instrument.minLeadTimeMinutes * 60_000),
    latest: horizonEnd(now, instrument.bookingHorizonDays),
    bufferMinutes: instrument.bufferMinutes,
  };
  return {
    rules,
    explain: (gap, window) =>
      whyUnbookable(
        {
          ...rules,
          now,
          leadMinutes: instrument.minLeadTimeMinutes,
          horizonDays: instrument.bookingHorizonDays,
        },
        gap,
        window,
      ),
  };
}
