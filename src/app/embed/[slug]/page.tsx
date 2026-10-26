import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { db } from "@/lib/db";
import { env } from "@/lib/env";
import { expandWindows } from "@/lib/booking/windows";
import {
  addCivilDays,
  civilToISODate,
  civilToInstant,
  formatTimeOnly,
  parseISODate,
  todayCivil,
  type CivilDate,
} from "@/lib/time";
import { campusDays, sundayOf, weekRangeLabel, type CampusDay } from "@/lib/week";
import { WeekGrid } from "@/components/week-grid";
import { buttonClass } from "@/components/ui";
import { buildScheduleView, type ScheduleBooking } from "@/lib/schedule-view";
import { DayAgenda } from "@/components/day-agenda";
import { buildAgenda } from "@/lib/agenda";

export const metadata: Metadata = {
  title: "Instrument availability — NKU Chemistry",
  // A fragment of the department's page, not a page of its own.
  robots: { index: false, follow: false },
};

type View = "week" | "month";
type Theme = "light" | "dark" | "auto";

const MAX_PER_DAY = 3;

/**
 * Read-only availability for one instrument, sized to sit in an iframe on the
 * department's Instrument Schedules page — the replacement for the Google Calendar
 * embeds.
 *
 * Public and sign-in free on purpose: browsers withhold this app's cookies inside a
 * frame on another site, and anyone on the internet can load it. So it shows *that*
 * time is taken, never by whom — the query below doesn't even select the owner.
 * Class titles are shown; they are what tells a student the gap is a lab.
 *
 * Framing is allowed only from nku.edu; see `headers()` in next.config.ts.
 */
