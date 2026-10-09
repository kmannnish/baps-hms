/**
 * utils/occupancy.js — per-day, per-room-type occupancy for the future-occupancy
 * calendar (ReceptionCalendar / Admin / Swami) and the daily email report.
 *
 * Reuses the capacity primitive used across the app (/availability and the
 * /decide capacity check): a booking occupies `num_rooms` of its type on every
 * NIGHT it spans. A booking is present on day D when
 *   checkin_date <= D AND checkout_date > D
 * (the checkout day itself is free again). Occupied is SUM(num_rooms), never a
 * count of physical room_id — a multi-room booking stores only one primary
 * room_id but holds several rooms, so counting room_ids would under-count.
 *
 * Total capacity per type = physical COUNT(rooms) of that type when rooms exist,
 * else room_types.capacity_cap (same fallback the availability check uses).
 */

// Confirmed occupancy only — pending bookings aren't yet holding a room. (The
// public /availability check is deliberately more conservative and also counts
// 'pending' to avoid overselling; this calendar shows committed occupancy.)
const DEFAULT_STATUSES = ['approved', 'checked_in', 'modified'];

// Local Y-M-D — DATE columns come back from node-pg as local-midnight Date
// objects, so formatting via UTC would shift the day. Declared first; used below.
function toDateStr(d) {
  const dt = d instanceof Date ? d : new Date(d);
  const y = dt.getFullYear();
  const m = String(dt.getMonth() + 1).padStart(2, '0');
  const day = String(dt.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

async function getOccupancyCalendar(pool, from, to, statuses = DEFAULT_STATUSES) {
  // Room types with their total capacity (physical rooms else capacity_cap).
  const { rows: typeRows } = await pool.query(
    `SELECT rt.id, rt.name, rt.capacity_cap,
            COUNT(r.id)::int AS physical_rooms
     FROM room_types rt
     LEFT JOIN rooms r ON r.room_type_id = rt.id
     GROUP BY rt.id, rt.name, rt.capacity_cap
     ORDER BY rt.name`
  );
  const roomTypes = typeRows.map((t) => ({
    id: t.id,
    name: t.name,
    total: t.physical_rooms > 0 ? t.physical_rooms : Number(t.capacity_cap ?? 0),
  }));

  // Every booking overlapping the [from, to] window, fetched once. A booking
  // overlaps the window when it is present on at least one night in it:
  //   checkin_date <= to AND checkout_date > from
  const { rows: bookingRows } = await pool.query(
    `SELECT room_type_id, num_rooms, checkin_date, checkout_date
     FROM bookings
     WHERE status = ANY($1)
       AND checkin_date <= $3::date AND checkout_date > $2::date`,
    [statuses, from, to]
  );

  // Tally per day in JS — at this volume (≤20 bookings/day, a month at a time)
  // this is trivial and avoids a generate_series + range-join in SQL.
  const normalized = bookingRows.map((b) => ({
    roomTypeId: b.room_type_id,
    numRooms: b.num_rooms || 1,
    ci: toDateStr(b.checkin_date),
    co: toDateStr(b.checkout_date),
  }));

  const days = [];
  const start = new Date(`${from}T00:00:00`);
  const end = new Date(`${to}T00:00:00`);
  for (let d = new Date(start); d <= end; d.setDate(d.getDate() + 1)) {
    const dayStr = toDateStr(d);
    const byTypeMap = Object.create(null);
    for (const rt of roomTypes) byTypeMap[rt.id] = 0;
    for (const b of normalized) {
      if (b.ci <= dayStr && b.co > dayStr) {
        byTypeMap[b.roomTypeId] = (byTypeMap[b.roomTypeId] ?? 0) + b.numRooms;
      }
    }
    days.push({
      date: dayStr,
      byType: roomTypes.map((rt) => ({
        roomTypeId: rt.id,
        occupied: byTypeMap[rt.id] ?? 0,
        total: rt.total,
      })),
    });
  }

  return { from, to, roomTypes, days };
}

module.exports = { getOccupancyCalendar, DEFAULT_STATUSES, toDateStr };
