import { z } from "zod";
import { Weekday } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { MINUTES_PER_DAY, formatDurationMinutes } from "@/lib/time";
import { windowSpanMinutes } from "@/lib/booking/windows";
import { windowShapeFailure } from "@/lib/booking/rules";

const minutes = (max: number) => z.number().int().min(0).max(max);
const optionalCount = z.number().int().min(1).max(1000).nullable();

export const windowSettingsSchema = z.object({
  /** Absent for a window added in this edit. */
  id: z.string().optional(),
  name: z.string().trim().min(1, "Every window needs a name.").max(40),
  daysOfWeek: z.array(z.enum(Weekday)),
  startMinute: minutes(MINUTES_PER_DAY - 1),
  /** At or before startMinute means the window runs past midnight. */
  endMinute: minutes(MINUTES_PER_DAY - 1),
  wholeBlockOnly: z.boolean(),
  slotSizeMinutes: z.number().int().min(5).max(MINUTES_PER_DAY),
  minDurationMinutes: z.number().int().min(5).max(MINUTES_PER_DAY),
  maxDurationMinutes: z.number().int().min(5).max(MINUTES_PER_DAY),
  maxConsecutiveSlots: optionalCount,
  maxBookingsPerUserPerWeek: optionalCount,
});

/** Everything on the Instrument settings screen, as the form submits it. */
export const instrumentSettingsSchema = z.object({
  name: z.string().trim().min(1, "Give the instrument a name.").max(80),
  location: z.string().trim().max(80),
  description: z.string().trim().max(300),
  color: z.string().regex(/^#[0-9a-fA-F]{6}$/, "Pick a calendar colour."),
  bookingHorizonDays: z.number().int().min(1).max(365),
  minLeadTimeMinutes: minutes(14 * MINUTES_PER_DAY),
  cancellationDeadlineMinutes: minutes(14 * MINUTES_PER_DAY),
  bufferMinutes: minutes(240),
  maxMinutesPerUserPerWeek: z.number().int().min(1).max(7 * MINUTES_PER_DAY).nullable(),
  requireResearchAdvisor: z.boolean(),
  windows: z.array(windowSettingsSchema),
});

export type WindowSettings = z.infer<typeof windowSettingsSchema>;
export type InstrumentSettings = z.infer<typeof instrumentSettingsSchema>;

const WEEK: readonly Weekday[] = ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"];

/**
 * A whole-block window is booked as exactly its own span, so its duration rules are
 * not the admin's to set: they follow from the times. Slots windows keep theirs.
 */
export function normalizeWindow(w: WindowSettings): WindowSettings {
  if (!w.wholeBlockOnly) return w;
  const span = windowSpanMinutes(w);
  return {
    ...w,
    slotSizeMinutes: span,
    minDurationMinutes: span,
    maxDurationMinutes: span,
    maxConsecutiveSlots: null,
  };
}

/**
 * What's wrong with these settings, in words for the admin, or null. Checks the
 * things the schema can't: window rules that contradict each other, and windows
 * that overlap (a booking has to fall inside exactly one window's rules).
 */
export function settingsProblem(settings: InstrumentSettings): string | null {
  const names = new Set<string>();

  for (const w of settings.windows.map(normalizeWindow)) {
    const label = `"${w.name}"`;
    if (names.has(w.name.toLowerCase())) return `Two windows are called ${label}. Rename one.`;
    names.add(w.name.toLowerCase());

    if (w.daysOfWeek.length === 0) return `${label} isn't open on any day. Pick at least one.`;
    if (w.wholeBlockOnly) continue;

    const span = windowSpanMinutes(w);
    if (w.slotSizeMinutes > span) {
      return `${label} is ${formatDurationMinutes(span)} long, shorter than one slot.`;
    }
    if (w.minDurationMinutes > w.maxDurationMinutes) {
      return `${label}'s shortest booking is longer than its longest.`;
    }
    if (w.maxDurationMinutes > span) {
      return `${label}'s longest booking is longer than the window itself.`;
    }
  }

  return overlapProblem(settings.windows);
}

/**
 * Two windows open at the same moment would leave a booking there with two sets of
 * rules. Laid out on one circular week of minutes, so an overnight Saturday window
 * is checked against Sunday morning too.
 */
function overlapProblem(windows: readonly WindowSettings[]): string | null {
  const WEEK_MINUTES = 7 * MINUTES_PER_DAY;
  const spans = windows.flatMap((w) =>
    w.daysOfWeek.map((day) => {
      const start = WEEK.indexOf(day) * MINUTES_PER_DAY + w.startMinute;
      return { name: w.name, start, end: start + windowSpanMinutes(w) };
    }),
  );

  const overlaps = (a: { start: number; end: number }, b: { start: number; end: number }) =>
    [-WEEK_MINUTES, 0, WEEK_MINUTES].some(
      (shift) => a.start < b.end + shift && b.start + shift < a.end,
    );

  for (let i = 0; i < spans.length; i += 1) {
    for (let j = i + 1; j < spans.length; j += 1) {
      if (spans[i].name !== spans[j].name && overlaps(spans[i], spans[j])) {
        return `"${spans[i].name}" and "${spans[j].name}" overlap. Windows can't share time.`;
      }
    }
  }
  return null;
}

/** A URL-safe, unique slug for a new instrument. Never changed afterwards: embeds use it. */
async function freeSlug(name: string): Promise<string> {
  const base =
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "instrument";
  for (let n = 1; ; n += 1) {
    const slug = n === 1 ? base : `${base}-${n}`;
    if (slug === "new") continue; // /admin/instruments/new is the Add page
    if (!(await db.instrument.findUnique({ where: { slug }, select: { id: true } }))) return slug;
  }
}

export class SettingsError extends Error {}

/**
 * Create or update an instrument and its windows in one transaction.
 *
 * Windows left out of `settings.windows` are archived, not deleted: past bookings
 * point at them and reports name them. Bookings already made stay as they are —
 * see `bookingsOutsideRules` for the ones that no longer fit.
 */
export async function saveInstrumentSettings(args: {
  instrumentId: string | null;
  settings: InstrumentSettings;
}): Promise<{ id: string; slug: string }> {
  const settings = { ...args.settings, windows: args.settings.windows.map(normalizeWindow) };
  const problem = settingsProblem(settings);
  if (problem) throw new SettingsError(problem);

  const clash = await db.instrument.findFirst({
    where: { name: settings.name, ...(args.instrumentId ? { id: { not: args.instrumentId } } : {}) },
    select: { id: true },
  });
  if (clash) throw new SettingsError(`There's already an instrument called ${settings.name}.`);

  const { windows, ...fields } = settings;
  const data = {
    ...fields,
    location: fields.location || null,
    description: fields.description || null,
  };
  const slug = args.instrumentId ? null : await freeSlug(settings.name);

  return db.$transaction(async (tx) => {
    const instrument = args.instrumentId
      ? await tx.instrument.update({ where: { id: args.instrumentId }, data, select: { id: true, slug: true } })
      : await tx.instrument.create({ data: { ...data, slug: slug! }, select: { id: true, slug: true } });

    const existing = await tx.bookingWindow.findMany({
      where: { instrumentId: instrument.id, isActive: true },
      select: { id: true },
    });
    const kept = new Set(windows.flatMap((w) => (w.id ? [w.id] : [])));
    const dropped = existing.filter((w) => !kept.has(w.id)).map((w) => w.id);
    if (dropped.length > 0) {
      await tx.bookingWindow.updateMany({ where: { id: { in: dropped } }, data: { isActive: false } });
    }

    for (const [sortOrder, { id, ...w }] of windows.entries()) {
      const row = { ...w, sortOrder, isActive: true };
      if (id && existing.some((e) => e.id === id)) {
        await tx.bookingWindow.update({ where: { id }, data: row });
      } else {
        await tx.bookingWindow.create({ data: { ...row, instrumentId: instrument.id } });
      }
    }

    return instrument;
  });
}

export type MisfitBooking = {
  id: string;
  userName: string;
  start: Date;
  end: Date;
  reason: string;
};

/**
 * Upcoming student bookings the instrument's current windows would no longer accept —
 * made before an admin changed the hours, slot length or limits. They stand; this is
 * so the admin can decide, booking by booking, whether to cancel.
 */
export async function bookingsOutsideRules(instrumentId: string, now = new Date()): Promise<MisfitBooking[]> {
  const instrument = await db.instrument.findUnique({
    where: { id: instrumentId },
    include: { windows: { where: { isActive: true } } },
  });
  if (!instrument) return [];

  const upcoming = await db.booking.findMany({
    where: { instrumentId, type: "STUDENT", status: "CONFIRMED", startsAt: { gt: now } },
    include: { user: { select: { name: true } } },
    orderBy: { startsAt: "asc" },
  });

  return upcoming.flatMap((b) => {
    const failure = windowShapeFailure({
      instrument,
      windows: instrument.windows,
      start: b.startsAt,
      end: b.endsAt,
      userId: b.userId,
    });
    return failure
      ? [{ id: b.id, userName: b.user.name, start: b.startsAt, end: b.endsAt, reason: failure.message }]
      : [];
  });
}

/** Archive or restore. Archived instruments take no new bookings and leave the lists. */
export async function setInstrumentActive(instrumentId: string, isActive: boolean) {
  return db.instrument.update({ where: { id: instrumentId }, data: { isActive }, select: { slug: true } });
}
