/**
 * pdf/dailyReport.js — the daily operations report emailed to Swami Ji.
 *
 * buildDailyReportPdf(stream, { date, settings, income, occupancy, activity, calendar })
 * streams an A4 PDF (auto-paginating when the day's lists are long). Pure layout
 * + the app-wide scheduled-vs-actual time rule; the caller (mailer/dailyReport.js)
 * has already gathered all the data via utils/reportData + utils/occupancy.
 */

const {
  createDoc,
  formatMoney,
  fmtDate,
  fmtTime,
  FONT_REG,
  FONT_BOLD,
  COLORS,
} = require('./base');

// Time-only rendering of a real TIMESTAMPTZ (the arrival/departure rows are all
// for "today", so the date part would just be noise in a narrow column).
function timeOnlyStamp(ts) {
  if (!ts) return '';
  const dt = ts instanceof Date ? ts : new Date(ts);
  if (Number.isNaN(dt.getTime())) return '';
  const hh = String(dt.getHours()).padStart(2, '0');
  const mm = String(dt.getMinutes()).padStart(2, '0');
  return fmtTime(`${hh}:${mm}`);
}

// App-wide rule: show the REAL recorded time once it exists, else the SCHEDULED
// time (preferred_* on the booking, else the default_* setting). A short ASCII
// tag disambiguates which one the reader is looking at.
function arrivalText(b, settings) {
  if (b.ata_actual_arrival) return `${timeOnlyStamp(b.ata_actual_arrival)} (act)`;
  const t = b.preferred_arrival_time || settings.default_checkin_time || '14:00';
  return `${fmtTime(t) || '—'} (sch)`;
}
function departureText(b, settings) {
  if (b.actual_checkout_at) return `${timeOnlyStamp(b.actual_checkout_at)} (act)`;
  const t = b.preferred_departure_time || settings.default_checkout_time || '11:00';
  return `${fmtTime(t) || '—'} (sch)`;
}

