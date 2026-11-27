/**
 * lib/offlineSync.js
 *
 * Transparent offline support for BAPS Jaipur Utara HMS:
 *  - Caches GET JSON responses in localStorage so Floor Board, Room Types,
 *    Add-ons, Settings, and Bookings still load when offline.
 *  - Queues mutating requests (POST / PUT / PATCH / DELETE) when offline (or
 *    when fetch fails due to network drop) and replays them automatically in
 *    FIFO order once internet returns.
 */

const QUEUE_KEY = 'baps_offline_queue_v1';
const CACHE_PREFIX = 'baps_api_cache_v1:';

const listeners = new Set();
let nativeFetch = null;
let syncing = false;
let lastSyncResult = null; // { ok, count, error }

function readQueue() {
  try {
    const raw = localStorage.getItem(QUEUE_KEY);
    const arr = raw ? JSON.parse(raw) : [];
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

function writeQueue(items) {
  try {
    localStorage.setItem(QUEUE_KEY, JSON.stringify(items));
  } catch {
    /* ignore quota errors */
  }
  notify();
}

function getState() {
  return {
    online: typeof navigator !== 'undefined' ? navigator.onLine : true,
    pendingCount: readQueue().length,
    syncing,
    lastSyncResult,
  };
}

function notify() {
  const state = getState();
  listeners.forEach((fn) => {
    try { fn(state); } catch { /* ignore */ }
  });
}

export function subscribeOfflineState(fn) {
  listeners.add(fn);
  fn(getState());
  return () => listeners.delete(fn);
}

function isApiPath(urlStr) {
  try {
    const u = new URL(urlStr, window.location.origin);
    const p = u.pathname;
    if (p.startsWith('/static/') || p.startsWith('/uploads/') || p.endsWith('.html') || p.endsWith('.js') || p.endsWith('.css')) {
      return false;
    }
    return (
      p.startsWith('/bookings') ||
      p.startsWith('/rooms') ||
      p.startsWith('/inventory') ||
      p.startsWith('/settings') ||
      p.startsWith('/reports') ||
      p.startsWith('/bhojan') ||
      p.startsWith('/roles') ||
      p.startsWith('/backup') ||
      p.startsWith('/auth')
    );
  } catch {
    return false;
  }
}

function shouldSkipQueue(urlStr, method) {
  if (method === 'GET' || method === 'HEAD') return true;
  if (urlStr.includes('/auth/login')) return true;
  if (urlStr.includes('/id-uploads/')) return true;
  if (urlStr.includes('/backup/upload-restore')) return true;
  if (urlStr.includes('/health')) return true;
  return false;
}

function jsonResponse(data, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

function buildOfflineSyntheticResponse(urlStr, bodyStr) {
  let parsed = {};
  try { parsed = bodyStr ? JSON.parse(bodyStr) : {}; } catch { /* ignore */ }
  if (urlStr.includes('/bookings/walkin')) {
    return {
      id: `offline-${Date.now()}`,
      booking_code: 'OFFLINE-PENDING',
      guest_name: parsed.guestName || 'Guest',
      mobile: parsed.mobile || '',
      checkin_date: parsed.checkinDate,
      checkout_date: parsed.checkoutDate,
      status: parsed.checkinNow ? 'checked_in' : (parsed.autoApprove ? 'approved' : 'pending'),
      offlineQueued: true,
    };
  }
  return { ok: true, offlineQueued: true };
}

function describeAction(method, urlStr) {
  if (urlStr.includes('/bookings/walkin')) return 'Walk-in / Check-in';
  if (urlStr.includes('/checkin')) return 'Check-in';
  if (urlStr.includes('/checkout')) return 'Check-out';
  if (urlStr.includes('/decide')) return 'Booking approval';
  if (urlStr.includes('/pay')) return 'Payment';
  if (urlStr.includes('/settings')) return 'Settings update';
  if (urlStr.includes('/dining')) return 'Bhojanshala meal update';
  return `${method} request`;
}

export async function syncOfflineQueue() {
  if (syncing || !nativeFetch) return;
  if (typeof navigator !== 'undefined' && !navigator.onLine) return;

  const queue = readQueue();
  if (queue.length === 0) return;

  syncing = true;
  lastSyncResult = null;
  notify();

  let syncedCount = 0;
  let remaining = [...queue];
  let errorMsg = null;

  while (remaining.length > 0) {
    const item = remaining[0];
    try {
      const res = await nativeFetch(item.url, {
        method: item.method,
        headers: item.headers,
        body: item.body ?? undefined,
      });
      if (!res.ok) {
        const errBody = await res.json().catch(() => ({}));
        errorMsg = `${item.label}: ${errBody.message || errBody.error || `HTTP ${res.status}`}`;
        break;
      }
      remaining.shift();
      syncedCount++;
      writeQueue(remaining);
    } catch {
      errorMsg = 'Connection lost while syncing. Will retry when online.';
      break;
    }
  }

  syncing = false;
  lastSyncResult = errorMsg
    ? { ok: false, count: syncedCount, error: errorMsg }
    : { ok: true, count: syncedCount, error: null };
  notify();

  if (syncedCount > 0) {
    window.dispatchEvent(new CustomEvent('baps:offline-synced', { detail: { syncedCount } }));
  }
}

export function clearFailedQueueItem() {
  const queue = readQueue();
  if (queue.length > 0) {
    queue.shift();
    writeQueue(queue);
  }
  lastSyncResult = null;
  notify();
}

export function installOfflineInterceptor() {
  if (typeof window === 'undefined' || nativeFetch) return;
  nativeFetch = window.fetch.bind(window);

  window.addEventListener('online', () => {
    notify();
    syncOfflineQueue();
  });
  window.addEventListener('offline', () => {
    lastSyncResult = null;
    notify();
  });

  window.fetch = async (input, init = {}) => {
    const urlStr = typeof input === 'string' ? input : (input?.url || '');
    const method = String(init.method || (typeof input !== 'string' && input?.method) || 'GET').toUpperCase();

    if (!isApiPath(urlStr)) {
      return nativeFetch(input, init);
    }

    // 1. GET requests: Network-first with localStorage cache fallback
    if (method === 'GET') {
      const cacheKey = `${CACHE_PREFIX}${urlStr}`;
      if (!navigator.onLine) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return jsonResponse(JSON.parse(cached), 200);
        return jsonResponse({ error: 'OFFLINE_NO_CACHE' }, 503);
      }
      try {
        const res = await nativeFetch(input, init);
        if (res.ok) {
          const clone = res.clone();
          clone.text().then((txt) => {
            try {
              JSON.parse(txt);
              localStorage.setItem(cacheKey, txt);
            } catch { /* non-JSON, e.g. PDF */ }
          }).catch(() => {});
        }
        return res;
      } catch (err) {
        const cached = localStorage.getItem(cacheKey);
        if (cached) return jsonResponse(JSON.parse(cached), 200);
        throw err;
      }
    }

    // 2. Mutations: Skip queue for login / binary uploads
    if (shouldSkipQueue(urlStr, method)) {
      return nativeFetch(input, init);
    }

    const queueItem = () => {
      const bodyStr = typeof init.body === 'string' ? init.body : null;
      const headersObj = init.headers ? Object.fromEntries(new Headers(init.headers).entries()) : {};
      const queue = readQueue();
      queue.push({
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
        url: urlStr,
        method,
        headers: headersObj,
        body: bodyStr,
        label: describeAction(method, urlStr),
        createdAt: new Date().toISOString(),
      });
      writeQueue(queue);
      return jsonResponse(buildOfflineSyntheticResponse(urlStr, bodyStr), 200);
    };

    if (!navigator.onLine) {
      return queueItem();
    }

    try {
      return await nativeFetch(input, init);
    } catch (err) {
      // Only queue on network failure (TypeError), not programming errors
      if (err instanceof TypeError || !navigator.onLine) {
        return queueItem();
      }
      throw err;
    }
  };

  // Attempt sync on startup if already online with pending items
  if (navigator.onLine && readQueue().length > 0) {
    setTimeout(() => syncOfflineQueue(), 1500);
  }
}
