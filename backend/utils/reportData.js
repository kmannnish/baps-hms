/**
 * utils/reportData.js — report queries shared by BOTH the /reports/stats
 * endpoint (routes/reports.js) and the daily email report (mailer/dailyReport.js),
 * so the on-screen numbers and the emailed PDF can never drift apart (DRY).
 *
 * Each function takes the shared pool explicitly (same convention as
 * utils/occupancy.js) and returns plain data — no money math, no formatting.
 * Date WINDOWS are passed in as 'YYYY-MM-DD' strings: the caller decides what
 * "today" means (the endpoint keeps its existing windows; the email uses the
 * server-local day), which keeps these helpers pure and reusable.
 */

// Revenue + realised-booking count for a [start, end] check-in window.
// Only stays that actually happened (checked_in / checked_out) count as income,
// exactly as the /reports/stats endpoint has always computed it.
async function revenueBetween(pool, start, end) {
  const { rows } = await pool.query(
    `SELECT COALESCE(SUM(final_amount), 0)::numeric AS revenue, COUNT(*)::int AS bookings
     FROM bookings
     WHERE status IN ('checked_in', 'checked_out')
       AND checkin_date >= $1 AND checkin_date <= $2`,
    [start, end]
  );
  return { revenue: Number(rows[0].revenue), bookings: rows[0].bookings };
}

// Per-room-type physical-room status snapshot (how many ready/occupied right
// now). Mirrors the historical /stats query verbatim so its shape is unchanged.
async function getRoomStatusOccupancy(pool) {
  const { rows } = await pool.query(
    `SELECT rt.name AS room_type,
            COUNT(*)::int AS total,
            COUNT(*) FILTER (WHERE r.status = 'occupied')::int AS occupied,
            COUNT(*) FILTER (WHERE r.status = 'ready')::int AS ready,
            COUNT(*) FILTER (WHERE r.status = 'in_transit')::int AS in_transit,
            COUNT(*) FILTER (WHERE r.status = 'luggage')::int AS luggage,
            COUNT(*) FILTER (WHERE r.status = 'maintenance')::int AS maintenance
     FROM rooms r
     JOIN room_types rt ON rt.id = r.room_type_id
     GROUP BY rt.name
     ORDER BY rt.name`
  );
  return rows;
}

// Today's realised check-in / check-out counts + pending walk-ins at the desk.
// Uses the DB's CURRENT_DATE (server-local calendar day), matching /stats.
async function getTodayCounts(pool) {
  const { rows } = await pool.query(
    `SELECT
       COUNT(*) FILTER (WHERE status = 'checked_in' AND ata_actual_arrival::date = CURRENT_DATE)::int AS today_checkins,
       COUNT(*) FILTER (WHERE status = 'checked_out' AND actual_checkout_at::date = CURRENT_DATE)::int AS today_checkouts,
       COUNT(*) FILTER (WHERE status IN ('pending','modified') AND channel = 'walkin')::int AS pending_walkins
     FROM bookings`
  );
  return rows[0] || { today_checkins: 0, today_checkouts: 0, pending_walkins: 0 };
}

// Bookings-per-month for the last 12 months (the /stats monthly trend chart).
async function getMonthlyTrend(pool) {
  const { rows } = await pool.query(
    `SELECT to_char(checkin_date, 'YYYY-MM') AS month, COUNT(*)::int AS bookings
     FROM bookings
     WHERE checkin_date >= (CURRENT_DATE - INTERVAL '12 months')
     GROUP BY month
     ORDER BY month`
  );
  return rows;
}

// Today's expected arrivals (confirmed bookings whose check-in is today) and
// departures (checked-in / checked-out bookings whose check-out is today) — the
// "what's happening today" tables in the daily email. Each row carries both the
// scheduled time (preferred_*) and the real stamp (ata_actual_arrival /
// actual_checkout_at) so the PDF can apply the app-wide scheduled-vs-actual rule.
async function getTodayActivity(pool) {
  const { rows: arrivals } = await pool.query(
    `SELECT b.id, b.booking_code, b.guest_name, b.mobile, b.num_rooms,
            b.status, b.channel, b.checkin_date, b.checkout_date,
            b.preferred_arrival_time, b.ata_actual_arrival,
            rt.name AS room_type_name, r.room_number
     FROM bookings b
     JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.checkin_date = CURRENT_DATE
       AND b.status IN ('approved', 'checked_in', 'modified')
     ORDER BY b.guest_name`
  );
  const { rows: departures } = await pool.query(
    `SELECT b.id, b.booking_code, b.guest_name, b.mobile, b.num_rooms,
            b.status, b.checkin_date, b.checkout_date,
            b.preferred_departure_time, b.actual_checkout_at,
            rt.name AS room_type_name, r.room_number
     FROM bookings b
     JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.checkout_date = CURRENT_DATE
       AND b.status IN ('checked_in', 'checked_out')
     ORDER BY b.guest_name`
  );
  return { arrivals, departures };
}

module.exports = {
  revenueBetween,
  getRoomStatusOccupancy,
  getTodayCounts,
  getMonthlyTrend,
  getTodayActivity,
};
