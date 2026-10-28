"use client";

import {
  useActionState,
  useState,
  type CSSProperties,
  type ReactNode,
} from "react";
import {
  saveInstrumentAction,
  type SettingsState,
} from "@/app/(site)/admin/actions";
import type {
  InstrumentSettings,
  WindowSettings,
} from "@/lib/admin/instrument-settings";
import {
  Button,
  ButtonLink,
  Field,
  Notice,
  Segmented,
  buttonClass,
  fieldClass,
  textareaClass,
} from "@/components/ui";

const DAY = 24 * 60;

/** Monday first, as the canvas lays out the week. Values match the Weekday enum. */
const WEEK = [
  { value: "MON", short: "M", full: "Monday" },
  { value: "TUE", short: "T", full: "Tuesday" },
  { value: "WED", short: "W", full: "Wednesday" },
  { value: "THU", short: "T", full: "Thursday" },
  { value: "FRI", short: "F", full: "Friday" },
  { value: "SAT", short: "S", full: "Saturday" },
  { value: "SUN", short: "S", full: "Sunday" },
] as const;

/** The canvas's swatches: each reads well tinted on light and dark surfaces. */
const PALETTE = [
  { label: "Indigo", color: "#4338CA" },
  { label: "Rust", color: "#C2410C" },
  { label: "Teal", color: "#0F766E" },
  { label: "Rose", color: "#BE185D" },
  { label: "Olive", color: "#4D7C0F" },
  { label: "Sky", color: "#0369A1" },
];

