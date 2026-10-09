/**
 * utils/bhojanData.js — Bhojanshala (dining hall) head-count for TODAY, shared
 * by the live /bhojan/today view (routes/bhojan.js) and the daily Bhojanshala
 * email (mailer/bhojanReport.js) so the screen and the email can never drift.
 *
 * Who is counted: only CHECKED-IN bookings present today
 *   checkin_date <= today AND checkout_date >= today
 * (a guest eats at the hall on every day of the stay, arrival and departure day
 * included — unlike the occupancy calendar, where the checkout day is free).
 * Each booking opts in/out per meal via dine_breakfast / dine_lunch /
 * dine_dinner; the Male/Female/Kids split is the existing pax_* columns.
 *
 * Pure data (same convention as utils/reportData.js): takes the shared pool,
 * returns plain objects, no formatting and no money math.
 */

const { toDateStr } = require('./occupancy');

const MEALS = ['breakfast', 'lunch', 'dinner'];

// JSONB settings may hold a real string or be absent — fall back to the request
// defaults (Breakfast 07:30, Lunch 11:30, Dinner 19:30).
function mealTimings(settings = {}) {
  const pick = (k, d) => (typeof settings[k] === 'string' && settings[k].trim() ? settings[k].trim() : d);
  return {
    breakfast: pick('bhojan_breakfast_time', '07:30'),
    lunch: pick('bhojan_lunch_time', '11:30'),
    dinner: pick('bhojan_dinner_time', '19:30'),
  };
}

// 'HH:MM' -> minutes since midnight, or null if unparseable.
function parseHHMM(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

// Which meal the dynamic view highlights right now. Before breakfast time the
// next meal up is breakfast, so early-morning collapses into 'breakfast'.
function currentMeal(timings, now = new Date()) {
  const nm = now.getHours() * 60 + now.getMinutes();
  const b = parseHHMM(timings.breakfast) ?? 7 * 60 + 30;
  const l = parseHHMM(timings.lunch) ?? 11 * 60 + 30;
  const d = parseHHMM(timings.dinner) ?? 19 * 60 + 30;
  if (nm >= d) return 'dinner';
  if (nm >= l) return 'lunch';
  void b;
  return 'breakfast';
}

async function getSettingsMap(pool) {
  const { rows } = await pool.query(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

// Guest-wise dining rows for every booking present and checked in today.
async function getDiningGuests(pool) {
  const { rows } = await pool.query(
    `SELECT b.id, b.booking_code, b.guest_name, b.mobile,
            b.pax_men, b.pax_women, b.pax_children,
            b.dine_breakfast, b.dine_lunch, b.dine_dinner,
            rt.name AS room_type_name,
            COALESCE(
              (SELECT string_agg(r2.room_number, ', ' ORDER BY r2.room_number)
               FROM booking_rooms br JOIN rooms r2 ON r2.id = br.room_id
               WHERE br.booking_id = b.id),
              r.room_number
            ) AS rooms
     FROM bookings b
     JOIN room_types rt ON rt.id = b.room_type_id
     LEFT JOIN rooms r ON r.id = b.room_id
     WHERE b.status = 'checked_in'
       AND b.checkin_date <= CURRENT_DATE
       AND b.checkout_date >= CURRENT_DATE
     ORDER BY b.guest_name`
  );
  return rows.map((b) => ({
    id: b.id,
    bookingCode: b.booking_code,
    name: b.guest_name,
    mobile: b.mobile,
    rooms: b.rooms || '—',
    roomType: b.room_type_name,
    men: Number(b.pax_men) || 0,
    women: Number(b.pax_women) || 0,
    children: Number(b.pax_children) || 0,
    total: (Number(b.pax_men) || 0) + (Number(b.pax_women) || 0) + (Number(b.pax_children) || 0),
    breakfast: b.dine_breakfast,
    lunch: b.dine_lunch,
    dinner: b.dine_dinner,
  }));
}

// Sum pax by category over the guests opted into each meal.
function summarize(guests) {
  const out = {};
  for (const meal of MEALS) {
    out[meal] = { men: 0, women: 0, children: 0, total: 0, parties: 0 };
    for (const g of guests) {
      if (!g[meal]) continue;
      out[meal].men += g.men;
      out[meal].women += g.women;
      out[meal].children += g.children;
      out[meal].total += g.total;
      out[meal].parties += 1;
    }
  }
  return out;
}

/**
 * The whole payload the view and the email share: today's date, the admin meal
 * timings, which meal is current, the per-meal Male/Female/Kids totals, and the
 * guest-wise list. `now` is injectable for tests.
 */
async function getDiningData(pool, now = new Date()) {
  const settings = await getSettingsMap(pool);
  const timings = mealTimings(settings);
  const guests = await getDiningGuests(pool);
  return {
    date: toDateStr(now),
    timings,
    currentMeal: currentMeal(timings, now),
    meals: summarize(guests),
    guests,
  };
}

module.exports = {
  MEALS,
  mealTimings,
  parseHHMM,
  currentMeal,
  getSettingsMap,
  getDiningGuests,
  summarize,
  getDiningData,
};
