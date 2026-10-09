/**
 * lib/datetime.js — shared, null-safe date/time formatters for the UI.
 *
 * Mirrors backend pdf/base.js so the screen and the printed/emailed PDF read
 * identically. The whole reason this exists: checkin_date / checkout_date are
 * DATE columns, so they arrive as 'YYYY-MM-DD' (or an ISO string at local
 * midnight) and several screens used to render them raw — leaking "00:00" or
 * "T00:00:00". These helpers render ONLY the calendar day for DATE values, use
 * fmtStamp for real timestamps, and ALWAYS return '—' for null/invalid instead
 * of throwing.
 */

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// Parse a DATE value without timezone drift: a bare 'YYYY-MM-DD' is a LOCAL
// calendar day (what the DATE column means), not a UTC instant.
function parseDateOnly(d) {
  if (d == null || d === '') return null;
  if (d instanceof Date) return Number.isNaN(d.getTime()) ? null : d;
  const s = String(d);
  const m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  const dt = new Date(s);
  return Number.isNaN(dt.getTime()) ? null : dt;
}

// '29 Sep 2026' — calendar day only, never a time.
export function fmtDate(d) {
  const dt = parseDateOnly(d);
  if (!dt) return '—';
  return `${String(dt.getDate()).padStart(2, '0')} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// 'YYYY-MM-DD' for an <input type="date"> value. DATE columns arrive from the
// API as an ISO timestamp at midnight (e.g. '2026-10-05T00:00:00.000Z'), which
// a date input silently rejects — it accepts ONLY 'YYYY-MM-DD' — and renders
// blank, so the picker looks empty even though the booking has dates. This
// returns just the calendar day (the same day fmtDate shows, drift-free) so the
// input is pre-filled, or '' for null/invalid so it renders empty by design.
export function toDateInput(d) {
  const dt = parseDateOnly(d);
  if (!dt) return '';
  return `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
}

// 'HH:MM' / 'HH:MM:SS' clock string -> '2:00 PM'. '' for null (so callers can
// conditionally append it).
export function fmtTime(t) {
  if (!t) return '';
  const m = String(t).match(/^(\d{1,2}):(\d{2})/);
  if (!m) return '';
  let h = Number(m[1]);
  const min = m[2];
  const ap = h >= 12 ? 'PM' : 'AM';
  h %= 12;
  if (h === 0) h = 12;
  return `${h}:${min} ${ap}`;
}

// '29 Sep 2026, 2:00 PM' — a DATE plus a scheduled clock time. '—' if no date.
export function fmtDateTime(d, t) {
  const date = fmtDate(d);
  if (date === '—') return '—';
  const time = fmtTime(t);
  return time ? `${date}, ${time}` : date;
}

// A real TIMESTAMPTZ -> '29 Sep 2026, 3:40 PM' (local). '—' for null/invalid.
export function fmtStamp(ts) {
  if (!ts) return '—';
  const dt = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(dt.getTime())) return '—';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${fmtDate(dt)}, ${fmtTime(`${hh}:${mm}`)}`;
}

// App-wide scheduled-vs-actual rule, shape-agnostic (pass explicit values):
//   - once the real stamp exists, show it (local date+time);
//   - before then, show the SCHEDULED date + time.
// `withTag` appends a small "(actual)"/"(scheduled)" hint for clarity.
export function arrivalText(actualStamp, scheduledDate, scheduledTime, withTag = false) {
  if (actualStamp) return `${fmtStamp(actualStamp)}${withTag ? ' (actual)' : ''}`;
  const base = fmtDateTime(scheduledDate, scheduledTime);
  return `${base}${withTag && base !== '—' ? ' (scheduled)' : ''}`;
}

export function departureText(actualStamp, scheduledDate, scheduledTime, withTag = false) {
  return arrivalText(actualStamp, scheduledDate, scheduledTime, withTag);
}
