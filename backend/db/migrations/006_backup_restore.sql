-- ============================================================================
-- Migration 006 — backup & restore (permission + schedule settings back-fill)
-- ============================================================================
-- WHEN YOU NEED THIS:
--   Only on a Postgres volume created BEFORE the backup feature was added. A
--   FRESH install (docker compose down -v && up --build on an empty volume)
--   already has all of this from schema.sql + seed.sql, so you do NOT need to
--   run this on a brand-new database.
--
-- WHY:
--   The Backup tab (Admin) is gated by a new data-driven permission,
--   can_manage_backups, and the automatic scheduler reads a handful of
--   backup_* settings rows. schema.sql defines the permission and seed.sql
--   grants every permission to Admin, so a fresh DB is complete — but an older
--   volume is missing both the permission row/grant and the settings defaults.
--   This is the idempotent back-fill.
--
-- WHAT IT DOES (all additive + idempotent — safe to re-run):
--   1. Ensures the can_manage_backups permission row exists.
--   2. Grants it to the Admin role (matching seed.sql's "Admin gets everything").
--      Custom roles can be granted it from the Roles admin UI instead.
--   3. Ensures the backup_* schedule settings exist, defaulting to OFF so the
--      feature stays dormant until the admin turns it on. The *_last_run markers
--      are intentionally NOT seeded — the server writes them after each run.
--
-- HOW TO RUN (safe to run more than once — every statement is guarded):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/006_backup_restore.sql
-- ============================================================================

-- 1. Ensure the permission row exists ---------------------------------------
INSERT INTO permissions (key, label, category) VALUES
    ('can_manage_backups', 'Create & restore database backups', 'admin')
ON CONFLICT (key) DO NOTHING;

-- 2. Grant it to Admin (seed.sql grants Admin every permission) --------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT r.id, p.id
FROM roles r, permissions p
WHERE p.key = 'can_manage_backups'
  AND r.name = 'Admin'
ON CONFLICT DO NOTHING;

-- 3. Ensure the schedule settings exist (default OFF) ------------------------
INSERT INTO settings (key, value) VALUES
    ('backup_enabled',          'false'),
    ('backup_daily_enabled',    'true'),
    ('backup_weekly_enabled',   'false'),
    ('backup_monthly_enabled',  'false'),
    ('backup_time',             '"02:00"'),
    ('backup_weekly_day',       '0'),
    ('backup_monthly_day',      '1')
ON CONFLICT (key) DO NOTHING;
