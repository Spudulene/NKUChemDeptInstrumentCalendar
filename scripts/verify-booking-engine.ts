import "dotenv/config";
import { db } from "@/lib/db";
import {
  addCivilDays,
  civilToInstant,
  civilWeekday,
  instantToCivil,
  todayCivil,
  type CivilDate,
} from "@/lib/time";
import {
  expandWindows,
  windowSpanMinutes,
  type WindowRule,
} from "@/lib/booking/windows";
import { computeOpenings, findOpenings } from "@/lib/booking/availability";
import { validateBooking } from "@/lib/booking/rules";
import { deliverPreemptionNotices } from "@/lib/email";
import {
  BookingError,
  createPriorityBooking,
  createStudentBooking,
  previewPreemption,
} from "@/lib/booking/create";

/**
 * End-to-end checks against a real Postgres. The exclusion constraint, DST-correct
 * window expansion, and the preemption transaction are the three things most likely
 * to be quietly wrong, and none of them can be verified by types alone.
 *
 *   npm run db:verify
 */

let failures = 0;
let checks = 0;

function check(label: string, ok: boolean, detail?: string) {
  checks += 1;
  if (ok) {
    console.log(`  PASS  ${label}`);
  } else {
    failures += 1;
    console.error(`  FAIL  ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

function section(title: string) {
  console.log(`\n${title}`);
}

const MIN = 60_000;
const hm = (h: number, m = 0) => h * 60 + m;

/** A window rule detached from the database, for pure expansion tests. */
function rule(overrides: Partial<WindowRule> & Pick<WindowRule, "startMinute" | "endMinute">): WindowRule {
  return {
    id: "w",
    name: "Test",
    daysOfWeek: ["SUN", "MON", "TUE", "WED", "THU", "FRI", "SAT"],
    minDurationMinutes: 30,
    maxDurationMinutes: 120,
    slotSizeMinutes: 30,
    wholeBlockOnly: false,
    maxConsecutiveSlots: null,
    maxBookingsPerUserPerWeek: null,
    isActive: true,
    ...overrides,
  };
}

function nextWeekday(from: CivilDate, target: string): CivilDate {
  let date = from;
  for (let i = 0; i < 8; i += 1) {
    if (civilWeekday(date) === target) return date;
    date = addCivilDays(date, 1);
  }
  throw new Error("unreachable");
}

async function main() {
  // -------------------------------------------------------------------------
  section("Window expansion and midnight crossing");
  // -------------------------------------------------------------------------

  const overnight = rule({
    startMinute: hm(17),
    endMinute: hm(8),
    wholeBlockOnly: true,
    minDurationMinutes: 900,
    maxDurationMinutes: 900,
  });

  check(
    "overnight window spans 900 minutes (17:00 -> 08:00)",
    windowSpanMinutes(overnight) === 900,
    `got ${windowSpanMinutes(overnight)}`,
  );

  const daytime = rule({ startMinute: hm(8), endMinute: hm(17) });
  check(
    "daytime window spans 540 minutes",
    windowSpanMinutes(daytime) === 540,
    `got ${windowSpanMinutes(daytime)}`,
  );

  const endOfDay = rule({ startMinute: hm(8), endMinute: hm(24) });
  check(
    "08:00 -> 24:00 spans 960 minutes and does not wrap",
    windowSpanMinutes(endOfDay) === 960,
    `got ${windowSpanMinutes(endOfDay)}`,
  );

  const friday = { y: 2026, m: 9, d: 4 }; // a Friday
  const [occurrence] = expandWindows([overnight], friday, friday);
  const endsSaturday = instantToCivil(occurrence.end);
  check(
    "a Friday overnight window ends Saturday morning",
    endsSaturday.d === 5 && occurrence.end.getTime() - occurrence.start.getTime() === 900 * MIN,
    `ends ${occurrence.end.toISOString()}`,
  );

  // -------------------------------------------------------------------------
  section("Daylight saving transitions");
  // -------------------------------------------------------------------------

  // US DST 2026: forward Sun Mar 8, back Sun Nov 1.
  const springNight = { y: 2026, m: 3, d: 7 };
  const [spring] = expandWindows([overnight], springNight, springNight);
  const springMinutes = (spring.end.getTime() - spring.start.getTime()) / MIN;
  check(
    "spring-forward overnight is 14 real hours, not 15",
    springMinutes === 840,
    `got ${springMinutes} minutes`,
  );

  const fallNight = { y: 2026, m: 10, d: 31 };
  const [fall] = expandWindows([overnight], fallNight, fallNight);
  const fallMinutes = (fall.end.getTime() - fall.start.getTime()) / MIN;
  check(
    "fall-back overnight is 16 real hours",
    fallMinutes === 960,
    `got ${fallMinutes} minutes`,
  );

  check(
    "wall-clock endpoints hold across DST (both nights end at 08:00 local)",
    spring.end.toLocaleString("en-US", {
      timeZone: "America/New_York",
      hour: "numeric",
    }) === "8 AM" &&
      fall.end.toLocaleString("en-US", {
        timeZone: "America/New_York",
        hour: "numeric",
      }) === "8 AM",
  );

  // -------------------------------------------------------------------------
  section("Availability");
  // -------------------------------------------------------------------------

  const monday = nextWeekday(addCivilDays(todayCivil(), 3), "MON");
  const dayWindow = rule({
    id: "day",
    name: "Daytime",
    startMinute: hm(8),
    endMinute: hm(17),
    daysOfWeek: ["MON"],
  });

  const openWhole = computeOpenings({
    windows: [dayWindow],
    busy: [],
    durationMinutes: 60,
    from: civilToInstant(monday, 0),
    to: civilToInstant(addCivilDays(monday, 1), 0),
    limit: 100,
  });
  check(
    "an empty 8-hour window offers 17 half-hour-aligned starts for a 1h booking",
    openWhole.length === 17,
    `got ${openWhole.length}`,
  );

  const withBusy = computeOpenings({
    windows: [dayWindow],
    busy: [
      {
        start: civilToInstant(monday, hm(9)),
        end: civilToInstant(monday, hm(12)),
      },
    ],
    durationMinutes: 60,
    from: civilToInstant(monday, 0),
    to: civilToInstant(addCivilDays(monday, 1), 0),
    bufferMinutes: 15,
    limit: 100,
  });
  const collides = withBusy.some(
    (o) =>
      o.start < civilToInstant(monday, hm(12, 15)) &&
      o.end > civilToInstant(monday, hm(8, 45)),
  );
  check("suggestions respect existing bookings plus buffer", !collides);

  // -------------------------------------------------------------------------
  section("Database constraints");
  // -------------------------------------------------------------------------

  const instrument = await db.instrument.upsert({
    where: { slug: "verify-fixture" },
    update: {},
    create: {
      slug: "verify-fixture",
      name: "Verification Fixture",
      bookingHorizonDays: 60,
      bufferMinutes: 0,
      cancellationDeadlineMinutes: 0,
      windows: {
        create: [
          {
            name: "Daytime",
            daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
            startMinute: hm(8),
            endMinute: hm(17),
            minDurationMinutes: 30,
            maxDurationMinutes: 120,
            slotSizeMinutes: 30,
            maxConsecutiveSlots: 4,
          },
          {
            name: "Overnight",
            daysOfWeek: ["MON", "TUE", "WED", "THU", "FRI"],
            startMinute: hm(17),
            endMinute: hm(8),
            minDurationMinutes: 900,
            maxDurationMinutes: 900,
            slotSizeMinutes: 900,
            wholeBlockOnly: true,
            maxBookingsPerUserPerWeek: 1,
          },
        ],
      },
    },
    include: { windows: true },
  });

  await db.booking.deleteMany({ where: { instrumentId: instrument.id } });

  const student = await db.user.upsert({
    where: { email: "verify-student@nku.edu" },
    update: { role: "STUDENT" },
    create: { email: "verify-student@nku.edu", name: "Verify Student", role: "STUDENT" },
  });
  const other = await db.user.upsert({
    where: { email: "verify-student2@nku.edu" },
    update: { role: "STUDENT" },
    create: { email: "verify-student2@nku.edu", name: "Other Student", role: "STUDENT" },
  });
  const instructor = await db.user.upsert({
    where: { email: "verify-instructor@nku.edu" },
    update: { role: "INSTRUCTOR" },
    create: {
      email: "verify-instructor@nku.edu",
      name: "Verify Instructor",
      role: "INSTRUCTOR",
    },
  });

  // A PI who never signs in: role STUDENT, but flagged as an advisor.
  const advisor = await db.user.upsert({
    where: { email: "verify-advisor@nku.edu" },
    update: { isResearchAdvisor: true },
    create: {
      email: "verify-advisor@nku.edu",
      name: "Dr. Verify Advisor",
      isResearchAdvisor: true,
    },
  });
  await db.user.update({
    where: { id: student.id },
    data: { advisorId: advisor.id },
  });

  const base = {
    instrumentId: instrument.id,
    userId: student.id,
    createdById: student.id,
    type: "STUDENT" as const,
    status: "CONFIRMED" as const,
  };

  const slotA = {
    start: civilToInstant(monday, hm(9)),
    end: civilToInstant(monday, hm(10)),
  };

  await db.booking.create({
    data: { ...base, startsAt: slotA.start, endsAt: slotA.end },
  });

  // Straight through Prisma, bypassing every application rule: the database itself
  // has to be the thing that refuses.
  let rejected = false;
  try {
    await db.booking.create({
      data: {
        ...base,
        startsAt: civilToInstant(monday, hm(9, 30)),
        endsAt: civilToInstant(monday, hm(10, 30)),
      },
    });
  } catch {
    rejected = true;
  }
  check("exclusion constraint rejects an overlapping insert", rejected);

  let adjacentOk = true;
  try {
    await db.booking.create({
      data: {
        ...base,
        startsAt: slotA.end,
        endsAt: civilToInstant(monday, hm(11)),
      },
    });
  } catch {
    adjacentOk = false;
  }
  check("back-to-back bookings are allowed ('[)' bounds)", adjacentOk);

  let cancelledFreesSlot = true;
  try {
    const doomed = await db.booking.create({
      data: {
        ...base,
        startsAt: civilToInstant(monday, hm(13)),
        endsAt: civilToInstant(monday, hm(14)),
      },
    });
    await db.booking.update({
      where: { id: doomed.id },
      data: { status: "CANCELLED" },
    });
    await db.booking.create({
      data: {
        ...base,
        userId: other.id,
        createdById: other.id,
        startsAt: civilToInstant(monday, hm(13)),
        endsAt: civilToInstant(monday, hm(14)),
      },
    });
  } catch {
    cancelledFreesSlot = false;
  }
  check(
    "a cancelled booking drops out of the constraint and frees its slot",
    cancelledFreesSlot,
  );

  let descriptionEnforced = false;
  try {
    await db.booking.create({
      data: {
        ...base,
        type: "CLASS",
        startsAt: civilToInstant(monday, hm(15)),
        endsAt: civilToInstant(monday, hm(16)),
        description: null,
      },
    });
  } catch {
    descriptionEnforced = true;
  }
  check("CLASS bookings cannot be created without a description", descriptionEnforced);

  // -------------------------------------------------------------------------
  section("Rule chain");
  // -------------------------------------------------------------------------

  const ctx = {
    instrument,
    windows: instrument.windows,
    actor: { id: student.id, role: "STUDENT" as const },
    now: new Date(),
    neighbors: [],
    userBookingsThisWeek: [],
  };

  const cases: Array<[string, Date, Date, string | null]> = [
    ["a valid 1-hour daytime booking passes", civilToInstant(addCivilDays(monday, 7), hm(10)), civilToInstant(addCivilDays(monday, 7), hm(11)), null],
    ["07:00 is outside the window", civilToInstant(addCivilDays(monday, 7), hm(7)), civilToInstant(addCivilDays(monday, 7), hm(8)), "OUTSIDE_WINDOW"],
    ["a 3-hour daytime booking exceeds the cap", civilToInstant(addCivilDays(monday, 7), hm(10)), civilToInstant(addCivilDays(monday, 7), hm(13)), "TOO_LONG"],
    ["09:10 is off the 30-minute grid", civilToInstant(addCivilDays(monday, 7), hm(9, 10)), civilToInstant(addCivilDays(monday, 7), hm(10, 10)), "OFF_GRID"],
    ["a booking spanning the day/overnight boundary is rejected", civilToInstant(addCivilDays(monday, 7), hm(16)), civilToInstant(addCivilDays(monday, 7), hm(18)), "OUTSIDE_WINDOW"],
  ];

  for (const [label, start, end, expected] of cases) {
    const result = validateBooking({
      ...ctx,
      request: { userId: student.id, start, end, type: "STUDENT" },
    });
    const actual = result.ok ? null : result.failure.code;
    check(label, actual === expected, `expected ${expected ?? "pass"}, got ${actual ?? "pass"}`);
  }

  const overnightStart = civilToInstant(addCivilDays(monday, 7), hm(17));
  const overnightEnd = civilToInstant(addCivilDays(monday, 8), hm(8));
  const overnightResult = validateBooking({
    ...ctx,
    request: {
      userId: student.id,
      start: overnightStart,
      end: overnightEnd,
      type: "STUDENT",
    },
  });
  check(
    "a full 17:00 -> 08:00 overnight block passes despite the 2-hour daytime cap",
    overnightResult.ok,
    overnightResult.ok ? undefined : overnightResult.failure.code,
  );

  const partialOvernight = validateBooking({
    ...ctx,
    request: {
      userId: student.id,
      start: overnightStart,
      end: civilToInstant(addCivilDays(monday, 7), hm(20)),
      type: "STUDENT",
    },
  });
  check(
    "a partial overnight booking is rejected (whole block only)",
    !partialOvernight.ok && partialOvernight.failure.code === "WHOLE_BLOCK_ONLY",
    partialOvernight.ok ? "unexpectedly passed" : partialOvernight.failure.code,
  );

  // -------------------------------------------------------------------------
  section("Research group attribution");
  // -------------------------------------------------------------------------

  const attributed = { ...instrument, requireResearchAdvisor: true };
  const advisorDay = addCivilDays(monday, 7);

  const missingAdvisor = validateBooking({
    ...ctx,
    instrument: attributed,
    request: {
      userId: student.id,
      start: civilToInstant(advisorDay, hm(10)),
      end: civilToInstant(advisorDay, hm(11)),
      type: "STUDENT",
    },
  });
  check(
    "an instrument requiring attribution rejects a booking with no research group",
    !missingAdvisor.ok && missingAdvisor.failure.code === "ADVISOR_REQUIRED",
    missingAdvisor.ok ? "unexpectedly passed" : missingAdvisor.failure.code,
  );

  const withAdvisor = validateBooking({
    ...ctx,
    instrument: attributed,
    request: {
      userId: student.id,
      start: civilToInstant(advisorDay, hm(10)),
      end: civilToInstant(advisorDay, hm(11)),
      type: "STUDENT",
      advisorId: advisor.id,
    },
  });
  check("naming a research group satisfies the requirement", withAdvisor.ok);

  const defaulted = await createStudentBooking({
    instrumentId: instrument.id,
    request: {
      userId: student.id,
      start: civilToInstant(addCivilDays(monday, 21), hm(14)),
      end: civilToInstant(addCivilDays(monday, 21), hm(15)),
      type: "STUDENT",
      // advisorId omitted entirely — should fall back to the student's group.
    },
    actor: { id: student.id, role: "STUDENT" },
  });
  check(
    "an omitted research group defaults to the student's advisor",
    defaulted.advisorId === advisor.id,
    `got ${defaulted.advisorId}`,
  );

  let unknownAdvisorRejected = false;
  try {
    await createStudentBooking({
      instrumentId: instrument.id,
      request: {
        userId: student.id,
        start: civilToInstant(addCivilDays(monday, 21), hm(16)),
        end: civilToInstant(addCivilDays(monday, 21), hm(17)),
        type: "STUDENT",
        // `other` is a student, not a flagged advisor.
        advisorId: other.id,
      },
      actor: { id: student.id, role: "STUDENT" },
    });
  } catch (error) {
    unknownAdvisorRejected =
      error instanceof BookingError && error.failure.code === "UNKNOWN_ADVISOR";
  }
  check(
    "someone who is not a flagged advisor cannot be named as one",
    unknownAdvisorRejected,
  );

  // -------------------------------------------------------------------------
  section("Preemption");
  // -------------------------------------------------------------------------

  const classDay = addCivilDays(monday, 14);
  const victim = await createStudentBooking({
    instrumentId: instrument.id,
    request: {
      userId: student.id,
      start: civilToInstant(classDay, hm(10)),
      end: civilToInstant(classDay, hm(11)),
      type: "STUDENT",
    },
    actor: { id: student.id, role: "STUDENT" },
  });
  check("student booking created through the full path", Boolean(victim.id));

  const preview = await previewPreemption({
    instrumentId: instrument.id,
    start: civilToInstant(classDay, hm(9)),
    end: civilToInstant(classDay, hm(12)),
    type: "CLASS",
  });
  check(
    "preview reports the student booking that would be displaced",
    preview.targets.length === 1 && preview.targets[0].id === victim.id,
    `${preview.targets.length} target(s)`,
  );

  let requiresConfirmation = false;
  try {
    await createPriorityBooking({
      instrumentId: instrument.id,
      request: {
        userId: instructor.id,
        start: civilToInstant(classDay, hm(9)),
        end: civilToInstant(classDay, hm(12)),
        type: "CLASS",
        description: "CHE 320 — instrument training",
      },
      actor: { id: instructor.id, role: "INSTRUCTOR" },
    });
  } catch (error) {
    requiresConfirmation =
      error instanceof BookingError && error.failure.code === "CONFIRMATION_REQUIRED";
  }
  check("preemption refuses to proceed without explicit confirmation", requiresConfirmation);

  const priority = await createPriorityBooking({
    instrumentId: instrument.id,
    request: {
      userId: instructor.id,
      start: civilToInstant(classDay, hm(9)),
      end: civilToInstant(classDay, hm(12)),
      type: "CLASS",
      description: "CHE 320 — instrument training",
    },
    actor: { id: instructor.id, role: "INSTRUCTOR" },
    confirmPreemption: true,
    // Delivery is exercised separately below; this keeps the queue assertion honest.
    notify: false,
  });

  const displaced = await db.booking.findUniqueOrThrow({ where: { id: victim.id } });
  check(
    "the displaced booking is PREEMPTED and points at the class booking",
    displaced.status === "PREEMPTED" &&
      displaced.preemptedByBookingId === priority.booking.id,
    `status=${displaced.status}`,
  );
  check(
    "the class booking is CONFIRMED in the slot it cleared",
    (await db.booking.findUniqueOrThrow({ where: { id: priority.booking.id } })).status ===
      "CONFIRMED",
  );
  check(
    "the displaced booking is queued for notification, not yet sent",
    displaced.preemptionNotifiedAt === null,
  );

  // With no RESEND_API_KEY the send reports failure, which is the interesting case:
  // an undelivered notice must stay queued so the sweeper retries it later.
  const delivery = await deliverPreemptionNotices([victim.id]);
  const stillQueued = await db.booking.findUniqueOrThrow({
    where: { id: victim.id },
    select: { preemptionNotifiedAt: true },
  });
  check(
    "a failed send leaves the notice queued rather than stamping it delivered",
    delivery.sent === 0 &&
      delivery.failed === 1 &&
      stillQueued.preemptionNotifiedAt === null,
    `sent=${delivery.sent} failed=${delivery.failed}`,
  );

  let sameTierBlocked = false;
  try {
    await createPriorityBooking({
      instrumentId: instrument.id,
      request: {
        userId: instructor.id,
        start: civilToInstant(classDay, hm(10)),
        end: civilToInstant(classDay, hm(11)),
        type: "CLASS",
        description: "CHE 101 — overlapping class",
      },
      actor: { id: instructor.id, role: "INSTRUCTOR" },
      confirmPreemption: true,
    });
  } catch (error) {
    sameTierBlocked =
      error instanceof BookingError && error.failure.code === "PRIORITY_CONFLICT";
  }
  check("a class booking cannot displace another class booking", sameTierBlocked);

  // An in-progress booking may have samples in the instrument.
  const running = await db.booking.create({
    data: {
      ...base,
      startsAt: new Date(Date.now() - 30 * MIN),
      endsAt: new Date(Date.now() + 30 * MIN),
    },
  });

  let inProgressBlocked = false;
  try {
    await createPriorityBooking({
      instrumentId: instrument.id,
      request: {
        userId: instructor.id,
        start: new Date(Date.now() - 15 * MIN),
        end: new Date(Date.now() + 60 * MIN),
        type: "CLASS",
        description: "Attempt to bump a running acquisition",
      },
      actor: { id: instructor.id, role: "INSTRUCTOR" },
      confirmPreemption: true,
    });
  } catch (error) {
    inProgressBlocked =
      error instanceof BookingError && error.failure.code === "IN_PROGRESS_CONFLICT";
  }
  check("an in-progress booking cannot be preempted", inProgressBlocked);
  await db.booking.delete({ where: { id: running.id } });

  let conflictCarriesSuggestions = false;
  try {
    await createStudentBooking({
      instrumentId: instrument.id,
      request: {
        userId: other.id,
        start: civilToInstant(classDay, hm(10)),
        end: civilToInstant(classDay, hm(11)),
        type: "STUDENT",
      },
      actor: { id: other.id, role: "STUDENT" },
    });
  } catch (error) {
    conflictCarriesSuggestions =
      error instanceof BookingError &&
      error.failure.code === "CONFLICT" &&
      error.openings.length > 0;
  }
  check(
    "a rejected booking comes back with alternative times attached",
    conflictCarriesSuggestions,
  );

  const suggestions = await findOpenings({
    instrumentId: instrument.id,
    durationMinutes: 60,
    from: civilToInstant(classDay, hm(9)),
    limit: 3,
  });
  const clashesWithClass = suggestions.some(
    (s) =>
      s.start < civilToInstant(classDay, hm(12)) &&
      s.end > civilToInstant(classDay, hm(9)),
  );
  check(
    "rebooking suggestions avoid the class that caused the preemption",
    suggestions.length > 0 && !clashesWithClass,
    `${suggestions.length} suggestion(s)`,
  );

  // -------------------------------------------------------------------------
  await db.booking.deleteMany({ where: { instrumentId: instrument.id } });
  await db.bookingWindow.deleteMany({ where: { instrumentId: instrument.id } });
  await db.instrument.delete({ where: { id: instrument.id } });
  await db.user.deleteMany({
    where: {
      email: {
        in: [student.email, other.email, instructor.email, advisor.email],
      },
    },
  });

  console.log(
    `\n${checks - failures}/${checks} checks passed${failures ? ` — ${failures} FAILED` : ""}.`,
  );
  process.exit(failures ? 1 : 0);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
