// Optional hard-coded default. Leave empty and set the Client ID from the popup
// (stored in extension storage) — handy for personal/unpublished use.
export const DEFAULT_CLIENT_ID = '';

export const DRIVE_SCOPE = 'https://www.googleapis.com/auth/drive.appdata';

// OAuth redirect target: a page on the PWA the extension injects a content
// script into. Using a normal tab (vs launchWebAuthFlow's restricted window) is
// what lets Google's multi-account chooser work. Register this exact URL under
// the OAuth client's "Authorized redirect URIs".
export const OAUTH_REDIRECT = 'https://atmo.github.io/stanki/oauth.html';
