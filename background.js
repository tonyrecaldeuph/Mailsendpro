import { computeGateDecision } from './ui/licenseGate.js';
import { activateLicense, validateLicense, getCachedLicenseState } from './ui/licenseClient.js';
import { buildMimeMessage } from './ui/mimeBuilder.js';
import { classifyGmailError } from './ui/gmailErrors.js';
import { getAccessToken, invalidateToken, connect, disconnect, detectActiveAccount, getConnectedAccount, AuthRequiredError } from './ui/gmailAuth.js';

const LICENSE_VALIDATION_ALARM = 'licenseValidationAlarm';
const LICENSE_VALIDATION_PERIOD_MIN = 360; // 6h

// Endpoint de subida (no el de metadatos): acepta el MIME crudo, sin tener
// que codificar el mensaje entero en base64url dentro de un JSON.
const GMAIL_SEND_URL = 'https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media';
const MAX_RATE_RETRIES = 3;

let sendInProgress = false;
let isPaused = false;
let isCancelled = false;
let quotaExhausted = false;
let pausedAccount = null;
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

  // La licencia ya no la valida ningún backend intermedio: sin Apps Script,
  // esta llamada es la única barrera del lado del servidor. Se hace una vez
  // por campaña, no una por correo.
  const licenseState = await validateLicense();
  const gate = computeGateDecision(licenseState, Date.now());
  if (!gate.allowed) {
    return { error: `Licencia no válida (${gate.reason}). Abre "Licencia" en el menú.` };
  }

  const account = await getConnectedAccount();
  if (!account) {
    return { error: 'No hay una cuenta de Gmail conectada. Abre "Configuración".' };
  }

  sendInProgress = true;
  isPaused = false;
  isCancelled = false;
  quotaExhausted = false;
  pausedAccount = null;
  currentProgress.failedEmails = [];

  const { fromEmail, recipients, subject, message, attachments, delaySeconds } = payload;
  let successCount = 0;
  let errorCount = 0;

  // La UI limita a 1 imagen embebida y hasta 3 PDFs; acá se separan porque
  // van en partes MIME distintas (related inline vs. mixed adjunto).
  const inlineImages = [];
  const fileAttachments = [];
  (attachments || []).forEach((att) => {
    const [, base64] = att.dataUrl.split(',');
    const part = { filename: att.name, mimeType: att.type, base64 };
    if (/^image\//i.test(att.type)) inlineImages.push(part);
    else fileAttachments.push(part);
  });

  let index = 0;
  while (index < recipients.length) {
    if (isCancelled) break;

    while (isPaused) {
      if (isCancelled) break;
      await sleep(500);
    }
    if (isCancelled) break;

    const recipient = recipients[index];
    const recipientEmail = resolveEmail(recipient);
    const outcome = await sendOne({
      recipient,
      recipientEmail,
      fromEmail,
      subject,
      message,
      inlineImages,
      fileAttachments
    });

    if (outcome.kind === 'quota') {
      // No se avanza el índice: este destinatario se reintenta con la cuenta
      // de relevo. Los que faltan siguen en "Pendiente", no se marcan fallidos.
      await pauseForQuota(outcome.message, index, recipients.length, successCount);
      continue;
    }

    if (outcome.kind === 'ok') {
      successCount += 1;
      broadcastProgress(index + 1, recipients.length, `Enviado a ${recipientEmail} (${successCount} OK, ${errorCount} errores)`, index, true);
    } else {
      errorCount += 1;
      currentProgress.failedEmails.push({ email: recipientEmail, error: outcome.message });
      broadcastProgress(index + 1, recipients.length, `Error en ${recipientEmail}: ${outcome.message}`, index, false);
    }

    index += 1;

    if (index < recipients.length) {
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
 * Envía un correo. El token se pide acá adentro, no antes del bucle: como
 * getAccessToken() cachea, no cuesta nada, y es lo que hace que al reanudar
 * con la cuenta de relevo el envío tome la cuenta nueva sin más cambios.
 * @returns {Promise<{kind:'ok'|'error'|'quota', message?: string}>}
 */
async function sendOne({ recipient, recipientEmail, fromEmail, subject, message, inlineImages, fileAttachments }) {
  for (let attempt = 0; attempt <= MAX_RATE_RETRIES; attempt += 1) {
    let token;
    try {
      token = await getAccessToken();
    } catch (err) {
      if (err instanceof AuthRequiredError) return { kind: 'quota', message: err.message };
      return { kind: 'error', message: err.message };
    }

    const account = await getConnectedAccount();
    const mime = buildMimeMessage({
      fromName: fromEmail,
      fromEmail: account?.email || 'me',
      to: recipientEmail,
      subject: personalizeMessage(subject || 'Mensaje de extensión', recipient),
      html: personalizeMessage(message, recipient),
      inlineImages,
      attachments: fileAttachments
    });

    let response;
    try {
      response = await fetch(GMAIL_SEND_URL, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'message/rfc822'
        },
        body: mime
      });
    } catch (err) {
      if (attempt < MAX_RATE_RETRIES) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { kind: 'error', message: `Sin conexión: ${err.message}` };
    }

    if (response.ok) return { kind: 'ok' };

    const body = await response.text();
    const classified = classifyGmailError(response.status, body);

    if (classified.kind === 'auth') {
      // Token vencido o revocado: se fuerza la renovación y se reintenta una vez.
      await invalidateToken();
      if (attempt < 1) continue;
      return { kind: 'quota', message: `Se perdió el acceso a la cuenta: ${classified.message}` };
    }

    if (classified.kind === 'rate') {
      if (attempt < MAX_RATE_RETRIES) {
        await sleep(2000 * (attempt + 1));
        continue;
      }
      return { kind: 'quota', message: classified.message };
    }

    if (classified.kind === 'quota') {
      return { kind: 'quota', message: classified.message };
    }

    return { kind: 'error', message: classified.message };
  }

  return { kind: 'error', message: 'Se agotaron los reintentos.' };
}

/**
 * Cuota diaria agotada: se pausa la campaña en el destinatario actual y se
 * avisa a la UI para que ofrezca conectar la cuenta de relevo.
 */
async function pauseForQuota(message, index, total, successCount) {
  const account = await getConnectedAccount();
  isPaused = true;
  quotaExhausted = true;
  pausedAccount = account?.email || null;

  currentProgress.current = index;
  currentProgress.total = total;
  currentProgress.status = `Límite diario alcanzado en ${pausedAccount || 'la cuenta conectada'} — ${successCount} enviados de ${total}.`;

  chrome.action.setBadgeText({ text: '⏸' }).catch(() => { });
  chrome.action.setBadgeBackgroundColor({ color: '#f59e0b' }).catch(() => { });

  chrome.runtime.sendMessage({
    action: 'quotaExhausted',
    current: index,
    total,
    account: pausedAccount,
    detail: message,
    status: currentProgress.status,
    failedEmails: currentProgress.failedEmails
  }).catch(() => { });
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
    quotaExhausted = false;
    pausedAccount = null;
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
      quotaExhausted,
      pausedAccount,
      ...currentProgress
    });
    return true;
  }

  if (message?.action === 'GMAIL_STATUS') {
    (async () => {
      // El intento silencioso reengancha la sesión del navegador sin abrir
      // ventanas. Si falla —no hay sesión de Google, o es otra cuenta— se
      // responde desconectado: mostrar 🟢 con un token que no se puede
      // conseguir haría fallar el envío recién al pulsar "Iniciar Campaña".
      const detected = await detectActiveAccount();
      const cached = await getConnectedAccount();
      sendResponse({ connected: !!detected, email: detected?.email || cached?.email || null });
    })();
    return true;
  }

  if (message?.action === 'GMAIL_CONNECT') {
    (async () => {
      try {
        const result = await connect({ selectAccount: message.selectAccount === true });
        sendResponse({ connected: true, email: result.email });
      } catch (err) {
        sendResponse({ connected: false, error: err.message });
      }
    })();
    return true;
  }

  if (message?.action === 'GMAIL_DISCONNECT') {
    (async () => {
      await disconnect();
      sendResponse({ connected: false });
    })();
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
