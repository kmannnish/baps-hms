/**
 * server.js
 *
 * Entrypoint. Wires Express routes, Socket.io real-time rooms (per-role and
 * per-user, so 'role:swami' / 'role:admin' / 'user:<id>' can be targeted
 * directly from route handlers), static serving of locally-stored ID
 * photos, and a scheduled job that flags bookings entering their overstay
 * warning window.
 *
 * LAN deployment: this server is meant to run on the Reception PC and be
 * reachable by any device on the same WiFi network. It listens on
 * 0.0.0.0 (all network interfaces) rather than just localhost — see
 * SETUP.md for finding the PC's LAN IP, setting a DHCP reservation so that
 * IP doesn't change, and allowing it through Windows Firewall.
 */

// Loads variables from a local .env file into process.env when running
// with `npm run dev` outside Docker. In Docker Compose, real env vars are
// injected directly into the process, so this call is a harmless no-op
// there — but without it, a local .env file would silently never be read.
require('dotenv').config();

// Without this, an unexpected error in any single async route handler
// (a bad request, a DB hiccup) crashes the ENTIRE server process — kicking
// every logged-in user off at once, not just the one bad request. This is
// a safety net, not a substitute for proper error handling in each route;
// it just stops one mistake from taking the whole front desk offline.
process.on('unhandledRejection', (err) => {
  console.error('Unhandled rejection (server stayed up):', err);
});
process.on('uncaughtException', (err) => {
  console.error('Uncaught exception (server stayed up):', err);
});

const express = require('express');
const http = require('http');
const path = require('path');
const fs = require('fs');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const { Server } = require('socket.io');
const jwt = require('jsonwebtoken');

// On a trusted local network, '*' (accept requests from any device on the
// LAN) is a reasonable default. If you later expose this beyond your own
// network, set CORS_ORIGIN to the real frontend URL instead.
const CORS_ORIGIN = process.env.CORS_ORIGIN || '*';

// CLOUD_MODE=1 turns this same codebase into the always-on cloud backend
// (Render) that serves the public guest form + Swami approvals while the PC is
// asleep. It mounts only the safe routers, and never runs the PC-only sync
// worker or the checkout notifier. Unset (the default) = the Reception PC.
const CLOUD_MODE = process.env.CLOUD_MODE === '1' || process.env.CLOUD_MODE === 'true';

const authRoutes = require('./routes/auth');
const bookingsRoutes = require('./routes/bookings');
const roomsRoutes = require('./routes/rooms');
const rolesRoutes = require('./routes/roles');
const inventoryRoutes = require('./routes/inventory');
const settingsRoutes = require('./routes/settings');
const idUploadsRoutes = require('./routes/idUploads');
const reportsRoutes = require('./routes/reports');
const bhojanRoutes = require('./routes/bhojan');
const backupRoutes = require('./routes/backup');
const { errorHandler } = require('./middleware/errorHandler');
const syncWorker = require('./sync/worker');
const { runDailyReportIfDue } = require('./mailer/dailyReport');
const { runBhojanReportIfDue } = require('./mailer/bhojanReport');
const { runBackupIfDue } = require('./utils/backupScheduler');

const pool = require('./db');
const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

// Serves locally-stored ID photos at http://<host>/uploads/id-photos/<file>
// Serves notification sounds at http://<host>/uploads/sounds/<file>
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));

const server = http.createServer(app);
const io = new Server(server, { cors: { origin: CORS_ORIGIN } });

// ---------------------------------------------------------------------------
// Socket.io: authenticate the connection, then join role + user rooms so
// route handlers can target `io.to('role:swami')` or `io.to('user:<id>')`.
// ---------------------------------------------------------------------------
io.use((socket, next) => {
  try {
    const token = socket.handshake.auth?.token;
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    socket.userId = decoded.userId;
    socket.roleId = decoded.roleId;
    next();
  } catch (err) {
    next(new Error('SOCKET_AUTH_FAILED'));
  }
});

io.on('connection', async (socket) => {
  socket.join(`user:${socket.userId}`);

  const { rows } = await pool.query(`SELECT name FROM roles WHERE id = $1`, [socket.roleId]);
  const roleName = rows[0]?.name?.toLowerCase().replace(/\s+/g, '_');
  if (roleName) socket.join(`role:${roleName}`);

  if (roleName === 'receptionist') {
    sendMorningSummary(socket).catch(() => {});
  }

  socket.on('disconnect', () => {
    // no-op — rooms are cleaned up automatically by Socket.io
  });
});

