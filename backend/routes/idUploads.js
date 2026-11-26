/**
 * routes/idUploads.js
 *
 * Replaces the old Firebase-based QR upload flow. Everything happens on
 * the local network / local disk — no cloud account needed:
 *
 *   - POST /id-uploads/session      PC calls this to start a QR session
 *   - POST /id-uploads/:sessionId   Phone posts the photo here after scanning
 *     the QR (which encodes the frontend's own LAN URL, e.g.
 *     http://192.168.1.42:3000/upload-id/<sessionId>) — saved to local disk,
 *     then a Socket.io event tells the PC it's ready (reusing the socket
 *     connection the app already has, instead of a cloud realtime database).
 *   - POST /id-uploads/direct/upload  Same-device upload (Customer Portal, or
 *     Reception attaching a photo directly) — no session needed, returns
 *     the local file URL synchronously in the response.
 *
 * Sessions live in memory only (a Map). That's intentional: a QR code is
 * meant to be scanned within a minute or two of being shown, not persisted
 * across a server restart, so there's no need for a database table here.
 */

const express = require('express');
const multer = require('multer');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const pool = require('../db');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'id-photos');
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for "scan and snap"

function getCloudinaryConfig() {
  const cloudName = (process.env.CLOUDINARY_CLOUD_NAME || '').trim();
  const apiKey = (process.env.CLOUDINARY_API_KEY || '').trim();
  const apiSecret = (process.env.CLOUDINARY_API_SECRET || '').trim();
  if (!cloudName || !apiKey || !apiSecret) return null;
  return { cloudName, apiKey, apiSecret };
}

function signCloudinary(params, apiSecret) {
  const sorted = Object.keys(params)
    .sort()
    .map((k) => `${k}=${params[k]}`)
    .join('&');
  return crypto.createHash('sha1').update(`${sorted}${apiSecret}`).digest('hex');
}

async function uploadToCloudinary(file, publicId) {
  const cfg = getCloudinaryConfig();
  if (!cfg) return null;
  const timestamp = Math.floor(Date.now() / 1000);
  const folder = 'baps-hms-ids';
  const signature = signCloudinary({ folder, public_id: publicId, timestamp }, cfg.apiSecret);
  const buf = fs.readFileSync(file.path);
  const fd = new FormData();
  fd.append('file', new Blob([buf], { type: file.mimetype || 'image/jpeg' }), file.originalname || 'id.jpg');
  fd.append('api_key', cfg.apiKey);
  fd.append('timestamp', String(timestamp));
  fd.append('folder', folder);
  fd.append('public_id', publicId);
  fd.append('signature', signature);

  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/upload`, {
    method: 'POST',
    body: fd,
  });
  if (!res.ok) {
    const errText = await res.text().catch(() => '');
    throw new Error(`Cloudinary upload failed (${res.status}): ${errText}`);
  }
  const data = await res.json();
  try { fs.unlinkSync(file.path); } catch { /* remove temp local file */ }
  return data.secure_url;
}

function extractCloudinaryPublicId(url) {
  const m = /\/upload\/(?:v\d+\/)?(baps-hms-ids\/[^.?#]+?)(?:\.[a-z0-9]+)?(?:[?#]|$)/i.exec(String(url || ''));
  return m ? m[1] : null;
}

async function deleteFromCloudinary(url) {
  const cfg = getCloudinaryConfig();
  const publicId = extractCloudinaryPublicId(url);
  if (!cfg || !publicId) return false;
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = signCloudinary({ public_id: publicId, timestamp }, cfg.apiSecret);
  const fd = new FormData();
  fd.append('public_id', publicId);
  fd.append('api_key', cfg.apiKey);
  fd.append('timestamp', String(timestamp));
  fd.append('signature', signature);
  const res = await fetch(`https://api.cloudinary.com/v1_1/${cfg.cloudName}/image/destroy`, {
    method: 'POST',
    body: fd,
  });
  return res.ok;
}

// In-memory session store: sessionId -> { status, createdAt, imageUrl? }
const sessions = new Map();

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(UPLOAD_DIR, { recursive: true });
    cb(null, UPLOAD_DIR);
  },
  filename: (req, file, cb) => {
    // Use the session id (or a fresh random id for /direct) as the filename
    // so re-uploads to the same session simply overwrite the old photo.
    const id = req.params.sessionId || crypto.randomUUID();
    const ext = path.extname(file.originalname || '.jpg') || '.jpg';
    cb(null, `${id}${ext}`);
  },
});

const upload = multer({
  storage,
  limits: { fileSize: 10 * 1024 * 1024 }, // 10MB
  fileFilter: (req, file, cb) => {
    if (!file.mimetype.startsWith('image/')) {
      return cb(new Error('Only image files are allowed'));
    }
    cb(null, true);
  },
});

