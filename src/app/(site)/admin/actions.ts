"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { getSession } from "@/lib/auth";
import {
  SettingsError,
  instrumentSettingsSchema,
  saveInstrumentSettings,
  setInstrumentActive,
} from "@/lib/admin/instrument-settings";

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

/** Archive (true → false) or restore an instrument. */
export async function setInstrumentActiveAction(formData: FormData) {
  const user = await getSession();
  if (user?.role !== "ADMIN") return;

  const id = String(formData.get("instrumentId") ?? "");
  await setInstrumentActive(id, formData.get("active") === "true");
  revalidatePath("/", "layout");
}
