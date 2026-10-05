/**
 * Panel lateral de monitoreo.
 *
 * No decide nada: pinta lo que background emite y le devuelve las órdenes de
 * los botones. El estado real vive en el service worker, así que este panel se
 * puede cerrar y reabrir a mitad de campaña sin consecuencias.
 */

// Solo CSV desde acá: el .xlsx necesita SheetJS, casi un mega de librería que
// no vale la pena cargar en un panel de 340 píxeles. El dashboard ofrece los
// dos formatos.
import { buildReportRows, toCSV, buildFileName } from './reportBuilder.js';

const counterEl = document.getElementById('counter');
const progressFill = document.getElementById('progress-fill');
const currentEmailEl = document.getElementById('current-email');
const counterOkEl = document.getElementById('counter-ok');
const counterErrorEl = document.getElementById('counter-error');
const controlsEl = document.getElementById('controls');
const btnPausar = document.getElementById('btn-pausar');
const btnReanudar = document.getElementById('btn-reanudar');
const btnCancelar = document.getElementById('btn-cancelar');
const quotaBanner = document.getElementById('quota-banner');
const quotaText = document.getElementById('quota-text');
const btnRelevo = document.getElementById('btn-relevo');
const btnAvance = document.getElementById('btn-avance');
const pauseBanner = document.getElementById('pause-banner');
const pauseText = document.getElementById('pause-text');
const btnPauseAvance = document.getElementById('btn-pause-avance');
const resumableBanner = document.getElementById('resumable-banner');
const resumableText = document.getElementById('resumable-text');
const resumableDetail = document.getElementById('resumable-detail');
const btnResumableAvance = document.getElementById('btn-resumable-avance');
const logEl = document.getElementById('log');
const emptyState = document.getElementById('empty-state');

const LIVE_LOG_LIMIT = 50;

const STATUS_ICONS = { enviado: '✅', error: '❌', pendiente: '⏳', omitido: '⊘' };

// Cuántos resultados lleva pintados el log. Background emite progreso también
// al pausar y al reanudar, con el mismo último resultado: sin este contador,
// cada pausa volvía a insertar la línea que ya estaba arriba.
let paintedResults = 0;

function formatTime(timestamp) {
  if (!timestamp) return '';
  return new Date(timestamp).toLocaleTimeString('es-EC', { hour: '2-digit', minute: '2-digit' });
}

function setProgress(current, total) {
  const percent = total ? Math.min(100, Math.floor((current / total) * 100)) : 0;
  progressFill.style.width = `${percent}%`;
  counterEl.textContent = `${current} / ${total}`;
}

function setSummary(summary) {
  if (!summary) return;
  counterOkEl.textContent = `✅ ${summary.enviados}`;
  counterErrorEl.textContent = `❌ ${summary.errores}`;
}

/**
 * Arma el nodo de una entrada del log. Se construye con createElement y no con
 * innerHTML a propósito: el motivo del error viene de la respuesta de Gmail y
 * el correo viene del Excel del usuario, así que ninguno de los dos se
 * interpola como HTML.
 *
 * @param {{email: string, status: string, reason: string, timestamp: number}} result
 * @returns {HTMLElement}
 */
function createLogEntry(result) {
  const entry = document.createElement('div');
  entry.className = 'log-entry';

  const icon = document.createElement('span');
  icon.textContent = STATUS_ICONS[result.status] || '•';

  const email = document.createElement('span');
  email.className = 'log-email';
  email.textContent = result.email;

  entry.append(icon, email);

  if (result.status === 'error' && result.reason) {
    const reason = document.createElement('span');
    reason.className = 'log-reason';
    reason.textContent = result.reason.slice(0, 40);
    entry.appendChild(reason);
  } else {
    const time = document.createElement('span');
    time.className = 'log-time';
    time.textContent = formatTime(result.timestamp);
    entry.appendChild(time);
  }

  return entry;
}

