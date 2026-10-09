-- ============================================================================
-- Migration 005 — permission back-fill for editing confirmed bookings
-- ============================================================================
-- WHEN YOU NEED THIS:
--   Only on a Postgres volume created BEFORE the permissions below were added
--   to schema.sql. A FRESH install (docker compose down -v && up --build on an
--   empty volume) already has all of this from schema.sql + seed.sql, so you do
--   NOT need to run this on a brand-new database.
--
-- WHY:
--   Editing a confirmed/approved booking (dates, pax, room type, bill, payment)
--   is gated by three permissions:
--       can_modify_bookings    → PATCH /bookings/:id          (details)
--       can_set_billing_tier   → PUT   /bookings/:id/billing  (the bill)
--       can_mark_payment       → POST  /bookings/:id/pay      (a payment)
--   schema.sql defines all three and seed.sql grants them to Admin, Swami Ji
--   and Receptionist. An older volume, however, may be missing the rows and/or
--   the grants (004 only granted can_modify_bookings to Receptionist), so the
--   new "Edit" button would 403 for Swami Ji and Admin there. This migration is
--   the idempotent back-fill.
--
-- WHAT IT DOES (all additive + idempotent — safe to re-run):
--   1. Ensures the three permission rows exist (ON CONFLICT (key) DO NOTHING).
--   2. Grants them to Admin + Swami Ji (matching seed.sql's intent).
--   3. Grants them to Receptionist (already granted by 004/seed, ON CONFLICT
--      DO NOTHING makes a re-run a no-op). Custom roles can be granted these
--      from the Roles admin UI instead.
--
-- HOW TO RUN (safe to run more than once — every statement is guarded):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/005_edit_confirmed_bookings_permissions.sql
-- ============================================================================

-- 1. Ensure the permission rows exist ---------------------------------------
INSERT INTO permissions (key, label, category) VALUES
    ('can_modify_bookings',  'Modify room/date on a booking', 'bookings'),
    ('can_set_billing_tier', 'Set billing tier / discount',    'billing'),
    ('can_mark_payment',     'Record a payment',               'billing')
ON CONFLICT (key) DO NOTHING;

-- 2. Grant to the approvers (Admin + Swami Ji) by role name ------------------
--    seed.sql already means to; an old volume may be missing the grants.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE p.key IN ('can_modify_bookings', 'can_set_billing_tier', 'can_mark_payment')
  AND r.name IN ('Admin', 'Swami Ji')
ON CONFLICT DO NOTHING;

-- 3. Grant to Receptionist (desk operations) ---------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE p.key IN ('can_modify_bookings', 'can_set_billing_tier', 'can_mark_payment')
  AND r.name = 'Receptionist'
ON CONFLICT DO NOTHING;
