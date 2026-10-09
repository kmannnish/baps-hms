-- ============================================================================
-- seed.sql — sample data to get a fresh install running end-to-end.
-- Run after schema.sql. Passwords below are all "password123" (bcrypt, cost 10)
-- — change them immediately in any non-local environment.
-- ============================================================================

-- ----------------------------------------------------------------------------
-- Roles — no geofence flag needed anymore: Reception only ever runs on the
-- one front-desk PC, so physical access to that machine is the security
-- boundary, not location.
-- ----------------------------------------------------------------------------
INSERT INTO roles (id, name, description, is_system) VALUES
    ('00000000-0000-0000-0000-000000000001', 'Admin',        'Full system configuration access', true),
    ('00000000-0000-0000-0000-000000000002', 'Swami Ji',     'Booking approvals', true),
    ('00000000-0000-0000-0000-000000000003', 'Receptionist', 'Front-desk operations: walk-ins, check-in/out, payments', true);

-- ----------------------------------------------------------------------------
-- Grant every permission to Admin. Swami Ji gets approval powers (including
-- can_approve_online_bookings, the authoritative approval of guest-submitted
-- online bookings). Reception gets day-to-day desk operations AND booking
-- approval/billing — this lets Reception record a phone/WhatsApp approval from
-- Swami Ji directly for walk-in guests, without Swami Ji needing to be on the
-- same network. Reception deliberately does NOT get can_approve_online_bookings:
-- it may approve an online booking only when the admin turns on the
-- reception_approve_on_behalf setting (with a mandatory "approved on behalf"
-- note). can_modify_bookings lets Reception edit an upcoming booking's
-- dates/details (early check-in, date change). can_view_reports lets Reception
-- open the guest "View ID" popup, the Current Guests list, and the History tab
-- (all read GET /bookings/:id, /history and /reports/stats).
-- ----------------------------------------------------------------------------
INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000001', id FROM permissions;

INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000002', id FROM permissions
WHERE key IN ('can_approve_bookings', 'can_approve_online_bookings', 'can_modify_bookings', 'can_set_billing_tier', 'can_view_reports');

INSERT INTO role_permissions (role_id, permission_id)
SELECT '00000000-0000-0000-0000-000000000003', id FROM permissions
WHERE key IN ('can_checkin_checkout', 'can_mark_payment', 'can_create_bookings',
              'can_approve_bookings', 'can_modify_bookings', 'can_set_billing_tier', 'can_view_reports',
              'can_manage_luggage', 'can_cancel_bookings');

-- ----------------------------------------------------------------------------
-- Demo users — mobile / password123 for each
-- ----------------------------------------------------------------------------
-- Verified bcrypt hash of "password123" (cost 10). Regenerate your own with:
--   node -e "console.log(require('bcrypt').hashSync('password123', 10))"
INSERT INTO users (id, full_name, mobile, password_hash, role_id) VALUES
    ('10000000-0000-0000-0000-000000000001', 'Admin User',       '9000000001', '$2b$10$ZAXWNCJPqm1YEs9..tXxdu1W63pRXRpGUcgrRndBdaFd5l1lmfJd6', '00000000-0000-0000-0000-000000000001'),
    ('10000000-0000-0000-0000-000000000002', 'Swami Ji',         '9000000002', '$2b$10$ZAXWNCJPqm1YEs9..tXxdu1W63pRXRpGUcgrRndBdaFd5l1lmfJd6', '00000000-0000-0000-0000-000000000002'),
    ('10000000-0000-0000-0000-000000000003', 'Reception Desk 1', '9000000003', '$2b$10$ZAXWNCJPqm1YEs9..tXxdu1W63pRXRpGUcgrRndBdaFd5l1lmfJd6', '00000000-0000-0000-0000-000000000003');

-- ----------------------------------------------------------------------------
-- Floors
-- ----------------------------------------------------------------------------
INSERT INTO floors (id, name, sort_order) VALUES
    ('20000000-0000-0000-0000-000000000001', 'Ground Floor', 0),
    ('20000000-0000-0000-0000-000000000002', 'First Floor',  1);

-- ----------------------------------------------------------------------------
-- Room types + inventory caps (matches the example in the spec: 15 AC, 11 Non-AC, 4 Dorm)
-- ----------------------------------------------------------------------------
INSERT INTO room_types (id, name, base_price, capacity_cap) VALUES
    ('30000000-0000-0000-0000-000000000001', 'AC',        1500, 15),
    ('30000000-0000-0000-0000-000000000002', 'Non-AC',    900,  11),
    ('30000000-0000-0000-0000-000000000003', 'Dormitory', 400,  4);

-- ----------------------------------------------------------------------------
-- A handful of sample rooms across both floors
-- ----------------------------------------------------------------------------
INSERT INTO rooms (floor_id, room_type_id, room_number, status) VALUES
    ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'G-101', 'ready'),
    ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000001', 'G-102', 'occupied'),
    ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000002', 'G-103', 'ready'),
    ('20000000-0000-0000-0000-000000000001', '30000000-0000-0000-0000-000000000003', 'G-104', 'ready'),
    ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000001', 'F-201', 'ready'),
    ('20000000-0000-0000-0000-000000000002', '30000000-0000-0000-0000-000000000002', 'F-202', 'ready');

-- Additional settings for new features
INSERT INTO settings (key, value) VALUES
    ('notification_checkout_warning_minutes', '30'),
    ('notification_sound_id',               'null'),
    ('late_checkout_rate_per_hour',          '200'),
    ('extra_bed_rate',                       '300')
ON CONFLICT (key) DO NOTHING;
