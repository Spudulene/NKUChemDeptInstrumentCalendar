import type { PreemptionTarget } from "@/lib/booking/create";
import {
  compareCivil,
  formatRange,
  instantToCivil,
  instantToMinutes,
  minutesToClock,
  type CivilDate,
} from "@/lib/time";
import type { ClassPreviewRow } from "@/app/(site)/classes/types";

/**
 * One affected booking as the reservation form shows it. `day` is the reservation's
 * date: a booking that sits inside it shows just its clock times.
 *
 * `resumeFrom` is left null; only the one-off form offers "start after it instead".
 */
export function previewRow(t: PreemptionTarget, day: CivilDate, now: Date): ClassPreviewRow {
  const sameDay = (instant: Date) => compareCivil(instantToCivil(instant), day) === 0;
  const clock = (instant: Date) => minutesToClock(instantToMinutes(instant));

  const minutesUntil = Math.round((t.start.getTime() - now.getTime()) / 60_000);
  const startsIn =
    minutesUntil > 0 && minutesUntil < 24 * 60
      ? `${Math.floor(minutesUntil / 60)} h ${minutesUntil % 60} min`
      : null;

  const parts = t.userName.trim().split(/\s+/);
  const initials = (
    parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
  ).toUpperCase();

  return {
    id: t.id,
    name: t.userName,
    initials,
    group: t.groupName,
    time:
      sameDay(t.start) && sameDay(t.end)
        ? `${clock(t.start)} – ${clock(t.end)}`
        : formatRange(t.start, t.end),
    range: formatRange(t.start, t.end),
    startsIn,
    startsSoon: t.startsSoon,
    resumeFrom: null,
    type: t.type,
  };
}
