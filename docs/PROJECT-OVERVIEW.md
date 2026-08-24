# Instrument Calendar — Project Overview

A shared booking calendar for chemistry department instruments (NMR, FTIR, GC-MS, and
anything added later). Students reserve instrument time online; instructors reserve
blocks for classes; the department gets a record of who used what and for which
research group.

This document has two halves. **Part 1** describes what the system does and how it
will be used day to day. **Part 2** covers the technical details, hosting, and what we
need from IT.

---

# Part 1 — What it does

## The problem

The department already schedules instrument time — but across several different
systems, because no single one of them can be configured to handle the way the various
instruments actually need to be booked.

The root cause is configurability. Most general-purpose booking tools assume every
bookable resource works the same way: one set of open hours, one slot length, one
maximum booking. Instruments don't work that way, and they don't work the same way as
each other. An NMR needs short bookings during the day and one long unattended run
overnight. A walk-up FTIR wants half-hour slots and no overnight use at all. A GC-MS
may want sequence runs at night and a queue during the day. When the tool can't
express those differences, the practical workaround is to use a different tool for
that instrument — and that is how a department ends up with several.

The fragmentation is what costs everyone time. Students have to know which system
governs which instrument. There's no single view of what's free this week. Each tool
is administered separately, so a policy change means repeating the same work in
several places, and nobody has a department-wide picture of how the instruments are
actually being used.

The goal here is one calendar covering every instrument, where each instrument is
configured on its own terms rather than forced into a shared template. The
configuration described below is the part that makes consolidation possible — it's
built specifically to express the differences that caused the split in the first
place.

## Who uses it

Everyone signs in with their existing NKU account — the same username and password
they use for email. There are no separate accounts to create and no new passwords for
anyone to forget. Sign-ins are restricted to the university, so an outside Microsoft
account cannot get in.

There are three levels of access:

| Role           | Can do                                                                 |
| -------------- | ---------------------------------------------------------------------- |
| **Student**    | Book time within each instrument's rules; cancel their own bookings.   |
| **Instructor** | The above, plus reserve blocks for classes, which take priority.       |
| **Admin**      | The above, plus add and configure instruments, schedule maintenance, and set who is an instructor. |

The instrument manager would be an admin.

## What a student sees

A list of instruments, each showing its location and hours. Picking one shows the
week's schedule: which times are open, which are taken, and what's reserved for
classes or maintenance.

To book, a student picks an open time within the instrument's rules. The system checks
the request and either confirms it or explains precisely why not — "bookings are
capped at 2 hours," "that time is outside the instrument's hours," "you already have
two overnight blocks this week." When a booking is refused, it offers the next few
available times rather than leaving the student to hunt.

Students see each other's names on the calendar so they know who to ask about a
conflict, but not what anyone is running. Class and maintenance bookings show their
purpose, since that's the point of them.

## What you can configure per instrument

Each instrument is set up independently. Nothing here is hard-coded, so the rules can
be adjusted as you learn what works.

**Basics** — name, location (so students know where to go), a short description, and a
colour used on the calendar.

**Bookable hours.** Rather than a single set of open hours, each instrument has one or
more *time windows*, each with its own rules. This is what lets an instrument work
differently during the day than it does overnight. A typical NMR setup:

| Window        | Days          | Hours         | Rules                                          |
| ------------- | ------------- | ------------- | ---------------------------------------------- |
| **Daytime**   | Mon–Fri       | 8:00 – 5:00   | 30-minute slots, 2 hours maximum, up to 4 slots back-to-back |
| **Overnight** | Any night     | 5:00 – 8:00   | booked as one whole block, 2 per student per week |
| **Weekend**   | Sat–Sun       | 8:00 – 5:00   | 1-hour slots, 4 hours maximum                  |

The overnight window is why the rules live on windows rather than on the instrument,
and it's the specific thing most booking tools can't express. A single "maximum
booking length" can't say "short bookings during the day, one long run at night" —
raising the cap to fifteen hours for overnight runs would also let someone book
fifteen hours on a Tuesday afternoon. Faced with that, the only options are to give up
overnight booking or to move the instrument to a different system.

