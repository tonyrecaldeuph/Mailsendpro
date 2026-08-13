/**
 * Clasifica una respuesta de error de la Gmail API para decidir qué hacer:
 * renovar token, esperar y reintentar, fallar solo esa fila, o pausar la
 * campaña porque la cuenta agotó su cuota diaria.
 * Módulo puro (sin chrome.*, sin red) para poder testearlo.
 */

function safeParse(body) {
  try {
    return JSON.parse(body);
  } catch (err) {
    return null;
  }
}

/**
 * @param {number} status  Código HTTP de la respuesta
 * @param {string} body    Cuerpo crudo de la respuesta
 * @returns {{kind: 'auth'|'quota'|'rate'|'recipient', message: string}}
 */
export function classifyGmailError(status, body) {
  const parsed = safeParse(body);
  const reason = parsed?.error?.errors?.[0]?.reason || '';
  const message = parsed?.error?.message || `Status: ${status}`;

  if (status === 401) {
    return { kind: 'auth', message };
  }

  if (/insufficient|authentication scopes|unauthorized_client/i.test(message)) {
    return { kind: 'auth', message };
  }

  if (/rateLimitExceeded|userRateLimitExceeded|backendError/i.test(reason)) {
    return { kind: 'rate', message };
  }

  if (/quotaExceeded|dailyLimitExceeded/i.test(reason) || /daily limit|sending limit|quota/i.test(message)) {
    return { kind: 'quota', message };
  }

  // Un 403/429 sin motivo reconocible casi siempre es cuota. Pausar es más
  // seguro que seguir y marcar como fallidos a todos los destinatarios que faltan.
  if (status === 403 || status === 429) {
    return { kind: 'quota', message };
  }

  return { kind: 'recipient', message };
}
