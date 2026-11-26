-- ============================================================================
-- Migration 010 — admin-configurable booking form field rules
-- ============================================================================
-- Additive + idempotent. Stores required / optional / hidden rules per field
-- for both walk-in (desk) and online (customer portal) booking forms.
--
-- Run (safe to re-run):
--   psql "$DATABASE_URL" -f backend/db/migrations/010_booking_form_config.sql
-- ============================================================================

INSERT INTO settings (key, value) VALUES (
    'booking_form_config',
    '{
      "walkin": {
        "guestCity": "optional",
        "santReferenceName": "required",
        "santReferenceMobile": "optional",
        "preferredArrivalTime": "optional",
        "preferredDepartureTime": "optional",
        "idDocument": "optional"
      },
      "online": {
        "guestCity": "optional",
        "santReferenceName": "required",
        "santReferenceMobile": "optional",
        "preferredArrivalTime": "optional",
        "preferredDepartureTime": "optional"
      }
    }'::jsonb
) ON CONFLICT (key) DO NOTHING;
