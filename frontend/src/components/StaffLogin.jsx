import React, { useState } from 'react';
import { LogIn } from 'lucide-react';
import { useAuth } from '../context/AuthContext';

/**
 * StaffLogin
 *
 * Shared mobile + password login for all three staff roles — Admin,
 * Swami Ji, and Receptionist. There's no separate geofenced login anymore:
 * Reception runs locally on the front-desk PC, so physical access to that
 * machine is the security boundary, not location.
 */
export default function StaffLogin({ onLoginSuccess }) {
  const { login } = useAuth();
  const [mobile, setMobile] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setSubmitting(true);
    try {
      const user = await login(mobile, password);
      onLoginSuccess?.(user);
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen bg-[#2B1610] flex items-center justify-center px-4">
      <form onSubmit={handleSubmit} className="max-w-sm w-full bg-[#F8F4EC] p-8 space-y-4">
        <div className="mb-2">
          <h1 className="font-serif text-2xl text-[#2B1610] mb-1">Sign in</h1>
          <p className="text-sm text-[#2B1610]/50">BAPS Jaipur Utara</p>
        </div>

        {error && (
          <p className="text-sm text-[#8C3B3B] bg-[#8C3B3B]/10 border border-[#8C3B3B]/30 px-3 py-2">
            {error}
          </p>
        )}

        <div>
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">Mobile number</label>
          <input
            value={mobile}
            onChange={(e) => setMobile(e.target.value)}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#B8792F]"
          />
        </div>
        <div>
          <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1.5">Password</label>
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            className="w-full border border-[#2B1610]/20 bg-white px-3 py-2.5 text-sm focus:outline-none focus:border-[#B8792F]"
          />
        </div>
        <button
          type="submit"
          disabled={submitting}
          className="w-full flex items-center justify-center gap-2 bg-[#2B1610] text-[#F8F4EC] py-3 text-sm hover:bg-[#3d2118] disabled:opacity-60"
        >
          <LogIn className="w-4 h-4" /> {submitting ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
