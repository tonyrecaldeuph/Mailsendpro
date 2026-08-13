import test from 'node:test';
import assert from 'node:assert/strict';
import { buildAuthUrl, parseTokenFromRedirect } from '../ui/gmailAuth.js';

test('la URL de autorización pide un token con los dos scopes', () => {
  const url = new URL(buildAuthUrl({
    clientId: '123.apps.googleusercontent.com',
    redirectUri: 'https://abc.chromiumapp.org/',
    prompt: 'consent'
  }));
  assert.equal(url.origin + url.pathname, 'https://accounts.google.com/o/oauth2/v2/auth');
  assert.equal(url.searchParams.get('response_type'), 'token');
  assert.equal(url.searchParams.get('client_id'), '123.apps.googleusercontent.com');
  assert.equal(url.searchParams.get('redirect_uri'), 'https://abc.chromiumapp.org/');
  assert.equal(url.searchParams.get('prompt'), 'consent');
  assert.match(url.searchParams.get('scope'), /gmail\.send/);
  assert.match(url.searchParams.get('scope'), /userinfo\.email/);
});

test('login_hint solo aparece cuando se pasa', () => {
  const sin = new URL(buildAuthUrl({ clientId: 'x', redirectUri: 'y', prompt: 'none' }));
  assert.equal(sin.searchParams.get('login_hint'), null);

  const con = new URL(buildAuthUrl({ clientId: 'x', redirectUri: 'y', prompt: 'none', loginHint: 'a@b.com' }));
  assert.equal(con.searchParams.get('login_hint'), 'a@b.com');
});

test('el token se lee del fragmento de la URL de redirección', () => {
  const result = parseTokenFromRedirect('https://abc.chromiumapp.org/#access_token=ya29.TOKEN&expires_in=3599&token_type=Bearer');
  assert.equal(result.accessToken, 'ya29.TOKEN');
  assert.equal(result.expiresInMs, 3599 * 1000);
});

test('una redirección sin token devuelve null', () => {
  assert.equal(parseTokenFromRedirect('https://abc.chromiumapp.org/#error=access_denied'), null);
  assert.equal(parseTokenFromRedirect('https://abc.chromiumapp.org/'), null);
  assert.equal(parseTokenFromRedirect(undefined), null);
});
