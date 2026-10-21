import {
  MINUTES_PER_DAY,
  civilToInstant,
  clockToMinutes,
  parseISODate,
  type CivilDate,
} from "@/lib/time";

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
