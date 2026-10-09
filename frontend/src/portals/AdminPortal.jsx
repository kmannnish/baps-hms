import React, { useState } from 'react';
import { ShieldCheck, Package, LogOut, BarChart3, FileEdit, Shield, Users, DatabaseBackup } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import RoleManager from '../components/RoleManager';
import InventoryManager from '../components/InventoryManager';
import HistoryReports from '../components/HistoryReports';
import ContentSettings from '../components/ContentSettings';
import AuditLogViewer from '../components/AuditLogViewer';
import UserManager from '../components/UserManager';
import BackupManager from '../components/BackupManager';

/**
 * AdminPortal
 *
 * Full activity visibility for Admin: roles/permissions, inventory/pricing,
 * booking history + occupancy/revenue reports, and guest-facing content
 * (T&C text, WhatsApp templates) — everything that was previously either
 * missing entirely or hardcoded in application code.
 */
export default function AdminPortal() {
  const { user, logout, apiBaseUrl, token } = useAuth();
  const [tab, setTab] = useState('reports');

  return (
    <div className="min-h-screen bg-[#F8F4EC]">
      <header className="flex items-center justify-between px-6 py-4 border-b border-[#2B1610]/10">
        <div>
          <h1 className="font-serif text-xl text-[#2B1610]">Admin</h1>
          <p className="text-xs text-[#2B1610]/40">Signed in as {user?.name}</p>
        </div>
        <button onClick={logout} className="flex items-center gap-1.5 text-sm text-[#2B1610]/50 hover:text-[#2B1610]">
          <LogOut className="w-4 h-4" /> Sign out
        </button>
      </header>

      <div className="px-6 pt-5">
        <div className="flex gap-6 border-b border-[#2B1610]/15 mb-6 flex-wrap">
          <TabButton active={tab === 'reports'} onClick={() => setTab('reports')} icon={BarChart3}>
            Reports &amp; history
          </TabButton>
          <TabButton active={tab === 'roles'} onClick={() => setTab('roles')} icon={ShieldCheck}>
            Roles &amp; permissions
          </TabButton>
          <TabButton active={tab === 'inventory'} onClick={() => setTab('inventory')} icon={Package}>
            Inventory &amp; pricing
          </TabButton>
          <TabButton active={tab === 'content'} onClick={() => setTab('content')} icon={FileEdit}>
            Content &amp; messages
          </TabButton>
          <TabButton active={tab === 'audit'} onClick={() => setTab('audit')} icon={Shield}>
            Audit log
          </TabButton>
          <TabButton active={tab === 'users'} onClick={() => setTab('users')} icon={Users}>
            Users
          </TabButton>
          <TabButton active={tab === 'backup'} onClick={() => setTab('backup')} icon={DatabaseBackup}>
            Backup
          </TabButton>
        </div>

        <div className="pb-12">
          {tab === 'reports' && <HistoryReports apiBaseUrl={apiBaseUrl} token={token} canModify canSetBilling canMarkPayment canCancel canDelete />}
          {tab === 'roles' && <RoleManager apiBaseUrl={apiBaseUrl} authToken={token} />}
          {tab === 'inventory' && <InventoryManager apiBaseUrl={apiBaseUrl} authToken={token} />}
          {tab === 'content' && <ContentSettings apiBaseUrl={apiBaseUrl} token={token} />}
          {tab === 'audit' && <AuditLogViewer apiBaseUrl={apiBaseUrl} token={token} />}
          {tab === 'users' && <UserManager apiBaseUrl={apiBaseUrl} token={token} />}
          {tab === 'backup' && <BackupManager apiBaseUrl={apiBaseUrl} token={token} />}
        </div>
      </div>
    </div>
  );
}

function TabButton({ active, onClick, icon: Icon, children }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 pb-3 text-sm border-b-2 -mb-px transition-colors ${
        active ? 'border-[#B8792F] text-[#2B1610]' : 'border-transparent text-[#2B1610]/40'
      }`}
    >
      <Icon className="w-4 h-4" /> {children}
    </button>
  );
}
