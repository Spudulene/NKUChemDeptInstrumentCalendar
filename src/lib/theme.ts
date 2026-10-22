import { cookies } from "next/headers";
import type { ThemeChoice } from "@/components/theme-switcher";

/** The viewer's saved light/dark choice; anything else means "follow the device". */
export async function savedThemeChoice(): Promise<ThemeChoice> {
  const saved = (await cookies()).get("theme")?.value;
  return saved === "light" || saved === "dark" ? saved : "system";
}
