import { db } from "@/lib/db";
import {
  addCivilDays,
  civilToISODate,
  civilToInstant,
  compareCivil,
  type CivilDate,
} from "@/lib/time";

// ---------------------------------------------------------------------------
// Terms
// ---------------------------------------------------------------------------

/**
 * Approximate NKU terms, worked out from the date alone: Spring Jan 1 – May 15,
 * Summer May 16 – Aug 15, Fall Aug 16 – Dec 31. The breaks fold into the term before
 * them, so every date belongs to exactly one term. Close enough for a default range;
 * the custom dates cover anything exact.
 */
export type Term = { label: string; first: CivilDate; last: CivilDate };

export function termOf(day: CivilDate): Term {
  const { y } = day;
  const md = day.m * 100 + day.d;
  if (md <= 515) return { label: `Spring ${y}`, first: { y, m: 1, d: 1 }, last: { y, m: 5, d: 15 } };
  if (md <= 815) return { label: `Summer ${y}`, first: { y, m: 5, d: 16 }, last: { y, m: 8, d: 15 } };
  return { label: `Fall ${y}`, first: { y, m: 8, d: 16 }, last: { y, m: 12, d: 31 } };
}

export function previousTerm(term: Term): Term {
  return termOf(addCivilDays(term.first, -1));
}

// ---------------------------------------------------------------------------
// Report
// ---------------------------------------------------------------------------

export type GroupBy = "group" | "instrument";
export type Scope = "students" | "all";

export type UsageRow = {
  /** Advisor or instrument id; a fixed key for the rows that aren't either. */
  key: string;
  label: string;
  /** Instrument rows carry their colour for the dot. */
  color?: string;
  minutes: number;
  bookings: number;
  /** Set on rows that can be drilled into (a real group or instrument). */
  drillId?: string;
};

export const NO_GROUP = "none";

/**
 * Instrument time used between two campus dates, inclusive.
 *
 * "Used" means a booking that wasn't cancelled or bumped and has ended. Nothing marks
 * bookings completed or no-show yet, so a past CONFIRMED booking counts. A booking
 * belongs to the day it starts on and counts in full, so an overnight block on the
 * last evening of the range isn't split.
 *
 * Research groups come from the booking's own copy of the advisor, so a student who
 * changed groups is counted where the time was for.
 */
export async function usageReport(args: {
  first: CivilDate;
  last: CivilDate;
  groupBy: GroupBy;
  scope: Scope;
  instrumentId?: string;
  advisorId?: string;
  now?: Date;
}): Promise<{ rows: UsageRow[]; minutes: number; bookings: number }> {
  const { now = new Date() } = args;
  const rangeStart = civilToInstant(args.first, 0);
  const rangeEnd = civilToInstant(addCivilDays(args.last, 1), 0);

  const bookings = await db.booking.findMany({
    where: {
      status: { in: ["CONFIRMED", "COMPLETED", "NO_SHOW"] },
      startsAt: { gte: rangeStart, lt: rangeEnd },
      endsAt: { lte: now },
      ...(args.scope === "students" ? { type: "STUDENT" as const } : {}),
      ...(args.instrumentId ? { instrumentId: args.instrumentId } : {}),
      ...(args.advisorId
        ? args.advisorId === NO_GROUP
          ? { advisorId: null, type: "STUDENT" as const }
          : { advisorId: args.advisorId }
        : {}),
    },
    select: {
      type: true,
      startsAt: true,
      endsAt: true,
      instrument: { select: { id: true, name: true, color: true } },
      advisor: { select: { id: true, name: true } },
    },
  });

  const rows = new Map<string, UsageRow>();
  let minutes = 0;

  for (const b of bookings) {
    const length = Math.round((b.endsAt.getTime() - b.startsAt.getTime()) / 60_000);
    minutes += length;

    let row: Omit<UsageRow, "minutes" | "bookings">;
    if (args.groupBy === "instrument") {
      row = { key: b.instrument.id, label: b.instrument.name, color: b.instrument.color, drillId: b.instrument.id };
    } else if (b.type === "CLASS") {
      row = { key: "class", label: "Class time" };
    } else if (b.type === "MAINTENANCE") {
      row = { key: "maintenance", label: "Maintenance" };
    } else if (b.advisor) {
      row = { key: b.advisor.id, label: b.advisor.name, drillId: b.advisor.id };
    } else {
      row = { key: NO_GROUP, label: "No research group", drillId: NO_GROUP };
    }

    const existing = rows.get(row.key) ?? { ...row, minutes: 0, bookings: 0 };
    existing.minutes += length;
    existing.bookings += 1;
    rows.set(row.key, existing);
  }

  return { rows: [...rows.values()], minutes, bookings: bookings.length };
}

/** A range as the YYYY-MM-DD pair the date inputs and links use. */
export function isoRange(first: CivilDate, last: CivilDate) {
  return { from: civilToISODate(first), to: civilToISODate(last) };
}

export function inOrder(a: CivilDate, b: CivilDate): [CivilDate, CivilDate] {
  return compareCivil(a, b) <= 0 ? [a, b] : [b, a];
}
