/**
 * routes/backup.js — admin API for the local backup & restore feature.
 *
 * PC-only (mounted inside `if (!CLOUD_MODE)` in server.js). Every endpoint is
 * gated by the data-driven `can_manage_backups` permission (seeded to Admin;
 * grantable to any custom role from the Roles UI) — no role name is hardcoded.
 *
 * The whole Backup tab lives behind this ONE permission: the schedule is saved
 * via PUT /config here (not the generic /settings PUT), so an operator granted
 * only can_manage_backups can use the tab fully without also holding
 * can_manage_settings.
 */

const express = require('express');
const fs = require('fs');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  listBackups,
  createBackup,
  restoreBackup,
  toolsAvailable,
  isValidSlot,
  slotFile,
  MANUAL_SLOTS,
} = require('../utils/backup');

const pool = require('../db');
const router = express.Router();

// audit_log.entity_id is NOT NULL UUID with no FK; backups are a system-level
// action with no booking/room entity, so we anchor them to the all-zeros UUID.
const SYSTEM_ENTITY = '00000000-0000-0000-0000-000000000000';

// Schedule settings this tab owns. Booleans are coerced on write; the rest are
// stored verbatim. Server-only markers are read (to show "last run") but never
// written through the API.
const CONFIG_KEYS = [
  'backup_enabled',
  'backup_daily_enabled',
  'backup_weekly_enabled',
  'backup_monthly_enabled',
  'backup_time',
  'backup_weekly_day',
  'backup_monthly_day',
];
const MARKER_KEYS = ['backup_daily_last_run', 'backup_weekly_last_run', 'backup_monthly_last_run'];

async function readConfig() {
  const { rows } = await pool.query(`SELECT key, value FROM settings WHERE key = ANY($1)`, [
    [...CONFIG_KEYS, ...MARKER_KEYS],
  ]);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Best-effort audit entry — a failed write here must never fail the operation.
async function auditLog(actorId, action, metadata) {
  try {
    await pool.query(
      `INSERT INTO audit_log (actor_id, action, entity_type, entity_id, metadata)
       VALUES ($1, $2, 'system', $3, $4)`,
      [actorId, action, SYSTEM_ENTITY, JSON.stringify(metadata || {})]
    );
  } catch (err) {
    console.error('[backup] audit log write failed (ignored):', err.message);
  }
}

// GET /backup — current backups + schedule config + whether pg tools exist.
router.get(
  '/',
  requireAuth,
  requirePermission('can_manage_backups'),
  asyncHandler(async (req, res) => {
    const [config, tools] = await Promise.all([readConfig(), toolsAvailable()]);
    res.json({ backups: listBackups(), config, toolsAvailable: tools });
  })
);

// PUT /backup/config — save the schedule (only the known keys).
router.put(
  '/config',
  requireAuth,
  requirePermission('can_manage_backups'),
  asyncHandler(async (req, res) => {
    const body = req.body || {};
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      for (const key of CONFIG_KEYS) {
        if (!(key in body)) continue;
        let value = body[key];
        if (key.endsWith('_enabled')) value = !!value; // coerce checkbox -> bool
        await client.query(
          `INSERT INTO settings (key, value, updated_by, updated_at)
           VALUES ($1, $2, $3, now())
           ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
          [key, JSON.stringify(value), req.user.id]
        );
      }
      await client.query('COMMIT');
    } catch (err) {
      await client.query('ROLLBACK');
      throw err;
    } finally {
      client.release();
    }
    res.json({ config: await readConfig() });
  })
);

// POST /backup/run — create a backup now (default the on-demand 'manual' slot).
router.post(
  '/run',
  requireAuth,
  requirePermission('can_manage_backups'),
  asyncHandler(async (req, res) => {
    const slot = req.body?.slot || 'manual';
    if (!MANUAL_SLOTS.includes(slot)) return res.status(400).json({ error: 'INVALID_SLOT' });
    if (!(await toolsAvailable())) {
      return res.status(503).json({
        error: 'PG_TOOLS_UNAVAILABLE',
        message: 'PostgreSQL client tools (pg_dump) are not installed on the server.',
      });
    }
    try {
      const backup = await createBackup(slot);
      await auditLog(req.user.id, 'backup.created', { slot, sizeBytes: backup.sizeBytes });
      res.json({ backup, backups: listBackups() });
    } catch (err) {
      res.status(500).json({ error: 'BACKUP_FAILED', message: err.message });
    }
  })
);

// POST /backup/restore — DESTRUCTIVE. Requires an explicit { confirm: true } so
// a stray request can never wipe the live database; a 'prerestore' safety copy
// is taken automatically before the restore (see utils/backup.restoreBackup).
router.post(
  '/restore',
  requireAuth,
  requirePermission('can_manage_backups'),
  asyncHandler(async (req, res) => {
    const slot = req.body?.slot;
    if (!isValidSlot(slot)) return res.status(400).json({ error: 'INVALID_SLOT' });
    if (req.body?.confirm !== true) {
      return res.status(400).json({
        error: 'CONFIRMATION_REQUIRED',
        message: 'Restore replaces ALL current data. Resend with confirm:true to proceed.',
      });
    }
    if (!fs.existsSync(slotFile(slot))) return res.status(404).json({ error: 'BACKUP_NOT_FOUND' });
    if (!(await toolsAvailable())) {
      return res.status(503).json({
        error: 'PG_TOOLS_UNAVAILABLE',
        message: 'PostgreSQL client tools (pg_restore) are not installed on the server.',
      });
    }
    try {
      const result = await restoreBackup(slot);
      await auditLog(req.user.id, 'backup.restored', {
        slot,
        prerestoreTakenAt: result.prerestore?.modifiedAt || null,
      });
      res.json({ restored: true, slot, prerestore: result.prerestore, backups: listBackups() });
    } catch (err) {
      res.status(500).json({ error: 'RESTORE_FAILED', message: err.message });
    }
  })
);

// GET /backup/download/:slot — hand the admin the raw .dump to keep off-site
// (e.g. on a pen drive). The browser can't attach the auth header to a plain
// link, so the UI fetches this with the token and saves the blob — the token is
// never placed in the URL.
router.get(
  '/download/:slot',
  requireAuth,
  requirePermission('can_manage_backups'),
  asyncHandler(async (req, res) => {
    const { slot } = req.params;
    if (!isValidSlot(slot)) return res.status(400).json({ error: 'INVALID_SLOT' });
    const file = slotFile(slot);
    if (!fs.existsSync(file)) return res.status(404).json({ error: 'BACKUP_NOT_FOUND' });
    const date = new Date().toISOString().slice(0, 10);
    res.download(file, `baps_hms_${slot}_${date}.dump`);
  })
);

module.exports = router;
