import Link from "next/link";
import type { SessionUser } from "@/lib/auth";
import { HeaderNav, type NavItem } from "@/components/header-nav";
import { AccountMenu } from "@/components/account-menu";
import type { ThemeChoice } from "@/components/theme-switcher";
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
 * Links appear only for screens the viewer can use. "Admin" from the design joins
 * this list once that page exists.
 */
function navFor(user: SessionUser | null): NavItem[] {
  const items: NavItem[] = [{ href: "/", label: "Instruments" }];
  if (user?.role === "STUDENT") items.push({ href: "/my-bookings", label: "My bookings" });
  if (user?.role === "INSTRUCTOR" || user?.role === "ADMIN") {
    items.push({ href: "/classes", label: "Class reservations" });
  }
  if (user?.role === "ADMIN") items.push({ href: "/admin", label: "Admin" });
  return items;
}

export function AppHeader({
  user,
  theme,
  researchGroup,
  showSignIn,
}: {
  user: SessionUser | null;
  theme: ThemeChoice;
  researchGroup?: { options: { id: string; name: string }[]; current: string | null };
  showSignIn: boolean;
}) {
  return (
    <header className="border-b-[3px] border-gold bg-chrome">
      <div className="mx-auto flex min-h-16 max-w-[1240px] flex-wrap items-center gap-x-3 gap-y-2 px-6 py-2.5 sm:gap-x-7">
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

        {/* Phones: the brand and account share the top row, the nav gets its own. */}
        <div className="order-last w-full sm:order-none sm:flex sm:w-auto sm:flex-auto">
          <HeaderNav items={navFor(user)} />
        </div>

        <div className="ml-auto flex items-center">
          {user ? (
            <AccountMenu
              user={{
                name: user.name,
                email: user.email,
                initials: initials(user.name),
                roleLabel: ROLE_LABEL[user.role],
              }}
              theme={theme}
              researchGroup={researchGroup}
            />
          ) : (
            showSignIn && (
              <Link href="/dev-login" className={buttonClass()}>
                Sign in
              </Link>
            )
          )}
        </div>
      </div>
    </header>
  );
}
