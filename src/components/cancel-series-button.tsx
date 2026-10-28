"use client";

import { useActionState, useState } from "react";
import { cancelSeriesAction, type CancelSeriesState } from "@/app/(site)/classes/actions";
import { Button } from "@/components/ui";

const initialState: CancelSeriesState = { error: null };

/**
 * Cancel every remaining date of a series. Asks first: it's one click for what may
 * be a whole term, and there's no undo.
 */
export function CancelSeriesButton({ seriesId, remaining }: { seriesId: string; remaining: number }) {
  const [state, formAction, pending] = useActionState(cancelSeriesAction, initialState);
  const [asking, setAsking] = useState(false);
  const dates = `${remaining} date${remaining === 1 ? "" : "s"}`;

  if (!asking) {
    return (
      <Button variant="secondary" onClick={() => setAsking(true)}>
        Cancel series
      </Button>
    );
  }

  return (
    <form action={formAction} className="flex flex-wrap items-center justify-end gap-2">
      <input type="hidden" name="seriesId" value={seriesId} />
      <span className="w-full text-right text-sm font-semibold sm:w-auto">Cancel all {dates}?</span>
      <Button variant="secondary" onClick={() => setAsking(false)} disabled={pending}>
        Keep
      </Button>
      <button
        type="submit"
        disabled={pending}
        className="min-h-11 rounded-[10px] bg-err px-4 text-sm font-bold text-bg disabled:opacity-50"
      >
        {pending ? "Cancelling…" : `Cancel ${dates}`}
      </button>
      {state.error && <p className="w-full text-right text-xs text-err">{state.error}</p>}
    </form>
  );
}
