import React, { createContext, useContext, useState, useEffect, useCallback, useRef } from 'react';
import { fetchObject } from '../lib/api';

/**
 * AuthContext
 *
 * Single source of truth for the session JWT, the logged-in user, and a
 * shared Socket.io connection authenticated with that JWT. Persists the
 * token to localStorage so a refresh doesn't drop the session.
 *
 * Usage: wrap the app in <AuthProvider apiBaseUrl=... socketUrl=... io={ioClientFn}>
 * and read `useAuth()` anywhere below it.
 */
const AuthContext = createContext(null);

const STORAGE_KEY = 'baps_hms_session';

export function AuthProvider({ apiBaseUrl, socketUrl, io, children }) {
  const [session, setSession] = useState(() => {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw ? JSON.parse(raw) : null;
    } catch {
      return null;
    }
  });
  const socketRef = useRef(null);
  const [settings, setSettings] = useState({});

  // Cache a few app-wide settings — currently the scheduled check-in/out default
  // times the date/time formatters fall back to (see lib/datetime.js). Public
  // endpoint, so it works pre-login too; re-pulled when the token changes so a
  // staff edit to the defaults is picked up next session. Safe-fetched: a failure
  // just leaves the built-in fallbacks ('14:00' / '11:00') in place.
  useEffect(() => {
    let active = true;
    fetchObject(`${apiBaseUrl}/settings`, {}, {}).then((s) => {
      if (active) setSettings(s && typeof s === 'object' ? s : {});
    });
    return () => { active = false; };
  }, [apiBaseUrl, session?.token]);

  // (Re)connect the shared socket whenever we have a token
  useEffect(() => {
    socketRef.current?.disconnect();
    socketRef.current = null;

    if (session?.token) {
      const socket = io(socketUrl, { auth: { token: session.token } });
      socketRef.current = socket;
    }

    return () => socketRef.current?.disconnect();
  }, [session?.token, socketUrl, io]);

  const persist = (next) => {
    setSession(next);
    if (next) localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    else localStorage.removeItem(STORAGE_KEY);
  };

  /**
   * Login for all three staff roles — Admin, Swami Ji, and Receptionist.
   * There's no separate geofenced flow anymore since Reception runs locally.
   */
  const login = useCallback(async (mobile, password) => {
    const res = await fetch(`${apiBaseUrl}/auth/login`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mobile, password }),
    });
    const body = await res.json();
    if (!res.ok) throw new Error(body.message || body.error || 'Login failed');
    persist({ token: body.token, user: body.user });
    return body.user;
  }, [apiBaseUrl]);

  /** Sets the session directly from a token/user pair (used if a future flow obtains a token outside login()). */
  const setSessionFromToken = useCallback((token, user) => {
    persist({ token, user });
  }, []);

  const logout = useCallback(() => {
    persist(null);
  }, []);

  const value = {
    token: session?.token ?? null,
    user: session?.user ?? null,
    role: session?.user?.role ?? null,
    isAuthenticated: !!session?.token,
    socket: socketRef.current,
    settings,
    defaultCheckinTime: settings.default_checkin_time || '14:00',
    defaultCheckoutTime: settings.default_checkout_time || '11:00',
    login,
    setSessionFromToken,
    logout,
    apiBaseUrl,
  };

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within an AuthProvider');
  return ctx;
}
