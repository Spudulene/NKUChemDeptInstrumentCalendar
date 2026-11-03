"use client";

import { useEffect, useRef, type ReactNode } from "react";

/**
 * The modal both instrument-page dialogs use, from the "Book time" artboard: centred
 * on desktop, a bottom sheet with a grab handle on phones ("Phone · Book time").
 * Escape and a click on the scrim close it; focus moves into it on open.
 */
export function SheetDialog({
  labelledBy,
  onClose,
  children,
}: {
  labelledBy: string;
  onClose: () => void;
  children: ReactNode;
}) {
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-scrim sm:items-start sm:px-4 sm:pt-[88px] sm:pb-10"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={labelledBy}
        tabIndex={-1}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[22px] border border-line bg-surface text-ink shadow-[0_-12px_40px_rgba(0,0,0,.3)] outline-none sm:max-w-[600px] sm:rounded-[18px] sm:shadow-[0_24px_64px_rgba(0,0,0,.35)]"
      >
        {/* The sheet's grab handle, phones only. */}
        <div aria-hidden="true" className="mx-auto mt-2 h-[5px] w-10 rounded-full bg-line-2 sm:hidden" />
        {children}
      </div>
    </div>
  );
}
