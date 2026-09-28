# NKU Chemistry — Instrument Calendar

Booking system for departmental instruments (NMR, FTIR, GC-MS). Students reserve time
within rules each instrument sets; instructors reserve blocks for classes, which
displace student bookings and email the affected students.

**Stack:** Next.js 16 (App Router) · TypeScript · Tailwind 4 · Postgres · Prisma 7 ·
Resend. Runs as a Docker container against any Postgres 15+ with `btree_gist`.

---

## Getting started

```bash
npm install
cp .env.example .env      # defaults already match compose.yaml
npm run db:up             # Postgres on :5433, waits until it accepts connections
npm run db:deploy         # apply migrations
npm run db:seed           # three sample instruments, seven sample users
npm run dev
```

`npm run db:up` starts the Postgres defined in [`compose.yaml`](compose.yaml) and does
not return until the container reports healthy, so nothing after it can race a database
that is still starting. `npm run db:down` stops it; the data sits in a named volume and
survives. Port 5433, because a machine-wide Postgres usually already holds 5432.

⚠️ Don't use `npx prisma dev` on this project. It picks a **fresh ephemeral port on
every restart**, which silently invalidates the URLs in `.env` — the failure surfaces as
`ECONNREFUSED` from application code rather than as the stale config it is. Its proxy
also **serialises connections**, dropping the second one, so any page running queries
concurrently fails with `Connection terminated unexpectedly` unless you pin
`DATABASE_POOL_MAX="1"`. Against the container above, leave that unset.

Sign in at [/dev-login](http://localhost:3000/dev-login) with any email. Addresses in
`ADMIN_EMAILS` become admins; everyone else becomes a student.

```bash
npm run db:verify    # 42 checks against a real database — see below
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

### The calendar offers only slots the rules permit

[`slots.ts`](src/lib/booking/slots.ts) computes, server-side, every start a student
could pick and the lengths available from each — accounting for existing bookings, the
changeover buffer, slot grid, duration caps, and the consecutive-slot limit. The
calendar renders those as clickable targets, so the booking dialog offers only choices
that will be accepted.

This is a UI honesty measure, not enforcement. The server action re-validates through
the same rule chain on submit, and the exclusion constraint sits behind that — someone
else can always take a slot between page render and click, and that path returns a
clear error with alternatives rather than a failure.

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

Campus hosting, as a container. `Dockerfile` has two publishable stages and
`compose.yaml` wires up the reference deployment:

```bash
npm run stack:up      # database, migrations, app, cron — built and waited on
npm run stack:logs    # follow the app
npm run stack:down
```

`AUTH_SECRET` and `CRON_SECRET` have no defaults and the stack refuses to start without
them. That is deliberate: a generated-at-startup session secret signs every user out on
each restart, and an unset `CRON_SECRET` makes the notification endpoint refuse to run
in production.

### Why two image stages

`runner` is the application: the standalone build, `tzdata`, and nothing else.

`migrator` exists because `prisma migrate deploy` needs the Prisma CLI, which depends on
`@prisma/engines`, `@prisma/studio-core` and `@prisma/dev` — about 170 MB the running app
never touches. It runs to completion before the app starts, expressed in compose as
`condition: service_completed_successfully`.

Migrating from the app's own entrypoint would instead put that 170 MB into the image
serving traffic and have every replica race to apply the same migrations on startup.

### Things that are easy to get wrong here

- **The build needs environment variables even though it never connects.**
  `src/lib/env.ts` validates the whole environment at import, and `next build` imports it
  while collecting routes. The build stage sets placeholders; every real value arrives at
  runtime. The placeholder database port is `1`, so any code that did try to connect
  during a build fails loudly rather than reaching something real.
- **`output: 'standalone'` does not copy `public` or `.next/static`.** The Dockerfile
  copies both explicitly. Omit them and the app serves correct markup with no stylesheet.
- **`tzdata` is required.** Bookings are `timestamptz` rendered in `CAMPUS_TIMEZONE`, and
  window expansion resolves wall-clock endpoints to handle DST. Without the zone database
  that silently falls back to UTC — correct all year, wrong on exactly the two nights
  `npm run db:verify` exists to protect. Neither image carries the suite itself (it needs
  the source tree and dev dependencies; CI runs it against a real Postgres instead), so to
  check a built image directly, ask it what it thinks the offsets are:

  ```bash
  docker compose --profile full exec app node -e "
    const f = (iso) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', timeZoneName: 'shortOffset' }).format(new Date(iso));
    console.log(f('2026-01-15T12:00:00Z'), f('2026-07-15T12:00:00Z'));"
  # GMT-5 GMT-4    — correct
  # GMT   GMT      — tzdata missing
  ```
- **Prisma's WASM query compiler traces correctly on its own.** It arrives as a 4.7 MB
  base64 `.mjs` reached through a dynamic import, which is the kind of thing output
  tracing misses — but it is a static string literal, so it is picked up. Verified in
  `.next/standalone`; no `outputFileTracingIncludes` entry needed.
- **`btree_gist` needs privileges.** The `postgres:17` image has it. If IT supplies the
  database instead, the app's user must be able to `CREATE EXTENSION`, or an administrator
  creates it once beforehand.

### Pulling published images instead of building

CI publishes both stages to GitHub Container Registry on every push to `main`, tagged
with the branch, the commit SHA, and the version for `v*` tags. Updating on the server is
then a pull and a restart rather than a build:

```bash
docker pull ghcr.io/<owner>/<repo>/migrate:main
docker pull ghcr.io/<owner>/<repo>/app:main
```

To deploy those instead of building locally, replace the `build:` blocks for `app` and
`migrate` in `compose.yaml` with `image:` lines pointing at a specific SHA tag. Pinning
the SHA rather than `main` is what makes a rollback possible.

### What IT supplies

- A hostname, and a TLS reverse proxy in front of `app`. If that proxy is nginx, disable
  response buffering so streaming works.
- Postgres 15+ with `btree_gist`, if they would rather run it themselves than use the
  database service here. Point `DATABASE_URL_INTERNAL` and `DIRECT_URL_INTERNAL` at it.
- A secret store for `AUTH_SECRET`, `CRON_SECRET`, `RESEND_API_KEY` and the Entra client
  secret.
- Database backups.

If they prefer their own scheduler to the `cron` container, a systemd timer making one
authenticated request per day to `/api/cron/notifications` is equivalent. Nothing
time-sensitive depends on it — students are mailed within seconds of being preempted, and
this only retries what failed.

### If it ever runs on Vercel and Neon again

Nothing in the application is Vercel-specific, but that path is no longer maintained
here: `vercel.json` is gone and the docs above assume a container. Neon's pooled
`DATABASE_URL` and unpooled `DIRECT_URL` are still the reason those two variables are
separate.

### Running multiple replicas

Single-instance is assumed. Before scaling past one, set
`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` to a fixed value across instances — otherwise a
server action encrypted by one replica cannot be decrypted by another and booking
submissions fail with "Failed to find Server Action". Shared caching and `deploymentId`
also become relevant.

---

## Still to build

- **The instructor class-booking UI.** `createPriorityBooking` and
  `previewPreemption` are done and tested, including the confirm-before-cancelling
  flow; there is no screen driving them yet. Students can book and cancel through the
  calendar today.
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
