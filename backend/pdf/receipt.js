/**
 * pdf/receipt.js — the guest bill / tax invoice.
 *
 * buildReceiptPdf(stream, { booking, payments, settings, breakdown, nights })
 * streams a single-page A4 PDF to `stream` (an HTTP response or a file/stream
 * transport buffer). The caller has already computed the itemised `breakdown`
 * (utils/billing.calculateBillBreakdown) reconciled to the stored final_amount,
 * so this module is pure layout — no money math of its own.
 *
 * Dates/times follow the app-wide rule: show the REAL recorded stamp once it
 * exists (ata_actual_arrival / actual_checkout_at), otherwise the SCHEDULED
 * date + time (preferred_* on the booking, else the default_* settings).
 */

const {
  createDoc,
  formatMoney,
  fmtDate,
  fmtTime,
  fmtStamp,
  FONT_REG,
  FONT_BOLD,
  COLORS,
} = require('./base');
const fs = require('fs');
const path = require('path');

function scheduledArrival(booking, settings) {
  const t = booking.preferred_arrival_time || settings.default_checkin_time || '14:00';
  const time = fmtTime(t);
  return `${fmtDate(booking.checkin_date)}${time ? `, ${time}` : ''}`;
}

function scheduledDeparture(booking, settings) {
  const t = booking.preferred_departure_time || settings.default_checkout_time || '11:00';
  const time = fmtTime(t);
  return `${fmtDate(booking.checkout_date)}${time ? `, ${time}` : ''}`;
}

function arrivalDisplay(booking, settings) {
  if (booking.ata_actual_arrival) return `${fmtStamp(booking.ata_actual_arrival)} (actual)`;
  return `${scheduledArrival(booking, settings)} (scheduled)`;
}

function departureDisplay(booking, settings) {
  if (booking.actual_checkout_at) return `${fmtStamp(booking.actual_checkout_at)} (actual)`;
  return `${scheduledDeparture(booking, settings)} (scheduled)`;
}

// Resolve a stored logo URL ("/uploads/branding/x.png") to a disk path, but
// only if it's a local upload that actually exists — never throw on a bad path.
function resolveLogoPath(url) {
  if (!url || typeof url !== 'string') return null;
  if (!url.startsWith('/uploads/')) return null;
  const p = path.join(__dirname, '..', url.replace(/^\/+/, ''));
  try {
    return fs.existsSync(p) ? p : null;
  } catch {
    return null;
  }
}

