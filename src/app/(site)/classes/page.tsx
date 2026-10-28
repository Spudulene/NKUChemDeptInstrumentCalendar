import Link from "next/link";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { civilToISODate, formatClockRange, formatDayLabel, minutesToClock, todayCivil } from "@/lib/time";
import { CancelBookingButton } from "@/components/cancel-booking-button";
import { CancelSeriesButton } from "@/components/cancel-series-button";
import { ReserveForm } from "@/components/reserve-form";
import { Card, InstrumentTile } from "@/components/ui";

export default async function ClassReservationsPage({
  searchParams,
}: PageProps<"/classes">) {
  const { instrument: requested } = await searchParams;
  const user = await getSession();

  if (!user || (user.role !== "INSTRUCTOR" && user.role !== "ADMIN")) {
    return (
      <div className="max-w-[680px]">
        <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em]">
          Reserve for a class
        </h1>
        <p className="mt-2 text-[17px] leading-normal text-ink-2">
          Class reservations are for instructors and the instrument manager.{" "}
          {user ? (
            <Link href="/" className="font-semibold underline underline-offset-4">
              Back to instruments
            </Link>
          ) : (
            <Link href="/dev-login" className="font-semibold underline underline-offset-4">
              Sign in
            </Link>
          )}
        </p>
      </div>
    );
  }

  const instruments = await db.instrument.findMany({
    where: { isActive: true },
    select: { id: true, name: true, slug: true, location: true },
    orderBy: { name: "asc" },
  });

  const initial =
    instruments.find((i) => i.slug === requested) ?? instruments[0] ?? null;

  return (
    <div>
      <h1 className="text-[34px] leading-tight font-extrabold tracking-[-0.02em]">
        Reserve for a class
      </h1>
      <p className="mt-2 max-w-[680px] text-[17px] leading-normal text-ink-2">
        Class reservations take priority over student bookings. You&apos;ll see exactly
        who is affected before anything is cancelled.
      </p>

      {initial ? (
        <ReserveForm
          instruments={instruments}
          initialInstrumentId={initial.id}
          today={civilToISODate(todayCivil())}
          reservedBy={user.name}
        />
      ) : (
        <p className="mt-7 text-ink-2">There are no active instruments to reserve.</p>
      )}

      <UpcomingReservations userId={user.id} isAdmin={user.role === "ADMIN"} />
    </div>
  );
}

const WEEK_ORDER = ["MON", "TUE", "WED", "THU", "FRI", "SAT", "SUN"] as const;
const DAY_NAME: Record<(typeof WEEK_ORDER)[number], string> = {
  MON: "Mon",
  TUE: "Tue",
  WED: "Wed",
  THU: "Thu",
  FRI: "Fri",
  SAT: "Sat",
  SUN: "Sun",
};

/** A `@db.Date` column comes back as UTC midnight; read it as the calendar date it is. */
const shortDate = (date: Date) =>
  date.toLocaleDateString("en-US", { month: "short", day: "numeric", timeZone: "UTC" });

/**
 * Class time still to come: weekly series as one row each (cancel all, or open it to
 * cancel single dates), then one-off reservations. Instructors see their own; admins
 * see everyone's, since they're the ones asked to clear a slot.
 */
