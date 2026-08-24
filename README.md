# NKU Chemistry — Instrument Calendar

Booking system for departmental instruments (NMR, FTIR, GC-MS). Students reserve time
within rules each instrument sets; instructors reserve blocks for classes, which
displace student bookings and email the affected students.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind 4 · Postgres · Prisma 7 ·
Resend. Deploys to Vercel with Neon Postgres.

---

## Getting started

```bash
npm install
cp .env.example .env      # then fill in DATABASE_URL / DIRECT_URL
npm run db:deploy         # apply migrations
npm run db:seed           # three sample instruments, four sample users
npm run dev
```

No Postgres handy? `npx prisma dev` starts a throwaway one and prints the URLs to
paste into `.env`. It picks a fresh port each run.

Sign in at [/dev-login](http://localhost:3000/dev-login) with any email. Addresses in
`ADMIN_EMAILS` become admins; everyone else becomes a student.

```bash
npm run db:verify    # 30 checks against a real database — see below
npm run typecheck
npm run lint
```

---

## How this is put together

### Instrument configuration lives on windows, not instruments

An instrument has one or more **booking windows**, each with its own rules:

| Window    | Days    | Hours         | Rules                          |
| --------- | ------- | ------------- | ------------------------------ |
| Daytime   | Mon–Fri | 08:00–17:00   | 30-min slots, max 2h, max 4 back-to-back |
| Overnight | Any     | 17:00–08:00   | one 15-hour block, 2 per week per student |
| Weekend   | Sat–Sun | 08:00–17:00   | 1-hour slots, max 4h           |

Duration and slot rules sit on the window rather than the instrument because a single
`maxDuration` cannot express "short bookings during the day, one long block at night."
Raising the instrument-wide cap to 15 hours for overnight runs would also permit a
15-hour Tuesday afternoon.

A window whose `endMinute <= startMinute` crosses midnight. Times are stored as
minutes-from-midnight rather than timestamps, because a window is a recurring rule,
not an instant.

### Double-booking is prevented by Postgres, not by application code

```sql
EXCLUDE USING gist (
  "instrumentId" WITH =,
  tstzrange("startsAt", "endsAt", '[)') WITH &&
) WHERE ("status" = 'CONFIRMED')
```

"Check for conflicts, then insert" has a race window that will not show up in testing
and will show up during the pre-lab-report rush. This makes the overlap impossible
instead. The `[)` bounds mean a booking ending at 15:00 and one starting at 15:00 do
not conflict.

Scoping the constraint to `CONFIRMED` is also what makes preemption work: flipping a
booking to `PREEMPTED` drops it out of the index and frees the slot inside the same
transaction.

Prisma cannot express this, so it lives in
[`prisma/migrations/20260815000001_booking_constraints`](prisma/migrations/20260815000001_booking_constraints/migration.sql).

### Times

Every timestamp is `timestamptz`. Everything renders in `CAMPUS_TIMEZONE`, never the
browser's zone — a student booking from home over break should see lab time.

Window expansion resolves wall-clock endpoints rather than adding offsets, so DST is
handled without special-casing: the spring-forward overnight block is genuinely 14
hours and the fall-back one is 16. Both are asserted in `npm run db:verify`.

### Research group attribution

Bookings record which research group the time was for. `User.advisorId` is the
student's current group; `Booking.advisorId` is a copy taken at creation, for the same
reason as `policySnapshot` — students change groups, and a report on last semester has
to reflect who the time was for then.

Advisors are `User` rows flagged `isResearchAdvisor`, deliberately independent of
`Role`: being someone's PI is not a reason to grant class-booking and preemption
rights. Most advisors never sign in — an admin creates the row, and if they do log in
later, `signInFromEntra` matches on email and the account activates.

`Instrument.requireResearchAdvisor` makes attribution mandatory per instrument, so it
can be enforced on the NMR without blocking walk-up FTIR use by students who aren't in
a group.

### Validation is a rule chain

[`src/lib/booking/rules.ts`](src/lib/booking/rules.ts) is an ordered list of small
independent rules, each returning its own error message. Adding a rule — instrument
training authorization, say — is one array entry plus an additive migration.

### Preemption

Instructors create `CLASS` bookings and admins create `MAINTENANCE` bookings; both
displace lower-tier bookings. `STUDENT < CLASS < MAINTENANCE`, and only a strictly
higher tier displaces — two instructors colliding is a plain conflict.

Guardrails, all in [`src/lib/booking/create.ts`](src/lib/booking/create.ts):

- `previewPreemption` lists who would be bumped; creation refuses without explicit
  confirmation. Never silent.
- In-progress bookings cannot be preempted — there may be samples in the instrument.
  That needs a conversation, not an email.
- Bookings starting within 12 hours raise a warning; an email is not fair notice.
- Preempted rows are never deleted, so the audit trail survives.

Email delivery is split in two, which is what keeps the app host-independent:

- **Immediately after the transaction commits**, `createPriorityBooking` mails the
  displaced students. Never inside the transaction — a provider outage must not roll
  back a booking that already succeeded — and failures are swallowed rather than
  surfaced.
- **`/api/cron/notifications`** is a once-daily sweeper that retries anything left
  unstamped, not the delivery path.

`preemptionNotifiedAt` is the queue and is stamped only on a successful send, so the
two paths cannot double-send and a failed send is retried automatically. Because
nothing time-sensitive depends on the schedule, this is equally correct on Vercel
Hobby's once-a-day cron limit, on Vercel Pro, or on a systemd timer hitting the same
URL from a university VM.

### Roles

`STUDENT` · `INSTRUCTOR` · `ADMIN`, stored on `User`.

Role comes from the database rather than a token claim, so promotions take effect
immediately and the app is not blocked on IT. If Entra app roles become available,
read the `roles` claim in the sign-in callback and use it to override.

---

## Deployment

**Neon** gives you two connection strings. `DATABASE_URL` is the pooled one (contains
`-pooler`) and is what the app uses — serverless functions open far more connections
than Postgres tolerates. `DIRECT_URL` is unpooled and used only by the Prisma CLI,
because PgBouncer in transaction mode cannot run DDL reliably.

Neon supports `btree_gist`, so the exclusion constraint works as written.

**Vercel** needs every variable from `.env.example` plus `CRON_SECRET`, which
authenticates the scheduled route. `npm run build` runs `prisma generate` first.

Run `npm run db:deploy` against production before the first deploy.

### If this moves to university hosting instead

The only Vercel-specific file is `vercel.json`. To run on a VM:

- Point `DATABASE_URL` and `DIRECT_URL` at the local Postgres — they collapse to the
  same value with no pooler in front. `@prisma/adapter-pg` needs no changes.
- Install the `postgresql-contrib` package so `CREATE EXTENSION btree_gist` works.
- Replace the cron entry with a systemd timer or cron container that curls
  `/api/cron/notifications` with the `CRON_SECRET` bearer token.
- Add a Dockerfile using Next's `output: 'standalone'`.

Resend keeps working from a VM regardless of firewall rules — it is an HTTPS API, not
SMTP, so blocked outbound port 587 is irrelevant.

---

## Still to build

- **Booking form and drag-to-select.** The engine is done and tested; the UI on top of
  it is not. The instrument page is currently read-only.
- **Entra SSO.** [`src/lib/auth.ts`](src/lib/auth.ts) has `signInFromEntra` ready for
  an OAuth callback to call. Needs an app registration with a redirect URI. The
  tenant check in that function is not optional — without it any Microsoft account on
  earth can sign in.
- **Admin screens** for instruments, windows, and the research-advisor list.
- **Usage reports by research group.** The data is captured and indexed
  (`Booking.advisorId`); nothing reads it yet.
- **Reminder emails and no-show marking** — the cron route exists; these are more jobs
  for it.
- **Blackout/maintenance UI.** The data model handles it today (`MAINTENANCE`
  bookings); there is no screen for it.

See [docs/PROJECT-OVERVIEW.md](docs/PROJECT-OVERVIEW.md) for the non-technical
description written for the instrument manager and IT.

### Open questions for the department

- Is there a list of instructors and research advisors to bulk-import, or is
  entry-by-admin enough?
- **Which systems is the department currently using, and what's the cutover plan?**
  This app is meant to consolidate several. Worth knowing whether any of them can
  export existing bookings, whether any instrument stays on its current system, and
  whether cutover happens at a semester boundary. Also worth a look at what those
  tools do well before replacing them.
- Which domain sends mail? Resend needs SPF/DKIM records, and a delegated subdomain is
  usually easier to get than records on the main university domain.
