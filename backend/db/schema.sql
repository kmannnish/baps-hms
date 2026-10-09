-- ============================================================================
-- BAPS Jaipur Utara Management System — PostgreSQL Schema
-- Everything configurable lives in `settings` / `permissions` / `role_permissions`.
-- No roles, prices, or business rules are hardcoded in application code.
-- ============================================================================

CREATE EXTENSION IF NOT EXISTS "uuid-ossp";

-- ----------------------------------------------------------------------------
-- 1. PERMISSIONS — the full catalog of grantable capabilities
-- ----------------------------------------------------------------------------
CREATE TABLE permissions (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    key         VARCHAR(64) UNIQUE NOT NULL,   -- e.g. 'can_approve_bookings'
    label       VARCHAR(128) NOT NULL,          -- human-readable, shown in Admin UI
    description TEXT,
    category    VARCHAR(64),                    -- e.g. 'bookings', 'security', 'billing'
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed the known capability set (admin can still add more later)
INSERT INTO permissions (key, label, category) VALUES
    ('can_approve_bookings',   'Approve or reject bookings',        'bookings'),
    ('can_approve_online_bookings', 'Approve online guest bookings', 'bookings'),
    ('can_create_bookings',    'Create walk-in bookings at the desk','bookings'),
    ('can_edit_rooms',         'Create / edit rooms & pricing',     'inventory'),
    ('can_modify_bookings',    'Modify room/date on a booking',     'bookings'),
    ('can_set_billing_tier',   'Set FOC / Discount / Paid tier',    'billing'),
    ('can_mark_payment',       'Mark a booking as paid (desk)',     'billing'),
    ('can_manage_settings',    'Edit global settings',              'admin'),
    ('can_manage_roles',       'Create/edit roles & permissions',   'admin'),
    ('can_checkin_checkout',   'Perform check-in / check-out',      'reception'),
    ('can_view_reports',       'View booking history & reports',    'reports'),
    ('can_view_audit_log',     'View the audit log',                'admin'),
    ('can_manage_luggage',      'Manage luggage hall counter',       'reception'),
    ('can_manage_notifications','Configure notification sounds',     'admin'),
    ('can_manage_backups',      'Create & restore database backups', 'admin'),
    ('can_cancel_bookings',     'Cancel a booking (frees the room, keeps history)', 'bookings'),
    ('can_delete_bookings',     'Permanently delete a booking',      'bookings');

-- ----------------------------------------------------------------------------
-- 2. ROLES — admin-defined, arbitrary names (Admin, Swami Ji, Receptionist, ...)
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(64) UNIQUE NOT NULL,
    description TEXT,
    is_system   BOOLEAN NOT NULL DEFAULT false, -- true for roles that cannot be deleted (safety)
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE role_permissions (
    role_id       UUID NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    permission_id UUID NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
    PRIMARY KEY (role_id, permission_id)
);

-- ----------------------------------------------------------------------------
-- 3. USERS
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 4. SETTINGS — single-row-per-key global configuration (admin-editable)
-- ----------------------------------------------------------------------------
CREATE TABLE settings (
    key         VARCHAR(64) PRIMARY KEY,   -- e.g. 'default_checkin_time', 'gst_percent'
    value       JSONB NOT NULL,
    updated_by  UUID REFERENCES users(id),
    updated_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Seed defaults (admin can change any of these from the UI)
INSERT INTO settings (key, value) VALUES
    ('default_checkin_time',  '"14:00"'),
    ('default_checkout_time', '"11:00"'),
    ('gst_percent',           '5'),
    ('tax_enabled',           'true'),
    ('overstay_warning_minutes', '15'),
    ('terms_and_conditions', '"Your booking is PENDING and only confirmed upon BAPS Jaipur approval. Please carry a valid government ID at check-in."'),
    ('whatsapp_templates', '{
        "approved":  "Jai Swaminarayan {{name}}, your booking for {{room}} is CONFIRMED. Status: {{status}}.",
        "rejected":  "Jai Swaminarayan {{name}}, your booking request could not be accommodated at this time. Status: {{status}}.",
        "modified":  "Jai Swaminarayan {{name}}, your booking has been updated. Room: {{room}}. Status: {{status}}.",
        "receipt":   "Jai Swaminarayan {{name}},\nReceipt - BAPS Jaipur Utara\nRoom: {{roomType}} {{roomNumber}}\nDates: {{checkin}} to {{checkout}} ({{nights}} nights)\nTotal: Rs.{{total}}\nPaid: Rs.{{paid}}\nBalance: Rs.{{balance}}\nThank you for staying with us."
    }'),
    -- Bhojanshala (dining hall) meal timings — the dynamic "current meal" view
    -- switches to Lunch after bhojan_lunch_time, Dinner after bhojan_dinner_time,
    -- etc. Admin-editable from the Content & Messages tab.
    ('bhojan_breakfast_time',       '"07:30"'),
    ('bhojan_lunch_time',           '"11:30"'),
    ('bhojan_dinner_time',          '"19:30"'),
    -- Optional daily Bhojanshala head-count email (same opt-in, zero-budget,
    -- PC-only pattern as the daily report — SMTP lives in the PC .env only).
    -- bhojanshala_mobile is the wa.me fallback when email isn't configured/fails.
    ('bhojan_report_enabled',       'false'),
    ('bhojan_report_time',          '"06:30"'),
    ('bhojanshala_email',           '""'),
    ('bhojanshala_mobile',          '""'),
    -- When true, the Reception desk may approve/reject online bookings on Swami
    -- Ji's behalf (a mandatory free-text note records who authorised it).
    ('reception_approve_on_behalf', 'false'),
    -- Automatic local DB backups (see utils/backupScheduler.js). Off by default
    -- (zero surprise, zero cost). The admin turns it on and picks cadences from
    -- the Backup tab; each cadence overwrites its own slot file so storage stays
    -- bounded. The *_last_run markers are written by the server, never seeded.
    ('backup_enabled',          'false'),
    ('backup_daily_enabled',    'true'),
    ('backup_weekly_enabled',   'false'),
    ('backup_monthly_enabled',  'false'),
    ('backup_time',             '"02:00"'),
    ('backup_weekly_day',       '0'),
    ('backup_monthly_day',      '1');

-- ----------------------------------------------------------------------------
-- 5. FLOORS & ROOMS
-- ----------------------------------------------------------------------------
CREATE TABLE floors (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name        VARCHAR(64) NOT NULL,       -- e.g. 'Ground Floor', 'First Floor'
    sort_order  INT NOT NULL DEFAULT 0
);

CREATE TABLE room_types (
    id            UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    name          VARCHAR(64) UNIQUE NOT NULL,   -- 'AC', 'Non-AC', 'Dormitory'
    base_price    NUMERIC(10,2) NOT NULL DEFAULT 0,
    capacity_cap  INT NOT NULL DEFAULT 0,         -- admin-set inventory cap for this type
    -- Hall bookings: a hall is a bookable space charged per-person at the desk
    -- (not per-night), hidden from the public Customer form, with an admin-set
    -- head-count capacity (e.g. 25 or 50). Ordinary sleeping rooms leave these
    -- at their defaults (is_hall=false, shown to customers, pax_capacity=0).
    is_hall                 BOOLEAN NOT NULL DEFAULT false,
    show_on_customer_portal BOOLEAN NOT NULL DEFAULT true,
    pax_capacity            INT     NOT NULL DEFAULT 0
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

-- ----------------------------------------------------------------------------
-- 6. BOOKINGS
-- ----------------------------------------------------------------------------
CREATE TABLE bookings (
    id                  UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    -- Human-readable stay code BAPS-<O|W>-YYMMDD-NN (O = online/cloud-minted,
    -- W = walk-in/PC-minted). The UUID above stays the primary key and the sync
    -- join key; this is a friendly per-day serial shown to guests and staff.
    -- Nullable + UNIQUE so legacy rows (NULL) coexist with coded ones.
    booking_code        VARCHAR(24),
    channel             VARCHAR(16) NOT NULL DEFAULT 'online'
                          CHECK (channel IN ('online', 'walkin')),
    num_rooms           INT NOT NULL DEFAULT 1 CHECK (num_rooms >= 1),
    guest_name          VARCHAR(128) NOT NULL,
    mobile              VARCHAR(20) NOT NULL,
    pax_men             INT NOT NULL DEFAULT 0,
    pax_women           INT NOT NULL DEFAULT 0,
    pax_children        INT NOT NULL DEFAULT 0,
    -- Per-booking Bhojanshala (dining hall) meal opt-in. Default TRUE: a guest
    -- is assumed to eat all three meals unless Reception unchecks one. The
    -- Bhojan head-count view only counts CHECKED-IN bookings, so these flags on
    -- pending/past rows are harmless. Male/Female/Kids split = pax_* columns.
    dine_breakfast      BOOLEAN NOT NULL DEFAULT true,
    dine_lunch          BOOLEAN NOT NULL DEFAULT true,
    dine_dinner         BOOLEAN NOT NULL DEFAULT true,
    checkin_date        DATE NOT NULL,
    checkout_date       DATE NOT NULL,
    sant_reference_name VARCHAR(128), -- required by the Customer Portal form, optional for walk-ins
    sant_reference_mobile VARCHAR(20),
    room_type_id        UUID NOT NULL REFERENCES room_types(id),
    room_id             UUID REFERENCES rooms(id),          -- assigned at check-in by reception
    id_document_url     TEXT,                                -- local /uploads/id-photos/... URL
    status              VARCHAR(20) NOT NULL DEFAULT 'pending'
                          CHECK (status IN ('pending','approved','rejected','modified','expired','checked_in','checked_out','cancelled')),
    billing_tier        VARCHAR(16) CHECK (billing_tier IN ('foc','discount','paid')),
    discount_percent    NUMERIC(5,2) DEFAULT 0,
    final_amount        NUMERIC(10,2),
    is_paid             BOOLEAN NOT NULL DEFAULT false,
    amount_paid         NUMERIC(10,2) NOT NULL DEFAULT 0,
    payment_status      VARCHAR(16) NOT NULL DEFAULT 'unpaid'
                          CHECK (payment_status IN ('unpaid','partial','paid')),
    ata_actual_arrival  TIMESTAMPTZ,                          -- Actual Time of Arrival
    actual_checkout_at  TIMESTAMPTZ,
    preferred_arrival_time   TIME,
    preferred_departure_time TIME,
    late_checkout_surcharge  NUMERIC(10,2) DEFAULT 0,
    extra_charges            JSONB DEFAULT '[]',
    created_by          UUID REFERENCES users(id),   -- staff member who created the booking (walk-ins); NULL for online/customer bookings
    approved_by         UUID REFERENCES users(id),
    approved_at         TIMESTAMPTZ,
    approval_note       TEXT, -- e.g. "Confirmed by Swami Ji via WhatsApp, 3:40pm" for walk-in phone approvals
    created_at          TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_at          TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_bookings_status_dates ON bookings (status, checkin_date, checkout_date);
CREATE INDEX idx_bookings_room_type ON bookings (room_type_id, status);
CREATE UNIQUE INDEX idx_bookings_booking_code ON bookings (booking_code);

-- ----------------------------------------------------------------------------
-- 6b. SYNC STATE + updated_at trigger (hybrid "online inbox + local master")
--     sync_state holds one cursor row per sync direction so the PC-side sync
--     worker resumes where it left off. The trigger keeps bookings.updated_at
--     truthful on every ordinary write; the sync worker sets baps.sync_write
--     = 'on' inside its own transaction so ITS writes preserve the source
--     row's updated_at (otherwise a pulled row would look freshly-changed and
--     echo straight back across the link). See migration 003 for the full note.
-- ----------------------------------------------------------------------------
CREATE TABLE sync_state (
    name       TEXT PRIMARY KEY,      -- 'pull_bookings' | 'push_bookings'
    cursor     TIMESTAMPTZ,           -- last source updated_at successfully applied
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

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

-- ----------------------------------------------------------------------------
-- 7. PAYMENTS — log of individual payment events per booking
-- ----------------------------------------------------------------------------
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

-- ----------------------------------------------------------------------------
-- 7b. BOOKING_ROOMS — junction for multi-room bookings.
--     A booking with num_rooms >= 2 occupies several physical rooms at once.
--     bookings.room_id is kept as the "primary" room (back-compat with history,
--     single-room reads); booking_rooms is the authoritative set of rooms a
--     CHECKED-IN booking currently holds. Rows are inserted at check-in and
--     deleted at checkout, so UNIQUE(room_id) guarantees a room is held by at
--     most one active booking at a time. The floor board joins through here.
-- ----------------------------------------------------------------------------
CREATE TABLE booking_rooms (
    booking_id  UUID NOT NULL REFERENCES bookings(id) ON DELETE CASCADE,
    room_id     UUID NOT NULL REFERENCES rooms(id)    ON DELETE CASCADE,
    assigned_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    PRIMARY KEY (booking_id, room_id),
    UNIQUE (room_id)
);
CREATE INDEX idx_booking_rooms_booking ON booking_rooms (booking_id);

-- ----------------------------------------------------------------------------
-- 8. AUDIT LOG (recommended, lightweight — tracks approvals/modifications)
-- ----------------------------------------------------------------------------
CREATE TABLE audit_log (
    id          UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    actor_id    UUID REFERENCES users(id),
    action      VARCHAR(64) NOT NULL,       -- e.g. 'booking.approved', 'room.status_changed'
    entity_type VARCHAR(64) NOT NULL,
    entity_id   UUID NOT NULL,
    metadata    JSONB,
    created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- 9. LUGGAGE COUNTER — LEGACY. Superseded by luggage_tokens (section 9b). Kept
--    only so older code / restored backups don't break; nothing reads it now.
--    The "bags in hall" figure is derived from open luggage_tokens instead.
-- ----------------------------------------------------------------------------
CREATE TABLE luggage_counter (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    count      INTEGER NOT NULL DEFAULT 0,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
    updated_by UUID REFERENCES users(id)
);
INSERT INTO luggage_counter (count) VALUES (0);

-- ----------------------------------------------------------------------------
-- 9b. LUGGAGE TOKENS — one row per bundle of bags a guest leaves in the hall.
--     A short human-readable token_code (LG-0001, LG-0002, ...) is printed and
--     handed to the guest at checkout as a security claim check; the luggage
--     hall reclaims the bags only against that code. Rows stay for history:
--     status flips 'open' -> 'collected' when the guest takes their bags back.
--     "Bags in hall" = SUM(bag_count) WHERE status = 'open'.
-- ----------------------------------------------------------------------------
CREATE SEQUENCE luggage_token_seq;

CREATE TABLE luggage_tokens (
    id           UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    token_code   VARCHAR(16) UNIQUE NOT NULL
                   DEFAULT ('LG-' || lpad(nextval('luggage_token_seq')::text, 4, '0')),
    booking_id   UUID REFERENCES bookings(id) ON DELETE SET NULL,  -- optional link to the stay
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
CREATE INDEX idx_luggage_tokens_status ON luggage_tokens (status);

-- ----------------------------------------------------------------------------
-- 10. NOTIFICATION SOUNDS — uploaded MP3 files for checkout alerts
-- ----------------------------------------------------------------------------
CREATE TABLE notification_sounds (
    id         UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    label      VARCHAR(100) NOT NULL,
    filename   VARCHAR(255) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
