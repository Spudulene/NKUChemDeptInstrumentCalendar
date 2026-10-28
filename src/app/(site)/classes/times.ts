import {
  MINUTES_PER_DAY,
  civilToInstant,
  clockToMinutes,
  parseISODate,
  type CivilDate,
} from "@/lib/time";
import type { Weekday } from "@/generated/prisma/enums";
import type { SeriesPattern } from "@/lib/booking/series";

export type ClassTimes = {
  day: CivilDate;
  fromMinute: number;
  toMinute: number;
  start: Date;
  end: Date;
  endsNextDay: boolean;
};

/**
 * Turn the form's Date / From / To, entered in campus time, into instants.
 *
 * A To at or before From means the reservation runs past midnight — the same
 * convention booking windows use. Both endpoints go through `civilToInstant` as
 * wall-clock times, so a reservation spanning a DST change gets its real length.
 */
export function resolveClassTimes(
  date: string,
  from: string,
  to: string,
): ClassTimes | null {
  const day = parseISODate(date);
  const fromMinute = clockToMinutes(from);
  const toMinute = clockToMinutes(to);

  if (!day || fromMinute === null || toMinute === null) return null;
  if (fromMinute >= MINUTES_PER_DAY) return null;

  const endsNextDay = toMinute <= fromMinute;

  return {
    day,
    fromMinute,
    toMinute,
    start: civilToInstant(day, fromMinute),
    end: civilToInstant(day, toMinute + (endsNextDay ? MINUTES_PER_DAY : 0)),
    endsNextDay,
  };
}

const WEEKDAYS: readonly Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * The weekly form's First date / Last date / Days / From / To, as a series pattern.
 * `days` is the comma-separated list the form submits ("TUE,THU").
 */
export function resolveSeriesPattern(fields: {
  first: string;
  until: string;
  days: string;
  from: string;
  to: string;
}): SeriesPattern | null {
  const firstDay = parseISODate(fields.first);
  const lastDay = parseISODate(fields.until);
  const fromMinute = clockToMinutes(fields.from);
  const toMinute = clockToMinutes(fields.to);
  const days = fields.days
    .split(",")
    .filter((d): d is Weekday => (WEEKDAYS as readonly string[]).includes(d));

  if (!firstDay || !lastDay || fromMinute === null || toMinute === null) return null;
  if (fromMinute >= MINUTES_PER_DAY) return null;

  return { firstDay, lastDay, days, fromMinute, toMinute: toMinute % MINUTES_PER_DAY };
}
