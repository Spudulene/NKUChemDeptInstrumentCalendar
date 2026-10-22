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
        className="text-xs text-ink-3 underline-offset-4 transition hover:text-err hover:underline disabled:opacity-50"
      >
        {pending ? "Cancelling..." : "Cancel"}
      </button>
      {/* The deadline rule lives on the server, so the reason surfaces here. */}
      {state.error && <p className="mt-1 text-xs text-err">{state.error}</p>}
    </form>
  );
}
