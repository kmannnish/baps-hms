/**
 * routes/bhojan.js — Bhojanshala (dining hall) head-count for the live Current
 * Guests view and the manual "notify the kitchen" action.
 *
 *   GET  /bhojan/today   live dining data (per-meal M/F/K totals + guest-wise)
 *   POST /bhojan/send    send today's count to the Bhojanshala department now
 *
 * The data layer (utils/bhojanData) and the email/wa.me layer (mailer/
 * bhojanReport) are shared with the once-a-day scheduler in server.js, so the
 * screen, the manual send, and the automatic send can never show different
 * numbers. Plain router (no io) — mounted PC-only, like /settings.
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');
const { getDiningData } = require('../utils/bhojanData');
const { sendBhojanReport, buildWhatsAppUrl } = require('../mailer/bhojanReport');

const pool = require('../db');
const router = express.Router();

// Live dining counts for today. Any signed-in staff member may read it (it
// drives the Current Guests dining panel, which Reception uses).
router.get('/today', requireAuth, asyncHandler(async (req, res) => {
  const data = await getDiningData(pool);
  const { rows } = await pool.query(
    `SELECT key, value FROM settings WHERE key IN ('org_name', 'bhojanshala_mobile')`
  );
  const settings = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const orgName = settings.org_name || 'BAPS Jaipur Utara';
  const dateStr = data.date
    ? new Date(`${data.date}T00:00:00`).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' })
    : '';
  const whatsappUrl = buildWhatsAppUrl(settings, data, orgName, dateStr);
  res.json({ ...data, whatsappUrl });
}));

// Send today's count to the Bhojanshala department right now. This is the desk
// "notify the kitchen" button AND the resend when a guest arrives after the
// automatic email already went out, so it deliberately does NOT touch
// bhojan_report_last_sent (the scheduler owns that marker).
//
// sendBhojanReport never rejects for the ordinary failures (no recipient, SMTP
// not configured, or a transport error): it returns { sent:false, error,
// message, whatsappUrl } so the frontend can fall back to the WhatsApp button.
// Gated on check-in/out so the same people who manage arrivals can notify.
router.post('/send', requireAuth, requirePermission('can_checkin_checkout'), asyncHandler(async (req, res) => {
  const result = await sendBhojanReport(pool, { reason: 'manual' });
  res.json(result);
}));

module.exports = router;
