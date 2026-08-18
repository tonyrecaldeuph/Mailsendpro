import test from 'node:test';
import assert from 'node:assert/strict';
import { getDomain, suggestDomain, levenshtein, interpretDnsResponse } from '../ui/emailValidator.js';

test('getDomain devuelve el dominio en minúsculas', () => {
  assert.equal(getDomain('Ana@Gmail.COM'), 'gmail.com');
  assert.equal(getDomain('  luis@corp.com  '), 'corp.com');
});

test('getDomain con una dirección sin arroba devuelve cadena vacía', () => {
  assert.equal(getDomain('sin-arroba'), '');
  assert.equal(getDomain(''), '');
  assert.equal(getDomain(null), '');
});

test('levenshtein cuenta las ediciones mínimas', () => {
  assert.equal(levenshtein('gmail.com', 'gmail.com'), 0);
  assert.equal(levenshtein('gmial.com', 'gmail.com'), 2);
  assert.equal(levenshtein('gmai.com', 'gmail.com'), 1);
});

test('los typos clásicos devuelven la corrección', () => {
  assert.equal(suggestDomain('gmial.com'), 'gmail.com');
  assert.equal(suggestDomain('gmai.com'), 'gmail.com');
  assert.equal(suggestDomain('gmail.co'), 'gmail.com');
  assert.equal(suggestDomain('hotmial.com'), 'hotmail.com');
  assert.equal(suggestDomain('hotmail.con'), 'hotmail.com');
  assert.equal(suggestDomain('yahooo.com'), 'yahoo.com');
  assert.equal(suggestDomain('outlok.com'), 'outlook.com');
});

test('un dominio correcto no genera sugerencia', () => {
  assert.equal(suggestDomain('gmail.com'), null);
  assert.equal(suggestDomain('hotmail.com'), null);
  assert.equal(suggestDomain('outlook.es'), null);
});

test('un dominio corporativo propio no se confunde con uno común', () => {
  assert.equal(suggestDomain('uphone.com.ec'), null);
  assert.equal(suggestDomain('anomalydevs.qzz.io'), null);
  assert.equal(suggestDomain('empresa.com'), null);
});

test('un dominio vacío no rompe', () => {
  assert.equal(suggestDomain(''), null);
  assert.equal(suggestDomain(null), null);
});

// ─── Interpretación de la consulta DNS ───────────────────────────────────────

test('un dominio inexistente se reporta como tal', () => {
  // Status 3 es NXDOMAIN en la respuesta de DNS-over-HTTPS.
  assert.equal(interpretDnsResponse({ Status: 3 }), 'inexistente');
});

test('un dominio con servidor de correo está bien', () => {
  assert.equal(interpretDnsResponse({
    Status: 0,
    Answer: [{ type: 15, data: '10 alt1.aspmx.l.google.com.' }]
  }), 'ok');
});

test('un dominio que existe pero no recibe correo se distingue del inexistente', () => {
  assert.equal(interpretDnsResponse({ Status: 0, Answer: [] }), 'sin-correo');
  assert.equal(interpretDnsResponse({ Status: 0 }), 'sin-correo');
});

test('un dominio que declara explícitamente que no recibe correo se detecta', () => {
  // "null MX" (RFC 7505): un MX apuntando a la raíz significa "acá no llega
  // correo". Es lo que publica example.com, y contarlo como válido dejaba
  // pasar direcciones que rebotan seguro.
  assert.equal(interpretDnsResponse({
    Status: 0,
    Answer: [{ type: 15, data: '0 .' }]
  }), 'sin-correo');
});

test('con varios MX alcanza con que uno sea real', () => {
  assert.equal(interpretDnsResponse({
    Status: 0,
    Answer: [
      { type: 15, data: '0 .' },
      { type: 15, data: '10 alt1.aspmx.l.google.com.' }
    ]
  }), 'ok');
});

test('una respuesta con registros que no son MX no cuenta como servidor de correo', () => {
  assert.equal(interpretDnsResponse({
    Status: 0,
    Answer: [{ type: 5, data: 'alias.example.com.' }]
  }), 'sin-correo');
});

test('una respuesta que no se entiende no marca nada, para no inventar errores', () => {
  assert.equal(interpretDnsResponse(null), 'desconocido');
  assert.equal(interpretDnsResponse({}), 'desconocido');
  assert.equal(interpretDnsResponse({ Status: 2 }), 'desconocido');
});
