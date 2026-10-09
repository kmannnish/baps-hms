/**
 * sync/cloudDb.js
 *
 * THE ONE DELIBERATE EXCEPTION to the single-shared-pool rule documented in
 * CLAUDE.md and backend/db.js. Everything else in the backend imports the one
 * shared pool from `../db`. This file is a *second* pool — but it points at a
 * DIFFERENT database (the always-on cloud "inbox/outbox", e.g. Neon), not a
 * second pool on the same local Postgres. The rule exists to stop ten pools
 * fighting over one database's connections; two databases legitimately need
 * two pools.
 *
 * It exists ONLY on the Reception PC's sync worker. It is created lazily and
 * only when CLOUD_DATABASE_URL is set:
 *   - CLOUD_DATABASE_URL unset  -> module exports `null`  -> the sync worker
 *     no-ops and the app runs exactly as the LAN-only build always has.
 *   - CLOUD_DATABASE_URL set    -> a small pool (max 3) to the cloud DB.
 *
 * SSL: managed providers (Neon) require it and their URLs carry
 * `?sslmode=require`, which turns SSL on automatically here — mirroring db.js.
 * A local second Postgres used for E2E testing has no SSL, so SSL stays off
 * for a plain localhost URL unless CLOUD_DB_SSL=true is set explicitly.
 */

const { Pool } = require('pg');

const url = process.env.CLOUD_DATABASE_URL;

const needsSsl =
  process.env.CLOUD_DB_SSL === 'true' ||
  (url && url.includes('sslmode=require'));

// Exported as `null` when no cloud DB is configured — callers check for this.
const cloudPool = url
  ? new Pool({
      connectionString: url,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
      max: 3, // tiny: one PC worker, 5–20 bookings/day
      idleTimeoutMillis: 30000,
      // Fail fast when the cloud is asleep/unreachable so the connectivity
      // guard in the worker can skip the cycle instead of hanging.
      connectionTimeoutMillis: 10000,
    })
  : null;

if (cloudPool) {
  // A pool 'error' event (e.g. an idle cloud connection dropped) must never be
  // allowed to bubble up as an uncaught exception — the worker treats the cloud
  // as best-effort. Log and move on; the next cycle reconnects.
  cloudPool.on('error', (err) => {
    console.error('[sync] cloud pool error (ignored, will retry):', err.message);
  });
}

module.exports = cloudPool;
