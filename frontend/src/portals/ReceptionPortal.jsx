import React, { useState, useEffect, useCallback, useRef } from 'react';
import { LogOut, X, DoorOpen, ClipboardList, LogIn as CheckInIcon, IndianRupee, Users, History, Eye, Printer, MessageCircle, Bell, CalendarDays, Plus, Trash2, Clock, Briefcase, CheckCircle2, Soup, Pencil } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import FloorBoard from '../components/FloorBoard';
import DashboardStatsStrip from '../components/DashboardStatsStrip';
import WalkInBookingPanel from '../components/WalkInBookingPanel';
import CurrentGuestsList from '../components/CurrentGuestsList';
import BhojanPanel from '../components/BhojanPanel';
import OccupancyCalendar from '../components/OccupancyCalendar';
import GuestDetailModal from '../components/GuestDetailModal';
import EditBookingModal from '../components/EditBookingModal';
import QRUploadTrigger from '../components/QRUploadTrigger';
import HistoryReports from '../components/HistoryReports';
import CancelBookingModal from '../components/CancelBookingModal';
import { fetchArray, fetchObject } from '../lib/api';
import { printReceipt, openWhatsAppReceipt } from '../lib/receipt';
import { fmtDate } from '../lib/datetime';

/**
 * ReceptionPortal
 *
 * Five tabs: the live floor board (with real check-out + payment editing on
 * occupied rooms), Check-ins (assign an available room to an approved
 * booking — the room-allocation step that was previously missing entirely),
 * Walk-ins (create + record phone approvals), Current guests (a flat table
 * of everyone in-house right now), and History (the shared reports view).
 *
 * "View ID" buttons across these tabs open a single shared GuestDetailModal,
 * driven by the `viewingBookingId` state below.
 */
