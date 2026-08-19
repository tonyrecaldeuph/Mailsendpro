import test from 'node:test';
import assert from 'node:assert/strict';
import { buildSuspectRows, toStyledHtmlTable, PROBLEM_STYLES } from '../ui/suspectReport.js';

const recipients = [
  { 'CORREO CLIENTE': 'ana@corp.com', 'NOMBRE CLIENTE': 'Ana', MONTO: '1.200' },
  { 'CORREO CLIENTE': 'sincorreo@gmail.com', 'NOMBRE CLIENTE': 'Beto', MONTO: '890' },
  { 'CORREO CLIENTE': 'juan@gmial.com', 'NOMBRE CLIENTE': 'Juan', MONTO: '450' }
];

const findings = [
  { email: 'sincorreo@gmail.com', problem: 'relleno', suggestion: null },
  { email: 'juan@gmial.com', problem: 'typo', suggestion: 'gmail.com' }
];

test('el reporte incluye a todos los clientes, no solo a los dudosos', () => {
  const { rows } = buildSuspectRows(recipients, findings);
  assert.equal(rows.length, 3);
  assert.deepEqual(rows.map((r) => r.cells[0]), ['ana@corp.com', 'sincorreo@gmail.com', 'juan@gmial.com']);
});

test('las columnas del Excel del usuario se conservan', () => {
  const { headers } = buildSuspectRows(recipients, findings);
  assert.deepEqual(headers, ['Correo', 'Diagnóstico', 'NOMBRE CLIENTE', 'MONTO']);
});

test('cada caso trae su propio diagnóstico', () => {
  const { rows } = buildSuspectRows(recipients, findings);
  assert.equal(rows[1].cells[1], 'Correo de relleno (el cliente no dio uno)');
  assert.match(rows[2].cells[1], /Dominio mal escrito.*gmail\.com/);
});

test('una dirección sin problemas queda sin diagnóstico y sin marca', () => {
  const { rows } = buildSuspectRows(recipients, findings);
  assert.equal(rows[0].cells[1], '');
  assert.equal(rows[0].problem, null);
});

test('cada fila sabe qué problema tiene, para poder pintarla', () => {
  const { rows } = buildSuspectRows(recipients, findings);
  assert.equal(rows[1].problem, 'relleno');
  assert.equal(rows[2].problem, 'typo');
});

test('sin hallazgos, ninguna fila queda marcada', () => {
  const { rows } = buildSuspectRows(recipients, []);
  assert.equal(rows.every((r) => r.problem === null), true);
});

test('una lista vacía no rompe', () => {
  const { headers, rows } = buildSuspectRows([], []);
  assert.equal(headers.length, 0);
  assert.equal(rows.length, 0);
});

test('cada tipo de problema tiene su propio color', () => {
  const colores = Object.values(PROBLEM_STYLES).map((s) => s.color);
  assert.equal(new Set(colores).size, colores.length, 'los colores no deben repetirse entre casos');
  Object.values(PROBLEM_STYLES).forEach((estilo) => {
    assert.match(estilo.color, /^#[0-9a-f]{6}$/i);
    assert.ok(estilo.etiqueta.length > 0);
  });
});

// ─── Tabla con estilos ───────────────────────────────────────────────────────

test('las direcciones dudosas van con la fuente en rojo', () => {
  const html = toStyledHtmlTable(buildSuspectRows(recipients, findings));
  const filaRelleno = html.split('<tr>').find((f) => f.includes('sincorreo@gmail.com'));
  assert.match(filaRelleno, new RegExp(`color:\\s*${PROBLEM_STYLES.relleno.color}`, 'i'));
  assert.match(filaRelleno, /font-weight:\s*bold/i);
});

test('las direcciones sanas no llevan color', () => {
  const html = toStyledHtmlTable(buildSuspectRows(recipients, findings));
  const filaSana = html.split('<tr>').find((f) => f.includes('ana@corp.com'));
  assert.ok(!/color:\s*#(dc2626|ea580c|d97706|b91c1c)/i.test(filaSana));
});

test('el HTML escapa el contenido para que un dato no rompa la tabla', () => {
  const html = toStyledHtmlTable(buildSuspectRows(
    [{ 'CORREO CLIENTE': 'a@b.com', NOTA: '<script>alert(1)</script> & "cita"' }],
    []
  ));
  assert.ok(!html.includes('<script>'));
  assert.ok(html.includes('&lt;script&gt;'));
  assert.ok(html.includes('&amp;'));
});

test('lleva la cabecera que Excel necesita para abrirlo', () => {
  const html = toStyledHtmlTable(buildSuspectRows(recipients, findings));
  assert.match(html, /^<html/);
  assert.ok(html.includes('charset="utf-8"'));
  assert.ok(html.includes('</table>'));
});

test('incluye una leyenda con el significado de cada color', () => {
  const html = toStyledHtmlTable(buildSuspectRows(recipients, findings));
  Object.values(PROBLEM_STYLES).forEach((estilo) => {
    assert.ok(html.includes(estilo.etiqueta), `falta la leyenda de ${estilo.etiqueta}`);
  });
});
