/**
 * middleware/requirePermission.js
 *
 * Gates a route behind a named permission key (e.g. 'can_approve_bookings').
 * The check is a pure DB join — roles and their permissions are entirely
 * admin-configurable, so no role name is ever special-cased in code.
 *
 * Assumes an upstream auth middleware has already set req.user = { id, roleId }
 * from a verified session JWT.
 */

const pool = require('../db');

// Does this user's role hold a given permission? A plain boolean check for use
// INSIDE a handler (e.g. to branch on an optional capability), using the exact
// same roles→role_permissions→permissions join as the middleware. Never throws
// — returns false on any error so a failed lookup can't accidentally grant.
async function userHasPermission(userId, permissionKey) {
  try {
    if (!userId) return false;
    const { rows } = await pool.query(
      `SELECT 1
       FROM users u
       JOIN role_permissions rp ON rp.role_id = u.role_id
       JOIN permissions p ON p.id = rp.permission_id
       WHERE u.id = $1 AND p.key = $2 AND u.is_active = true
       LIMIT 1`,
      [userId, permissionKey]
    );
    return rows.length > 0;
  } catch (err) {
    console.error('userHasPermission error:', err);
    return false;
  }
}

function requirePermission(permissionKey) {
  return async function (req, res, next) {
    try {
      if (!req.user?.id) {
        return res.status(401).json({ error: 'UNAUTHENTICATED' });
      }

      const { rows } = await pool.query(
        `SELECT 1
         FROM users u
         JOIN role_permissions rp ON rp.role_id = u.role_id
         JOIN permissions p ON p.id = rp.permission_id
         WHERE u.id = $1 AND p.key = $2 AND u.is_active = true
         LIMIT 1`,
        [req.user.id, permissionKey]
      );

      if (rows.length === 0) {
        return res.status(403).json({
          error: 'PERMISSION_DENIED',
          required: permissionKey,
        });
      }

      next();
    } catch (err) {
      console.error('requirePermission error:', err);
      res.status(500).json({ error: 'PERMISSION_CHECK_FAILED' });
    }
  };
}

module.exports = { requirePermission, userHasPermission };
