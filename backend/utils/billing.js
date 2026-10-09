/**
 * utils/billing.js
 *
 * Single source of truth for billing math. Every place that computes
 * final_amount (POST /:id/decide, PUT /:id/billing) calls this instead
 * of duplicating the formula.
 */

const pool = require('../db');

function nightsBetween(checkinDate, checkoutDate) {
  const ms = new Date(checkoutDate) - new Date(checkinDate);
  return Math.max(1, Math.round(ms / 86400000));
}

async function getTaxSettings() {
  const { rows } = await pool.query(
    `SELECT key, value FROM settings WHERE key IN ('gst_percent', 'tax_enabled')`
  );
  const map = Object.fromEntries(rows.map((r) => [r.key, r.value]));
  const taxEnabled = map.tax_enabled !== false;
  const gstPercent = taxEnabled ? Number(map.gst_percent ?? 0) : 0;
  return { taxEnabled, gstPercent };
}

function calculateFinalAmount({ basePrice, numRooms, nights, billingTier, discountPercent, gstPercent }) {
  if (billingTier === 'foc') return 0;

  const subtotal = basePrice * numRooms * nights;

  if (billingTier === 'discount') {
    return subtotal * (1 - (discountPercent ?? 0) / 100) * (1 + gstPercent / 100);
  }

  // 'paid' (full rate)
  return subtotal * (1 + gstPercent / 100);
}

function round2(n) {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Pure, DB-free itemised breakdown of a bill, for the invoice PDF.
 *
 * The room portion mirrors calculateFinalAmount() exactly (asserted in the
 * E2E tests): for 'discount', taxable + GST == subtotal*(1-d/100)*(1+gst/100);
 * for 'paid', == subtotal*(1+gst/100); for 'foc', 0. It then itemises the
 * discount, GST, late-checkout surcharge and freeform extra charges.
 *
 * Only `final_amount` is persisted (no stored line-item breakdown), so callers
 * pass the stored value as `storedFinal`. If the re-derived grand total ever
 * diverges from it (e.g. gst_percent was changed in Settings AFTER this bill
 * was finalised), we trust the stored amount and back-solve the GST line so the
 * printed grand total always equals what the guest was actually charged.
 */
function calculateBillBreakdown({
  basePrice,
  numRooms,
  nights,
  billingTier,
  discountPercent = 0,
  gstPercent = 0,
  lateSurcharge = 0,
  extraCharges = [],
  storedFinal = null,
}) {
  const rooms = Math.max(1, Number(numRooms) || 1);
  const n = Math.max(1, Number(nights) || 1);
  const bp = Number(basePrice) || 0;

  const subtotal = billingTier === 'foc' ? 0 : round2(bp * rooms * n);
  const discPct = billingTier === 'discount' ? Number(discountPercent) || 0 : 0;
  const discountAmount = round2(subtotal * (discPct / 100));
  const taxable = round2(subtotal - discountAmount);

  const gp = billingTier === 'foc' ? 0 : Number(gstPercent) || 0;
  let gstAmount = round2(taxable * (gp / 100));
  let roomTotal = round2(taxable + gstAmount);

  const late = round2(Number(lateSurcharge) || 0);
  const extras = (Array.isArray(extraCharges) ? extraCharges : [])
    .map((c) => ({ label: String(c?.label ?? '').trim(), amount: round2(Number(c?.amount) || 0) }))
    .filter((c) => c.label && c.amount);
  const extrasTotal = round2(extras.reduce((s, c) => s + c.amount, 0));

  let grandTotal = round2(roomTotal + late + extrasTotal);

  if (storedFinal != null && Number.isFinite(Number(storedFinal))) {
    const stored = round2(Number(storedFinal));
    if (Math.abs(stored - grandTotal) > 0.01) {
      // Trust the stored total; absorb the difference into the GST line so the
      // paper reconciles to what was charged.
      roomTotal = round2(stored - late - extrasTotal);
      gstAmount = round2(Math.max(0, roomTotal - taxable));
      grandTotal = stored;
    }
  }

  return {
    subtotal,
    discountPercent: discPct,
    discountAmount,
    taxable,
    gstPercent: gp,
    gstAmount,
    roomTotal,
    lateSurcharge: late,
    extraCharges: extras,
    extrasTotal,
    grandTotal,
  };
}

module.exports = { nightsBetween, getTaxSettings, calculateFinalAmount, calculateBillBreakdown, round2 };
