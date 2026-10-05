import test from 'node:test';
import assert from 'node:assert/strict';
import { computeGmailConnectGate, GRACE_MS } from '../ui/licenseGate.js';

const NOW = 1_800_000_000_000;
const active = { status: 'active', lastValidatedAt: NOW - 1000 };

test('con licencia activa se puede conectar Gmail', () => {
  assert.deepEqual(computeGmailConnectGate(active, NOW), { allowed: true, message: '' });
});

test('sin licencia no se abre el consentimiento de Google', () => {
  const gate = computeGmailConnectGate(undefined, NOW);
  assert.equal(gate.allowed, false);
  assert.match(gate.message, /licencia/i);
});

test('una licencia vencida tampoco deja conectar', () => {
  const gate = computeGmailConnectGate({ status: 'expired', lastValidatedAt: NOW }, NOW);
  assert.equal(gate.allowed, false);
  assert.match(gate.message, /licencia/i);
});

test('vencida la gracia sin conexión, no deja conectar', () => {
  const stale = { status: 'active', lastValidatedAt: NOW - GRACE_MS - 1 };
  assert.equal(computeGmailConnectGate(stale, NOW).allowed, false);
});
