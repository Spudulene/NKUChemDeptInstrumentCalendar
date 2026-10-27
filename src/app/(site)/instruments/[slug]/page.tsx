import Link from "next/link";
import { notFound } from "next/navigation";
import type { CSSProperties } from "react";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { env } from "@/lib/env";
import {
  addCivilDays,
  civilToISODate,
  civilToInstant,
  formatClockRange,
  formatDayLabel,
  formatDurationMinutes,
  formatRange,
  instantToCivil,
  parseISODate,
  todayCivil,
} from "@/lib/time";
import { weeklyAllowance } from "@/lib/booking/quota";
import { computeBookableSlots } from "@/lib/booking/slots";
import { instrumentRules } from "@/lib/booking/unbookable";
import { findOpenings } from "@/lib/booking/availability";
import { expandWindows, windowSpanMinutes } from "@/lib/booking/windows";
import { buildAgenda } from "@/lib/agenda";
import { buildScheduleView, type ScheduleBooking } from "@/lib/schedule-view";
import { campusDays, sundayOf, weekRangeLabel } from "@/lib/week";
import { windowDays, windowHours, windowRule, windowSummary } from "@/lib/window-copy";
import { BookingProvider, BookTimeButton } from "@/components/booking-provider";
import { CancelBookingButton } from "@/components/cancel-booking-button";
import { DayAgenda } from "@/components/day-agenda";
import { WeekGrid } from "@/components/week-grid";
import { ButtonLink, Card, InstrumentTile, Notice, buttonClass } from "@/components/ui";

/**
 * One instrument's week, from the "Week schedule" artboard: who has what, the rules,
 * and — for students — booking, by clicking open time or the "Book time" button.
 */
