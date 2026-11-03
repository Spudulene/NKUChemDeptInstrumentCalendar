import Link from "next/link";
import type { ReactNode } from "react";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { canCancel } from "@/lib/booking/rules";
import { civilToISODate, formatClockRange, formatDayLabel, formatDurationMinutes, instantToCivil } from "@/lib/time";
import { sundayOf } from "@/lib/week";
import { withdrawSwapAction } from "@/app/(site)/swap/actions";
import { CancelBookingButton } from "@/components/cancel-booking-button";
import { SwapAnswer } from "@/components/swap-answer";
import { ButtonLink, Card, InstrumentTile } from "@/components/ui";

/** How far back "Past" and "Bumped" look: enough to check last week, not a history. */
const LOOKBACK_DAYS = 30;

const bookingInclude = {
  instrument: { select: { name: true, slug: true, color: true, cancellationDeadlineMinutes: true } },
  window: { select: { name: true } },
  advisor: { select: { name: true } },
} as const;

/**
 * Everything the signed-in student has booked, across every instrument: what's coming
 * up (with cancel, up to each instrument's deadline), anything a class or maintenance
 * displaced, and the last month for reference. Bumped bookings are emailed too, but
 * this is where a student can find them again and rebook.
 *
 * "Ask for this time" lives here too: requests for the student's own bookings, to give
 * up or keep, and the requests they've sent, with how each ended.
 */
