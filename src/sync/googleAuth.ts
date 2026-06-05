// Google Identity Services (GIS) browser token flow. No client secret, no
// backend: we request a short-lived access token for the drive.appdata scope.

import { GOOGLE_CLIENT_ID, DRIVE_SCOPE, isDriveConfigured } from '../config';
import { authErrorMessage, type AuthErrorKind } from '@shared/authError';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
  error_description?: string;
}
interface TokenErrorResponse {
  type?: string; // e.g. 'popup_closed', 'popup_failed_to_open'
  message?: string;
}
interface TokenClientConfig {
  client_id: string;
  scope: string;
  callback: (resp: TokenResponse) => void;
  error_callback?: (err: TokenErrorResponse) => void;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
}
interface GsiOAuth2 {
  initTokenClient: (cfg: TokenClientConfig) => TokenClient;
  revoke: (token: string, done?: () => void) => void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GsiOAuth2 } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let scriptPromise: Promise<void> | null = null;
let accessToken: string | null = null;
let expiresAt = 0;

// Persist the short-lived token so relaunching within its lifetime stays signed
// in. Google's browser token flow has no refresh token, so once it expires
// (~1h) a one-click reconnect is unavoidable without a backend.
const TOKEN_KEY = 'stanki.googleToken';

function persistToken(): void {
  try {
    localStorage.setItem(TOKEN_KEY, JSON.stringify({ accessToken, expiresAt }));
  } catch {
    /* storage may be unavailable */
  }
}
function clearPersistedToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    /* ignore */
  }
}
function restoreToken(): void {
  try {
    const raw = localStorage.getItem(TOKEN_KEY);
    if (!raw) return;
    const saved = JSON.parse(raw) as { accessToken?: string; expiresAt?: number };
    // Only restore if it hasn't expired, so the app never auto-syncs with a dead token.
    if (saved.accessToken && typeof saved.expiresAt === 'number' && Date.now() < saved.expiresAt) {
      accessToken = saved.accessToken;
      expiresAt = saved.expiresAt;
    } else {
      clearPersistedToken();
    }
  } catch {
    /* ignore malformed */
  }
}
restoreToken();

function loadGis(): Promise<void> {
  if (scriptPromise) return scriptPromise;
  scriptPromise = new Promise((resolve, reject) => {
    if (window.google?.accounts?.oauth2) return resolve();
    const s = document.createElement('script');
    s.src = GIS_SRC;
    s.async = true;
    s.defer = true;
    s.onload = () => resolve();
    s.onerror = () => reject(new Error('Failed to load Google Identity Services'));
    document.head.appendChild(s);
  });
  return scriptPromise;
}

function authError(kind: AuthErrorKind, raw?: string): Error {
  const msg = authErrorMessage(kind, { surface: 'pwa', origin: location.origin }, raw);
  console.error('[Stanki] Google auth failed:', { kind, origin: location.origin, raw });
  return new Error(msg);
}

function requestToken(interactive: boolean): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!isDriveConfigured()) {
      reject(authError('noClientId'));
      return;
    }
    loadGis()
      .then(() => {
        const oauth2 = window.google!.accounts!.oauth2!;
        const client = oauth2.initTokenClient({
          client_id: GOOGLE_CLIENT_ID,
          scope: DRIVE_SCOPE,
          callback: (resp) => {
            if (resp.error || !resp.access_token) {
              const kind: AuthErrorKind = resp.error === 'access_denied' ? 'accessDenied' : 'unknown';
              reject(authError(kind, resp.error_description || resp.error));
              return;
            }
            accessToken = resp.access_token;
            expiresAt = Date.now() + (resp.expires_in - 60) * 1000; // refresh 1m early
            persistToken();
            resolve(accessToken);
          },
          // Without this, popup/origin failures close the window with no error.
          error_callback: (err) => {
            const kind: AuthErrorKind =
              err?.type === 'popup_closed'
                ? 'cancelled'
                : err?.type === 'popup_failed_to_open'
                  ? 'popupBlocked'
                  : 'unknown';
            reject(authError(kind, err?.message));
          },
        });
        // '' attempts a silent grant; 'consent' forces the account chooser.
        client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
      })
      .catch(reject);
  });
}

/** Interactive sign-in (shows Google's consent/account UI). */
export function signIn(): Promise<string> {
  return requestToken(true);
}

/** Token provider for the Drive API: reuse the cached token, else refresh silently. */
export async function getToken(): Promise<string> {
  if (accessToken && Date.now() < expiresAt) return accessToken;
  return requestToken(false);
}

export function isSignedIn(): boolean {
  return !!accessToken && Date.now() < expiresAt;
}

export function signOut(): void {
  if (accessToken && window.google?.accounts?.oauth2) {
    window.google.accounts.oauth2.revoke(accessToken);
  }
  accessToken = null;
  expiresAt = 0;
  clearPersistedToken();
}
