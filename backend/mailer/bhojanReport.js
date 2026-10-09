/**
 * mailer/bhojanReport.js — composes and sends the daily Bhojanshala (dining
 * hall) head-count email, plus the minute-tick scheduler that fires it once per
 * day, plus a wa.me fallback the desk can use when email isn't configured/fails.
 *
 * Same discipline as mailer/dailyReport.js:
 *   • PC-only: server.js runs the tick inside `if (!CLOUD_MODE)`.
 *   • Opt-in + zero-budget: dormant unless the admin turned `bhojan_report_enabled`
 *     ON *and* the PC's .env carries SMTP_*. SMTP creds come only from process.env
 *     (via ./transport) — never the database, never synced to the cloud.
 *   • Every entry point is wrapped so it can NEVER throw into the setInterval.
 */

const { createTransport, isMailConfigured, mailConfig } = require('./transport');
const { getDiningData, getSettingsMap, parseHHMM, MEALS } = require('../utils/bhojanData');
const { fmtDate } = require('../pdf/base');
const { toDateStr } = require('../utils/occupancy');

function truthy(v) {
  return v === true || v === 1 || v === 'true' || v === '1';
}

// 'YYYY-MM-DD' -> "02 Oct 2026", parsed as a LOCAL calendar day (not UTC
// midnight) so it never shifts a day regardless of server timezone.
function displayDate(ymd) {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(ymd || ''));
  return m ? fmtDate(new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]))) : fmtDate(ymd);
}

