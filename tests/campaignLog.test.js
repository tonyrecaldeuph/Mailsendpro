import test from 'node:test';
import assert from 'node:assert/strict';
import { createCampaign, appendResult, summarize, tailLog, finalizeCampaign } from '../ui/campaignLog.js';

const base = () => createCampaign({
  total: 3,
  account: 'ventas@empresa.com',
  subject: 'Recordatorio',
  startedAt: 1000
});

test('una campaña nueva arranca en curso y sin resultados', () => {
  const campaign = base();
  assert.equal(campaign.status, 'En curso');
  assert.equal(campaign.total, 3);
  assert.equal(campaign.account, 'ventas@empresa.com');
  assert.equal(campaign.subject, 'Recordatorio');
  assert.equal(campaign.date, 1000);
  assert.deepEqual(campaign.results, []);
});

test('appendResult no muta la campaña original', () => {
  const campaign = base();
  const next = appendResult(campaign, { email: 'a@b.com', status: 'enviado', timestamp: 1100 });
  assert.equal(campaign.results.length, 0);
  assert.equal(next.results.length, 1);
});

test('appendResult guarda motivo y datos del contacto', () => {
  const next = appendResult(base(), {
    email: 'luis@corp.com',
    status: 'error',
    reason: 'Invalid to header',
    contactData: { NOMBRE: 'Luis' },
    timestamp: 1200
  });
  assert.deepEqual(next.results[0], {
    email: 'luis@corp.com',
    status: 'error',
    reason: 'Invalid to header',
    contactData: { NOMBRE: 'Luis' },
    timestamp: 1200
  });
});

test('un resultado sin motivo ni contacto queda con valores neutros, no undefined', () => {
  const next = appendResult(base(), { email: 'a@b.com', status: 'enviado', timestamp: 1100 });
  assert.equal(next.results[0].reason, '');
  assert.deepEqual(next.results[0].contactData, {});
});

test('summarize cuenta enviados, errores y pendientes por separado', () => {
  let campaign = base();
  campaign = appendResult(campaign, { email: 'a@b.com', status: 'enviado', timestamp: 1 });
  campaign = appendResult(campaign, { email: 'b@b.com', status: 'error', reason: 'x', timestamp: 2 });
  campaign = appendResult(campaign, { email: 'c@b.com', status: 'pendiente', timestamp: 3 });

  assert.deepEqual(summarize(campaign), { total: 3, enviados: 1, errores: 1, pendientes: 1, procesados: 2 });
});

test('un pendiente nunca se cuenta como enviado', () => {
  let campaign = createCampaign({ total: 2, startedAt: 0 });
  campaign = appendResult(campaign, { email: 'a@b.com', status: 'pendiente', timestamp: 1 });
  assert.equal(summarize(campaign).enviados, 0);
});

test('tailLog devuelve las últimas entradas, la más reciente primero', () => {
  let campaign = createCampaign({ total: 5, startedAt: 0 });
  ['a', 'b', 'c', 'd', 'e'].forEach((letter, i) => {
    campaign = appendResult(campaign, { email: `${letter}@b.com`, status: 'enviado', timestamp: i });
  });

  const tail = tailLog(campaign, 3);
  assert.equal(tail.length, 3);
  assert.deepEqual(tail.map((r) => r.email), ['e@b.com', 'd@b.com', 'c@b.com']);
});

test('tailLog con menos resultados que el límite los devuelve todos', () => {
  const campaign = appendResult(base(), { email: 'a@b.com', status: 'enviado', timestamp: 1 });
  assert.equal(tailLog(campaign, 50).length, 1);
});

test('recortar el log en vivo no altera los totales', () => {
  let campaign = createCampaign({ total: 100, startedAt: 0 });
  for (let i = 0; i < 100; i += 1) {
    campaign = appendResult(campaign, { email: `x${i}@b.com`, status: 'enviado', timestamp: i });
  }
  assert.equal(tailLog(campaign, 50).length, 50);
  assert.equal(summarize(campaign).enviados, 100);
});

test('finalizeCampaign marca como pendientes a los destinatarios no procesados', () => {
  let campaign = createCampaign({ total: 3, startedAt: 0 });
  campaign = appendResult(campaign, { email: 'a@b.com', status: 'enviado', timestamp: 1 });

  const closed = finalizeCampaign(campaign, {
    status: 'Cancelada',
    finishedAt: 5000,
    remaining: [
      { email: 'b@b.com', contactData: { NOMBRE: 'Beto' } },
      { email: 'c@b.com', contactData: { NOMBRE: 'Cami' } }
    ],
    reason: 'Campaña cancelada por el usuario'
  });

  assert.equal(closed.status, 'Cancelada');
  assert.equal(closed.finishedAt, 5000);
  assert.equal(closed.results.length, 3);
  assert.deepEqual(closed.results.slice(1).map((r) => r.status), ['pendiente', 'pendiente']);
  assert.equal(closed.results[1].reason, 'Campaña cancelada por el usuario');
  assert.deepEqual(closed.results[1].contactData, { NOMBRE: 'Beto' });
  assert.deepEqual(summarize(closed), { total: 3, enviados: 1, errores: 0, pendientes: 2, procesados: 1 });
});

test('finalizeCampaign sin destinatarios restantes solo cierra la campaña', () => {
  const closed = finalizeCampaign(base(), { status: 'Completada', finishedAt: 9 });
  assert.equal(closed.status, 'Completada');
  assert.deepEqual(closed.results, []);
});