function buildDailyReportPdf(stream, {
  date = new Date(),
  settings = {},
  income = { revenue: 0, bookings: 0 },
  occupancy = [],
  activity = { arrivals: [], departures: [] },
  calendar = { roomTypes: [], days: [] },
}) {
  const doc = createDoc();
  doc.pipe(stream);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;
  const bottom = () => doc.page.height - doc.page.margins.bottom;
  const ensureSpace = (h) => {
    if (doc.y + h > bottom()) doc.addPage();
  };

  const cell = (text, x, y, w, opts = {}) => {
    doc.font(opts.bold ? FONT_BOLD : FONT_REG)
      .fontSize(opts.size || 9)
      .fillColor(opts.color || COLORS.espresso);
    doc.text(String(text ?? ''), x, y, {
      width: w,
      align: opts.align || 'left',
      ellipsis: true,
      lineBreak: false,
    });
  };

  const sectionHeader = (text) => {
    ensureSpace(34);
    const y = doc.y;
    doc.font(FONT_BOLD).fontSize(11).fillColor(COLORS.espresso).text(text, left, y);
    doc.moveTo(left, doc.y + 2).lineTo(right, doc.y + 2).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.y += 8;
  };

  // ---- Header -------------------------------------------------------------
  const orgName = settings.org_name || 'BAPS Jaipur Utara';
  doc.font(FONT_BOLD).fontSize(20).fillColor(COLORS.espresso).text(orgName, left, 50);
  doc.font(FONT_BOLD).fontSize(12).fillColor(COLORS.gold).text('Daily Operations Report', left, doc.y + 2);
  doc.font(FONT_REG).fontSize(10).fillColor(COLORS.ash).text(fmtDate(date), left, doc.y + 2);
  doc.moveTo(left, doc.y + 8).lineTo(right, doc.y + 8).lineWidth(1).strokeColor(COLORS.gold).stroke();
  doc.y += 18;

  // ---- Stat band: today at a glance --------------------------------------
  const totalOccupied = occupancy.reduce((s, o) => s + (Number(o.occupied) || 0), 0);
  const totalRooms = occupancy.reduce((s, o) => s + (Number(o.total) || 0), 0);
  const stats = [
    { value: formatMoney(income.revenue), label: `Income today (${income.bookings} stay${income.bookings === 1 ? '' : 's'})` },
    { value: String(activity.arrivals.length), label: 'Arrivals today' },
    { value: String(activity.departures.length), label: 'Departures today' },
    { value: `${totalOccupied}/${totalRooms}`, label: 'Rooms occupied now' },
  ];
  ensureSpace(56);
  const bandY = doc.y;
  doc.rect(left, bandY, contentWidth, 48).fill(COLORS.parchment);
  const statW = contentWidth / stats.length;
  stats.forEach((s, i) => {
    const x = left + i * statW;
    doc.font(FONT_BOLD).fontSize(14).fillColor(COLORS.espresso)
      .text(s.value, x + 8, bandY + 8, { width: statW - 16, align: 'left', ellipsis: true, lineBreak: false });
    doc.font(FONT_REG).fontSize(8).fillColor(COLORS.ash)
      .text(s.label, x + 8, bandY + 28, { width: statW - 16, align: 'left', ellipsis: true, lineBreak: false });
  });
  doc.y = bandY + 48 + 16;

  // ---- Current occupancy by type -----------------------------------------
  sectionHeader('Current occupancy by room type');
  {
    const cols = [
      { key: 'room_type', label: 'Room type', w: contentWidth - 3 * 70, align: 'left' },
      { key: 'occupied', label: 'Occupied', w: 70, align: 'right' },
      { key: 'ready', label: 'Ready', w: 70, align: 'right' },
      { key: 'total', label: 'Total', w: 70, align: 'right' },
    ];
    let x = left;
    const headY = doc.y;
    for (const c of cols) { cell(c.label, x, headY, c.w, { bold: true, size: 8, color: COLORS.gold, align: c.align }); x += c.w; }
    doc.y = headY + 15;
    if (!occupancy.length) {
      cell('No rooms configured.', left, doc.y, contentWidth, { color: COLORS.ash });
      doc.y += 16;
    }
    for (const o of occupancy) {
      ensureSpace(16);
      const y = doc.y;
      x = left;
      for (const c of cols) { cell(o[c.key], x, y, c.w, { align: c.align }); x += c.w; }
      doc.y = y + 15;
    }
    doc.y += 10;
  }

  // ---- Today's arrivals ---------------------------------------------------
  sectionHeader(`Today's arrivals (${activity.arrivals.length})`);
  {
    const cols = [
      { label: 'Guest', w: 170, align: 'left', get: (b) => b.guest_name },
      { label: 'Room type', w: 115, align: 'left', get: (b) => b.room_type_name },
      { label: 'Rms', w: 40, align: 'right', get: (b) => b.num_rooms || 1 },
      { label: 'Arrival', w: contentWidth - 170 - 115 - 40, align: 'right', get: (b) => arrivalText(b, settings) },
    ];
    let x = left;
    const headY = doc.y;
    for (const c of cols) { cell(c.label, x, headY, c.w, { bold: true, size: 8, color: COLORS.gold, align: c.align }); x += c.w; }
    doc.y = headY + 15;
    if (!activity.arrivals.length) {
      cell('No arrivals scheduled today.', left, doc.y, contentWidth, { color: COLORS.ash });
      doc.y += 16;
    }
    for (const b of activity.arrivals) {
      ensureSpace(16);
      const y = doc.y;
      x = left;
      for (const c of cols) { cell(c.get(b), x, y, c.w, { align: c.align }); x += c.w; }
      doc.y = y + 15;
    }
    doc.y += 10;
  }

  // ---- Today's departures -------------------------------------------------
  sectionHeader(`Today's departures (${activity.departures.length})`);
  {
    const cols = [
      { label: 'Guest', w: 170, align: 'left', get: (b) => b.guest_name },
      { label: 'Room type', w: 115, align: 'left', get: (b) => b.room_type_name },
      { label: 'Room', w: 60, align: 'left', get: (b) => b.room_number || '—' },
      { label: 'Departure', w: contentWidth - 170 - 115 - 60, align: 'right', get: (b) => departureText(b, settings) },
    ];
    let x = left;
    const headY = doc.y;
    for (const c of cols) { cell(c.label, x, headY, c.w, { bold: true, size: 8, color: COLORS.gold, align: c.align }); x += c.w; }
    doc.y = headY + 15;
    if (!activity.departures.length) {
      cell('No departures scheduled today.', left, doc.y, contentWidth, { color: COLORS.ash });
      doc.y += 16;
    }
    for (const b of activity.departures) {
      ensureSpace(16);
      const y = doc.y;
      x = left;
      for (const c of cols) { cell(c.get(b), x, y, c.w, { align: c.align }); x += c.w; }
      doc.y = y + 15;
    }
    doc.y += 10;
  }

  // ---- Next 7 days occupancy (X of N per type per day) --------------------
  sectionHeader('Next 7 days — rooms booked (booked of total)');
  {
    const types = calendar.roomTypes || [];
    const dateW = 95;
    const typeW = types.length ? (contentWidth - dateW) / types.length : 0;

    let x = left;
    const headY = doc.y;
    cell('Date', x, headY, dateW, { bold: true, size: 8, color: COLORS.gold });
    x += dateW;
    for (const t of types) { cell(t.name, x, headY, typeW, { bold: true, size: 8, color: COLORS.gold, align: 'right' }); x += typeW; }
    doc.y = headY + 15;

    if (!types.length || !(calendar.days || []).length) {
      cell('No upcoming bookings in the next 7 days.', left, doc.y, contentWidth, { color: COLORS.ash });
      doc.y += 16;
    }
    for (const day of calendar.days || []) {
      ensureSpace(16);
      const y = doc.y;
      x = left;
      cell(fmtDate(day.date), x, y, dateW);
      x += dateW;
      const byType = Object.create(null);
      for (const bt of day.byType || []) byType[bt.roomTypeId] = bt;
      for (const t of types) {
        const bt = byType[t.id];
        const occ = bt ? bt.occupied : 0;
        const tot = bt ? bt.total : t.total;
        const full = tot > 0 && occ >= tot;
        cell(`${occ}/${tot}`, x, y, typeW, { align: 'right', color: full ? COLORS.brick : COLORS.espresso, bold: full });
        x += typeW;
      }
      doc.y = y + 15;
    }
  }

  // ---- Footer -------------------------------------------------------------
  doc.font(FONT_REG).fontSize(8).fillColor(COLORS.ash);
  doc.text(
    'Automated daily report from the BAPS Jaipur Utara front desk.  |  Jai Swaminarayan',
    left,
    bottom() - 12,
    { width: contentWidth, align: 'center', lineBreak: false }
  );

  doc.end();
}

module.exports = { buildDailyReportPdf };
