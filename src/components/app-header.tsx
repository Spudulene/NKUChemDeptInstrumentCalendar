import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { HeaderNav, type NavItem } from "@/components/header-nav";
import { ThemeSwitcher, type ThemeChoice } from "@/components/theme-switcher";
import { buttonClass } from "@/components/ui";

const ROLE_LABEL: Record<SessionUser["role"], string> = {
  STUDENT: "Student",
  INSTRUCTOR: "Instructor",
  ADMIN: "Instrument manager",
};

function initials(name: string): string {
  const parts = name.trim().split(/\s+/);
  const letters = parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Links appear only for screens the viewer can use. "My bookings" and "Admin" from
 * the design join this list once those pages exist.
 */
function navFor(user: SessionUser | null): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Instruments" }];
  if (user?.role === "INSTRUCTOR" || user?.role === "ADMIN") {
    items.push({ href: "/classes", label: "Class reservations" });
  }
  return items;
}

export function AppHeader({
  user,
  theme,
  showSignIn,
}: {
  user: SessionUser | null;
  theme: ThemeChoice;
  showSignIn: boolean;
}) {
  return (
    <header className="border-b-[3px] border-gold bg-chrome">
      <div className="mx-auto flex min-h-16 max-w-[1240px] flex-wrap items-center gap-x-7 gap-y-2.5 px-6 py-2.5">
        <Link href="/" className="flex items-center gap-3 text-chrome-ink no-underline">
          <span className="flex size-[38px] flex-none items-center justify-center rounded-[9px] bg-gold text-on-gold">
            <svg
              width="22"
              height="22"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <rect x="3" y="5" width="18" height="16" rx="2" />
              <path d="M3 10h18M8 3v4M16 3v4" />
              <path d="M9 15.5l2 2 4-4" />
            </svg>
          </span>
          <span className="flex flex-col leading-tight">
            <span className="text-base font-bold tracking-[-0.01em]">Instrument Calendar</span>
            <span className="text-[11px] font-bold uppercase tracking-[0.09em] text-gold">
              NKU Chemistry
            </span>
          </span>
        </Link>

        <HeaderNav items={navFor(user)} />

        <div className="flex items-center gap-3">
          <ThemeSwitcher initial={theme} />

          {user ? (
            <details className="relative">
              <summary
                aria-label={`Account menu for ${user.name}, ${ROLE_LABEL[user.role].toLowerCase()}`}
                className="flex size-11 cursor-pointer list-none items-center justify-center rounded-full border-2 border-gold bg-chrome-2 text-sm font-bold text-chrome-ink [&::-webkit-details-marker]:hidden"
              >
                {initials(user.name)}
              </summary>
              <div className="absolute right-0 z-40 mt-2 w-60 rounded-xl border border-line bg-surface p-4 text-ink shadow-lg">
                <p className="text-[15px] font-bold">{user.name}</p>
                <p className="mt-0.5 text-sm text-ink-3">{ROLE_LABEL[user.role]}</p>
                <form action="/api/dev-login/sign-out" method="post" className="mt-3 border-t border-line pt-3">
                  <button
                    type="submit"
                    className="min-h-11 w-full rounded-[10px] border border-line-2 text-sm font-bold hover:bg-surface-2"
                  >
                    Sign out
                  </button>
                </form>
              </div>
            </details>
          ) : (
            showSignIn && (
              <Link
                href="/dev-login"
                className={buttonClass()}
              >
                Sign in
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
