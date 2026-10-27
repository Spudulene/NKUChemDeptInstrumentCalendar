import { horizonEnd, opensForBooking } from "@/lib/booking/horizon";
import { computeBookableSlots } from "@/lib/booking/slots";
import type { Interval, WindowRule } from "@/lib/booking/windows";
import {
  addCivilDays,
  civilToInstant,
  formatDayLabel,
  formatDurationMinutes,
  instantToCivil,
  type CivilDate,
} from "@/lib/time";

/** Why open time can't be booked: a short label for tight cells, and a sentence. */
export type Unbookable = {
  kind: "past" | "started" | "too-soon" | "not-open" | "changeover";
  label: string;
  detail: string;
};

/** The wording for each reason, in one place so every view says it the same way. */
const reason = {
  past: (): Unbookable => ({ kind: "past", label: "Past", detail: "This time has passed." }),
  started: (): Unbookable => ({
    kind: "started",
    label: "Started",
    detail: "Already under way. This block is booked whole, from its start.",
  }),
  tooSoon: (leadMinutes: number): Unbookable => ({
    kind: "too-soon",
    label: "Too soon",
    detail: `Too soon to book. Bookings must be made at least ${formatDurationMinutes(leadMinutes)} ahead.`,
  }),
  notOpen: (day: CivilDate, horizonDays: number): Unbookable => {
    const opens = formatDayLabel(civilToInstant(opensForBooking(day, horizonDays), 0));
    return {
      kind: "not-open",
      label: `Opens ${opens.split(", ")[1]}`,
      detail: `Too far ahead to book yet. Opens for booking on ${opens}.`,
    };
  },
  changeover: (bufferMinutes: number): Unbookable => ({
    kind: "changeover",
    label: "Changeover",
    detail: `No room for the ${formatDurationMinutes(bufferMinutes)} changeover between bookings.`,
  }),
};

export type SlotRules = Parameters<typeof computeBookableSlots>[0];

/** The clock-based limits on booking, as of `now`. */
export type BookingLimits = {
  now: Date;
  /** Nothing may start before this (the lead time). */
  earliest: Date;
  /** Nothing may start at or after this (the horizon; see `horizonEnd`). */
  latest: Date;
  leadMinutes: number;
  horizonDays: number;
};

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
  rules: SlotRules & BookingLimits,
  gap: Interval,
  window: WindowRule,
): Unbookable | null {
  const { now, leadMinutes, horizonDays, bufferMinutes = 0 } = rules;

  if (gap.end <= now) return reason.past();
  if (gap.start < now && window.wholeBlockOnly) return reason.started();

  const startsIn = (overrides: Partial<SlotRules>) =>
    computeBookableSlots({ ...rules, from: gap.start, to: gap.end, ...overrides }).filter(
      (s) => s.windowId === window.id && s.start >= gap.start && s.start < gap.end,
    );

  if (startsIn({}).length > 0) return null;

  const farFuture = new Date(8.64e15);
  const beyondHorizon = startsIn({ latest: farFuture });
  if (beyondHorizon.length > 0) {
    // Whole days open at midnight, so the start's own day decides when.
    return reason.notOpen(instantToCivil(beyondHorizon[0].start), horizonDays);
  }

  if (leadMinutes > 0 && startsIn({ latest: farFuture, earliest: now }).length > 0) {
    return reason.tooSoon(leadMinutes);
  }

  if (bufferMinutes > 0 && startsIn({ latest: farFuture, earliest: now, bufferMinutes: 0 }).length > 0) {
    return reason.changeover(bufferMinutes);
  }

  return null;
}

/**
 * The stretches of `span` the clock rules out for everyone: time that has passed, time
 * inside the lead time, and days the horizon hasn't reached. The week grid shades
 * these, so time that looks open is open. A day beyond the horizon is its own stretch,
 * since each day opens on its own date.
 *
 * Changeover gaps are left out: a 15-minute strip around every booking is noise, and
 * where one rules out a whole block, `whyUnbookable` says so.
 */
export function limitBands(
  span: Interval,
  limits: BookingLimits,
): Array<Interval & { why: Unbookable }> {
  const { now, earliest, latest, leadMinutes, horizonDays } = limits;
  const bands: Array<Interval & { why: Unbookable }> = [];
  const add = (start: Date, end: Date, why: Unbookable) => {
    const from = start > span.start ? start : span.start;
    const to = end < span.end ? end : span.end;
    if (to > from) bands.push({ start: from, end: to, why });
  };

  add(span.start, now, reason.past());
  if (leadMinutes > 0) add(now, earliest, reason.tooSoon(leadMinutes));

  let cursor = latest > span.start ? latest : span.start;
  while (cursor < span.end) {
    const day = instantToCivil(cursor);
    const nextMidnight = civilToInstant(addCivilDays(day, 1), 0);
    add(cursor, nextMidnight, reason.notOpen(day, horizonDays));
    cursor = nextMidnight;
  }

  return bands;
}

/** The parts of an instrument the slot rules read. */
type InstrumentRules = {
  windows: readonly WindowRule[];
  minLeadTimeMinutes: number;
  bookingHorizonDays: number;
  bufferMinutes: number;
};

/**
 * One instrument's slot rules and clock limits as of `now` over [from, to), and
 * `whyUnbookable` bound to them in the shape the schedule builders take. Shared by the
 * instrument page and the embed, so both explain open time the same way.
 */
export function instrumentRules(args: {
  instrument: InstrumentRules;
  busy: readonly Interval[];
  from: Date;
  to: Date;
  now: Date;
}): {
  rules: SlotRules;
  limits: BookingLimits;
  explain: (gap: Interval, window: WindowRule) => Unbookable | null;
} {
  const { instrument, busy, from, to, now } = args;
  const limits: BookingLimits = {
    now,
    earliest: new Date(now.getTime() + instrument.minLeadTimeMinutes * 60_000),
    latest: horizonEnd(now, instrument.bookingHorizonDays),
    leadMinutes: instrument.minLeadTimeMinutes,
    horizonDays: instrument.bookingHorizonDays,
  };
  const rules: SlotRules = {
    windows: instrument.windows,
    busy,
    from,
    to,
    earliest: limits.earliest,
    latest: limits.latest,
    bufferMinutes: instrument.bufferMinutes,
  };
  return {
    rules,
    limits,
    explain: (gap, window) => whyUnbookable({ ...rules, ...limits }, gap, window),
  };
}
