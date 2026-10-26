"use client";

import { useActionState } from "react";
import {
  cancelBookingAction,
  type ActionState,
} from "@/app/(site)/instruments/[slug]/actions";

const initialState: ActionState = { error: null };

export function CancelBookingButton({ bookingId }: { bookingId: string }) {
  const [state, formAction, pending] = useActionState(
    cancelBookingAction,
    initialState,
  );

  return (
    <form action={formAction} className="text-right">
      <input type="hidden" name="bookingId" value={bookingId} />
      <button
        type="submit"
        disabled={pending}
        className="-my-2.5 min-h-11 rounded-[10px] px-2.5 text-sm font-semibold text-ink-2 transition hover:bg-err-soft hover:text-err disabled:opacity-50"
      >
        {pending ? "Cancelling…" : "Cancel"}
      </button>
      {/* The deadline rule lives on the server, so the reason surfaces here. */}
      {state.error && <p className="mt-1 text-xs text-err">{state.error}</p>}
    </form>
  );
}
