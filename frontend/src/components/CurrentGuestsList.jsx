import React, { useMemo, useState } from 'react';
import { Users, Eye, LogOut, Settings2, Check } from 'lucide-react';
import { fmtDate } from '../lib/datetime';

/**
 * CurrentGuestsList — a flat table of every occupied room right now.
 *
 * Per the dining feature it shows the pax split by category (Male/Female/Kids)
 * and lets Reception flip each room's per-meal Bhojanshala opt-in inline
 * (onToggleDining → PATCH /bookings/:id/dining); the dedicated Bhojanshala tab
 * shows the rolled-up counts. "Manage" opens the same occupied-room modal as the
 * floor board (full billing + checkout + extend), so checkout always goes
 * through that modal's unpaid-balance guard rather than a blind bulk action.
 */
const MEALS = [
  { key: 'dineBreakfast', short: 'B', label: 'Breakfast' },
  { key: 'dineLunch', short: 'L', label: 'Lunch' },
  { key: 'dineDinner', short: 'D', label: 'Dinner' },
];

export default function CurrentGuestsList({ floors = [], onViewId, onBulkCheckout, onToggleDining, onManage }) {
  const [selected, setSelected] = useState(new Set());
  const [confirming, setConfirming] = useState(false);

  const guests = useMemo(() => {
    const rows = [];
    floors.forEach((f) => {
      (f.rooms || []).forEach((r) => {
        if (r.status === 'occupied' && r.bookingId) {
          rows.push({ ...r, floorName: f.name });
        }
      });
    });
    return rows;
  }, [floors]);

  const paxTotal = (r) =>
    (Number(r.paxMen) || 0) + (Number(r.paxWomen) || 0) + (Number(r.paxChildren) || 0);

  const toggleOne = (bookingId) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(bookingId)) next.delete(bookingId); else next.add(bookingId);
      return next;
    });
  };

  const toggleAll = () => {
    if (selected.size === guests.length) {
      setSelected(new Set());
    } else {
      setSelected(new Set(guests.map((g) => g.bookingId)));
    }
  };

  const handleBulkCheckout = async () => {
    if (!onBulkCheckout || selected.size === 0) return;
    setConfirming(false);
    await onBulkCheckout([...selected]);
    setSelected(new Set());
  };

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-[#B8792F]" strokeWidth={1.75} />
        <h3 className="font-serif text-lg text-[#2B1610]">Current guests</h3>
        <span className="text-sm text-[#2B1610]/40">· {guests.length} occupied</span>
      </div>

      {guests.length === 0 ? (
        <p className="text-sm text-[#2B1610]/40">No rooms are currently occupied.</p>
      ) : (
        <>
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="text-left text-xs uppercase tracking-wide text-[#2B1610]/40 border-b border-[#2B1610]/10">
                  <th className="py-2 font-normal w-8">
                    <input
                      type="checkbox"
                      checked={selected.size === guests.length && guests.length > 0}
                      onChange={toggleAll}
                      className="accent-[#B8792F]"
                    />
                  </th>
                  <th className="py-2 font-normal">Room</th>
                  <th className="py-2 font-normal">Guest</th>
                  <th className="py-2 font-normal">Pax (M/F/K)</th>
                  <th className="py-2 font-normal text-center">Bhojanshala</th>
                  <th className="py-2 font-normal">Checkout</th>
                  <th className="py-2 font-normal">Payment</th>
                  <th className="py-2 font-normal" />
                </tr>
              </thead>
              <tbody>
                {guests.map((r) => {
                  const total = paxTotal(r);
                  const ps = r.paymentStatus || (r.isPaid ? 'paid' : 'unpaid');
                  const color = ps === 'paid' ? 'text-[#4A6D5C]' : ps === 'partial' ? 'text-[#B8792F]' : 'text-[#8C3B3B]';
                  const isOverstay = r.checkoutTime && new Date(r.checkoutTime) < new Date();
                  return (
                    <tr key={r.id} className={`border-b border-[#2B1610]/5 ${isOverstay ? 'bg-[#8C3B3B]/5' : ''}`}>
                      <td className="py-2.5">
                        <input
                          type="checkbox"
                          checked={selected.has(r.bookingId)}
                          onChange={() => toggleOne(r.bookingId)}
                          className="accent-[#B8792F]"
                        />
                      </td>
                      <td className="py-2.5">
                        <p className="text-[#2B1610]">{r.roomNumber}</p>
                        <p className="text-xs text-[#2B1610]/40">{r.floorName} · {r.roomType}</p>
                      </td>
                      <td className="py-2.5 text-[#2B1610]/80">{r.guestName || '—'}</td>
                      <td className="py-2.5 text-[#2B1610]/70">
                        {total > 0 ? (
                          <span className="inline-flex items-baseline gap-1.5">
                            <span className="font-medium text-[#2B1610]">{total}</span>
                            <span className="text-xs text-[#2B1610]/45">
                              {Number(r.paxMen) || 0}/{Number(r.paxWomen) || 0}/{Number(r.paxChildren) || 0}
                            </span>
                          </span>
                        ) : '—'}
                      </td>
                      <td className="py-2.5">
                        <div className="flex items-center justify-center gap-1">
                          {MEALS.map((m) => (
                            <DiningPill
                              key={m.key}
                              short={m.short}
                              label={m.label}
                              on={!!r[m.key]}
                              onToggle={onToggleDining ? () => onToggleDining(r.bookingId, m, !r[m.key]) : null}
                            />
                          ))}
                        </div>
                      </td>
                      <td className="py-2.5">
                        <span className={`text-[#2B1610]/70 ${isOverstay ? 'text-[#8C3B3B] font-medium' : ''}`}>
                          {fmtDate(r.checkoutTime)}
                        </span>
                        {isOverstay && <span className="text-[10px] text-[#8C3B3B] block">Overstay</span>}
                      </td>
                      <td className="py-2.5">
                        <span className={`text-xs uppercase tracking-wide ${color}`}>{ps}</span>
                      </td>
                      <td className="py-2.5 text-right whitespace-nowrap">
                        {onManage && (
                          <button
                            onClick={() => onManage(r)}
                            className="inline-flex items-center gap-1.5 border border-[#2B1610]/20 px-2.5 py-1.5 text-xs text-[#2B1610]/80 hover:border-[#2B1610]/40 mr-1.5"
                          >
                            <Settings2 className="w-3.5 h-3.5" /> Manage
                          </button>
                        )}
                        <button
                          onClick={() => onViewId?.(r.bookingId)}
                          className="inline-flex items-center gap-1.5 border border-[#2B1610]/20 px-2.5 py-1.5 text-xs text-[#2B1610]/80 hover:border-[#2B1610]/40"
                        >
                          <Eye className="w-3.5 h-3.5" /> View ID
                        </button>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {selected.size > 0 && (
            <div className="sticky bottom-4 mt-4 flex items-center justify-between bg-[#2B1610] text-[#F8F4EC] px-5 py-3 shadow-lg">
              <span className="text-sm">{selected.size} guest{selected.size > 1 ? 's' : ''} selected</span>
              {confirming ? (
                <div className="flex items-center gap-2">
                  <span className="text-sm text-[#F8F4EC]/70">Check out? Rooms with a balance are kept.</span>
                  <button
                    onClick={handleBulkCheckout}
                    className="bg-[#8C3B3B] text-white px-4 py-1.5 text-sm hover:opacity-90"
                  >
                    Yes, check out
                  </button>
                  <button
                    onClick={() => setConfirming(false)}
                    className="border border-[#F8F4EC]/30 px-4 py-1.5 text-sm hover:bg-[#F8F4EC]/10"
                  >
                    Cancel
                  </button>
                </div>
              ) : (
                <button
                  onClick={() => setConfirming(true)}
                  className="flex items-center gap-1.5 bg-[#8C3B3B] text-white px-4 py-1.5 text-sm hover:opacity-90"
                >
                  <LogOut className="w-3.5 h-3.5" /> Check out selected
                </button>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}

// A small Breakfast/Lunch/Dinner opt-in pill. Read-only (no onToggle) renders as
// a static indicator; with onToggle it flips the room's meal opt-in inline.
function DiningPill({ short, label, on, onToggle }) {
  const base = `inline-flex items-center justify-center w-6 h-6 text-[11px] font-medium border transition-colors ${
    on ? 'border-[#4A6D5C] bg-[#4A6D5C] text-white' : 'border-[#2B1610]/20 bg-white text-[#2B1610]/30'
  }`;
  if (!onToggle) {
    return <span className={base} title={`${label}: ${on ? 'yes' : 'no'}`}>{on ? <Check className="w-3 h-3" strokeWidth={3} /> : short}</span>;
  }
  return (
    <button
      onClick={onToggle}
      aria-pressed={on}
      title={`${label}: ${on ? 'eating — tap to exclude' : 'not eating — tap to include'}`}
      className={`${base} hover:border-[#2B1610]/50 cursor-pointer`}
    >
      {on ? <Check className="w-3 h-3" strokeWidth={3} /> : short}
    </button>
  );
}
