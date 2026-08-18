import { computeGateDecision } from './ui/licenseGate.js';
import { activateLicense, validateLicense, getCachedLicenseState } from './ui/licenseClient.js';
import { buildMimeMessage } from './ui/mimeBuilder.js';
import { classifyGmailError } from './ui/gmailErrors.js';
import { getAccessToken, invalidateToken, connect, disconnect, detectActiveAccount, getConnectedAccount, AuthRequiredError } from './ui/gmailAuth.js';
import { resolveEmail } from './ui/recipientFields.js';
import { createCampaign, appendResult, summarize, tailLog, finalizeCampaign, RESULT_STATUS, CAMPAIGN_STATUS } from './ui/campaignLog.js';
import { saveCurrent, loadCurrent, archive, listHistory, clearHistory, saveRecipients, loadRecipients } from './ui/historyStore.js';

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

// Registro de la campaña en curso. Vive en memoria mientras el worker está
// vivo y se persiste después de cada correo: si Chrome lo recicla, el reporte
// se puede reconstruir igual.
let currentCampaign = null;
const LIVE_LOG_LIMIT = 50;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Chrome mata un service worker MV3 tras ~30s sin llamadas a APIs de
 * extensión, y un setTimeout encadenado NO cuenta como actividad. Durante el
 * envío eso no importa (cada correo hace fetch y actualiza el badge), pero la
 * pausa por cuota agotada puede durar minutos mientras el usuario conecta la
 * segunda cuenta: ahí el bucle solo dormiría, el worker moriría, y al reanudar
 * no quedaría ningún bucle vivo que despertar. Esta llamada trivial reinicia
 * el temporizador de inactividad.
 */
function keepAlive() {
  return chrome.runtime.getPlatformInfo().catch(() => { });
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

/**
 * Si el worker murió a mitad de campaña, quedó una campaña "En curso" en
 * storage que nadie cerró. Se archiva como Interrumpida —es el único camino
 * por el que aparece ese estado— para que el usuario igual pueda descargar el
 * reporte de lo que sí se envió.
 */
async function recoverInterruptedCampaign() {
  // Si este worker ya está enviando, la campaña de storage es la suya y no hay
  // nada que recuperar: archivarla acá le borraría el registro en pleno envío.
  if (sendInProgress) return;

  const pending = await loadCurrent();
  if (!pending) return;

  // Los destinatarios se guardaron aparte justo por esto: sin ellos, el
  // reporte de una campaña interrumpida solo mostraría a los que sí se
  // intentaron, que es exactamente el caso en que el usuario más necesita
  // saber quiénes quedaron afuera.
  const allRecipients = await loadRecipients();

  // Se cuentan solo los intentos reales: las direcciones omitidas también son
  // resultados, pero no salen de esta lista, así que incluirlas correría el
  // corte y dejaría fuera del reporte a destinatarios que sí faltaban.
  const attempted = pending.results.filter(
    (r) => r.status === RESULT_STATUS.SENT || r.status === RESULT_STATUS.ERROR
  ).length;

  const remaining = allRecipients.slice(attempted).map((item) => ({
    email: resolveEmail(item),
    contactData: item
  }));

  const closed = finalizeCampaign(pending, {
    status: CAMPAIGN_STATUS.INTERRUPTED,
    finishedAt: Date.now(),
    remaining,
    reason: 'El envío se interrumpió antes de llegar a este destinatario'
  });
  await archive(closed);
  console.warn('[campaña] se archivó una campaña interrumpida:', closed.results.length, 'resultados');
}

// Se guarda la promesa para que el primer `startSend` de este worker espere a
// que la recuperación termine. Si corrieran en paralelo, el `archive()` de la
// recuperación podía borrar el registro de la campaña recién iniciada.
const recoveryReady = recoverInterruptedCampaign()
  .catch((err) => console.warn('[campaña] recuperación falló:', err?.message || err));

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
  try {
    return await runCampaign(payload, account);
  } catch (err) {
    // Cualquier fallo inesperado —storage lleno, permiso revocado— tiene que
    // dejar la extensión usable. Sin esto, `sendInProgress` se quedaba en true
    // y todas las campañas siguientes respondían "Ya hay un envío en progreso"
    // hasta que Chrome reciclara el service worker.
    console.error('[campaña] el envío se interrumpió por un error:', err);
    currentCampaign = null;
    broadcastCompletion(currentProgress.current, payload.recipients?.length || 0, `Envío interrumpido: ${err.message}`);
    return { error: `El envío se interrumpió: ${err.message}` };
  } finally {
    sendInProgress = false;
  }
}

