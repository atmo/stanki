// Shared, surface-aware OAuth error messages so the PWA (GIS token flow) and the
// extension (launchWebAuthFlow) explain failures the same way — and actionably.
//
// The two surfaces fail in different shapes (GIS error.type vs. a rejected
// launchWebAuthFlow / an `error` param), so each caller normalizes to a kind and
// passes its own context (origin for the PWA, redirect URI for the extension).

export type AuthErrorKind =
  | 'cancelled' // window closed without a completed redirect (often misconfig)
  | 'popupBlocked'
  | 'accessDenied'
  | 'noClientId'
  | 'unknown';

export interface AuthErrorContext {
  surface: 'pwa' | 'extension';
  origin?: string; // PWA: location.origin
  redirectUri?: string; // extension: identity.getRedirectURL()
}

export function authErrorMessage(
  kind: AuthErrorKind,
  ctx: AuthErrorContext,
  raw?: string,
): string {
  switch (kind) {
    case 'noClientId':
      return ctx.surface === 'extension'
        ? 'Set your Google OAuth Client ID in the popup first.'
        : 'Google Client ID is not configured (set VITE_GOOGLE_CLIENT_ID).';

    case 'popupBlocked':
      return 'The Google popup was blocked. Allow popups for this site and try again.';

    case 'accessDenied':
      return (
        'Access was denied. If you didn’t decline, your Google account probably isn’t ' +
        'added as a Test user on the OAuth consent screen.'
      );

    case 'cancelled': {
      const cause =
        ctx.surface === 'extension'
          ? `this extension’s redirect URI (${ctx.redirectUri ?? 'shown in the popup'}) isn’t ` +
            'registered under “Authorized redirect URIs”'
          : `this site’s origin (${ctx.origin ?? 'this site'}) isn’t listed under ` +
            '“Authorized JavaScript origins”';
      return (
        'The Google window closed before finishing. If you didn’t cancel, the most likely ' +
        `cause is that ${cause} on your OAuth client — or your account isn’t a Test user.`
      );
    }

    default:
      return raw || 'Google sign-in failed.';
  }
}
