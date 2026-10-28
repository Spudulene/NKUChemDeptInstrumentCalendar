import Link from "next/link";
import type { ComponentProps, CSSProperties, ReactNode } from "react";

/**
 * The building blocks every screen is made from, matched to the "Instrument Calendar —
 * NKU Prototypes" design canvas. See docs/DESIGN.md before adding UI.
 *
 * No hooks here, so these render in Server and Client Components alike. Colors come
 * only from the tokens in globals.css (bg-surface, text-ink-2, border-line, ...), which
 * is what makes dark mode work without per-component effort.
 */

// ---------------------------------------------------------------------------
// Buttons
// ---------------------------------------------------------------------------

type ButtonVariant = "primary" | "secondary" | "ghost";
type ButtonSize = "md" | "lg" | "icon";

const BUTTON_BASE =
  "inline-flex items-center justify-center gap-2 rounded-xl font-bold no-underline transition disabled:cursor-not-allowed";

const BUTTON_VARIANT: Record<ButtonVariant, string> = {
  // One gold action per view: the thing the screen is for.
  primary: "bg-gold text-on-gold hover:brightness-95 disabled:bg-sunken disabled:text-ink-3",
  secondary:
    "border border-line-2 bg-surface text-ink hover:bg-surface-2 disabled:text-ink-3",
  ghost: "text-ink-2 hover:bg-sunken hover:text-ink",
};

// Every size keeps a 44px touch target.
const BUTTON_SIZE: Record<ButtonSize, string> = {
  md: "min-h-11 px-4 text-[15px]",
  lg: "min-h-12 px-5 text-base",
  icon: "size-11",
};

export function buttonClass({
  variant = "primary",
  size = "md",
  className = "",
}: { variant?: ButtonVariant; size?: ButtonSize; className?: string } = {}) {
  return `${BUTTON_BASE} ${BUTTON_VARIANT[variant]} ${BUTTON_SIZE[size]} ${className}`;
}

export function Button({
  variant,
  size,
  className,
  type = "button",
  ...props
}: ComponentProps<"button"> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <button type={type} className={buttonClass({ variant, size, className })} {...props} />;
}

export function ButtonLink({
  variant,
  size,
  className,
  ...props
}: ComponentProps<typeof Link> & { variant?: ButtonVariant; size?: ButtonSize }) {
  return <Link className={buttonClass({ variant, size, className })} {...props} />;
}

// ---------------------------------------------------------------------------
// Surfaces
// ---------------------------------------------------------------------------

/** The white (or dark) panel everything sits on. `raised` adds the canvas's soft shadow. */
export function Card({
  as: Tag = "div",
  raised = false,
  className = "",
  children,
  ...props
}: {
  as?: "div" | "section" | "article" | "aside" | "li" | "ul";
  raised?: boolean;
  className?: string;
  children: ReactNode;
} & Omit<ComponentProps<"section">, "className" | "children" | "ref">) {
  return (
    <Tag
      className={`rounded-2xl border border-line bg-surface ${raised ? "shadow-[var(--ui-shadow)]" : ""} ${className}`}
      {...props}
    >
      {children}
    </Tag>
  );
}

/** A small uppercase heading for a group, as on the phone screens and email preview. */
export function Eyebrow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <p className={`text-xs font-extrabold tracking-[0.07em] text-ink-3 uppercase ${className}`}>
      {children}
    </p>
  );
}

// ---------------------------------------------------------------------------
// Forms
// ---------------------------------------------------------------------------

/** For <input>, <select> and single-line controls. Text is 16px so iOS doesn't zoom. */
export const fieldClass =
  "box-border min-h-[46px] w-full rounded-[10px] border border-line-2 bg-surface px-3 font-sans text-base font-medium text-ink";

export const textareaClass =
  "box-border w-full resize-y rounded-[10px] border border-line-2 bg-surface px-3 py-2.5 font-sans text-[15px] leading-[1.45] text-ink";

/**
 * A labelled control. The label wraps the control, so no id wiring is needed.
 * `hint` sits after the label in a lighter weight ("optional", "shown to students");
 * `help` goes under the control.
 */
export function Field({
  label,
  hint,
  required = false,
  help,
  className = "",
  children,
}: {
  label: ReactNode;
  hint?: ReactNode;
  required?: boolean;
  help?: ReactNode;
  className?: string;
  children: ReactNode;
}) {
  return (
    <label className={`flex flex-col gap-1.5 text-sm font-bold text-ink ${className}`}>
      <span>
        {label}
        {required && (
          <span aria-hidden="true" className="text-err">
            {" "}
            *
          </span>
        )}
        {hint && <span className="font-medium text-ink-3"> {hint}</span>}
      </span>
      {children}
      {help && <span className="text-[13px] font-medium text-ink-3">{help}</span>}
    </label>
  );
}

/**
 * Pick-one buttons, like the booking dialog's Length choices. Pair with a hidden input
 * (or form state) holding the value; these are buttons, not radio inputs, to match the
 * canvas, so `aria-pressed` carries the selection.
 */
