/**
 * routes/settings.js
 */

const express = require('express');
const path = require('path');
const fs = require('fs');
const multer = require('multer');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');

const pool = require('../db');
const router = express.Router();

const soundStorage = multer.diskStorage({
  destination: path.join(__dirname, '../uploads/sounds'),
  filename: (req, file, cb) => {
    const safe = file.originalname.replace(/[^a-zA-Z0-9._-]/g, '_');
    cb(null, `${Date.now()}_${safe}`);
  },
});
const uploadSound = multer({ storage: soundStorage, limits: { fileSize: 5 * 1024 * 1024 } });

// Branding logo → local disk (served by the existing /uploads static mount at
// /uploads/branding/<file>). Same disk-only, no-cloud approach as ID photos.
const BRANDING_DIR = path.join(__dirname, '../uploads/branding');
try {
  fs.mkdirSync(BRANDING_DIR, { recursive: true });
} catch {
  /* dir already exists / created on first upload */
}
const logoStorage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, BRANDING_DIR),
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '.png') || '.png';
    cb(null, `logo_${Date.now()}${ext}`);
  },
});
const uploadLogo = multer({
  storage: logoStorage,
  limits: { fileSize: 3 * 1024 * 1024 },
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) return cb(new Error('Only image files are allowed'));
    cb(null, true);
  },
});

// Keys that must NOT be exposed on the PUBLIC GET / (the customer form and
// pre-login screens read that unauthenticated, and /settings is also mounted in
// CLOUD_MODE on the public internet). The recipient email and the server-only
// last-sent markers are read by the admin UI through the authenticated GET
// /manage. The Bhojanshala number is never sent to the browser raw — the
// /bhojan/send endpoint returns a ready wa.me link instead.
const PRIVATE_SETTING_KEYS = new Set([
  'daily_report_recipient',
  'daily_report_last_sent',
  'bhojanshala_email',
  'bhojanshala_mobile',
  'bhojan_report_last_sent',
  // Backup scheduler bookkeeping — set by the server after each run, read only
  // by the Backup tab (via GET /backup). Not useful or wanted on the public blob.
  'backup_daily_last_run',
  'backup_weekly_last_run',
  'backup_monthly_last_run',
]);

// Public: everything except the private keys above.
router.get('/', asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT key, value FROM settings`);
  const out = {};
  for (const r of rows) {
    if (!PRIVATE_SETTING_KEYS.has(r.key)) out[r.key] = r.value;
  }
  res.json(out);
}));

// Authenticated full read for the admin Settings UI (includes the private keys).
router.get('/manage', requireAuth, requirePermission('can_manage_settings'), asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT key, value FROM settings`);
  res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
}));

const EDITABLE_KEYS = new Set([
  'default_checkin_time',
  'default_checkout_time',
  'gst_percent',
  'tax_enabled',
  'overstay_warning_minutes',
  'terms_and_conditions',
  'whatsapp_templates',
  'notification_checkout_warning_minutes',
  'notification_sound_id',
  'late_checkout_rate_per_hour',
  'extra_bed_rate',
  // Bill / invoice branding (shown on the PDF header — see pdf/receipt.js).
  'org_name',
  'org_address',
  'org_gstin',
  'org_phone',
  'org_email',
  'invoice_prefix',
  'org_logo_url',
  // Daily email report (see mailer/dailyReport.js). SMTP credentials live in
  // the PC's .env only — never here, never synced to the cloud.
  'daily_report_enabled',
  'daily_report_time',
  'daily_report_recipient',
  // Bhojanshala (dining hall) — meal timings drive the dynamic "current meal"
  // view; the rest configure the optional daily head-count email + wa.me
  // fallback (bhojan_report_last_sent is server-only, set by the scheduler, so
  // it is intentionally NOT editable here).
  'bhojan_breakfast_time',
  'bhojan_lunch_time',
  'bhojan_dinner_time',
  'bhojan_report_enabled',
  'bhojan_report_time',
  'bhojanshala_email',
  'bhojanshala_mobile',
  // Admin toggle: let the Reception desk approve on Swami Ji's behalf.
  'reception_approve_on_behalf',
]);

router.put('/', requireAuth, requirePermission('can_manage_settings'), asyncHandler(async (req, res) => {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    for (const [key, value] of Object.entries(req.body)) {
      if (!EDITABLE_KEYS.has(key)) continue;
      await client.query(
        `INSERT INTO settings (key, value, updated_by, updated_at)
         VALUES ($1, $2, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = $2, updated_by = $3, updated_at = now()`,
        [key, JSON.stringify(value), req.user.id]
      );
    }
    await client.query('COMMIT');
    const { rows } = await client.query(`SELECT key, value FROM settings`);
    res.json(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}));

// ---- Notification sounds -------------------------------------------------
router.get('/notification-sounds', requireAuth, asyncHandler(async (req, res) => {
  const { rows } = await pool.query(`SELECT * FROM notification_sounds ORDER BY created_at DESC`);
  res.json(rows);
}));

router.post('/notification-sound', requireAuth, requirePermission('can_manage_notifications'),
  uploadSound.single('sound'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const label = req.body.label || req.file.originalname;
    const { rows } = await pool.query(
      `INSERT INTO notification_sounds (label, filename) VALUES ($1, $2) RETURNING *`,
      [label, req.file.filename]
    );
    res.status(201).json(rows[0]);
  })
);

// ---- Branding logo upload ------------------------------------------------
router.post('/branding-logo', requireAuth, requirePermission('can_manage_settings'),
  uploadLogo.single('logo'),
  asyncHandler(async (req, res) => {
    if (!req.file) return res.status(400).json({ error: 'NO_FILE' });
    const url = `/uploads/branding/${req.file.filename}`;
    await pool.query(
      `INSERT INTO settings (key, value, updated_by, updated_at)
       VALUES ('org_logo_url', $1, $2, now())
       ON CONFLICT (key) DO UPDATE SET value = $1, updated_by = $2, updated_at = now()`,
      [JSON.stringify(url), req.user.id]
    );
    res.status(201).json({ org_logo_url: url });
  })
);

module.exports = router;
