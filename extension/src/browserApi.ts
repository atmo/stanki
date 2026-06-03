// Minimal cross-browser shim. Firefox exposes promise-based `browser.*`;
// Chrome MV3 returns promises from `chrome.*` when no callback is passed.
// We pick whichever exists and use promise-style calls throughout.

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const ext: any = (globalThis as any).browser ?? (globalThis as any).chrome;

export const runtime = ext.runtime;
export const contextMenus = ext.contextMenus;
export const identity = ext.identity;
export const scripting = ext.scripting;
export const action = ext.action ?? ext.browserAction;
export const storageLocal = ext.storage.local as {
  get: (keys?: string | string[] | null) => Promise<Record<string, unknown>>;
  set: (items: Record<string, unknown>) => Promise<void>;
};

export default ext;
