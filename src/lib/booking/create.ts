import type { BookingType, Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { deliverPreemptionNotices } from "@/lib/email";
import { campusWeekRange } from "@/lib/time";
import { findOpenings, type Opening } from "@/lib/booking/availability";
import {
  policySnapshot,
  validateBooking,
  type BookingRequest,
  type ExistingBooking,
  type RuleFailure,
} from "@/lib/booking/rules";

const MINUTE_MS = 60_000;

/**
 * Only a strictly higher tier may displace a lower one. Two instructors colliding is
 * a plain conflict they need to sort out between themselves, not a race to click.
 */
const TIER: Record<BookingType, number> = {
  STUDENT: 0,
  CLASS: 1,
  MAINTENANCE: 2,
};

export type PreemptionTarget = {
  id: string;
  userId: string;
  userName: string;
  userEmail: string;
  type: BookingType;
  start: Date;
  end: Date;
  /** True when the booking is already running — these cannot be preempted. */
  inProgress: boolean;
  /** True when it starts soon enough that an email is not fair warning. */
  startsSoon: boolean;
};

export type PreemptionPreview = {
  targets: PreemptionTarget[];
  /** Bookings at or above the new booking's tier — hard blockers, not preemptable. */
  blockedBy: PreemptionTarget[];
  inProgress: PreemptionTarget[];
  warnings: string[];
};

/** Bookings starting within this window get a louder warning in the confirm dialog. */
const SHORT_NOTICE_MINUTES = 12 * 60;

export class BookingError extends Error {
  constructor(
    readonly failure: RuleFailure,
    readonly openings: Opening[] = [],
  ) {
    super(failure.message);
    this.name = "BookingError";
  }
}

/**
 * Postgres raises 23P01 (exclusion_violation) when `Booking_no_overlap` rejects an
 * insert. Prisma has no dedicated error code for exclusion constraints, so the pg
 * code is matched directly — it is the only reliable signal available.
 */
function isOverlapViolation(error: unknown): boolean {
  if (!(error instanceof Error)) return false;

  const messages = [error.message];

  const adapterError = (error as { meta?: { driverAdapterError?: unknown } }).meta
    ?.driverAdapterError;
  if (adapterError instanceof Error) messages.push(adapterError.message);

  const cause = (adapterError as { cause?: { code?: unknown } } | undefined)?.cause;
  if (cause?.code) messages.push(String(cause.code));

  return messages.some(
    (m) => m.includes("23P01") || m.includes("Booking_no_overlap"),
  );
}

async function loadContext(
  instrumentId: string,
  request: BookingRequest,
  bufferMinutes = 0,
) {
  const instrument = await db.instrument.findUnique({
    where: { id: instrumentId },
    include: {
      windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
    },
  });

  if (!instrument) {
    throw new BookingError({
      code: "NOT_FOUND",
      message: "That instrument no longer exists.",
    });
  }

  const pad = Math.max(bufferMinutes, instrument.bufferMinutes) * MINUTE_MS;
  const week = campusWeekRange(request.start);

  const [neighbors, weekBookings] = await Promise.all([
    db.booking.findMany({
      where: {
        instrumentId,
        status: "CONFIRMED",
        startsAt: { lt: new Date(request.end.getTime() + pad) },
        endsAt: { gt: new Date(request.start.getTime() - pad) },
      },
      select: {
        id: true,
        userId: true,
        windowId: true,
        startsAt: true,
        endsAt: true,
      },
    }),
    db.booking.findMany({
      where: {
        instrumentId,
        userId: request.userId,
        status: "CONFIRMED",
        startsAt: { gte: week.start, lt: week.end },
      },
      select: {
        id: true,
        userId: true,
        windowId: true,
        startsAt: true,
        endsAt: true,
      },
    }),
  ]);

  const toExisting = (b: (typeof neighbors)[number]): ExistingBooking => ({
    id: b.id,
    userId: b.userId,
    windowId: b.windowId,
    start: b.startsAt,
    end: b.endsAt,
  });

  return {
    instrument,
    neighbors: neighbors.map(toExisting),
    userBookingsThisWeek: weekBookings.map(toExisting),
  };
}

/**
 * Settle which research group a booking is attributed to.
 *
 * Omitting `advisorId` means "use my group" — the common case, and the reason the
 * picker can be a pre-filled default rather than a question every time. Passing an
 * explicit id overrides it, for a student running samples for another group. Passing
 * null clears it.
 */
async function resolveAdvisorId(request: BookingRequest): Promise<string | null> {
  if (request.advisorId === undefined) {
    const user = await db.user.findUnique({
      where: { id: request.userId },
      select: { advisorId: true },
    });
    return user?.advisorId ?? null;
  }

  if (request.advisorId === null) return null;

  const advisor = await db.user.findUnique({
    where: { id: request.advisorId },
    select: { id: true, isResearchAdvisor: true },
  });

  if (!advisor?.isResearchAdvisor) {
    throw new BookingError({
      code: "UNKNOWN_ADVISOR",
      message: "That research advisor isn't on the department's list.",
    });
  }

  return advisor.id;
}

/**
 * Create an ordinary student booking. Priority bookings go through
 * `createPriorityBooking`, which additionally resolves conflicts by preemption.
 */
export async function createStudentBooking(args: {
  instrumentId: string;
  request: BookingRequest;
  actor: { id: string; role: Role };
  now?: Date;
}) {
  const { instrumentId, request, actor, now = new Date() } = args;
  const [{ instrument, neighbors, userBookingsThisWeek }, advisorId] =
    await Promise.all([
      loadContext(instrumentId, request),
      resolveAdvisorId(request),
    ]);

  const resolved = { ...request, type: "STUDENT" as const, advisorId };

  const result = validateBooking({
    instrument,
    windows: instrument.windows,
    request: resolved,
    actor,
    now,
    neighbors,
    userBookingsThisWeek,
  });

  if (!result.ok) {
    // A rejection is the moment the student most needs an alternative, so the error
    // carries suggestions rather than making them hunt.
    const openings = await findOpenings({
      instrumentId,
      durationMinutes:
        (request.end.getTime() - request.start.getTime()) / MINUTE_MS,
      from: request.start,
      limit: 3,
    }).catch(() => []);

    throw new BookingError(result.failure, openings);
  }

  try {
    return await db.booking.create({
      data: {
        instrumentId,
        userId: request.userId,
        createdById: actor.id,
        type: "STUDENT",
        status: "CONFIRMED",
        startsAt: request.start,
        endsAt: request.end,
        description: request.description ?? null,
        advisorId,
        windowId: result.occurrence?.window.id ?? null,
        policySnapshot: policySnapshot(instrument, result.occurrence),
      },
    });
  } catch (error) {
    if (isOverlapViolation(error)) {
      // Lost the race between validation and insert. This is exactly the case the
      // exclusion constraint exists to catch.
      throw new BookingError({
        code: "CONFLICT",
        message: "Someone just booked that time. Please pick another slot.",
      });
    }
    throw error;
  }
}

/**
 * What would happen if this priority booking were created — who gets bumped, what
 * blocks it, and what deserves a warning.
 *
 * Preemption is never silent: the instructor sees this and confirms before anything
 * is cancelled.
 */
export async function previewPreemption(args: {
  instrumentId: string;
  start: Date;
  end: Date;
  type: BookingType;
  now?: Date;
  excludeBookingId?: string;
}): Promise<PreemptionPreview> {
  const { instrumentId, start, end, type, now = new Date() } = args;

  const conflicts = await db.booking.findMany({
    where: {
      instrumentId,
      status: "CONFIRMED",
      startsAt: { lt: end },
      endsAt: { gt: start },
      ...(args.excludeBookingId ? { id: { not: args.excludeBookingId } } : {}),
    },
    include: { user: { select: { name: true, email: true } } },
    orderBy: { startsAt: "asc" },
  });

  const shortNoticeCutoff = new Date(now.getTime() + SHORT_NOTICE_MINUTES * MINUTE_MS);

  const mapped: PreemptionTarget[] = conflicts.map((b) => ({
    id: b.id,
    userId: b.userId,
    userName: b.user.name,
    userEmail: b.user.email,
    type: b.type,
    start: b.startsAt,
    end: b.endsAt,
    inProgress: b.startsAt <= now && b.endsAt > now,
    startsSoon: b.startsAt > now && b.startsAt <= shortNoticeCutoff,
  }));

  const blockedBy = mapped.filter((t) => TIER[t.type] >= TIER[type]);
  const preemptable = mapped.filter((t) => TIER[t.type] < TIER[type]);
  const inProgress = preemptable.filter((t) => t.inProgress);
  const targets = preemptable.filter((t) => !t.inProgress);

  const warnings: string[] = [];

  const soon = targets.filter((t) => t.startsSoon);
  if (soon.length > 0) {
    warnings.push(
      `${soon.length} booking${soon.length === 1 ? " starts" : "s start"} within ${SHORT_NOTICE_MINUTES / 60} hours. An email may not reach them in time — consider contacting them directly.`,
    );
  }

  if (inProgress.length > 0) {
    warnings.push(
      `${inProgress.length} booking${inProgress.length === 1 ? " is" : "s are"} running right now. There may be samples in the instrument, so these cannot be cancelled automatically.`,
    );
  }

  return { targets, blockedBy, inProgress, warnings };
}

export type PriorityBookingResult = {
  booking: { id: string };
  preempted: PreemptionTarget[];
};

/**
 * Create a CLASS or MAINTENANCE booking, displacing lower-tier bookings.
 *
 * The cancel and the insert share one transaction. Flipping a booking to PREEMPTED
 * drops it out of the `Booking_no_overlap` partial index, so the slot is free for the
 * insert with no intermediate state where both exist — and if a third party inserts a
 * conflicting booking mid-flight, the constraint blocks them until this commits and
 * then rejects them.
 *
 * Emails are sent after commit, never inside the transaction: a Resend outage must
 * not roll back a booking.
 */
export async function createPriorityBooking(args: {
  instrumentId: string;
  request: BookingRequest & { type: "CLASS" | "MAINTENANCE" };
  actor: { id: string; role: Role };
  /** Must be true when the preview reports targets. Forces an explicit decision. */
  confirmPreemption?: boolean;
  /**
   * Mail the displaced students as soon as the transaction commits. Off only for
   * tests and backfills, where the scheduled sweeper can pick them up instead.
   */
  notify?: boolean;
  now?: Date;
}): Promise<PriorityBookingResult> {
  const { instrumentId, request, actor, now = new Date() } = args;

  if (actor.role !== "ADMIN" && actor.role !== "INSTRUCTOR") {
    throw new BookingError({
      code: "FORBIDDEN",
      message: "Only instructors and admins can create class or maintenance bookings.",
    });
  }

  if (request.type === "MAINTENANCE" && actor.role !== "ADMIN") {
    throw new BookingError({
      code: "FORBIDDEN",
      message: "Only admins can schedule maintenance.",
    });
  }

  const { instrument, neighbors, userBookingsThisWeek } = await loadContext(
    instrumentId,
    request,
  );

  const validation = validateBooking({
    instrument,
    windows: instrument.windows,
    request,
    actor,
    now,
    neighbors,
    userBookingsThisWeek,
  });

  if (!validation.ok) throw new BookingError(validation.failure);

  const preview = await previewPreemption({
    instrumentId,
    start: request.start,
    end: request.end,
    type: request.type,
    now,
    excludeBookingId: request.excludeBookingId,
  });

  if (preview.blockedBy.length > 0) {
    throw new BookingError({
      code: "PRIORITY_CONFLICT",
      message:
        "That time conflicts with another class or maintenance booking. Those aren't displaced automatically — sort it out with whoever owns it.",
    });
  }

  if (preview.inProgress.length > 0) {
    throw new BookingError({
      code: "IN_PROGRESS_CONFLICT",
      message:
        "A booking is currently running on this instrument. There may be samples loaded, so it needs a conversation rather than an email.",
    });
  }

  if (preview.targets.length > 0 && !args.confirmPreemption) {
    throw new BookingError({
      code: "CONFIRMATION_REQUIRED",
      message: `This will cancel ${preview.targets.length} student booking${preview.targets.length === 1 ? "" : "s"}. Confirm to continue.`,
    });
  }

  const targetIds = preview.targets.map((t) => t.id);

  const booking = await db.$transaction(async (tx) => {
    // Order matters: the conflicting bookings have to leave CONFIRMED *before* the
    // insert, or `Booking_no_overlap` rejects it. They are still CONFIRMED at this
    // point, so the slot is not yet free.
    if (targetIds.length > 0) {
      await tx.booking.updateMany({
        where: { id: { in: targetIds }, status: "CONFIRMED" },
        data: {
          status: "PREEMPTED",
          preemptedAt: now,
          cancellationReason: request.description,
        },
      });
    }

    const created = await tx.booking.create({
      data: {
        instrumentId,
        userId: request.userId,
        createdById: actor.id,
        type: request.type,
        status: "CONFIRMED",
        startsAt: request.start,
        endsAt: request.end,
        description: request.description!,
        policySnapshot: policySnapshot(instrument, null),
      },
      select: { id: true },
    });

    // The back-reference needs the new id, so it is a second pass. Same transaction,
    // so nothing ever observes a preempted booking without its cause.
    if (targetIds.length > 0) {
      await tx.booking.updateMany({
        where: { id: { in: targetIds } },
        data: { preemptedByBookingId: created.id },
      });
    }

    return created;
  });

  // After commit, never inside the transaction: an email provider having a bad minute
  // must not roll back a booking that already succeeded. Failures here are swallowed
  // on purpose — the row stays unnotified and the scheduled sweeper retries it.
  if (targetIds.length > 0 && (args.notify ?? true)) {
    try {
      await deliverPreemptionNotices(targetIds);
    } catch (error) {
      console.error("[preemption] immediate notification failed:", error);
    }
  }

  return { booking, preempted: preview.targets };
}

