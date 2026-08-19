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

test('un nombre de archivo con tildes usa el parámetro extendido RFC 2231', () => {
  const mime = buildMimeMessage({
    ...base,
    attachments: [{ filename: 'informe_período.pdf', mimeType: 'application/pdf', base64: 'QkJCQg==' }]
  });
  // Un encoded-word RFC 2047 entre comillas llegaría crudo al destinatario.
  assert.ok(!mime.includes('filename="=?UTF-8?B?'));
  assert.match(mime, /filename\*=UTF-8''informe_per%C3%ADodo\.pdf/);
  assert.match(mime, /name\*=UTF-8''informe_per%C3%ADodo\.pdf/);
});

test('un adjunto sin mimeType no produce "Content-Type: undefined"', () => {
  const mime = buildMimeMessage({
    ...base,
    attachments: [{ filename: 'documento.pdf', base64: 'QkJCQg==' }]
  });
  assert.ok(!mime.includes('undefined'));
  assert.match(mime, /Content-Type: application\/octet-stream; name="documento\.pdf"/);
});

test('un CRLF en el destinatario no puede inyectar cabeceras', () => {
  const mime = buildMimeMessage({
    ...base,
    to: 'cliente@ejemplo.com\r\nBcc: atacante@evil.com'
  });
  // El texto sigue ahí, pero aplastado dentro del To: — nunca como cabecera propia.
  assert.ok(!/\r\nBcc:/.test(mime));
  assert.match(mime, /\r\nTo: cliente@ejemplo\.comBcc: atacante@evil\.com\r\n/);
});

test('un CRLF en la dirección del remitente tampoco inyecta cabeceras', () => {
  const mime = buildMimeMessage({
    ...base,
    fromName: '',
    fromEmail: 'cobranzas@empresa.com\r\nBcc: atacante@evil.com'
  });
  assert.ok(!/\r\nBcc:/.test(mime));
});

test('los tres PDFs permitidos viajan como partes separadas', () => {
  const pdf = (n) => ({ filename: `factura${n}.pdf`, mimeType: 'application/pdf', base64: 'QkJCQg==' });
  const mime = buildMimeMessage({ ...base, attachments: [pdf(1), pdf(2), pdf(3)] });
  ['factura1.pdf', 'factura2.pdf', 'factura3.pdf'].forEach((name) => {
    assert.match(mime, new RegExp(`filename="${name.replace('.', '\\.')}"`));
  });
  assert.equal(mime.split('--BOUNDARY_mix\r\n').length - 1, 4); // html + 3 PDFs
});

test('el cuerpo HTML con acentos sobrevive el roundtrip UTF-8', () => {
  const mime = buildMimeMessage({ ...base, html: '<p>Notificación de cobranza: ñandú</p>' });
  assert.equal(decodeBase64Body(mime), '<p>Notificación de cobranza: ñandú</p>');
});

test('wrapBase64 corta en líneas de 76 caracteres', () => {
  const lines = wrapBase64('A'.repeat(200)).split('\r\n');
  assert.equal(lines[0].length, 76);
  assert.ok(lines.every((l) => l.length <= 76));
});

test('encodeHeaderWord deja el ASCII puro sin tocar', () => {
  assert.equal(encodeHeaderWord('Hello World'), 'Hello World');
});
