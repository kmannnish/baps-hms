-- ============================================================================
-- Migration 002 — Luggage security tokens (luggage_tokens)
-- ============================================================================
-- WHEN YOU NEED THIS:
--   Only if you are upgrading a Postgres volume created BEFORE per-guest luggage
--   tokens were added. A FRESH install (docker compose down -v && up --build on
--   an empty volume) already gets luggage_tokens from schema.sql, so you do NOT
--   need to run this on a brand-new database.
--
-- WHAT IT DOES:
--   Replaces the old single-number luggage_counter with per-guest tokens. Each
--   token gets a short printable code (LG-0001, LG-0002, ...) handed to the guest
--   at checkout as a claim check. The luggage hall's "bags in hall" figure is now
--   SUM(bag_count) over open tokens, not the old counter. The luggage_counter
--   table is left in place (harmless, no longer read) so nothing breaks.
--
-- HOW TO RUN (safe to run more than once — every statement is guarded):
--   docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/002_luggage_tokens.sql
-- ============================================================================

CREATE SEQUENCE IF NOT EXISTS luggage_token_seq;

CREATE TABLE IF NOT EXISTS luggage_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_code   VARCHAR(16) UNIQUE NOT NULL
                   DEFAULT ('LG-' || lpad(nextval('luggage_token_seq')::text, 4, '0')),
    booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,
    guest_name   VARCHAR(128) NOT NULL,
    mobile       VARCHAR(20),
    bag_count    INTEGER NOT NULL DEFAULT 1 CHECK (bag_count >= 1),
    status       VARCHAR(16) NOT NULL DEFAULT 'open'
                   CHECK (status IN ('open', 'collected')),
    note         TEXT DEFAULT '',
    issued_by    UUID REFERENCES users(id),
    issued_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    collected_by UUID REFERENCES users(id),
    collected_at TIMESTAMPTZ
);

CREATE INDEX IF NOT EXISTS idx_luggage_tokens_status ON luggage_tokens (status);
