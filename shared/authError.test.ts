import { describe, it, expect } from 'vitest';
import { authErrorMessage } from './authError';

const pwa = { surface: 'pwa' as const, origin: 'https://atmo.github.io' };
const ext = { surface: 'extension' as const, redirectUri: 'https://abc.extensions.allizom.org/' };

describe('authErrorMessage', () => {
  it('noClientId is surface-specific', () => {
    expect(authErrorMessage('noClientId', ext)).toMatch(/popup/i);
    expect(authErrorMessage('noClientId', pwa)).toMatch(/VITE_GOOGLE_CLIENT_ID/);
  });

  it('cancelled points at the right setting per surface, and mentions Test user', () => {
    const e = authErrorMessage('cancelled', ext);
    expect(e).toContain(ext.redirectUri);
    expect(e).toMatch(/Authorized redirect URIs/);
    expect(e).toMatch(/Test user/);

    const p = authErrorMessage('cancelled', pwa);
    expect(p).toContain(pwa.origin);
    expect(p).toMatch(/Authorized JavaScript origins/);
    expect(p).toMatch(/Test user/);
  });

  it('accessDenied is the same Test-user guidance on both surfaces', () => {
    const e = authErrorMessage('accessDenied', ext);
    const p = authErrorMessage('accessDenied', pwa);
    expect(e).toBe(p);
    expect(e).toMatch(/Test user/);
  });

  it('popupBlocked is shared', () => {
    expect(authErrorMessage('popupBlocked', ext)).toBe(authErrorMessage('popupBlocked', pwa));
  });

  it('unknown falls back to the raw message when present', () => {
    expect(authErrorMessage('unknown', pwa, 'boom')).toBe('boom');
    expect(authErrorMessage('unknown', pwa)).toMatch(/sign-in failed/i);
  });
});
