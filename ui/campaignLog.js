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