export function Segmented<T extends string | number>({
  legend,
  options,
  value,
  onChange,
  columns = 4,
}: {
  legend: string;
  options: { value: T; label: string }[];
  value: T;
  onChange: (value: T) => void;
  columns?: number;
}) {
  return (
    <fieldset className="m-0 border-0 p-0">
      <legend className="p-0 text-sm font-bold text-ink">{legend}</legend>
      <div
        className="mt-1.5 grid gap-2"
        style={{ gridTemplateColumns: `repeat(${Math.min(columns, options.length)}, minmax(0, 1fr))` }}
      >
        {options.map((option) => {
          const on = option.value === value;
          return (
            <button
              key={String(option.value)}
              type="button"
              aria-pressed={on}
              onClick={() => onChange(option.value)}
              className={`min-h-[46px] rounded-[10px] border px-2 text-[15px] font-bold ${
                on ? "border-ink bg-ink text-bg" : "border-line-2 bg-surface text-ink hover:bg-surface-2"
              }`}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}

// ---------------------------------------------------------------------------
// Messages
// ---------------------------------------------------------------------------

type Tone = "ok" | "warn" | "err" | "info";

const NOTICE_TONE: Record<Tone, { box: string; title: string }> = {
  ok: { box: "bg-ok-soft", title: "text-ok" },
  warn: { box: "bg-warn-soft shadow-[inset_0_0_0_1.5px_var(--ui-warn)]", title: "text-warn" },
  err: { box: "bg-err-soft", title: "text-err" },
  info: { box: "bg-surface-2 shadow-[inset_0_0_0_1px_var(--ui-border)]", title: "text-ink" },
};

/**
 * A status message: green for done, amber for "check this", red for "can't". `alert`
 * makes screen readers announce it when it appears, for errors after a submit.
 */
export function Notice({
  tone,
  title,
  children,
  alert = false,
  className = "",
}: {
  tone: Tone;
  title?: ReactNode;
  children?: ReactNode;
  alert?: boolean;
  className?: string;
}) {
  return (
    <div
      role={alert ? "alert" : undefined}
      className={`flex items-start gap-3 rounded-xl px-4 py-3.5 ${NOTICE_TONE[tone].box} ${className}`}
    >
      <NoticeIcon tone={tone} />
      <div className="min-w-0 text-sm leading-normal text-ink">
        {title && <p className={`text-[15px] font-bold ${NOTICE_TONE[tone].title}`}>{title}</p>}
        {children && <div className={title ? "mt-1" : ""}>{children}</div>}
      </div>
    </div>
  );
}

function NoticeIcon({ tone }: { tone: Tone }) {
  const color = { ok: "text-ok", warn: "text-warn", err: "text-err", info: "text-ink-3" }[tone];
  return (
    <svg
      width="20"
      height="20"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      className={`mt-px flex-none ${color}`}
    >
      {tone === "ok" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M8 12l3 3 5-6" />
        </>
      ) : tone === "info" ? (
        <>
          <circle cx="12" cy="12" r="9" />
          <path d="M12 11v5M12 8h.01" />
        </>
      ) : (
        <>
          <path d="M12 3 2 20h20L12 3z" />
          <path d="M12 10v4M12 17h.01" />
        </>
      )}
    </svg>
  );
}

/** A small rounded label, like an instrument's features ("Overnight blocks"). */
export function Chip({ children }: { children: ReactNode }) {
  return (
    <span className="inline-block rounded-full border border-line bg-surface-2 px-2.5 py-1 text-xs font-semibold text-ink-2">
      {children}
    </span>
  );
}

// ---------------------------------------------------------------------------
// Instruments
// ---------------------------------------------------------------------------

/**
 * The short code on an instrument's tile: the last all-capitals word of its name
 * ("Bruker 400 MHz NMR" → NMR, "Agilent GC-MS" → GC-MS, "… (MPLC)" → MPLC), or the
 * initials when there isn't one.
 */
export function instrumentAbbr(name: string): string {
  const words = name.replace(/[()]/g, " ").split(/\s+/).filter(Boolean);
  const code = [...words].reverse().find((w) => /^[A-Z0-9-]*[A-Z]{2,}[A-Z0-9-]*$/.test(w));
  return code ?? words.slice(0, 2).map((w) => w[0]?.toUpperCase() ?? "").join("");
}

/**
 * The instrument's colour as a tinted tile. Its colour is admin-set data rather than a
 * token, so it is passed in as `--inst` and blended with the theme's surface and text
 * (see the `inst-*` utilities) — that keeps it legible in both light and dark.
 */
export function InstrumentTile({
  name,
  color,
  size = "md",
}: {
  name: string;
  color: string;
  size?: "sm" | "md" | "lg";
}) {
  const dims = { sm: "size-[34px] rounded-lg text-[10px]", md: "size-11 rounded-xl text-[11px]", lg: "size-14 rounded-[14px] text-sm" }[size];
  return (
    <span
      aria-hidden="true"
      style={{ "--inst": color } as CSSProperties}
      className={`inst-soft inst-ink flex flex-none items-center justify-center font-extrabold tracking-[0.02em] ${dims}`}
    >
      {instrumentAbbr(name)}
    </span>
  );
}
