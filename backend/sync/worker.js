/**
 * sync/worker.js
 *
 * The Reception PC's hybrid sync worker. It reconciles two databases:
 *   - the LOCAL Postgres (the complete MASTER — this app's `../db` pool), and
 *   - the CLOUD "inbox/outbox" (Neon, via ./cloudDb) that backs the public
 *     guest booking form + Swami Ji approvals while the PC is asleep.
 *
 * It runs ONLY on the PC (never in CLOUD_MODE) and ONLY when CLOUD_DATABASE_URL
 * is set. When it is unset, ./cloudDb exports null and start() no-ops, so the
 * LAN-only deployment is byte-for-byte unchanged.
 *
 * ─────────────────────────────────────────────────────────────────────────
 * FIELD OWNERSHIP (the rule that makes two-way sync safe — one writer/field):
 *   • Guest-entered fields (name, mobile, pax, dates, room_type, preferred
 *     times, booking_code): owned by whoever CREATED the row — the cloud for
 *     online bookings, the PC for walk-ins. Never contested.
 *   • Decision fields (status, billing_tier, discount_percent, final_amount,
 *     approved_by, approved_at, approval_note): owned by the DECIDER. The only
 *     possible clash is the same booking decided on BOTH sides in one offline
 *     window -> latest approved_at wins, and a `sync.conflict` audit row is
 *     written for Reception to eyeball.
 *   • Operational fields (room_id, booking_rooms, id_document_url, payments,
 *     amount_paid, payment_status, is_paid, ata_actual_arrival,
 *     actual_checkout_at, late/extra charges): PC-ONLY. A PULL never writes
 *     them, and check-in/checkout status transitions (checked_in/checked_out)
 *     happen only on the PC, so a PULL never drags a local booking back out of
 *     an operational state.
 *
 * ECHO PREVENTION: bookings carry a BEFORE UPDATE trigger that bumps
 * updated_at = now() on every ordinary write. This worker sets
 * `SET LOCAL baps.sync_write = 'on'` inside its own transactions and writes the
 * SOURCE row's updated_at verbatim, so a row it copies keeps the source's
 * timestamp instead of looking freshly-changed. With strict `updated_at >
 * cursor` watermarks on both directions, the loop reaches a fixed point after
 * at most one redundant (identical) copy. See migration 003 for the trigger.
 * ─────────────────────────────────────────────────────────────────────────
 */

const localPool = require('../db');
const cloudPool = require('./cloudDb');

const PULL_CURSOR = 'pull_bookings';
const PUSH_CURSOR = 'push_bookings';
const INTERVAL_MS = Number(process.env.SYNC_INTERVAL_MS || 60000);

