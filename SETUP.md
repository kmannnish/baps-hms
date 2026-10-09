# Setup Guide — Local Network Deployment

## 0. The architecture, in one paragraph

The Reception PC **is the server**. It runs the backend (Node + Postgres) permanently
during operating hours. Every other device — Swami Ji's phone, an Admin's laptop, a
guest's phone for the booking form — just opens a web browser and types that PC's address
on the WiFi network. Nothing needs installing on those other devices. In the **default
setup there's no cloud account of any kind** — no Firebase, no Google Maps, no Neon, no
Netlify. That's intentional: at 5–20 bookings/day, everything genuinely useful here works
over your own WiFi. Going online is an **optional** add-on — the "hybrid" mode in §7 — that
lets guests book and Swami Ji approve even while the PC is asleep; it stays off until you
deliberately turn it on, and turning it on changes nothing about how the LAN setup works.

Geofencing was removed for the same reason it's no longer needed: Reception only ever runs
on this one physical machine, so possession of the machine *is* the access control.

---

## 1. Folder structure

```
baps-hms/
├── backend/
│   ├── server.js               Express + Socket.io entrypoint, binds to 0.0.0.0
│   ├── db.js                   Single shared Postgres connection pool
│   ├── package.json
│   ├── Dockerfile
│   ├── uploads/
│   │   └── id-photos/          Guest ID photos land here — local disk, not cloud
│   ├── db/
│   │   ├── schema.sql
│   │   ├── seed.sql
│   │   ├── cloud-schema.sql    Cloud subset (§7) — only tables the public site needs
│   │   └── migrations/         Additive, idempotent upgrades for an existing DB
│   ├── middleware/
│   │   ├── requireAuth.js
│   │   └── requirePermission.js
│   ├── routes/
│   │   ├── auth.js             One plain login for all three roles
│   │   ├── bookings.js         Online + walk-in booking creation, approval
│   │   ├── rooms.js
│   │   ├── roles.js
│   │   ├── inventory.js
│   │   ├── settings.js
│   │   └── idUploads.js        QR + direct photo upload, saved to local disk
│   ├── sync/                   Hybrid sync worker (§7) — PC-only, no-op if unused
│   │   ├── cloudDb.js          Second pool → cloud DB (the one documented exception)
│   │   └── worker.js           Pull online bookings down, push availability up
│   └── utils/
│       └── whatsapp.js
│
├── frontend/
│   ├── package.json
│   ├── tailwind.config.js
│   ├── .env.example
│   ├── public/index.html
│   └── src/
│       ├── index.js
│       ├── App.jsx             Router: all 4 areas + one shared /login
│       ├── context/AuthContext.jsx
│       ├── portals/
│       │   ├── AdminPortal.jsx
│       │   ├── ReceptionPortal.jsx   Floor board + Walk-ins tabs
│       │   ├── SwamiPortal.jsx
│       │   └── CustomerPortal.jsx
│       └── components/
│           ├── RoleManager.jsx, InventoryManager.jsx
│           ├── FloorBoard.jsx, SwamiDashboard.jsx
│           ├── CustomerBookingForm.jsx, WalkInBookingPanel.jsx
│           ├── StaffLogin.jsx, ProtectedRoute.jsx
│           └── QRUploadTrigger.jsx, MobileIdCapture.jsx
│
├── docker-compose.yml           Postgres (auto-seeded) + backend, one command
└── .env.example
```

---

## 2. First run — on the Reception PC

```bash
cd baps-hms
cp .env.example .env        # fill in JWT_SECRET (see below for how to generate one)
docker compose up --build
```

Generate a `JWT_SECRET`:
```bash
node -e "console.log(require('crypto').randomBytes(64).toString('hex'))"
```

This starts Postgres (auto-loading `backend/db/schema.sql` then `seed.sql` on first run
only) and the backend on port 4000. Leave this terminal open — it's running your app.

Demo logins (all password `password123` — **change these before real use**, see §6):

| Role | Mobile |
|---|---|
| Admin | 9000000001 |
| Swami Ji | 9000000002 |
| Receptionist | 9000000003 |

In a **second** terminal:
```bash
cd frontend
npm install
cp .env.example .env
npm start
```

