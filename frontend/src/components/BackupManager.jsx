import React, { useState, useEffect, useCallback } from 'react';
import {
  DatabaseBackup, Save, Loader2, Download, RotateCcw, AlertTriangle,
  Clock, CheckCircle2, HardDrive,
} from 'lucide-react';
import { fetchObject } from '../lib/api';

/**
 * BackupManager
 *
 * Admin screen for the local database backup & restore feature (see
 * backend/routes/backup.js + utils/backup.js + utils/backupScheduler.js).
 *
 * - Schedule: a master on/off plus daily / weekly / monthly cadences and the
 *   time of day they run. Each cadence overwrites its own single file, so the
 *   previous backup is replaced automatically and storage stays bounded.
 * - Backups list: the current .dump file for each slot with its size and when
 *   it was taken; Download (to a pen drive) and Restore per slot.
 * - Restore is DESTRUCTIVE and confirmed in a modal; the server also takes an
 *   automatic safety copy of the current data before every restore.
 *
 * Everything here is behind the single `can_manage_backups` permission (the
 * schedule saves via PUT /backup/config, not the generic /settings PUT).
 *
 * props.apiBaseUrl, props.token
 */

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
// Slots shown as "scheduled" rows even before their first run; 'manual' is the
// on-demand slot. 'prerestore' is shown only once it exists (after a restore).
const SCHEDULED_SLOTS = ['daily', 'weekly', 'monthly', 'manual'];

