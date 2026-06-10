// Baked in at build time (see build.mjs) from the GOOGLE_CLIENT_ID env var or
// the repo .env's VITE_GOOGLE_CLIENT_ID. The OAuth client ID is public-by-design,
// so shipping it in the built extension is safe. An empty string falls back to a
// Client ID entered in the popup (stored in extension storage).
declare const __CLIENT_ID__: string;
export const DEFAULT_CLIENT_ID = __CLIENT_ID__;

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// OAuth redirect target: a page on the PWA the extension injects a content
// script into. Using a normal tab (vs launchWebAuthFlow's restricted window) is
// what lets Google's multi-account chooser work. Register this exact URL under
// the OAuth client's "Authorized redirect URIs".
export const OAUTH_REDIRECT = 'https://atmo.github.io/stanki/oauth.html';
