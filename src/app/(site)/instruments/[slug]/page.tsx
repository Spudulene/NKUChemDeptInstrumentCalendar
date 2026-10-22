import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  addCivilDays,
  civilToInstant,
  civilToISODate,
  formatDurationMinutes,
  formatRange,
  minutesToClock,
  parseISODate,
  todayCivil,
} from "@/lib/time";
import { crossesMidnight, expandWindows, windowSpanMinutes } from "@/lib/booking/windows";
import { computeBookableSlots } from "@/lib/booking/slots";
import { findOpenings } from "@/lib/booking/availability";
import { campusDays, sundayOf } from "@/lib/week";
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

  const weekStart = sundayOf(anchor);
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

  // Only students book through this grid; instructors and admins reserve class time
  // on /classes, which can displace student bookings.
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

  const days: GridDay[] = campusDays(weekStart, 7, today);

  const blocks: GridBlock[] = bookings.map((booking) => {
    const mine = user?.id === booking.user.id;
    return {
      id: booking.id,
      start: booking.startsAt,
      end: booking.endsAt,
      when: formatRange(booking.startsAt, booking.endsAt),
      // Class and maintenance announce themselves; student bookings show only a name,
      // since what someone is running is their business. Only signed-in members of the
      // department get the name: this page is reachable by anyone with the URL.
      label:
        booking.type === "MAINTENANCE"
          ? "Maintenance"
          : booking.type === "CLASS"
            ? (booking.title ?? booking.description ?? "Class")
            : mine
              ? "You"
              : user
                ? booking.user.name
                : "Booked",
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
            className="text-sm text-ink-3 underline-offset-4 hover:underline"
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
            <p className="text-ink-2">{instrument.location}</p>
          )}
        </div>

        <nav className="flex items-center gap-1 text-sm">
          <Link
            href={`/instruments/${slug}?week=${civilToISODate(addCivilDays(weekStart, -7))}`}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:border-line-2"
          >
            ←
          </Link>
          <Link
            href={`/instruments/${slug}`}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:border-line-2"
          >
            Today
          </Link>
          <Link
            href={`/instruments/${slug}?week=${civilToISODate(addCivilDays(weekStart, 7))}`}
            className="rounded-lg border border-line bg-surface px-3 py-1.5 hover:border-line-2"
          >
            →
          </Link>
        </nav>
      </div>

      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-ink-2">
          {canBook ? (
            <>Click any open time to book it.</>
          ) : user ? (
            // Everyone signed in who isn't a student is an instructor or admin.
            <>
              Viewing the schedule.{" "}
              <Link
                href={`/classes?instrument=${slug}`}
                className="font-semibold underline underline-offset-4"
              >
                Reserve {instrument.name} for a class
              </Link>
            </>
          ) : (
            <>
              <Link href="/dev-login" className="underline underline-offset-4">
                Sign in
              </Link>{" "}
              to book time.
            </>
          )}
        </p>
        <ul className="flex flex-wrap gap-3 text-xs text-ink-3">
          <Legend className="bg-ok-soft border-line-2">Open</Legend>
          <Legend className="bg-surface border-line-2">Booked</Legend>
          <Legend className="bg-mine border-mine">Yours</Legend>
          <Legend className="stripes-class border-gold">Class</Legend>
          <Legend className="stripes-maintenance border-line-2">Maintenance</Legend>
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
        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium">
            {myBookings.length > 0 ? "Your bookings this week" : "Bookable hours"}
          </h2>

          {myBookings.length > 0 ? (
            <ul className="mt-3 space-y-3 text-sm">
              {myBookings.map((booking) => (
                <li
                  key={booking.id}
                  className="flex items-start justify-between gap-4 border-b border-line pb-3 last:border-0 last:pb-0"
                >
                  <div>
                    <div className="text-ink-2">
                      {formatRange(booking.startsAt, booking.endsAt)}
                    </div>
                    {booking.description && (
                      <div className="text-xs text-ink-3">
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
                  <dt className="text-ink-2">{window.name}</dt>
                  <dd className="text-right text-ink-3">
                    {minutesToClock(window.startMinute)}–
                    {minutesToClock(window.endMinute)}
                    {crossesMidnight(window) && (
                      <span className="text-ink-3"> next day</span>
                    )}
                    <div className="text-xs text-ink-3">
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

        <section className="rounded-xl border border-line bg-surface p-5">
          <h2 className="text-sm font-medium">Next available</h2>
          {openings.length === 0 ? (
            <p className="mt-3 text-sm text-ink-3">
              Nothing open in the next {instrument.bookingHorizonDays} days.
            </p>
          ) : (
            <ul className="mt-3 space-y-2 text-sm">
              {openings.map((opening) => (
                <li
                  key={opening.start.toISOString()}
                  className="flex justify-between gap-4"
                >
                  <span className="text-ink-2">
                    {formatRange(opening.start, opening.end)}
                  </span>
                  <span className="shrink-0 text-xs text-ink-3">
                    {opening.windowName}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {user?.role === "ADMIN" && (
        <details className="rounded-xl border border-line bg-surface p-5">
          <summary className="cursor-pointer text-sm font-medium">
            Show this calendar on the department&apos;s website
          </summary>
          <p className="mt-3 text-sm text-ink-2">
            Paste this where the Google Calendar embed used to be. It shows booked and open
            time without names, and its button opens this page to book. Only nku.edu pages
            can display it.{" "}
            <a
              href={`/embed/${slug}`}
              target="_blank"
              rel="noopener"
              className="font-semibold underline underline-offset-4"
            >
              Preview
            </a>
          </p>
          <pre className="mt-3 overflow-x-auto rounded-lg bg-sunken p-3 text-xs text-ink">
            <code>{`<iframe src="${env.APP_URL}/embed/${slug}" title="${instrument.name} availability" width="100%" height="800" style="border:0" loading="lazy"></iframe>`}</code>
          </pre>
          <p className="mt-2 text-xs text-ink-3">
            Add <code>?view=month</code> to the address for a month view like Google
            Calendar&apos;s.
          </p>
        </details>
      )}
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
