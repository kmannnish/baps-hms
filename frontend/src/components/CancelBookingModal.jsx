import React, { useState } from 'react';
import { Loader2, Ban } from 'lucide-react';

/**
 * CancelBookingModal
 *
 * Cancel a booking with a required reason and an OPTIONAL cancellation charge.
 * The charge is recorded as a note in the audit log only — it does not change
 * billing (per the chosen behaviour). Used by Reception for no-shows / guests
 * who cancel. Calls POST /bookings/:id/cancel.
 *
 * props: booking, apiBaseUrl, token, onClose(), onDone(cancelledBooking)
 */
export default function CancelBookingModal({ booking, apiBaseUrl, token, onClose, onDone }) {
  const [reason, setReason] = useState('');
  const [charge, setCharge] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  const submit = async (e) => {
    e.preventDefault();
    if (!reason.trim()) { setError('A short reason is required.'); return; }
    setBusy(true);
    setError('');
    try {
      const res = await fetch(`${apiBaseUrl}/bookings/${booking.id}/cancel`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: reason.trim(), cancellationCharge: charge }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setError(body.message || body.error || 'Could not cancel the booking.');
        return;
      }
      onDone?.(body);
    } catch {
      setError('Network error — could not reach the server.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
      <form onSubmit={submit} className="bg-[#F8F4EC] border border-[#2B1610]/15 max-w-md w-full p-6">
        <h4 className="font-serif text-lg text-[#2B1610] flex items-center gap-2 mb-1">
          <Ban className="w-4 h-4 text-[#8C3B3B]" /> Cancel booking
        </h4>
        <p className="text-sm text-[#2B1610]/70 mb-3">
          Cancel <strong>{booking.guest_name}</strong>'s booking
          {booking.room_type_name ? <> ({booking.room_type_name})</> : null}. It stays in history,
          labelled cancelled, and any held room is freed.
        </p>

        <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Reason</label>
        <textarea
          autoFocus
          rows={2}
          value={reason}
          onChange={(e) => setReason(e.target.value)}
          placeholder="e.g. guest no-show, guest cancelled by phone"
          className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
        />

        <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1 mt-3">
          Cancellation charge ₹ (optional)
        </label>
        <input
          type="number"
          min="0"
          value={charge}
          onChange={(e) => setCharge(e.target.value)}
          placeholder="e.g. 500 — leave blank for no charge"
          className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
        />
        <p className="text-[11px] text-[#2B1610]/40 mt-1">Recorded as a note in the audit log (not added to billing).</p>

        {error && <p className="text-sm text-[#8C3B3B] mt-2">{error}</p>}

        <div className="flex items-center justify-end gap-3 mt-4">
          <button
            type="button"
            onClick={onClose}
            disabled={busy}
            className="px-4 py-2 text-sm text-[#2B1610]/60 hover:text-[#2B1610] disabled:opacity-50"
          >
            Back
          </button>
          <button
            type="submit"
            disabled={busy || !reason.trim()}
            className="flex items-center gap-2 bg-[#8C3B3B] text-white px-5 py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
          >
            {busy && <Loader2 className="w-4 h-4 animate-spin" />}
            Cancel booking
          </button>
        </div>
      </form>
    </div>
  );
}
