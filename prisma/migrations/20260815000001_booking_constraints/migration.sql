-- Integrity rules Prisma's schema DSL cannot express.
--
-- The exclusion constraint is the important one. "Query for conflicts, then insert"
-- has a race window: two students submitting within the same few hundred milliseconds
-- both see a clear calendar and both get the slot. Rare enough to never show up in
-- testing, common enough to happen during the pre-lab-report rush. This makes the
-- overlap structurally impossible instead.

CREATE EXTENSION IF NOT EXISTS btree_gist;

-- A booking must end after it starts.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_time_order_check"
  CHECK ("endsAt" > "startsAt");

-- CLASS and MAINTENANCE bookings must explain themselves: that text is what the
-- bumped student reads in the preemption email.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_priority_description_check"
  CHECK (
    "type" = 'STUDENT'::"BookingType"
    OR ("description" IS NOT NULL AND length(btrim("description")) > 0)
  );

-- No two CONFIRMED bookings on the same instrument may overlap.
--
-- '[)' bounds: a booking ending at 15:00 and one starting at 15:00 do not conflict.
--
-- Scoping to CONFIRMED is what makes preemption work. Flipping a student booking to
-- PREEMPTED drops it out of this index, so the instructor's CLASS booking can be
-- inserted in the same transaction with no window where both exist.
--
-- Note this enforces literal overlap only. Instrument.bufferMinutes (changeover time)
-- is a policy rule applied in src/lib/booking/rules.ts, not here — the database
-- guarantees correctness, the rule chain guarantees politeness.
ALTER TABLE "Booking"
  ADD CONSTRAINT "Booking_no_overlap"
  EXCLUDE USING gist (
    "instrumentId" WITH =,
    tstzrange("startsAt", "endsAt", '[)') WITH &&
  ) WHERE ("status" = 'CONFIRMED'::"BookingStatus");

-- Window times are minutes-from-midnight, campus-local. Start is always a real
-- time-of-day; end may be 1440 to mean "midnight, same day". endMinute <= startMinute
-- is the overnight case and is deliberately allowed.
ALTER TABLE "BookingWindow"
  ADD CONSTRAINT "BookingWindow_minute_range_check"
  CHECK (
    "startMinute" >= 0 AND "startMinute" < 1440
    AND "endMinute" >= 0 AND "endMinute" <= 1440
  );

ALTER TABLE "BookingWindow"
  ADD CONSTRAINT "BookingWindow_duration_check"
  CHECK (
    "minDurationMinutes" > 0
    AND "maxDurationMinutes" >= "minDurationMinutes"
    AND "slotSizeMinutes" > 0
  );

-- A window with no days never opens; that is always a configuration mistake.
ALTER TABLE "BookingWindow"
  ADD CONSTRAINT "BookingWindow_days_not_empty_check"
  CHECK (array_length("daysOfWeek", 1) IS NOT NULL);
