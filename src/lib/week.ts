import {
  addCivilDays,
  civilToISODate,
  civilToInstant,
  compareCivil,
  type CivilDate,
} from "@/lib/time";

/** One campus calendar day, with its real bounds as instants. */
export type CampusDay = {
  date: CivilDate;
  /** YYYY-MM-DD, campus-local. */
  key: string;
  weekday: string;
  dayOfMonth: number;
  isToday: boolean;
  /** Midnight to midnight resolved as wall-clock times, so DST days are 23 or 25 hours. */
  start: Date;
  end: Date;
};

/** The Sunday on or before `date` — calendar columns and quota weeks both start on Sunday. */
export function sundayOf(date: CivilDate): CivilDate {
  const weekday = new Date(Date.UTC(date.y, date.m - 1, date.d)).getUTCDay();
  return addCivilDays(date, -weekday);
}

export function campusDays(from: CivilDate, count: number, today: CivilDate): CampusDay[] {
  return Array.from({ length: count }, (_, i) => {
    const date = addCivilDays(from, i);
    return {
      date,
      key: civilToISODate(date),
      weekday: new Date(Date.UTC(date.y, date.m - 1, date.d)).toLocaleDateString(
        "en-US",
        { weekday: "short", timeZone: "UTC" },
      ),
      dayOfMonth: date.d,
      isToday: compareCivil(date, today) === 0,
      start: civilToInstant(date, 0),
      end: civilToInstant(addCivilDays(date, 1), 0),
    };
  });
}

/** "Oct 25 – 31, 2026", or "Oct 29 – Nov 4, 2026" across a month boundary. */
export function weekRangeLabel(weekStart: CivilDate): string {
  const last = addCivilDays(weekStart, 6);
  const fmt = (d: CivilDate, opts: Intl.DateTimeFormatOptions) =>
    new Date(Date.UTC(d.y, d.m - 1, d.d)).toLocaleDateString("en-US", { ...opts, timeZone: "UTC" });
  const sameMonth = weekStart.m === last.m;
  return `${fmt(weekStart, { month: "short", day: "numeric" })} – ${fmt(
    last,
    sameMonth ? { day: "numeric" } : { month: "short", day: "numeric" },
  )}, ${last.y}`;
}
