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