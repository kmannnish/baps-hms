import React, { useState, useEffect } from 'react';
import { X, Loader2, IndianRupee, Save } from 'lucide-react';
import { fetchArray } from '../lib/api';
import { toDateInput } from '../lib/datetime';

/**
 * EditBookingModal — "edit everything later" for a booking, opened from the
 * Booking History tab. Pre-filled from the /bookings/history row (snake_case),
 * it edits BOTH the booking details and the money, each gated by its own
 * permission so one modal serves every role:
 *
 *   • Details  → PATCH /bookings/:id           (can_modify_bookings)
 *   • The bill → PUT  /bookings/:id/billing    (can_set_billing_tier)
 *   • Payment  → POST /bookings/:id/pay        (can_mark_payment)
 *
 * The amount is NEVER free-typed — it's the server's job. Changing the billing
 * tier / discount (or the dates / room type) is what moves the amount, and the
 * server recomputes it (respecting the tax toggle). This modal only shows the
 * current stored amount and refreshes after saving.
 *
 * Save runs the three calls in order — details → bill → payment — and ONLY the
 * sections that actually changed, so an untouched section is never rewritten
 * (which matters for the bill: PUT /billing re-derives final_amount from scratch
 * and would drop any late/extra checkout charges, so we leave it alone unless the
 * tier/discount really changed). The payment call runs last so its overpayment
 * check sees the just-recomputed amount. On a partial failure we stop, say which
 * step failed, and keep the modal open — re-saving replays the earlier steps
 * idempotently.
 */

const TIERS = [
  { value: 'foc', label: 'Free of charge', hint: 'Amount becomes ₹0' },
  { value: 'discount', label: 'Discount', hint: 'Percentage off the room charge' },
  { value: 'paid', label: 'Full price', hint: 'Room charge in full' },
];

const METHODS = [
  { value: 'cash', label: 'Cash' },
  { value: 'upi', label: 'UPI' },
  { value: 'card', label: 'Card' },
];

const INPUT = 'w-full border border-[#2B1610]/20 bg-white px-3 py-2 text-sm focus:outline-none focus:border-[#B8792F]';

