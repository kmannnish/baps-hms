import React from 'react';
import { Navigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';

/**
 * ProtectedRoute
 *
 * Wraps a portal route. Redirects to /login if unauthenticated, or to
 * /unauthorized if the logged-in user's role isn't in `allowedRoles`.
 * Role names are compared as-is against whatever /auth/login returned in
 * `user.role` — since roles are admin-defined, keep `allowedRoles` in sync
 * with whatever names your Admin actually creates.
 *
 * Usage:
 *   <ProtectedRoute allowedRoles={['Admin']}>
 *     <AdminPortal />
 *   </ProtectedRoute>
 */
export default function ProtectedRoute({ children, allowedRoles, loginPath = '/login' }) {
  const { isAuthenticated, role } = useAuth();

  if (!isAuthenticated) return <Navigate to={loginPath} replace />;
  if (allowedRoles && !allowedRoles.includes(role)) return <Navigate to="/unauthorized" replace />;

  return children;
}
