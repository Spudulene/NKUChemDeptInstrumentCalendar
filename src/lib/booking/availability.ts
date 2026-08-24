import { db } from "@/lib/db";
import { addCivilDays, instantToCivil } from "@/lib/time";
import {
  expandWindows,
  slotStarts,
  subtractIntervals,
  windowSpanMinutes,
  type Interval,
  type WindowOccurrence,
  type WindowRule,
} from "@/lib/booking/windows";

export type Opening = {
  start: Date;
  end: Date;
  windowId: string;
  windowName: string;
};

/**
 * Openings of a given length, in chronological order.
 *
 * Deliberately pure — the booking UI and the "you were bumped, here's what's left"
 * email need the same answer, and a preemption email suggesting a slot the calendar
 * would reject is worse than sending no suggestion at all.
 */
export function computeOpenings(args: {
  windows: readonly WindowRule[];
  busy: readonly Interval[];
  durationMinutes: number;
  /** Nothing before this instant is offered. */
  from: Date;
  /** Search horizon. */
  to: Date;
  bufferMinutes?: number;
  limit?: number;
}): Opening[] {
  const {
    windows,
    busy,
    durationMinutes,
    from,
    to,
    bufferMinutes = 0,
    limit = 3,
  } = args;

  if (durationMinutes <= 0 || from >= to) return [];

  // Padding busy intervals by the changeover buffer means the buffer rule and the
  // suggestions agree by construction, rather than by two implementations matching.
  const bufferMs = bufferMinutes * 60_000;
  const blocked: Interval[] = busy.map((b) => ({
    start: new Date(b.start.getTime() - bufferMs),
    end: new Date(b.end.getTime() + bufferMs),
  }));

  // Start a day early: an overnight window that opened yesterday may still have room
  // in it this morning.
  const occurrences = expandWindows(
    windows,
    addCivilDays(instantToCivil(from), -1),
    instantToCivil(to),
  );

  const openings: Opening[] = [];

  for (const occurrence of occurrences) {
    if (openings.length >= limit) break;
    if (occurrence.end <= from || occurrence.start >= to) continue;

    for (const opening of openingsInOccurrence(
      occurrence,
      blocked,
      durationMinutes,
      from,
      to,
    )) {
      openings.push(opening);
      if (openings.length >= limit) break;
    }
  }

  return openings;
}

function openingsInOccurrence(
  occurrence: WindowOccurrence,
  blocked: readonly Interval[],
  durationMinutes: number,
  from: Date,
  to: Date,
): Opening[] {
  const { window } = occurrence;
  const free = subtractIntervals(occurrence, blocked);
  if (free.length === 0) return [];

  const label = { windowId: window.id, windowName: window.name };

  // Whole-block windows are all-or-nothing: any encroachment kills the night.
  if (window.wholeBlockOnly) {
    if (durationMinutes !== windowSpanMinutes(window)) return [];

    const intact = free.some(
      (f) => f.start <= occurrence.start && f.end >= occurrence.end,
    );
    if (!intact || occurrence.start < from || occurrence.start >= to) return [];

    return [{ start: occurrence.start, end: occurrence.end, ...label }];
  }

  const durationMs = durationMinutes * 60_000;

  return slotStarts(occurrence, durationMinutes)
    .filter((start) => {
      if (start < from || start >= to) return false;
      const end = new Date(start.getTime() + durationMs);
      return free.some((f) => f.start <= start && f.end >= end);
    })
    .map((start) => ({
      start,
      end: new Date(start.getTime() + durationMs),
      ...label,
    }));
}

/**
 * The database-backed form: what should we suggest to someone who needs `duration`
 * minutes on this instrument, starting from `from`?
 */
export async function findOpenings(args: {
  instrumentId: string;
  durationMinutes: number;
  from?: Date;
  limit?: number;
  /** How far ahead to look. Defaults to the instrument's booking horizon. */
  horizonDays?: number;
}): Promise<Opening[]> {
  const { instrumentId, durationMinutes, from = new Date(), limit = 3 } = args;

  const instrument = await db.instrument.findUnique({
    where: { id: instrumentId },
    include: { windows: { where: { isActive: true }, orderBy: { sortOrder: "asc" } } },
  });

  if (!instrument || !instrument.isActive) return [];

  const horizonDays = args.horizonDays ?? instrument.bookingHorizonDays;
  const to = new Date(from.getTime() + horizonDays * 86_400_000);

  const earliest = new Date(
    Math.max(from.getTime(), Date.now() + instrument.minLeadTimeMinutes * 60_000),
  );

  const busy = await db.booking.findMany({
    where: {
      instrumentId,
      status: "CONFIRMED",
      endsAt: { gt: earliest },
      startsAt: { lt: to },
    },
    select: { startsAt: true, endsAt: true },
  });

  return computeOpenings({
    windows: instrument.windows,
    busy: busy.map((b) => ({ start: b.startsAt, end: b.endsAt })),
    durationMinutes,
    from: earliest,
    to,
    bufferMinutes: instrument.bufferMinutes,
    limit,
  });
}
