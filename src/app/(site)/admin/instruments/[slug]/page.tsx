import { notFound } from "next/navigation";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { bookingsOutsideRules, type InstrumentSettings } from "@/lib/admin/instrument-settings";
import { formatClockRange, formatDayLabel } from "@/lib/time";
import { setInstrumentActiveAction } from "@/app/(site)/admin/actions";
import { CancelBookingButton } from "@/components/cancel-booking-button";
import { ArchiveControl, InstrumentSettingsForm } from "@/components/instrument-settings-form";
import { Card, Notice } from "@/components/ui";

export default async function InstrumentSettingsPage({ params }: PageProps<"/admin/instruments/[slug]">) {
  const { slug } = await params;
  const user = await getSession();
  if (user?.role !== "ADMIN") return null; // the layout explains

  const instrument = await db.instrument.findUnique({
    where: { slug },
    include: { windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
  });
  if (!instrument) notFound();

  const now = new Date();
  const [misfits, upcoming] = await Promise.all([
    bookingsOutsideRules(instrument.id, now),
    db.booking.count({ where: { instrumentId: instrument.id, status: "CONFIRMED", startsAt: { gt: now } } }),
  ]);

  const initial: InstrumentSettings = {
    name: instrument.name,
    location: instrument.location ?? "",
    description: instrument.description ?? "",
    color: instrument.color,
    bookingHorizonDays: instrument.bookingHorizonDays,
    minLeadTimeMinutes: instrument.minLeadTimeMinutes,
    cancellationDeadlineMinutes: instrument.cancellationDeadlineMinutes,
    bufferMinutes: instrument.bufferMinutes,
    maxMinutesPerUserPerWeek: instrument.maxMinutesPerUserPerWeek,
    requireResearchAdvisor: instrument.requireResearchAdvisor,
    windows: instrument.windows.map((w) => ({
      id: w.id,
      name: w.name,
      daysOfWeek: w.daysOfWeek,
      startMinute: w.startMinute,
      endMinute: w.endMinute,
      wholeBlockOnly: w.wholeBlockOnly,
      slotSizeMinutes: w.slotSizeMinutes,
      minDurationMinutes: w.minDurationMinutes,
      maxDurationMinutes: w.maxDurationMinutes,
      maxConsecutiveSlots: w.maxConsecutiveSlots,
      maxBookingsPerUserPerWeek: w.maxBookingsPerUserPerWeek,
    })),
  };

  // Changes whenever a save lands (the instrument row is always updated), which
  // remounts the editor on the saved data.
  const version = [instrument.updatedAt.toISOString(), ...instrument.windows.map((w) => w.id)].join("|");

  return (
    <div className="flex flex-col gap-5">
      {misfits.length > 0 && (
        <Notice
          tone="warn"
          title={`${misfits.length} upcoming booking${misfits.length === 1 ? " doesn't" : "s don't"} fit the current rules`}
        >
          <p>
            {misfits.length === 1 ? "It was" : "They were"} made before the rules changed, so{" "}
            {misfits.length === 1 ? "it stands" : "they stand"}. Cancel any that can&apos;t go ahead;
            the student isn&apos;t emailed automatically.
          </p>
          <Card as="ul" className="mt-3 divide-y divide-line">
            {misfits.map((m) => (
              <li key={m.id} className="flex flex-wrap items-center gap-x-4 gap-y-1 px-4 py-3">
                <div className="min-w-0 flex-[1_1_240px]">
                  <p className="text-[15px] font-bold text-ink">
                    {m.userName} · {formatDayLabel(m.start)}{" "}
                    <span className="font-semibold whitespace-nowrap text-ink-2 tabular-nums">
                      {formatClockRange(m.start, m.end)}
                    </span>
                  </p>
                  <p className="mt-0.5 text-sm text-ink-2">{m.reason}</p>
                </div>
                <div className="ml-auto">
                  <CancelBookingButton bookingId={m.id} />
                </div>
              </li>
            ))}
          </Card>
        </Notice>
      )}

      <InstrumentSettingsForm
        instrumentId={instrument.id}
        slug={instrument.slug}
        initial={initial}
        version={version}
      />

      <ArchiveControl
        instrumentId={instrument.id}
        isActive={instrument.isActive}
        upcoming={upcoming}
        action={setInstrumentActiveAction}
      />
    </div>
  );
}
