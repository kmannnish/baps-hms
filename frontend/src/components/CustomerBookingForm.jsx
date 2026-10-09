import React, { useState, useEffect, useCallback } from 'react';
import { Info, Users, Calendar, Phone, User, CheckCircle2, AlertCircle, X, Clock } from 'lucide-react';

/**
 * CustomerBookingForm
 *
 * Fields: Full Name, Mobile, Pax (Men/Women/Children), Dates/Times, Sant
 * Reference (free text name + number), Room Type.
 *
 * Dynamic Inventory Blocking: whenever roomType or dates change, calls
 * GET /bookings/availability and disables that room type's option if full.
 *
 * Submission is gated behind a T&C popup stating the booking is PENDING
 * until BAPS Jaipur approval.
 *
 * ID photos are NOT collected online — the guest is told to carry a valid
 * government ID, and Reception records it at physical check-in. This keeps
 * sensitive IDs off the public cloud entirely (the form runs against the cloud
 * backend when the PC is asleep).
 *
 * props.roomTypes: [{ id, name, basePrice }]
 * props.onSubmit: (payload) => Promise
 * props.apiBaseUrl: string  // e.g. 'https://api.bapsjaipur.org'
 */
export default function CustomerBookingForm({ roomTypes = [], onSubmit, apiBaseUrl, termsText }) {
  const [form, setForm] = useState({
    guestName: '',
    mobile: '',
    paxMen: 1,
    paxWomen: 0,
    paxChildren: 0,
    numRooms: 1,
    checkinDate: '',
    checkoutDate: '',
    preferredArrivalTime: '',
    preferredDepartureTime: '',
    santReferenceName: '',
    santReferenceMobile: '',
    roomTypeId: roomTypes[0]?.id ?? '',
  });

  const [availability, setAvailability] = useState({}); // roomTypeId -> { available, cap, booked }
  const [checkingAvailability, setCheckingAvailability] = useState(false);
  const [showTerms, setShowTerms] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [submitted, setSubmitted] = useState(false);
  const [error, setError] = useState('');

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  // Re-check availability for every room type whenever dates or quantity change
  const checkAvailability = useCallback(async () => {
    if (!form.checkinDate || !form.checkoutDate) return;
    setCheckingAvailability(true);
    try {
      const results = await Promise.all(
        roomTypes.map((rt) =>
          fetch(
            `${apiBaseUrl}/bookings/availability?roomTypeId=${rt.id}&checkin=${form.checkinDate}&checkout=${form.checkoutDate}&numRooms=${form.numRooms}`
          ).then((r) => r.json())
        )
      );
      const next = {};
      roomTypes.forEach((rt, i) => { next[rt.id] = results[i]; });
      setAvailability(next);
    } catch {
      // if the availability check fails, don't block the form — server re-validates on submit anyway
    } finally {
      setCheckingAvailability(false);
    }
  }, [form.checkinDate, form.checkoutDate, form.numRooms, roomTypes, apiBaseUrl]);

  useEffect(() => { checkAvailability(); }, [checkAvailability]);

  const isRoomTypeFull = (roomTypeId) => availability[roomTypeId]?.available === false;

  const validate = () => {
    if (!form.guestName || !form.mobile) return 'Name and mobile are required.';
    if (!form.checkinDate || !form.checkoutDate) return 'Please select check-in and check-out dates.';
    if (new Date(form.checkoutDate) <= new Date(form.checkinDate)) return 'Check-out must be after check-in.';
    if (!form.santReferenceName || !form.santReferenceMobile) return 'Sant reference name and number are required.';
    if (!form.roomTypeId) return 'Please select a room type.';
    if (isRoomTypeFull(form.roomTypeId)) return 'That room type is fully booked for these dates. Please pick another.';
    return null;
  };

  const handleSubmitClick = (e) => {
    e.preventDefault();
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError('');
    setShowTerms(true);
  };

  const confirmSubmit = async () => {
    setSubmitting(true);
    try {
      // Online guests don't upload ID — no sensitive IDs on the public cloud.
      // Reception records it at the desk (PATCH /bookings/:id/id-document).
      await onSubmit?.({ ...form, idDocumentUrl: null });
      setSubmitted(true);
      setShowTerms(false);
    } catch (err) {
      setError('Something went wrong submitting your request. Please try again.');
      setShowTerms(false);
    } finally {
      setSubmitting(false);
    }
  };

  if (submitted) {
    return (
      <div className="max-w-md mx-auto bg-[#F8F4EC] border border-[#2B1610]/10 p-8 text-center">
        <CheckCircle2 className="w-10 h-10 text-[#4A6D5C] mx-auto mb-4" strokeWidth={1.5} />
        <h3 className="font-serif text-xl text-[#2B1610] mb-2">Request received</h3>
        <p className="text-sm text-[#2B1610]/60">
          Your booking is pending BAPS Jaipur's approval. You'll be notified once it's confirmed.
        </p>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmitClick} className="max-w-2xl mx-auto bg-[#F8F4EC] border border-[#2B1610]/10 p-6 sm:p-8 space-y-6">
      <div>
        <h2 className="font-serif text-2xl text-[#2B1610] mb-1">Request a stay</h2>
        <p className="text-sm text-[#2B1610]/50">BAPS Shri Swaminarayan Mandir, Jaipur — Utara</p>
      </div>

      {error && (
        <div className="flex items-start gap-2 bg-[#8C3B3B]/10 border border-[#8C3B3B]/30 text-[#8C3B3B] text-sm px-3 py-2">
          <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
          {error}
        </div>
      )}

      {/* Identity */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Full name" icon={User}>
          <input
            value={form.guestName}
            onChange={(e) => update({ guestName: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
            placeholder="Your full name"
          />
        </Field>
        <Field label="Mobile number" icon={Phone}>
          <input
            value={form.mobile}
            onChange={(e) => update({ mobile: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
            placeholder="+91 XXXXX XXXXX"
          />
        </Field>
      </div>

      {/* Pax */}
      <div>
        <label className="flex items-center gap-1.5 mb-2 text-xs uppercase tracking-wide text-[#2B1610]/50"><Users className="w-3.5 h-3.5" /> Pax</label>
        <div className="grid grid-cols-3 gap-3">
          {[
            ['paxMen', 'Men'],
            ['paxWomen', 'Women'],
            ['paxChildren', 'Children'],
          ].map(([key, label]) => (
            <div key={key}>
              <input
                type="number"
                min={0}
                value={form[key]}
                onChange={(e) => update({ [key]: Number(e.target.value) })}
                className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
              />
              <p className="text-xs text-[#2B1610]/40 mt-1">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Room quantity */}
      <div>
        <label className="mb-2 block text-xs uppercase tracking-wide text-[#2B1610]/50">Number of rooms needed</label>
        <input
          type="number"
          min={1}
          value={form.numRooms}
          onChange={(e) => update({ numRooms: Math.max(1, Number(e.target.value)) })}
          className="w-32 border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
        />
      </div>

      {/* Dates */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Check-in" icon={Calendar}>
          <input
            type="date"
            value={form.checkinDate}
            onChange={(e) => update({ checkinDate: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
          />
        </Field>
        <Field label="Check-out" icon={Calendar}>
          <input
            type="date"
            value={form.checkoutDate}
            onChange={(e) => update({ checkoutDate: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
          />
        </Field>
      </div>

      {/* Sant reference */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Sant reference — name">
          <input
            value={form.santReferenceName}
            onChange={(e) => update({ santReferenceName: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
            placeholder="Referring Sant's name"
          />
        </Field>
        <Field label="Sant reference — number">
          <input
            value={form.santReferenceMobile}
            onChange={(e) => update({ santReferenceMobile: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
            placeholder="Referring Sant's mobile"
          />
        </Field>
      </div>

      {/* Room type */}
      <div>
        <label className="mb-2 block text-xs uppercase tracking-wide text-[#2B1610]/50">Room type</label>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {roomTypes.map((rt) => {
            const full = isRoomTypeFull(rt.id);
            const selected = form.roomTypeId === rt.id;
            return (
              <button
                type="button"
                key={rt.id}
                disabled={full}
                onClick={() => update({ roomTypeId: rt.id })}
                className={`text-left border px-4 py-3 transition-colors ${
                  full
                    ? 'border-[#2B1610]/10 bg-[#2B1610]/5 text-[#2B1610]/30 cursor-not-allowed'
                    : selected
                    ? 'border-[#B8792F] bg-[#B8792F]/10 text-[#2B1610]'
                    : 'border-[#2B1610]/15 text-[#2B1610]/70 hover:border-[#2B1610]/30'
                }`}
              >
                <p className="font-serif text-base">{rt.name}</p>
                <p className="text-xs mt-0.5">
                  {full ? 'Fully booked for these dates' : checkingAvailability ? 'Checking…' : 'Available'}
                </p>
              </button>
            );
          })}
        </div>
      </div>

      {/* ID note — captured at the desk, never uploaded online */}
      <div className="flex items-start gap-2 border border-[#2B1610]/15 bg-[#2B1610]/5 px-4 py-3">
        <Info className="w-4 h-4 mt-0.5 shrink-0 text-[#B8792F]" strokeWidth={1.75} />
        <p className="text-sm text-[#2B1610]/60">
          Please carry a valid government ID — it will be recorded by Reception at check-in.
        </p>
      </div>

      {/* Preferred times */}
      <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
        <Field label="Preferred arrival time (optional)" icon={Clock}>
          <input
            type="time"
            value={form.preferredArrivalTime}
            onChange={(e) => update({ preferredArrivalTime: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
          />
        </Field>
        <Field label="Preferred departure time (optional)" icon={Clock}>
          <input
            type="time"
            value={form.preferredDepartureTime}
            onChange={(e) => update({ preferredDepartureTime: e.target.value })}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm text-[#2B1610] focus:outline-none focus:border-[#B8792F]"
          />
        </Field>
      </div>

      <button
        type="submit"
        className="w-full bg-[#2B1610] text-[#F8F4EC] py-3 text-sm tracking-wide hover:bg-[#3d2118] transition-colors"
      >
        Submit request
      </button>

      {showTerms && (
        <TermsModal
          submitting={submitting}
          onCancel={() => setShowTerms(false)}
          onConfirm={confirmSubmit}
          termsText={termsText}
        />
      )}
    </form>
  );
}

function Field({ label, icon: Icon, children }) {
  return (
    <div>
      <label className="flex items-center gap-1.5 mb-1.5 text-xs uppercase tracking-wide text-[#2B1610]/50">
        {Icon && <Icon className="w-3.5 h-3.5" />} {label}
      </label>
      {children}
    </div>
  );
}

function TermsModal({ onCancel, onConfirm, submitting, termsText }) {
  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-sm w-full p-6 relative">
        <button onClick={onCancel} className="absolute top-4 right-4 text-[#2B1610]/40 hover:text-[#2B1610]">
          <X className="w-5 h-5" />
        </button>
        <h3 className="font-serif text-lg text-[#2B1610] mb-3">Before you submit</h3>
        <p className="text-sm text-[#2B1610]/70 leading-relaxed mb-6">
          {termsText || "Your booking is PENDING and only confirmed upon BAPS Jaipur's approval."}
        </p>
        <div className="flex gap-2">
          <button
            onClick={onCancel}
            className="flex-1 border border-[#2B1610]/20 text-[#2B1610] py-2.5 text-sm hover:bg-[#2B1610]/5"
          >
            Go back
          </button>
          <button
            onClick={onConfirm}
            disabled={submitting}
            className="flex-1 bg-[#2B1610] text-[#F8F4EC] py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-60"
          >
            {submitting ? 'Submitting…' : 'I understand, submit'}
          </button>
        </div>
      </div>
    </div>
  );
}
