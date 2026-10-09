import React, { useState, useEffect } from 'react';
import { Layers, DoorOpen, Plus, Pencil, Trash2, IndianRupee, Loader2 } from 'lucide-react';
import { fetchArray } from '../lib/api';

/**
 * InventoryManager
 *
 * Admin screen covering: room creation, mapping rooms to floors, base
 * pricing per room type, and inventory caps (e.g. 15 AC, 11 Non-AC, 4 Dorm).
 *
 * props.apiBaseUrl, props.authToken
 */
export default function InventoryManager({ apiBaseUrl, authToken }) {
  const [tab, setTab] = useState('room-types'); // 'room-types' | 'rooms'
  const [floors, setFloors] = useState([]);
  const [roomTypes, setRoomTypes] = useState([]);
  const [rooms, setRooms] = useState([]);
  const [loading, setLoading] = useState(true);

  const authHeaders = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  const loadAll = async () => {
    setLoading(true);
    const [f, rt, r] = await Promise.all([
      fetchArray(`${apiBaseUrl}/inventory/floors`),
      fetchArray(`${apiBaseUrl}/inventory/room-types`),
      fetchArray(`${apiBaseUrl}/inventory/rooms`),
    ]);
    setFloors(f);
    setRoomTypes(rt);
    setRooms(r);
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#2B1610]/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[#F8F4EC]">
      <div className="flex gap-6 border-b border-[#2B1610]/15 mb-6">
        <TabButton active={tab === 'room-types'} onClick={() => setTab('room-types')} icon={IndianRupee}>
          Room types & pricing
        </TabButton>
        <TabButton active={tab === 'rooms'} onClick={() => setTab('rooms')} icon={DoorOpen}>
          Rooms & floors
        </TabButton>
      </div>

      {tab === 'room-types' && (
        <RoomTypesPanel
          roomTypes={roomTypes}
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          onChanged={loadAll}
        />
      )}
      {tab === 'rooms' && (
        <RoomsPanel
          floors={floors}
          roomTypes={roomTypes}
          rooms={rooms}
          apiBaseUrl={apiBaseUrl}
          authHeaders={authHeaders}
          onChanged={loadAll}
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

// ---------------------------------------------------------------------------
// Room types & pricing
// ---------------------------------------------------------------------------
function RoomTypesPanel({ roomTypes, apiBaseUrl, authHeaders, onChanged }) {
  const [editingId, setEditingId] = useState(null);
  const [draft, setDraft] = useState({});
  const [adding, setAdding] = useState(false);
  const [newType, setNewType] = useState({ name: '', basePrice: 0, capacityCap: 0 });

  const startEdit = (rt) => { setEditingId(rt.id); setDraft(rt); };

  const save = async () => {
    await fetch(`${apiBaseUrl}/inventory/room-types/${editingId}`, {
      method: 'PUT',
      headers: authHeaders,
      body: JSON.stringify({ name: draft.name, basePrice: draft.base_price, capacityCap: draft.capacity_cap }),
    });
    setEditingId(null);
    onChanged();
  };

  const create = async () => {
    if (!newType.name.trim()) return;
    await fetch(`${apiBaseUrl}/inventory/room-types`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(newType),
    });
    setNewType({ name: '', basePrice: 0, capacityCap: 0 });
    setAdding(false);
    onChanged();
  };

  return (
    <div>
      <table className="w-full text-sm mb-4">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[#2B1610]/40 border-b border-[#2B1610]/10">
            <th className="py-2 font-normal">Room type</th>
            <th className="py-2 font-normal">Base price</th>
            <th className="py-2 font-normal">Inventory cap</th>
            <th className="py-2 font-normal w-10"></th>
          </tr>
        </thead>
        <tbody>
          {roomTypes.map((rt) => (
            <tr key={rt.id} className="border-b border-[#2B1610]/5">
              {editingId === rt.id ? (
                <>
                  <td className="py-2 pr-2">
                    <input
                      value={draft.name}
                      onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                      className="border border-[#2B1610]/20 px-2 py-1 w-full"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      value={draft.base_price}
                      onChange={(e) => setDraft({ ...draft, base_price: Number(e.target.value) })}
                      className="border border-[#2B1610]/20 px-2 py-1 w-24"
                    />
                  </td>
                  <td className="py-2 pr-2">
                    <input
                      type="number"
                      value={draft.capacity_cap}
                      onChange={(e) => setDraft({ ...draft, capacity_cap: Number(e.target.value) })}
                      className="border border-[#2B1610]/20 px-2 py-1 w-20"
                    />
                  </td>
                  <td className="py-2">
                    <button onClick={save} className="text-[#B8792F] text-xs hover:underline">Save</button>
                  </td>
                </>
              ) : (
                <>
                  <td className="py-3 font-serif text-[#2B1610]">{rt.name}</td>
                  <td className="py-3 text-[#2B1610]/70">₹{Number(rt.base_price).toLocaleString('en-IN')}</td>
                  <td className="py-3 text-[#2B1610]/70">{rt.capacity_cap} rooms</td>
                  <td className="py-3">
                    <button onClick={() => startEdit(rt)} className="text-[#2B1610]/40 hover:text-[#2B1610]">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </td>
                </>
              )}
            </tr>
          ))}
        </tbody>
      </table>

      {adding ? (
        <div className="flex flex-wrap items-center gap-2 border border-[#2B1610]/10 p-3">
          <input
            placeholder="Name (e.g. AC)"
            value={newType.name}
            onChange={(e) => setNewType({ ...newType, name: e.target.value })}
            className="border border-[#2B1610]/20 px-2 py-1.5 text-sm"
          />
          <input
            type="number"
            placeholder="Base price"
            value={newType.basePrice}
            onChange={(e) => setNewType({ ...newType, basePrice: Number(e.target.value) })}
            className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-28"
          />
          <input
            type="number"
            placeholder="Cap"
            value={newType.capacityCap}
            onChange={(e) => setNewType({ ...newType, capacityCap: Number(e.target.value) })}
            className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-20"
          />
          <button onClick={create} className="bg-[#2B1610] text-[#F8F4EC] px-3 py-1.5 text-sm">Add</button>
          <button onClick={() => setAdding(false)} className="text-sm text-[#2B1610]/40">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setAdding(true)}
          className="flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline"
        >
          <Plus className="w-3.5 h-3.5" /> Add room type
        </button>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// Rooms & floors
// ---------------------------------------------------------------------------
function RoomsPanel({ floors, roomTypes, rooms, apiBaseUrl, authHeaders, onChanged }) {
  const [newRoom, setNewRoom] = useState({ floorId: floors[0]?.id ?? '', roomTypeId: roomTypes[0]?.id ?? '', roomNumber: '', bedCount: 1, hasBathroom: true });
  const [error, setError] = useState('');
  const [addingFloor, setAddingFloor] = useState(false);
  const [newFloorName, setNewFloorName] = useState('');

  const addRoom = async () => {
    if (!newRoom.roomNumber.trim()) return;
    const res = await fetch(`${apiBaseUrl}/inventory/rooms`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify(newRoom),
    });
    if (res.status === 409) {
      setError('That room number already exists on this floor.');
      return;
    }
    setError('');
    setNewRoom({ ...newRoom, roomNumber: '', bedCount: 1, hasBathroom: true });
    onChanged();
  };

  const addFloor = async () => {
    if (!newFloorName.trim()) return;
    const res = await fetch(`${apiBaseUrl}/inventory/floors`, {
      method: 'POST',
      headers: authHeaders,
      body: JSON.stringify({ name: newFloorName, sortOrder: floors.length }),
    });
    const floor = await res.json();
    setNewFloorName('');
    setAddingFloor(false);
    setNewRoom((prev) => ({ ...prev, floorId: floor.id }));
    onChanged();
  };

  const deleteRoom = async (id) => {
    await fetch(`${apiBaseUrl}/inventory/rooms/${id}`, { method: 'DELETE', headers: authHeaders });
    onChanged();
  };

  return (
    <div>
      <div className="flex flex-wrap items-center gap-2 border border-[#2B1610]/10 p-3 mb-3">
        <Layers className="w-4 h-4 text-[#B8792F]" />
        <select
          value={newRoom.floorId}
          onChange={(e) => setNewRoom({ ...newRoom, floorId: e.target.value })}
          className="border border-[#2B1610]/20 px-2 py-1.5 text-sm"
        >
          {floors.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
        </select>
        <select
          value={newRoom.roomTypeId}
          onChange={(e) => setNewRoom({ ...newRoom, roomTypeId: e.target.value })}
          className="border border-[#2B1610]/20 px-2 py-1.5 text-sm"
        >
          {roomTypes.map((rt) => <option key={rt.id} value={rt.id}>{rt.name}</option>)}
        </select>
        <input
          placeholder="Room number"
          value={newRoom.roomNumber}
          onChange={(e) => setNewRoom({ ...newRoom, roomNumber: e.target.value })}
          className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-32"
        />
        <input
          type="number"
          min="1"
          placeholder="Beds"
          value={newRoom.bedCount}
          onChange={(e) => setNewRoom({ ...newRoom, bedCount: Math.max(1, parseInt(e.target.value) || 1) })}
          className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-16"
        />
        <label className="flex items-center gap-1.5 text-sm text-[#2B1610]/70 cursor-pointer">
          <input
            type="checkbox"
            checked={newRoom.hasBathroom}
            onChange={(e) => setNewRoom({ ...newRoom, hasBathroom: e.target.checked })}
            className="accent-[#B8792F]"
          />
          Attached bath
        </label>
        <button onClick={addRoom} className="flex items-center gap-1.5 bg-[#2B1610] text-[#F8F4EC] px-3 py-1.5 text-sm">
          <Plus className="w-3.5 h-3.5" /> Add room
        </button>
      </div>

      {addingFloor ? (
        <div className="flex items-center gap-2 mb-4">
          <input
            autoFocus
            placeholder="New floor name (e.g. Second Floor)"
            value={newFloorName}
            onChange={(e) => setNewFloorName(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFloor()}
            className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-56"
          />
          <button onClick={addFloor} className="bg-[#2B1610] text-[#F8F4EC] px-3 py-1.5 text-sm">Add floor</button>
          <button onClick={() => setAddingFloor(false)} className="text-sm text-[#2B1610]/40">Cancel</button>
        </div>
      ) : (
        <button
          onClick={() => setAddingFloor(true)}
          className="flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline mb-4"
        >
          <Plus className="w-3.5 h-3.5" /> Add a new floor — as many as you need, not limited to two
        </button>
      )}

      {error && <p className="text-sm text-[#8C3B3B] mb-4">{error}</p>}

      <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
        {rooms.map((room) => (
          <div key={room.id} className="border border-[#2B1610]/10 px-3 py-2.5 flex items-center justify-between group">
            <div>
              <p className="font-serif text-[#2B1610]">{room.room_number}</p>
              <p className="text-xs text-[#2B1610]/40">{room.floor_name} · {room.room_type_name}</p>
              <p className="text-xs text-[#2B1610]/30">{room.bed_count ?? 1} bed{(room.bed_count ?? 1) !== 1 ? 's' : ''} · {room.has_bathroom ? 'attached bath' : 'no bath'}</p>
            </div>
            <button
              onClick={() => deleteRoom(room.id)}
              className="opacity-0 group-hover:opacity-100 text-[#8C3B3B]/60 hover:text-[#8C3B3B]"
            >
              <Trash2 className="w-3.5 h-3.5" />
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