This opens at `http://localhost:3000` — confirm it works on the Reception PC itself before
moving to §3 (making it reachable from other devices).

---

## 3. Making it reachable from other devices on the WiFi

This is the part that turns "works on this one PC" into "works from anywhere on the
network" — three steps.

### 3.1 Find this PC's LAN IP address

Open Command Prompt on the Reception PC and run:
```
ipconfig
```
Look for **IPv4 Address** under your active WiFi adapter — something like `192.168.1.42`.
That's this PC's address on your local network.

### 3.2 Give it a fixed IP (DHCP reservation)

By default, your WiFi router can hand this PC a *different* IP after a restart, which would
break everyone's bookmarks. Fix the IP permanently:

1. Log into your router's admin page (usually `http://192.168.1.1` or `http://192.168.0.1`
   — check the sticker on the router itself for the exact address and login).
2. Find **DHCP Reservation** / **Static Lease** / **Address Reservation** (naming varies by
   router brand — look under LAN or DHCP settings).
3. Reserve the IP you found in §3.1 for this PC's MAC address (also shown in `ipconfig /all`
   as **Physical Address**).
4. Save and reboot the router if it asks.

### 3.3 Allow the app through Windows Firewall

Windows blocks other devices from reaching a server running on this PC by default:

1. Open **Windows Security** → **Firewall & network protection** → **Advanced settings**.
2. **Inbound Rules** → **New Rule** → **Port** → **TCP** → specific ports: `3000,4000` →
   **Allow the connection** → apply to all profiles → name it "BAPS HMS".
3. Repeat if you use a third-party firewall/antivirus with its own blocking.

### 3.4 Point the frontend at itself via LAN, not localhost

Edit `frontend/.env`:
```
HOST=0.0.0.0
REACT_APP_API_BASE_URL=http://192.168.1.42:4000
REACT_APP_SOCKET_URL=http://192.168.1.42:4000
```
(Replace `192.168.1.42` with your actual IP from §3.1.) Restart `npm start` after editing.

### 3.5 Test from another device

On a phone or laptop connected to the **same WiFi**, open a browser and go to
`http://192.168.1.42:3000`. You should see the Customer booking form. Try `/login` for the
staff portals.

---

## 4. How everything works without any cloud account

**Walk-in bookings + phone/WhatsApp approval**: Reception creates a walk-in booking
directly (Reception portal → Walk-ins tab → New walk-in). When Swami Ji gives a verbal or
WhatsApp decision, Reception clicks **Record decision** on that booking, picks the billing
tier, and optionally notes how it was communicated (e.g. "Confirmed via WhatsApp, 3:40pm").
No internet needed anywhere in this path.

**Online bookings**: a guest on the same WiFi (or, later, the internet — see §7) fills the
Customer form directly; it lands in Swami Ji's queue the normal way.

**ID photo capture (QR flow)**: Reception clicks **Upload ID**, which shows a QR code
encoding *this PC's own LAN address* (e.g. `http://192.168.1.42:3000/upload-id/<id>`). The
receptionist's phone — already on the same WiFi — scans it, takes the photo, and it uploads
straight to this PC's local disk at `backend/uploads/id-photos/`. The PC's screen updates
the instant it arrives, over the same Socket.io connection the rest of the app already
uses — no separate realtime service, no cloud storage account.

