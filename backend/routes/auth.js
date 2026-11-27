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
const { requireAuth } = require('../middleware/requireAuth');

const router = express.Router();
const pool = require('../db');
const JWT_SECRET = process.env.JWT_SECRET;

async function getRolePermissions(roleId) {
  const { rows } = await pool.query(
    `SELECT p.key
     FROM role_permissions rp
     JOIN permissions p ON p.id = rp.permission_id
     WHERE rp.role_id = $1`,
    [roleId]
  );
  return rows.map((r) => r.key);
}

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

  const permissions = await getRolePermissions(user.role_id);
  const token = jwt.sign({ userId: user.id, roleId: user.role_id }, JWT_SECRET, {
    expiresIn: '15d',
  });

  res.json({
    token,
    user: { id: user.id, name: user.full_name, role: user.role_name, permissions },
  });
}));

/**
 * GET /auth/me — returns fresh user profile + live role permissions.
 */
router.get('/me', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(
    `SELECT u.id, u.full_name, u.role_id, r.name AS role_name
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE u.id = $1 AND u.is_active = true`,
    [req.user.id]
  );
  const user = rows[0];
  if (!user) return res.status(401).json({ error: 'USER_NOT_FOUND' });
  const permissions = await getRolePermissions(user.role_id);
  res.json({ id: user.id, name: user.full_name, role: user.role_name, permissions });
}));

module.exports = router;
