"use server";

import { revalidatePath } from "next/cache";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";

export type ResearchGroupState = { error: string | null; saved?: boolean };

/**
 * A student's default research group: what the booking form fills in. Each booking
 * still keeps its own copy, so changing this never rewrites past attribution.
 */
export async function setResearchGroupAction(
  _prev: ResearchGroupState,
  formData: FormData,
): Promise<ResearchGroupState> {
  const user = await getSession();
  if (!user) return { error: "Your session expired. Sign in and try again." };

  const raw = String(formData.get("advisorId") ?? "");
  if (raw) {
    const advisor = await db.user.findFirst({
      where: { id: raw, isResearchAdvisor: true },
      select: { id: true },
    });
    if (!advisor) return { error: "That research group isn't available. Pick another." };
  }

  await db.user.update({ where: { id: user.id }, data: { advisorId: raw || null } });
  revalidatePath("/", "layout");
  return { error: null, saved: true };
}
