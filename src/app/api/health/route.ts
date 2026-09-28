import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * Health check for the container and for whatever IT points at it.
 *
 * It touches the database on purpose. A booking calendar that cannot reach Postgres
 * is serving nobody even though the process is alive, and a check that only proves
 * Node is running would report that state as healthy.
 *
 * Reachable without signing in, so it deliberately says nothing useful to a stranger:
 * no version, no hostname, no connection details, and no error text from the failure.
 */

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

export async function GET() {
  try {
    await db.$queryRaw`select 1`;
    return NextResponse.json(
      { status: "ok" },
      { headers: { "cache-control": "no-store" } },
    );
  } catch (error) {
    console.error("[health] database unreachable:", error);
    return NextResponse.json(
      { status: "unavailable" },
      { status: 503, headers: { "cache-control": "no-store" } },
    );
  }
}
