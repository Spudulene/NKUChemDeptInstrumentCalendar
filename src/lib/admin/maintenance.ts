import { civilToInstant, clockToMinutes, parseISODate, type CivilDate } from "@/lib/time";

/**
 * A maintenance block's Starts / Ends, entered as campus date and time, as instants.
 *
 * Unlike a class, a block can run for days (a service visit, a magnet quench), so each
 * end has its own date. Both go through `civilToInstant` as wall-clock times, so a
 * block across a DST change gets its real length.
 */
export function resolveMaintenanceTimes(fields: {
  startDate: string;
  startTime: string;
  endDate: string;
  endTime: string;
}): { day: CivilDate; start: Date; end: Date } | null {
  const startDay = parseISODate(fields.startDate);
  const endDay = parseISODate(fields.endDate);
  const startMinute = clockToMinutes(fields.startTime);
  const endMinute = clockToMinutes(fields.endTime);
  if (!startDay || !endDay || startMinute === null || endMinute === null) return null;

  return {
    day: startDay,
    start: civilToInstant(startDay, startMinute),
    end: civilToInstant(endDay, endMinute),
  };
}
