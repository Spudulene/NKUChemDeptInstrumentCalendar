import { addCivilDays, civilToInstant, todayCivil, type CivilDate } from "@/lib/time";

/**
 * The booking horizon opens whole days at a time: with an N-day horizon, each campus
 * day becomes bookable at midnight N days before it. So right now the last bookable
 * day is today + N, and anything starting before the midnight after it is in reach.
 *
 * Returns that midnight, an exclusive limit. It is counted in calendar days and
 * resolved to a wall-clock midnight, never `N × 24 h`, so a daylight-saving change in
 * between doesn't move it by an hour.
 */
export function horizonEnd(now: Date, horizonDays: number): Date {
  return civilToInstant(addCivilDays(todayCivil(now), horizonDays + 1), 0);
}

/** The campus date on which `day` opens for booking. */
export function opensForBooking(day: CivilDate, horizonDays: number): CivilDate {
  return addCivilDays(day, -horizonDays);
}
