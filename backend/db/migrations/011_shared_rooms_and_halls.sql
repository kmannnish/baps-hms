-- ============================================================================
-- Migration 011 — Shared Dormitories & Shared Halls (multi-booking per room)
-- ============================================================================
-- Additive + idempotent.
-- 1. Adds `is_shared` to `room_types` (true for dormitories and shared halls).
-- 2. Drops the single-booking-per-room UNIQUE(room_id) constraint on
--    `booking_rooms` and adds `beds_used` so multiple bookings can share
--    a dormitory or hall up to `rooms.bed_count` capacity.
--
-- Run (safe to re-run):
--   psql "$DATABASE_URL" -f backend/db/migrations/011_shared_rooms_and_halls.sql
-- ============================================================================

ALTER TABLE room_types ADD COLUMN IF NOT EXISTS is_shared BOOLEAN NOT NULL DEFAULT false;

-- Auto-enable sharing for existing Dormitory / Hall room types
UPDATE room_types
SET is_shared = true
WHERE is_hall = true OR LOWER(name) LIKE '%dorm%';

ALTER TABLE booking_rooms DROP CONSTRAINT IF EXISTS booking_rooms_room_id_key;
ALTER TABLE booking_rooms ADD COLUMN IF NOT EXISTS beds_used INT NOT NULL DEFAULT 1;