// ---------------------------------------------------------------------------
// Routes
//
// Two deployment modes from ONE codebase:
//   • Local (Reception PC, the default): mount everything.
//   • Cloud (Render, CLOUD_MODE=1): mount ONLY the routers the public site
//     needs — /auth (Swami/Admin login), /bookings (guest create + Swami
//     approve + availability), /inventory (room-type list for the form) and
//     /settings (T&C + WhatsApp templates). /rooms, /id-uploads, /roles and
//     /reports stay PC-only: they touch physical inventory, local-disk ID
//     photos, role admin, or reports that need the complete master data.
//     CORS_ORIGIN is locked to the Netlify domain via env on Render.
// ---------------------------------------------------------------------------
// Rate limiting for the internet-facing endpoints (the app is reachable over a
// Cloudflare Tunnel in the online setup). Keyed by the real client IP —
// Cloudflare passes it as CF-Connecting-IP; on the LAN we fall back to req.ip.
// Authenticated staff requests (which carry a Bearer token) are never limited,
// so the front desk is never throttled — only unauthenticated/public traffic.
const clientKey = (req) => req.headers['cf-connecting-ip'] || req.ip;
const authLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 20, // login attempts per IP / 10 min — slows password guessing
  keyGenerator: clientKey,
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});
// Only the PUBLIC booking submission (an unauthenticated POST /bookings) is
// rate-limited — NEVER the GET reads every page needs to render (room types,
// settings, lists), and never signed-in staff. This stops bots spamming fake
// bookings without ever throttling a normal page load.
const publicWriteLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  max: 30, // public booking submissions per IP / 10 min
  keyGenerator: clientKey,
  skip: (req) => req.method !== 'POST' || Boolean(req.headers.authorization),
  standardHeaders: true,
  legacyHeaders: false,
  validate: false,
});

app.use('/auth', authLimiter, authRoutes);
app.use('/bookings', publicWriteLimiter, bookingsRoutes(io));
app.use('/inventory', inventoryRoutes(io));
app.use('/settings', settingsRoutes);

if (!CLOUD_MODE) {
  app.use('/rooms', roomsRoutes(io));
  app.use('/roles', rolesRoutes());
  app.use('/id-uploads', idUploadsRoutes(io));
  app.use('/reports', reportsRoutes());
  // Bhojanshala dining counts read physical check-in state (booking_rooms) and
  // drive a Reception-desk panel, so they're PC-only like /rooms and /reports.
  app.use('/bhojan', bhojanRoutes);
  // Local DB backup & restore — dumps the PC's own Postgres to a mounted folder.
  // PC-only: the cloud backend has no business backing up the local database.
  app.use('/backup', backupRoutes);
}

app.get('/health', (req, res) => res.json({ ok: true, mode: CLOUD_MODE ? 'cloud' : 'local' }));

// ---------------------------------------------------------------------------
// Serve the built React frontend from this same server, so the whole app is
// ONE origin and ONE `docker compose up` (open http://<pc>:4000 — no separate
// `npm start`). The Docker build drops the production build into /app/public
// (see backend/Dockerfile). In local dev the React dev server runs separately
// on :3000 and this folder won't exist, so this block is skipped there.
// It MUST stay after every API route above, so the SPA fallback below never
// shadows an endpoint.
// ---------------------------------------------------------------------------
const FRONTEND_DIR = process.env.FRONTEND_BUILD_DIR || path.join(__dirname, 'public');
if (fs.existsSync(path.join(FRONTEND_DIR, 'index.html'))) {
  app.use(express.static(FRONTEND_DIR));
  // Any other GET (a React Router path like /admin or /reception) returns the
  // SPA shell; the browser-side router then renders the right screen. API 404s
  // are rare GETs and simply get the shell too, which is harmless.
  app.get('*', (req, res) => res.sendFile(path.join(FRONTEND_DIR, 'index.html')));
  console.log(`Serving frontend from ${FRONTEND_DIR}`);
}

app.use(errorHandler);

// ---------------------------------------------------------------------------
// Scheduled job: flag bookings approaching or past their checkout time
// Emits checkout:warning (≤warningMinutes away) and checkout:overdue (past).
// A per-booking state map prevents repeated emissions for the same booking.
// ---------------------------------------------------------------------------
const checkoutNotifyState = new Map(); // bookingId → 'warning' | 'overdue'

