import type { ReactNode } from "react";
import type { ClassPreviewRow } from "@/app/(site)/classes/types";

/**
 * One booking a class or maintenance reservation would affect, as the impact panel
 * lists it: amber for "will be cancelled", red for "can't go ahead".
 */
export function ImpactRow({
  row,
  tone,
  badge,
  children,
}: {
  row: ClassPreviewRow;
  tone: "warn" | "err";
  badge: string;
  children?: ReactNode;
}) {
  return (
    <li
      className={`rounded-xl px-4 py-3.5 ${
        tone === "err"
          ? "bg-surface shadow-[inset_0_0_0_2px_var(--ui-err)]"
          : "bg-surface-2 shadow-[inset_0_0_0_1px_var(--ui-border)]"
      }`}
    >
      <div className="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <span
          aria-hidden="true"
          className="flex size-10 flex-none items-center justify-center rounded-full bg-sunken text-[13px] font-bold"
        >
          {row.initials}
        </span>
        <div className="min-w-0 flex-[1_1_160px]">
          <p className="text-base font-bold">{row.name}</p>
          <p className="mt-0.5 text-sm text-ink-2 tabular-nums">
            {row.time}
            {row.group && ` · ${row.group}`}
          </p>
        </div>
        <span
          className={`flex-none rounded-full px-2.5 py-1.5 text-[13px] font-bold ${
            tone === "err" ? "bg-err-soft text-err" : "bg-warn-soft text-warn"
          }`}
        >
          {badge}
        </span>
      </div>
      {children && (
        <div className="mt-3 border-t border-line pt-3 text-sm leading-normal">{children}</div>
      )}
    </li>
  );
}
