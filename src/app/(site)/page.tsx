import Link from "next/link";
import { db } from "@/lib/db";
import { getSession } from "@/lib/auth";
import { findOpenings } from "@/lib/booking/availability";
import { windowSpanMinutes } from "@/lib/booking/windows";
import {
  compareCivil,
  formatClockRange,
  formatDayLabel,
  instantToCivil,
  instantToMinutes,
  minutesToClock,
  todayCivil,
} from "@/lib/time";
import { windowDays, windowHours, windowRule } from "@/lib/window-copy";
import { ButtonLink, Card, Chip, InstrumentTile } from "@/components/ui";

/** "Today 14:00", "Mon 09:00", or a date further out. */
function nextOpenLabel(start: Date): string {
  const days = compareCivil(instantToCivil(start), todayCivil()) / 86_400_000;
  const clock = minutesToClock(instantToMinutes(start));
  if (days === 0) return `Today ${clock}`;
  if (days < 7) return `${formatDayLabel(start).split(",")[0]} ${clock}`;
  return `${formatDayLabel(start)} ${clock}`;
}

/** The "Instruments (home)" artboard. */
export default async function HomePage() {
  const now = new Date();
  const [user, instruments] = await Promise.all([
    getSession(),
    db.instrument.findMany({
      where: { isActive: true },
      include: { windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
      orderBy: { name: "asc" },
    }),
  ]);

  const [profile, upcoming, nextOpen] = await Promise.all([
    user
      ? db.user.findUnique({ where: { id: user.id }, select: { advisor: { select: { name: true } } } })
      : null,
    user
      ? db.booking.findMany({
          where: { userId: user.id, status: "CONFIRMED", endsAt: { gt: now } },
          include: {
            instrument: { select: { name: true, slug: true, color: true } },
            window: { select: { name: true } },
            advisor: { select: { name: true } },
          },
          orderBy: { startsAt: "asc" },
          take: 6,
        })
      : [],
    // The soonest opening of the shortest bookable length, per instrument.
    Promise.all(
      instruments.map(async (instrument) => {
        const shortest = Math.min(
          ...instrument.windows.map((w) => (w.wholeBlockOnly ? windowSpanMinutes(w) : w.minDurationMinutes)),
        );
        if (!Number.isFinite(shortest)) return null;
        const [opening] = await findOpenings({ instrumentId: instrument.id, durationMinutes: shortest, limit: 1 });
        return opening ?? null;
      }),
    ),
  ]);

  return (
    <div className="pt-2">
      <div className="flex flex-wrap items-end justify-between gap-x-8 gap-y-4">
        <div className="max-w-[640px]">
          <h1 className="text-[40px] leading-[1.1] font-extrabold tracking-[-0.025em]">Instruments</h1>
          <p className="mt-2.5 text-lg leading-normal text-ink-2">
            Pick an instrument to see its week and reserve time. Each one keeps its own hours and
            rules.
          </p>
        </div>
        {user && (
          <p className="text-sm text-ink-3">
            Signed in as <strong className="font-bold text-ink">{user.name}</strong>
            {profile?.advisor && <> · {profile.advisor.name}</>}
          </p>
        )}
      </div>

      {upcoming.length > 0 && (
        <section aria-labelledby="upcoming-h" className="mt-10">
          <div className="flex flex-wrap items-baseline justify-between gap-3">
            <h2 id="upcoming-h" className="text-xl font-bold tracking-[-0.01em]">
              Your upcoming bookings
            </h2>
            <Link
              href="/my-bookings"
              className="text-[15px] font-semibold decoration-gold decoration-2 underline-offset-4"
            >
              All my bookings
            </Link>
          </div>
          <ul className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(260px,1fr))] gap-3.5">
            {upcoming.map((b) => (
              <Card as="li" key={b.id} className="flex items-start gap-3.5 px-[18px] py-4">
                <InstrumentTile name={b.instrument.name} color={b.instrument.color} />
                <div className="min-w-0">
                  <p className="text-[13px] font-semibold text-ink-3">{b.instrument.name}</p>
                  <p className="mt-0.5 text-lg font-bold">{formatDayLabel(b.startsAt)}</p>
                  <p className="mt-0.5 text-[15px] font-semibold text-ink-2 tabular-nums">
                    {formatClockRange(b.startsAt, b.endsAt)}
                  </p>
                  <p className="mt-1.5 text-[13px] text-ink-3">
                    {[b.window?.name ?? (b.type === "CLASS" ? "Class" : null), b.advisor?.name]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                </div>
              </Card>
            ))}
          </ul>
        </section>
      )}

      <section aria-labelledby="all-h" className="mt-11">
        <h2 id="all-h" className="text-xl font-bold tracking-[-0.01em]">
          All instruments
        </h2>

        {instruments.length === 0 ? (
          <p className="mt-4 rounded-2xl border border-dashed border-line-2 p-8 text-center text-ink-3">
            No instruments yet. Run <code className="font-mono">npm run db:seed</code> to load the
            sample set.
          </p>
        ) : (
          <div className="mt-4 grid grid-cols-[repeat(auto-fill,minmax(min(340px,100%),1fr))] gap-5">
            {instruments.map((instrument, i) => {
              const chips = [
                instrument.windows.some((w) => w.wholeBlockOnly) && "Overnight blocks",
                instrument.windows.some(
                  (w) => !w.wholeBlockOnly && (w.daysOfWeek.includes("SAT") || w.daysOfWeek.includes("SUN")),
                ) && "Weekends",
                instrument.requireResearchAdvisor ? "Research group required" : "No research group needed",
              ].filter((c): c is string => Boolean(c));
              const opening = nextOpen[i];

              return (
                <Card as="article" raised key={instrument.id} className="flex flex-col">
                  <div className="flex items-start gap-3.5 px-[22px] pt-[22px]">
                    <InstrumentTile name={instrument.name} color={instrument.color} size="lg" />
                    <div className="min-w-0">
                      <h3 className="text-xl leading-tight font-bold tracking-[-0.01em]">{instrument.name}</h3>
                      {instrument.location && (
                        <p className="mt-1 flex items-center gap-1.5 text-sm font-medium text-ink-2">
                          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                            <path d="M12 21s-7-6.2-7-11a7 7 0 0 1 14 0c0 4.8-7 11-7 11z" />
                            <circle cx="12" cy="10" r="2.5" />
                          </svg>
                          {instrument.location}
                        </p>
                      )}
                    </div>
                  </div>

                  {instrument.description && (
                    <p className="mx-[22px] mt-3.5 text-[15px] leading-normal text-ink-2">{instrument.description}</p>
                  )}

                  <ul aria-label="Features" className="mx-[22px] mt-3.5 flex flex-wrap gap-1.5">
                    {chips.map((chip) => (
                      <li key={chip}>
                        <Chip>{chip}</Chip>
                      </li>
                    ))}
                  </ul>

                  <ul aria-label="Bookable hours" className="mx-[22px] mt-4 border-t border-line">
                    {instrument.windows.map((w) => (
                      <li key={w.id} className="grid grid-cols-[minmax(0,1fr)_auto] gap-x-3 gap-y-0.5 border-b border-line py-[11px]">
                        <span className="text-[15px] font-bold">{w.name}</span>
                        <span className="text-right text-[15px] font-semibold tabular-nums">{windowHours(w)}</span>
                        <span className="text-[13px] text-ink-3">{windowDays(w)}</span>
                        <span className="text-right text-[13px] text-ink-3">{windowRule(w)}</span>
                      </li>
                    ))}
                  </ul>

                  <div className="mt-auto flex flex-wrap items-center justify-between gap-3 px-[22px] pt-4 pb-5">
                    <p className="flex items-center gap-2 text-sm text-ink-3">
                      <span aria-hidden="true" className={`size-[9px] rounded-full ${opening ? "bg-ok" : "bg-line-2"}`} />
                      {opening ? (
                        <>
                          Next open <strong className="font-bold text-ink tabular-nums">{nextOpenLabel(opening.start)}</strong>
                        </>
                      ) : (
                        `Nothing open in the next ${instrument.bookingHorizonDays} days`
                      )}
                    </p>
                    <ButtonLink variant="secondary" href={`/instruments/${instrument.slug}`}>
                      View schedule
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="M5 12h14M13 6l6 6-6 6" />
                      </svg>
                    </ButtonLink>
                  </div>
                </Card>
              );
            })}
          </div>
        )}
      </section>

      <p className="mt-12 border-t border-line pt-5 text-sm leading-relaxed text-ink-3">
        Questions about an instrument or its rules? Contact the instrument manager.
      </p>
    </div>
  );
}
