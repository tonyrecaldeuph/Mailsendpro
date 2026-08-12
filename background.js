import { computeGateDecision } from './ui/licenseGate.js';
import { activateLicense, validateLicense, getCachedLicenseState, getOrCreateDeviceId, LICENSE_KEY_STORAGE } from './ui/licenseClient.js';

const LICENSE_VALIDATION_ALARM = 'licenseValidationAlarm';
const LICENSE_VALIDATION_PERIOD_MIN = 360; // 6h

let sendInProgress = false;
let isPaused = false;
let isCancelled = false;
let currentProgress = { current: 0, total: 0, status: 'Listo', failedEmails: [] };

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// Mismos alias que ui/dataProcessor.js: el contacto conserva el nombre de
// columna original del Excel (ej. "CORREO CLIENTE"), así que el envío debe
// resolver dinámicamente cuál campo es el email en vez de asumir `.email`.
const EMAIL_COLUMN_ALIASES = ['correo cliente', 'email', 'correo', 'correo electronico', 'e-mail'];

function normalizeHeader(header) {
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

function resolveEmail(recipient) {
  const key = Object.keys(recipient || {}).find((k) => EMAIL_COLUMN_ALIASES.includes(normalizeHeader(k)));
  return key ? String(recipient[key] || '').trim() : '';
}

// ────────────────────────────────────────────────────────────
// Licencia: alarma de revalidación periódica (6h) + validación inmediata
// ────────────────────────────────────────────────────────────
function setupLicenseValidationAlarm() {
  chrome.alarms.create(LICENSE_VALIDATION_ALARM, { periodInMinutes: LICENSE_VALIDATION_PERIOD_MIN });
  validateLicense().catch((err) => console.warn('[license] validación inicial falló:', err?.message || err));
}

chrome.runtime.onInstalled.addListener(() => {
  setupLicenseValidationAlarm();
});

chrome.runtime.onStartup.addListener(() => {
  setupLicenseValidationAlarm();
});

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === LICENSE_VALIDATION_ALARM) {
    validateLicense().catch((err) => console.warn('[license] revalidación periódica falló:', err?.message || err));
  }
});

// ────────────────────────────────────────────────────────────
// Envío de campaña
// ────────────────────────────────────────────────────────────
async function sendEmails(payload) {
  if (sendInProgress) {
    return { error: 'Ya hay un envío en progreso.' };
  }

  sendInProgress = true;
  isPaused = false;
  isCancelled = false;
  currentProgress.failedEmails = [];

  const { apiKey, apiToken, fromEmail, recipients, subject, message, attachments, delaySeconds } = payload;
  let successCount = 0;
  let errorCount = 0;

  // Adapt attachment format for Google Script: 1 imagen (se embebe inline)
  // + hasta 3 PDFs (se adjuntan como archivo real, Code.gs decide cuál es cuál por tipo).
  const mappedAttachments = (attachments || []).map((att) => {
    const [, b64] = att.dataUrl.split(',');
    return { filename: att.name, content: b64, type: att.type };
  });

  // El backend valida la licencia contra licencias.anomalydevs.qzz.io antes
  // de enviar (en vez de un SHARED_TOKEN manual por instalación) — mismo
  // license_key/device_id que ya usa el gate local de la extensión.
  const { [LICENSE_KEY_STORAGE]: licenseKey } = await chrome.storage.local.get([LICENSE_KEY_STORAGE]);
  const deviceId = await getOrCreateDeviceId();

  for (let index = 0; index < recipients.length; index += 1) {
    if (isCancelled) {
      break;
    }

    while (isPaused) {
      if (isCancelled) break;
      await sleep(500);
    }

    if (isCancelled) {
      break;
    }

    const recipient = recipients[index];
    const recipientEmail = resolveEmail(recipient);
    const personalized = personalizeMessage(message, recipient);

    const apiPayload = {
      token: apiToken || "",
      fromName: fromEmail || "",
      to: recipientEmail,
      subject: personalizeMessage(subject || 'Mensaje de extensión', recipient),
      html: personalized,
      attachments: mappedAttachments,
      licenseKey: licenseKey || "",
      deviceId: deviceId || ""
    };

    try {
      const response = await fetch(apiKey, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(apiPayload)
      });

      if (!response.ok) {
        throw new Error(`Status: ${response.status}`);
      }

      const rawResponse = await response.text();
      let resJson = {};
      try { resJson = JSON.parse(rawResponse); } catch (e) { }

      if (resJson.error) {
        throw new Error(resJson.error);
      }

      successCount += 1;
      broadcastProgress(index + 1, recipients.length, `Enviado a ${recipientEmail} (${successCount} OK, ${errorCount} errores)`, index, true);
    } catch (err) {
      errorCount += 1;
      currentProgress.failedEmails.push({ email: recipientEmail, error: err.message });
      broadcastProgress(index + 1, recipients.length, `Error en ${recipientEmail}: ${err.message}`, index, false);
    }

    if (index < recipients.length - 1) {
      // Delay, but allow interruption if paused or cancelled
      const delayMs = (delaySeconds || 10) * 1000;
      const steps = delayMs / 500;
      for (let s = 0; s < steps; s++) {
        if (isCancelled || isPaused) break;
        await sleep(500);
      }
    }
  }

  let finalStatus = `Envío completado: ${successCount} OK, ${errorCount} errores.`;
  if (isCancelled) {
    finalStatus = `Envío cancelado. ${successCount} OK, ${errorCount} errores.`;
  }

  broadcastCompletion(currentProgress.current, recipients.length, finalStatus);
  return { successCount, errorCount, failedEmails: currentProgress.failedEmails };
}

