-- ============================================================================
-- Migration 012 — Admin-controlled custom add-on charges (Food, Extra Bed, etc.)
-- ============================================================================
-- Additive + idempotent. Creates `addon_charges` table so Admin can define
-- custom add-ons once and Reception can tick them during check-in or stay.
--
-- Run (safe to re-run):
--   psql "$DATABASE_URL" -f backend/db/migrations/012_addon_charges.sql
-- ============================================================================

CREATE TABLE IF NOT EXISTS addon_charges (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(100) NOT NULL,
    price       NUMERIC(10,2) NOT NULL DEFAULT 0,
    is_active   BOOLEAN NOT NULL DEFAULT true,
    sort_order  INT NOT NULL DEFAULT 0,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed starter add-ons only when empty
INSERT INTO addon_charges (name, price, sort_order)
SELECT v.name, v.price, v.sort_order
FROM (VALUES
    ('Extra Bed', 100, 1),
    ('Food / Bhojan', 80, 2)
) AS v(name, price, sort_order)
WHERE NOT EXISTS (SELECT 1 FROM addon_charges);
