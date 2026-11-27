import React, { useState, useEffect, useCallback } from 'react';
import { Plus, Phone, Check, X, Users, Calendar, Clock, Upload, QrCode, AlertCircle, Eye, LogIn as CheckInIcon, MessageCircle, Printer, CheckCircle2, Copy } from 'lucide-react';
import QRUploadTrigger from './QRUploadTrigger';
import GuestDetailModal from './GuestDetailModal';
import SantReferenceInput from './SantReferenceInput';
import { fetchArray, fetchObject } from '../lib/api';
import { openWhatsAppReceipt, printReceipt } from '../lib/receipt';
import { parseWhatsAppBooking } from '../lib/whatsappBookingParser';

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
const DEFAULT_BOOKING_WA_TEMPLATE = `:*BAPS JAIPUR UTARA BOOKING* 🇦🇹

1.Full Name :- 
2.Mobile No :- 
3.City :- 
4.Arrival Date :- 
5.Arrival Time :- 
6.Departure Date :- 
7.Departure Time :- 
8.Total Person :- 
      Gents :- 
      Ladies :- 
      Children :- 
9.Room Require :- 
      Dormitory :- 
      Non AC Room :- 
      AC Room :- 
10.Sant Ref :- 
11.AC Room - Rs 2100 /- Per day
Non AC Room - Rs 1600 /- Per day`;

