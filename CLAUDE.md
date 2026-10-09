# CLAUDE.md — Project Memory & Handoff

This file exists so Claude Code has full context picking up this project. Read this
entirely before making changes — several design decisions look like they could be
"simplified" but exist for specific reasons explained below.

## What this is

BAPS Jaipur Utara Management System — hospitality management for guest accommodation at
a religious organization's guest house. Four roles: Admin, Swami Ji (approver),
Receptionist, Customer (public, no login).

**Hard constraints from the person building this** (a non-developer, learning as they go):
- **Zero monthly budget.** Not "cheap" — zero. This ruled out Railway (paid after trial),
  and is why the architecture is LAN-only rather than cloud-hosted.
- **Very low traffic**: 5–20 bookings/day. This justifies architectural simplicity over
  scalability everywhere — no need for caching, queues, horizontal scaling, etc.
- **Runs on one physical Reception PC**, reachable by other devices (Swami Ji's phone,
  Admin's laptop) over the venue's own WiFi. Not the public internet. "Going online" is an
  explicitly deferred future phase — do not add cloud dependencies without being asked.

## Architecture decisions and why (read before "fixing" these)

- **No geofencing.** Earlier versions had GPS-based login restriction for Reception. This
  was **deliberately removed** once the design became "Reception only runs on one PC" —
  physical possession of that PC is the access control. Don't re-add location checks.
- **No Firebase, no Google Maps.** Originally used Firebase Realtime DB + Storage for a
  QR-based ID-upload flow, and Google Maps for the geofence picker. Both removed. ID
  photos now save straight to local disk (`backend/uploads/id-photos/`), and the QR flow's
  "realtime" piece reuses the app's own Socket.io connection instead of a cloud database.
  Do not reintroduce Firebase/Maps unless the person explicitly asks to go online.
- **Single shared DB pool** (`backend/db.js`). Early versions had ~10 files each doing
  `new Pool()`. Consolidated into one shared pool because multiple pools waste connections
  and would exhaust a free-tier DB's connection limit if this ever moves to managed
  Postgres. All routes import `require('../db')`, never instantiate their own Pool.
- **`fetchArray`/`fetchObject` helpers** (`frontend/src/lib/api.js`). **Important bug class
  to avoid reintroducing**: several components used to do
  `setState(await res.json())` and then `.map()` over that state, assuming the response was
  always an array. When the backend returns an error object instead (expired token,
  permission denied, a schema mismatch after an update), `.map()` crashes the whole page.
  `fetchArray`/`fetchObject` always resolve to a safe value ([] or a fallback object) and
  log the real error to console. **Any new fetch-then-render code should use these
  helpers**, not raw `fetch().then(r => r.json())`.
- **Tax is a toggle, not assumed-on.** `settings.tax_enabled` (boolean) + `settings.gst_percent`.
  Every billing calculation (`/bookings/:id/decide`, `/bookings/:id/billing`) checks
  `tax_enabled` before applying GST. Admin edits both from Content & Messages tab.
- **Permissions are fully data-driven, never hardcoded.** Roles are rows in `roles`,
  permissions are rows in `permissions`, and `role_permissions` links them. "Swami Ji" is
  just a role name with certain permissions checked — nothing in code special-cases it.
  When adding a new capability, add a permission row + check it with `requirePermission()`,
  don't check `role.name === 'X'` anywhere.
- **Booking `channel`**: `'online'` (Customer Portal) vs `'walkin'` (Reception-created).
  Walk-ins get approved by Reception itself recording Swami Ji's phone/WhatsApp decision
  (Reception is granted `can_approve_bookings` + `can_set_billing_tier` for exactly this) —
  not by Swami Ji needing to be online/reachable.
- **Multi-room bookings use a `booking_rooms` junction** (added after the initial build).
  A booking can have `num_rooms >= 2` and physically occupy several rooms at once.
  `bookings.room_id` is kept as the **primary** room (back-compat with single-room history
  reads); `booking_rooms` is the authoritative set of rooms a **checked-in** booking holds.
  Rows are inserted at check-in and deleted at checkout, and `UNIQUE(room_id)` guarantees a
  room is held by at most one active booking. **Don't "simplify" this back to a single
  `room_id`** — the floor board, `/available`, check-in, checkout and the capacity-based
  vacancy checks all read through this junction. The vacancy check on approve (`/decide`)
  and on `/extend` is **capacity-based** — it sums `num_rooms` over overlapping
  approved/checked-in bookings of the type, because counting physical `room_id`s
  under-counts a multi-room booking (which stores only one primary `room_id`).
- **Process-level crash safety net** in `server.js` (`unhandledRejection`/`uncaughtException`
  handlers). An unhandled error in one async route handler used to crash the **entire
  server**, kicking every user off. This is a safety net, not a fix — routes still don't
  have per-handler try/catch. A good follow-up task is wrapping every async route handler
  properly, but it hasn't been done yet (would touch ~40 handlers across 8 route files).

## Tech stack

- **Backend**: Node.js, Express, Socket.io, PostgreSQL, `pg`, `bcrypt`, `jsonwebtoken`, `multer`, `dotenv`
- **Frontend**: React (Create React App, not Vite), Tailwind CSS, `react-router-dom`,
  `socket.io-client`, `qrcode`, `lucide-react`
- **Local run**: Docker Compose (Postgres + backend), `npm start` for frontend (separate,
  not containerized)

## Folder structure

```
baps-hms/
├── backend/
│   ├── server.js              Express + Socket.io entrypoint, binds 0.0.0.0
│   ├── db.js                  Single shared Postgres pool (DATABASE_URL or PG* vars)
│   ├── package.json
│   ├── Dockerfile
│   ├── uploads/id-photos/     Local ID photo storage (gitkeep'd, not committed content)
│   ├── db/
│   │   ├── schema.sql         Source of truth; auto-runs ONLY on an empty volume
│   │   ├── seed.sql
│   │   └── migrations/        Idempotent .sql to bring an EXISTING volume up to schema.sql
│   │       └── 001_multiroom_and_extend.sql   Adds booking_rooms + backfills checked-in rooms
│   ├── middleware/
│   │   ├── requireAuth.js         JWT verify -> req.user {id, roleId}
│   │   └── requirePermission.js   DB join: users->roles->role_permissions->permissions
│   ├── routes/
│   │   ├── auth.js            One login endpoint, all 3 roles, no geofence
│   │   ├── bookings.js        Create (online/walkin), decide (capacity-checked), multi-room
│   │   │                      checkin/checkout, extend (stay +N nights), billing, checkout-
│   │   │                      charges, history, approved-unassigned, availability
│   │   ├── rooms.js           Floor board (joins through booking_rooms; incl. pax + billing +
│   │   │                      bed_count + has_bathroom), available-rooms-for-checkin, status,
│   │   │                      luggage counter
│   │   ├── roles.js           Role/permission CRUD (+ user CRUD)
│   │   ├── inventory.js       Floors, room types, rooms CRUD (bed_count, has_bathroom)
│   │   ├── settings.js        GST/tax/T&C/WhatsApp templates/checkin-checkout defaults
│   │   ├── reports.js         Occupancy + revenue (today/7d/30d/custom) + monthly trend
│   │   └── idUploads.js       Session-based QR upload + direct upload, saves to local disk
│   └── utils/
│       ├── whatsapp.js        Template interpolation + wa.me link builder
│       ├── billing.js         Single source of truth for billing math (nightsBetween,
│       │                      getTaxSettings, calculateFinalAmount) — used by decide/billing/extend
│       └── asyncHandler.js    Wraps async route handlers so rejections hit the error handler
│
├── frontend/
│   ├── package.json (CRA — react-scripts)
│   ├── tailwind.config.js     font-serif mapped to Lora
│   ├── .env.example           HOST=0.0.0.0 + REACT_APP_API_BASE_URL/SOCKET_URL
│   ├── public/index.html
│   └── src/
│       ├── index.js, index.css, App.jsx (router, one shared /login for all roles)
│       ├── context/AuthContext.jsx    JWT in localStorage, shared Socket.io connection
│       ├── lib/api.js                 fetchArray/fetchObject safe-fetch helpers
│       ├── portals/
│       │   ├── AdminPortal.jsx        Tabs: Reports, Roles, Inventory, Content&Messages
│       │   ├── SwamiPortal.jsx        Tabs: Pending queue, Income&Occupancy (Reports)
│       │   ├── ReceptionPortal.jsx    Tabs: Floor board, Check-ins, Walk-ins, Current guests,
│       │   │                          History, Calendar. Multi-room check-in + extend-stay wired.
│       │   └── CustomerPortal.jsx     Public booking form
│       └── components/
│           ├── RoleManager.jsx, InventoryManager.jsx (has "add floor" now)
│           ├── HistoryReports.jsx     Shared by Admin+Swami: occupancy/revenue/trend/history table
│           ├── ContentSettings.jsx    Admin: T&C text, WhatsApp templates, tax toggle+%
│           ├── FloorBoard.jsx, SwamiDashboard.jsx, CustomerBookingForm.jsx
│           ├── WalkInBookingPanel.jsx Walk-in create (validated) + phone-approval recording;
│           │                          DecisionModal picks the room(s) at approval (multi-room aware)
│           ├── QRUploadTrigger.jsx    PC side: shows QR, listens on socket for completion
│           ├── MobileIdCapture.jsx    Phone side: opened by scanning QR, uploads photo
│           ├── StaffLogin.jsx, ProtectedRoute.jsx
│           ├── GuestDetailModal.jsx   "View ID" popup — wired into ReceptionPortal
│           └── CurrentGuestsList.jsx  Flat table of occupied rooms — wired into ReceptionPortal
│
├── docker-compose.yml          Postgres (auto-seeded) + backend
├── .env.example                Backend env (CORS_ORIGIN=* for LAN trust)
└── SETUP.md                    Full LAN setup walkthrough (read this for deployment)
```

## Database

Demo users (all password `password123` — **must be changed before real guests use this**,
see `SETUP.md` §6):

| Role | Mobile |
|---|---|
| Admin | 9000000001 |
| Swami Ji | 9000000002 |
| Receptionist | 9000000003 |

Key tables: `users`, `roles`, `permissions`, `role_permissions`, `floors`, `room_types`
(`base_price`, `capacity_cap`), `rooms` (`bed_count`, `has_bathroom`, status CHECK is now
`ready`/`occupied`/`maintenance` only), `bookings` (has `channel`, `num_rooms`,
`approval_note`, `late_checkout_surcharge`, `extra_charges` JSONB, `preferred_arrival_time`/
`preferred_departure_time`, `created_by`/`approved_by` columns — added after the initial
build), `booking_rooms` (multi-room junction — see architecture note above), `payments`,
`settings`, `luggage_counter`, `notification_sounds`, `audit_log` (written to on
approve/reject/billing-edit/checkin/checkout/extend, but **nothing reads it yet** — the
History tab reads the `bookings` table directly; an audit-trail viewer is unfinished work).

**Schema changes — two paths:**
- **Fresh install**: `docker compose down -v` (destroys the volume) then `up --build`. The
  auto-seed (schema.sql + seed.sql) only runs on an **empty** volume, so this is the only
  way schema.sql edits reach a from-scratch DB.
- **Existing volume (the live Reception PC — do NOT wipe its data)**: apply an **additive,
  idempotent** migration instead, e.g.
  `docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/001_multiroom_and_extend.sql`.
  Keep migration files idempotent (`IF NOT EXISTS`, guarded inserts) so they're safe to
  re-run, and mirror the same change into `schema.sql` so fresh installs stay in sync.

## Current state — what's done and what's next

**Done and validated** (multi-room + extend work, verified end-to-end against the live
Docker stack — see the validation methodology below):

- **Multi-room bookings** — `booking_rooms` junction (migration 001). Check-in accepts
  `{ roomIds: [...] }` (or legacy `{ roomId }`), validates the count equals `num_rooms`, all
  rooms `ready`; checkout/bulk-checkout free every held room via the junction; the floor
  board and `/rooms/available` read through it. The approve (`/decide`) and `/extend`
  vacancy checks are capacity-based (sum `num_rooms` over overlapping bookings of the type).
- **Room pickers show attached-bathroom** — both `CheckinModal` (ReceptionPortal) and
  `DecisionModal` (WalkInBookingPanel) list ready rooms with a bathroom badge + bed count,
  radio for single-room / capped checkboxes for multi-room, with an "X of N selected" counter.
- **"Approve & check in" in one step** — `DecisionModal` has a "check in now" toggle that
  fetches ready rooms and, on approve, calls `/decide` then `/checkin` so Reception doesn't
  need a second trip to the Check-ins tab for a guest standing at the desk.
- **`GuestDetailModal` + `CurrentGuestsList`** — wired into ReceptionPortal (Current guests
  tab, "View ID" from the floor-board room modal and the awaiting-checkin list).
- **Reception "Send confirmation" WhatsApp** — in the awaiting-checkin list, builds a wa.me
  link from the admin's `approved` template (same template Swami Ji's panel uses).