export default function EditBookingModal({
  booking: b,
  apiBaseUrl,
  token,
  canModify = false,
  canSetBilling = false,
  canMarkPayment = false,
  onClose,
  onSaved,
}) {
  const [roomTypes, setRoomTypes] = useState([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState(null);   // friendly message of the step that failed
  const [savedSteps, setSavedSteps] = useState([]); // human labels of steps already saved this attempt

  // --- details ---
  const [guestName, setGuestName] = useState(b.guest_name || '');
  const [mobile, setMobile] = useState(b.mobile || '');
  const [paxMen, setPaxMen] = useState(String(b.pax_men ?? 0));
  const [paxWomen, setPaxWomen] = useState(String(b.pax_women ?? 0));
  const [paxChildren, setPaxChildren] = useState(String(b.pax_children ?? 0));
  const [santName, setSantName] = useState(b.sant_reference_name || '');
  const [santMobile, setSantMobile] = useState(b.sant_reference_mobile || '');
  const [arrivalTime, setArrivalTime] = useState((b.preferred_arrival_time || '').slice(0, 5));
  const [departureTime, setDepartureTime] = useState((b.preferred_departure_time || '').slice(0, 5));
  const [dineB, setDineB] = useState(!!b.dine_breakfast);
  const [dineL, setDineL] = useState(!!b.dine_lunch);
  const [dineD, setDineD] = useState(!!b.dine_dinner);
  const [roomTypeId, setRoomTypeId] = useState(b.room_type_id || '');
  const [checkinDate, setCheckinDate] = useState(toDateInput(b.checkin_date));
  const [checkoutDate, setCheckoutDate] = useState(toDateInput(b.checkout_date));

  // --- the bill ---
  const [billingTier, setBillingTier] = useState(b.billing_tier || '');
  const [discountPercent, setDiscountPercent] = useState(String(b.discount_percent ?? 0));

  // --- payment (a NEW payment to record) ---
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  useEffect(() => {
    let active = true;
    fetchArray(`${apiBaseUrl}/inventory/room-types`).then((rows) => {
      if (active) setRoomTypes(rows);
    });
    return () => { active = false; };
  }, [apiBaseUrl]);

  const finalAmt = Number(b.final_amount ?? 0);
  const amtPaid = Number(b.amount_paid ?? 0);
  const balance = Math.max(0, finalAmt - amtPaid);
  const roomTypeLocked = b.status === 'checked_in'; // backend refuses a type change while checked in

  // Which sections actually changed, so we only call the endpoints we need to.
  const detailsDirty =
    guestName.trim() !== (b.guest_name || '') ||
    mobile.trim() !== (b.mobile || '') ||
    Number(paxMen || 0) !== Number(b.pax_men ?? 0) ||
    Number(paxWomen || 0) !== Number(b.pax_women ?? 0) ||
    Number(paxChildren || 0) !== Number(b.pax_children ?? 0) ||
    santName !== (b.sant_reference_name || '') ||
    santMobile !== (b.sant_reference_mobile || '') ||
    arrivalTime !== (b.preferred_arrival_time || '').slice(0, 5) ||
    departureTime !== (b.preferred_departure_time || '').slice(0, 5) ||
    dineB !== !!b.dine_breakfast ||
    dineL !== !!b.dine_lunch ||
    dineD !== !!b.dine_dinner ||
    String(roomTypeId) !== String(b.room_type_id) ||
    checkinDate !== toDateInput(b.checkin_date) ||
    checkoutDate !== toDateInput(b.checkout_date);

  const billingDirty =
    billingTier !== (b.billing_tier || '') ||
    (billingTier === 'discount' && Number(discountPercent || 0) !== Number(b.discount_percent ?? 0));

  const payAmt = Number(payAmount);
  const paymentDirty = payAmount !== '' && payAmt > 0;

  const anyDirty =
    (canModify && detailsDirty) ||
    (canSetBilling && billingDirty) ||
    (canMarkPayment && paymentDirty);

  // Map a backend error body to a sentence a receptionist can act on.
  const friendly = (step, body) => {
    const code = body?.error;
    const map = {
      MISSING_REQUIRED_FIELDS: 'Guest name and mobile are both required.',
      ROOM_TYPE_LOCKED: 'Check the guest out before changing the room type.',
      CHECKOUT_BEFORE_CHECKIN: 'Check-out must be after check-in.',
      NO_VACANCY: 'No rooms of that type are free for those dates.',
      INVALID_AMOUNT: 'Enter a payment amount greater than zero.',
      INVALID_METHOD: 'Pick a payment method.',
      OVERPAYMENT: `That is more than the balance due${
        body?.maxAllowed != null ? ` — at most ₹${Number(body.maxAllowed).toLocaleString('en-IN')}` : ''
      }.`,
      BOOKING_NOT_FOUND: 'This booking no longer exists — refresh the list.',
    };
    return `${step}: ${map[code] || body?.message || body?.error || 'Could not save.'}`;
  };

  const save = async () => {
    setError(null);
    if (!anyDirty) {
      setError('No changes to save.');
      return;
    }
    setSaving(true);
    const done = [];
    let latest = b;
    try {
      // 1) Details
      if (canModify && detailsDirty) {
        const res = await fetch(`${apiBaseUrl}/bookings/${b.id}`, {
          method: 'PATCH',
          headers: authHeaders,
          body: JSON.stringify({
            guestName: guestName.trim(),
            mobile: mobile.trim(),
            paxMen: Math.max(0, Number(paxMen) || 0),
            paxWomen: Math.max(0, Number(paxWomen) || 0),
            paxChildren: Math.max(0, Number(paxChildren) || 0),
            santReferenceName: santName.trim(),
            santReferenceMobile: santMobile.trim(),
            preferredArrivalTime: arrivalTime || '',
            preferredDepartureTime: departureTime || '',
            dineBreakfast: dineB,
            dineLunch: dineL,
            dineDinner: dineD,
            roomTypeId,
            checkinDate,
            checkoutDate,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setError(friendly('Details', body)); setSavedSteps(done); return; }
        latest = body; done.push('details');
      }

      // 2) The bill (tier / discount). Only when it moved — PUT /billing recomputes
      //    final_amount from scratch, so skipping it preserves any checkout extras.
      if (canSetBilling && billingDirty) {
        const res = await fetch(`${apiBaseUrl}/bookings/${b.id}/billing`, {
          method: 'PUT',
          headers: authHeaders,
          body: JSON.stringify({
            billingTier,
            discountPercent: billingTier === 'discount' ? Math.min(100, Math.max(0, Number(discountPercent) || 0)) : 0,
          }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setError(friendly('Bill', body)); setSavedSteps(done); return; }
        latest = body; done.push('bill');
      }

      // 3) Payment — last, so its overpayment check sees the recomputed amount.
      if (canMarkPayment && paymentDirty) {
        const res = await fetch(`${apiBaseUrl}/bookings/${b.id}/pay`, {
          method: 'POST',
          headers: authHeaders,
          body: JSON.stringify({ amount: payAmt, method: payMethod, note: payNote.trim() }),
        });
        const body = await res.json().catch(() => ({}));
        if (!res.ok) { setError(friendly('Payment', body)); setSavedSteps(done); return; }
        latest = body; done.push('payment');
      }

      onSaved?.(latest);
    } catch {
      setError('Network error — could not reach the server. Any steps already saved are kept.');
      setSavedSteps(done);
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-lg w-full p-6 relative max-h-[90vh] overflow-y-auto">
        <button onClick={onClose} className="absolute top-4 right-4 text-[#2B1610]/40 hover:text-[#2B1610]">
          <X className="w-5 h-5" />
        </button>

        <h3 className="font-serif text-xl text-[#2B1610] mb-0.5 pr-8">Edit booking</h3>
        <p className="text-sm text-[#2B1610]/60 mb-5">
          {b.guest_name} · <span className="uppercase tracking-wide text-xs">{b.status}</span>
          {b.num_rooms > 1 ? ` · ${b.num_rooms} rooms` : ''}
        </p>

        {/* ---- Details ---- */}
        {canModify && (
          <section className="mb-6">
            <h4 className="text-xs uppercase tracking-wide text-[#2B1610]/50 mb-3">Guest details</h4>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Guest name" className="col-span-2">
                <input className={INPUT} value={guestName} onChange={(e) => setGuestName(e.target.value)} />
              </Field>
              <Field label="Mobile" className="col-span-2">
                <input className={INPUT} value={mobile} onChange={(e) => setMobile(e.target.value)} />
              </Field>
              <Field label="Men"><input type="number" min="0" className={INPUT} value={paxMen} onChange={(e) => setPaxMen(e.target.value)} /></Field>
              <Field label="Women"><input type="number" min="0" className={INPUT} value={paxWomen} onChange={(e) => setPaxWomen(e.target.value)} /></Field>
              <Field label="Children"><input type="number" min="0" className={INPUT} value={paxChildren} onChange={(e) => setPaxChildren(e.target.value)} /></Field>
              <Field label="Room type">
                <select className={INPUT} value={roomTypeId} onChange={(e) => setRoomTypeId(e.target.value)} disabled={roomTypeLocked}>
                  {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
                </select>
              </Field>
              <Field label="Check-in"><input type="date" className={INPUT} value={checkinDate} onChange={(e) => setCheckinDate(e.target.value)} /></Field>
              <Field label="Check-out"><input type="date" className={INPUT} value={checkoutDate} onChange={(e) => setCheckoutDate(e.target.value)} /></Field>
              <Field label="Arrival time"><input type="time" className={INPUT} value={arrivalTime} onChange={(e) => setArrivalTime(e.target.value)} /></Field>
              <Field label="Departure time"><input type="time" className={INPUT} value={departureTime} onChange={(e) => setDepartureTime(e.target.value)} /></Field>
              <Field label="Sant reference"><input className={INPUT} value={santName} onChange={(e) => setSantName(e.target.value)} /></Field>
              <Field label="Sant mobile"><input className={INPUT} value={santMobile} onChange={(e) => setSantMobile(e.target.value)} /></Field>
            </div>
            {roomTypeLocked && (
              <p className="text-[11px] text-[#2B1610]/40 mt-2">Room type is locked while the guest is checked in.</p>
            )}
            <div className="flex items-center gap-4 mt-3">
              <span className="text-xs text-[#2B1610]/50">Bhojanshala:</span>
              <Check label="Breakfast" on={dineB} onToggle={() => setDineB((v) => !v)} />
              <Check label="Lunch" on={dineL} onToggle={() => setDineL((v) => !v)} />
              <Check label="Dinner" on={dineD} onToggle={() => setDineD((v) => !v)} />
            </div>
          </section>
        )}

        {/* ---- The bill ---- */}
        {canSetBilling && (
          <section className="mb-6">
            <h4 className="text-xs uppercase tracking-wide text-[#2B1610]/50 mb-3">The bill</h4>
            <div className="border border-[#2B1610]/10 bg-white/40 px-3 py-2.5 mb-3 flex items-center justify-between text-sm">
              <span className="text-[#2B1610]/60">Current amount</span>
              <span className="inline-flex items-center text-[#2B1610] font-medium">
                <IndianRupee className="w-3.5 h-3.5" />{finalAmt.toLocaleString('en-IN')}
              </span>
            </div>
            <div className="space-y-1.5">
              {TIERS.map((t) => (
                <label key={t.value} className="flex items-center gap-2 text-sm cursor-pointer">
                  <input
                    type="radio"
                    name="billingTier"
                    className="accent-[#B8792F]"
                    checked={billingTier === t.value}
                    onChange={() => setBillingTier(t.value)}
                  />
                  <span className="text-[#2B1610]">{t.label}</span>
                  <span className="text-xs text-[#2B1610]/40">· {t.hint}</span>
                </label>
              ))}
            </div>
            {billingTier === 'discount' && (
              <Field label="Discount %" className="mt-3 w-40">
                <input type="number" min="0" max="100" className={INPUT} value={discountPercent} onChange={(e) => setDiscountPercent(e.target.value)} />
              </Field>
            )}
            <p className="text-[11px] text-[#2B1610]/40 mt-2">
              The amount is recomputed on save from the tier, discount, dates and the tax setting.
            </p>
          </section>
        )}

        {/* ---- Payment ---- */}
        {canMarkPayment && (
          <section className="mb-6">
            <h4 className="text-xs uppercase tracking-wide text-[#2B1610]/50 mb-3">Record a payment</h4>
            <div className="flex flex-wrap gap-4 text-sm mb-3">
              <span className="text-[#2B1610]/60">Paid <b className="text-[#2B1610]">₹{amtPaid.toLocaleString('en-IN')}</b></span>
              <span className="text-[#2B1610]/60">Balance <b className={balance > 0 ? 'text-[#8C3B3B]' : 'text-[#4A6D5C]'}>₹{balance.toLocaleString('en-IN')}</b></span>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <Field label="Amount to record">
                <div className="flex gap-2">
                  <input type="number" min="0" className={INPUT} value={payAmount} onChange={(e) => setPayAmount(e.target.value)} placeholder="0" />
                  {balance > 0 && (
                    <button
                      type="button"
                      onClick={() => setPayAmount(String(balance))}
                      className="shrink-0 border border-[#2B1610]/20 px-2 text-xs text-[#2B1610]/70 hover:border-[#2B1610]/40"
                      title="Fill the full balance due"
                    >
                      Full
                    </button>
                  )}
                </div>
              </Field>
              <Field label="Method">
                <select className={INPUT} value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  {METHODS.map((m) => <option key={m.value} value={m.value}>{m.label}</option>)}
                </select>
              </Field>
              <Field label="Note (optional)" className="col-span-2">
                <input className={INPUT} value={payNote} onChange={(e) => setPayNote(e.target.value)} placeholder="e.g. advance, balance on checkout" />
              </Field>
            </div>
            <p className="text-[11px] text-[#2B1610]/40 mt-2">
              Payments can only be added here, not reversed. Leave the amount blank to make no payment.
            </p>
          </section>
        )}

        {error && (
          <div className="mb-4 border border-[#C77A34]/40 bg-[#C77A34]/5 p-3">
            <p className="text-sm text-[#8C3B3B]">{error}</p>
            {savedSteps.length > 0 && (
              <p className="text-xs text-[#2B1610]/50 mt-1">
                Already saved: {savedSteps.join(', ')}. Fix the above and save again.
              </p>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={onClose}
            disabled={saving}
            className="flex-1 border border-[#2B1610]/20 text-[#2B1610]/70 py-2.5 text-sm hover:border-[#2B1610]/40 disabled:opacity-60"
          >
            Cancel
          </button>
          <button
            onClick={save}
            disabled={saving || !anyDirty}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#2B1610] text-[#F8F4EC] py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-50"
          >
            {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
            {saving ? 'Saving…' : 'Save changes'}
          </button>
        </div>
      </div>
    </div>
  );
}

function Field({ label, className = '', children }) {
  return (
    <label className={`block ${className}`}>
      <span className="text-xs text-[#2B1610]/50 block mb-1">{label}</span>
      {children}
    </label>
  );
}

// A small labelled checkbox for the dining opt-ins.
function Check({ label, on, onToggle }) {
  return (
    <label className="flex items-center gap-1.5 text-sm cursor-pointer">
      <input type="checkbox" className="accent-[#4A6D5C]" checked={on} onChange={onToggle} />
      <span className="text-[#2B1610]/80">{label}</span>
    </label>
  );
}
