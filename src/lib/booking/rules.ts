import type { BookingType, Role } from "@/generated/prisma/enums";
import type { InstrumentModel } from "@/generated/prisma/models";
import {
  formatDurationMinutes,
  formatInstant,
  formatRange,
  formatTimeOnly,
} from "@/lib/time";
import {
  findContainingOccurrence,
  slotStarts,
  windowSpanMinutes,
  type WindowOccurrence,
  type WindowRule,
} from "@/lib/booking/windows";

/**
 * Validation is an ordered list of independent rules rather than one long function.
 *
 * Two reasons this shape matters here. First, each rule produces its own message, so
 * a student sees "bookings must start at least 2 hours out" instead of a generic
 * rejection. Second, when instrument training turns out to be a real requirement,
 * adding it is one entry in this array plus an additive migration — no rewrite.
 */

export type InstrumentPolicy = Pick<
  InstrumentModel,
  | "id"
  | "name"
  | "isActive"
  | "bookingHorizonDays"
  | "minLeadTimeMinutes"
  | "cancellationDeadlineMinutes"
  | "bufferMinutes"
  | "maxMinutesPerUserPerWeek"
  | "requireResearchAdvisor"
>;

export type BookingRequest = {
  userId: string;
  start: Date;
  end: Date;
  type: BookingType;
  description?: string | null;
  /**
   * Research group this time is for. Resolved by the caller before validation —
   * defaulted from the student's profile and overridable per booking, since students
   * do occasionally run samples for another group.
   */
  advisorId?: string | null;
  /** Set when editing, so the booking does not conflict with itself. */
  excludeBookingId?: string;
};

/** A confirmed booking already on the instrument, trimmed to what rules need. */
export type ExistingBooking = {
  id: string;
  userId: string;
  windowId: string | null;
  start: Date;
  end: Date;
};

export type RuleContext = {
  instrument: InstrumentPolicy;
  windows: readonly WindowRule[];
  request: BookingRequest;
  actor: { id: string; role: Role };
  now: Date;
  /** Confirmed bookings on this instrument near the request (buffer + conflicts). */
  neighbors: readonly ExistingBooking[];
  /** The requesting user's confirmed bookings in the same campus calendar week. */
  userBookingsThisWeek: readonly ExistingBooking[];
  /** Resolved once by `validateBooking` and shared across rules. */
  occurrence: WindowOccurrence | null;
};

export type RuleFailure = { code: string; message: string };
export type RuleResult = RuleFailure | null;
export type Rule = (ctx: RuleContext) => RuleResult;

const MINUTE_MS = 60_000;

function durationMinutes(ctx: RuleContext): number {
  return (ctx.request.end.getTime() - ctx.request.start.getTime()) / MINUTE_MS;
}

// ---------------------------------------------------------------------------
// Rules shared by every booking type
// ---------------------------------------------------------------------------

const instrumentIsActive: Rule = (ctx) =>
  ctx.instrument.isActive
    ? null
    : {
        code: "INSTRUMENT_ARCHIVED",
        message: `${ctx.instrument.name} is no longer accepting bookings.`,
      };

const endsAfterStart: Rule = (ctx) =>
  ctx.request.end > ctx.request.start
    ? null
    : { code: "INVALID_RANGE", message: "The end time must be after the start time." };

const notInThePast: Rule = (ctx) =>
  ctx.request.end > ctx.now
    ? null
    : { code: "IN_THE_PAST", message: "That time has already passed." };

const priorityBookingsExplainThemselves: Rule = (ctx) => {
  if (ctx.request.type === "STUDENT") return null;
  return ctx.request.description?.trim()
    ? null
    : {
        code: "DESCRIPTION_REQUIRED",
        message:
          "Add a short description — students who get bumped will see this as the reason.",
      };
};

const doesNotOverlapConfirmed: Rule = (ctx) => {
  const clash = ctx.neighbors.find(
    (b) =>
      b.id !== ctx.request.excludeBookingId &&
      b.start < ctx.request.end &&
      b.end > ctx.request.start,
  );

  return clash
    ? {
        code: "CONFLICT",
        message: `That time overlaps an existing booking (${formatRange(clash.start, clash.end)}).`,
      }
    : null;
};

// ---------------------------------------------------------------------------
// Rules that apply only to student bookings
// ---------------------------------------------------------------------------

const withinBookingHorizon: Rule = (ctx) => {
  const horizonMs = ctx.instrument.bookingHorizonDays * 86_400_000;
  const limit = new Date(ctx.now.getTime() + horizonMs);

  return ctx.request.start <= limit
    ? null
    : {
        code: "BEYOND_HORIZON",
        message: `Bookings open ${ctx.instrument.bookingHorizonDays} days ahead — the latest you can book right now is ${formatInstant(limit)}.`,
      };
};

const respectsLeadTime: Rule = (ctx) => {
  const lead = ctx.instrument.minLeadTimeMinutes;
  if (lead <= 0) return null;

  const earliest = new Date(ctx.now.getTime() + lead * MINUTE_MS);
  return ctx.request.start >= earliest
    ? null
    : {
        code: "TOO_SOON",
        message: `Bookings must start at least ${formatDurationMinutes(lead)} from now.`,
      };
};

