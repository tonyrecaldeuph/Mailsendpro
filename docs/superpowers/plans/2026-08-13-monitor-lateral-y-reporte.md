# Monitor lateral en vivo y reporte de campañas — Plan de implementación

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Que el usuario pueda ver el avance del envío en un panel lateral mientras trabaja en otra cosa, y que al terminar quede un reporte descargable en CSV y Excel, con historial de campañas.

**Architecture:** `background.js` sigue siendo la única fuente de verdad y ya emite `sendProgress` / `sendComplete` por `chrome.runtime.sendMessage`; el panel lateral (`ui/monitor.js`) se engancha a ese mismo broadcast, igual que el dashboard. Tres módulos puros nuevos —`recipientFields.js`, `campaignLog.js` y `reportBuilder.js`— concentran la lógica testeable, y `historyStore.js` aísla la persistencia en `chrome.storage.local`.

**Tech Stack:** Chrome Extension MV3 (ESM en el service worker), `chrome.sidePanel` (Chrome 114+), SheetJS 0.20.3 ya incluido en `ui/lib/xlsx.js`, `node:test` para los módulos puros (Node v22.20.0).

**Spec:** `docs/superpowers/specs/2026-08-13-monitor-lateral-y-reporte-design.md`

---

## Estructura de archivos

| Archivo | Responsabilidad |
|---|---|
| `ui/recipientFields.js` (nuevo) | Resolver qué columna del Excel es el correo. Puro. Se extrae de `background.js` porque ahora lo necesitan dos consumidores |
| `ui/campaignLog.js` (nuevo) | Crear la campaña, acumular resultados, resumir totales, cerrarla marcando pendientes. Puro |
| `ui/reportBuilder.js` (nuevo) | Filas del reporte y serialización a CSV. Puro: no toca el global `XLSX` |
| `ui/historyStore.js` (nuevo) | Persistir la campaña en curso y el historial en `chrome.storage.local` |
| `ui/monitor.html` (nuevo) | Markup del panel lateral |
| `ui/monitor.js` (nuevo) | Lógica del panel: pinta el broadcast y despacha los controles |
| `tests/recipientFields.test.js`, `tests/campaignLog.test.js`, `tests/reportBuilder.test.js` (nuevos) | Unitarios |
| `manifest.json` | Permiso `sidePanel` y `side_panel.default_path` |
| `background.js` | Acumular y persistir resultados, archivar al terminar, recuperar campañas interrumpidas |
| `ui/dashboard.js` | Abrir el panel al iniciar, modal Resumen, modal Historial, descargas |
| `ui/dashboard.html` | Modales `modal-resumen` y `modal-historial`, ítem de menú "Historial" |

`recipientFields.js` es un agregado del plan sobre el spec. El spec pide que el reporte resuelva la columna de correo "con el mismo `EMAIL_COLUMN_ALIASES` que ya usa el envío" (§7); la única forma de que sea *el mismo* y no una copia que se desincronice es extraerlo a un módulo. Es el mismo criterio con el que el plan anterior separó `gmailErrors.js`.

**Vocabulario compartido, idéntico en todas las tareas:**

- Estado de una entrada de resultado: `'enviado' | 'error' | 'pendiente'` (minúscula, es un valor interno).
- Estado de una campaña: `'En curso' | 'Completada' | 'Cancelada' | 'Interrumpida'` (capitalizado, se muestra tal cual en la UI).
- Una entrada de resultado es siempre `{ email, status, reason, timestamp, contactData }`.

---

### Task 1: `recipientFields.js` — resolver la columna de correo

`background.js` ya resuelve dinámicamente qué columna del Excel tiene el correo (`background.js:39-59`), porque el contacto conserva el nombre original de la columna y puede llamarse "CORREO CLIENTE". El reporte necesita exactamente lo mismo para no duplicar esa columna en la exportación. Se extrae a un módulo antes de que existan dos copias divergentes.

**Files:**
- Create: `ui/recipientFields.js`
- Test: `tests/recipientFields.test.js`
- Modify: `background.js:39-59`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/recipientFields.test.js`:

```js
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
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test tests/recipientFields.test.js`
Expected: FAIL — `Cannot find module '../ui/recipientFields.js'`

- [ ] **Step 3: Crear `ui/recipientFields.js`**

Es el código que hoy vive en `background.js:39-59`, movido tal cual y con `resolveEmailKey` agregado (el reporte necesita saber el nombre de la columna, no solo el valor).

```js
/**
 * Resolución de la columna de correo de un destinatario importado del Excel.
 *
 * El contacto conserva el nombre de columna original ("CORREO CLIENTE",
 * "Email", "Correo electrónico"...), así que no se puede asumir `.email`.
 * Módulo puro: lo usan el envío (background.js) y el reporte
 * (reportBuilder.js), y tener una sola copia evita que diverjan.
 */

// Mismos alias que ui/dataProcessor.js.
export const EMAIL_COLUMN_ALIASES = ['correo cliente', 'email', 'correo', 'correo electronico', 'e-mail'];

export function normalizeHeader(header) {
  return String(header)
    .trim()
    .toLowerCase()
    .replace(/[áàäâ]/g, 'a')
    .replace(/[éèëê]/g, 'e')
    .replace(/[íìïî]/g, 'i')
    .replace(/[óòöô]/g, 'o')
    .replace(/[úùüû]/g, 'u')
    .replace(/\s+/g, ' ');
}

/** @returns {string|null} El nombre original de la columna, o null si no hay ninguna. */
export function resolveEmailKey(recipient) {
  const key = Object.keys(recipient || {}).find((k) => EMAIL_COLUMN_ALIASES.includes(normalizeHeader(k)));
  return key || null;
}

