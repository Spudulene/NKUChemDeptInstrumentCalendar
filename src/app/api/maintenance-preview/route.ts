import { NextResponse, type NextRequest } from "next/server";
import { getSession } from "@/lib/auth";
import { db } from "@/lib/db";
import { previewPreemption } from "@/lib/booking/create";
import { resolveMaintenanceTimes } from "@/lib/admin/maintenance";
import { formatTimeOnly } from "@/lib/time";
import { previewRow } from "@/app/(site)/classes/preview-rows";
import {
  maintenanceKey,
  type MaintenancePreviewResponse,
} from "@/app/(site)/admin/maintenance/types";

export const dynamic = "force-dynamic";

/**
 * Who a maintenance block would affect, recomputed as the admin edits the form. A GET
 * route rather than a Server Action for the same reason as /api/class-preview, and
 * just as advisory: `createPriorityBooking` re-checks at submit.
 */
export async function GET(request: NextRequest) {
  const params = request.nextUrl.searchParams;
  const fields = {
    instrumentId: params.get("instrumentId") ?? "",
    startDate: params.get("startDate") ?? "",
    startTime: params.get("startTime") ?? "",
    endDate: params.get("endDate") ?? "",
    endTime: params.get("endTime") ?? "",
  };
  const key = maintenanceKey(fields);
  const fail = (error: string, status = 400) =>
    NextResponse.json<MaintenancePreviewResponse>({ ok: false, key, error }, { status });

  const user = await getSession();
  if (!user) return fail("Your session expired. Sign in and try again.", 401);
  if (user.role !== "ADMIN") return fail("Only admins can schedule maintenance.", 403);

  const times = resolveMaintenanceTimes(fields);
  if (!times) return fail("Pick when it starts and ends.");
  if (times.end <= times.start) return fail("The end must be after the start.");

  const now = new Date();
  if (times.end <= now) return fail("That time has already passed.");

  const instrument = await db.instrument.findUnique({
    where: { id: fields.instrumentId },
    select: { isActive: true, name: true },
  });
  if (!instrument) return fail("That instrument no longer exists.", 404);
  if (!instrument.isActive) return fail(`${instrument.name} is archived.`);

  const preview = await previewPreemption({
    instrumentId: fields.instrumentId,
    start: times.start,
    end: times.end,
    type: "MAINTENANCE",
    now,
  });

  const toRow = (t: (typeof preview.targets)[number]) => previewRow(t, times.day, now);

  return NextResponse.json<MaintenancePreviewResponse>({
    ok: true,
    key,
    asOf: formatTimeOnly(now),
    targets: preview.targets.map(toRow),
    inProgress: preview.inProgress.map(toRow),
    blockedBy: preview.blockedBy.map(toRow),
  });
}
