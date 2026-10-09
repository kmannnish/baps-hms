import React, { useState, useMemo } from 'react';
import { Check, X, Pencil, MessageCircleMore } from 'lucide-react';
import { fmtDate, toDateInput } from '../lib/datetime';

export default function SwamiDashboard({
  pendingBookings = [],
  approvedBookings = [],
  roomTypes = [],
  onDecideBooking,
  onEditBooking,
  buildWhatsAppLink,
}) {
  const [drafts, setDrafts] = useState({});
  const [errors, setErrors] = useState({});

  const today = new Date();
  const activePending = useMemo(
    () => pendingBookings.filter((b) => new Date(b.checkoutDate) >= today),
    [pendingBookings]
  );
  const activeApproved = useMemo(
    () => approvedBookings.filter((b) => new Date(b.checkoutDate) >= today),
    [approvedBookings]
  );

  // The booking's dates arrive as ISO strings; normalize to 'YYYY-MM-DD' so the
  // <input type="date"> renders them (it rejects anything else and shows blank).
  const defaultDraft = (booking) => ({
    roomTypeId: booking.roomTypeId,
    checkinDate: toDateInput(booking.checkinDate),
    checkoutDate: toDateInput(booking.checkoutDate),
    billingTier: 'paid',
    discountPercent: 0,
  });

  const draftFor = (booking) => drafts[booking.id] ?? defaultDraft(booking);

  // Merge the patch onto the booking's CURRENT draft (seeded from defaultDraft on
  // first touch). Earlier this rebuilt the draft from a synthetic { id } booking,
  // which had no real date fields — so changing the tier or room type silently
  // wiped checkinDate/checkoutDate out of the draft.
  const updateDraft = (booking, patch) =>
    setDrafts((prev) => ({
      ...prev,
      [booking.id]: { ...(prev[booking.id] ?? defaultDraft(booking)), ...patch },
    }));

  const computeFullPrice = (booking, draft) => {
    const rt = roomTypes.find((r) => r.id === (draft.roomTypeId || booking.roomTypeId));
    if (!rt) return null;
    const ci = new Date(draft.checkinDate || booking.checkinDate);
    const co = new Date(draft.checkoutDate || booking.checkoutDate);
    const nights = Math.max(1, Math.round((co - ci) / 86400000));
    const numRooms = booking.numRooms ?? 1;
    return Math.round(Number(rt.base_price) * nights * numRooms);
  };

  const handleDecision = async (booking, action) => {
    const draft = draftFor(booking);
    if (draft.billingTier === 'discount' && !draft.discountPercent) {
      alert('Enter a discount percentage before approving.');
      return;
    }
    // Omit a blank date (a cleared input) instead of sending '' — the backend
    // COALESCEs undefined to the booking's existing date, but '' would fail to
    // cast to DATE.
    const payload = {
      action,
      ...draft,
      checkinDate: draft.checkinDate || undefined,
      checkoutDate: draft.checkoutDate || undefined,
    };
    const err = await onDecideBooking?.(booking.id, payload);
    if (err) {
      setErrors((prev) => ({ ...prev, [booking.id]: err.message || err.error }));
    } else {
      setErrors((prev) => { const n = { ...prev }; delete n[booking.id]; return n; });
    }
  };

  return (
    <div className="bg-[#F8F4EC] min-h-full space-y-8">
      {/* ---- Pending ---- */}
      <section>
        <h2 className="text-xs uppercase tracking-widest text-[#B8792F] mb-3">Pending approval</h2>
        {activePending.length === 0 && (
          <p className="text-sm text-[#2B1610]/40">No pending requests.</p>
        )}
        {activePending.map((booking) => (
          <BookingCard
            key={booking.id}
            booking={booking}
            draft={draftFor(booking)}
            roomTypes={roomTypes}
            error={errors[booking.id]}
            fullPrice={computeFullPrice(booking, draftFor(booking))}
            updateDraft={updateDraft}
            handleDecision={handleDecision}
            buildWhatsAppLink={buildWhatsAppLink}
            isPending
          />
        ))}
      </section>

      {/* ---- Approved ---- */}
      {activeApproved.length > 0 && (
        <section>
          <h2 className="text-xs uppercase tracking-widest text-[#4A6D5C] mb-3">Approved</h2>
          {activeApproved.map((booking) => (
            <BookingCard
              key={booking.id}
              booking={booking}
              draft={draftFor(booking)}
              roomTypes={roomTypes}
              error={errors[booking.id]}
              fullPrice={computeFullPrice(booking, draftFor(booking))}
              updateDraft={updateDraft}
              handleDecision={handleDecision}
              buildWhatsAppLink={buildWhatsAppLink}
              onEditBooking={onEditBooking}
              isPending={false}
            />
          ))}
        </section>
      )}
    </div>
  );
}

