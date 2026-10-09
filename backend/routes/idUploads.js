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
const crypto = require('crypto');

const UPLOAD_DIR = path.join(__dirname, '..', 'uploads', 'id-photos');
const SESSION_TTL_MS = 10 * 60 * 1000; // 10 minutes — plenty for "scan and snap"

// In-memory session store: sessionId -> { status, createdAt, imageUrl? }
const sessions = new Map();

function cleanupExpiredSessions() {
  const now = Date.now();
  for (const [id, session] of sessions) {
    if (now - session.createdAt > SESSION_TTL_MS) sessions.delete(id);
  }
}

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, UPLOAD_DIR),
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

    upload.single('photo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: 'UPLOAD_FAILED', message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'NO_FILE_PROVIDED' });
      }

      const imageUrl = `/uploads/id-photos/${req.file.filename}`;
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
    upload.single('photo')(req, res, (err) => {
      if (err) {
        return res.status(400).json({ error: 'UPLOAD_FAILED', message: err.message });
      }
      if (!req.file) {
        return res.status(400).json({ error: 'NO_FILE_PROVIDED' });
      }
      res.status(201).json({ imageUrl: `/uploads/id-photos/${req.file.filename}` });
    });
  });

  return router;
};
