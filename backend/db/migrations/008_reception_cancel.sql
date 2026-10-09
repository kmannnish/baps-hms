-- ============================================================================
-- Migration 008 — let Reception cancel bookings (no-show / guest cancellation)
-- ============================================================================
-- Additive + idempotent. Grants the Receptionist role the can_cancel_bookings
-- permission (created in migration 007 / schema.sql). Run AFTER 007.
--
-- Run (safe to re-run):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/008_reception_cancel.sql
-- ============================================================================

INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE r.name = 'Receptionist'
  AND p.key = 'can_cancel_bookings'
ON CONFLICT DO NOTHING;
