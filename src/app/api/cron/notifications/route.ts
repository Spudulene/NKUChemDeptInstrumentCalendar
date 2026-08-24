import { NextResponse } from "next/server";
import { env } from "@/lib/env";
import { sendPendingPreemptionNotices } from "@/lib/email";

/**
 * Retries preemption notices that failed their immediate send.
 *
 * This is a safety net, not the delivery path — students are mailed within seconds of
 * being bumped, by `createPriorityBooking`. This run only catches rows left unstamped
 * because the email provider was down at that moment.
 *
 * That split is deliberate: it means the app is correct on a once-a-day scheduler
 * (Vercel Hobby's limit) and equally correct on a cron container or systemd timer if
 * this ends up on a university VM. Nothing time-sensitive depends on the frequency.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET(request: Request) {
  // Vercel Cron sends CRON_SECRET as a bearer token. Unset in local development,
  // where the endpoint is only reachable from the machine running it anyway.
  if (env.CRON_SECRET) {
    const provided = request.headers.get("authorization");
    if (provided !== `Bearer ${env.CRON_SECRET}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  } else if (env.NODE_ENV === "production") {
    return NextResponse.json(
      { error: "CRON_SECRET is not configured." },
      { status: 500 },
    );
  }

  try {
    const result = await sendPendingPreemptionNotices();
    return NextResponse.json({ ok: true, ...result });
  } catch (error) {
    console.error("[cron] preemption notices failed:", error);
    return NextResponse.json(
      { ok: false, error: "Notification run failed." },
      { status: 500 },
    );
  }
}
