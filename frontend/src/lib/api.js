/**
 * lib/api.js
 *
 * Small fetch helpers that prevent the exact class of bug that crashed
 * ReceptionPortal ("x.map is not a function"): every list-rendering screen
 * called `setXxx(await res.json())` and assumed the response was always an
 * array. If the backend ever returns an error object instead (auth
 * failure, permission denied, a stale schema after an update, a network
 * hiccup) — that assumption breaks and .map() throws, crashing the whole
 * page instead of just showing "no data".
 *
 * fetchArray always resolves to an array — [] on any failure — and logs
 * the real problem to the console so it's still debuggable.
 */

export async function fetchArray(url, options) {
  try {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => null);
    if (!res.ok || !Array.isArray(body)) {
      if (!res.ok) console.error(`Request failed (${res.status}) for ${url}:`, body);
      else console.error(`Expected an array from ${url} but got:`, body);
      return [];
    }
    return body;
  } catch (err) {
    console.error(`Network error fetching ${url}:`, err);
    return [];
  }
}

/** Same idea for a single object response — never returns null/undefined into state that gets rendered. */
export async function fetchObject(url, options, fallback = {}) {
  try {
    const res = await fetch(url, options);
    const body = await res.json().catch(() => null);
    if (!res.ok || !body || typeof body !== 'object') {
      if (!res.ok) console.error(`Request failed (${res.status}) for ${url}:`, body);
      return fallback;
    }
    return body;
  } catch (err) {
    console.error(`Network error fetching ${url}:`, err);
    return fallback;
  }
}
