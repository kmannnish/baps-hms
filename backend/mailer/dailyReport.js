/**
 * mailer/dailyReport.js — composes and sends the daily operations email to
 * Swami Ji, plus the minute-tick scheduler that fires it once per day.
 *
 * PC-only: server.js runs the tick inside `if (!CLOUD_MODE)`. Every entry point
 * is wrapped so it can NEVER throw into the setInterval — a background worker
 * that throws would violate the crash-safety-net rule in CLAUDE.md.
 *
 * Opt-in + zero-budget: the feature stays completely dormant unless BOTH the
 * admin has turned `daily_report_enabled` on AND the PC's .env carries SMTP_*.
 * SMTP credentials are read only from process.env (via ./transport) — never the
 * database, never synced to the cloud.
 */

const { Writable } = require('stream');
const { createTransport, isMailConfigured, mailConfig } = require('./transport');
const { buildDailyReportPdf } = require('../pdf/dailyReport');
const { formatMoney, fmtDate } = require('../pdf/base');
const { getOccupancyCalendar, toDateStr } = require('../utils/occupancy');
const {
  revenueBetween,
  getRoomStatusOccupancy,
  getTodayActivity,
} = require('../utils/reportData');

// JSONB settings may hold a real boolean or a stringified one — accept both.
function truthy(v) {
  return v === true || v === 1 || v === 'true' || v === '1';
}

