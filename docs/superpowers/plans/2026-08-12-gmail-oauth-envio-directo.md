# Envío directo por Gmail API con relevo de cuentas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que MailerPro envíe directo desde la cuenta de Gmail del usuario vía OAuth, eliminando el backend de Apps Script y el paso de configuración que hoy bloquea la campaña, y permitiendo relevar la cuenta cuando agota su cuota diaria para cubrir 1.000 envíos/día.

**Architecture:** Un módulo `gmailAuth.js` encapsula OAuth (flujo implícito con `chrome.identity.launchWebAuthFlow`) y corre **siempre en el service worker**, porque el dashboard es un popup que se cierra al perder el foco. Un módulo puro `mimeBuilder.js` arma el mensaje RFC 2822 que antes construía `Code.gs`. Otro módulo puro `gmailErrors.js` clasifica las respuestas de error de la API para decidir entre reintentar, fallar la fila o pausar por cuota agotada. `background.js` envía contra `https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send` pidiendo el token **dentro** del bucle, lo que hace que el relevo de cuenta funcione sin tocar el índice de progreso.

**Tech Stack:** Chrome Extension MV3 (ESM en el service worker), Gmail API v1, OAuth 2.0 implícito, `node:test` para los módulos puros (Node v22.20.0 disponible).

**Spec:** `docs/superpowers/specs/2026-08-12-mailerpro-gmail-oauth-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `ui/mimeBuilder.js` (nuevo) | Construir el MIME RFC 2822. Puro: sin `chrome.*`, sin red, sin DOM |
| `ui/gmailErrors.js` (nuevo) | Clasificar errores de la Gmail API en `auth` / `quota` / `rate` / `recipient`. Puro |
| `ui/gmailAuth.js` (nuevo) | OAuth: conectar, detectar en silencio, renovar, revocar. Solo service worker |
| `tests/mimeBuilder.test.js` (nuevo) | Test unitario del MIME |
| `tests/gmailErrors.test.js` (nuevo) | Test unitario del clasificador |
| `tests/gmailAuth.test.js` (nuevo) | Test de las partes puras de gmailAuth (URL y parseo del fragmento) |
| `package.json` (nuevo) | `{"type":"module"}` para que Node pueda importar los módulos ESM en los tests |
| `background.js` | Transporte Gmail API, validación de licencia al iniciar, pausa por cuota, handlers `GMAIL_*` |
| `ui/dashboard.js` | Bloque "Cuenta de envío", banner de relevo, gate del botón, sin `apiKey`/`apiToken` |
| `ui/dashboard.html` | Modal Configuración sin URL ni Token; banner de cuota |
| `manifest.json` | Permiso `identity`, host_permissions, `key` estable |
| `google-apps-script/Code.gs` | **Se elimina** |
| `INSTRUCCIONES.md` | Reescritura de los pasos de setup y de los límites reales |

`gmailErrors.js` es un agregado del plan sobre el spec: el spec describe la tabla de clasificación de errores (§3.4) sin asignarle archivo. Se separa de `background.js` para poder testearlo.

---

### Task 0: Base de trabajo (git + package.json)

**Files:**
- Create: `package.json`
- Create: `.gitignore`

- [ ] **Step 1: Inicializar el repositorio**

La carpeta no es un repo git hoy, así que no hay red de seguridad para revertir. Crearla primero.

```bash
cd "C:/Users/HP/Desktop/DESARROLLOS_UPHONE/MailerPro"
git init
```

- [ ] **Step 2: Crear `.gitignore`**

```
node_modules/
*.pem
graphify-out/cache/
```

El `*.pem` importa: en la Task 3 se genera la clave privada de la extensión y no debe entrar al repo.

- [ ] **Step 3: Crear `package.json`**

Chrome ignora este archivo; existe solo para que `node --test` pueda importar los módulos ESM de `ui/`.

```json
{
  "name": "mailerpro",
  "version": "1.2.0",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/"
  }
}
```

- [ ] **Step 4: Commit de la línea base**

```bash
git add -A
git commit -m "chore: repositorio inicial antes de migrar a Gmail API"
```

---

### Task 1: `mimeBuilder.js` — construcción del mensaje

**Files:**
- Create: `ui/mimeBuilder.js`
- Test: `tests/mimeBuilder.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/mimeBuilder.test.js`. Las boundaries se inyectan para que el test sea determinístico.

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildMimeMessage, encodeHeaderWord, wrapBase64 } from '../ui/mimeBuilder.js';

const fixedBoundary = (prefix) => `BOUNDARY_${prefix}`;

const base = {
  fromName: 'Mi Empresa',
  fromEmail: 'cobranzas@empresa.com',
  to: 'cliente@ejemplo.com',
  subject: 'Recordatorio',
  html: '<p>Hola</p>',
  boundaryFactory: fixedBoundary
};

function decodeBase64Body(mime) {
  const body = mime.split('\r\n\r\n').slice(1).join('\r\n\r\n');
  return Buffer.from(body.replace(/\r\n/g, ''), 'base64').toString('utf8');
}

test('sin adjuntos produce un text/html simple', () => {
  const mime = buildMimeMessage(base);
  assert.match(mime, /^From: "Mi Empresa" <cobranzas@empresa\.com>\r\n/);
  assert.match(mime, /\r\nTo: cliente@ejemplo\.com\r\n/);
  assert.match(mime, /\r\nSubject: Recordatorio\r\n/);
  assert.match(mime, /\r\nMIME-Version: 1\.0\r\n/);
  assert.match(mime, /Content-Type: text\/html; charset=UTF-8/);
  assert.ok(!mime.includes('multipart'));
  assert.equal(decodeBase64Body(mime), '<p>Hola</p>');
});

test('el asunto con acentos va codificado en RFC 2047', () => {
  const mime = buildMimeMessage({ ...base, subject: 'Notificación de cobranza' });
  assert.match(mime, /Subject: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?=/);
  const encoded = mime.match(/Subject: =\?UTF-8\?B\?([A-Za-z0-9+/=]+)\?=/)[1];
  assert.equal(Buffer.from(encoded, 'base64').toString('utf8'), 'Notificación de cobranza');
});

test('el nombre del remitente con acentos no va entre comillas', () => {
  const mime = buildMimeMessage({ ...base, fromName: 'Cobranzas Perú' });
  assert.match(mime, /^From: =\?UTF-8\?B\?[A-Za-z0-9+/=]+\?= <cobranzas@empresa\.com>/);
});

test('con imagen produce multipart/related con Content-ID', () => {
  const mime = buildMimeMessage({
    ...base,
    inlineImages: [{ filename: 'promo.png', mimeType: 'image/png', base64: 'AAAA' }]
  });
  assert.match(mime, /Content-Type: multipart\/related; boundary="BOUNDARY_rel"/);
  assert.match(mime, /Content-ID: <img0>/);
  assert.match(mime, /Content-Disposition: inline; filename="promo\.png"/);
  assert.ok(mime.includes('--BOUNDARY_rel--'));
});

test('el HTML referencia la imagen embebida por cid', () => {
  const mime = buildMimeMessage({
    ...base,
    inlineImages: [{ filename: 'promo.png', mimeType: 'image/png', base64: 'AAAA' }]
  });
  const htmlPart = mime.split('--BOUNDARY_rel')[1];
  const htmlBody = Buffer.from(htmlPart.split('\r\n\r\n')[1].replace(/\r\n/g, ''), 'base64').toString('utf8');
  assert.match(htmlBody, /<img src="cid:img0"/);
});

test('con PDF produce multipart/mixed con el adjunto', () => {
  const mime = buildMimeMessage({
    ...base,
    attachments: [{ filename: 'factura.pdf', mimeType: 'application/pdf', base64: 'QkJCQg==' }]
  });
  assert.match(mime, /Content-Type: multipart\/mixed; boundary="BOUNDARY_mix"/);
  assert.match(mime, /Content-Disposition: attachment; filename="factura\.pdf"/);
  assert.ok(!mime.includes('multipart/related'));
});

test('con imagen y PDF anida related dentro de mixed', () => {
  const mime = buildMimeMessage({
    ...base,
    inlineImages: [{ filename: 'promo.png', mimeType: 'image/png', base64: 'AAAA' }],
    attachments: [{ filename: 'factura.pdf', mimeType: 'application/pdf', base64: 'QkJCQg==' }]
  });
  assert.ok(mime.indexOf('multipart/mixed') < mime.indexOf('multipart/related'));
  assert.match(mime, /Content-ID: <img0>/);
  assert.match(mime, /Content-Disposition: attachment; filename="factura\.pdf"/);
});

test('los saltos de línea y barras en el nombre de archivo se sanitizan', () => {
  const mime = buildMimeMessage({
    ...base,
    attachments: [{ filename: 'fac\r\ntura/2026.pdf', mimeType: 'application/pdf', base64: 'QkJCQg==' }]
  });
  assert.match(mime, /filename="fac__tura_2026\.pdf"/);
});

test('wrapBase64 corta en líneas de 76 caracteres', () => {
  const lines = wrapBase64('A'.repeat(200)).split('\r\n');
  assert.equal(lines[0].length, 76);
  assert.ok(lines.every((l) => l.length <= 76));
});

test('encodeHeaderWord deja el ASCII puro sin tocar', () => {
  assert.equal(encodeHeaderWord('Hello World'), 'Hello World');
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test tests/mimeBuilder.test.js`
Expected: FAIL — `Cannot find module '../ui/mimeBuilder.js'`

