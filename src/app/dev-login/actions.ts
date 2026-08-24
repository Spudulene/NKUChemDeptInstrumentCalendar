"use server";

import { redirect } from "next/navigation";
import { devSignIn } from "@/lib/auth";

/**
 * Placeholder sign-in. Replaced by the Entra OAuth callback once an app registration
 * exists — see `signInFromEntra` in src/lib/auth.ts for the shape that replaces it.
 */
export async function signInAction(formData: FormData): Promise<void> {
  const email = String(formData.get("email") ?? "").trim();
  const name = String(formData.get("name") ?? "").trim();

  if (!email.includes("@")) {
    redirect("/dev-login?error=Enter+a+valid+email+address.");
  }

  try {
    await devSignIn(email, name || undefined);
  } catch (error) {
    const message =
      error instanceof Error ? error.message : "Sign-in failed.";
    redirect(`/dev-login?error=${encodeURIComponent(message)}`);
  }

  redirect("/");
}
