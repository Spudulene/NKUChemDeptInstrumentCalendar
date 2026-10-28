"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createClassReservationAction,
  type ReserveState,
} from "@/app/(site)/classes/actions";
import {
  previewKey,
  seriesKey,
  type ClassPreviewResponse,
  type ClassPreviewRow,
  type SeriesPreviewDate,
  type SeriesPreviewResponse,
} from "@/app/(site)/classes/types";
import { preemptionExplanation } from "@/lib/notice-copy";
import {
  Button,
  ButtonLink,
  Eyebrow,
  Field,
  Notice,
  Segmented,
  fieldClass,
  textareaClass,
} from "@/components/ui";

type InstrumentOption = {
  id: string;
  name: string;
  slug: string;
  location: string | null;
};

type Repeat = "once" | "weekly";

/** Half-hour steps across the whole day — class time is not bound by booking windows. */
const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

/** Monday first: how a teaching week reads. Values match the Weekday enum. */
const WEEK = [
  { value: "MON", label: "Mon" },
  { value: "TUE", label: "Tue" },
  { value: "WED", label: "Wed" },
  { value: "THU", label: "Thu" },
  { value: "FRI", label: "Fri" },
  { value: "SAT", label: "Sat" },
  { value: "SUN", label: "Sun" },
] as const;

const BY_UTC_DAY = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/** Calendar arithmetic on YYYY-MM-DD in UTC, which has no DST to trip over. */
function isoParts(iso: string) {
  const [y, m, d] = iso.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}
const weekdayOf = (iso: string) => BY_UTC_DAY[new Date(isoParts(iso)).getUTCDay()];
const addDays = (iso: string, days: number) =>
  new Date(isoParts(iso) + days * 86_400_000).toISOString().slice(0, 10);

/** About a semester: what a weekly reservation usually covers. */
const DEFAULT_WEEKS = 15;

const initialState: ReserveState = { error: null };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

const isBlocked = (d: SeriesPreviewDate) => d.blockedBy.length + d.inProgress.length > 0;

/**
 * The "Reserve for a class" screen from the design canvas, plus a weekly mode for
 * classes that meet all term: the same preview, one row per date, and dates the
 * instructor can untick (holidays) or that another class already holds.
 *
 * Every field is controlled: React resets uncontrolled inputs after a form action,
 * and an instructor whose confirm comes back "the list changed" should not have to
 * retype the class and reason.
 */
