import React, { useState, useEffect } from 'react';
import { WifiOff, RefreshCw, CheckCircle2, AlertTriangle } from 'lucide-react';
import { subscribeOfflineState, syncOfflineQueue, clearFailedQueueItem } from '../lib/offlineSync';

export default function OfflineBanner() {
  const [state, setState] = useState({ online: true, pendingCount: 0, syncing: false, lastSyncResult: null });
  const [showSyncedToast, setShowSyncedToast] = useState(false);

  useEffect(() => {
    return subscribeOfflineState((next) => {
      setState(next);
      if (next.lastSyncResult?.ok && next.lastSyncResult.count > 0 && next.pendingCount === 0) {
        setShowSyncedToast(true);
        setTimeout(() => setShowSyncedToast(false), 4500);
      }
    });
  }, []);

  if (state.online && state.pendingCount === 0 && !state.syncing && !state.lastSyncResult?.error && !showSyncedToast) {
    return null;
  }

  // Synced confirmation toast
  if (state.online && state.pendingCount === 0 && showSyncedToast && !state.lastSyncResult?.error) {
    return (
      <div className="bg-[#4A6D5C] text-white px-4 py-2 text-xs flex items-center justify-center gap-2">
        <CheckCircle2 className="w-4 h-4 shrink-0" />
        <span>Back online — all offline changes synced to server!</span>
      </div>
    );
  }

  // Offline banner
  if (!state.online) {
    return (
      <div className="bg-[#C77A34] text-white px-4 py-2 text-xs flex items-center justify-center gap-2 flex-wrap">
        <WifiOff className="w-4 h-4 shrink-0" />
        <span>
          <strong>You are offline</strong> — changes are saved on this device and will sync automatically when internet connects
          {state.pendingCount > 0 ? ` (${state.pendingCount} pending)` : ''}.
        </span>
      </div>
    );
  }

  // Sync error banner
  if (state.lastSyncResult?.error) {
    return (
      <div className="bg-[#8C3B3B] text-white px-4 py-2 text-xs flex items-center justify-center gap-3 flex-wrap">
        <span className="flex items-center gap-1.5">
          <AlertTriangle className="w-4 h-4 shrink-0" />
          Sync issue: {state.lastSyncResult.error} ({state.pendingCount} pending)
        </span>
        <button
          onClick={() => syncOfflineQueue()}
          className="underline font-medium hover:opacity-80"
        >
          Retry
        </button>
        <button
          onClick={() => clearFailedQueueItem()}
          className="underline opacity-80 hover:opacity-100"
        >
          Discard failed item
        </button>
      </div>
    );
  }

  // Online with pending items / syncing
  return (
    <div className="bg-[#2B1610] text-[#F8F4EC] px-4 py-2 text-xs flex items-center justify-center gap-3 flex-wrap">
      <RefreshCw className={`w-3.5 h-3.5 shrink-0 ${state.syncing ? 'animate-spin' : ''}`} />
      <span>
        {state.syncing
          ? `Syncing ${state.pendingCount} offline change(s) to server…`
          : `You have ${state.pendingCount} offline change(s) waiting to sync.`}
      </span>
      {!state.syncing && (
        <button
          onClick={() => syncOfflineQueue()}
          className="bg-[#B8792F] text-white px-2.5 py-0.5 text-xs hover:opacity-90"
        >
          Sync now
        </button>
      )}
    </div>
  );
}
