"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import type { CSSProperties } from "react";

export type AdminNavInstrument = { slug: string; name: string; color: string; isActive: boolean };

const linkClass = (current: boolean) =>
  `flex min-h-11 items-center gap-2.5 rounded-[10px] px-3 text-[15px] no-underline ${
    current ? "bg-surface font-bold text-ink shadow-[inset_0_0_0_1px_var(--ui-border)]" : "font-semibold text-ink-2 hover:text-ink"
  }`;

/** The admin sidebar from the canvas. Client-side only for `usePathname`. */
export function AdminNav({ instruments }: { instruments: AdminNavInstrument[] }) {
  const pathname = usePathname();
  const active = instruments.filter((i) => i.isActive);
  const archived = instruments.filter((i) => !i.isActive);

  const item = (i: AdminNavInstrument) => {
    const href = `/admin/instruments/${i.slug}`;
    const current = pathname === href;
    return (
      <li key={i.slug}>
        <Link href={href} aria-current={current ? "page" : undefined} className={linkClass(current)}>
          <span
            aria-hidden="true"
            style={{ "--inst": i.color } as CSSProperties}
            className="inst-dot size-2.5 flex-none rounded-full"
          />
          <span className="min-w-0 truncate">{i.name}</span>
        </Link>
      </li>
    );
  };

  const newHref = "/admin/instruments/new";

  return (
    <nav aria-label="Admin" className="min-w-0 flex-[1_1_220px] lg:max-w-[280px]">
      <p className="mb-2 ml-3 text-xs font-extrabold tracking-[0.08em] text-ink-3 uppercase">Instruments</p>
      <ul className="flex flex-col gap-0.5">{active.map(item)}</ul>
      <Link
        href={newHref}
        aria-current={pathname === newHref ? "page" : undefined}
        className="mt-2 flex min-h-11 w-full items-center gap-2 rounded-[10px] border-[1.5px] border-dashed border-line-2 px-3 text-[15px] font-bold text-ink no-underline hover:bg-surface"
      >
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" aria-hidden="true">
          <path d="M12 5v14M5 12h14" />
        </svg>
        Add instrument
      </Link>

      {archived.length > 0 && (
        <>
          <p className="mt-6 mb-2 ml-3 text-xs font-extrabold tracking-[0.08em] text-ink-3 uppercase">Archived</p>
          <ul className="flex flex-col gap-0.5">{archived.map(item)}</ul>
        </>
      )}
    </nav>
  );
}