/** Entrada nueva: va arriba de todo, porque el log va del más reciente al más viejo. */
function prependLogEntry(result) {
  if (!result) return;
  emptyState.style.display = 'none';
  logEl.insertBefore(createLogEntry(result), logEl.firstChild);

  // El detalle completo vive en el reporte: acá solo se muestran las últimas
  // entradas para que el panel no se vuelva pesado en campañas largas.
  // Se recorta por `.log-entry` y no por `lastElementChild`: el cartel de
  // "sin campaña" es el último hijo del contenedor y se lo llevaba puesto.
  const entries = logEl.querySelectorAll('.log-entry');
  for (let i = LIVE_LOG_LIMIT; i < entries.length; i += 1) {
    entries[i].remove();
  }
}

/** Pintado inicial al abrir el panel a mitad de campaña. */
function renderLog(entries) {
  logEl.querySelectorAll('.log-entry').forEach((el) => el.remove());

  if (!entries || entries.length === 0) {
    emptyState.style.display = '';
    return;
  }

  emptyState.style.display = 'none';
  // `tailLog` las devuelve con la más reciente primero, que es el mismo orden
  // en que se muestran: se agregan al final una tras otra.
  entries.forEach((result) => logEl.appendChild(createLogEntry(result)));
}

function setControls(state) {
  if (state === 'running') {
    controlsEl.style.display = '';
    btnPausar.style.display = '';
    btnReanudar.style.display = 'none';
    btnCancelar.style.display = '';
  } else if (state === 'paused') {
    controlsEl.style.display = '';
    btnPausar.style.display = 'none';
    btnReanudar.style.display = '';
    btnCancelar.style.display = '';
  } else {
    controlsEl.style.display = 'none';
  }
}

function showQuotaBanner(account, detail) {
  quotaText.textContent = `La cuenta ${account || 'conectada'} alcanzó su límite diario. ${detail || ''}`.trim();
  quotaBanner.style.display = '';
  if (pauseBanner) pauseBanner.style.display = 'none';
  if (resumableBanner) resumableBanner.style.display = 'none';
}

function hideQuotaBanner() {
  quotaBanner.style.display = 'none';
}

function showPauseBanner() {
  if (!pauseBanner) return;
  pauseBanner.style.display = '';
  if (quotaBanner) quotaBanner.style.display = 'none';
}

function hidePauseBanner() {
  if (pauseBanner) pauseBanner.style.display = 'none';
}

function showResumableBanner(campaign, recipientsCount) {
  if (!resumableBanner) return;
  const total = campaign?.total || recipientsCount || 0;
  const enviados = (campaign?.results || []).filter((r) => r.status === 'enviado').length;
  const errores = (campaign?.results || []).filter((r) => r.status === 'error').length;
  const pendientes = total ? Math.max(0, total - (enviados + errores)) : 0;
  resumableText.textContent = '⏸️ Campaña interrumpida — retomala desde el dashboard';
  if (resumableDetail) resumableDetail.textContent = `${total} destinatarios · ${enviados} enviados · ${errores} errores · ${pendientes} pendientes. Volvé a subir el Excel en el dashboard y usá "Retomar".`;
  resumableBanner.style.display = '';
}

function hideResumableBanner() {
  if (resumableBanner) resumableBanner.style.display = 'none';
}

function downloadSnapshot() {
  chrome.runtime.sendMessage({ action: 'CAMPAIGN_SNAPSHOT' }, (response) => {
    if (chrome.runtime.lastError || !response?.campaign) return;
    const report = buildReportRows(response.campaign);
    if (report.headers.length === 0) return;
    const blob = new Blob([toCSV(report)], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = buildFileName(response.campaign, 'csv');
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  });
}

// ─── Controles ───────────────────────────────────────────────────────────────
btnPausar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'pauseSend' }).catch(() => { });
  setControls('paused');
  showPauseBanner();
});

