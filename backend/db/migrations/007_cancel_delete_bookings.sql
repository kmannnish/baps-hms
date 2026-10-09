-- ============================================================================
-- Migration 007 — cancel & delete bookings (Admin)
-- ============================================================================
-- Additive + idempotent. Adds two Admin-only booking permissions and allows a
-- new 'cancelled' booking status. Mirrors schema.sql for an EXISTING volume
-- (a fresh install already has all of this from schema.sql + seed.sql).
--
-- Run (safe to re-run):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/007_cancel_delete_bookings.sql
-- ============================================================================

-- 1. Permissions (Admin-only booking cancel + delete) ------------------------
INSERT INTO permissions (key, label, category) VALUES
    ('can_cancel_bookings', 'Cancel a booking (frees the room, keeps history)', 'bookings'),
    ('can_delete_bookings', 'Permanently delete a booking',                     'bookings')
ON CONFLICT (key) DO NOTHING;

-- 2. Grant both to the Admin role (seed.sql grants Admin every permission) ----
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Admin'
  AND p.key IN ('can_cancel_bookings', 'can_delete_bookings')
ON CONFLICT DO NOTHING;

-- 3. Allow the 'cancelled' booking status ------------------------------------
--    (drop + re-add the inline column CHECK, which Postgres named
--    bookings_status_check; safe to re-run).
ALTER TABLE bookings DROP CONSTRAINT IF EXISTS bookings_status_check;
ALTER TABLE bookings ADD CONSTRAINT bookings_status_check
    CHECK (status IN ('pending','approved','rejected','modified','expired','checked_in','checked_out','cancelled'));
