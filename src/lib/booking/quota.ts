import type { BookableSlot } from "@/lib/booking/slots";
import type { Unbookable } from "@/lib/booking/unbookable";
import type { WindowRule } from "@/lib/booking/windows";
import { formatDurationMinutes } from "@/lib/time";

/** A slot, with the lengths the student's weekly limit leaves them. */
export type AllowedSlot = BookableSlot & {
  /** Set when the weekly limit cut the lengths short: what's left, as a sentence. */
  limitNote?: string;
};

/**
 * One student's standing against an instrument's weekly caps, for one campus week, so
 * the schedule only offers what `underWindowWeeklyCap` and `underWeeklyMinuteCap` will
 * accept. Unlike `whyUnbookable`, this is about who is looking.
 *
 * `mine` must be counted the way the rules count it: the student's confirmed bookings
 * on this instrument that *start* in the week.
 */
export function weeklyAllowance(args: {
  instrumentName: string;
  maxMinutesPerWeek: number | null;
  mine: readonly { windowId: string | null; start: Date; end: Date }[];
}): {
  minutesLeft: number | null;
  apply: (slots: readonly BookableSlot[], windows: readonly WindowRule[]) => AllowedSlot[];
  explain: (window: WindowRule) => Unbookable | null;
} {
  const { instrumentName, maxMinutesPerWeek: cap, mine } = args;
  const used = mine.reduce((sum, b) => sum + (b.end.getTime() - b.start.getTime()) / 60_000, 0);
  const minutesLeft = cap === null ? null : Math.max(0, cap - used);

  const explain = (window: WindowRule): Unbookable | null => {
    const perWindow = window.maxBookingsPerUserPerWeek;
    const taken = mine.filter((b) => b.windowId === window.id).length;
    if (perWindow && taken >= perWindow) {
      return {
        kind: "weekly-limit",
        label: "Limit reached",
        detail: `You already have ${taken} ${window.name} booking${taken === 1 ? "" : "s"} this week, the most allowed.`,
      };
    }
    if (cap !== null && minutesLeft! < window.minDurationMinutes) {
      return {
        kind: "weekly-limit",
        label: "Over your limit",
        detail:
          window.minDurationMinutes > cap
            ? `${window.name} is ${formatDurationMinutes(window.minDurationMinutes)}, longer than the ${formatDurationMinutes(cap)} each student can book on ${instrumentName} a week.`
            : minutesLeft === 0
              ? `You've used all ${formatDurationMinutes(cap)} of your weekly time on ${instrumentName}.`
              : `You have ${formatDurationMinutes(minutesLeft!)} of your ${formatDurationMinutes(cap)} left this week, less than the shortest ${window.name} booking.`,
      };
    }
    return null;
  };

  const apply = (slots: readonly BookableSlot[], windows: readonly WindowRule[]): AllowedSlot[] => {
    const byId = new Map(windows.map((w) => [w.id, w]));
    return slots.flatMap((slot) => {
      const window = byId.get(slot.windowId);
      if (window && explain(window)) return [];
      if (minutesLeft === null) return [slot];

      const durations = slot.durations.filter((d) => d <= minutesLeft);
      if (durations.length === 0) return [];
      if (durations.length === slot.durations.length) return [slot];
      return [
        {
          ...slot,
          durations,
          limitNote: `You have ${formatDurationMinutes(minutesLeft)} of your ${formatDurationMinutes(cap!)} left this week, so longer bookings aren't offered.`,
        },
      ];
    });
  };

  return { minutesLeft, apply, explain };
}
