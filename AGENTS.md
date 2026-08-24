<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# Instrument Calendar

See [README.md](README.md) for the architecture. Things that are easy to get wrong:

- **Never validate overlaps in application code alone.** The `Booking_no_overlap`
  exclusion constraint is the authority. App-level checks exist for good error
  messages, not for correctness.
- **Preemption order matters.** Conflicting bookings must leave `CONFIRMED` *before*
  the new booking is inserted, or the constraint rejects it. Both steps in one
  transaction.
- **Times of day are minutes-from-midnight, campus-local.** `endMinute <= startMinute`
  means the window crosses midnight. Never do modular arithmetic on them — expand into
  concrete instants via `civilToInstant` and compare those.
- **Never add offsets to cross DST.** Resolve wall-clock endpoints instead.
- **Prisma 7 specifics:** row types are `InstrumentModel` / `BookingWindowModel`, not
  `Instrument` / `BookingWindow`. The datasource URL lives in `prisma.config.ts`, not
  the schema. A driver adapter is required at runtime.
- Run `npm run db:verify` after touching anything in `src/lib/booking/` or `src/lib/time.ts`.
