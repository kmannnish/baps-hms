# BAPS Jaipur Utara Management System

A hospitality management system for guest accommodation at BAPS Jaipur Utara — bookings,
room management, check-in/out, tiered billing (FOC/Discount/Paid), staff roles, and walk-in
guest handling with phone/WhatsApp approval.

**→ See `SETUP.md` for the full setup walkthrough** — folder structure, running it on the
Reception PC, making it reachable from other devices on your WiFi, and what's actually been
tested versus what hasn't.

## Design at a glance

- **Runs entirely on the Reception PC, on your local network.** No cloud accounts, no
  monthly hosting cost. Any device on the same WiFi (Swami Ji's phone, an Admin's laptop)
  reaches it through a browser — nothing to install on those devices.
- **No geofencing.** Reception only ever runs on this one physical machine, so possession of
  it is the access control — there's no location check on login.
- **No Firebase, no Google Maps.** ID photos go straight to local disk
  (`backend/uploads/id-photos/`); the QR-to-phone upload flow uses the app's own Socket.io
  connection instead of a cloud realtime database.
- **Two ways a booking gets created**: online (Customer Portal, approved by Swami Ji in the
  cloud dashboard) or walk-in (Reception creates it directly, then records Swami Ji's
  phone/WhatsApp decision themselves — Reception is granted approval permission for exactly
  this).
- **Everything role- and permission-driven**, not hardcoded: Admin creates roles and toggles
  permissions from a UI; "Swami Ji" is just a role name with certain permissions checked; no
  role or price is baked into application code.
- **Going online later is a deferred, separate phase** — not attempted in this build. See
  §7 of `SETUP.md`.

## Stack

- **Backend**: Node.js, Express, Socket.io, PostgreSQL, multer (local file uploads)
- **Frontend**: React, Tailwind, Lucide icons
- **Local dev/run**: Docker Compose (Postgres + backend), `npm start` for the frontend

## Quick start

```bash
cp .env.example .env        # fill in JWT_SECRET
docker compose up --build   # backend + Postgres, auto-seeded on first run
cd frontend && npm install && cp .env.example .env && npm start
```

Demo logins (all password `password123` — change before real use, see `SETUP.md` §6):

| Role | Mobile |
|---|---|
| Admin | 9000000001 |
| Swami Ji | 9000000002 |
| Receptionist | 9000000003 |

Full detail — including making this reachable from other devices on your WiFi, the
auto-start setup, and an honest list of what's been tested versus not — is in `SETUP.md`.