// The engine's formatters live with the server's timezone config; these are the
// same wordings, for a form that only ever deals in durations and clock times.
const clock = (m: number) =>
  `${String(Math.floor((m % DAY) / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
const duration = (m: number) => {
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r} min`;
  if (r === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h}h ${r}m`;
};
const span = (w: Pick<WindowSettings, "startMinute" | "endMinute">) =>
  (w.endMinute <= w.startMinute ? w.endMinute + DAY : w.endMinute) -
  w.startMinute;

/** Preset choices, plus the current value when it isn't one of them, in order. */
function withCurrent<T extends number | null>(
  presets: readonly T[],
  current: T,
): T[] {
  return presets.includes(current)
    ? [...presets]
    : [...presets, current].sort((a, b) => (a ?? -1) - (b ?? -1));
}

const TIMES = Array.from({ length: 48 }, (_, i) => i * 30);

type Option<T> = { value: T; label: string };

/** A select over numbers (or null for "no limit"), keeping the form's state typed. */
function NumberSelect<T extends number | null>({
  label,
  help,
  options,
  value,
  onChange,
  small = false,
}: {
  label: ReactNode;
  help?: ReactNode;
  options: Option<T>[];
  value: T;
  onChange: (value: T) => void;
  small?: boolean;
}) {
  return (
    <Field
      label={label}
      help={help}
      className={small ? "text-[13px] text-ink-2" : ""}
    >
      <select
        value={value === null ? "" : String(value)}
        onChange={(e) =>
          onChange((e.target.value === "" ? null : Number(e.target.value)) as T)
        }
        className={`${fieldClass} tabular-nums ${small ? "min-h-11 px-2.5 text-[15px]" : ""}`}
      >
        {options.map((o) => (
          <option
            key={String(o.value)}
            value={o.value === null ? "" : String(o.value)}
          >
            {o.label}
          </option>
        ))}
      </select>
    </Field>
  );
}

const initialState: SettingsState = { error: null };

/**
 * Instrument settings, from the canvas's admin artboard: basics and colour, the
 * bookable windows with a week-at-a-glance, and the instrument-wide limits.
 *
 * `version` changes whenever the saved instrument does, which remounts the editor
 * with fresh data — new windows pick up their database ids, so a second save
 * updates them instead of adding copies.
 */
export function InstrumentSettingsForm({
  instrumentId,
  slug,
  initial,
  version,
}: {
  instrumentId: string | null;
  slug: string | null;
  initial: InstrumentSettings;
  version: string;
}) {
  const [state, formAction, pending] = useActionState(
    saveInstrumentAction,
    initialState,
  );
  return (
    <Editor
      key={version}
      instrumentId={instrumentId}
      slug={slug}
      initial={initial}
      state={state}
      formAction={formAction}
      pending={pending}
    />
  );
}

function Editor({
  instrumentId,
  slug,
  initial,
  state,
  formAction,
  pending,
}: {
  instrumentId: string | null;
  slug: string | null;
  initial: InstrumentSettings;
  state: SettingsState;
  formAction: (formData: FormData) => void;
  pending: boolean;
}) {
  const [s, setS] = useState(initial);
  const [dirty, setDirty] = useState(false);
  const set = <K extends keyof InstrumentSettings>(
    key: K,
    value: InstrumentSettings[K],
  ) => {
    setS((prev) => ({ ...prev, [key]: value }));
    setDirty(true);
  };
  const setWindow = (index: number, patch: Partial<WindowSettings>) =>
    set(
      "windows",
      s.windows.map((w, i) => (i === index ? { ...w, ...patch } : w)),
    );

  const addWindow = () => {
    let n = s.windows.length + 1;
    while (s.windows.some((w) => w.name === `Window ${n}`)) n += 1;
    set("windows", [
      ...s.windows,
      {
        name: `Window ${n}`,
        daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
        startMinute: 8 * 60,
        endMinute: 17 * 60,
        wholeBlockOnly: false,
        slotSizeMinutes: 30,
        minDurationMinutes: 30,
        maxDurationMinutes: 120,
        maxConsecutiveSlots: null,
        maxBookingsPerUserPerWeek: null,
      },
    ]);
  };

  const isNew = instrumentId === null;
  const saveLabel = pending
    ? "Saving…"
    : isNew
      ? "Create instrument"
      : "Save changes";
  const showSaved = Boolean(state.savedAt) && !dirty && !state.error;
  const palette = PALETTE.some(
    (p) => p.color.toLowerCase() === s.color.toLowerCase(),
  )
    ? PALETTE
    : [...PALETTE, { label: "Current colour", color: s.color }];

  // Shown above and below the form; only the top one is announced.
  const status = (alert: boolean) =>
    state.error ? (
      <Notice tone="err" alert={alert}>
        {state.error}
      </Notice>
    ) : showSaved ? (
      <Notice tone="ok" title="Saved">
        New bookings follow these settings from now on. Bookings already made
        keep the rules they were made under.
      </Notice>
    ) : null;

  return (
    <form
      action={formAction}
      onSubmit={() => setDirty(false)}
      style={{ "--inst": s.color } as CSSProperties}
      className="flex flex-col gap-5"
    >
      {instrumentId && (
        <input type="hidden" name="instrumentId" value={instrumentId} />
      )}
      <input type="hidden" name="settings" value={JSON.stringify(s)} />

      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-sm font-semibold text-ink-3">
            {isNew ? "Add instrument" : "Instrument settings"}
          </p>
          <h1 className="mt-0.5 text-[32px] leading-tight font-extrabold tracking-[-0.02em]">
            {s.name || "New instrument"}
          </h1>
        </div>
        <div className="flex flex-wrap gap-2.5">
          {slug && (
            <ButtonLink href={`/instruments/${slug}`} variant="secondary">
              View schedule
            </ButtonLink>
          )}
          <Button type="submit" disabled={pending}>
            {saveLabel}
          </Button>
        </div>
      </div>

      {status(true)}

      <Section id="basics-h" title="Basics">
        <div className="mt-[18px] grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Name">
            <input
              type="text"
              required
              maxLength={80}
              value={s.name}
              onChange={(e) => set("name", e.target.value)}
              className={fieldClass}
            />
          </Field>
          <Field label="Location" hint="optional">
            <input
              type="text"
              maxLength={80}
              value={s.location}
              onChange={(e) => set("location", e.target.value)}
              placeholder="e.g. SC 350 — NMR Suite"
              className={fieldClass}
            />
          </Field>
        </div>
        <Field label="Short description" hint="optional" className="mt-4">
          <textarea
            rows={2}
            maxLength={300}
            value={s.description}
            onChange={(e) => set("description", e.target.value)}
            className={textareaClass}
          />
        </Field>
        {slug && (
          <p className="mt-2 text-[13px] text-ink-3">
            Schedule link:{" "}
            <span className="font-semibold text-ink-2">
              /instruments/{slug}
            </span>
            . It stays the same if you rename the instrument, so embeds keep
            working.
          </p>
        )}
        <fieldset className="m-0 mt-4 border-0 p-0">
          <legend className="p-0 text-sm font-bold text-ink">
            Calendar colour
          </legend>
          <div className="mt-2 flex flex-wrap gap-2.5">
            {palette.map((p) => {
              const on = p.color.toLowerCase() === s.color.toLowerCase();
              return (
                <button
                  key={p.color}
                  type="button"
                  aria-label={p.label}
                  aria-pressed={on}
                  onClick={() => set("color", p.color)}
                  style={{ "--inst": p.color } as CSSProperties}
                  className={`inst-dot size-11 rounded-full border-[3px] border-surface ${
                    on
                      ? "shadow-[0_0_0_3px_var(--ui-text)]"
                      : "shadow-[0_0_0_1px_var(--ui-border2)]"
                  }`}
                />
              );
            })}
          </div>
          <p className="mt-2 text-[13px] text-ink-3">
            Tinted to stay readable in light and dark mode.
          </p>
        </fieldset>
      </Section>

      <Section
        id="windows-h"
        title="Bookable windows"
        intro="Each window has its own rules. Add a window for anything this instrument does differently — overnight runs, weekends, a sequence queue."
        action={
          <Button variant="secondary" onClick={addWindow}>
            <PlusIcon />
            Add window
          </Button>
        }
      >
        <WeekAtAGlance windows={s.windows} />
        {s.windows.length === 0 && (
          <Notice tone="warn" className="mt-4" title="No windows">
            Students can&apos;t book this instrument until it has at least one
            window. Class and maintenance reservations still work.
          </Notice>
        )}
        <div className="mt-4 flex flex-col gap-3.5">
          {s.windows.map((w, i) => (
            <WindowCard
              key={w.id ?? `new-${i}`}
              window={w}
              index={i}
              onChange={(patch) => setWindow(i, patch)}
              onRemove={() =>
                set(
                  "windows",
                  s.windows.filter((_, j) => j !== i),
                )
              }
            />
          ))}
        </div>
      </Section>

      <Section
        id="policy-h"
        title="Limits and policies"
        intro="They apply across every window on this instrument."
      >
        <div className="mt-[18px] grid grid-cols-[repeat(auto-fit,minmax(240px,1fr))] gap-4">
          <NumberSelect
            label="Bookings open"
            help="Stops anyone booking the whole semester on day one."
            value={s.bookingHorizonDays}
            onChange={(v) => set("bookingHorizonDays", v)}
            options={withCurrent(
              [7, 14, 21, 28, 30, 42, 60, 90],
              s.bookingHorizonDays,
            ).map((d) => ({
              value: d,
              label:
                d % 7 === 0
                  ? `${d / 7} week${d === 7 ? "" : "s"} ahead`
                  : `${d} days ahead`,
            }))}
          />
          <NumberSelect
            label="Minimum notice"
            help="How soon before the start a booking can be made."
            value={s.minLeadTimeMinutes}
            onChange={(v) => set("minLeadTimeMinutes", v)}
            options={withCurrent(
              [0, 15, 30, 60, 120, 240, 720, 1440],
              s.minLeadTimeMinutes,
            ).map((m) => ({
              value: m,
              label: m === 0 ? "None" : duration(m),
            }))}
          />
          <NumberSelect
            label="Cancellation deadline"
            help="After this, students ask the instrument manager."
            value={s.cancellationDeadlineMinutes}
            onChange={(v) => set("cancellationDeadlineMinutes", v)}
            options={withCurrent(
              [0, 30, 60, 120, 240, 720, 1440, 2880],
              s.cancellationDeadlineMinutes,
            ).map((m) => ({
              value: m,
              label:
                m === 0
                  ? "Any time before start"
                  : `${duration(m)} before start`,
            }))}
          />
          <NumberSelect
            label="Changeover buffer"
            help="Gap kept between bookings for sample changes or shimming."
            value={s.bufferMinutes}
            onChange={(v) => set("bufferMinutes", v)}
            options={withCurrent(
              [0, 5, 10, 15, 20, 30, 60],
              s.bufferMinutes,
            ).map((m) => ({
              value: m,
              label: m === 0 ? "None" : duration(m),
            }))}
          />
          <NumberSelect
            label="Weekly cap per student"
            help="Total booked time per student, per week. Whole-block windows don't count toward it."
            value={s.maxMinutesPerUserPerWeek}
            onChange={(v) => set("maxMinutesPerUserPerWeek", v)}
            options={withCurrent<number | null>(
              [null, 60, 120, 180, 240, 360, 480, 600, 720, 960, 1200],
              s.maxMinutesPerUserPerWeek,
            ).map((m) => ({
              value: m,
              label: m === null ? "No limit" : duration(m),
            }))}
          />
        </div>

        <div className="mt-5 flex items-center justify-between gap-4 rounded-xl border border-line bg-surface-2 px-[18px] py-4">
          <div>
            <p id="grp-label" className="text-[15px] font-bold">
              Require a research group
            </p>
            <p className="mt-0.5 text-[13px] text-ink-3">
              Filled in from each student&apos;s profile; they can change it per
              booking.
            </p>
          </div>
          <button
            type="button"
            role="switch"
            aria-checked={s.requireResearchAdvisor}
            aria-labelledby="grp-label"
            onClick={() =>
              set("requireResearchAdvisor", !s.requireResearchAdvisor)
            }
            className={`flex h-8 w-14 flex-none items-center rounded-full p-[3px] ${
              s.requireResearchAdvisor
                ? "justify-end bg-ok"
                : "justify-start bg-line-2"
            }`}
          >
            <span className="size-[26px] rounded-full bg-surface shadow-[0_1px_3px_rgba(0,0,0,.3)]" />
          </button>
        </div>
      </Section>

      <div className="flex flex-col gap-3">
        {status(false)}
        <div className="flex justify-end">
          <Button type="submit" size="lg" disabled={pending}>
            {saveLabel}
          </Button>
        </div>
      </div>
    </form>
  );
}

function Section({
  id,
  title,
  intro,
  action,
  children,
}: {
  id: string;
  title: string;
  intro?: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section
      aria-labelledby={id}
      className="rounded-2xl border border-line bg-surface p-5 sm:p-6"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="max-w-[620px]">
          <h2 id={id} className="text-lg font-bold">
            {title}
          </h2>
          {intro && (
            <p className="mt-1.5 text-[15px] leading-normal text-ink-2">
              {intro}
            </p>
          )}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}

function PlusIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2.4"
      strokeLinecap="round"
      aria-hidden="true"
      className="mr-2 inline"
    >
      <path d="M12 5v14M5 12h14" />
    </svg>
  );
}

/** How each window is drawn in the week-at-a-glance and on its card. */
const WINDOW_FILL = [
  "inst-soft shadow-[inset_0_0_0_1.5px_var(--inst)]",
  "inst-dot",
  "bg-gold",
  "bg-ink-3",
];
const fillFor = (i: number) => WINDOW_FILL[i % WINDOW_FILL.length];

/** When the instrument is open, Monday to Sunday, with overnight windows spilling into the next day. */
function WeekAtAGlance({ windows }: { windows: WindowSettings[] }) {
  const rows = WEEK.map(
    () => [] as { from: number; to: number; fill: string; key: string }[],
  );
  windows.forEach((w, i) => {
    w.daysOfWeek.forEach((day) => {
      const d = WEEK.findIndex((x) => x.value === day);
      const end = w.startMinute + span(w);
      rows[d].push({
        from: w.startMinute,
        to: Math.min(end, DAY),
        fill: fillFor(i),
        key: `${i}a`,
      });
      if (end > DAY)
        rows[(d + 1) % 7].push({
          from: 0,
          to: end - DAY,
          fill: fillFor(i),
          key: `${i}b${d}`,
        });
    });
  });

  return (
    <figure className="m-0 mt-5 rounded-xl border border-line bg-surface-2 px-[18px] py-4">
      <figcaption className="flex flex-wrap justify-between gap-x-4 gap-y-2 text-sm font-bold">
        Week at a glance
        <span className="flex flex-wrap gap-x-3.5 gap-y-1.5 text-[13px] font-medium text-ink-2">
          {windows.map((w, i) => (
            <span
              key={w.id ?? `n${i}`}
              className="inline-flex items-center gap-1.5"
            >
              <span
                aria-hidden="true"
                className={`h-3 w-3.5 rounded-[3px] ${fillFor(i)}`}
              />
              {w.name}
            </span>
          ))}
          <span className="inline-flex items-center gap-1.5">
            <span
              aria-hidden="true"
              className="h-3 w-3.5 rounded-[3px] bg-sunken shadow-[inset_0_0_0_1px_var(--ui-border2)]"
            />
            Closed
          </span>
        </span>
      </figcaption>
      <div className="mt-3 grid grid-cols-[40px_minmax(0,1fr)] items-center gap-x-2.5 gap-y-1.5">
        <span />
        <div className="relative h-4 text-[11px] font-semibold text-ink-3 tabular-nums">
          {[0, 6, 12, 18, 24].map((h) => (
            <span
              key={h}
              className={`absolute top-0 ${h % 12 ? "hidden sm:inline" : ""} ${h === 0 ? "left-0" : h === 24 ? "right-0" : "-translate-x-1/2"}`}
              style={
                h > 0 && h < 24 ? { left: `${(h / 24) * 100}%` } : undefined
              }
            >
              {clock(h === 24 ? 0 : h * 60)}
            </span>
          ))}
        </div>
        {WEEK.map((day, d) => (
          <div key={day.value} className="contents">
            <span className="text-[13px] font-bold text-ink-2">
              {day.full.slice(0, 3)}
            </span>
            <div className="relative h-[26px] overflow-hidden rounded-md bg-sunken shadow-[inset_0_0_0_1px_var(--ui-border)]">
              {rows[d].map((seg) => (
                <span
                  key={seg.key}
                  className={`absolute top-[3px] bottom-[3px] rounded ${seg.fill}`}
                  style={{
                    left: `calc(${(seg.from / DAY) * 100}% + 1px)`,
                    width: `calc(${((seg.to - seg.from) / DAY) * 100}% - 2px)`,
                  }}
                />
              ))}
            </div>
          </div>
        ))}
      </div>
    </figure>
  );
}

function WindowCard({
  window: w,
  index,
  onChange,
  onRemove,
}: {
  window: WindowSettings;
  index: number;
  onChange: (patch: Partial<WindowSettings>) => void;
  onRemove: () => void;
}) {
  const length = span(w);
  const nextDay = w.endMinute <= w.startMinute;
  const count = w.daysOfWeek.length;
  const summary = `${count === 7 ? "Every day" : `${count} day${count === 1 ? "" : "s"}`} · ${clock(w.startMinute)}${nextDay ? " → " : " – "}${clock(w.endMinute)}`;

  // Durations are whole slots, up to the window's length (capped for the menu's sake).
  const steps = Array.from(
    {
      length: Math.max(
        1,
        Math.floor(Math.min(length, 12 * 60) / w.slotSizeMinutes),
      ),
    },
    (_, k) => (k + 1) * w.slotSizeMinutes,
  );
  const durationOptions = (current: number) =>
    withCurrent(steps, current).map((m) => ({ value: m, label: duration(m) }));
  const timeOptions = (current: number) =>
    withCurrent(TIMES, current).map((m) => ({ value: m, label: clock(m) }));

  const setMode = (block: boolean) =>
    onChange(
      block
        ? {
            wholeBlockOnly: true,
            maxBookingsPerUserPerWeek: w.maxBookingsPerUserPerWeek ?? 1,
          }
        : {
            wholeBlockOnly: false,
            slotSizeMinutes: 30,
            minDurationMinutes: 30,
            maxDurationMinutes: Math.min(120, length),
          },
    );

  return (
    <article className="rounded-[14px] border border-line px-4 py-4 sm:px-5">
      <div className="flex items-center gap-2.5">
        <span
          aria-hidden="true"
          className={`size-3.5 flex-none rounded ${fillFor(index)}`}
        />
        <h3 className="text-[17px] font-extrabold">
          {w.name || "Unnamed window"}
        </h3>
        <span className="hidden text-sm text-ink-3 tabular-nums sm:inline">
          {summary}
        </span>
        <button
          type="button"
          onClick={onRemove}
          className="ml-auto min-h-10 rounded-lg px-3 text-sm font-semibold text-ink-2 hover:bg-err-soft hover:text-err"
        >
          Remove
        </button>
      </div>

      <div className="mt-3.5 flex flex-wrap items-end gap-x-7 gap-y-4">
        <Field label="Name" className="w-[180px] text-[13px] text-ink-2">
          <input
            type="text"
            required
            maxLength={40}
            value={w.name}
            onChange={(e) => onChange({ name: e.target.value })}
            className={`${fieldClass} min-h-11 text-[15px]`}
          />
        </Field>

        <fieldset className="m-0 w-full border-0 p-0 sm:w-auto">
          <legend className="p-0 text-[13px] font-bold text-ink-2">Days</legend>
          <div className="mt-1.5 grid grid-cols-7 gap-1 sm:flex">
            {WEEK.map((d) => {
              const on = w.daysOfWeek.includes(d.value);
              return (
                <button
                  key={d.value}
                  type="button"
                  aria-label={d.full}
                  aria-pressed={on}
                  onClick={() =>
                    onChange({
                      daysOfWeek: on
                        ? w.daysOfWeek.filter((x) => x !== d.value)
                        : [...w.daysOfWeek, d.value],
                    })
                  }
                  className={`h-10 rounded-[9px] border text-sm font-extrabold sm:w-10 ${
                    on
                      ? "border-ink bg-ink text-bg"
                      : "border-line-2 bg-surface text-ink-2"
                  }`}
                >
                  {d.short}
                </button>
              );
            })}
          </div>
        </fieldset>

        <div className="flex items-end gap-2">
          <div className="w-[100px]">
            <NumberSelect
              small
              label="From"
              value={w.startMinute}
              options={timeOptions(w.startMinute)}
              onChange={(v) => onChange({ startMinute: v })}
            />
          </div>
          <div className="w-[100px]">
            <NumberSelect
              small
              label="To"
              value={w.endMinute}
              options={timeOptions(w.endMinute)}
              onChange={(v) => onChange({ endMinute: v })}
            />
          </div>
          {nextDay && (
            <span className="mb-3 rounded-full bg-gold-soft px-2 py-0.5 text-xs font-extrabold whitespace-nowrap text-gold-ink">
              +1 day
            </span>
          )}
        </div>

        <div className="w-full sm:w-[280px]">
          <Segmented
            legend="Booked as"
            options={[
              { value: "slots", label: "Slots" },
              { value: "block", label: "One whole block" },
            ]}
            value={w.wholeBlockOnly ? "block" : "slots"}
            columns={2}
            onChange={(v) => setMode(v === "block")}
          />
        </div>
      </div>

      <div className="mt-3.5 grid grid-cols-[repeat(auto-fit,minmax(170px,1fr))] gap-3 border-t border-line pt-3.5">
        {w.wholeBlockOnly ? (
          <>
            <NumberSelect
              small
              label="Blocks per week"
              value={w.maxBookingsPerUserPerWeek}
              onChange={(v) => onChange({ maxBookingsPerUserPerWeek: v })}
              options={withCurrent<number | null>(
                [null, 1, 2, 3, 4, 5, 7],
                w.maxBookingsPerUserPerWeek,
              ).map((n) => ({
                value: n,
                label: n === null ? "No limit" : `${n} per student`,
              }))}
            />
            <Field label="Block length" className="text-[13px] text-ink-2">
              <span className="flex min-h-11 items-center text-[15px] font-semibold text-ink">
                Whole window ({duration(length)})
              </span>
            </Field>
          </>
        ) : (
          <>
            <NumberSelect
              small
              label="Slot length"
              value={w.slotSizeMinutes}
              onChange={(v) =>
                onChange({
                  slotSizeMinutes: v,
                  minDurationMinutes: Math.max(
                    v,
                    Math.round(w.minDurationMinutes / v) * v,
                  ),
                  maxDurationMinutes: Math.max(
                    v,
                    Math.round(w.maxDurationMinutes / v) * v,
                  ),
                })
              }
              options={withCurrent(
                [10, 15, 20, 30, 45, 60, 90, 120],
                w.slotSizeMinutes,
              ).map((m) => ({
                value: m,
                label: duration(m),
              }))}
            />
            <NumberSelect
              small
              label="Shortest booking"
              value={w.minDurationMinutes}
              options={durationOptions(w.minDurationMinutes)}
              onChange={(v) => onChange({ minDurationMinutes: v })}
            />
            <NumberSelect
              small
              label="Longest booking"
              value={w.maxDurationMinutes}
              options={durationOptions(w.maxDurationMinutes)}
              onChange={(v) => onChange({ maxDurationMinutes: v })}
            />
            <NumberSelect
              small
              label="Back-to-back limit"
              value={w.maxConsecutiveSlots}
              onChange={(v) => onChange({ maxConsecutiveSlots: v })}
              options={withCurrent<number | null>(
                [null, 1, 2, 3, 4, 6, 8],
                w.maxConsecutiveSlots,
              ).map((n) => ({
                value: n,
                label:
                  n === null ? "No limit" : `${n} slot${n === 1 ? "" : "s"}`,
              }))}
            />
          </>
        )}
      </div>
    </article>
  );
}

/** Archive or restore, below the form: rare, and not part of "Save changes". */
export function ArchiveControl({
  instrumentId,
  isActive,
  upcoming,
  action,
}: {
  instrumentId: string;
  isActive: boolean;
  upcoming: number;
  action: (formData: FormData) => Promise<void>;
}) {
  const [asking, setAsking] = useState(false);

  return (
    <section
      aria-labelledby="archive-h"
      className="rounded-2xl border border-line bg-surface p-5 sm:p-6"
    >
      <h2 id="archive-h" className="text-lg font-bold">
        {isActive ? "Archive instrument" : "Archived"}
      </h2>
      <p className="mt-1.5 max-w-[620px] text-[15px] leading-normal text-ink-2">
        {isActive
          ? "Takes it off the instrument list and stops new bookings. Its history stays for reports, and you can restore it any time."
          : "Not on the instrument list and not taking bookings. Restoring puts it back with these settings."}
        {isActive && upcoming > 0 && (
          <>
            {" "}
            {upcoming} upcoming booking{upcoming === 1 ? "" : "s"} will stay on
            the calendar until you cancel {upcoming === 1 ? "it" : "them"}.
          </>
        )}
      </p>
      <form
        action={action}
        className="mt-4 flex flex-wrap items-center gap-2.5"
      >
        <input type="hidden" name="instrumentId" value={instrumentId} />
        <input
          type="hidden"
          name="active"
          value={isActive ? "false" : "true"}
        />
        {!isActive ? (
          <button
            type="submit"
            className={buttonClass({ variant: "secondary" })}
          >
            Restore instrument
          </button>
        ) : asking ? (
          <>
            <span className="text-sm font-semibold">
              Archive this instrument?
            </span>
            <Button variant="secondary" onClick={() => setAsking(false)}>
              Keep it
            </Button>
            <button
              type="submit"
              className="min-h-11 rounded-[10px] bg-err px-4 text-sm font-bold text-bg"
            >
              Archive
            </button>
          </>
        ) : (
          <Button variant="secondary" onClick={() => setAsking(true)}>
            Archive instrument
          </Button>
        )}
      </form>
    </section>
  );
}
