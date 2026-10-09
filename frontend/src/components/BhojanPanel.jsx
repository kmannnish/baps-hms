import React, { useState, useEffect, useCallback } from 'react';
import { Coffee, Utensils, Moon, Send, MessageCircle, RefreshCw, Check } from 'lucide-react';
import { fetchObject } from '../lib/api';
import { fmtDate, fmtTime } from '../lib/datetime';

/**
 * BhojanPanel — the Bhojanshala (dining hall) head-count for TODAY.
 *
 * Reads GET /bhojan/today (per-meal Male/Female/Kids totals + a guest-wise list)
 * and lets Reception flip each guest's per-meal opt-in inline (PATCH
 * /bookings/:id/dining). The "current" meal is highlighted by time of day
 * (Breakfast → Lunch after the lunch time → Dinner after the dinner time), with
 * the thresholds coming from the admin-set timings in the same payload.
 *
 * "Send to Bhojanshala" posts to /bhojan/send. The server never throws for the
 * ordinary not-configured/failed cases — it returns { sent:false, message,
 * whatsappUrl } — so when email isn't set up we fall back to a wa.me button to a
 * fixed kitchen number. Live: re-pulls on the bhojan:changed socket event so a
 * new arrival (or a toggle on another device) updates the count immediately.
 */

const MEALS = [
  { key: 'breakfast', label: 'Breakfast', icon: Coffee },
  { key: 'lunch', label: 'Lunch', icon: Utensils },
  { key: 'dinner', label: 'Dinner', icon: Moon },
];

const EMPTY_MEAL = { men: 0, women: 0, children: 0, total: 0, parties: 0 };
const EMPTY = { date: '', timings: {}, currentMeal: 'breakfast', meals: {}, guests: [] };

