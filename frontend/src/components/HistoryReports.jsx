import React, { useState, useEffect, useCallback } from 'react';
import { IndianRupee, BedDouble, TrendingUp, Search, Loader2, Download, Eye, EyeOff, CalendarDays, Printer, MessageCircle, RotateCcw, Pencil, Ban, Trash2 } from 'lucide-react';
import { fetchArray, fetchObject } from '../lib/api';
import { fmtDate } from '../lib/datetime';
import { printReceipt, openWhatsAppReceipt } from '../lib/receipt';
import OccupancyCalendar from './OccupancyCalendar';
import EditBookingModal from './EditBookingModal';

/**
 * HistoryReports
 *
 * Shared by AdminPortal and SwamiPortal — the booking-history table plus
 * occupancy/revenue/trend stats that neither role had any visibility into
 * before. Admin sees it as one of several tabs; Swami Ji sees it alongside
 * the approval queue.
 *
 * props.apiBaseUrl, props.token
 * props.canManageCheckout — when true (Reception, who holds can_checkin_checkout),
 *   each checked-out row gets an "Undo checkout" action that reopens the booking
 *   (POST /bookings/:id/reopen) for when the desk checked a guest out by mistake.
 *   The receipt actions are shown to every role — the receipt PDF sits behind the
 *   same can_view_reports permission as this whole tab.
 * props.canModify / canSetBilling / canMarkPayment — gate the per-row "Edit"
 *   action and, inside it, which sections of EditBookingModal are editable
 *   (details / the bill / recording a payment). Each maps to the matching backend
 *   permission, so the one modal serves every role: Admin and Reception get all
 *   three; Swami Ji edits details + the bill but cannot record payments.
 */
