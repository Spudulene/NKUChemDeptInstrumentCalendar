import { createHash, randomBytes } from "node:crypto";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { notifySwapHolder, notifySwapOutcomes } from "@/lib/email";
import {
  BookingError,
  isOverlapViolation,
  loadContext,
  resolveAdvisorId,
} from "@/lib/booking/create";
import { validateTransfer, type RuleFailure } from "@/lib/booking/rules";

/**
 * "Ask for this time": one student asks another to give up a booking.
 *
 * The holder answers from My bookings or from the link in their email, which opens a
 * confirm page rather than acting on its own (mail scanners follow links). Accepting
 * cancels the holder's booking and creates the same time for the requester, in that
 * order, in one transaction: `Booking_no_overlap` would reject the insert otherwise.
 *
 * Every way a request ends stamps its status at once and mails the requester straight
 * after; `sweepSwapRequests` catches what nothing triggered (the booking starting with
 * no answer, or being bumped by a class) and retries emails that failed.
 */

const hashToken = (token: string) => createHash("sha256").update(token).digest("hex");

function newToken() {
  const token = randomBytes(32).toString("base64url");
  return { token, tokenHash: hashToken(token) };
}

const QUOTA_CODES = ["WINDOW_QUOTA", "WEEKLY_QUOTA"];

/** Whether `requesterId` could hold this booking as it stands, now. */
async function transferFailure(args: {
  booking: { instrumentId: string; startsAt: Date; endsAt: Date };
  requesterId: string;
  advisorId: string | null;
  now: Date;
}): Promise<RuleFailure | null> {
  const request = {
    userId: args.requesterId,
    start: args.booking.startsAt,
    end: args.booking.endsAt,
    type: "STUDENT" as const,
    advisorId: args.advisorId,
  };
  const { instrument, neighbors, userBookingsThisWeek } = await loadContext(args.booking.instrumentId, request);
  const result = validateTransfer({
    instrument,
    windows: instrument.windows,
    request,
    actor: { id: args.requesterId, role: "STUDENT" },
    now: args.now,
    neighbors,
    userBookingsThisWeek,
  });
  return result.ok ? null : result.failure;
}

/** Ask the holder of `bookingId` to give it up. Mails them straight away. */
export async function requestSwap(args: {
  bookingId: string;
  requester: { id: string; role: Role };
  /** Undefined means "my default group", as when booking. */
  advisorId?: string | null;
  note?: string | null;
  now?: Date;
}) {
  const { requester, now = new Date() } = args;
  if (requester.role !== "STUDENT") {
    throw new BookingError({ code: "FORBIDDEN", message: "Only students can ask for someone's time." });
  }

  const booking = await db.booking.findUnique({
    where: { id: args.bookingId },
    select: { id: true, instrumentId: true, userId: true, type: true, status: true, startsAt: true, endsAt: true },
  });
  if (!booking || booking.status !== "CONFIRMED" || booking.type !== "STUDENT") {
    throw new BookingError({ code: "NOT_FOUND", message: "That booking isn't on the calendar any more." });
  }
  if (booking.userId === requester.id) {
    throw new BookingError({ code: "OWN_BOOKING", message: "That's already your booking." });
  }

  const advisorId = await resolveAdvisorId({
    userId: requester.id,
    start: booking.startsAt,
    end: booking.endsAt,
    type: "STUDENT",
    advisorId: args.advisorId,
  });
  const failure = await transferFailure({ booking, requesterId: requester.id, advisorId, now });
  if (failure) throw new BookingError(failure);

  const alreadyAsked = { code: "ALREADY_ASKED", message: "You've already asked for this time." };
  // For the message only; the partial unique index below is what guarantees it.
  const open = await db.swapRequest.count({
    where: { bookingId: booking.id, requesterId: requester.id, status: "PENDING" },
  });
  if (open > 0) throw new BookingError(alreadyAsked);

  const { token, tokenHash } = newToken();
  let created: { id: string };
  try {
    created = await db.swapRequest.create({
      data: {
        bookingId: booking.id,
        requesterId: requester.id,
        advisorId,
        note: args.note?.trim() || null,
        tokenHash,
      },
      select: { id: true },
    });
  } catch (error) {
    // The partial unique index: one open request per requester per booking.
    if ((error as { code?: string }).code === "P2002") throw new BookingError(alreadyAsked);
    throw error;
  }

  // After the insert, never instead of it: a failed send leaves holderNotifiedAt unset
  // and the sweeper retries with a fresh token.
  await notifySwapHolder(created.id, token).catch((error) =>
    console.error("[swap] holder notification failed:", error),
  );
  return created;
}

