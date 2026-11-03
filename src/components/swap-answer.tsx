"use client";

import { useActionState, useState } from "react";
import { answerSwapAction, type SwapState } from "@/app/(site)/swap/actions";
import { Button, Notice } from "@/components/ui";

const initialState: SwapState = { error: null };

/**
 * The holder's answer to "Ask for this time": give it up or keep it. Giving up can't
 * be undone, so it asks once more, as Remove and Archive do. Identified by request id
 * (signed in, My bookings) or by the email link's token (the /swap page).
 */
export function SwapAnswer({
  requestId,
  token,
  requesterName,
  size = "md",
}: {
  requestId?: string;
  token?: string;
  requesterName: string;
  size?: "md" | "lg";
}) {
  const [state, formAction, pending] = useActionState(answerSwapAction, initialState);
  const [confirming, setConfirming] = useState(false);
  const first = requesterName.split(" ")[0];

  if (state.done === "given") {
    return <Notice tone="ok" title={`It's ${first}'s now`}>We&apos;ve let {first} know. It&apos;s off your schedule.</Notice>;
  }
  if (state.done === "kept") {
    return <Notice tone="info" title="You're keeping this time">We&apos;ve let {first} know, without a reason.</Notice>;
  }

  return (
    <form action={formAction} className="flex flex-col items-stretch gap-2.5 sm:items-end">
      {requestId && <input type="hidden" name="requestId" value={requestId} />}
      {token && <input type="hidden" name="token" value={token} />}
      <div className="flex flex-wrap items-center gap-2.5 sm:justify-end">
        {confirming ? (
          <>
            <span className="text-sm font-semibold">Give it to {first}?</span>
            <Button variant="secondary" size={size} onClick={() => setConfirming(false)}>
              Not yet
            </Button>
            <Button type="submit" name="answer" value="give" size={size} disabled={pending}>
              {pending ? "Giving…" : "Yes, give it up"}
            </Button>
          </>
        ) : (
          <>
            <Button type="submit" name="answer" value="keep" variant="secondary" size={size} disabled={pending}>
              Keep it
            </Button>
            {/* Gold only on the /swap page, where it's the one thing to do; a list of
                requests in My bookings would otherwise be a column of gold buttons. */}
            <Button variant={size === "lg" ? "primary" : "secondary"} size={size} onClick={() => setConfirming(true)}>
              Give it up
            </Button>
          </>
        )}
      </div>
      {state.error && (
        <Notice tone="err" alert>
          {state.error}
        </Notice>
      )}
    </form>
  );
}
