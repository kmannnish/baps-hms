/**
 * utils/backupScheduler.js — the minute-tick that fires automatic backups.
 *
 * Mirrors mailer/dailyReport.js's runDailyReportIfDue exactly: self-gating,
 * NEVER throws into setInterval (a background worker that throws would violate
 * the crash-safety-net rule in CLAUDE.md), and persists a per-cadence last-run
 * DATE so a restart — or several ticks in the same minute — can't double-run.
 *
 * PC-only: server.js runs this inside `if (!CLOUD_MODE)`. The cloud backend has
 * no business dumping the PC's local database.
 *
 * Admin controls (settings rows, all set from the Backup tab):
 *   backup_enabled          master on/off for ALL automatic backups
 *   backup_daily_enabled    } which cadences run
 *   backup_weekly_enabled   }
 *   backup_monthly_enabled  }
 *   backup_time             'HH:MM' — the earliest time of day a backup may run
 *   backup_weekly_day       0..6 (Sun..Sat) the weekly backup runs on
 *   backup_monthly_day      1..28 the monthly backup runs on
 * Server-only markers (never editable; set here after a successful run):
 *   backup_daily_last_run / backup_weekly_last_run / backup_monthly_last_run
 */

const { createBackup } = require('./backup');

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

// Local calendar date 'YYYY-MM-DD' (NOT UTC — the admin's clock is the PC's).
function toLocalDateStr(d) {
  const x = new Date(d);
  return `${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}-${String(x.getDate()).padStart(2, '0')}`;
}

function clampInt(v, lo, hi, dflt) {
  const n = Number(v);
  if (!Number.isFinite(n)) return dflt;
  return Math.min(hi, Math.max(lo, Math.trunc(n)));
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

// Run one cadence. A failure is logged but does NOT set the marker, so the next
// tick retries — and one failing cadence never blocks the others.
async function runSlot(pool, slot, markerKey, today) {
  try {
    const b = await createBackup(slot);
    await setSetting(pool, markerKey, today);
    console.log(`[backup] ${slot} backup written (${b.sizeBytes} bytes)`);
  } catch (err) {
    console.error(`[backup] ${slot} backup failed (will retry next tick):`, err.message);
  }
}

// In-process guard so a slow dump can't overlap the next minute-tick.
let running = false;

/**
 * Minute-tick entry point (called by server.js every 60s on the PC). Writes any
 * cadence that is enabled, due today, and past the configured time and hasn't
 * already run today. Swallows all errors — must never throw into setInterval.
 */
async function runBackupIfDue(pool) {
  if (running) return;
  try {
    const s = await getSettingsMap(pool);
    if (!truthy(s.backup_enabled)) return; // feature off entirely

    const target = parseHHMM(s.backup_time || '02:00');
    if (target == null) return;

    const now = new Date();
    const today = toLocalDateStr(now);
    const nowMinutes = now.getHours() * 60 + now.getMinutes();
    if (nowMinutes < target) return; // not time yet (also catches up after a late start)

    running = true;

    // DAILY — every day once past the set time.
    if (truthy(s.backup_daily_enabled) && s.backup_daily_last_run !== today) {
      await runSlot(pool, 'daily', 'backup_daily_last_run', today);
    }

    // WEEKLY — only on the chosen weekday (0=Sun..6=Sat; default Sunday).
    const wday = clampInt(s.backup_weekly_day, 0, 6, 0);
    if (truthy(s.backup_weekly_enabled) && now.getDay() === wday && s.backup_weekly_last_run !== today) {
      await runSlot(pool, 'weekly', 'backup_weekly_last_run', today);
    }

    // MONTHLY — only on the chosen day-of-month (clamped to 28 so every month
    // reaches it; default the 1st).
    const dom = clampInt(s.backup_monthly_day, 1, 28, 1);
    if (truthy(s.backup_monthly_enabled) && now.getDate() === dom && s.backup_monthly_last_run !== today) {
      await runSlot(pool, 'monthly', 'backup_monthly_last_run', today);
    }
  } catch (err) {
    console.error('[backup] runBackupIfDue failed (ignored):', err);
  } finally {
    running = false;
  }
}

module.exports = {
  runBackupIfDue,
  // exported for unit tests
  truthy,
  parseHHMM,
  toLocalDateStr,
  clampInt,
};