async function runCheckoutNotifier() {
  const { rows: settingRows } = await pool.query(
    `SELECT key, value FROM settings WHERE key IN ('default_checkout_time', 'notification_checkout_warning_minutes')`
  );
  const map = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
  const checkoutTime = map.default_checkout_time ?? '11:00';
  const warningMinutes = Number(map.notification_checkout_warning_minutes ?? 30);

  const { rows: bookings } = await pool.query(
    `SELECT b.id, b.guest_name, r.room_number
     FROM bookings b
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.status = 'checked_in' AND b.checkout_date = CURRENT_DATE`
  );

  const now = new Date();
  for (const b of bookings) {
    const checkoutAt = new Date(
      `${now.toISOString().slice(0, 10)}T${checkoutTime}:00`
    );
    const diffMs = checkoutAt - now;
    const diffMin = diffMs / 60000;

    const prevState = checkoutNotifyState.get(b.id);
    if (diffMin < 0) {
      if (prevState !== 'overdue') {
        checkoutNotifyState.set(b.id, 'overdue');
        io.to('role:receptionist').emit('checkout:overdue', {
          bookingId: b.id,
          guestName: b.guest_name,
          room: b.room_number,
          minutesPast: Math.round(-diffMin),
        });
      }
    } else if (diffMin <= warningMinutes) {
      if (!prevState) {
        checkoutNotifyState.set(b.id, 'warning');
        io.to('role:receptionist').emit('checkout:warning', {
          bookingId: b.id,
          guestName: b.guest_name,
          room: b.room_number,
          minutesRemaining: Math.round(diffMin),
        });
      }
    }
  }

  // Prune state for bookings no longer in the active list
  const activeIds = new Set(bookings.map((b) => b.id));
  for (const id of checkoutNotifyState.keys()) {
    if (!activeIds.has(id)) checkoutNotifyState.delete(id);
  }
}

// The checkout notifier is a Reception-desk concern and reads physical rooms,
// so it only runs on the PC. The cloud (CLOUD_MODE) has no rooms and no
// receptionist connected, so it would only spin uselessly.
if (!CLOUD_MODE) {
  setInterval(() => {
    runCheckoutNotifier().catch((err) => console.error('checkoutNotifier failed:', err));
  }, 60 * 1000); // every minute

  // Daily email report (opt-in): fires once per day at the admin-set time, but
  // only when SMTP_* is present in this PC's .env. Self-gating and wrapped so it
  // can never throw. PC-only for the same reason as the checkout notifier — the
  // cloud has no master data to report on.
  setInterval(() => {
    runDailyReportIfDue(pool).catch((err) => console.error('dailyReport tick failed:', err));
  }, 60 * 1000); // every minute

  // Daily Bhojanshala head-count email (opt-in, same gating as the daily
  // report: enabled flag + SMTP in .env + recipient set + past the set time +
  // not already sent today). Wrapped so it can never throw into the interval.
  setInterval(() => {
    runBhojanReportIfDue(pool).catch((err) => console.error('bhojanReport tick failed:', err));
  }, 60 * 1000); // every minute

  // Automatic local DB backups (opt-in): once past the admin-set time, writes
  // whichever of daily/weekly/monthly are enabled and due, each overwriting its
  // own slot file so storage stays bounded. Self-gating and wrapped so it can
  // never throw. PC-only — the cloud has no local database to dump.
  setInterval(() => {
    runBackupIfDue(pool).catch((err) => console.error('backup tick failed:', err));
  }, 60 * 1000); // every minute
}

// Morning summary: send to any receptionist who connects
async function sendMorningSummary(socket) {
  const { rows } = await pool.query(
    `SELECT b.id, b.guest_name, r.room_number
     FROM bookings b
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.status = 'checked_in' AND b.checkout_date = CURRENT_DATE`
  );
  if (rows.length) socket.emit('checkout:morning_summary', { checkouts: rows });
}

const PORT = process.env.PORT || 4000;
// Explicitly bind to 0.0.0.0 so other devices on the same WiFi network can
// reach this server, not just the Reception PC itself.
server.listen(PORT, '0.0.0.0', () => console.log(`BAPS HMS backend listening on :${PORT}`));

// Start the hybrid sync worker. It self-gates: a no-op in CLOUD_MODE and when
// CLOUD_DATABASE_URL is unset (LAN-only), so this line is safe in every
// deployment and changes nothing about the existing LAN-only behaviour.
syncWorker.start();
