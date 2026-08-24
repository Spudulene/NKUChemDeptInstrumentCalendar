import { TZDate } from "@date-fns/tz";
import { Weekday } from "@/generated/prisma/enums";
import { env } from "@/lib/env";

export const CAMPUS_TZ = env.CAMPUS_TIMEZONE;

export const MINUTES_PER_DAY = 1440;

/**
 * A date on the wall calendar, with no time and no zone. Booking windows recur on
 * civil dates ("every Friday"), while bookings are instants — conflating the two is
 * the root of most timezone bugs, so they get separate types here.
 */
export type CivilDate = { y: number; m: number; d: number };

/**
 * Civil date arithmetic runs in UTC on purpose. UTC has no DST, so adding a day is
 * always exactly 86400000ms and "March 8 + 1 day" is reliably March 9. Doing the same
 * arithmetic in a DST-observing zone is what produces off-by-one-hour drift.
 */
export function addCivilDays(date: CivilDate, days: number): CivilDate {
  const t = Date.UTC(date.y, date.m - 1, date.d) + days * 86_400_000;
  const dt = new Date(t);
  return {
    y: dt.getUTCFullYear(),
    m: dt.getUTCMonth() + 1,
    d: dt.getUTCDate(),
  };
}

const WEEKDAYS: readonly Weekday[] = [
  Weekday.SUN,
  Weekday.MON,
  Weekday.TUE,
  Weekday.WED,
  Weekday.THU,
  Weekday.FRI,
  Weekday.SAT,
];

export function civilWeekday(date: CivilDate): Weekday {
  const index = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  return WEEKDAYS[index];
}

/**
 * Resolve a civil date plus minutes-from-midnight into a real instant, interpreting
 * the wall-clock time in the campus zone.
 *
 * `minutes` may exceed 1440 to express times on following days, which is how the
 * overnight window (17:00 -> 08:00 = minute 1920) is expressed.
 *
 * DST falls out of this for free: on the spring-forward date, 17:00 -> 08:00 spans 14
 * real hours rather than 15, because both endpoints are resolved as wall-clock times
 * rather than by adding an offset.
 */
export function civilToInstant(date: CivilDate, minutes: number): Date {
  const dayOffset = Math.floor(minutes / MINUTES_PER_DAY);
  const within = minutes - dayOffset * MINUTES_PER_DAY;
  const target = dayOffset === 0 ? date : addCivilDays(date, dayOffset);

  const tz = new TZDate(
    target.y,
    target.m - 1,
    target.d,
    Math.floor(within / 60),
    within % 60,
    0,
    0,
    CAMPUS_TZ,
  );

  return new Date(tz.getTime());
}

/** The campus-local civil date an instant falls on. */
export function instantToCivil(instant: Date): CivilDate {
  const tz = new TZDate(instant, CAMPUS_TZ);
  return {
    y: tz.getFullYear(),
    m: tz.getMonth() + 1,
    d: tz.getDate(),
  };
}

/** Campus-local minutes-from-midnight for an instant. */
export function instantToMinutes(instant: Date): number {
  const tz = new TZDate(instant, CAMPUS_TZ);
  return tz.getHours() * 60 + tz.getMinutes();
}

export function todayCivil(now: Date = new Date()): CivilDate {
  return instantToCivil(now);
}

/**
 * The campus calendar week (Sunday 00:00 through the following Sunday 00:00) that an
 * instant falls in.
 *
 * Quotas use a fixed calendar week rather than a rolling 7-day lookback. Rolling is
 * arguably fairer, but "you have 8 hours a week, it resets Sunday" is something a
 * student can predict without doing arithmetic — and a quota nobody can predict just
 * reads as the system being broken.
 */
export function campusWeekRange(instant: Date): { start: Date; end: Date } {
  const civil = instantToCivil(instant);
  const dayIndex = new Date(
    Date.UTC(civil.y, civil.m - 1, civil.d),
  ).getUTCDay();

  const weekStart = addCivilDays(civil, -dayIndex);
  return {
    start: civilToInstant(weekStart, 0),
    end: civilToInstant(addCivilDays(weekStart, 7), 0),
  };
}

export function compareCivil(a: CivilDate, b: CivilDate): number {
  return (
    Date.UTC(a.y, a.m - 1, a.d) - Date.UTC(b.y, b.m - 1, b.d)
  );
}

export function civilToISODate(date: CivilDate): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${date.y}-${pad(date.m)}-${pad(date.d)}`;
}

export function parseISODate(value: string): CivilDate | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, m, d] = match;
  const date = { y: Number(y), m: Number(m), d: Number(d) };
  // Round-trip catches things like 2026-02-31.
  return civilToISODate(date) === value ? date : null;
}

/** "17:30" — for admin config screens, where a 24h grid is easier to reason about. */
export function minutesToClock(minutes: number): string {
  const within = ((minutes % MINUTES_PER_DAY) + MINUTES_PER_DAY) % MINUTES_PER_DAY;
  const h = Math.floor(within / 60);
  const m = within % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

export function clockToMinutes(clock: string): number | null {
  const match = /^(\d{1,2}):(\d{2})$/.exec(clock.trim());
  if (!match) return null;
  const h = Number(match[1]);
  const m = Number(match[2]);
  if (h > 24 || m > 59 || (h === 24 && m !== 0)) return null;
  return h * 60 + m;
}

const dateTimeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TZ,
  weekday: "short",
  month: "short",
  day: "numeric",
  hour: "numeric",
  minute: "2-digit",
});

const timeFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CAMPUS_TZ,
  hour: "numeric",
  minute: "2-digit",
});

/** "Fri, Aug 15, 5:00 PM" — campus time, always. */
export function formatInstant(instant: Date): string {
  return dateTimeFormatter.format(instant);
}

export function formatTimeOnly(instant: Date): string {
  return timeFormatter.format(instant);
}

/**
 * "Fri, Aug 15, 5:00 PM – 8:00 AM" for a range, collapsing the second date when the
 * range stays inside one campus day.
 */
export function formatRange(start: Date, end: Date): string {
  const sameDay = compareCivil(instantToCivil(start), instantToCivil(end)) === 0;
  return sameDay
    ? `${formatInstant(start)} – ${formatTimeOnly(end)}`
    : `${formatInstant(start)} – ${formatInstant(end)}`;
}

export function formatDurationMinutes(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  if (h === 0) return `${m} min`;
  if (m === 0) return h === 1 ? "1 hour" : `${h} hours`;
  return `${h}h ${m}m`;
}
