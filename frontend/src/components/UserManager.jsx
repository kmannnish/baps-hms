import React, { useState, useEffect, useCallback } from 'react';
import { Users, Loader2, Plus, X, Pencil, Trash2 } from 'lucide-react';
import { fetchArray } from '../lib/api';

export default function UserManager({ apiBaseUrl, token }) {
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [roleFilter, setRoleFilter] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState({ fullName: '', mobile: '', password: '', roleId: '' });
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  // Shared top-of-list banner for action results (ok = green, err = red).
  const [notice, setNotice] = useState(null);

  // Password reset flow: which user, the new password, in-flight state, and the
  // modal's inline error.
  const [resetFor, setResetFor] = useState(null);
  const [newPassword, setNewPassword] = useState('');
  const [resetSaving, setResetSaving] = useState(false);
  const [resetError, setResetError] = useState('');

  // Edit flow.
  const [editFor, setEditFor] = useState(null);
  const [editForm, setEditForm] = useState({ fullName: '', mobile: '', roleId: '' });
  const [editActive, setEditActive] = useState(true);
  const [editSaving, setEditSaving] = useState(false);
  const [editError, setEditError] = useState('');

  // Delete flow.
  const [deleteFor, setDeleteFor] = useState(null);
  const [deleting, setDeleting] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}` };

  const load = useCallback(async () => {
    setLoading(true);
    const [u, r] = await Promise.all([
      fetchArray(`${apiBaseUrl}/roles/users`, { headers: authHeaders }),
      fetchArray(`${apiBaseUrl}/roles`, { headers: authHeaders }),
    ]);
    setUsers(u);
    setRoles(r);
    if (!form.roleId && r.length) setForm((prev) => ({ ...prev, roleId: r[0].id }));
    setLoading(false);
  }, [apiBaseUrl, token]);

  useEffect(() => { load(); }, [load]);

  const roleNames = [...new Set(users.map((u) => u.role_name).filter(Boolean))];
  const filtered = roleFilter ? users.filter((u) => u.role_name === roleFilter) : users;

  const createUser = async (e) => {
    e.preventDefault();
    setFormError('');
    if (!form.fullName.trim() || !form.mobile.trim() || !form.password.trim() || !form.roleId) {
      setFormError('All fields are required.');
      return;
    }
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/roles/users`, {
        method: 'POST',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify(form),
      });
      if (res.status === 409) { setFormError('That mobile number is already registered.'); return; }
      if (!res.ok) { setFormError('Something went wrong. Please try again.'); return; }
      setForm({ fullName: '', mobile: '', password: '', roleId: roles[0]?.id ?? '' });
      setShowForm(false);
      load();
    } finally {
      setSaving(false);
    }
  };

  const resetPassword = async (e) => {
    e.preventDefault();
    if (!resetFor) return;
    if (newPassword.length < 8) {
      setResetError('Password must be at least 8 characters.');
      return;
    }
    setResetSaving(true);
    setResetError('');
    try {
      const res = await fetch(`${apiBaseUrl}/roles/users/${resetFor.id}/password`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({ password: newPassword }),
      });
      if (!res.ok) {
        setResetError('Could not update the password. Please try again.');
        return;
      }
      setNotice({ type: 'ok', text: `Password updated for ${resetFor.name}.` });
      setNewPassword('');
      setResetFor(null);
    } finally {
      setResetSaving(false);
    }
  };

  const openEdit = (u) => {
    setEditFor(u);
    setEditForm({ fullName: u.name || '', mobile: u.mobile || '', roleId: u.role_id || '' });
    setEditActive(u.is_active !== false);
    setEditError('');
  };

  const saveEdit = async (e) => {
    e.preventDefault();
    if (!editForm.fullName.trim() || !editForm.mobile.trim() || !editForm.roleId) {
      setEditError('Name, mobile and role are required.');
      return;
    }
    setEditSaving(true);
    setEditError('');
    try {
      const res = await fetch(`${apiBaseUrl}/roles/users/${editFor.id}`, {
        method: 'PUT',
        headers: { ...authHeaders, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          fullName: editForm.fullName,
          mobile: editForm.mobile,
          roleId: editForm.roleId,
          isActive: editActive,
        }),
      });
      if (res.status === 409) { setEditError('That mobile number is already used by another user.'); return; }
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        setEditError(body.message || 'Could not save changes. Please try again.');
        return;
      }
      setNotice({ type: 'ok', text: `Updated ${editForm.fullName}.` });
      setEditFor(null);
      load();
    } finally {
      setEditSaving(false);
    }
  };

  const confirmDelete = async () => {
    if (!deleteFor) return;
    setDeleting(true);
    try {
      const res = await fetch(`${apiBaseUrl}/roles/users/${deleteFor.id}`, {
        method: 'DELETE',
        headers: authHeaders,
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setNotice({
          type: 'err',
          text: body.message
            || (body.error === 'CANNOT_DELETE_SELF' ? 'You cannot delete your own account.' : 'Could not delete this user.'),
        });
        setDeleteFor(null);
        return;
      }
      setNotice(
        body.deactivated
          ? { type: 'ok', text: `${deleteFor.name} has booking history, so the account was deactivated (can no longer sign in) rather than deleted.` }
          : { type: 'ok', text: `${deleteFor.name} was deleted.` }
      );
      setDeleteFor(null);
      load();
    } finally {
      setDeleting(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#2B1610]/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div>
      <div className="flex items-center gap-2 mb-4">
        <Users className="w-4 h-4 text-[#B8792F]" />
        <h3 className="font-serif text-lg text-[#2B1610]">Staff accounts</h3>
        <div className="ml-auto flex items-center gap-2">
          <select
            value={roleFilter}
            onChange={(e) => setRoleFilter(e.target.value)}
            className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
          >
            <option value="">All roles</option>
            {roleNames.map((r) => (
              <option key={r} value={r}>{r}</option>
            ))}
          </select>
          <button
            onClick={() => { setShowForm((v) => !v); setFormError(''); }}
            className="flex items-center gap-1.5 bg-[#2B1610] text-[#F8F4EC] px-3 py-1.5 text-sm hover:bg-[#3d2118]"
          >
            {showForm ? <X className="w-3.5 h-3.5" /> : <Plus className="w-3.5 h-3.5" />}
            {showForm ? 'Cancel' : 'Create new user'}
          </button>
        </div>
      </div>

      {showForm && (
        <form onSubmit={createUser} className="border border-[#2B1610]/10 p-4 mb-5 space-y-3 bg-white">
          <h4 className="font-serif text-[#2B1610] mb-2">New staff account</h4>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
            <div>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Full name</label>
              <input
                value={form.fullName}
                onChange={(e) => setForm({ ...form, fullName: e.target.value })}
                placeholder="e.g. Ramesh Sharma"
                className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Mobile number</label>
              <input
                value={form.mobile}
                onChange={(e) => setForm({ ...form, mobile: e.target.value })}
                placeholder="10-digit mobile"
                className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Password</label>
              <input
                type="password"
                value={form.password}
                onChange={(e) => setForm({ ...form, password: e.target.value })}
                placeholder="Set a login password"
                className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Role</label>
              <select
                value={form.roleId}
                onChange={(e) => setForm({ ...form, roleId: e.target.value })}
                className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full bg-white"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
          </div>
          {formError && <p className="text-sm text-[#8C3B3B]">{formError}</p>}
          <button
            type="submit"
            disabled={saving}
            className="flex items-center gap-2 bg-[#2B1610] text-[#F8F4EC] px-4 py-2 text-sm hover:bg-[#3d2118] disabled:opacity-60"
          >
            {saving && <Loader2 className="w-4 h-4 animate-spin" />}
            Create account
          </button>
        </form>
      )}

      {notice && (
        <div
          className={`border px-3 py-2 text-sm mb-3 ${
            notice.type === 'ok'
              ? 'border-[#4A6D5C]/30 bg-[#4A6D5C]/5 text-[#4A6D5C]'
              : 'border-[#8C3B3B]/30 bg-[#8C3B3B]/5 text-[#8C3B3B]'
          }`}
        >
          {notice.text}
        </div>
      )}

      <table className="w-full text-sm">
        <thead>
          <tr className="text-left text-xs uppercase tracking-wide text-[#2B1610]/40 border-b border-[#2B1610]/10">
            <th className="py-2 font-normal">Name</th>
            <th className="py-2 font-normal">Mobile</th>
            <th className="py-2 font-normal">Role</th>
            <th className="py-2 font-normal">Joined</th>
            <th className="py-2 font-normal">Bookings made</th>
            <th className="py-2 font-normal">Bookings approved</th>
            <th className="py-2 font-normal">Actions</th>
          </tr>
        </thead>
        <tbody>
          {filtered.map((u) => (
            <tr key={u.id} className={`border-b border-[#2B1610]/5 ${u.is_active === false ? 'opacity-50' : ''}`}>
              <td className="py-2.5 text-[#2B1610] font-serif">
                {u.name}
                {u.is_active === false && (
                  <span className="ml-2 text-[10px] uppercase tracking-wide text-[#8C3B3B] border border-[#8C3B3B]/30 px-1.5 py-0.5">
                    Inactive
                  </span>
                )}
              </td>
              <td className="py-2.5 text-[#2B1610]/60">{u.mobile}</td>
              <td className="py-2.5">
                <span className="text-xs uppercase tracking-wide text-[#B8792F]">{u.role_name}</span>
              </td>
              <td className="py-2.5 text-[#2B1610]/50 text-xs">
                {u.created_at ? new Date(u.created_at).toLocaleDateString() : '—'}
              </td>
              <td className="py-2.5 text-[#2B1610]/70 text-center">{u.bookings_made ?? 0}</td>
              <td className="py-2.5 text-[#2B1610]/70 text-center">{u.bookings_approved ?? 0}</td>
              <td className="py-2.5">
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => openEdit(u)}
                    className="flex items-center gap-1 text-sm text-[#2B1610]/70 hover:text-[#2B1610]"
                  >
                    <Pencil className="w-3.5 h-3.5" /> Edit
                  </button>
                  <button
                    onClick={() => { setResetFor(u); setNewPassword(''); setResetError(''); }}
                    className="text-sm text-[#B8792F] hover:underline"
                  >
                    Reset password
                  </button>
                  <button
                    onClick={() => setDeleteFor(u)}
                    className="flex items-center gap-1 text-sm text-[#8C3B3B] hover:underline"
                  >
                    <Trash2 className="w-3.5 h-3.5" /> Delete
                  </button>
                </div>
              </td>
            </tr>
          ))}
          {!filtered.length && (
            <tr>
              <td colSpan={7} className="py-6 text-center text-[#2B1610]/40">No users found.</td>
            </tr>
          )}
        </tbody>
      </table>

      {/* Reset-password modal */}
      {resetFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={resetPassword} className="bg-[#F8F4EC] border border-[#2B1610]/15 max-w-sm w-full p-6">
            <h4 className="font-serif text-lg text-[#2B1610] mb-1">Reset password</h4>
            <p className="text-sm text-[#2B1610]/60 mb-4">
              New login password for <strong>{resetFor.name}</strong> ({resetFor.mobile}).
            </p>
            <input
              type="password"
              autoFocus
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
              placeholder="At least 8 characters"
              className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full"
            />
            {resetError && <p className="text-sm text-[#8C3B3B] mt-2">{resetError}</p>}
            <div className="flex items-center justify-end gap-3 mt-4">
              <button
                type="button"
                onClick={() => { setResetFor(null); setNewPassword(''); setResetError(''); }}
                disabled={resetSaving}
                className="px-4 py-2 text-sm text-[#2B1610]/60 hover:text-[#2B1610] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={resetSaving}
                className="flex items-center gap-2 bg-[#2B1610] text-[#F8F4EC] px-4 py-2 text-sm hover:bg-[#3d2118] disabled:opacity-60"
              >
                {resetSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Update password
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Edit modal */}
      {editFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <form onSubmit={saveEdit} className="bg-[#F8F4EC] border border-[#2B1610]/15 max-w-md w-full p-6 space-y-3">
            <h4 className="font-serif text-lg text-[#2B1610] mb-1">Edit staff account</h4>
            <div>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Full name</label>
              <input
                autoFocus
                value={editForm.fullName}
                onChange={(e) => setEditForm({ ...editForm, fullName: e.target.value })}
                className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Mobile number</label>
              <input
                value={editForm.mobile}
                onChange={(e) => setEditForm({ ...editForm, mobile: e.target.value })}
                className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full"
              />
            </div>
            <div>
              <label className="text-xs uppercase tracking-wide text-[#2B1610]/50 block mb-1">Role</label>
              <select
                value={editForm.roleId}
                onChange={(e) => setEditForm({ ...editForm, roleId: e.target.value })}
                className="border border-[#2B1610]/20 px-2 py-1.5 text-sm w-full bg-white"
              >
                {roles.map((r) => (
                  <option key={r.id} value={r.id}>{r.name}</option>
                ))}
              </select>
            </div>
            <label className="flex items-center gap-2 cursor-pointer pt-1">
              <input
                type="checkbox"
                checked={editActive}
                onChange={(e) => setEditActive(e.target.checked)}
                className="accent-[#B8792F]"
              />
              <span className="text-sm text-[#2B1610]/80">Active (can sign in)</span>
            </label>
            {editError && <p className="text-sm text-[#8C3B3B]">{editError}</p>}
            <div className="flex items-center justify-end gap-3 pt-1">
              <button
                type="button"
                onClick={() => setEditFor(null)}
                disabled={editSaving}
                className="px-4 py-2 text-sm text-[#2B1610]/60 hover:text-[#2B1610] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={editSaving}
                className="flex items-center gap-2 bg-[#2B1610] text-[#F8F4EC] px-4 py-2 text-sm hover:bg-[#3d2118] disabled:opacity-60"
              >
                {editSaving && <Loader2 className="w-4 h-4 animate-spin" />}
                Save changes
              </button>
            </div>
          </form>
        </div>
      )}

      {/* Delete confirmation modal */}
      {deleteFor && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-[#F8F4EC] border border-[#2B1610]/15 max-w-sm w-full p-6">
            <h4 className="font-serif text-lg text-[#2B1610] mb-2">Delete {deleteFor.name}?</h4>
            <p className="text-sm text-[#2B1610]/70 mb-1">
              This removes the staff account <strong>{deleteFor.name}</strong> ({deleteFor.mobile}).
            </p>
            <p className="text-xs text-[#2B1610]/50 mb-5">
              If this person has booking or approval history, their records are kept and the account is
              deactivated (can no longer sign in) instead of being deleted.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setDeleteFor(null)}
                disabled={deleting}
                className="px-4 py-2 text-sm text-[#2B1610]/60 hover:text-[#2B1610] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={confirmDelete}
                disabled={deleting}
                className="flex items-center gap-2 bg-[#8C3B3B] text-white px-5 py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
              >
                {deleting && <Loader2 className="w-4 h-4 animate-spin" />}
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