- **Extend stay** — `POST /bookings/:id/extend { nights }` (requires `can_checkin_checkout`).
  Refuses if not checked in (409 `NOT_CHECKED_IN`) or the type is full across the new
  night(s) (409 `NO_VACANCY_FOR_EXTENSION`); otherwise advances `checkout_date`, recomputes
  the room charge for the new total nights (preserving prior late/extra charges), audits
  `booking.extended`, returns `{ booking, extensionCharge, newCheckout, nights }`. Wired into
  `RoomActionModal`'s occupied-room branch (nights input + result/error message).
  E2E-verified: money math (one extra paid night == one-night final, GST-inclusive), the
  allow path, the deny path, and that a denied extend leaves the booking untouched.

**Genuine remaining gaps from the big feature request** (not yet built):

- **Luggage per-guest TOKEN** — today `luggage_counter` is a single global count (+1/−1) with
  `can_manage_luggage`. The request wants a security **token** issued per guest at checkout
  and a luggage-hall view of open tokens + bag counts. Needs an additive `luggage_tokens`
  table (token no., booking/guest, bag count, open/collected, timestamps) + endpoints + UI.
- **Admin Report & History showing future-month bookings** — `HistoryReports` filters by
  check-in date range; confirm/extend it so an admin can pull up next month's approved
  bookings (Reception already has a monthly `ReceptionCalendar`).
