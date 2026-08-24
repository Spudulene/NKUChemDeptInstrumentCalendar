import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
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
import { findOpenings } from "@/lib/booking/availability";
import { WeekGrid, type GridBlock } from "@/components/week-grid";

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

  const today = todayCivil();
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

  const bookings = await db.booking.findMany({
    where: {
      instrumentId: instrument.id,
      status: "CONFIRMED",
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
    },
    include: { user: { select: { id: true, name: true } } },
    orderBy: { startsAt: "asc" },
  });

  // A day early, so an overnight window opening Saturday still shades Sunday morning.
  const occurrences = expandWindows(
    instrument.windows,
    addCivilDays(weekStart, -1),
    weekEnd,
  );

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

  const isCurrentWeek = compareCivil(weekStart, addCivilDays(today, -weekdayIndex)) === 0;

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
          Week of {civilToISODate(weekStart)}
          {isCurrentWeek && <span className="ml-2 text-stone-400">(this week)</span>}
        </p>
        <ul className="flex flex-wrap gap-3 text-xs text-stone-500">
          <Legend className="bg-emerald-50 border-emerald-200">Bookable</Legend>
          <Legend className="bg-stone-200 border-stone-300">Booked</Legend>
          <Legend className="bg-amber-100 border-amber-300">Class</Legend>
          <Legend className="bg-rose-100 border-rose-300">Maintenance</Legend>
        </ul>
      </div>

      <WeekGrid
        weekStart={weekStart}
        today={today}
        bands={occurrences.map((o) => ({
          id: o.window.id,
          start: o.start,
          end: o.end,
        }))}
        blocks={blocks}
      />

      <div className="grid gap-4 sm:grid-cols-2">
        <section className="rounded-xl border border-stone-200 bg-white p-5">
          <h2 className="text-sm font-medium">Bookable hours</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {instrument.windows.map((window) => (
              <div key={window.id} className="flex justify-between gap-4">
                <dt className="text-stone-600">{window.name}</dt>
                <dd className="text-right text-stone-500">
                  {minutesToClock(window.startMinute)}–{minutesToClock(window.endMinute)}
                  {crossesMidnight(window) && (
                    <span className="text-stone-400"> next day</span>
                  )}
                  <div className="text-xs text-stone-400">
                    {window.wholeBlockOnly
                      ? `one ${formatDurationMinutes(windowSpanMinutes(window))} block`
                      : `${formatDurationMinutes(window.minDurationMinutes)}–${formatDurationMinutes(window.maxDurationMinutes)}, ${formatDurationMinutes(window.slotSizeMinutes)} steps`}
                  </div>
                </dd>
              </div>
            ))}
          </dl>
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
          <p className="mt-4 border-t border-stone-100 pt-3 text-xs text-stone-400">
            Booking form is not built yet — the engine behind it is (see
            src/lib/booking/).
          </p>
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
