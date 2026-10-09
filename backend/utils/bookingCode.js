/**
 * utils/bookingCode.js
 *
 * Mints the human-readable stay code shown to guests and staff:
 *
 *     BAPS-<origin>-YYMMDD-NN
 *
 * where <origin> is a single letter owned by the database that mints it:
 *   O = online   (the public Customer Portal, minted on the CLOUD backend)
 *   W = walk-in  (the Reception desk, minted on the LOCAL/PC backend)
 * and NN is a per-origin, per-day serial (01, 02, ...).
 *
 * Why the origin letter matters for the hybrid sync: the public form only ever
 * runs against the cloud (origin O) and walk-ins only ever run against the PC
 * (origin W), so O-serials and W-serials are minted by different databases and
 * can NEVER collide when the two databases sync into one another. The row's
 * UUID stays the real primary key and the sync join key — this code is purely a
 * friendly label. `bookings.booking_code` carries a UNIQUE index as a backstop.
 *
 * The date is formatted from LOCAL components (not toISOString()) so the YYMMDD
 * matches the calendar day on the machine that mints it — the same reason the
 * /extend handler reads dates back from local parts.
 */

// 'O' (online/cloud) unless the environment says otherwise; the PC sets
// BOOKING_ORIGIN=W. Anything other than a single A–Z letter falls back to 'W'
// so a misconfigured env can't produce a malformed code.
function resolveOrigin(explicit) {
  const raw = String(explicit ?? process.env.BOOKING_ORIGIN ?? 'W').trim().toUpperCase();
  return /^[A-Z]$/.test(raw) ? raw : 'W';
}

function yymmdd(date) {
  const d = date instanceof Date ? date : new Date();
  const yy = String(d.getFullYear()).slice(-2);
  const mm = String(d.getMonth() + 1).padStart(2, '0');
  const dd = String(d.getDate()).padStart(2, '0');
  return `${yy}${mm}${dd}`;
}

/**
 * makeBookingCode(pool, origin?, date?) -> Promise<string>
 * Computes the next serial for today's <origin> prefix by counting existing
 * codes with that prefix. Idempotent to read; the UNIQUE index guards the
 * (vanishingly unlikely, at 5–20 bookings/day) same-millisecond race.
 */
async function makeBookingCode(pool, origin, date) {
  const org = resolveOrigin(origin);
  const day = yymmdd(date);
  const prefix = `BAPS-${org}-${day}-`;
  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS n FROM bookings WHERE booking_code LIKE $1`,
    [`${prefix}%`]
  );
  const serial = (rows[0]?.n ?? 0) + 1;
  return `${prefix}${String(serial).padStart(2, '0')}`;
}

module.exports = { makeBookingCode, resolveOrigin };
