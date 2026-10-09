import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Phone, Check, X, Users, Calendar, Clock, Upload, QrCode, AlertCircle, Eye, LogIn as CheckInIcon } from 'lucide-react';
import QRUploadTrigger from './QRUploadTrigger';
import GuestDetailModal from './GuestDetailModal';
import { fetchArray } from '../lib/api';

/**
 * WalkInBookingPanel
 *
 * Two things Reception needs for walk-in guests, entirely on the local
 * network — no dependency on Swami Ji being reachable online:
 *
 *   1. A quick form to create the booking right at the desk
 *      (POST /bookings/walkin) — now with real validation feedback (fixed
 *      a bug where an incomplete form silently did nothing) and an ID
 *      upload step with a choice of "PC file" or "QR to phone".
 *   2. A list of pending walk-ins with a "Record decision" action, for
 *      when Reception calls or WhatsApps Swami Ji, gets a verbal answer,
 *      and records it themselves (POST /bookings/:id/decide).
 *
 * props.apiBaseUrl, props.token, props.roomTypes, props.socket
 */
export default function WalkInBookingPanel({ apiBaseUrl, token, roomTypes, socket }) {
  const [pending, setPending] = useState([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [decidingBooking, setDecidingBooking] = useState(null);
  const [viewingBookingId, setViewingBookingId] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadPending = useCallback(async () => {
    setPending(await fetchArray(`${apiBaseUrl}/bookings/pending?channel=walkin`, { headers: authHeaders }));
  }, [apiBaseUrl, token]);

  useEffect(() => { loadPending(); /* eslint-disable-next-line */ }, [loadPending]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => loadPending();
    socket.on('booking:new', refresh);
    socket.on('booking:updated', refresh);
    return () => {
      socket.off('booking:new', refresh);
      socket.off('booking:updated', refresh);
    };
  }, [socket, loadPending]);

  const createWalkIn = async (payload) => {
    const res = await fetch(`${apiBaseUrl}/bookings/walkin`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      throw new Error(body.error === 'CHECKOUT_BEFORE_CHECKIN'
        ? 'Check-out must be after check-in.'
        : 'Could not create the booking. Please check every field and try again.');
    }
    setShowNewForm(false);
    loadPending();
  };

  const recordDecision = async (bookingId, decision) => {
    await fetch(`${apiBaseUrl}/bookings/${bookingId}/decide`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(decision),
    });
    setDecidingBooking(null);
    loadPending();
  };

  return (
    <div>
      <div className="flex items-center justify-between mb-5">
        <h3 className="font-serif text-lg text-[#2B1610]">Bookings</h3>
        <button
          onClick={() => setShowNewForm(true)}
          className="flex items-center gap-1.5 bg-[#2B1610] text-[#F8F4EC] px-4 py-2 text-sm hover:bg-[#3d2118]"
        >
          <Plus className="w-4 h-4" /> New booking
        </button>
      </div>

      {pending.length === 0 ? (
        <p className="text-sm text-[#2B1610]/40">No pending bookings.</p>
      ) : (
        <div className="space-y-3">
          {pending.map((booking) => (
            <div key={booking.id} className="border border-[#2B1610]/10 bg-white/40 p-4 flex items-center justify-between gap-4">
              <div>
                <p className="font-serif text-[#2B1610]">{booking.guest_name}</p>
                <p className="text-xs text-[#2B1610]/50">
                  {booking.mobile} · {booking.checkin_date?.slice(0, 10)} → {booking.checkout_date?.slice(0, 10)}
                  {booking.num_rooms > 1 ? ` · ${booking.num_rooms} rooms` : ''}
                </p>
              </div>
              <div className="flex items-center gap-2 shrink-0">
                <button
                  onClick={() => setViewingBookingId(booking.id)}
                  className="flex items-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610]/80 px-3 py-2 text-sm hover:border-[#2B1610]/40"
                >
                  <Eye className="w-3.5 h-3.5" /> View ID
                </button>
                <button
                  onClick={() => setDecidingBooking(booking)}
                  className="flex items-center gap-1.5 border border-[#B8792F] text-[#B8792F] px-3 py-2 text-sm hover:bg-[#B8792F]/10"
                >
                  <Phone className="w-3.5 h-3.5" /> Record decision
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {showNewForm && (
        <NewWalkInModal
          roomTypes={roomTypes}
          apiBaseUrl={apiBaseUrl}
          onCancel={() => setShowNewForm(false)}
          onCreate={createWalkIn}
        />
      )}

      {decidingBooking && (
        <DecisionModal
          booking={decidingBooking}
          roomTypes={roomTypes}
          apiBaseUrl={apiBaseUrl}
          token={token}
          onCancel={() => setDecidingBooking(null)}
          onDecide={recordDecision}
          onCheckedIn={() => { setDecidingBooking(null); loadPending(); }}
        />
      )}

      {viewingBookingId && (
        <GuestDetailModal
          bookingId={viewingBookingId}
          apiBaseUrl={apiBaseUrl}
          token={token}
          onClose={() => setViewingBookingId(null)}
        />
      )}
    </div>
  );
}

function NewWalkInModal({ roomTypes, apiBaseUrl, onCancel, onCreate }) {
  const [form, setForm] = useState({
    guestName: '', mobile: '', paxMen: 1, paxWomen: 0, paxChildren: 0, numRooms: 1,
    checkinDate: new Date().toISOString().slice(0, 10),
    checkoutDate: '', santReferenceName: '', santReferenceMobile: '',
    preferredArrivalTime: '', preferredDepartureTime: '',
    roomTypeId: roomTypes[0]?.id ?? '',
  });
  const [idMethod, setIdMethod] = useState('pc'); // 'pc' | 'qr'
  const [idDocumentUrl, setIdDocumentUrl] = useState(null);
  const [uploadingId, setUploadingId] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');

  const update = (patch) => setForm((prev) => ({ ...prev, ...patch }));

  const validate = () => {
    if (!form.guestName.trim()) return 'Guest name is required.';
    if (!form.mobile.trim()) return 'Mobile number is required.';
    if (!form.checkinDate) return 'Check-in date is required.';
    if (!form.checkoutDate) return 'Check-out date is required.';
    if (new Date(form.checkoutDate) <= new Date(form.checkinDate)) return 'Check-out must be after check-in.';
    if (!form.roomTypeId) return 'Please select a room type.';
    return null;
  };

  const handlePcFileChange = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadingId(true);
    setError('');
    try {
      const formData = new FormData();
      formData.append('photo', file);
      const res = await fetch(`${apiBaseUrl}/id-uploads/direct/upload`, { method: 'POST', body: formData });
      if (!res.ok) throw new Error('Upload failed');
      const { imageUrl } = await res.json();
      setIdDocumentUrl(imageUrl);
    } catch {
      setError('ID upload failed. Please try again.');
    } finally {
      setUploadingId(false);
    }
  };

  const submit = async () => {
    const validationError = validate();
    if (validationError) { setError(validationError); return; }
    setError('');
    setSubmitting(true);
    try {
      await onCreate({ ...form, idDocumentUrl });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <h3 className="font-serif text-lg text-[#2B1610] mb-4">New booking</h3>

        {error && (
          <div className="flex items-start gap-2 bg-[#8C3B3B]/10 border border-[#8C3B3B]/30 text-[#8C3B3B] text-sm px-3 py-2 mb-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            placeholder="Guest name"
            value={form.guestName}
            onChange={(e) => update({ guestName: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="Mobile"
            value={form.mobile}
            onChange={(e) => update({ mobile: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm col-span-2"
          />
        </div>

        <div className="mb-3">
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1.5 mb-1.5">
            <Users className="w-3.5 h-3.5" /> Pax
          </label>
          <div className="grid grid-cols-3 gap-2">
            {[['paxMen', 'Men'], ['paxWomen', 'Women'], ['paxChildren', 'Children']].map(([key, label]) => (
              <div key={key}>
                <input
                  type="number" min={0} value={form[key]}
                  onChange={(e) => update({ [key]: Number(e.target.value) })}
                  className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
                />
                <p className="text-xs text-[#2B1610]/40 mt-0.5">{label}</p>
              </div>
            ))}
          </div>
        </div>

        <div className="mb-3">
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">Number of rooms</label>
          <input
            type="number" min={1} value={form.numRooms}
            onChange={(e) => update({ numRooms: Math.max(1, Number(e.target.value)) })}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-32"
          />
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1.5 mb-1.5">
              <Calendar className="w-3.5 h-3.5" /> Check-in
            </label>
            <input
              type="date" value={form.checkinDate}
              onChange={(e) => update({ checkinDate: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1.5 mb-1.5">
              <Calendar className="w-3.5 h-3.5" /> Check-out
            </label>
            <input
              type="date" value={form.checkoutDate}
              onChange={(e) => update({ checkoutDate: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
        </div>

        {/* Expected arrival / departure times — optional; feed the scheduled
            date+time shown on the booking before the guest actually checks in. */}
        <div className="grid grid-cols-2 gap-3 mb-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1.5 mb-1.5">
              <Clock className="w-3.5 h-3.5" /> Expected arrival (optional)
            </label>
            <input
              type="time" value={form.preferredArrivalTime}
              onChange={(e) => update({ preferredArrivalTime: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1.5 mb-1.5">
              <Clock className="w-3.5 h-3.5" /> Expected departure (optional)
            </label>
            <input
              type="time" value={form.preferredDepartureTime}
              onChange={(e) => update({ preferredDepartureTime: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
        </div>

        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            placeholder="Sant reference — name (optional)"
            value={form.santReferenceName}
            onChange={(e) => update({ santReferenceName: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm"
          />
          <input
            placeholder="Sant reference — number (optional)"
            value={form.santReferenceMobile}
            onChange={(e) => update({ santReferenceMobile: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm"
          />
        </div>

        <div className="mb-3">
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">Room type</label>
          <select
            value={form.roomTypeId}
            onChange={(e) => update({ roomTypeId: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
          >
            {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
          </select>
        </div>

        {/* ID upload — choice of PC file or QR to phone */}
        <div className="mb-5">
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">Government ID</label>
          <div className="flex gap-2 mb-2">
            <button
              type="button"
              onClick={() => setIdMethod('pc')}
              className={`flex-1 flex items-center justify-center gap-1.5 border px-3 py-2 text-sm ${
                idMethod === 'pc' ? 'border-[#B8792F] bg-[#B8792F]/10 text-[#2B1610]' : 'border-[#2B1610]/15 text-[#2B1610]/60'
              }`}
            >
              <Upload className="w-3.5 h-3.5" /> PC file
            </button>
            <button
              type="button"
              onClick={() => setIdMethod('qr')}
              className={`flex-1 flex items-center justify-center gap-1.5 border px-3 py-2 text-sm ${
                idMethod === 'qr' ? 'border-[#B8792F] bg-[#B8792F]/10 text-[#2B1610]' : 'border-[#2B1610]/15 text-[#2B1610]/60'
              }`}
            >
              <QrCode className="w-3.5 h-3.5" /> QR to phone
            </button>
          </div>

          {idMethod === 'pc' ? (
            <label className="flex items-center gap-3 border border-dashed border-[#2B1610]/25 px-4 py-3 cursor-pointer hover:border-[#2B1610]/40">
              <Upload className="w-4 h-4 text-[#B8792F]" />
              <span className="text-sm text-[#2B1610]/60">
                {uploadingId ? 'Uploading…' : idDocumentUrl ? 'ID uploaded ✓' : 'Choose a file from this PC'}
              </span>
              <input type="file" accept="image/*" className="hidden" onChange={handlePcFileChange} />
            </label>
          ) : (
            <QRUploadTrigger apiBaseUrl={apiBaseUrl} onUploaded={(url) => setIdDocumentUrl(url)} />
          )}
        </div>

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 border border-[#2B1610]/20 text-[#2B1610] py-2.5 text-sm hover:bg-[#2B1610]/5">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className="flex-1 bg-[#2B1610] text-[#F8F4EC] py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-60"
          >
            {submitting ? 'Creating…' : 'Create booking'}
          </button>
        </div>
      </div>
    </div>
  );
}

function DecisionModal({ booking, roomTypes, apiBaseUrl, token, onCancel, onDecide, onCheckedIn }) {
  const [billingTier, setBillingTier] = useState('paid');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [approvalNote, setApprovalNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [collectNow, setCollectNow] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [checkinNow, setCheckinNow] = useState(false);
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [error, setError] = useState('');
  const needed = booking.num_rooms ?? 1;

  useEffect(() => {
    if (!checkinNow) { setAvailableRooms([]); setSelectedRoomIds([]); return; }
    setLoadingRooms(true);
    fetchArray(`${apiBaseUrl}/rooms/available?roomTypeId=${booking.room_type_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((rooms) => {
      setAvailableRooms(rooms);
      setSelectedRoomIds(needed === 1 && rooms[0] ? [rooms[0].id] : []);
      setLoadingRooms(false);
    });
  }, [checkinNow, apiBaseUrl, token, booking.room_type_id, needed]);

  const toggleRoom = (id) => {
    setSelectedRoomIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (needed === 1) return [id];
      if (prev.length >= needed) return prev;
      return [...prev, id];
    });
  };

  const decide = async (action) => {
    setError('');
    if (action === 'approve' && checkinNow && selectedRoomIds.length !== needed) {
      setError(`Select ${needed} room${needed > 1 ? 's' : ''} for immediate check-in.`);
      return;
    }
    setSubmitting(true);
    try {
      await onDecide(booking.id, {
        action,
        roomTypeId: booking.room_type_id,
        checkinDate: booking.checkin_date,
        checkoutDate: booking.checkout_date,
        billingTier,
        discountPercent,
        approvalNote,
      });
      if (action === 'approve' && collectNow && Number(payAmount) > 0) {
        await fetch(`${apiBaseUrl}/bookings/${booking.id}/pay`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ amount: Number(payAmount), method: payMethod, note: 'Collected at walk-in approval' }),
        });
      }
      if (action === 'approve' && checkinNow && selectedRoomIds.length === needed) {
        const res = await fetch(`${apiBaseUrl}/bookings/${booking.id}/checkin`, {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ roomIds: selectedRoomIds }),
        });
        if (!res.ok) {
          const body = await res.json().catch(() => ({}));
          throw new Error(body.message || body.error || 'Check-in failed after approval.');
        }
        onCheckedIn();
        return;
      }
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-sm w-full p-6">
        <h3 className="font-serif text-lg text-[#2B1610] mb-1">{booking.guest_name}</h3>
        <p className="text-xs text-[#2B1610]/50 mb-4">Record Swami Ji's phone/WhatsApp decision</p>

        {error && (
          <div className="flex items-start gap-2 bg-[#8C3B3B]/10 border border-[#8C3B3B]/30 text-[#8C3B3B] text-sm px-3 py-2 mb-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="flex flex-wrap gap-2 mb-3">
          {['foc', 'discount', 'paid'].map((tier) => (
            <label
              key={tier}
              className={`flex items-center gap-2 border px-3 py-2 text-sm cursor-pointer ${
                billingTier === tier ? 'border-[#B8792F] bg-[#B8792F]/10 text-[#2B1610]' : 'border-[#2B1610]/15 text-[#2B1610]/60'
              }`}
            >
              <input type="radio" className="hidden" checked={billingTier === tier} onChange={() => setBillingTier(tier)} />
              {tier === 'foc' ? 'Free of charge' : tier === 'discount' ? 'Discount' : 'Full price'}
            </label>
          ))}
        </div>
        {billingTier === 'discount' && (
          <input
            type="number" min={0} max={100} placeholder="% off"
            value={discountPercent}
            onChange={(e) => setDiscountPercent(Number(e.target.value))}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full mb-3"
          />
        )}

        {billingTier !== 'foc' && (
          <div className="mb-3">
            <label className="flex items-center gap-2.5 cursor-pointer select-none">
              <span className={`w-9 h-5 rounded-full relative transition-colors ${collectNow ? 'bg-[#4A6D5C]' : 'bg-[#2B1610]/20'}`}>
                <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${collectNow ? 'translate-x-4' : ''}`} />
              </span>
              <input type="checkbox" className="hidden" checked={collectNow} onChange={(e) => setCollectNow(e.target.checked)} />
              <span className="text-sm text-[#2B1610]">Collect payment now</span>
            </label>
            {collectNow && (
              <div className="mt-2 space-y-2 pl-0.5">
                <input
                  type="number" min={1} step="0.01"
                  placeholder="Amount to collect"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                  className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
                />
                <div className="flex gap-2">
                  {['cash', 'upi', 'card'].map((m) => (
                    <label
                      key={m}
                      className={`flex-1 text-center border px-2 py-1.5 text-xs cursor-pointer ${
                        payMethod === m ? 'border-[#B8792F] bg-[#B8792F]/10 text-[#2B1610]' : 'border-[#2B1610]/15 text-[#2B1610]/60'
                      }`}
                    >
                      <input type="radio" className="hidden" checked={payMethod === m} onChange={() => setPayMethod(m)} />
                      {m.toUpperCase()}
                    </label>
                  ))}
                </div>
              </div>
            )}
          </div>
        )}

        <textarea
          placeholder='e.g. "Confirmed by Swami Ji via WhatsApp, 3:40pm"'
          value={approvalNote}
          onChange={(e) => setApprovalNote(e.target.value)}
          className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full mb-4 h-20 resize-none"
        />

        <label className="flex items-center gap-2.5 mb-4 cursor-pointer select-none">
          <span className={`w-9 h-5 rounded-full relative transition-colors ${
            checkinNow ? 'bg-[#4A6D5C]' : 'bg-[#2B1610]/20'
          }`}>
            <span className={`absolute top-0.5 left-0.5 w-4 h-4 bg-white rounded-full transition-transform ${
              checkinNow ? 'translate-x-4' : ''
            }`} />
          </span>
          <input type="checkbox" className="hidden" checked={checkinNow} onChange={(e) => setCheckinNow(e.target.checked)} />
          <span className="text-sm text-[#2B1610]">
            <CheckInIcon className="w-3.5 h-3.5 inline mr-1" />
            Check in now
          </span>
        </label>

        {checkinNow && (
          <div className="mb-4">
            {needed > 1 && (
              <p className={`text-xs mb-2 ${selectedRoomIds.length === needed ? 'text-[#4A6D5C]' : 'text-[#B8792F]'}`}>
                Select {needed} rooms — {selectedRoomIds.length} chosen
              </p>
            )}
            {loadingRooms ? (
              <p className="text-sm text-[#2B1610]/40">Loading rooms…</p>
            ) : availableRooms.length === 0 ? (
              <p className="text-sm text-[#8C3B3B]">No rooms of this type are ready right now.</p>
            ) : availableRooms.length < needed ? (
              <p className="text-sm text-[#8C3B3B]">
                Only {availableRooms.length} room(s) ready, but this booking needs {needed}.
              </p>
            ) : (
              <div className="max-h-48 overflow-y-auto border border-[#2B1610]/15 divide-y divide-[#2B1610]/10">
                {availableRooms.map((r) => {
                  const checked = selectedRoomIds.includes(r.id);
                  const capped = !checked && needed > 1 && selectedRoomIds.length >= needed;
                  return (
                    <label
                      key={r.id}
                      className={`flex items-center gap-2.5 px-3 py-2 text-sm cursor-pointer ${
                        checked ? 'bg-[#B8792F]/10' : capped ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#2B1610]/5'
                      }`}
                    >
                      <input
                        type={needed === 1 ? 'radio' : 'checkbox'}
                        name="walkin-room"
                        checked={checked}
                        disabled={capped}
                        onChange={() => toggleRoom(r.id)}
                        className="accent-[#B8792F]"
                      />
                      <span className="text-[#2B1610]">{r.room_number}</span>
                      <span className="text-[#2B1610]/40 text-xs">{r.floor_name}</span>
                      <span className={`ml-auto text-[10px] uppercase tracking-wide px-1.5 py-0.5 ${
                        r.has_bathroom ? 'bg-[#4A6D5C]/15 text-[#4A6D5C]' : 'bg-[#C77A34]/15 text-[#C77A34]'
                      }`}>
                        {r.has_bathroom ? 'Attached bath' : 'No bath'}
                      </span>
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={() => decide('reject')}
            disabled={submitting}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#8C3B3B] text-white py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
          >
            <X className="w-4 h-4" /> Reject
          </button>
          <button
            onClick={() => decide('approve')}
            disabled={submitting || (checkinNow && selectedRoomIds.length !== needed)}
            className="flex-1 flex items-center justify-center gap-1.5 bg-[#4A6D5C] text-white py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
          >
            <Check className="w-4 h-4" /> {checkinNow ? 'Approve & check in' : 'Approve'}
          </button>
        </div>
        <button onClick={onCancel} className="w-full text-sm text-[#2B1610]/40 hover:text-[#2B1610]/70 mt-3">
          Cancel
        </button>
      </div>
    </div>
  );
}
