/**
 * pdf/base.js — shared PDFKit helpers for the invoice (receipt.js) and the
 * daily report (dailyReport.js). One place for document creation, the money
 * formatter, date/time formatting and the palette, so both PDFs look alike.
 *
 * Font & currency strategy (zero-budget, robust by default):
 *   - By DEFAULT we use PDFKit's built-in Times serif (which matches the app's
 *     calm serif identity) and the ASCII prefix "Rs." — no binary font is
 *     shipped, and this renders correctly on every machine.
 *   - If a Unicode serif TTF is dropped into backend/assets/fonts/
 *     (NotoSerif-Regular.ttf + NotoSerif-Bold.ttf — both OFL, free), base.js
 *     detects them at load time, embeds them, and switches the currency prefix
 *     to the real ₹ (U+20B9) glyph. Nothing else in the code changes.
 *
 * The rupee sign is NOT present in the WinAnsi built-in fonts, which is exactly
 * why the default path uses "Rs." instead of a broken glyph.
 */

const fs = require('fs');
const path = require('path');
const PDFDocument = require('pdfkit');

const FONT_DIR = path.join(__dirname, '..', 'assets', 'fonts');
const REG_TTF = path.join(FONT_DIR, 'NotoSerif-Regular.ttf');
const BOLD_TTF = path.join(FONT_DIR, 'NotoSerif-Bold.ttf');

let HAS_TTF = false;
try {
  HAS_TTF = fs.existsSync(REG_TTF) && fs.existsSync(BOLD_TTF);
} catch {
  HAS_TTF = false;
}

const FONT_REG = HAS_TTF ? 'Body' : 'Times-Roman';
const FONT_BOLD = HAS_TTF ? 'Body-Bold' : 'Times-Bold';
const CURRENCY = HAS_TTF ? '₹' : 'Rs. ';

// Palette — mirrors the app's inline hex so the paper matches the screen.
const COLORS = {
  espresso: '#2B1610',
  gold: '#B8792F',
  clay: '#C77A34',
  brick: '#8C3B3B',
  sage: '#4A6D5C',
  ash: '#6B5B4E',
  line: '#D8CDBE',
  parchment: '#F8F4EC',
};

function createDoc(opts = {}) {
  const doc = new PDFDocument({ size: 'A4', margin: 50, ...opts });
  if (HAS_TTF) {
    doc.registerFont('Body', REG_TTF);
    doc.registerFont('Body-Bold', BOLD_TTF);
  }
  doc.font(FONT_REG);
  return doc;
}

// Indian digit grouping: 1234567.5 -> "12,34,567.50"
function groupIndian(intStr) {
  if (intStr.length <= 3) return intStr;
  const last3 = intStr.slice(-3);
  const rest = intStr.slice(0, -3);
  return `${rest.replace(/\B(?=(\d{2})+(?!\d))/g, ',')},${last3}`;
}

function formatMoney(n) {
  const num = Number(n);
  const safe = Number.isFinite(num) ? num : 0;
  const sign = safe < 0 ? '-' : '';
  const [int, dec] = Math.abs(safe).toFixed(2).split('.');
  return `${sign}${CURRENCY}${groupIndian(int)}.${dec}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

// DATE columns come back from node-pg as local-midnight Date objects; render
// only the calendar day, never a time, to avoid the "00:00" leak.
function fmtDate(d) {
  if (!d) return '—';
  const dt = d instanceof Date ? d : new Date(d);
  if (Number.isNaN(dt.getTime())) return '—';
  return `${String(dt.getDate()).padStart(2, '0')} ${MONTHS[dt.getMonth()]} ${dt.getFullYear()}`;
}

// A 'HH:MM' / 'HH:MM:SS' clock string -> "2:00 PM". Empty for null.
function fmtTime(t) {
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

// A real TIMESTAMPTZ -> "29 Sep 2026, 3:40 PM".
function fmtStamp(ts) {
  if (!ts) return '—';
  const dt = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(dt.getTime())) return '—';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return `${fmtDate(dt)}, ${fmtTime(`${hh}:${mm}`)}`;
}

module.exports = {
  createDoc,
  formatMoney,
  fmtDate,
  fmtTime,
  fmtStamp,
  FONT_REG,
  FONT_BOLD,
  CURRENCY,
  COLORS,
  HAS_TTF,
};
