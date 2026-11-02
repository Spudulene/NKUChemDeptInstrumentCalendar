import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import {
  addCivilDays,
  civilToISODate,
  compareCivil,
  formatClockRange,
  formatDayLabel,
  instantToCivil,
  instantToMinutes,
  minutesToClock,
  todayCivil,
} from "@/lib/time";
import { CancelBookingButton } from "@/components/cancel-booking-button";
import { MaintenanceForm } from "@/components/maintenance-form";
import { Card, InstrumentTile } from "@/components/ui";

/** "Mon, Nov 3 · 08:00 – 12:00", or "Mon, Nov 3 08:00 → Wed, Nov 5 17:00" for a multi-day block. */
function blockLabel(start: Date, end: Date): string {
  const lastMinute = new Date(end.getTime() - 1);
  if (compareCivil(instantToCivil(start), instantToCivil(lastMinute)) === 0) {
    return `${formatDayLabel(start)} · ${formatClockRange(start, end)}`;
  }
  const clock = (i: Date) => minutesToClock(instantToMinutes(i));
  return `${formatDayLabel(start)} ${clock(start)} → ${formatDayLabel(end)} ${clock(end)}`;
}

export default async function MaintenancePage({ searchParams }: PageProps<"/admin/maintenance">) {
  const { instrument: requested } = await searchParams;
  const user = await getSession();
  if (user?.role !== "ADMIN") return null; // the layout explains

  const now = new Date();
  const [instruments, upcoming] = await Promise.all([
    db.instrument.findMany({
      where: { isActive: true },
      select: { id: true, name: true, slug: true, location: true },
      orderBy: { name: "asc" },
    }),
    db.booking.findMany({
      where: { type: "MAINTENANCE", status: "CONFIRMED", endsAt: { gt: now } },
      include: {
        instrument: { select: { name: true, color: true } },
        user: { select: { name: true } },
        _count: { select: { preempted: true } },
      },
      orderBy: { startsAt: "asc" },
    }),
  ]);

  const initial = instruments.find((i) => i.slug === requested) ?? instruments[0] ?? null;
  const today = todayCivil();

  return (
    <div className="flex flex-col gap-5">
      <div className="min-w-0">
        <p className="text-sm font-semibold text-ink-3">Department</p>
        <h1 className="mt-0.5 text-[32px] leading-tight font-extrabold tracking-[-0.02em]">Maintenance</h1>
        <p className="mt-1.5 max-w-[620px] text-[15px] leading-normal text-ink-2">
          Take an instrument out of service. You&apos;ll see exactly whose bookings are
          affected before anything is cancelled.
        </p>
      </div>

      {initial ? (
        <MaintenanceForm
          instruments={instruments}
          initialInstrumentId={initial.id}
          today={civilToISODate(today)}
          tomorrow={civilToISODate(addCivilDays(today, 1))}
          scheduledBy={user.name}
        />
      ) : (
        <p className="text-ink-2">There are no active instruments.</p>
      )}

      <section aria-labelledby="upcoming-h" className="mt-4">
        <h2 id="upcoming-h" className="text-lg font-bold">
          Upcoming maintenance
        </h2>
        {upcoming.length === 0 ? (
          <p className="mt-2 text-[15px] text-ink-3">Nothing scheduled from today on.</p>
        ) : (
          <>
            <p className="mt-1 max-w-[620px] text-sm text-ink-2">
              Cancelling frees the time. Bookings it already cancelled don&apos;t come back;
              those people were told to rebook.
            </p>
            <Card as="ul" className="mt-3 divide-y divide-line">
              {upcoming.map((b) => (
                <li key={b.id} className="flex flex-wrap items-center gap-x-4 gap-y-3 px-4 py-3.5 sm:px-5">
                  <div className="flex min-w-0 flex-[1_1_260px] items-start gap-3.5">
                    <InstrumentTile name={b.instrument.name} color={b.instrument.color} />
                    <div className="min-w-0">
                      <p className="text-[13px] font-semibold text-ink-3">
                        {b.instrument.name} · {b.user.name}
                      </p>
                      <p className="mt-0.5 text-base font-bold tabular-nums">{blockLabel(b.startsAt, b.endsAt)}</p>
                      <p className="mt-0.5 text-sm text-ink-2">
                        {b.description}
                        {b._count.preempted > 0 &&
                          ` · cancelled ${b._count.preempted} booking${b._count.preempted === 1 ? "" : "s"}`}
                      </p>
                    </div>
                  </div>
                  <div className="ml-auto flex-none">
                    {b.startsAt > now ? (
                      <CancelBookingButton bookingId={b.id} />
                    ) : (
                      <span className="text-sm font-semibold text-ok">Happening now</span>
                    )}
                  </div>
                </li>
              ))}
            </Card>
          </>
        )}
      </section>
    </div>
  );
}