function BookingCard({ booking, draft, roomTypes, error, fullPrice, updateDraft, handleDecision, buildWhatsAppLink, onEditBooking, isPending }) {
  return (
    <div className="border border-[#2B1610]/10 bg-white/40 p-5 mb-4">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-4">
        <div>
          <p className="font-serif text-lg text-[#2B1610]">{booking.guestName}</p>
          <p className="text-xs text-[#2B1610]/50">
            {booking.mobile} · Sant ref: {booking.santReferenceName || '—'} ({booking.santReferenceMobile || '—'})
          </p>
          <p className="text-xs text-[#2B1610]/50 mt-1">
            {booking.paxMen}M · {booking.paxWomen}W · {booking.paxChildren}C
            {booking.numRooms > 1 && <span className="ml-2">· {booking.numRooms} rooms</span>}
          </p>
          <p className="text-xs text-[#2B1610]/50 mt-1">
            {fmtDate(booking.checkinDate)} → {fmtDate(booking.checkoutDate)}
            {booking.roomTypeName && <span className="ml-2">· {booking.roomTypeName}</span>}
          </p>
          {booking.approvedByName && (
            <p className="text-xs text-[#4A6D5C] mt-1">Approved by: {booking.approvedByName}</p>
          )}
        </div>
        <span className="text-xs uppercase tracking-wide text-[#B8792F] border border-[#B8792F]/40 px-2 py-1">
          {booking.channel === 'walkin' ? 'Walk-in' : 'Online'}
        </span>
      </div>

      {isPending && (
        <>
          {/* Modification controls */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4">
            <div>
              <label className="text-xs text-[#2B1610]/50 block mb-1">Room type</label>
              <select
                value={draft.roomTypeId}
                onChange={(e) => updateDraft(booking, { roomTypeId: e.target.value })}
                className="w-full border border-[#2B1610]/20 bg-white px-2 py-2 text-sm"
              >
                {roomTypes.map((rt) => (
                  <option key={rt.id} value={rt.id}>{rt.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="text-xs text-[#2B1610]/50 block mb-1">Check-in</label>
              <input
                type="date"
                value={draft.checkinDate}
                onChange={(e) => updateDraft(booking, { checkinDate: e.target.value })}
                className="w-full border border-[#2B1610]/20 bg-white px-2 py-2 text-sm"
              />
            </div>
            <div>
              <label className="text-xs text-[#2B1610]/50 block mb-1">Check-out</label>
              <input
                type="date"
                value={draft.checkoutDate}
                onChange={(e) => updateDraft(booking, { checkoutDate: e.target.value })}
                className="w-full border border-[#2B1610]/20 bg-white px-2 py-2 text-sm"
              />
            </div>
          </div>

          {/* Billing tier */}
          <div className="flex flex-wrap items-center gap-3 mb-4">
            {['foc', 'discount', 'paid'].map((tier) => (
              <label
                key={tier}
                className={`flex items-center gap-2 border px-3 py-2 text-sm cursor-pointer ${
                  draft.billingTier === tier
                    ? 'border-[#B8792F] bg-[#B8792F]/10 text-[#2B1610]'
                    : 'border-[#2B1610]/15 text-[#2B1610]/60'
                }`}
              >
                <input
                  type="radio"
                  name={`tier-${booking.id}`}
                  className="hidden"
                  checked={draft.billingTier === tier}
                  onChange={() => updateDraft(booking, { billingTier: tier })}
                />
                {tier === 'foc'
                  ? 'Free of charge'
                  : tier === 'discount'
                  ? 'Discount'
                  : fullPrice != null
                  ? `Full price — ₹${fullPrice}`
                  : 'Full price'}
              </label>
            ))}
            {draft.billingTier === 'discount' && (
              <input
                type="number"
                min={0}
                max={100}
                placeholder="% off"
                value={draft.discountPercent}
                onChange={(e) => updateDraft(booking, { discountPercent: Number(e.target.value) })}
                className="w-24 border border-[#2B1610]/20 bg-white px-2 py-2 text-sm"
              />
            )}
          </div>

          {/* Error */}
          {error && (
            <p className="text-xs text-red-600 mb-3">{error}</p>
          )}

          {/* Actions */}
          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => handleDecision(booking, 'approve')}
              className="flex items-center gap-1.5 bg-[#4A6D5C] text-white px-4 py-2 text-sm hover:opacity-90"
            >
              <Check className="w-4 h-4" /> Approve
            </button>
            <button
              onClick={() => handleDecision(booking, 'modify')}
              className="flex items-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610] px-4 py-2 text-sm hover:bg-[#2B1610]/5"
            >
              <Pencil className="w-4 h-4" /> Save changes
            </button>
            <button
              onClick={() => handleDecision(booking, 'reject')}
              className="flex items-center gap-1.5 bg-[#8C3B3B] text-white px-4 py-2 text-sm hover:opacity-90"
            >
              <X className="w-4 h-4" /> Reject
            </button>
            <a
              href={buildWhatsAppLink?.(booking, draft.billingTier)}
              target="_blank"
              rel="noreferrer"
              className="ml-auto flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline"
            >
              <MessageCircleMore className="w-4 h-4" /> Send WhatsApp update
            </a>
          </div>
        </>
      )}

      {!isPending && (
        <div className="flex flex-wrap items-center gap-3 mt-2">
          <button
            onClick={() => onEditBooking?.(booking._raw)}
            disabled={!booking._raw || !onEditBooking}
            className="flex items-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610] px-4 py-2 text-sm hover:bg-[#2B1610]/5 disabled:opacity-40"
          >
            <Pencil className="w-4 h-4" /> Edit booking
          </button>
          <a
            href={buildWhatsAppLink?.(booking, 'approved')}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline"
          >
            <MessageCircleMore className="w-4 h-4" /> Send confirmation WhatsApp
          </a>
        </div>
      )}
    </div>
  );
}
