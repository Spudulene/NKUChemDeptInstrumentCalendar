"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createClassReservationAction,
  type ReserveState,
} from "@/app/(site)/classes/actions";
import {
  previewKey,
  type ClassPreviewResponse,
  type ClassPreviewRow,
} from "@/app/(site)/classes/types";
import { preemptionExplanation } from "@/lib/notice-copy";
import { Button, ButtonLink, Eyebrow, Field, Notice, fieldClass, textareaClass } from "@/components/ui";

type InstrumentOption = {
  id: string;
  name: string;
  slug: string;
  location: string | null;
};

/** Half-hour steps across the whole day — class time is not bound by booking windows. */
const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

const initialState: ReserveState = { error: null };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;


/**
 * The "Reserve for a class" screen from the design canvas.
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
  const [date, setDate] = useState(today);
  const [from, setFrom] = useState("13:00");
  const [to, setTo] = useState("17:00");
  const [title, setTitle] = useState("");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<ClassPreviewResponse | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(
    createClassReservationAction,
    initialState,
  );

  const key = previewKey({ instrumentId, date, from, to });
  const formKey = [key, title, reason].join("|");

  // Refetch when the time range changes, and after every submit: one that came back
  // "the list changed" needs the fresh list, and one that succeeded changed it.
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const query = new URLSearchParams({ instrumentId, date, from, to });
        const response = await fetch(`/api/class-preview?${query}`, {
          signal: controller.signal,
          cache: "no-store",
        });
        setPreview((await response.json()) as ClassPreviewResponse);
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
  }, [instrumentId, date, from, to, key, state]);

  // A preview for different inputs than the ones on screen is as good as none.
  const current = preview?.key === key ? preview : null;
  const result = current?.ok ? current : null;
  const unchangedSinceSubmit = submittedKey === formKey;
  const done = unchangedSinceSubmit ? state.done : undefined;
  const actionError = unchangedSinceSubmit ? state.error : null;

  const instrument = instruments.find((i) => i.id === instrumentId) ?? instruments[0];
  const endsNextDay = to <= from;
  const n = result?.targets.length ?? 0;
  const runningCount = result?.inProgress.length ?? 0;
  const heldCount = result?.blockedBy.length ?? 0;
  const blocked = runningCount + heldCount > 0;
  const soon = result?.targets.filter((r) => r.startsSoon) ?? [];

  const impactTitle = !current
    ? "Checking who is affected…"
    : !result
      ? "Can't check this time"
      : heldCount > 0
        ? "Another reservation already holds this time"
        : runningCount > 0
          ? `${plural(n + runningCount, "booking")} overlap — ${runningCount} ${runningCount === 1 ? "needs" : "need"} your attention`
          : n === 0
            ? "No student bookings are affected"
            : `${plural(n, "booking")} will be cancelled`;

  const footNote = heldCount
    ? "Pick a time that doesn't overlap another reservation."
    : runningCount
      ? "Resolve the in-progress booking to continue."
      : n
        ? "Each student is emailed within seconds, with times to rebook."
        : "Nothing will be cancelled.";

  const rangeLabel = `${from} – ${to}${endsNextDay ? " next day" : ""}`;
  const canSubmit = Boolean(result) && !blocked && !pending;

  return (
    <form
      action={formAction}
      onSubmit={() => setSubmittedKey(formKey)}
      className="mt-7 flex flex-wrap items-start gap-6"
    >
      <input
        type="hidden"
        name="confirmedTargetIds"
        value={result?.targets.map((t) => t.id).join(",") ?? ""}
      />

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
          </div>

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
          Class reservations never override each other. If another instructor already
          holds this time, you&apos;ll get an error instead.
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
                {result && <span className="text-[13px] text-ink-3">As of {result.asOf}</span>}
              </div>

              {current && !current.ok && (
                <p className="mt-3 text-sm text-ink-2">{current.error}</p>
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
                <p className="text-sm text-ink-2">{result ? footNote : " "}</p>
                <Button type="submit" size="lg" disabled={!canSubmit}>
                  {pending
                    ? "Reserving…"
                    : `Reserve ${rangeLabel}${n && !blocked ? ` & cancel ${plural(n, "booking")}` : ""}`}
                </Button>
              </div>
            </>
          )}
        </div>

        {result && n > 0 && !done && (
          <div className="rounded-2xl border border-line bg-surface-2 px-6 py-5">
            <Eyebrow>What affected students receive</Eyebrow>
            <p className="mt-2.5 text-base font-bold">
              Your {instrument.name} booking was cancelled
            </p>
            <p className="mt-2 text-sm leading-[1.55] text-ink-2">
              {preemptionExplanation({
                instrumentName: instrument.name,
                range: result.targets[0].range,
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
