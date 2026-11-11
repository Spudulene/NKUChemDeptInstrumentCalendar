"use client";

import Link from "next/link";
import { useActionState, useState, type CSSProperties } from "react";
import { requestSwapAction, type SwapState } from "@/app/(site)/swap/actions";
import type { AskTarget } from "@/lib/schedule-view";
import type { AdvisorOption, DialogInstrument } from "@/components/booking-dialog";
import { SheetDialog } from "@/components/sheet-dialog";
import { Button, Field, InstrumentTile, Notice, buttonClass, fieldClass, textareaClass } from "@/components/ui";

const initialState: SwapState = { error: null };

/**
 * "Ask for this time": a student asks another student to give up a booking. Composed
 * from the booking dialog's pieces (no artboard). The holder gets an email and can
 * answer from it or from My bookings; if they give it up, the time becomes the
 * requester's booking, under the requester's own weekly limits.
 */
export function AskDialog({
  target,
  instrument,
  advisors,
  defaultAdvisorId,
  advisorRequired,
  onClose,
}: {
  target: AskTarget;
  instrument: DialogInstrument;
  advisors: AdvisorOption[];
  defaultAdvisorId: string | null;
  advisorRequired: boolean;
  onClose: () => void;
}) {
  const [state, formAction, pending] = useActionState(requestSwapAction, initialState);
  // Controlled, so a refusal (over a limit, already asked) keeps the note.
  const [advisorId, setAdvisorId] = useState(defaultAdvisorId ?? "");
  const [note, setNote] = useState("");
  const first = target.holder.split(" ")[0];

  return (
    <SheetDialog labelledBy="ask-h" onClose={onClose}>
      <div className="flex items-start gap-3.5 px-5 pt-3 sm:px-6 sm:pt-[22px]">
        <span className="hidden sm:block">
          <InstrumentTile name={instrument.name} color={instrument.color} />
        </span>
        <div className="min-w-0 flex-1">
          <h2 id="ask-h" className="text-[21px] font-extrabold tracking-[-0.015em] sm:text-[22px]">
            Ask for this time
          </h2>
          <p className="mt-1 text-sm text-ink-2">{instrument.name}</p>
        </div>
        <Button variant="ghost" size="icon" onClick={onClose} aria-label="Close" className="-mt-1.5 -mr-2 flex-none">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" aria-hidden="true">
            <path d="M6 6l12 12M18 6 6 18" />
          </svg>
        </Button>
      </div>

      <div
        style={{ "--inst": instrument.color } as CSSProperties}
        className="inst-soft mx-5 mt-4 rounded-xl px-3.5 py-3 text-sm leading-[1.45] sm:mx-6"
      >
        <span className="font-bold">{target.holder}</span> has {target.when}.
      </div>

      {state.done === "asked" ? (
        <div className="px-5 pt-5 pb-5 sm:px-6 sm:pb-6">
          <Notice tone="ok" title={`Request sent to ${first}`}>
            We&apos;ve emailed {first}. You&apos;ll hear back by email either way, and you can
            follow or withdraw it in My bookings.
          </Notice>
          <div className="mt-5 flex flex-col-reverse gap-2.5 sm:flex-row sm:justify-end">
            <Link href="/my-bookings" className={buttonClass({ variant: "secondary", size: "lg" })}>
              My bookings
            </Link>
            <Button size="lg" onClick={onClose}>
              Done
            </Button>
          </div>
        </div>
      ) : (
        <form action={formAction}>
          <input type="hidden" name="bookingId" value={target.bookingId} />

          <div className="flex flex-col gap-4 px-5 pt-5 sm:px-6">
            <p className="text-[15px] leading-normal text-ink-2">
              {first} gets an email and can give it to you straight from it. If they do, it
              becomes your booking. Your weekly limits still apply, and the request ends when
              their booking starts.
            </p>

            {advisors.length > 0 && (
              <Field
                label="Research group"
                required={advisorRequired}
                hint={advisorRequired ? "required on this instrument" : "optional"}
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

            <Field
              label={`Note to ${first}`}
              hint="optional · why it's urgent helps"
              help="Don't include sensitive or personal information."
            >
              <textarea
                name="note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                rows={3}
                maxLength={200}
                placeholder="e.g. My samples won't keep past Thursday — could I have this slot?"
                className={textareaClass}
              />
            </Field>

            <div aria-live="polite">
              {state.error && (
                <Notice tone="err" alert title="Can't send this request">
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
              {pending ? "Sending…" : `Ask ${first}`}
            </Button>
          </div>
        </form>
      )}
    </SheetDialog>
  );
}
