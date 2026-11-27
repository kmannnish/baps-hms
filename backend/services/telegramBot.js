/**
 * services/telegramBot.js
 *
 * Full-featured Telegram bot for BAPS Jaipur Utara HMS:
 *   - Swami Ji role: instant new-request alerts with Approve (Standard / Discounted / FOC)
 *     and Reject buttons, Pending queue, Approved list, Live Occupancy, Income & Occupancy,
 *     Bhojanshala count, Future Bookings, WhatsApp-template forward-to-book, and Daily Report.
 *   - Bhojanshala role: receives scheduled/manual daily meal counts and can tap
 *     "Today's Meal Count" anytime (strictly dining data only — no income/private info).
 */

const crypto = require('crypto');
const pool = require('../db');
const { getDiningData } = require('../utils/bhojanData');
const { revenueBetween, getRoomStatusOccupancy, getTodayActivity } = require('../utils/reportData');
const { parseWhatsAppBooking } = require('../utils/whatsappBookingParser');
const { makeBookingCode } = require('../utils/bookingCode');

// Ephemeral in-memory drafts for WhatsApp-template forward-to-book (Swami Ji).
const pendingWaDrafts = new Map(); // draftId -> { parsed, roomType, createdAt }

const SWAMI_KEYBOARD = {
  keyboard: [
    [{ text: '📋 Pending Requests' }, { text: '✅ Approved' }],
    [{ text: '🏨 Live Occupancy' }, { text: '📊 Income & Occupancy' }],
    [{ text: '🍽️ Bhojanshala' }, { text: '📅 Future Bookings' }],
  ],
  resize_keyboard: true,
  persistent: true,
};

const BHOJAN_KEYBOARD = {
  keyboard: [[{ text: "🍽️ Today's Meal Count" }]],
  resize_keyboard: true,
  persistent: true,
};

function getBotToken() {
  return (process.env.TELEGRAM_BOT_TOKEN || '').trim();
}

function getWebhookSecret() {
  const token = getBotToken();
  if (process.env.TELEGRAM_WEBHOOK_SECRET) return process.env.TELEGRAM_WEBHOOK_SECRET.trim();
  if (!token) return '';
  return crypto.createHash('sha256').update(token).digest('hex').slice(0, 32);
}

function parseChatIds(val) {
  if (!val) return [];
  if (Array.isArray(val)) return val.map((x) => String(x).trim()).filter(Boolean);
  return String(val)
    .split(/[\s,;]+/)
    .map((x) => x.trim())
    .filter(Boolean);
}

async function getSettingsMap() {
  const { rows } = await pool.query(`SELECT key, value FROM settings`);
  return Object.fromEntries(rows.map((r) => [r.key, r.value]));
}

async function setSetting(key, value) {
  await pool.query(
    `INSERT INTO settings (key, value, updated_at) VALUES ($1, $2, now())
     ON CONFLICT (key) DO UPDATE SET value = $2, updated_at = now()`,
    [key, JSON.stringify(value)]
  );
}

async function getAuthorizedChatIds() {
  const settings = await getSettingsMap();
  const swamiSet = new Set([
    ...parseChatIds(process.env.TELEGRAM_SWAMI_CHAT_ID),
    ...parseChatIds(settings.telegram_swami_chat_ids),
  ]);
  const bhojanSet = new Set([
    ...parseChatIds(process.env.TELEGRAM_BHOJAN_CHAT_ID),
    ...parseChatIds(settings.telegram_bhojan_chat_ids),
  ]);
  return { swamiIds: [...swamiSet], bhojanIds: [...bhojanSet], settings };
}

