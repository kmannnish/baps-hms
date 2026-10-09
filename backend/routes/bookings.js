/**
 * routes/bookings.js
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission, userHasPermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');
const { nightsBetween, getTaxSettings, calculateFinalAmount, calculateBillBreakdown } = require('../utils/billing');
const { buildWhatsAppLink } = require('../utils/whatsapp');
const { makeBookingCode } = require('../utils/bookingCode');
const { buildReceiptPdf } = require('../pdf/receipt');
const { getOccupancyCalendar } = require('../utils/occupancy');

const pool = require('../db');

// JSONB settings booleans come back as real booleans, but a defensive coerce
// keeps the gate honest if a value was ever stored as "true"/"1" text.
function truthy(v) {
  return v === true || v === 1 || v === 'true' || v === '1';
}

module.exports = function (io) {
  const router = express.Router();

  // GET /bookings/availability?roomTypeId=&checkin=&checkout=&numRooms=
  router.get('/availability', asyncHandler(async (req, res) => {
    const { roomTypeId, checkin, checkout } = req.query;
    const numRooms = Number(req.query.numRooms ?? 1);

    const { rows: capRows } = await pool.query(
      `SELECT capacity_cap FROM room_types WHERE id = $1`,
      [roomTypeId]
    );
    const cap = capRows[0]?.capacity_cap ?? 0;

    const { rows: countRows } = await pool.query(
      `SELECT COALESCE(SUM(num_rooms), 0)::int AS booked
       FROM bookings
       WHERE room_type_id = $1
         AND status IN ('pending', 'approved', 'modified', 'checked_in')
         AND checkin_date < $3 AND checkout_date > $2`,
      [roomTypeId, checkin, checkout]
    );

    const booked = countRows[0]?.booked ?? 0;
    res.json({ cap, booked, available: booked + numRooms <= cap });
  }));

  // GET /bookings/calendar?from=YYYY-MM-DD&to=YYYY-MM-DD
  // Per-day, per-room-type occupancy ("X of N") for the future-occupancy
  // calendar. Registered BEFORE GET /:id so "calendar" isn't captured as an id.
  // Gated by can_view_reports — held by Reception, Admin and Swami (see seed).
  router.get('/calendar', requireAuth, requirePermission('can_view_reports'), asyncHandler(async (req, res) => {
    const today = new Date();
    const iso = (d) => d.toISOString().slice(0, 10);
    // Default: the current month-ish window (today → +30d) when unspecified.
    const from = /^\d{4}-\d{2}-\d{2}$/.test(req.query.from || '') ? req.query.from : iso(today);
    let to = /^\d{4}-\d{2}-\d{2}$/.test(req.query.to || '') ? req.query.to : null;
    if (!to) {
      const t = new Date(`${from}T00:00:00`);
      t.setDate(t.getDate() + 30);
      to = iso(t);
    }
    // Guard against an inverted or absurd range (cap at 92 days).
    if (to < from) to = from;
    const maxTo = new Date(`${from}T00:00:00`);
    maxTo.setDate(maxTo.getDate() + 92);
    if (to > iso(maxTo)) to = iso(maxTo);

    const calendar = await getOccupancyCalendar(pool, from, to);
    res.json(calendar);
  }));

  // POST /bookings
  router.post('/', asyncHandler(async (req, res) => {
    const {
      guestName, mobile, checkinDate, checkoutDate, santReferenceName, santReferenceMobile,
      roomTypeId, idDocumentUrl, preferredArrivalTime, preferredDepartureTime,
    } = req.body;
    const paxMen = Number(req.body.paxMen ?? 0);
    const paxWomen = Number(req.body.paxWomen ?? 0);
    const paxChildren = Number(req.body.paxChildren ?? 0);
    const numRooms = Math.max(1, Number(req.body.numRooms ?? 1));

    const { rows: capRows } = await pool.query(
      `SELECT capacity_cap FROM room_types WHERE id = $1`, [roomTypeId]
    );
    const cap = capRows[0]?.capacity_cap ?? 0;
    const { rows: countRows } = await pool.query(
      `SELECT COALESCE(SUM(num_rooms), 0)::int AS booked FROM bookings
       WHERE room_type_id = $1 AND status IN ('pending','approved','modified','checked_in')
         AND checkin_date < $3 AND checkout_date > $2`,
      [roomTypeId, checkinDate, checkoutDate]
    );
    if ((countRows[0]?.booked ?? 0) + numRooms > cap) {
      return res.status(409).json({ error: 'ROOM_TYPE_FULL' });
    }

    // Origin letter comes from the minting database's env (O on the cloud,
    // W on the PC) so online and walk-in serials can never collide under sync.
    const bookingCode = await makeBookingCode(pool);
    const { rows } = await pool.query(
      `INSERT INTO bookings
        (booking_code, channel, num_rooms, guest_name, mobile, pax_men, pax_women, pax_children, checkin_date, checkout_date,
         sant_reference_name, sant_reference_mobile, room_type_id, id_document_url, status,
         preferred_arrival_time, preferred_departure_time)
       VALUES ($15,'online',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$14)
       RETURNING *`,
      [numRooms, guestName, mobile, paxMen, paxWomen, paxChildren, checkinDate, checkoutDate,
       santReferenceName, santReferenceMobile, roomTypeId, idDocumentUrl,
       preferredArrivalTime || null, preferredDepartureTime || null, bookingCode]
    );

    const booking = rows[0];
    io.to('role:swami').to('role:admin').emit('booking:new', booking);
    res.status(201).json(booking);
  }));

  // POST /bookings/walkin
  router.post('/walkin', requireAuth, requirePermission('can_create_bookings'), asyncHandler(async (req, res) => {
    const {
      guestName, mobile, checkinDate, checkoutDate, santReferenceName, santReferenceMobile,
      roomTypeId, idDocumentUrl, preferredArrivalTime, preferredDepartureTime,
    } = req.body;
    const paxMen = Number(req.body.paxMen ?? 0);
    const paxWomen = Number(req.body.paxWomen ?? 0);
    const paxChildren = Number(req.body.paxChildren ?? 0);
    const numRooms = Math.max(1, Number(req.body.numRooms ?? 1));

    if (!guestName || !mobile || !checkinDate || !checkoutDate || !roomTypeId) {
      return res.status(400).json({ error: 'MISSING_REQUIRED_FIELDS' });
    }
    if (new Date(checkoutDate) <= new Date(checkinDate)) {
      return res.status(400).json({ error: 'CHECKOUT_BEFORE_CHECKIN' });
    }

    const bookingCode = await makeBookingCode(pool);
    const { rows } = await pool.query(
      `INSERT INTO bookings
        (booking_code, channel, num_rooms, guest_name, mobile, pax_men, pax_women, pax_children, checkin_date, checkout_date,
         sant_reference_name, sant_reference_mobile, room_type_id, id_document_url, status, created_by,
         preferred_arrival_time, preferred_departure_time)
       VALUES ($14,'walkin',$1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'pending',$13,$15,$16)
       RETURNING *`,
      [numRooms, guestName, mobile, paxMen, paxWomen, paxChildren, checkinDate, checkoutDate,
       santReferenceName ?? null, santReferenceMobile ?? null, roomTypeId, idDocumentUrl ?? null, req.user.id, bookingCode,
       preferredArrivalTime || null, preferredDepartureTime || null]
    );

    const booking = rows[0];
    io.to('role:receptionist').emit('booking:new', booking);
    res.status(201).json(booking);
  }));

  // GET /bookings/pending?channel=walkin|online
  router.get('/pending', requireAuth, requirePermission('can_approve_bookings'), asyncHandler(async (req, res) => {
    const { channel } = req.query;
    const { rows } = await pool.query(
      `SELECT b.*, rt.name AS room_type_name,
              u.full_name AS approved_by_name
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN users u ON u.id = b.approved_by
       WHERE b.status IN ('pending', 'modified') AND b.checkout_date >= CURRENT_DATE
         AND ($1::text IS NULL OR b.channel = $1)
       ORDER BY b.created_at ASC`,
      [channel ?? null]
    );
    res.json(rows);
  }));

  // GET /bookings/approved — approved bookings still within date range (for Swami panel)
  router.get('/approved', requireAuth, requirePermission('can_approve_bookings'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT b.*, rt.name AS room_type_name,
              u.full_name AS approved_by_name
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN users u ON u.id = b.approved_by
       WHERE b.status = 'approved' AND b.checkout_date >= CURRENT_DATE
       ORDER BY b.created_at ASC`
    );
    res.json(rows);
  }));

  // GET /bookings/approved-unassigned
  router.get('/approved-unassigned', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT b.*, rt.name AS room_type_name
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       WHERE b.status = 'approved' AND b.room_id IS NULL AND b.checkin_date <= CURRENT_DATE
       ORDER BY b.checkin_date ASC`
    );
    res.json(rows);
  }));

  // GET /bookings/history?from=&to=&status=&channel=&roomTypeId=&search=
  router.get('/history', requireAuth, requirePermission('can_view_reports'), asyncHandler(async (req, res) => {
    const { from, to, status, channel, roomTypeId, search } = req.query;
    const { rows } = await pool.query(
      `SELECT b.*, rt.name AS room_type_name, r.room_number
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE ($1::date IS NULL OR b.checkin_date >= $1)
         AND ($2::date IS NULL OR b.checkin_date <= $2)
         AND ($3::text IS NULL OR b.status = ANY(string_to_array($3, ',')))
         AND ($4::text IS NULL OR b.channel = $4)
         AND ($5::uuid IS NULL OR b.room_type_id = $5)
         AND ($6::text IS NULL OR b.guest_name ILIKE '%' || $6 || '%' OR b.mobile ILIKE '%' || $6 || '%')
       ORDER BY b.created_at DESC
       LIMIT 500`,
      [from || null, to || null, status || null, channel || null, roomTypeId || null, search || null]
    );
    res.json(rows);
  }));

  // POST /bookings/bulk-checkout
  router.post('/bulk-checkout', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { bookingIds } = req.body;
    const force = truthy(req.body?.force);
    if (!Array.isArray(bookingIds) || bookingIds.length === 0) {
      return res.status(400).json({ error: 'MISSING_BOOKING_IDS' });
    }

    const updated = [];
    const skipped = [];          // not checked-in (already out / wrong status)
    const unpaid = [];           // blocked by an outstanding balance (unless force)

    for (const bid of bookingIds) {
      // Same unpaid guard as single checkout (feature A): a departing guest with
      // money owing is set aside in `unpaid` rather than silently checked out,
      // unless the desk retried the whole batch with { force: true }.
      if (!force) {
        const { rows: curRows } = await pool.query(
          `SELECT final_amount, amount_paid FROM bookings WHERE id = $1 AND status = 'checked_in'`, [bid]
        );
        const cur = curRows[0];
        if (cur) {
          const balance = Math.round((Number(cur.final_amount ?? 0) - Number(cur.amount_paid ?? 0)) * 100) / 100;
          if (balance > 0) { unpaid.push({ id: bid, balance }); continue; }
        }
      }

      const { rows } = await pool.query(
        `UPDATE bookings SET status = 'checked_out', actual_checkout_at = now(), updated_at = now()
         WHERE id = $1 AND status = 'checked_in' RETURNING *`,
        [bid]
      );
      const booking = rows[0];
      if (!booking) { skipped.push(bid); continue; }

      const { rows: assigned } = await pool.query(
        `SELECT room_id FROM booking_rooms WHERE booking_id = $1`, [bid]
      );
      const roomIds = assigned.map((a) => a.room_id);
      if (roomIds.length === 0 && booking.room_id) roomIds.push(booking.room_id);
      if (roomIds.length) {
        await pool.query(`UPDATE rooms SET status = 'ready' WHERE id = ANY($1::uuid[])`, [roomIds]);
        for (const rid of roomIds) io.emit('room:status_changed', { roomId: rid, status: 'ready' });
      }
      await pool.query(`DELETE FROM booking_rooms WHERE booking_id = $1`, [bid]);

      await pool.query(
        `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
         VALUES ($1, 'booking.checked_out', 'booking', $2, $3)`,
        [req.user.id, bid, JSON.stringify({ bulk: true, forced: force })]
      );

      io.to('role:receptionist').emit('booking:updated', booking);
      updated.push(bid);
    }

    res.json({ updated, skipped, unpaid });
  }));

  // GET /bookings/:id
  router.get('/:id', requireAuth, requirePermission('can_view_reports'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT b.*, rt.name AS room_type_name, r.room_number
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });
    res.json(rows[0]);
  }));

  // POST /bookings/:id/decide
  router.post('/:id/decide', requireAuth, requirePermission('can_approve_bookings'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { action, roomTypeId, checkinDate, checkoutDate, billingTier, discountPercent, approvalNote } = req.body;

    const nextStatus = action === 'approve' ? 'approved' : action === 'reject' ? 'rejected' : 'modified';

    const { rows: existingRows } = await pool.query(
      `SELECT num_rooms, checkin_date, checkout_date, room_type_id, channel FROM bookings WHERE id = $1`, [id]
    );
    const existing = existingRows[0];

    // Approve-on-behalf gate (feature E). The authoritative approval of a
    // guest-submitted ONLINE booking belongs to Swami Ji / Admin (they hold
    // can_approve_online_bookings). Anyone else who holds can_approve_bookings
    // — the Reception desk, which has it so it can record Swami Ji's phone
    // approval of a WALK-IN — may decide an ONLINE booking ONLY when the admin
    // has turned the reception_approve_on_behalf toggle ON, and must record who
    // authorised it in a mandatory free-text note. Walk-in bookings are
    // unaffected. Nothing here special-cases a role name: it branches purely on
    // a data-driven permission + an admin setting.
    if (existing?.channel === 'online') {
      const authoritative = await userHasPermission(req.user.id, 'can_approve_online_bookings');
      if (!authoritative) {
        const { rows: toggleRows } = await pool.query(
          `SELECT value FROM settings WHERE key = 'reception_approve_on_behalf'`
        );
        if (!truthy(toggleRows[0]?.value)) {
          return res.status(403).json({
            error: 'ON_BEHALF_DISABLED',
            message: 'Approving online bookings on Swami Ji’s behalf is turned off. Ask an admin to enable it.',
          });
        }
        if (!approvalNote || !String(approvalNote).trim()) {
          return res.status(400).json({
            error: 'APPROVAL_NOTE_REQUIRED',
            message: 'A note recording who authorised this approval (approved on behalf) is required.',
          });
        }
      }
    }

    const numRooms = existing?.num_rooms ?? 1;
    const effectiveCheckin = checkinDate || existing?.checkin_date;
    const effectiveCheckout = checkoutDate || existing?.checkout_date;
    // A decision that doesn't change the room type may omit roomTypeId — fall
    // back to the booking's own type so pricing and the vacancy check below
    // both work instead of silently costing ₹0 / reporting NO_VACANCY.
    const effectiveRoomTypeId = roomTypeId || existing?.room_type_id;
    const nights = nightsBetween(effectiveCheckin, effectiveCheckout);

    const { rows: roomTypeRows } = await pool.query(
      `SELECT base_price, name AS room_type_name FROM room_types WHERE id = $1`,
      [effectiveRoomTypeId]
    );
    const basePrice = Number(roomTypeRows[0]?.base_price ?? 0);
    const roomTypeName = roomTypeRows[0]?.room_type_name ?? '';

    // Availability check on approve — capacity-based so it is correct for
    // multi-room bookings. Reserve num_rooms per overlapping approved/checked-in
    // booking of this type (excluding this booking itself), and require that the
    // remaining capacity covers this booking's num_rooms. (Counting physical
    // room_ids under-counts, because a multi-room booking only stores one
    // primary room_id even though it occupies several rooms.)
    //
    // Denominator = physical room count when this type has rooms (the PC / local
    // master, where inventory is real), else the admin-set room_types.capacity_cap
    // (the cloud inbox, which carries no `rooms`). This is the SAME authority the
    // guest availability check (POST /) and GET /availability already use, so on
    // the PC — where rooms always exist — this behaves exactly as before; the
    // capacity_cap branch only ever runs in the cloud, where it unblocks approval.
    if (action === 'approve') {
      const { rows: capRows } = await pool.query(
        `SELECT
           (SELECT CASE
              WHEN (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1) > 0
                THEN (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1)
              ELSE COALESCE((SELECT capacity_cap FROM room_types WHERE id = $1), 0)
            END) AS total,
           COALESCE((
             SELECT SUM(num_rooms) FROM bookings
             WHERE room_type_id = $1
               AND status IN ('approved','checked_in')
               AND id <> $4
               AND checkin_date < $3 AND checkout_date > $2
           ), 0) AS reserved`,
        [effectiveRoomTypeId, effectiveCheckin, effectiveCheckout, id]
      );
      const available = parseInt(capRows[0].total, 10) - parseInt(capRows[0].reserved, 10);
      if (available < numRooms) {
        return res.status(409).json({ error: 'NO_VACANCY', message: 'No rooms of this type available for those dates.' });
      }
    }

    const { gstPercent } = await getTaxSettings();

    const finalAmount = billingTier
      ? calculateFinalAmount({ basePrice, numRooms, nights, billingTier, discountPercent, gstPercent })
      : null;

    const { rows } = await pool.query(
      `UPDATE bookings
       SET status = $1, room_type_id = COALESCE($2, room_type_id),
           checkin_date = COALESCE($3, checkin_date), checkout_date = COALESCE($4, checkout_date),
           billing_tier = $5, discount_percent = $6, final_amount = $7,
           approved_by = $8, approved_at = now(), approval_note = $9, updated_at = now()
       WHERE id = $10
       RETURNING *`,
      [nextStatus, roomTypeId, checkinDate, checkoutDate, billingTier, discountPercent ?? 0,
       finalAmount, req.user.id, approvalNote ?? null, id]
    );

    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'booking', $3, $4)`,
      [req.user.id, `booking.${nextStatus}`, id, JSON.stringify({ billingTier, discountPercent })]
    );

    io.to('role:receptionist').emit('booking:updated', booking);

    const link = await buildWhatsAppLink(
      nextStatus === 'approved' ? 'approved' : nextStatus === 'rejected' ? 'rejected' : 'modified',
      { name: booking.guest_name, status: nextStatus, room: roomTypeName || 'your room', mobile: booking.mobile }
    );

    res.json({ booking, whatsappLink: link });
  }));

  // POST /bookings/:id/checkin
  // Accepts either { roomId } (single) or { roomIds: [...] } (multi-room). The number
  // of rooms must match the booking's num_rooms. All rooms must be 'ready'. The first
  // room becomes bookings.room_id (primary, back-compat); every room is recorded in
  // booking_rooms and flipped to 'occupied'.
  router.post('/:id/checkin', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const roomIds = [...new Set(
      Array.isArray(req.body.roomIds) && req.body.roomIds.length
        ? req.body.roomIds
        : (req.body.roomId ? [req.body.roomId] : [])
    )];
    if (roomIds.length === 0) return res.status(400).json({ error: 'NO_ROOMS_SELECTED' });

    const { rows: bookingRows } = await pool.query(
      `SELECT num_rooms FROM bookings WHERE id = $1`, [id]
    );
    if (!bookingRows[0]) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });
    const needed = bookingRows[0].num_rooms ?? 1;
    if (roomIds.length !== needed) {
      return res.status(400).json({
        error: 'ROOM_COUNT_MISMATCH',
        message: `This booking needs ${needed} room(s); ${roomIds.length} selected.`,
      });
    }

    const { rows: roomRows } = await pool.query(
      `SELECT id, status FROM rooms WHERE id = ANY($1::uuid[])`, [roomIds]
    );
    if (roomRows.length !== roomIds.length) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
    if (roomRows.some((r) => r.status !== 'ready')) {
      return res.status(409).json({ error: 'ROOM_NOT_READY' });
    }

    const { rows } = await pool.query(
      `UPDATE bookings SET room_id = $1, status = 'checked_in', ata_actual_arrival = now(), updated_at = now()
       WHERE id = $2 RETURNING *`,
      [roomIds[0], id]
    );
    for (const rid of roomIds) {
      await pool.query(
        `INSERT INTO booking_rooms (booking_id, room_id) VALUES ($1, $2)
         ON CONFLICT (room_id) DO NOTHING`,
        [id, rid]
      );
    }
    await pool.query(`UPDATE rooms SET status = 'occupied' WHERE id = ANY($1::uuid[])`, [roomIds]);

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.checked_in', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ roomIds })]
    );

    for (const rid of roomIds) io.emit('room:status_changed', { roomId: rid, status: 'occupied' });
    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json(rows[0]);
  }));

  // PATCH /bookings/:id/id-document — attach an ID photo URL to an existing
  // booking at the desk. Online guests no longer upload ID from the public form
  // (no sensitive IDs on the cloud inbox); Reception records it here at check-in
  // via the same local-disk upload the QR flow already uses. Body: { idDocumentUrl }.
  router.patch('/:id/id-document', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const url = String(req.body.idDocumentUrl || '').trim();
    if (!url) return res.status(400).json({ error: 'MISSING_ID_DOCUMENT_URL' });

    const { rows } = await pool.query(
      `UPDATE bookings SET id_document_url = $1, updated_at = now() WHERE id = $2 RETURNING *`,
      [url, id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.id_document_attached', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ idDocumentUrl: url })]
    );

    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json(rows[0]);
  }));

  // POST /bookings/:id/checkout
  router.post('/:id/checkout', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const force = truthy(req.body?.force);

    // Guard (feature A): don't check a guest out with money still owing by
    // accident. A positive balance (final_amount − amount_paid) blocks checkout
    // with 409 UNPAID_BALANCE unless the desk explicitly retries with
    // { force: true } (acknowledged in the confirm dialog). FOC / zero-total
    // bookings have balance ≤ 0 and pass straight through.
    const { rows: curRows } = await pool.query(
      `SELECT final_amount, amount_paid FROM bookings WHERE id = $1 AND status = 'checked_in'`, [id]
    );
    const cur = curRows[0];
    if (cur) {
      const balance = Math.round((Number(cur.final_amount ?? 0) - Number(cur.amount_paid ?? 0)) * 100) / 100;
      if (!force && balance > 0) {
        return res.status(409).json({
          error: 'UNPAID_BALANCE',
          balance,
          message: `Outstanding balance of ₹${balance}. Collect payment, or confirm check-out anyway.`,
        });
      }
    }

    const { rows } = await pool.query(
      `UPDATE bookings SET status = 'checked_out', actual_checkout_at = now(), updated_at = now()
       WHERE id = $1 RETURNING *`,
      [id]
    );
    const booking = rows[0];
    if (booking) {
      // Free every room this booking holds (multi-room via junction; fall back to the
      // primary room_id for any legacy row without junction entries).
      const { rows: assigned } = await pool.query(
        `SELECT room_id FROM booking_rooms WHERE booking_id = $1`, [id]
      );
      const roomIds = assigned.map((a) => a.room_id);
      if (roomIds.length === 0 && booking.room_id) roomIds.push(booking.room_id);
      if (roomIds.length) {
        await pool.query(`UPDATE rooms SET status = 'ready' WHERE id = ANY($1::uuid[])`, [roomIds]);
        for (const rid of roomIds) io.emit('room:status_changed', { roomId: rid, status: 'ready' });
      }
      await pool.query(`DELETE FROM booking_rooms WHERE booking_id = $1`, [id]);
    }

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.checked_out', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ forced: force })]
    );

    io.to('role:receptionist').emit('booking:updated', booking);
    res.json(booking);
  }));

  // POST /bookings/:id/cancel — Admin cancels a booking. Marks it 'cancelled'
  // (kept in history), frees any room it holds, and records the reason in the
  // audit log. A short reason is required.
  router.post('/:id/cancel', requireAuth, requirePermission('can_cancel_bookings'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'REASON_REQUIRED', message: 'A short reason is required to cancel.' });
    // Optional cancellation charge — recorded as a NOTE only (no billing change).
    const chargeRaw = req.body?.cancellationCharge;
    const cancellationCharge = (chargeRaw != null && String(chargeRaw).trim() !== '' && Number.isFinite(Number(chargeRaw)))
      ? Number(chargeRaw)
      : null;

    const { rows: curRows } = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [id]);
    const current = curRows[0];
    if (!current) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });
    if (current.status === 'cancelled') return res.status(409).json({ error: 'ALREADY_CANCELLED', message: 'This booking is already cancelled.' });
    if (current.status === 'checked_out') return res.status(409).json({ error: 'ALREADY_CHECKED_OUT', message: 'This stay is already checked out; delete it instead if you must remove it.' });

    // Free any room(s) the booking holds (same as checkout).
    const { rows: assigned } = await pool.query(`SELECT room_id FROM booking_rooms WHERE booking_id = $1`, [id]);
    const roomIds = assigned.map((a) => a.room_id);
    if (roomIds.length === 0 && current.room_id) roomIds.push(current.room_id);
    if (roomIds.length) {
      await pool.query(`UPDATE rooms SET status = 'ready' WHERE id = ANY($1::uuid[])`, [roomIds]);
      for (const rid of roomIds) io.emit('room:status_changed', { roomId: rid, status: 'ready' });
    }
    await pool.query(`DELETE FROM booking_rooms WHERE booking_id = $1`, [id]);

    const { rows } = await pool.query(
      `UPDATE bookings SET status = 'cancelled', updated_at = now() WHERE id = $1 RETURNING *`,
      [id]
    );
    const booking = rows[0];

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.cancelled', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ reason, cancellationCharge, previousStatus: current.status })]
    );

    io.to('role:receptionist').emit('booking:updated', booking);
    res.json(booking);
  }));

  // DELETE /bookings/:id — Admin permanently deletes a booking. Payments and
  // room links go with it (ON DELETE CASCADE); any linked luggage token is kept
  // (its booking_id is set NULL). Held rooms are freed first, and a reason +
  // snapshot are written to the audit log BEFORE deletion. Reason required.
  router.delete('/:id', requireAuth, requirePermission('can_delete_bookings'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const reason = String(req.body?.reason || '').trim();
    if (!reason) return res.status(400).json({ error: 'REASON_REQUIRED', message: 'A short reason is required to delete.' });

    const { rows: curRows } = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [id]);
    const current = curRows[0];
    if (!current) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    // Free held rooms before removing the booking (the cascade clears booking_rooms).
    const { rows: assigned } = await pool.query(`SELECT room_id FROM booking_rooms WHERE booking_id = $1`, [id]);
    const roomIds = assigned.map((a) => a.room_id);
    if (roomIds.length === 0 && current.room_id) roomIds.push(current.room_id);
    if (roomIds.length) {
      await pool.query(`UPDATE rooms SET status = 'ready' WHERE id = ANY($1::uuid[])`, [roomIds]);
      for (const rid of roomIds) io.emit('room:status_changed', { roomId: rid, status: 'ready' });
    }

    // Audit BEFORE deleting (the row is about to be gone) — keep a small snapshot.
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.deleted', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({
        reason,
        snapshot: {
          bookingCode: current.booking_code, guestName: current.guest_name, mobile: current.mobile,
          status: current.status, checkinDate: current.checkin_date, checkoutDate: current.checkout_date,
          finalAmount: current.final_amount, amountPaid: current.amount_paid,
        },
      })]
    );

    await pool.query(`DELETE FROM bookings WHERE id = $1`, [id]);

    io.to('role:receptionist').emit('booking:updated', { id, deleted: true });
    res.json({ deleted: true, id });
  }));

  // POST /bookings/:id/pay — record a payment event
  router.post('/:id/pay', requireAuth, requirePermission('can_mark_payment'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { amount, method, note } = req.body;
    const amt = Number(amount);

    if (!amt || amt <= 0) return res.status(400).json({ error: 'INVALID_AMOUNT' });
    if (!['cash', 'upi', 'card'].includes(method)) return res.status(400).json({ error: 'INVALID_METHOD' });

    const { rows: bookingRows } = await pool.query(
      `SELECT final_amount, amount_paid FROM bookings WHERE id = $1`, [id]
    );
    const booking = bookingRows[0];
    if (!booking) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    const finalAmt = Number(booking.final_amount ?? 0);
    const alreadyPaid = Number(booking.amount_paid ?? 0);
    if (finalAmt > 0 && alreadyPaid + amt > finalAmt) {
      return res.status(400).json({ error: 'OVERPAYMENT', maxAllowed: finalAmt - alreadyPaid });
    }

    const newPaid = alreadyPaid + amt;
    const paymentStatus = finalAmt > 0 && newPaid >= finalAmt ? 'paid' : newPaid > 0 ? 'partial' : 'unpaid';

    await pool.query(
      `INSERT INTO payments (booking_id, amount, method, note, recorded_by) VALUES ($1,$2,$3,$4,$5)`,
      [id, amt, method, note || '', req.user.id]
    );

    const { rows } = await pool.query(
      `UPDATE bookings SET amount_paid = $1, payment_status = $2, is_paid = $3, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [newPaid, paymentStatus, paymentStatus === 'paid', id]
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.payment_recorded', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ amount: amt, method, newTotal: newPaid, paymentStatus })]
    );

    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json(rows[0]);
  }));

  // GET /bookings/:id/payments — payment history for a booking
  router.get('/:id/payments', requireAuth, requirePermission('can_view_reports'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT p.*, u.full_name AS recorded_by_name
       FROM payments p
       LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.booking_id = $1
       ORDER BY p.created_at ASC`,
      [req.params.id]
    );
    res.json(rows);
  }));

  // GET /bookings/:id/receipt.pdf — professional invoice/bill as a streamed PDF.
  // Behind the same permission as the billing reads above (GET /:id, /payments),
  // so any staff member who can already open a guest's bill can print it.
  router.get('/:id/receipt.pdf', requireAuth, requirePermission('can_view_reports'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT b.*, rt.name AS room_type_name, rt.base_price, r.room_number
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE b.id = $1`,
      [req.params.id]
    );
    const booking = rows[0];
    if (!booking) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    const { rows: payments } = await pool.query(
      `SELECT p.*, u.full_name AS recorded_by_name
       FROM payments p
       LEFT JOIN users u ON u.id = p.recorded_by
       WHERE p.booking_id = $1
       ORDER BY p.created_at ASC`,
      [req.params.id]
    );

    const { rows: setRows } = await pool.query(`SELECT key, value FROM settings`);
    const settings = Object.fromEntries(setRows.map((r) => [r.key, r.value]));

    // GST comes from the toggle-aware source of truth; the breakdown is then
    // reconciled to the stored final_amount so the printed grand total always
    // equals what the guest was actually charged.
    const { gstPercent } = await getTaxSettings();
    const nights = nightsBetween(booking.checkin_date, booking.checkout_date);
    const breakdown = calculateBillBreakdown({
      basePrice: Number(booking.base_price ?? 0),
      numRooms: booking.num_rooms ?? 1,
      nights,
      billingTier: booking.billing_tier,
      discountPercent: booking.discount_percent,
      gstPercent,
      lateSurcharge: booking.late_checkout_surcharge,
      extraCharges: booking.extra_charges,
      storedFinal: booking.final_amount,
    });

    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader(
      'Content-Disposition',
      `inline; filename="${(booking.booking_code || `receipt-${booking.id}`).replace(/[^\w.-]/g, '_')}.pdf"`
    );
    buildReceiptPdf(res, { booking, payments, settings, breakdown, nights });
  }));

  // PUT /bookings/:id/checkout-charges — late-checkout fee + extra beds + freeform line items.
  // Idempotent: re-applying REPLACES the previous checkout charges (it does not stack), so the
  // receptionist can recalculate as many times as needed before the guest leaves.
  router.put('/:id/checkout-charges', requireAuth, requirePermission('can_set_billing_tier'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const lateHours = Math.max(0, Number(req.body.lateCheckoutHours) || 0);
    const beds = Math.max(0, Math.floor(Number(req.body.extraBeds) || 0));

    // Sanitise freeform line items: keep only { label, amount>0 } entries.
    const freeform = Array.isArray(req.body.extraCharges)
      ? req.body.extraCharges
          .map((c) => ({ label: String(c?.label ?? '').trim(), amount: Number(c?.amount) || 0 }))
          .filter((c) => c.label && c.amount > 0)
      : [];

    // Rates come from settings (admin-editable, data-driven), with safe fallbacks.
    const { rows: settingRows } = await pool.query(
      `SELECT key, value FROM settings WHERE key IN ('late_checkout_rate_per_hour', 'extra_bed_rate')`
    );
    const settingMap = Object.fromEntries(settingRows.map((r) => [r.key, r.value]));
    const lateRate = Number(settingMap.late_checkout_rate_per_hour ?? 0) || 0;
    const bedRate = Number(settingMap.extra_bed_rate ?? 0) || 0;

    const lateFee = lateHours * lateRate;
    const bedFee = beds * bedRate;

    // Itemised extra_charges array = extra-bed line (if any) + the freeform lines.
    const extraChargesArr = [];
    if (beds > 0) extraChargesArr.push({ label: `Extra bed × ${beds}`, amount: bedFee });
    extraChargesArr.push(...freeform);
    const extraChargesTotal = extraChargesArr.reduce((sum, c) => sum + Number(c.amount), 0);

    const { rows: bookingRows } = await pool.query(
      `SELECT final_amount, amount_paid, late_checkout_surcharge, extra_charges FROM bookings WHERE id = $1`,
      [id]
    );
    const existing = bookingRows[0];
    if (!existing) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    // Reconstruct the pre-surcharge amount by removing whatever was applied last time,
    // so repeated calls converge instead of compounding.
    const priorLate = Number(existing.late_checkout_surcharge ?? 0);
    const priorExtra = Array.isArray(existing.extra_charges)
      ? existing.extra_charges.reduce((sum, c) => sum + (Number(c?.amount) || 0), 0)
      : 0;
    const base = Number(existing.final_amount ?? 0) - priorLate - priorExtra;
    const newFinal = Math.max(0, base + lateFee + extraChargesTotal);

    // Keep payment_status/is_paid consistent now that the total moved.
    const amountPaid = Number(existing.amount_paid ?? 0);
    const paymentStatus = newFinal > 0 && amountPaid >= newFinal ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';

    const { rows } = await pool.query(
      `UPDATE bookings
       SET late_checkout_surcharge = $1, extra_charges = $2, final_amount = $3,
           payment_status = $4, is_paid = $5, updated_at = now()
       WHERE id = $6
       RETURNING *`,
      [lateFee, JSON.stringify(extraChargesArr), newFinal, paymentStatus, paymentStatus === 'paid', id]
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.checkout_charges', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ lateHours, lateFee, beds, bedFee, freeform, newFinal })]
    );

    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json(rows[0]);
  }));

  // POST /bookings/:id/extend — extend a checked-in booking's stay by N nights.
  // Allowed only if the same room type has capacity across the extension window
  // (else 409 NO_VACANCY_FOR_EXTENSION). Recomputes the room charge for the new
  // total nights at the booking's billing tier, preserving any late/extra charges.
  router.post('/:id/extend', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const nights = Math.max(1, Math.floor(Number(req.body.nights) || 1));

    const { rows: bRows } = await pool.query(
      `SELECT room_type_id, num_rooms, checkin_date, checkout_date, status,
              billing_tier, discount_percent, final_amount, late_checkout_surcharge, extra_charges
       FROM bookings WHERE id = $1`, [id]
    );
    const b = bRows[0];
    if (!b) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });
    if (b.status !== 'checked_in') {
      return res.status(409).json({ error: 'NOT_CHECKED_IN', message: 'Only a checked-in booking can be extended.' });
    }

    // node-pg parses DATE columns as *local* midnight, so read the day back from
    // local components — .toISOString() would shift the date by a day in any
    // timezone behind UTC (e.g. IST on the Reception PC).
    const toDateStr = (d) =>
      `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const newCheckout = new Date(b.checkout_date);
    newCheckout.setDate(newCheckout.getDate() + nights);
    const newCheckoutStr = toDateStr(newCheckout);
    const oldCheckoutStr = toDateStr(new Date(b.checkout_date));

    // Capacity across the extension window [oldCheckout, newCheckout): reserve
    // num_rooms per OTHER overlapping approved/checked-in booking of this type.
    const numRooms = b.num_rooms ?? 1;
    const { rows: capRows } = await pool.query(
      `SELECT
         (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1) AS total,
         COALESCE((
           SELECT SUM(num_rooms) FROM bookings
           WHERE room_type_id = $1
             AND status IN ('approved','checked_in')
             AND id <> $2
             AND checkin_date < $4 AND checkout_date > $3
         ), 0) AS reserved`,
      [b.room_type_id, id, oldCheckoutStr, newCheckoutStr]
    );
    const available = parseInt(capRows[0].total, 10) - parseInt(capRows[0].reserved, 10);
    if (available < numRooms) {
      return res.status(409).json({ error: 'NO_VACANCY_FOR_EXTENSION', message: 'No availability to extend into the next day(s).' });
    }

    // Recompute the room charge for the new total nights; preserve late/extra charges
    // (mirrors how /checkout-charges reconstructs final_amount).
    const { rows: rtRows } = await pool.query(`SELECT base_price FROM room_types WHERE id = $1`, [b.room_type_id]);
    const basePrice = Number(rtRows[0]?.base_price ?? 0);
    const { gstPercent } = await getTaxSettings();
    const oldNights = nightsBetween(b.checkin_date, b.checkout_date);
    const newNights = oldNights + nights;
    const newBase = calculateFinalAmount({ basePrice, numRooms, nights: newNights, billingTier: b.billing_tier, discountPercent: b.discount_percent, gstPercent });
    const priorLate = Number(b.late_checkout_surcharge ?? 0);
    const priorExtra = Array.isArray(b.extra_charges)
      ? b.extra_charges.reduce((s, c) => s + (Number(c?.amount) || 0), 0)
      : 0;
    const oldBase = Math.max(0, Number(b.final_amount ?? 0) - priorLate - priorExtra);
    const extensionCharge = Math.max(0, newBase - oldBase);
    const newFinal = newBase + priorLate + priorExtra;

    const { rows } = await pool.query(
      `UPDATE bookings SET checkout_date = $1, final_amount = $2, updated_at = now()
       WHERE id = $3 RETURNING *`,
      [newCheckoutStr, newFinal, id]
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.extended', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ nights, newCheckout: newCheckoutStr, extensionCharge, newFinal })]
    );

    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json({ booking: rows[0], extensionCharge, newCheckout: newCheckoutStr, nights });
  }));

  // PUT /bookings/:id/billing — set/adjust billing tier & recompute final_amount.
  router.put('/:id/billing', requireAuth, requirePermission('can_set_billing_tier'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { billingTier, discountPercent } = req.body;

    const { rows: bookingRows } = await pool.query(
      `SELECT room_type_id, num_rooms, checkin_date, checkout_date FROM bookings WHERE id = $1`, [id]
    );
    const booking = bookingRows[0];
    if (!booking) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    const { rows: roomTypeRows } = await pool.query(
      `SELECT base_price FROM room_types WHERE id = $1`, [booking.room_type_id]
    );
    const basePrice = Number(roomTypeRows[0]?.base_price ?? 0);
    const numRooms = booking.num_rooms ?? 1;
    const nights = nightsBetween(booking.checkin_date, booking.checkout_date);
    const { gstPercent } = await getTaxSettings();

    const finalAmount = calculateFinalAmount({ basePrice, numRooms, nights, billingTier, discountPercent, gstPercent });

    const { rows } = await pool.query(
      `UPDATE bookings SET billing_tier = $1, discount_percent = $2, final_amount = $3, updated_at = now()
       WHERE id = $4 RETURNING *`,
      [billingTier, discountPercent ?? 0, finalAmount, id]
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.billing_edited', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ billingTier, discountPercent, finalAmount })]
    );

    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json(rows[0]);
  }));

  // ------------------------------------------------------------------------
  // PATCH /bookings/:id/dining — quick per-meal Bhojanshala opt-in toggle from
  // the Current Guests panel (feature C). Body: any of { breakfast, lunch,
  // dinner } booleans; an omitted meal is left unchanged (COALESCE). Gated on
  // can_checkin_checkout — the desk manages dining as guests come and go.
  // Emits bhojan:changed so any open Bhojan count view refetches live (a guest
  // who arrives after the morning email is then counted immediately).
  // ------------------------------------------------------------------------
  router.patch('/:id/dining', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const body = req.body || {};
    const pick = (k) => (typeof body[k] === 'boolean' ? body[k] : null);

    const { rows } = await pool.query(
      `UPDATE bookings SET
         dine_breakfast = COALESCE($1, dine_breakfast),
         dine_lunch     = COALESCE($2, dine_lunch),
         dine_dinner    = COALESCE($3, dine_dinner),
         updated_at = now()
       WHERE id = $4 RETURNING *`,
      [pick('breakfast'), pick('lunch'), pick('dinner'), id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    io.to('role:receptionist').emit('booking:updated', rows[0]);
    io.emit('bhojan:changed', { bookingId: id });
    res.json(rows[0]);
  }));

  // ------------------------------------------------------------------------
  // POST /bookings/:id/reopen — undo an accidental check-out (feature B). Puts a
  // 'checked_out' booking back to 'checked_in' and re-acquires its room(s). The
  // junction was cleared at checkout, so the caller passes { roomIds: [...] }
  // (count must equal num_rooms); a single-room booking falls back to its
  // primary room_id. Every target room must still be 'ready' (another guest may
  // have taken it since) else 409 ROOM_NOT_READY. Gated can_checkin_checkout.
  // ------------------------------------------------------------------------
  router.post('/:id/reopen', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rows: bRows } = await pool.query(
      `SELECT status, num_rooms, room_id FROM bookings WHERE id = $1`, [id]
    );
    const b = bRows[0];
    if (!b) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });
    if (b.status !== 'checked_out') {
      return res.status(409).json({ error: 'NOT_CHECKED_OUT', message: 'Only a checked-out booking can be reopened.' });
    }

    const needed = b.num_rooms ?? 1;
    const roomIds = [...new Set(
      Array.isArray(req.body?.roomIds) && req.body.roomIds.length
        ? req.body.roomIds
        : (b.room_id ? [b.room_id] : [])
    )];
    if (roomIds.length === 0) {
      return res.status(400).json({ error: 'NO_ROOMS_SELECTED', message: 'Select the room(s) to put the guest back into.' });
    }
    if (roomIds.length !== needed) {
      return res.status(400).json({
        error: 'ROOM_COUNT_MISMATCH',
        message: `This booking needs ${needed} room(s); ${roomIds.length} selected.`,
      });
    }

    const { rows: roomRows } = await pool.query(
      `SELECT id, status FROM rooms WHERE id = ANY($1::uuid[])`, [roomIds]
    );
    if (roomRows.length !== roomIds.length) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
    if (roomRows.some((r) => r.status !== 'ready')) {
      return res.status(409).json({ error: 'ROOM_NOT_READY', message: 'A room has been taken since checkout — pick different room(s).' });
    }

    const { rows } = await pool.query(
      `UPDATE bookings SET status = 'checked_in', actual_checkout_at = NULL, room_id = $1, updated_at = now()
       WHERE id = $2 RETURNING *`,
      [roomIds[0], id]
    );
    for (const rid of roomIds) {
      await pool.query(
        `INSERT INTO booking_rooms (booking_id, room_id) VALUES ($1, $2) ON CONFLICT (room_id) DO NOTHING`,
        [id, rid]
      );
    }
    await pool.query(`UPDATE rooms SET status = 'occupied' WHERE id = ANY($1::uuid[])`, [roomIds]);

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.reopened', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ roomIds })]
    );

    for (const rid of roomIds) io.emit('room:status_changed', { roomId: rid, status: 'occupied' });
    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json(rows[0]);
  }));

  // ------------------------------------------------------------------------
  // POST /bookings/hall — Reception-counter hall booking (feature D). A hall is
  // a room_type with is_hall=true, charged PER PERSON at a rate the desk enters
  // (not per-night), and never shown on the public Customer form. It is created
  // already 'approved' by the desk (no Swami approval step), billing_tier
  // 'paid', final_amount = pax × rate (+ GST when tax is enabled). num_rooms is
  // 1 and room_id stays NULL — a hall doesn't occupy the sleeping-room floor
  // board or the Bhojan head-count (which only counts checked-in guests). 'hall'
  // is a fixed segment with no POST /:id to shadow it. Gated can_create_bookings.
  // ------------------------------------------------------------------------
  router.post('/hall', requireAuth, requirePermission('can_create_bookings'), asyncHandler(async (req, res) => {
    const { roomTypeId, guestName, mobile, checkinDate, checkoutDate, note } = req.body || {};
    const paxMen = Math.max(0, Number(req.body?.paxMen) || 0);
    const paxWomen = Math.max(0, Number(req.body?.paxWomen) || 0);
    const paxChildren = Math.max(0, Number(req.body?.paxChildren) || 0);
    const perPersonRate = Math.max(0, Number(req.body?.perPersonRate) || 0);
    const pax = paxMen + paxWomen + paxChildren;

    if (!roomTypeId || !guestName || !mobile || !checkinDate || !checkoutDate) {
      return res.status(400).json({ error: 'MISSING_REQUIRED_FIELDS' });
    }
    // Halls are often single-day (checkin == checkout is allowed); only reject a
    // checkout strictly before check-in.
    if (new Date(checkoutDate) < new Date(checkinDate)) {
      return res.status(400).json({ error: 'CHECKOUT_BEFORE_CHECKIN' });
    }
    if (pax <= 0) return res.status(400).json({ error: 'NO_PAX', message: 'Enter at least one person.' });

    const { rows: rtRows } = await pool.query(
      `SELECT is_hall, pax_capacity FROM room_types WHERE id = $1`, [roomTypeId]
    );
    const rt = rtRows[0];
    if (!rt) return res.status(404).json({ error: 'ROOM_TYPE_NOT_FOUND' });
    if (!rt.is_hall) return res.status(400).json({ error: 'NOT_A_HALL', message: 'That room type is not a hall.' });
    const cap = Number(rt.pax_capacity ?? 0);
    if (cap > 0 && pax > cap) {
      return res.status(409).json({ error: 'HALL_OVER_CAPACITY', capacity: cap, message: `This hall holds up to ${cap} people; ${pax} entered.` });
    }

    const { taxEnabled, gstPercent } = await getTaxSettings();
    const subtotal = pax * perPersonRate;
    const finalAmount = Math.round((taxEnabled ? subtotal * (1 + Number(gstPercent || 0) / 100) : subtotal) * 100) / 100;

    const bookingCode = await makeBookingCode(pool);
    const { rows } = await pool.query(
      `INSERT INTO bookings
         (booking_code, channel, num_rooms, guest_name, mobile, pax_men, pax_women, pax_children,
          checkin_date, checkout_date, room_type_id, status, billing_tier, final_amount,
          created_by, approved_by, approved_at, approval_note,
          dine_breakfast, dine_lunch, dine_dinner)
       VALUES ($1,'walkin',1,$2,$3,$4,$5,$6,$7,$8,$9,'approved','paid',$10,$11,$11,now(),$12,false,false,false)
       RETURNING *`,
      [bookingCode, guestName, mobile, paxMen, paxWomen, paxChildren, checkinDate, checkoutDate,
       roomTypeId, finalAmount, req.user.id, note || 'Hall booking (per-person charge)']
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.hall_created', 'booking', $2, $3)`,
      [req.user.id, rows[0].id, JSON.stringify({ pax, perPersonRate, subtotal, finalAmount })]
    );

    io.to('role:receptionist').emit('booking:new', rows[0]);
    res.status(201).json(rows[0]);
  }));

  // ------------------------------------------------------------------------
  // PATCH /bookings/:id — edit a booking's details and/or dates. Powers the
  // History "edit" action (feature B: fix a past booking) and Reception/Swami
  // editing an UPCOMING booking (feature E: early check-in, date change). Status
  // transitions live elsewhere (approve/reject → /decide, check-in/out → their
  // own endpoints, undo → /reopen); this edits descriptive fields, pax, dine
  // flags, references, preferred times, room type and dates.
  //
  // When the dates or room type move on a booking that still holds inventory
  // (pending/approved/modified/checked_in), capacity is re-checked the same way
  // /decide does, so an edit can't overbook (409 NO_VACANCY). When they move on
  // a booking that has a billing tier, the room charge is recomputed for the new
  // nights/type (preserving late/extra charges) and payment_status re-derived.
  // Room type can't change on a checked-in guest (they physically hold rooms of
  // the old type) — 409 ROOM_TYPE_LOCKED. Gated can_modify_bookings (Swami,
  // Admin, and — since migration 004 — the Reception desk). Registered last so
  // the fixed-segment PATCH routes above are matched first.
  // ------------------------------------------------------------------------
  router.patch('/:id', requireAuth, requirePermission('can_modify_bookings'), asyncHandler(async (req, res) => {
    const { id } = req.params;
    const { rows: curRows } = await pool.query(`SELECT * FROM bookings WHERE id = $1`, [id]);
    const b = curRows[0];
    if (!b) return res.status(404).json({ error: 'BOOKING_NOT_FOUND' });

    const body = req.body || {};
    const has = (k) => Object.prototype.hasOwnProperty.call(body, k);
    // node-pg returns DATE columns as local midnight; read them back from local
    // components (not .toISOString(), which shifts a day behind UTC, e.g. IST).
    const toStr = (d) => (d instanceof Date
      ? `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
      : String(d).slice(0, 10));

    const guestName = has('guestName') ? String(body.guestName || '').trim() : b.guest_name;
    const mobile = has('mobile') ? String(body.mobile || '').trim() : b.mobile;
    if (!guestName || !mobile) return res.status(400).json({ error: 'MISSING_REQUIRED_FIELDS' });
    const paxMen = has('paxMen') ? Math.max(0, Number(body.paxMen) || 0) : b.pax_men;
    const paxWomen = has('paxWomen') ? Math.max(0, Number(body.paxWomen) || 0) : b.pax_women;
    const paxChildren = has('paxChildren') ? Math.max(0, Number(body.paxChildren) || 0) : b.pax_children;
    const santName = has('santReferenceName') ? (body.santReferenceName || null) : b.sant_reference_name;
    const santMobile = has('santReferenceMobile') ? (body.santReferenceMobile || null) : b.sant_reference_mobile;
    const arrTime = has('preferredArrivalTime') ? (body.preferredArrivalTime || null) : b.preferred_arrival_time;
    const depTime = has('preferredDepartureTime') ? (body.preferredDepartureTime || null) : b.preferred_departure_time;
    const dineB = has('dineBreakfast') ? !!body.dineBreakfast : b.dine_breakfast;
    const dineL = has('dineLunch') ? !!body.dineLunch : b.dine_lunch;
    const dineD = has('dineDinner') ? !!body.dineDinner : b.dine_dinner;

    const roomTypeId = has('roomTypeId') && body.roomTypeId ? body.roomTypeId : b.room_type_id;
    const roomTypeChanged = String(roomTypeId) !== String(b.room_type_id);
    if (roomTypeChanged && b.status === 'checked_in') {
      return res.status(409).json({ error: 'ROOM_TYPE_LOCKED', message: 'Check the guest out before changing room type.' });
    }

    const checkinDate = has('checkinDate') && body.checkinDate ? String(body.checkinDate).slice(0, 10) : toStr(b.checkin_date);
    const checkoutDate = has('checkoutDate') && body.checkoutDate ? String(body.checkoutDate).slice(0, 10) : toStr(b.checkout_date);
    if (new Date(checkoutDate) <= new Date(checkinDate)) {
      return res.status(400).json({ error: 'CHECKOUT_BEFORE_CHECKIN' });
    }
    const datesChanged = checkinDate !== toStr(b.checkin_date) || checkoutDate !== toStr(b.checkout_date);

    // Capacity re-check (same authority as /decide: physical rooms on the PC,
    // else capacity_cap) when the window or type moves on a booking that still
    // holds inventory. Self is excluded via id <> $4.
    if ((datesChanged || roomTypeChanged) && ['pending', 'approved', 'modified', 'checked_in'].includes(b.status)) {
      const numRooms = b.num_rooms ?? 1;
      const { rows: capRows } = await pool.query(
        `SELECT
           (SELECT CASE
              WHEN (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1) > 0
                THEN (SELECT COUNT(*) FROM rooms WHERE room_type_id = $1)
              ELSE COALESCE((SELECT capacity_cap FROM room_types WHERE id = $1), 0)
            END) AS total,
           COALESCE((
             SELECT SUM(num_rooms) FROM bookings
             WHERE room_type_id = $1
               AND status IN ('approved','checked_in')
               AND id <> $4
               AND checkin_date < $3 AND checkout_date > $2
           ), 0) AS reserved`,
        [roomTypeId, checkinDate, checkoutDate, id]
      );
      const available = parseInt(capRows[0].total, 10) - parseInt(capRows[0].reserved, 10);
      if (available < numRooms) {
        return res.status(409).json({ error: 'NO_VACANCY', message: 'No availability of this room type for the new dates.' });
      }
    }

    // Recompute billing only when something price-affecting moved AND a tier is
    // set (halls / un-priced bookings keep their stored amount).
    let finalAmount = b.final_amount;
    let paymentStatus = b.payment_status;
    let isPaid = b.is_paid;
    if ((datesChanged || roomTypeChanged) && b.billing_tier) {
      const { rows: rtRows } = await pool.query(`SELECT base_price FROM room_types WHERE id = $1`, [roomTypeId]);
      const basePrice = Number(rtRows[0]?.base_price ?? 0);
      const { gstPercent } = await getTaxSettings();
      const nights = nightsBetween(checkinDate, checkoutDate);
      const newBase = calculateFinalAmount({
        basePrice, numRooms: b.num_rooms ?? 1, nights,
        billingTier: b.billing_tier, discountPercent: b.discount_percent, gstPercent,
      });
      const priorLate = Number(b.late_checkout_surcharge ?? 0);
      const priorExtra = Array.isArray(b.extra_charges)
        ? b.extra_charges.reduce((s, c) => s + (Number(c?.amount) || 0), 0) : 0;
      finalAmount = newBase + priorLate + priorExtra;
      const amountPaid = Number(b.amount_paid ?? 0);
      paymentStatus = finalAmount > 0 && amountPaid >= finalAmount ? 'paid' : amountPaid > 0 ? 'partial' : 'unpaid';
      isPaid = paymentStatus === 'paid';
    }

    const { rows } = await pool.query(
      `UPDATE bookings SET
         guest_name = $1, mobile = $2, pax_men = $3, pax_women = $4, pax_children = $5,
         sant_reference_name = $6, sant_reference_mobile = $7,
         preferred_arrival_time = $8, preferred_departure_time = $9,
         dine_breakfast = $10, dine_lunch = $11, dine_dinner = $12,
         room_type_id = $13, checkin_date = $14, checkout_date = $15,
         final_amount = $16, payment_status = $17, is_paid = $18, updated_at = now()
       WHERE id = $19 RETURNING *`,
      [guestName, mobile, paxMen, paxWomen, paxChildren, santName, santMobile,
       arrTime, depTime, dineB, dineL, dineD, roomTypeId, checkinDate, checkoutDate,
       finalAmount, paymentStatus, isPaid, id]
    );

    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, 'booking.edited', 'booking', $2, $3)`,
      [req.user.id, id, JSON.stringify({ datesChanged, roomTypeChanged, checkinDate, checkoutDate })]
    );

    io.to('role:receptionist').emit('booking:updated', rows[0]);
    res.json(rows[0]);
  }));

  return router;
};
