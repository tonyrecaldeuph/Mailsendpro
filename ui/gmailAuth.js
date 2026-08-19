/**
 * OAuth contra la cuenta de Gmail del usuario (flujo implícito).
 *
 * IMPORTANTE: este módulo corre SIEMPRE en el service worker, nunca en el
 * popup. El dashboard es un popup y se cierra al perder el foco: si el flujo
 * se lanzara desde ahí, la ventana de consentimiento de Google le robaría el
 * foco, el popup moriría y la promesa del token se perdería. El dashboard
 * habla con este módulo por mensajes (GMAIL_STATUS / GMAIL_CONNECT /
 * GMAIL_DISCONNECT), igual que ya hace con la licencia.
 *
 * Flujo implícito y no código+PKCE porque la carpeta de la extensión se le
 * entrega al cliente: cualquier client_secret que viviera acá sería público.
 */

// ID de cliente OAuth (tipo "Aplicación web") del proyecto Mailsendpro en
// Google Cloud. No es un secreto: viaja en la URL de autorización y por eso
// puede vivir en la carpeta que se le entrega al cliente.
export const CLIENT_ID = '693802762631-lt4bo2h51t992s68d3l5ootr5sg5g378.apps.googleusercontent.com';

const AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';
const USERINFO_ENDPOINT = 'https://www.googleapis.com/oauth2/v3/userinfo';
const REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';

const SCOPES = [
  'https://www.googleapis.com/auth/gmail.send',
  'https://www.googleapis.com/auth/userinfo.email'
];

const TOKEN_KEY = 'gmail_access_token';
const TOKEN_EXPIRY_KEY = 'gmail_token_expiry';
const ACCOUNT_KEY = 'gmail_account_email';

// Margen para no empezar un envío con un token que vence a mitad de camino.
const RENEW_MARGIN_MS = 2 * 60 * 1000;

export class AuthRequiredError extends Error {
  constructor(message = 'Se necesita conectar una cuenta de Gmail.') {
    super(message);
    this.name = 'AuthRequiredError';
  }
}

export function buildAuthUrl({ clientId, redirectUri, prompt, loginHint }) {
  const params = new URLSearchParams({
    client_id: clientId,
    response_type: 'token',
    redirect_uri: redirectUri,
    scope: SCOPES.join(' '),
    prompt
  });
  if (loginHint) params.set('login_hint', loginHint);
  return `${AUTH_ENDPOINT}?${params.toString()}`;
}

export function parseTokenFromRedirect(redirectUrl) {
  const fragment = String(redirectUrl || '').split('#')[1];
  if (!fragment) return null;
  const params = new URLSearchParams(fragment);
  const accessToken = params.get('access_token');
  if (!accessToken) return null;
  const expiresIn = parseInt(params.get('expires_in'), 10) || 3600;
  return { accessToken, expiresInMs: expiresIn * 1000 };
}

async function fetchAccountEmail(accessToken) {
  try {
    const response = await fetch(USERINFO_ENDPOINT, {
      headers: { Authorization: `Bearer ${accessToken}` }
    });
    if (!response.ok) return null;
    const data = await response.json();
    return data.email || null;
  } catch (err) {
    console.warn('[gmail] no se pudo leer el correo de la cuenta:', err?.message || err);
    return null;
  }
}

/**
 * Corre el flujo y persiste el resultado.
 * @param {'none'|'select_account'|'consent'} prompt
 * @returns {Promise<{email: string|null}|null>} null si el flujo no dio token
 */
async function runAuthFlow(prompt, loginHint) {
  if (!CLIENT_ID) {
    throw new AuthRequiredError('Falta configurar CLIENT_ID en ui/gmailAuth.js.');
  }

  const url = buildAuthUrl({
    clientId: CLIENT_ID,
    redirectUri: chrome.identity.getRedirectURL(),
    prompt,
    loginHint
  });

  const redirect = await chrome.identity
    .launchWebAuthFlow({ url, interactive: prompt !== 'none' })
    .catch(() => null);

  const token = parseTokenFromRedirect(redirect);
  if (!token) return null;

  await chrome.storage.session.set({
    [TOKEN_KEY]: token.accessToken,
    [TOKEN_EXPIRY_KEY]: Date.now() + token.expiresInMs
  });

  const email = await fetchAccountEmail(token.accessToken);
  if (email) await chrome.storage.local.set({ [ACCOUNT_KEY]: email });

  return { email };
}

/**
 * Intento silencioso contra la sesión de Google del navegador. No abre
 * ventanas: si no hay sesión activa, o la cuenta nunca autorizó la app,
 * devuelve null y la UI muestra "desconectado".
 */
export async function detectActiveAccount() {
  const known = await getConnectedAccount();
  return runAuthFlow('none', known?.email).catch(() => null);
}

/**
 * @param {{selectAccount?: boolean}} options selectAccount fuerza el selector
 *   de cuentas de Google, que es como se elige la casilla de relevo.
 */
export async function connect({ selectAccount = false } = {}) {
  const result = await runAuthFlow(selectAccount ? 'select_account' : 'consent');
  if (!result) throw new AuthRequiredError('El usuario canceló la conexión o Google no devolvió un token.');
  return result;
}

export async function getConnectedAccount() {
  const { [ACCOUNT_KEY]: email } = await chrome.storage.local.get([ACCOUNT_KEY]);
  return email ? { email } : null;
}

/**
 * Token vigente para enviar. Se llama una vez por correo: como cachea en
 * chrome.storage.session, el costo es nulo, y es lo que hace que al reanudar
 * con otra cuenta el envío tome la cuenta nueva sin reestructurar el bucle.
 */
export async function getAccessToken() {
  const stored = await chrome.storage.session.get([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
  const token = stored[TOKEN_KEY];
  const expiry = stored[TOKEN_EXPIRY_KEY];

  if (token && expiry && Date.now() < expiry - RENEW_MARGIN_MS) {
    return token;
  }

  const account = await getConnectedAccount();
  const renewed = await runAuthFlow('none', account?.email);
  if (!renewed) throw new AuthRequiredError('La sesión de Google expiró. Volvé a conectar la cuenta.');

  const fresh = await chrome.storage.session.get([TOKEN_KEY]);
  return fresh[TOKEN_KEY];
}

/**
 * Descarta el token cacheado sin desconectar la cuenta. Lo usa background.js
 * cuando Gmail responde 401, para forzar la renovación en el reintento.
 */
export async function invalidateToken() {
  await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
}

export async function disconnect() {
  const stored = await chrome.storage.session.get([TOKEN_KEY]);
  const token = stored[TOKEN_KEY];
  if (token) {
    await fetch(`${REVOKE_ENDPOINT}?token=${encodeURIComponent(token)}`, { method: 'POST' })
      .catch((err) => console.warn('[gmail] revoke falló:', err?.message || err));
  }
  await chrome.storage.session.remove([TOKEN_KEY, TOKEN_EXPIRY_KEY]);
  await chrome.storage.local.remove([ACCOUNT_KEY]);
}
