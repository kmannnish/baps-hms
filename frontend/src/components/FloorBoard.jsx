import React, { useMemo, useState } from 'react';
import { DoorOpen, Users } from 'lucide-react';

/**
 * FloorBoard
 *
 * Reads like a physical building directory: floors as tabs, rooms as
 * labeled slots on a wall rather than SaaS cards. Status colors:
 *   ready       -> sage green
 *   in_transit  -> clay orange
 *   occupied    -> brick red
 *   luggage     -> muted gold (cloak/luggage room)
 *
 * props.floors: [{ id, name, rooms: [{ id, roomNumber, roomType, status, guestName, checkoutTime }] }]
 * props.onSelectRoom: (room) => void
 */
const STATUS_STYLES = {
  ready:       { bg: '#4A6D5C', label: 'Ready' },
  in_transit:  { bg: '#4A6D5C', label: 'Ready' },
  occupied:    { bg: '#8C3B3B', label: 'Occupied' },
  maintenance: { bg: '#6B7280', label: 'Maintenance' },
};

function RoomSlot({ room, onSelectRoom }) {
  const style = STATUS_STYLES[room.status] ?? STATUS_STYLES.ready;
  const isOverstayWarning = room.status === 'occupied' && room.checkoutTime && new Date(room.checkoutTime) < new Date();
  return (
    <button
      onClick={() => onSelectRoom?.(room)}
      className={`relative flex flex-col items-start gap-1.5 border bg-[#F8F4EC] px-3 py-3 text-left hover:border-[#2B1610]/30 transition-colors ${
        isOverstayWarning ? 'border-[#8C3B3B] ring-2 ring-[#8C3B3B] animate-pulse' : 'border-[#2B1610]/10'
      }`}
      style={{ borderLeft: `4px solid ${style.bg}` }}
    >
      <div className="flex w-full items-center justify-between">
        <span className="font-serif text-lg text-[#2B1610]">{room.roomNumber}</span>
      </div>
      <span className="text-[11px] uppercase tracking-wide text-[#2B1610]/40">
        {room.roomType}
      </span>
      <div className="flex items-center gap-1.5 mt-0.5">
        <span
          className="inline-block w-2 h-2 rounded-full"
          style={{ backgroundColor: style.bg }}
        />
        <span className="text-xs text-[#2B1610]/60">{style.label}</span>
      </div>
      {room.guestName && (
        <span className="text-xs text-[#2B1610]/50 truncate w-full">{room.guestName}</span>
      )}
      {isOverstayWarning && (
        <span className="text-[10px] text-[#8C3B3B] font-medium mt-0.5">Overstay warning</span>
      )}
    </button>
  );
}

function countRooms(rooms = []) {
  const c = { ready: 0, occupied: 0, maintenance: 0 };
  rooms.forEach((r) => {
    const key = r.status === 'in_transit' ? 'ready' : r.status;
    c[key] = (c[key] ?? 0) + 1;
  });
  return c;
}

export default function FloorBoard({ floors = [], onSelectRoom }) {
  // 'ALL' is a virtual tab shown first: the whole building on one screen for a
  // fast glance. Selecting a real floor id narrows to that floor (the original
  // behaviour). Defaulting to 'ALL' makes the quick overview the landing view.
  const [activeFloorId, setActiveFloorId] = useState('ALL');
  const isAll = activeFloorId === 'ALL';

  const activeFloor = useMemo(
    () => floors.find((f) => f.id === activeFloorId) ?? floors[0],
    [floors, activeFloorId]
  );

  // Counts scope to whatever is on screen: the whole building in the All view,
  // otherwise just the selected floor.
  const counts = useMemo(
    () => countRooms(isAll ? floors.flatMap((f) => f.rooms || []) : activeFloor?.rooms || []),
    [isAll, floors, activeFloor]
  );

  return (
    <div className="bg-[#F8F4EC]">
      <div className="flex items-center gap-2 mb-4">
        <DoorOpen className="w-4 h-4 text-[#B8792F]" strokeWidth={1.75} />
        <h3 className="font-serif text-lg text-[#2B1610]">Building board</h3>
      </div>

      {/* Floor tabs — "All floors" first for a one-screen overview, then each floor */}
      <div className="flex gap-6 border-b border-[#2B1610]/15 mb-5 flex-wrap">
        <button
          onClick={() => setActiveFloorId('ALL')}
          className={`pb-3 text-sm transition-colors border-b-2 -mb-px ${
            isAll
              ? 'border-[#B8792F] text-[#2B1610]'
              : 'border-transparent text-[#2B1610]/40 hover:text-[#2B1610]/70'
          }`}
        >
          All floors
        </button>
        {floors.map((floor) => (
          <button
            key={floor.id}
            onClick={() => setActiveFloorId(floor.id)}
            className={`pb-3 text-sm transition-colors border-b-2 -mb-px ${
              !isAll && activeFloor?.id === floor.id
                ? 'border-[#B8792F] text-[#2B1610]'
                : 'border-transparent text-[#2B1610]/40 hover:text-[#2B1610]/70'
            }`}
          >
            {floor.name}
          </button>
        ))}
      </div>

      {/* Status legend / counts (scoped to the current view) */}
      <div className="flex flex-wrap gap-4 mb-5 text-xs text-[#2B1610]/60">
        {Object.entries(STATUS_STYLES).filter(([key]) => key !== 'in_transit').map(([key, s]) => (
          <div key={key} className="flex items-center gap-1.5">
            <span className="inline-block w-2 h-2 rounded-full" style={{ backgroundColor: s.bg }} />
            {s.label} · {counts[key] ?? 0}
          </div>
        ))}
      </div>

      {/* Rooms — every floor stacked in the All view, otherwise just the active floor */}
      {isAll ? (
        <div className="space-y-6">
          {floors.map((floor) => {
            const rooms = floor.rooms || [];
            return (
              <div key={floor.id}>
                <div className="flex items-baseline justify-between mb-2 border-b border-[#2B1610]/10 pb-1">
                  <h4 className="font-serif text-base text-[#2B1610]">{floor.name}</h4>
                  <span className="text-[11px] text-[#2B1610]/40">
                    {rooms.length} room{rooms.length === 1 ? '' : 's'}
                  </span>
                </div>
                {rooms.length ? (
                  <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
                    {rooms.map((room) => (
                      <RoomSlot key={room.id} room={room} onSelectRoom={onSelectRoom} />
                    ))}
                  </div>
                ) : (
                  <p className="text-sm text-[#2B1610]/40 py-2">No rooms configured on this floor yet.</p>
                )}
              </div>
            );
          })}
          {!floors.length && (
            <div className="flex items-center gap-2 text-[#2B1610]/40 text-sm py-8">
              <Users className="w-4 h-4" /> No floors configured yet.
            </div>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 lg:grid-cols-6 gap-3">
          {activeFloor?.rooms.map((room) => (
            <RoomSlot key={room.id} room={room} onSelectRoom={onSelectRoom} />
          ))}
          {!activeFloor?.rooms.length && (
            <div className="col-span-full flex items-center gap-2 text-[#2B1610]/40 text-sm py-8">
              <Users className="w-4 h-4" />
              No rooms configured on this floor yet.
            </div>
          )}
        </div>
      )}

      <div className="flex items-center gap-2 mt-5 text-xs text-[#2B1610]/40">
        <DoorOpen className="w-3.5 h-3.5" />
        Tap a room to check in, check out, or update its status.
      </div>
    </div>
  );
}
