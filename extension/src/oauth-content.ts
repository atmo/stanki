// Runs on the OAuth redirect page (oauth.html). Reads the access token from the
// URL fragment and hands it to the background, which stores it and closes this
// tab. Doing the sign-in in a real tab (not launchWebAuthFlow's window) is what
// makes Google's multi-account chooser work.

const ext = (globalThis as { browser?: typeof chrome; chrome?: typeof chrome }).browser ?? chrome;

const params = new URLSearchParams(location.hash.slice(1));
const accessToken = params.get('access_token');
const error = params.get('error');

if (accessToken || error) {
  ext.runtime.sendMessage({
    type: 'oauthRedirect',
    accessToken,
    expiresIn: Number(params.get('expires_in') ?? '0'),
    error,
  });
}
