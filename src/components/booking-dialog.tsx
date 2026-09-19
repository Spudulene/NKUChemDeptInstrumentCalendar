"use client";

import { useActionState, useEffect, useRef } from "react";
import {
  createBookingAction,
  type ActionState,
} from "@/app/instruments/[slug]/actions";
import type { BookableSlot } from "@/lib/booking/slots";

export type AdvisorOption = { id: string; name: string };

const initialState: ActionState = { error: null };

/**
 * Confirmation step for a slot the student clicked on the calendar.
 *
 * The durations offered come from the server, so the choices are ones the rules
 * actually permit — a student should never be able to pick something and then be told
 * no. Genuine conflicts still happen (someone else booked it first), and those come
 * back through the action as an error rather than being predicted here.
 */
export function BookingDialog({
  slug,
  slot,
  advisors,
  defaultAdvisorId,
  advisorRequired,
  timeZone,
  onClose,
}: {
  slug: string;
  slot: BookableSlot;
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
  const [state, formAction, pending] = useActionState(
    createBookingAction,
    initialState,
  );
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

  const startISO = slot.start.toISOString();

  const clock = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hour: "numeric",
    minute: "2-digit",
  });

  const rangeLabel = (durationMinutes: number) => {
    const end = new Date(slot.start.getTime() + durationMinutes * 60_000);
    const hours = Math.floor(durationMinutes / 60);
    const minutes = durationMinutes % 60;
    const length =
      hours === 0
        ? `${minutes} min`
        : minutes === 0
          ? `${hours} hr`
          : `${hours} hr ${minutes} min`;

    return `${clock.format(slot.start)} - ${clock.format(end)} (${length})`;
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-stone-900/40 p-4"
      onClick={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-label="Confirm booking"
        tabIndex={-1}
        className="w-full max-w-sm rounded-xl border border-stone-200 bg-white p-6 shadow-lg outline-none"
      >
        <h2 className="text-lg font-semibold tracking-tight">Book this time</h2>
        <p className="mt-1 text-sm text-stone-500">
          {slot.windowName}
          {slot.wholeBlock && " · booked as one full block"}
        </p>

        <form action={formAction} className="mt-5 space-y-4">
          <input type="hidden" name="slug" value={slug} />
          <input type="hidden" name="start" value={startISO} />

          <div className="space-y-1.5">
            <label htmlFor="duration" className="block text-sm font-medium">
              Length
            </label>
            {slot.durations.length === 1 ? (
              <>
                <input type="hidden" name="duration" value={slot.durations[0]} />
                <p className="rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm text-stone-700">
                  {rangeLabel(slot.durations[0])}
                </p>
              </>
            ) : (
              <select
                id="duration"
                name="duration"
                defaultValue={slot.durations[0]}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
              >
                {slot.durations.map((minutes) => (
                  <option key={minutes} value={minutes}>
                    {rangeLabel(minutes)}
                  </option>
                ))}
              </select>
            )}
          </div>

          {advisors.length > 0 && (
            <div className="space-y-1.5">
              <label htmlFor="advisorId" className="block text-sm font-medium">
                Research group
                {!advisorRequired && (
                  <span className="font-normal text-stone-400"> (optional)</span>
                )}
              </label>
              <select
                id="advisorId"
                name="advisorId"
                defaultValue={defaultAdvisorId ?? ""}
                className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
              >
                <option value="">
                  {advisorRequired ? "Select a research group..." : "Not for a group"}
                </option>
                {advisors.map((advisor) => (
                  <option key={advisor.id} value={advisor.id}>
                    {advisor.name}
                  </option>
                ))}
              </select>
            </div>
          )}

          <div className="space-y-1.5">
            <label htmlFor="description" className="block text-sm font-medium">
              Note <span className="font-normal text-stone-400">(optional)</span>
            </label>
            <input
              id="description"
              name="description"
              type="text"
              maxLength={120}
              placeholder="What you're running"
              className="w-full rounded-lg border border-stone-300 px-3 py-2 text-sm outline-none focus:border-stone-500"
            />
            <p className="text-xs text-stone-400">
              Only you and the lab manager see this.
            </p>
          </div>

          {state.error && (
            <p className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-sm text-rose-900">
              {state.error}
            </p>
          )}

          <div className="flex gap-2 pt-1">
            <button
              type="submit"
              disabled={pending}
              className="flex-1 rounded-lg bg-stone-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-stone-700 disabled:opacity-50"
            >
              {pending ? "Booking..." : "Confirm booking"}
            </button>
            <button
              type="button"
              onClick={onClose}
              className="rounded-lg border border-stone-300 px-4 py-2 text-sm transition hover:bg-stone-50"
            >
              Cancel
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
