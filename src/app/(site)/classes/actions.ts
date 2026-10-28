"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { BookingError, createPriorityBooking } from "@/lib/booking/create";
import { cancelSeries, createClassSeries } from "@/lib/booking/series";
import { civilToISODate } from "@/lib/time";
import { sundayOf } from "@/lib/week";
import { resolveClassTimes, resolveSeriesPattern } from "@/app/(site)/classes/times";

export type ReserveState = {
  error: string | null;
  /** True when the server's list of affected bookings differs from the one shown. */
  stale?: boolean;
  done?: { message: string; calendarHref: string };
};

/**
 * Create the class reservation the instructor confirmed.
 *
 * `confirmedTargetIds` is the list of bookings the page showed as "will be cancelled".
 * Passing it through is what makes the confirmation mean something: if a student has
 * booked into the range since the preview loaded, the booking engine refuses rather
 * than cancelling a booking the instructor never saw.
 */
export async function createClassReservationAction(
  _prev: ReserveState,
  formData: FormData,
): Promise<ReserveState> {
  const user = await getSession();
  if (!user) return { error: "Your session expired. Sign in and try again." };
  if (user.role !== "INSTRUCTOR" && user.role !== "ADMIN") {
    return { error: "Only instructors and admins can reserve class time." };
  }

  const instrumentId = String(formData.get("instrumentId") ?? "");
  const date = String(formData.get("date") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  const reason = String(formData.get("reason") ?? "").trim();
  const confirmedRaw = String(formData.get("confirmedTargetIds") ?? "");
  const confirmedTargetIds = confirmedRaw ? confirmedRaw.split(",") : [];

  if (formData.get("repeat") === "weekly") {
    return createSeries(formData, { instrumentId, title, reason, confirmedTargetIds, user });
  }

  const times = resolveClassTimes(
    date,
    String(formData.get("from") ?? ""),
    String(formData.get("to") ?? ""),
  );
  if (!times) return { error: "Pick a date and a start and end time." };
  if (!title) return { error: "Name the class — it's the label on the calendar." };
  if (!reason) {
    return { error: "Add a reason. Students whose bookings are cancelled will see it." };
  }

  const instrument = await db.instrument.findUnique({
    where: { id: instrumentId },
    select: { slug: true },
  });
  if (!instrument) return { error: "That instrument no longer exists." };

  try {
    const { preempted } = await createPriorityBooking({
      instrumentId,
      request: {
        userId: user.id,
        start: times.start,
        end: times.end,
        type: "CLASS",
        title,
        description: reason,
      },
      actor: { id: user.id, role: user.role },
      confirmPreemption: true,
      confirmedTargetIds,
    });

    revalidatePath(`/instruments/${instrument.slug}`);
    revalidatePath("/classes");

    const n = preempted.length;
    return {
      error: null,
      done: {
        message:
          n === 0
            ? "Reserved. No student bookings were affected."
            : `Reserved. ${n} student booking${n === 1 ? " was" : "s were"} cancelled, and ${n === 1 ? "that student has" : "those students have"} been emailed.`,
        calendarHref: `/instruments/${instrument.slug}?week=${date}`,
      },
    };
  } catch (error) {
    if (error instanceof BookingError) {
      return {
        error: error.failure.message,
        stale: error.failure.code === "CONFIRMATION_REQUIRED",
      };
    }
    console.error("[class-reservation] unexpected failure:", error);
    return { error: "Something went wrong creating that reservation." };
  }
}

const bumpedMessage = (n: number) =>
  n === 0
    ? "No student bookings were affected."
    : `${n} student booking${n === 1 ? " was" : "s were"} cancelled, and ${n === 1 ? "that student has" : "those students have"} been emailed.`;

/** The weekly branch of the form: every kept date in one go. */
async function createSeries(
  formData: FormData,
  fields: {
    instrumentId: string;
    title: string;
    reason: string;
    confirmedTargetIds: string[];
    user: { id: string; role: "STUDENT" | "INSTRUCTOR" | "ADMIN" };
  },
): Promise<ReserveState> {
  const pattern = resolveSeriesPattern({
    first: String(formData.get("date") ?? ""),
    until: String(formData.get("until") ?? ""),
    days: String(formData.get("days") ?? ""),
    from: String(formData.get("from") ?? ""),
    to: String(formData.get("to") ?? ""),
  });
  const datesRaw = String(formData.get("dates") ?? "");
  const dates = datesRaw ? datesRaw.split(",") : [];

  if (!pattern) return { error: "Pick a first and last date and a start and end time." };
  if (!fields.title) return { error: "Name the class — it's the label on the calendar." };
  if (!fields.reason) {
    return { error: "Add a reason. Students whose bookings are cancelled will see it." };
  }

  const instrument = await db.instrument.findUnique({
    where: { id: fields.instrumentId },
    select: { slug: true },
  });
  if (!instrument) return { error: "That instrument no longer exists." };

  try {
    const { meetings, preempted } = await createClassSeries({
      instrumentId: fields.instrumentId,
      pattern,
      dates,
      title: fields.title,
      description: fields.reason,
      actor: fields.user,
      confirmedTargetIds: fields.confirmedTargetIds,
    });

    revalidatePath(`/instruments/${instrument.slug}`);
    revalidatePath("/classes");

    const count = meetings.length;
    return {
      error: null,
      done: {
        message: `Reserved ${count} date${count === 1 ? "" : "s"}. ${bumpedMessage(preempted.length)}`,
        calendarHref: `/instruments/${instrument.slug}?week=${civilToISODate(sundayOf(meetings[0].day))}`,
      },
    };
  } catch (error) {
    if (error instanceof BookingError) {
      const stale = ["CONFIRMATION_REQUIRED", "PRIORITY_CONFLICT", "IN_PROGRESS_CONFLICT"];
      return { error: error.failure.message, stale: stale.includes(error.failure.code) };
    }
    console.error("[class-series] unexpected failure:", error);
    return { error: "Something went wrong creating that reservation." };
  }
}

export type CancelSeriesState = { error: string | null };

/** Cancel the meetings of a series that haven't started. */
export async function cancelSeriesAction(
  _prev: CancelSeriesState,
  formData: FormData,
): Promise<CancelSeriesState> {
  const user = await getSession();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  try {
    const { instrumentSlug } = await cancelSeries({
      seriesId: String(formData.get("seriesId") ?? ""),
      actor: { id: user.id, role: user.role, name: user.name },
    });
    revalidatePath(`/instruments/${instrumentSlug}`);
    revalidatePath("/classes");
    return { error: null };
  } catch (error) {
    if (error instanceof BookingError) return { error: error.failure.message };
    throw error;
  }
}