export default function WalkInBookingPanel({ apiBaseUrl, token, roomTypes, socket, onBookingCreated }) {
  const [waTemplate, setWaTemplate] = useState(DEFAULT_BOOKING_WA_TEMPLATE);
  const [copiedTpl, setCopiedTpl] = useState(false);

  useEffect(() => {
    fetchObject(`${apiBaseUrl}/settings`, {}, {}).then((s) => {
      if (s?.whatsapp_booking_template) setWaTemplate(s.whatsapp_booking_template);
    });
  }, [apiBaseUrl]);

  const copyWaTemplate = async () => {
    try {
      await navigator.clipboard.writeText(waTemplate);
      setCopiedTpl(true);
      setTimeout(() => setCopiedTpl(false), 2500);
    } catch { /* clipboard fallback ignored */ }
  };
  const [pending, setPending] = useState([]);
  const [showNewForm, setShowNewForm] = useState(false);
  const [recentBooking, setRecentBooking] = useState(null);
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
      const msg = body.error === 'CHECKOUT_BEFORE_CHECKIN'
        ? 'Check-out must be after check-in.'
        : (body.message || 'Could not create the booking. Please check every field and try again.');
      throw new Error(msg);
    }
    const created = await res.json();
    setShowNewForm(false);
    setRecentBooking(created);
    loadPending();
    onBookingCreated?.(created);
    return created;
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
      <div className="flex items-center justify-between gap-2 mb-5 flex-wrap">
        <h3 className="font-serif text-lg text-[#2B1610]">Bookings</h3>
        <div className="flex items-center gap-2 flex-wrap">
          <button
            onClick={copyWaTemplate}
            className="flex items-center gap-1.5 border border-[#4A6D5C]/40 bg-[#4A6D5C]/5 text-[#4A6D5C] px-3 py-2 text-sm hover:bg-[#4A6D5C]/10"
          >
            {copiedTpl ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            {copiedTpl ? 'Template Copied!' : 'Copy WhatsApp Template'}
          </button>
          <button
            onClick={() => setShowNewForm(true)}
            className="flex items-center gap-1.5 bg-[#2B1610] text-[#F8F4EC] px-4 py-2 text-sm hover:bg-[#3d2118]"
          >
            <Plus className="w-4 h-4" /> New booking
          </button>
        </div>
      </div>

      {recentBooking && (
        <div className="border border-[#4A6D5C]/30 bg-[#4A6D5C]/5 p-4 mb-5 flex flex-col sm:flex-row sm:items-center justify-between gap-3">
          <div className="flex items-start gap-2.5">
            <CheckCircle2 className="w-5 h-5 text-[#4A6D5C] mt-0.5 shrink-0" />
            <div>
              <p className="text-sm font-medium text-[#2B1610]">
                {recentBooking.guest_name} — {recentBooking.status === 'checked_in' ? 'Checked in!' : `Booking ${recentBooking.status}`}
              </p>
              <p className="text-xs text-[#2B1610]/60">
                Booking ID: <span className="font-mono font-semibold">{recentBooking.booking_code}</span> · {recentBooking.mobile}
              </p>
            </div>
          </div>
          <div className="flex items-center gap-2 flex-wrap">
            <button
              onClick={() => openWhatsAppReceipt(recentBooking)}
              className="flex items-center gap-1.5 bg-[#4A6D5C] text-white px-3 py-1.5 text-xs hover:opacity-90"
            >
              <MessageCircle className="w-3.5 h-3.5" /> Send WhatsApp
            </button>
            <button
              onClick={() => printReceipt(recentBooking, { apiBaseUrl, token })}
              className="flex items-center gap-1.5 border border-[#2B1610]/20 bg-white text-[#2B1610] px-3 py-1.5 text-xs hover:bg-[#2B1610]/5"
            >
              <Printer className="w-3.5 h-3.5" /> Print Receipt
            </button>
            <button
              onClick={() => setRecentBooking(null)}
              className="text-xs text-[#2B1610]/40 hover:text-[#2B1610] px-2"
            >
              Dismiss
            </button>
          </div>
        </div>
      )}

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
          token={token}
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

export function NewWalkInModal({ roomTypes, apiBaseUrl, token, initialRoom = null, onCancel, onCreate }) {
  const today = new Date().toISOString().slice(0, 10);
  const tomorrow = new Date(Date.now() + 86400000).toISOString().slice(0, 10);
  const initialRoomTypeId =
    initialRoom?.roomTypeId ||
    (initialRoom?.roomType ? roomTypes.find((rt) => rt.name === initialRoom.roomType)?.id : '') ||
    roomTypes[0]?.id ||
    '';

  const [form, setForm] = useState({
    guestName: '', mobile: '', guestCity: '',
    paxMen: 1, paxWomen: 0, paxChildren: 0, numRooms: 1,
    checkinDate: today,
    checkoutDate: tomorrow,
    santReferenceName: '', santReferenceMobile: '',
    preferredArrivalTime: '', preferredDepartureTime: '',
    roomTypeId: initialRoomTypeId,
  });
  const [checkinNow, setCheckinNow] = useState(true);
  const [autoApprove, setAutoApprove] = useState(true);
  const [billingTier, setBillingTier] = useState('paid');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [approvalNote, setApprovalNote] = useState('');
  const [collectNow, setCollectNow] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payAmountEdited, setPayAmountEdited] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [taxCfg, setTaxCfg] = useState({ enabled: true, gstPercent: 5 });
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState(initialRoom?.id ? [initialRoom.id] : []);
  const [loadingRooms, setLoadingRooms] = useState(false);
  const [addons, setAddons] = useState([]);
  const [selectedAddons, setSelectedAddons] = useState({}); // addonId -> qty

  const [idMethod, setIdMethod] = useState('pc'); // 'pc' | 'qr'
  const [showWaPaste, setShowWaPaste] = useState(false);
  const [waRawText, setWaRawText] = useState('');
  const [waParseNote, setWaParseNote] = useState('');

  const handleParseWa = () => {
    const parsed = parseWhatsAppBooking(waRawText);
    if (!parsed) {
      setWaParseNote('Could not detect booking fields. Please check the pasted text.');
      return;
    }
    const hint = (parsed.roomRequire || '').toLowerCase();
    const matchedRt =
      roomTypes.find((rt) => hint && rt.name.toLowerCase().includes(hint.replace(/\s*room\s*/g, '').trim())) ||
      roomTypes.find((rt) => hint && hint.includes(rt.name.toLowerCase()));

    update({
      ...(parsed.guestName ? { guestName: parsed.guestName } : {}),
      ...(parsed.mobile ? { mobile: parsed.mobile } : {}),
      ...(parsed.guestCity ? { guestCity: parsed.guestCity } : {}),
      ...(parsed.checkinDate ? { checkinDate: parsed.checkinDate } : {}),
      ...(parsed.checkoutDate ? { checkoutDate: parsed.checkoutDate } : {}),
      ...(parsed.preferredArrivalTime ? { preferredArrivalTime: parsed.preferredArrivalTime } : {}),
      ...(parsed.preferredDepartureTime ? { preferredDepartureTime: parsed.preferredDepartureTime } : {}),
      paxMen: parsed.paxMen,
      paxWomen: parsed.paxWomen,
      paxChildren: parsed.paxChildren,
      ...(parsed.santReferenceName ? { santReferenceName: parsed.santReferenceName } : {}),
      ...(matchedRt ? { roomTypeId: matchedRt.id } : {}),
    });
    setWaParseNote('Auto-filled from WhatsApp message!');
    setShowWaPaste(false);
    setWaRawText('');
  };
  const [idDocumentUrl, setIdDocumentUrl] = useState(null);
  const [uploadingId, setUploadingId] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [fieldRules, setFieldRules] = useState({
    guestCity: 'optional',
    santReferenceName: 'required',
    santReferenceMobile: 'optional',
    preferredArrivalTime: 'optional',
    preferredDepartureTime: 'optional',
    idDocument: 'optional',
  });

  useEffect(() => {
    let active = true;
    fetchObject(`${apiBaseUrl}/settings`, {}, {}).then((s) => {
      if (!active) return;
      const walkinCfg = s?.booking_form_config?.walkin;
      if (walkinCfg && typeof walkinCfg === 'object') {
        setFieldRules((prev) => ({ ...prev, ...walkinCfg }));
      }
      setTaxCfg({
        enabled: s?.tax_enabled !== false,
        gstPercent: Number(s?.gst_percent ?? 5) || 0,
      });
    });
    fetchArray(`${apiBaseUrl}/inventory/addons`).then((list) => {
      if (active) setAddons(list);
    });
    return () => { active = false; };
  }, [apiBaseUrl]);

  const update = (patch) => {
    setForm((prev) => {
      const next = { ...prev, ...patch };
      if (patch.checkinDate) {
        if (!prev.checkoutDate || prev.checkoutDate <= patch.checkinDate) {
          const [y, m, d] = patch.checkinDate.split('-').map(Number);
          next.checkoutDate = new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
        }
      }
      // If user switches check-in date to a future day, default off immediate check-in
      if (patch.checkinDate !== undefined && patch.checkinDate > today) {
        setCheckinNow(false);
      }
      return next;
    });
  };

  useEffect(() => {
    if (!checkinNow || !form.roomTypeId || !token) {
      setAvailableRooms([]);
      return;
    }
    let active = true;
    setLoadingRooms(true);
    fetchArray(`${apiBaseUrl}/rooms/available?roomTypeId=${form.roomTypeId}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((rooms) => {
      if (!active) return;
      setAvailableRooms(rooms);
      setSelectedRoomIds((prev) => {
        const validPrev = prev.filter((id) => rooms.some((r) => r.id === id));
        if (validPrev.length > 0) return validPrev.slice(0, form.numRooms);
        if (initialRoom?.id && rooms.some((r) => r.id === initialRoom.id)) return [initialRoom.id];
        if (form.numRooms === 1 && rooms[0]) return [rooms[0].id];
        return [];
      });
      setLoadingRooms(false);
    });
    return () => { active = false; };
  }, [checkinNow, form.roomTypeId, form.numRooms, apiBaseUrl, token, initialRoom]);

  const selectedRt = (roomTypes || []).find((rt) => rt.id === booking.room_type_id);
  const nights = booking.checkin_date && booking.checkout_date
    ? Math.max(1, Math.round((new Date(booking.checkout_date) - new Date(booking.checkin_date)) / 86400000))
    : 1;
  const baseRoomTotal = (Number(selectedRt?.base_price) || 0) * needed * nights;
  const afterDiscount = billingTier === 'foc'
    ? 0
    : billingTier === 'discount'
    ? baseRoomTotal * (1 - Math.min(100, Math.max(0, Number(discountPercent) || 0)) / 100)
    : baseRoomTotal;
  const withGst = taxCfg.enabled ? afterDiscount * (1 + taxCfg.gstPercent / 100) : afterDiscount;
  const estimatedTotal = Math.round(withGst);

  useEffect(() => {
    if (!payAmountEdited) {
      setPayAmount(estimatedTotal > 0 ? String(estimatedTotal) : '');
    }
  }, [estimatedTotal, payAmountEdited]);

  const SUGGESTED_NOTES = [
    'Approved by Swami Ji on phone',
    'Approved by Swami Ji on WhatsApp',
    'Walk-in approved at desk',
    'Sant reference',
  ];

  const toggleRoom = (id) => {
    setSelectedRoomIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (form.numRooms === 1) return [id];
      if (prev.length >= form.numRooms) return prev;
      return [...prev, id];
    });
  };

  const validate = () => {
    if (!form.guestName.trim()) return 'Guest name is required.';
    if (!form.mobile.trim()) return 'Mobile number is required.';
    if (fieldRules.guestCity === 'required' && !form.guestCity.trim()) return 'City / Address is required.';
    if (!form.checkinDate) return 'Check-in date is required.';
    if (!form.checkoutDate) return 'Check-out date is required.';
    if (new Date(form.checkoutDate) <= new Date(form.checkinDate)) return 'Check-out must be after check-in.';
    if (fieldRules.preferredArrivalTime === 'required' && !form.preferredArrivalTime) return 'Expected arrival time is required.';
    if (fieldRules.preferredDepartureTime === 'required' && !form.preferredDepartureTime) return 'Expected departure time is required.';
    if (fieldRules.santReferenceName === 'required' && !form.santReferenceName.trim()) return 'Sant reference name is required.';
    if (fieldRules.santReferenceMobile === 'required' && !form.santReferenceMobile.trim()) return 'Sant reference number is required.';
    if (fieldRules.idDocument === 'required' && !idDocumentUrl) return 'Government ID upload is required.';
    if (!form.roomTypeId) return 'Please select a room type.';
    if (checkinNow && selectedRoomIds.length !== form.numRooms) {
      return `Please select ${form.numRooms} ready room${form.numRooms > 1 ? 's' : ''} for immediate check-in.`;
    }
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
      const extraCharges = addons
        .filter((a) => (selectedAddons[a.id] || 0) > 0)
        .map((a) => {
          const qty = selectedAddons[a.id];
          return {
            label: qty > 1 ? `${a.name} × ${qty}` : a.name,
            amount: Number(a.price) * qty,
          };
        });
      await onCreate({
        ...form,
        idDocumentUrl,
        checkinNow,
        autoApprove: checkinNow ? true : autoApprove,
        roomIds: checkinNow ? selectedRoomIds : [],
        billingTier,
        discountPercent,
        approvalNote,
        extraCharges,
        payment: checkinNow && collectNow && Number(payAmount) > 0
          ? { amount: Number(payAmount), method: payMethod }
          : null,
      });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-lg w-full p-6 max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between mb-4">
          <h3 className="font-serif text-lg text-[#2B1610]">
            {initialRoom ? `Check in to Room ${initialRoom.roomNumber}` : 'New booking'}
          </h3>
          <button type="button" onClick={onCancel} className="text-[#2B1610]/40 hover:text-[#2B1610]">
            <X className="w-5 h-5" />
          </button>
        </div>

        <div className="mb-3">
          <button
            type="button"
            onClick={() => setShowWaPaste((p) => !p)}
            className="text-xs text-[#4A6D5C] hover:underline flex items-center gap-1.5"
          >
            <MessageCircle className="w-3.5 h-3.5" />
            {showWaPaste ? 'Hide WhatsApp paste box' : 'Paste WhatsApp Booking Message (Auto-Fill)'}
          </button>
          {waParseNote && !showWaPaste && (
            <p className="text-xs text-[#4A6D5C] mt-1">{waParseNote}</p>
          )}
          {showWaPaste && (
            <div className="mt-2 border border-[#4A6D5C]/30 bg-[#4A6D5C]/5 p-3 space-y-2">
              <textarea
                rows={5}
                value={waRawText}
                onChange={(e) => setWaRawText(e.target.value)}
                placeholder="Paste the forwarded WhatsApp booking template here…"
                className="w-full border border-[#2B1610]/20 bg-white p-2 text-xs"
              />
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  onClick={handleParseWa}
                  className="bg-[#4A6D5C] text-white px-3 py-1.5 text-xs hover:opacity-90"
                >
                  Auto-Fill Form
                </button>
                {waParseNote && <span className="text-xs text-[#8C3B3B]">{waParseNote}</span>}
              </div>
            </div>
          )}
        </div>

        {error && (
          <div className="flex items-start gap-2 bg-[#8C3B3B]/10 border border-[#8C3B3B]/30 text-[#8C3B3B] text-sm px-3 py-2 mb-3">
            <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />
            {error}
          </div>
        )}

        <div className="grid grid-cols-2 gap-3 mb-3">
          <input
            placeholder="Guest name *"
            value={form.guestName}
            onChange={(e) => update({ guestName: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm col-span-2"
          />
          <input
            placeholder="Mobile *"
            value={form.mobile}
            onChange={(e) => update({ mobile: e.target.value })}
            className={`border border-[#2B1610]/20 bg-white px-3 py-2 text-sm ${fieldRules.guestCity === 'hidden' ? 'col-span-2' : ''}`}
          />
          {fieldRules.guestCity !== 'hidden' && (
            <input
              placeholder={`City / Address ${fieldRules.guestCity === 'required' ? '*' : '(optional)'}`}
              value={form.guestCity}
              onChange={(e) => update({ guestCity: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm"
            />
          )}
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

        <div className="grid grid-cols-3 gap-3 mb-3">
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">Rooms</label>
            <input
              type="number" min={1} value={form.numRooms}
              onChange={(e) => update({ numRooms: Math.max(1, Number(e.target.value)) })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1 mb-1.5">
              <Calendar className="w-3.5 h-3.5" /> Check-in
            </label>
            <input
              type="date" value={form.checkinDate}
              onChange={(e) => update({ checkinDate: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
          </div>
          <div>
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1 mb-1.5">
              <Calendar className="w-3.5 h-3.5" /> Check-out
            </label>
            <input
              type="date"
              min={form.checkinDate ? (() => {
                const [y, m, d] = form.checkinDate.split('-').map(Number);
                return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
              })() : today}
              value={form.checkoutDate}
              onChange={(e) => update({ checkoutDate: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
            />
            {form.checkinDate && (
              <p className="mt-1 text-[11px] text-[#2B1610]/55">
                Check-in: {form.checkinDate.split('-').reverse().join('-')} · {nights} night{nights === 1 ? '' : 's'}
              </p>
            )}
          </div>
        </div>

        {/* Expected arrival / departure times — admin-controlled */}
        {(fieldRules.preferredArrivalTime !== 'hidden' || fieldRules.preferredDepartureTime !== 'hidden') && (
          <div className={`grid ${fieldRules.preferredArrivalTime !== 'hidden' && fieldRules.preferredDepartureTime !== 'hidden' ? 'grid-cols-2' : 'grid-cols-1'} gap-3 mb-3`}>
            {fieldRules.preferredArrivalTime !== 'hidden' && (
              <div>
                <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1.5 mb-1.5">
                  <Clock className="w-3.5 h-3.5" /> Expected arrival {fieldRules.preferredArrivalTime === 'required' ? '*' : '(optional)'}
                </label>
                <input
                  type="time" value={form.preferredArrivalTime}
                  onChange={(e) => update({ preferredArrivalTime: e.target.value })}
                  className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
                />
              </div>
            )}
            {fieldRules.preferredDepartureTime !== 'hidden' && (
              <div>
                <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 flex items-center gap-1.5 mb-1.5">
                  <Clock className="w-3.5 h-3.5" /> Expected departure {fieldRules.preferredDepartureTime === 'required' ? '*' : '(optional)'}
                </label>
                <input
                  type="time" value={form.preferredDepartureTime}
                  onChange={(e) => update({ preferredDepartureTime: e.target.value })}
                  className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
                />
              </div>
            )}
          </div>
        )}

        <div className="mb-3">
          <SantReferenceInput
            nameValue={form.santReferenceName}
            mobileValue={form.santReferenceMobile}
            onChange={update}
            apiBaseUrl={apiBaseUrl}
            token={token}
            nameRule={fieldRules.santReferenceName}
            mobileRule={fieldRules.santReferenceMobile}
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

        {/* 1-Step Check-in & Billing */}
        <div className="border border-[#4A6D5C]/30 bg-[#4A6D5C]/5 p-3.5 mb-4 space-y-3">
          <label className="flex items-center gap-2 text-sm font-medium text-[#2B1610] cursor-pointer">
            <input
              type="checkbox"
              checked={checkinNow}
              onChange={(e) => setCheckinNow(e.target.checked)}
              className="accent-[#4A6D5C]"
            />
            <CheckInIcon className="w-4 h-4 text-[#4A6D5C]" />
            Check in immediately & assign room
          </label>

          {!checkinNow && (
            <label className="flex items-center gap-2 text-xs text-[#2B1610]/70 cursor-pointer pl-6">
              <input
                type="checkbox"
                checked={autoApprove}
                onChange={(e) => setAutoApprove(e.target.checked)}
                className="accent-[#B8792F]"
              />
              Already approved by Swami Ji (skip pending queue)
            </label>
          )}

          {checkinNow && (
            <div>
              <p className="text-xs text-[#2B1610]/60 mb-1.5">
                Select {form.numRooms} ready room{form.numRooms > 1 ? 's' : ''} ({selectedRoomIds.length}/{form.numRooms} selected):
              </p>
              {loadingRooms ? (
                <p className="text-xs text-[#2B1610]/40">Loading ready rooms…</p>
              ) : availableRooms.length === 0 ? (
                <p className="text-xs text-[#8C3B3B]">No ready rooms of this type right now.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5 max-h-28 overflow-y-auto">
                  {availableRooms.map((r) => {
                    const checked = selectedRoomIds.includes(r.id);
                    const capped = !checked && form.numRooms > 1 && selectedRoomIds.length >= form.numRooms;
                    return (
                      <button
                        type="button"
                        key={r.id}
                        disabled={capped}
                        onClick={() => toggleRoom(r.id)}
                        className={`px-2.5 py-1.5 text-xs border transition-colors ${
                          checked
                            ? 'bg-[#4A6D5C] text-white border-[#4A6D5C]'
                            : capped
                            ? 'opacity-40 border-[#2B1610]/15 bg-white cursor-not-allowed'
                            : 'bg-white border-[#2B1610]/20 text-[#2B1610] hover:border-[#4A6D5C]'
                        }`}
                      >
                        {r.room_number}
                        {r.is_shared && (
                          <span className="ml-1 opacity-75">
                            ({r.available_beds}/{r.bed_count} free)
                          </span>
                        )}
                      </button>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {(checkinNow || autoApprove) && (
            <div className="pt-2 border-t border-[#2B1610]/10 space-y-2">
              <div className="flex flex-wrap gap-1.5">
                {[
                  { id: 'paid', label: 'Full price' },
                  { id: 'foc', label: 'FOC (Free)' },
                  { id: 'discount', label: 'Discount' },
                ].map((opt) => (
                  <button
                    type="button"
                    key={opt.id}
                    onClick={() => setBillingTier(opt.id)}
                    className={`px-2.5 py-1 text-xs border ${
                      billingTier === opt.id
                        ? 'border-[#B8792F] bg-[#B8792F]/15 text-[#2B1610] font-medium'
                        : 'border-[#2B1610]/15 bg-white text-[#2B1610]/60'
                    }`}
                  >
                    {opt.label}
                  </button>
                ))}
              </div>
              {billingTier === 'discount' && (
                <div className="flex flex-wrap items-center gap-2">
                  <div className="flex items-center border border-[#2B1610]/20 bg-white">
                    <input
                      type="number" min={0} max={100} placeholder="0"
                      value={discountPercent}
                      onChange={(e) => setDiscountPercent(Math.min(100, Math.max(0, Number(e.target.value))))}
                      className="px-2.5 py-1.5 text-xs w-20 focus:outline-none"
                    />
                    <span className="px-2 py-1.5 text-xs bg-[#2B1610]/5 text-[#2B1610]/70 border-l border-[#2B1610]/15">% off</span>
                  </div>
                  <span className="text-xs text-[#2B1610]/60">
                    ₹{Math.round(baseRoomTotal).toLocaleString('en-IN')} − {discountPercent || 0}% = <strong>₹{Math.round(afterDiscount).toLocaleString('en-IN')}</strong>
                  </span>
                </div>
              )}

              {/* Live calculated total */}
              <div className="flex items-center justify-between bg-white/80 border border-[#2B1610]/10 px-2.5 py-1.5 text-xs">
                <span className="text-[#2B1610]/60">
                  Estimated total ({nights} night{nights > 1 ? 's' : ''}
                  {taxCfg.enabled && billingTier !== 'foc' ? ` + ${taxCfg.gstPercent}% GST` : ''}
                  {addonsTotal > 0 ? ` + ₹${addonsTotal.toLocaleString('en-IN')} add-ons` : ''})
                </span>
                <span className="font-serif text-sm font-semibold text-[#2B1610]">
                  ₹{estimatedTotal.toLocaleString('en-IN')}
                </span>
              </div>

              {checkinNow && billingTier !== 'foc' && (
                <div className="pt-1">
                  <label className="flex items-center gap-2 text-xs text-[#2B1610]/70 cursor-pointer">
                    <input
                      type="checkbox"
                      checked={collectNow}
                      onChange={(e) => {
                        setCollectNow(e.target.checked);
                        if (e.target.checked && !payAmountEdited) {
                          setPayAmount(estimatedTotal > 0 ? String(estimatedTotal) : '');
                        }
                      }}
                      className="accent-[#4A6D5C]"
                    />
                    Collect payment now
                  </label>
                  {collectNow && (
                    <div className="flex gap-2 mt-2">
                      <input
                        type="number" min={1} placeholder="Amount ₹"
                        value={payAmount}
                        onChange={(e) => { setPayAmountEdited(true); setPayAmount(e.target.value); }}
                        className="border border-[#2B1610]/20 bg-white px-2.5 py-1.5 text-xs flex-1"
                      />
                      {payAmountEdited && estimatedTotal > 0 && Number(payAmount) !== estimatedTotal && (
                        <button
                          type="button"
                          onClick={() => { setPayAmountEdited(false); setPayAmount(String(estimatedTotal)); }}
                          className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-[11px] text-[#B8792F] hover:bg-[#B8792F]/10"
                        >
                          Reset ₹{estimatedTotal}
                        </button>
                      )}
                      <select
                        value={payMethod}
                        onChange={(e) => setPayMethod(e.target.value)}
                        className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-xs"
                      >
                        <option value="cash">CASH</option>
                        <option value="upi">UPI</option>
                        <option value="card">CARD</option>
                      </select>
                    </div>
                  )}
                </div>
              )}

              <div>
                <div className="flex flex-wrap gap-1 mb-1.5">
                  {SUGGESTED_NOTES.map((noteText) => (
                    <button
                      type="button"
                      key={noteText}
                      onClick={() => setApprovalNote(noteText)}
                      className={`text-[11px] px-2 py-0.5 border transition-colors ${
                        approvalNote === noteText
                          ? 'border-[#B8792F] bg-[#B8792F]/15 text-[#2B1610]'
                          : 'border-[#2B1610]/15 bg-white text-[#2B1610]/60 hover:border-[#2B1610]/30'
                      }`}
                    >
                      {noteText}
                    </button>
                  ))}
                </div>
                <input
                  placeholder="Approval note (pick above or type custom)"
                  value={approvalNote}
                  onChange={(e) => setApprovalNote(e.target.value)}
                  className="border border-[#2B1610]/20 bg-white px-2.5 py-1.5 text-xs w-full"
                />
              </div>

              {addons.length > 0 && (
                <div className="pt-2 border-t border-[#2B1610]/10">
                  <p className="text-[11px] uppercase tracking-wide text-[#2B1610]/50 mb-1.5">Add-ons (tick if needed)</p>
                  <div className="space-y-1.5">
                    {addons.map((a) => {
                      const qty = selectedAddons[a.id] || 0;
                      return (
                        <div key={a.id} className="flex items-center justify-between text-xs bg-white/70 border border-[#2B1610]/10 px-2.5 py-1.5">
                          <label className="flex items-center gap-2 cursor-pointer flex-1">
                            <input
                              type="checkbox"
                              checked={qty > 0}
                              onChange={(e) => setSelectedAddons((prev) => ({
                                ...prev,
                                [a.id]: e.target.checked ? 1 : 0,
                              }))}
                              className="accent-[#4A6D5C]"
                            />
                            <span className="text-[#2B1610]">{a.name}</span>
                            <span className="text-[#2B1610]/50">(₹{Number(a.price).toLocaleString('en-IN')})</span>
                          </label>
                          {qty > 0 && (
                            <div className="flex items-center gap-1">
                              <button
                                type="button"
                                onClick={() => setSelectedAddons((p) => ({ ...p, [a.id]: Math.max(0, qty - 1) }))}
                                className="w-5 h-5 border border-[#2B1610]/20 text-center leading-none"
                              >-</button>
                              <span className="w-5 text-center">{qty}</span>
                              <button
                                type="button"
                                onClick={() => setSelectedAddons((p) => ({ ...p, [a.id]: qty + 1 }))}
                                className="w-5 h-5 border border-[#2B1610]/20 text-center leading-none"
                              >+</button>
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* ID upload — choice of PC file or QR to phone */}
        {fieldRules.idDocument !== 'hidden' && (
          <div className="mb-5">
            <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">
              Government ID {fieldRules.idDocument === 'required' ? '*' : '(optional)'}
            </label>
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
        )}

        <div className="flex gap-2">
          <button onClick={onCancel} className="flex-1 border border-[#2B1610]/20 text-[#2B1610] py-2.5 text-sm hover:bg-[#2B1610]/5">
            Cancel
          </button>
          <button
            onClick={submit}
            disabled={submitting}
            className={`flex-1 text-[#F8F4EC] py-2.5 text-sm disabled:opacity-60 ${
              checkinNow ? 'bg-[#4A6D5C] hover:opacity-90' : 'bg-[#2B1610] hover:bg-[#3d2118]'
            }`}
          >
            {submitting
              ? (checkinNow ? 'Checking in…' : 'Creating…')
              : (checkinNow ? 'Create & Check In Now' : 'Create booking')}
          </button>
        </div>
      </div>
    </div>
  );
}

export function DecisionModal({ booking, roomTypes, apiBaseUrl, token, onCancel, onDecide, onCheckedIn }) {
  const [billingTier, setBillingTier] = useState('paid');
  const [discountPercent, setDiscountPercent] = useState(0);
  const [approvalNote, setApprovalNote] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [collectNow, setCollectNow] = useState(false);
  const [payAmount, setPayAmount] = useState('');
  const [payAmountEdited, setPayAmountEdited] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [taxCfg, setTaxCfg] = useState({ enabled: true, gstPercent: 5 });
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

  const selectedRt = (roomTypes || []).find((rt) => rt.id === booking.room_type_id);
  const nights = booking.checkin_date && booking.checkout_date
    ? Math.max(1, Math.round((new Date(booking.checkout_date) - new Date(booking.checkin_date)) / 86400000))
    : 1;
  const baseRoomTotal = (Number(selectedRt?.base_price) || 0) * needed * nights;
  const afterDiscount = billingTier === 'foc'
    ? 0
    : billingTier === 'discount'
    ? baseRoomTotal * (1 - Math.min(100, Math.max(0, Number(discountPercent) || 0)) / 100)
    : baseRoomTotal;
  const withGst = taxCfg.enabled ? afterDiscount * (1 + taxCfg.gstPercent / 100) : afterDiscount;
  const estimatedTotal = Math.round(withGst);

  useEffect(() => {
    if (!payAmountEdited) {
      setPayAmount(estimatedTotal > 0 ? String(estimatedTotal) : '');
    }
  }, [estimatedTotal, payAmountEdited]);

  const SUGGESTED_NOTES = [
    'Approved by Swami Ji on phone',
    'Approved by Swami Ji on WhatsApp',
    'Walk-in approved at desk',
    'Sant reference',
  ];

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
