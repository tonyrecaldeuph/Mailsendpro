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
  pendiente: 'Pendiente',
  omitido: 'Omitido'
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
  return `\uFEFF${lines.join('\r\n')}`;
}

/**
 * La fecha se arma con las partes locales y no con toISOString(): en zonas
 * detrás de UTC, una campaña de la noche ya cayó en el día siguiente en UTC, y
 * el archivo salía fechado un día después que la fila del historial que está
 * al lado del botón de descarga.
 *
 * @param {'csv'|'xlsx'} extension
 */
export function buildFileName(campaign, extension) {
  const date = new Date(campaign?.date || Date.now());
  const pad = (value) => String(value).padStart(2, '0');
  const stamp = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
  return `campana_${stamp}.${extension}`;
}