/** For the email link's page: the request behind a token, or null. */
export function findRequestByToken(token: string) {
  return db.swapRequest.findUnique({
    where: { tokenHash: hashToken(token) },
    include: {
      requester: { select: { name: true } },
      booking: { include: { instrument: { select: { name: true, color: true, location: true } } } },
    },
  });
}

type Responder = { requestId: string; holderId: string } | { token: string };

/** The request a holder is answering, by id from My bookings or by email token. */
async function findForResponder(who: Responder) {
  const request = await db.swapRequest.findUnique({
    where: "token" in who ? { tokenHash: hashToken(who.token) } : { id: who.requestId },
    include: {
      requester: { select: { name: true } },
      booking: { include: { instrument: { select: { slug: true } } } },
    },
  });
  if (!request || ("holderId" in who && request.booking.userId !== who.holderId)) {
    throw new BookingError({ code: "NOT_FOUND", message: "That request doesn't exist." });
  }
  return request;
}

const closedMessage = {
  ACCEPTED: "You already gave this time up.",
  DECLINED: "You already kept this time.",
  WITHDRAWN: "They took the request back, so there's nothing to answer.",
  EXPIRED: "This request has ended — the booking started, or isn't on the calendar any more.",
} as const;

/** Give the booking to the requester. Returns the instrument slug, for revalidation. */
export async function acceptSwap(who: Responder, now = new Date()): Promise<{ slug: string }> {
  const request = await findForResponder(who);
  const { booking } = request;
  if (request.status !== "PENDING") {
    throw new BookingError({ code: "CLOSED", message: closedMessage[request.status] });
  }
  if (booking.status !== "CONFIRMED" || booking.startsAt <= now) {
    await expireRequests([request.id]);
    throw new BookingError({ code: "CLOSED", message: closedMessage.EXPIRED });
  }

  const failure = await transferFailure({
    booking,
    requesterId: request.requesterId,
    advisorId: request.advisorId,
    now,
  });
  if (failure) {
    throw new BookingError({
      code: failure.code,
      message: QUOTA_CODES.includes(failure.code)
        ? `${request.requester.name} can't take this time now — it would put them over their weekly limit. Keep it, or decline the request.`
        : `${request.requester.name} can't take this time now: ${failure.message}`,
    });
  }

  let others: string[] = [];
  try {
    others = await db.$transaction(async (tx) => {
      // Order matters: the holder's booking leaves CONFIRMED before the insert, or
      // `Booking_no_overlap` rejects it. The guard on status makes a double click or
      // two accepted requests a no-op instead of two bookings.
      const cancelled = await tx.booking.updateMany({
        where: { id: booking.id, status: "CONFIRMED" },
        data: { status: "CANCELLED", cancelledAt: now, cancellationReason: `Given to ${request.requester.name}` },
      });
      if (cancelled.count === 0) throw new BookingError({ code: "CLOSED", message: closedMessage.EXPIRED });

      const created = await tx.booking.create({
        data: {
          instrumentId: booking.instrumentId,
          userId: request.requesterId,
          createdById: request.requesterId,
          type: "STUDENT",
          status: "CONFIRMED",
          startsAt: booking.startsAt,
          endsAt: booking.endsAt,
          advisorId: request.advisorId,
          // Same time, same rules: it keeps the snapshot it was booked under.
          windowId: booking.windowId,
          policySnapshot: booking.policySnapshot ?? undefined,
        },
        select: { id: true },
      });

      await tx.swapRequest.update({
        where: { id: request.id },
        data: { status: "ACCEPTED", respondedAt: now, resultBookingId: created.id },
      });

      // Anyone else asking for the same time hears it's gone.
      const rest = await tx.swapRequest.findMany({
        where: { bookingId: booking.id, status: "PENDING" },
        select: { id: true },
      });
      await tx.swapRequest.updateMany({
        where: { id: { in: rest.map((r) => r.id) } },
        data: { status: "EXPIRED", respondedAt: now },
      });
      return rest.map((r) => r.id);
    });
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new BookingError({ code: "CONFLICT", message: "That time changed while you were answering. Reload and try again." });
    }
    throw error;
  }

  await notifySwapOutcomes([request.id, ...others]).catch((error) =>
    console.error("[swap] outcome notification failed:", error),
  );
  return { slug: booking.instrument.slug };
}

