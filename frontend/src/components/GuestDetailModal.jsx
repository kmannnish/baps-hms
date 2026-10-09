import React, { useState, useEffect } from 'react';
import { X, Loader2, Phone, IndianRupee, Printer, MessageCircle } from 'lucide-react';
import { fetchObject } from '../lib/api';
import { printReceipt, openWhatsAppReceipt } from '../lib/receipt';
import { arrivalText, departureText } from '../lib/datetime';
import { useAuth } from '../context/AuthContext';

const TIER_LABEL = { foc: 'Free of charge', discount: 'Discount', paid: 'Fully paid' };

export default function GuestDetailModal({ bookingId, apiBaseUrl, token, onClose }) {
  const { defaultCheckinTime, defaultCheckoutTime } = useAuth();
  const [booking, setBooking] = useState(null);
  const [loading, setLoading] = useState(true);

  const authHeaders = { headers: { Authorization: `Bearer ${token}` } };

  useEffect(() => {
    let active = true;
    setLoading(true);
    fetchObject(`${apiBaseUrl}/bookings/${bookingId}`, authHeaders, null).then((bookingData) => {
      if (!active) return;
      setBooking(bookingData);
      setLoading(false);
    });
    return () => { active = false; };
    /* eslint-disable-next-line */
  }, [bookingId, apiBaseUrl, token]);

  const idPhotoSrc = booking?.id_document_url
    ? (/^https?:\/\//i.test(booking.id_document_url)
        ? booking.id_document_url
        : `${apiBaseUrl}${booking.id_document_url}`)
    : null;

  const totalPax =
    (Number(booking?.pax_men) || 0) +
    (Number(booking?.pax_women) || 0) +
    (Number(booking?.pax_children) || 0);

  const finalAmt = Number(booking?.final_amount ?? 0);
  const amtPaid = Number(booking?.amount_paid ?? 0);
  const balance = Math.max(0, finalAmt - amtPaid);
  const pStatus = booking?.payment_status || (booking?.is_paid ? 'paid' : 'unpaid');

  const statusColor = pStatus === 'paid' ? 'bg-[#4A6D5C]/15 text-[#4A6D5C]'
    : pStatus === 'partial' ? 'bg-[#B8792F]/15 text-[#B8792F]'
    : 'bg-[#8C3B3B]/15 text-[#8C3B3B]';

  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-md w-full p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-[#2B1610]/40 hover:text-[#2B1610]">
          <X className="w-5 h-5" />
        </button>

        {loading ? (
          <div className="flex items-center justify-center py-16 text-[#2B1610]/40">
            <Loader2 className="w-5 h-5 animate-spin" />
          </div>
        ) : !booking ? (
          <div className="py-12 text-center text-sm text-[#2B1610]/50">
            Could not load this booking. It may have been removed, or your session may have
            expired — try signing out and back in.
          </div>
        ) : (
          <>
            <h3 className="font-serif text-xl text-[#2B1610] mb-0.5 pr-8">{booking.guest_name}</h3>
            <p className="flex items-center gap-1.5 text-sm text-[#2B1610]/60 mb-4">
              <Phone className="w-3.5 h-3.5" /> {booking.mobile}
            </p>

            <div className="flex flex-wrap gap-2 mb-5">
              <span className="text-[11px] uppercase tracking-wide bg-[#B8792F]/15 text-[#B8792F] px-2 py-1">
                {booking.status}
              </span>
              <span className="text-[11px] uppercase tracking-wide bg-[#2B1610]/5 text-[#2B1610]/60 px-2 py-1">
                {booking.channel}
              </span>
              <span className={`text-[11px] uppercase tracking-wide px-2 py-1 ${statusColor}`}>
                {pStatus}
              </span>
            </div>

            <div className="border border-[#2B1610]/10 divide-y divide-[#2B1610]/5 mb-5">
              <Row
                label="Room type"
                value={`${booking.room_type_name}${booking.num_rooms > 1 ? ` × ${booking.num_rooms}` : ''}`}
              />
              {booking.room_number && <Row label="Room" value={booking.room_number} />}
              <Row
                label="Arrival"
                value={arrivalText(
                  booking.ata_actual_arrival,
                  booking.checkin_date,
                  booking.preferred_arrival_time || defaultCheckinTime,
                  true
                )}
              />
              <Row
                label="Departure"
                value={departureText(
                  booking.actual_checkout_at,
                  booking.checkout_date,
                  booking.preferred_departure_time || defaultCheckoutTime,
                  true
                )}
              />
              <Row
                label="Guests"
                value={`${totalPax} · ${booking.pax_men || 0} men, ${booking.pax_women || 0} women, ${booking.pax_children || 0} children`}
              />
              {(booking.sant_reference_name || booking.sant_reference_mobile) && (
                <Row
                  label="Sant reference"
                  value={[booking.sant_reference_name, booking.sant_reference_mobile].filter(Boolean).join(' · ')}
                />
              )}
              <Row
                label="Billing"
                value={
                  <span className="inline-flex items-center gap-1">
                    {TIER_LABEL[booking.billing_tier] || '—'}
                    {booking.billing_tier === 'discount' && Number(booking.discount_percent) > 0
                      ? ` (${Number(booking.discount_percent)}% off)`
                      : ''}
                    {booking.final_amount != null && (
                      <span className="ml-1 inline-flex items-center text-[#2B1610]">
                        <IndianRupee className="w-3 h-3" />
                        {Number(booking.final_amount).toLocaleString('en-IN')}
                      </span>
                    )}
                  </span>
                }
              />
              {finalAmt > 0 && (
                <Row
                  label="Paid"
                  value={
                    <span className="inline-flex items-center gap-1">
                      <IndianRupee className="w-3 h-3" />
                      {amtPaid.toLocaleString('en-IN')}
                    </span>
                  }
                />
              )}
              {balance > 0 && (
                <Row
                  label="Balance due"
                  value={
                    <span className="inline-flex items-center gap-1 font-semibold">
                      <IndianRupee className="w-3 h-3" />
                      {balance.toLocaleString('en-IN')}
                    </span>
                  }
                />
              )}
              {booking.approval_note && <Row label="Approval note" value={booking.approval_note} />}
            </div>

            <div className="mb-5">
              <p className="text-xs uppercase tracking-wide text-[#2B1610]/50 mb-2">Government ID</p>
              {idPhotoSrc ? (
                <a href={idPhotoSrc} target="_blank" rel="noopener noreferrer" className="block border border-[#2B1610]/15">
                  <img
                    src={idPhotoSrc}
                    alt={`Government ID for ${booking.guest_name}`}
                    className="w-full max-h-72 object-contain bg-white"
                  />
                </a>
              ) : (
                <div className="border border-dashed border-[#2B1610]/20 px-4 py-8 text-center text-sm text-[#2B1610]/40">
                  No ID photo on file for this booking.
                </div>
              )}
            </div>

            <div className="flex gap-2">
              <button
                onClick={() => printReceipt(booking, { apiBaseUrl, token })}
                className="flex-1 flex items-center justify-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610] py-2.5 text-sm hover:bg-[#2B1610]/5"
              >
                <Printer className="w-3.5 h-3.5" /> Print receipt
              </button>
              <button
                onClick={() => openWhatsAppReceipt(booking)}
                className="flex-1 flex items-center justify-center gap-1.5 border border-[#4A6D5C]/30 text-[#4A6D5C] py-2.5 text-sm hover:bg-[#4A6D5C]/5"
              >
                <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

function Row({ label, value }) {
  return (
    <div className="flex items-start justify-between gap-4 px-3 py-2.5 text-sm">
      <span className="shrink-0 text-[#2B1610]/50">{label}</span>
      <span className="text-right text-[#2B1610]">{value}</span>
    </div>
  );
}