// node-pg returns DATE columns as a JS Date at the process's LOCAL midnight.
// Re-bind them as 'YYYY-MM-DD' strings built from local components so a stay's
// calendar day round-trips exactly (a bare Date -> ISO would shift a day in any
// timezone behind UTC, e.g. IST). Same reasoning as the /extend handler.
const toDateStr = (v) => {
  if (v == null) return null;
  const d = v instanceof Date ? v : new Date(v);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

// The 26-column booking projection shared by the local INSERT (pull, new row)
// and the cloud UPSERT (push). Order matters — it maps 1:1 to $1..$26 below.
// Operational fields and id_document_url are deliberately absent (see header).
function fullParams(b) {
  return [
    b.id,                         // $1
    b.booking_code,               // $2
    b.channel,                    // $3
    b.num_rooms,                  // $4
    b.guest_name,                 // $5
    b.mobile,                     // $6
    b.pax_men,                    // $7
    b.pax_women,                  // $8
    b.pax_children,               // $9
    toDateStr(b.checkin_date),    // $10
    toDateStr(b.checkout_date),   // $11
    b.sant_reference_name,        // $12
    b.sant_reference_mobile,      // $13
    b.room_type_id,               // $14
    b.status,                     // $15
    b.billing_tier,               // $16
    b.discount_percent,           // $17
    b.final_amount,               // $18
    b.created_by,                 // $19
    b.approved_by,                // $20
    b.approved_at,                // $21
    b.approval_note,              // $22
    b.preferred_arrival_time,     // $23
    b.preferred_departure_time,   // $24
    b.created_at,                 // $25
    b.updated_at,                 // $26
  ];
}

const FULL_COLS = `
  (id, booking_code, channel, num_rooms, guest_name, mobile,
   pax_men, pax_women, pax_children, checkin_date, checkout_date,
   sant_reference_name, sant_reference_mobile, room_type_id, status,
   billing_tier, discount_percent, final_amount, created_by, approved_by,
   approved_at, approval_note, preferred_arrival_time, preferred_departure_time,
   created_at, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23,$24,$25,$26)`;

// Columns updated on an existing row. channel / created_by / created_at are
// immutable (set once by the creator) and are omitted on purpose.
const CONFLICT_UPDATE_SET = `
  booking_code = EXCLUDED.booking_code, num_rooms = EXCLUDED.num_rooms,
  guest_name = EXCLUDED.guest_name, mobile = EXCLUDED.mobile,
  pax_men = EXCLUDED.pax_men, pax_women = EXCLUDED.pax_women,
  pax_children = EXCLUDED.pax_children, checkin_date = EXCLUDED.checkin_date,
  checkout_date = EXCLUDED.checkout_date,
  sant_reference_name = EXCLUDED.sant_reference_name,
  sant_reference_mobile = EXCLUDED.sant_reference_mobile,
  room_type_id = EXCLUDED.room_type_id, status = EXCLUDED.status,
  billing_tier = EXCLUDED.billing_tier, discount_percent = EXCLUDED.discount_percent,
  final_amount = EXCLUDED.final_amount, approved_by = EXCLUDED.approved_by,
  approved_at = EXCLUDED.approved_at, approval_note = EXCLUDED.approval_note,
  preferred_arrival_time = EXCLUDED.preferred_arrival_time,
  preferred_departure_time = EXCLUDED.preferred_departure_time,
  updated_at = EXCLUDED.updated_at`;

// The PULL update path (an online booking already present locally, whose guest
// or decision fields changed on the cloud). It must NOT touch operational or
// immutable columns, so it can't reuse FULL_COLS. Its own contiguous $1..$23
// numbering matters: Postgres cannot infer the type of a bound parameter that
// never appears in the SQL text, so re-using fullParams (which leaves $3/$19/$25
// — channel/created_by/created_at — unreferenced) fails with "could not
// determine data type of parameter $3". Keep updateParams() 1:1 with the SET.
function updateParams(b) {
  return [
    b.id,                        // $1  (WHERE id)
    b.booking_code,              // $2
    b.num_rooms,                 // $3
    b.guest_name,                // $4
    b.mobile,                    // $5
    b.pax_men,                   // $6
    b.pax_women,                 // $7
    b.pax_children,              // $8
    toDateStr(b.checkin_date),   // $9
    toDateStr(b.checkout_date),  // $10
    b.sant_reference_name,       // $11
    b.sant_reference_mobile,     // $12
    b.room_type_id,              // $13
    b.status,                    // $14
    b.billing_tier,              // $15
    b.discount_percent,          // $16
    b.final_amount,              // $17
    b.approved_by,               // $18
    b.approved_at,               // $19
    b.approval_note,             // $20
    b.preferred_arrival_time,    // $21
    b.preferred_departure_time,  // $22
    b.updated_at,                // $23
  ];
}

const PULL_UPDATE_SQL = `
  UPDATE bookings SET
    booking_code=$2, num_rooms=$3, guest_name=$4, mobile=$5,
    pax_men=$6, pax_women=$7, pax_children=$8, checkin_date=$9, checkout_date=$10,
    sant_reference_name=$11, sant_reference_mobile=$12, room_type_id=$13,
    status=$14, billing_tier=$15, discount_percent=$16, final_amount=$17,
    approved_by=$18, approved_at=$19, approval_note=$20,
    preferred_arrival_time=$21, preferred_departure_time=$22, updated_at=$23
  WHERE id=$1`;

// ---------------------------------------------------------------------------
// PULL: cloud -> local. Bring in guest bookings created online and Swami's
// online decisions. Writes ONLY guest + decision fields; never operational.
// ---------------------------------------------------------------------------
async function pull() {
  // Read the cursor as TEXT and compare with $1::timestamptz so the watermark
  // keeps full microsecond precision. node-pg parses timestamptz into a JS Date
  // (millisecond precision); round-tripping the cursor through a Date truncates
  // sub-millisecond digits, so a row updated at .309102 stays strictly greater
  // than a cursor stored as .309 and gets re-pulled every cycle forever.
  const { rows: curRows } = await localPool.query(
    `SELECT cursor::text AS cursor FROM sync_state WHERE name = $1`, [PULL_CURSOR]
  );
  const cursor = curRows[0]?.cursor ?? '1970-01-01 00:00:00+00';

  const { rows: cloudRows } = await cloudPool.query(
    `SELECT *, updated_at::text AS updated_at_text
       FROM bookings WHERE updated_at > $1::timestamptz ORDER BY updated_at ASC`, [cursor]
  );
  if (!cloudRows.length) return { pulled: 0, conflicts: 0 };

  const client = await localPool.connect();
  let pulled = 0;
  let conflicts = 0;
  try {
    await client.query('BEGIN');
    // Preserve each source row's updated_at instead of bumping it (echo guard).
    await client.query(`SET LOCAL baps.sync_write = 'on'`);

    let maxUpdatedText = cursor;
    for (const c of cloudRows) {
      // rows are ORDER BY updated_at ASC, so the running watermark is simply the
      // latest row seen — applied OR skipped, both advance the cursor so a
      // skipped row is not re-examined next cycle.
      maxUpdatedText = c.updated_at_text;

      const { rows: lrows } = await client.query(
        `SELECT status, approved_at FROM bookings WHERE id = $1`, [c.id]
      );
      const local = lrows[0];

      // New online booking -> insert. ON CONFLICT DO NOTHING guards the (tiny)
      // race where a row appeared between the SELECT and the INSERT.
      if (!local) {
        await client.query(
          `INSERT INTO bookings ${FULL_COLS} ON CONFLICT (id) DO NOTHING`,
          fullParams(c)
        );
        pulled++;
        continue;
      }

      // Operational truth is the PC's: never revert a local check-in/out.
      if (local.status === 'checked_in' || local.status === 'checked_out') continue;

      // Never un-decide a locally-decided booking with a stale cloud 'pending'.
      if (c.status === 'pending' && local.approved_at) continue;

      // Both sides decided the same booking in one offline window -> latest
      // approved_at wins. If the LOCAL decision is newer, keep it and record a
      // conflict for Reception; otherwise the cloud decision applies below.
      if (local.approved_at && c.approved_at &&
          new Date(local.approved_at) > new Date(c.approved_at)) {
        conflicts++;
        await client.query(
          `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
           VALUES (NULL, 'sync.conflict', 'booking', $1, $2)`,
          [c.id, JSON.stringify({
            resolution: 'local_wins',
            localStatus: local.status, cloudStatus: c.status,
            localApprovedAt: local.approved_at, cloudApprovedAt: c.approved_at,
          })]
        );
        continue;
      }

      // Cloud wins (or local not yet decided): apply guest + decision fields
      // only (never operational/immutable columns — see PULL_UPDATE_SQL).
      await client.query(PULL_UPDATE_SQL, updateParams(c));
      pulled++;
    }

    await client.query(
      `INSERT INTO sync_state (name, cursor, updated_at) VALUES ($1,$2::timestamptz,now())
       ON CONFLICT (name) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
      [PULL_CURSOR, maxUpdatedText]
    );
    await client.query('COMMIT');
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
  return { pulled, conflicts };
}

// ---------------------------------------------------------------------------
// PUSH: local -> cloud. (a) Mirror the small reference tables so the cloud can
// authenticate Swami and price/approve with the same data the PC uses; (b) push
// near-future, capacity-relevant bookings (incl. walk-ins) so cloud
// availability stays honest.
// ---------------------------------------------------------------------------
async function push() {
  // Cursor as TEXT + $1::timestamptz comparison — same microsecond-precision
  // reasoning as pull(); a Date-truncated watermark would re-push every row
  // every cycle.
  const { rows: curRows } = await localPool.query(
    `SELECT cursor::text AS cursor FROM sync_state WHERE name = $1`, [PUSH_CURSOR]
  );
  const cursor = curRows[0]?.cursor ?? '1970-01-01 00:00:00+00';

  // Reference snapshot (small tables — mirrored in full every cycle). FK-safe
  // read order isn't required here; the WRITE order below is.
  const [perms, roles, rolePerms, users, settings, roomTypes] = await Promise.all([
    localPool.query(`SELECT id, key, label, description, category, created_at FROM permissions`),
    localPool.query(`SELECT id, name, description, is_system, created_at FROM roles`),
    localPool.query(`SELECT role_id, permission_id FROM role_permissions`),
    localPool.query(`SELECT id, full_name, mobile, email, password_hash, role_id, is_active, created_at, updated_at FROM users`),
    localPool.query(`SELECT key, value, updated_by, updated_at FROM settings`),
    localPool.query(`SELECT id, name, base_price, capacity_cap FROM room_types`),
  ]);

  const { rows: localBookings } = await localPool.query(
    `SELECT *, updated_at::text AS updated_at_text
       FROM bookings WHERE updated_at > $1::timestamptz ORDER BY updated_at ASC`, [cursor]
  );

  const cloud = await cloudPool.connect();
  let pushed = 0;
  let maxUpdatedText = cursor;
  try {
    await cloud.query('BEGIN');
    await cloud.query(`SET LOCAL baps.sync_write = 'on'`);

    // (a) Reference data, in FK order: permissions -> roles -> role_permissions
    // -> users -> settings -> room_types. Same UUIDs as the PC so every
    // role_permissions / approved_by / created_by FK lines up across both DBs.
    for (const p of perms.rows) {
      await cloud.query(
        `INSERT INTO permissions (id, key, label, description, category, created_at)
         VALUES ($1,$2,$3,$4,$5,$6)
         ON CONFLICT (id) DO UPDATE SET
           key=EXCLUDED.key, label=EXCLUDED.label,
           description=EXCLUDED.description, category=EXCLUDED.category`,
        [p.id, p.key, p.label, p.description, p.category, p.created_at]
      );
    }
    for (const r of roles.rows) {
      await cloud.query(
        `INSERT INTO roles (id, name, description, is_system, created_at)
         VALUES ($1,$2,$3,$4,$5)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, description=EXCLUDED.description, is_system=EXCLUDED.is_system`,
        [r.id, r.name, r.description, r.is_system, r.created_at]
      );
    }
    // role_permissions is a pure link set: replace it wholesale so a permission
    // REVOKED on the PC is also revoked online (data-driven permissions must
    // stay faithful — the app never hardcodes roles).
    await cloud.query(`DELETE FROM role_permissions`);
    for (const rp of rolePerms.rows) {
      await cloud.query(
        `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1,$2)
         ON CONFLICT DO NOTHING`,
        [rp.role_id, rp.permission_id]
      );
    }
    for (const u of users.rows) {
      await cloud.query(
        `INSERT INTO users (id, full_name, mobile, email, password_hash, role_id, is_active, created_at, updated_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
         ON CONFLICT (id) DO UPDATE SET
           full_name=EXCLUDED.full_name, mobile=EXCLUDED.mobile, email=EXCLUDED.email,
           password_hash=EXCLUDED.password_hash, role_id=EXCLUDED.role_id,
           is_active=EXCLUDED.is_active, updated_at=EXCLUDED.updated_at`,
        [u.id, u.full_name, u.mobile, u.email, u.password_hash, u.role_id, u.is_active, u.created_at, u.updated_at]
      );
    }
    for (const s of settings.rows) {
      // settings.value is JSONB. node-pg parses it into a JS value on read, so
      // we must re-serialize with JSON.stringify + cast $2::jsonb on write:
      // a JS string ("14:00") bound raw would reach Postgres as the bare text
      // 14:00 and fail "invalid input syntax for type json", and a JSON-null
      // value (JS null) would hit the NOT NULL constraint. Stringify makes every
      // type ("14:00" -> "\"14:00\"", null -> "null", objects -> {...}) valid.
      await cloud.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1,$2::jsonb,$3,$4)
         ON CONFLICT (key) DO UPDATE SET
           value=EXCLUDED.value, updated_by=EXCLUDED.updated_by, updated_at=EXCLUDED.updated_at`,
        [s.key, JSON.stringify(s.value), s.updated_by, s.updated_at]
      );
    }
    for (const rt of roomTypes.rows) {
      await cloud.query(
        `INSERT INTO room_types (id, name, base_price, capacity_cap)
         VALUES ($1,$2,$3,$4)
         ON CONFLICT (id) DO UPDATE SET
           name=EXCLUDED.name, base_price=EXCLUDED.base_price, capacity_cap=EXCLUDED.capacity_cap`,
        [rt.id, rt.name, rt.base_price, rt.capacity_cap]
      );
    }

    // (b) Bookings — only those still current/future matter to cloud
    // availability. Old bookings are skipped but still advance the cursor so
    // their churn doesn't re-examine forever.
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    for (const b of localBookings) {
      // ASC order → running watermark is the latest row seen; advance it even
      // for skipped (past) bookings so their churn isn't re-examined forever.
      maxUpdatedText = b.updated_at_text;
      if (b.checkout_date && new Date(b.checkout_date) < today) continue;
      await cloud.query(
        `INSERT INTO bookings ${FULL_COLS}
         ON CONFLICT (id) DO UPDATE SET ${CONFLICT_UPDATE_SET}`,
        fullParams(b)
      );
      pushed++;
    }

    await cloud.query('COMMIT');
  } catch (e) {
    await cloud.query('ROLLBACK');
    throw e;
  } finally {
    cloud.release();
  }

  // Advance the local watermark only after the cloud transaction committed. If
  // this write fails after the commit, next cycle re-pushes idempotently.
  await localPool.query(
    `INSERT INTO sync_state (name, cursor, updated_at) VALUES ($1,$2::timestamptz,now())
     ON CONFLICT (name) DO UPDATE SET cursor = EXCLUDED.cursor, updated_at = now()`,
    [PUSH_CURSOR, maxUpdatedText]
  );
  return { pushed };
}

