import { getSession } from "@/lib/auth";
import type { InstrumentSettings } from "@/lib/admin/instrument-settings";
import { InstrumentSettingsForm } from "@/components/instrument-settings-form";

/** A weekday daytime window to start from: what most instruments need first. */
const STARTER: InstrumentSettings = {
  name: "",
  location: "",
  description: "",
  color: "#0369A1",
  bookingHorizonDays: 21,
  minLeadTimeMinutes: 0,
  cancellationDeadlineMinutes: 120,
  bufferMinutes: 0,
  maxMinutesPerUserPerWeek: null,
  requireResearchAdvisor: false,
  windows: [
    {
      name: "Daytime",
      daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
      startMinute: 8 * 60,
      endMinute: 17 * 60,
      wholeBlockOnly: false,
      slotSizeMinutes: 30,
      minDurationMinutes: 30,
      maxDurationMinutes: 120,
      maxConsecutiveSlots: null,
      maxBookingsPerUserPerWeek: null,
    },
  ],
};

export default async function NewInstrumentPage() {
  const user = await getSession();
  if (user?.role !== "ADMIN") return null; // the layout explains

  return <InstrumentSettingsForm instrumentId={null} slug={null} initial={STARTER} version="new" />;
}
