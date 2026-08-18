/**
 * Persistencia de campañas en chrome.storage.local.
 *
 * Dos claves distintas y con propósitos distintos:
 * - CURRENT_KEY guarda la campaña en curso después de cada correo. Si Chrome
 *   recicla el service worker a mitad de envío, el reporte no se pierde.
 * - HISTORY_KEY guarda las campañas ya cerradas.
 */

const CURRENT_KEY = 'campaignInProgress';
const HISTORY_KEY = 'campaignHistory';

// La lista de destinatarios va en su propia clave y se escribe una sola vez
// por campaña. Si viviera dentro del objeto de la campaña, cada correo la
// reserializaría entera junto con los resultados.
const RECIPIENTS_KEY = 'campaignRecipients';

// Lo lee el dashboard al abrirse para saber que hay un resumen sin ver. Hace
// falta porque al abrir el panel lateral Chrome cierra el popup, y entonces no
// queda nadie escuchando el mensaje de campaña terminada.
const FINISHED_FLAG_KEY = 'campaignFinished';

/** Tope por higiene de la UI, no por espacio: la extensión declara unlimitedStorage. */
export const HISTORY_LIMIT = 20;

export async function saveCurrent(campaign) {
  await chrome.storage.local.set({ [CURRENT_KEY]: campaign });
}

export async function loadCurrent() {
  const stored = await chrome.storage.local.get([CURRENT_KEY]);
  return stored[CURRENT_KEY] || null;
}

export async function clearCurrent() {
  await chrome.storage.local.remove([CURRENT_KEY]);
}

/** Destinatarios de la campaña en curso, para saber quiénes quedaron sin intentar. */
export async function saveRecipients(recipients) {
  await chrome.storage.local.set({ [RECIPIENTS_KEY]: recipients });
}

export async function loadRecipients() {
  const stored = await chrome.storage.local.get([RECIPIENTS_KEY]);
  return stored[RECIPIENTS_KEY] || [];
}

/** Archiva una campaña cerrada y limpia todo el estado de la que estaba en curso. */
export async function archive(campaign) {
  const history = await listHistory();
  history.unshift(campaign);
  await chrome.storage.local.set({
    [HISTORY_KEY]: history.slice(0, HISTORY_LIMIT),
    [FINISHED_FLAG_KEY]: true
  });
  await clearCurrent();
  await chrome.storage.local.remove([RECIPIENTS_KEY]);
}

/** @returns {Promise<Array>} Campañas cerradas, la más reciente primero. */
export async function listHistory() {
  const stored = await chrome.storage.local.get([HISTORY_KEY]);
  return stored[HISTORY_KEY] || [];
}

export async function clearHistory() {
  await chrome.storage.local.remove([HISTORY_KEY]);
}