export default function ReceptionPortal() {
  const { user, logout, apiBaseUrl, token, socket } = useAuth();
  const [tab, setTab] = useState('board');
  const [floors, setFloors] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [awaitingCheckin, setAwaitingCheckin] = useState([]);
  const [pendingApproval, setPendingApproval] = useState([]);
  const [upcomingBookings, setUpcomingBookings] = useState([]);
  const [selectedRoom, setSelectedRoom] = useState(null);
  const [checkinBooking, setCheckinBooking] = useState(null);
  const [editingBooking, setEditingBooking] = useState(null);
  const [viewingBookingId, setViewingBookingId] = useState(null);
  const [cancelBooking, setCancelBooking] = useState(null); // booking pending cancellation (no-show / guest cancel)
  const [dashStats, setDashStats] = useState(null);
  const [luggage, setLuggage] = useState({ count: 0, tokens: [] });
  const [notifications, setNotifications] = useState([]);
  const [notifOpen, setNotifOpen] = useState(false);
  const [soundArmed, setSoundArmed] = useState(false);
  const [showSoundBanner, setShowSoundBanner] = useState(true);
  const [chargeRates, setChargeRates] = useState({ lateCheckoutRatePerHour: 0, extraBedRate: 0 });
  const [waTemplates, setWaTemplates] = useState({});
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [calendarBookings, setCalendarBookings] = useState([]);
  const [calendarOccupancy, setCalendarOccupancy] = useState({ roomTypes: [], days: [] });
  const audioRef = useRef(null);
  const notifSoundUrl = useRef(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadBoard = useCallback(async () => {
    setFloors(await fetchArray(`${apiBaseUrl}/rooms/board`));
  }, [apiBaseUrl]);

  const loadRoomTypes = useCallback(async () => {
    setRoomTypes(await fetchArray(`${apiBaseUrl}/inventory/room-types`));
  }, [apiBaseUrl]);

  const loadAwaitingCheckin = useCallback(async () => {
    setAwaitingCheckin(await fetchArray(`${apiBaseUrl}/bookings/approved-unassigned`, { headers: authHeaders }));
  }, [apiBaseUrl, token]);

  // Bookings still awaiting a decision (pending/modified, any channel) — shown on
  // the Check-ins tab for visibility only. Reception records a walk-in's phone/
  // WhatsApp decision from the Walk-ins tab; Swami Ji approves online requests.
  const loadPendingApproval = useCallback(async () => {
    setPendingApproval(await fetchArray(`${apiBaseUrl}/bookings/pending`, { headers: authHeaders }));
  }, [apiBaseUrl, token]);

  // Approved bookings arriving AFTER today. Today's unassigned approvals are the
  // "Awaiting check-in" list (/approved-unassigned is checkin_date <= today);
  // future ones only surface there on their arrival day, so list them separately.
  // /history filters on check-in date, so from = tomorrow gives strictly-future
  // arrivals; sort soonest-first (history returns newest-created first).
  const loadUpcoming = useCallback(async () => {
    const d = new Date();
    d.setDate(d.getDate() + 1);
    const from = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
    const rows = await fetchArray(`${apiBaseUrl}/bookings/history?status=approved&from=${from}`, { headers: authHeaders });
    rows.sort((a, b) => new Date(a.checkin_date) - new Date(b.checkin_date));
    setUpcomingBookings(rows);
  }, [apiBaseUrl, token]);

  const loadDashStats = useCallback(async () => {
    setDashStats(await fetchObject(`${apiBaseUrl}/reports/stats`, { headers: authHeaders }, null));
  }, [apiBaseUrl, token]);

  const loadLuggage = useCallback(async () => {
    const data = await fetchObject(`${apiBaseUrl}/rooms/luggage`, { headers: authHeaders }, null);
    setLuggage({
      count: data?.count ?? 0,
      tokens: Array.isArray(data?.tokens) ? data.tokens : [],
    });
  }, [apiBaseUrl, token]);

  // Issue a luggage-security token; returns { ok, token } or { ok:false, error }.
  const issueToken = async (payload) => {
    try {
      const res = await fetch(`${apiBaseUrl}/rooms/luggage/tokens`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify(payload),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) return { ok: false, error: body.message || body.error || 'Could not issue token.' };
      loadLuggage();
      return { ok: true, token: body };
    } catch {
      return { ok: false, error: 'Network error — could not reach the server.' };
    }
  };

  const collectToken = async (id) => {
    try {
      const res = await fetch(`${apiBaseUrl}/rooms/luggage/tokens/${id}/collect`, {
        method: 'PATCH',
        headers: authHeaders,
      });
      if (res.ok) loadLuggage();
    } catch { /* ignore — socket/refresh will reconcile */ }
  };

  useEffect(() => { loadBoard(); loadRoomTypes(); loadAwaitingCheckin(); loadPendingApproval(); loadUpcoming(); loadDashStats(); loadLuggage(); }, [loadBoard, loadRoomTypes, loadAwaitingCheckin, loadPendingApproval, loadUpcoming, loadDashStats, loadLuggage]);

  // Load active notification sound URL on mount
  useEffect(() => {
    fetchObject(`${apiBaseUrl}/settings`).then((s) => {
      setChargeRates({
        lateCheckoutRatePerHour: Number(s.late_checkout_rate_per_hour) || 0,
        extraBedRate: Number(s.extra_bed_rate) || 0,
      });
      setWaTemplates(s.whatsapp_templates ?? {});
      const soundId = s.notification_sound_id;
      if (!soundId) return;
      fetchArray(`${apiBaseUrl}/settings/notification-sounds`, { headers: { Authorization: `Bearer ${token}` } }).then((snds) => {
        const snd = snds.find((x) => x.id === soundId);
        if (snd) notifSoundUrl.current = `${apiBaseUrl.replace('/api', '')}/uploads/sounds/${snd.filename}`;
      });
    });
  }, [apiBaseUrl, token]);

  const playNotifSound = useCallback(() => {
    if (!soundArmed) return;
    if (notifSoundUrl.current) {
      const a = new Audio(notifSoundUrl.current);
      a.play().catch(() => {});
    } else {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        osc.connect(ctx.destination);
        osc.frequency.value = 880;
        osc.start();
        osc.stop(ctx.currentTime + 0.3);
      } catch { /* no sound */ }
    }
  }, [soundArmed]);

  const loadCalendar = useCallback(async ({ year, month }) => {
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const last = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    // History powers the per-guest arrivals/departures popover; the calendar
    // endpoint powers the per-day "X of N rooms taken" occupancy summary.
    const [data, occ] = await Promise.all([
      fetchArray(
        `${apiBaseUrl}/bookings/history?status=approved,checked_in&from=${from}&to=${to}`,
        { headers: authHeaders }
      ),
      fetchObject(
        `${apiBaseUrl}/bookings/calendar?from=${from}&to=${to}`,
        { headers: authHeaders },
        { roomTypes: [], days: [] }
      ),
    ]);
    setCalendarBookings(data);
    setCalendarOccupancy(occ && Array.isArray(occ.days) ? occ : { roomTypes: [], days: [] });
  }, [apiBaseUrl, token]);

  useEffect(() => {
    if (tab === 'calendar') loadCalendar(calendarMonth);
  }, [tab, calendarMonth, loadCalendar]);

  const armSound = () => {
    setSoundArmed(true);
    setShowSoundBanner(false);
  };

  useEffect(() => {
    if (!socket) return;
    const refresh = () => { loadBoard(); loadAwaitingCheckin(); loadPendingApproval(); loadUpcoming(); loadDashStats(); };
    socket.on('room:status_changed', refresh);
    socket.on('room:created', refresh);
    socket.on('room:deleted', refresh);
    socket.on('booking:updated', refresh);
    socket.on('booking:new', refresh);
    const onLuggage = () => loadLuggage();
    socket.on('luggage:updated', onLuggage);

    const onWarning = (data) => {
      setNotifications((prev) => {
        if (prev.some((n) => n.bookingId === data.bookingId && n.type === 'warning')) return prev;
        return [{ id: `${data.bookingId}-w`, type: 'warning', bookingId: data.bookingId, message: `${data.guestName} (Room ${data.room}) — checkout in ${data.minutesRemaining} min`, dismissed: false }, ...prev];
      });
      playNotifSound();
    };
    const onOverdue = (data) => {
      setNotifications((prev) => {
        const filtered = prev.filter((n) => !(n.bookingId === data.bookingId && n.type === 'warning'));
        if (filtered.some((n) => n.bookingId === data.bookingId && n.type === 'overdue')) return filtered;
        return [{ id: `${data.bookingId}-o`, type: 'overdue', bookingId: data.bookingId, message: `${data.guestName} (Room ${data.room}) — overdue by ${data.minutesPast} min`, dismissed: false }, ...filtered];
      });
      playNotifSound();
    };
    const onMorningSummary = (data) => {
      if (!data.checkouts?.length) return;
      setNotifications((prev) => {
        if (prev.some((n) => n.type === 'morning')) return prev;
        const names = data.checkouts.map((c) => `${c.guest_name} (Rm ${c.room_number})`).join(', ');
        return [{ id: 'morning', type: 'morning', message: `Checking out today: ${names}`, dismissed: false }, ...prev];
      });
    };

    socket.on('checkout:warning', onWarning);
    socket.on('checkout:overdue', onOverdue);
    socket.on('checkout:morning_summary', onMorningSummary);

    return () => {
      socket.off('room:status_changed', refresh);
      socket.off('room:created', refresh);
      socket.off('room:deleted', refresh);
      socket.off('booking:updated', refresh);
      socket.off('booking:new', refresh);
      socket.off('luggage:updated', onLuggage);
      socket.off('checkout:warning', onWarning);
      socket.off('checkout:overdue', onOverdue);
      socket.off('checkout:morning_summary', onMorningSummary);
    };
  }, [socket, loadBoard, loadAwaitingCheckin, loadPendingApproval, loadUpcoming, loadLuggage, playNotifSound]);

  const setRoomStatus = async (roomId, status) => {
    await fetch(`${apiBaseUrl}/rooms/${roomId}/status`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ status }),
    });
    setSelectedRoom(null);
    loadBoard();
  };

  // Check out an occupied room. The backend refuses with 409 UNPAID_BALANCE
  // unless `force` is set, so a guest with money still owing isn't checked out
  // by accident — the modal surfaces the balance and asks before retrying with
  // force. Returns a result object the modal drives its confirm/error UI from.
  const checkoutRoom = async (bookingId, force = false) => {
    try {
      const res = await fetch(`${apiBaseUrl}/bookings/${bookingId}/checkout`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ force }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 409 && body.error === 'UNPAID_BALANCE') {
          return { ok: false, unpaid: true, balance: Number(body.balance) || 0 };
        }
        return { ok: false, error: body.message || body.error || 'Could not check out.' };
      }
      setSelectedRoom(null);
      loadBoard();
      return { ok: true };
    } catch {
      return { ok: false, error: 'Network error — could not reach the server.' };
    }
  };

  // Flip a checked-in room's per-meal Bhojanshala opt-in. `meal` is a { key }
  // from the dining pills (dineBreakfast/dineLunch/dineDinner); the backend maps
  // that to the booking column and emits bhojan:changed so the dining panel and
  // the board reconcile. Optimism isn't needed here — the board reload is quick.
  const toggleDining = async (bookingId, meal, value) => {
    const field = { dineBreakfast: 'breakfast', dineLunch: 'lunch', dineDinner: 'dinner' }[meal.key];
    if (!field) return;
    try {
      await fetch(`${apiBaseUrl}/bookings/${bookingId}/dining`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ [field]: value }),
      });
      loadBoard();
    } catch { /* socket bhojan:changed / booking:updated will reconcile */ }
  };

  const recordPayment = async (bookingId, amount, method, note) => {
    await fetch(`${apiBaseUrl}/bookings/${bookingId}/pay`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ amount, method, note }),
    });
    loadBoard();
  };

  const editBilling = async (bookingId, billingTier, discountPercent) => {
    await fetch(`${apiBaseUrl}/bookings/${bookingId}/billing`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ billingTier, discountPercent }),
    });
    loadBoard();
  };

  // Apply late-checkout / extra-bed / freeform charges, then reflect the new
  // totals in the still-open modal (the endpoint is idempotent — it replaces
  // any charges applied on a previous attempt rather than stacking them).
  const applyCheckoutCharges = async (bookingId, payload) => {
    const res = await fetch(`${apiBaseUrl}/bookings/${bookingId}/checkout-charges`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify(payload),
    });
    const b = await res.json().catch(() => null);
    if (b && b.id) {
      setSelectedRoom((r) => (r ? {
        ...r,
        finalAmount: b.final_amount,
        amountPaid: b.amount_paid,
        paymentStatus: b.payment_status,
        isPaid: b.is_paid,
        lateCheckoutSurcharge: b.late_checkout_surcharge,
        extraCharges: b.extra_charges,
      } : r));
    }
    loadBoard();
    return b;
  };

  const completeCheckin = async (bookingId, roomIds) => {
    await fetch(`${apiBaseUrl}/bookings/${bookingId}/checkin`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ roomIds }),
    });
    setCheckinBooking(null);
    loadAwaitingCheckin();
    loadBoard();
  };

  const bulkCheckout = async (bookingIds) => {
    await fetch(`${apiBaseUrl}/bookings/bulk-checkout`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ bookingIds }),
    });
    loadBoard();
  };

  // Extend a checked-in guest's stay by N nights. The backend refuses (409
  // NO_VACANCY_FOR_EXTENSION) if the room type is full across the new night(s),
  // so a denied extension surfaces as a message rather than an overbooking.
  const extendStay = async (bookingId, nights) => {
    try {
      const res = await fetch(`${apiBaseUrl}/bookings/${bookingId}/extend`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ nights }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        return { ok: false, error: body.message || body.error || 'Could not extend the stay.' };
      }
      loadBoard();
      return { ok: true, extensionCharge: body.extensionCharge, newCheckout: body.newCheckout, nights: body.nights };
    } catch {
      return { ok: false, error: 'Network error — could not reach the server.' };
    }
  };

  // Build a wa.me confirmation link for an approved guest, using the admin's
  // "approved" WhatsApp template (same template Swami Ji's panel uses).
  const buildConfirmationLink = (b) => {
    const tpl = waTemplates.approved
      ?? 'Jai Swaminarayan {{name}}, your booking for {{room}} is CONFIRMED. Status: {{status}}.';
    const msg = tpl
      .replace('{{name}}', b.guest_name || '')
      .replace('{{status}}', 'approved')
      .replace('{{room}}', b.room_type_name || 'your room');
    const phone = (b.mobile || '').replace(/\D/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(msg)}`;
  };

  return (
    <div className="min-h-screen bg-[#F8F4EC]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2B1610]/10" onClick={armSound}>
        <div>
          <h1 className="font-serif text-xl text-[#2B1610]">Reception</h1>
          <p className="text-xs text-[#2B1610]/40">Signed in as {user?.name}</p>
        </div>
        <div className="flex items-center gap-3">
          {/* Notification bell */}
          <div className="relative">
            <button
              onClick={(e) => { e.stopPropagation(); armSound(); setNotifOpen((p) => !p); }}
              className="relative flex items-center justify-center w-9 h-9 border border-[#2B1610]/15 hover:bg-[#2B1610]/5"
            >
              <Bell className={`w-4 h-4 ${notifications.some((n) => !n.dismissed && n.type === 'overdue') ? 'text-[#8C3B3B] animate-pulse' : 'text-[#2B1610]/60'}`} />
              {notifications.filter((n) => !n.dismissed).length > 0 && (
                <span className="absolute -top-1 -right-1 bg-[#8C3B3B] text-white text-[9px] w-4 h-4 flex items-center justify-center rounded-full">
                  {notifications.filter((n) => !n.dismissed).length}
                </span>
              )}
            </button>
            {notifOpen && (
              <div className="absolute right-0 top-10 w-80 bg-white border border-[#2B1610]/15 shadow-lg z-40 max-h-72 overflow-y-auto">
                <div className="flex items-center justify-between px-3 py-2 border-b border-[#2B1610]/10">
                  <span className="text-xs font-medium text-[#2B1610]/60 uppercase tracking-wide">Notifications</span>
                  <button onClick={() => setNotifications((p) => p.map((n) => ({ ...n, dismissed: true })))} className="text-xs text-[#B8792F] hover:underline">Dismiss all</button>
                </div>
                {notifications.length === 0 && (
                  <p className="text-xs text-[#2B1610]/40 text-center py-4">No notifications.</p>
                )}
                {notifications.map((n) => (
                  <div key={n.id} className={`flex items-start gap-2 px-3 py-2.5 border-b border-[#2B1610]/5 last:border-0 ${
                    n.dismissed ? 'opacity-40' : n.type === 'overdue' ? 'bg-[#8C3B3B]/5' : n.type === 'warning' ? 'bg-[#C77A34]/5' : ''
                  }`}>
                    <p className="text-xs text-[#2B1610] flex-1">{n.message}</p>
                    {!n.dismissed && (
                      <button onClick={() => setNotifications((p) => p.map((x) => x.id === n.id ? { ...x, dismissed: true } : x))} className="text-[#2B1610]/30 hover:text-[#2B1610] shrink-0">
                        <X className="w-3 h-3" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
            )}
          </div>
          <button onClick={logout} className="flex items-center gap-1.5 text-sm text-[#2B1610]/50 hover:text-[#2B1610]">
            <LogOut className="w-4 h-4" /> Sign out
          </button>
        </div>
      </header>

      {soundArmed === false && showSoundBanner && (
        <div className="bg-[#B8792F]/10 border-b border-[#B8792F]/20 px-6 py-2 flex items-center justify-between text-xs text-[#B8792F]">
          <span>Tap anywhere to enable sound notifications</span>
          <button onClick={() => setShowSoundBanner(false)} className="ml-4 text-[#B8792F]/60 hover:text-[#B8792F]"><X className="w-3.5 h-3.5" /></button>
        </div>
      )}

      <div className="px-6 pt-5">
        <div className="flex gap-6 border-b border-[#2B1610]/15 mb-6">
          <TabButton active={tab === 'board'} onClick={() => setTab('board')} icon={DoorOpen}>
            Floor board
          </TabButton>
          <TabButton active={tab === 'checkins'} onClick={() => setTab('checkins')} icon={CheckInIcon}>
            Check-ins
            {awaitingCheckin.length > 0 && (
              <span className="bg-[#8C3B3B] text-[#F8F4EC] text-[10px] px-1.5 py-0.5 rounded-full">{awaitingCheckin.length}</span>
            )}
          </TabButton>
          <TabButton active={tab === 'walkins'} onClick={() => setTab('walkins')} icon={ClipboardList}>
            Booking
          </TabButton>
          <TabButton active={tab === 'luggage'} onClick={() => setTab('luggage')} icon={Briefcase}>
            Luggage
            {luggage.count > 0 && (
              <span className="bg-[#B8792F] text-[#F8F4EC] text-[10px] px-1.5 py-0.5 rounded-full">{luggage.count}</span>
            )}
          </TabButton>
          <TabButton active={tab === 'guests'} onClick={() => setTab('guests')} icon={Users}>
            Current guests
          </TabButton>
          <TabButton active={tab === 'bhojan'} onClick={() => setTab('bhojan')} icon={Soup}>
            Bhojanshala
          </TabButton>
          <TabButton active={tab === 'history'} onClick={() => setTab('history')} icon={History}>
            History
          </TabButton>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')} icon={CalendarDays}>
            Calendar
          </TabButton>
        </div>

        <div className="pb-12">
          {tab === 'board' && (
            <>
              <DashboardStatsStrip stats={dashStats} />
              <FloorBoard floors={floors} onSelectRoom={setSelectedRoom} />
            </>
          )}

          {tab === 'checkins' && (
            <div className="space-y-8">
              {/* Awaiting approval — pending a decision; view-only here */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-serif text-lg text-[#2B1610]">Awaiting approval</h3>
                  {pendingApproval.length > 0 && (
                    <span className="bg-[#C77A34] text-[#F8F4EC] text-[11px] px-2 py-0.5 rounded-full">{pendingApproval.length}</span>
                  )}
                </div>
                {pendingApproval.length === 0 ? (
                  <p className="text-sm text-[#2B1610]/40">Nothing waiting for approval.</p>
                ) : (
                  <div className="space-y-3">
                    {pendingApproval.map((b) => (
                      <CheckinListRow
                        key={b.id}
                        booking={b}
                        badge={
                          <>
                            <span className="text-[10px] uppercase tracking-wide bg-[#B8792F]/15 text-[#B8792F] px-1.5 py-0.5">
                              {b.status === 'modified' ? 'Modified' : 'Pending'}
                            </span>
                            <span className="text-[10px] uppercase tracking-wide bg-[#2B1610]/5 text-[#2B1610]/50 px-1.5 py-0.5">
                              {b.channel === 'walkin' ? 'Walk-in' : 'Online'}
                            </span>
                          </>
                        }
                        onViewId={() => setViewingBookingId(b.id)}
                      />
                    ))}
                    <p className="text-xs text-[#2B1610]/40 pt-1">
                      Record a walk-in's phone/WhatsApp decision in the{' '}
                      <button onClick={() => setTab('walkins')} className="text-[#B8792F] hover:underline">Booking</button>{' '}
                      tab. Online requests are approved by Swami Ji.
                    </p>
                  </div>
                )}
              </section>

              {/* Awaiting check-in — approved, unassigned, arriving today or earlier */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-serif text-lg text-[#2B1610]">Awaiting check-in</h3>
                  {awaitingCheckin.length > 0 && (
                    <span className="bg-[#8C3B3B] text-[#F8F4EC] text-[11px] px-2 py-0.5 rounded-full">{awaitingCheckin.length}</span>
                  )}
                </div>
                {awaitingCheckin.length === 0 ? (
                  <p className="text-sm text-[#2B1610]/40">No approved bookings waiting for a room right now.</p>
                ) : (
                  <div className="space-y-3">
                    {awaitingCheckin.map((b) => (
                      <CheckinListRow
                        key={b.id}
                        booking={b}
                        onViewId={() => setViewingBookingId(b.id)}
                        confirmationLink={buildConfirmationLink(b)}
                        onCheckin={() => setCheckinBooking(b)}
                        onEdit={() => setEditingBooking(b)}
                        onCancel={() => setCancelBooking(b)}
                      />
                    ))}
                  </div>
                )}
              </section>

              {/* Upcoming — approved, arriving after today */}
              <section>
                <div className="flex items-center gap-2 mb-3">
                  <h3 className="font-serif text-lg text-[#2B1610]">Upcoming bookings</h3>
                  {upcomingBookings.length > 0 && (
                    <span className="bg-[#4A6D5C] text-[#F8F4EC] text-[11px] px-2 py-0.5 rounded-full">{upcomingBookings.length}</span>
                  )}
                </div>
                {upcomingBookings.length === 0 ? (
                  <p className="text-sm text-[#2B1610]/40">No future bookings on the books yet.</p>
                ) : (
                  <div className="space-y-3">
                    {upcomingBookings.map((b) => (
                      <CheckinListRow
                        key={b.id}
                        booking={b}
                        badge={
                          <>
                            <span className="text-[10px] uppercase tracking-wide bg-[#4A6D5C]/15 text-[#4A6D5C] px-1.5 py-0.5">Approved</span>
                            <span className="text-[10px] uppercase tracking-wide bg-[#2B1610]/5 text-[#2B1610]/50 px-1.5 py-0.5">
                              {b.channel === 'walkin' ? 'Walk-in' : 'Online'}
                            </span>
                          </>
                        }
                        onViewId={() => setViewingBookingId(b.id)}
                        confirmationLink={buildConfirmationLink(b)}
                        onEdit={() => setEditingBooking(b)}
                        onCancel={() => setCancelBooking(b)}
                      />
                    ))}
                  </div>
                )}
              </section>
            </div>
          )}

          {tab === 'walkins' && (
            <div>
              <WalkInBookingPanel apiBaseUrl={apiBaseUrl} token={token} roomTypes={roomTypes} socket={socket} />
            </div>
          )}

          {tab === 'luggage' && (
            <LuggagePanel luggage={luggage} onIssue={issueToken} onCollect={collectToken} />
          )}

          {tab === 'guests' && (
            <CurrentGuestsList
              floors={floors}
              onViewId={setViewingBookingId}
              onBulkCheckout={bulkCheckout}
              onToggleDining={toggleDining}
              onManage={setSelectedRoom}
            />
          )}

          {tab === 'bhojan' && (
            <BhojanPanel apiBaseUrl={apiBaseUrl} token={token} socket={socket} />
          )}

          {tab === 'history' && <HistoryReports apiBaseUrl={apiBaseUrl} token={token} canManageCheckout canModify canSetBilling canMarkPayment canCancel />}

          {tab === 'calendar' && (
            <OccupancyCalendar
              bookings={calendarBookings}
              occupancy={calendarOccupancy}
              calendarMonth={calendarMonth}
              onChangeMonth={(m) => setCalendarMonth(m)}
            />
          )}
        </div>
      </div>

      {selectedRoom && (
        <RoomActionModal
          room={selectedRoom}
          onClose={() => setSelectedRoom(null)}
          onViewId={(id) => { setSelectedRoom(null); setViewingBookingId(id); }}
          onSetStatus={setRoomStatus}
          onCheckout={checkoutRoom}
          onRecordPayment={recordPayment}
          onEditBilling={editBilling}
          onCheckoutCharges={applyCheckoutCharges}
          onExtendStay={extendStay}
          onIssueLuggage={issueToken}
          chargeRates={chargeRates}
          apiBaseUrl={apiBaseUrl}
          token={token}
        />
      )}

      {checkinBooking && (
        <CheckinModal
          booking={checkinBooking}
          apiBaseUrl={apiBaseUrl}
          token={token}
          onClose={() => setCheckinBooking(null)}
          onConfirm={completeCheckin}
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

      {/* Edit a confirmed booking (dates, pax, room type, bill, payment) — the
          same modal the History tab uses, opened straight from the Awaiting
          check-in / Upcoming rows so Reception needn't dig through History. */}
      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          apiBaseUrl={apiBaseUrl}
          token={token}
          canModify
          canSetBilling
          canMarkPayment
          onClose={() => setEditingBooking(null)}
          onSaved={() => {
            setEditingBooking(null);
            loadAwaitingCheckin();
            loadUpcoming();
            loadBoard();
          }}
        />
      )}

      {cancelBooking && (
        <CancelBookingModal
          booking={cancelBooking}
          apiBaseUrl={apiBaseUrl}
          token={token}
          onClose={() => setCancelBooking(null)}
          onDone={() => {
            setCancelBooking(null);
            loadAwaitingCheckin();
            loadUpcoming();
            loadBoard();
          }}
        />
      )}
    </div>
  );
}

// A single booking row for the Check-ins tab sections. Actions are opt-in so one
// row serves "awaiting approval" (view only), "awaiting check-in" (assign room +
// confirm) and "upcoming" (view + confirm). `badge` is optional status markup.
function CheckinListRow({ booking: b, badge = null, onViewId, confirmationLink, onCheckin, onEdit, onCancel }) {
  return (
    <div className="border border-[#2B1610]/10 bg-white/40 p-4 flex items-center justify-between gap-4">
      <div>
        <div className="flex items-center gap-2 flex-wrap">
          <p className="font-serif text-[#2B1610]">{b.guest_name}</p>
          {badge}
          {!b.id_document_url && (
            <span className="text-[10px] uppercase tracking-wide bg-[#C77A34]/15 text-[#C77A34] px-1.5 py-0.5">No ID</span>
          )}
        </div>
        <p className="text-xs text-[#2B1610]/50">
          {b.room_type_name} · {fmtDate(b.checkin_date)} → {fmtDate(b.checkout_date)}
          {b.num_rooms > 1 ? ` · ${b.num_rooms} rooms` : ''}
        </p>
        {b.mobile && <p className="text-xs text-[#2B1610]/40">{b.mobile}</p>}
      </div>
      <div className="flex items-center gap-2 shrink-0">
        {onViewId && (
          <button
            onClick={onViewId}
            className="flex items-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610]/80 px-3 py-2 text-sm hover:border-[#2B1610]/40"
          >
            <Eye className="w-3.5 h-3.5" /> View ID
          </button>
        )}
        {onEdit && (
          <button
            onClick={onEdit}
            className="flex items-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610]/80 px-3 py-2 text-sm hover:border-[#2B1610]/40"
          >
            <Pencil className="w-3.5 h-3.5" /> Edit
          </button>
        )}
        {onCancel && (
          <button
            onClick={onCancel}
            className="flex items-center gap-1.5 border border-[#8C3B3B]/40 text-[#8C3B3B] px-3 py-2 text-sm hover:bg-[#8C3B3B]/10"
          >
            <X className="w-3.5 h-3.5" /> Cancel
          </button>
        )}
        {confirmationLink && (
          <a
            href={confirmationLink}
            target="_blank"
            rel="noreferrer"
            className="flex items-center gap-1.5 border border-[#4A6D5C]/40 text-[#4A6D5C] px-3 py-2 text-sm hover:bg-[#4A6D5C]/10"
          >
            <MessageCircle className="w-3.5 h-3.5" /> Send confirmation
          </a>
        )}
        {onCheckin && (
          <button
            onClick={onCheckin}
            className="flex items-center gap-1.5 bg-[#2B1610] text-[#F8F4EC] px-3 py-2 text-sm hover:bg-[#3d2118]"
          >
            <CheckInIcon className="w-3.5 h-3.5" /> Assign room &amp; check in
          </button>
        )}
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 pb-3 text-sm border-b-2 -mb-px transition-colors ${
        active ? 'border-[#B8792F] text-[#2B1610]' : 'border-transparent text-[#2B1610]/40'
      }`}
    >
      <Icon className="w-4 h-4" /> {children}
    </button>
  );
}

