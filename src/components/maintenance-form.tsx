"use client";

import { useActionState, useEffect, useState } from "react";
import {
  createMaintenanceAction,
  type MaintenanceState,
} from "@/app/(site)/admin/actions";
import {
  maintenanceKey,
  type MaintenancePreviewResponse,
} from "@/app/(site)/admin/maintenance/types";
import { preemptionExplanation } from "@/lib/notice-copy";
import { ImpactRow } from "@/components/impact-row";
import {
  Button,
  ButtonLink,
  Eyebrow,
  Field,
  Notice,
  fieldClass,
  textareaClass,
} from "@/components/ui";

type InstrumentOption = { id: string; name: string; location: string | null };

/** Half-hour steps across the whole day — maintenance is not bound by booking windows. */
const TIMES = Array.from(
  { length: 48 },
  (_, i) => `${String(Math.floor(i / 2)).padStart(2, "0")}:${i % 2 ? "30" : "00"}`,
);

const initialState: MaintenanceState = { error: null };

const plural = (n: number, word: string) => `${n} ${word}${n === 1 ? "" : "s"}`;

/**
 * Schedule a maintenance block: the class reservation form's one-off mode, with an
 * end date (service visits run for days) and no class name. Maintenance outranks
 * classes too, so their meetings can be among the bookings it cancels.
 *
 * Every field is controlled, as on the class form, so a "the list changed" refusal
 * doesn't wipe the reason.
 */
