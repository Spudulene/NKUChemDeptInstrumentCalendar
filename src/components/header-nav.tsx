"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

export type NavItem = { href: string; label: string };

/** Client-side only for `usePathname`; which links appear is decided on the server. */
export function HeaderNav({ items }: { items: NavItem[] }) {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-auto flex-wrap gap-1">
      {items.map((item) => {
        const current =
          item.href === "/"
            ? pathname === "/" || pathname.startsWith("/instruments")
            : pathname.startsWith(item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={current ? "page" : undefined}
            className={`inline-flex min-h-11 items-center rounded-[10px] px-3.5 text-[15px] font-semibold no-underline ${
              current
                ? "bg-chrome-2 text-chrome-ink shadow-[inset_0_-3px_0_var(--ui-gold)]"
                : "text-chrome-ink-2 hover:text-chrome-ink"
            }`}
          >
            {item.label}
          </Link>
        );
      })}
    </nav>
  );
}
