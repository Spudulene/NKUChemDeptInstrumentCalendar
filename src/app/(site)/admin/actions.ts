"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { BookingError, createPriorityBooking } from "@/lib/booking/create";
import { resolveMaintenanceTimes } from "@/lib/admin/maintenance";
import { civilToISODate } from "@/lib/time";
import { sundayOf } from "@/lib/week";
import {
  SettingsError,
  instrumentSettingsSchema,
  saveInstrumentSettings,
  setInstrumentActive,
} from "@/lib/admin/instrument-settings";
import {
  PeopleError,
  addPerson,
  addPersonSchema,
  removePerson,
  type PeopleKind,
} from "@/lib/admin/people";

export type SettingsState = { error: string | null; savedAt?: number };

/**
 * Save the whole settings screen. The form sends its state as one JSON field: a
 * variable number of windows, each with a dozen fields, doesn't map onto flat
 * FormData without a naming scheme nobody wants to maintain.
 */
export async function saveInstrumentAction(
  _prev: SettingsState,
  formData: FormData,
): Promise<SettingsState> {
  const user = await getSession();
  if (user?.role !== "ADMIN") return { error: "Only admins can change instrument settings." };

  const instrumentId = String(formData.get("instrumentId") ?? "") || null;
  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("settings") ?? ""));
  } catch {
    return { error: "Couldn't read the form. Reload the page and try again." };
  }

  const parsed = instrumentSettingsSchema.safeParse(raw);
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Some settings aren't valid." };
  }

  let saved: { id: string; slug: string };
  try {
    saved = await saveInstrumentSettings({ instrumentId, settings: parsed.data });
  } catch (error) {
    if (error instanceof SettingsError) return { error: error.message };
    console.error("[admin] saving instrument failed:", error);
    return { error: "Something went wrong saving these settings." };
  }

  // Everything that shows an instrument's name, colour or hours.
  revalidatePath("/", "layout");

  if (!instrumentId) redirect(`/admin/instruments/${saved.slug}`);
  return { error: null, savedAt: Date.now() };
}

export type PeopleState = {
  error: string | null;
  /** Who was just added. */
  added?: string;
  /** What was typed, handed back with an error so the form keeps it. */
  values?: { name: string; email: string };
};

const isPeopleKind = (value: unknown): value is PeopleKind =>
  value === "instructors" || value === "advisors";

/** Add an instructor or research advisor by name and email. */
export async function addPersonAction(_prev: PeopleState, formData: FormData): Promise<PeopleState> {
  const values = { name: String(formData.get("name") ?? ""), email: String(formData.get("email") ?? "") };
  const user = await getSession();
  if (user?.role !== "ADMIN") return { error: "Only admins can change department lists.", values };

  const kind = formData.get("kind");
  if (!isPeopleKind(kind)) return { error: "Couldn't read the form. Reload the page and try again.", values };

  const parsed = addPersonSchema.safeParse(values);
  if (!parsed.success) return { error: parsed.error.issues[0]?.message ?? "Check the name and email.", values };

  let added: string;
  try {
    added = await addPerson(kind, parsed.data);
  } catch (error) {
    if (error instanceof PeopleError) return { error: error.message, values };
    console.error("[admin] adding person failed:", error);
    return { error: "Something went wrong adding them.", values };
  }

  // Roles change the header's links; advisors appear in every research-group picker.
  revalidatePath("/", "layout");
  return { error: null, added };
}

export async function removePersonAction(formData: FormData) {
  const user = await getSession();
  if (user?.role !== "ADMIN") return;

  const kind = formData.get("kind");
  if (!isPeopleKind(kind)) return;
  await removePerson(kind, String(formData.get("userId") ?? ""));
  revalidatePath("/", "layout");
}

export type MaintenanceState = {
  error: string | null;
  /** True when the server's list of affected bookings differs from the one shown. */
  stale?: boolean;
  done?: { message: string; calendarHref: string };
};

/**
 * Schedule the maintenance block the admin confirmed. `confirmedTargetIds` works as
 * on class reservations: a booking made since the preview loaded sends the admin
 * back to review rather than being cancelled unseen.
 */
export async function createMaintenanceAction(
  _prev: MaintenanceState,
  formData: FormData,
): Promise<MaintenanceState> {
  const user = await getSession();
  if (user?.role !== "ADMIN") return { error: "Only admins can schedule maintenance." };

  const instrumentId = String(formData.get("instrumentId") ?? "");
  const startDate = String(formData.get("startDate") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  const confirmedRaw = String(formData.get("confirmedTargetIds") ?? "");

  const times = resolveMaintenanceTimes({
    startDate,
    startTime: String(formData.get("startTime") ?? ""),
    endDate: String(formData.get("endDate") ?? ""),
    endTime: String(formData.get("endTime") ?? ""),
  });
  if (!times) return { error: "Pick when it starts and ends." };
  if (!reason) return { error: "Add a reason. Anyone whose booking is cancelled will see it." };

  const instrument = await db.instrument.findUnique({ where: { id: instrumentId }, select: { slug: true } });
  if (!instrument) return { error: "That instrument no longer exists." };

  try {
    const { preempted } = await createPriorityBooking({
      instrumentId,
      request: { userId: user.id, start: times.start, end: times.end, type: "MAINTENANCE", description: reason },
      actor: { id: user.id, role: user.role },
      confirmPreemption: true,
      confirmedTargetIds: confirmedRaw ? confirmedRaw.split(",") : [],
    });

    revalidatePath(`/instruments/${instrument.slug}`);
    revalidatePath("/admin/maintenance");

    const n = preempted.length;
    return {
      error: null,
      done: {
        message:
          n === 0
            ? "Scheduled. No bookings were affected."
            : `Scheduled. ${n} booking${n === 1 ? " was" : "s were"} cancelled, and ${n === 1 ? "its owner has" : "their owners have"} been emailed.`,
        calendarHref: `/instruments/${instrument.slug}?week=${civilToISODate(sundayOf(times.day))}`,
      },
    };
  } catch (error) {
    if (error instanceof BookingError) {
      const stale = ["CONFIRMATION_REQUIRED", "PRIORITY_CONFLICT", "IN_PROGRESS_CONFLICT"];
      return { error: error.failure.message, stale: stale.includes(error.failure.code) };
    }
    console.error("[maintenance] unexpected failure:", error);
    return { error: "Something went wrong scheduling that maintenance." };
  }
}

/** Archive (true → false) or restore an instrument. */
export async function setInstrumentActiveAction(formData: FormData) {
  const user = await getSession();
  if (user?.role !== "ADMIN") return;

  const id = String(formData.get("instrumentId") ?? "");
  await setInstrumentActive(id, formData.get("active") === "true");
  revalidatePath("/", "layout");
}
