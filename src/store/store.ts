import { create } from 'zustand';
import { signIn, signOut, getToken, isSignedIn } from '../sync/googleAuth';
import { syncAll } from '../sync/sync';
import { getLastSync } from '../db/repo';
import { isDriveConfigured } from '../config';

export type SyncStatus = 'idle' | 'syncing' | 'error';

interface AppState {
  connected: boolean;
  syncStatus: SyncStatus;
  syncError: string | null;
  lastSync: number | null;
  configured: boolean;

  init: () => Promise<void>;
  connect: () => Promise<void>;
  disconnect: () => void;
  syncNow: () => Promise<void>;
}

export const useStore = create<AppState>((set, get) => ({
  connected: isSignedIn(),
  syncStatus: 'idle',
  syncError: null,
  lastSync: null,
  configured: isDriveConfigured(),

  async init() {
    set({ lastSync: await getLastSync(), connected: isSignedIn() });
  },

  async connect() {
    set({ syncError: null });
    try {
      await signIn();
      set({ connected: true });
      await get().syncNow();
    } catch (e) {
      set({ connected: false, syncStatus: 'error', syncError: errMsg(e) });
    }
  },

  disconnect() {
    signOut();
    set({ connected: false, syncStatus: 'idle', syncError: null });
  },

  async syncNow() {
    if (!get().connected) return;
    set({ syncStatus: 'syncing', syncError: null });
    try {
      await syncAll(getToken);
      set({ syncStatus: 'idle', lastSync: await getLastSync() });
    } catch (e) {
      set({ syncStatus: 'error', syncError: errMsg(e) });
    }
  },
}));

function errMsg(e: unknown): string {
  return e instanceof Error ? e.message : String(e);
}
