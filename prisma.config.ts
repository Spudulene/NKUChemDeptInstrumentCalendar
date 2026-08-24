import "dotenv/config";
import { defineConfig } from "prisma/config";

/**
 * The CLI connects directly, the app connects through the pooler.
 *
 * Neon's pooled endpoint runs PgBouncer in transaction mode, which cannot reliably
 * run the DDL and advisory locks that migrations need. DIRECT_URL is the unpooled
 * host; it falls back to DATABASE_URL for local development, where there is no
 * pooler and the two are the same thing.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  migrations: {
    path: "prisma/migrations",
    seed: "tsx prisma/seed.ts",
  },
  datasource: {
    url: process.env["DIRECT_URL"] ?? process.env["DATABASE_URL"],
    shadowDatabaseUrl: process.env["SHADOW_DATABASE_URL"],
  },
});
