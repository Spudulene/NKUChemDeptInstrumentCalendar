"use client";

import { startTransition, useActionState, useEffect, useId, useRef, useState } from "react";
import { setResearchGroupAction, type ResearchGroupState } from "@/app/(site)/account-actions";
import { ThemeSwitcher, type ThemeChoice } from "@/components/theme-switcher";
import { Field, fieldClass } from "@/components/ui";

export type AccountMenuUser = {
  name: string;
  email: string;
  initials: string;
  roleLabel: string;
};

const initialGroupState: ResearchGroupState = { error: null };

/**
 * Everything about the signed-in person, behind their initials in the header: who
 * they are, the research group their bookings default to (students), appearance, and
 * signing out. A menu rather than a page — sign-in comes from university SSO, so
 * there's nothing else to manage — and the same on desktop and phone.
 */
export function AccountMenu({
  user,
  theme,
  researchGroup,
}: {
  user: AccountMenuUser;
  theme: ThemeChoice;
  /** Students only: the groups to choose from and the current default. */
  researchGroup?: { options: { id: string; name: string }[]; current: string | null };
}) {
  const [open, setOpen] = useState(false);
  const wrapper = useRef<HTMLDivElement>(null);
  const button = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!wrapper.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        setOpen(false);
        button.current?.focus();
      }
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={wrapper} className="relative">
      <button
        ref={button}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        aria-label={`Account menu for ${user.name}, ${user.roleLabel.toLowerCase()}`}
        onClick={() => setOpen((o) => !o)}
        className="flex size-11 items-center justify-center rounded-full border-2 border-gold bg-chrome-2 text-sm font-bold text-chrome-ink"
      >
        {user.initials}
      </button>

      {open && (
        <div
          id={panelId}
          className="absolute right-0 z-50 mt-2 flex w-[min(320px,calc(100vw-32px))] flex-col gap-4 rounded-2xl border border-line bg-surface p-4 text-ink shadow-[var(--ui-shadow)]"
        >
          <div>
            <p className="text-[15px] font-bold">{user.name}</p>
            <p className="mt-0.5 truncate text-sm text-ink-2">{user.email}</p>
            <p className="mt-0.5 text-[13px] text-ink-3">{user.roleLabel}</p>
          </div>

          {researchGroup && researchGroup.options.length > 0 && (
            <ResearchGroupField {...researchGroup} />
          )}

          <ThemeSwitcher initial={theme} />

          <form action="/api/dev-login/sign-out" method="post" className="border-t border-line pt-3">
            <button
              type="submit"
              className="min-h-11 w-full rounded-[10px] border border-line-2 text-sm font-bold hover:bg-surface-2"
            >
              Sign out
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function ResearchGroupField({
  options,
  current,
}: {
  options: { id: string; name: string }[];
  current: string | null;
}) {
  const [state, save, pending] = useActionState(setResearchGroupAction, initialGroupState);
  const [value, setValue] = useState(current ?? "");

  // Saved on change, outside a <form action>: React resets a form after its action
  // runs, which would snap the select back to its first option.
  const pick = (advisorId: string) => {
    setValue(advisorId);
    const data = new FormData();
    data.set("advisorId", advisorId);
    startTransition(() => save(data));
  };

  return (
    <div>
      <Field
        label="Research group"
        help={
          state.error ??
          (pending
            ? "Saving…"
            : state.saved
              ? "Saved. New bookings use this group."
              : "Filled in on new bookings. You can still change it on each one.")
        }
      >
        <select
          value={value}
          onChange={(e) => pick(e.target.value)}
          className={fieldClass}
        >
          <option value="">Not in a group</option>
          {options.map((o) => (
            <option key={o.id} value={o.id}>
              {o.name}
            </option>
          ))}
        </select>
      </Field>
    </div>
  );
}
