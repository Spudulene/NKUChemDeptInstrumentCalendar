import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "../src/generated/prisma/client";
import { Weekday } from "../src/generated/prisma/enums";

const connectionString = process.env.DIRECT_URL ?? process.env.DATABASE_URL;
if (!connectionString) throw new Error("DATABASE_URL is not set.");

const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

const WEEKDAYS = [Weekday.MON, Weekday.TUE, Weekday.WED, Weekday.THU, Weekday.FRI];
const EVERY_DAY = [
  Weekday.SUN,
  Weekday.MON,
  Weekday.TUE,
  Weekday.WED,
  Weekday.THU,
  Weekday.FRI,
  Weekday.SAT,
];

const hm = (h: number, m = 0) => h * 60 + m;

async function main() {
  const adminEmails = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);

  for (const email of adminEmails) {
    await db.user.upsert({
      where: { email },
      update: { role: "ADMIN" },
      create: { email, name: email.split("@")[0], role: "ADMIN" },
    });
  }

  // Stand-ins so every role is clickable before SSO exists. Harmless in production:
  // they can only be signed into via the dev login, which is disabled there.
  const people = [
    { email: "admin@nku.edu", name: "Dana Whitfield", role: "ADMIN" as const },
    { email: "instructor@nku.edu", name: "Marcus Reyes", role: "INSTRUCTOR" as const },
    { email: "student@nku.edu", name: "Priya Raman", role: "STUDENT" as const },
    { email: "student2@nku.edu", name: "Alex Okonkwo", role: "STUDENT" as const },
  ];

  for (const person of people) {
    await db.user.upsert({
      where: { email: person.email },
      update: {},
      create: person,
    });
  }

  // Research advisors. Note these carry role STUDENT — appearing in the advisor picker
  // is not a reason to hand out class-booking rights. Most PIs will never sign in;
  // if one does, SSO matches on email and the row simply becomes their account.
  const advisors = [
    { email: "instructor@nku.edu", name: "Marcus Reyes" },
    { email: "l.fontaine@nku.edu", name: "Dr. Lucille Fontaine" },
    { email: "t.abara@nku.edu", name: "Dr. Tobias Abara" },
  ];

  for (const advisor of advisors) {
    await db.user.upsert({
      where: { email: advisor.email },
      update: { isResearchAdvisor: true },
      create: { ...advisor, isResearchAdvisor: true },
    });
  }

  // Put the sample students in groups so booking defaults have something to resolve.
  const fontaine = await db.user.findUniqueOrThrow({
    where: { email: "l.fontaine@nku.edu" },
    select: { id: true },
  });
  const abara = await db.user.findUniqueOrThrow({
    where: { email: "t.abara@nku.edu" },
    select: { id: true },
  });

  await db.user.update({
    where: { email: "student@nku.edu" },
    data: { advisorId: fontaine.id },
  });
  await db.user.update({
    where: { email: "student2@nku.edu" },
    data: { advisorId: abara.id },
  });

  const instruments = [
    {
      slug: "nmr-400",
      name: "Bruker 400 MHz NMR",
      location: "SC 350 — NMR Suite",
      description:
        "High-field NMR for routine 1H/13C. Overnight blocks are for long acquisitions.",
      color: "#4f46e5",
      bookingHorizonDays: 21,
      minLeadTimeMinutes: 0,
      cancellationDeadlineMinutes: 120,
      bufferMinutes: 15,
      maxMinutesPerUserPerWeek: 480,
      // Attribution matters most on the expensive instrument.
      requireResearchAdvisor: true,
      windows: [
        {
          name: "Daytime",
          daysOfWeek: WEEKDAYS,
          startMinute: hm(8),
          endMinute: hm(17),
          minDurationMinutes: 30,
          maxDurationMinutes: 120,
          slotSizeMinutes: 30,
          maxConsecutiveSlots: 4,
          sortOrder: 0,
        },
        {
          // 17:00 -> 08:00. endMinute < startMinute is what marks the midnight cross;
          // 900 minutes is the whole span, and it is booked as one block.
          name: "Overnight",
          daysOfWeek: EVERY_DAY,
          startMinute: hm(17),
          endMinute: hm(8),
          minDurationMinutes: 900,
          maxDurationMinutes: 900,
          slotSizeMinutes: 900,
          wholeBlockOnly: true,
          maxBookingsPerUserPerWeek: 2,
          sortOrder: 1,
        },
        {
          name: "Weekend",
          daysOfWeek: [Weekday.SAT, Weekday.SUN],
          startMinute: hm(8),
          endMinute: hm(17),
          minDurationMinutes: 60,
          maxDurationMinutes: 240,
          slotSizeMinutes: 60,
          sortOrder: 2,
        },
      ],
    },
    {
      slug: "ftir",
      name: "Nicolet iS50 FTIR",
      location: "SC 312",
      description: "Walk-up ATR-FTIR. Short slots, no overnight use.",
      color: "#0d9488",
      bookingHorizonDays: 14,
      minLeadTimeMinutes: 0,
      cancellationDeadlineMinutes: 30,
      bufferMinutes: 0,
      maxMinutesPerUserPerWeek: null,
      windows: [
        {
          name: "Daytime",
          daysOfWeek: WEEKDAYS,
          startMinute: hm(8),
          endMinute: hm(18),
          minDurationMinutes: 30,
          maxDurationMinutes: 60,
          slotSizeMinutes: 30,
          maxConsecutiveSlots: 2,
          sortOrder: 0,
        },
      ],
    },
    {
      slug: "gc-ms",
      name: "Agilent GC-MS",
      location: "SC 340",
      description: "Sequence runs welcome overnight; daytime is for short queues.",
      color: "#b45309",
      bookingHorizonDays: 21,
      minLeadTimeMinutes: 60,
      cancellationDeadlineMinutes: 120,
      bufferMinutes: 10,
      maxMinutesPerUserPerWeek: 600,
      windows: [
        {
          name: "Daytime",
          daysOfWeek: WEEKDAYS,
          startMinute: hm(9),
          endMinute: hm(17),
          minDurationMinutes: 60,
          maxDurationMinutes: 180,
          slotSizeMinutes: 60,
          maxConsecutiveSlots: 3,
          sortOrder: 0,
        },
        {
          name: "Overnight",
          daysOfWeek: WEEKDAYS,
          startMinute: hm(17),
          endMinute: hm(9),
          minDurationMinutes: 960,
          maxDurationMinutes: 960,
          slotSizeMinutes: 960,
          wholeBlockOnly: true,
          maxBookingsPerUserPerWeek: 3,
          sortOrder: 1,
        },
      ],
    },
  ];

  for (const { windows, ...instrument } of instruments) {
    const record = await db.instrument.upsert({
      where: { slug: instrument.slug },
      update: instrument,
      create: instrument,
    });

    // Windows are replaced wholesale so re-seeding cannot accumulate duplicates.
    await db.bookingWindow.deleteMany({ where: { instrumentId: record.id } });
    await db.bookingWindow.createMany({
      data: windows.map((w) => ({ ...w, instrumentId: record.id })),
    });
  }

  const counts = {
    users: await db.user.count(),
    instruments: await db.instrument.count(),
    windows: await db.bookingWindow.count(),
  };

  console.log(
    `Seeded ${counts.instruments} instruments, ${counts.windows} windows, ${counts.users} users.`,
  );
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
