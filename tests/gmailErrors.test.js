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
