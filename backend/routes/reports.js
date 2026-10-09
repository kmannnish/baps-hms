/**
 * routes/reports.js
 */

const express = require('express');
const { requireAuth } = require('../middleware/requireAuth');
const { requirePermission } = require('../middleware/requirePermission');
const { asyncHandler } = require('../utils/asyncHandler');
const {
  revenueBetween,
  getRoomStatusOccupancy,
  getTodayCounts,
  getMonthlyTrend,
} = require('../utils/reportData');
const { sendDailyReport } = require('../mailer/dailyReport');
const { isMailConfigured } = require('../mailer/transport');

const pool = require('../db');

module.exports = function () {
  const router = express.Router();

  router.get('/stats', requireAuth, requirePermission('can_view_reports'), asyncHandler(async (req, res) => {
    const { from, to } = req.query;

    const occupancy = await getRoomStatusOccupancy(pool);

    const today = new Date().toISOString().slice(0, 10);
    const weekAgo = new Date(Date.now() - 7 * 86400000).toISOString().slice(0, 10);
    const monthAgo = new Date(Date.now() - 30 * 86400000).toISOString().slice(0, 10);

    const [revenueToday, revenueWeek, revenueMonth, revenueCustom] = await Promise.all([
      revenueBetween(pool, today, today),
      revenueBetween(pool, weekAgo, today),
      revenueBetween(pool, monthAgo, today),
      from && to ? revenueBetween(pool, from, to) : Promise.resolve(null),
    ]);

    const monthlyTrend = await getMonthlyTrend(pool);
    const todayCounts = await getTodayCounts(pool);

    const totalOccupied = occupancy.reduce((s, o) => s + o.occupied, 0);
    const totalRooms = occupancy.reduce((s, o) => s + o.total, 0);

    res.json({
      occupancy,
      revenue: {
        today: revenueToday,
        last7Days: revenueWeek,
        last30Days: revenueMonth,
        custom: revenueCustom,
      },
      monthlyTrend,
      todayCheckins: todayCounts.today_checkins ?? 0,
      todayCheckouts: todayCounts.today_checkouts ?? 0,
      pendingWalkins: todayCounts.pending_walkins ?? 0,
      totalOccupied,
      totalRooms,
    });
  }));

  // POST /reports/daily-email/test — send the daily report email right now so the
  // admin can confirm their SMTP (Gmail App Password) works without waiting for
  // the scheduled time. Admin-only. Optional { to } overrides the recipient just
  // for this test. SMTP creds come from the PC's .env (never the DB).
  router.post('/daily-email/test', requireAuth, requirePermission('can_manage_settings'), asyncHandler(async (req, res) => {
    if (!isMailConfigured()) {
      return res.status(400).json({
        error: 'SMTP_NOT_CONFIGURED',
        message: 'Set SMTP_HOST, SMTP_USER and SMTP_PASS in the Reception PC\'s .env, then restart the server.',
      });
    }
    const to = typeof req.body?.to === 'string' && req.body.to.trim() ? req.body.to.trim() : null;
    const result = await sendDailyReport(pool, { to, reason: 'manual-test' });
    if (!result.sent) {
      return res.status(400).json({ error: result.error || 'SEND_FAILED', message: result.message || null });
    }
    res.json({ sent: true, to: result.to, messageId: result.messageId || null });
  }));

  // GET /reports/audit-log
  router.get('/audit-log', requireAuth, requirePermission('can_view_audit_log'), asyncHandler(async (req, res) => {
    const { from, to, action, entityType, limit } = req.query;
    const maxRows = Math.min(Number(limit) || 200, 500);

    const { rows } = await pool.query(
      `SELECT al.*, u.full_name AS actor_name
       FROM audit_log al
       LEFT JOIN users u ON u.id = al.actor_id
       WHERE ($1::date IS NULL OR al.created_at >= $1)
         AND ($2::date IS NULL OR al.created_at <= ($2::date + INTERVAL '1 day'))
         AND ($3::text IS NULL OR al.action = $3)
         AND ($4::text IS NULL OR al.entity_type = $4)
       ORDER BY al.created_at DESC
       LIMIT $5`,
      [from || null, to || null, action || null, entityType || null, maxRows]
    );
    res.json(rows);
  }));

  // GET /reports/export — CSV download
  router.get('/export', requireAuth, requirePermission('can_view_reports'), asyncHandler(async (req, res) => {
    const { from, to, status, channel, roomTypeId, search } = req.query;

    const { rows } = await pool.query(
      `SELECT b.guest_name, b.mobile, b.channel, b.status, b.num_rooms,
              b.pax_men, b.pax_women, b.pax_children,
              b.checkin_date, b.checkout_date,
              rt.name AS room_type, r.room_number,
              b.billing_tier, b.discount_percent, b.final_amount,
              b.amount_paid, b.payment_status,
              b.sant_reference_name, b.approval_note,
              b.created_at
       FROM bookings b
       JOIN room_types rt ON rt.id = b.room_type_id
       LEFT JOIN rooms r ON r.id = b.room_id
       WHERE ($1::date IS NULL OR b.checkin_date >= $1)
         AND ($2::date IS NULL OR b.checkin_date <= $2)
         AND ($3::text IS NULL OR b.status = $3)
         AND ($4::text IS NULL OR b.channel = $4)
         AND ($5::uuid IS NULL OR b.room_type_id = $5)
         AND ($6::text IS NULL OR b.guest_name ILIKE '%' || $6 || '%' OR b.mobile ILIKE '%' || $6 || '%')
       ORDER BY b.created_at DESC
       LIMIT 5000`,
      [from || null, to || null, status || null, channel || null, roomTypeId || null, search || null]
    );

    const headers = [
      'Guest', 'Mobile', 'Channel', 'Status', 'Rooms', 'Men', 'Women', 'Children',
      'Check-in', 'Check-out', 'Room Type', 'Room', 'Billing Tier', 'Discount %',
      'Amount', 'Paid', 'Payment Status', 'Sant Reference', 'Approval Note', 'Created'
    ];

    const csvEscape = (val) => {
      if (val == null) return '';
      const s = String(val);
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? '"' + s.replace(/"/g, '""') + '"'
        : s;
    };

    const csvRows = rows.map((r) => [
      r.guest_name, r.mobile, r.channel, r.status, r.num_rooms,
      r.pax_men, r.pax_women, r.pax_children,
      r.checkin_date ? new Date(r.checkin_date).toISOString().slice(0, 10) : '',
      r.checkout_date ? new Date(r.checkout_date).toISOString().slice(0, 10) : '',
      r.room_type, r.room_number || '',
      r.billing_tier || '', r.discount_percent || 0,
      r.final_amount || 0, r.amount_paid || 0, r.payment_status || '',
      r.sant_reference_name || '', r.approval_note || '',
      r.created_at ? new Date(r.created_at).toISOString() : '',
    ].map(csvEscape).join(','));

    const csv = [headers.join(','), ...csvRows].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="bookings-export.csv"');
    res.send(csv);
  }));

  return router;
};
