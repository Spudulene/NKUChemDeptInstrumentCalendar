import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { previewPreemption, type PreemptionTarget } from "@/lib/booking/create";
import {
  compareCivil,
  formatRange,
  formatTimeOnly,
  instantToCivil,
  instantToMinutes,
  minutesToClock,
} from "@/lib/time";
import { resolveClassTimes } from "@/app/(site)/classes/times";
import {
  previewKey,
  type ClassPreviewResponse,
  type ClassPreviewRow,
} from "@/app/(site)/classes/types";

export const dynamic = "force-dynamic";

const SLOT_MINUTES = 30;

/**
 * Who a class reservation would affect, recomputed as the instructor edits the form.
 *
 * A GET route rather than a Server Action on purpose: Next dispatches Server Actions
 * one at a time per client, so a preview on every keystroke would queue in front of
 * the actual reservation submit. This is read-only, cancellable, and runs alongside.
 *
 * It is advisory. `createPriorityBooking` recomputes the same preview at submit time
 * and refuses if the bookings it would cancel are not the ones shown here.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fields = {
    instrumentId: params.get("instrumentId") ?? "",
    date: params.get("date") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const key = previewKey(fields);
  const fail = (error: string, status = 400) =>
    NextResponse.json<ClassPreviewResponse>({ ok: false, key, error }, { status });

  const user = await getSession();
  if (!user) return fail("Your session expired. Sign in and try again.", 401);
  if (user.role !== "INSTRUCTOR" && user.role !== "ADMIN") {
    return fail("Only instructors and admins can reserve class time.", 403);
  }

  const times = resolveClassTimes(fields.date, fields.from, fields.to);
  if (!times) return fail("Pick a date and a start and end time.");

  const now = new Date();
  if (times.end <= now) return fail("That time has already passed.");

  const instrument = await db.instrument.findUnique({
    where: { id: fields.instrumentId },
    select: { isActive: true, name: true },
  });
  if (!instrument) return fail("That instrument no longer exists.", 404);
  if (!instrument.isActive) {
    return fail(`${instrument.name} is no longer accepting bookings.`);
  }

  const preview = await previewPreemption({
    instrumentId: fields.instrumentId,
    start: times.start,
    end: times.end,
    type: "CLASS",
    now,
  });

  const toRow = (t: PreemptionTarget): ClassPreviewRow => {
    const sameDay = (instant: Date) => compareCivil(instantToCivil(instant), times.day) === 0;
    const clock = (instant: Date) => minutesToClock(instantToMinutes(instant));

    const minutesUntil = Math.round((t.start.getTime() - now.getTime()) / 60_000);
    const startsIn =
      minutesUntil > 0 && minutesUntil < 24 * 60
        ? `${Math.floor(minutesUntil / 60)} h ${minutesUntil % 60} min`
        : null;

    // Offer "start after it instead" only when that start still lands on the same day
    // and leaves some of the reservation. Rounded up to the form's half-hour grid.
    let resumeFrom: string | null = null;
    if (t.inProgress && sameDay(t.end)) {
      const rounded = Math.ceil(instantToMinutes(t.end) / SLOT_MINUTES) * SLOT_MINUTES;
      const stillShort = times.endsNextDay || rounded < times.toMinute;
      if (rounded < 24 * 60 && stillShort) resumeFrom = minutesToClock(rounded);
    }

    const parts = t.userName.trim().split(/\s+/);
    const initials = (
      parts.length > 1 ? parts[0][0] + parts[parts.length - 1][0] : parts[0].slice(0, 2)
    ).toUpperCase();

    return {
      id: t.id,
      name: t.userName,
      initials,
      group: t.groupName,
      time:
        sameDay(t.start) && sameDay(t.end)
          ? `${clock(t.start)} – ${clock(t.end)}`
          : formatRange(t.start, t.end),
      range: formatRange(t.start, t.end),
      startsIn,
      startsSoon: t.startsSoon,
      resumeFrom,
      type: t.type,
    };
  };

  return NextResponse.json<ClassPreviewResponse>({
    ok: true,
    key,
    asOf: formatTimeOnly(now),
    targets: preview.targets.map(toRow),
    inProgress: preview.inProgress.map(toRow),
    blockedBy: preview.blockedBy.map(toRow),
  });
}