// 'HH:MM' -> minutes-since-midnight, or null if unparseable/out of range.
function parseHHMM(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

async function getSettingsMap(pool) {
  const { rows } = await pool.query(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function setSetting(pool, key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// Collect a PDFKit document (written by buildFn) into a single Buffer for use as
// an email attachment — no temp file on disk.
function renderPdfToBuffer(buildFn) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    const sink = new Writable({
      write(chunk, _enc, cb) {
        chunks.push(chunk);
        cb();
      },
    });
    sink.on('finish', () => resolve(Buffer.concat(chunks)));
    sink.on('error', reject);
    try {
      buildFn(sink);
    } catch (err) {
      reject(err);
    }
  });
}

// Recipient = the admin-set address if present, else — data-driven, never by
// role name — the active user whose role can APPROVE bookings but canNOT do
// check-in/check-out (i.e. the pure approver, "Swami Ji"), else any active user
// who can view reports. Returns null if nobody suitable has an email on file.
async function resolveRecipient(pool, settings) {
  const explicit = typeof settings.daily_report_recipient === 'string' ? settings.daily_report_recipient.trim() : '';
  if (explicit) return explicit;

  const { rows } = await pool.query(
    `SELECT u.email FROM users u
     WHERE u.is_active = true AND u.email IS NOT NULL AND btrim(u.email) <> ''
       AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                   WHERE rp.role_id = u.role_id AND p.key = 'can_approve_bookings')
       AND NOT EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                       WHERE rp.role_id = u.role_id AND p.key = 'can_checkin_checkout')
     ORDER BY u.created_at
     LIMIT 1`
  );
  if (rows[0]?.email) return rows[0].email.trim();

  const { rows: rows2 } = await pool.query(
    `SELECT u.email FROM users u
     WHERE u.is_active = true AND u.email IS NOT NULL AND btrim(u.email) <> ''
       AND EXISTS (SELECT 1 FROM role_permissions rp JOIN permissions p ON p.id = rp.permission_id
                   WHERE rp.role_id = u.role_id AND p.key = 'can_view_reports')
     ORDER BY u.created_at
     LIMIT 1`
  );
  return rows2[0]?.email ? rows2[0].email.trim() : null;
}

async function gatherReportData(pool) {
  const now = new Date();
  const today = toDateStr(now);
  const settings = await getSettingsMap(pool);

  const income = await revenueBetween(pool, today, today);
  const occupancy = await getRoomStatusOccupancy(pool);
  const activity = await getTodayActivity(pool);

  const tomorrow = new Date(now);
  tomorrow.setDate(tomorrow.getDate() + 1);
  const weekEnd = new Date(now);
  weekEnd.setDate(weekEnd.getDate() + 7);
  const calendar = await getOccupancyCalendar(pool, toDateStr(tomorrow), toDateStr(weekEnd));

  return { date: now, settings, income, occupancy, activity, calendar };
}

function composePlainText(data, orgName, dateStr) {
  const totalOccupied = data.occupancy.reduce((s, o) => s + (Number(o.occupied) || 0), 0);
  const totalRooms = data.occupancy.reduce((s, o) => s + (Number(o.total) || 0), 0);
  return [
    `${orgName} — Daily Operations Report`,
    dateStr,
    '',
    `Income today: ${formatMoney(data.income.revenue)} across ${data.income.bookings} stay(s)`,
    `Arrivals today: ${data.activity.arrivals.length}`,
    `Departures today: ${data.activity.departures.length}`,
    `Rooms occupied now: ${totalOccupied} of ${totalRooms}`,
    '',
    "The attached PDF has the full breakdown: occupancy by room type, today's",
    'arrivals and departures, and the next 7 days of bookings.',
    '',
    'Jai Swaminarayan',
  ].join('\n');
}

/**
 * Build + send the daily report now. Returns a plain result object (never
 * throws for the ordinary "not configured / no recipient" cases; a genuine
 * SMTP transport error WILL reject so callers can log it).
 *   { sent: true, to, messageId }
 *   { sent: false, error, message }
 * `transport` may be injected (e.g. nodemailer streamTransport) for offline tests.
 */
async function sendDailyReport(pool, { to = null, transport = null, reason = 'scheduled' } = {}) {
  const data = await gatherReportData(pool);
  const recipient = to || (await resolveRecipient(pool, data.settings));
  if (!recipient) {
    return {
      sent: false,
      error: 'NO_RECIPIENT',
      message: 'No recipient set. Add a Daily Report recipient in Settings, or an email on the approver user.',
    };
  }

  const tx = transport || createTransport();
  if (!tx) {
    return {
      sent: false,
      error: 'SMTP_NOT_CONFIGURED',
      message: 'SMTP is not configured in the PC .env (SMTP_HOST / SMTP_USER / SMTP_PASS).',
    };
  }

  const orgName = data.settings.org_name || 'BAPS Jaipur Utara';
  const dateStr = fmtDate(data.date);
  const pdf = await renderPdfToBuffer((sink) => buildDailyReportPdf(sink, data));
  const { from } = mailConfig();

  const info = await tx.sendMail({
    from: from || recipient,
    to: recipient,
    subject: `${orgName} — Daily Report, ${dateStr}`,
    text: composePlainText(data, orgName, dateStr),
    attachments: [
      {
        filename: `daily-report-${toDateStr(data.date)}.pdf`,
        content: pdf,
        contentType: 'application/pdf',
      },
    ],
  });

  return { sent: true, to: recipient, messageId: info?.messageId || null, reason };
}

// In-process guard so a slow send can't overlap the next minute-tick.
let running = false;

/**
 * Minute-tick entry point (called by server.js every 60s on the PC). Fires the
 * report once when: the feature is enabled, SMTP is configured, the clock has
 * reached the configured time, and it hasn't already sent today (persisted in
 * the server-only `daily_report_last_sent` settings row, so a restart can't
 * double-send). Swallows all errors — must never throw into setInterval.
 */
async function runDailyReportIfDue(pool) {
  if (running) return;
  try {
    if (!isMailConfigured()) return; // dormant: no SMTP on this PC
    const settings = await getSettingsMap(pool);
    if (!truthy(settings.daily_report_enabled)) return;

    const target = parseHHMM(settings.daily_report_time || '20:00');
    if (target == null) return;

    const now = new Date();
    const today = toDateStr(now);
    if (settings.daily_report_last_sent === today) return; // already sent today

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < target) return; // not time yet (also catches up after a late start)

    running = true;
    const result = await sendDailyReport(pool, { reason: 'scheduled' });
    if (result.sent) {
      await setSetting(pool, 'daily_report_last_sent', today);
      console.log(`[dailyReport] sent to ${result.to} for ${today}`);
    } else {
      // Not fatal — log and let a later tick retry (e.g. recipient added later).
      console.warn(`[dailyReport] not sent (${result.error}): ${result.message || ''}`);
    }
  } catch (err) {
    console.error('[dailyReport] runDailyReportIfDue failed (ignored):', err);
  } finally {
    running = false;
  }
}

module.exports = {
  runDailyReportIfDue,
  sendDailyReport,
  gatherReportData,
  resolveRecipient,
  // exported for unit tests
  parseHHMM,
  truthy,
};
