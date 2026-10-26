import type { Weekday } from "@/generated/prisma/enums";
import { crossesMidnight, windowSpanMinutes, type WindowRule } from "@/lib/booking/windows";
import { formatDurationMinutes, minutesToClock } from "@/lib/time";

/**
 * How a booking window is described in the UI. One place, so the home page, the
 * instrument page and the booking dialog never describe the same rule differently.
 */

const ORDER: Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];
const SHORT: Record<Weekday, string> = {
  SUN: "Sun", MON: "Mon", TUE: "Tue", WED: "Wed", THU: "Thu", FRI: "Fri", SAT: "Sat",
};

/** "Mon–Fri", "Sat–Sun", "Every night" / "Every day", or "Mon, Wed, Fri". */
export function windowDays(window: Pick<WindowRule, "daysOfWeek" | "startMinute" | "endMinute">): string {
  const set = new Set(window.daysOfWeek);
  if (set.size === 7) return crossesMidnight(window) ? "Every night" : "Every day";
  if (set.has("SAT") && set.has("SUN") && set.size === 2) return "Sat–Sun";

  const indexes = ORDER.map((d, i) => (set.has(d) ? i : -1)).filter((i) => i >= 0);
  const contiguous = indexes.every((v, i) => i === 0 || v === indexes[i - 1] + 1);
  if (contiguous && indexes.length > 2) {
    return `${SHORT[ORDER[indexes[0]]]}–${SHORT[ORDER[indexes[indexes.length - 1]]]}`;
  }
  return indexes.map((i) => SHORT[ORDER[i]]).join(", ");
}

/** "08:00 – 17:00", or "17:00 → 08:00" when it runs overnight. */
export function windowHours(window: Pick<WindowRule, "startMinute" | "endMinute">): string {
  const start = minutesToClock(window.startMinute);
  const end = minutesToClock(window.endMinute);
  return crossesMidnight(window) ? `${start} → ${end}` : `${start} – ${end}`;
}

/** "30-min slots · up to 2 hours" or "one 15-hour block", plus any weekly cap. */
export function windowRule(window: WindowRule): string {
  const parts = window.wholeBlockOnly
    ? [`one ${formatDurationMinutes(windowSpanMinutes(window)).replace(/ hours?$/, "-hour")} block`]
    : [`${formatDurationMinutes(window.slotSizeMinutes).replace(" min", "-min").replace(/^1 hour$/, "1-hour")} slots`, `up to ${formatDurationMinutes(window.maxDurationMinutes)}`];
  if (window.maxBookingsPerUserPerWeek) {
    parts.push(`${window.maxBookingsPerUserPerWeek} per student per week`);
  }
  return parts.join(" · ");
}

/** The booking dialog's banner: "Daytime · Mon–Fri 08:00 – 17:00 · 30-min slots · up to 2 hours". */
export function windowSummary(window: WindowRule): string {
  return `${window.name} · ${windowDays(window)} ${windowHours(window)} · ${windowRule(window)}`;
}