btnReanudar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'resumeSend' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.error) {
      currentEmailEl.textContent = response.error;
      setControls('idle');
      return;
    }
    hideQuotaBanner();
    hidePauseBanner();
    hideResumableBanner();
    setControls('running');
  });
});

btnCancelar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'cancelSend' }).catch(() => { });
  setControls('idle');
  hidePauseBanner();
  hideQuotaBanner();
});

/**
 * Baja el avance de la campaña pausada sin cerrarla: quién ya recibió el
 * correo, quién falló y desde qué destinatario hay que retomar.
 */
btnAvance.addEventListener('click', downloadSnapshot);
if (btnPauseAvance) btnPauseAvance.addEventListener('click', downloadSnapshot);
if (btnResumableAvance) btnResumableAvance.addEventListener('click', downloadSnapshot);

btnRelevo.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'GMAIL_CONNECT', selectAccount: true }, (response) => {
    if (chrome.runtime.lastError) return;
    if (!response?.connected) return;

    // Se verifica que la campaña siga viva antes de decir que continúa: si el
    // worker murió durante la pausa por cuota, no hay bucle que reanudar y
    // mostrar "enviando" sería una barra de progreso que no avanza nunca.
    chrome.runtime.sendMessage({ action: 'resumeSend' }, (resumed) => {
      if (chrome.runtime.lastError) return;
      if (resumed?.error) {
        quotaText.textContent = resumed.error;
        setControls('idle');
        return;
      }
      hideQuotaBanner();
      setControls('running');
    });
  });
});

// ─── Broadcast de background ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'sendProgress') {
    setProgress(message.current, message.total);
    setSummary(message.summary);

    // Solo se pinta si de verdad hay un resultado nuevo: una pausa o una
    // reanudación reenvían el último, que ya está en pantalla.
    if (message.resultCount > paintedResults) {
      prependLogEntry(message.lastResult);
      paintedResults = message.resultCount;
      if (message.lastResult) currentEmailEl.textContent = message.lastResult.email;
    }

    setControls(message.isPaused ? 'paused' : 'running');
    if (message.isPaused) {
      if (!quotaBanner || quotaBanner.style.display === 'none') {
        showPauseBanner();
      }
    } else {
      hidePauseBanner();
    }
    hideResumableBanner();
  }

  if (message?.action === 'sendComplete') {
    setProgress(message.current, message.total);
    setSummary(message.summary);
    currentEmailEl.textContent = message.isCancelled ? 'Campaña cancelada' : 'Campaña completada';
    setControls('idle');
    hideQuotaBanner();
    hidePauseBanner();
    hideResumableBanner();
  }

  if (message?.action === 'quotaExhausted') {
    setProgress(message.current, message.total);
    showQuotaBanner(message.account, message.detail);
    setControls('paused');
  }
});

// ─── Puesta al día al abrir ──────────────────────────────────────────────────
// El panel puede abrirse con la campaña ya empezada o interrumpida.
chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
  if (chrome.runtime.lastError || !response) return;

  setProgress(response.current || 0, response.total || 0);
  setSummary(response.summary);
  renderLog(response.log);
  paintedResults = response.resultCount || 0;

  if (response.hasResumable && !response.sendInProgress) {
    showResumableBanner(response.resumable, response.resumableRecipientsCount || 0);
    setControls('idle');
    currentEmailEl.textContent = 'Campaña interrumpida — retomar en dashboard';
    return;
  }

  if (response.sendInProgress) {
    setControls(response.isPaused ? 'paused' : 'running');
    const last = response.log && response.log[0];
    if (last) currentEmailEl.textContent = last.email;
    if (response.quotaExhausted) showQuotaBanner(response.pausedAccount, '');
    else if (response.isPaused) showPauseBanner();
  } else {
    setControls('idle');
    if (response.total > 0) currentEmailEl.textContent = 'Campaña finalizada';
  }
});