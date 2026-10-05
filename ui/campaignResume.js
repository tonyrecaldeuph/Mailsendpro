/**
 * Lógica pura para retomar una campaña interrumpida.
 *
 * No toca chrome.* ni DOM: decide qué destinatarios faltan cuando el usuario
 * vuelve a subir el Excel después de una caída de conexión / reinicio del
 * service worker. Se usa tanto en background (para filtrar) como en dashboard
 * (para mostrar "quedan X por enviar").
 */

import { resolveEmail } from './recipientFields.js';
import { RESULT_STATUS } from './campaignLog.js';

/**
 * Devuelve los destinatarios del Excel que todavía no fueron procesados.
 *
 * Un destinatario se considera procesado si su correo ya aparece en
 * `campaign.results` con estado enviado / error / omitido (case-insensitive).
 * Los pendientes no cuentan: son los que justamente faltan.
 *
 * @param {Array<Object>} uploadedRecipients - lo que el usuario acaba de subir
 * @param {Object|null} campaign - campaña en curso / interrumpida (con .results)
 * @returns {Array<Object>} solo los que faltan, en el orden del Excel subido
 */
export function filterRemainingRecipients(uploadedRecipients, campaign) {
  if (!Array.isArray(uploadedRecipients) || uploadedRecipients.length === 0) return [];
  if (!campaign || !Array.isArray(campaign.results) || campaign.results.length === 0) {
    return [...uploadedRecipients];
  }

  const processed = new Set(
    campaign.results
      .filter((r) => r.status === RESULT_STATUS.SENT || r.status === RESULT_STATUS.ERROR || r.status === RESULT_STATUS.OMITTED)
      .map((r) => String(r.email || '').trim().toLowerCase())
      .filter(Boolean)
  );

  if (processed.size === 0) return [...uploadedRecipients];

  return uploadedRecipients.filter((item) => {
    const email = resolveEmail(item);
    if (!email) return true; // sin correo no se puede deducir, se deja pasar
    return !processed.has(String(email).trim().toLowerCase());
  });
}

