-- ============================================================================
-- Migration 013 — Built-in Mac-style chime notification sounds
-- ============================================================================
-- Additive + idempotent. Registers the 3 bundled .wav chimes in
-- `backend/uploads/sounds/` so they appear in Admin -> Content & messages
-- and persist across Render redeploys.
--
-- Run (safe to re-run):
--   psql "$DATABASE_URL" -f backend/db/migrations/013_builtin_notification_sounds.sql
-- ============================================================================

INSERT INTO notification_sounds (label, filename)
SELECT v.label, v.filename
FROM (VALUES
    ('Glass Chime (Mac style)', 'mac_glass_chime.wav'),
    ('Tri-Tone Chime (Mac style)', 'mac_tri_tone.wav'),
    ('Soft Ping (Mac style)', 'mac_soft_ping.wav')
) AS v(label, filename)
WHERE NOT EXISTS (
    SELECT 1 FROM notification_sounds ns WHERE ns.filename = v.filename
);