/** Keep the booking. The requester is told, without a reason. */
export async function declineSwap(who: Responder, now = new Date()): Promise<void> {
  const request = await findForResponder(who);
  if (request.status !== "PENDING") {
    throw new BookingError({ code: "CLOSED", message: closedMessage[request.status] });
  }
  await db.swapRequest.updateMany({
    where: { id: request.id, status: "PENDING" },
    data: { status: "DECLINED", respondedAt: now },
  });
  await notifySwapOutcomes([request.id]).catch((error) =>
    console.error("[swap] outcome notification failed:", error),
  );
}

/** The requester takes their request back. No email: they know, and the holder's link says so. */
export async function withdrawSwap(args: { requestId: string; requesterId: string; now?: Date }) {
  await db.swapRequest.updateMany({
    where: { id: args.requestId, requesterId: args.requesterId, status: "PENDING" },
    data: { status: "WITHDRAWN", respondedAt: args.now ?? new Date(), requesterNotifiedAt: new Date() },
  });
}

async function expireRequests(ids: string[], now = new Date()) {
  if (ids.length === 0) return;
  await db.swapRequest.updateMany({
    where: { id: { in: ids }, status: "PENDING" },
    data: { status: "EXPIRED", respondedAt: now },
  });
}

/**
 * Close open requests for bookings that just went away (the holder cancelled), so the
 * requester hears now, while the time may still be free to book.
 */
export async function closeSwapRequestsFor(bookingIds: string[]) {
  const open = await db.swapRequest.findMany({
    where: { bookingId: { in: bookingIds }, status: "PENDING" },
    select: { id: true },
  });
  const ids = open.map((r) => r.id);
  await expireRequests(ids);
  await notifySwapOutcomes(ids).catch((error) =>
    console.error("[swap] outcome notification failed:", error),
  );
}

/**
 * The scheduled safety net: expire requests whose booking started or went away with
 * nobody answering, resend "someone is asking" emails that failed (with a new token,
 * since only the hash of the old one was kept), and resend outcomes that failed.
 */
export async function sweepSwapRequests(now = new Date()) {
  const stale = await db.swapRequest.findMany({
    where: {
      status: "PENDING",
      booking: { OR: [{ status: { not: "CONFIRMED" } }, { startsAt: { lte: now } }] },
    },
    select: { id: true },
  });
  await expireRequests(stale.map((r) => r.id), now);

  const unsent = await db.swapRequest.findMany({
    where: { status: "PENDING", holderNotifiedAt: null },
    select: { id: true },
    take: 50,
  });
  for (const { id } of unsent) {
    const { token, tokenHash } = newToken();
    await db.swapRequest.update({ where: { id }, data: { tokenHash } });
    await notifySwapHolder(id, token).catch((error) => console.error("[swap] holder retry failed:", error));
  }

  const outcomes = await notifySwapOutcomes();
  return { expired: stale.length, asksRetried: unsent.length, ...outcomes };
}
