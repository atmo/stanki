// vConsole gives an on-screen devtools console, which is the only practical way
// to watch what the app is doing on a phone. It is ~400KB, so it is dynamically
// imported and only when explicitly switched on — Vite splits it into its own
// chunk that a normal session never fetches.
const KEY = 'stanki:debugConsole';

export const debugConsoleOn = (): boolean => {
  try {
    return localStorage.getItem(KEY) === '1';
  } catch {
    return false; // storage blocked (private mode); simply stay off
  }
};

export function setDebugConsole(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** Load and start vConsole if it's switched on. Safe to await unconditionally. */
export async function initDebugConsole(): Promise<void> {
  if (!debugConsoleOn()) return;
  try {
    const { default: VConsole } = await import('vconsole');
    new VConsole();
  } catch {
    /* the console failing to load must not take the app with it */
  }
}