module.exports = function (io) {
  const router = express.Router();

  // GET /id-uploads/stats — count stored IDs + whether Cloudinary is active
  router.get('/stats', requireAuth, requirePermission('can_manage_backups'), async (req, res) => {
    try {
      const { rows } = await pool.query(
        `SELECT COUNT(*)::int AS count,
                MIN(checkin_date) AS oldest_date
         FROM bookings
         WHERE id_document_url IS NOT NULL AND id_document_url <> ''`
      );
      res.json({
        count: rows[0]?.count ?? 0,
        oldestDate: rows[0]?.oldest_date || null,
        cloudinaryConfigured: Boolean(getCloudinaryConfig()),
      });
    } catch (err) {
      res.status(500).json({ error: 'STATS_FAILED', message: err.message });
    }
  });

  // POST /id-uploads/purge — delete ID images for a specific month/year or before it
  // body: { year: 2026, month: 'ALL' | 1..12, mode: 'exact' | 'before' }
  router.post('/purge', requireAuth, requirePermission('can_manage_backups'), async (req, res) => {
    try {
      const year = parseInt(req.body?.year, 10);
      const rawMonth = req.body?.month;
      const mode = req.body?.mode === 'before' ? 'before' : 'exact';
      if (!Number.isFinite(year) || year < 2000 || year > 2100) {
        return res.status(400).json({ error: 'INVALID_YEAR', message: 'Please select a valid year.' });
      }

      let startDate;
      let endDate;
      if (rawMonth === 'ALL' || !rawMonth) {
        startDate = `${year}-01-01`;
        endDate = `${year + 1}-01-01`;
      } else {
        const m = parseInt(rawMonth, 10);
        if (!Number.isFinite(m) || m < 1 || m > 12) {
          return res.status(400).json({ error: 'INVALID_MONTH', message: 'Please select a valid month.' });
        }
        const mm = String(m).padStart(2, '0');
        startDate = `${year}-${mm}-01`;
        const nextY = m === 12 ? year + 1 : year;
        const nextM = String(m === 12 ? 1 : m + 1).padStart(2, '0');
        endDate = `${nextY}-${nextM}-01`;
      }

      const whereClause = mode === 'before'
        ? `checkin_date < $1`
        : `checkin_date >= $1 AND checkin_date < $2`;
      const params = mode === 'before' ? [startDate] : [startDate, endDate];

      const { rows } = await pool.query(
        `SELECT id, id_document_url FROM bookings
         WHERE id_document_url IS NOT NULL AND id_document_url <> '' AND ${whereClause}`,
        params
      );

      let deletedFiles = 0;
      for (const row of rows) {
        const url = row.id_document_url;
        if (/res\.cloudinary\.com/i.test(url)) {
          try { if (await deleteFromCloudinary(url)) deletedFiles++; } catch { /* ignore */ }
        } else if (url.startsWith('/uploads/id-photos/')) {
          const localPath = path.join(UPLOAD_DIR, path.basename(url));
          try { if (fs.existsSync(localPath)) { fs.unlinkSync(localPath); deletedFiles++; } } catch { /* ignore */ }
        }
      }

      if (rows.length > 0) {
        await pool.query(
          `UPDATE bookings SET id_document_url = NULL, updated_at = now() WHERE id = ANY($1::uuid[])`,
          [rows.map((r) => r.id)]
        );
      }

      res.json({ purged: rows.length, deletedFiles });
    } catch (err) {
      res.status(500).json({ error: 'PURGE_FAILED', message: err.message });
    }
  });

  /**
   * POST /id-uploads/session
   * Called by the PC (QRUploadTrigger.jsx) to start a new upload session.
   * The frontend builds the actual QR URL itself (it knows its own LAN
   * address); this endpoint just registers the session id so the later
   * upload can be validated.
   */
  router.post('/session', (req, res) => {
    cleanupExpiredSessions();
    const sessionId = crypto.randomUUID();
    sessions.set(sessionId, { status: 'pending', createdAt: Date.now() });
    res.status(201).json({ sessionId });
  });

  /**
   * POST /id-uploads/:sessionId
   * The phone posts the photo here (multipart/form-data, field name "photo")
   * after scanning the QR code. Saves to local disk, then emits a Socket.io
   * event so the PC's QRUploadTrigger updates immediately.
   */
  router.post('/:sessionId', (req, res) => {
    const { sessionId } = req.params;
    if (!sessions.has(sessionId)) {
      return res.status(404).json({ error: 'SESSION_NOT_FOUND_OR_EXPIRED' });
    }

    upload.single('photo')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'UPLOAD_FAILED', message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'NO_FILE_PROVIDED' });
      }

      let imageUrl = `/uploads/id-photos/${req.file.filename}`;
      try {
        const cloudUrl = await uploadToCloudinary(req.file, `qr_${sessionId}`);
        if (cloudUrl) imageUrl = cloudUrl;
      } catch (cloudErr) {
        return res.status(500).json({ error: 'CLOUD_UPLOAD_FAILED', message: cloudErr.message });
      }

      sessions.set(sessionId, { status: 'uploaded', createdAt: Date.now(), imageUrl });

      // Notify the PC in real time — same Socket.io connection the rest of
      // the app already uses, no separate realtime service needed.
      io.emit('id-upload:completed', { sessionId, imageUrl });

      res.status(201).json({ imageUrl });
    });
  });

  /**
   * GET /id-uploads/:sessionId
   * Optional polling fallback if a client can't use Socket.io for some
   * reason (e.g. a very restrictive phone browser).
   */
  router.get('/:sessionId', (req, res) => {
    const session = sessions.get(req.params.sessionId);
    if (!session) return res.status(404).json({ error: 'SESSION_NOT_FOUND_OR_EXPIRED' });
    res.json(session);
  });

  /**
   * POST /id-uploads/direct/upload
   * Same-device upload — Customer Portal (guest uploading from their own
   * phone/laptop) or Reception attaching a photo directly. No session
   * needed; returns the file URL synchronously.
   */
  router.post('/direct/upload', (req, res) => {
    upload.single('photo')(req, res, async (err) => {
      if (err) {
        return res.status(400).json({ error: 'UPLOAD_FAILED', message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'NO_FILE_PROVIDED' });
      }
      let imageUrl = `/uploads/id-photos/${req.file.filename}`;
      try {
        const cloudUrl = await uploadToCloudinary(req.file, `id_${crypto.randomUUID()}`);
        if (cloudUrl) imageUrl = cloudUrl;
      } catch (cloudErr) {
        return res.status(500).json({ error: 'CLOUD_UPLOAD_FAILED', message: cloudErr.message });
      }
      res.status(201).json({ imageUrl });
    });
  });

  return router;
};