function escHtml(str) {
  return String(str ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function fmtDateIn(d) {
  if (!d) return '-';
  const s = typeof d === 'string' ? d.slice(0, 10) : d.toISOString().slice(0, 10);
  const [y, m, day] = s.split('-');
  const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  return `${day} ${months[Number(m) - 1] || m} ${y}`;
}

function istNowParts() {
  const ist = new Date(Date.now() + 330 * 60 * 1000);
  return {
    date: ist.toISOString().slice(0, 10),
    minutes: ist.getUTCHours() * 60 + ist.getUTCMinutes(),
  };
}

function parseHHMM(s) {
  const m = String(s || '').match(/^(\d{1,2}):(\d{2})/);
  if (!m) return null;
  const h = Number(m[1]);
  const min = Number(m[2]);
  if (h > 23 || min > 59) return null;
  return h * 60 + min;
}

async function tgCall(method, payload) {
  const token = getBotToken();
  if (!token) return null;
  try {
    const res = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    if (!data.ok) {
      console.error(`Telegram API ${method} error:`, data.description);
    }
    return data;
  } catch (err) {
    console.error(`Telegram API ${method} failed:`, err.message);
    return null;
  }
}

async function sendMessage(chatId, text, extra = {}) {
  return tgCall('sendMessage', {
    chat_id: chatId,
    text,
    parse_mode: 'HTML',
    disable_web_page_preview: true,
    ...extra,
  });
}

function bookingCardHtml(b, availInfo = null) {
  const totalPax = (Number(b.pax_men) || 0) + (Number(b.pax_women) || 0) + (Number(b.pax_children) || 0);
  const lines = [
    `🙏 <b>Stay Request ${b.booking_code ? `(${escHtml(b.booking_code)})` : ''}</b>`,
    `👤 <b>Guest:</b> ${escHtml(b.guest_name)}`,
    `📞 <b>Mobile:</b> ${escHtml(b.mobile || '-')}`,
    b.guest_city ? `🏙️ <b>City:</b> ${escHtml(b.guest_city)}` : null,
    `📅 <b>Check-in:</b> ${fmtDateIn(b.checkin_date)}${b.preferred_arrival_time ? ` (${escHtml(b.preferred_arrival_time)})` : ''}`,
    `📅 <b>Check-out:</b> ${fmtDateIn(b.checkout_date)}${b.preferred_departure_time ? ` (${escHtml(b.preferred_departure_time)})` : ''}`,
    `👥 <b>Pax:</b> ${totalPax} (M:${b.pax_men || 0} / F:${b.pax_women || 0} / K:${b.pax_children || 0})`,
    `🛏️ <b>Room:</b> ${escHtml(b.room_type_name || 'Room')} × ${b.num_rooms || 1}`,
    b.sant_reference_name ? `🪷 <b>Sant Ref:</b> ${escHtml(b.sant_reference_name)}${b.sant_reference_mobile ? ` (${escHtml(b.sant_reference_mobile)})` : ''}` : null,
    availInfo ? `ℹ️ <b>Availability:</b> ${escHtml(availInfo)}` : null,
  ];
  return lines.filter(Boolean).join('\n');
}

function approvalButtons(bookingId) {
  return {
    inline_keyboard: [
      [
        { text: '✅ Standard', callback_data: `approve:${bookingId}:paid` },
        { text: '🏷️ Discounted', callback_data: `approve:${bookingId}:discounted` },
      ],
      [
        { text: '🙏 FOC', callback_data: `approve:${bookingId}:foc` },
        { text: '❌ Reject', callback_data: `reject:${bookingId}` },
      ],
    ],
  };
}

async function notifyNewBookingRequest(bookingId) {
  if (!getBotToken()) return;
  const { swamiIds } = await getAuthorizedChatIds();
  if (!swamiIds.length) return;

  const { rows } = await pool.query(
    `SELECT b.*, rt.name AS room_type_name, rt.capacity_cap
     FROM bookings b
     LEFT JOIN room_types rt ON rt.id = b.room_type_id
     WHERE b.id = $1`,
    [bookingId]
  );
  const b = rows[0];
  if (!b) return;

  const { rows: bookedRows } = await pool.query(
    `SELECT COALESCE(SUM(num_rooms), 0)::int AS booked
     FROM bookings
     WHERE room_type_id = $1 AND status IN ('pending','approved','modified','checked_in')
       AND checkin_date < $3 AND checkout_date > $2`,
    [b.room_type_id, b.checkin_date, b.checkout_date]
  );
  const booked = bookedRows[0]?.booked ?? 0;
  const avail = Math.max(0, (b.capacity_cap ?? 0) - booked);
  const msg = bookingCardHtml(b, `${avail} of ${b.capacity_cap ?? 0} available for these dates`);
  const reply_markup = approvalButtons(b.id);

  await Promise.all(swamiIds.map((id) => sendMessage(id, msg, { reply_markup })));
}

async function formatBhojanMessage() {
  const data = await getDiningData(pool);
  const { settings } = await getAuthorizedChatIds();
  const orgName = settings.org_name || 'BAPS Jaipur Utara';
  const m = data.meals || {};
  const b = m.breakfast || { total: 0, men: 0, women: 0, children: 0, parties: 0 };
  const l = m.lunch || { total: 0, men: 0, women: 0, children: 0, parties: 0 };
  const d = m.dinner || { total: 0, men: 0, women: 0, children: 0, parties: 0 };

  const lines = [
    `🍽️ <b>${escHtml(orgName)} — Bhojanshala Count</b>`,
    `📅 <b>Date:</b> ${fmtDateIn(data.date)}`,
    '',
    `🌅 <b>Breakfast:</b> <b>${b.total}</b> (M:${b.men} / F:${b.women} / K:${b.children}) · ${b.parties} room(s)`,
    `☀️ <b>Lunch:</b> <b>${l.total}</b> (M:${l.men} / F:${l.women} / K:${l.children}) · ${l.parties} room(s)`,
    `🌙 <b>Dinner:</b> <b>${d.total}</b> (M:${d.men} / F:${d.women} / K:${d.children}) · ${d.parties} room(s)`,
  ];

  if (data.guests?.length) {
    lines.push('', `<b>Room-wise Opt-in (${data.guests.length}):</b>`);
    data.guests.slice(0, 15).forEach((g) => {
      const meals = [g.dineBreakfast ? 'B' : null, g.dineLunch ? 'L' : null, g.dineDinner ? 'D' : null].filter(Boolean).join('/') || '-';
      lines.push(`• ${escHtml(g.rooms || '-')} (${g.total} pax) [${meals}]`);
    });
    if (data.guests.length > 15) lines.push(`<i>…and ${data.guests.length - 15} more</i>`);
  } else {
    lines.push('', '<i>No guests currently checked in.</i>');
  }

  return lines.join('\n');
}

async function sendBhojanToTelegram() {
  if (!getBotToken()) return { sent: false, error: 'TELEGRAM_NOT_CONFIGURED' };
  const { bhojanIds } = await getAuthorizedChatIds();
  if (!bhojanIds.length) return { sent: false, error: 'NO_BHOJAN_CHAT_ID' };
  const msg = await formatBhojanMessage();
  await Promise.all(bhojanIds.map((id) => sendMessage(id, msg, { reply_markup: BHOJAN_KEYBOARD })));
  return { sent: true, recipients: bhojanIds.length };
}

async function formatDailyReportMessage() {
  const { date: today } = istNowParts();
  const monthStart = `${today.slice(0, 8)}01`;
  const [occ, act, todayRev, monthRev, dining, pendingRes] = await Promise.all([
    getRoomStatusOccupancy(pool),
    getTodayActivity(pool, today),
    revenueBetween(pool, today, today),
    revenueBetween(pool, monthStart, today),
    getDiningData(pool),
    pool.query(`SELECT COUNT(*)::int AS c FROM bookings WHERE status = 'pending'`),
  ]);

  const m = dining.meals || {};
  return [
    `📊 <b>Daily Operations Report — ${fmtDateIn(today)}</b>`,
    '',
    `🏨 <b>Rooms:</b> ${occ.occupied}/${occ.totalRooms} occupied · ${occ.ready} ready · ${occ.maintenance} maintenance`,
    `📥 <b>Today Check-ins:</b> ${act.checkins} | 📤 <b>Check-outs:</b> ${act.checkouts}`,
    `⏳ <b>Pending Approvals:</b> ${pendingRes.rows[0]?.c ?? 0}`,
    '',
    `💰 <b>Today Revenue:</b> ₹${Number(todayRev.revenue || 0).toLocaleString('en-IN')}`,
    `🗓️ <b>This Month Revenue:</b> ₹${Number(monthRev.revenue || 0).toLocaleString('en-IN')}`,
    '',
    `🍽️ <b>Bhojanshala Today:</b> B:${m.breakfast?.total || 0} · L:${m.lunch?.total || 0} · D:${m.dinner?.total || 0}`,
  ].join('\n');
}

async function handleSwamiText(chatId, text, io) {
  if (text === '/start' || text === '/menu') {
    await sendMessage(
      chatId,
      `🙏 <b>Jai Swaminarayan!</b>\nWelcome to <b>BAPS Jaipur Utara</b> Swami Ji Portal.\n\nUse the menu buttons below, or <b>forward any guest WhatsApp booking message</b> here to create & approve it directly.`,
      { reply_markup: SWAMI_KEYBOARD }
    );
    return;
  }

  if (text === '📋 Pending Requests') {
    const { rows } = await pool.query(
      `SELECT b.*, rt.name AS room_type_name
       FROM bookings b
       LEFT JOIN room_types rt ON rt.id = b.room_type_id
       WHERE b.status = 'pending'
       ORDER BY b.created_at DESC
       LIMIT 10`
    );
    if (!rows.length) {
      await sendMessage(chatId, '✅ No pending stay requests right now.', { reply_markup: SWAMI_KEYBOARD });
      return;
    }
    for (const b of rows) {
      await sendMessage(chatId, bookingCardHtml(b), { reply_markup: approvalButtons(b.id) });
    }
    return;
  }

  if (text === '✅ Approved') {
    const { rows } = await pool.query(
      `SELECT b.booking_code, b.guest_name, b.checkin_date, b.checkout_date, b.num_rooms, b.billing_tier, rt.name AS room_type_name
       FROM bookings b
       LEFT JOIN room_types rt ON rt.id = b.room_type_id
       WHERE b.status IN ('approved','modified') AND b.checkout_date >= CURRENT_DATE
       ORDER BY b.checkin_date ASC
       LIMIT 15`
    );
    if (!rows.length) {
      await sendMessage(chatId, 'No upcoming approved bookings.', { reply_markup: SWAMI_KEYBOARD });
      return;
    }
    const lines = ['✅ <b>Upcoming Approved Bookings:</b>', ''];
    rows.forEach((b) => {
      lines.push(`• <b>${escHtml(b.guest_name)}</b> (${escHtml(b.booking_code || '')}) — ${fmtDateIn(b.checkin_date)} → ${fmtDateIn(b.checkout_date)} · ${escHtml(b.room_type_name || '')} ×${b.num_rooms} [${escHtml(b.billing_tier || 'paid')}]`);
    });
    await sendMessage(chatId, lines.join('\n'), { reply_markup: SWAMI_KEYBOARD });
    return;
  }

  if (text === '🏨 Live Occupancy') {
    const occ = await getRoomStatusOccupancy(pool);
    const { rows: floors } = await pool.query(
      `SELECT f.name, COUNT(r.id)::int AS total,
              COUNT(*) FILTER (WHERE r.status = 'occupied')::int AS occupied,
              COUNT(*) FILTER (WHERE r.status = 'ready')::int AS ready
       FROM floors f
       LEFT JOIN rooms r ON r.floor_id = f.id
       GROUP BY f.id, f.name, f.sort_order
       ORDER BY f.sort_order, f.name`
    );
    const lines = [
      `🏨 <b>Live Room Occupancy</b>`,
      `Occupied: <b>${occ.occupied}</b> / ${occ.totalRooms} · Ready: <b>${occ.ready}</b> · Maintenance: ${occ.maintenance}`,
      '',
      ...floors.map((f) => `• <b>${escHtml(f.name)}:</b> ${f.occupied}/${f.total} occupied (${f.ready} ready)`),
    ];
    await sendMessage(chatId, lines.join('\n'), { reply_markup: SWAMI_KEYBOARD });
    return;
  }

  if (text === '📊 Income & Occupancy') {
    const msg = await formatDailyReportMessage();
    await sendMessage(chatId, msg, { reply_markup: SWAMI_KEYBOARD });
    return;
  }

  if (text === '🍽️ Bhojanshala') {
    const msg = await formatBhojanMessage();
    await sendMessage(chatId, msg, { reply_markup: SWAMI_KEYBOARD });
    return;
  }

  if (text === '📅 Future Bookings') {
    const { rows } = await pool.query(
      `SELECT b.guest_name, b.checkin_date, b.checkout_date, b.status, b.num_rooms, rt.name AS room_type_name
       FROM bookings b
       LEFT JOIN room_types rt ON rt.id = b.room_type_id
       WHERE b.status IN ('pending','approved','modified') AND b.checkin_date >= CURRENT_DATE
       ORDER BY b.checkin_date ASC
       LIMIT 15`
    );
    if (!rows.length) {
      await sendMessage(chatId, 'No future bookings scheduled.', { reply_markup: SWAMI_KEYBOARD });
      return;
    }
    const lines = ['📅 <b>Future Bookings (Next Arrivals):</b>', ''];
    rows.forEach((b) => {
      const icon = b.status === 'pending' ? '⏳' : '✅';
      lines.push(`${icon} <b>${fmtDateIn(b.checkin_date)}</b>: ${escHtml(b.guest_name)} · ${escHtml(b.room_type_name || '')} ×${b.num_rooms}`);
    });
    await sendMessage(chatId, lines.join('\n'), { reply_markup: SWAMI_KEYBOARD });
    return;
  }

  // Otherwise try parsing as a forwarded WhatsApp booking template!
  const parsed = parseWhatsAppBooking(text);
  if (parsed && parsed.guestName && parsed.checkinDate) {
    const { rows: roomTypes } = await pool.query(`SELECT id, name, base_price FROM room_types ORDER BY id`);
    const hint = (parsed.roomRequire || '').toLowerCase();
    const matchedRt =
      roomTypes.find((rt) => hint && rt.name.toLowerCase().includes(hint.replace(/\s*room\s*/g, '').trim())) ||
      roomTypes.find((rt) => hint && hint.includes(rt.name.toLowerCase())) ||
      roomTypes[0];

    const checkoutDate = parsed.checkoutDate && parsed.checkoutDate > parsed.checkinDate
      ? parsed.checkoutDate
      : (() => {
          const [y, m, d] = parsed.checkinDate.split('-').map(Number);
          return new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10);
        })();

    const draftId = crypto.randomBytes(6).toString('hex');
    pendingWaDrafts.set(draftId, {
      parsed: { ...parsed, checkoutDate },
      roomType: matchedRt,
      createdAt: Date.now(),
    });
    // Prune old drafts (> 1 hour)
    for (const [k, v] of pendingWaDrafts.entries()) {
      if (Date.now() - v.createdAt > 3600000) pendingWaDrafts.delete(k);
    }

    const preview = [
      `📥 <b>Parsed WhatsApp Booking</b>`,
      `👤 <b>Name:</b> ${escHtml(parsed.guestName)}`,
      `📞 <b>Mobile:</b> ${escHtml(parsed.mobile || '-')}`,
      parsed.guestCity ? `🏙️ <b>City:</b> ${escHtml(parsed.guestCity)}` : null,
      `📅 <b>Dates:</b> ${fmtDateIn(parsed.checkinDate)} → ${fmtDateIn(checkoutDate)}`,
      `👥 <b>Pax:</b> M:${parsed.paxMen} / F:${parsed.paxWomen} / K:${parsed.paxChildren}`,
      `🛏️ <b>Room Type:</b> ${escHtml(matchedRt?.name || 'Default')}`,
      parsed.santReferenceName ? `🪷 <b>Sant Ref:</b> ${escHtml(parsed.santReferenceName)}` : null,
    ].filter(Boolean).join('\n');

    await sendMessage(chatId, preview, {
      reply_markup: {
        inline_keyboard: [
          [
            { text: '✅ Book & Approve (Standard)', callback_data: `wa_book:${draftId}:paid` },
            { text: '🙏 Book & Approve (FOC)', callback_data: `wa_book:${draftId}:foc` },
          ],
          [
            { text: '📋 Save Pending', callback_data: `wa_book:${draftId}:pending` },
            { text: '❌ Cancel', callback_data: `wa_cancel:${draftId}` },
          ],
        ],
      },
    });
    return;
  }

  await sendMessage(
    chatId,
    'Tap a menu button below or forward a guest WhatsApp booking template to create a booking.',
    { reply_markup: SWAMI_KEYBOARD }
  );
}

async function handleCallbackQuery(cq, io) {
  const chatId = String(cq.message?.chat?.id || '');
  const messageId = cq.message?.message_id;
  const data = cq.data || '';

  const { swamiIds } = await getAuthorizedChatIds();
  if (!swamiIds.includes(chatId)) {
    await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'Unauthorized', show_alert: true });
    return;
  }

  const [action, idOrDraft, tier] = data.split(':');

  if (action === 'approve' || action === 'reject') {
    const nextStatus = action === 'approve' ? 'approved' : 'rejected';
    const { rows } = await pool.query(
      `SELECT b.*, rt.base_price FROM bookings b LEFT JOIN room_types rt ON rt.id = b.room_type_id WHERE b.id = $1`,
      [idOrDraft]
    );
    const b = rows[0];
    if (!b) {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'Booking not found' });
      return;
    }

    let finalAmount = b.final_amount;
    if (action === 'approve') {
      const nights = Math.max(1, Math.round((new Date(b.checkout_date) - new Date(b.checkin_date)) / 86400000));
      const base = Number(b.base_price || 0) * Number(b.num_rooms || 1) * nights;
      finalAmount = tier === 'foc' ? 0 : tier === 'discounted' ? Math.round(base * 0.5) : base;
    }

    await pool.query(
      `UPDATE bookings
       SET status = $1,
           billing_tier = COALESCE($2, billing_tier),
           final_amount = COALESCE($3, final_amount),
           approved_at = CASE WHEN $1 = 'approved' THEN now() ELSE approved_at END,
           updated_at = now()
       WHERE id = $4`,
      [nextStatus, action === 'approve' ? (tier || 'paid') : null, action === 'approve' ? finalAmount : null, b.id]
    );

    if (io) {
      io.emit(action === 'approve' ? 'booking:approved' : 'booking:rejected', { id: b.id, status: nextStatus });
    }

    const badge = action === 'approve'
      ? `\n\n✅ <b>APPROVED (${(tier || 'paid').toUpperCase()}) via Telegram</b>`
      : `\n\n❌ <b>REJECTED via Telegram</b>`;

    await tgCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `${cq.message.text || ''}${badge}`,
      parse_mode: 'HTML',
    });
    await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: action === 'approve' ? 'Booking Approved!' : 'Booking Rejected' });
    return;
  }

  if (action === 'wa_cancel') {
    pendingWaDrafts.delete(idOrDraft);
    await tgCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: '❌ WhatsApp booking draft cancelled.',
    });
    await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'Cancelled' });
    return;
  }

  if (action === 'wa_book') {
    const draft = pendingWaDrafts.get(idOrDraft);
    if (!draft) {
      await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: 'Draft expired — please forward again.', show_alert: true });
      return;
    }
    const { parsed, roomType } = draft;
    const isPending = tier === 'pending';
    const status = isPending ? 'pending' : 'approved';
    const billingTier = isPending ? null : (tier || 'paid');
    const nights = Math.max(1, Math.round((new Date(parsed.checkoutDate) - new Date(parsed.checkinDate)) / 86400000));
    const finalAmount = isPending ? null : (billingTier === 'foc' ? 0 : Number(roomType?.base_price || 0) * nights);
    const bookingCode = await makeBookingCode(pool);

    const { rows } = await pool.query(
      `INSERT INTO bookings
        (booking_code, channel, num_rooms, guest_name, mobile, guest_city, pax_men, pax_women, pax_children,
         checkin_date, checkout_date, sant_reference_name, room_type_id, status, billing_tier, final_amount,
         preferred_arrival_time, preferred_departure_time, approved_at)
       VALUES ($1,'online',1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,
         CASE WHEN $12 = 'approved' THEN now() ELSE NULL END)
       RETURNING *`,
      [
        bookingCode,
        parsed.guestName,
        parsed.mobile || '0000000000',
        parsed.guestCity || null,
        parsed.paxMen || 0,
        parsed.paxWomen || 0,
        parsed.paxChildren || 0,
        parsed.checkinDate,
        parsed.checkoutDate,
        parsed.santReferenceName || 'Swami Ji Telegram',
        roomType?.id,
        status,
        billingTier,
        finalAmount,
        parsed.preferredArrivalTime || null,
        parsed.preferredDepartureTime || null,
      ]
    );
    pendingWaDrafts.delete(idOrDraft);
    if (io) io.emit('booking:new', rows[0]);

    await tgCall('editMessageText', {
      chat_id: chatId,
      message_id: messageId,
      text: `✅ <b>Booking Created (${escHtml(bookingCode)})</b>\n👤 ${escHtml(parsed.guestName)}\n📅 ${fmtDateIn(parsed.checkinDate)} → ${fmtDateIn(parsed.checkoutDate)}\nStatus: <b>${status.toUpperCase()}${billingTier ? ` (${billingTier.toUpperCase()})` : ''}</b>`,
      parse_mode: 'HTML',
    });
    await tgCall('answerCallbackQuery', { callback_query_id: cq.id, text: `Created ${bookingCode}` });
  }
}