export default function HistoryReports({
  apiBaseUrl,
  token,
  canManageCheckout = false,
  canModify = false,
  canSetBilling = false,
  canMarkPayment = false,
  canCancel = false,
  canDelete = false,
}) {
  const [stats, setStats] = useState(null);
  const [history, setHistory] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '', status: '', channel: '', search: '' });
  const [incomeVisible, setIncomeVisible] = useState(false);
  const [calMonth, setCalMonth] = useState(() => { const d = new Date(); return { year: d.getFullYear(), month: d.getMonth() }; });
  const [occupancy, setOccupancy] = useState({ roomTypes: [], days: [] });
  const [confirmReopen, setConfirmReopen] = useState(null); // booking id awaiting an undo-checkout confirm
  const [reopeningId, setReopeningId] = useState(null);     // booking id whose reopen is in flight
  const [actionMsg, setActionMsg] = useState(null);         // { ok, text } banner shown above the history table
  const [editing, setEditing] = useState(null);             // the booking row currently open in the edit modal
  const [actionTarget, setActionTarget] = useState(null);   // { booking, mode: 'cancel' | 'delete' } for the reason modal
  const [reasonText, setReasonText] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [chargeText, setChargeText] = useState('');       // optional cancellation charge (note only)

  const canEdit = canModify || canSetBilling || canMarkPayment;

  const authHeaders = { Authorization: `Bearer ${token}` };

  const loadStats = useCallback(async (range) => {
    const params = new URLSearchParams();
    if (range?.from) params.set('from', range.from);
    if (range?.to) params.set('to', range.to);
    setStats(await fetchObject(`${apiBaseUrl}/reports/stats?${params}`, { headers: authHeaders }, null));
  }, [apiBaseUrl, token]);

  const loadHistory = useCallback(async (f) => {
    const params = new URLSearchParams();
    Object.entries(f).forEach(([k, v]) => { if (v) params.set(k, v); });
    setHistory(await fetchArray(`${apiBaseUrl}/bookings/history?${params}`, { headers: authHeaders }));
  }, [apiBaseUrl, token]);

  // Undo an accidental checkout: flip the booking back to checked_in and put the
  // guest back into room(s). A single-room booking reuses its primary room_id (we
  // send an empty body); a multi-room booking's junction rows were cleared at
  // checkout, so we grab that many currently-ready rooms of the same type and
  // reopen into those (the desk can reassign specific rooms afterwards if needed).
  const reopenBooking = useCallback(async (b) => {
    setReopeningId(b.id);
    setActionMsg(null);
    try {
      let roomIds = null;
      const needed = b.num_rooms || 1;
      if (needed > 1) {
        const avail = await fetchArray(
          `${apiBaseUrl}/rooms/available?roomTypeId=${b.room_type_id}`,
          { headers: authHeaders }
        );
        if (avail.length < needed) {
          setActionMsg({
            ok: false,
            text: `Undo needs ${needed} ready ${b.room_type_name} room(s), but only ${avail.length} are free right now — free some rooms and try again.`,
          });
          return;
        }
        roomIds = avail.slice(0, needed).map((r) => r.id);
      }
      const res = await fetch(`${apiBaseUrl}/bookings/${b.id}/reopen`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(roomIds ? { roomIds } : {}),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        const text =
          body.error === 'ROOM_NOT_READY'
            ? 'A room was taken since checkout — free it and try the undo again.'
            : body.error === 'NOT_CHECKED_OUT'
            ? 'That booking is not checked out, so there is nothing to undo.'
            : body.message || body.error || 'Could not undo the checkout.';
        setActionMsg({ ok: false, text });
      } else {
        setActionMsg({
          ok: true,
          text: `${b.guest_name} is back in their room — edit the bill and reprint the receipt from the Floor board or Current guests.`,
        });
        await loadHistory(filters); // refresh so the row flips to checked_in
      }
    } catch {
      setActionMsg({ ok: false, text: 'Network error — could not reach the server.' });
    } finally {
      setReopeningId(null);
      setConfirmReopen(null);
    }
  }, [apiBaseUrl, token, filters, loadHistory]);

  // Future-occupancy calendar — the whole month the user is viewing, so Admin and
  // Swami Ji can pull up next month's committed rooms (same endpoint Reception's
  // Calendar tab uses). Reloads whenever they page to another month.
  const loadOccupancy = useCallback(async ({ year, month }) => {
    const from = `${year}-${String(month + 1).padStart(2, '0')}-01`;
    const last = new Date(year, month + 1, 0).getDate();
    const to = `${year}-${String(month + 1).padStart(2, '0')}-${String(last).padStart(2, '0')}`;
    const occ = await fetchObject(
      `${apiBaseUrl}/bookings/calendar?from=${from}&to=${to}`,
      { headers: authHeaders },
      { roomTypes: [], days: [] }
    );
    setOccupancy(occ && Array.isArray(occ.days) ? occ : { roomTypes: [], days: [] });
  }, [apiBaseUrl, token]);

  useEffect(() => { loadOccupancy(calMonth); }, [calMonth, loadOccupancy]);

  useEffect(() => {
    setLoading(true);
    Promise.all([loadStats(), loadHistory(filters)]).finally(() => setLoading(false));
    /* eslint-disable-next-line */
  }, []);

  const applyFilters = () => {
    loadStats(filters.from && filters.to ? filters : null);
    loadHistory(filters);
  };

  // Cancel (soft, keeps history) or Delete (permanent) a booking — Admin only.
  // Both require a short reason that the backend records in the audit log.
  const runAction = async () => {
    if (!actionTarget) return;
    const { booking, mode } = actionTarget;
    const reason = reasonText.trim();
    if (!reason) return;
    setActionBusy(true);
    try {
      const url = mode === 'cancel'
        ? `${apiBaseUrl}/bookings/${booking.id}/cancel`
        : `${apiBaseUrl}/bookings/${booking.id}`;
      const res = await fetch(url, {
        method: mode === 'cancel' ? 'POST' : 'DELETE',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify(mode === 'cancel' ? { reason, cancellationCharge: chargeText } : { reason }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setActionMsg({ ok: false, text: body.message || body.error || `Could not ${mode} the booking.` });
      } else {
        setActionMsg({
          ok: true,
          text: mode === 'cancel'
            ? `${booking.guest_name}'s booking was cancelled.`
            : `${booking.guest_name}'s booking was permanently deleted.`,
        });
        await loadHistory(filters);
        await loadStats(filters.from && filters.to ? filters : null);
      }
    } catch {
      setActionMsg({ ok: false, text: 'Network error — could not reach the server.' });
    } finally {
      setActionBusy(false);
      setActionTarget(null);
      setReasonText('');
      setChargeText('');
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#2B1610]/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const maxTrend = Math.max(1, ...(stats?.monthlyTrend?.map((m) => m.bookings) ?? [1]));

  return (
    <div className="space-y-8">
      {/* Revenue cards */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-3 flex items-center gap-2">
          <IndianRupee className="w-4 h-4 text-[#B8792F]" /> Income
          <button
            type="button"
            onClick={() => setIncomeVisible((v) => !v)}
            className="ml-auto text-[#2B1610]/40 hover:text-[#2B1610] transition-colors"
            title={incomeVisible ? 'Hide income figures' : 'Show income figures'}
          >
            {incomeVisible ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
          </button>
        </h3>
        <div className="relative">
          <div className={`grid grid-cols-2 sm:grid-cols-4 gap-3${incomeVisible ? '' : ' blur-sm pointer-events-none select-none'}`}>
            <RevenueCard label="Today" data={stats?.revenue?.today} />
            <RevenueCard label="Last 7 days" data={stats?.revenue?.last7Days} />
            <RevenueCard label="Last 30 days" data={stats?.revenue?.last30Days} />
            <RevenueCard label="Custom range" data={stats?.revenue?.custom} empty="Pick dates below" />
          </div>
          {!incomeVisible && (
            <div className="absolute inset-0 flex items-center justify-center">
              <button
                type="button"
                onClick={() => setIncomeVisible(true)}
                className="flex items-center gap-2 bg-white/80 border border-[#2B1610]/15 px-4 py-2 text-sm text-[#2B1610]/60 hover:text-[#2B1610] hover:border-[#2B1610]/30 transition-colors"
              >
                <Eye className="w-4 h-4" /> Tap to reveal
              </button>
            </div>
          )}
        </div>
        <div className="flex flex-wrap items-end gap-2 mt-3">
          <div>
            <label className="text-xs text-[#2B1610]/50 block mb-1">From</label>
            <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm" />
          </div>
          <div>
            <label className="text-xs text-[#2B1610]/50 block mb-1">To</label>
            <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm" />
          </div>
          <button onClick={applyFilters} className="bg-[#2B1610] text-[#F8F4EC] px-4 py-1.5 text-sm">
            Calculate
          </button>
        </div>
      </div>

      {/* Occupancy */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-3 flex items-center gap-2">
          <BedDouble className="w-4 h-4 text-[#B8792F]" /> Occupancy right now
        </h3>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
          {stats?.occupancy?.map((o) => (
            <div key={o.room_type} className="border border-[#2B1610]/10 bg-white/40 p-4">
              <p className="font-serif text-[#2B1610] mb-2">{o.room_type}</p>
              <div className="flex items-baseline gap-1 mb-2">
                <span className="text-2xl font-serif text-[#2B1610]">{o.occupied}</span>
                <span className="text-sm text-[#2B1610]/40">/ {o.total} occupied</span>
              </div>
              <div className="flex gap-3 text-xs text-[#2B1610]/50">
                <span>{o.ready} ready</span>
                <span>{o.maintenance} maint.</span>
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Upcoming occupancy — future months, per-day "X of N" per room type */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-3 flex items-center gap-2">
          <CalendarDays className="w-4 h-4 text-[#B8792F]" /> Upcoming occupancy
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          Rooms committed per day for each type — page ahead to see next month's load.
        </p>
        <OccupancyCalendar occupancy={occupancy} calendarMonth={calMonth} onChangeMonth={setCalMonth} />
      </div>

      {/* Monthly trend */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-3 flex items-center gap-2">
          <TrendingUp className="w-4 h-4 text-[#B8792F]" /> Bookings by month (last 12 months)
        </h3>
        <div className="flex items-end gap-2 h-32 border-b border-[#2B1610]/10 pb-1">
          {stats?.monthlyTrend?.map((m) => (
            <div key={m.month} className="flex-1 flex flex-col items-center justify-end gap-1">
              <span className="text-xs text-[#2B1610]/50">{m.bookings}</span>
              <div
                className="w-full bg-[#B8792F]/70"
                style={{ height: `${(m.bookings / maxTrend) * 100}%`, minHeight: m.bookings > 0 ? '4px' : 0 }}
              />
              <span className="text-[10px] text-[#2B1610]/40">{m.month.slice(5)}</span>
            </div>
          ))}
          {!stats?.monthlyTrend?.length && <p className="text-sm text-[#2B1610]/40">No data yet.</p>}
        </div>
      </div>

      {/* History table */}
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-3">Booking history</h3>
        <div className="flex flex-wrap items-center gap-2 mb-3">
          <div className="relative">
            <Search className="w-3.5 h-3.5 text-[#2B1610]/40 absolute left-2.5 top-1/2 -translate-y-1/2" />
            <input
              placeholder="Search guest or mobile"
              value={filters.search}
              onChange={(e) => setFilters({ ...filters, search: e.target.value })}
              onKeyDown={(e) => e.key === 'Enter' && applyFilters()}
              className="border border-[#2B1610]/20 bg-white pl-8 pr-3 py-1.5 text-sm w-56"
            />
          </div>
          <select value={filters.status} onChange={(e) => setFilters({ ...filters, status: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm">
            <option value="">All statuses</option>
            {['pending', 'approved', 'rejected', 'modified', 'checked_in', 'checked_out', 'expired', 'cancelled'].map((s) => (
              <option key={s} value={s}>{s}</option>
            ))}
          </select>
          <select value={filters.channel} onChange={(e) => setFilters({ ...filters, channel: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm">
            <option value="">Online + walk-in</option>
            <option value="online">Online</option>
            <option value="walkin">Walk-in</option>
          </select>
          <button onClick={applyFilters} className="bg-[#2B1610] text-[#F8F4EC] px-4 py-1.5 text-sm">
            Filter
          </button>
          <button
            onClick={() => {
              const params = new URLSearchParams();
              Object.entries(filters).forEach(([k, v]) => { if (v) params.set(k, v); });
              fetch(`${apiBaseUrl}/reports/export?${params}`, { headers: authHeaders })
                .then((r) => r.blob())
                .then((blob) => {
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement('a');
                  a.href = url; a.download = 'bookings-export.csv'; a.click();
                  URL.revokeObjectURL(url);
                })
                .catch(() => {});
            }}
            className="flex items-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610]/70 px-3 py-1.5 text-sm hover:border-[#2B1610]/40"
          >
            <Download className="w-3.5 h-3.5" /> Export CSV
          </button>
        </div>

        {actionMsg && (
          <div className={`mb-4 border p-3 flex items-start justify-between gap-3 ${
            actionMsg.ok ? 'border-[#4A6D5C]/30 bg-[#4A6D5C]/5' : 'border-[#C77A34]/40 bg-[#C77A34]/5'
          }`}>
            <p className={`text-sm ${actionMsg.ok ? 'text-[#4A6D5C]' : 'text-[#8C3B3B]'}`}>{actionMsg.text}</p>
            <button
              onClick={() => setActionMsg(null)}
              className="text-xs text-[#2B1610]/40 hover:text-[#2B1610]/70 shrink-0"
            >
              Dismiss
            </button>
          </div>
        )}

        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[#2B1610]/40 border-b border-[#2B1610]/10">
              <th className="py-2 font-normal">Guest</th>
              <th className="py-2 font-normal">Room</th>
              <th className="py-2 font-normal">Dates</th>
              <th className="py-2 font-normal">Status</th>
              <th className="py-2 font-normal">Channel</th>
              <th className="py-2 font-normal">Amount</th>
              <th className="py-2 font-normal">Payment</th>
              <th className="py-2 font-normal text-right">Receipt / actions</th>
            </tr>
          </thead>
          <tbody>
            {history.map((b) => (
              <tr key={b.id} className="border-b border-[#2B1610]/5">
                <td className="py-2.5">
                  <p className="text-[#2B1610]">{b.guest_name}</p>
                  <p className="text-xs text-[#2B1610]/40">{b.mobile}</p>
                </td>
                <td className="py-2.5 text-[#2B1610]/70">
                  {b.room_type_name}{b.room_number ? ` · ${b.room_number}` : ''}{b.num_rooms > 1 ? ` × ${b.num_rooms}` : ''}
                </td>
                <td className="py-2.5 text-[#2B1610]/70 text-xs">
                  {fmtDate(b.checkin_date)} → {fmtDate(b.checkout_date)}
                </td>
                <td className="py-2.5">
                  <span className="text-xs uppercase tracking-wide text-[#B8792F]">{b.status}</span>
                </td>
                <td className="py-2.5 text-[#2B1610]/60 text-xs">{b.channel}</td>
                <td className="py-2.5 text-[#2B1610]/70">
                  {b.final_amount != null ? `₹${Number(b.final_amount).toLocaleString('en-IN')}` : '—'}
                </td>
                <td className="py-2.5">
                  {(() => {
                    const ps = b.payment_status || (b.is_paid ? 'paid' : 'unpaid');
                    const color = ps === 'paid' ? 'text-[#4A6D5C]' : ps === 'partial' ? 'text-[#B8792F]' : 'text-[#8C3B3B]';
                    return <span className={`text-xs uppercase tracking-wide ${color}`}>{ps}</span>;
                  })()}
                </td>
                <td className="py-2.5">
                  <div className="flex items-center justify-end gap-1.5 flex-wrap">
                    {canEdit && (
                      <button
                        onClick={() => { setActionMsg(null); setEditing(b); }}
                        title="Edit this booking — details and the bill"
                        className="inline-flex items-center gap-1.5 border border-[#2B1610]/20 px-2.5 py-1.5 text-xs text-[#2B1610]/80 hover:border-[#2B1610]/40"
                      >
                        <Pencil className="w-3.5 h-3.5" /> Edit
                      </button>
                    )}
                    {['checked_in', 'checked_out'].includes(b.status) && (
                      <>
                        <button
                          onClick={() => printReceipt(b, { apiBaseUrl, token })}
                          title="Open the bill PDF to print or save"
                          className="inline-flex items-center gap-1.5 border border-[#2B1610]/20 px-2.5 py-1.5 text-xs text-[#2B1610]/80 hover:border-[#2B1610]/40"
                        >
                          <Printer className="w-3.5 h-3.5" /> Receipt
                        </button>
                        {b.mobile && (
                          <button
                            onClick={() => openWhatsAppReceipt(b)}
                            title="Send the receipt summary on WhatsApp"
                            className="inline-flex items-center gap-1.5 border border-[#4A6D5C]/40 text-[#4A6D5C] px-2.5 py-1.5 text-xs hover:bg-[#4A6D5C]/10"
                          >
                            <MessageCircle className="w-3.5 h-3.5" /> WhatsApp
                          </button>
                        )}
                      </>
                    )}
                    {canManageCheckout && b.status === 'checked_out' && (
                      confirmReopen === b.id ? (
                        <span className="inline-flex items-center gap-1.5">
                          <span className="text-xs text-[#8C3B3B]">Undo checkout?</span>
                          <button
                            onClick={() => reopenBooking(b)}
                            disabled={reopeningId === b.id}
                            className="inline-flex items-center gap-1.5 bg-[#8C3B3B] text-white px-2.5 py-1.5 text-xs hover:opacity-90 disabled:opacity-60"
                          >
                            {reopeningId === b.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : null}
                            Yes
                          </button>
                          <button
                            onClick={() => setConfirmReopen(null)}
                            disabled={reopeningId === b.id}
                            className="border border-[#2B1610]/20 px-2.5 py-1.5 text-xs text-[#2B1610]/70 hover:border-[#2B1610]/40 disabled:opacity-60"
                          >
                            No
                          </button>
                        </span>
                      ) : (
                        <button
                          onClick={() => { setActionMsg(null); setConfirmReopen(b.id); }}
                          title="Undo an accidental checkout — puts the guest back in their room so you can edit the bill and reprint the receipt"
                          className="inline-flex items-center gap-1.5 border border-[#2B1610]/20 px-2.5 py-1.5 text-xs text-[#2B1610]/80 hover:border-[#2B1610]/40"
                        >
                          <RotateCcw className="w-3.5 h-3.5" /> Undo checkout
                        </button>
                      )
                    )}
                    {canCancel && !['cancelled', 'checked_out'].includes(b.status) && (
                      <button
                        onClick={() => { setActionMsg(null); setReasonText(''); setChargeText(''); setActionTarget({ booking: b, mode: 'cancel' }); }}
                        title="Cancel this booking — frees the room, keeps it in history as cancelled"
                        className="inline-flex items-center gap-1.5 border border-[#C77A34]/50 text-[#C77A34] px-2.5 py-1.5 text-xs hover:bg-[#C77A34]/10"
                      >
                        <Ban className="w-3.5 h-3.5" /> Cancel
                      </button>
                    )}
                    {canDelete && (
                      <button
                        onClick={() => { setActionMsg(null); setReasonText(''); setChargeText(''); setActionTarget({ booking: b, mode: 'delete' }); }}
                        title="Permanently delete this booking (cannot be undone)"
                        className="inline-flex items-center gap-1.5 border border-[#8C3B3B]/50 text-[#8C3B3B] px-2.5 py-1.5 text-xs hover:bg-[#8C3B3B]/10"
                      >
                        <Trash2 className="w-3.5 h-3.5" /> Delete
                      </button>
                    )}
                    {!canEdit && !canCancel && !canDelete && !['checked_in', 'checked_out'].includes(b.status) && (
                      <span className="text-xs text-[#2B1610]/30">—</span>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!history.length && (
              <tr><td colSpan={8} className="py-6 text-center text-[#2B1610]/40">No bookings match these filters.</td></tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <EditBookingModal
          booking={editing}
          apiBaseUrl={apiBaseUrl}
          token={token}
          canModify={canModify}
          canSetBilling={canSetBilling}
          canMarkPayment={canMarkPayment}
          onClose={() => { setEditing(null); loadHistory(filters); }}
          onSaved={(updated) => {
            setEditing(null);
            setActionMsg({ ok: true, text: `Saved changes to ${updated?.guest_name || 'the booking'}.` });
            loadStats(filters.from && filters.to ? filters : null);
            loadHistory(filters);
          }}
        />
      )}

      {/* Cancel / Delete reason modal (Admin) */}
      {actionTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-[#F8F4EC] border border-[#2B1610]/15 max-w-md w-full p-6">
            <h4 className="font-serif text-lg text-[#2B1610] mb-1">
              {actionTarget.mode === 'cancel' ? 'Cancel booking' : 'Delete booking'}
            </h4>
            <p className="text-sm text-[#2B1610]/70 mb-1">
              {actionTarget.mode === 'cancel' ? (
                <>Mark <strong>{actionTarget.booking.guest_name}</strong>'s booking as cancelled and free its room. It stays in history, labelled cancelled.</>
              ) : (
                <>Permanently delete <strong>{actionTarget.booking.guest_name}</strong>'s booking and its payment records. This cannot be undone.</>
              )}
            </p>
            <p className="text-xs text-[#2B1610]/50 mb-3">A short reason is required and saved to the audit log.</p>
            <textarea
              autoFocus
              rows={2}
              value={reasonText}
              onChange={(e) => setReasonText(e.target.value)}
              placeholder="Reason (e.g. guest cancelled, duplicate entry)"
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
            />
            {actionTarget.mode === 'cancel' && (
              <div className="mt-3">
                <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">
                  Cancellation charge ₹ (optional)
                </label>
                <input
                  type="number"
                  min="0"
                  value={chargeText}
                  onChange={(e) => setChargeText(e.target.value)}
                  placeholder="e.g. 500 — leave blank for no charge"
                  className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm w-full"
                />
                <p className="text-[11px] text-[#2B1610]/40 mt-1">Recorded as a note in the audit log (not added to billing).</p>
              </div>
            )}
            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                onClick={() => { setActionTarget(null); setReasonText(''); setChargeText(''); }}
                disabled={actionBusy}
                className="px-4 py-2 text-sm text-[#2B1610]/60 hover:text-[#2B1610] disabled:opacity-50"
              >
                Back
              </button>
              <button
                onClick={runAction}
                disabled={actionBusy || !reasonText.trim()}
                className={`flex items-center gap-2 px-5 py-2.5 text-sm text-white disabled:opacity-60 hover:opacity-90 ${
                  actionTarget.mode === 'cancel' ? 'bg-[#C77A34]' : 'bg-[#8C3B3B]'
                }`}
              >
                {actionBusy && <Loader2 className="w-4 h-4 animate-spin" />}
                {actionTarget.mode === 'cancel' ? 'Cancel booking' : 'Delete permanently'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function RevenueCard({ label, data, empty }) {
  return (
    <div className="border border-[#2B1610]/10 bg-white/40 p-4">
      <p className="text-xs uppercase tracking-wide text-[#2B1610]/40 mb-1">{label}</p>
      {data ? (
        <>
          <p className="text-xl font-serif text-[#2B1610]">₹{Number(data.revenue).toLocaleString('en-IN')}</p>
          <p className="text-xs text-[#2B1610]/40">{data.bookings} bookings</p>
        </>
      ) : (
        <p className="text-xs text-[#2B1610]/30">{empty || '—'}</p>
      )}
    </div>
  );
}