Windows are independent, so you can open weekends on one instrument and not another,
run different overnight hours per instrument, or give one instrument a window shape
that no other instrument has. An instrument that needs a genuinely unusual
arrangement gets it by adding a window, not by moving to a separate tool.

**Limits and policies**, all optional and set per instrument:

- **How far ahead** bookings open (e.g. three weeks). Prevents one organised student
  booking every Tuesday for the whole semester on day one.
- **Minimum notice** before a booking can start.
- **Cancellation deadline** — how close to the start time a student can still cancel.
- **Changeover buffer** between bookings, for sample changes or re-shimming.
- **Weekly cap** on total hours per student.
- **Whether a research group must be named** when booking (see below).

## Research group attribution

When a student books, the booking records which research group the time is for. The
student's group is filled in automatically from their profile, so in normal use it's
already correct and they don't have to think about it — but they can change it for a
booking if they're running samples for another group.

This can be required on some instruments and not others. It makes sense to require it
on the NMR, where knowing whose work the time went to matters, while leaving the FTIR
open to students who aren't in a group yet.

Research advisors are managed as a simple list. A professor does **not** need to sign
in or use the system to appear on it — an admin adds their name, and that's enough.
Being on the advisor list carries no special permissions.

## Classes and maintenance

Instructors can reserve an instrument for a class, and admins can block time for
maintenance. Both take priority over individual student bookings.

If students are already booked during that time, the system will cancel those bookings
and email each affected student — explaining that the instrument was reserved for a
class, showing the reason the instructor gave, listing the next few available times,
and linking back to the calendar to rebook. That email goes out within seconds.

This is deliberately not silent or automatic:

- The instructor sees exactly whose bookings would be cancelled, with names and times,
  and has to confirm before anything happens.
- A booking that is **currently running** cannot be cancelled this way. There may be
  samples in the instrument, so that needs a conversation, not an email.
- If a booking starts within the next twelve hours, the instructor gets a prominent
  warning that an email may not reach the student in time, and should contact them
  directly.
- Class bookings do not override other class bookings. Two instructors wanting the
  same slot get an error, not a race.
- Cancelled bookings are kept on record, so "how often is this happening?" is an
  answerable question.

## What it deliberately does not do

- **It does not track instrument training or certification.** The department doesn't
  track this today, so the system doesn't pretend to. If that changes, it can be added
  without disturbing anything else.
- **It does not handle billing or recharge.** It records which research group used what
  time, which is the input to that, but it doesn't calculate or bill anything.
- **It does not enforce anything physically.** It's a calendar. It doesn't lock
  instruments or verify that whoever booked the time is the person at the bench.

## Current status

Working and tested: the booking rules, the overnight and weekend handling, conflict
prevention, class bookings and the preemption emails, the week calendar view, and
research group attribution.

Still to build: the booking form itself (the calendar is currently read-only), the
admin screens for setting up instruments, connecting the university sign-in, and usage
reports.

---

# Part 2 — Technical details

## Summary

A conventional server-rendered web application. No native apps, no browser extensions,
nothing installed on lab machines — it runs in a browser.

| | |
| --- | --- |
| **Application** | Next.js 16 (React, TypeScript), Node.js 22 |
| **Database** | PostgreSQL 15+ (requires the standard `btree_gist` extension) |
| **Authentication** | Microsoft Entra ID (OpenID Connect), single-tenant |
| **Email** | Resend (HTTPS API — no SMTP, no mail server) |
| **Hosting** | Vercel + Neon Postgres, or a campus VM + local Postgres |

## Authentication

Sign-in uses the university's existing Entra ID tenant via OpenID Connect. An app
registration already exists.

- **Single-tenant.** The application rejects any sign-in whose tenant claim doesn't
  match NKU's tenant ID. Accounts from outside the university cannot authenticate.
- **Delegated permissions only**, and only the standard ones: `openid`, `profile`,
  `email`, `User.Read`. No application permissions, no directory read access, no
  mailbox access, no write access of any kind.
- **No passwords are handled by this application.** Credentials are entered on
  Microsoft's sign-in page and never reach our servers. We never see, store, or
  transmit a university password.
