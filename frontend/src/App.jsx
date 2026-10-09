import React from 'react';
import { BrowserRouter, Routes, Route, Navigate, useNavigate } from 'react-router-dom';
import { io } from 'socket.io-client';
import { AuthProvider, useAuth } from './context/AuthContext';
import ProtectedRoute from './components/ProtectedRoute';
import CustomerPortal from './portals/CustomerPortal';
import ReceptionPortal from './portals/ReceptionPortal';
import StaffLogin from './components/StaffLogin';
import SwamiPortal from './portals/SwamiPortal';
import AdminPortal from './portals/AdminPortal';
import MobileIdCapture from './components/MobileIdCapture';

/**
 * App
 *
 * Route map:
 *   /                     Customer booking form (public)
 *   /upload-id/:sessionId Mobile ID-capture page opened by the QR flow (public)
 *   /login                Shared login for all three staff roles
 *   /reception            Reception floor board + walk-ins (protected: Receptionist)
 *   /swami                Swami Ji approval dashboard (protected: Swami Ji)
 *   /admin                Admin portal (protected: Admin)
 *   /unauthorized         Shown when a logged-in role hits a route it can't access
 *
 * There's no separate geofenced Reception login anymore — Reception runs
 * locally on the front-desk PC, so all three roles share the same plain
 * login screen and get routed to their portal based on what the backend
 * returns.
 *
 * The backend address is resolved at runtime (see resolveApiBase) so ONE build
 * works in every setup — local dev, the Reception PC (backend serves this build
 * on the same origin), and a separately-hosted public site that sets
 * REACT_APP_API_BASE_URL. See SETUP.md.
 */

/**
 * Where the backend lives, resolved at runtime so a single build runs anywhere:
 *   1. An explicit build-time env var always wins — set REACT_APP_API_BASE_URL
 *      when the frontend is hosted apart from the backend (e.g. on Cloudflare
 *      Pages pointing at a Cloudflare Tunnel URL for the public website).
 *   2. Local CRA dev (localhost:3000) talks to the backend on :4000.
 *   3. Otherwise the backend serves this build on the SAME origin (the one-
 *      command Reception-PC setup — reached by LAN IP, a local hostname, or the
 *      public domain), so we use window.location.origin and never rebuild when
 *      that address changes.
 */
function resolveApiBase() {
  if (process.env.REACT_APP_API_BASE_URL) return process.env.REACT_APP_API_BASE_URL;
  if (typeof window !== 'undefined') {
    const { hostname, origin } = window.location;
    if (hostname === 'localhost' || hostname === '127.0.0.1') return 'http://localhost:4000';
    return origin;
  }
  return 'http://localhost:4000';
}

const API_BASE_URL = resolveApiBase();
const SOCKET_URL = process.env.REACT_APP_SOCKET_URL || API_BASE_URL;

const ROLE_HOME_PATHS = {
  Admin: '/admin',
  'Swami Ji': '/swami',
  Receptionist: '/reception',
};

export default function App() {
  return (
    <AuthProvider apiBaseUrl={API_BASE_URL} socketUrl={SOCKET_URL} io={io}>
      <BrowserRouter>
        <Routes>
          <Route path="/" element={<CustomerPortal apiBaseUrl={API_BASE_URL} />} />
          <Route path="/upload-id/:sessionId" element={<MobileIdCapture apiBaseUrl={API_BASE_URL} />} />

          <Route path="/login" element={<LoginRoute />} />

          <Route
            path="/reception"
            element={
              <ProtectedRoute allowedRoles={['Receptionist']}>
                <ReceptionPortal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/swami"
            element={
              <ProtectedRoute allowedRoles={['Swami Ji']}>
                <SwamiPortal />
              </ProtectedRoute>
            }
          />
          <Route
            path="/admin"
            element={
              <ProtectedRoute allowedRoles={['Admin']}>
                <AdminPortal />
              </ProtectedRoute>
            }
          />

          <Route path="/unauthorized" element={<UnauthorizedScreen />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </BrowserRouter>
    </AuthProvider>
  );
}

function LoginRoute() {
  const navigate = useNavigate();
  const { isAuthenticated, role } = useAuth();

  if (isAuthenticated && ROLE_HOME_PATHS[role]) {
    return <Navigate to={ROLE_HOME_PATHS[role]} replace />;
  }

  return (
    <StaffLogin
      onLoginSuccess={(user) => {
        navigate(ROLE_HOME_PATHS[user.role] || '/');
      }}
    />
  );
}

function UnauthorizedScreen() {
  return (
    <div className="min-h-screen bg-[#F8F4EC] flex items-center justify-center px-4">
      <div className="text-center">
        <h1 className="font-serif text-2xl text-[#2B1610] mb-2">Not authorized</h1>
        <p className="text-sm text-[#2B1610]/50">Your account doesn't have access to this area.</p>
      </div>
    </div>
  );
}
