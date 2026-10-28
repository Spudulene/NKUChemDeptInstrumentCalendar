import type { Role, Weekday } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { deliverPreemptionNotices } from "@/lib/email";
import {
  MINUTES_PER_DAY,
  addCivilDays,
  civilToISODate,
  civilToInstant,
  civilWeekday,
  compareCivil,
  formatDayLabel,
  type CivilDate,
} from "@/lib/time";
import {
  BookingError,
  classifyConflicts,
  isOverlapViolation,
  loadConflicts,
  type PreemptionPreview,
  type PreemptionTarget,
} from "@/lib/booking/create";
import { policySnapshot, validateBooking } from "@/lib/booking/rules";

/** Long enough for a semester plus finals, short enough that a typo can't book a year. */
export const MAX_SERIES_DAYS = 26 * 7;

/** "Every Tue and Thu, 13:00–17:00, from Aug 25 to Dec 11", in campus time. */
export type SeriesPattern = {
  firstDay: CivilDate;
  lastDay: CivilDate;
  days: readonly Weekday[];
  fromMinute: number;
  /** At or before `fromMinute` means each meeting runs past midnight. */
  toMinute: number;
};

export type SeriesMeeting = {
  day: CivilDate;
  /** YYYY-MM-DD — how the form names a meeting when the instructor skips it. */
  date: string;
  start: Date;
  end: Date;
};

export type MeetingPreview = SeriesMeeting & PreemptionPreview;

/** What's wrong with the pattern itself, before any database work. */
export function patternProblem(pattern: SeriesPattern): string | null {
  if (pattern.days.length === 0) return "Pick at least one day of the week.";
  const span = compareCivil(pattern.lastDay, pattern.firstDay);
  if (span < 0) return "The last date is before the first.";
  if (span / 86_400_000 >= MAX_SERIES_DAYS) {
    return `A series can run for up to ${MAX_SERIES_DAYS / 7} weeks. Split a longer one in two.`;
  }
  return null;
}

/**
 * Every meeting the pattern produces that hasn't started yet.
 *
 * Each endpoint is resolved as a wall-clock time on its own date, so a Tuesday class
 * is 13:00–17:00 on both sides of a DST change rather than drifting by an hour.
 */
export function expandSeries(pattern: SeriesPattern, now: Date): SeriesMeeting[] {
  const endMinute =
    pattern.toMinute + (pattern.toMinute <= pattern.fromMinute ? MINUTES_PER_DAY : 0);
  const meetings: SeriesMeeting[] = [];

  for (
    let day = pattern.firstDay;
    compareCivil(day, pattern.lastDay) <= 0;
    day = addCivilDays(day, 1)
  ) {
    if (!pattern.days.includes(civilWeekday(day))) continue;
    const start = civilToInstant(day, pattern.fromMinute);
    if (start <= now) continue;
    meetings.push({ day, date: civilToISODate(day), start, end: civilToInstant(day, endMinute) });
  }

  return meetings;
}

/**
 * Who each meeting would affect. One query covers the whole span; each meeting then
 * gets its own slice, sorted the same way a one-off reservation's preview is.
 */
export async function previewSeries(args: {
  instrumentId: string;
  meetings: readonly SeriesMeeting[];
  now?: Date;
}): Promise<MeetingPreview[]> {
  const { instrumentId, meetings, now = new Date() } = args;
  if (meetings.length === 0) return [];

  const conflicts = await loadConflicts({
    instrumentId,
    start: meetings[0].start,
    end: meetings[meetings.length - 1].end,
    now,
  });

  return meetings.map((m) => ({
    ...m,
    ...classifyConflicts(
      conflicts.filter((c) => c.start < m.end && c.end > m.start),
      "CLASS",
    ),
  }));
}

/** A meeting the instructor can't take: another class holds it, or someone is mid-run. */
export function meetingIsBlocked(m: PreemptionPreview): boolean {
  return m.blockedBy.length > 0 || m.inProgress.length > 0;
}

/**
 * Reserve the meetings the instructor kept, bumping student bookings in all of them.
 *
 * All or nothing, in one transaction: every displaced booking leaves CONFIRMED before
 * any meeting is inserted (or `Booking_no_overlap` rejects it), and a half-created
 * series is worse than none — the instructor would have to work out which dates
 * stuck. As with a one-off reservation, the instructor must have seen every booking
 * that gets cancelled.
 */