// ---------------------------------------------------------------------------
// One full cycle. Never throws — the process-level crash net in server.js is a
// net, not a crutch, and a flaky cloud link must not take the front desk down.
// ---------------------------------------------------------------------------
let running = false;
async function runSyncCycle() {
  if (!cloudPool) return; // CLOUD_DATABASE_URL unset -> disabled
  if (running) return;    // don't overlap a slow cycle with the next tick
  running = true;
  try {
    // Connectivity guard: a sleeping/unreachable cloud skips the cycle quietly.
    try {
      await cloudPool.query('SELECT 1');
    } catch (e) {
      console.warn('[sync] cloud unreachable, skipping cycle:', e.message);
      return;
    }
    const pu = await pull();
    const ps = await push();
    if (pu.pulled || pu.conflicts || ps.pushed) {
      console.log(`[sync] pulled=${pu.pulled} conflicts=${pu.conflicts} pushed=${ps.pushed}`);
    }
  } catch (e) {
    console.error('[sync] cycle error (will retry next interval):', e.message);
  } finally {
    running = false;
  }
}

// ---------------------------------------------------------------------------
// start() — called from server.js. No-ops cleanly on the cloud (CLOUD_MODE)
// and on a LAN-only PC (no CLOUD_DATABASE_URL), so both those deployments are
// unchanged by the mere presence of this module.
// ---------------------------------------------------------------------------
function start() {
  if (process.env.CLOUD_MODE === '1' || process.env.CLOUD_MODE === 'true') return;
  if (!cloudPool) {
    console.log('[sync] CLOUD_DATABASE_URL not set — hybrid sync disabled (LAN-only).');
    return;
  }
  console.log(`[sync] hybrid sync worker enabled (every ${INTERVAL_MS} ms).`);
  // First run shortly after boot (let the HTTP server bind first), then on the
  // interval. Both swallow errors via runSyncCycle's own try/catch.
  setTimeout(() => { runSyncCycle(); }, 5000);
  setInterval(() => { runSyncCycle(); }, INTERVAL_MS);
}

module.exports = { start, runSyncCycle, pull, push };
