import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  addCivilDays,
  civilToInstant,
  civilToISODate,
  compareCivil,
  formatDurationMinutes,
  formatRange,
  minutesToClock,
  parseISODate,
  todayCivil,
} from "@/lib/time";
import { crossesMidnight, expandWindows, windowSpanMinutes } from "@/lib/booking/windows";
import { computeBookableSlots } from "@/lib/booking/slots";
import { findOpenings } from "@/lib/booking/availability";
import { WeekGrid, type GridBlock, type GridDay } from "@/components/week-grid";
import { CancelBookingButton } from "@/components/cancel-booking-button";

export default async function InstrumentPage({
  params,
  searchParams,
}: PageProps<"/instruments/[slug]">) {
  const { slug } = await params;
  const { week } = await searchParams;

  const [user, instrument] = await Promise.all([
    getSession(),
    db.instrument.findUnique({
      where: { slug },
      include: {
        windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } },
      },
    }),
  ]);

  if (!instrument) notFound();

  const now = new Date();
  const today = todayCivil(now);
  const requested = typeof week === "string" ? parseISODate(week) : null;
  const anchor = requested ?? today;

  // Columns run Sunday to Saturday, matching how quota weeks are counted.
  const weekdayIndex = new Date(
    Date.UTC(anchor.y, anchor.m - 1, anchor.d),
  ).getUTCDay();
  const weekStart = addCivilDays(anchor, -weekdayIndex);
  const weekEnd = addCivilDays(weekStart, 7);

  const rangeStart = civilToInstant(weekStart, 0);
  const rangeEnd = civilToInstant(weekEnd, 0);

  const [bookings, advisors, profile] = await Promise.all([
    db.booking.findMany({
      where: {
        instrumentId: instrument.id,
        status: "CONFIRMED",
        startsAt: { lt: rangeEnd },
        endsAt: { gt: rangeStart },
      },
      include: { user: { select: { id: true, name: true } } },
      orderBy: { startsAt: "asc" },
    }),
    db.user.findMany({
      where: { isResearchAdvisor: true },
      select: { id: true, name: true },
      orderBy: { name: "asc" },
    }),
    user
      ? db.user.findUnique({
          where: { id: user.id },
          select: { advisorId: true },
        })
      : Promise.resolve(null),
  ]);

  // A day early, so an overnight window opening Saturday still shades Sunday morning.
  const occurrences = expandWindows(
    instrument.windows,
    addCivilDays(weekStart, -1),
    weekEnd,
  );

  const busy = bookings.map((b) => ({ start: b.startsAt, end: b.endsAt }));

  // Only students book through this UI; instructors get the class-booking flow, which
  // is not built yet.
  const canBook = user?.role === "STUDENT";

  const slots = canBook
    ? computeBookableSlots({
        windows: instrument.windows,
        busy,
        from: rangeStart,
        to: rangeEnd,
        earliest: new Date(
          Math.max(
            rangeStart.getTime(),
            now.getTime() + instrument.minLeadTimeMinutes * 60_000,
          ),
        ),
        latest: new Date(now.getTime() + instrument.bookingHorizonDays * 86_400_000),
        bufferMinutes: instrument.bufferMinutes,
      })
    : [];

  const days: GridDay[] = Array.from({ length: 7 }, (_, i) => {
    const date = addCivilDays(weekStart, i);
    return {
      key: civilToISODate(date),
      weekday: new Date(Date.UTC(date.y, date.m - 1, date.d)).toLocaleDateString(
        "en-US",
        { weekday: "short", timeZone: "UTC" },
      ),
      dayOfMonth: date.d,
      isToday: compareCivil(date, today) === 0,
      start: civilToInstant(date, 0),
      end: civilToInstant(addCivilDays(date, 1), 0),
    };
  });

  const blocks: GridBlock[] = bookings.map((booking) => {
    const mine = user?.id === booking.user.id;
    return {
      id: booking.id,
      start: booking.startsAt,
      end: booking.endsAt,
      // Class and maintenance announce themselves; student bookings show only a name,
      // since what someone is running is their business.
      label:
        booking.type === "MAINTENANCE"
          ? "Maintenance"
          : booking.type === "CLASS"
            ? (booking.description ?? "Class")
            : mine
              ? "You"
              : booking.user.name,
      sublabel:
        booking.type === "MAINTENANCE"
          ? (booking.description ?? undefined)
          : booking.type === "CLASS"
            ? booking.user.name
            : undefined,
      tone:
        booking.type === "MAINTENANCE"
          ? "maintenance"
          : booking.type === "CLASS"
            ? "class"
            : mine
              ? "mine"
              : "student",
    };
  });

  const myBookings = user
    ? bookings.filter((b) => b.user.id === user.id && b.endsAt > now)
    : [];

  const shortest = Math.min(
    ...instrument.windows.map((w) =>
      w.wholeBlockOnly ? windowSpanMinutes(w) : w.minDurationMinutes,
    ),
  );
  const openings = await findOpenings({
    instrumentId: instrument.id,
    durationMinutes: Number.isFinite(shortest) ? shortest : 60,
    limit: 3,
  });

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <Link
            href="/"
            className="text-sm text-stone-500 underline-offset-4 hover:underline"
          >
            ← All instruments
          </Link>
          <h1 className="mt-2 flex items-center gap-2 text-2xl font-semibold tracking-tight">
            <span
              aria-hidden
              className="size-3 rounded-full"
              style={{ backgroundColor: instrument.color }}
            />
            {instrument.name}
          </h1>
          {instrument.location && (
            <p className="text-stone-600">{instrument.location}</p>
          )}
        </div>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href={`/instruments/${slug}?week=${civilToISODate(addCivilDays(weekStart, -7))}`}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 hover:border-stone-300"
          >
            ←
          </Link>
          <Link
            href={`/instruments/${slug}`}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 hover:border-stone-300"
          >
            Today
          </Link>
          <Link
            href={`/instruments/${slug}?week=${civilToISODate(addCivilDays(weekStart, 7))}`}
            className="rounded-lg border border-stone-200 bg-white px-3 py-1.5 hover:border-stone-300"
          >
            →
          </Link>
        </nav>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-stone-600">
          {canBook ? (
            <>Click any open time to book it.</>
          ) : user ? (
            <>Viewing the schedule. Class bookings aren&apos;t built yet.</>
          ) : (
            <>
              <Link href="/dev-login" className="underline underline-offset-4">
                Sign in
              </Link>{" "}
              to book time.
            </>
          )}
        </p>
        <ul className="flex flex-wrap gap-3 text-xs text-stone-500">
          <Legend className="bg-emerald-50 border-emerald-200">Open</Legend>
          <Legend className="bg-stone-200 border-stone-300">Booked</Legend>
          <Legend className="bg-indigo-100 border-indigo-300">Yours</Legend>
          <Legend className="bg-amber-100 border-amber-300">Class</Legend>
          <Legend className="bg-rose-100 border-rose-300">Maintenance</Legend>
        </ul>
      </div>

      <WeekGrid
        slug={slug}
        days={days}
        bands={occurrences.map((o) => ({
          id: o.window.id,
          start: o.start,
          end: o.end,
        }))}
        blocks={blocks}
        slots={slots}
        advisors={advisors}
        defaultAdvisorId={profile?.advisorId ?? null}
        advisorRequired={instrument.requireResearchAdvisor}
        timeZone={env.CAMPUS_TIMEZONE}
        canBook={canBook}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-medium">
            {myBookings.length > 0 ? "Your bookings this week" : "Bookable hours"}
          </h2>

          {myBookings.length > 0 ? (
            <ul className="mt-3 space-y-3 text-sm">
              {myBookings.map((booking) => (
                <li
                  key={booking.id}
                  className="flex items-start justify-between gap-4 border-b border-stone-100 pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <div className="text-stone-700">
                      {formatRange(booking.startsAt, booking.endsAt)}
                    </div>
                    {booking.description && (
                      <div className="text-xs text-stone-400">
                        {booking.description}
                      </div>
                    )}
                  </div>
                  <CancelBookingButton bookingId={booking.id} />
                </li>
              ))}
            </ul>
          ) : (
            <dl className="mt-3 space-y-2 text-sm">
              {instrument.windows.map((window) => (
                <div key={window.id} className="flex justify-between gap-4">
                  <dt className="text-stone-600">{window.name}</dt>
                  <dd className="text-right text-stone-500">
                    {minutesToClock(window.startMinute)}–
                    {minutesToClock(window.endMinute)}
                    {crossesMidnight(window) && (
                      <span className="text-stone-400"> next day</span>
                    )}
                    <div className="text-xs text-stone-400">
                      {window.wholeBlockOnly
                        ? `one ${formatDurationMinutes(windowSpanMinutes(window))} block`
                        : `${formatDurationMinutes(window.minDurationMinutes)}–${formatDurationMinutes(window.maxDurationMinutes)}`}
                    </div>
                  </dd>
                </div>
              ))}
            </dl>
          )}
        </section>

        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-medium">Next available</h2>
          {openings.length === 0 ? (
            <p className="mt-3 text-sm text-stone-500">
              Nothing open in the next {instrument.bookingHorizonDays} days.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {openings.map((opening) => (
                <li
                  key={opening.start.toISOString()}
                  className="flex justify-between gap-4"
                >
                  <span className="text-stone-700">
                    {formatRange(opening.start, opening.end)}
                  </span>
                  <span className="shrink-0 text-xs text-stone-400">
                    {opening.windowName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>
    </div>
  );
}

function Legend({
  className,
  children,
}: {
  className: string;
  children: React.ReactNode;
}) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`size-3 rounded border ${className}`} />
      {children}
    </li>
  );
}