export function ReserveForm({
  instruments,
  initialInstrumentId,
  today,
  reservedBy,
}: {
  instruments: InstrumentOption[];
  initialInstrumentId: string;
  /** Campus-local YYYY-MM-DD, from the server so it is lab time, not browser time. */
  today: string;
  reservedBy: string;
}) {
  const [instrumentId, setInstrumentId] = useState(initialInstrumentId);
  const [repeat, setRepeat] = useState<Repeat>("once");
  const [date, setDate] = useState(today);
  const [until, setUntil] = useState(() => addDays(today, DEFAULT_WEEKS * 7 - 1));
  const [days, setDays] = useState<string[]>(() => [weekdayOf(today)]);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [from, setFrom] = useState("13:00");
  const [to, setTo] = useState("17:00");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ClassPreviewResponse | SeriesPreviewResponse | null>(
    null,
  );
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    createClassReservationAction,
    initialState,
  );

  const weekly = repeat === "weekly";
  const daysParam = WEEK.filter((d) => days.includes(d.value))
    .map((d) => d.value)
    .join(",");
  const key = weekly
    ? seriesKey({ instrumentId, first: date, until, days: daysParam, from, to })
    : previewKey({ instrumentId, date, from, to });
  const previewUrl = weekly
    ? `/api/class-series-preview?${new URLSearchParams({ instrumentId, first: date, until, days: daysParam, from, to })}`
    : `/api/class-preview?${new URLSearchParams({ instrumentId, date, from, to })}`;
  const formKey = [key, title, reason, weekly ? skipped.join(",") : ""].join("|");

  // Refetch when the time range changes, and after every submit: one that came back
  // "the list changed" needs the fresh list, and one that succeeded changed it.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(previewUrl, {
          signal: controller.signal,
          cache: "no-store",
        });
        setPreview((await response.json()) as ClassPreviewResponse | SeriesPreviewResponse);
      } catch {
        if (!controller.signal.aborted) {
          setPreview({ ok: false, key, error: "Couldn't check who is affected. Try again." });
        }
      }
    }, 250);

    return () => {
      controller.abort();
      clearTimeout(timer);
    };
  }, [previewUrl, key, state]);

  // A preview for different inputs than the ones on screen is as good as none.
  const current = preview?.key === key ? preview : null;
  const result = current?.ok && "targets" in current ? current : null;
  const series = current?.ok && "dates" in current ? current : null;
  const unchangedSinceSubmit = submittedKey === formKey;
  const done = unchangedSinceSubmit ? state.done : undefined;
  const actionError = unchangedSinceSubmit ? state.error : null;

  const kept = series?.dates.filter((d) => !isBlocked(d) && !skipped.includes(d.date)) ?? [];
  const heldDates = series?.dates.filter(isBlocked).length ?? 0;
  const targets = weekly ? kept.flatMap((d) => d.targets) : (result?.targets ?? []);

  const instrument = instruments.find((i) => i.id === instrumentId) ?? instruments[0];
  const endsNextDay = to <= from;
  const n = targets.length;
  const runningCount = result?.inProgress.length ?? 0;
  const heldCount = result?.blockedBy.length ?? 0;
  const blocked = weekly ? kept.length === 0 : runningCount + heldCount > 0;
  const soon = targets.filter((r) => r.startsSoon);

  const impactTitle = !current
    ? "Checking who is affected…"
    : !current.ok
      ? "Can't check this time"
      : weekly
        ? n === 0
          ? `${plural(kept.length, "date")} · no student bookings affected`
          : `${plural(kept.length, "date")} · ${plural(n, "booking")} will be cancelled`
        : heldCount > 0
          ? "Another reservation already holds this time"
          : runningCount > 0
            ? `${plural(n + runningCount, "booking")} overlap — ${runningCount} ${runningCount === 1 ? "needs" : "need"} your attention`
            : n === 0
              ? "No student bookings are affected"
              : `${plural(n, "booking")} will be cancelled`;

  const footNote = weekly
    ? kept.length === 0
      ? "Keep at least one date."
      : n
        ? "Each student is emailed within seconds, with times to rebook."
        : "Nothing will be cancelled."
    : heldCount
      ? "Pick a time that doesn't overlap another reservation."
      : runningCount
        ? "Resolve the in-progress booking to continue."
        : n
          ? "Each student is emailed within seconds, with times to rebook."
          : "Nothing will be cancelled.";

  const rangeLabel = `${from} – ${to}${endsNextDay ? " next day" : ""}`;
  const canSubmit = Boolean(weekly ? series : result) && !blocked && !pending;
  const submitLabel = pending
    ? "Reserving…"
    : weekly
      ? !series
        ? "Reserve dates"
        : `Reserve ${plural(kept.length, "date")}${n ? ` & cancel ${plural(n, "booking")}` : ""}`
      : `Reserve ${rangeLabel}${n && !blocked ? ` & cancel ${plural(n, "booking")}` : ""}`;

  const toggleDay = (value: string) =>
    setDays((current) =>
      current.includes(value) ? current.filter((d) => d !== value) : [...current, value],
    );
  const toggleSkip = (iso: string) =>
    setSkipped((current) =>
      current.includes(iso) ? current.filter((d) => d !== iso) : [...current, iso],
    );

  const timeFields = (
    <>
      <Field label="From">
        <select
          name="from"
          value={from}
          onChange={(e) => setFrom(e.target.value)}
          className={`${fieldClass} px-2.5 tabular-nums`}
        >
          {TIMES.map((t) => (
            <option key={t} value={t}>
              {t}
            </option>
          ))}
        </select>
      </Field>
      <Field label="To">
        <select
          name="to"
          value={to}
          onChange={(e) => setTo(e.target.value)}
          className={`${fieldClass} px-2.5 tabular-nums`}
        >
          {TIMES.map((t) => (
            <option key={t} value={t}>
              {t <= from ? `${t} (next day)` : t}
            </option>
          ))}
        </select>
      </Field>
    </>
  );

  return (
    <form
      action={formAction}
      onSubmit={() => setSubmittedKey(formKey)}
      className="mt-7 flex flex-wrap items-start gap-6"
    >
      <input type="hidden" name="repeat" value={repeat} />
      <input type="hidden" name="confirmedTargetIds" value={targets.map((t) => t.id).join(",")} />
      {weekly && (
        <>
          <input type="hidden" name="days" value={daysParam} />
          <input type="hidden" name="dates" value={kept.map((d) => d.date).join(",")} />
        </>
      )}

      <section
        aria-labelledby="details-h"
        className="box-border min-w-0 flex-[1_1_380px] rounded-2xl border border-line bg-surface p-6"
      >
        <h2 id="details-h" className="text-lg font-bold">
          Reservation
        </h2>
        <div className="mt-[18px] flex flex-col gap-4">
          <Field label="Instrument">
            <select
              name="instrumentId"
              value={instrumentId}
              onChange={(e) => setInstrumentId(e.target.value)}
              className={fieldClass}
            >
              {instruments.map((i) => (
                <option key={i.id} value={i.id}>
                  {i.name}
                  {i.location ? ` — ${i.location}` : ""}
                </option>
              ))}
            </select>
          </Field>

          <Field label="Class">
            <input
              type="text"
              name="title"
              required
              maxLength={80}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. CHE 310 — Instrumental Analysis"
              className={fieldClass}
            />
          </Field>

          <Segmented
            legend="Repeats"
            options={[
              { value: "once" as Repeat, label: "Once" },
              { value: "weekly" as Repeat, label: "Every week" },
            ]}
            value={repeat}
            columns={2}
            onChange={setRepeat}
          />

          {weekly ? (
            <>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="First date">
                  <input
                    type="date"
                    name="date"
                    required
                    min={today}
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className={`${fieldClass} px-2.5`}
                  />
                </Field>
                <Field label="Last date">
                  <input
                    type="date"
                    name="until"
                    required
                    min={date}
                    value={until}
                    onChange={(e) => setUntil(e.target.value)}
                    className={`${fieldClass} px-2.5`}
                  />
                </Field>
              </div>

              <fieldset className="m-0 border-0 p-0">
                <legend className="p-0 text-sm font-bold text-ink">Meets on</legend>
                <div className="mt-1.5 grid grid-cols-7 gap-1.5">
                  {WEEK.map((d) => {
                    const on = days.includes(d.value);
                    return (
                      <button
                        key={d.value}
                        type="button"
                        aria-pressed={on}
                        onClick={() => toggleDay(d.value)}
                        className={`min-h-11 rounded-[10px] border text-sm font-bold ${
                          on
                            ? "border-ink bg-ink text-bg"
                            : "border-line-2 bg-surface text-ink hover:bg-surface-2"
                        }`}
                      >
                        {d.label}
                      </button>
                    );
                  })}
                </div>
              </fieldset>

              <div className="grid grid-cols-2 gap-3">{timeFields}</div>
            </>
          ) : (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field label="Date">
                <input
                  type="date"
                  name="date"
                  required
                  min={today}
                  value={date}
                  onChange={(e) => setDate(e.target.value)}
                  className={`${fieldClass} px-2.5`}
                />
              </Field>
              {timeFields}
            </div>
          )}

          <Field label="Reason" hint="shown to affected students">
            <textarea
              name="reason"
              required
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Lab 6 — students run their unknowns on the NMR."
              className={textareaClass}
            />
          </Field>
        </div>
        <p className="mt-[18px] text-[13px] leading-normal text-ink-3">
          {weekly
            ? "Each date is its own reservation. Dates another class already holds are skipped, and you can untick holidays."
            : "Class reservations never override each other. If another instructor already holds this time, you'll get an error instead."}
        </p>
      </section>

      <section
        aria-labelledby="impact-h"
        className="flex min-w-0 flex-[1.4_1_460px] flex-col gap-4"
      >
        <div className="rounded-2xl border border-line bg-surface p-6" aria-live="polite">
          {done ? (
            <Notice tone="ok" title={<span id="impact-h">{done.message}</span>}>
              <ButtonLink href={done.calendarHref} className="mt-1">
                View on the calendar
              </ButtonLink>
            </Notice>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <h2 id="impact-h" className="text-lg font-bold">
                  {impactTitle}
                </h2>
                {current?.ok && <span className="text-[13px] text-ink-3">As of {current.asOf}</span>}
              </div>

              {current && !current.ok && (
                <p className="mt-3 text-sm text-ink-2">{current.error}</p>
              )}

              {series && heldDates > 0 && (
                <p className="mt-1 text-sm text-ink-2">
                  {plural(heldDates, "date")} can&apos;t be reserved and will be skipped.
                </p>
              )}

              {series && (
                <ul className="mt-4 max-h-[520px] divide-y divide-line overflow-y-auto rounded-xl border border-line">
                  {series.dates.map((d) => (
                    <MeetingRow
                      key={d.date}
                      meeting={d}
                      time={rangeLabel}
                      skipped={skipped.includes(d.date)}
                      onToggle={() => toggleSkip(d.date)}
                    />
                  ))}
                </ul>
              )}

              {result && (
                <ul className="mt-4 flex flex-col gap-2.5">
                  {result.blockedBy.map((r) => (
                    <ImpactRow
                      key={r.id}
                      row={r}
                      tone="err"
                      badge={`${r.type === "MAINTENANCE" ? "Maintenance" : "Class"} — can't override`}
                    >
                      Class reservations never override each other. Talk to {r.name}, or
                      pick another time.
                    </ImpactRow>
                  ))}
                  {result.inProgress.map((r) => (
                    <ImpactRow key={r.id} row={r} tone="err" badge="In progress — can't cancel">
                      This booking is in progress, so it can&apos;t be cancelled from here —
                      there may be samples in the instrument. Talk to {r.name}, or start your
                      reservation after it ends.
                      {r.resumeFrom && (
                        <Button variant="secondary" onClick={() => setFrom(r.resumeFrom!)} className="mt-2.5">
                          Start at {r.resumeFrom} instead
                        </Button>
                      )}
                    </ImpactRow>
                  ))}
                  {result.targets.map((r) => (
                    <ImpactRow
                      key={r.id}
                      row={r}
                      tone="warn"
                      badge={`Cancel & email${r.startsIn ? ` · starts in ${r.startsIn}` : ""}`}
                    />
                  ))}
                </ul>
              )}

              {soon.length > 0 && (
                <Notice
                  tone="warn"
                  className="mt-4"
                  title={
                    soon.length === 1
                      ? "1 booking starts within 12 hours"
                      : `${soon.length} bookings start within 12 hours`
                  }
                >
                  An email may not reach them in time. Please contact{" "}
                  {soon.map((r) => r.name).join(" and ")} directly as well.
                </Notice>
              )}

              {actionError && (
                <Notice tone="err" alert className="mt-4">
                  {actionError}
                </Notice>
              )}

              <div className="mt-5 flex flex-wrap items-center justify-between gap-3">
                <p className="text-sm text-ink-2">{current?.ok ? footNote : " "}</p>
                <Button type="submit" size="lg" disabled={!canSubmit}>
                  {submitLabel}
                </Button>
              </div>
            </>
          )}
        </div>

        {n > 0 && !done && (
          <div className="rounded-2xl border border-line bg-surface-2 px-6 py-5">
            <Eyebrow>What affected students receive</Eyebrow>
            <p className="mt-2.5 text-base font-bold">
              Your {instrument.name} booking was cancelled
            </p>
            <p className="mt-2 text-sm leading-[1.55] text-ink-2">
              {preemptionExplanation({
                instrumentName: instrument.name,
                range: targets[0].range,
                type: "CLASS",
                title: title || null,
                reservedBy,
              })}
            </p>
            {reason && (
              <p className="mt-2 text-sm leading-[1.55] text-ink-2">
                <span className="font-bold text-ink">Reason:</span> {reason}
              </p>
            )}
            <p className="mt-2.5 text-sm text-ink-2">
              Followed by the next three open times of the same length, picked for each
              student.
            </p>
            <span className="mt-3.5 inline-flex min-h-10 items-center rounded-[10px] bg-gold px-4 text-sm font-bold text-on-gold">
              Rebook on the calendar
            </span>
          </div>
        )}
      </section>
    </form>
  );
}