- Sessions are HTTP-only, signed cookies with a 12-hour lifetime. Roles are read from
  the database on every request, so revoking access takes effect immediately rather
  than whenever a session happens to expire.

The one operational note: the client secret in the app registration expires (24 months
maximum). An expired secret means sign-in stops working, so it needs a calendar
reminder.

## Data stored

Minimal, and all of it operational:

- **People** — name, university email, role, and their research advisor if they have
  one. Populated from the sign-in claims. No passwords, no ID numbers, no personal
  information beyond what's already in the campus directory.
- **Instruments** — names, locations, and scheduling rules.
- **Bookings** — who, which instrument, start and end time, research group, and an
  optional note.

No FERPA-protected educational records, no financial data, no health data. If the
department wants a retention policy (e.g. purge bookings older than three years), it's
a straightforward addition.

## Data integrity

Worth flagging because it's the part that's easy to get wrong: double-booking is
prevented by a database-level exclusion constraint, not by application logic. Checking
for a conflict and then inserting has a race window that will not show up in testing
and will show up during a busy week. Postgres enforces non-overlap directly, so two
simultaneous requests for the same slot cannot both succeed regardless of how the
application behaves.

This is why `btree_gist` is a requirement — it ships with standard Postgres and is in
the `postgresql-contrib` package on Debian/Ubuntu.

All timestamps are stored in UTC and displayed in campus time, including correct
handling of daylight saving transitions (an overnight run on the spring-forward night
really is one hour shorter, and the system knows that).

## Hosting — two options

**Option A: Vercel + Neon.** Managed hosting, free tier adequate for this workload,
nothing for IT to run or patch. Both are external SaaS providers, which may or may not
be acceptable under university policy. Requires only a DNS record pointing a hostname
at Vercel.

**Option B: campus VM.** The application is built to be portable and has no dependency
on Vercel-specific features. Requirements:

- Linux VM, 1–2 vCPU and 2 GB RAM is ample; this is a low-traffic application
- Node.js 22 and PostgreSQL 15+ with `postgresql-contrib`
- A reverse proxy with TLS (nginx or similar)
- A scheduled job — cron or a systemd timer — making one authenticated HTTPS request
  per day to a retry endpoint
- Outbound HTTPS for sending email

Either way the application is deployed from a Git repository and configured entirely
through environment variables. It can also run under Docker if that's preferred.

Note that the daily scheduled job is a safety net, not the delivery path — notification
emails are sent immediately when a booking is preempted. Nothing time-sensitive
depends on how often that job runs.

## Email

Sent through Resend, which is an HTTPS API rather than SMTP. No mail server, no
relay configuration, and outbound port 587 restrictions are irrelevant.

Volume is very low — notification emails only, well under a hundred per month.

## What we need from IT

1. **A hostname** — a subdomain such as `instruments.nku.edu`, pointed either at
   Vercel or at the campus VM depending on which hosting option is chosen.
2. **DNS records on that subdomain for sending email** — SPF and DKIM records, which
   Resend generates. This is what allows notification emails to come from an
   nku.edu address rather than an unfamiliar external domain that students' spam
   filters will distrust.
3. **A redirect URI added to the existing app registration**, once the hostname is
   known. A two-minute change; no new registration needed.
4. **If self-hosting:** the VM and Postgres instance described above, plus a backup
   schedule for the database.

Nothing here is urgent — the application runs locally for development without any of
it. Items 1 and 2 are needed before students can use it.

## Ongoing maintenance

Low, but not zero. Realistically:

- Rotating the Entra client secret before it expires (every ~2 years)
- Dependency updates, a few times a year
- Database backups, if self-hosted
- Adding instructors and instruments, which is an admin task in the app rather than a
  technical one

## Source and documentation

The repository contains full technical documentation in `README.md`, including the
architecture, the reasoning behind the design decisions, and setup instructions. The
booking rules are covered by an automated test suite (`npm run db:verify`) that runs
against a real database and checks 35 behaviours, including the daylight saving edge
cases and the conflict-prevention guarantees.
