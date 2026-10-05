/**
 * Lógica pura de vigencia de licencia (sin dependencias de chrome.* ni red).
 * Recibe el último estado cacheado por background.js y decide si se puede
 * iniciar una campaña ahora mismo, incluyendo la gracia offline de 48h.
 * Mismo diseño que el de la extensión hermana de SMS (licencias.anomalydevs.qzz.io).
 */

export const GRACE_MS = 48 * 60 * 60 * 1000; // 48h de gracia si el backend no responde

/**
 * @param {Object|null} cachedState - Último estado guardado en chrome.storage.local
 *   bajo la key 'licenseState': { status, companyName, endDate, daysRemaining, lastValidatedAt }
 * @param {number} nowMs - Date.now(), inyectado para poder testear determinísticamente.
 * @returns {{allowed: boolean, reason: string|null}}
 */
export function computeGateDecision(cachedState, nowMs) {
    if (!cachedState) {
        return { allowed: false, reason: 'no_license' };
    }

    if (cachedState.status !== 'active') {
        // Cubre: not_found, pending, expired, suspended, device_not_registered,
        // device_limit_reached, network_error — el backend o activateLicense()
        // ya resolvió cuál de estos aplica; acá solo se respeta esa decisión.
        return { allowed: false, reason: cachedState.status || 'unknown' };
    }

    if (!cachedState.lastValidatedAt) {
        return { allowed: false, reason: 'invalid_state' };
    }

    const elapsed = nowMs - cachedState.lastValidatedAt;
    if (elapsed <= GRACE_MS) {
        return { allowed: true, reason: null };
    }

    return { allowed: false, reason: 'offline_grace_expired' };
}

/**
 * Conectar Gmail exige licencia vigente. El motivo es el cupo de la app OAuth
 * sin verificar: Google cuenta cada consentimiento de por vida (100 en total,
 * sin reseteo), así que alguien que descarga el zip sin licencia no debe poder
 * gastar uno solo por probar el botón.
 *
 * @returns {{allowed: boolean, message: string}} message vacío si se permite.
 */
export function computeGmailConnectGate(cachedState, nowMs) {
    const { allowed } = computeGateDecision(cachedState, nowMs);
    if (allowed) return { allowed: true, message: '' };
    return {
        allowed: false,
        message: 'Primero activá tu licencia en "Licencia"; después vas a poder conectar tu cuenta de Gmail.'
    };
}

/**
 * Aviso de renovación: la licencia vence en 30 días o menos.
 * @param {number|null} daysRemaining
 */
export function isRenewalWarning(daysRemaining) {
    return typeof daysRemaining === 'number' && daysRemaining >= 0 && daysRemaining <= 30;
}