/**
 * One date of a weekly series: kept or skipped, and who it affects. A date another
 * class holds (or someone is mid-run on) can't be kept, so its box is off and locked.
 */
function MeetingRow({
  meeting: d,
  time,
  skipped,
  onToggle,
}: {
  meeting: SeriesPreviewDate;
  time: string;
  skipped: boolean;
  onToggle: () => void;
}) {
  const locked = isBlocked(d);
  const kept = !locked && !skipped;
  const id = `meeting-${d.date}`;

  const badge = locked
    ? { text: d.blockedBy.length ? "Already reserved" : "In progress", tone: "bg-err-soft text-err" }
    : skipped
      ? { text: "Skipped", tone: "bg-surface-2 text-ink-3" }
      : d.targets.length
        ? { text: `Cancel ${plural(d.targets.length, "booking")}`, tone: "bg-warn-soft text-warn" }
        : { text: "Clear", tone: "bg-ok-soft text-ok" };

  return (
    <li className="flex flex-wrap items-start gap-x-3 gap-y-1.5 px-4 py-3">
      <input
        id={id}
        type="checkbox"
        checked={kept}
        disabled={locked}
        onChange={onToggle}
        className="mt-0.5 size-5 flex-none accent-ink"
      />
      <label htmlFor={id} className={`min-w-0 flex-[1_1_160px] ${kept ? "" : "text-ink-3"}`}>
        <span className="text-[15px] font-bold">{d.label}</span>{" "}
        <span className="text-sm whitespace-nowrap tabular-nums">{time}</span>
        {kept &&
          d.targets.map((r) => (
            <span key={r.id} className="mt-1 block text-sm text-ink-2 tabular-nums">
              {r.name} · {r.time}
              {r.group && ` · ${r.group}`}
            </span>
          ))}
        {d.blockedBy.map((r) => (
          <span key={r.id} className="mt-1 block text-sm text-ink-2 tabular-nums">
            {r.type === "MAINTENANCE" ? "Maintenance" : "Class"} by {r.name} · {r.time}
          </span>
        ))}
        {d.inProgress.map((r) => (
          <span key={r.id} className="mt-1 block text-sm text-ink-2 tabular-nums">
            {r.name} is using it · {r.time}
          </span>
        ))}
      </label>
      <span className={`ml-8 flex-none rounded-full px-2.5 py-1 text-[13px] font-bold sm:ml-0 ${badge.tone}`}>
        {badge.text}
      </span>
    </li>
  );
}

function ImpactRow({
  row,
  tone,
  badge,
  children,
}: {
  row: ClassPreviewRow;
  tone: "warn" | "err";
  badge: string;
  children?: React.ReactNode;
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
