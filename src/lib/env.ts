import { z } from "zod";

/**
 * Fail loudly at boot rather than at 2am when a booking confirmation silently
 * doesn't send. Anything optional here is a feature that degrades gracefully;
 * anything required is load-bearing.
 */
const schema = z.object({
  /**
   * Pooled connection. On Neon this is the `-pooler` host — that is what the app
   * uses at runtime, because serverless functions open far more connections than
   * Postgres will tolerate directly.
   */
  DATABASE_URL: z.string().min(1),

  /**
   * Unpooled connection, used only by the Prisma CLI for migrations. PgBouncer in
   * transaction mode cannot run DDL reliably, so migrations must bypass it.
   * Falls back to DATABASE_URL for local development where there is no pooler.
   */
  DIRECT_URL: z.string().min(1).optional(),

  /** Everything students see is rendered in this zone, never the browser's. */
  CAMPUS_TIMEZONE: z.string().default("America/New_York"),

  /** Comma-separated emails promoted to ADMIN on seed. Bootstrap only. */
  ADMIN_EMAILS: z.string().default(""),

  /** Signs the session cookie. Required in production; dev falls back to a constant. */
  AUTH_SECRET: z.string().min(16).optional(),

  /** Tenant lock for Entra SSO. Sign-ins whose `tid` claim differs are rejected. */
  ENTRA_TENANT_ID: z.string().optional(),
  ENTRA_CLIENT_ID: z.string().optional(),
  ENTRA_CLIENT_SECRET: z.string().optional(),

  /**
   * Shared secret for scheduled routes. Vercel Cron sends it as a bearer token when
   * this is set on the project; without it the cron endpoints are open to anyone.
   */
  CRON_SECRET: z.string().optional(),

  RESEND_API_KEY: z.string().optional(),
  MAIL_FROM: z.string().default("Instrument Calendar <onboarding@resend.dev>"),

  /** Absolute base URL, used to build links in emails. */
  APP_URL: z.string().default("http://localhost:3000"),

  NODE_ENV: z
    .enum(["development", "test", "production"])
    .default("development"),

  /**
   * Enables the password-less dev login at /dev-login. Hard-blocked in production
   * regardless of this value — see assertions below.
   */
  ENABLE_DEV_LOGIN: z
    .string()
    .optional()
    .transform((v) => v === "true"),
});

const parsed = schema.safeParse(process.env);

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((i) => `  ${i.path.join(".") || "(root)"}: ${i.message}`)
    .join("\n");
  throw new Error(`Invalid environment configuration:\n${issues}`);
}

const raw = parsed.data;

// A dev login reachable in production would be a complete authentication bypass.
// This is deliberately not configurable.
const devLoginEnabled = raw.ENABLE_DEV_LOGIN && raw.NODE_ENV !== "production";

if (raw.NODE_ENV === "production" && !raw.AUTH_SECRET) {
  throw new Error(
    "AUTH_SECRET is required in production — session cookies cannot be signed without it.",
  );
}

export const env = {
  ...raw,
  ENABLE_DEV_LOGIN: devLoginEnabled,
  AUTH_SECRET: raw.AUTH_SECRET ?? "dev-only-insecure-secret-do-not-ship",
  /** Migrations and other DDL go through the unpooled connection. */
  MIGRATION_URL: raw.DIRECT_URL ?? raw.DATABASE_URL,
  /** True once an Entra app registration exists and SSO can be wired up. */
  SSO_CONFIGURED: Boolean(
    raw.ENTRA_TENANT_ID && raw.ENTRA_CLIENT_ID && raw.ENTRA_CLIENT_SECRET,
  ),
} as const;

export type Env = typeof env;
