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
 * Un CRLF dentro de una dirección abriría una cabecera nueva en el mensaje
 * ("Bcc: ..."). Hoy dataProcessor.js ya rechaza esas filas al importar el
 * Excel, pero la garantía tiene que vivir también acá: este módulo es el
 * único responsable de producir un RFC 2822 bien formado.
 */
function stripCRLF(value) {
  return String(value || '').replace(/[\r\n]/g, '');
}

/** Escapa lo que encodeURIComponent deja pasar y RFC 2231 no permite. */
function encodeRFC2231(value) {
  return encodeURIComponent(value).replace(/['()*]/g, (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`);
}

/**
 * RFC 2047 prohíbe un encoded-word dentro de un string entrecomillado, así que
 * un nombre de archivo con tildes o ñ no puede ir como filename="=?UTF-8?B?…?=":
 * el destinatario vería ese texto crudo. Para esos casos se usa el parámetro
 * extendido de RFC 2231 (filename*=UTF-8''…), que sí decodifican los clientes.
 */
function filenameParam(param, name) {
  return /^[\x20-\x7E]*$/.test(name)
    ? `${param}="${name.replace(/"/g, '')}"`
    : `${param}*=UTF-8''${encodeRFC2231(name)}`;
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
  // Sin fallback, un adjunto sin tipo generaba "Content-Type: undefined".
  // Code.gs tenía este mismo default.
  const type = mimeType || 'application/octet-stream';
  const lines = [
    `Content-Type: ${type}; ${filenameParam('name', safeName)}`,
    'Content-Transfer-Encoding: base64'
  ];
  if (inline) {
    lines.push(`Content-ID: <${cid}>`);
    lines.push(`Content-Disposition: inline; ${filenameParam('filename', safeName)}`);
  } else {
    lines.push(`Content-Disposition: attachment; ${filenameParam('filename', safeName)}`);
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
    `From: ${formatAddress(fromName, stripCRLF(fromEmail))}`,
    `To: ${stripCRLF(to)}`,
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
