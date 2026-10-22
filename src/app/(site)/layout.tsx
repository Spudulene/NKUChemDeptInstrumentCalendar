import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import { AppHeader } from "@/components/app-header";
import { savedThemeChoice } from "@/lib/theme";

/**
 * Chrome for the app itself. Lives in a route group rather than the root layout so
 * `/embed` — framed inside the department's site — renders without it.
 */
export default async function SiteLayout({ children }: LayoutProps<"/">) {
  const [user, theme] = await Promise.all([getSession(), savedThemeChoice()]);

  return (
    <>
      <AppHeader user={user} theme={theme} showSignIn={env.ENABLE_DEV_LOGIN} />

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