- **Checkout reminder lifecycle** — `server.js` emits `checkout:warning`/`checkout:overdue`
  and a morning summary over Socket.io, and admin can upload MP3s (`notification_sounds`).
  The day-before "remind guest" + extend-or-deny prompt and the staged orange/red escalation
  described in the request are only partially represented; review against that list if asked.

**Unresolved question for the person** (unchanged): whether the LAN setup in `SETUP.md` §3
is done (fixed IP, `frontend/.env` at the LAN IP, accessing Reception via that IP not
`localhost`). The QR upload encodes `window.location.origin`; on `localhost:3000` the QR
encodes a `localhost` URL a phone can't reach. A setup step, not a code bug.

## Chronological bug log (context for why some code looks defensive)

- Pax fields (`pax_men` etc.) could crash booking creation with a NOT NULL violation if
  omitted from the request — fixed by defaulting to 0 server-side in `bookings.js`.
- An unhandled async error in any route crashed the **entire Node process** — added
  `process.on('unhandledRejection'/'uncaughtException')` handlers in `server.js`.
- `// eslint-disable-next-line react-hooks/exhaustive-deps` crashed the CRA build entirely
  ("rule not found") because that specific plugin isn't registered in this exact dependency
  set — fixed by using a bare `/* eslint-disable-next-line */` instead (present elsewhere
  in the codebase already, which is why only one file had this problem).
