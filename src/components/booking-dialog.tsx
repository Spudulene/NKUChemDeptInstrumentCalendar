"use client";

import { useActionState, useEffect, useRef, useState, type CSSProperties } from "react";
import {
  createBookingAction,
  type ActionState,
} from "@/app/(site)/instruments/[slug]/actions";
import type { BookableSlot } from "@/lib/booking/slots";
import { Button, Field, InstrumentTile, Notice, Segmented, fieldClass, textareaClass } from "@/components/ui";

export type AdvisorOption = { id: string; name: string };
export type DialogInstrument = { slug: string; name: string; location: string | null; color: string };

const initialState: ActionState = { error: null };

/**
 * Confirming a slot the student picked, from the "Book time" artboard — a centred
 * dialog on desktop, a bottom sheet on phones ("Phone · Book time").
 *
 * The lengths offered come from the server, so every choice is one the rules permit;
 * a student should never pick something and then be told no. Genuine conflicts still
 * happen (someone else booked first) and come back from the action as an error.
 */
export function BookingDialog({
  instrument,
  slot: initialSlot,
  starts = [],
  windowSummary,
  advisors,
  defaultAdvisorId,
  advisorRequired,
  timeZone,
  onClose,
}: {
  instrument: DialogInstrument;
  slot: BookableSlot;
  /** Other starts the student may switch to (the "Phone · Book time" sheet's Start). */
  starts?: BookableSlot[];
  windowSummary: string;
  advisors: AdvisorOption[];
  defaultAdvisorId: string | null;
  advisorRequired: boolean;
  /**
   * Campus timezone, passed down rather than read from the browser. A student booking
   * from home over break must see lab time, not their own.
   */
  timeZone: string;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(createBookingAction, initialState);
  const [slot, setSlot] = useState(initialSlot);
  // Controlled, because React resets uncontrolled fields after a submit — a booking
  // that fails (someone took the slot) shouldn't also lose the student's note.
  const [duration, setDuration] = useState(slot.durations[0]);
  const [advisorId, setAdvisorId] = useState(defaultAdvisorId ?? "");
  const [note, setNote] = useState("");
  const dialogRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (state.ok) onClose();
  }, [state.ok, onClose]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKey);
    dialogRef.current?.focus();
    return () => document.removeEventListener("keydown", onKey);
  }, [onClose]);

  // Formatting here is safe: the dialog only ever renders in the browser, after a click.
  const clock = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit" });
  const dayLabel = new Intl.DateTimeFormat("en-US", {
    timeZone,
    weekday: "long",
    month: "short",
    day: "numeric",
  }).format(slot.start);
  const end = new Date(slot.start.getTime() + duration * 60_000);
  const range = `${clock.format(slot.start)} – ${clock.format(end)}`;

  const pickStart = (iso: string) => {
    const next = starts.find((s) => s.start.toISOString() === iso);
    if (!next) return;
    setSlot(next);
    // Keep the chosen length if it still fits, else the longest that does.
    setDuration((d) =>
      next.durations.includes(d) ? d : (next.durations.filter((m) => m <= d).at(-1) ?? next.durations[0]),
    );
  };

  const lengthLabel = (minutes: number) => {
    const h = Math.floor(minutes / 60);
    const m = minutes % 60;
    return h === 0 ? `${m} min` : m === 0 ? `${h} h` : `${h} h ${m}`;
  };

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
        aria-labelledby="book-h"
        tabIndex={-1}
        className="max-h-[92dvh] w-full overflow-y-auto rounded-t-[22px] border border-line bg-surface text-ink shadow-[0_-12px_40px_rgba(0,0,0,.3)] outline-none sm:max-w-[600px] sm:rounded-[18px] sm:shadow-[0_24px_64px_rgba(0,0,0,.35)]"
      >
        {/* The sheet's grab handle, phones only. */}
        <div aria-hidden="true" className="mx-auto mt-2 h-[5px] w-10 rounded-full bg-line-2 sm:hidden" />

        <div className="flex items-start gap-3.5 px-5 pt-3 sm:px-6 sm:pt-[22px]">
          <span className="hidden sm:block">
            <InstrumentTile name={instrument.name} color={instrument.color} />
          </span>
          <div className="min-w-0 flex-1">
            <h2 id="book-h" className="text-[21px] font-extrabold tracking-[-0.015em] sm:text-[22px]">
              Book the {instrument.name}
            </h2>
            {instrument.location && <p className="mt-1 text-sm text-ink-2">{instrument.location}</p>}
          </div>
          <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mt-1.5 -mr-2 flex-none">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
              <path d="M6 6l12 12M18 6 6 18" />
            </svg>
          </Button>
        </div>

        <div
          style={{ "--inst": instrument.color } as CSSProperties}
          className="inst-soft mx-5 mt-4 flex items-start gap-2.5 rounded-xl px-3.5 py-3 text-sm leading-[1.45] sm:mx-6"
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true" className="inst-ink mt-px flex-none">
            <circle cx="12" cy="12" r="9" />
            <path d="M12 7v5l3 2" />
          </svg>
          <span>{windowSummary}</span>
        </div>

        <form action={formAction}>
          <input type="hidden" name="slug" value={instrument.slug} />
          <input type="hidden" name="start" value={slot.start.toISOString()} />
          <input type="hidden" name="duration" value={duration} />

          <div className="flex flex-col gap-4 px-5 pt-5 sm:px-6">
            <div className="flex flex-col gap-1.5">
              <span className="text-sm font-bold">When</span>
              <p className="rounded-[10px] border border-line bg-surface-2 px-3 py-2.5 text-base font-semibold tabular-nums">
                {dayLabel} · {range}
              </p>
            </div>

            {starts.length > 1 && (
              <Field label="Start">
                <select
                  value={slot.start.toISOString()}
                  onChange={(e) => pickStart(e.target.value)}
                  className={`${fieldClass} tabular-nums`}
                >
                  {starts.map((s) => (
                    <option key={s.start.getTime()} value={s.start.toISOString()}>
                      {clock.format(s.start)}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            {slot.durations.length > 1 ? (
              <Segmented
                legend="Length"
                options={slot.durations.map((m) => ({ value: m, label: lengthLabel(m) }))}
                value={duration}
                onChange={setDuration}
              />
            ) : (
              slot.wholeBlock && (
                <p className="text-sm text-ink-2">Booked as one whole block ({lengthLabel(duration)}).</p>
              )
            )}

            {advisors.length > 0 && (
              <Field
                label="Research group"
                required={advisorRequired}
                hint={advisorRequired ? "required on this instrument" : "optional"}
                help={
                  defaultAdvisorId
                    ? "Filled in from your profile. Change it if you're running samples for another group."
                    : undefined
                }
              >
                <select
                  name="advisorId"
                  value={advisorId}
                  onChange={(e) => setAdvisorId(e.target.value)}
                  className={fieldClass}
                >
                  <option value="">{advisorRequired ? "Select a research group…" : "Not for a group"}</option>
                  {advisors.map((advisor) => (
                    <option key={advisor.id} value={advisor.id}>
                      {advisor.name}
                    </option>
                  ))}
                </select>
              </Field>
            )}

            <Field label="Note" hint="optional · only you and the instrument manager see this">
              <textarea
                name="description"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={2}
                maxLength={120}
                placeholder="e.g. 13C on sample KR-14"
                className={textareaClass}
              />
            </Field>

            <div aria-live="polite">
              {state.error && (
                <Notice tone="err" alert title={`Can't book ${range}`}>
                  {state.error}
                </Notice>
              )}
            </div>
          </div>

          <div className="mt-5 flex flex-col-reverse gap-2.5 border-t border-line px-5 py-4 sm:flex-row sm:justify-end sm:px-6 sm:py-5">
            <Button variant="secondary" size="lg" onClick={onClose}>
              Cancel
            </Button>
            <Button type="submit" size="lg" disabled={pending}>
              {pending ? "Booking…" : "Confirm booking"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