export default async function InstrumentPage({
  params,
  searchParams,
}: PageProps<"/instruments/[slug]">) {
  const { slug } = await params;
  const { week } = await searchParams;

  const [user, instrument, allInstruments] = await Promise.all([
    getSession(),
    db.instrument.findUnique({
      where: { slug },
      include: { windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
    }),
    db.instrument.findMany({
      where: { isActive: true },
      select: { slug: true, name: true, color: true },
      orderBy: { name: "asc" },
    }),
  ]);

  if (!instrument) notFound();

  const now = new Date();
  const today = todayCivil(now);
  const requested = typeof week === "string" ? parseISODate(week) : null;
  const weekStart = sundayOf(requested ?? today);
  const weekEnd = addCivilDays(weekStart, 7);
  const rangeStart = civilToInstant(weekStart, 0);
  const rangeEnd = civilToInstant(weekEnd, 0);
  const isThisWeek = civilToISODate(weekStart) === civilToISODate(sundayOf(today));

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
      ? db.user.findUnique({ where: { id: user.id }, select: { advisorId: true } })
      : Promise.resolve(null),
  ]);

  // Only students book here; instructors and admins reserve class time on /classes,
  // which can displace student bookings.
  const canBook = user?.role === "STUDENT";
  const isStaff = user?.role === "INSTRUCTOR" || user?.role === "ADMIN";

  // Open time that no one can book says why, for every viewer: the rules are the same
  // for all students, so this isn't about who is looking.
  const { rules, limits, explain: explainForAll } = instrumentRules({
    instrument,
    busy: bookings.map((b) => ({ start: b.startsAt, end: b.endsAt })),
    from: rangeStart,
    to: rangeEnd,
    now,
  });

  // The signed-in student's own week. The weekly caps count bookings that start in it,
  // so an overnight carried over from last Saturday doesn't.
  const mine = user ? bookings.filter((b) => b.user.id === user.id) : [];
  const mineThisWeek = mine.filter((b) => b.startsAt >= rangeStart);
  const allowance = weeklyAllowance({
    instrumentName: instrument.name,
    maxMinutesPerWeek: instrument.maxMinutesPerUserPerWeek,
    windows: instrument.windows,
    mine: mineThisWeek.map((b) => ({ windowId: b.windowId, start: b.startsAt, end: b.endsAt })),
  });

  // Only what this student's caps allow is offered, so nothing they pick gets refused
  // for a limit on submit. Time the caps rule out says so, after the reasons that hold
  // for everyone.
  const openToAll = canBook
    ? computeBookableSlots({
        ...rules,
        earliest: new Date(Math.max(rangeStart.getTime(), rules.earliest.getTime())),
      })
    : [];
  const slots = allowance.apply(openToAll);
  const explain: typeof explainForAll = canBook
    ? (gap, window) => explainForAll(gap, window) ?? allowance.explain(window)
    : explainForAll;
  // Timed windows in the grid have no cell to say this in, so it goes above the grid.
  const limitNotices = canBook
    ? [
        ...new Set(
          instrument.windows
            .filter((w) => !w.wholeBlockOnly)
            .map((w) => allowance.explain(w)?.detail)
            .filter((detail): detail is string => !!detail),
        ),
      ]
    : [];

  const scheduleBookings: ScheduleBooking[] = bookings.map((booking) => {
    const mine = user?.id === booking.user.id;
    return {
      id: booking.id,
      start: booking.startsAt,
      end: booking.endsAt,
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

  const view = buildScheduleView({
    weekStart,
    today,
    windows: instrument.windows,
    bookings: scheduleBookings,
    slots,
    explain,
    limits,
  });

  // Phones get the day-at-a-time list instead of the seven-column grid ("Phone · Day
  // schedule"). Both are rendered and CSS picks one by width. A day early, so an
  // overnight window opening Saturday still counts against Sunday morning.
  const agenda = buildAgenda({
    days: campusDays(weekStart, 7, today),
    occurrences: expandWindows(instrument.windows, addCivilDays(weekStart, -1), weekEnd),
    bookings: scheduleBookings,
    slots,
    explain,
    now,
  });
  const initialDay =
    agenda.find((d) => d.isToday) ?? agenda.find((d) => d.hasOpen) ?? agenda[0];

  // "Book time" opens the soonest slot in view; with none this week, it points at the
  // week holding the next opening instead. If this week has openings the student's
  // limits rule out, that's after this week, when the limits reset.
  const firstSlot = slots.find((s) => s.start > now) ?? null;
  const cappedOut = openToAll.some((s) => s.start > now);
  const shortest = Math.min(
    ...instrument.windows.map((w) => (w.wholeBlockOnly ? windowSpanMinutes(w) : w.minDurationMinutes)),
  );
  const nextOpening =
    canBook && !firstSlot
      ? (
          await findOpenings({
            instrumentId: instrument.id,
            durationMinutes: Number.isFinite(shortest) ? shortest : 60,
            ...(cappedOut && { from: rangeEnd }),
            limit: 1,
          })
        )[0]
      : undefined;

  // How much of each cap the student has used.
  const usage = canBook
    ? [
        ...instrument.windows
          .filter((w) => w.maxBookingsPerUserPerWeek)
          .map((w) => ({
            label: `${w.name} bookings`,
            used: mineThisWeek.filter((b) => b.windowId === w.id).length,
            cap: w.maxBookingsPerUserPerWeek!,
            unit: "",
          })),
        ...(instrument.maxMinutesPerUserPerWeek
          ? [
              {
                label: "Hours this week",
                // Whole-block windows have their own count above, not hours.
                used:
                  mineThisWeek
                    .filter((b) => !instrument.windows.some((w) => w.wholeBlockOnly && w.id === b.windowId))
                    .reduce((sum, b) => sum + (b.endsAt.getTime() - b.startsAt.getTime()) / 60_000, 0) / 60,
                cap: instrument.maxMinutesPerUserPerWeek / 60,
                unit: " h",
              },
            ]
          : []),
      ]
    : [];
  const upcomingMine = mine.filter((b) => b.endsAt > now);
  const blockNames = instrument.windows.filter((w) => w.wholeBlockOnly).map((w) => w.name);

  const weekHref = (start: typeof weekStart) => `/instruments/${slug}?week=${civilToISODate(start)}`;
  const navButton = buttonClass({ variant: "secondary", size: "icon" });

  // The student's main action: book the soonest open slot, or go to the week with one.
  const bookAction = (className: string) =>
    firstSlot ? (
      <BookTimeButton slot={firstSlot} className={className} />
    ) : nextOpening ? (
      <Link href={weekHref(sundayOf(instantToCivil(nextOpening.start)))} className={className}>
        Next open: {formatRange(nextOpening.start, nextOpening.end).split(" – ")[0]}
      </Link>
    ) : null;

  const page = (
    <div className={canBook ? "pb-24 sm:pb-0" : undefined}>
      <nav aria-label="Breadcrumb" className="text-sm text-ink-3">
        <Link href="/" className="font-semibold text-ink-2">
          Instruments
        </Link>
        <span aria-hidden="true" className="mx-2">
          /
        </span>
        <span aria-current="page" className="text-ink">
          {instrument.name}
        </span>
      </nav>

      {allInstruments.length > 1 && (
        // One scrolling row on phones, so the schedule starts higher up.
        <nav aria-label="Switch instrument" className="mt-4 flex gap-2 overflow-x-auto [scrollbar-width:none] sm:flex-wrap sm:overflow-visible">
          {allInstruments.map((other) => {
            const current = other.slug === slug;
            return (
              <Link
                key={other.slug}
                href={`/instruments/${other.slug}${isThisWeek ? "" : `?week=${civilToISODate(weekStart)}`}`}
                aria-current={current ? "page" : undefined}
                style={{ "--inst": other.color } as CSSProperties}
                className={`inline-flex min-h-10 flex-none items-center gap-2 rounded-full px-3.5 text-sm font-semibold whitespace-nowrap no-underline ${
                  current ? "bg-ink text-bg" : "bg-surface text-ink-2 shadow-[inset_0_0_0_1px_var(--ui-border)] hover:text-ink"
                }`}
              >
                <span aria-hidden="true" className="inst-dot size-2.5 rounded-full" />
                {other.name}
              </Link>
            );
          })}
        </nav>
      )}

      <div className="mt-4 flex flex-wrap items-center justify-between gap-4 sm:mt-5">
        <div className="flex min-w-0 items-center gap-3 sm:gap-4">
          <span className="sm:hidden">
            <InstrumentTile name={instrument.name} color={instrument.color} size="md" />
          </span>
          <span className="hidden sm:block">
            <InstrumentTile name={instrument.name} color={instrument.color} size="lg" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl leading-tight font-extrabold tracking-[-0.02em] sm:text-[32px]">{instrument.name}</h1>
            <p className="mt-0.5 text-sm text-ink-2 sm:mt-1 sm:text-[15px]">
              {[instrument.location, instrument.requireResearchAdvisor && "Research group required"]
                .filter(Boolean)
                .join(" · ")}
            </p>
          </div>
        </div>

        {canBook ? (
          // On phones this moves to the bar along the bottom of the screen.
          <div className="hidden sm:block">{bookAction(buttonClass({ size: "lg" }))}</div>
        ) : isStaff ? (
          <ButtonLink size="lg" href={`/classes?instrument=${slug}`}>
            Reserve for a class
          </ButtonLink>
        ) : (
          !user &&
          env.ENABLE_DEV_LOGIN && (
            <ButtonLink size="lg" href="/dev-login">
              Sign in to book
            </ButtonLink>
          )
        )}
      </div>

      <div className="mt-6 flex flex-wrap items-start gap-6">
        <section aria-label={`Week of ${weekRangeLabel(weekStart)}`} className="min-w-0 flex-[999_1_640px]">
          <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Link href={weekHref(addCivilDays(weekStart, -7))} aria-label="Previous week" className={navButton}>
                <Chevron direction="left" />
              </Link>
              <Link href={weekHref(addCivilDays(weekStart, 7))} aria-label="Next week" className={navButton}>
                <Chevron direction="right" />
              </Link>
              <h2 className="ml-1.5 text-xl font-bold tracking-[-0.01em]">{weekRangeLabel(weekStart)}</h2>
              {!isThisWeek && (
                <Link href={`/instruments/${slug}`} className="ml-1 text-sm font-semibold text-ink-2 underline underline-offset-4">
                  This week
                </Link>
              )}
            </div>
            {/* The phone list labels its own entries; the legend describes the grid. */}
            <ul aria-label="Legend" className="hidden flex-wrap gap-x-4 gap-y-1.5 text-[13px] font-medium text-ink-2 sm:flex">
              {canBook && <Swatch className="bg-mine">Yours</Swatch>}
              <Swatch className="bg-surface shadow-[inset_0_0_0_1px_var(--ui-border2)]">Booked</Swatch>
              <Swatch className="stripes-class shadow-[inset_0_0_0_2px_var(--ui-gold)]">Class</Swatch>
              <Swatch className="stripes-maintenance shadow-[inset_0_0_0_1px_var(--ui-border2)]">Maintenance</Swatch>
              <Swatch className="bg-sunken">Not bookable</Swatch>
            </ul>
          </div>

          {limitNotices.length > 0 && (
            <Notice tone="info" title="Weekly limit" className="mb-3">
              {limitNotices.map((detail) => (
                <p key={detail}>{detail}</p>
              ))}
            </Notice>
          )}

          <div className="sm:hidden">
            <DayAgenda
              days={agenda}
              initialKey={initialDay.key}
              usage={usage.map((u) => `${u.label}: ${Number(u.used.toFixed(1))} of ${u.cap}${u.unit}`).join(" · ")}
            />
          </div>
          <div className="hidden sm:block">
            <WeekGrid view={view} />
          </div>

          <p className="mx-0.5 mt-2.5 text-[13px] text-ink-3">
            {canBook
              ? "Choose any open time to book it. "
              : ""}
            {user
              ? "You can see who has each slot so you know who to ask about a conflict — but not what they're running."
              : "Sign in to see who has each slot."}
          </p>
        </section>

        <aside className="flex min-w-0 flex-[1_1_280px] flex-col gap-4">
          {canBook && (
            <Card as="section" aria-labelledby="week-h" className="p-5">
              <h2 id="week-h" className="text-base font-bold">
                Your week on this instrument
              </h2>
              {usage.map((u) => (
                <div key={u.label} className="mt-4">
                  <div className="flex justify-between text-sm">
                    <span className="text-ink-2">{u.label}</span>
                    <strong>
                      {Number(u.used.toFixed(1))} of {u.cap}
                      {u.unit}
                    </strong>
                  </div>
                  <div
                    role="progressbar"
                    aria-label={u.label}
                    aria-valuemin={0}
                    aria-valuemax={u.cap}
                    aria-valuenow={u.used}
                    className="mt-2 h-2 overflow-hidden rounded-full bg-sunken"
                  >
                    <div className="h-full rounded-full bg-mine" style={{ width: `${Math.min(100, (u.used / u.cap) * 100)}%` }} />
                  </div>
                </div>
              ))}
              {upcomingMine.length > 0 ? (
                <ul className={`flex flex-col gap-3 ${usage.length ? "mt-[18px] border-t border-line pt-3.5" : "mt-3"}`}>
                  {upcomingMine.map((b) => (
                    <li key={b.id} className="flex items-start justify-between gap-3 text-sm">
                      <div>
                        <div>
                          <span className="font-semibold">{formatDayLabel(b.startsAt)}</span>{" "}
                          <span className="whitespace-nowrap text-ink-2 tabular-nums">{formatClockRange(b.startsAt, b.endsAt)}</span>
                        </div>
                        {b.description && <div className="text-xs text-ink-3">{b.description}</div>}
                      </div>
                      <CancelBookingButton bookingId={b.id} />
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-3 text-sm text-ink-3">Nothing booked this week.</p>
              )}
            </Card>
          )}

          <Card as="section" aria-labelledby="rules-h" className="p-5">
            <h2 id="rules-h" className="text-base font-bold">
              How booking works here
            </h2>
            <ul className="mt-3.5 flex flex-col gap-3.5">
              {instrument.windows.map((w) => (
                <li key={w.id}>
                  <div className="flex items-baseline justify-between gap-x-3">
                    <strong className="text-[15px]">{w.name}</strong>
                    <span className="text-right text-[13px] text-ink-2 tabular-nums">
                      {windowDays(w)} · {windowHours(w)}
                    </span>
                  </div>
                  <p className="mt-1 text-[13px] leading-[1.45] text-ink-3">{windowRule(w)}</p>
                </li>
              ))}
            </ul>
            <ul className="mt-4 flex flex-col gap-1.5 border-t border-line pt-3.5 text-[13px] text-ink-2">
              <li>Each day opens for booking {instrument.bookingHorizonDays} days ahead</li>
              {instrument.minLeadTimeMinutes > 0 && (
                <li>Book at least {formatDurationMinutes(instrument.minLeadTimeMinutes)} ahead</li>
              )}
              <li>Cancel up to {formatDurationMinutes(instrument.cancellationDeadlineMinutes)} before start</li>
              {instrument.bufferMinutes > 0 && (
                <li>{formatDurationMinutes(instrument.bufferMinutes)} changeover between bookings</li>
              )}
              {instrument.maxMinutesPerUserPerWeek && (
                <li>
                  Up to {formatDurationMinutes(instrument.maxMinutesPerUserPerWeek)} per student per week
                  {blockNames.length > 0 && `, not counting ${blockNames.join(" or ")} blocks`}
                </li>
              )}
              <li>Class and maintenance blocks take priority</li>
            </ul>
          </Card>
        </aside>
      </div>

      {user?.role === "ADMIN" && (
        <Card as="section" className="mt-6 p-5">
          <details>
            <summary className="cursor-pointer text-[15px] font-bold">
              Show this calendar on the department&apos;s website
            </summary>
            <p className="mt-3 text-sm text-ink-2">
              Paste this where the Google Calendar embed used to be. It shows booked and open time
              without names, and its button opens this page to book. Only nku.edu pages can display
              it.{" "}
              <a href={`/embed/${slug}`} target="_blank" rel="noopener" className="font-semibold underline underline-offset-4">
                Preview
              </a>
            </p>
            <pre className="mt-3 overflow-x-auto rounded-[10px] bg-sunken p-3 text-xs text-ink">
              <code>{`<iframe src="${env.APP_URL}/embed/${slug}" title="${instrument.name} availability" width="100%" height="800" style="border:0" loading="lazy"></iframe>`}</code>
            </pre>
            <p className="mt-2 text-xs text-ink-3">
              Add <code>?view=month</code> to the address for a month view like Google Calendar&apos;s.
            </p>
          </details>
        </Card>
      )}

      {/* "Phone · Day schedule": the main action stays in reach while scrolling a day. */}
      {canBook && (firstSlot || nextOpening) && (
        <div className="fixed inset-x-0 bottom-0 z-40 border-t border-line bg-surface px-4 pt-3 pb-[max(1.375rem,env(safe-area-inset-bottom))] sm:hidden">
          {bookAction(`${buttonClass({ size: "lg" })} w-full`)}
        </div>
      )}
    </div>
  );

  if (!canBook) return page;

  return (
    <BookingProvider
      instrument={{ slug, name: instrument.name, location: instrument.location, color: instrument.color }}
      windowSummaries={Object.fromEntries(instrument.windows.map((w) => [w.id, windowSummary(w)]))}
      advisors={advisors}
      defaultAdvisorId={profile?.advisorId ?? null}
      advisorRequired={instrument.requireResearchAdvisor}
      timeZone={env.CAMPUS_TIMEZONE}
    >
      {page}
    </BookingProvider>
  );
}

function Chevron({ direction }: { direction: "left" | "right" }) {
  return (
    <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={direction === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} />
    </svg>
  );
}

function Swatch({ className, children }: { className: string; children: React.ReactNode }) {
  return (
    <li className="flex items-center gap-[7px]">
      <span aria-hidden="true" className={`size-3.5 flex-none rounded ${className}`} />
      {children}
    </li>
  );
}