- [ ] **Step 3: Implementar `ui/mimeBuilder.js`**

```js
/**
 * Construcción del mensaje RFC 2822 que se manda a la Gmail API.
 * Módulo puro: sin chrome.*, sin red, sin DOM — por eso es testeable.
 * Reemplaza el armado de correo que antes hacía google-apps-script/Code.gs.
 */

const CRLF = '\r\n';

function utf8Bytes(str) {
  return new TextEncoder().encode(str);
}

function bytesToBase64(bytes) {
  let binary = '';
  for (let i = 0; i < bytes.length; i += 1) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64Utf8(str) {
  return bytesToBase64(utf8Bytes(str));
}

/** RFC 2045 exige líneas de máximo 76 caracteres en los cuerpos base64. */
export function wrapBase64(b64) {
  return (String(b64).match(/.{1,76}/g) || []).join(CRLF);
}

/**
 * RFC 2047: una cabecera con caracteres no-ASCII (acentos, ñ) tiene que ir
 * codificada o llega rota al destinatario.
 */
export function encodeHeaderWord(text) {
  const value = String(text || '');
  if (/^[\x20-\x7E]*$/.test(value)) return value;
  return `=?UTF-8?B?${base64Utf8(value)}?=`;
}

// Mismo criterio que usaba sanitizeFilename() en Code.gs.
function sanitizeFilename(name) {
  return String(name).replace(/[\r\n/\\]/g, '_').slice(0, 120);
}

/**
 * Un encoded-word de RFC 2047 no puede ir dentro de un string entrecomillado,
 * así que el nombre se entrecomilla solo cuando es ASCII puro.
 */
function formatAddress(name, email) {
  const clean = String(name || '').trim();
  if (!clean) return email;
  const encoded = encodeHeaderWord(clean);
  return encoded === clean ? `"${clean.replace(/"/g, '')}" <${email}>` : `${encoded} <${email}>`;
}

