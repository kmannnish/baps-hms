-- ============================================================================
-- cloud-schema.sql — the CLOUD "inbox/outbox" subset (e.g. Neon Postgres)
-- ============================================================================
-- This is the schema for the always-on cloud database that backs the PUBLIC
-- site (guest booking form + Swami Ji approvals) while the Reception PC is off.
-- The PC's local Postgres remains the complete MASTER; this cloud DB only holds
-- what guest-create + Swami-approve actually need, and the PC's sync worker
-- reconciles the two when the PC is online.
--
-- WHAT'S HERE vs schema.sql:
--   • Only the tables the cloud's mounted routes touch: auth (permissions,
--     roles, role_permissions, users), settings, inventory reference
--     (room_types + empty floors/rooms), bookings, audit_log, payments.
--   • NO seed data at all — not even the permissions catalog or settings
--     defaults. The sync worker's first PUSH seeds permissions, roles,
--     role_permissions, users, settings and room_types FROM THE PC, using the
--     PC's real UUIDs, so role_permissions / approved_by / audit FKs line up
--     across the two databases. (Seeding here with fresh random UUIDs would
--     make them diverge.) => Swami's cloud login only works AFTER the first
--     sync has run; this is documented in SETUP.md.
--   • floors and rooms are created but stay EMPTY on the cloud (no physical
--     inventory lives here). That is deliberate: the approve capacity check
--     does `COUNT(*) FROM rooms` and, finding zero, falls back to
--     room_types.capacity_cap — the same authority the guest availability
--     check already uses. Keeping the (empty) tables means the exact same
--     route SQL runs on the PC and in the cloud with no branching.
--   • booking_code column + the updated_at trigger are present (see below) so
--     the cloud mints BAPS-O-YYMMDD-NN codes and the sync cursors stay honest.
--
-- Omitted (cloud never reaches them): booking_rooms, luggage_counter,
-- luggage_tokens, notification_sounds, sync_state (sync_state is PC-only).
--
-- HOW TO LOAD (once, on the fresh cloud DB):
--   psql "<CLOUD_DATABASE_URL>" -f backend/db/cloud-schema.sql
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ---- Auth -----------------------------------------------------------------
CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key         VARCHAR(64) UNIQUE NOT NULL,
    label       VARCHAR(128) NOT NULL,
    description TEXT,
    category    VARCHAR(64),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(64) UNIQUE NOT NULL,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT false,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE users (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name     VARCHAR(128) NOT NULL,
    mobile        VARCHAR(20) UNIQUE NOT NULL,
    email         VARCHAR(128) UNIQUE,
    password_hash TEXT NOT NULL,
    role_id       UUID NOT NULL REFERENCES roles(id),
    is_active     BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at    TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Settings -------------------------------------------------------------
CREATE TABLE settings (
    key         VARCHAR(64) PRIMARY KEY,
    value       JSONB NOT NULL,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- Inventory reference (rooms/floors stay EMPTY on the cloud) -----------
CREATE TABLE floors (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(64) NOT NULL,
    sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE room_types (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(64) UNIQUE NOT NULL,
    base_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
    capacity_cap  INT NOT NULL DEFAULT 0
);

CREATE TABLE rooms (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    floor_id      UUID NOT NULL REFERENCES floors(id),
    room_type_id  UUID NOT NULL REFERENCES room_types(id),
    room_number   VARCHAR(16) NOT NULL,
    status        VARCHAR(16) NOT NULL DEFAULT 'ready'
                    CHECK (status IN ('ready', 'occupied', 'maintenance')),
    bed_count     INTEGER NOT NULL DEFAULT 1,
    has_bathroom  BOOLEAN NOT NULL DEFAULT true,
    created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
    UNIQUE (floor_id, room_number)
);

-- ---- Bookings (the inbox/outbox) ------------------------------------------
CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_code        VARCHAR(24),
    channel             VARCHAR(16) NOT NULL DEFAULT 'online'
                          CHECK (channel IN ('online', 'walkin')),
    num_rooms           INT NOT NULL DEFAULT 1 CHECK (num_rooms >= 1),
    guest_name          VARCHAR(128) NOT NULL,
    mobile              VARCHAR(20) NOT NULL,
    pax_men             INT NOT NULL DEFAULT 0,
    pax_women           INT NOT NULL DEFAULT 0,
    pax_children        INT NOT NULL DEFAULT 0,
    checkin_date        DATE NOT NULL,
    checkout_date       DATE NOT NULL,
    sant_reference_name VARCHAR(128),
    sant_reference_mobile VARCHAR(20),
    room_type_id        UUID NOT NULL REFERENCES room_types(id),
    room_id             UUID REFERENCES rooms(id),      -- always NULL on the cloud
    id_document_url     TEXT,                            -- always NULL on the cloud (ID captured at the desk)
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','modified','expired','checked_in','checked_out')),
    billing_tier        VARCHAR(16) CHECK (billing_tier IN ('foc','discount','paid')),
    discount_percent    NUMERIC(5,2) DEFAULT 0,
    final_amount        NUMERIC(10,2),
    is_paid             BOOLEAN NOT NULL DEFAULT false,
    amount_paid         NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_status      VARCHAR(16) NOT NULL DEFAULT 'unpaid'
                          CHECK (payment_status IN ('unpaid','partial','paid')),
    ata_actual_arrival  TIMESTAMPTZ,
    actual_checkout_at  TIMESTAMPTZ,
    preferred_arrival_time   TIME,
    preferred_departure_time TIME,
    late_checkout_surcharge  NUMERIC(10,2) DEFAULT 0,
    extra_charges            JSONB DEFAULT '[]',
    created_by          UUID REFERENCES users(id),
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    approval_note       TEXT,
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_status_dates ON bookings (status, checkin_date, checkout_date);
CREATE INDEX idx_bookings_room_type ON bookings (room_type_id, status);
CREATE UNIQUE INDEX idx_bookings_booking_code ON bookings (booking_code);

-- ---- Payments (empty on the cloud; kept so can_view_reports routes can't 500) ----
CREATE TABLE payments (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    amount      NUMERIC(10,2) NOT NULL CHECK (amount > 0),
    method      VARCHAR(16) NOT NULL CHECK (method IN ('cash','upi','card')),
    note        TEXT DEFAULT '',
    recorded_by UUID REFERENCES users(id),
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX idx_payments_booking ON payments (booking_id);

-- ---- Audit log ------------------------------------------------------------
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id    UUID REFERENCES users(id),
    action      VARCHAR(64) NOT NULL,
    entity_type VARCHAR(64) NOT NULL,
    entity_id   UUID NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---- updated_at trigger (mirror of the local one; keeps sync cursors honest) ----
-- The PC's sync worker sets `SET LOCAL baps.sync_write = 'on'` on whichever
-- connection it writes through — local on PULL, cloud on PUSH — and writes the
-- SOURCE row's updated_at. This bypass keeps the pushed/pulled timestamp intact
-- so the row does not look freshly-changed and echo back across the link.
CREATE OR REPLACE FUNCTION set_bookings_updated_at()
RETURNS TRIGGER AS $$
BEGIN
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
