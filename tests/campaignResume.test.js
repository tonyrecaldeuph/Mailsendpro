import test from 'node:test';
import assert from 'node:assert/strict';
import { filterRemainingRecipients } from '../ui/campaignResume.js';

const excel = [
  { Nombre: 'Ana', Email: 'ana@empresa.com' },
  { Nombre: 'Beto', Email: 'beto@empresa.com' },
  { Nombre: 'Caro', Email: 'caro@empresa.com' }
];

const campaignWith = (results) => ({ total: 3, results });

test('sin campaña previa se retoman todos los del Excel', () => {
  assert.deepEqual(filterRemainingRecipients(excel, campaignWith([])), excel);
});

test('un Excel vacío no deja nada para retomar', () => {
  assert.deepEqual(filterRemainingRecipients([], campaignWith([])), []);
});

test('saca a los ya enviados, con error u omitidos y conserva el orden del Excel', () => {
  const campaign = campaignWith([
    { email: 'ana@empresa.com', status: 'enviado' },
    { email: 'caro@empresa.com', status: 'error' }
  ]);
  assert.deepEqual(filterRemainingRecipients(excel, campaign), [excel[1]]);
});

test('un omitido cuenta como procesado', () => {
  const campaign = campaignWith([{ email: 'beto@empresa.com', status: 'omitido' }]);
  assert.deepEqual(filterRemainingRecipients(excel, campaign), [excel[0], excel[2]]);
});

test('los pendientes no cuentan como procesados: son justamente los que faltan', () => {
  const campaign = campaignWith([{ email: 'ana@empresa.com', status: 'pendiente' }]);
  assert.deepEqual(filterRemainingRecipients(excel, campaign), excel);
});

test('compara correos sin importar mayúsculas ni espacios', () => {
  const campaign = campaignWith([{ email: '  ANA@Empresa.com ', status: 'enviado' }]);
  assert.deepEqual(filterRemainingRecipients(excel, campaign), [excel[1], excel[2]]);
});

test('una fila sin correo se deja pasar porque no se puede saber si se envió', () => {
  const sinCorreo = { Nombre: 'Dani' };
  const campaign = campaignWith([{ email: 'ana@empresa.com', status: 'enviado' }]);
  assert.deepEqual(filterRemainingRecipients([sinCorreo], campaign), [sinCorreo]);
});
