import React, { useState, useEffect, useCallback } from 'react';
import { Shield, Loader2, Search } from 'lucide-react';
import { fetchArray } from '../lib/api';

export default function AuditLogViewer({ apiBaseUrl, token }) {
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filters, setFilters] = useState({ from: '', to: '', action: '' });

  const authHeaders = { Authorization: `Bearer ${token}` };

  const load = useCallback(async (f) => {
    setLoading(true);
    const params = new URLSearchParams();
    if (f?.from) params.set('from', f.from);
    if (f?.to) params.set('to', f.to);
    if (f?.action) params.set('action', f.action);
    setEntries(await fetchArray(`${apiBaseUrl}/reports/audit-log?${params}`, { headers: authHeaders }));
    setLoading(false);
  }, [apiBaseUrl, token]);

  useEffect(() => { load(filters); /* eslint-disable-next-line */ }, []);

  const applyFilters = () => load(filters);

  const fmtTime = (v) => v ? new Date(v).toLocaleString('en-IN', {
    day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit'
  }) : '—';

  const actionOptions = [
    '', 'booking.approved', 'booking.rejected', 'booking.modified',
    'booking.billing_edited', 'booking.payment_recorded',
    'booking.checked_in', 'booking.checked_out',
    'booking.cancelled', 'booking.deleted',
  ];

  return (
    <div className="space-y-5">
      <div className="flex items-center gap-2 mb-1">
        <Shield className="w-4 h-4 text-[#B8792F]" />
        <h3 className="font-serif text-lg text-[#2B1610]">Audit log</h3>
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <div>
          <label className="text-xs text-[#2B1610]/50 block mb-1">From</label>
          <input type="date" value={filters.from} onChange={(e) => setFilters({ ...filters, from: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-[#2B1610]/50 block mb-1">To</label>
          <input type="date" value={filters.to} onChange={(e) => setFilters({ ...filters, to: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm" />
        </div>
        <div>
          <label className="text-xs text-[#2B1610]/50 block mb-1">Action</label>
          <select value={filters.action} onChange={(e) => setFilters({ ...filters, action: e.target.value })}
            className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm">
            {actionOptions.map((a) => <option key={a} value={a}>{a || 'All actions'}</option>)}
          </select>
        </div>
        <button onClick={applyFilters} className="bg-[#2B1610] text-[#F8F4EC] px-4 py-1.5 text-sm">
          <Search className="w-3.5 h-3.5 inline mr-1" />Filter
        </button>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-12 text-[#2B1610]/40">
          <Loader2 className="w-5 h-5 animate-spin" />
        </div>
      ) : (
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs uppercase tracking-wide text-[#2B1610]/40 border-b border-[#2B1610]/10">
              <th className="py-2 font-normal">Time</th>
              <th className="py-2 font-normal">Actor</th>
              <th className="py-2 font-normal">Action</th>
              <th className="py-2 font-normal">Entity</th>
              <th className="py-2 font-normal">Details</th>
            </tr>
          </thead>
          <tbody>
            {entries.map((e) => (
              <tr key={e.id} className="border-b border-[#2B1610]/5">
                <td className="py-2 text-[#2B1610]/70 text-xs whitespace-nowrap">{fmtTime(e.created_at)}</td>
                <td className="py-2 text-[#2B1610]/80">{e.actor_name || '—'}</td>
                <td className="py-2">
                  <span className="text-xs bg-[#2B1610]/5 px-2 py-0.5 text-[#2B1610]/70">{e.action}</span>
                </td>
                <td className="py-2 text-[#2B1610]/60 text-xs">
                  {e.entity_type} <span className="text-[#2B1610]/30">{e.entity_id?.slice(0, 8)}</span>
                </td>
                <td className="py-2 text-[#2B1610]/50 text-xs max-w-[200px] truncate">
                  {e.metadata ? JSON.stringify(e.metadata) : ''}
                </td>
              </tr>
            ))}
            {!entries.length && (
              <tr><td colSpan={5} className="py-8 text-center text-[#2B1610]/40">No audit entries match these filters.</td></tr>
            )}
          </tbody>
        </table>
      )}
    </div>
  );
}
