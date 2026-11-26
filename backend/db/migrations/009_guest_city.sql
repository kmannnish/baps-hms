-- ============================================================================
-- Migration 009 — add guest_city to bookings
-- ============================================================================
-- Additive + idempotent. Stores the guest's city / address entered at booking.
--
-- Run (safe to re-run):
--   psql "$DATABASE_URL" -f backend/db/migrations/009_guest_city.sql
-- ============================================================================

ALTER TABLE bookings ADD COLUMN IF NOT EXISTS guest_city VARCHAR(128);