async function UpcomingReservations({ userId, isAdmin }: { userId: string; isAdmin: boolean }) {
  const now = new Date();
  const bookings = await db.booking.findMany({
    where: {
      type: "CLASS",
      status: "CONFIRMED",
      endsAt: { gt: now },
      ...(isAdmin ? {} : { userId }),
    },
    include: {
      instrument: { select: { name: true, color: true } },
      user: { select: { name: true } },
      series: true,
    },
    orderBy: { startsAt: "asc" },
  });

  const seriesIds = [...new Set(bookings.flatMap((b) => (b.seriesId ? [b.seriesId] : [])))];
  const oneOffs = bookings.filter((b) => !b.seriesId);

  const cancelOrRunning = (b: { id: string; startsAt: Date }) =>
    b.startsAt > now ? (
      <CancelBookingButton bookingId={b.id} />
    ) : (
      <span className="text-sm font-semibold text-ok">Happening now</span>
    );

  return (
    <section aria-labelledby="mine-h" className="mt-12 max-w-[860px]">
      <h2 id="mine-h" className="text-xl font-bold tracking-[-0.01em]">
        {isAdmin ? "Upcoming class reservations" : "Your class reservations"}
      </h2>
      {bookings.length === 0 ? (
        <p className="mt-3 text-[15px] text-ink-3">Nothing reserved from today on.</p>
      ) : (
        <Card as="ul" className="mt-4 divide-y divide-line">
          {seriesIds.map((id) => {
            const meetings = bookings.filter((b) => b.seriesId === id);
            const { series, instrument, user } = meetings[0];
            if (!series) return null;
            const days = WEEK_ORDER.filter((d) => series.daysOfWeek.includes(d))
              .map((d) => DAY_NAME[d])
              .join(" & ");
            const crosses = series.endMinute <= series.startMinute;
            return (
              <li key={id} className="px-4 py-3.5 sm:px-5">
                <div className="flex flex-wrap items-center gap-x-4 gap-y-3">
                  <div className="flex min-w-0 flex-[1_1_260px] items-start gap-3.5">
                    <InstrumentTile name={instrument.name} color={instrument.color} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink-3">
                        {instrument.name}
                        {isAdmin && ` · ${user.name}`}
                      </p>
                      <p className="mt-0.5 text-base font-bold">{series.title}</p>
                      <p className="mt-0.5 text-sm text-ink-2 tabular-nums">
                        Every {days} · {minutesToClock(series.startMinute)} –{" "}
                        {minutesToClock(series.endMinute)}
                        {crosses && " next day"} · {shortDate(series.firstDate)} –{" "}
                        {shortDate(series.lastDate)}
                      </p>
                    </div>
                  </div>
                  <div className="ml-auto max-w-full">
                    <CancelSeriesButton
                      seriesId={id}
                      remaining={meetings.filter((m) => m.startsAt > now).length}
                    />
                  </div>
                </div>
                <details className="mt-2 sm:ml-[58px]">
                  <summary className="inline-flex min-h-11 cursor-pointer items-center text-sm font-bold underline underline-offset-4">
                    {meetings.length} date{meetings.length === 1 ? "" : "s"} left · next{" "}
                    {formatDayLabel(meetings[0].startsAt)}
                  </summary>
                  <ul className="mt-1 divide-y divide-line rounded-xl border border-line">
                    {meetings.map((m) => (
                      <li key={m.id} className="flex items-center justify-between gap-3 px-3.5 py-2.5">
                        <span className="text-sm">
                          <span className="font-bold">{formatDayLabel(m.startsAt)}</span>{" "}
                          <span className="text-ink-2 tabular-nums">
                            {formatClockRange(m.startsAt, m.endsAt)}
                          </span>
                        </span>
                        {cancelOrRunning(m)}
                      </li>
                    ))}
                  </ul>
                </details>
              </li>
            );
          })}
          {oneOffs.map((b) => (
            <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
              <div className="flex min-w-0 flex-[1_1_260px] items-start gap-3.5">
                <InstrumentTile name={b.instrument.name} color={b.instrument.color} />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink-3">
                    {b.instrument.name}
                    {isAdmin && ` · ${b.user.name}`}
                  </p>
                  <p className="mt-0.5 text-base font-bold">{b.title ?? "Class"}</p>
                  <p className="mt-0.5 text-sm text-ink-2 tabular-nums">
                    {formatDayLabel(b.startsAt)} · {formatClockRange(b.startsAt, b.endsAt)}
                  </p>
                </div>
              </div>
              <div className="ml-auto flex-none">{cancelOrRunning(b)}</div>
            </li>
          ))}
        </Card>
      )}
    </section>
  );
}