async function handleWebhookUpdate(update, io) {
  if (!update) return;
  if (update.callback_query) {
    await handleCallbackQuery(update.callback_query, io);
    return;
  }
  const msg = update.message;
  if (!msg || !msg.chat) return;
  const chatId = String(msg.chat.id);
  const text = (msg.text || msg.caption || '').trim();

  const { swamiIds, bhojanIds } = await getAuthorizedChatIds();
  if (swamiIds.includes(chatId)) {
    await handleSwamiText(chatId, text, io);
    return;
  }
  if (bhojanIds.includes(chatId)) {
    if (text === '/start' || text === "🍽️ Today's Meal Count") {
      const bhojanMsg = await formatBhojanMessage();
      await sendMessage(chatId, bhojanMsg, { reply_markup: BHOJAN_KEYBOARD });
    } else {
      await sendMessage(chatId, `Tap <b>🍽️ Today's Meal Count</b> below to view today's Bhojanshala headcount.`, {
        reply_markup: BHOJAN_KEYBOARD,
      });
    }
    return;
  }

  await sendMessage(
    chatId,
    `🙏 <b>Jai Swaminarayan!</b>\n\nYour Telegram Chat ID is:\n<code>${escHtml(chatId)}</code>\n\nPlease share this number with the Utara Admin in <b>Admin Portal → Settings → Telegram Bot</b> to activate your access.`
  );
}