export default function BhojanPanel({ apiBaseUrl, token, socket }) {
  const [data, setData] = useState(EMPTY);
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [sendMsg, setSendMsg] = useState(null); // { ok, text, whatsappUrl }
  const [savingId, setSavingId] = useState(null);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const load = useCallback(async () => {
    const d = await fetchObject(
      `${apiBaseUrl}/bhojan/today`,
      { headers: { Authorization: `Bearer ${token}` } },
      EMPTY
    );
    setData(d && Array.isArray(d.guests) ? d : EMPTY);
    setLoading(false);
  }, [apiBaseUrl, token]);

  useEffect(() => { load(); }, [load]);

  // Live refresh: a dining opt-in flip (here or on another device) emits
  // bhojan:changed; arrivals/checkouts emit booking:* / room:status_changed.
  useEffect(() => {
    if (!socket) return;
    const refresh = () => load();
    socket.on('bhojan:changed', refresh);
    socket.on('booking:updated', refresh);
    socket.on('booking:new', refresh);
    socket.on('room:status_changed', refresh);
    return () => {
      socket.off('bhojan:changed', refresh);
      socket.off('booking:updated', refresh);
      socket.off('booking:new', refresh);
      socket.off('room:status_changed', refresh);
    };
  }, [socket, load]);

  // Flip one guest's opt-in for one meal. Optimistic, then reconcile from the
  // server (the PATCH also emits bhojan:changed, which refetches anyway).
  const toggleMeal = async (guest, mealKey) => {
    const nextVal = !guest[mealKey];
    setSavingId(guest.id);
    setData((prev) => ({
      ...prev,
      guests: prev.guests.map((g) => (g.id === guest.id ? { ...g, [mealKey]: nextVal } : g)),
      meals: recomputeMeals(
        prev.guests.map((g) => (g.id === guest.id ? { ...g, [mealKey]: nextVal } : g))
      ),
    }));
    try {
      await fetch(`${apiBaseUrl}/bookings/${guest.id}/dining`, {
        method: 'PATCH',
        headers: authHeaders,
        body: JSON.stringify({ [mealKey]: nextVal }),
      });
    } finally {
      await load(); // authoritative totals back from the server
      setSavingId(null);
    }
  };

  const sendToKitchen = async () => {
    setSending(true);
    setSendMsg(null);
    try {
      const res = await fetch(`${apiBaseUrl}/bhojan/send`, { method: 'POST', headers: authHeaders });
      const body = await res.json().catch(() => ({}));
      if (body.sent) {
        setSendMsg({ ok: true, text: `Sent to ${body.to || 'Bhojanshala'}.` });
      } else {
        setSendMsg({
          ok: false,
          text: body.message || 'Email could not be sent.',
          whatsappUrl: body.whatsappUrl || null,
        });
      }
    } catch {
      setSendMsg({ ok: false, text: 'Network error — could not reach the server.', whatsappUrl: null });
    } finally {
      setSending(false);
    }
  };

  const guests = Array.isArray(data.guests) ? data.guests : [];
  const current = data.currentMeal || 'breakfast';

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-5 flex-wrap">
        <div className="flex items-center gap-2">
          <Utensils className="w-4 h-4 text-[#B8792F]" strokeWidth={1.75} />
          <h3 className="font-serif text-lg text-[#2B1610]">Bhojanshala</h3>
          <span className="text-sm text-[#2B1610]/40">· {fmtDate(data.date)}</span>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={load}
            className="flex items-center gap-1.5 border border-[#2B1610]/20 text-[#2B1610]/70 px-3 py-2 text-sm hover:border-[#2B1610]/40"
          >
            <RefreshCw className="w-3.5 h-3.5" /> Refresh
          </button>
          <button
            onClick={sendToKitchen}
            disabled={sending}
            className="flex items-center gap-1.5 bg-[#2B1610] text-[#F8F4EC] px-4 py-2 text-sm hover:bg-[#3d2118] disabled:opacity-60"
          >
            <Send className="w-3.5 h-3.5" /> {sending ? 'Sending…' : 'Send to Bhojanshala'}
          </button>
        </div>
      </div>

      {sendMsg && (
        <div className={`mb-5 border p-3 flex items-center justify-between gap-3 flex-wrap ${
          sendMsg.ok ? 'border-[#4A6D5C]/30 bg-[#4A6D5C]/5' : 'border-[#C77A34]/30 bg-[#C77A34]/5'
        }`}>
          <p className={`text-sm ${sendMsg.ok ? 'text-[#4A6D5C]' : 'text-[#8C3B3B]'}`}>{sendMsg.text}</p>
          {!sendMsg.ok && sendMsg.whatsappUrl && (
            <a
              href={sendMsg.whatsappUrl}
              target="_blank"
              rel="noreferrer"
              className="flex items-center gap-1.5 border border-[#4A6D5C]/40 text-[#4A6D5C] px-3 py-2 text-sm hover:bg-[#4A6D5C]/10"
            >
              <MessageCircle className="w-3.5 h-3.5" /> Send on WhatsApp instead
            </a>
          )}
        </div>
      )}

      {/* Per-meal summary cards — the current meal is highlighted */}
      <div className="grid sm:grid-cols-3 gap-4 mb-7">
        {MEALS.map(({ key, label, icon: Icon }) => {
          const m = data.meals?.[key] || EMPTY_MEAL;
          const isCurrent = key === current;
          const time = fmtTime(data.timings?.[key]);
          return (
            <div
              key={key}
              className={`border p-4 ${isCurrent ? 'border-[#B8792F] bg-[#B8792F]/5' : 'border-[#2B1610]/10 bg-white/40'}`}
            >
              <div className="flex items-center justify-between mb-2">
                <div className="flex items-center gap-2">
                  <Icon className={`w-4 h-4 ${isCurrent ? 'text-[#B8792F]' : 'text-[#2B1610]/40'}`} strokeWidth={1.75} />
                  <span className="text-sm text-[#2B1610]">{label}</span>
                  {isCurrent && (
                    <span className="text-[9px] uppercase tracking-wide bg-[#B8792F] text-[#F8F4EC] px-1.5 py-0.5">Now</span>
                  )}
                </div>
                {time && <span className="text-xs text-[#2B1610]/40">{time}</span>}
              </div>
              <p className="font-serif text-3xl text-[#2B1610] leading-none mb-2">{m.total}</p>
              <div className="flex items-center gap-3 text-xs text-[#2B1610]/60">
                <span>M <b className="text-[#2B1610]">{m.men}</b></span>
                <span>F <b className="text-[#2B1610]">{m.women}</b></span>
                <span>K <b className="text-[#2B1610]">{m.children}</b></span>
                <span className="ml-auto text-[#2B1610]/40">{m.parties} room{m.parties === 1 ? '' : 's'}</span>
              </div>
            </div>
          );
        })}
      </div>

      {/* Guest-wise opt-in grid */}
      {loading ? (
        <p className="text-sm text-[#2B1610]/40">Loading dining list…</p>
      ) : guests.length === 0 ? (
        <p className="text-sm text-[#2B1610]/40">No guests are currently checked in.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs uppercase tracking-wide text-[#2B1610]/40 border-b border-[#2B1610]/10">
                <th className="py-2 font-normal">Guest</th>
                <th className="py-2 font-normal">Room(s)</th>
                <th className="py-2 font-normal text-center">Pax (M/F/K)</th>
                {MEALS.map((meal) => (
                  <th key={meal.key} className="py-2 font-normal text-center">{meal.label}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {guests.map((g) => (
                <tr key={g.id} className={`border-b border-[#2B1610]/5 ${savingId === g.id ? 'opacity-60' : ''}`}>
                  <td className="py-2.5">
                    <p className="text-[#2B1610]">{g.name}</p>
                    {g.mobile && <p className="text-xs text-[#2B1610]/40">{g.mobile}</p>}
                  </td>
                  <td className="py-2.5 text-[#2B1610]/60">
                    <span>{g.rooms}</span>
                    <span className="block text-xs text-[#2B1610]/40">{g.roomType}</span>
                  </td>
                  <td className="py-2.5 text-center text-[#2B1610]/80">
                    <span className="font-medium text-[#2B1610]">{g.total}</span>
                    <span className="block text-xs text-[#2B1610]/40">
                      {g.men}/{g.women}/{g.children}
                    </span>
                  </td>
                  {MEALS.map((meal) => (
                    <td key={meal.key} className="py-2.5 text-center">
                      <MealToggle
                        on={!!g[meal.key]}
                        disabled={savingId === g.id}
                        onToggle={() => toggleMeal(g, meal.key)}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
          <p className="text-xs text-[#2B1610]/40 mt-3">
            Tap a meal to include or exclude that room's guests. Totals update live and feed the daily
            Bhojanshala notification.
          </p>
        </div>
      )}
    </div>
  );
}

// A compact include/exclude pill for one guest-party × one meal.
function MealToggle({ on, disabled, onToggle }) {
  return (
    <button
      onClick={onToggle}
      disabled={disabled}
      aria-pressed={on}
      className={`inline-flex items-center justify-center w-7 h-7 border transition-colors disabled:cursor-not-allowed ${
        on
          ? 'border-[#4A6D5C] bg-[#4A6D5C] text-white'
          : 'border-[#2B1610]/20 bg-white text-[#2B1610]/20 hover:border-[#2B1610]/40'
      }`}
    >
      <Check className="w-3.5 h-3.5" strokeWidth={on ? 3 : 2} />
    </button>
  );
}

// Recompute per-meal M/F/K totals from a guest list for the optimistic update
// (the server sends authoritative numbers right after; this just avoids a flash).
function recomputeMeals(guests) {
  const out = {};
  for (const meal of ['breakfast', 'lunch', 'dinner']) {
    const acc = { men: 0, women: 0, children: 0, total: 0, parties: 0 };
    for (const g of guests) {
      if (!g[meal]) continue;
      acc.men += Number(g.men) || 0;
      acc.women += Number(g.women) || 0;
      acc.children += Number(g.children) || 0;
      acc.total += Number(g.total) || 0;
      acc.parties += 1;
    }
    out[meal] = acc;
  }
  return out;
}
