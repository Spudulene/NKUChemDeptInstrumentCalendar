import { z } from "zod";
import { db } from "@/lib/db";

/**
 * The two department lists an admin keeps: instructors (the INSTRUCTOR role) and
 * research advisors (the `isResearchAdvisor` flag). They are independent — someone
 * can be both — and neither touches ADMIN, which stays with IT and the seed.
 *
 * People are added by email. If the account exists it is promoted; if not, a row is
 * created now and activates when they first sign in, because both sign-in paths
 * match an existing row by email and keep its role and flag.
 */
export type PeopleKind = "instructors" | "advisors";

export class PeopleError extends Error {}

export const addPersonSchema = z.object({
  name: z.string().trim().min(1, "Enter their name.").max(80),
  email: z
    .string()
    .trim()
    .toLowerCase()
    .pipe(z.email("Enter a full email address, like name@nku.edu.")),
});

export type Person = {
  id: string;
  name: string;
  email: string;
  /** Upcoming class meetings (instructors) or students in the group (advisors). */
  count: number;
};

export async function listPeople(kind: PeopleKind, now: Date): Promise<Person[]> {
  if (kind === "instructors") {
    const rows = await db.user.findMany({
      where: { role: "INSTRUCTOR" },
      select: {
        id: true,
        name: true,
        email: true,
        _count: {
          select: { bookings: { where: { type: "CLASS", status: "CONFIRMED", startsAt: { gt: now } } } },
        },
      },
      orderBy: { name: "asc" },
    });
    return rows.map(({ _count, ...p }) => ({ ...p, count: _count.bookings }));
  }

  const rows = await db.user.findMany({
    where: { isResearchAdvisor: true },
    select: { id: true, name: true, email: true, _count: { select: { advisees: true } } },
    orderBy: { name: "asc" },
  });
  return rows.map(({ _count, ...p }) => ({ ...p, count: _count.advisees }));
}

/** Add someone to a list. Returns the name they are listed under. */
export async function addPerson(
  kind: PeopleKind,
  input: z.infer<typeof addPersonSchema>,
): Promise<string> {
  const existing = await db.user.findUnique({
    where: { email: input.email },
    select: { id: true, name: true, role: true, isResearchAdvisor: true },
  });

  if (kind === "instructors") {
    if (existing?.role === "ADMIN") {
      throw new PeopleError(`${existing.name} is an admin, which already includes everything instructors can do.`);
    }
    if (existing?.role === "INSTRUCTOR") {
      throw new PeopleError(`${existing.name} is already an instructor.`);
    }
  } else if (existing?.isResearchAdvisor) {
    throw new PeopleError(`${existing.name} is already listed as a research advisor.`);
  }

  const grant = kind === "instructors" ? { role: "INSTRUCTOR" as const } : { isResearchAdvisor: true };

  // An existing account keeps its own name; it's what they signed in with.
  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: grant });
    return existing.name;
  }
  await db.user.create({ data: { email: input.email, name: input.name, ...grant } });
  return input.name;
}

/**
 * Take someone off a list. Their account and history stay.
 *
 * Removing an advisor also clears them as the default group of their students, so
 * the account menu asks them to pick again instead of offering a group that's gone.
 * Bookings keep their own copy of the advisor, so past attribution is unchanged.
 */
export async function removePerson(kind: PeopleKind, userId: string): Promise<void> {
  if (kind === "instructors") {
    await db.user.updateMany({ where: { id: userId, role: "INSTRUCTOR" }, data: { role: "STUDENT" } });
    return;
  }

  await db.$transaction([
    db.user.updateMany({ where: { advisorId: userId }, data: { advisorId: null } }),
    db.user.updateMany({ where: { id: userId }, data: { isResearchAdvisor: false } }),
  ]);
}
