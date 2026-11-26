/**
 * routes/inventory.js
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');

const pool = require('../db');

module.exports = function (io) {
  const router = express.Router();

  // ---- Floors -----------------------------------------------------------
  router.get('/floors', asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT * FROM floors ORDER BY sort_order`);
    res.json(rows);
  }));

  router.post('/floors', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const { name, sortOrder = 0 } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO floors (name, sort_order) VALUES ($1, $2) RETURNING *`,
      [name, sortOrder]
    );
    res.status(201).json(rows[0]);
  }));

  // ---- Room types -------------------------------------------------------
  // publicOnly=1 → only types the Customer form may show (halls and any type an
  // admin has hidden are excluded). Staff screens omit the flag and see all.
  router.get('/room-types', asyncHandler(async (req, res) => {
    const publicOnly = req.query.publicOnly === '1' || req.query.publicOnly === 'true';
    const where = publicOnly ? `WHERE show_on_customer_portal = true AND is_hall = false` : ``;
    const { rows } = await pool.query(`SELECT * FROM room_types ${where} ORDER BY name`);
    res.json(rows);
  }));

  router.post('/room-types', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const { name, basePrice, capacityCap, isHall = false, isShared = false, showOnCustomerPortal, paxCapacity = 0 } = req.body;
    const hall = !!isHall;
    const shared = !!(isShared || hall);
    // A hall defaults to hidden from the Customer form unless the admin says otherwise.
    const showCustomer = showOnCustomerPortal == null ? !hall : !!showOnCustomerPortal;
    const { rows } = await pool.query(
      `INSERT INTO room_types (name, base_price, capacity_cap, is_hall, is_shared, show_on_customer_portal, pax_capacity)
       VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
      [name, basePrice, capacityCap, hall, shared, showCustomer, paxCapacity]
    );
    res.status(201).json(rows[0]);
  }));

  router.put('/room-types/:id', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const { name, basePrice, capacityCap, isHall = false, isShared = false, showOnCustomerPortal, paxCapacity = 0 } = req.body;
    const hall = !!isHall;
    const shared = !!isShared;
    const showCustomer = showOnCustomerPortal == null ? !hall : !!showOnCustomerPortal;
    const { rows } = await pool.query(
      `UPDATE room_types
       SET name = $1, base_price = $2, capacity_cap = $3,
           is_hall = $4, is_shared = $5, show_on_customer_portal = $6, pax_capacity = $7
       WHERE id = $8 RETURNING *`,
      [name, basePrice, capacityCap, hall, shared, showCustomer, paxCapacity, req.params.id]
    );
    res.json(rows[0]);
  }));

  // ---- Rooms ------------------------------------------------------------
  router.get('/rooms', asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT r.*, f.name AS floor_name, rt.name AS room_type_name
       FROM rooms r
       JOIN floors f ON f.id = r.floor_id
       JOIN room_types rt ON rt.id = r.room_type_id
       ORDER BY f.sort_order, r.room_number`
    );
    res.json(rows);
  }));

  router.post('/rooms', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const { floorId, roomTypeId, roomNumber, bedCount = 1, hasBathroom = true } = req.body;
    const { rows } = await pool.query(
      `INSERT INTO rooms (floor_id, room_type_id, room_number, status, bed_count, has_bathroom)
       VALUES ($1, $2, $3, 'ready', $4, $5) RETURNING *`,
      [floorId, roomTypeId, roomNumber, bedCount, hasBathroom]
    );
    io.emit('room:created', rows[0]);
    res.status(201).json(rows[0]);
  }));

  router.put('/rooms/:id', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const { floorId, roomTypeId, roomNumber, bedCount, hasBathroom } = req.body;
    if (!roomNumber || !String(roomNumber).trim()) {
      return res.status(400).json({ error: 'ROOM_NUMBER_REQUIRED' });
    }
    try {
      const { rows } = await pool.query(
        `UPDATE rooms
         SET floor_id = COALESCE($1, floor_id),
             room_type_id = COALESCE($2, room_type_id),
             room_number = $3,
             bed_count = COALESCE($4, bed_count),
             has_bathroom = COALESCE($5, has_bathroom)
         WHERE id = $6
         RETURNING *`,
        [
          floorId || null,
          roomTypeId || null,
          String(roomNumber).trim(),
          bedCount !== undefined ? Math.max(1, parseInt(bedCount, 10) || 1) : null,
          hasBathroom !== undefined ? Boolean(hasBathroom) : null,
          req.params.id,
        ]
      );
      if (!rows[0]) return res.status(404).json({ error: 'ROOM_NOT_FOUND' });
      io.emit('room:updated', rows[0]);
      res.json(rows[0]);
    } catch (err) {
      if (err.code === '23505') {
        return res.status(409).json({ error: 'DUPLICATE_ROOM_NUMBER', message: 'That room number already exists on this floor.' });
      }
      throw err;
    }
  }));

  router.delete('/rooms/:id', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    await pool.query(`DELETE FROM rooms WHERE id = $1`, [req.params.id]);
    io.emit('room:deleted', { roomId: req.params.id });
    res.status(204).end();
  }));

  // ---- Add-on charges (Food, Extra Bed, custom items) -------------------
  router.get('/addons', asyncHandler(async (req, res) => {
    const showAll = req.query.all === '1' || req.query.all === 'true';
    const where = showAll ? '' : 'WHERE is_active = true';
    const { rows } = await pool.query(
      `SELECT * FROM addon_charges ${where} ORDER BY sort_order ASC, name ASC`
    );
    res.json(rows);
  }));

  router.post('/addons', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const price = Math.max(0, Number(req.body.price) || 0);
    if (!name) return res.status(400).json({ error: 'ADDON_NAME_REQUIRED' });
    const { rows } = await pool.query(
      `INSERT INTO addon_charges (name, price, is_active) VALUES ($1, $2, true) RETURNING *`,
      [name, price]
    );
    res.status(201).json(rows[0]);
  }));

  router.put('/addons/:id', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const name = String(req.body.name || '').trim();
    const price = Math.max(0, Number(req.body.price) || 0);
    const isActive = req.body.isActive !== undefined ? Boolean(req.body.isActive) : true;
    if (!name) return res.status(400).json({ error: 'ADDON_NAME_REQUIRED' });
    const { rows } = await pool.query(
      `UPDATE addon_charges SET name = $1, price = $2, is_active = $3 WHERE id = $4 RETURNING *`,
      [name, price, isActive, req.params.id]
    );
    if (!rows[0]) return res.status(404).json({ error: 'ADDON_NOT_FOUND' });
    res.json(rows[0]);
  }));

  router.delete('/addons/:id', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    await pool.query(`DELETE FROM addon_charges WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  }));

  return router;
};