export default async function MyBookingsPage() {
  const user = await getSession();

  if (!user) {
    return (
      <div className="max-w-[680px]">
        <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em]">My bookings</h1>
        <p className="mt-2 text-[17px] leading-normal text-ink-2">
          <Link href="/dev-login" className="font-semibold underline underline-offset-4">
            Sign in
          </Link>{" "}
          to see the time you&apos;ve booked.
        </p>
      </div>
    );
  }

  const now = new Date();
  const since = new Date(now.getTime() - LOOKBACK_DAYS * 24 * 60 * 60_000);

  const [upcoming, bumped, past, incoming, outgoing] = await Promise.all([
    db.booking.findMany({
      where: { userId: user.id, status: "CONFIRMED", endsAt: { gt: now } },
      include: bookingInclude,
      orderBy: { startsAt: "asc" },
    }),
    db.booking.findMany({
      where: { userId: user.id, status: "PREEMPTED", startsAt: { gte: since } },
      include: {
        ...bookingInclude,
        preemptedBy: { select: { type: true, title: true, description: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
    db.booking.findMany({
      where: {
        userId: user.id,
        status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] },
        endsAt: { lte: now },
        startsAt: { gte: since },
      },
      include: bookingInclude,
      orderBy: { startsAt: "desc" },
    }),
    db.swapRequest.findMany({
      where: {
        status: "PENDING",
        booking: { userId: user.id, status: "CONFIRMED", startsAt: { gt: now } },
      },
      include: { requester: { select: { name: true } }, booking: { include: bookingInclude } },
      orderBy: { createdAt: "asc" },
    }),
    // Open requests, and ones that ended in the last week so the outcome is findable.
    db.swapRequest.findMany({
      where: {
        requesterId: user.id,
        OR: [
          { status: "PENDING", booking: { status: "CONFIRMED", startsAt: { gt: now } } },
          { status: { not: "PENDING" }, respondedAt: { gte: new Date(now.getTime() - 7 * 24 * 60 * 60_000) } },
        ],
      },
      include: { booking: { include: { ...bookingInclude, user: { select: { name: true } } } } },
      orderBy: { createdAt: "desc" },
    }),
  ]);

  const weekOf = (b: { instrument: { slug: string }; startsAt: Date }) =>
    `/instruments/${b.instrument.slug}?week=${civilToISODate(sundayOf(instantToCivil(b.startsAt)))}`;

  return (
    <div className="flex max-w-[860px] flex-col gap-10">
      <div>
        <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em] sm:text-[40px]">My bookings</h1>
        <p className="mt-2 text-[17px] leading-normal text-ink-2">
          Your time on every instrument. Times are campus time.
        </p>
      </div>

      {incoming.length > 0 && (
        <section aria-labelledby="incoming-h">
          <h2 id="incoming-h" className="text-xl font-bold tracking-[-0.01em]">
            Asking for your time
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Give it up and it becomes their booking. Each request ends when the booking starts.
          </p>
          <BookingList>
            {incoming.map((r) => (
              <BookingRow
                key={r.id}
                booking={r.booking}
                note={
                  <>
                    <span className="font-semibold text-ink">{r.requester.name}</span> is asking for this time
                    {r.note ? <>: &ldquo;{r.note}&rdquo;</> : "."}
                  </>
                }
                action={<SwapAnswer requestId={r.id} requesterName={r.requester.name} />}
              />
            ))}
          </BookingList>
        </section>
      )}

      <section aria-labelledby="upcoming-h">
        <h2 id="upcoming-h" className="text-xl font-bold tracking-[-0.01em]">
          Upcoming
        </h2>
        {upcoming.length > 0 ? (
          <BookingList>
            {upcoming.map((b) => {
              const tooLate = canCancel({
                booking: { userId: b.userId, start: b.startsAt },
                instrument: b.instrument,
                actor: { id: user.id, role: user.role },
                now,
              });
              return (
                <BookingRow
                  key={b.id}
                  booking={b}
                  action={
                    b.startsAt <= now ? (
                      <span className="text-sm font-semibold text-ok">Happening now</span>
                    ) : tooLate ? (
                      <span className="block max-w-[240px] text-right text-[13px] leading-snug text-ink-3">
                        Too late to cancel online (within{" "}
                        {formatDurationMinutes(b.instrument.cancellationDeadlineMinutes)} of the start). Contact
                        the instrument manager.
                      </span>
                    ) : (
                      <CancelBookingButton bookingId={b.id} />
                    )
                  }
                />
              );
            })}
          </BookingList>
        ) : (
          <Card className="mt-4 flex flex-wrap items-center justify-between gap-4 p-5">
            <p className="text-[15px] text-ink-2">Nothing booked. Pick an instrument to find open time.</p>
            <ButtonLink href="/" variant="secondary">
              See instruments
            </ButtonLink>
          </Card>
        )}
      </section>

      {bumped.length > 0 && (
        <section aria-labelledby="bumped-h">
          <h2 id="bumped-h" className="text-xl font-bold tracking-[-0.01em]">
            Bumped for a class or maintenance
          </h2>
          <p className="mt-1 text-sm text-ink-2">
            Class and maintenance time takes priority, so these were cancelled for you.
          </p>
          <BookingList>
            {bumped.map((b) => {
              const by = b.preemptedBy;
              const what =
                by?.type === "MAINTENANCE" ? "maintenance" : by?.title ? by.title : "a class";
              return (
                <BookingRow
                  key={b.id}
                  booking={b}
                  muted
                  note={
                    <>
                      Replaced by {what}
                      {by?.description ? `: ${by.description}` : "."}
                    </>
                  }
                  action={
                    b.startsAt > now && (
                      <Link
                        href={weekOf(b)}
                        className="inline-flex min-h-11 items-center text-sm font-bold whitespace-nowrap underline underline-offset-4"
                      >
                        Find another time
                      </Link>
                    )
                  }
                />
              );
            })}
          </BookingList>
        </section>
      )}

      {outgoing.length > 0 && (
        <section aria-labelledby="outgoing-h">
          <h2 id="outgoing-h" className="text-xl font-bold tracking-[-0.01em]">
            Your requests
          </h2>
          <p className="mt-1 text-sm text-ink-2">Time you&apos;ve asked other students for.</p>
          <BookingList>
            {outgoing.map((r) => {
              const holder = r.booking.user.name;
              const outcome = {
                PENDING: `Waiting for ${holder}.`,
                ACCEPTED: `${holder} gave it to you — it's under Upcoming.`,
                DECLINED: `${holder} is keeping it.`,
                WITHDRAWN: "You withdrew this request.",
                EXPIRED: "Ended without the time changing hands.",
              }[r.status];
              return (
                <BookingRow
                  key={r.id}
                  // Someone else's booking: their research group isn't the requester's business.
                  booking={{ ...r.booking, advisor: null }}
                  muted={r.status !== "PENDING"}
                  note={outcome}
                  action={
                    r.status === "PENDING" ? (
                      <form action={withdrawSwapAction}>
                        <input type="hidden" name="requestId" value={r.id} />
                        <button
                          type="submit"
                          className="min-h-11 rounded-[10px] px-2.5 text-sm font-semibold text-ink-2 transition hover:bg-err-soft hover:text-err"
                        >
                          Withdraw
                        </button>
                      </form>
                    ) : (
                      r.status !== "ACCEPTED" &&
                      r.booking.startsAt > now && (
                        <Link
                          href={weekOf(r.booking)}
                          className="inline-flex min-h-11 items-center text-sm font-bold whitespace-nowrap underline underline-offset-4"
                        >
                          Find another time
                        </Link>
                      )
                    )
                  }
                />
              );
            })}
          </BookingList>
        </section>
      )}

      <section aria-labelledby="past-h">
        <h2 id="past-h" className="text-xl font-bold tracking-[-0.01em]">
          Past {LOOKBACK_DAYS} days
        </h2>
        {past.length > 0 ? (
          <BookingList>
            {past.map((b) => (
              <BookingRow
                key={b.id}
                booking={b}
                muted
                action={b.status === "NO_SHOW" && <span className="text-sm font-semibold text-warn">No-show</span>}
              />
            ))}
          </BookingList>
        ) : (
          <p className="mt-3 text-[15px] text-ink-3">Nothing in the last {LOOKBACK_DAYS} days.</p>
        )}
      </section>
    </div>
  );
}

function BookingList({ children }: { children: ReactNode }) {
  return (
    <Card as="ul" className="mt-4 divide-y divide-line">
      {children}
    </Card>
  );
}

function BookingRow({
  booking: b,
  action,
  note,
  muted = false,
}: {
  booking: {
    type: string;
    startsAt: Date;
    endsAt: Date;
    instrument: { name: string; color: string };
    window: { name: string } | null;
    advisor: { name: string } | null;
  };
  action?: ReactNode;
  note?: ReactNode;
  muted?: boolean;
}) {
  return (
    <li className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
      <div className={`flex min-w-0 flex-[1_1_260px] items-start gap-3.5 ${muted ? "opacity-80" : ""}`}>
        <InstrumentTile name={b.instrument.name} color={b.instrument.color} />
        <div className="min-w-0">
          <p className="text-[13px] font-semibold text-ink-3">{b.instrument.name}</p>
          <p className="mt-0.5 text-base font-bold">
            {formatDayLabel(b.startsAt)}{" "}
            <span className="font-semibold whitespace-nowrap text-ink-2 tabular-nums">
              {formatClockRange(b.startsAt, b.endsAt)}
            </span>
          </p>
          <p className="mt-0.5 text-[13px] text-ink-3">
            {[b.window?.name ?? (b.type === "CLASS" ? "Class" : null), b.advisor?.name].filter(Boolean).join(" · ")}
          </p>
          {note && <p className="mt-1.5 text-sm text-ink-2">{note}</p>}
        </div>
      </div>
      {action && <div className="ml-auto flex-none">{action}</div>}
    </li>
  );
}