export function MaintenanceForm({
  instruments,
  initialInstrumentId,
  today,
  tomorrow,
  scheduledBy,
}: {
  instruments: InstrumentOption[];
  initialInstrumentId: string;
  /** Campus-local YYYY-MM-DD, from the server so it is lab time, not browser time. */
  today: string;
  tomorrow: string;
  scheduledBy: string;
}) {
  const [instrumentId, setInstrumentId] = useState(initialInstrumentId);
  const [startDate, setStartDate] = useState(tomorrow);
  const [startTime, setStartTime] = useState("08:00");
  const [endDate, setEndDate] = useState(tomorrow);
  const [endTime, setEndTime] = useState("12:00");
  const [reason, setReason] = useState("");
  const [preview, setPreview] = useState<MaintenancePreviewResponse | null>(null);
  const [submittedKey, setSubmittedKey] = useState<string | null>(null);
  const [state, formAction, pending] = useActionState(createMaintenanceAction, initialState);

  const fields = { instrumentId, startDate, startTime, endDate, endTime };
  const key = maintenanceKey(fields);
  const previewUrl = `/api/maintenance-preview?${new URLSearchParams(fields)}`;
  const formKey = [key, reason].join("|");

  // Refetch when the time changes, and after every submit (see ReserveForm).
  useEffect(() => {
    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const response = await fetch(previewUrl, { signal: controller.signal, cache: "no-store" });
        setPreview((await response.json()) as MaintenancePreviewResponse);
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

  const current = preview?.key === key ? preview : null;
  const result = current?.ok ? current : null;
  const unchangedSinceSubmit = submittedKey === formKey;
  const done = unchangedSinceSubmit ? state.done : undefined;
  const actionError = unchangedSinceSubmit ? state.error : null;

  const instrument = instruments.find((i) => i.id === instrumentId) ?? instruments[0];
  const targets = result?.targets ?? [];
  const n = targets.length;
  const runningCount = result?.inProgress.length ?? 0;
  const heldCount = result?.blockedBy.length ?? 0;
  const blocked = runningCount + heldCount > 0;
  const soon = targets.filter((r) => r.startsSoon);

  const impactTitle = !current
    ? "Checking who is affected…"
    : !current.ok
      ? "Can't check this time"
      : heldCount > 0
        ? "Maintenance is already scheduled in this time"
        : runningCount > 0
          ? `${plural(n + runningCount, "booking")} overlap — ${runningCount} ${runningCount === 1 ? "needs" : "need"} your attention`
          : n === 0
            ? "No bookings are affected"
            : `${plural(n, "booking")} will be cancelled`;

  const footNote = heldCount
    ? "Cancel the existing block below, or pick another time."
    : runningCount
      ? "Resolve the in-progress booking to continue."
      : n
        ? "Each person is emailed within seconds, with times to rebook."
        : "Nothing will be cancelled.";

  const canSubmit = Boolean(result) && !blocked && !pending;
  const submitLabel = pending
    ? "Scheduling…"
    : `Schedule maintenance${n && !blocked ? ` & cancel ${plural(n, "booking")}` : ""}`;

  const timeSelect = (label: string, name: string, value: string, set: (v: string) => void) => (
    <Field label={label}>
      <select
        name={name}
        value={value}
        onChange={(e) => set(e.target.value)}
        className={`${fieldClass} px-2.5 tabular-nums`}
      >
        {TIMES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </select>
    </Field>
  );

  return (
    <form
      action={formAction}
      onSubmit={() => setSubmittedKey(formKey)}
      className="flex flex-wrap items-start gap-6"
    >
      <input type="hidden" name="confirmedTargetIds" value={targets.map((t) => t.id).join(",")} />

      <section
        aria-labelledby="details-h"
        className="box-border min-w-0 flex-[1_1_340px] rounded-2xl border border-line bg-surface p-6"
      >
        <h2 id="details-h" className="text-lg font-bold">
          Schedule maintenance
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

          <div className="grid grid-cols-[3fr_2fr] gap-3">
            <Field label="Starts">
              <input
                type="date"
                name="startDate"
                required
                min={today}
                value={startDate}
                onChange={(e) => {
                  setStartDate(e.target.value);
                  if (e.target.value > endDate) setEndDate(e.target.value);
                }}
                className={`${fieldClass} px-2.5`}
              />
            </Field>
            {timeSelect("At", "startTime", startTime, setStartTime)}
          </div>
          <div className="grid grid-cols-[3fr_2fr] gap-3">
            <Field label="Ends">
              <input
                type="date"
                name="endDate"
                required
                min={startDate}
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                className={`${fieldClass} px-2.5`}
              />
            </Field>
            {timeSelect("At", "endTime", endTime, setEndTime)}
          </div>

          <Field label="Reason" hint="shown to anyone whose booking is cancelled">
            <textarea
              name="reason"
              required
              rows={3}
              maxLength={300}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Annual service visit — the magnet is being re-shimmed."
              className={textareaClass}
            />
          </Field>
        </div>
        <p className="mt-[18px] text-[13px] leading-normal text-ink-3">
          Maintenance takes priority over student bookings and classes. It never overrides
          other maintenance.
        </p>
      </section>

      <section aria-labelledby="impact-h" className="flex min-w-0 flex-[1.4_1_420px] flex-col gap-4">
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

              {current && !current.ok && <p className="mt-3 text-sm text-ink-2">{current.error}</p>}

              {result && (
                <ul className="mt-4 flex max-h-[560px] flex-col gap-2.5 overflow-y-auto">
                  {result.blockedBy.map((r) => (
                    <ImpactRow key={r.id} row={r} tone="err" badge="Maintenance — can't override">
                      Maintenance blocks never override each other. Cancel the existing one
                      below, or pick another time.
                    </ImpactRow>
                  ))}
                  {result.inProgress.map((r) => (
                    <ImpactRow key={r.id} row={r} tone="err" badge="In progress — can't cancel">
                      This booking is in progress, so it can&apos;t be cancelled from here —
                      there may be samples in the instrument. Talk to {r.name}, or start the
                      maintenance after it ends.
                    </ImpactRow>
                  ))}
                  {result.targets.map((r) => (
                    <ImpactRow
                      key={r.id}
                      row={r}
                      tone="warn"
                      badge={`${r.type === "CLASS" ? "Class · " : ""}Cancel & email${r.startsIn ? ` · starts in ${r.startsIn}` : ""}`}
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
            <Eyebrow>What affected people receive</Eyebrow>
            <p className="mt-2.5 text-base font-bold">Your {instrument.name} booking was cancelled</p>
            <p className="mt-2 text-sm leading-[1.55] text-ink-2">
              {preemptionExplanation({
                instrumentName: instrument.name,
                range: targets[0].range,
                type: "MAINTENANCE",
                title: null,
                reservedBy: scheduledBy,
              })}
            </p>
            {reason && (
              <p className="mt-2 text-sm leading-[1.55] text-ink-2">
                <span className="font-bold text-ink">Reason:</span> {reason}
              </p>
            )}
            <p className="mt-2.5 text-sm text-ink-2">
              Followed by the next three open times of the same length, picked for each person.
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