async function setSetting(pool, key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

// The Bhojanshala department address is admin-set; there is no user-based
// fallback (it's a kitchen inbox, not a staff member).
function resolveRecipient(settings) {
  const v = typeof settings.bhojanshala_email === 'string' ? settings.bhojanshala_email.trim() : '';
  return v || null;
}

const MEAL_LABEL = { breakfast: 'Breakfast', lunch: 'Lunch', dinner: 'Dinner' };

function mealLine(label, m) {
  return `${label.padEnd(10)} ${String(m.total).padStart(3)}  (M ${m.men} / W ${m.women} / K ${m.children})`;
}

function composePlainText(data, orgName, dateStr) {
  const lines = [
    `${orgName} — Bhojanshala Count`,
    dateStr,
    '',
    'Expected meals today:',
    ...MEALS.map((meal) => mealLine(MEAL_LABEL[meal], data.meals[meal])),
    '',
  ];
  if (data.guests.length) {
    lines.push('Guest-wise:');
    for (const g of data.guests) {
      const tags = MEALS.filter((meal) => g[meal]).map((meal) => MEAL_LABEL[meal][0]).join('/') || '—';
      lines.push(`  • ${g.name} (${g.rooms}): ${g.total} pax [${tags}]`);
    }
  } else {
    lines.push('No guests are currently checked in.');
  }
  lines.push('', 'Jai Swaminarayan');
  return lines.join('\n');
}

function composeHtml(data, orgName, dateStr) {
  const cell = 'padding:6px 10px;border:1px solid #ddd;';
  const mealRows = MEALS.map((meal) => {
    const m = data.meals[meal];
    return `<tr><td style="${cell}"><b>${MEAL_LABEL[meal]}</b></td><td style="${cell}text-align:center">${m.total}</td><td style="${cell}text-align:center">${m.men}</td><td style="${cell}text-align:center">${m.women}</td><td style="${cell}text-align:center">${m.children}</td></tr>`;
  }).join('');
  const guestRows = data.guests.length
    ? data.guests
        .map((g) => {
          const tags = MEALS.filter((meal) => g[meal]).map((meal) => MEAL_LABEL[meal]).join(', ') || '—';
          return `<tr><td style="${cell}">${g.name}</td><td style="${cell}">${g.rooms}</td><td style="${cell}text-align:center">${g.total}</td><td style="${cell}">${tags}</td></tr>`;
        })
        .join('')
    : `<tr><td style="${cell}" colspan="4">No guests are currently checked in.</td></tr>`;
  return `
    <div style="font-family:Arial,Helvetica,sans-serif;color:#2B1610">
      <h2 style="margin:0 0 4px">${orgName} — Bhojanshala Count</h2>
      <p style="margin:0 0 16px;color:#777">${dateStr}</p>
      <table style="border-collapse:collapse;margin-bottom:20px">
        <thead><tr>
          <th style="${cell}background:#F8F4EC">Meal</th>
          <th style="${cell}background:#F8F4EC">Total</th>
          <th style="${cell}background:#F8F4EC">Male</th>
          <th style="${cell}background:#F8F4EC">Female</th>
          <th style="${cell}background:#F8F4EC">Kids</th>
        </tr></thead>
        <tbody>${mealRows}</tbody>
      </table>
      <table style="border-collapse:collapse">
        <thead><tr>
          <th style="${cell}background:#F8F4EC">Guest</th>
          <th style="${cell}background:#F8F4EC">Room(s)</th>
          <th style="${cell}background:#F8F4EC">Pax</th>
          <th style="${cell}background:#F8F4EC">Meals</th>
        </tr></thead>
        <tbody>${guestRows}</tbody>
      </table>
      <p style="margin-top:20px">Jai Swaminarayan</p>
    </div>`;
}

// wa.me needs a country-coded number with no punctuation. We don't assume a
// country — the admin stores the full number (e.g. 9198...). Returns null when
// no number is configured.
function buildWhatsAppUrl(settings, data, orgName, dateStr) {
  const raw = typeof settings.bhojanshala_mobile === 'string' ? settings.bhojanshala_mobile.trim() : '';
  const digits = raw.replace(/[^\d]/g, '');
  if (!digits) return null;
  const summary = [
    `${orgName} — Bhojanshala Count`,
    dateStr,
    ...MEALS.map((meal) => `${MEAL_LABEL[meal]}: ${data.meals[meal].total} (M${data.meals[meal].men}/W${data.meals[meal].women}/K${data.meals[meal].children})`),
  ].join('\n');
  return `https://wa.me/${digits}?text=${encodeURIComponent(summary)}`;
}

/**
 * Build + send the Bhojanshala email now. Never throws for the ordinary
 * "not configured / no recipient" cases — it returns a result object that also
 * carries a `whatsappUrl` fallback (when a number is set) so the caller can
 * offer a WhatsApp button. A genuine SMTP transport error DOES reject so
 * callers can log it.
 */
async function sendBhojanReport(pool, { to = null, transport = null, reason = 'manual' } = {}) {
  const data = await getDiningData(pool);
  const settings = await getSettingsMap(pool);
  const orgName = settings.org_name || 'BAPS Jaipur Utara';
  const dateStr = displayDate(data.date);
  const whatsappUrl = buildWhatsAppUrl(settings, data, orgName, dateStr);

  const recipient = to || resolveRecipient(settings);
  if (!recipient) {
    return {
      sent: false,
      error: 'NO_RECIPIENT',
      message: 'No Bhojanshala email set. Add it in Settings, or use the WhatsApp button.',
      whatsappUrl,
      data,
    };
  }

  const tx = transport || createTransport();
  if (!tx) {
    return {
      sent: false,
      error: 'SMTP_NOT_CONFIGURED',
      message: 'SMTP is not configured in the PC .env (SMTP_HOST / SMTP_USER / SMTP_PASS). Use the WhatsApp button instead.',
      whatsappUrl,
      data,
    };
  }

  const { from } = mailConfig();
  let info;
  try {
    info = await tx.sendMail({
      from: from || recipient,
      to: recipient,
      subject: `${orgName} — Bhojanshala Count, ${dateStr}`,
      text: composePlainText(data, orgName, dateStr),
      html: composeHtml(data, orgName, dateStr),
    });
  } catch (err) {
    // A real transport failure (bad credentials, network down). Don't reject —
    // hand the caller the WhatsApp fallback so the desk can still notify the
    // kitchen; the scheduler logs result.error on its own.
    return {
      sent: false,
      error: 'SEND_FAILED',
      message: err?.message || 'Email failed to send.',
      whatsappUrl,
      data,
    };
  }

  return { sent: true, to: recipient, messageId: info?.messageId || null, reason, whatsappUrl, data };
}

// In-process guard so a slow send can't overlap the next minute-tick.
let running = false;

/**
 * Minute-tick entry point (called by server.js every 60s on the PC). Fires once
 * per day when: the feature is enabled, SMTP is configured, the clock has
 * reached bhojan_report_time, and it hasn't already sent today (persisted in the
 * server-only bhojan_report_last_sent row). Swallows all errors.
 */
async function runBhojanReportIfDue(pool) {
  if (running) return;
  try {
    if (!isMailConfigured()) return; // dormant: no SMTP on this PC
    const settings = await getSettingsMap(pool);
    if (!truthy(settings.bhojan_report_enabled)) return;
    if (!resolveRecipient(settings)) return; // no address yet

    const target = parseHHMM(settings.bhojan_report_time || '06:30');
    if (target == null) return;

    const now = new Date();
    const today = toDateStr(now);
    if (settings.bhojan_report_last_sent === today) return; // already sent today

    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < target) return;

    running = true;
    const result = await sendBhojanReport(pool, { reason: 'scheduled' });
    if (result.sent) {
      await setSetting(pool, 'bhojan_report_last_sent', today);
      console.log(`[bhojanReport] sent to ${result.to} for ${today}`);
    } else {
      console.warn(`[bhojanReport] not sent (${result.error}): ${result.message || ''}`);
    }
  } catch (err) {
    console.error('[bhojanReport] runBhojanReportIfDue failed (ignored):', err);
  } finally {
    running = false;
  }
}

module.exports = {
  runBhojanReportIfDue,
  sendBhojanReport,
  buildWhatsAppUrl,
  resolveRecipient,
  truthy,
};