const withinOperatingWindow: Rule = (ctx) =>
  ctx.occurrence
    ? null
    : {
        code: "OUTSIDE_WINDOW",
        message:
          "That time is outside the instrument's bookable hours, or it spans a gap between them.",
      };

const durationWithinBounds: Rule = (ctx) => {
  const occurrence = ctx.occurrence;
  if (!occurrence) return null; // withinOperatingWindow already reported this

  const minutes = durationMinutes(ctx);
  const { minDurationMinutes, maxDurationMinutes, name } = occurrence.window;

  if (minutes < minDurationMinutes) {
    return {
      code: "TOO_SHORT",
      message: `${name} bookings must be at least ${formatDurationMinutes(minDurationMinutes)}.`,
    };
  }

  if (minutes > maxDurationMinutes) {
    return {
      code: "TOO_LONG",
      message: `${name} bookings are capped at ${formatDurationMinutes(maxDurationMinutes)}.`,
    };
  }

  return null;
};

const respectsWholeBlock: Rule = (ctx) => {
  const occurrence = ctx.occurrence;
  if (!occurrence?.window.wholeBlockOnly) return null;

  const matchesBlock =
    occurrence.start.getTime() === ctx.request.start.getTime() &&
    occurrence.end.getTime() === ctx.request.end.getTime();

  return matchesBlock
    ? null
    : {
        code: "WHOLE_BLOCK_ONLY",
        message: `${occurrence.window.name} is booked as one full block (${formatTimeOnly(occurrence.start)}–${formatTimeOnly(occurrence.end)}).`,
      };
};

const respectsSlotGrid: Rule = (ctx) => {
  const occurrence = ctx.occurrence;
  if (!occurrence || occurrence.window.wholeBlockOnly) return null;

  const valid = slotStarts(occurrence, durationMinutes(ctx)).some(
    (s) => s.getTime() === ctx.request.start.getTime(),
  );

  return valid
    ? null
    : {
        code: "OFF_GRID",
        message: `Bookings start on ${formatDurationMinutes(occurrence.window.slotSizeMinutes)} boundaries.`,
      };
};

const respectsConsecutiveSlotCap: Rule = (ctx) => {
  const occurrence = ctx.occurrence;
  const cap = occurrence?.window.maxConsecutiveSlots;
  if (!occurrence || !cap) return null;

  const slots = Math.ceil(durationMinutes(ctx) / occurrence.window.slotSizeMinutes);

  return slots <= cap
    ? null
    : {
        code: "TOO_MANY_SLOTS",
        message: `You can book at most ${cap} back-to-back ${formatDurationMinutes(occurrence.window.slotSizeMinutes)} slots at a time.`,
      };
};

/**
 * Changeover time between bookings. Enforced here rather than in the database: the
 * exclusion constraint guarantees no literal overlap, this guarantees breathing room.
 */
const respectsBuffer: Rule = (ctx) => {
  const buffer = ctx.instrument.bufferMinutes;
  if (buffer <= 0) return null;

  const bufferMs = buffer * MINUTE_MS;

  const tooClose = ctx.neighbors.find((b) => {
    if (b.id === ctx.request.excludeBookingId) return false;
    const gapBefore = ctx.request.start.getTime() - b.end.getTime();
    const gapAfter = b.start.getTime() - ctx.request.end.getTime();
    // Overlap is another rule's problem; only flag genuine gaps that are too small.
    if (gapBefore >= 0) return gapBefore < bufferMs;
    if (gapAfter >= 0) return gapAfter < bufferMs;
    return false;
  });

  return tooClose
    ? {
        code: "BUFFER",
        message: `Leave at least ${formatDurationMinutes(buffer)} between bookings for changeover.`,
      }
    : null;
};

/**
 * Attribution: which research group is this time being used for.
 *
 * Only checks presence. That the id refers to a real, active advisor is enforced
 * where the value is resolved, since that needs a database round-trip and rules are
 * kept pure.
 */
const researchAdvisorRecorded: Rule = (ctx) => {
  if (!ctx.instrument.requireResearchAdvisor) return null;

  return ctx.request.advisorId
    ? null
    : {
        code: "ADVISOR_REQUIRED",
        message: `${ctx.instrument.name} bookings have to name the research group the time is for. If you aren't in a group yet, ask the lab manager.`,
      };
};

const underWindowWeeklyCap: Rule = (ctx) => {
  const occurrence = ctx.occurrence;
  const cap = occurrence?.window.maxBookingsPerUserPerWeek;
  if (!occurrence || !cap) return null;

  const used = ctx.userBookingsThisWeek.filter(
    (b) =>
      b.windowId === occurrence.window.id &&
      b.id !== ctx.request.excludeBookingId,
  ).length;

  return used < cap
    ? null
    : {
        code: "WINDOW_QUOTA",
        message: `You already have ${used} ${occurrence.window.name} booking${used === 1 ? "" : "s"} this week (limit ${cap}).`,
      };
};

