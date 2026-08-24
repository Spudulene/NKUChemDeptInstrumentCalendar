import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@/generated/prisma/client";
import { env } from "@/lib/env";

/**
 * Prisma 7 runs the query compiler in-process and talks to Postgres through a
 * driver adapter, so the connection pool is ours to configure.
 *
 * `max: 5` is deliberate. On Vercel every warm lambda holds its own pool, and
 * Neon's pooler has a ceiling; a large per-instance pool multiplied by however
 * many instances Vercel decides to run is how you exhaust connections under the
 * exact load spike you built the app to handle.
 */
function createClient() {
  const adapter = new PrismaPg({
    connectionString: env.DATABASE_URL,
    max: 5,
    idleTimeoutMillis: 10_000,
    connectionTimeoutMillis: 10_000,
  });

  return new PrismaClient({
    adapter,
    log:
      env.NODE_ENV === "development"
        ? ["warn", "error"]
        : ["error"],
  });
}

// Next's dev server re-evaluates modules on every hot reload. Without this the
// pool count climbs until Postgres refuses new connections.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