/**
 * Reemplaza {NombreDeColumna} (case-insensitive) por el valor de esa columna
 * en el contacto. Cualquier columna del Excel importado es una variable
 * válida, no solo {nombre}/{email}.
 */
function personalizeMessage(template, recipient) {
  return String(template || '').replace(/\{([^{}]+)\}/g, (match, rawKey) => {
    const key = rawKey.trim().toLowerCase();
    const foundKey = Object.keys(recipient || {}).find((k) => k.toLowerCase() === key);
    return foundKey ? (recipient[foundKey] ?? '') : match;
  });
}

function broadcastProgress(current, total, status, rowIndex, rowSuccess) {
  currentProgress.current = current;
  currentProgress.total = total;
  currentProgress.status = status;

  const percent = total ? Math.floor((current / total) * 100) : 0;
  chrome.action.setBadgeText({ text: `${percent}%` }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ color: '#2ebd59' }).catch(() => { });

  chrome.runtime.sendMessage({
    action: 'sendProgress',
    current,
    total,
    status,
    rowIndex,
    rowSuccess,
    failedEmails: currentProgress.failedEmails,
    isPaused
  }).catch(() => { });
}

function broadcastCompletion(current, total, status) {
  sendInProgress = false;
  currentProgress.current = current;
  currentProgress.total = total;
  currentProgress.status = status;

  const hasErrors = currentProgress.failedEmails.length > 0;

  chrome.action.setBadgeText({ text: isCancelled ? 'X' : 'OK' }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ color: hasErrors ? '#ef4444' : (isCancelled ? '#f59e0b' : '#2ebd59') }).catch(() => { });

  chrome.runtime.sendMessage({
    action: 'sendComplete',
    current,
    total,
    status,
    failedEmails: currentProgress.failedEmails,
    isCancelled
  }).catch(() => { });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'startSend') {
    sendEmails(message.payload).then((result) => {
      sendResponse(result);
    });
    return true;
  }

  if (message?.action === 'pauseSend') {
    isPaused = true;
    currentProgress.status = "Pausado...";
    broadcastProgress(currentProgress.current, currentProgress.total, currentProgress.status);
    sendResponse({ success: true });
    return true;
  }

  if (message?.action === 'resumeSend') {
    isPaused = false;
    currentProgress.status = "Reanudando...";
    broadcastProgress(currentProgress.current, currentProgress.total, currentProgress.status);
    sendResponse({ success: true });
    return true;
  }

  if (message?.action === 'cancelSend') {
    isCancelled = true;
    sendResponse({ success: true });
    return true;
  }

  if (message?.action === 'getState') {
    sendResponse({
      sendInProgress,
      isPaused,
      isCancelled,
      ...currentProgress
    });
    return true;
  }

  if (message?.action === 'LICENSE_ACTIVATE') {
    (async () => {
      const state = await activateLicense(message.licenseKey);
      const gate = computeGateDecision(state, Date.now());
      sendResponse({ ...gate, ...state });
    })();
    return true;
  }

  if (message?.action === 'LICENSE_STATUS') {
    (async () => {
      const state = await getCachedLicenseState();
      const gate = computeGateDecision(state, Date.now());
      sendResponse({ ...gate, ...(state || {}) });
    })();
    return true;
  }

  return true;
});
