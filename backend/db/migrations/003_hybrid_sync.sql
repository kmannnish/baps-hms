-- ============================================================================
-- Migration 003 — Hybrid sync support (booking_code, sync_state, updated_at trigger)
-- ============================================================================
-- WHEN YOU NEED THIS:
--   Only if you are upgrading a Postgres volume created BEFORE the hybrid
--   "online inbox + local master" work. A FRESH install (docker compose down -v
--   && up --build on an empty volume) already gets all of this from schema.sql,
--   so you do NOT need to run this on a brand-new database.
--
-- WHAT IT DOES (all additive — nothing existing is dropped or rewritten):
--   1. bookings.booking_code — the human-readable stay code BAPS-<O|W>-YYMMDD-NN
--      (O = online/cloud-minted, W = walk-in/PC-minted). UUID stays the primary
--      key and the sync join key; this is just a friendly, per-day serial shown
--      to guests and staff. Nullable + UNIQUE: old rows keep NULL (Postgres
--      allows many NULLs under a UNIQUE index), new rows get a code.
--   2. sync_state — one row per sync cursor (pull_bookings / push_bookings),
--      so the PC-side sync worker knows where it left off after a restart.
--   3. A BEFORE UPDATE trigger on bookings that stamps updated_at = now() on
--      every ordinary write, so the sync cursors are reliable even if a future
--      writer forgets the "updated_at = now()" clause (today it is app
--      convention only). The sync worker itself sets a session flag
--      (baps.sync_write = 'on') so its OWN writes PRESERVE the source row's
--      updated_at instead of bumping it — without that bypass, a pulled row
--      would look freshly-changed and get pushed straight back, echoing forever.
--
-- HOW TO RUN (safe to run more than once — every statement is guarded):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/003_hybrid_sync.sql
-- ============================================================================

-- 1. Human-readable booking code -------------------------------------------
ALTER TABLE bookings ADD COLUMN IF NOT EXISTS booking_code VARCHAR(24);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bookings_booking_code ON bookings (booking_code);

-- 2. Sync cursors ------------------------------------------------------------
CREATE TABLE IF NOT EXISTS sync_state (
    name       TEXT PRIMARY KEY,      -- 'pull_bookings' | 'push_bookings'
    cursor     TIMESTAMPTZ,           -- last source updated_at successfully applied
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- 3. Keep bookings.updated_at truthful, but let the sync worker opt out ------
CREATE OR REPLACE FUNCTION set_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
    -- Sync-originated writes carry the SOURCE database's updated_at and must
    -- keep it, so a pulled/pushed row does not look locally-modified and echo
    -- back across the link. The worker sets `SET LOCAL baps.sync_write = 'on'`
    -- inside its transaction; current_setting(..., true) returns NULL when the
    -- flag was never set (ordinary writes), which falls through to the bump.
    IF current_setting('baps.sync_write', true) = 'on' THEN
        RETURN NEW;
    END IF;
    NEW.updated_at = now();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS trg_bookings_updated_at ON bookings;
CREATE TRIGGER trg_bookings_updated_at
    BEFORE UPDATE ON bookings
    FOR EACH ROW
    EXECUTE FUNCTION set_bookings_updated_at();