/** Cuerpo de la campaña. Lo envuelve sendEmails, que garantiza la limpieza. */
async function runCampaign(payload, account) {
  isPaused = false;
  isCancelled = false;
  quotaExhausted = false;
  pausedAccount = null;
  currentProgress.failedEmails = [];

  const omitted = payload.omitted || [];

  currentCampaign = createCampaign({
    // El total incluye las descartadas: el reporte tiene que cuadrar con la
    // cantidad de filas que el usuario cargó, no solo con las que se enviaron.
    total: payload.recipients.length + omitted.length,
    account: account.email,
    subject: payload.subject || '',
    startedAt: Date.now()
  });

  // Las direcciones que la revisión previa marcó como probables rebotes y el
  // usuario decidió no enviar entran al registro antes de arrancar: el
  // historial debe decir por qué no se les escribió, en vez de que
  // simplemente falten.
  omitted.forEach((item) => {
    currentCampaign = appendResult(currentCampaign, {
      email: item.email,
      status: RESULT_STATUS.OMITTED,
      reason: item.reason || 'Descartada antes de enviar',
      contactData: item.contactData || {},
      timestamp: Date.now()
    });
  });

  await saveCurrent(currentCampaign);
  await saveRecipients(payload.recipients);

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
      await keepAlive();
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
      await recordResult(recipient, recipientEmail, RESULT_STATUS.SENT, '');
      broadcastProgress(index + 1, recipients.length, `Enviado a ${recipientEmail} (${successCount} OK, ${errorCount} errores)`, index, true);
    } else {
      errorCount += 1;
      currentProgress.failedEmails.push({ email: recipientEmail, error: outcome.message });
      await recordResult(recipient, recipientEmail, RESULT_STATUS.ERROR, outcome.message);
      broadcastProgress(index + 1, recipients.length, `Error en ${recipientEmail}: ${outcome.message}`, index, false);
    }

    index += 1;

    if (index < recipients.length) {
      const delayMs = (delaySeconds || 10) * 1000;
      const steps = delayMs / 500;
      for (let s = 0; s < steps; s++) {
        if (isCancelled || isPaused) break;
        await keepAlive();
        await sleep(500);
      }
    }
  }

  let finalStatus = `Envío completado: ${successCount} OK, ${errorCount} errores.`;
  let campaignStatus = CAMPAIGN_STATUS.COMPLETED;
  let pendingReason = '';
  if (isCancelled) {
    finalStatus = `Envío cancelado. ${successCount} OK, ${errorCount} errores.`;
    campaignStatus = CAMPAIGN_STATUS.CANCELLED;
    pendingReason = 'Campaña cancelada antes de llegar a este destinatario';
  }

  // Lo que quedó sin intentar entra al reporte como pendiente. `index` apunta
  // al primer destinatario no procesado, tanto si se canceló como si se salió
  // del bucle por cualquier otra vía.
  const remaining = recipients.slice(index).map((item) => ({
    email: resolveEmail(item),
    contactData: item
  }));

  currentCampaign = finalizeCampaign(currentCampaign, {
    status: campaignStatus,
    finishedAt: Date.now(),
    remaining,
    reason: pendingReason
  });
  await archive(currentCampaign);

  broadcastCompletion(currentProgress.current, recipients.length, finalStatus);
  const archived = currentCampaign;
  currentCampaign = null;
  return { successCount, errorCount, failedEmails: currentProgress.failedEmails, campaign: archived };
}

/**
 * Agrega el resultado al registro y lo persiste. Una escritura cada 10
 * segundos —el retardo por defecto entre correos— no es un costo relevante, y
 * a cambio ninguna campaña se pierde si el worker se recicla.
 */
async function recordResult(recipient, email, status, reason) {
  currentCampaign = appendResult(currentCampaign, {
    email,
    status,
    reason,
    contactData: recipient,
    timestamp: Date.now()
  });
  await saveCurrent(currentCampaign);
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

  const results = currentCampaign?.results || [];

  chrome.runtime.sendMessage({
    action: 'sendProgress',
    current,
    total,
    status,
    rowIndex,
    rowSuccess,
    failedEmails: currentProgress.failedEmails,
    isPaused,
    // El panel lateral agrega esta entrada a su log en vivo; el dashboard la ignora.
    lastResult: results[results.length - 1] || null,
    // Pausar y reanudar también emiten progreso, con el mismo `lastResult` que
    // el panel ya pintó. Con este contador el panel distingue un resultado
    // nuevo de una repetición y deja de duplicar la última línea del log.
    resultCount: results.length,
    summary: currentCampaign ? summarize(currentCampaign) : null
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
    isCancelled,
    summary: currentCampaign ? summarize(currentCampaign) : null,
    campaign: currentCampaign
  }).catch(() => { });
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.action === 'startSend') {
    // Se espera a la recuperación de campañas interrumpidas antes de arrancar:
    // las dos escriben sobre la misma clave de storage.
    recoveryReady
      .then(() => sendEmails(message.payload))
      .then((result) => sendResponse(result))
      .catch((err) => sendResponse({ error: err?.message || 'Error inesperado al iniciar el envío.' }));
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
    // Sin bucle vivo no hay nada que despertar: bajar las banderas dejaría la
    // UI en "enviando" para siempre. Mejor decirlo que fingir que continúa.
    if (!sendInProgress) {
      sendResponse({ success: false, error: 'La campaña ya no está en curso. Vuelve a iniciarla con los destinatarios que falten.' });
      return true;
    }
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
      ...currentProgress,
      // Con esto el panel lateral se pone al día si se abre a mitad de campaña.
      log: currentCampaign ? tailLog(currentCampaign, LIVE_LOG_LIMIT) : [],
      resultCount: currentCampaign ? currentCampaign.results.length : 0,
      summary: currentCampaign ? summarize(currentCampaign) : null,
      account: currentCampaign?.account || null
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

  if (message?.action === 'HISTORY_LIST') {
    (async () => {
      sendResponse({ history: await listHistory() });
    })();
    return true;
  }

  if (message?.action === 'HISTORY_CLEAR') {
    (async () => {
      await clearHistory();
      sendResponse({ ok: true });
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
