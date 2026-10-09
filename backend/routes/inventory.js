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
    const { name, basePrice, capacityCap, isHall = false, showOnCustomerPortal, paxCapacity = 0 } = req.body;
    const hall = !!isHall;
    // A hall defaults to hidden from the Customer form unless the admin says otherwise.
    const showCustomer = showOnCustomerPortal == null ? !hall : !!showOnCustomerPortal;
    const { rows } = await pool.query(
      `INSERT INTO room_types (name, base_price, capacity_cap, is_hall, show_on_customer_portal, pax_capacity)
       VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
      [name, basePrice, capacityCap, hall, showCustomer, paxCapacity]
    );
    res.status(201).json(rows[0]);
  }));

  router.put('/room-types/:id', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    const { name, basePrice, capacityCap, isHall = false, showOnCustomerPortal, paxCapacity = 0 } = req.body;
    const hall = !!isHall;
    const showCustomer = showOnCustomerPortal == null ? !hall : !!showOnCustomerPortal;
    const { rows } = await pool.query(
      `UPDATE room_types
       SET name = $1, base_price = $2, capacity_cap = $3,
           is_hall = $4, show_on_customer_portal = $5, pax_capacity = $6
       WHERE id = $7 RETURNING *`,
      [name, basePrice, capacityCap, hall, showCustomer, paxCapacity, req.params.id]
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

  router.delete('/rooms/:id', requireAuth, requirePermission('can_edit_rooms'), asyncHandler(async (req, res) => {
    await pool.query(`DELETE FROM rooms WHERE id = $1`, [req.params.id]);
    io.emit('room:deleted', { roomId: req.params.id });
    res.status(204).end();
  }));

  return router;
};
