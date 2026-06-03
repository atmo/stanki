// Google Identity Services (GIS) browser token flow. No client secret, no
// backend: we request a short-lived access token for the drive.appdata scope.

import { GOOGLE_CLIENT_ID, DRIVE_SCOPE, isDriveConfigured } from '../config';

interface TokenResponse {
  access_token: string;
  expires_in: number;
  error?: string;
}
interface TokenClient {
  requestAccessToken: (opts?: { prompt?: string }) => void;
  callback: (resp: TokenResponse) => void;
}
interface GsiOAuth2 {
  initTokenClient: (cfg: {
    client_id: string;
    scope: string;
    callback: (resp: TokenResponse) => void;
  }) => TokenClient;
  revoke: (token: string, done?: () => void) => void;
}
declare global {
  interface Window {
    google?: { accounts?: { oauth2?: GsiOAuth2 } };
  }
}

const GIS_SRC = 'https://accounts.google.com/gsi/client';

let scriptPromise: Promise<void> | null = null;
let tokenClient: TokenClient | null = null;
let accessToken: string | null = null;
let expiresAt = 0;

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

async function getClient(): Promise<TokenClient> {
  if (!isDriveConfigured()) {
    throw new Error('Google Client ID is not configured (set VITE_GOOGLE_CLIENT_ID).');
  }
  await loadGis();
  const oauth2 = window.google!.accounts!.oauth2!;
  if (!tokenClient) {
    tokenClient = oauth2.initTokenClient({
      client_id: GOOGLE_CLIENT_ID,
      scope: DRIVE_SCOPE,
      callback: () => {}, // replaced per-request below
    });
  }
  return tokenClient;
}

function requestToken(interactive: boolean): Promise<string> {
  return new Promise(async (resolve, reject) => {
    try {
      const client = await getClient();
      client.callback = (resp: TokenResponse) => {
        if (resp.error || !resp.access_token) {
          reject(new Error(resp.error ?? 'Authorization failed'));
          return;
        }
        accessToken = resp.access_token;
        expiresAt = Date.now() + (resp.expires_in - 60) * 1000; // refresh 1m early
        resolve(accessToken);
      };
      // '' attempts a silent grant; 'consent' forces the account chooser.
      client.requestAccessToken({ prompt: interactive ? 'consent' : '' });
    } catch (e) {
      reject(e);
    }
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
}
