import { createHmac, timingSafeEqual } from "node:crypto";
import { cookies } from "next/headers";
import type { Role } from "@/generated/prisma/enums";
import { db } from "@/lib/db";
import { env } from "@/lib/env";

/**
 * Session handling, currently backed by a dev login.
 *
 * The shape here is the shape Entra SSO will use: a signed cookie carrying a user id,
 * with the database as the source of truth for role. When the app registration lands,
 * `signIn` gets called from the OAuth callback with the verified `oid`/`email` claims
 * instead of from a dev form, and nothing downstream changes.
 *
 * Two things the callback will need to do that the dev login does not:
 *   1. Reject any token whose `tid` claim is not ENTRA_TENANT_ID. Without that check,
 *      any Microsoft account anywhere can sign in.
 *   2. Match on `entraObjectId` before email — students change display names and
 *      occasionally addresses, but the object id is stable.
 */

const COOKIE = "ic_session";
const MAX_AGE_SECONDS = 60 * 60 * 12;

export type SessionUser = {
  id: string;
  email: string;
  name: string;
  role: Role;
};

function sign(value: string): string {
  return createHmac("sha256", env.AUTH_SECRET).update(value).digest("base64url");
}

function serialize(userId: string): string {
  const payload = `${userId}.${Date.now()}`;
  return `${payload}.${sign(payload)}`;
}

function deserialize(token: string): string | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;

  const [userId, issuedAt, signature] = parts;
  const expected = sign(`${userId}.${issuedAt}`);

  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  const age = Date.now() - Number(issuedAt);
  if (!Number.isFinite(age) || age < 0 || age > MAX_AGE_SECONDS * 1000) return null;

  return userId;
}

export async function getSession(): Promise<SessionUser | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;

  const userId = deserialize(token);
  if (!userId) return null;

  // Role is read fresh rather than trusted from the cookie, so a demotion takes
  // effect on the next request instead of whenever the session happens to expire.
  const user = await db.user.findUnique({
    where: { id: userId },
    select: { id: true, email: true, name: true, role: true },
  });

  return user ?? null;
}

export async function requireUser(): Promise<SessionUser> {
  const user = await getSession();
  if (!user) throw new Error("UNAUTHENTICATED");
  return user;
}

export async function requireRole(...roles: Role[]): Promise<SessionUser> {
  const user = await requireUser();
  if (!roles.includes(user.role)) throw new Error("FORBIDDEN");
  return user;
}

export function isAtLeast(user: SessionUser | null, role: Role): boolean {
  if (!user) return false;
  const rank: Record<Role, number> = { STUDENT: 0, INSTRUCTOR: 1, ADMIN: 2 };
  return rank[user.role] >= rank[role];
}

async function establishSession(userId: string): Promise<void> {
  (await cookies()).set(COOKIE, serialize(userId), {
    httpOnly: true,
    sameSite: "lax",
    secure: env.NODE_ENV === "production",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

/**
 * Development-only sign-in. Creates the user on first use so seeding a fresh database
 * isn't a prerequisite for clicking around.
 *
 * `env.ENABLE_DEV_LOGIN` is already forced false in production (see env.ts); this
 * second check is here because an auth bypass is worth failing twice over.
 */
export async function devSignIn(email: string, name?: string): Promise<SessionUser> {
  if (!env.ENABLE_DEV_LOGIN || env.NODE_ENV === "production") {
    throw new Error("Dev login is disabled.");
  }

  const normalized = email.trim().toLowerCase();
  const adminEmails = env.ADMIN_EMAILS.split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  const user = await db.user.upsert({
    where: { email: normalized },
    update: {},
    create: {
      email: normalized,
      name: name?.trim() || normalized.split("@")[0],
      role: adminEmails.includes(normalized) ? "ADMIN" : "STUDENT",
    },
    select: { id: true, email: true, name: true, role: true },
  });

  await establishSession(user.id);
  return user;
}

/**
 * The seam SSO will call. Given verified claims from Entra, find or create the user
 * and start a session. Not reachable until an app registration exists.
 */
export async function signInFromEntra(claims: {
  oid: string;
  email: string;
  name: string;
  tid: string;
}): Promise<SessionUser> {
  if (!env.ENTRA_TENANT_ID || claims.tid !== env.ENTRA_TENANT_ID) {
    throw new Error("Sign-in rejected: account is outside the university tenant.");
  }

  const email = claims.email.trim().toLowerCase();

  const existing = await db.user.findFirst({
    where: { OR: [{ entraObjectId: claims.oid }, { email }] },
    select: { id: true },
  });

  const user = existing
    ? await db.user.update({
        where: { id: existing.id },
        data: { entraObjectId: claims.oid, email, name: claims.name },
        select: { id: true, email: true, name: true, role: true },
      })
    : await db.user.create({
        data: { entraObjectId: claims.oid, email, name: claims.name },
        select: { id: true, email: true, name: true, role: true },
      });

  await establishSession(user.id);
  return user;
}

export async function signOut(): Promise<void> {
  (await cookies()).delete(COOKIE);
}
