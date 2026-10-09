-- ============================================================================
-- Migration 001 — Multi-room bookings (booking_rooms junction)
-- ============================================================================
-- WHEN YOU NEED THIS:
--   Only if you are upgrading a Postgres volume that was created BEFORE
--   multi-room support was added. A FRESH install (docker compose down -v &&
--   up --build on an empty volume) already gets booking_rooms from schema.sql,
--   so you do NOT need to run this on a brand-new database.
--
-- WHAT IT DOES:
--   Adds the booking_rooms junction table that lets one booking (num_rooms >= 2)
--   hold several physical rooms at once. bookings.room_id stays the "primary"
--   room for back-compat; booking_rooms is the authoritative set of rooms a
--   CHECKED-IN booking currently holds. UNIQUE(room_id) guarantees a room is
--   held by at most one active booking at a time.
--
-- HOW TO RUN (safe to run more than once — every statement is guarded):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/001_multiroom_and_extend.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS booking_rooms (
    booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    room_id     UUID NOT NULL REFERENCES rooms(id)    ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (booking_id, room_id),
    UNIQUE (room_id)
);

CREATE INDEX IF NOT EXISTS idx_booking_rooms_booking ON booking_rooms (booking_id);

-- Backfill: for any booking that is currently checked in and already has a
-- primary room_id but no junction row (i.e. it was checked in before this
-- migration), record that room in booking_rooms so the floor board and
-- checkout logic — which now read through the junction — still see it.
INSERT INTO booking_rooms (booking_id, room_id)
SELECT b.id, b.room_id
FROM bookings b
WHERE b.status = 'checked_in'
  AND b.room_id IS NOT NULL
  AND NOT EXISTS (SELECT 1 FROM booking_rooms br WHERE br.booking_id = b.id)
ON CONFLICT (room_id) DO NOTHING;