- `awaitingCheckin.map is not a function` — a stale/expired JWT caused the backend to
  return `{error: "INVALID_OR_EXPIRED_TOKEN"}`, and the frontend fed that straight into
  `.map()` without checking. Root-caused and fixed by introducing `lib/api.js`'s
  `fetchArray`/`fetchObject`, applied across every list-rendering fetch call in the app
  (8 files). If you add new data-fetching code, use these helpers.
- Walk-in booking form used to fail silently (no validation message) if required fields
  were missing — fixed with proper error state + display in `WalkInBookingPanel.jsx`.

## Validation methodology used throughout this project — please keep this up

This project has been built with a genuine test-before-ship discipline, not just "looks
right." Whoever continues this should keep doing the same:

1. **Every backend file change**: `node --check path/to/file.js` before considering it done.
2. **Every SQL change**: validate with `pglast` (`pip install pglast`,
   `pglast.parse_sql(sql)`) — catches syntax errors without needing a live DB.
3. **Every frontend file change**: `esbuild --bundle --packages=external --loader:.js=jsx
   --outfile=/dev/null` on the changed file — catches syntax errors AND unresolved imports
   (critical after any file-move/rename).
4. **For non-trivial backend logic** (billing math, new endpoints, schema changes): spin up
   a **real local Postgres 16** instance, load `schema.sql` + `seed.sql`, start the actual
   `node server.js`, and hit it with real `curl` requests end-to-end. This has caught
   several real bugs that code review alone would have missed (the pax NOT NULL crash, for
   instance). Don't skip this step for anything touching money calculations or state
   transitions (booking status, room status).
5. Clean up test databases (`DROP DATABASE`/`DROP USER`) after each test run.
6. Only rebuild the delivery zip and hand it over after validation passes.

Environment note: this development sandbox has intermittent `node_modules` loss between
tool calls (a sandbox quirk, not a project issue) — if a test suddenly fails with
`Cannot find module 'X'`, it's almost always `cd backend && npm install` needed again, not
a real regression. Don't chase phantom bugs from this.

## Known unfinished / good next tasks beyond the immediate wiring above

- Per-route try/catch (see "process-level crash safety net" above) — the safety net
  prevents full outages but individual bad requests may still hang instead of returning a
  clean error.
- `audit_log` table exists and is written to on approve/reject/billing-edit, but nothing
  reads it. Could become a proper audit trail UI if wanted (separate from the booking
  History tab, which reads `bookings` directly).
- The "check in now" flow described above (fold room assignment into walk-in approval).
- Consider whether `WalkInBookingPanel`'s pending list also needs a "View ID" action once
  `GuestDetailModal` is wired up elsewhere.
