import React, { useMemo, useState } from 'react';

/**
 * OccupancyCalendar
 *
 * A month grid showing, per day, how many rooms of each type are taken out of
 * the total ("X of N") — so Reception AND Admin/Swami can read future capacity
 * at a glance. Shared by ReceptionPortal (Calendar tab) and HistoryReports
 * (Admin/Swami "Upcoming occupancy"); this is the single source so the two
 * views can never drift apart.
 *
 * Props:
 *   occupancy    { roomTypes:[{id,name,total}], days:[{date:'YYYY-MM-DD',
 *                  byType:[{roomTypeId, occupied, total}]}] } — from
 *                  GET /bookings/calendar. Powers the per-day "X of N" badge and
 *                  the per-room-type breakdown in the popover.
 *   bookings     optional [] of approved/checked-in bookings (snake_case:
 *                  checkin_date, checkout_date, guest_name, room_type_name).
 *                  When present (Reception), adds "N in" / "N out" badges and a
 *                  per-guest arrivals/departures list in the popover. Omit it for
 *                  the occupancy-only Admin/Swami view.
 *   calendarMonth { year, month }  (month is 0-based)
 *   onChangeMonth (m) => void
 */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

export default function OccupancyCalendar({
  bookings = [],
  occupancy = { roomTypes: [], days: [] },
  calendarMonth,
  onChangeMonth,
}) {
  const { year, month } = calendarMonth;
  const hasBookings = Array.isArray(bookings) && bookings.length > 0;

  const dayMap = useMemo(() => {
    const m = {};
    (bookings || []).forEach((b) => {
      const arrival = b.checkin_date?.slice(0, 10);
      const departure = b.checkout_date?.slice(0, 10);
      if (arrival) { if (!m[arrival]) m[arrival] = { arrivals: [], departures: [] }; m[arrival].arrivals.push(b); }
      if (departure) { if (!m[departure]) m[departure] = { arrivals: [], departures: [] }; m[departure].departures.push(b); }
    });
    return m;
  }, [bookings]);

  // Per-day occupancy from GET /bookings/calendar: date -> { occupied, total,
  // byType:[{name, occupied, total}] }.
  const typeNameById = useMemo(() => {
    const n = {};
    (occupancy.roomTypes || []).forEach((t) => { n[t.id] = t.name; });
    return n;
  }, [occupancy]);

  const occByDate = useMemo(() => {
    const m = {};
    (occupancy.days || []).forEach((d) => {
      const byType = (d.byType || []).map((bt) => ({
        name: typeNameById[bt.roomTypeId] || '—',
        occupied: Number(bt.occupied) || 0,
        total: Number(bt.total) || 0,
      }));
      const occupied = byType.reduce((s, t) => s + t.occupied, 0);
      const total = byType.reduce((s, t) => s + t.total, 0);
      m[d.date] = { occupied, total, byType };
    });
    return m;
  }, [occupancy, typeNameById]);

  const todayStr = new Date().toISOString().slice(0, 10);
  const firstDow = new Date(year, month, 1).getDay();
  const daysInMonth = new Date(year, month + 1, 0).getDate();

  const prev = () => { const d = new Date(year, month - 1, 1); onChangeMonth({ year: d.getFullYear(), month: d.getMonth() }); };
  const next = () => { const d = new Date(year, month + 1, 1); onChangeMonth({ year: d.getFullYear(), month: d.getMonth() }); };

  const cells = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= daysInMonth; d++) cells.push(d);

  const [popover, setPopover] = useState(null);

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <button onClick={prev} className="text-[#2B1610]/50 hover:text-[#2B1610] px-2 py-1 text-sm">‹ Prev</button>
        <h3 className="font-serif text-lg text-[#2B1610]">{MONTHS[month]} {year}</h3>
        <button onClick={next} className="text-[#2B1610]/50 hover:text-[#2B1610] px-2 py-1 text-sm">Next ›</button>
      </div>

      <div className="flex items-center gap-4 text-xs mb-3 flex-wrap">
        {hasBookings && (
          <>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#4A6D5C] inline-block"></span> Arrivals</span>
            <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#C77A34] inline-block"></span> Departures</span>
          </>
        )}
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-[#2B1610]/30 inline-block"></span> Rooms taken (of total)</span>
      </div>

      <div className="grid grid-cols-7 text-center text-[10px] uppercase tracking-wide text-[#2B1610]/40 mb-1">
        {['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'].map((d) => <span key={d} className="py-1">{d}</span>)}
      </div>

      <div className="grid grid-cols-7 gap-px bg-[#2B1610]/10">
        {cells.map((day, i) => {
          if (!day) return <div key={`e${i}`} className="bg-[#F8F4EC] h-24" />;
          const dateStr = `${year}-${String(month + 1).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
          const cell = dayMap[dateStr];
          const occ = occByDate[dateStr];
          const isToday = dateStr === todayStr;
          const full = occ && occ.total > 0 && occ.occupied >= occ.total;
          return (
            <div
              key={dateStr}
              onClick={() => setPopover(popover === dateStr ? null : dateStr)}
              className={`bg-[#F8F4EC] h-24 p-1 cursor-pointer hover:bg-[#2B1610]/5 relative overflow-hidden ${
                isToday ? 'ring-2 ring-inset ring-[#B8792F]' : ''
              }`}
            >
              <span className={`text-xs ${isToday ? 'text-[#B8792F] font-semibold' : 'text-[#2B1610]/60'}`}>{day}</span>
              {occ && occ.total > 0 && (
                <span className={`block mt-0.5 text-[10px] px-1 py-0.5 text-center ${
                  full ? 'bg-[#8C3B3B] text-white' : 'bg-[#2B1610]/10 text-[#2B1610]/70'
                }`}>
                  {occ.occupied}/{occ.total}
                </span>
              )}
              {cell?.arrivals.length > 0 && (
                <span className="block mt-0.5 text-[10px] bg-[#4A6D5C] text-white px-1 py-0.5 text-center">
                  {cell.arrivals.length} in
                </span>
              )}
              {cell?.departures.length > 0 && (
                <span className="block mt-0.5 text-[10px] bg-[#C77A34] text-white px-1 py-0.5 text-center">
                  {cell.departures.length} out
                </span>
              )}
              {popover === dateStr && (cell || occ) && (
                <div className="absolute z-20 top-full left-0 mt-1 bg-white border border-[#2B1610]/15 shadow p-2 min-w-[210px]">
                  {occ && occ.byType.length > 0 && (
                    <div className="mb-1.5 pb-1.5 border-b border-[#2B1610]/10">
                      <p className="text-[10px] uppercase tracking-wide text-[#2B1610]/40 mb-0.5">Rooms taken</p>
                      {occ.byType.map((t, k) => (
                        <p key={`o${k}`} className="text-xs text-[#2B1610]/70 py-0.5 flex justify-between gap-3">
                          <span>{t.name}</span>
                          <span className={t.total > 0 && t.occupied >= t.total ? 'text-[#8C3B3B] font-semibold' : ''}>
                            {t.occupied} of {t.total}
                          </span>
                        </p>
                      ))}
                    </div>
                  )}
                  {cell?.arrivals.map((b, j) => (
                    <p key={`a${j}`} className="text-xs text-[#4A6D5C] py-0.5">↑ {b.guest_name} <span className="text-[#2B1610]/40">· {b.room_type_name}</span></p>
                  ))}
                  {cell?.departures.map((b, j) => (
                    <p key={`d${j}`} className="text-xs text-[#C77A34] py-0.5">↓ {b.guest_name} <span className="text-[#2B1610]/40">· {b.room_type_name}</span></p>
                  ))}
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
