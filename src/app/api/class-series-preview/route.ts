import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { expandSeries, patternProblem, previewSeries } from "@/lib/booking/series";
import { formatDayLabel, formatTimeOnly } from "@/lib/time";
import { previewRow } from "@/app/(site)/classes/preview-rows";
import { resolveSeriesPattern } from "@/app/(site)/classes/times";
import { seriesKey, type SeriesPreviewResponse } from "@/app/(site)/classes/types";

export const dynamic = "force-dynamic";

/**
 * Every meeting a weekly class reservation would produce, and who each one affects.
 * The weekly counterpart of /api/class-preview, and advisory in the same way:
 * `createClassSeries` recomputes it at submit and refuses if it changed.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fields = {
    instrumentId: params.get("instrumentId") ?? "",
    first: params.get("first") ?? "",
    until: params.get("until") ?? "",
    days: params.get("days") ?? "",
    from: params.get("from") ?? "",
    to: params.get("to") ?? "",
  };
  const key = seriesKey(fields);
  const fail = (error: string, status = 400) =>
    NextResponse.json<SeriesPreviewResponse>({ ok: false, key, error }, { status });

  const user = await getSession();
  if (!user) return fail("Your session expired. Sign in and try again.", 401);
  if (user.role !== "INSTRUCTOR" && user.role !== "ADMIN") {
    return fail("Only instructors and admins can reserve class time.", 403);
  }

  const pattern = resolveSeriesPattern(fields);
  if (!pattern) return fail("Pick a first and last date and a start and end time.");
  const problem = patternProblem(pattern);
  if (problem) return fail(problem);

  const instrument = await db.instrument.findUnique({
    where: { id: fields.instrumentId },
    select: { isActive: true, name: true },
  });
  if (!instrument) return fail("That instrument no longer exists.", 404);
  if (!instrument.isActive) {
    return fail(`${instrument.name} is no longer accepting bookings.`);
  }

  const now = new Date();
  const meetings = expandSeries(pattern, now);
  if (meetings.length === 0) return fail("No dates in that range fall on the days you picked.");

  const previews = await previewSeries({ instrumentId: fields.instrumentId, meetings, now });

  return NextResponse.json<SeriesPreviewResponse>({
    ok: true,
    key,
    asOf: formatTimeOnly(now),
    dates: previews.map((p) => ({
      date: p.date,
      label: formatDayLabel(p.start),
      targets: p.targets.map((t) => previewRow(t, p.day, now)),
      inProgress: p.inProgress.map((t) => previewRow(t, p.day, now)),
      blockedBy: p.blockedBy.map((t) => previewRow(t, p.day, now)),
    })),
  });
}