function buildReceiptPdf(stream, { booking, payments = [], settings = {}, breakdown, nights }) {
  const doc = createDoc();
  doc.pipe(stream);

  const left = doc.page.margins.left;
  const right = doc.page.width - doc.page.margins.right;
  const contentWidth = right - left;

  const orgName = settings.org_name || 'BAPS Jaipur Utara';
  const orgAddress = settings.org_address || '';
  const orgPhone = settings.org_phone || '';
  const orgEmail = settings.org_email || '';
  const orgGstin = settings.org_gstin || '';

  // ---- Header: logo (optional, top-right) + org identity (left) -----------
  const logoPath = resolveLogoPath(settings.org_logo_url);
  if (logoPath) {
    try {
      doc.image(logoPath, right - 70, 46, { fit: [70, 70], align: 'right' });
    } catch {
      /* ignore an unreadable/corrupt image — the rest of the bill still prints */
    }
  }

  doc.font(FONT_BOLD).fontSize(22).fillColor(COLORS.espresso);
  doc.text(orgName, left, 50, { width: contentWidth - 80 });
  doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ash);
  if (orgAddress) doc.text(orgAddress, left, doc.y + 2, { width: contentWidth - 80 });
  const contactLine = [orgPhone && `Phone: ${orgPhone}`, orgEmail && `Email: ${orgEmail}`]
    .filter(Boolean)
    .join('    ');
  if (contactLine) doc.text(contactLine, left, doc.y + 1, { width: contentWidth - 80 });
  if (orgGstin) doc.text(`GSTIN: ${orgGstin}`, left, doc.y + 1);

  let y = Math.max(doc.y, 118) + 10;
  doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor(COLORS.gold).stroke();
  y += 16;

  // ---- Title + invoice meta ----------------------------------------------
  const isTax = Number(breakdown?.gstAmount) > 0;
  const title = booking.billing_tier === 'foc' ? 'RECEIPT (COMPLIMENTARY)' : isTax ? 'TAX INVOICE' : 'RECEIPT';
  doc.font(FONT_BOLD).fontSize(15).fillColor(COLORS.espresso).text(title, left, y);

  const invNo = booking.booking_code || `${settings.invoice_prefix || 'INV'}-${booking.id}`;
  doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ash);
  const metaX = right - 200;
  const metaTop = y;
  doc.text('Invoice No:', metaX, metaTop, { width: 90 });
  doc.text('Date:', metaX, metaTop + 13, { width: 90 });
  doc.text('Status:', metaX, metaTop + 26, { width: 90 });
  doc.font(FONT_BOLD).fillColor(COLORS.espresso);
  doc.text(invNo, metaX + 92, metaTop, { width: 108, align: 'right' });
  doc.text(fmtDate(new Date()), metaX + 92, metaTop + 13, { width: 108, align: 'right' });
  doc.text(String(booking.status || '').replace(/_/g, ' ') || '—', metaX + 92, metaTop + 26, {
    width: 108,
    align: 'right',
  });

  y = metaTop + 48;

  // ---- Bill-to + stay details (two columns) -------------------------------
  const colGap = 24;
  const colW = (contentWidth - colGap) / 2;
  const rightColX = left + colW + colGap;

  const sectionLabel = (text, x, yy) =>
    doc.font(FONT_BOLD).fontSize(8).fillColor(COLORS.gold).text(text.toUpperCase(), x, yy);

  const kv = (label, value, x, yy, w) => {
    doc.font(FONT_REG).fontSize(9).fillColor(COLORS.ash).text(label, x, yy, { width: w, continued: false });
    doc.font(FONT_BOLD).fontSize(9.5).fillColor(COLORS.espresso).text(value || '—', x, doc.y, { width: w });
    return doc.y + 6;
  };

  sectionLabel('Billed to', left, y);
  let ly = y + 12;
  ly = kv('Guest', booking.guest_name, left, ly, colW);
  ly = kv('Mobile', booking.mobile, left, ly, colW);
  if (booking.sant_reference_name) ly = kv('Sant reference', booking.sant_reference_name, left, ly, colW);

  sectionLabel('Stay', rightColX, y);
  let ry = y + 12;
  ry = kv('Room type', booking.room_type_name, rightColX, ry, colW);
  ry = kv(
    'Rooms / Nights',
    `${booking.num_rooms || 1} room(s) · ${nights} night(s)`,
    rightColX,
    ry,
    colW
  );
  if (booking.room_number) ry = kv('Room no.', booking.room_number, rightColX, ry, colW);
  ry = kv('Arrival', arrivalDisplay(booking, settings), rightColX, ry, colW);
  ry = kv('Departure', departureDisplay(booking, settings), rightColX, ry, colW);

  y = Math.max(ly, ry) + 8;

  // ---- Charges table ------------------------------------------------------
  const amtX = right - 110; // right-aligned amount column start
  const amtW = 110;
  const descW = amtX - left - 10;

  const tableHead = (yy) => {
    doc.rect(left, yy, contentWidth, 20).fill(COLORS.parchment);
    doc.font(FONT_BOLD).fontSize(9).fillColor(COLORS.espresso);
    doc.text('Description', left + 8, yy + 6, { width: descW });
    doc.text('Amount', amtX, yy + 6, { width: amtW - 8, align: 'right' });
    return yy + 24;
  };

  const chargeRow = (desc, amount, yy, opts = {}) => {
    const font = opts.bold ? FONT_BOLD : FONT_REG;
    doc.font(font).fontSize(9.5).fillColor(opts.color || COLORS.espresso);
    doc.text(desc, left + 8, yy, { width: descW });
    const rowH = doc.y - yy;
    doc.font(font).fontSize(9.5).fillColor(opts.color || COLORS.espresso);
    doc.text(formatMoney(amount), amtX, yy, { width: amtW - 8, align: 'right' });
    return yy + Math.max(rowH, 12) + 6;
  };

  y = tableHead(y);

  const b = breakdown;
  const roomDesc =
    booking.billing_tier === 'foc'
      ? `Room charge — ${booking.room_type_name || 'Room'} (complimentary)`
      : `Room charge — ${booking.room_type_name || 'Room'}\n${booking.num_rooms || 1} × ${nights} night(s) @ ${formatMoney(booking.base_price)}`;
  y = chargeRow(roomDesc, b.subtotal, y);

  if (b.discountAmount > 0) {
    y = chargeRow(`Discount (${b.discountPercent}%)`, -b.discountAmount, y, { color: COLORS.sage });
  }
  if (b.gstAmount > 0) {
    y = chargeRow(`GST (${b.gstPercent}%)`, b.gstAmount, y);
  }
  if (b.lateSurcharge > 0) {
    y = chargeRow('Late checkout surcharge', b.lateSurcharge, y);
  }
  for (const c of b.extraCharges || []) {
    y = chargeRow(c.label, c.amount, y);
  }

  // ---- Grand total --------------------------------------------------------
  doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(COLORS.line).stroke();
  y += 8;
  doc.rect(left, y, contentWidth, 26).fill(COLORS.espresso);
  doc.font(FONT_BOLD).fontSize(12).fillColor('#FFFFFF');
  doc.text('GRAND TOTAL', left + 8, y + 7, { width: descW });
  doc.text(formatMoney(b.grandTotal), amtX, y + 7, { width: amtW - 8, align: 'right' });
  y += 38;

  // ---- Payment summary ----------------------------------------------------
  const amountPaid = Number(booking.amount_paid) || 0;
  const balance = Math.max(0, Math.round((b.grandTotal - amountPaid) * 100) / 100);

  doc.font(FONT_REG).fontSize(9.5).fillColor(COLORS.ash);
  const payRow = (label, value, yy, opts = {}) => {
    doc.font(opts.bold ? FONT_BOLD : FONT_REG).fontSize(9.5).fillColor(opts.color || COLORS.espresso);
    doc.text(label, amtX - 120, yy, { width: 120 });
    doc.text(formatMoney(value), amtX, yy, { width: amtW - 8, align: 'right' });
    return yy + 15;
  };
  y = payRow('Amount paid', amountPaid, y);
  y = payRow(balance > 0 ? 'Balance due' : 'Balance', balance, y, {
    bold: true,
    color: balance > 0 ? COLORS.brick : COLORS.sage,
  });

  if (payments.length) {
    y += 6;
    doc.font(FONT_BOLD).fontSize(8).fillColor(COLORS.gold).text('PAYMENTS RECEIVED', left, y);
    y += 12;
    doc.font(FONT_REG).fontSize(8.5).fillColor(COLORS.ash);
    for (const p of payments) {
      const when = p.created_at ? fmtStamp(p.created_at) : '';
      const method = p.method ? ` · ${p.method}` : '';
      const by = p.recorded_by_name ? ` · ${p.recorded_by_name}` : '';
      doc.text(`${when}${method}${by}`, left, y, { width: descW });
      doc.text(formatMoney(p.amount), amtX, y, { width: amtW - 8, align: 'right' });
      y = doc.y + 3;
    }
  }

  // ---- Terms & footer -----------------------------------------------------
  const terms = settings.terms_and_conditions;
  const footerTop = doc.page.height - doc.page.margins.bottom - 70;
  const yTerms = Math.min(y + 16, footerTop);
  if (terms && typeof terms === 'string' && terms.trim()) {
    doc.moveTo(left, yTerms).lineTo(right, yTerms).lineWidth(0.5).strokeColor(COLORS.line).stroke();
    doc.font(FONT_BOLD).fontSize(7.5).fillColor(COLORS.gold).text('TERMS & CONDITIONS', left, yTerms + 6);
    doc.font(FONT_REG).fontSize(7.5).fillColor(COLORS.ash).text(terms.trim(), left, doc.y + 2, {
      width: contentWidth,
      height: 44,
      ellipsis: true,
    });
  }

  doc.font(FONT_REG).fontSize(8).fillColor(COLORS.ash);
  doc.text('This is a computer-generated invoice.  |  Jai Swaminarayan', left, doc.page.height - doc.page.margins.bottom - 14, {
    width: contentWidth,
    align: 'center',
  });

  doc.end();
}

module.exports = { buildReceiptPdf };
