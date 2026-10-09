/**
 * routes/rooms.js
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');

const pool = require('../db');

module.exports = function (io) {
  const router = express.Router();

  router.get('/board', asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT f.id AS floor_id, f.name AS floor_name, f.sort_order,
              r.id AS room_id, r.room_number, r.status, r.bed_count, r.has_bathroom,
              rt.name AS room_type,
              b.id AS booking_id, b.guest_name, b.checkout_date,
              b.pax_men, b.pax_women, b.pax_children,
              b.dine_breakfast, b.dine_lunch, b.dine_dinner,
              b.billing_tier, b.discount_percent, b.final_amount, b.is_paid,
              b.amount_paid, b.payment_status, b.id_document_url
       FROM floors f
       LEFT JOIN rooms r ON r.floor_id = f.id
       LEFT JOIN room_types rt ON rt.id = r.room_type_id
       LEFT JOIN booking_rooms br ON br.room_id = r.id
       LEFT JOIN bookings b ON b.id = br.booking_id AND b.status = 'checked_in'
       ORDER BY f.sort_order, r.room_number`
    );

    const floors = [];
    const byFloor = new Map();
    for (const row of rows) {
      if (!byFloor.has(row.floor_id)) {
        const floor = { id: row.floor_id, name: row.floor_name, rooms: [] };
        byFloor.set(row.floor_id, floor);
        floors.push(floor);
      }
      if (row.room_id) {
        byFloor.get(row.floor_id).rooms.push({
          id: row.room_id,
          roomNumber: row.room_number,
          roomType: row.room_type,
          status: row.status,
          bedCount: row.bed_count,
          hasBathroom: row.has_bathroom,
          bookingId: row.booking_id,
          guestName: row.guest_name,
          checkoutTime: row.checkout_date,
          paxMen: row.pax_men,
          paxWomen: row.pax_women,
          paxChildren: row.pax_children,
          dineBreakfast: row.dine_breakfast,
          dineLunch: row.dine_lunch,
          dineDinner: row.dine_dinner,
          billingTier: row.billing_tier,
          discountPercent: row.discount_percent,
          finalAmount: row.final_amount,
          isPaid: row.is_paid,
          amountPaid: row.amount_paid,
          paymentStatus: row.payment_status,
          idDocumentUrl: row.id_document_url,
        });
      }
    }
    res.json(floors);
  }));

  router.get('/available', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { roomTypeId } = req.query;
    const { rows } = await pool.query(
      `SELECT r.id, r.room_number, r.bed_count, r.has_bathroom, f.name AS floor_name
       FROM rooms r
       JOIN floors f ON f.id = r.floor_id
       WHERE r.room_type_id = $1 AND r.status = 'ready'
       ORDER BY f.sort_order, r.room_number`,
      [roomTypeId]
    );
    res.json(rows);
  }));

  router.post('/:id/status', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
    const { status } = req.body;
    const { rows } = await pool.query(
      `UPDATE rooms SET status = $1 WHERE id = $2 RETURNING *`,
      [status, req.params.id]
    );
    io.emit('room:status_changed', { roomId: req.params.id, status });
    res.json(rows[0]);
  }));

  // ---- Luggage tokens ---------------------------------------------------
  // Each token is a printable claim check (LG-0001, ...) handed to a guest at
  // checkout for the bags they leave in the luggage hall. "Bags in hall" is the
  // sum of bag_count over open tokens — there is no separate manual counter.
  const emitLuggage = async () => {
    const { rows } = await pool.query(
      `SELECT COALESCE(SUM(bag_count), 0)::int AS count FROM luggage_tokens WHERE status = 'open'`
    );
    io.emit('luggage:updated', { count: rows[0].count });
  };

  // GET open tokens + total bag count for the luggage-hall view.
  router.get('/luggage', requireAuth, asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, token_code, booking_id, guest_name, mobile, bag_count, note, issued_at
       FROM luggage_tokens
       WHERE status = 'open'
       ORDER BY issued_at DESC`
    );
    const count = rows.reduce((sum, r) => sum + (r.bag_count || 0), 0);
    res.json({ count, tokens: rows });
  }));

  // Issue a luggage token for a guest (typically as they check out).
  router.post('/luggage/tokens', requireAuth, requirePermission('can_manage_luggage'), asyncHandler(async (req, res) => {
    const guestName = String(req.body.guestName || '').trim();
    if (!guestName) {
      return res.status(400).json({ error: 'GUEST_NAME_REQUIRED', message: 'Guest name is required to issue a luggage token.' });
    }
    const mobile = String(req.body.mobile || '').trim() || null;
    const note = String(req.body.note || '').trim();
    // Only accept a booking link that looks like a UUID; anything else is ignored
    // so a stray value can't turn into a 500 from a bad cast.
    const rawBooking = String(req.body.bookingId || '').trim();
    const bookingId = /^[0-9a-f-]{36}$/i.test(rawBooking) ? rawBooking : null;
    let bagCount = parseInt(req.body.bagCount, 10);
    if (!Number.isFinite(bagCount) || bagCount < 1) bagCount = 1;

    const { rows } = await pool.query(
      `INSERT INTO luggage_tokens (booking_id, guest_name, mobile, bag_count, note, issued_by)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id, token_code, booking_id, guest_name, mobile, bag_count, note, status, issued_at`,
      [bookingId, guestName, mobile, bagCount, note, req.user.id]
    );
    await emitLuggage();
    res.status(201).json(rows[0]);
  }));

  // Mark a token collected — the guest returned and took their bags back.
  router.patch('/luggage/tokens/:id/collect', requireAuth, requirePermission('can_manage_luggage'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `UPDATE luggage_tokens
       SET status = 'collected', collected_by = $1, collected_at = now()
       WHERE id = $2 AND status = 'open'
       RETURNING id, token_code, guest_name, bag_count, status, collected_at`,
      [req.user.id, req.params.id]
    );
    if (!rows[0]) {
      return res.status(404).json({ error: 'TOKEN_NOT_FOUND_OR_COLLECTED', message: 'That token was not found or has already been collected.' });
    }
    await emitLuggage();
    res.json(rows[0]);
  }));

  return router;
};
