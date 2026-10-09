import React, { useState, useEffect, useCallback, useMemo } from 'react';
import { LogOut, ClipboardCheck, BarChart3, CalendarDays } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import SwamiDashboard from '../components/SwamiDashboard';
import HistoryReports from '../components/HistoryReports';
import EditBookingModal from '../components/EditBookingModal';
import { fetchArray, fetchObject } from '../lib/api';

export default function SwamiPortal() {
  const { user, logout, apiBaseUrl, token, socket } = useAuth();
  const [tab, setTab] = useState('queue');
  const [pendingBookings, setPendingBookings] = useState([]);
  const [approvedBookings, setApprovedBookings] = useState([]);
  const [futureBookings, setFutureBookings] = useState([]);
  const [calendarMonth, setCalendarMonth] = useState(() => {
    const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() };
  });
  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [templates, setTemplates] = useState({});
  // The full snake_case row of the approved booking being edited. Swami Ji's
  // cards hold camelCase copies (fine for display) but EditBookingModal needs
  // every stored field — billing tier, payments, dine flags, preferred times —
  // so we hand it the raw row instead of the camelCase one.
  const [editingBooking, setEditingBooking] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const loadAll = useCallback(async () => {
    const today = new Date().toISOString().slice(0, 10);
    const [pending, approved, future, rt, allRooms, settings] = await Promise.all([
      fetchArray(`${apiBaseUrl}/bookings/pending`, { headers: authHeaders }),
      fetchArray(`${apiBaseUrl}/bookings/approved`, { headers: authHeaders }),
      fetchArray(`${apiBaseUrl}/bookings/history?status=approved&from=${today}`, { headers: authHeaders }),
      fetchArray(`${apiBaseUrl}/inventory/room-types`),
      fetchArray(`${apiBaseUrl}/inventory/rooms`),
      fetchObject(`${apiBaseUrl}/settings`),
    ]);
    setPendingBookings(pending.map(toCamelBooking));
    setApprovedBookings(approved.map(toCamelBooking));
    setFutureBookings(future);
    setRoomTypes(rt);
    setRooms(allRooms);
    setTemplates(settings.whatsapp_templates ?? {});
  }, [apiBaseUrl, token]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    if (!socket) return;
    const refresh = () => loadAll();
    socket.on('booking:new', refresh);
    socket.on('booking:updated', refresh);
    return () => {
      socket.off('booking:new', refresh);
      socket.off('booking:updated', refresh);
    };
  }, [socket, loadAll]);

  const onDecideBooking = async (bookingId, decision) => {
    const resp = await fetch(`${apiBaseUrl}/bookings/${bookingId}/decide`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(decision),
    });
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      return { error: err.error || 'REQUEST_FAILED', message: err.message || '' };
    }
    loadAll();
    return null;
  };

  // The dashboard hands us the raw history row to edit (see _raw below).
  const onEditBooking = (rawRow) => {
    if (rawRow) setEditingBooking(rawRow);
  };

  const buildWhatsAppLink = (booking, billingTier) => {
    const statusKey = billingTier ? 'approved' : 'modified';
    const template = templates[statusKey] ?? '{{name}}, your booking status is now {{status}}.';
    const message = template
      .replace('{{name}}', booking.guestName)
      .replace('{{status}}', statusKey)
      .replace('{{room}}', booking.roomTypeName || 'your room');
    const phone = (booking.mobile || '').replace(/\D/g, '');
    return `https://wa.me/${phone}?text=${encodeURIComponent(message)}`;
  };

  return (
    <div className="min-h-screen bg-[#F8F4EC]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2B1610]/10">
        <div>
          <h1 className="font-serif text-xl text-[#2B1610]">Swami Ji</h1>
          <p className="text-xs text-[#2B1610]/40">Signed in as {user?.name}</p>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 text-sm text-[#2B1610]/50 hover:text-[#2B1610]">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </header>

      <div className="px-6 pt-5">
        <div className="flex gap-6 border-b border-[#2B1610]/15 mb-6">
          <TabButton active={tab === 'queue'} onClick={() => setTab('queue')} icon={ClipboardCheck}>
            Pending Bookings
          </TabButton>
          <TabButton active={tab === 'reports'} onClick={() => setTab('reports')} icon={BarChart3}>
            Income &amp; occupancy
          </TabButton>
          <TabButton active={tab === 'calendar'} onClick={() => setTab('calendar')} icon={CalendarDays}>
            Future bookings
          </TabButton>
        </div>

        <div className="pb-12">
          {tab === 'queue' && (
            <SwamiDashboard
              pendingBookings={pendingBookings}
              approvedBookings={approvedBookings}
              roomTypes={roomTypes}
              onDecideBooking={onDecideBooking}
              onEditBooking={onEditBooking}
              buildWhatsAppLink={buildWhatsAppLink}
            />
          )}
          {tab === 'reports' && <HistoryReports apiBaseUrl={apiBaseUrl} token={token} canModify canSetBilling />}
          {tab === 'calendar' && (
            <FutureCalendar
              bookings={futureBookings}
              roomTypes={roomTypes}
              rooms={rooms}
              calendarMonth={calendarMonth}
              onChangeMonth={setCalendarMonth}
            />
          )}
        </div>
      </div>

      {editingBooking && (
        <EditBookingModal
          booking={editingBooking}
          apiBaseUrl={apiBaseUrl}
          token={token}
          canModify
          canSetBilling
          onClose={() => setEditingBooking(null)}
          onSaved={() => { setEditingBooking(null); loadAll(); }}
        />
      )}
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

// Stable colours assigned to accommodation types in name order. The legend
// shows which colour is which, so the exact hues don't matter.
const ROOM_TYPE_COLORS = ['#4A6D5C', '#B8792F', '#8C3B3B', '#5B6E8C', '#6E5A7B', '#7B6E3F'];

// A booking occupies a room every night from check-in (inclusive) to check-out
// (exclusive) — the checkout day itself is free. 'YYYY-MM-DD' strings compare
// correctly as calendar dates, so no Date parsing is needed.
function occupiesDay(b, dateStr) {
  const ci = (b.checkin_date || '').slice(0, 10);
  const co = (b.checkout_date || '').slice(0, 10);
  if (!ci) return false;
  return co ? ci <= dateStr && dateStr < co : ci === dateStr;
}

function FutureCalendar({ bookings, roomTypes = [], rooms = [], calendarMonth, onChangeMonth }) {
  const { year, month } = calendarMonth;
  const [popover, setPopover] = useState(null);

  const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
  const todayStr = new Date().toISOString().slice(0, 10);

  const firstDay = new Date(year, month, 1);
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startDow = firstDay.getDay(); // 0=Sun

  // Accommodation types (not halls) that actually have rooms, each with a stable
  // colour and its total physical room count — the "out of how many".
  const typeInfo = useMemo(() => {
    const counts = {};
    rooms.forEach((r) => { counts[r.room_type_id] = (counts[r.room_type_id] || 0) + 1; });
    return roomTypes
      .filter((rt) => !rt.is_hall && (counts[rt.id] || 0) > 0)
      .sort((a, b) => (a.name || '').localeCompare(b.name || ''))
      .map((rt, i) => ({
        id: rt.id,
        name: rt.name,
        total: counts[rt.id] || 0,
        color: ROOM_TYPE_COLORS[i % ROOM_TYPE_COLORS.length],
      }));
  }, [roomTypes, rooms]);

  // For every day of the visible month: rooms booked by type (sum of num_rooms
  // over bookings whose stay covers that night) — the capacity-based occupancy.
  const occByDay = useMemo(() => {
    const res = {};
    for (let d = 1; d <= daysInMonth; d++) {
      const ds = `${year}-${String(month + 1).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
      const map = {};
      bookings.forEach((b) => {
        if (!occupiesDay(b, ds)) return;
        map[b.room_type_id] = (map[b.room_type_id] || 0) + (Number(b.num_rooms) || 1);
      });
      res[ds] = map;
    }
    return res;
  }, [bookings, year, month, daysInMonth]);

  // Guests arriving (checking in) each day — for the day popover's guest list.
  const arrivalsByDay = useMemo(() => {
    const m = {};
    bookings.forEach((b) => {
      const key = (b.checkin_date || '').slice(0, 10);
      if (!key) return;
      (m[key] = m[key] || []).push(b);
    });
    return m;
  }, [bookings]);

  const prev = () => {
    const d = new Date(year, month - 1, 1);
    onChangeMonth({ year: d.getFullYear(), month: d.getMonth() });
  };
  const next = () => {
    const d = new Date(year, month + 1, 1);
    onChangeMonth({ year: d.getFullYear(), month: d.getMonth() });
  };

  const cells = [];
  for (let i = 0; i < startDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="text-[#2B1610]/50 hover:text-[#2B1610] px-2 py-1 text-sm">‹ Prev</button>
        <h3 className="font-serif text-lg text-[#2B1610]">{MONTHS[month]} {year}</h3>
        <button onClick={next} className="text-[#2B1610]/50 hover:text-[#2B1610] px-2 py-1 text-sm">Next ›</button>
      </div>

      {/* Room-type legend: total rooms of each type — the "out of how many". */}
      {typeInfo.length > 0 && (
        <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5 mb-3 text-xs">
          <span className="text-[#2B1610]/40 uppercase tracking-wide text-[10px]">Rooms</span>
          {typeInfo.map((t) => (
            <span key={t.id} className="flex items-center gap-1.5">
              <span className="inline-block w-2.5 h-2.5 rounded-sm" style={{ background: t.color }} />
              <span className="text-[#2B1610]">{t.name}</span>
              <span className="text-[#2B1610]/50">{t.total}</span>
            </span>
          ))}
        </div>
      )}

      <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-[#2B1610]/40 mb-1">
        {['Su','Mo','Tu','We','Th','Fr','Sa'].map((d) => (
          <span key={d} className="py-1">{d}</span>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-px bg-[#2B1610]/10">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="bg-[#F8F4EC] min-h-[78px]" />;
          const dateStr = `${year}-${String(month + 1).padStart(2,'0')}-${String(day).padStart(2,'0')}`;
          const occ = occByDay[dateStr] || {};
          const occupiedTypes = typeInfo.filter((t) => (occ[t.id] || 0) > 0);
          const arrivals = arrivalsByDay[dateStr] ?? [];
          const isToday = dateStr === todayStr;
          const hasDetail = occupiedTypes.length > 0 || arrivals.length > 0;
          return (
            <div
              key={dateStr}
              onClick={() => setPopover(popover === dateStr ? null : dateStr)}
              className={`bg-[#F8F4EC] min-h-[78px] p-1 cursor-pointer hover:bg-[#2B1610]/5 relative ${
                isToday ? 'ring-2 ring-inset ring-[#B8792F]' : ''
              }`}
            >
              <span className={`text-xs ${isToday ? 'text-[#B8792F] font-semibold' : 'text-[#2B1610]/60'}`}>{day}</span>
              <div className="mt-1 space-y-0.5">
                {occupiedTypes.map((t) => {
                  const full = occ[t.id] >= t.total;
                  return (
                    <span
                      key={t.id}
                      className="flex items-center gap-1 text-[10px] leading-tight"
                      style={{ color: t.color }}
                      title={`${t.name}: ${occ[t.id]} of ${t.total} booked`}
                    >
                      <span className="inline-block w-1.5 h-1.5 rounded-full shrink-0" style={{ background: t.color }} />
                      <span className="truncate">{t.name} {occ[t.id]}/{t.total}{full ? ' · full' : ''}</span>
                    </span>
                  );
                })}
              </div>

              {popover === dateStr && hasDetail && (
                <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-[#2B1610]/15 shadow p-2.5 min-w-[190px] text-left">
                  <p className="text-[11px] font-medium text-[#2B1610] mb-1.5">{day} {MONTHS[month]} {year}</p>
                  {typeInfo.map((t) => {
                    const n = occ[t.id] || 0;
                    const full = n >= t.total;
                    return (
                      <p key={t.id} className="flex items-center justify-between gap-3 text-xs py-0.5">
                        <span className="flex items-center gap-1.5 text-[#2B1610]/80">
                          <span className="inline-block w-2 h-2 rounded-sm" style={{ background: t.color }} />
                          {t.name}
                        </span>
                        <span className={n === 0 ? 'text-[#2B1610]/40' : full ? 'text-[#8C3B3B] font-medium' : 'text-[#2B1610]'}>
                          {n} / {t.total}
                        </span>
                      </p>
                    );
                  })}
                  {arrivals.length > 0 && (
                    <>
                      <p className="text-[10px] uppercase tracking-wide text-[#2B1610]/40 mt-2 mb-1">
                        Arriving ({arrivals.length})
                      </p>
                      {arrivals.map((b, j) => (
                        <p key={j} className="text-xs text-[#2B1610] py-0.5">
                          {b.guest_name} <span className="text-[#2B1610]/40">· {b.room_type_name}</span>
                        </p>
                      ))}
                    </>
                  )}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {typeInfo.length === 0 && (
        <p className="text-xs text-[#2B1610]/40 mt-3">No accommodation rooms configured yet.</p>
      )}
    </div>
  );
}

function toCamelBooking(row) {
  return {
    id: row.id,
    channel: row.channel,
    guestName: row.guest_name,
    mobile: row.mobile,
    paxMen: row.pax_men,
    paxWomen: row.pax_women,
    paxChildren: row.pax_children,
    checkinDate: row.checkin_date,
    checkoutDate: row.checkout_date,
    santReferenceName: row.sant_reference_name,
    santReferenceMobile: row.sant_reference_mobile,
    roomTypeId: row.room_type_id,
    roomTypeName: row.room_type_name,
    approvedByName: row.approved_by_name,
    numRooms: row.num_rooms ?? 1,
    status: row.status,
    // Keep the full snake_case row so "Edit" can hand the modal every stored
    // field (the camelCase view above deliberately carries only what's shown).
    _raw: row,
  };
}
