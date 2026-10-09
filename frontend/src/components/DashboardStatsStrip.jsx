import React from 'react';
import { BedDouble, LogIn, LogOut, ClipboardList } from 'lucide-react';

export default function DashboardStatsStrip({ stats }) {
  if (!stats) return null;

  const cards = [
    {
      label: 'Occupied',
      value: `${stats.totalOccupied ?? 0} / ${stats.totalRooms ?? 0}`,
      icon: BedDouble,
      color: '#8C3B3B',
    },
    {
      label: "Today's check-ins",
      value: stats.todayCheckins ?? 0,
      icon: LogIn,
      color: '#4A6D5C',
    },
    {
      label: "Today's checkouts",
      value: stats.todayCheckouts ?? 0,
      icon: LogOut,
      color: '#C77A34',
    },
    {
      label: 'Pending walk-ins',
      value: stats.pendingWalkins ?? 0,
      icon: ClipboardList,
      color: '#2B1610',
    },
  ];

  return (
    <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
      {cards.map((c) => (
        <div key={c.label} className="border border-[#2B1610]/10 bg-white/40 p-3 flex items-center gap-3">
          <c.icon className="w-4 h-4 shrink-0" style={{ color: c.color }} />
          <div>
            <p className="text-lg font-serif text-[#2B1610] leading-tight">{c.value}</p>
            <p className="text-[10px] uppercase tracking-wide text-[#2B1610]/40">{c.label}</p>
          </div>
        </div>
      ))}
    </div>
  );
}
