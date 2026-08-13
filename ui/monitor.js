/**
 * Panel lateral de monitoreo.
 *
 * No decide nada: pinta lo que background emite y le devuelve las órdenes de
 * los botones. El estado real vive en el service worker, así que este panel se
 * puede cerrar y reabrir a mitad de campaña sin consecuencias.
 */

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
const logEl = document.getElementById('log');
const emptyState = document.getElementById('empty-state');

const LIVE_LOG_LIMIT = 50;

const STATUS_ICONS = { enviado: '✅', error: '❌', pendiente: '⏳' };

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
  while (logEl.querySelectorAll('.log-entry').length > LIVE_LOG_LIMIT) {
    logEl.removeChild(logEl.lastElementChild);
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
}

function hideQuotaBanner() {
  quotaBanner.style.display = 'none';
}

// ─── Controles ───────────────────────────────────────────────────────────────
btnPausar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'pauseSend' }).catch(() => { });
  setControls('paused');
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
    setControls('running');
  });
});

btnCancelar.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'cancelSend' }).catch(() => { });
  setControls('idle');
});

btnRelevo.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'GMAIL_CONNECT', selectAccount: true }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response?.connected) {
      chrome.runtime.sendMessage({ action: 'resumeSend' }).catch(() => { });
      hideQuotaBanner();
      setControls('running');
    }
  });
});

// ─── Broadcast de background ─────────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'sendProgress') {
    setProgress(message.current, message.total);
    setSummary(message.summary);
    prependLogEntry(message.lastResult);
    if (message.lastResult) currentEmailEl.textContent = message.lastResult.email;
    setControls(message.isPaused ? 'paused' : 'running');
  }

  if (message?.action === 'sendComplete') {
    setProgress(message.current, message.total);
    setSummary(message.summary);
    currentEmailEl.textContent = message.isCancelled ? 'Campaña cancelada' : 'Campaña completada';
    setControls('idle');
  }

  if (message?.action === 'quotaExhausted') {
    setProgress(message.current, message.total);
    showQuotaBanner(message.account, message.detail);
    setControls('paused');
  }
});

// ─── Puesta al día al abrir ──────────────────────────────────────────────────
// El panel puede abrirse con la campaña ya empezada.
chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
  if (chrome.runtime.lastError || !response) return;

  setProgress(response.current || 0, response.total || 0);
  setSummary(response.summary);
  renderLog(response.log);

  if (response.sendInProgress) {
    setControls(response.isPaused ? 'paused' : 'running');
    const last = response.log && response.log[0];
    if (last) currentEmailEl.textContent = last.email;
    if (response.quotaExhausted) showQuotaBanner(response.pausedAccount, '');
  } else {
    setControls('idle');
    if (response.total > 0) currentEmailEl.textContent = 'Campaña finalizada';
  }
});