const underWeeklyMinuteCap: Rule = (ctx) => {
  const cap = ctx.instrument.maxMinutesPerUserPerWeek;
  if (!cap) return null;

  const used = ctx.userBookingsThisWeek
    .filter((b) => b.id !== ctx.request.excludeBookingId)
    .reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()) / MINUTE_MS, 0);

  return used + durationMinutes(ctx) <= cap
    ? null
    : {
        code: "WEEKLY_QUOTA",
        message: `That would put you over the ${formatDurationMinutes(cap)} weekly limit on ${ctx.instrument.name} (you have ${formatDurationMinutes(used)} booked).`,
      };
};

// ---------------------------------------------------------------------------
// Chains
// ---------------------------------------------------------------------------

/**
 * Order matters: cheap structural checks first so their clearer messages win, and
 * `withinOperatingWindow` ahead of every rule that reads `ctx.occurrence`.
 *
 * Insert `userAuthorizedForInstrument` here if training ever gets tracked.
 */
const STUDENT_RULES: readonly Rule[] = [
  instrumentIsActive,
  endsAfterStart,
  notInThePast,
  respectsLeadTime,
  withinBookingHorizon,
  withinOperatingWindow,
  // Ahead of durationWithinBounds: for a whole-block window the duration bounds are
  // the block length, so a partial overnight booking would otherwise be reported as
  // "must be at least 15 hours" instead of "this is booked as one block".
  respectsWholeBlock,
  durationWithinBounds,
  respectsSlotGrid,
  respectsConsecutiveSlotCap,
  researchAdvisorRecorded,
  underWindowWeeklyCap,
  underWeeklyMinuteCap,
  respectsBuffer,
  doesNotOverlapConfirmed,
];

/**
 * Class and maintenance bookings are not bound by operating hours, durations, or
 * quotas — that is the whole point of them. They still have to be coherent, and they
 * still have to explain themselves. Overlap is deliberately absent: resolving it by
 * preemption is the caller's job.
 */
const PRIORITY_RULES: readonly Rule[] = [
  instrumentIsActive,
  endsAfterStart,
  notInThePast,
  priorityBookingsExplainThemselves,
];

export function rulesFor(type: BookingType): readonly Rule[] {
  return type === "STUDENT" ? STUDENT_RULES : PRIORITY_RULES;
}

export type ValidationResult =
  | { ok: true; occurrence: WindowOccurrence | null }
  | { ok: false; failure: RuleFailure };

export function validateBooking(
  ctx: Omit<RuleContext, "occurrence">,
): ValidationResult {
  const occurrence =
    ctx.request.type === "STUDENT"
      ? findContainingOccurrence(ctx.windows, ctx.request.start, ctx.request.end)
      : null;

  const full: RuleContext = { ...ctx, occurrence };

  for (const rule of rulesFor(ctx.request.type)) {
    const failure = rule(full);
    if (failure) return { ok: false, failure };
  }

  return { ok: true, occurrence };
}

/**
 * Captured onto the booking at creation time. Without it, an admin narrowing a
 * window retroactively invalidates existing bookings and every later check has to
 * reason about which rules were in force back in March.
 */
export function policySnapshot(
  instrument: InstrumentPolicy,
  occurrence: WindowOccurrence | null,
) {
  return {
    capturedAt: new Date().toISOString(),
    instrument: {
      bufferMinutes: instrument.bufferMinutes,
      minLeadTimeMinutes: instrument.minLeadTimeMinutes,
      cancellationDeadlineMinutes: instrument.cancellationDeadlineMinutes,
      bookingHorizonDays: instrument.bookingHorizonDays,
      maxMinutesPerUserPerWeek: instrument.maxMinutesPerUserPerWeek,
    },
    window: occurrence && {
      id: occurrence.window.id,
      name: occurrence.window.name,
      slotSizeMinutes: occurrence.window.slotSizeMinutes,
      minDurationMinutes: occurrence.window.minDurationMinutes,
      maxDurationMinutes: occurrence.window.maxDurationMinutes,
      wholeBlockOnly: occurrence.window.wholeBlockOnly,
      spanMinutes: windowSpanMinutes(occurrence.window),
    },
  };
}

/**
 * Cancellation is separate from creation: the deadline protects the schedule from
 * last-minute churn, but staff need to be able to clear a slot regardless.
 */
export function canCancel(args: {
  booking: { userId: string; start: Date };
  instrument: Pick<InstrumentPolicy, "cancellationDeadlineMinutes">;
  actor: { id: string; role: Role };
  now: Date;
}): RuleResult {
  const { booking, instrument, actor, now } = args;

  if (actor.role === "ADMIN" || actor.role === "INSTRUCTOR") return null;

  if (booking.userId !== actor.id) {
    return { code: "NOT_OWNER", message: "That is not your booking." };
  }

  const deadline = new Date(
    booking.start.getTime() - instrument.cancellationDeadlineMinutes * MINUTE_MS,
  );

  return now <= deadline
    ? null
    : {
        code: "PAST_CANCELLATION_DEADLINE",
        message: `Bookings can't be cancelled within ${formatDurationMinutes(instrument.cancellationDeadlineMinutes)} of the start time. Contact the lab manager.`,
      };
}