/** @returns {string} El correo ya recortado, o '' si el contacto no tiene columna de correo. */
export function resolveEmail(recipient) {
  const key = resolveEmailKey(recipient);
  return key ? String(recipient[key] || '').trim() : '';
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test tests/recipientFields.test.js`
Expected: PASS — 6 tests

- [ ] **Step 5: Borrar el código duplicado de `background.js`**

Eliminar el bloque completo `background.js:39-59` (desde el comentario `// Mismos alias que ui/dataProcessor.js:` hasta el cierre de `resolveEmail`) y agregar el import junto a los demás, después de la línea 5:

```js
import { resolveEmail } from './ui/recipientFields.js';
```

- [ ] **Step 6: Verificar que no quedó ninguna definición huérfana**

Run: `grep -n "EMAIL_COLUMN_ALIASES\|function normalizeHeader\|function resolveEmail" background.js`
Expected: sin resultados — todo vive ahora en el módulo

Run: `node --check background.js`
Expected: sin salida

- [ ] **Step 7: Commit**

```bash
git add ui/recipientFields.js tests/recipientFields.test.js background.js
git commit -m "refactor: extraer la resolucion de la columna de correo a un modulo puro"
```

---

### Task 2: `campaignLog.js` — acumulador de resultados

**Files:**
- Create: `ui/campaignLog.js`
- Test: `tests/campaignLog.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/campaignLog.test.js`:

```js
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
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test tests/campaignLog.test.js`
Expected: FAIL — `Cannot find module '../ui/campaignLog.js'`

- [ ] **Step 3: Implementar `ui/campaignLog.js`**

```js
/**
 * Acumulador de resultados de una campaña.
 *
 * Módulo puro (sin chrome.*, sin red, sin DOM): background.js lo usa para
 * llevar el registro que alimenta el log en vivo del panel lateral y el
 * reporte descargable.
 *
 * Las funciones no mutan: devuelven una campaña nueva. Con listas de cientos
 * de destinatarios el costo es irrelevante —una copia cada 10 segundos, que es
 * el retardo por defecto entre correos— y a cambio el estado es fácil de
 * seguir y de testear.
 */

/** Estados posibles de una entrada de resultado. */
export const RESULT_STATUS = { SENT: 'enviado', ERROR: 'error', PENDING: 'pendiente' };

/** Estados posibles de una campaña. Se muestran tal cual en la UI. */
export const CAMPAIGN_STATUS = {
  RUNNING: 'En curso',
  COMPLETED: 'Completada',
  CANCELLED: 'Cancelada',
  INTERRUPTED: 'Interrumpida'
};

/**
 * @param {{total: number, account?: string, subject?: string, startedAt: number}} params
 */
export function createCampaign({ total, account = null, subject = '', startedAt }) {
  return {
    date: startedAt,
    finishedAt: null,
    total,
    account,
    subject,
    status: CAMPAIGN_STATUS.RUNNING,
    results: []
  };
}

/**
 * @param {Object} campaign
 * @param {{email: string, status: string, reason?: string, contactData?: Object, timestamp: number}} entry
 * @returns {Object} Una campaña nueva con la entrada agregada al final.
 */
export function appendResult(campaign, { email, status, reason = '', contactData = {}, timestamp }) {
  return {
    ...campaign,
    results: [...campaign.results, { email, status, reason, contactData, timestamp }]
  };
}

/**
 * `procesados` es lo que la barra de progreso debe mostrar: los pendientes no
 * cuentan, porque son destinatarios que nunca se intentaron.
 */
export function summarize(campaign) {
  const results = campaign?.results || [];
  const enviados = results.filter((r) => r.status === RESULT_STATUS.SENT).length;
  const errores = results.filter((r) => r.status === RESULT_STATUS.ERROR).length;
  const pendientes = results.filter((r) => r.status === RESULT_STATUS.PENDING).length;
  return { total: campaign?.total || 0, enviados, errores, pendientes, procesados: enviados + errores };
}

/**
 * Últimas entradas, la más reciente primero. Es un límite de DOM, no de datos:
 * el detalle completo siempre sale en el reporte.
 */
export function tailLog(campaign, limit = 50) {
  const results = campaign?.results || [];
  return results.slice(-limit).reverse();
}

/**
 * Cierra la campaña. Los destinatarios que nunca se intentaron entran como
 * `pendiente`: el reporte no debe dar por enviado lo que no se envió.
 *
 * @param {{status: string, finishedAt: number, remaining?: Array<{email: string, contactData?: Object}>, reason?: string}} params
 */
export function finalizeCampaign(campaign, { status, finishedAt, remaining = [], reason = '' }) {
  const pending = remaining.map((item) => ({
    email: item.email,
    status: RESULT_STATUS.PENDING,
    reason,
    contactData: item.contactData || {},
    timestamp: finishedAt
  }));

  return {
    ...campaign,
    status,
    finishedAt,
    results: [...campaign.results, ...pending]
  };
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test tests/campaignLog.test.js`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add ui/campaignLog.js tests/campaignLog.test.js
git commit -m "feat: acumulador de resultados de campana"
```

---

### Task 3: `reportBuilder.js` — filas del reporte y CSV

**Files:**
- Create: `ui/reportBuilder.js`
- Test: `tests/reportBuilder.test.js`

- [ ] **Step 1: Escribir el test que falla**

Crear `tests/reportBuilder.test.js`:

```js
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
  assert.equal(csv[0], '﻿');
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
  const lines = csv.replace('﻿', '').split('\r\n');
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
```

- [ ] **Step 2: Correr el test para verificar que falla**

Run: `node --test tests/reportBuilder.test.js`
Expected: FAIL — `Cannot find module '../ui/reportBuilder.js'`

- [ ] **Step 3: Implementar `ui/reportBuilder.js`**

```js
/**
 * Construcción del reporte de una campaña.
 *
 * Módulo puro a propósito: no toca el DOM ni el global XLSX. Devuelve filas
 * planas, y quien las quiera como Excel las pasa por SheetJS desde el
 * dashboard. Así se puede testear en Node, que es lo que en el aplicativo
 * hermano de SMS no se puede hacer porque esta lógica vive dentro del
 * dashboard mezclada con manipulación del DOM.
 */

import { resolveEmailKey } from './recipientFields.js';

const STATUS_LABELS = {
  enviado: 'Enviado',
  error: 'Error',
  pendiente: 'Pendiente'
};

const FIXED_HEADERS = ['Correo', 'Estado', 'Motivo'];

/**
 * Las columnas extra salen de los propios contactos, en el orden en que
 * aparecen en el Excel del usuario. Se recorren todos los resultados y no solo
 * el primero: una fila del Excel puede tener celdas vacías que XLSX omite.
 */
function collectExtraKeys(results) {
  const keys = [];
  results.forEach((result) => {
    const contactData = result.contactData || {};
    const emailKey = resolveEmailKey(contactData);
    Object.keys(contactData).forEach((key) => {
      // La columna de correo ya es la primera columna fija: repetirla solo
      // ensucia el reporte.
      if (key !== emailKey && !keys.includes(key)) keys.push(key);
    });
  });
  return keys;
}

/**
 * @param {Object} campaign
 * @returns {{headers: string[], rows: Array<Array<string>>}}
 */
export function buildReportRows(campaign) {
  const results = campaign?.results || [];
  if (results.length === 0) return { headers: [], rows: [] };

  const extraKeys = collectExtraKeys(results);
  const headers = [...FIXED_HEADERS, ...extraKeys];

  const rows = results.map((result) => {
    const contactData = result.contactData || {};
    const extras = extraKeys.map((key) => (contactData[key] == null ? '' : String(contactData[key])));
    return [
      result.email || '',
      STATUS_LABELS[result.status] || result.status || '',
      result.reason || '',
      ...extras
    ];
  });

  return { headers, rows };
}

/** RFC 4180: solo se entrecomilla cuando hace falta. */
function escapeCsvField(value) {
  const text = String(value == null ? '' : value);
  if (/[",\r\n]/.test(text)) return `"${text.replace(/"/g, '""')}"`;
  return text;
}

/**
 * El BOM inicial no es decorativo: sin él, Excel abre el archivo en la
 * codificación local y los acentos llegan rotos.
 */
export function toCSV({ headers, rows }) {
  const lines = [
    headers.map(escapeCsvField).join(','),
    ...rows.map((row) => row.map(escapeCsvField).join(','))
  ];
  return `﻿${lines.join('\r\n')}`;
}

/** @param {'csv'|'xlsx'} extension */
export function buildFileName(campaign, extension) {
  const date = new Date(campaign?.date || Date.now()).toISOString().slice(0, 10);
  return `campana_${date}.${extension}`;
}
```

- [ ] **Step 4: Correr el test para verificar que pasa**

Run: `node --test tests/reportBuilder.test.js`
Expected: PASS — 11 tests

- [ ] **Step 5: Commit**

```bash
git add ui/reportBuilder.js tests/reportBuilder.test.js
git commit -m "feat: constructor de filas del reporte y serializacion CSV"
```

---

### Task 4: `historyStore.js` — persistencia

**Files:**
- Create: `ui/historyStore.js`

No lleva test unitario: es una capa fina sobre `chrome.storage.local`, que no existe en Node. Toda la lógica que sí vale testear ya está en `campaignLog.js`.

- [ ] **Step 1: Crear `ui/historyStore.js`**

```js
/**
 * Persistencia de campañas en chrome.storage.local.
 *
 * Dos claves distintas y con propósitos distintos:
 * - CURRENT_KEY guarda la campaña en curso después de cada correo. Si Chrome
 *   recicla el service worker a mitad de envío, el reporte no se pierde.
 * - HISTORY_KEY guarda las campañas ya cerradas.
 */

const CURRENT_KEY = 'campaignInProgress';
const HISTORY_KEY = 'campaignHistory';

/** Tope por higiene de la UI, no por espacio: la extensión declara unlimitedStorage. */
export const HISTORY_LIMIT = 20;

export async function saveCurrent(campaign) {
  await chrome.storage.local.set({ [CURRENT_KEY]: campaign });
}

export async function loadCurrent() {
  const stored = await chrome.storage.local.get([CURRENT_KEY]);
  return stored[CURRENT_KEY] || null;
}

export async function clearCurrent() {
  await chrome.storage.local.remove([CURRENT_KEY]);
}

/** Archiva una campaña cerrada y limpia la que estaba en curso. */
export async function archive(campaign) {
  const history = await listHistory();
  history.unshift(campaign);
  await chrome.storage.local.set({ [HISTORY_KEY]: history.slice(0, HISTORY_LIMIT) });
  await clearCurrent();
}

/** @returns {Promise<Array>} Campañas cerradas, la más reciente primero. */
export async function listHistory() {
  const stored = await chrome.storage.local.get([HISTORY_KEY]);
  return stored[HISTORY_KEY] || [];
}

export async function clearHistory() {
  await chrome.storage.local.remove([HISTORY_KEY]);
}
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check ui/historyStore.js`
Expected: sin salida

- [ ] **Step 3: Commit**

```bash
git add ui/historyStore.js
git commit -m "feat: persistencia de la campana en curso y del historial"
```

---

### Task 5: `manifest.json` — permiso del panel lateral

**Files:**
- Modify: `manifest.json:7` (permisos) y agregar la clave `side_panel`

- [ ] **Step 1: Agregar el permiso `sidePanel`**

Reemplazar la línea 7:

```json
  "permissions": ["storage", "unlimitedStorage", "alarms", "identity", "sidePanel"],
```

- [ ] **Step 2: Declarar la página del panel**

Insertar después del bloque `"action"` (después de la línea 25, antes de `"icons"`):

```json
  "side_panel": {
    "default_path": "ui/monitor.html"
  },
```

`default_path` deja el panel habilitado globalmente, así que no hace falta llamar `chrome.sidePanel.setOptions()` desde el código.

- [ ] **Step 3: Verificar que el JSON sea válido y tenga lo nuevo**

Run: `node -e "const m=JSON.parse(require('fs').readFileSync('manifest.json','utf8')); if(!m.permissions.includes('sidePanel')) throw new Error('falta permiso sidePanel'); if(m.side_panel.default_path!=='ui/monitor.html') throw new Error('falta side_panel'); console.log('manifest OK')"`
Expected: `manifest OK`

- [ ] **Step 4: Commit**

```bash
git add manifest.json
git commit -m "chore: permiso y pagina del panel lateral"
```

---

### Task 6: `background.js` — registrar, persistir y archivar

**Files:**
- Modify: `background.js` — imports, estado, `sendEmails`, `pauseForQuota`, `broadcastProgress`, `broadcastCompletion`, handlers

- [ ] **Step 1: Agregar los imports**

Junto a los demás imports del inicio del archivo, después del import de `recipientFields.js` que agregó la Task 1:

```js
import { createCampaign, appendResult, summarize, tailLog, finalizeCampaign, RESULT_STATUS, CAMPAIGN_STATUS } from './ui/campaignLog.js';
import { saveCurrent, loadCurrent, archive, listHistory, clearHistory } from './ui/historyStore.js';
```

- [ ] **Step 2: Agregar el estado de la campaña**

Después de la línea `let currentProgress = ...` (`background.js:20`):

```js
// Registro de la campaña en curso. Vive en memoria mientras el worker está
// vivo y se persiste después de cada correo: si Chrome lo recicla, el reporte
// se puede reconstruir igual.
let currentCampaign = null;
const LIVE_LOG_LIMIT = 50;
```

- [ ] **Step 3: Recuperar campañas interrumpidas al arrancar**

Agregar justo después del bloque de `chrome.alarms.onAlarm.addListener` (`background.js:77-81`):

```js
/**
 * Si el worker murió a mitad de campaña, quedó una campaña "En curso" en
 * storage que nadie cerró. Se archiva como Interrumpida —es el único camino
 * por el que aparece ese estado— para que el usuario igual pueda descargar el
 * reporte de lo que sí se envió.
 */
async function recoverInterruptedCampaign() {
  const pending = await loadCurrent();
  if (!pending) return;

  const closed = finalizeCampaign(pending, {
    status: CAMPAIGN_STATUS.INTERRUPTED,
    finishedAt: Date.now(),
    reason: 'El envío se interrumpió antes de llegar a este destinatario'
  });
  await archive(closed);
  console.warn('[campaña] se archivó una campaña interrumpida:', closed.results.length, 'resultados');
}

recoverInterruptedCampaign().catch((err) => console.warn('[campaña] recuperación falló:', err?.message || err));
```

- [ ] **Step 4: Crear la campaña al iniciar el envío**

En `sendEmails`, reemplazar el bloque que va desde `sendInProgress = true;` hasta `currentProgress.failedEmails = [];` (`background.js:105-110`) por:

```js
  sendInProgress = true;
  isPaused = false;
  isCancelled = false;
  quotaExhausted = false;
  pausedAccount = null;
  currentProgress.failedEmails = [];

  currentCampaign = createCampaign({
    total: payload.recipients.length,
    account: account.email,
    subject: payload.subject || '',
    startedAt: Date.now()
  });
  await saveCurrent(currentCampaign);
```

- [ ] **Step 5: Registrar el resultado de cada destinatario**

Reemplazar el bloque de resultado del bucle (`background.js:157-164`, el `if (outcome.kind === 'ok') { ... } else { ... }`) por:

```js
    if (outcome.kind === 'ok') {
      successCount += 1;
      await recordResult(recipient, recipientEmail, RESULT_STATUS.SENT, '');
      broadcastProgress(index + 1, recipients.length, `Enviado a ${recipientEmail} (${successCount} OK, ${errorCount} errores)`, index, true);
    } else {
      errorCount += 1;
      currentProgress.failedEmails.push({ email: recipientEmail, error: outcome.message });
      await recordResult(recipient, recipientEmail, RESULT_STATUS.ERROR, outcome.message);
      broadcastProgress(index + 1, recipients.length, `Error en ${recipientEmail}: ${outcome.message}`, index, false);
    }
```

Y agregar la función justo antes de `sendOne` (antes del comentario `/** Envía un correo. ...`):

```js
/**
 * Agrega el resultado al registro y lo persiste. Una escritura cada 10
 * segundos —el retardo por defecto entre correos— no es un costo relevante, y
 * a cambio ninguna campaña se pierde si el worker se recicla.
 */
async function recordResult(recipient, email, status, reason) {
  currentCampaign = appendResult(currentCampaign, {
    email,
    status,
    reason,
    contactData: recipient,
    timestamp: Date.now()
  });
  await saveCurrent(currentCampaign);
}
```

- [ ] **Step 6: Archivar la campaña al terminar**

Reemplazar el cierre de `sendEmails` (`background.js:179-186`, desde `let finalStatus = ...` hasta el `return`) por:

```js
  let finalStatus = `Envío completado: ${successCount} OK, ${errorCount} errores.`;
  let campaignStatus = CAMPAIGN_STATUS.COMPLETED;
  let pendingReason = '';
  if (isCancelled) {
    finalStatus = `Envío cancelado. ${successCount} OK, ${errorCount} errores.`;
    campaignStatus = CAMPAIGN_STATUS.CANCELLED;
    pendingReason = 'Campaña cancelada antes de llegar a este destinatario';
  }

  // Lo que quedó sin intentar entra al reporte como pendiente. `index` apunta
  // al primer destinatario no procesado, tanto si se canceló como si se salió
  // del bucle por cualquier otra vía.
  const remaining = recipients.slice(index).map((item) => ({
    email: resolveEmail(item),
    contactData: item
  }));

  currentCampaign = finalizeCampaign(currentCampaign, {
    status: campaignStatus,
    finishedAt: Date.now(),
    remaining,
    reason: pendingReason
  });
  await archive(currentCampaign);

  broadcastCompletion(currentProgress.current, recipients.length, finalStatus);
  const archived = currentCampaign;
  currentCampaign = null;
  return { successCount, errorCount, failedEmails: currentProgress.failedEmails, campaign: archived };
}
```

- [ ] **Step 7: Emitir el último resultado en el broadcast**

El panel necesita saber qué acaba de pasar para agregarlo a su log. Reemplazar `broadcastProgress` completa (`background.js:304-323`):

```js
function broadcastProgress(current, total, status, rowIndex, rowSuccess) {
  currentProgress.current = current;
  currentProgress.total = total;
  currentProgress.status = status;

  const percent = total ? Math.floor((current / total) * 100) : 0;
  chrome.action.setBadgeText({ text: `${percent}%` }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ color: '#2ebd59' }).catch(() => { });

  const results = currentCampaign?.results || [];

  chrome.runtime.sendMessage({
    action: 'sendProgress',
    current,
    total,
    status,
    rowIndex,
    rowSuccess,
    failedEmails: currentProgress.failedEmails,
    isPaused,
    // El panel lateral agrega esta entrada a su log en vivo; el dashboard la ignora.
    lastResult: results[results.length - 1] || null,
    summary: currentCampaign ? summarize(currentCampaign) : null
  }).catch(() => { });
}
```

- [ ] **Step 8: Incluir el resumen en el mensaje de fin**

En `broadcastCompletion` (`background.js:336-343`), agregar dos campos al objeto que se envía, después de `isCancelled`:

```js
  chrome.runtime.sendMessage({
    action: 'sendComplete',
    current,
    total,
    status,
    failedEmails: currentProgress.failedEmails,
    isCancelled,
    summary: currentCampaign ? summarize(currentCampaign) : null,
    campaign: currentCampaign
  }).catch(() => { });
```

- [ ] **Step 9: Exponer el registro en `getState`**

Reemplazar el handler `getState` (`background.js:384-394`):

```js
  if (message?.action === 'getState') {
    sendResponse({
      sendInProgress,
      isPaused,
      isCancelled,
      quotaExhausted,
      pausedAccount,
      ...currentProgress,
      // Con esto el panel lateral se pone al día si se abre a mitad de campaña.
      log: currentCampaign ? tailLog(currentCampaign, LIVE_LOG_LIMIT) : [],
      summary: currentCampaign ? summarize(currentCampaign) : null,
      account: currentCampaign?.account || null
    });
    return true;
  }
```

- [ ] **Step 10: Agregar los handlers del historial**

Insertar antes del handler `LICENSE_ACTIVATE` (`background.js:429`):

```js
  if (message?.action === 'HISTORY_LIST') {
    (async () => {
      sendResponse({ history: await listHistory() });
    })();
    return true;
  }

  if (message?.action === 'HISTORY_CLEAR') {
    (async () => {
      await clearHistory();
      sendResponse({ ok: true });
    })();
    return true;
  }
```

- [ ] **Step 11: Verificar sintaxis**

Run: `node --check background.js`
Expected: sin salida

- [ ] **Step 12: Commit**

```bash
git add background.js
git commit -m "feat: registro persistente de resultados e historial de campanas"
```

---

### Task 7: `monitor.html` — markup del panel lateral

**Files:**
- Create: `ui/monitor.html`

- [ ] **Step 1: Crear `ui/monitor.html`**

El panel tiene ~340 px de ancho, así que no reutiliza `dashboard.css` (está pensado para el popup, mucho más ancho). Sí reutiliza `tokens.css` para que los colores sean los mismos.

```html
<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <title>Mailer Pro — Monitor</title>
  <link rel="stylesheet" href="tokens.css">
  <style>
    * { box-sizing: border-box; }

    body {
      margin: 0;
      padding: var(--spacing-md);
      background: var(--bg-primary);
      color: var(--text-main);
      font-family: var(--font-main);
      font-size: 0.85rem;
      display: flex;
      flex-direction: column;
      gap: var(--spacing-md);
      height: 100vh;
    }

    .monitor-header {
      display: flex;
      justify-content: space-between;
      align-items: center;
      padding-bottom: var(--spacing-sm);
      border-bottom: 1px solid var(--border-color);
    }

    .monitor-title { font-weight: 700; letter-spacing: 0.3px; }

    .monitor-counter {
      background: var(--bg-tertiary);
      border: 1px solid var(--border-color);
      color: var(--color-accent);
      padding: 2px 10px;
      border-radius: 999px;
      font-size: 0.75rem;
      font-weight: 700;
    }

    .progress-track {
      width: 100%;
      height: 8px;
      background: var(--bg-tertiary);
      border-radius: 999px;
      overflow: hidden;
    }

    .progress-fill {
      display: block;
      height: 100%;
      width: 0%;
      background: var(--color-accent);
      transition: width 0.3s ease;
    }

    .current-target {
      background: var(--bg-secondary);
      border: 1px solid var(--border-color);
      border-radius: var(--radius-md);
      padding: var(--spacing-sm) var(--spacing-md);
    }

    .current-label { color: var(--text-dim); font-size: 0.7rem; text-transform: uppercase; letter-spacing: 0.5px; }
    .current-email { font-weight: 600; word-break: break-all; margin-top: 2px; }

    .counters { display: flex; gap: var(--spacing-md); font-weight: 600; }
    .counter-ok { color: var(--color-accent); }
    .counter-error { color: #f87171; }

    .controls { display: flex; gap: var(--spacing-sm); }

    .btn {
      flex: 1;
      padding: 8px;
      border-radius: var(--radius-sm);
      border: 1px solid var(--border-color);
      background: var(--bg-tertiary);
      color: var(--text-main);
      font-family: inherit;
      font-size: 0.8rem;
      font-weight: 600;
      cursor: pointer;
    }

    .btn:hover { border-color: var(--border-active); }
    .btn-pause { color: #fbbf24; }
    .btn-resume { color: var(--color-accent); }
    .btn-cancel { color: #f87171; }

    .quota-banner {
      padding: var(--spacing-sm) var(--spacing-md);
      background: rgba(245, 158, 11, 0.12);
      border: 1px solid #f59e0b;
      border-radius: var(--radius-sm);
      line-height: 1.5;
    }

    .quota-banner button { width: 100%; margin-top: var(--spacing-sm); }

    .log {
      flex: 1;
      overflow-y: auto;
      border-top: 1px solid var(--border-color);
      padding-top: var(--spacing-sm);
      display: flex;
      flex-direction: column;
      gap: 2px;
    }

    .log-entry {
      display: flex;
      gap: var(--spacing-sm);
      padding: 5px 6px;
      border-radius: var(--radius-sm);
      font-size: 0.78rem;
      align-items: baseline;
    }

    .log-entry:nth-child(odd) { background: var(--bg-secondary); }
    .log-email { flex: 1; word-break: break-all; color: var(--text-muted); }
    .log-reason { color: #f87171; font-size: 0.72rem; }
    .log-time { color: var(--text-dim); font-size: 0.7rem; white-space: nowrap; }

    .empty-state { color: var(--text-dim); text-align: center; padding: var(--spacing-lg) 0; line-height: 1.6; }
  </style>
</head>
<body>
  <div class="monitor-header">
    <span class="monitor-title">🚀 MAILER PRO</span>
    <span class="monitor-counter" id="counter">0 / 0</span>
  </div>

  <div class="progress-track"><span class="progress-fill" id="progress-fill"></span></div>

  <div class="current-target">
    <div class="current-label">Enviando a</div>
    <div class="current-email" id="current-email">—</div>
  </div>

  <div class="counters">
    <span class="counter-ok" id="counter-ok">✅ 0</span>
    <span class="counter-error" id="counter-error">❌ 0</span>
  </div>

  <div class="quota-banner" id="quota-banner" style="display: none;">
    <span id="quota-text"></span>
    <button class="btn btn-resume" id="btn-relevo">Conectar otra cuenta y continuar</button>
  </div>

  <div class="controls" id="controls">
    <button class="btn btn-pause" id="btn-pausar">⏸ Pausar</button>
    <button class="btn btn-resume" id="btn-reanudar" style="display: none;">▶ Reanudar</button>
    <button class="btn btn-cancel" id="btn-cancelar">⏹ Cancelar</button>
  </div>

  <div class="log" id="log">
    <div class="empty-state" id="empty-state">
      Sin campaña en curso.<br>Inicia una desde el dashboard.
    </div>
  </div>

  <script type="module" src="monitor.js"></script>
</body>
</html>
```

- [ ] **Step 2: Verificar que estén todos los IDs que usará `monitor.js`**

Un `grep -c` no sirve acá: contaría también las clases CSS con nombres parecidos. Se comprueba id por id.

Run:
```bash
node -e "
const html=require('fs').readFileSync('ui/monitor.html','utf8');
const ids=['counter','progress-fill','current-email','counter-ok','counter-error','controls','btn-pausar','btn-reanudar','btn-cancelar','quota-banner','quota-text','btn-relevo','log','empty-state'];
const faltan=ids.filter(id=>!html.includes('id=\"'+id+'\"'));
if(faltan.length) throw new Error('faltan ids: '+faltan.join(', '));
console.log('ids OK:', ids.length);
"
```
Expected: `ids OK: 14`

- [ ] **Step 3: Commit**

```bash
git add ui/monitor.html
git commit -m "feat: markup del panel lateral de monitoreo"
```

---

### Task 8: `monitor.js` — lógica del panel

**Files:**
- Create: `ui/monitor.js`

- [ ] **Step 1: Crear `ui/monitor.js`**

```js
/**
 * Panel lateral de monitoreo.
 *
 * No decide nada: pinta lo que background emite y le devuelve las órdenes de
 * los botones. El estado real vive en el service worker, así que este panel se
 * puede cerrar y reabrir a mitad de campaña sin consecuencias.
 */

const counterEl = document.getElementById('counter');
const progressFill = document.getElementById('progress-fill');
const currentEmailEl = document.getElementById('current-email');
const counterOkEl = document.getElementById('counter-ok');
const counterErrorEl = document.getElementById('counter-error');
const controlsEl = document.getElementById('controls');
const btnPausar = document.getElementById('btn-pausar');
const btnReanudar = document.getElementById('btn-reanudar');
const btnCancelar = document.getElementById('btn-cancelar');
const quotaBanner = document.getElementById('quota-banner');
const quotaText = document.getElementById('quota-text');
const btnRelevo = document.getElementById('btn-relevo');
const logEl = document.getElementById('log');
const emptyState = document.getElementById('empty-state');

const LIVE_LOG_LIMIT = 50;

const STATUS_ICONS = { enviado: '✅', error: '❌', pendiente: '⏳' };

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

function setProgress(current, total) {
  const percent = total ? Math.min(100, Math.floor((current / total) * 100)) : 0;
  progressFill.style.width = `${percent}%`;
  counterEl.textContent = `${current} / ${total}`;
}

function setSummary(summary) {
  if (!summary) return;
  counterOkEl.textContent = `✅ ${summary.enviados}`;
  counterErrorEl.textContent = `❌ ${summary.errores}`;
}

/**
 * Arma el nodo de una entrada del log. Se construye con createElement y no con
 * innerHTML a propósito: el motivo del error viene de la respuesta de Gmail y
 * el correo viene del Excel del usuario, así que ninguno de los dos se
 * interpola como HTML.
 *
 * @param {{email: string, status: string, reason: string, timestamp: number}} result
 * @returns {HTMLElement}
 */
function createLogEntry(result) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const icon = document.createElement('span');
  icon.textContent = STATUS_ICONS[result.status] || '•';

  const email = document.createElement('span');
  email.className = 'log-email';
  email.textContent = result.email;

  entry.append(icon, email);

  if (result.status === 'error' && result.reason) {
    const reason = document.createElement('span');
    reason.className = 'log-reason';
    reason.textContent = result.reason.slice(0, 40);
    entry.appendChild(reason);
  } else {
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatTime(result.timestamp);
    entry.appendChild(time);
  }

  return entry;
}

/** Entrada nueva: va arriba de todo, porque el log va del más reciente al más viejo. */
function prependLogEntry(result) {
  if (!result) return;
  emptyState.style.display = 'none';
  logEl.insertBefore(createLogEntry(result), logEl.firstChild);

  // El detalle completo vive en el reporte: acá solo se muestran las últimas
  // entradas para que el panel no se vuelva pesado en campañas largas.
  while (logEl.querySelectorAll('.log-entry').length > LIVE_LOG_LIMIT) {
    logEl.removeChild(logEl.lastElementChild);
  }
}

/** Pintado inicial al abrir el panel a mitad de campaña. */
function renderLog(entries) {
  logEl.querySelectorAll('.log-entry').forEach((el) => el.remove());

  if (!entries || entries.length === 0) {
    emptyState.style.display = '';
    return;
  }

  emptyState.style.display = 'none';
  // `tailLog` las devuelve con la más reciente primero, que es el mismo orden
  // en que se muestran: se agregan al final una tras otra.
  entries.forEach((result) => logEl.appendChild(createLogEntry(result)));
}

function setControls(state) {
  if (state === 'running') {
    controlsEl.style.display = '';
    btnPausar.style.display = '';
    btnReanudar.style.display = 'none';
    btnCancelar.style.display = '';
  } else if (state === 'paused') {
    controlsEl.style.display = '';
    btnPausar.style.display = 'none';
    btnReanudar.style.display = '';
    btnCancelar.style.display = '';
  } else {
    controlsEl.style.display = 'none';
  }
}

function showQuotaBanner(account, detail) {
  quotaText.textContent = `La cuenta ${account || 'conectada'} alcanzó su límite diario. ${detail || ''}`.trim();
  quotaBanner.style.display = '';
}

function hideQuotaBanner() {
  quotaBanner.style.display = 'none';
}

// ─── Controles ───────────────────────────────────────────────────────────────
btnPausar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'pauseSend' }).catch(() => { });
  setControls('paused');
});

btnReanudar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'resumeSend' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.error) {
      currentEmailEl.textContent = response.error;
      setControls('idle');
      return;
    }
    hideQuotaBanner();
    setControls('running');
  });
});

btnCancelar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'cancelSend' }).catch(() => { });
  setControls('idle');
});

btnRelevo.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'GMAIL_CONNECT', selectAccount: true }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.connected) {
      chrome.runtime.sendMessage({ action: 'resumeSend' }).catch(() => { });
      hideQuotaBanner();
      setControls('running');
    }
  });
});

// ─── Broadcast de background ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'sendProgress') {
    setProgress(message.current, message.total);
    setSummary(message.summary);
    prependLogEntry(message.lastResult);
    if (message.lastResult) currentEmailEl.textContent = message.lastResult.email;
    setControls(message.isPaused ? 'paused' : 'running');
  }

  if (message?.action === 'sendComplete') {
    setProgress(message.current, message.total);
    setSummary(message.summary);
    currentEmailEl.textContent = message.isCancelled ? 'Campaña cancelada' : 'Campaña completada';
    setControls('idle');
  }

  if (message?.action === 'quotaExhausted') {
    setProgress(message.current, message.total);
    showQuotaBanner(message.account, message.detail);
    setControls('paused');
  }
});

// ─── Puesta al día al abrir ──────────────────────────────────────────────────
// El panel puede abrirse con la campaña ya empezada.
chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
  if (chrome.runtime.lastError || !response) return;

  setProgress(response.current || 0, response.total || 0);
  setSummary(response.summary);
  renderLog(response.log);

  if (response.sendInProgress) {
    setControls(response.isPaused ? 'paused' : 'running');
    const last = response.log && response.log[0];
    if (last) currentEmailEl.textContent = last.email;
    if (response.quotaExhausted) showQuotaBanner(response.pausedAccount, '');
  } else {
    setControls('idle');
    if (response.total > 0) currentEmailEl.textContent = 'Campaña finalizada';
  }
});
```

- [ ] **Step 2: Verificar sintaxis**

Run: `node --check ui/monitor.js`
Expected: sin salida

- [ ] **Step 3: Commit**

```bash
git add ui/monitor.js
git commit -m "feat: logica del panel lateral de monitoreo"
```

---

### Task 9: `dashboard.html` — modales de resumen e historial

**Files:**
- Modify: `ui/dashboard.html:24-26` (nav), y agregar dos modales antes del bloque de scripts (`ui/dashboard.html:247`)

- [ ] **Step 1: Agregar el ítem "Historial" al menú**

Insertar después del `<a>` de `nav-licencia` (después de la línea 26), dentro de `<nav class="nav-links">`:

```html
        <a href="#" class="nav-item" id="nav-historial">
          <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="icon"><path d="M3 3v5h5"/><path d="M3.05 13A9 9 0 1 0 6 5.3L3 8"/><path d="M12 7v5l4 2"/></svg> Historial
        </a>
```

- [ ] **Step 2: Agregar los dos modales**

Insertar justo antes del comentario `<!-- Scripts -->` (`ui/dashboard.html:247`):

```html
  <div id="modal-resumen" class="modal-overlay" style="display: none;">
    <div class="modal-content" style="max-width: 480px;">
      <div class="modal-header">
        <h2 id="resumen-titulo">Resumen de Campaña</h2>
        <button class="btn-close">×</button>
      </div>
      <div class="modal-body" style="text-align: center;">
        <div style="font-size: 2.5rem; margin-bottom: 10px;">📊</div>
        <div style="display: flex; justify-content: space-around; background: var(--bg-tertiary); padding: 15px; border-radius: var(--radius-md); margin-bottom: 20px;">
          <div>
            <div style="font-size: 1.6rem; font-weight: bold; color: var(--color-accent);" id="resumen-enviados">0</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Enviados</div>
          </div>
          <div>
            <div style="font-size: 1.6rem; font-weight: bold; color: #f87171;" id="resumen-errores">0</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Errores</div>
          </div>
          <div>
            <div style="font-size: 1.6rem; font-weight: bold; color: #fbbf24;" id="resumen-pendientes">0</div>
            <div style="font-size: 0.8rem; color: var(--text-muted);">Pendientes</div>
          </div>
        </div>
        <div style="display: flex; gap: 10px; margin-bottom: 12px;">
          <button class="btn btn-muted" id="btn-resumen-csv" style="flex: 1;">📄 Descargar CSV</button>
          <button class="btn btn-muted" id="btn-resumen-xlsx" style="flex: 1;">📊 Descargar Excel</button>
        </div>
        <button class="btn btn-accent btn-full" id="btn-cerrar-resumen">Cerrar</button>
      </div>
    </div>
  </div>

  <div id="modal-historial" class="modal-overlay" style="display: none;">
    <div class="modal-content" style="max-width: 560px;">
      <div class="modal-header">
        <h2>Historial de Campañas</h2>
        <button class="btn-close">×</button>
      </div>
      <div class="modal-body">
        <div style="display: flex; justify-content: flex-end; margin-bottom: 12px;">
          <button class="btn btn-danger-outline" id="btn-borrar-historial" style="padding: 5px 10px; font-size: 0.8rem;">Borrar todo el historial</button>
        </div>
        <div id="historial-lista"></div>
      </div>
    </div>
  </div>
```

- [ ] **Step 3: Verificar que existan los IDs nuevos**

Run: `grep -c "nav-historial\|modal-resumen\|modal-historial\|resumen-enviados\|resumen-errores\|resumen-pendientes\|btn-resumen-csv\|btn-resumen-xlsx\|btn-cerrar-resumen\|btn-borrar-historial\|historial-lista" ui/dashboard.html`
Expected: `11` o más

- [ ] **Step 4: Commit**

```bash
git add ui/dashboard.html
git commit -m "feat: modales de resumen e historial en el dashboard"
```

---

### Task 10: `dashboard.js` — abrir el panel, resumen, historial y descargas

**Files:**
- Modify: `ui/dashboard.js` — imports, refs, `startSend`, listener de `sendComplete`, y bloque nuevo de reporte

- [ ] **Step 1: Agregar los imports al inicio del archivo**

`ui/dashboard.js` se carga con `type="module"` (`ui/dashboard.html:250`), así que admite imports. Agregar como primeras líneas del archivo, antes del comentario `// ─── DOM refs ───`:

```js
import { buildReportRows, toCSV, buildFileName } from './reportBuilder.js';
```

`XLSX` y `DataProcessor` siguen siendo globales cargados por `<script>` antes del módulo; no se importan.

- [ ] **Step 2: Agregar las refs nuevas**

Después del bloque de refs de Licencia (`ui/dashboard.js:60-65`):

```js
// Reporte e historial
const navHistorial      = document.getElementById('nav-historial');
const modalHistorial    = document.getElementById('modal-historial');
const historialLista    = document.getElementById('historial-lista');
const btnBorrarHistorial = document.getElementById('btn-borrar-historial');
const modalResumen      = document.getElementById('modal-resumen');
const resumenEnviados   = document.getElementById('resumen-enviados');
const resumenErrores    = document.getElementById('resumen-errores');
const resumenPendientes = document.getElementById('resumen-pendientes');
const btnResumenCSV     = document.getElementById('btn-resumen-csv');
const btnResumenXLSX    = document.getElementById('btn-resumen-xlsx');
const btnCerrarResumen  = document.getElementById('btn-cerrar-resumen');
```

- [ ] **Step 3: Agregar el estado nuevo**

Después de `let hasPromptedForGmail = false;` (`ui/dashboard.js:78`):

```js
let lastCampaign = null;
// Se resuelve al cargar porque chrome.sidePanel.open() exige un gesto del
// usuario: si se pidiera la ventana dentro del click, el await perdería el
// gesto y Chrome rechazaría la apertura.
let currentWindowId = null;
chrome.windows.getCurrent().then((win) => { currentWindowId = win.id; }).catch(() => { });
```

- [ ] **Step 4: Abrir el panel al iniciar la campaña**

En `startSend()`, insertar justo antes de `setProgress(0, recipients.length, '🚀 Iniciando campaña...', []);` (`ui/dashboard.js:606`):

```js
  openMonitorPanel();
```

Y agregar la función justo antes de `function startSend()` (`ui/dashboard.js:564`):

```js
/**
 * Abre el panel lateral de monitoreo. Se llama dentro del click de "Iniciar
 * Campaña" porque Chrome solo permite abrirlo en respuesta a un gesto del
 * usuario. Si el navegador es anterior a Chrome 114 no existe la API: la
 * campaña sale igual, solo que sin panel.
 */
function openMonitorPanel() {
  if (!chrome.sidePanel?.open || currentWindowId === null) {
    console.info('[monitor] este Chrome no soporta el panel lateral; la campaña sigue normalmente.');
    return;
  }
  chrome.sidePanel.open({ windowId: currentWindowId })
    .catch((err) => console.warn('[monitor] no se pudo abrir el panel:', err?.message || err));
}
```

- [ ] **Step 5: Abrir el resumen al terminar**

En el listener de `sendComplete` (`ui/dashboard.js:912-920`), agregar el guardado de la campaña y la apertura del modal. Reemplazar ese bloque por:

```js
  if (message?.action === 'sendComplete') {
    setProgress(message.current, message.total, message.status, message.failedEmails || []);
    setUIState('finished');

    if (message.campaign) {
      lastCampaign = message.campaign;
      showSummary(message.summary);
    }

    const success = !message.isCancelled && (!message.failedEmails || message.failedEmails.length === 0);
    if (success && message.total > 0) {
      launchConfetti();
    }
  }
```

- [ ] **Step 6: Agregar el bloque de reporte e historial**

Insertar antes del comentario `// ─── Background message listener ───` (`ui/dashboard.js:903`):

```js
// ─── Reporte e historial ─────────────────────────────────────────────────────

/**
 * Descarga un Blob. En una página de extensión alcanza con un <a download>
 * sintético; el object URL se revoca enseguida para no retener memoria.
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCSV(campaign) {
  const report = buildReportRows(campaign);
  if (report.headers.length === 0) {
    alert('Esa campaña no tiene resultados para exportar.');
    return;
  }
  const blob = new Blob([toCSV(report)], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, buildFileName(campaign, 'csv'));
}

/**
 * .xlsx nativo con el SheetJS que ya viene incluido para importar. El
 * aplicativo hermano de SMS genera una tabla HTML con extensión .xls y por eso
 * Excel avisa que el formato no coincide con la extensión cada vez que se
 * abre; acá el archivo es legítimo.
 */
function downloadXLSX(campaign) {
  const report = buildReportRows(campaign);
  if (report.headers.length === 0) {
    alert('Esa campaña no tiene resultados para exportar.');
    return;
  }
  const worksheet = XLSX.utils.aoa_to_sheet([report.headers, ...report.rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, buildFileName(campaign, 'xlsx'));
}

function showSummary(summary) {
  resumenEnviados.textContent   = summary?.enviados ?? 0;
  resumenErrores.textContent    = summary?.errores ?? 0;
  resumenPendientes.textContent = summary?.pendientes ?? 0;
  openModal(modalResumen);
}

function renderHistory(history) {
  historialLista.innerHTML = '';

  if (!history || history.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'text-align: center; color: var(--text-muted); padding: 20px 0;';
    empty.textContent = 'Todavía no hay campañas guardadas.';
    historialLista.appendChild(empty);
    btnBorrarHistorial.style.display = 'none';
    return;
  }

  btnBorrarHistorial.style.display = '';

  history.forEach((campaign) => {
    const enviados = (campaign.results || []).filter((r) => r.status === 'enviado').length;
    const errores  = (campaign.results || []).filter((r) => r.status === 'error').length;

    const item = document.createElement('div');
    item.style.cssText = 'padding: 12px; margin-bottom: 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-md);';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 10px;';

    const info = document.createElement('div');
    const date = document.createElement('div');
    date.style.cssText = 'font-weight: 600; color: var(--text-main);';
    date.textContent = new Date(campaign.date).toLocaleString('es-EC');
    const detail = document.createElement('div');
    detail.style.cssText = 'font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;';
    detail.textContent = `${campaign.total} destinatarios · ✅ ${enviados} · ❌ ${errores} · ${campaign.status}`;
    info.append(date, detail);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 6px;';

    const btnCsv = document.createElement('button');
    btnCsv.className = 'btn btn-muted';
    btnCsv.style.cssText = 'padding: 5px 10px; font-size: 0.75rem;';
    btnCsv.textContent = '📄 CSV';
    btnCsv.addEventListener('click', () => downloadCSV(campaign));

    const btnXlsx = document.createElement('button');
    btnXlsx.className = 'btn btn-muted';
    btnXlsx.style.cssText = 'padding: 5px 10px; font-size: 0.75rem;';
    btnXlsx.textContent = '📊 Excel';
    btnXlsx.addEventListener('click', () => downloadXLSX(campaign));

    actions.append(btnCsv, btnXlsx);
    header.append(info, actions);
    item.appendChild(header);
    historialLista.appendChild(item);
  });
}

function openHistory() {
  chrome.runtime.sendMessage({ action: 'HISTORY_LIST' }, (response) => {
    if (chrome.runtime.lastError) return;
    renderHistory(response?.history || []);
    openModal(modalHistorial);
  });
}

navHistorial.addEventListener('click', (e) => { e.preventDefault(); openHistory(); });

btnBorrarHistorial.addEventListener('click', () => {
  if (!confirm('¿Borrar todo el historial de campañas? No se puede deshacer.')) return;
  chrome.runtime.sendMessage({ action: 'HISTORY_CLEAR' }, () => {
    if (chrome.runtime.lastError) return;
    renderHistory([]);
  });
});

btnCerrarResumen.addEventListener('click', () => closeModal(modalResumen));
btnResumenCSV.addEventListener('click', () => { if (lastCampaign) downloadCSV(lastCampaign); });
btnResumenXLSX.addEventListener('click', () => { if (lastCampaign) downloadXLSX(lastCampaign); });
```

- [ ] **Step 7: Verificar sintaxis y que no queden referencias sueltas**

Run: `node --check ui/dashboard.js`
Expected: sin salida

Run: `grep -c "downloadCSV\|downloadXLSX\|openMonitorPanel\|renderHistory" ui/dashboard.js`
Expected: `10` o más

- [ ] **Step 8: Commit**

```bash
git add ui/dashboard.js
git commit -m "feat: panel al iniciar, resumen de campana e historial descargable"
```

---

### Task 11: Verificación final

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Sintaxis de todos los módulos**

Run: `node --check background.js && node --check ui/dashboard.js && node --check ui/monitor.js && node --check ui/campaignLog.js && node --check ui/reportBuilder.js && node --check ui/recipientFields.js && node --check ui/historyStore.js && node --check ui/gmailAuth.js && node --check ui/mimeBuilder.js && node --check ui/gmailErrors.js`
Expected: sin salida

- [ ] **Step 2: Toda la batería de tests**

Run: `node --test`
Expected: PASS — 55 tests, 0 fallos (27 previos + 6 de recipientFields + 11 de campaignLog + 11 de reportBuilder)

(Sin argumento: en Node 22 sobre Windows, pasarle el directorio — `node --test tests/` — intenta cargarlo como módulo y falla con `MODULE_NOT_FOUND`. La autodetección sí encuentra `tests/*.test.js`.)

- [ ] **Step 3: Rutas del manifest existentes**

Run: `node -e "const m=JSON.parse(require('fs').readFileSync('manifest.json','utf8'));const fs=require('fs');[m.background.service_worker,m.action.default_popup,m.side_panel.default_path,...Object.values(m.icons)].forEach(p=>{if(!fs.existsSync(p))throw new Error('falta '+p)});console.log('rutas OK')"`
Expected: `rutas OK`

- [ ] **Step 4: Generar un .xlsx de prueba con la librería incluida**

Confirma que la build de SheetJS del proyecto sirve para escribir, que es de lo que depende la descarga en Excel.

Run:
```bash
node -e "
const fs=require('fs'),vm=require('vm');
const ctx={console,Date,Math,JSON,Array,Object,String,Number,Uint8Array,ArrayBuffer,TextEncoder,TextDecoder,Error,RegExp,parseInt,parseFloat,isNaN,Buffer};
ctx.window=ctx; ctx.self=ctx; ctx.globalThis=ctx;
vm.createContext(ctx);
vm.runInContext(fs.readFileSync('ui/lib/xlsx.js','utf8'),ctx);
const wb=ctx.XLSX.utils.book_new();
ctx.XLSX.utils.book_append_sheet(wb,ctx.XLSX.utils.aoa_to_sheet([['Correo','Estado'],['a@b.com','Enviado']]),'Reporte');
console.log('xlsx OK, bytes:', ctx.XLSX.write(wb,{bookType:'xlsx',type:'array'}).byteLength);
"
```
Expected: `xlsx OK, bytes: <un número mayor que 0>`

- [ ] **Step 5: Checklist manual en el navegador**

No se puede automatizar desde este entorno. Cargar la extensión desempaquetada en `chrome://extensions` y verificar:

1. Importar un Excel con 3 correos propios e iniciar la campaña → **el panel lateral se abre solo** a la derecha.
2. El panel muestra el correo en curso, el contador `N / total`, la barra y las líneas del log con ✅.
3. Cambiar de pestaña → el panel sigue visible y actualizándose.
4. Pausar desde el panel → el envío se detiene; abrir el popup del dashboard y confirmar que también muestra "Pausado".
5. Reanudar desde el panel → el envío continúa en el destinatario correcto.
6. Cerrar el panel y volver a abrirlo desde el ícono lateral de Chrome a mitad de campaña → se pone al día con el progreso y el log.
7. Al terminar → se abre el modal Resumen con los totales correctos.
8. "Descargar CSV" → el archivo abre en Excel **con los acentos correctos**.
9. "Descargar Excel" → el `.xlsx` abre **sin la advertencia de formato**, con las columnas del Excel original.
10. Menú "Historial" → aparece la campaña; descargar desde ahí funciona igual.
11. Cerrar Chrome, reabrirlo, entrar al Historial → la campaña sigue guardada.
12. Cancelar una campaña a mitad → queda en el historial como `Cancelada` y los no enviados aparecen como `Pendiente` en el reporte.

- [ ] **Step 6: Commit final**

```bash
git add -A
git commit -m "chore: verificacion del monitor lateral y el reporte"
```
