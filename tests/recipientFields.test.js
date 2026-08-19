import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveEmail, resolveEmailKey, normalizeHeader } from '../ui/recipientFields.js';

test('encuentra el correo en una columna llamada "CORREO CLIENTE"', () => {
  assert.equal(resolveEmail({ 'CORREO CLIENTE': 'ana@corp.com', MONTO: 100 }), 'ana@corp.com');
});

test('acepta los alias habituales sin importar mayúsculas ni acentos', () => {
  assert.equal(resolveEmail({ Email: 'a@b.com' }), 'a@b.com');
  assert.equal(resolveEmail({ 'Correo Electronico': 'a@b.com' }), 'a@b.com');
  assert.equal(resolveEmail({ 'CORREO ELECTRÓNICO': 'a@b.com' }), 'a@b.com');
  assert.equal(resolveEmail({ 'E-Mail': 'a@b.com' }), 'a@b.com');
});

test('recorta los espacios del valor', () => {
  assert.equal(resolveEmail({ correo: '  ana@corp.com  ' }), 'ana@corp.com');
});

test('sin columna de correo devuelve cadena vacía en vez de romper', () => {
  assert.equal(resolveEmail({ NOMBRE: 'Ana' }), '');
  assert.equal(resolveEmail({}), '');
  assert.equal(resolveEmail(null), '');
});

test('resolveEmailKey devuelve el nombre original de la columna', () => {
  assert.equal(resolveEmailKey({ 'CORREO CLIENTE': 'ana@corp.com' }), 'CORREO CLIENTE');
  assert.equal(resolveEmailKey({ NOMBRE: 'Ana' }), null);
});

test('normalizeHeader baja acentos, mayúsculas y espacios repetidos', () => {
  assert.equal(normalizeHeader('  CORREO   ELECTRÓNICO '), 'correo electronico');
});