function fmtSize(bytes) {
  if (!bytes) return '—';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function fmtWhen(iso) {
  if (!iso) return 'Not yet created';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Not yet created';
  return d.toLocaleString(undefined, {
    day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });
}

export default function BackupManager({ apiBaseUrl, token }) {
  const [backups, setBackups] = useState([]);
  const [toolsAvailable, setToolsAvailable] = useState(true);
  const [cfg, setCfg] = useState({
    backup_enabled: false,
    backup_daily_enabled: true,
    backup_weekly_enabled: false,
    backup_monthly_enabled: false,
    backup_time: '02:00',
    backup_weekly_day: 0,
    backup_monthly_day: 1,
  });
  const [lastRun, setLastRun] = useState({});

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [backingUp, setBackingUp] = useState(false);
  const [error, setError] = useState(null);
  const [notice, setNotice] = useState(null);

  // Restore flow: the slot pending confirmation, and the in-flight state.
  const [restoreTarget, setRestoreTarget] = useState(null);
  const [restoring, setRestoring] = useState(false);

  const authHeaders = { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' };

  const applyPayload = useCallback((data) => {
    setBackups(Array.isArray(data.backups) ? data.backups : []);
    setToolsAvailable(data.toolsAvailable !== false);
    const c = data.config || {};
    setCfg((prev) => ({
      backup_enabled: c.backup_enabled === true,
      backup_daily_enabled: c.backup_daily_enabled !== false,
      backup_weekly_enabled: c.backup_weekly_enabled === true,
      backup_monthly_enabled: c.backup_monthly_enabled === true,
      backup_time: typeof c.backup_time === 'string' ? c.backup_time : prev.backup_time,
      backup_weekly_day: Number.isFinite(Number(c.backup_weekly_day)) ? Number(c.backup_weekly_day) : prev.backup_weekly_day,
      backup_monthly_day: Number.isFinite(Number(c.backup_monthly_day)) ? Number(c.backup_monthly_day) : prev.backup_monthly_day,
    }));
    setLastRun({
      daily: c.backup_daily_last_run || null,
      weekly: c.backup_weekly_last_run || null,
      monthly: c.backup_monthly_last_run || null,
    });
  }, []);

  const load = useCallback(async () => {
    const data = await fetchObject(`${apiBaseUrl}/backup`, { headers: { Authorization: `Bearer ${token}` } }, {});
    applyPayload(data);
    setLoading(false);
  }, [apiBaseUrl, token, applyPayload]);

  useEffect(() => { load(); }, [load]);

  // Any edit to the schedule invalidates a prior "Saved" confirmation, so the
  // button goes back to "Save schedule" until the new change is persisted.
  useEffect(() => { setSaved(false); }, [cfg]);

  const saveSchedule = async () => {
    setSaving(true);
    setSaved(false);
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/backup/config`, {
        method: 'PUT',
        headers: authHeaders,
        body: JSON.stringify(cfg),
      });
      if (!res.ok) throw new Error('SAVE_FAILED');
      const data = await res.json().catch(() => ({}));
      if (data.config) setLastRun((prev) => ({ ...prev })); // config echoes back; list unchanged
      setSaved(true);
    } catch {
      setError('Could not save the backup schedule. Please try again.');
    } finally {
      setSaving(false);
    }
  };

  const backupNow = async () => {
    setBackingUp(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBaseUrl}/backup/run`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ slot: 'manual' }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'BACKUP_FAILED');
      if (Array.isArray(body.backups)) setBackups(body.backups);
      setNotice('Backup created.');
    } catch (err) {
      setError(err.message || 'Could not create the backup.');
    } finally {
      setBackingUp(false);
    }
  };

  const downloadBackup = async (slot) => {
    setError(null);
    try {
      const res = await fetch(`${apiBaseUrl}/backup/download/${slot}`, {
        headers: { Authorization: `Bearer ${token}` },
      });
      if (!res.ok) throw new Error('DOWNLOAD_FAILED');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `baps_hms_${slot}.dump`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch {
      setError('Could not download that backup.');
    }
  };

  const doRestore = async () => {
    if (!restoreTarget) return;
    setRestoring(true);
    setError(null);
    setNotice(null);
    try {
      const res = await fetch(`${apiBaseUrl}/backup/restore`, {
        method: 'POST',
        headers: authHeaders,
        body: JSON.stringify({ slot: restoreTarget.slot, confirm: true }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.message || body.error || 'RESTORE_FAILED');
      setRestoreTarget(null);
      setNotice('Restore complete. Reloading with the restored data…');
      // Every portal's data changed under us — reload so the whole app re-reads.
      setTimeout(() => window.location.reload(), 1600);
    } catch (err) {
      setError(err.message || 'Restore failed. Your current data was not changed.');
      setRestoring(false);
    }
  };

  if (loading) {
    return (
      <div className="flex items-center justify-center py-16 text-[#2B1610]/40">
        <Loader2 className="w-5 h-5 animate-spin" />
      </div>
    );
  }

  const scheduledRows = backups.filter((b) => SCHEDULED_SLOTS.includes(b.slot));
  const prerestore = backups.find((b) => b.slot === 'prerestore' && b.exists);

  return (
    <div className="max-w-2xl space-y-8">
      <div>
        <h3 className="font-serif text-lg text-[#2B1610] mb-1 flex items-center gap-2">
          <DatabaseBackup className="w-4 h-4 text-[#B8792F]" /> Automatic backups
        </h3>
        <p className="text-xs text-[#2B1610]/50 mb-3">
          The Reception PC saves a copy of the whole database to a local folder. Each schedule
          keeps just its most recent backup — a new one replaces the previous automatically, so
          this never fills up the disk. Backups stay on this PC (no internet needed); download
          one to a pen drive for safe keeping.
        </p>

        {!toolsAvailable && (
          <div className="flex items-start gap-2 border border-[#8C3B3B]/30 bg-[#8C3B3B]/5 text-[#8C3B3B] px-3 py-2 text-sm mb-4">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
            <span>
              The database backup tools (<code className="bg-[#8C3B3B]/10 px-1">pg_dump</code>) aren't
              installed on the server, so backups can't run. Rebuild the backend
              (<code className="bg-[#8C3B3B]/10 px-1">docker compose up --build</code>) to install them.
            </span>
          </div>
        )}

        {/* Master toggle */}
        <label className="flex items-center gap-2 cursor-pointer mb-4">
          <input
            type="checkbox"
            checked={cfg.backup_enabled}
            onChange={(e) => setCfg({ ...cfg, backup_enabled: e.target.checked })}
            className="accent-[#B8792F]"
          />
          <span className="text-sm text-[#2B1610]/80">Run automatic backups on a schedule</span>
        </label>

        {/* Cadences — greyed when the master switch is off */}
        <div className={`space-y-3 ${cfg.backup_enabled ? '' : 'opacity-40 pointer-events-none'}`}>
          <label className="flex items-center gap-2 cursor-pointer">
            <input
              type="checkbox"
              checked={cfg.backup_daily_enabled}
              onChange={(e) => setCfg({ ...cfg, backup_daily_enabled: e.target.checked })}
              className="accent-[#B8792F]"
            />
            <span className="text-sm text-[#2B1610]/80">Daily</span>
            {lastRun.daily && (
              <span className="text-xs text-[#2B1610]/40">· last run {lastRun.daily}</span>
            )}
          </label>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.backup_weekly_enabled}
                onChange={(e) => setCfg({ ...cfg, backup_weekly_enabled: e.target.checked })}
                className="accent-[#B8792F]"
              />
              <span className="text-sm text-[#2B1610]/80">Weekly, every</span>
            </label>
            <select
              value={cfg.backup_weekly_day}
              onChange={(e) => setCfg({ ...cfg, backup_weekly_day: Number(e.target.value) })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
            >
              {WEEKDAYS.map((d, i) => (
                <option key={i} value={i}>{d}</option>
              ))}
            </select>
            {lastRun.weekly && (
              <span className="text-xs text-[#2B1610]/40">· last run {lastRun.weekly}</span>
            )}
          </div>

          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <label className="flex items-center gap-2 cursor-pointer">
              <input
                type="checkbox"
                checked={cfg.backup_monthly_enabled}
                onChange={(e) => setCfg({ ...cfg, backup_monthly_enabled: e.target.checked })}
                className="accent-[#B8792F]"
              />
              <span className="text-sm text-[#2B1610]/80">Monthly, on day</span>
            </label>
            <select
              value={cfg.backup_monthly_day}
              onChange={(e) => setCfg({ ...cfg, backup_monthly_day: Number(e.target.value) })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
            >
              {Array.from({ length: 28 }, (_, i) => i + 1).map((d) => (
                <option key={d} value={d}>{d}</option>
              ))}
            </select>
            <span className="text-xs text-[#2B1610]/40">(1–28, so every month has it)</span>
            {lastRun.monthly && (
              <span className="text-xs text-[#2B1610]/40">· last run {lastRun.monthly}</span>
            )}
          </div>

          <div className="flex items-center gap-2 pt-1">
            <Clock className="w-4 h-4 text-[#B8792F]" />
            <span className="text-sm text-[#2B1610]/60">Run at</span>
            <input
              type="time"
              value={cfg.backup_time}
              onChange={(e) => setCfg({ ...cfg, backup_time: e.target.value })}
              className="border border-[#2B1610]/20 bg-white px-2 py-1.5 text-sm"
            />
            <span className="text-xs text-[#2B1610]/40">(the PC must be on at this time)</span>
          </div>
        </div>

        <button
          onClick={saveSchedule}
          disabled={saving}
          className="mt-5 flex items-center gap-2 bg-[#2B1610] text-[#F8F4EC] px-5 py-2.5 text-sm hover:bg-[#3d2118] disabled:opacity-60"
        >
          {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
          {saving ? 'Saving…' : saved ? 'Saved' : 'Save schedule'}
        </button>
      </div>

      {/* Existing backups */}
      <div>
        <div className="flex items-center justify-between mb-3">
          <h3 className="font-serif text-lg text-[#2B1610] flex items-center gap-2">
            <HardDrive className="w-4 h-4 text-[#B8792F]" /> Backups on this PC
          </h3>
          <button
            onClick={backupNow}
            disabled={backingUp || !toolsAvailable}
            className="flex items-center gap-1.5 border border-[#B8792F] text-[#B8792F] px-4 py-2 text-sm hover:bg-[#B8792F]/10 disabled:opacity-50"
          >
            {backingUp ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <DatabaseBackup className="w-3.5 h-3.5" />}
            Back up now
          </button>
        </div>

        {error && (
          <div className="flex items-start gap-2 border border-[#8C3B3B]/30 bg-[#8C3B3B]/5 text-[#8C3B3B] px-3 py-2 text-sm mb-3">
            <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" /> <span>{error}</span>
          </div>
        )}
        {notice && (
          <div className="flex items-start gap-2 border border-[#4A6D5C]/30 bg-[#4A6D5C]/5 text-[#4A6D5C] px-3 py-2 text-sm mb-3">
            <CheckCircle2 className="w-4 h-4 mt-0.5 shrink-0" /> <span>{notice}</span>
          </div>
        )}

        <div className="border border-[#2B1610]/10 divide-y divide-[#2B1610]/10">
          {scheduledRows.map((b) => (
            <div key={b.slot} className="flex items-center gap-3 px-4 py-3">
              <div className="flex-1 min-w-0">
                <p className="text-sm text-[#2B1610]">{b.label}</p>
                <p className="text-xs text-[#2B1610]/50">
                  {fmtWhen(b.modifiedAt)}{b.exists ? ` · ${fmtSize(b.sizeBytes)}` : ''}
                </p>
              </div>
              <button
                onClick={() => downloadBackup(b.slot)}
                disabled={!b.exists}
                title="Download this backup file"
                className="flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline disabled:opacity-30 disabled:no-underline"
              >
                <Download className="w-3.5 h-3.5" /> Download
              </button>
              <button
                onClick={() => { setRestoreTarget(b); setError(null); setNotice(null); }}
                disabled={!b.exists || !toolsAvailable}
                title="Replace all current data with this backup"
                className="flex items-center gap-1.5 text-sm text-[#8C3B3B] hover:underline disabled:opacity-30 disabled:no-underline"
              >
                <RotateCcw className="w-3.5 h-3.5" /> Restore
              </button>
            </div>
          ))}
        </div>

        {/* The automatic safety copy taken before the last restore, if any. */}
        {prerestore && (
          <div className="flex items-center gap-3 px-4 py-3 mt-3 border border-[#2B1610]/10 bg-[#2B1610]/[0.02]">
            <div className="flex-1 min-w-0">
              <p className="text-sm text-[#2B1610]">{prerestore.label}</p>
              <p className="text-xs text-[#2B1610]/50">
                {fmtWhen(prerestore.modifiedAt)} · {fmtSize(prerestore.sizeBytes)} — undo the last restore from here
              </p>
            </div>
            <button
              onClick={() => downloadBackup('prerestore')}
              className="flex items-center gap-1.5 text-sm text-[#B8792F] hover:underline"
            >
              <Download className="w-3.5 h-3.5" /> Download
            </button>
            <button
              onClick={() => { setRestoreTarget(prerestore); setError(null); setNotice(null); }}
              disabled={!toolsAvailable}
              className="flex items-center gap-1.5 text-sm text-[#8C3B3B] hover:underline disabled:opacity-30"
            >
              <RotateCcw className="w-3.5 h-3.5" /> Restore
            </button>
          </div>
        )}
      </div>

      {/* Restore confirmation modal */}
      {restoreTarget && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-[#F8F4EC] border border-[#2B1610]/15 max-w-md w-full p-6">
            <h4 className="font-serif text-lg text-[#2B1610] flex items-center gap-2 mb-2">
              <AlertTriangle className="w-5 h-5 text-[#8C3B3B]" /> Restore this backup?
            </h4>
            <p className="text-sm text-[#2B1610]/70 mb-3">
              This replaces <strong>all current data</strong> — bookings, guests, rooms, settings —
              with the <strong>{restoreTarget.label}</strong> backup from{' '}
              <strong>{fmtWhen(restoreTarget.modifiedAt)}</strong>. Anything added since then will be lost.
            </p>
            <p className="text-xs text-[#2B1610]/50 mb-5">
              A safety copy of the current data is saved first, so you can undo this. Do it when
              no one else is using the system.
            </p>
            <div className="flex items-center justify-end gap-3">
              <button
                onClick={() => setRestoreTarget(null)}
                disabled={restoring}
                className="px-4 py-2 text-sm text-[#2B1610]/60 hover:text-[#2B1610] disabled:opacity-50"
              >
                Cancel
              </button>
              <button
                onClick={doRestore}
                disabled={restoring}
                className="flex items-center gap-2 bg-[#8C3B3B] text-white px-5 py-2.5 text-sm hover:opacity-90 disabled:opacity-60"
              >
                {restoring ? <Loader2 className="w-4 h-4 animate-spin" /> : <RotateCcw className="w-4 h-4" />}
                {restoring ? 'Restoring…' : 'Yes, restore'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
