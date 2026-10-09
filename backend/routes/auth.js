/**
 * routes/auth.js
 *
 * Single login path for every role. Reception, Swami Ji, and Admin all log
 * in the same way — there's no geofence check, since Reception only ever
 * runs on the one front-desk PC and physical access to that machine is the
 * security boundary, not location.
 */

const express = require('express');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const { asyncHandler } = require('../utils/asyncHandler');

const router = express.Router();
const pool = require('../db');
const JWT_SECRET = process.env.JWT_SECRET;

/**
 * POST /auth/login
 * body: { mobile, password }
 */
router.post('/login', asyncHandler(async (req, res) => {
  const { mobile, password } = req.body;

  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.password_hash, u.role_id, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.mobile = $1 AND u.is_active = true`,
    [mobile]
  );

  const user = rows[0];
  if (!user || !(await bcrypt.compare(password, user.password_hash))) {
    return res.status(401).json({ error: 'INVALID_CREDENTIALS' });
  }

  const token = jwt.sign({ userId: user.id, roleId: user.role_id }, JWT_SECRET, {
    expiresIn: '12h',
  });

  res.json({ token, user: { id: user.id, name: user.full_name, role: user.role_name } });
}));

module.exports = router;
