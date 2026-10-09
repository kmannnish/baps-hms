/**
 * lib/receipt.js
 *
 * Receipt / bill helpers:
 *  - printReceipt() fetches the SERVER-generated PDF bill (GET
 *    /bookings/:id/receipt.pdf) with the JWT in the Authorization header — so
 *    the token never lands in a URL — then opens it in a new tab, falling back
 *    to a direct download if a popup is blocked. The old client-side
 *    window.print() HTML receipt was replaced by this invoice-grade PDF
 *    (see backend/pdf/receipt.js), which is also what the daily email attaches.
 *  - buildReceiptText() + openWhatsAppReceipt() build the plain-text WhatsApp
 *    receipt: a wa.me link can only carry text, so this stays client-side.
 */

function nightsBetween(checkin, checkout) {
  const ms = new Date(checkout) - new Date(checkin);
  return Math.max(1, Math.round(ms / 86400000));
}

function fmt(n) {
  return Number(n ?? 0).toLocaleString('en-IN');
}

function fmtDate(d) {
  return d ? new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
}

export function buildReceiptText(booking) {
  const nights = nightsBetween(booking.checkin_date, booking.checkout_date);
  const total = Number(booking.final_amount ?? 0);
  const paid = Number(booking.amount_paid ?? 0);
  const balance = Math.max(0, total - paid);

  return [
    `Jai Swaminarayan ${booking.guest_name},`,
    `Receipt — BAPS Jaipur Utara`,
    `Room: ${booking.room_type_name || '—'} ${booking.room_number || ''}`.trim(),
    `Dates: ${fmtDate(booking.checkin_date)} to ${fmtDate(booking.checkout_date)} (${nights} night${nights > 1 ? 's' : ''})`,
    `Total: Rs.${fmt(total)}`,
    `Paid: Rs.${fmt(paid)}`,
    `Balance: Rs.${fmt(balance)}`,
    `Thank you for staying with us.`,
  ].join('\n');
}

/**
 * Fetch the server-rendered PDF bill and show it. The endpoint is behind
 * can_view_reports, so the JWT must travel in the Authorization header; a blob
 * URL keeps the token out of the address bar. `auth` is { apiBaseUrl, token }.
 */
export async function printReceipt(booking, auth = {}) {
  const { apiBaseUrl, token } = auth;
  const id = booking?.id;
  if (!id || !apiBaseUrl) {
    console.error('printReceipt: missing booking id or apiBaseUrl', { id, apiBaseUrl });
    alert('Could not open the bill — missing booking details.');
    return;
  }

  let url = null;
  try {
    const res = await fetch(`${apiBaseUrl}/bookings/${id}/receipt.pdf`, {
      headers: token ? { Authorization: `Bearer ${token}` } : {},
    });
    if (!res.ok) throw new Error(`Receipt request failed (${res.status})`);

    const blob = await res.blob();
    url = URL.createObjectURL(blob);
    const fileName = `bill-${booking.booking_code || id}.pdf`;

    const win = window.open(url, '_blank');
    if (!win) {
      // Popup blocked — fall back to a direct download so the bill still comes out.
      const a = document.createElement('a');
      a.href = url;
      a.download = fileName;
      document.body.appendChild(a);
      a.click();
      a.remove();
    }
    // Revoke late: the new tab needs the blob URL alive long enough to load it.
    setTimeout(() => URL.revokeObjectURL(url), 60000);
  } catch (err) {
    console.error('printReceipt failed:', err);
    if (url) URL.revokeObjectURL(url);
    alert('Could not generate the bill PDF. Please check the connection and try again.');
  }
}

export function openWhatsAppReceipt(booking) {
  const text = buildReceiptText(booking);
  const phone = (booking.mobile || '').replace(/\D/g, '');
  const url = `https://wa.me/${phone.startsWith('91') ? phone : '91' + phone}?text=${encodeURIComponent(text)}`;
  window.open(url, '_blank');
}
