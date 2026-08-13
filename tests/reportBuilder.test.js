import test from 'node:test';
import assert from 'node:assert/strict';
import { buildReportRows, toCSV, buildFileName } from '../ui/reportBuilder.js';

const campaign = {
  date: new Date('2026-08-13T14:30:00Z').getTime(),
  total: 3,
  status: 'Completada',
  results: [
    {
      email: 'ana@corp.com',
      status: 'enviado',
      reason: '',
      timestamp: 1,
      contactData: { 'CORREO CLIENTE': 'ana@corp.com', NOMBRE: 'Ana', MONTO: '1.200' }
    },
    {
      email: 'luis@corp.com',
      status: 'error',
      reason: 'Invalid to header',
      timestamp: 2,
      contactData: { 'CORREO CLIENTE': 'luis@corp.com', NOMBRE: 'Luis', MONTO: '890' }
    },
    {
      email: 'mario@corp.com',
      status: 'pendiente',
      reason: 'Cuota diaria agotada',
      timestamp: 3,
      contactData: { 'CORREO CLIENTE': 'mario@corp.com', NOMBRE: 'Mario', MONTO: '450' }
    }
  ]
};

test('las columnas fijas van primero y después las del Excel del usuario', () => {
  const { headers } = buildReportRows(campaign);
  assert.deepEqual(headers, ['Correo', 'Estado', 'Motivo', 'NOMBRE', 'MONTO']);
});

test('la columna de correo del Excel no se repite como columna extra', () => {
  const { headers } = buildReportRows(campaign);
  assert.ok(!headers.includes('CORREO CLIENTE'));
});

test('los estados se exportan con etiqueta legible', () => {
  const { rows } = buildReportRows(campaign);
  assert.deepEqual(rows.map((r) => r[1]), ['Enviado', 'Error', 'Pendiente']);
});

test('cada fila lleva correo, motivo y los valores del contacto', () => {
  const { rows } = buildReportRows(campaign);
  assert.deepEqual(rows[1], ['luis@corp.com', 'Error', 'Invalid to header', 'Luis', '890']);
});

test('una campaña cancelada exporta igual a sus pendientes', () => {
  const { rows } = buildReportRows({ ...campaign, status: 'Cancelada' });
  assert.equal(rows.length, 3);
  assert.deepEqual(rows[2].slice(0, 3), ['mario@corp.com', 'Pendiente', 'Cuota diaria agotada']);
});

test('un contacto al que le falta una columna deja la celda vacía, no undefined', () => {
  const { rows } = buildReportRows({
    ...campaign,
    results: [
      { email: 'a@b.com', status: 'enviado', reason: '', timestamp: 1, contactData: { NOMBRE: 'Ana', MONTO: '10' } },
      { email: 'b@b.com', status: 'enviado', reason: '', timestamp: 2, contactData: { NOMBRE: 'Beto' } }
    ]
  });
  assert.deepEqual(rows[1], ['b@b.com', 'Enviado', '', 'Beto', '']);
});

test('una campaña sin resultados no produce filas ni rompe', () => {
  const { headers, rows } = buildReportRows({ ...campaign, results: [] });
  assert.deepEqual(headers, []);
  assert.deepEqual(rows, []);
});

test('el CSV empieza con BOM para que Excel respete los acentos', () => {
  const csv = toCSV(buildReportRows(campaign));
  assert.equal(csv[0], '\uFEFF');
});

test('el CSV escapa comas, comillas y saltos de línea', () => {
  const csv = toCSV({
    headers: ['Correo', 'Motivo'],
    rows: [
      ['a@b.com', 'Rechazado, sin buzón'],
      ['b@b.com', 'Dijo "no existe"'],
      ['c@b.com', 'Primera línea\nSegunda línea']
    ]
  });
  const lines = csv.replace('\uFEFF', '').split('\r\n');
  assert.equal(lines[0], 'Correo,Motivo');
  assert.equal(lines[1], 'a@b.com,"Rechazado, sin buzón"');
  assert.equal(lines[2], 'b@b.com,"Dijo ""no existe"""');
  assert.ok(csv.includes('"Primera línea\nSegunda línea"'));
});

test('un valor sin caracteres especiales no se entrecomilla', () => {
  const csv = toCSV({ headers: ['A'], rows: [['simple']] });
  assert.ok(csv.includes('\r\nsimple'));
  assert.ok(!csv.includes('"simple"'));
});

test('el nombre del archivo lleva la fecha de la campaña', () => {
  assert.equal(buildFileName(campaign, 'csv'), 'campana_2026-08-13.csv');
  assert.equal(buildFileName(campaign, 'xlsx'), 'campana_2026-08-13.xlsx');
});