async function registerWebhook() {
  const token = getBotToken();
  const baseUrl = (process.env.PUBLIC_API_URL || process.env.RENDER_EXTERNAL_URL || '').trim().replace(/\/+$/, '');
  if (!token || !baseUrl) return;
  const secret = getWebhookSecret();
  const url = `${baseUrl}/telegram/webhook`;
  const res = await tgCall('setWebhook', {
    url,
    secret_token: secret,
    allowed_updates: ['message', 'callback_query'],
  });
  if (res?.ok) {
    console.log(`Telegram webhook registered: ${url}`);
  }
}

async function runTelegramSchedulersIfDue() {
  if (!getBotToken()) return;
  const { swamiIds, bhojanIds, settings } = await getAuthorizedChatIds();
  const { date: today, minutes: nowMin } = istNowParts();

  // 1. Swami Ji Daily Report
  const dailyEnabled = settings.telegram_daily_report_enabled === true || settings.telegram_daily_report_enabled === 'true';
  const dailyTime = parseHHMM(settings.telegram_daily_report_time || process.env.TELEGRAM_DAILY_REPORT_TIME);
  if (dailyEnabled && dailyTime !== null && swamiIds.length && nowMin >= dailyTime && settings.telegram_daily_last_sent !== today) {
    await setSetting('telegram_daily_last_sent', today);
    const msg = await formatDailyReportMessage();
    await Promise.all(swamiIds.map((id) => sendMessage(id, msg, { reply_markup: SWAMI_KEYBOARD })));
  }

  // 2. Bhojanshala Daily Count
  const bhojanEnabled = settings.telegram_bhojan_report_enabled === true || settings.telegram_bhojan_report_enabled === 'true';
  const bhojanTime = parseHHMM(settings.telegram_bhojan_report_time);
  if (bhojanEnabled && bhojanTime !== null && bhojanIds.length && nowMin >= bhojanTime && settings.telegram_bhojan_last_sent !== today) {
    await setSetting('telegram_bhojan_last_sent', today);
    const msg = await formatBhojanMessage();
    await Promise.all(bhojanIds.map((id) => sendMessage(id, msg, { reply_markup: BHOJAN_KEYBOARD })));
  }
}

module.exports = {
  getWebhookSecret,
  handleWebhookUpdate,
  notifyNewBookingRequest,
  sendBhojanToTelegram,
  registerWebhook,
  runTelegramSchedulersIfDue,
};
