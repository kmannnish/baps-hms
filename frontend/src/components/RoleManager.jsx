import React, { useState, useEffect, useMemo } from 'react';
import { ShieldCheck, Plus, Save, Trash2, Loader2, Lock } from 'lucide-react';
import { fetchArray } from '../lib/api';

/**
 * RoleManager
 *
 * Admin screen: create a role by name, toggle any combination of
 * permissions (grouped by category), save. No role or permission is
 * hardcoded here — everything renders from what /roles and
 * /roles/permissions return.
 *
 * props.apiBaseUrl, props.authToken
 */
export default function RoleManager({ apiBaseUrl, authToken }) {
  const [permissions, setPermissions] = useState([]);
  const [roles, setRoles] = useState([]);
  const [selectedRoleId, setSelectedRoleId] = useState(null);
  const [draftPermissionIds, setDraftPermissionIds] = useState(new Set());
  const [creating, setCreating] = useState(false);
  const [newRoleName, setNewRoleName] = useState('');
  const [saving, setSaving] = useState(false);
  const [loading, setLoading] = useState(true);

  const authHeaders = { Authorization: `Bearer ${authToken}`, 'Content-Type': 'application/json' };

  const loadAll = async () => {
    setLoading(true);
    const [permissionsList, roleList] = await Promise.all([
      fetchArray(`${apiBaseUrl}/roles/permissions`, { headers: authHeaders }),
      fetchArray(`${apiBaseUrl}/roles`, { headers: authHeaders }),
    ]);
    setPermissions(permissionsList);
    setRoles(roleList);
    if (!selectedRoleId && roleList.length) selectRole(roleList[0]);
    setLoading(false);
  };

  useEffect(() => { loadAll(); /* eslint-disable-next-line */ }, []);

  const selectRole = (role) => {
    setSelectedRoleId(role.id);
    setDraftPermissionIds(new Set(role.permission_ids ?? []));
    setCreating(false);
  };

  const selectedRole = useMemo(() => roles.find((r) => r.id === selectedRoleId), [roles, selectedRoleId]);

  const grouped = useMemo(() => {
    const map = {};
    for (const p of permissions) {
      (map[p.category] ??= []).push(p);
    }
    return map;
  }, [permissions]);

  const togglePermission = (id) => {
    setDraftPermissionIds((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const saveRolePermissions = async () => {
    setSaving(true);
    try {
      await fetch(`${apiBaseUrl}/roles/${selectedRoleId}/permissions`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify({ permissionIds: Array.from(draftPermissionIds) }),
      });
      await loadAll();
    } finally {
      setSaving(false);
    }
  };

  const createRole = async () => {
    if (!newRoleName.trim()) return;
    setSaving(true);
    try {
      const res = await fetch(`${apiBaseUrl}/roles`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({
          name: newRoleName,
          permissionIds: Array.from(draftPermissionIds),
        }),
      });
      const role = await res.json();
      setNewRoleName('');
      setCreating(false);
      await loadAll();
      selectRole({ ...role, permission_ids: Array.from(draftPermissionIds) });
    } finally {
      setSaving(false);
    }
  };

  const deleteRole = async (role) => {
    if (role.is_system) return;
    if (!confirm(`Delete the "${role.name}" role?`)) return;
    await fetch(`${apiBaseUrl}/roles/${role.id}`, { method: 'DELETE', headers: authHeaders });
    setSelectedRoleId(null);
    await loadAll();
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#2B1610]/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  return (
    <div className="bg-[#F8F4EC] grid grid-cols-1 md:grid-cols-[220px_1fr] gap-6">
      {/* Role list */}
      <div className="space-y-1">
        {roles.map((role) => (
          <div key={role.id} className="flex items-center group">
            <button
              onClick={() => selectRole(role)}
              className={`flex-1 text-left px-3 py-2.5 text-sm flex items-center gap-2 ${
                selectedRoleId === role.id && !creating
                  ? 'bg-[#B8792F]/10 text-[#2B1610] border-l-2 border-[#B8792F]'
                  : 'text-[#2B1610]/60 border-l-2 border-transparent hover:bg-[#2B1610]/5'
              }`}
            >
              {role.is_system && <Lock className="w-3 h-3 opacity-40" />}
              {role.name}
            </button>
            {!role.is_system && (
              <button
                onClick={() => deleteRole(role)}
                className="opacity-0 group-hover:opacity-100 px-2 text-[#8C3B3B]/60 hover:text-[#8C3B3B]"
              >
                <Trash2 className="w-3.5 h-3.5" />
              </button>
            )}
          </div>
        ))}
        <button
          onClick={() => { setCreating(true); setSelectedRoleId(null); setDraftPermissionIds(new Set()); }}
          className={`w-full text-left px-3 py-2.5 text-sm flex items-center gap-2 ${
            creating ? 'bg-[#B8792F]/10 text-[#2B1610] border-l-2 border-[#B8792F]' : 'text-[#B8792F] border-l-2 border-transparent'
          }`}
        >
          <Plus className="w-3.5 h-3.5" /> New role
        </button>
      </div>

      {/* Permission editor */}
      <div className="border-l border-[#2B1610]/10 pl-6">
        {creating ? (
          <input
            autoFocus
            value={newRoleName}
            onChange={(e) => setNewRoleName(e.target.value)}
            placeholder="Role name (e.g. Front Desk Supervisor)"
            className="font-serif text-xl text-[#2B1610] bg-transparent border-b border-[#2B1610]/20 focus:outline-none focus:border-[#B8792F] pb-1 mb-6 w-full max-w-sm"
          />
        ) : selectedRole ? (
          <div className="flex items-center gap-2 mb-6">
            <ShieldCheck className="w-4 h-4 text-[#B8792F]" />
            <h3 className="font-serif text-xl text-[#2B1610]">{selectedRole.name}</h3>
          </div>
        ) : (
          <p className="text-sm text-[#2B1610]/40">Select or create a role to edit its permissions.</p>
        )}

        {(creating || selectedRole) && (
          <>
            <div className="space-y-6 mb-6">
              {Object.entries(grouped).map(([category, perms]) => (
                <div key={category}>
                  <p className="text-xs uppercase tracking-wide text-[#2B1610]/40 mb-2">{category}</p>
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    {perms.map((perm) => (
                      <label
                        key={perm.id}
                        className="flex items-start gap-2.5 border border-[#2B1610]/10 px-3 py-2.5 cursor-pointer hover:border-[#2B1610]/25"
                      >
                        <input
                          type="checkbox"
                          checked={draftPermissionIds.has(perm.id)}
                          onChange={() => togglePermission(perm.id)}
                          className="mt-0.5 accent-[#B8792F]"
                        />
                        <span className="text-sm text-[#2B1610]/80">{perm.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              ))}
            </div>

            <button
              onClick={creating ? createRole : saveRolePermissions}
              disabled={saving || (creating && !newRoleName.trim())}
              className="flex items-center gap-2 bg-[#2B1610] text-[#F8F4EC] px-5 py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-60"
            >
              {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              {creating ? 'Create role' : 'Save permissions'}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