// ---------------------------------------------------------------------------
// Room action modal — now branches by room status: ready/in_transit
// rooms get simple status-toggle actions; occupied rooms get the
// guest's billing summary plus checkout + payment editing.
// ---------------------------------------------------------------------------
function RoomActionModal({ room, onClose, onViewId, onSetStatus, onCheckout, onRecordPayment, onEditBilling, onCheckoutCharges, onExtendStay, onIssueLuggage, chargeRates, apiBaseUrl, token }) {
  const [editingBilling, setEditingBilling] = useState(false);
  const [billingTier, setBillingTier] = useState(room.billingTier || 'paid');
  const [discountPercent, setDiscountPercent] = useState(Number(room.discountPercent) || 0);
  const [payAmount, setPayAmount] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [payNote, setPayNote] = useState('');
  const [paying, setPaying] = useState(false);
  const [showPayHistory, setShowPayHistory] = useState(false);
  const [payHistory, setPayHistory] = useState([]);

  // Extend stay
  const [extendNights, setExtendNights] = useState(1);
  const [extending, setExtending] = useState(false);
  const [extendMsg, setExtendMsg] = useState(null); // { ok, text }

  // Luggage token at checkout
  const [luggageBags, setLuggageBags] = useState(1);
  const [issuingLuggage, setIssuingLuggage] = useState(false);
  const [luggageMsg, setLuggageMsg] = useState(null); // { ok, text, code }

  // Checkout — the server refuses (409 UNPAID_BALANCE) when money is still owing
  // unless we pass force; checkoutConfirm holds the balance while we ask.
  const [checkingOut, setCheckingOut] = useState(false);
  const [checkoutConfirm, setCheckoutConfirm] = useState(null); // { balance }
  const [checkoutErr, setCheckoutErr] = useState(null);

  // Checkout charges (late checkout / extra beds / freeform)
  const [showCharges, setShowCharges] = useState(false);
  const [lateHours, setLateHours] = useState(0);
  const [extraBeds, setExtraBeds] = useState(0);
  const [freeform, setFreeform] = useState([]); // [{ label, amount }]
  const [chargeBase, setChargeBase] = useState(null); // pre-surcharge amount
  const [applyingCharges, setApplyingCharges] = useState(false);

  const lateRate = Number(chargeRates?.lateCheckoutRatePerHour) || 0;
  const bedRate = Number(chargeRates?.extraBedRate) || 0;

  const finalAmt = Number(room.finalAmount ?? 0);
  const amtPaid = Number(room.amountPaid ?? 0);
  const balance = Math.max(0, finalAmt - amtPaid);
  const pStatus = room.paymentStatus || (room.isPaid ? 'paid' : 'unpaid');

  const authH = { Authorization: `Bearer ${token}` };

  const loadPayHistory = async () => {
    if (showPayHistory) { setShowPayHistory(false); return; }
    try {
      const res = await fetch(`${apiBaseUrl}/bookings/${room.bookingId}/payments`, { headers: authH });
      const data = await res.json();
      setPayHistory(Array.isArray(data) ? data : []);
    } catch { setPayHistory([]); }
    setShowPayHistory(true);
  };

  const handlePrint = async () => {
    // The PDF endpoint only needs the booking id; fetch the booking first so the
    // downloaded file can be named with its booking_code, but fall back cleanly.
    try {
      const bRes = await fetch(`${apiBaseUrl}/bookings/${room.bookingId}`, { headers: authH });
      const booking = await bRes.json();
      await printReceipt(booking?.id ? booking : { id: room.bookingId }, { apiBaseUrl, token });
    } catch {
      printReceipt({ id: room.bookingId }, { apiBaseUrl, token });
    }
  };

  const handleWhatsApp = async () => {
    try {
      const res = await fetch(`${apiBaseUrl}/bookings/${room.bookingId}`, { headers: authH });
      const booking = await res.json();
      openWhatsAppReceipt(booking);
    } catch { /* ignore */ }
  };

  const handlePay = async () => {
    const amt = Number(payAmount);
    if (!amt || amt <= 0) return;
    setPaying(true);
    await onRecordPayment(room.bookingId, amt, payMethod, payNote);
    setPaying(false);
    setPayAmount(''); setPayNote('');
  };

  // --- Checkout charges -----------------------------------------------------
  // The backend REPLACES (does not stack) checkout charges on every apply, so
  // we prefill the form from whatever is already saved and derive the
  // pre-surcharge base to preview the new total locally.
  const lateFee = Math.max(0, Number(lateHours) || 0) * lateRate;
  const bedFee = Math.max(0, Math.floor(Number(extraBeds) || 0)) * bedRate;
  const freeformTotal = freeform.reduce((s, c) => s + (Number(c.amount) || 0), 0);
  const surchargeTotal = lateFee + bedFee + freeformTotal;
  const newTotalPreview = chargeBase === null ? null : Math.max(0, chargeBase + surchargeTotal);

  const openCharges = async () => {
    if (showCharges) { setShowCharges(false); return; }
    let priorLate = 0;
    let priorExtra = [];
    let base = finalAmt;
    try {
      const res = await fetch(`${apiBaseUrl}/bookings/${room.bookingId}`, { headers: authH });
      const b = await res.json();
      if (b && !b.error) {
        priorLate = Number(b.late_checkout_surcharge) || 0;
        priorExtra = Array.isArray(b.extra_charges) ? b.extra_charges : [];
        const priorExtraTotal = priorExtra.reduce((s, c) => s + (Number(c?.amount) || 0), 0);
        base = Math.max(0, (Number(b.final_amount) || 0) - priorLate - priorExtraTotal);
      }
    } catch { /* fall back to the board's figures */ }
    // An "Extra bed × N" row is generated by the backend from extraBeds — pull
    // it back out so re-opening the form shows beds as beds, not as a line item.
    let beds = 0;
    const rest = [];
    priorExtra.forEach((c) => {
      const m = /^Extra bed × (\d+)$/.exec(String(c?.label ?? ''));
      if (m) beds = Number(m[1]);
      else rest.push({ label: String(c?.label ?? ''), amount: Number(c?.amount) || 0 });
    });
    setChargeBase(base);
    setLateHours(lateRate > 0 ? priorLate / lateRate : 0);
    setExtraBeds(beds);
    setFreeform(rest);
    setShowCharges(true);
  };

  const addFreeform = () => setFreeform((f) => [...f, { label: '', amount: '' }]);
  const updateFreeform = (i, patch) =>
    setFreeform((f) => f.map((c, idx) => (idx === i ? { ...c, ...patch } : c)));
  const removeFreeform = (i) => setFreeform((f) => f.filter((_, idx) => idx !== i));

  const applyCharges = async () => {
    setApplyingCharges(true);
    await onCheckoutCharges?.(room.bookingId, {
      lateCheckoutHours: Math.max(0, Number(lateHours) || 0),
      extraBeds: Math.max(0, Math.floor(Number(extraBeds) || 0)),
      extraCharges: freeform
        .map((c) => ({ label: String(c.label || '').trim(), amount: Number(c.amount) || 0 }))
        .filter((c) => c.label && c.amount > 0),
    });
    setApplyingCharges(false);
    setShowCharges(false);
  };

  const handleExtend = async () => {
    const n = Math.max(1, Math.floor(Number(extendNights) || 1));
    setExtending(true);
    setExtendMsg(null);
    const result = await onExtendStay?.(room.bookingId, n);
    setExtending(false);
    if (result?.ok) {
      setExtendMsg({
        ok: true,
        text: `Extended to ${result.newCheckout}. Extra charge ₹${Number(result.extensionCharge || 0).toLocaleString('en-IN')}.`,
      });
    } else {
      setExtendMsg({ ok: false, text: result?.error || 'Could not extend the stay.' });
    }
  };

  const handleIssueLuggage = async () => {
    const bags = Math.max(1, Math.floor(Number(luggageBags) || 1));
    setIssuingLuggage(true);
    setLuggageMsg(null);
    const result = await onIssueLuggage?.({
      guestName: room.guestName,
      bookingId: room.bookingId,
      bagCount: bags,
    });
    setIssuingLuggage(false);
    if (result?.ok) {
      setLuggageMsg({ ok: true, text: 'Token issued', code: result.token?.token_code });
    } else {
      setLuggageMsg({ ok: false, text: result?.error || 'Could not issue luggage token.' });
    }
  };

  // Checkout: first attempt is un-forced; if the server reports an unpaid
  // balance we show the balance and a "check out anyway" confirm that forces it.
  const doCheckout = async (force) => {
    setCheckingOut(true);
    setCheckoutErr(null);
    const result = await onCheckout?.(room.bookingId, force);
    setCheckingOut(false);
    if (result?.ok) return; // parent closes the modal + refreshes
    if (result?.unpaid) { setCheckoutConfirm({ balance: result.balance }); return; }
    setCheckoutErr(result?.error || 'Could not check out.');
  };

  const statusBadge = pStatus === 'paid'
    ? 'bg-[#4A6D5C]/10 text-[#4A6D5C]'
    : pStatus === 'partial'
    ? 'bg-[#B8792F]/10 text-[#B8792F]'
    : 'bg-[#8C3B3B]/10 text-[#8C3B3B]';

  if (room.status === 'occupied' && room.bookingId) {
    return (
      <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
        <div className="bg-[#F8F4EC] max-w-sm w-full p-6 relative max-h-[90vh] overflow-y-auto">
          <button onClick={onClose} className="absolute top-4 right-4 text-[#2B1610]/40 hover:text-[#2B1610]">
            <X className="w-5 h-5" />
          </button>
          <h3 className="font-serif text-lg text-[#2B1610] mb-1">Room {room.roomNumber}</h3>
          <div className="flex items-center gap-2 mb-1">
            <p className="text-sm text-[#2B1610]/70">{room.guestName}</p>
            {!room.idDocumentUrl && (
              <span className="text-[10px] uppercase tracking-wide bg-[#C77A34]/15 text-[#C77A34] px-1.5 py-0.5">No ID</span>
            )}
          </div>
          <p className="text-xs text-[#2B1610]/40 mb-4">
            Checkout by {fmtDate(room.checkoutTime)}
          </p>

          {/* Billing summary */}
          <div className="border border-[#2B1610]/10 p-3 mb-4">
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-[#2B1610]/60">Billing tier</span>
              <span className="text-[#2B1610]">{room.billingTier || '—'}</span>
            </div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-[#2B1610]/60">Total</span>
              <span className="text-[#2B1610] font-serif">
                {finalAmt > 0 ? `₹${finalAmt.toLocaleString('en-IN')}` : '—'}
              </span>
            </div>
            <div className="flex items-center justify-between text-sm mb-2">
              <span className="text-[#2B1610]/60">Paid</span>
              <span className="text-[#2B1610] font-serif">₹{amtPaid.toLocaleString('en-IN')}</span>
            </div>
            <div className="flex items-center justify-between text-sm">
              <span className="text-[#2B1610]/60">Balance</span>
              <span className="font-serif font-semibold text-[#2B1610]">
                {balance > 0 ? `₹${balance.toLocaleString('en-IN')}` : '₹0'}
              </span>
            </div>
            <div className="mt-2">
              <span className={`text-xs px-2 py-0.5 uppercase tracking-wide ${statusBadge}`}>
                {pStatus}
              </span>
            </div>
          </div>

          <button
            onClick={() => onViewId?.(room.bookingId)}
            className="w-full flex items-center justify-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610] py-2.5 text-sm hover:bg-[#2B1610]/5 mb-2"
          >
            <Eye className="w-3.5 h-3.5" /> View ID
          </button>

          {/* Record payment — only if balance remaining */}
          {balance > 0 && (
            <div className="border border-[#2B1610]/10 p-3 mb-3 space-y-2">
              <p className="text-xs font-medium text-[#2B1610]/60 uppercase tracking-wide">Record payment</p>
              <input
                type="number" min={1} max={balance} step="0.01"
                placeholder={`Amount (max ₹${balance.toLocaleString('en-IN')})`}
                value={payAmount}
                onChange={(e) => setPayAmount(e.target.value)}
                className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
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
              <input
                placeholder="Note (optional)"
                value={payNote}
                onChange={(e) => setPayNote(e.target.value)}
                className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
              />
              <button
                onClick={handlePay}
                disabled={paying || !payAmount || Number(payAmount) <= 0}
                className="w-full bg-[#4A6D5C] text-white py-2 text-sm hover:opacity-90 disabled:opacity-60"
              >
                {paying ? 'Recording…' : 'Record payment'}
              </button>
            </div>
          )}

          {/* Payment history toggle */}
          <button
            onClick={loadPayHistory}
            className="w-full flex items-center justify-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610] py-2 text-xs hover:bg-[#2B1610]/5 mb-2"
          >
            {showPayHistory ? 'Hide' : 'Show'} payment history
          </button>
          {showPayHistory && (
            <div className="border border-[#2B1610]/10 p-2 mb-3 max-h-32 overflow-y-auto">
              {payHistory.length === 0 ? (
                <p className="text-xs text-[#2B1610]/40 text-center py-2">No payments recorded.</p>
              ) : payHistory.map((p) => (
                <div key={p.id} className="flex justify-between text-xs py-1 border-b border-[#2B1610]/5 last:border-0">
                  <span className="text-[#2B1610]/70">
                    ₹{Number(p.amount).toLocaleString('en-IN')} · {p.method}
                    {p.note ? ` · ${p.note}` : ''}
                  </span>
                  <span className="text-[#2B1610]/40">{new Date(p.created_at).toLocaleString()}</span>
                </div>
              ))}
            </div>
          )}

          {/* Billing edit */}
          {editingBilling ? (
            <div className="border border-[#2B1610]/10 p-3 mb-4 space-y-3">
              <div className="flex flex-wrap gap-2">
                {['foc', 'discount', 'paid'].map((tier) => (
                  <label
                    key={tier}
                    className={`flex items-center gap-1.5 border px-2.5 py-1.5 text-xs cursor-pointer ${
                      billingTier === tier ? 'border-[#B8792F] bg-[#B8792F]/10 text-[#2B1610]' : 'border-[#2B1610]/15 text-[#2B1610]/60'
                    }`}
                  >
                    <input type="radio" className="hidden" checked={billingTier === tier} onChange={() => setBillingTier(tier)} />
                    {tier === 'foc' ? 'FOC' : tier === 'discount' ? 'Discount' : 'Full price'}
                  </label>
                ))}
              </div>
              {billingTier === 'discount' && (
                <input
                  type="number" min={0} max={100} placeholder="% off"
                  value={discountPercent}
                  onChange={(e) => setDiscountPercent(Number(e.target.value))}
                  className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
                />
              )}
              <button
                onClick={() => { onEditBilling(room.bookingId, billingTier, discountPercent); setEditingBilling(false); }}
                className="w-full bg-[#2B1610] text-[#F8F4EC] py-2 text-sm"
              >
                Save billing changes
              </button>
            </div>
          ) : (
            <button
              onClick={() => setEditingBilling(true)}
              className="w-full flex items-center justify-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610] py-2.5 text-sm hover:bg-[#2B1610]/5 mb-2"
            >
              <IndianRupee className="w-3.5 h-3.5" /> Edit billing
            </button>
          )}

          {/* Checkout charges — late checkout, extra beds, freeform extras */}
          <button
            onClick={openCharges}
            className="w-full flex items-center justify-center gap-1.5 border border-[#B8792F]/40 text-[#B8792F] py-2.5 text-sm hover:bg-[#B8792F]/5 mb-2"
          >
            <Clock className="w-3.5 h-3.5" /> {showCharges ? 'Hide checkout charges' : 'Checkout charges'}
          </button>

          {showCharges && (
            <div className="border border-[#B8792F]/30 p-3 mb-3 space-y-3">
              <div>
                <label className="text-xs text-[#2B1610]/60 block mb-1">
                  Late checkout (hours){lateRate > 0 ? ` · ₹${lateRate.toLocaleString('en-IN')}/hr` : ' · no rate set'}
                </label>
                <input
                  type="number" min={0} step="0.5"
                  value={lateHours}
                  onChange={(e) => setLateHours(e.target.value)}
                  className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
                />
              </div>

              <div>
                <label className="text-xs text-[#2B1610]/60 block mb-1">
                  Extra beds{bedRate > 0 ? ` · ₹${bedRate.toLocaleString('en-IN')} each` : ' · no rate set'}
                </label>
                <input
                  type="number" min={0} step="1"
                  value={extraBeds}
                  onChange={(e) => setExtraBeds(e.target.value)}
                  className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
                />
              </div>

              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <span className="text-xs text-[#2B1610]/60">Other charges</span>
                  <button
                    onClick={addFreeform}
                    className="flex items-center gap-1 text-xs text-[#B8792F] hover:underline"
                  >
                    <Plus className="w-3 h-3" /> Add
                  </button>
                </div>
                {freeform.map((c, i) => (
                  <div key={i} className="flex gap-2">
                    <input
                      placeholder="Label"
                      value={c.label}
                      onChange={(e) => updateFreeform(i, { label: e.target.value })}
                      className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm flex-1 min-w-0"
                    />
                    <input
                      type="number" min={0} placeholder="₹"
                      value={c.amount}
                      onChange={(e) => updateFreeform(i, { amount: e.target.value })}
                      className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-20"
                    />
                    <button
                      onClick={() => removeFreeform(i)}
                      className="text-[#8C3B3B]/60 hover:text-[#8C3B3B] px-1"
                      aria-label="Remove charge"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                ))}
              </div>

              <div className="border-t border-[#2B1610]/10 pt-2 text-sm space-y-1">
                <div className="flex justify-between text-[#2B1610]/60">
                  <span>Room charges</span>
                  <span>{chargeBase === null ? '—' : `₹${chargeBase.toLocaleString('en-IN')}`}</span>
                </div>
                <div className="flex justify-between text-[#2B1610]/60">
                  <span>Extra charges</span>
                  <span>₹{surchargeTotal.toLocaleString('en-IN')}</span>
                </div>
                <div className="flex justify-between font-serif font-semibold text-[#2B1610]">
                  <span>New total</span>
                  <span>{newTotalPreview === null ? '—' : `₹${newTotalPreview.toLocaleString('en-IN')}`}</span>
                </div>
              </div>

              <p className="text-[11px] text-[#2B1610]/40 leading-snug">
                Applying replaces any charges added earlier — it does not add to them.
              </p>

              <button
                onClick={applyCharges}
                disabled={applyingCharges}
                className="w-full bg-[#2B1610] text-[#F8F4EC] py-2 text-sm disabled:opacity-60"
              >
                {applyingCharges ? 'Applying…' : 'Apply charges'}
              </button>
            </div>
          )}

          <div className="flex gap-2 mb-2">
            <button
              onClick={handlePrint}
              className="flex-1 flex items-center justify-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610] py-2.5 text-sm hover:bg-[#2B1610]/5"
            >
              <Printer className="w-3.5 h-3.5" /> Print receipt
            </button>
            <button
              onClick={handleWhatsApp}
              className="flex-1 flex items-center justify-center gap-1.5 border border-[#4A6D5C]/30 text-[#4A6D5C] py-2.5 text-sm hover:bg-[#4A6D5C]/5"
            >
              <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
            </button>
          </div>

          {/* Extend stay — refused by the server if the room type is full on the new night(s) */}
          <div className="border border-[#2B1610]/10 p-3 mb-2">
            <p className="text-xs font-medium text-[#2B1610]/60 uppercase tracking-wide mb-2">Extend stay</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#2B1610]/60">Nights</label>
              <input
                type="number" min={1} step="1"
                value={extendNights}
                onChange={(e) => setExtendNights(e.target.value)}
                className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-16"
              />
              <button
                onClick={handleExtend}
                disabled={extending}
                className="flex-1 flex items-center justify-center gap-1.5 border border-[#4A6D5C]/40 text-[#4A6D5C] py-2 text-sm hover:bg-[#4A6D5C]/5 disabled:opacity-60"
              >
                <Clock className="w-3.5 h-3.5" /> {extending ? 'Extending…' : 'Extend stay'}
              </button>
            </div>
            {extendMsg && (
              <p className={`text-xs mt-2 ${extendMsg.ok ? 'text-[#4A6D5C]' : 'text-[#8C3B3B]'}`}>
                {extendMsg.text}
              </p>
            )}
          </div>

          {/* Luggage token — printable claim check for bags left in the hall */}
          <div className="border border-[#2B1610]/10 p-3 mb-2">
            <p className="text-xs font-medium text-[#2B1610]/60 uppercase tracking-wide mb-2">Luggage token</p>
            <div className="flex items-center gap-2">
              <label className="text-xs text-[#2B1610]/60">Bags</label>
              <input
                type="number" min={1} step="1"
                value={luggageBags}
                onChange={(e) => setLuggageBags(e.target.value)}
                className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-16"
              />
              <button
                onClick={handleIssueLuggage}
                disabled={issuingLuggage}
                className="flex-1 flex items-center justify-center gap-1.5 border border-[#B8792F]/40 text-[#B8792F] py-2 text-sm hover:bg-[#B8792F]/5 disabled:opacity-60"
              >
                <Briefcase className="w-3.5 h-3.5" /> {issuingLuggage ? 'Issuing…' : 'Issue luggage token'}
              </button>
            </div>
            {luggageMsg && (
              luggageMsg.ok ? (
                <div className="mt-2 border border-[#4A6D5C]/30 bg-[#4A6D5C]/5 p-2 text-center">
                  <span className="text-xs text-[#2B1610]/50">Give the guest token </span>
                  <span className="font-serif text-[#4A6D5C] font-semibold tracking-wider">{luggageMsg.code}</span>
                </div>
              ) : (
                <p className="text-xs mt-2 text-[#8C3B3B]">{luggageMsg.text}</p>
              )
            )}
          </div>

          {checkoutConfirm ? (
            <div className="border border-[#8C3B3B]/30 bg-[#8C3B3B]/5 p-3 mb-2">
              <p className="text-sm text-[#8C3B3B] mb-2">
                ₹{Number(checkoutConfirm.balance || 0).toLocaleString('en-IN')} is still unpaid. Check out anyway?
              </p>
              <div className="flex gap-2">
                <button
                  onClick={() => doCheckout(true)}
                  disabled={checkingOut}
                  className="flex-1 bg-[#8C3B3B] text-white py-2 text-sm hover:opacity-90 disabled:opacity-60"
                >
                  {checkingOut ? 'Checking out…' : 'Check out anyway'}
                </button>
                <button
                  onClick={() => { setCheckoutConfirm(null); setCheckoutErr(null); }}
                  className="flex-1 border border-[#2B1610]/20 text-[#2B1610] py-2 text-sm hover:bg-[#2B1610]/5"
                >
                  Keep guest
                </button>
              </div>
            </div>
          ) : (
            <button
              onClick={() => doCheckout(false)}
              disabled={checkingOut}
              className="w-full flex items-center justify-center gap-1.5 bg-[#8C3B3B] text-white py-2.5 text-sm hover:opacity-90 mb-2 disabled:opacity-60"
            >
              {checkingOut ? 'Checking out…' : 'Check out'}
            </button>
          )}
          {checkoutErr && <p className="text-xs text-[#8C3B3B] mb-2">{checkoutErr}</p>}
        </div>
      </div>
    );
  }

  // Ready / maintenance — simple status-change actions. Only three room
  // statuses exist now (Ready, Occupied, Maintenance) — no cleaning limbo.
  const options = [
    { status: 'ready', label: 'Mark ready' },
    { status: 'maintenance', label: 'Mark under maintenance' },
  ];

  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-xs w-full p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-[#2B1610]/40 hover:text-[#2B1610]">
          <X className="w-5 h-5" />
        </button>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1">Room {room.roomNumber}</h3>
        <p className="text-xs text-[#2B1610]/50 mb-5">{room.roomType}</p>
        <div className="space-y-2">
          {options.map((opt) => (
            <button
              key={opt.status}
              onClick={() => onSetStatus(room.id, opt.status)}
              className="w-full text-left border border-[#2B1610]/15 px-3 py-2.5 text-sm text-[#2B1610]/80 hover:border-[#2B1610]/30"
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Luggage hall — issue a printable claim token per bundle of bags a guest
// leaves, and see which tokens are still open. "Bags in hall" is the sum of
// open tokens' bag counts (kept live over the socket by the parent).
// ---------------------------------------------------------------------------
function LuggagePanel({ luggage, onIssue, onCollect }) {
  const [guestName, setGuestName] = useState('');
  const [mobile, setMobile] = useState('');
  const [bags, setBags] = useState(1);
  const [note, setNote] = useState('');
  const [issuing, setIssuing] = useState(false);
  const [msg, setMsg] = useState(null); // { ok, text, code }

  const tokens = Array.isArray(luggage?.tokens) ? luggage.tokens : [];
  const count = luggage?.count ?? 0;

  const submit = async () => {
    const name = guestName.trim();
    if (!name) { setMsg({ ok: false, text: 'Guest name is required.' }); return; }
    setIssuing(true);
    setMsg(null);
    const result = await onIssue?.({
      guestName: name,
      mobile: mobile.trim(),
      bagCount: Math.max(1, Math.floor(Number(bags) || 1)),
      note: note.trim(),
    });
    setIssuing(false);
    if (result?.ok) {
      setMsg({ ok: true, text: 'Token issued', code: result.token?.token_code });
      setGuestName(''); setMobile(''); setBags(1); setNote('');
    } else {
      setMsg({ ok: false, text: result?.error || 'Could not issue token.' });
    }
  };

  return (
    <div className="grid md:grid-cols-2 gap-6">
      {/* Issue a token */}
      <div>
        <div className="flex items-center gap-3 mb-4">
          <div className="w-12 h-12 bg-[#B8792F]/10 flex items-center justify-center">
            <Briefcase className="w-6 h-6 text-[#B8792F]" />
          </div>
          <div>
            <p className="font-serif text-2xl text-[#2B1610]">{count}</p>
            <p className="text-xs text-[#2B1610]/50 uppercase tracking-wide">
              bags in hall · {tokens.length} open token{tokens.length === 1 ? '' : 's'}
            </p>
          </div>
        </div>
        <div className="border border-[#2B1610]/10 p-4 space-y-3">
          <p className="text-xs font-medium text-[#2B1610]/60 uppercase tracking-wide">Issue a token</p>
          <input
            placeholder="Guest name *"
            value={guestName}
            onChange={(e) => setGuestName(e.target.value)}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
          />
          <input
            placeholder="Mobile (optional)"
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
          />
          <div className="flex items-center gap-2">
            <label className="text-xs text-[#2B1610]/60">Bags</label>
            <input
              type="number" min={1} step="1"
              value={bags}
              onChange={(e) => setBags(e.target.value)}
              className="border border-[#2B1610]/20 bg-white px-2 py-2 text-sm w-20"
            />
          </div>
          <input
            placeholder="Note (optional)"
            value={note}
            onChange={(e) => setNote(e.target.value)}
            className="border border-[#2B1610]/20 bg-white px-3 py-2 text-sm w-full"
          />
          <button
            onClick={submit}
            disabled={issuing}
            className="w-full bg-[#2B1610] text-[#F8F4EC] py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-60"
          >
            {issuing ? 'Issuing…' : 'Issue luggage token'}
          </button>
          {msg && (
            msg.ok ? (
              <div className="border border-[#4A6D5C]/30 bg-[#4A6D5C]/5 p-3 text-center">
                <p className="text-xs text-[#2B1610]/50 uppercase tracking-wide">Give the guest this token</p>
                <p className="font-serif text-2xl text-[#4A6D5C] tracking-wider">{msg.code}</p>
              </div>
            ) : (
              <p className="text-xs text-[#8C3B3B]">{msg.text}</p>
            )
          )}
        </div>
      </div>

      {/* Open tokens */}
      <div>
        <p className="text-xs font-medium text-[#2B1610]/60 uppercase tracking-wide mb-3">Open tokens</p>
        {tokens.length === 0 ? (
          <p className="text-sm text-[#2B1610]/40">No bags in the hall right now.</p>
        ) : (
          <div className="space-y-2">
            {tokens.map((t) => (
              <div key={t.id} className="border border-[#2B1610]/10 p-3 flex items-center justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="font-serif text-[#B8792F]">{t.token_code}</span>
                    <span className="text-xs text-[#2B1610]/40">{t.bag_count} bag{t.bag_count === 1 ? '' : 's'}</span>
                  </div>
                  <p className="text-sm text-[#2B1610] truncate">{t.guest_name}</p>
                  {t.mobile && <p className="text-xs text-[#2B1610]/40">{t.mobile}</p>}
                  {t.note && <p className="text-xs text-[#2B1610]/40 truncate">{t.note}</p>}
                </div>
                <button
                  onClick={() => onCollect?.(t.id)}
                  className="shrink-0 border border-[#4A6D5C]/40 text-[#4A6D5C] px-3 py-2 text-xs hover:bg-[#4A6D5C]/10"
                >
                  Mark collected
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Reception Calendar — monthly grid showing arrivals, departures, in-house
// ---------------------------------------------------------------------------
// Check-in modal — the room-allocation step that was entirely missing.
// Lists rooms of the booking's room type currently 'ready' and lets
// Reception pick exactly which one the guest goes into.
// ---------------------------------------------------------------------------
function CheckinModal({ booking, apiBaseUrl, token, onClose, onConfirm }) {
  const [availableRooms, setAvailableRooms] = useState([]);
  const [selectedRoomIds, setSelectedRoomIds] = useState([]);
  const [loading, setLoading] = useState(true);
  const [confirming, setConfirming] = useState(false);
  const [idDocUrl, setIdDocUrl] = useState(booking.id_document_url || null);
  const [attachingId, setAttachingId] = useState(false);
  const [idError, setIdError] = useState('');
  const needed = booking.num_rooms ?? 1;

  useEffect(() => {
    fetchArray(`${apiBaseUrl}/rooms/available?roomTypeId=${booking.room_type_id}`, {
      headers: { Authorization: `Bearer ${token}` },
    }).then((rooms) => {
      setAvailableRooms(rooms);
      // Pre-select the first room only for single-room bookings; multi-room is deliberate.
      setSelectedRoomIds(needed === 1 && rooms[0] ? [rooms[0].id] : []);
      setLoading(false);
    });
  }, [apiBaseUrl, token, booking.room_type_id, needed]);

  // Persist a captured ID photo to this booking. Online guests arrive without
  // an ID (none is collected on the public cloud form), so Reception records it
  // here at the desk via the same local-disk QR upload the app already uses.
  // The upload's imageUrl is a local '/uploads/...' path — exactly what the
  // PATCH endpoint stores. This is separate from (and not required for) the
  // room-assignment step below.
  const attachId = async (imageUrl) => {
    setAttachingId(true);
    setIdError('');
    try {
      const res = await fetch(`${apiBaseUrl}/bookings/${booking.id}/id-document`, {
        method: 'PATCH',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ idDocumentUrl: imageUrl }),
      });
      if (!res.ok) {
        const b = await res.json().catch(() => ({}));
        setIdError(b.message || b.error || 'Could not save the ID. Try again.');
        return;
      }
      setIdDocUrl(imageUrl);
    } catch {
      setIdError('Network error — could not save the ID.');
    } finally {
      setAttachingId(false);
    }
  };

  const toggleRoom = (id) => {
    setSelectedRoomIds((prev) => {
      if (prev.includes(id)) return prev.filter((x) => x !== id);
      if (needed === 1) return [id];               // single-room: selecting replaces
      if (prev.length >= needed) return prev;       // multi-room: cap at needed
      return [...prev, id];
    });
  };

  const confirm = async () => {
    if (selectedRoomIds.length !== needed) return;
    setConfirming(true);
    await onConfirm(booking.id, selectedRoomIds);
    setConfirming(false);
  };

  return (
    <div className="fixed inset-0 bg-[#2B1610]/60 flex items-center justify-center p-4 z-50">
      <div className="bg-[#F8F4EC] max-w-sm w-full p-6 relative">
        <button onClick={onClose} className="absolute top-4 right-4 text-[#2B1610]/40 hover:text-[#2B1610]">
          <X className="w-5 h-5" />
        </button>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1">{booking.guest_name}</h3>
        <p className="text-xs text-[#2B1610]/50 mb-1">
          Assign {needed > 1 ? `${needed} ${booking.room_type_name} rooms` : `a ${booking.room_type_name} room`}
        </p>
        {needed > 1 && (
          <p className={`text-xs mb-3 ${selectedRoomIds.length === needed ? 'text-[#4A6D5C]' : 'text-[#B8792F]'}`}>
            {selectedRoomIds.length} of {needed} selected
          </p>
        )}

        {/* Guest ID — recorded at the desk. Online bookings arrive without one
            (no IDs on the public cloud form); walk-ins may already have it. */}
        <div className="border border-[#2B1610]/10 p-3 mb-4">
          <div className="flex items-center justify-between mb-2">
            <p className="text-xs font-medium text-[#2B1610]/60 uppercase tracking-wide">Guest ID</p>
            {idDocUrl ? (
              <span className="flex items-center gap-1 text-xs text-[#4A6D5C]">
                <CheckCircle2 className="w-3.5 h-3.5" /> On file
              </span>
            ) : (
              <span className="text-xs text-[#C77A34]">Not recorded</span>
            )}
          </div>
          {idDocUrl ? (
            <img
              src={`${apiBaseUrl}${idDocUrl}`}
              alt="Guest ID"
              className="mx-auto max-h-32 border border-[#2B1610]/10"
            />
          ) : (
            <>
              <p className="text-xs text-[#2B1610]/50 mb-2">
                Scan the QR with a phone to photograph the guest's government ID.
              </p>
              <QRUploadTrigger apiBaseUrl={apiBaseUrl} onUploaded={attachId} />
              {attachingId && <p className="text-xs text-[#2B1610]/40 mt-2">Saving ID…</p>}
              {idError && <p className="text-xs text-[#8C3B3B] mt-2">{idError}</p>}
            </>
          )}
        </div>

        {loading ? (
          <p className="text-sm text-[#2B1610]/40 mb-4">Loading available rooms…</p>
        ) : availableRooms.length === 0 ? (
          <p className="text-sm text-[#8C3B3B] mb-4">No {booking.room_type_name} rooms are currently ready.</p>
        ) : availableRooms.length < needed ? (
          <p className="text-sm text-[#8C3B3B] mb-4">
            Only {availableRooms.length} {booking.room_type_name} room(s) ready, but this booking needs {needed}.
            Free up rooms or reduce the booking first.
          </p>
        ) : (
          <div className="max-h-64 overflow-y-auto border border-[#2B1610]/15 divide-y divide-[#2B1610]/10 mb-4">
            {availableRooms.map((r) => {
              const checked = selectedRoomIds.includes(r.id);
              const capped = !checked && needed > 1 && selectedRoomIds.length >= needed;
              return (
                <label
                  key={r.id}
                  className={`flex items-center gap-3 px-3 py-2.5 text-sm cursor-pointer ${
                    checked ? 'bg-[#B8792F]/10' : capped ? 'opacity-40 cursor-not-allowed' : 'hover:bg-[#2B1610]/5'
                  }`}
                >
                  <input
                    type={needed === 1 ? 'radio' : 'checkbox'}
                    name="checkin-room"
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

        <button
          onClick={confirm}
          disabled={selectedRoomIds.length !== needed || confirming}
          className="w-full bg-[#2B1610] text-[#F8F4EC] py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-60"
        >
          {confirming ? 'Checking in…' : needed > 1 ? `Check in — ${needed} rooms` : 'Confirm check-in'}
        </button>
      </div>
    </div>
  );
}
