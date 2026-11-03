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

## Asking for someone's time

A student who urgently needs a slot someone else has booked can ask for it from the
calendar. The other student gets an email and can give it up with a click — or keep
it, with no reason needed. If they give it up, it becomes the asker's booking, under the
asker's own weekly limits. Requests end when the booking starts. Names show only to
signed-in students, never on the department's public page.

## Reports

The instrument manager can see instrument time used — hours and number of bookings —
by research group or by instrument, for the current term or any dates, and drill from a
group into its instruments or the other way round.

## What it deliberately does not do

- **It does not track instrument training or certification.** The department doesn't
  track this today, so the system doesn't pretend to. If that changes, it can be added
  without disturbing anything else.
- **It does not handle billing or recharge.** It records which research group used what
  time, which is the input to that, but it doesn't calculate or bill anything.
- **It does not enforce anything physically.** It's a calendar. It doesn't lock
  instruments or verify that whoever booked the time is the person at the bench.

## Current status

Built and tested: booking with every instrument's rules, the week and phone day views,
class reservations (one-off and weekly) and the emails to bumped students, maintenance
blocks, students asking each other for time, "My bookings", the admin screens for
instruments, instructors and research advisors, usage reports, and the embed for the
department's website.

Still to do before students use it: connecting the university sign-in (it needs the
app registration below), the email setup, and loading the real instruments and people.

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
| **Email** | Resend (HTTPS API), or the university's own relay — IT's choice, see Email |
| **Hosting** | Docker containers on a campus VM |

## Authentication

Sign-in uses the university's existing Entra ID tenant via OpenID Connect. It needs a
new app registration; none exists yet.

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
- Roles (student, instructor, admin) are kept in the application, not in Entra, so
  the instrument manager can add instructors without an IT ticket.

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
  optional note. Class reservations and maintenance blocks carry a title and a reason.
- **Requests between students** for each other's time, with an optional short note.

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

## Hosting — campus, in containers

The application ships as Docker images, which is how IT asked to run it.

**What runs.** Four containers, defined in one `compose.yaml` in the repository:

| Container | Role |
| --- | --- |
| `app` | The web application. One is enough for this workload. |
| `migrate` | Applies database schema changes, then exits. Runs before `app` starts. |
| `db` | PostgreSQL 17. Omit it if IT would rather supply the database. |
| `cron` | Makes one authenticated request an hour to a housekeeping endpoint. |

**What the VM needs.** A Linux host with Docker, 1–2 vCPU and 2 GB RAM — this is a
low-traffic application — plus a TLS reverse proxy in front of it (if it's nginx, with
response buffering off). Outbound HTTPS to `login.microsoftonline.com` (sign-in),
`ghcr.io` (updates) and, if Resend is used, `api.resend.com`. Nothing inbound except
through the proxy. Node.js does not need installing; it is inside the image.

**Keeping it current.** Every push to the repository's main branch builds both images and
publishes them to GitHub Container Registry, tagged by commit. Updating is a pull and a
restart; rolling back is pulling the previous tag. Nothing is built on the server. If the
images are kept private, the VM also needs a read-only GitHub token to pull them.

**PostgreSQL.** Version 15 or newer, with the standard `btree_gist` extension — it ships
with Postgres and lives in `postgresql-contrib` on Debian and Ubuntu. It is what makes
double-booking impossible at the database level rather than merely unlikely. If IT
supplies the database, the application's user needs to be able to create that extension
once, or an administrator creates it beforehand.

**Configuration** is entirely environment variables; no config files to edit. The
secrets: the session signing key and the token protecting the scheduled endpoint (both
required — the stack refuses to start without them), the database password, the Entra
client secret, and the Resend key if Resend is used. All belong in whatever secret store
IT already uses.

**The hourly scheduled job is a safety net, not the delivery path.** Emails go out
within seconds of whatever triggers them. This run retries any that failed because the
email provider was unreachable, and closes requests between students that nobody
answered before the booking started. Nothing breaks if it runs less often; a systemd
timer works just as well as the container.

**Backups** are the one genuinely manual responsibility: a scheduled dump of one Postgres
database.

## Email

All of it is notification email, triggered by something a person did:

- a student's booking was cancelled for a class or maintenance, with the next open times
- another student is asking for your booking, with a link to give it up or keep it
- how that request ended

Volume is low — tens to a few hundred messages a month. Two ways to send it, and either
is fine with us:

- **Resend** (the app's current setup). An HTTPS API, so no SMTP and no mail server.
  It needs SPF and DKIM records, which Resend generates, on the sending domain —
  usually a subdomain such as `instruments.nku.edu`, so nothing changes on the main
  domain's mail setup.
- **The university's own relay** (Microsoft 365 or SMTP). If IT prefers mail to go
  through university systems, we switch the app over before go-live; it's a small
  change on our side. We'd need the relay host and port, credentials or an allowed-IP
  arrangement, and the address to send from.

Either way, mail should come from an nku.edu address. Students' spam filters distrust
unfamiliar external domains, and some of these messages are time-sensitive.

## Showing availability on the department's website

The department's instrument schedules page currently embeds Google Calendars. Those get
replaced with an embedded view of this calendar (`/embed/<instrument>`), which shows
booked and open time without names. The application only allows itself to be framed by
`nku.edu` pages. Whoever maintains the department's web pages needs to be able to add
an `<iframe>` pointing at the new hostname.

## What we need from IT

1. **A hostname** — a subdomain such as `instruments.nku.edu`, pointed at the campus VM
   running the containers, with a TLS certificate.
2. **A new Entra ID app registration**, single-tenant, as described under
   Authentication:
   - redirect URI `https://<hostname>/api/auth/entra/callback`
   - delegated permissions `openid`, `profile`, `email`, `User.Read`
   - the optional `email` claim added to the ID token
   - and back to us: the tenant ID, the client ID, and a client secret (with its
     expiry date).
3. **A decision on email** — Resend with SPF/DKIM records on the subdomain, or the
   university's relay with its connection details. See Email.
4. **The VM described above**, with outbound HTTPS to the hosts listed.
5. **The database** — either the bundled Postgres container, or one of IT's (15+, with
   `btree_gist`) — and a backup schedule for it.
6. **Somewhere to keep the secrets** listed under Configuration.
7. **A way to embed the calendar on the department's website**, through whoever
   maintains those pages.

Items 1–3 are what the remaining work on our side waits for: the sign-in connection is
built against a real app registration, and the email switch, if any, before go-live.

## Ongoing maintenance

Low, but not zero. Realistically:

- Rotating the Entra client secret before it expires (every ~2 years)
- Dependency updates, a few times a year — these rebuild the image automatically
- Database backups
- Pulling a new image when the application is updated
- Adding instructors and instruments, which is an admin task in the app rather than a
  technical one

## Source and documentation

The repository contains full technical documentation in `README.md`, including the
architecture, the reasoning behind the design decisions, and setup instructions. The
booking rules are covered by an automated test suite (`npm run db:verify`) that runs
against a real database and checks 101 behaviours, including the daylight saving edge
cases, the conflict-prevention guarantees, and handing a booking from one student to
another.
