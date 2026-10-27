import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { AppHeader } from "@/components/app-header";
import { savedThemeChoice } from "@/lib/theme";

/**
 * Chrome for the app itself. Lives in a route group rather than the root layout so
 * `/embed` — framed inside the department's site — renders without it.
 */
export default async function SiteLayout({ children }: LayoutProps<"/">) {
  const [user, theme] = await Promise.all([getSession(), savedThemeChoice()]);
  // Students choose the research group their bookings default to, in the account menu.
  const researchGroup =
    user?.role === "STUDENT"
      ? await Promise.all([
          db.user.findMany({
            where: { isResearchAdvisor: true },
            select: { id: true, name: true },
            orderBy: { name: "asc" },
          }),
          db.user.findUnique({ where: { id: user.id }, select: { advisorId: true } }),
        ]).then(([options, profile]) => ({ options, current: profile?.advisorId ?? null }))
      : undefined;

  return (
    <>
      <AppHeader user={user} theme={theme} researchGroup={researchGroup} showSignIn={env.ENABLE_DEV_LOGIN} />

      <main className="mx-auto box-border w-full max-w-[1240px] flex-1 px-6 pt-8 pb-16">
        {children}
      </main>

      {env.ENABLE_DEV_LOGIN && (
        <footer className="border-t border-line bg-warn-soft px-6 py-2 text-center text-xs text-warn">
          Development login is enabled. Entra SSO is not wired up yet.
        </footer>
      )}
    </>
  );
}
