import "dotenv/config";
import { db } from "@/lib/db";
import {
  addCivilDays,
  civilToInstant,
  civilWeekday,
  compareCivil,
  instantToCivil,
  instantToMinutes,
  todayCivil,
  type CivilDate,
} from "@/lib/time";
import {
  expandWindows,
  windowSpanMinutes,
  type WindowRule,
} from "@/lib/booking/windows";
import { computeOpenings, findOpenings } from "@/lib/booking/availability";
import { computeBookableSlots } from "@/lib/booking/slots";
import { horizonEnd, opensForBooking } from "@/lib/booking/horizon";
import { limitBands } from "@/lib/booking/unbookable";
import { weeklyAllowance } from "@/lib/booking/quota";
import { validateBooking } from "@/lib/booking/rules";
import { deliverPreemptionNotices } from "@/lib/email";
import {
  BookingError,
  createPriorityBooking,
  createStudentBooking,
  previewPreemption,
} from "@/lib/booking/create";
import {
  cancelSeries,
  createClassSeries,
  expandSeries,
  patternProblem,
  previewSeries,
} from "@/lib/booking/series";

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
  section("Booking horizon (whole days)");
  // -------------------------------------------------------------------------

  // 21 days from Tue Oct 27 2026 crosses the Nov 1 fall-back.
  const horizonFrom = { y: 2026, m: 10, d: 27 };
  const horizonLimit = horizonEnd(civilToInstant(horizonFrom, hm(18)), 21);
  check(
    "the horizon ends at campus midnight after today + N, across fall-back",
    horizonLimit.getTime() === civilToInstant({ y: 2026, m: 11, d: 18 }, 0).getTime() &&
      horizonLimit.toLocaleString("en-US", { timeZone: "America/New_York", hour: "numeric" }) ===
        "12 AM",
    horizonLimit.toISOString(),
  );
  check(
    "the horizon moves by whole days, not with the clock (00:05 and 23:55 agree)",
    horizonEnd(civilToInstant(horizonFrom, hm(0, 5)), 21).getTime() ===
      horizonEnd(civilToInstant(horizonFrom, hm(23, 55)), 21).getTime(),
  );
  check(
    "a day opens for booking N calendar days before it",
    JSON.stringify(opensForBooking({ y: 2026, m: 11, d: 17 }, 21)) === JSON.stringify(horizonFrom),
  );

  const horizonSlots = computeBookableSlots({
    windows: [daytime],
    busy: [],
    from: civilToInstant({ y: 2026, m: 11, d: 17 }, 0),
    to: civilToInstant({ y: 2026, m: 11, d: 19 }, 0),
    earliest: civilToInstant(horizonFrom, hm(18)),
    latest: horizonLimit,
  });
  const lastDayStarts = horizonSlots.filter((s) => compareCivil(instantToCivil(s.start), { y: 2026, m: 11, d: 17 }) === 0);
  check(
    "the whole last day is offered, to its final 16:30 start",
    lastDayStarts.length === 18 && lastDayStarts.at(-1)?.start.getTime() === civilToInstant({ y: 2026, m: 11, d: 17 }, hm(16, 30)).getTime(),
    `${lastDayStarts.length} start(s)`,
  );
  check(
    "nothing on the day after is offered",
    horizonSlots.every((s) => s.start < horizonLimit),
  );

  // Shading on the week grid: now is Tue Oct 27 10:00, lead time 24 h, horizon 21 days.
  const bandNow = civilToInstant(horizonFrom, hm(10));
  const bandLimits = {
    now: bandNow,
    earliest: new Date(bandNow.getTime() + 24 * 60 * MIN),
    latest: horizonEnd(bandNow, 21),
    leadMinutes: 1440,
    horizonDays: 21,
  };
  const day = (d: CivilDate, from: number, to: number) => ({ start: civilToInstant(d, from), end: civilToInstant(d, to) });
  const describe = (span: { start: Date; end: Date }) =>
    limitBands(span, bandLimits)
      .map((b) => `${b.why.kind} ${b.start.toISOString()}-${b.end.toISOString()}`)
      .join(", ");
  const todayBands = limitBands(day(horizonFrom, hm(8), hm(17)), bandLimits);
  check(
    "today splits at now: past until 10:00, too soon after",
    todayBands.length === 2 &&
      todayBands[0].why.kind === "past" && todayBands[0].end.getTime() === bandNow.getTime() &&
      todayBands[1].why.kind === "too-soon" && todayBands[1].end.getTime() === civilToInstant(horizonFrom, hm(17)).getTime(),
    describe(day(horizonFrom, hm(8), hm(17))),
  );
  const tomorrow = addCivilDays(horizonFrom, 1);
  const tomorrowBands = limitBands(day(tomorrow, hm(8), hm(17)), bandLimits);
  check(
    "tomorrow is too soon only until the lead time runs out (10:00)",
    tomorrowBands.length === 1 && tomorrowBands[0].why.kind === "too-soon" &&
      tomorrowBands[0].end.getTime() === civilToInstant(tomorrow, hm(10)).getTime(),
    describe(day(tomorrow, hm(8), hm(17))),
  );
  check(
    "a day inside the horizon and past the lead time is not shaded",
    limitBands(day({ y: 2026, m: 11, d: 17 }, hm(8), hm(17)), bandLimits).length === 0,
  );
  const lateBands = limitBands(day({ y: 2026, m: 11, d: 18 }, hm(8), hm(17)), bandLimits);
  check(
    "the day after the horizon is shaded whole, with its own opening date",
    lateBands.length === 1 && lateBands[0].why.kind === "not-open" && lateBands[0].why.label === "Opens Oct 28",
    describe(day({ y: 2026, m: 11, d: 18 }, hm(8), hm(17))),
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
    "a 9-hour window offers 17 half-hour-aligned starts for a 1h booking",
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
  section("Bookable slots offered to the UI");
  // -------------------------------------------------------------------------

  const gridWindow = rule({
    id: "grid",
    name: "Daytime",
    startMinute: hm(8),
    endMinute: hm(17),
    daysOfWeek: ["MON"],
    minDurationMinutes: 30,
    maxDurationMinutes: 120,
    slotSizeMinutes: 30,
    maxConsecutiveSlots: 4,
  });

  const wideOpen = computeBookableSlots({
    windows: [gridWindow],
    busy: [],
    from: civilToInstant(monday, 0),
    to: civilToInstant(addCivilDays(monday, 1), 0),
    earliest: civilToInstant(monday, 0),
    latest: civilToInstant(addCivilDays(monday, 30), 0),
  });
  check(
    "a 9-hour window offers 18 half-hour starts (08:00 through 16:30)",
    wideOpen.length === 18,
    `got ${wideOpen.length}`,
  );
  check(
    "the first start offers every length up to the 2-hour cap",
    wideOpen[0]?.durations.join(",") === "30,60,90,120",
    wideOpen[0]?.durations.join(","),
  );

  const nearClose = wideOpen[wideOpen.length - 1];
  check(
    "the last start before closing only offers what fits",
    nearClose?.durations.join(",") === "30",
    nearClose?.durations.join(","),
  );

  const constrained = computeBookableSlots({
    windows: [gridWindow],
    busy: [
      {
        start: civilToInstant(monday, hm(11)),
        end: civilToInstant(monday, hm(12)),
      },
    ],
    from: civilToInstant(monday, 0),
    to: civilToInstant(addCivilDays(monday, 1), 0),
    earliest: civilToInstant(monday, 0),
    latest: civilToInstant(addCivilDays(monday, 30), 0),
    bufferMinutes: 15,
  });

  const tenThirty = constrained.find(
    (s) => s.start.getTime() === civilToInstant(monday, hm(10, 30)).getTime(),
  );
  check(
    "a start near a booking is not offered a length that would collide",
    tenThirty === undefined,
    `10:30 offered ${tenThirty?.durations.join(",")}`,
  );

  const overlapping = constrained.some((slot) =>
    slot.durations.some((d) => {
      const end = new Date(slot.start.getTime() + d * 60_000);
      return (
        slot.start < civilToInstant(monday, hm(12, 15)) &&
        end > civilToInstant(monday, hm(10, 45))
      );
    }),
  );
  check("no offered slot and length overlaps a booking or its buffer", !overlapping);

  const overnightSlots = computeBookableSlots({
    windows: [{ ...overnight, id: "on", daysOfWeek: ["MON"] }],
    busy: [],
    from: civilToInstant(monday, 0),
    to: civilToInstant(addCivilDays(monday, 2), 0),
    earliest: civilToInstant(monday, 0),
    latest: civilToInstant(addCivilDays(monday, 30), 0),
  });
  check(
    "an overnight window offers exactly one whole-block choice",
    overnightSlots.length === 1 &&
      overnightSlots[0].wholeBlock &&
      overnightSlots[0].durations.join(",") === "900",
    `${overnightSlots.length} slot(s)`,
  );

  const overnightTaken = computeBookableSlots({
    windows: [{ ...overnight, id: "on", daysOfWeek: ["MON"] }],
    busy: [
      {
        start: civilToInstant(monday, hm(20)),
        end: civilToInstant(monday, hm(21)),
      },
    ],
    from: civilToInstant(monday, 0),
    to: civilToInstant(addCivilDays(monday, 2), 0),
    earliest: civilToInstant(monday, 0),
    latest: civilToInstant(addCivilDays(monday, 30), 0),
  });
  check(
    "any encroachment removes the overnight block entirely",
    overnightTaken.length === 0,
    `${overnightTaken.length} slot(s)`,
  );

  // -------------------------------------------------------------------------
  section("Weekly caps offered to the UI");
  // -------------------------------------------------------------------------

  const capOvernight = { ...overnight, id: "on", name: "Overnight", daysOfWeek: ["MON"], maxBookingsPerUserPerWeek: 2 } as WindowRule;
  const capSlots = [
    ...wideOpen,
    ...computeBookableSlots({
      windows: [capOvernight],
      busy: [],
      from: civilToInstant(monday, 0),
      to: civilToInstant(addCivilDays(monday, 2), 0),
      earliest: civilToInstant(monday, 0),
      latest: civilToInstant(addCivilDays(monday, 30), 0),
    }),
  ];
  const capWindows = [gridWindow, capOvernight];
  const booked = (windowId: string, hours: number) => ({
    windowId,
    start: civilToInstant(addCivilDays(monday, -1), hm(8)),
    end: civilToInstant(addCivilDays(monday, -1), hm(8 + hours)),
  });
  const allowance = (maxMinutesPerWeek: number | null, mine: ReturnType<typeof booked>[]) =>
    weeklyAllowance({ instrumentName: "Test NMR", maxMinutesPerWeek, windows: capWindows, mine });

  check(
    "with no caps, every slot is offered unchanged",
    allowance(null, []).apply(capSlots).length === capSlots.length,
  );

  const nearCap = allowance(480, [booked("grid", 7)]).apply(capSlots);
  check(
    "an hour left of 8: lengths stop at 1 hour, with a note saying why",
    nearCap.filter((s) => s.windowId === "grid").every((s) => Math.max(...s.durations) <= 60) &&
      nearCap[0]?.durations.join(",") === "30,60" &&
      !!nearCap[0]?.limitNote,
    nearCap[0]?.durations.join(","),
  );

  const usedUp = allowance(480, [booked("grid", 8)]);
  check(
    "all 8 hours used: no daytime slots, and the reason is the weekly limit",
    usedUp.apply(capSlots).every((s) => s.windowId !== "grid") &&
      usedUp.explain(gridWindow)?.kind === "weekly-limit",
    usedUp.explain(gridWindow)?.detail,
  );

  const twoOvernights = allowance(null, [booked("on", 1), booked("on", 1)]);
  check(
    "two of two overnights booked: the overnight block isn't offered, and says why",
    twoOvernights.apply(capSlots).every((s) => s.windowId !== "on") &&
      twoOvernights.explain(capOvernight)?.label === "Limit reached",
    twoOvernights.explain(capOvernight)?.detail,
  );

  const hoursUsedUp = allowance(480, [booked("grid", 8)]);
  check(
    "overnight doesn't count toward the hour cap: offered with all 8 hours used",
    hoursUsedUp.apply(capSlots).some((s) => s.windowId === "on") && hoursUsedUp.explain(capOvernight) === null,
  );

  const afterOvernight = allowance(480, [booked("on", 15)]).apply(capSlots);
  check(
    "a 15-hour overnight leaves the daytime hours untouched",
    afterOvernight[0]?.durations.join(",") === "30,60,90,120" && !afterOvernight[0]?.limitNote,
    afterOvernight[0]?.durations.join(","),
  );

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
  await db.reservationSeries.deleteMany({ where: { instrumentId: instrument.id } });

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

  // The fixture's horizon is 60 days: a Monday inside it passes, one past it doesn't.
  const lastMonday = nextWeekday(addCivilDays(todayCivil(), 54), "MON");
  const pastMonday = nextWeekday(addCivilDays(todayCivil(), 61), "MON");
  cases.push(
    ["a Monday within the 60-day horizon passes", civilToInstant(lastMonday, hm(10)), civilToInstant(lastMonday, hm(11)), null],
    ["a Monday past the 60-day horizon is rejected", civilToInstant(pastMonday, hm(10)), civilToInstant(pastMonday, hm(11)), "BEYOND_HORIZON"],
  );

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

  // An 8-hour weekly cap counts daytime hours only; overnight has its own count.
  const capped = { ...ctx, instrument: { ...instrument, maxMinutesPerUserPerWeek: 480 } };
  const dayWindowId = instrument.windows.find((w) => !w.wholeBlockOnly)!.id;
  const nightWindowId = instrument.windows.find((w) => w.wholeBlockOnly)!.id;
  const earlier = (windowId: string, hours: number, i: number) => ({
    id: `earlier-${i}`,
    userId: student.id,
    windowId,
    start: civilToInstant(addCivilDays(monday, 6), hm(1)),
    end: civilToInstant(addCivilDays(monday, 6), hm(1 + hours)),
  });
  const overnightUnderCap = validateBooking({
    ...capped,
    request: { userId: student.id, start: overnightStart, end: overnightEnd, type: "STUDENT" },
  });
  check(
    "a 15-hour overnight block passes an 8-hour weekly cap",
    overnightUnderCap.ok,
    overnightUnderCap.ok ? undefined : overnightUnderCap.failure.code,
  );
  const dayAfterNights = validateBooking({
    ...capped,
    userBookingsThisWeek: [earlier(nightWindowId, 15, 1), earlier(dayWindowId, 6, 2)],
    request: {
      userId: student.id,
      start: civilToInstant(addCivilDays(monday, 7), hm(10)),
      end: civilToInstant(addCivilDays(monday, 7), hm(12)),
      type: "STUDENT",
    },
  });
  check(
    "with 6 daytime hours and an overnight booked, 2 more daytime hours still fit",
    dayAfterNights.ok,
    dayAfterNights.ok ? undefined : dayAfterNights.failure.code,
  );
  const dayOverCap = validateBooking({
    ...capped,
    userBookingsThisWeek: [earlier(dayWindowId, 7, 3)],
    request: {
      userId: student.id,
      start: civilToInstant(addCivilDays(monday, 7), hm(10)),
      end: civilToInstant(addCivilDays(monday, 7), hm(12)),
      type: "STUDENT",
    },
  });
  check(
    "with 7 daytime hours booked, 2 more go over the 8-hour cap",
    !dayOverCap.ok && dayOverCap.failure.code === "WEEKLY_QUOTA",
    dayOverCap.ok ? "unexpectedly passed" : dayOverCap.failure.code,
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

  // The instructor reviewed an empty range, then a student booked into it before they
  // confirmed. Confirming what they saw must not cancel what they didn't.
  let unseenTargetRefused = false;
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
      confirmPreemption: true,
      confirmedTargetIds: [],
      notify: false,
    });
  } catch (error) {
    unseenTargetRefused =
      error instanceof BookingError && error.failure.code === "CONFIRMATION_REQUIRED";
  }
  check(
    "confirming a stale preview does not cancel a booking the instructor never saw",
    unseenTargetRefused &&
      (await db.booking.findUniqueOrThrow({ where: { id: victim.id } })).status ===
        "CONFIRMED",
  );

  const priority = await createPriorityBooking({
    instrumentId: instrument.id,
    request: {
      userId: instructor.id,
      start: civilToInstant(classDay, hm(9)),
      end: civilToInstant(classDay, hm(12)),
      type: "CLASS",
      title: "CHE 320",
      description: "CHE 320 — instrument training",
    },
    actor: { id: instructor.id, role: "INSTRUCTOR" },
    confirmPreemption: true,
    confirmedTargetIds: [victim.id],
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
  section("Recurring class reservations");
  // -------------------------------------------------------------------------

  // Pure expansion first: fixed dates either side of the November 2026 DST change.
  const longAgo = new Date(Date.UTC(2026, 0, 1));
  const acrossDst = expandSeries(
    {
      firstDay: { y: 2026, m: 10, d: 26 },
      lastDay: { y: 2026, m: 11, d: 6 },
      days: ["TUE", "THU"],
      fromMinute: hm(13),
      toMinute: hm(15),
    },
    longAgo,
  );
  check(
    "a series produces one meeting per chosen weekday in the range",
    acrossDst.length === 4 &&
      acrossDst.every((m) => ["TUE", "THU"].includes(civilWeekday(m.day))),
    `${acrossDst.length} meeting(s)`,
  );
  check(
    "meetings keep their wall-clock times across a DST change",
    acrossDst.every(
      (m) =>
        instantToMinutes(m.start) === hm(13) &&
        m.end.getTime() - m.start.getTime() === 120 * MIN,
    ),
  );

  const lateNight = expandSeries(
    {
      firstDay: { y: 2026, m: 10, d: 26 },
      lastDay: { y: 2026, m: 10, d: 26 },
      days: ["MON"],
      fromMinute: hm(22),
      toMinute: hm(2),
    },
    longAgo,
  );
  check(
    "a To at or before From runs each meeting past midnight",
    lateNight.length === 1 &&
      lateNight[0].end.getTime() - lateNight[0].start.getTime() === 240 * MIN &&
      compareCivil(instantToCivil(lateNight[0].end), { y: 2026, m: 10, d: 27 }) === 0,
  );

  const firstDay = addCivilDays(monday, 21);
  const pattern = {
    firstDay,
    lastDay: addCivilDays(firstDay, 13),
    days: ["TUE", "THU"] as ("TUE" | "THU")[],
    fromMinute: hm(13),
    toMinute: hm(15),
  };
  check(
    "a pattern with no days, a backwards range, or over 26 weeks is refused",
    patternProblem({ ...pattern, days: [] }) !== null &&
      patternProblem({ ...pattern, lastDay: addCivilDays(firstDay, -1) }) !== null &&
      patternProblem({ ...pattern, lastDay: addCivilDays(firstDay, 26 * 7) }) !== null &&
      patternProblem(pattern) === null,
  );

  const meetings = expandSeries(pattern, new Date());
  const [tue, thu] = meetings;
  const bumpedByClass = await createStudentBooking({
    instrumentId: instrument.id,
    request: {
      userId: student.id,
      start: civilToInstant(tue.day, hm(13, 30)),
      end: civilToInstant(tue.day, hm(14, 30)),
      type: "STUDENT",
    },
    actor: { id: student.id, role: "STUDENT" },
  });
  const otherClass = await createPriorityBooking({
    instrumentId: instrument.id,
    request: {
      userId: instructor.id,
      start: civilToInstant(thu.day, hm(14)),
      end: civilToInstant(thu.day, hm(16)),
      type: "CLASS",
      title: "CHE 210",
      description: "Another section",
    },
    actor: { id: instructor.id, role: "INSTRUCTOR" },
  });

  const seriesPreview = await previewSeries({ instrumentId: instrument.id, meetings });
  check(
    "the series preview finds the student booking on one date and the other class on another",
    seriesPreview.length === 4 &&
      seriesPreview[0].targets.map((t) => t.id).join() === bumpedByClass.id &&
      seriesPreview[1].blockedBy.map((t) => t.id).join() === otherClass.booking.id &&
      seriesPreview.slice(2).every((p) => p.targets.length + p.blockedBy.length === 0),
  );

  const seriesArgs = {
    instrumentId: instrument.id,
    pattern,
    title: "CHE 310",
    description: "CHE 310 — weekly lab",
    actor: { id: instructor.id, role: "INSTRUCTOR" as const },
    notify: false,
  };
  const codeOf = async (run: () => Promise<unknown>) => {
    try {
      await run();
      return "ok";
    } catch (error) {
      return error instanceof BookingError ? error.failure.code : String(error);
    }
  };

  check(
    "keeping a date another class holds refuses the whole series",
    (await codeOf(() =>
      createClassSeries({
        ...seriesArgs,
        dates: meetings.map((m) => m.date),
        confirmedTargetIds: [bumpedByClass.id],
      }),
    )) === "PRIORITY_CONFLICT" &&
      (await db.reservationSeries.count({ where: { instrumentId: instrument.id } })) === 0,
  );

  const keptDates = meetings.filter((m) => m !== thu).map((m) => m.date);
  check(
    "a series won't cancel a booking the instructor wasn't shown",
    (await codeOf(() =>
      createClassSeries({ ...seriesArgs, dates: keptDates, confirmedTargetIds: [] }),
    )) === "CONFIRMATION_REQUIRED" &&
      (await db.booking.findUniqueOrThrow({ where: { id: bumpedByClass.id } })).status ===
        "CONFIRMED",
  );

  const created = await createClassSeries({
    ...seriesArgs,
    dates: keptDates,
    confirmedTargetIds: [bumpedByClass.id],
  });
  const seriesMeetings = await db.booking.findMany({
    where: { seriesId: created.seriesId },
    orderBy: { startsAt: "asc" },
  });
  const bumpedRow = await db.booking.findUniqueOrThrow({ where: { id: bumpedByClass.id } });
  check(
    "the kept dates become CLASS bookings in the series; the skipped date has none",
    seriesMeetings.length === 3 &&
      seriesMeetings.every((b) => b.type === "CLASS" && b.status === "CONFIRMED") &&
      !seriesMeetings.some((b) => b.startsAt.getTime() === thu.start.getTime()),
    `${seriesMeetings.length} meeting(s)`,
  );
  check(
    "the bumped student booking points at the meeting on its own date",
    bumpedRow.status === "PREEMPTED" && bumpedRow.preemptedByBookingId === seriesMeetings[0].id,
  );

  check(
    "only the owner or an admin can cancel a series",
    (await codeOf(() =>
      cancelSeries({
        seriesId: created.seriesId,
        actor: { id: student.id, role: "STUDENT", name: student.name },
      }),
    )) === "NOT_OWNER",
  );
  const { cancelled } = await cancelSeries({
    seriesId: created.seriesId,
    actor: { id: instructor.id, role: "INSTRUCTOR", name: instructor.name },
  });
  check(
    "cancelling a series cancels its remaining meetings and frees the time",
    cancelled === 3 &&
      (await db.booking.count({ where: { seriesId: created.seriesId, status: "CONFIRMED" } })) ===
        0 &&
      (await db.reservationSeries.findUniqueOrThrow({ where: { id: created.seriesId } }))
        .cancelledAt !== null,
  );

  // -------------------------------------------------------------------------
  await db.booking.deleteMany({ where: { instrumentId: instrument.id } });
  await db.reservationSeries.deleteMany({ where: { instrumentId: instrument.id } });
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
