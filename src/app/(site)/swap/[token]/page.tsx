import type { Metadata } from "next";
import { findRequestByToken } from "@/lib/booking/swap";
import { formatDayLabel, formatClockRange } from "@/lib/time";
import { SwapAnswer } from "@/components/swap-answer";
import { ButtonLink, Card, InstrumentTile, Notice } from "@/components/ui";

export const metadata: Metadata = {
  title: "Someone is asking for your time — Instrument Calendar",
  robots: { index: false, follow: false },
};

/**
 * Where the holder's email link lands. The token is the credential, so no sign-in:
 * the request is urgent by nature. Nothing happens on load (mail scanners follow
 * links); the holder chooses with a button.
 */
export default async function SwapLinkPage({ params }: PageProps<"/swap/[token]">) {
  const { token } = await params;
  const request = await findRequestByToken(token);
  const now = new Date();

  if (!request) {
    return (
      <Shell>
        <Notice tone="warn" title="This link doesn't work">
          It may have been replaced by a newer email about the same request. You can also
          answer from My bookings.
        </Notice>
        <ButtonLink href="/my-bookings" variant="secondary" className="mt-4">
          My bookings
        </ButtonLink>
      </Shell>
    );
  }

  const { booking, requester } = request;
  const first = requester.name.split(" ")[0];
  const ended =
    request.status !== "PENDING"
      ? {
          ACCEPTED: `You gave this time to ${first}.`,
          DECLINED: "You kept this time.",
          WITHDRAWN: `${first} took the request back, so there's nothing to answer.`,
          EXPIRED: "This request has ended.",
        }[request.status]
      : booking.status !== "CONFIRMED"
        ? "This booking isn't on the calendar any more."
        : booking.startsAt <= now
          ? "This booking has already started, so the request has ended."
          : null;

  return (
    <Shell>
      <Card className="p-5 sm:p-6">
        <div className="flex items-start gap-3.5">
          <InstrumentTile name={booking.instrument.name} color={booking.instrument.color} />
          <div className="min-w-0">
            <p className="text-[13px] font-semibold text-ink-3">
              {[booking.instrument.name, booking.instrument.location].filter(Boolean).join(" · ")}
            </p>
            <p className="mt-0.5 text-lg font-bold">
              {formatDayLabel(booking.startsAt)}{" "}
              <span className="font-semibold whitespace-nowrap text-ink-2 tabular-nums">
                {formatClockRange(booking.startsAt, booking.endsAt)}
              </span>
            </p>
          </div>
        </div>

        <p className="mt-5 text-[17px] leading-normal">
          <span className="font-bold">{requester.name}</span> is asking if you can give them
          this booking.
        </p>
        {request.note && (
          <p className="mt-3 rounded-xl bg-surface-2 px-4 py-3 text-[15px] leading-normal text-ink-2">
            <span className="font-bold text-ink">Their note:</span> {request.note}
          </p>
        )}

        <div className="mt-6">
          {ended ? (
            <Notice tone="info">{ended}</Notice>
          ) : (
            <>
              <p className="mb-4 text-sm text-ink-2">
                If you give it up, it becomes {first}&apos;s booking and leaves your schedule.
                Either way, {first} hears back by email.
              </p>
              <SwapAnswer token={token} requesterName={requester.name} size="lg" />
            </>
          )}
        </div>
      </Card>
    </Shell>
  );
}

function Shell({ children }: { children: React.ReactNode }) {
  return (
    <div className="mx-auto max-w-[620px]">
      <h1 className="mb-5 text-[34px] leading-tight font-extrabold tracking-[-0.02em]">Your booking</h1>
      {children}
    </div>
  );
}
