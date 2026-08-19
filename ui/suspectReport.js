/**
 * Reporte de direcciones dudosas.
 *
 * Lista a TODOS los clientes de la lista cargada, con las direcciones
 * problemáticas resaltadas en rojo y un diagnóstico por caso, para revisar la
 * planilla completa y corregirla en el origen.
 *
 * Sale como tabla HTML con extensión .xls y no como .xlsx nativo —al revés que
 * el reporte de campaña— por una razón concreta: la build libre de SheetJS no
 * escribe estilos de celda, así que un .xlsx real saldría sin un solo color. Y
 * acá el color es el pedido, no un adorno. El costo es que Excel avisa que la
 * extensión no coincide con el formato al abrirlo.
 *
 * Módulo puro: sin DOM, sin red.
 */

import { resolveEmailKey } from './recipientFields.js';
import { PROBLEM_LABELS } from './emailAudit.js';

/**
 * Un color distinto por caso, para distinguirlos de un vistazo. La etiqueta es
 * la que se imprime en la leyenda del reporte: el color solo no alcanza si
 * alguien imprime en blanco y negro.
 */
export const PROBLEM_STYLES = {
  relleno:       { color: '#b91c1c', fondo: '#fee2e2', etiqueta: 'Correo de relleno' },
  typo:          { color: '#dc2626', fondo: '#ffe4e6', etiqueta: 'Dominio mal escrito' },
  inexistente:   { color: '#ea580c', fondo: '#ffedd5', etiqueta: 'El dominio no existe' },
  'sin-correo':  { color: '#d97706', fondo: '#fef3c7', etiqueta: 'El dominio no recibe correo' }
};

function diagnosticoDe(finding) {
  if (!finding) return '';
  if (finding.suggestion) return `Dominio mal escrito (¿${finding.suggestion}?)`;
  return PROBLEM_LABELS[finding.problem] || 'Dirección dudosa';
}

/**
 * @param {Array<Object>} recipients Contactos tal como se cargaron del Excel
 * @param {Array<{email: string, problem: string, suggestion: string|null}>} findings
 * @returns {{headers: string[], rows: Array<{cells: string[], problem: string|null}>}}
 */
export function buildSuspectRows(recipients, findings) {
  const list = recipients || [];
  if (list.length === 0) return { headers: [], rows: [] };

  const porEmail = new Map((findings || []).map((f) => [f.email, f]));

  // Las columnas del usuario se conservan enteras: el reporte sirve para
  // corregir la planilla, y sin el nombre o el monto no se sabe a quién
  // corresponde cada dirección.
  const extraKeys = [];
  list.forEach((contact) => {
    const emailKey = resolveEmailKey(contact);
    Object.keys(contact).forEach((key) => {
      if (key !== emailKey && !extraKeys.includes(key)) extraKeys.push(key);
    });
  });

  const headers = ['Correo', 'Diagnóstico', ...extraKeys];

  const rows = list.map((contact) => {
    const emailKey = resolveEmailKey(contact);
    const email = emailKey ? String(contact[emailKey] || '').trim() : '';
    const finding = porEmail.get(email) || null;

    return {
      problem: finding ? finding.problem : null,
      cells: [
        email,
        diagnosticoDe(finding),
        ...extraKeys.map((key) => (contact[key] == null ? '' : String(contact[key])))
      ]
    };
  });

  return { headers, rows };
}

function escapeHtml(value) {
  return String(value == null ? '' : value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function leyenda() {
  const items = Object.values(PROBLEM_STYLES)
    .map((estilo) => `<span style="color:${estilo.color};font-weight:bold;">&#9632; ${escapeHtml(estilo.etiqueta)}</span>`)
    .join('&nbsp;&nbsp;&nbsp;');
  return `<p style="font-family:Calibri,Arial,sans-serif;font-size:12px;">${items}</p>`;
}

/**
 * @param {{headers: string[], rows: Array<{cells: string[], problem: string|null}>}} report
 * @returns {string} Documento que Excel abre con los colores puestos.
 */
export function toStyledHtmlTable({ headers, rows }) {
  const th = headers
    .map((h) => `<th style="background-color:#1e293b;color:#ffffff;font-weight:bold;padding:6px 10px;text-align:left;border:1px solid #475569;">${escapeHtml(h)}</th>`)
    .join('');

  const tr = rows.map((row) => {
    const estilo = row.problem ? PROBLEM_STYLES[row.problem] : null;
    const celdas = row.cells.map((cell, index) => {
      // El color va en la dirección y en su diagnóstico, que es lo que se
      // busca al recorrer la planilla; el resto de los datos queda legible.
      const resaltar = estilo && index <= 1;
      const css = resaltar
        ? `color:${estilo.color};background-color:${estilo.fondo};font-weight:bold;`
        : 'color:#1e293b;background-color:#ffffff;';
      return `<td style="${css}padding:5px 9px;border:1px solid #cbd5e1;">${escapeHtml(cell)}</td>`;
    }).join('');
    return `<tr>${celdas}</tr>`;
  }).join('');

  return [
    '<html xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">',
    '<head><meta charset="utf-8">',
    '<!--[if gte mso 9]><xml><x:ExcelWorkbook><x:ExcelWorksheets><x:ExcelWorksheet>',
    '<x:Name>Dudosos</x:Name><x:WorksheetOptions><x:DisplayGridlines/></x:WorksheetOptions>',
    '</x:ExcelWorksheet></x:ExcelWorksheets></x:ExcelWorkbook></xml><![endif]-->',
    '</head><body style="background-color:#ffffff;">',
    leyenda(),
    '<table border="1" style="border-collapse:collapse;font-family:Calibri,Arial,sans-serif;font-size:12px;">',
    `<thead><tr>${th}</tr></thead><tbody>${tr}</tbody>`,
    '</table></body></html>'
  ].join('');
}

/** @returns {string} Nombre con la fecha local, igual que el resto de los reportes. */
export function buildSuspectFileName(date = new Date()) {
  const pad = (value) => String(value).padStart(2, '0');
  return `dudosos_${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}.xls`;
}