**Guests filling the Customer form on their own device** upload their ID the same way,
just directly (no QR needed since it's already their own device) — same local disk
destination.

---

## 5. Auto-starting on boot (optional, but recommended)

So reception doesn't need to open a terminal every morning:

1. Create a file `start-baps-hms.bat` in the `baps-hms` folder:
   ```bat
   @echo off
   cd /d "%~dp0"
   start "" docker compose up
   timeout /t 15
   start "" cmd /k "cd frontend && npm start"
   ```
2. Right-click it → **Create shortcut** → move the shortcut into:
   `C:\Users\PRAPTI\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Startup`
3. It'll now launch automatically whenever the Reception PC starts up. Docker Desktop
   itself also needs "Start Docker Desktop when you sign in" enabled in its own Settings →
   General, or the `.bat` file will fail since Docker won't be running yet.

---

## 6. Before real guests use this

Change every seeded password (`password123` for all three demo accounts):
```bash
cd backend
node -e "console.log(require('bcrypt').hashSync('YourNewPassword', 10))"
```
Then run, once per user, against the local database (`docker compose exec postgres psql -U
baps_admin -d baps_hms`, or any Postgres client pointed at `localhost:5432`):
```sql
UPDATE users SET password_hash = '<paste hash>' WHERE mobile = '9000000001';
```

---

## 7. Going online (hybrid: online inbox + local master) — OPTIONAL

This is the opt-in that lets **guests book and Swami Ji approve even while the Reception PC
is asleep**, without giving up the local system. It is genuinely optional: skip this whole
section and everything in §1–§6 works exactly the same. All three services below are **free
and need no credit card**.

**The shape of it.** Three small free services plus your PC:

| Piece | Free host | What it holds / does |
|---|---|---|
| Cloud database | **Neon** | A small "inbox/outbox": reference data + near-future bookings only |
| Cloud backend | **Render** | The *same* `backend/` code, run with `CLOUD_MODE=1` (safe routes only) |
| Public website | **Netlify** | The guest booking form + Swami approval page |
| Reception PC | (your PC) | Still the **complete master**; a sync worker mirrors to/from the cloud |

Your local Postgres stays the single source of truth. When the PC is online it **pulls**
online bookings + Swami's online approvals down, and **pushes** reference data + availability
up. When the PC is offline, guests and Swami keep using the cloud; the PC catches up the next
time it syncs. **ID photos are never uploaded online** — the public form only asks the guest
to carry a government ID, and Reception photographs it at check-in (§4), so no sensitive
image ever touches the cloud.

> **Accepted trade-off:** Render's free server sleeps after ~15 min idle, so the first
> visitor after a quiet spell waits ~30–60s for it to wake. Fine at this volume.

### 7.0 Prerequisite — bring the PC's database up to the hybrid schema

The hybrid needs three additive things on the PC's existing database (a `booking_code`
column, a `sync_state` table, and an `updated_at` trigger). They ship as an **idempotent**
migration — safe to run once or many times, and it does **not** wipe any data:

```bash
docker exec -i baps-hms-postgres-1 psql -U baps_admin -d baps_hms < backend/db/migrations/003_hybrid_sync.sql
```

(A brand-new install from `docker compose up --build` on an empty volume already has these
from `schema.sql` — this step is only for an existing Reception PC you must not wipe.)

### 7.1 Neon — the cloud database

1. Sign up at **neon.tech** (free tier, no card) and create a project (region closest to you).
2. Copy the **connection string** it gives you — it looks like
   `postgresql://user:pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require`. The
   `?sslmode=require` matters: the app turns SSL on automatically when it sees it.
3. Load the **cloud subset schema** into Neon (this creates only the tables the public site
   needs — no `rooms`, no `id-photos`, no luggage). Either paste `backend/db/cloud-schema.sql`
   into Neon's SQL Editor, or from any machine with `psql`:
   ```bash
   psql "postgresql://user:pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require" -f backend/db/cloud-schema.sql
   ```
   Don't seed any data here — the PC's first sync (§7.4) fills in room types, settings, and
   the Swami/Admin logins with the *same* IDs as the PC, so approvals line up across both.

### 7.2 Render — the always-on cloud backend

1. Sign up at **render.com** (free tier, no card). New → **Web Service** → connect this repo
   (or upload it). Set **Root Directory** to `backend`.
2. **Build command** `npm install` · **Start command** `node server.js`. (Render provides the
   `PORT` itself; the app already reads `process.env.PORT`.)
3. Add these **environment variables**:

   | Key | Value |
   |---|---|
   | `DATABASE_URL` | your Neon string from §7.1 (with `?sslmode=require`) |
   | `CLOUD_MODE` | `1` |
   | `BOOKING_ORIGIN` | `O` |
   | `JWT_SECRET` | any long random string (need **not** match the PC — tokens are per-server) |
   | `CORS_ORIGIN` | `*` for now; tighten to your Netlify domain in §7.3 |

   Do **not** set `CLOUD_DATABASE_URL` here — the cloud never runs the sync worker.
4. Deploy. When it's live, note the URL (e.g. `https://baps-hms-cloud.onrender.com`) and open
   `https://<that-url>/health` — it should return `{"ok":true,"mode":"cloud"}`.

