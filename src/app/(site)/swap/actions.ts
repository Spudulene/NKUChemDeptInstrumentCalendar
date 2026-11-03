"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { BookingError } from "@/lib/booking/create";
import { acceptSwap, declineSwap, requestSwap, withdrawSwap } from "@/lib/booking/swap";

export type SwapState = { error: string | null; done?: "asked" | "given" | "kept" };

const fail = (error: unknown, fallback: string): SwapState => {
  if (error instanceof BookingError) return { error: error.failure.message };
  console.error("[swap]", error);
  return { error: fallback };
};

/** "Ask for this time", from the instrument page. */
export async function requestSwapAction(_prev: SwapState, formData: FormData): Promise<SwapState> {
  const user = await getSession();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const raw = formData.get("advisorId");
  try {
    await requestSwap({
      bookingId: String(formData.get("bookingId") ?? ""),
      requester: { id: user.id, role: user.role },
      // Absent: no picker was shown, so use the student's default group.
      advisorId: raw === null ? undefined : String(raw) || null,
      note: String(formData.get("note") ?? "").slice(0, 200),
    });
  } catch (error) {
    return fail(error, "Something went wrong sending that request.");
  }
  revalidatePath("/instruments/[slug]", "page");
  revalidatePath("/my-bookings");
  return { error: null, done: "asked" };
}

/**
 * The holder's answer. Signed in (My bookings) it goes by request id and must be their
 * booking; from the email link it goes by the token alone, which is the credential.
 */
export async function answerSwapAction(_prev: SwapState, formData: FormData): Promise<SwapState> {
  const give = formData.get("answer") === "give";
  const token = String(formData.get("token") ?? "");

  let who: Parameters<typeof acceptSwap>[0];
  if (token) {
    who = { token };
  } else {
    const user = await getSession();
    if (!user) return { error: "Your session expired. Sign in and try again." };
    who = { requestId: String(formData.get("requestId") ?? ""), holderId: user.id };
  }

  try {
    if (give) await acceptSwap(who);
    else await declineSwap(who);
  } catch (error) {
    return fail(error, "Something went wrong answering that request.");
  }
  revalidatePath("/", "layout");
  return { error: null, done: give ? "given" : "kept" };
}

export async function withdrawSwapAction(formData: FormData) {
  const user = await getSession();
  if (!user) return;
  await withdrawSwap({ requestId: String(formData.get("requestId") ?? ""), requesterId: user.id });
  revalidatePath("/my-bookings");
  revalidatePath("/instruments/[slug]", "page");
}