function defaultBoundaryFactory(prefix) {
  return `${prefix}_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

function textHtmlPart(html) {
  return [
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: base64',
    '',
    wrapBase64(base64Utf8(html))
  ].join(CRLF);
}

function binaryPart({ filename, mimeType, base64 }, { inline, cid }) {
  const safeName = sanitizeFilename(filename);
  const headerName = encodeHeaderWord(safeName);
  const lines = [
    `Content-Type: ${mimeType}; name="${headerName}"`,
    'Content-Transfer-Encoding: base64'
  ];
  if (inline) {
    lines.push(`Content-ID: <${cid}>`);
    lines.push(`Content-Disposition: inline; filename="${headerName}"`);
  } else {
    lines.push(`Content-Disposition: attachment; filename="${headerName}"`);
  }
  lines.push('', wrapBase64(base64));
  return lines.join(CRLF);
}

/** Cada "parte" es su bloque de cabeceras + línea en blanco + cuerpo. */
function multipart(subtype, boundary, parts) {
  const body = parts.map((part) => `--${boundary}${CRLF}${part}`).join(CRLF) + `${CRLF}--${boundary}--`;
  return `Content-Type: multipart/${subtype}; boundary="${boundary}"${CRLF}${CRLF}${body}`;
}

/**
 * Replica lo que hacía Code.gs: la imagen se agrega al final del cuerpo
 * apuntando al cid de su parte inline.
 */
function appendInlineImageTags(html, inlineImages) {
  return inlineImages.reduce(
    (acc, _img, index) => `${acc}<br/><img src="cid:img${index}" style="max-width:100%;height:auto;" />`,
    String(html || '')
  );
}

/**
 * @param {Object} params
 * @param {string} params.fromName      Nombre visible del remitente
 * @param {string} params.fromEmail     Dirección real (la de la cuenta conectada)
 * @param {string} params.to            Destinatario
 * @param {string} params.subject       Asunto ya personalizado
 * @param {string} params.html          Cuerpo HTML ya personalizado
 * @param {Array<{filename,mimeType,base64}>} [params.inlineImages]
 * @param {Array<{filename,mimeType,base64}>} [params.attachments]
 * @param {Function} [params.boundaryFactory] Inyectable para tests
 * @returns {string} Mensaje RFC 2822 listo para mandar como message/rfc822
 */
export function buildMimeMessage({
  fromName,
  fromEmail,
  to,
  subject,
  html,
  inlineImages = [],
  attachments = [],
  boundaryFactory = defaultBoundaryFactory
}) {
  const headers = [
    `From: ${formatAddress(fromName, fromEmail)}`,
    `To: ${to}`,
    `Subject: ${encodeHeaderWord(subject)}`,
    'MIME-Version: 1.0'
  ];

  let root = textHtmlPart(appendInlineImageTags(html, inlineImages));

  if (inlineImages.length > 0) {
    root = multipart('related', boundaryFactory('rel'), [
      root,
      ...inlineImages.map((img, index) => binaryPart(img, { inline: true, cid: `img${index}` }))
    ]);
  }

  if (attachments.length > 0) {
    root = multipart('mixed', boundaryFactory('mix'), [
      root,
      ...attachments.map((att) => binaryPart(att, { inline: false }))
    ]);
  }

  return `${headers.join(CRLF)}${CRLF}${root}`;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test tests/mimeBuilder.test.js`
Expected: PASS — 10 tests

- [ ] **Step 5: Commit**

```bash
git add ui/mimeBuilder.js tests/mimeBuilder.test.js
git commit -m "feat: constructor de mensajes MIME para la Gmail API"
```

---

### Task 2: `gmailErrors.js` — clasificador de errores

**Files:**
- Create: `ui/gmailErrors.js`
- Test: `tests/gmailErrors.test.js`

- [ ] **Step 1: Escribir el test que falla**

```js
import test from 'node:test';
import assert from 'node:assert/strict';
import { classifyGmailError } from '../ui/gmailErrors.js';

const quotaBody = JSON.stringify({
  error: { code: 403, message: 'Daily Limit Exceeded', errors: [{ reason: 'quotaExceeded' }] }
});
const rateBody = JSON.stringify({
  error: { code: 429, message: 'User-rate limit exceeded', errors: [{ reason: 'rateLimitExceeded' }] }
});
const scopeBody = JSON.stringify({
  error: { code: 403, message: 'Request had insufficient authentication scopes.' }
});
const recipientBody = JSON.stringify({
  error: { code: 400, message: 'Invalid to header' }
});

test('401 es problema de token', () => {
  assert.equal(classifyGmailError(401, '').kind, 'auth');
});

test('403 por scopes insuficientes es problema de token, no de cuota', () => {
  assert.equal(classifyGmailError(403, scopeBody).kind, 'auth');
});

test('quotaExceeded es cuota diaria agotada', () => {
  const result = classifyGmailError(403, quotaBody);
  assert.equal(result.kind, 'quota');
  assert.equal(result.message, 'Daily Limit Exceeded');
});

test('rateLimitExceeded es límite por minuto, reintentable', () => {
  assert.equal(classifyGmailError(429, rateBody).kind, 'rate');
});

test('400 con dirección inválida falla solo esa fila', () => {
  const result = classifyGmailError(400, recipientBody);
  assert.equal(result.kind, 'recipient');
  assert.equal(result.message, 'Invalid to header');
});

test('un cuerpo que no es JSON no rompe el clasificador', () => {
  const result = classifyGmailError(500, '<html>Server Error</html>');
  assert.equal(result.kind, 'recipient');
  assert.match(result.message, /500/);
});

test('403 sin reason reconocible se trata como cuota para no quemar la lista', () => {
  assert.equal(classifyGmailError(403, '{}').kind, 'quota');
});
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test tests/gmailErrors.test.js`
Expected: FAIL — `Cannot find module '../ui/gmailErrors.js'`

- [ ] **Step 3: Implementar `ui/gmailErrors.js`**

```js
/**
 * Clasifica una respuesta de error de la Gmail API para decidir qué hacer:
 * renovar token, esperar y reintentar, fallar solo esa fila, o pausar la
 * campaña porque la cuenta agotó su cuota diaria.
 * Módulo puro (sin chrome.*, sin red) para poder testearlo.
 */

function safeParse(body) {
  try {
    return JSON.parse(body);
  } catch (err) {
    return null;
  }
}

/**
 * @param {number} status  Código HTTP de la respuesta
 * @param {string} body    Cuerpo crudo de la respuesta
 * @returns {{kind: 'auth'|'quota'|'rate'|'recipient', message: string}}
 */
export function classifyGmailError(status, body) {
  const parsed = safeParse(body);
  const reason = parsed?.error?.errors?.[0]?.reason || '';
  const message = parsed?.error?.message || `Status: ${status}`;

  if (status === 401) {
    return { kind: 'auth', message };
  }

  if (/insufficient|authentication scopes|unauthorized_client/i.test(message)) {
    return { kind: 'auth', message };
  }

  if (/rateLimitExceeded|userRateLimitExceeded|backendError/i.test(reason)) {
    return { kind: 'rate', message };
  }

  if (/quotaExceeded|dailyLimitExceeded/i.test(reason) || /daily limit|sending limit|quota/i.test(message)) {
    return { kind: 'quota', message };
  }

  // Un 403/429 sin motivo reconocible casi siempre es cuota. Pausar es más
  // seguro que seguir y marcar como fallidos a todos los destinatarios que faltan.
  if (status === 403 || status === 429) {
    return { kind: 'quota', message };
  }

  return { kind: 'recipient', message };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test tests/gmailErrors.test.js`
Expected: PASS — 7 tests

- [ ] **Step 5: Commit**

```bash
git add ui/gmailErrors.js tests/gmailErrors.test.js
git commit -m "feat: clasificador de errores de la Gmail API"
```

---

### Task 3: `gmailAuth.js` — OAuth

**Files:**
- Create: `ui/gmailAuth.js`
- Test: `tests/gmailAuth.test.js`

- [ ] **Step 1: Escribir el test que falla**

Solo se testean las dos funciones puras. El resto depende de `chrome.identity` y se verifica a mano en la Task 8.

```js
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
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test tests/gmailAuth.test.js`
Expected: FAIL — `Cannot find module '../ui/gmailAuth.js'`

- [ ] **Step 3: Implementar `ui/gmailAuth.js`**

`CLIENT_ID` queda vacío a propósito: lo completa el dueño del proyecto con la credencial que se crea en la Task 4, Step 3. Todo lo demás del módulo funciona sin tocar nada más.

```js
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

// ← Pegar acá el ID de cliente OAuth (tipo "Aplicación web") de Google Cloud.
export const CLIENT_ID = '';

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
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test tests/gmailAuth.test.js`
Expected: PASS — 4 tests

- [ ] **Step 5: Commit**

```bash
git add ui/gmailAuth.js tests/gmailAuth.test.js
git commit -m "feat: cliente OAuth para la cuenta de Gmail del usuario"
```

---

### Task 4: `manifest.json` — permisos e ID estable

**Files:**
- Modify: `manifest.json:1-35`

- [ ] **Step 1: Generar la clave que fija el ID de la extensión**

El redirect que se registra en Google Cloud contiene el ID de la extensión, así que ese ID no puede cambiar entre instalaciones. Se fija con una `key` en el manifest.

```bash
cd "C:/Users/HP/Desktop/DESARROLLOS_UPHONE/MailerPro"
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out mailerpro-key.pem
openssl rsa -in mailerpro-key.pem -pubout -outform DER | openssl base64 -A
openssl rsa -in mailerpro-key.pem -pubout -outform DER | sha256sum | head -c32 | tr 0-9a-f a-p
```

El segundo comando imprime el valor de `"key"`. El tercero imprime el ID de la extensión, que sirve para armar el redirect `https://<ID>.chromiumapp.org/`.

El `.pem` queda fuera del repo por el `.gitignore` de la Task 0. Guardarlo aparte: sin él no se puede regenerar la misma `key`.

- [ ] **Step 2: Reemplazar `manifest.json`**

Cambios: `identity` en permisos, host_permissions de Google en vez de los de Apps Script, `key` nueva, versión 1.2.0 y sin `browser_specific_settings` (Firefox sale de soporte porque su `getRedirectURL()` devuelve un UUID distinto por instalación, imposible de registrar).

```json
{
  "manifest_version": 3,
  "name": "Mailer Pro — Envío Masivo de Correos",
  "description": "Enviar emails masivos con imágenes y listas de Excel desde tu propia cuenta de Gmail.",
  "version": "1.2.0",
  "key": "PEGAR_AQUI_LA_CLAVE_PUBLICA_DEL_PASO_1",
  "permissions": ["storage", "unlimitedStorage", "alarms", "identity"],
  "host_permissions": [
    "https://gmail.googleapis.com/*",
    "https://oauth2.googleapis.com/*",
    "https://www.googleapis.com/*",
    "https://licencias.anomalydevs.qzz.io/*"
  ],
  "background": {
    "service_worker": "background.js",
    "type": "module"
  },
  "action": {
    "default_popup": "ui/dashboard.html",
    "default_icon": {
      "16": "assets/icon16.png",
      "48": "assets/icon48.png",
      "128": "assets/icon128.png"
    }
  },
  "icons": {
    "16": "assets/icon16.png",
    "48": "assets/icon48.png",
    "128": "assets/icon128.png"
  }
}
```

- [ ] **Step 3: Crear la credencial OAuth en Google Cloud**

Este paso es manual, en la consola de Google, y lo hace el dueño del proyecto. Sin él la extensión no puede conectar ninguna cuenta.

1. [console.cloud.google.com](https://console.cloud.google.com) → proyecto nuevo, nombre "Mailer Pro".
2. *APIs y servicios → Biblioteca* → buscar **Gmail API** → Habilitar.
3. *Pantalla de consentimiento de OAuth* → tipo **Externo** → completar nombre de la app, correo de soporte y correo del desarrollador → agregar los scopes `https://www.googleapis.com/auth/gmail.send` y `https://www.googleapis.com/auth/userinfo.email` → **Publicar la app** (queda en Producción sin verificar, con tope de 100 cuentas).
4. *Credenciales → Crear credenciales → ID de cliente de OAuth → Aplicación web*. En "URI de redireccionamiento autorizados" pegar `https://<ID>.chromiumapp.org/`, usando el ID que imprimió el Step 1.
5. Copiar el ID de cliente generado y pegarlo en la constante `CLIENT_ID` de `ui/gmailAuth.js` (Task 3). No hay `client_secret` que guardar.

- [ ] **Step 4: Verificar que el JSON sea válido**

Run: `node -e "JSON.parse(require('fs').readFileSync('manifest.json','utf8')); console.log('manifest OK')"`
Expected: `manifest OK`

- [ ] **Step 5: Commit**

```bash
git add manifest.json .gitignore
git commit -m "chore: permiso identity, hosts de Google API e ID estable"
```

---

### Task 5: `background.js` — transporte Gmail API y relevo de cuenta

**Files:**
- Modify: `background.js:1-2` (imports), `background.js:63-166` (`sendEmails`), `background.js:223-282` (handlers)

- [ ] **Step 1: Reemplazar los imports (`background.js:1-2`)**

```js
import { computeGateDecision } from './ui/licenseGate.js';
import { activateLicense, validateLicense, getCachedLicenseState, getOrCreateDeviceId, LICENSE_KEY_STORAGE } from './ui/licenseClient.js';
import { buildMimeMessage } from './ui/mimeBuilder.js';
import { classifyGmailError } from './ui/gmailErrors.js';
import { getAccessToken, invalidateToken, connect, disconnect, detectActiveAccount, getConnectedAccount, AuthRequiredError } from './ui/gmailAuth.js';
```

- [ ] **Step 2: Agregar las constantes y el estado de cuota**

Justo debajo de los imports, reemplazando el bloque de estado de `background.js:4-10`:

```js
const LICENSE_VALIDATION_ALARM = 'licenseValidationAlarm';
const LICENSE_VALIDATION_PERIOD_MIN = 360; // 6h

// Endpoint de subida (no el de metadatos): acepta el MIME crudo, sin tener
// que codificar el mensaje entero en base64url dentro de un JSON.
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
const MAX_RATE_RETRIES = 3;

let sendInProgress = false;
let isPaused = false;
let isCancelled = false;
let quotaExhausted = false;
let pausedAccount = null;
let currentProgress = { current: 0, total: 0, status: 'Listo', failedEmails: [] };
```

- [ ] **Step 3: Reemplazar `sendEmails` completa (`background.js:63-166`)**

```js
async function sendEmails(payload) {
  if (sendInProgress) {
    return { error: 'Ya hay un envío en progreso.' };
  }

  // La licencia ya no la valida ningún backend intermedio: sin Apps Script,
  // esta llamada es la única barrera del lado del servidor. Se hace una vez
  // por campaña, no una por correo.
  const licenseState = await validateLicense();
  const gate = computeGateDecision(licenseState, Date.now());
  if (!gate.allowed) {
    return { error: `Licencia no válida (${gate.reason}). Abre "Licencia" en el menú.` };
  }

  const account = await getConnectedAccount();
  if (!account) {
    return { error: 'No hay una cuenta de Gmail conectada. Abre "Configuración".' };
  }

  sendInProgress = true;
  isPaused = false;
  isCancelled = false;
  quotaExhausted = false;
  pausedAccount = null;
  currentProgress.failedEmails = [];

  const { fromEmail, recipients, subject, message, attachments, delaySeconds } = payload;
  let successCount = 0;
  let errorCount = 0;

  // La UI limita a 1 imagen embebida y hasta 3 PDFs; acá se separan porque
  // van en partes MIME distintas (related inline vs. mixed adjunto).
  const inlineImages = [];
  const fileAttachments = [];
  (attachments || []).forEach((att) => {
    const [, base64] = att.dataUrl.split(',');
    const part = { filename: att.name, mimeType: att.type, base64 };
    if (/^image\//i.test(att.type)) inlineImages.push(part);
    else fileAttachments.push(part);
  });

  let index = 0;
  while (index < recipients.length) {
    if (isCancelled) break;

    while (isPaused) {
      if (isCancelled) break;
      await sleep(500);
    }
    if (isCancelled) break;

    const recipient = recipients[index];
    const recipientEmail = resolveEmail(recipient);
    const outcome = await sendOne({
      recipient,
      recipientEmail,
      fromEmail,
      subject,
      message,
      inlineImages,
      fileAttachments
    });

    if (outcome.kind === 'quota') {
      // No se avanza el índice: este destinatario se reintenta con la cuenta
      // de relevo. Los que faltan siguen en "Pendiente", no se marcan fallidos.
      await pauseForQuota(outcome.message, index, recipients.length, successCount);
      continue;
    }

    if (outcome.kind === 'ok') {
      successCount += 1;
      broadcastProgress(index + 1, recipients.length, `Enviado a ${recipientEmail} (${successCount} OK, ${errorCount} errores)`, index, true);
    } else {
      errorCount += 1;
      currentProgress.failedEmails.push({ email: recipientEmail, error: outcome.message });
      broadcastProgress(index + 1, recipients.length, `Error en ${recipientEmail}: ${outcome.message}`, index, false);
    }

    index += 1;

    if (index < recipients.length) {
      const delayMs = (delaySeconds || 10) * 1000;
      const steps = delayMs / 500;
      for (let s = 0; s < steps; s++) {
        if (isCancelled || isPaused) break;
        await sleep(500);
      }
    }
  }

  let finalStatus = `Envío completado: ${successCount} OK, ${errorCount} errores.`;
  if (isCancelled) {
    finalStatus = `Envío cancelado. ${successCount} OK, ${errorCount} errores.`;
  }

  broadcastCompletion(currentProgress.current, recipients.length, finalStatus);
  return { successCount, errorCount, failedEmails: currentProgress.failedEmails };
}

/**
 * Envía un correo. El token se pide acá adentro, no antes del bucle: como
 * getAccessToken() cachea, no cuesta nada, y es lo que hace que al reanudar
 * con la cuenta de relevo el envío tome la cuenta nueva sin más cambios.
 * @returns {Promise<{kind:'ok'|'error'|'quota', message?: string}>}
 */
async function sendOne({ recipient, recipientEmail, fromEmail, subject, message, inlineImages, fileAttachments }) {
  for (let attempt = 0; attempt <= MAX_RATE_RETRIES; attempt += 1) {
    let token;
    try {
      token = await getAccessToken();
    } catch (err) {
      if (err instanceof AuthRequiredError) return { kind: 'quota', message: err.message };
      return { kind: 'error', message: err.message };
    }

    const account = await getConnectedAccount();
    const mime = buildMimeMessage({
      fromName: fromEmail,
      fromEmail: account?.email || 'me',
      to: recipientEmail,
      subject: personalizeMessage(subject || 'Mensaje de extensión', recipient),
      html: personalizeMessage(message, recipient),
      inlineImages,
      attachments: fileAttachments
    });

    let response;
    try {
      response = await fetch(GMAIL_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'message/rfc822'
        },
        body: mime
      });
    } catch (err) {
      if (attempt < MAX_RATE_RETRIES) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { kind: 'error', message: `Sin conexión: ${err.message}` };
    }

    if (response.ok) return { kind: 'ok' };

    const body = await response.text();
    const classified = classifyGmailError(response.status, body);

    if (classified.kind === 'auth') {
      // Token vencido o revocado: se fuerza la renovación y se reintenta una vez.
      await invalidateToken();
      if (attempt < 1) continue;
      return { kind: 'quota', message: `Se perdió el acceso a la cuenta: ${classified.message}` };
    }

    if (classified.kind === 'rate') {
      if (attempt < MAX_RATE_RETRIES) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { kind: 'quota', message: classified.message };
    }

    if (classified.kind === 'quota') {
      return { kind: 'quota', message: classified.message };
    }

    return { kind: 'error', message: classified.message };
  }

  return { kind: 'error', message: 'Se agotaron los reintentos.' };
}

/**
 * Cuota diaria agotada: se pausa la campaña en el destinatario actual y se
 * avisa a la UI para que ofrezca conectar la cuenta de relevo.
 */
async function pauseForQuota(message, index, total, successCount) {
  const account = await getConnectedAccount();
  isPaused = true;
  quotaExhausted = true;
  pausedAccount = account?.email || null;

  currentProgress.current = index;
  currentProgress.total = total;
  currentProgress.status = `Límite diario alcanzado en ${pausedAccount || 'la cuenta conectada'} — ${successCount} enviados de ${total}.`;

  chrome.action.setBadgeText({ text: '⏸' }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }).catch(() => { });

  chrome.runtime.sendMessage({
    action: 'quotaExhausted',
    current: index,
    total,
    account: pausedAccount,
    detail: message,
    status: currentProgress.status,
    failedEmails: currentProgress.failedEmails
  }).catch(() => { });
}
```

- [ ] **Step 4: Agregar los handlers de mensajes de Gmail**

En el `chrome.runtime.onMessage.addListener` (`background.js:223`), justo antes del handler de `LICENSE_ACTIVATE`:

```js
  if (message?.action === 'GMAIL_STATUS') {
    (async () => {
      // El intento silencioso reengancha la sesión del navegador sin abrir
      // ventanas. Si falla —no hay sesión de Google, o es otra cuenta— se
      // responde desconectado: mostrar 🟢 con un token que no se puede
      // conseguir haría fallar el envío recién al pulsar "Iniciar Campaña".
      const detected = await detectActiveAccount();
      const cached = await getConnectedAccount();
      sendResponse({ connected: !!detected, email: detected?.email || cached?.email || null });
    })();
    return true;
  }

  if (message?.action === 'GMAIL_CONNECT') {
    (async () => {
      try {
        const result = await connect({ selectAccount: message.selectAccount === true });
        sendResponse({ connected: true, email: result.email });
      } catch (err) {
        sendResponse({ connected: false, error: err.message });
      }
    })();
    return true;
  }

  if (message?.action === 'GMAIL_DISCONNECT') {
    (async () => {
      await disconnect();
      sendResponse({ connected: false });
    })();
    return true;
  }
```

- [ ] **Step 5: Exponer el estado de cuota en `getState`**

Reemplazar el handler `getState` (`background.js:253-261`):

```js
  if (message?.action === 'getState') {
    sendResponse({
      sendInProgress,
      isPaused,
      isCancelled,
      quotaExhausted,
      pausedAccount,
      ...currentProgress
    });
    return true;
  }
```

- [ ] **Step 6: Limpiar la bandera de cuota al reanudar**

Reemplazar el handler `resumeSend` (`background.js:239-245`):

```js
  if (message?.action === 'resumeSend') {
    isPaused = false;
    quotaExhausted = false;
    pausedAccount = null;
    currentProgress.status = "Reanudando...";
    broadcastProgress(currentProgress.current, currentProgress.total, currentProgress.status);
    sendResponse({ success: true });
    return true;
  }
```

- [ ] **Step 7: Verificar sintaxis**

Run: `node --check background.js`
Expected: sin salida (éxito)

- [ ] **Step 8: Commit**

```bash
git add background.js
git commit -m "feat: envío por Gmail API con pausa y relevo por cuota agotada"
```

---

### Task 6: `dashboard.html` — modal Configuración y banner de relevo

**Files:**
- Modify: `ui/dashboard.html:182-207` (modal), y agregar el banner en la sección de progreso

- [ ] **Step 1: Reemplazar el cuerpo del modal de Configuración (`ui/dashboard.html:182-207`)**

```html
  <div id="modal-configuracion" class="modal-overlay" style="display: none;">
    <div class="modal-content">
      <div class="modal-header">
        <h2>Configuración</h2>
        <button class="btn-close">×</button>
      </div>
      <div class="modal-body" style="display: flex; flex-direction: column; gap: 15px;">
        <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">Cuenta de envío</label>
        <div style="padding: 12px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-sm); display: flex; flex-direction: column; gap: 10px;">
          <div id="gmail-status" style="font-size: 0.9rem; color: var(--text-main);">🔴 Ninguna cuenta conectada</div>
          <button class="btn btn-accent btn-full" id="btn-conectar-gmail">Conectar cuenta de Gmail</button>
          <button class="btn btn-muted btn-full" id="btn-desconectar-gmail" style="display: none;">Desconectar</button>
        </div>

        <label style="font-size: 0.8rem; font-weight: 600; color: var(--text-muted);">Nombre visible del Remitente</label>
        <input id="smtpFrom" type="text" placeholder="Mi Empresa S.A." maxlength="100" style="padding: 10px; background: var(--bg-tertiary); color: white; border: 1px solid var(--border-color); border-radius: var(--radius-sm);">
        <p style="font-size: 0.75rem; color: var(--text-muted); line-height: 1.5; margin: 0;">
          Es solo el nombre que ve el destinatario. La dirección de correo siempre es la de la cuenta conectada — Gmail no permite enviar desde otra. Para enviar desde otra casilla, conectá esa casilla.
        </p>

        <button class="btn btn-accent btn-full" id="btn-cerrar-configuracion">Listo</button>
      </div>
    </div>
  </div>
```

- [ ] **Step 2: Agregar el banner de cuota agotada**

Insertarlo dentro de `#progress-section`, inmediatamente antes de `<div id="errorsContainer"`:

```html
        <div id="quota-banner" style="display: none; margin: 12px 0; padding: 12px; background: rgba(245, 158, 11, 0.12); border: 1px solid #f59e0b; border-radius: var(--radius-sm);">
          <p id="quota-banner-text" style="font-size: 0.85rem; color: var(--text-main); line-height: 1.5; margin: 0 0 10px 0;"></p>
          <button class="btn btn-accent btn-full" id="btn-relevo-cuenta">Conectar otra cuenta y continuar</button>
        </div>
```

- [ ] **Step 3: Verificar que los IDs nuevos existan y los viejos no**

Run: `grep -n "gmail-status\|btn-conectar-gmail\|btn-desconectar-gmail\|quota-banner\|btn-relevo-cuenta\|apiKey\|apiToken" ui/dashboard.html`
Expected: aparecen los cinco IDs nuevos; **ninguna** línea con `apiKey` ni `apiToken`

- [ ] **Step 4: Commit**

```bash
git add ui/dashboard.html
git commit -m "feat: bloque de cuenta de envío y banner de relevo en el dashboard"
```

---

### Task 7: `dashboard.js` — estado de conexión, gate y relevo

**Files:**
- Modify: `ui/dashboard.js:41-47` (refs), `:61-70` (estado), `:73-99` (persistencia), `:539-599` (`startSend`), `:728-744` (toggles), `:782` (syncInputs), `:788-813` (listeners e init)

- [ ] **Step 1: Reemplazar las refs de Configuración (`ui/dashboard.js:41-47`)**

```js
// Configuración
const navConfiguracion  = document.getElementById('nav-configuracion');
const modalConfiguracion = document.getElementById('modal-configuracion');
const btnCerrarConfiguracion = document.getElementById('btn-cerrar-configuracion');
const gmailStatusEl     = document.getElementById('gmail-status');
const btnConectarGmail  = document.getElementById('btn-conectar-gmail');
const btnDesconectarGmail = document.getElementById('btn-desconectar-gmail');
const smtpFrom          = document.getElementById('smtpFrom');

// Relevo de cuenta por cuota agotada
const quotaBanner       = document.getElementById('quota-banner');
const quotaBannerText   = document.getElementById('quota-banner-text');
const btnRelevoCuenta   = document.getElementById('btn-relevo-cuenta');
```

- [ ] **Step 2: Agregar el estado de conexión (`ui/dashboard.js:61-70`)**

Reemplazar el bloque `// ─── State ───` agregando dos variables:

```js
// ─── State ───────────────────────────────────────────────────────────────────
let recipients  = [];
let availableVariables = [];
let attachments = [];
let pdfAttachments = [];
let campaignRunning = false;
let isPaused        = false;
let currentFailedEmails = [];
let isLicenseAllowed = false;
let hasPromptedForLicense = false;
let gmailAccount = null;
let hasPromptedForGmail = false;
```

- [ ] **Step 3: Sacar `apiKey`/`apiToken` de la persistencia (`ui/dashboard.js:73-99`)**

```js
// ─── Persistence ─────────────────────────────────────────────────────────────
function saveState() {
  chrome.storage.local.set({
    subject:    subjectInput.value,
    message:    messageInput.value,
    delaySeconds: delaySeconds.value,
    smtpFrom:   smtpFrom.value,
    recipients
  });
}

function restoreState() {
  // Restos del backend de Apps Script: se limpian una sola vez para no dejar
  // la URL vieja dando vueltas en el storage del cliente.
  chrome.storage.local.remove(['apiKey', 'apiToken']);

  chrome.storage.local.get(null, (state) => {
    if (state.subject       !== undefined) subjectInput.value   = state.subject;
    if (state.message       !== undefined) messageInput.value   = state.message;
    if (state.delaySeconds  !== undefined) delaySeconds.value   = state.delaySeconds;
    if (state.smtpFrom      !== undefined) smtpFrom.value       = state.smtpFrom;

    if (state.recipients && state.recipients.length) {
      recipients = state.recipients;
      availableVariables = DataProcessor.getAvailableVariables(recipients);
      updateUIWithContacts();
    }
  });

  chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response) {
      if (response.sendInProgress || response.current > 0) {
        setProgress(response.current, response.total, response.status, response.failedEmails || []);
        if (response.sendInProgress) {
          campaignRunning = true;
          isPaused = response.isPaused || false;
          setUIState(response.isPaused ? 'paused' : 'running');
          if (response.quotaExhausted) {
            showQuotaBanner(response.pausedAccount, response.current, response.total);
          }
        } else {
          setUIState('finished');
        }
      }
    }
  });
}
```

- [ ] **Step 4: Agregar el bloque de cuenta de Gmail**

Insertarlo justo antes de la sección `// ─── Licencia ───` (`ui/dashboard.js:658`):

```js
// ─── Cuenta de Gmail ─────────────────────────────────────────────────────────
// Todo el OAuth vive en el service worker: este popup se cierra al perder el
// foco, y la ventana de consentimiento de Google se lo roba.
function renderGmailStatus() {
  if (gmailAccount) {
    gmailStatusEl.textContent = `🟢 ${gmailAccount}`;
    btnConectarGmail.textContent = 'Cambiar de cuenta';
    btnDesconectarGmail.style.display = '';
  } else {
    gmailStatusEl.textContent = '🔴 Ninguna cuenta conectada';
    btnConectarGmail.textContent = 'Conectar cuenta de Gmail';
    btnDesconectarGmail.style.display = 'none';
  }
  updateSendButtonState();
}

function refreshGmailStatus() {
  chrome.runtime.sendMessage({ action: 'GMAIL_STATUS' }, (result) => {
    if (chrome.runtime.lastError || !result) return;
    gmailAccount = result.connected ? result.email : null;
    renderGmailStatus();

    // Con licencia activa pero sin cuenta, el siguiente paso obvio es conectar.
    if (!gmailAccount && isLicenseAllowed && !hasPromptedForGmail) {
      hasPromptedForGmail = true;
      openModal(modalConfiguracion);
    }
  });
}

function connectGmail({ selectAccount }) {
  btnConectarGmail.disabled = true;
  btnConectarGmail.textContent = 'Conectando...';
  chrome.runtime.sendMessage({ action: 'GMAIL_CONNECT', selectAccount }, (result) => {
    btnConectarGmail.disabled = false;
    if (chrome.runtime.lastError || !result) {
      renderGmailStatus();
      alert('No se pudo completar la conexión con Google.');
      return;
    }
    gmailAccount = result.email || null;
    renderGmailStatus();
    if (!result.connected) {
      alert(result.error || 'No se pudo conectar la cuenta.');
    }
  });
}

btnConectarGmail.addEventListener('click', () => connectGmail({ selectAccount: !!gmailAccount }));

btnDesconectarGmail.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'GMAIL_DISCONNECT' }, () => {
    gmailAccount = null;
    renderGmailStatus();
  });
});

// ─── Relevo de cuenta por cuota agotada ──────────────────────────────────────
function showQuotaBanner(account, current, total) {
  quotaBannerText.textContent =
    `Límite diario alcanzado en ${account || 'la cuenta conectada'} — se enviaron ${current} de ${total}. ` +
    `Conectá otra cuenta para continuar desde donde quedó.`;
  quotaBanner.style.display = '';
  setUIState('paused');
}

function hideQuotaBanner() {
  quotaBanner.style.display = 'none';
}

btnRelevoCuenta.addEventListener('click', () => {
  btnRelevoCuenta.disabled = true;
  btnRelevoCuenta.textContent = 'Conectando...';
  chrome.runtime.sendMessage({ action: 'GMAIL_CONNECT', selectAccount: true }, (result) => {
    btnRelevoCuenta.disabled = false;
    btnRelevoCuenta.textContent = 'Conectar otra cuenta y continuar';
    if (chrome.runtime.lastError || !result?.connected) {
      alert(result?.error || 'No se pudo conectar la cuenta de relevo.');
      return;
    }
    gmailAccount = result.email || null;
    renderGmailStatus();
    hideQuotaBanner();
    chrome.runtime.sendMessage({ action: 'resumeSend' }, () => {});
    isPaused = false;
    setUIState('running');
    statusText.textContent = `▶️ Continuando desde ${gmailAccount}...`;
  });
});
```

- [ ] **Step 5: Reemplazar el gate y `startSend` (`ui/dashboard.js:539-599`)**

Acá desaparece el `alert` de "Configuración incompleta" que motivó todo el cambio, y entra la validación de peso total de adjuntos.

```js
// ─── Campaign actions ─────────────────────────────────────────────────────────
const MAX_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;

function updateSendButtonState() {
  sendBtn.disabled = !(recipients.length > 0 && isLicenseAllowed && !!gmailAccount && !campaignRunning);
}

/** Peso aproximado del adjunto a partir del data URL (base64 infla 4/3). */
function estimateAttachmentBytes(list) {
  return list.reduce((total, att) => {
    const base64 = (att.dataUrl.split(',')[1] || '');
    return total + Math.floor(base64.length * 0.75);
  }, 0);
}

function startSend() {
  if (recipients.length === 0) {
    alert('Importa al menos un destinatario desde Excel.');
    return;
  }
  if (!isLicenseAllowed) {
    alert('Necesitas una licencia activa para iniciar una campaña. Abre "Licencia" en el menú.');
    return;
  }
  if (!gmailAccount) {
    openModal(modalConfiguracion);
    return;
  }

  // Gmail rechaza mensajes de más de 25 MB ya codificados; 18 MB de adjuntos
  // crudos quedan en ~24 MB. Mejor avisar acá que fallar en cada destinatario.
  const totalBytes = estimateAttachmentBytes([...attachments, ...pdfAttachments]);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    alert(`Los adjuntos suman ${(totalBytes / 1048576).toFixed(1)} MB. Gmail no acepta más de 18 MB por correo — quita alguno.`);
    return;
  }

  currentFailedEmails = [];
  errorsContainer.style.display = 'none';
  errorsList.style.display      = 'none';
  errorsList.innerHTML          = '';
  toggleErrorsBtn.textContent   = 'Ver Errores (0)';
  copyErrorsBtn.style.display   = 'none';
  hideQuotaBanner();

  document.querySelectorAll('.contact-row-status').forEach((el) => {
    if (el.id?.startsWith('status-row-')) {
      el.value = 'Pendiente ⏳';
      el.style.color = '#a3a3a3';
    }
  });
  const firstStatus = document.getElementById('status-row-0');
  if (firstStatus) {
    firstStatus.value = 'Enviando... ⏳';
    firstStatus.style.color = '#eab308';
  }

  setProgress(0, recipients.length, '🚀 Iniciando campaña...', []);
  setUIState('running');
  campaignRunning = true;
  isPaused = false;

  const payload = {
    fromEmail:    smtpFrom.value.replace(/[\r\n]/g, '').slice(0, 100),
    recipients,
    subject:      subjectInput.value,
    message:      messageInput.value,
    attachments:  [...attachments, ...pdfAttachments],
    delaySeconds: parseInt(delaySeconds.value) || 10
  };

  chrome.runtime.sendMessage({ action: 'startSend', payload }, (response) => {
    if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
    if (response?.error) {
      alert('Error: ' + response.error);
      campaignRunning = false;
      setUIState('idle');
    }
  });
}
```

- [ ] **Step 6: Borrar los toggles de contraseña muertos (`ui/dashboard.js:743-744`)**

Los inputs `apiKey`/`apiToken` ya no existen. Eliminar estas dos líneas:

```js
attachToggle('togglePass', apiKeyInput);
attachToggle('toggleToken', apiTokenInput);
```

`attachToggle` queda sin usarse: eliminar también la función completa (`ui/dashboard.js:729-742`).

- [ ] **Step 7: Sacar los inputs borrados de `syncInputs` (`ui/dashboard.js:782`)**

```js
const syncInputs = [subjectInput, messageInput, delaySeconds, smtpFrom];
```

- [ ] **Step 8: Escuchar el aviso de cuota agotada**

Dentro del `chrome.runtime.onMessage.addListener` de `ui/dashboard.js:789`, agregar antes del cierre:

```js
  if (message?.action === 'quotaExhausted') {
    campaignRunning = true;
    isPaused = true;
    setProgress(message.current, message.total, message.status, message.failedEmails || []);
    showQuotaBanner(message.account, message.current, message.total);
  }
```

- [ ] **Step 9: Enganchar el arranque (`ui/dashboard.js:808-813`)**

```js
// ─── Initialization ───────────────────────────────────────────────────────────
setUIState('idle');
restoreState();
refreshLicenseStatus();
refreshGmailStatus();
setInterval(refreshLicenseStatus, 60000);
```

- [ ] **Step 10: Verificar sintaxis y que no queden referencias muertas**

Run: `node --check ui/dashboard.js`
Expected: sin salida

Run: `grep -n "apiKeyInput\|apiTokenInput\|attachToggle" ui/dashboard.js`
Expected: sin resultados

- [ ] **Step 11: Commit**

```bash
git add ui/dashboard.js
git commit -m "feat: gate por cuenta conectada y relevo de cuenta en el dashboard"
```

---

### Task 8: Eliminar Apps Script y reescribir la documentación

**Files:**
- Delete: `google-apps-script/Code.gs`
- Modify: `INSTRUCCIONES.md`

- [ ] **Step 1: Eliminar el backend**

```bash
git rm -r google-apps-script
```

- [ ] **Step 2: Reescribir `INSTRUCCIONES.md`**

Reemplazar el archivo entero. Se van los PASOS 1 y 2 (crear y desplegar el backend), la sección "Cambiar de cuenta Gmail" y Firefox; entran la conexión de cuenta, el relevo por cuota y los límites reales.

```markdown
# 🚀 Mailer Pro — Instrucciones Completas

---

> **⚠️ Si venías de una versión anterior:** Mailer Pro ya no usa un backend de
> Google Apps Script. Los correos salen directamente de tu cuenta de Gmail,
> autorizada una sola vez desde la extensión. Podés borrar el proyecto
> "Mailer Pro Backend" de script.google.com: no se usa más. La URL que tenías
> cargada en "Configuración" se elimina sola al abrir esta versión.

---

## PASO 1: Instalar la Extensión

### En Google Chrome:
1. Escribe en la barra: chrome://extensions
2. Activa "Modo desarrollador" (arriba a la derecha).
3. Haz clic en "Cargar extensión sin empaquetar".
4. Selecciona ESTA CARPETA (MailerPro).

### En Brave:
1. Escribe en la barra: brave://extensions — mismos pasos que Chrome.

### En Microsoft Edge:
1. Escribe en la barra: edge://extensions
2. Activa "Modo de desarrollador" (abajo a la izquierda).
3. Haz clic en "Cargar desempaquetada" y selecciona ESTA CARPETA.

### En Opera / Opera GX:
1. Escribe en la barra: opera://extensions — mismos pasos que Chrome.

> Firefox no está soportado: su sistema de autorización genera una dirección
> distinta en cada instalación, incompatible con el permiso de Google.

---

## PASO 2: Activar tu Licencia

1. Haz clic en el ícono de la extensión.
2. En el menú superior, abre "Licencia" (o el indicador del pie de página).
3. Pega la clave que te entregó AnomalyDevs (formato `UPHONE-XXXX-XXXX-XXXX`).
4. Haz clic en "Activar". El indicador pasa a 🟢 con el nombre de tu empresa.

Sin licencia activa el botón "Iniciar Campaña" permanece deshabilitado. Si
pierdes conexión, la extensión sigue funcionando 48 horas con la última
validación exitosa.

---

## PASO 3: Conectar tu Cuenta de Gmail

1. En el menú superior, abre "Configuración".
2. Haz clic en "Conectar cuenta de Gmail".
3. Elige la cuenta desde la que quieres enviar.
4. Google muestra una pantalla que dice que la aplicación no está verificada.
   Haz clic en "Configuración avanzada" y luego en "Ir a Mailer Pro (no seguro)".
   Es normal: la app está en proceso de verificación con Google.
5. Haz clic en "Continuar" para autorizar el envío de correos.
6. El estado pasa a 🟢 con tu dirección.
7. Escribe el nombre del remitente (ej: "Mi Empresa S.A.") y haz clic en "Listo".

Ese nombre es solo lo que ve el destinatario. La dirección real siempre es la
de la cuenta conectada — Gmail no permite enviar desde otra.

**A partir de acá no hay que repetir nada:** cada vez que abras la extensión,
si esa cuenta tiene la sesión abierta en el navegador, aparece conectada sola.
Si dice 🔴, es porque cerraste sesión de Google o cambiaste de cuenta: un clic
en "Conectar cuenta de Gmail" y listo.

---

## PASO 4: Enviar Correos

1. En "Destinatarios", haz clic en "Importar Excel" y selecciona tu archivo
   (.xlsx o .xls).
   - La primera fila debe tener los encabezados de columna.
   - Debe existir una columna **CORREO CLIENTE** (también acepta "email",
     "correo" o "correo electrónico", sin importar mayúsculas ni tildes).
   - Cualquier otra columna queda disponible como variable del mensaje.
   - Las filas sin email válido se descartan automáticamente.

2. Escribe el asunto (también admite variables).

3. Escribe el mensaje. Las variables detectadas aparecen como chips debajo:
   haz clic en una para insertarla. Ejemplo: `{Nombre}`.

4. Adjunta una imagen (opcional, JPG/PNG/GIF/WEBP, máx. 5MB). Se embebe en el
   cuerpo del correo.

5. Adjunta hasta 3 PDFs (opcional, máx. 5MB cada uno). Viajan como adjunto
   descargable. Entre todos los adjuntos no pueden superar 18 MB.

6. Configura el intervalo entre envíos. Recomendado: 5-15 segundos.

7. Haz clic en "Iniciar Campaña".

Cada fila muestra su estado en vivo: Pendiente ⏳ / Enviando... ⏳ /
Enviado ✅ / Error ❌.

---

## Límites de Gmail y envíos de más de 500 correos

Cada cuenta tiene su propio límite diario:

- Gmail gratuito: ~500 correos por día
- Google Workspace: ~2.000 correos por día

**Cuando una cuenta agota su límite, la campaña no se pierde.** Se pausa sola
en el destinatario exacto donde iba y aparece un aviso naranja:

> Límite diario alcanzado en cobranzas@empresa.com — se enviaron 500 de 1.000.

Haz clic en "Conectar otra cuenta y continuar", elige la segunda casilla y la
campaña sigue desde donde quedó. Los correos ya enviados no se repiten y no
hay que volver a importar el Excel. Así se cubren 1.000 envíos en un día con
dos cuentas.

Las cuentas de relevo deben ser casillas propias de la empresa, y el correo,
solicitado por el destinatario. Rotar cuentas para mandar correo no solicitado
termina con las casillas suspendidas por Google.

## Intervalos Recomendados

- Menos de 50 correos: 3-5 segundos
- 50-200 correos: 5-10 segundos
- 200-500 correos: 10-15 segundos

---

## Controles Durante el Envío

- PAUSAR: detiene temporalmente. El progreso se conserva.
- REANUDAR: continúa desde donde se pausó.
- CANCELAR: detiene definitivamente la campaña.
- REINICIAR: limpia todo para una nueva campaña.

---

## Correos Fallidos

- Si algún correo falla, aparece "Ver Errores" debajo de la barra de progreso.
- "Copiar Correos Fallidos" los copia al portapapeles para reintentar.

---

## Problemas Comunes

"El botón Iniciar Campaña está deshabilitado":
- Revisa el indicador de licencia del pie de página (debe estar en 🟢).
- Verifica que haya destinatarios importados.
- Abre "Configuración": debe haber una cuenta de Gmail conectada (🟢).

"Dice que la cuenta está desconectada y yo tengo Gmail abierto":
- Es una cuenta distinta de la que autorizaste, o cerraste sesión de Google.
  Haz clic en "Conectar cuenta de Gmail" y elige la correcta.

"Google dice que la aplicación no está verificada":
- Es esperado. Haz clic en "Configuración avanzada" → "Ir a Mailer Pro".

"El archivo Excel no se importa / falta la columna de correo":
- La primera fila debe tener encabezados y una columna debe llamarse
  "CORREO CLIENTE" (o "email", "correo", "correo electrónico").

"La imagen no se ve en el correo":
- Algunos clientes de correo bloquean imágenes; el destinatario debe hacer
  clic en "Mostrar imágenes".

"Todos los correos fallan por licencia":
- La licencia se valida contra el servidor al iniciar cada campaña. Si venció
  o se desactivó, revisa el estado real en el modal "Licencia".
```

- [ ] **Step 3: Verificar que no queden referencias al backend viejo**

Run: `grep -rn "script.google.com\|Apps Script\|Enlace Mágico\|SHARED_TOKEN" --include=*.js --include=*.html --include=*.json --include=*.md . | grep -v docs/superpowers | grep -v graphify-out`
Expected: sin resultados

- [ ] **Step 4: Commit**

```bash
git add -A
git commit -m "docs: instrucciones sin Apps Script, con conexión de cuenta y relevo"
```

---

### Task 9: Verificación final

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Sintaxis de todos los módulos**

Run: `node --check background.js && node --check ui/dashboard.js && node --check ui/gmailAuth.js && node --check ui/mimeBuilder.js && node --check ui/gmailErrors.js && node --check ui/licenseClient.js && node --check ui/licenseGate.js`
Expected: sin salida

- [ ] **Step 2: Toda la batería de tests**

Run: `node --test tests/`
Expected: PASS — 21 tests, 0 fallos

- [ ] **Step 3: Rutas del manifest existentes**

Run: `node -e "const m=JSON.parse(require('fs').readFileSync('manifest.json','utf8'));const fs=require('fs');[m.background.service_worker,m.action.default_popup,...Object.values(m.icons)].forEach(p=>{if(!fs.existsSync(p))throw new Error('falta '+p)});console.log('rutas OK')"`
Expected: `rutas OK`

- [ ] **Step 4: Checklist manual en el navegador**

Esto **no se puede automatizar desde este entorno** y requiere el `CLIENT_ID` real cargado en `ui/gmailAuth.js` y la credencial creada en Google Cloud (ver §4 del spec). Verificar en Chrome:

1. Cargar la extensión desempaquetada y confirmar que el ID coincide con el derivado en la Task 4.
2. Abrir el dashboard sin cuenta conectada → Configuración muestra 🔴.
3. "Conectar cuenta de Gmail" → pantalla de Google → autorizar → vuelve 🟢 con la dirección correcta.
4. Cerrar y reabrir el popup → sigue en 🟢 sin abrir ventanas.
5. Importar un Excel de 2 filas con correos propios y enviar: llegan, con el nombre de remitente configurado, la imagen embebida visible y el PDF descargable.
6. Cerrar sesión de Google en el navegador y reabrir el popup → muestra 🔴.
7. Desconectar desde Configuración → vuelve a 🔴 y el botón "Iniciar Campaña" se deshabilita.

**No verificable sin quemar cuota real:** la pausa por límite diario. Se puede forzar cambiando temporalmente `GMAIL_SEND_URL` en `background.js` por un endpoint que devuelva 403 con `{"error":{"errors":[{"reason":"quotaExceeded"}],"message":"Daily Limit Exceeded"}}` y confirmando que aparece el banner naranja, que los destinatarios pendientes siguen en "Pendiente ⏳" y que al conectar otra cuenta la campaña retoma en el destinatario correcto.

- [ ] **Step 5: Commit final**

```bash
git add -A
git commit -m "chore: verificación de la migración a Gmail API"
```