### 7.3 Netlify — the public guest + Swami website

1. Edit `frontend/.env.production` (already in the repo) and set **both** URLs to your Render
   URL from §7.2:
   ```
   REACT_APP_API_BASE_URL=https://baps-hms-cloud.onrender.com
   REACT_APP_SOCKET_URL=https://baps-hms-cloud.onrender.com
   ```
2. Sign up at **netlify.com** (free, no card). New site → connect the repo. Set **Base
   directory** `frontend`, **Build command** `npm run build`, **Publish directory**
   `frontend/build`. (CRA reads `.env.production` automatically for `npm run build`, so the
   public bundle points at Render while the PC keeps using `frontend/.env` with its LAN IP.)
3. Deploy, then copy your Netlify domain (e.g. `https://baps-jaipur.netlify.app`).
4. Go **back to Render** and set `CORS_ORIGIN` to exactly that Netlify domain (no trailing
   slash), then let Render redeploy. This locks the public backend to your site only.

### 7.4 The Reception PC — turn sync on

1. In the PC's **backend `.env`**, set:
   ```
   CLOUD_DATABASE_URL=postgresql://user:pass@ep-xxxx.region.aws.neon.tech/neondb?sslmode=require
   BOOKING_ORIGIN=W
   ```
   (`BOOKING_ORIGIN=W` is already the default — it marks PC-minted codes as walk-ins so they
   can never collide with the cloud's `O` codes.)
2. Restart the backend (`docker compose up -d --build`, or restart `node server.js`). On
   startup you'll see `[sync] hybrid sync worker enabled` in the log, and within a minute
   `[sync] pulled=… pushed=…`.
3. **This first sync is what makes cloud login work** (the chicken-and-egg): it pushes the
   Swami/Admin users, roles, permissions, room types and settings up to Neon with the same
   IDs the PC uses. Only after it runs can Swami Ji log in on the Netlify site.

### 7.5 Test the round trip

1. On a phone/laptop **off the venue WiFi** (e.g. on mobile data), open your Netlify site and
   submit a guest booking → it saves to Neon with a code like `BAPS-O-260929-01`, status
   *pending*.
2. Log in as Swami Ji on the same site and approve it.
3. Back on the Reception PC, wait for the next sync (≤1 min): the approved booking now appears
   in the local master (History / Calendar) with the same code and decision. Walk-ins created
   on the PC likewise show up in the cloud's availability within a minute.

### 7.6 Before you expose the staff login publicly

- **Change the demo passwords first** (§6) — the Swami/Admin logins become reachable from the
  internet the moment §7.4 runs. This is the single most important step.
- The cloud backend mounts **only** the safe routes (`/auth`, `/bookings`, `/inventory`,
  `/settings`); `/rooms`, `/roles`, `/id-uploads` and `/reports` stay PC-only.
- `CORS_ORIGIN` on Render must be your Netlify domain (§7.3), not `*`.

Compared to the LAN setup this is more moving parts (three accounts, a handful of environment
variables), but each service is free and the PC remains the authority — if all three cloud
services vanished tomorrow, the Reception PC would keep working exactly as it does today.

---

## 8. What's actually been verified vs. what hasn't

Tested for real during this build, not just written:
- `backend/db/schema.sql` and `seed.sql` loaded into a real Postgres 16 instance without error
- The full walk-in flow — create booking (no Sant reference) → appears in pending →
  Reception records a phone approval with a note → billing calculated correctly (base price
  + GST) → disappears from pending — run end-to-end against a live server and confirmed
  correct at every step
- The complete ID upload pipeline — session creation → real multipart file upload → file
  landing correctly on disk → static file serving — run end-to-end and confirmed
- Login for all three roles, permission checks, and the shared connection pool (`db.js`)
  tested against real Postgres
- Every backend file passes `node --check`; every frontend file's syntax and imports
  verified with esbuild after the whole restructure

Not yet tested: the frontend has never been run in an actual browser, and the LAN
reachability steps in §3 (firewall rule, DHCP reservation) depend on your specific router
and Windows setup, which I can't test from here — the usual first-attempt snag is a firewall
rule not quite matching or the router's DHCP reservation UI being named something slightly
different than described above.