export default async function EmbedPage({
  params,
  searchParams,
}: PageProps<"/embed/[slug]">) {
  const { slug } = await params;
  const query = await searchParams;

  const view: View = query.view === "month" ? "month" : "week";
  const theme: Theme =
    query.theme === "dark" || query.theme === "auto" ? query.theme : "light";

  const instrument = await db.instrument.findUnique({
    where: { slug },
    include: { windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!instrument || !instrument.isActive) notFound();

  const today = todayCivil();
  const anchor =
    (typeof query.date === "string" ? parseISODate(query.date) : null) ?? today;

  // Week: the Sunday-to-Saturday containing the anchor. Month: whole weeks covering it.
  const monthFirst = { y: anchor.y, m: anchor.m, d: 1 };
  const nextMonthFirst =
    anchor.m === 12 ? { y: anchor.y + 1, m: 1, d: 1 } : { y: anchor.y, m: anchor.m + 1, d: 1 };
  const gridStart = sundayOf(view === "week" ? anchor : monthFirst);
  const gridEnd =
    view === "week" ? addCivilDays(gridStart, 7) : sundayOf(addCivilDays(nextMonthFirst, 6));
  const dayCount = Math.round(
    (Date.UTC(gridEnd.y, gridEnd.m - 1, gridEnd.d) -
      Date.UTC(gridStart.y, gridStart.m - 1, gridStart.d)) /
      86_400_000,
  );
  const days = campusDays(gridStart, dayCount, today);

  const rangeStart = civilToInstant(gridStart, 0);
  const rangeEnd = civilToInstant(gridEnd, 0);

  const bookings = await db.booking.findMany({
    where: {
      instrumentId: instrument.id,
      status: "CONFIRMED",
      startsAt: { lt: rangeEnd },
      endsAt: { gt: rangeStart },
    },
    // Deliberately no user, description or research group.
    select: { id: true, startsAt: true, endsAt: true, type: true, title: true },
    orderBy: { startsAt: "asc" },
  });

  const label = (b: (typeof bookings)[number]) =>
    b.type === "MAINTENANCE" ? "Maintenance" : b.type === "CLASS" ? (b.title ?? "Class") : "Booked";

  const blocks: ScheduleBooking[] = bookings.map((b) => ({
    id: b.id,
    start: b.startsAt,
    end: b.endsAt,
    label: label(b),
    tone: b.type === "MAINTENANCE" ? "maintenance" : b.type === "CLASS" ? "class" : "student",
  }));

  // The same grid the app uses, minus anything clickable.
  const weekView =
    view === "week"
      ? buildScheduleView({ weekStart: gridStart, today, windows: instrument.windows, bookings: blocks, slots: [] })
      : null;

  // A day early, so an overnight window opening Saturday still shades Sunday morning.
  const occurrences = expandWindows(instrument.windows, addCivilDays(gridStart, -1), gridEnd);

  // Phones get a day-at-a-time list instead of the seven-column grid. Both are
  // rendered and CSS picks one by the frame's width.
  const agenda =
    view === "week"
      ? buildAgenda({
          days,
          occurrences,
          bookings: blocks,
          now: new Date(),
        })
      : [];
  // The requested date (e.g. tapped in month view) or today, else the first day with room.
  const initialDay =
    agenda.find((d) => d.key === civilToISODate(anchor)) ??
    agenda.find((d) => d.hasOpen) ??
    agenda[0];

  const href = (changes: { date?: CivilDate; view?: View }) => {
    const next = new URLSearchParams();
    const v = changes.view ?? view;
    if (v !== "week") next.set("view", v);
    if (changes.date) next.set("date", civilToISODate(changes.date));
    if (theme !== "light") next.set("theme", theme);
    const qs = next.toString();
    return `/embed/${slug}${qs ? `?${qs}` : ""}`;
  };

  const step = (direction: -1 | 1): CivilDate =>
    view === "week"
      ? addCivilDays(gridStart, 7 * direction)
      : direction === 1
        ? nextMonthFirst
        : anchor.m === 1
          ? { y: anchor.y - 1, m: 12, d: 1 }
          : { y: anchor.y, m: anchor.m - 1, d: 1 };

  const heading =
    view === "week"
      ? weekRangeLabel(gridStart)
      : new Date(Date.UTC(anchor.y, anchor.m - 1, 1)).toLocaleDateString("en-US", {
          month: "long",
          year: "numeric",
          timeZone: "UTC",
        });

  const zoneName =
    new Intl.DateTimeFormat("en-US", { timeZone: env.CAMPUS_TIMEZONE, timeZoneName: "longGeneric" })
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName")?.value ?? env.CAMPUS_TIMEZONE;

  const control = buttonClass({ variant: "secondary" });

  return (
    <div
      data-theme={theme === "auto" ? undefined : theme}
      className="min-h-screen bg-bg p-3 font-sans text-ink sm:p-4"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <h1 className="flex items-center gap-2 text-lg font-bold">
            <span
              aria-hidden
              className="size-3 flex-none rounded-full"
              style={{ backgroundColor: instrument.color }}
            />
            {instrument.name}
          </h1>
          {instrument.location && <p className="text-sm text-ink-3">{instrument.location}</p>}
        </div>
        {/* A new tab: booking needs sign-in, which can't happen inside the frame. */}
        <a
          href={`/instruments/${slug}`}
          target="_blank"
          rel="noopener"
          className={buttonClass()}
        >
          Book this instrument
          <span className="sr-only"> (opens in a new tab)</span>
        </a>
      </div>

      <nav aria-label="Calendar" className="mt-3 flex flex-wrap items-center gap-2">
        <Link href={href({})} className={control}>
          Today
        </Link>
        <Link href={href({ date: step(-1) })} className={control} aria-label={`Previous ${view}`}>
          ‹
        </Link>
        <Link href={href({ date: step(1) })} className={control} aria-label={`Next ${view}`}>
          ›
        </Link>
        <p className="mr-auto px-1 text-base font-semibold" aria-live="polite">
          {heading}
        </p>
        <div role="group" aria-label="View" className="flex gap-0.5 rounded-xl bg-sunken p-[3px]">
          {(["week", "month"] as const).map((v) => (
            <Link
              key={v}
              href={href({ view: v, date: anchor })}
              aria-current={v === view ? "page" : undefined}
              className={`inline-flex min-h-9 items-center rounded-[9px] px-3 text-sm font-semibold capitalize no-underline ${
                v === view ? "bg-surface text-ink shadow-sm" : "text-ink-2"
              }`}
            >
              {v}
            </Link>
          ))}
        </div>
      </nav>

      <div className="mt-3">
        {view === "week" ? (
          <>
            <div className="sm:hidden">
              <DayAgenda days={agenda} initialKey={initialDay.key} embedSlug={slug} />
            </div>
            <div className="hidden sm:block">
              <WeekGrid view={weekView!} />
            </div>
          </>
        ) : (
          <MonthGrid days={days} month={anchor.m} blocks={blocks} weekHref={(d) => href({ view: "week", date: d })} />
        )}
      </div>

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 text-xs text-ink-3">
        {/* The phone list labels its own entries; these swatches describe the grid. */}
        <ul className={`flex-wrap gap-3 ${view === "week" ? "hidden sm:flex" : "flex"}`}>
          <Swatch className="bg-surface border-line-2">Booked</Swatch>
          <Swatch className="stripes-class border-gold">Class</Swatch>
          <Swatch className="stripes-maintenance border-line-2">Maintenance</Swatch>
          {view === "week" && <Swatch className="bg-sunken border-line">Not bookable</Swatch>}
        </ul>
        <p>Times shown in {zoneName} · NKU Chemistry Instrument Calendar</p>
      </div>
    </div>
  );
}


const DOT: Record<"student" | "class" | "maintenance", string> = {
  student: "border border-ink-3 bg-surface",
  class: "bg-gold",
  maintenance: "stripes-maintenance border border-line-2",
};

const TONE: Record<ScheduleBooking["tone"], string> = {
  student: "text-ink-2",
  mine: "text-ink-2",
  class: "font-semibold text-gold-ink",
  maintenance: "text-ink-3",
};

/**
 * The Google Calendar month layout people are used to: each day lists what is taken.
 * A booking spanning midnight is listed on the day it starts.
 *
 * On a phone there's no room for entries, so each day shows a marker per kind of
 * booking instead, and the date links to that day in the week view's day list.
 */
function MonthGrid({
  days,
  month,
  blocks,
  weekHref,
}: {
  days: CampusDay[];
  month: number;
  blocks: ScheduleBooking[];
  weekHref: (date: CivilDate) => string;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-line bg-surface">
      <div className="grid grid-cols-7 sm:min-w-[640px]">
        {days.slice(0, 7).map((d) => (
          <div key={d.weekday} className="border-b border-line px-2 py-1.5 text-center text-xs font-semibold text-ink-3 uppercase">
            {d.weekday}
          </div>
        ))}
        {days.map((day) => {
          const items = blocks.filter((b) => b.start >= day.start && b.start < day.end);
          const outside = day.date.m !== month;
          const tones = (["student", "class", "maintenance"] as const).filter((t) =>
            items.some((b) => b.tone === t),
          );
          const summary =
            items.length === 0
              ? "nothing booked"
              : `${items.length} booking${items.length === 1 ? "" : "s"}`;
          return (
            <div
              key={day.key}
              className={`min-h-14 border-b border-l border-line p-1 sm:min-h-24 sm:p-1.5 [&:nth-child(7n+1)]:border-l-0 ${
                outside ? "bg-surface-2" : ""
              }`}
            >
              <div className="flex justify-center">
                <Link
                  href={weekHref(day.date)}
                  aria-label={`${day.weekday} ${day.dayOfMonth}${day.isToday ? ", today" : ""}: ${summary}`}
                  className={`flex size-9 items-center justify-center rounded-full text-sm no-underline sm:size-7 ${
                    day.isToday
                      ? "bg-gold font-bold text-on-gold"
                      : outside
                        ? "text-ink-3 hover:bg-sunken"
                        : "font-medium text-ink hover:bg-sunken"
                  }`}
                >
                  {day.dayOfMonth}
                </Link>
              </div>
              {tones.length > 0 && (
                <div aria-hidden="true" className="mt-1 flex justify-center gap-1 sm:hidden">
                  {tones.map((t) => (
                    <span key={t} className={`size-2 rounded-full ${DOT[t]}`} />
                  ))}
                </div>
              )}
              {items.length > 0 && (
                <ul className="mt-1 hidden space-y-0.5 text-xs leading-snug sm:block">
                  {items.slice(0, MAX_PER_DAY).map((b) => (
                    <li key={b.id} className={`truncate ${TONE[b.tone]}`} title={`${formatTimeOnly(b.start)} ${b.label}`}>
                      <span className="tabular-nums">{formatTimeOnly(b.start)}</span> {b.label}
                    </li>
                  ))}
                  {items.length > MAX_PER_DAY && (
                    <li>
                      <Link href={weekHref(day.date)} className="text-ink-3 underline underline-offset-2">
                        +{items.length - MAX_PER_DAY} more
                      </Link>
                    </li>
                  )}
                </ul>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function Swatch({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-1.5">
      <span aria-hidden className={`size-3 rounded border ${className}`} />
      {children}
    </li>
  );
}
