/**
 * db.js
 *
 * Single shared Postgres connection pool for the whole backend. Every route
 * and middleware file imports this instead of creating its own `new Pool()`
 * — ten separate pools each opening their own connections was wasteful
 * locally and would exhaust a free-tier database's connection limit
 * (e.g. Neon's free tier) in production.
 *
 * Two ways to configure it:
 *   - DATABASE_URL set (a full connection string, e.g. from Neon) — used
 *     as-is, with SSL enabled automatically since Neon requires it.
 *   - DATABASE_URL not set — falls back to discrete PGHOST/PGPORT/
 *     PGDATABASE/PGUSER/PGPASSWORD env vars, which is what local Docker
 *     Compose uses (no SSL needed for a local container).
 */

const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

// Neon (and most managed Postgres providers) require SSL. Force it on
// whenever a connection string is used, or when explicitly requested via
// DB_SSL=true for a discrete-vars setup that also needs SSL.
const needsSsl =
  process.env.DB_SSL === 'true' ||
  (connectionString && connectionString.includes('sslmode=require'));

const pool = connectionString
  ? new Pool({
      connectionString,
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
    })
  : new Pool({
      ssl: needsSsl ? { rejectUnauthorized: false } : false,
    });

module.exports = pool;
