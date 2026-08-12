/**
 * Cliente HTTP + cacheo para el backend de licencias (licensing-server),
 * compartido con la extensión hermana de SMS. Vive en el service worker
 * (background.js lo importa como módulo ES). No decide si se puede enviar
 * una campaña — eso lo hace licenseGate.js (computeGateDecision) a partir
 * de lo que este módulo cachea.
 */

import { computeGateDecision } from './licenseGate.js';

const LICENSE_API_BASE = 'https://licencias.anomalydevs.qzz.io/api/v1';
export const LICENSE_KEY_STORAGE = 'licenseKey';
export const LICENSE_DEVICE_ID_STORAGE = 'licenseDeviceId';
export const LICENSE_STATE_STORAGE = 'licenseState';

export async function getOrCreateDeviceId() {
    const { [LICENSE_DEVICE_ID_STORAGE]: existing } = await chrome.storage.local.get([LICENSE_DEVICE_ID_STORAGE]);
    if (existing) return existing;
    const deviceId = crypto.randomUUID();
    await chrome.storage.local.set({ [LICENSE_DEVICE_ID_STORAGE]: deviceId });
    return deviceId;
}

/**
 * Label descriptivo del dispositivo, solo para identificación humana en el
 * panel admin (no hay fingerprint de hardware real disponible en MV3).
 */
export function getDeviceLabel() {
    const ua = (typeof navigator !== 'undefined' && navigator.userAgent) || '';
    const chromeMatch = ua.match(/Chrome\/([\d.]+)/);
    const platform = ua.includes('Windows') ? 'Windows'
        : ua.includes('Mac') ? 'macOS'
        : ua.includes('Linux') ? 'Linux'
        : 'Desconocido';
    return `${platform} · Chrome ${chromeMatch ? chromeMatch[1] : '?'} · MailerPro`;
}

async function callLicenseApi(path, body) {
    const response = await fetch(`${LICENSE_API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body)
    });
    const data = await response.json().catch(() => ({}));
    return { httpStatus: response.status, data };
}

function toCachedState(data, lastValidatedAt) {
    return {
        status: data.status,
        companyName: data.company_name || null,
        endDate: data.end_date || null,
        daysRemaining: typeof data.days_remaining === 'number' ? data.days_remaining : null,
        lastValidatedAt
    };
}

function errorState(status) {
    return { status, companyName: null, endDate: null, daysRemaining: null, lastValidatedAt: null };
}

/**
 * Activa (o re-confirma) este dispositivo contra una license_key.
 * Persiste licenseKey + licenseState en chrome.storage.local.
 */
export async function activateLicense(licenseKey) {
    const deviceId = await getOrCreateDeviceId();
    const deviceLabel = getDeviceLabel();
    try {
        const { httpStatus, data } = await callLicenseApi('/activate', {
            license_key: licenseKey,
            device_id: deviceId,
            device_label: deviceLabel
        });

        if (httpStatus === 200) {
            const state = toCachedState(data, Date.now());
            await chrome.storage.local.set({ [LICENSE_KEY_STORAGE]: licenseKey, [LICENSE_STATE_STORAGE]: state });
            return state;
        }
        if (httpStatus === 404) {
            return errorState('not_found');
        }
        if (httpStatus === 409) {
            return errorState('device_limit_reached');
        }
        // Cualquier otro status inesperado: no persistir, para no pisar una
        // licencia previamente válida por un error transitorio del backend.
        return errorState('network_error');
    } catch (err) {
        console.warn('[license] activate falló (red/backend):', err?.message || err);
        return errorState('network_error');
    }
}

/**
 * Revalida el dispositivo ya activado. Si falla la red, conserva el último
 * estado cacheado tal cual (no toca lastValidatedAt) para que la gracia
 * offline de 48h siga contando desde la última validación exitosa real.
 */
export async function validateLicense() {
    const { [LICENSE_KEY_STORAGE]: licenseKey, [LICENSE_STATE_STORAGE]: cachedState } =
        await chrome.storage.local.get([LICENSE_KEY_STORAGE, LICENSE_STATE_STORAGE]);
    if (!licenseKey) return null;

    const deviceId = await getOrCreateDeviceId();
    try {
        const { httpStatus, data } = await callLicenseApi('/validate', { license_key: licenseKey, device_id: deviceId });
        if (httpStatus === 200) {
            const state = toCachedState(data, Date.now());
            await chrome.storage.local.set({ [LICENSE_STATE_STORAGE]: state });
            return state;
        }
        if (httpStatus === 404) {
            const state = errorState('not_found');
            await chrome.storage.local.set({ [LICENSE_STATE_STORAGE]: state });
            return state;
        }
        console.warn(`[license] validate devolvió status inesperado ${httpStatus}, se conserva el último estado cacheado`);
        return cachedState || null;
    } catch (err) {
        console.warn('[license] validate falló (red/backend), se conserva el último estado cacheado:', err?.message || err);
        return cachedState || null;
    }
}

export async function getCachedLicenseState() {
    const { [LICENSE_STATE_STORAGE]: state } = await chrome.storage.local.get([LICENSE_STATE_STORAGE]);
    return state || null;
}

/**
 * Decisión de gate lista para usar (combina el estado cacheado con
 * computeGateDecision).
 */
export async function getLicenseGate() {
    const state = await getCachedLicenseState();
    return computeGateDecision(state, Date.now());
}
