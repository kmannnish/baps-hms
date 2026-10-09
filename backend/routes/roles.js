/**
 * routes/roles.js
 */

const express = require('express');
const bcrypt = require('bcrypt');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');

const pool = require('../db');

module.exports = function () {
  const router = express.Router();

  router.get('/users', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT u.id, u.full_name AS name, u.mobile, u.role_id, u.is_active, r.name AS role_name, u.created_at,
              (SELECT COUNT(*) FROM bookings WHERE created_by = u.id) AS bookings_made,
              (SELECT COUNT(*) FROM bookings WHERE approved_by = u.id) AS bookings_approved
       FROM users u
       LEFT JOIN roles r ON r.id = u.role_id
       ORDER BY u.created_at`
    );
    res.json(rows);
  }));

  router.post('/users', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { fullName, mobile, password, roleId } = req.body;
    if (!fullName || !mobile || !password || !roleId) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }
    const existing = await pool.query('SELECT id FROM users WHERE mobile = $1', [mobile]);
    if (existing.rows.length) return res.status(409).json({ error: 'MOBILE_TAKEN' });
    const hash = await bcrypt.hash(password, 10);
    const { rows } = await pool.query(
      `INSERT INTO users (full_name, mobile, password_hash, role_id)
       VALUES ($1, $2, $3, $4)
       RETURNING id, full_name AS name, mobile, role_id, created_at`,
      [fullName, mobile, hash, roleId]
    );
    res.status(201).json(rows[0]);
  }));

  // Reset a user's password. Admin action gated by can_manage_roles — needed to
  // change the shipped demo passwords before going live, and to help staff who
  // forget theirs. Minimum 8 characters.
  router.put('/users/:id/password', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { password } = req.body || {};
    if (!password || String(password).length < 8) {
      return res.status(400).json({ error: 'WEAK_PASSWORD', message: 'Password must be at least 8 characters.' });
    }
    const hash = await bcrypt.hash(String(password), 10);
    const { rows } = await pool.query(
      `UPDATE users SET password_hash = $1 WHERE id = $2
       RETURNING id, full_name AS name, mobile`,
      [hash, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    res.json({ ok: true, user: rows[0] });
  }));

  // Edit a user's name, mobile, role, and active flag. Gated by can_manage_roles.
  router.put('/users/:id', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { fullName, mobile, roleId, isActive } = req.body || {};
    if (!fullName || !mobile || !roleId) {
      return res.status(400).json({ error: 'MISSING_FIELDS' });
    }
    if (req.params.id === req.user.id && isActive === false) {
      return res.status(400).json({ error: 'CANNOT_DEACTIVATE_SELF', message: 'You cannot deactivate your own account.' });
    }
    // Mobile must stay unique across users (ignore this same row).
    const clash = await pool.query('SELECT id FROM users WHERE mobile = $1 AND id <> $2', [mobile, req.params.id]);
    if (clash.rows.length) return res.status(409).json({ error: 'MOBILE_TAKEN' });
    const { rows } = await pool.query(
      `UPDATE users
          SET full_name = $1, mobile = $2, role_id = $3,
              is_active = COALESCE($4, is_active), updated_at = now()
        WHERE id = $5
        RETURNING id, full_name AS name, mobile, role_id, is_active`,
      [fullName, mobile, roleId, typeof isActive === 'boolean' ? isActive : null, req.params.id]
    );
    if (!rows.length) return res.status(404).json({ error: 'USER_NOT_FOUND' });
    res.json(rows[0]);
  }));

  // Delete a user. Blocks deleting yourself. A staff member referenced by
  // bookings/audit/luggage history can't be hard-deleted without erasing that
  // history (a foreign-key violation, code 23503) — in that case we deactivate
  // them instead (is_active=false blocks login via requirePermission) and keep
  // the records intact. Returns which happened so the UI can say so.
  router.delete('/users/:id', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    if (req.params.id === req.user.id) {
      return res.status(400).json({ error: 'CANNOT_DELETE_SELF', message: 'You cannot delete your own account.' });
    }
    try {
      const { rows } = await pool.query('DELETE FROM users WHERE id = $1 RETURNING id', [req.params.id]);
      if (!rows.length) return res.status(404).json({ error: 'USER_NOT_FOUND' });
      res.json({ deleted: true });
    } catch (err) {
      if (err.code === '23503') {
        const { rowCount } = await pool.query(
          'UPDATE users SET is_active = false, updated_at = now() WHERE id = $1',
          [req.params.id]
        );
        if (!rowCount) return res.status(404).json({ error: 'USER_NOT_FOUND' });
        return res.json({ deleted: false, deactivated: true });
      }
      throw err;
    }
  }));

  router.get('/permissions', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT id, key, label, description, category FROM permissions ORDER BY category, label`
    );
    res.json(rows);
  }));

  router.get('/', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(
      `SELECT r.id, r.name, r.description, r.is_system,
              COALESCE(array_agg(rp.permission_id) FILTER (WHERE rp.permission_id IS NOT NULL), '{}') AS permission_ids
       FROM roles r
       LEFT JOIN role_permissions rp ON rp.role_id = r.id
       GROUP BY r.id
       ORDER BY r.created_at`
    );
    res.json(rows);
  }));

  router.post('/', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { name, description, permissionIds = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(
        `INSERT INTO roles (name, description) VALUES ($1, $2) RETURNING *`,
        [name, description]
      );
      const role = rows[0];
      for (const pid of permissionIds) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
          [role.id, pid]
        );
      }
      await client.query('COMMIT');
      res.status(201).json({ ...role, permission_ids: permissionIds });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  router.put('/:id/permissions', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { permissionIds = [] } = req.body;
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`DELETE FROM role_permissions WHERE role_id = $1`, [req.params.id]);
      for (const pid of permissionIds) {
        await client.query(
          `INSERT INTO role_permissions (role_id, permission_id) VALUES ($1, $2)`,
          [req.params.id, pid]
        );
      }
      await client.query('COMMIT');
      res.json({ roleId: req.params.id, permission_ids: permissionIds });
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
  }));

  router.delete('/:id', requireAuth, requirePermission('can_manage_roles'), asyncHandler(async (req, res) => {
    const { rows } = await pool.query(`SELECT is_system FROM roles WHERE id = $1`, [req.params.id]);
    if (rows[0]?.is_system) {
      return res.status(400).json({ error: 'CANNOT_DELETE_SYSTEM_ROLE' });
    }
    await pool.query(`DELETE FROM roles WHERE id = $1`, [req.params.id]);
    res.status(204).end();
  }));

  return router;
};