export async function createClassSeries(args: {
  instrumentId: string;
  pattern: SeriesPattern;
  /** The meetings kept, by date. Anything the pattern produces but isn't listed is skipped. */
  dates: readonly string[];
  title: string;
  description: string;
  actor: { id: string; role: Role };
  confirmedTargetIds: readonly string[];
  notify?: boolean;
  now?: Date;
}): Promise<{ seriesId: string; meetings: SeriesMeeting[]; preempted: PreemptionTarget[] }> {
  const { instrumentId, pattern, actor, now = new Date() } = args;
  const title = args.title.trim();
  const description = args.description.trim();

  if (actor.role !== "ADMIN" && actor.role !== "INSTRUCTOR") {
    throw new BookingError({
      code: "FORBIDDEN",
      message: "Only instructors and admins can create class reservations.",
    });
  }

  const problem = patternProblem(pattern);
  if (problem) throw new BookingError({ code: "INVALID_SERIES", message: problem });

  const all = expandSeries(pattern, now);
  const kept = new Set(args.dates);
  const meetings = all.filter((m) => kept.has(m.date));

  if (meetings.length !== kept.size) {
    throw new BookingError({
      code: "CONFIRMATION_REQUIRED",
      message: "Some of those dates have already started. Check the updated list and confirm again.",
    });
  }
  if (meetings.length === 0) {
    throw new BookingError({ code: "INVALID_SERIES", message: "Keep at least one date." });
  }

  const instrument = await db.instrument.findUnique({
    where: { id: instrumentId },
    include: { windows: { where: { isActive: true } } },
  });
  if (!instrument) {
    throw new BookingError({ code: "NOT_FOUND", message: "That instrument no longer exists." });
  }

  // The same priority rule chain a one-off reservation goes through, per meeting.
  for (const m of meetings) {
    const validation = validateBooking({
      instrument,
      windows: instrument.windows,
      request: { userId: actor.id, start: m.start, end: m.end, type: "CLASS", title, description },
      actor,
      now,
      neighbors: [],
      userBookingsThisWeek: [],
    });
    if (!validation.ok) throw new BookingError(validation.failure);
  }

  const previews = await previewSeries({ instrumentId, meetings, now });

  const blocked = previews.find(meetingIsBlocked);
  if (blocked) {
    throw new BookingError({
      code: blocked.blockedBy.length > 0 ? "PRIORITY_CONFLICT" : "IN_PROGRESS_CONFLICT",
      message: `${formatDayLabel(blocked.start)} can't be reserved any more. Check the updated list and confirm again.`,
    });
  }

  const targets = previews.flatMap((p) => p.targets);
  const confirmed = new Set(args.confirmedTargetIds);
  if (targets.some((t) => !confirmed.has(t.id))) {
    throw new BookingError({
      code: "CONFIRMATION_REQUIRED",
      message:
        "Someone booked into one of those dates while you were reviewing. Check the updated list and confirm again.",
    });
  }

  const asDate = (day: CivilDate) => new Date(Date.UTC(day.y, day.m - 1, day.d));
  const snapshot = policySnapshot(instrument, null);

  let seriesId: string;
  try {
    seriesId = await db.$transaction(async (tx) => {
      // Order matters, as for a one-off: everything displaced leaves CONFIRMED before
      // the first meeting is inserted.
      if (targets.length > 0) {
        await tx.booking.updateMany({
          where: { id: { in: targets.map((t) => t.id) }, status: "CONFIRMED" },
          data: { status: "PREEMPTED", preemptedAt: now, cancellationReason: description },
        });
      }

      const series = await tx.reservationSeries.create({
        data: {
          instrumentId,
          userId: actor.id,
          title,
          description,
          daysOfWeek: [...pattern.days],
          startMinute: pattern.fromMinute,
          endMinute: pattern.toMinute,
          firstDate: asDate(pattern.firstDay),
          lastDate: asDate(pattern.lastDay),
        },
        select: { id: true },
      });

      for (const p of previews) {
        const created = await tx.booking.create({
          data: {
            instrumentId,
            userId: actor.id,
            createdById: actor.id,
            type: "CLASS",
            status: "CONFIRMED",
            startsAt: p.start,
            endsAt: p.end,
            title,
            description,
            seriesId: series.id,
            policySnapshot: snapshot,
          },
          select: { id: true },
        });

        if (p.targets.length > 0) {
          await tx.booking.updateMany({
            where: { id: { in: p.targets.map((t) => t.id) } },
            data: { preemptedByBookingId: created.id },
          });
        }
      }

      return series.id;
    });
  } catch (error) {
    if (isOverlapViolation(error)) {
      throw new BookingError({
        code: "CONFIRMATION_REQUIRED",
        message:
          "Someone booked into one of those dates while you were reviewing. Check the updated list and confirm again.",
      });
    }
    throw error;
  }

  // After commit, as for a one-off; the sweeper retries anything that fails here.
  if (targets.length > 0 && (args.notify ?? true)) {
    try {
      await deliverPreemptionNotices(targets.map((t) => t.id));
    } catch (error) {
      console.error("[series] immediate notification failed:", error);
    }
  }

  return { seriesId, meetings, preempted: targets };
}

/**
 * Cancel every meeting of a series that hasn't started. A meeting already under way is
 * left alone — the class is in the room. Bumped student bookings stay bumped: those
 * students were told and may have rebooked.
 */
export async function cancelSeries(args: {
  seriesId: string;
  actor: { id: string; role: Role; name: string };
  now?: Date;
}): Promise<{ cancelled: number; instrumentSlug: string }> {
  const { seriesId, actor, now = new Date() } = args;

  const series = await db.reservationSeries.findUnique({
    where: { id: seriesId },
    select: { userId: true, cancelledAt: true, instrument: { select: { slug: true } } },
  });
  if (!series || series.cancelledAt) {
    throw new BookingError({ code: "NOT_FOUND", message: "That series is no longer active." });
  }
  if (series.userId !== actor.id && actor.role !== "ADMIN") {
    throw new BookingError({ code: "NOT_OWNER", message: "That isn't your reservation." });
  }

  const cancelled = await db.$transaction(async (tx) => {
    const { count } = await tx.booking.updateMany({
      where: { seriesId, status: "CONFIRMED", startsAt: { gt: now } },
      data: {
        status: "CANCELLED",
        cancelledAt: now,
        cancellationReason:
          series.userId === actor.id ? "Series cancelled by owner" : `Series cancelled by ${actor.name}`,
      },
    });
    await tx.reservationSeries.update({ where: { id: seriesId }, data: { cancelledAt: now } });
    return count;
  });

  return { cancelled, instrumentSlug: series.instrument.slug };
}
