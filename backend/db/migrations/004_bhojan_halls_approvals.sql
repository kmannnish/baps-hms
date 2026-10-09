-- ============================================================================
-- Migration 004 — Bhojanshala dining, hall room types, on-behalf approvals
-- ============================================================================
-- WHEN YOU NEED THIS:
--   Only if you are upgrading a Postgres volume created BEFORE the Bhojanshala
--   dining tracking, hall bookings, and "Reception approves on behalf of Swami
--   Ji" work. A FRESH install (docker compose down -v && up --build on an empty
--   volume) already gets all of this from schema.sql, so you do NOT need to run
--   this on a brand-new database.
--
-- WHAT IT DOES (all additive — nothing existing is dropped or rewritten):
--   1. bookings.dine_breakfast / dine_lunch / dine_dinner — per-booking meal
--      opt-in for the Bhojanshala (dining hall) head-count. Default TRUE: a
--      guest is assumed to eat all three meals unless Reception unchecks one.
--      The Bhojan view only ever counts CHECKED-IN bookings, so these flags on
--      pending/past rows are harmless. Male/Female/Kids totals come from the
--      existing pax_men / pax_women / pax_children columns.
--   2. room_types.is_hall — marks a bookable hall (vs a sleeping room). Halls
--      are charged per-person at the desk, not per-night.
--   3. room_types.show_on_customer_portal — when false, the type is hidden from
--      the public Customer booking form (halls are Reception-counter only).
--   4. room_types.pax_capacity — max persons for a hall of this type (e.g. 25 or
--      50), admin-set. 0 = not applicable (ordinary sleeping room).
--   5. settings — Bhojanshala meal timings (dynamic "current meal" switches on
--      these), the optional daily Bhojanshala email (recipient + WhatsApp
--      fallback number + enable/time), and the admin toggle that lets the
--      Reception desk approve bookings on Swami Ji's behalf. Guarded inserts
--      (ON CONFLICT DO NOTHING) so re-running never clobbers admin-set values.
--   6. permission can_approve_online_bookings — the AUTHORITATIVE approval of
--      guest-submitted (channel='online') bookings. Granted to Admin + Swami Ji.
--      Reception does NOT get it: Reception may approve an online booking only
--      when the admin turns the reception_approve_on_behalf toggle ON (and must
--      record who authorised it). Reception keeps can_approve_bookings for
--      walk-in phone-approval recording, which is unchanged.
--   7. grant can_modify_bookings to the Receptionist role, so Reception can edit
--      an upcoming booking's dates/details (early check-in, date change) without
--      it being an "approval". Swami Ji + Admin already hold it.
--
-- HOW TO RUN (safe to run more than once — every statement is guarded):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/004_bhojan_halls_approvals.sql
-- ============================================================================

-- 1. Per-booking Bhojanshala meal opt-in ------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dine_breakfast BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dine_lunch     BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS dine_dinner    BOOLEAN NOT NULL DEFAULT true;

-- 2. Hall room types ---------------------------------------------------------
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS is_hall                 BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS show_on_customer_portal BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE room_types ADD COLUMN IF NOT EXISTS pax_capacity            INT     NOT NULL DEFAULT 0;

-- 3. New settings (guarded — admin edits survive a re-run) --------------------
INSERT INTO settings (key, value) VALUES
    ('bhojan_breakfast_time',       '"07:30"'),
    ('bhojan_lunch_time',           '"11:30"'),
    ('bhojan_dinner_time',          '"19:30"'),
    ('bhojan_report_enabled',       'false'),
    ('bhojan_report_time',          '"06:30"'),
    ('bhojanshala_email',           '""'),
    ('bhojanshala_mobile',          '""'),
    ('reception_approve_on_behalf', 'false')
ON CONFLICT (key) DO NOTHING;

-- 4. Authoritative online-approval permission --------------------------------
INSERT INTO permissions (key, label, category) VALUES
    ('can_approve_online_bookings', 'Approve online guest bookings', 'bookings')
ON CONFLICT (key) DO NOTHING;

-- Grant it to the authoritative approvers (Admin, Swami Ji) by role name — the
-- same by-name approach seed.sql already uses. Custom roles can be granted it
-- from the Roles admin UI. Idempotent via the PK ON CONFLICT.
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE p.key = 'can_approve_online_bookings'
  AND r.name IN ('Admin', 'Swami Ji')
ON CONFLICT DO NOTHING;

-- 5. Let Reception edit upcoming booking dates/details (not an approval) ------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE p.key = 'can_modify_bookings'
  AND r.name = 'Receptionist'
ON CONFLICT DO NOTHING;
