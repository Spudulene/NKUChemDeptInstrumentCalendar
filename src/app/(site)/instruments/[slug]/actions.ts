"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { BookingError, createStudentBooking } from "@/lib/booking/create";
import { canCancel } from "@/lib/booking/rules";

export type ActionState = { error: string | null; ok?: boolean };

/**
 * The authority on whether a booking is allowed.
 *
 * The calendar only offers slots that looked bookable when the page rendered; by the
 * time someone clicks, another student may have taken the time. Everything is
 * re-validated here, and the database exclusion constraint sits behind that as the
 * final word.
 */
export async function createBookingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSession();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const slug = String(formData.get("slug") ?? "");
  const startISO = String(formData.get("start") ?? "");
  const durationMinutes = Number(formData.get("duration"));
  const advisorRaw = String(formData.get("advisorId") ?? "");
  const description = String(formData.get("description") ?? "").trim();

  const start = new Date(startISO);
  if (Number.isNaN(start.getTime()) || !Number.isFinite(durationMinutes)) {
    return { error: "That booking request wasn't valid. Try picking the time again." };
  }

  const instrument = await db.instrument.findUnique({
    where: { slug },
    select: { id: true },
  });
  if (!instrument) return { error: "That instrument no longer exists." };

  try {
    await createStudentBooking({
      instrumentId: instrument.id,
      request: {
        userId: user.id,
        start,
        end: new Date(start.getTime() + durationMinutes * 60_000),
        type: "STUDENT",
        description: description || null,
        // "" means the picker was left on the default; undefined defers to the
        // student's own research group rather than clearing it.
        advisorId: advisorRaw === "" ? undefined : advisorRaw,
      },
      actor: { id: user.id, role: user.role },
    });
  } catch (error) {
    if (error instanceof BookingError) {
      const suggestions = error.openings
        .slice(0, 2)
        .map((o) => o.start.toLocaleString("en-US", { timeZone: "America/New_York" }));

      return {
        error:
          suggestions.length > 0
            ? `${error.failure.message} Next open: ${suggestions.join(", ")}.`
            : error.failure.message,
      };
    }
    console.error("[booking] unexpected failure:", error);
    return { error: "Something went wrong creating that booking." };
  }

  revalidatePath(`/instruments/${slug}`);
  return { error: null, ok: true };
}

export async function cancelBookingAction(
  _prev: ActionState,
  formData: FormData,
): Promise<ActionState> {
  const user = await getSession();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const bookingId = String(formData.get("bookingId") ?? "");

  const booking = await db.booking.findUnique({
    where: { id: bookingId },
    include: {
      instrument: { select: { slug: true, cancellationDeadlineMinutes: true } },
    },
  });

  if (!booking || booking.status !== "CONFIRMED") {
    return { error: "That booking is no longer active." };
  }

  const failure = canCancel({
    booking: { userId: booking.userId, start: booking.startsAt },
    instrument: booking.instrument,
    actor: { id: user.id, role: user.role },
    now: new Date(),
  });

  if (failure) return { error: failure.message };

  await db.booking.update({
    where: { id: bookingId },
    data: {
      status: "CANCELLED",
      cancelledAt: new Date(),
      cancellationReason:
        booking.userId === user.id ? "Cancelled by owner" : `Cancelled by ${user.name}`,
    },
  });

  revalidatePath(`/instruments/${booking.instrument.slug}`);
  return { error: null, ok: true };
}
