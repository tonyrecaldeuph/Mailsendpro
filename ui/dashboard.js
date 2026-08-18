import { buildReportRows, toCSV, buildFileName } from './reportBuilder.js';
import { summarize } from './campaignLog.js';
import { auditEmails, applySuggestion, PROBLEM_LABELS } from './emailAudit.js';
import { resolveEmail, resolveEmailKey } from './recipientFields.js';

// ─── DOM refs ────────────────────────────────────────────────────────────────
const fileInput         = document.getElementById('file-import');
const importBtn         = document.getElementById('btn-import');
const clearListBtn      = document.getElementById('btn-clear-list');
const recipientCountEl  = document.getElementById('recipient-count');
const contactsListEl    = document.getElementById('contacts-list');
const contactsHeaderEl  = document.getElementById('contacts-header');

const subjectInput      = document.getElementById('subject');
const messageInput      = document.getElementById('message');
const variablesContainer = document.getElementById('variables-container');
const variableTags      = document.getElementById('variable-tags');

const inputImagen       = document.getElementById('input-imagen');
const btnCargarImagen   = document.getElementById('btn-cargar-imagen');
const btnQuitarImagen   = document.getElementById('btn-quitar-imagen');
const previewImagenContainer = document.getElementById('preview-imagen-container');
const previewImagen     = document.getElementById('preview-imagen');

const inputPdfs         = document.getElementById('input-pdfs');
const btnCargarPdfs     = document.getElementById('btn-cargar-pdfs');
const pdfListEl         = document.getElementById('pdf-list');

const delaySeconds      = document.getElementById('delaySeconds');

const progressSection   = document.getElementById('progress-section');
const progressBar       = document.getElementById('progressBar');
const statusText        = document.getElementById('statusText');
const progressText      = document.getElementById('progressText');
const errorsContainer   = document.getElementById('errorsContainer');
const toggleErrorsBtn   = document.getElementById('toggleErrorsBtn');
const errorsList        = document.getElementById('errorsList');
const copyErrorsBtn     = document.getElementById('copyErrorsBtn');

const sendBtn            = document.getElementById('btn-enviar');
const pauseBtn            = document.getElementById('btn-pausar');
const resumeBtn            = document.getElementById('btn-reanudar');
const cancelBtn            = document.getElementById('btn-cancelar');
const resetBtn            = document.getElementById('btn-reiniciar');

// Configuración
const navConfiguracion  = document.getElementById('nav-configuracion');
const modalConfiguracion = document.getElementById('modal-configuracion');
const btnCerrarConfiguracion = document.getElementById('btn-cerrar-configuracion');
const gmailStatusEl     = document.getElementById('gmail-status');
const btnConectarGmail  = document.getElementById('btn-conectar-gmail');
const btnDesconectarGmail = document.getElementById('btn-desconectar-gmail');
const smtpFrom          = document.getElementById('smtpFrom');

// Relevo de cuenta por cuota agotada
const quotaBanner       = document.getElementById('quota-banner');
const quotaBannerText   = document.getElementById('quota-banner-text');
const btnRelevoCuenta   = document.getElementById('btn-relevo-cuenta');
const btnAvanceCSV      = document.getElementById('btn-avance-csv');
const btnAvanceXLSX     = document.getElementById('btn-avance-xlsx');

// Soporte
const navSoporte        = document.getElementById('nav-soporte');
const modalSoporte       = document.getElementById('modal-soporte');
const linkWebSoporte     = document.getElementById('link-web-soporte');

// Licencia
const navLicencia       = document.getElementById('nav-licencia');
const modalLicencia      = document.getElementById('modal-licencia');
const licenseBadge      = document.getElementById('license-badge');
const licenseInfo       = document.getElementById('license-info');
const inputLicenseKey   = document.getElementById('input-license-key');
const btnActivarLicencia = document.getElementById('btn-activar-licencia');

// Revisión previa de direcciones
const auditBanner       = document.getElementById('audit-banner');
const auditExcludedBlock = document.getElementById('audit-excluded-block');
const auditExcludedTitle = document.getElementById('audit-excluded-title');
const auditExcludedList = document.getElementById('audit-excluded-list');
const btnAuditReincluir = document.getElementById('btn-audit-reincluir');
const auditSuspectBlock = document.getElementById('audit-suspect-block');
const auditTitle        = document.getElementById('audit-title');
const auditStatus       = document.getElementById('audit-status');
const auditList         = document.getElementById('audit-list');
const btnAuditCorregir  = document.getElementById('btn-audit-corregir');
const btnAuditExcluir   = document.getElementById('btn-audit-excluir');
const btnAuditIgnorar   = document.getElementById('btn-audit-ignorar');

// Reporte e historial
const navHistorial      = document.getElementById('nav-historial');
const modalHistorial    = document.getElementById('modal-historial');
const historialLista    = document.getElementById('historial-lista');
const btnBorrarHistorial = document.getElementById('btn-borrar-historial');
const modalResumen      = document.getElementById('modal-resumen');
const resumenEnviados   = document.getElementById('resumen-enviados');
const resumenErrores    = document.getElementById('resumen-errores');
const resumenPendientes = document.getElementById('resumen-pendientes');
const resumenOmitidos   = document.getElementById('resumen-omitidos');
const resumenOmitidosBloque = document.getElementById('resumen-omitidos-bloque');
const btnResumenCSV     = document.getElementById('btn-resumen-csv');
const btnResumenXLSX    = document.getElementById('btn-resumen-xlsx');
const btnCerrarResumen  = document.getElementById('btn-cerrar-resumen');

// ─── State ───────────────────────────────────────────────────────────────────
let recipients  = [];
let availableVariables = [];
let attachments = [];
let pdfAttachments = [];
let campaignRunning = false;
let isPaused        = false;
let currentFailedEmails = [];
let isLicenseAllowed = false;
let hasPromptedForLicense = false;
let gmailAccount = null;
let hasPromptedForGmail = false;

let lastCampaign = null;
// Direcciones excluidas por la revisión previa. No se envían, pero viajan en el
// payload para quedar registradas en el reporte con su motivo.
let omittedRecipients = [];
// Se resuelve al cargar porque chrome.sidePanel.open() exige un gesto del
// usuario: si se pidiera la ventana dentro del click, el await perdería el
// gesto y Chrome rechazaría la apertura.
let currentWindowId = null;
chrome.windows.getCurrent().then((win) => { currentWindowId = win.id; }).catch(() => { });

// Última posición del caret dentro del editor. El navegador descarta la
// selección cuando el foco se va a otro elemento, así que se guarda acá para
// poder insertar una variable exactamente donde el usuario estaba escribiendo.
let lastEditorRange = null;

document.addEventListener('selectionchange', () => {
  const selection = window.getSelection();
  if (selection.rangeCount > 0 && messageInput.contains(selection.anchorNode)) {
    lastEditorRange = selection.getRangeAt(0).cloneRange();
  }
});

// ─── Persistence ─────────────────────────────────────────────────────────────
/**
 * El editor enriquecido guarda HTML; los mensajes guardados por versiones
 * anteriores son texto plano. Cuál es cuál se decide por la marca que graba
 * `saveState`, no adivinando por el contenido: el editor está estilado con
 * `white-space: pre-wrap` y bajo ese estilo el navegador sí puede dejar saltos
 * de línea crudos en el innerHTML, así que olfatear `\n` daba por texto plano
 * a mensajes con formato y los mostraba con las etiquetas a la vista.
 */
function restoreMessage(stored, format) {
  if (format === 'html') return stored;

  // Texto plano: se escapa siempre, no solo cuando hay saltos de línea. Un
  // mensaje de una sola línea con "<" o "&" también se rompería al asignarlo
  // como HTML, y el usuario perdería ese texto sin enterarse.
  return String(stored)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/\r?\n/g, '<br>');
}

/**
 * El cuerpo que se manda a Gmail. Los saltos de línea crudos que `pre-wrap`
 * permite dentro del editor no se ven en un correo `text/html`: sin esta
 * conversión el destinatario recibe todo el mensaje en un solo párrafo
 * corrido, aunque en el editor se viera separado en líneas.
 */
function messageToHtml() {
  return messageInput.innerHTML.replace(/\r?\n/g, '<br>');
}

function saveState() {
  chrome.storage.local.set({
    subject:    subjectInput.value,
    message:    messageInput.innerHTML,
    messageFormat: 'html',
    delaySeconds: delaySeconds.value,
    smtpFrom:   smtpFrom.value,
    recipients
  });
}

function restoreState() {
  // Restos del backend de Apps Script: se limpian una sola vez para no dejar
  // la URL vieja dando vueltas en el storage del cliente.
  chrome.storage.local.remove(['apiKey', 'apiToken']);

  chrome.storage.local.get(null, (state) => {
    if (state.subject       !== undefined) subjectInput.value   = state.subject;
    if (state.message       !== undefined) messageInput.innerHTML = restoreMessage(state.message, state.messageFormat);
    if (state.delaySeconds  !== undefined) delaySeconds.value   = state.delaySeconds;
    if (state.smtpFrom      !== undefined) smtpFrom.value       = state.smtpFrom;

    if (state.recipients && state.recipients.length) {
      // Se filtra también acá y no solo al importar: una lista cargada antes de
      // que se ignoraran las columnas internas sigue guardada con ellas, y sin
      // esto reaparecerían al reabrir el dashboard.
      recipients = DataProcessor.stripIgnoredColumns(state.recipients);
      availableVariables = DataProcessor.getAvailableVariables(recipients);
      updateUIWithContacts();
    }

    // El resumen no puede depender del mensaje `sendComplete`: abrir el panel
    // lateral le saca el foco a este popup y Chrome lo cierra, así que cuando
    // la campaña termina no queda nadie escuchando. Se recupera de la campaña
    // archivada, que es la que además alimenta los botones de descarga.
    const history = state.campaignHistory || [];
    if (history.length > 0) {
      lastCampaign = history[0];
      if (state.campaignFinished) {
        showSummary(summarize(lastCampaign));
        chrome.storage.local.remove('campaignFinished');
      }
    }
  });

  chrome.runtime.sendMessage({ action: 'getState' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (response) {
      if (response.sendInProgress || response.current > 0) {
        setProgress(response.current, response.total, response.status, response.failedEmails || []);
        if (response.sendInProgress) {
          campaignRunning = true;
          isPaused = response.isPaused || false;
          setUIState(response.isPaused ? 'paused' : 'running');
          if (response.quotaExhausted) {
            showQuotaBanner(response.pausedAccount, response.current, response.total);
          }
        } else {
          setUIState('finished');
        }
      }
    }
  });
}

// ─── UI State Machine ─────────────────────────────────────────────────────────
// States: 'idle' | 'running' | 'paused' | 'finished'
function setUIState(state) {
  switch (state) {
    case 'idle':
      sendBtn.style.display = '';
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      resetBtn.style.display = 'none';
      updateSendButtonState();
      break;

    case 'running':
      sendBtn.style.display = 'none';
      pauseBtn.style.display = '';
      resumeBtn.style.display = 'none';
      cancelBtn.style.display = '';
      resetBtn.style.display = 'none';
      progressSection.style.display = '';
      break;

    case 'paused':
      sendBtn.style.display = 'none';
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = '';
      cancelBtn.style.display = '';
      resetBtn.style.display = 'none';
      progressSection.style.display = '';
      break;

    case 'finished':
      sendBtn.style.display = 'none';
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'none';
      cancelBtn.style.display = 'none';
      resetBtn.style.display = '';
      progressSection.style.display = '';
      campaignRunning = false;
      isPaused = false;
      break;
  }
}

// ─── Progress ─────────────────────────────────────────────────────────────────
function setProgress(current, total, message, failedEmails, rowIndex, rowSuccess) {
  const percent = total ? Math.min(100, Math.floor((current / total) * 100)) : 0;
  progressBar.style.width = `${percent}%`;
  progressText.textContent = `${percent}%`;
  statusText.textContent = message || '';

  if (typeof rowIndex === 'number') {
    const statusEl = document.getElementById(`status-row-${rowIndex}`);
    if (statusEl) {
      if (rowSuccess) {
        statusEl.value = 'Enviado ✅';
        statusEl.style.color = '#22c55e';
      } else {
        statusEl.value = 'Error ❌';
        statusEl.style.color = '#ff6b6b';
      }
    }
    const nextEl = document.getElementById(`status-row-${rowIndex + 1}`);
    if (nextEl) {
      nextEl.value = 'Enviando... ⏳';
      nextEl.style.color = '#eab308';
    }
  }

  if (failedEmails && failedEmails.length > 0) {
    currentFailedEmails = failedEmails;
    renderErrors(failedEmails);
  }
}

function renderErrors(failedEmails) {
  errorsContainer.style.display = '';
  toggleErrorsBtn.textContent   = `⚠️ Ver Errores (${failedEmails.length})`;

  errorsList.innerHTML = '';
  failedEmails.forEach(({ email, error }) => {
    const item = document.createElement('div');
    item.className = 'error-item';
    const emailEl = document.createElement('span');
    emailEl.className = 'error-email';
    emailEl.textContent = `✉️ ${email}`;
    const msgEl = document.createElement('span');
    msgEl.className = 'error-msg';
    msgEl.textContent = String(error ?? '');
    item.append(emailEl, msgEl);
    errorsList.appendChild(item);
  });

  copyErrorsBtn.style.display = '';
}

// ─── Confetti ────────────────────────────────────────────────────────────────
function launchConfetti() {
  const canvas = document.createElement('canvas');
  canvas.id = 'confetti-canvas';
  canvas.style.cssText = 'position:fixed;top:0;left:0;width:100%;height:100%;pointer-events:none;z-index:9999;';
  document.body.appendChild(canvas);
  canvas.width  = window.innerWidth;
  canvas.height = window.innerHeight;
  const ctx = canvas.getContext('2d');

  const colors = ['#2ebd59', '#22c55e', '#3b82f6', '#f59e0b', '#8b5cf6', '#ec4899'];
  const particles = Array.from({ length: 90 }, () => ({
    x: Math.random() * canvas.width,
    y: Math.random() * canvas.height - canvas.height,
    r: Math.random() * 7 + 4,
    d: Math.random() * 90,
    color: colors[Math.floor(Math.random() * colors.length)],
    tilt: Math.random() * 10 - 10,
    tiltAngle: 0,
    tiltAngleIncrement: Math.random() * 0.07 + 0.05
  }));

  let frameCount = 0;
  const MAX_FRAMES = 180;

  function draw() {
    ctx.clearRect(0, 0, canvas.width, canvas.height);
    particles.forEach((p) => {
      ctx.beginPath();
      ctx.fillStyle = p.color;
      ctx.globalAlpha = Math.max(0, 1 - frameCount / MAX_FRAMES);
      ctx.ellipse(p.x, p.y, p.r, p.r / 2, p.tilt, 0, 2 * Math.PI);
      ctx.fill();
    });

    frameCount++;
    particles.forEach((p) => {
      p.tiltAngle += p.tiltAngleIncrement;
      p.y += (Math.cos(p.d) + 3 + p.r / 2) / 2;
      p.tilt = Math.sin(p.tiltAngle - frameCount / 3) * 15;
    });

    if (frameCount < MAX_FRAMES) {
      requestAnimationFrame(draw);
    } else {
      canvas.remove();
    }
  }
  draw();
}

// ─── Contactos: import + render tipo tabla ────────────────────────────────────
function updateRecipientCount() {
  recipientCountEl.textContent = `${recipients.length} destinatarios cargados`;
}

function updateUIWithContacts() {
  updateRecipientCount();
  renderVariableTags();
  renderContactList();
  updateSendButtonState();
  saveState();
}

function renderVariableTags() {
  if (availableVariables.length === 0) {
    variablesContainer.style.display = 'none';
    return;
  }
  variablesContainer.style.display = '';
  variableTags.innerHTML = '';
  availableVariables.forEach((variable) => {
    const tag = document.createElement('span');
    tag.className = 'variable-tag';
    tag.textContent = variable;
    // Sin esto, el mousedown sobre el tag le saca el foco al editor y el
    // navegador descarta el caret: la variable terminaba insertándose al final
    // del mensaje en vez de donde el usuario había hecho clic.
    tag.addEventListener('mousedown', (e) => e.preventDefault());
    tag.addEventListener('click', () => insertVariable(variable));
    variableTags.appendChild(tag);
  });
}

/**
 * La variable se inserta donde el usuario dejó el cursor. El `preventDefault`
 * del mousedown de cada tag ya evita que el editor pierda el foco, así que en
 * el caso normal la selección sigue viva; `lastEditorRange` es el respaldo
 * para cuando el foco se fue por otro camino (abrir un modal, cambiar de
 * pestaña), y solo si tampoco hay respaldo se cae al final del mensaje.
 */
function insertVariable(variable) {
  messageInput.focus();

  const selection = window.getSelection();
  const caretIsInEditor = selection.rangeCount > 0 && messageInput.contains(selection.anchorNode);

  if (!caretIsInEditor) {
    const range = lastEditorRange ? lastEditorRange.cloneRange() : document.createRange();
    if (!lastEditorRange) {
      range.selectNodeContents(messageInput);
      range.collapse(false);
    }
    selection.removeAllRanges();
    selection.addRange(range);
  }

  // insertText conserva el formato del texto en el punto de inserción.
  document.execCommand('insertText', false, `{${variable}}`);
  saveState();
}

function renderContactList() {
  // contactsHeaderEl vive DENTRO de contactsListEl (sticky, para que scrollee
  // horizontalmente junto con las filas) - no se debe destruir al limpiar,
  // solo las filas de datos y el mensaje de "vacío".
  Array.from(contactsListEl.children).forEach((child) => {
    if (child !== contactsHeaderEl) child.remove();
  });

  if (recipients.length === 0) {
    contactsHeaderEl.style.display = 'none';
    const empty = document.createElement('div');
    empty.style.cssText = 'text-align: center; color: var(--text-muted); padding: 20px;';
    empty.textContent = 'No hay destinatarios cargados. Importa un Excel para comenzar.';
    contactsListEl.appendChild(empty);
    return;
  }

  contactsHeaderEl.style.display = '';
  contactsHeaderEl.innerHTML = '';
  const numHeader = document.createElement('span');
  numHeader.className = 'contact-row-num';
  numHeader.textContent = '#';
  contactsHeaderEl.appendChild(numHeader);
  availableVariables.forEach((col) => {
    const colHeader = document.createElement('span');
    colHeader.className = 'contact-row-input';
    colHeader.style.background = 'transparent';
    colHeader.style.border = 'none';
    colHeader.textContent = col;
    colHeader.title = col;
    contactsHeaderEl.appendChild(colHeader);
  });
  const statusHeader = document.createElement('span');
  statusHeader.className = 'contact-row-status';
  statusHeader.textContent = 'Estado';
  contactsHeaderEl.appendChild(statusHeader);

  const fragment = document.createDocumentFragment();

  // Límite de renderizado para evitar congelar la interfaz con Excels enormes.
  const maxRender = Math.min(recipients.length, 500);

  for (let i = 0; i < maxRender; i++) {
    const contact = recipients[i];

    const row = document.createElement('div');
    row.className = 'contact-row';

    const numLabel = document.createElement('span');
    numLabel.className = 'contact-row-num';
    numLabel.textContent = `${i + 1}.`;
    row.appendChild(numLabel);

    availableVariables.forEach((col) => {
      const input = document.createElement('input');
      input.type = 'text';
      input.className = 'contact-row-input';
      input.value = contact[col] ?? '';
      input.title = input.value;
      input.readOnly = true;
      row.appendChild(input);
    });

    const statusInput = document.createElement('input');
    statusInput.type = 'text';
    statusInput.className = 'contact-row-input contact-row-status';
    statusInput.id = `status-row-${i}`;
    statusInput.value = 'Pendiente ⏳';
    statusInput.readOnly = true;
    statusInput.style.color = '#a3a3a3';
    statusInput.style.fontWeight = 'bold';
    row.appendChild(statusInput);

    fragment.appendChild(row);
  }

  contactsListEl.appendChild(fragment);

  if (recipients.length > 500) {
    const info = document.createElement('div');
    info.style.cssText = 'text-align:center;padding:12px;color:#38bdf8;font-weight:600;font-size:0.8rem;';
    info.textContent = `⚠️ Solo se muestran las primeras 500 filas. La campaña de todas formas enviará los ${recipients.length} destinatarios.`;
    contactsListEl.appendChild(info);
  }
}

async function handleFileImport(event) {
  const file = event.target.files[0];
  if (!file) return;

  try {
    importBtn.disabled = true;
    importBtn.innerHTML = '<span>⏳</span> Procesando...';

    const imported = await DataProcessor.readContacts(file);
    recipients = [...recipients, ...imported];
    availableVariables = DataProcessor.getAvailableVariables(recipients);
    updateUIWithContacts();
    runEmailAudit();
  } catch (error) {
    alert(error);
  } finally {
    importBtn.disabled = false;
    importBtn.innerHTML = '<span class="icon">📊</span> Importar Excel';
    fileInput.value = '';
  }
}

function clearListHandler() {
  if (recipients.length === 0) return;
  if (confirm('¿Estás seguro de que deseas limpiar la lista de destinatarios?')) {
    recipients = [];
    availableVariables = [];
    omittedRecipients = [];
    auditFindings = [];
    renderAuditBanner();
    updateUIWithContacts();
  }
}

// ─── Imagen adjunta ────────────────────────────────────────────────────────────
async function readFileAsDataURL(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function showImagePreview(dataUrl) {
  if (dataUrl) {
    previewImagen.src = dataUrl;
    previewImagenContainer.style.display = '';
    btnQuitarImagen.style.display = '';
    btnCargarImagen.textContent = 'Cambiar imagen';
  } else {
    previewImagen.src = '';
    previewImagenContainer.style.display = 'none';
    btnQuitarImagen.style.display = 'none';
    btnCargarImagen.textContent = 'Seleccionar imagen';
    inputImagen.value = '';
  }
}

async function handleImagenChange(event) {
  const file = event.target.files[0];
  if (!file) return;

  const MAX_BYTES = 5 * 1024 * 1024;
  const ALLOWED = /^image\/(png|jpeg|jpg|gif|webp)$/i;

  if (!ALLOWED.test(file.type)) {
    alert(`Tipo no permitido: ${file.type || 'desconocido'}. Solo PNG/JPG/GIF/WEBP.`);
    inputImagen.value = '';
    return;
  }
  if (file.size > MAX_BYTES) {
    alert(`Imagen "${file.name}" supera 5 MB. Reducila e intenta de nuevo.`);
    inputImagen.value = '';
    return;
  }

  const dataUrl = await readFileAsDataURL(file);
  attachments = [{ name: file.name, type: file.type, dataUrl }];
  showImagePreview(dataUrl);
}

function handleQuitarImagen() {
  attachments = [];
  showImagePreview('');
}

// ─── PDFs adjuntos ─────────────────────────────────────────────────────────────
const MAX_PDFS = 3;
const MAX_PDF_BYTES = 5 * 1024 * 1024;

function renderPdfList() {
  pdfListEl.innerHTML = '';

  if (pdfAttachments.length === 0) {
    pdfListEl.style.display = 'none';
    return;
  }

  pdfListEl.style.display = '';
  pdfAttachments.forEach((pdf, index) => {
    const chip = document.createElement('div');
    chip.className = 'chip';

    const label = document.createElement('span');
    label.textContent = `📄 ${pdf.name}`;
    chip.appendChild(label);

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'chip-remove';
    removeBtn.title = 'Quitar';
    removeBtn.textContent = '×';
    removeBtn.addEventListener('click', () => {
      pdfAttachments.splice(index, 1);
      renderPdfList();
    });
    chip.appendChild(removeBtn);

    pdfListEl.appendChild(chip);
  });
}

async function handlePdfsChange(event) {
  const files = Array.from(event.target.files || []);
  if (files.length === 0) return;

  for (const file of files) {
    if (pdfAttachments.length >= MAX_PDFS) {
      alert(`Máximo ${MAX_PDFS} archivos PDF por campaña.`);
      break;
    }
    const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
    if (!isPdf) {
      alert(`"${file.name}" no es un PDF.`);
      continue;
    }
    if (file.size > MAX_PDF_BYTES) {
      alert(`"${file.name}" supera 5 MB. Reducilo e intenta de nuevo.`);
      continue;
    }
    const dataUrl = await readFileAsDataURL(file);
    pdfAttachments.push({ name: file.name, type: 'application/pdf', dataUrl });
  }

  renderPdfList();
  inputPdfs.value = '';
}

// ─── Campaign actions ─────────────────────────────────────────────────────────
const MAX_TOTAL_ATTACHMENT_BYTES = 18 * 1024 * 1024;

function updateSendButtonState() {
  sendBtn.disabled = !(recipients.length > 0 && isLicenseAllowed && !!gmailAccount && !campaignRunning);
}

/** Peso aproximado del adjunto a partir del data URL (base64 infla 4/3). */
function estimateAttachmentBytes(list) {
  return list.reduce((total, att) => {
    const base64 = (att.dataUrl.split(',')[1] || '');
    return total + Math.floor(base64.length * 0.75);
  }, 0);
}

/**
 * Abre el panel lateral de monitoreo. Se llama dentro del click de "Iniciar
 * Campaña" porque Chrome solo permite abrirlo en respuesta a un gesto del
 * usuario. Si el navegador es anterior a Chrome 114 no existe la API: la
 * campaña sale igual, solo que sin panel.
 */
function openMonitorPanel() {
  if (!chrome.sidePanel?.open || currentWindowId === null) {
    console.info('[monitor] este Chrome no soporta el panel lateral; la campaña sigue normalmente.');
    return;
  }
  chrome.sidePanel.open({ windowId: currentWindowId })
    .catch((err) => console.warn('[monitor] no se pudo abrir el panel:', err?.message || err));
}

function startSend() {
  if (recipients.length === 0) {
    alert('Importa al menos un destinatario desde Excel.');
    return;
  }
  if (!isLicenseAllowed) {
    alert('Necesitas una licencia activa para iniciar una campaña. Abre "Licencia" en el menú.');
    return;
  }
  if (!gmailAccount) {
    openModal(modalConfiguracion);
    return;
  }

  // Gmail rechaza mensajes de más de 25 MB ya codificados; 18 MB de adjuntos
  // crudos quedan en ~24 MB. Mejor avisar acá que fallar en cada destinatario.
  const totalBytes = estimateAttachmentBytes([...attachments, ...pdfAttachments]);
  if (totalBytes > MAX_TOTAL_ATTACHMENT_BYTES) {
    alert(`Los adjuntos suman ${(totalBytes / 1048576).toFixed(1)} MB. Gmail no acepta más de 18 MB por correo — quita alguno.`);
    return;
  }

  currentFailedEmails = [];
  errorsContainer.style.display = 'none';
  errorsList.style.display      = 'none';
  errorsList.innerHTML          = '';
  toggleErrorsBtn.textContent   = 'Ver Errores (0)';
  copyErrorsBtn.style.display   = 'none';
  hideQuotaBanner();

  document.querySelectorAll('.contact-row-status').forEach((el) => {
    if (el.id?.startsWith('status-row-')) {
      el.value = 'Pendiente ⏳';
      el.style.color = '#a3a3a3';
    }
  });
  const firstStatus = document.getElementById('status-row-0');
  if (firstStatus) {
    firstStatus.value = 'Enviando... ⏳';
    firstStatus.style.color = '#eab308';
  }

  openMonitorPanel();

  setProgress(0, recipients.length, '🚀 Iniciando campaña...', []);
  setUIState('running');
  campaignRunning = true;
  isPaused = false;

  const payload = {
    fromEmail:    smtpFrom.value.replace(/[\r\n]/g, '').slice(0, 100),
    recipients,
    subject:      subjectInput.value,
    message:      messageToHtml(),
    omitted:      omittedRecipients,
    attachments:  [...attachments, ...pdfAttachments],
    delaySeconds: parseInt(delaySeconds.value) || 10
  };

  chrome.runtime.sendMessage({ action: 'startSend', payload }, (response) => {
    if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
    if (response?.error) {
      alert('Error: ' + response.error);
      campaignRunning = false;
      setUIState('idle');
    }
  });
}

function pauseCampaign() {
  chrome.runtime.sendMessage({ action: 'pauseSend' }, () => {});
  isPaused = true;
  setUIState('paused');
  statusText.textContent = '⏸️ Campaña pausada...';
}

function resumeCampaign() {
  chrome.runtime.sendMessage({ action: 'resumeSend' }, () => {});
  isPaused = false;
  setUIState('running');
  statusText.textContent = '▶️ Reanudando envío...';
}

function cancelCampaign() {
  if (!confirm('¿Seguro que deseas cancelar la campaña? Los correos ya enviados no se pueden deshacer.')) return;
  chrome.runtime.sendMessage({ action: 'cancelSend' }, () => {});
  hideQuotaBanner();
  setUIState('finished');
  statusText.textContent = '🛑 Campaña cancelada.';
}

function resetCampaign() {
  campaignRunning = false;
  isPaused = false;
  currentFailedEmails = [];
  progressBar.style.width = '0%';
  progressText.textContent = '0%';
  statusText.textContent = 'Listo para despegar';
  errorsContainer.style.display = 'none';
  errorsList.style.display = 'none';
  errorsList.innerHTML = '';
  progressSection.style.display = 'none';
  setUIState('idle');
  renderContactList();
}

// ─── Modales ───────────────────────────────────────────────────────────────────
function openModal(modal) { modal.style.display = 'flex'; }
function closeModal(modal) { modal.style.display = 'none'; }

document.querySelectorAll('.modal-overlay').forEach((overlay) => {
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) closeModal(overlay);
  });
  overlay.querySelectorAll('.btn-close').forEach((btn) => {
    btn.addEventListener('click', () => closeModal(overlay));
  });
});

navConfiguracion.addEventListener('click', (e) => { e.preventDefault(); openModal(modalConfiguracion); });
btnCerrarConfiguracion.addEventListener('click', () => closeModal(modalConfiguracion));

navSoporte.addEventListener('click', (e) => { e.preventDefault(); openModal(modalSoporte); });

// chrome.tabs.create en vez de dejar que el popup navegue: al cerrarse el
// popup, la pestaña nueva igual se abre en la ventana del navegador.
linkWebSoporte.addEventListener('click', (e) => {
  e.preventDefault();
  chrome.tabs.create({ url: 'https://anomalydevs.qzz.io/' });
});

navLicencia.addEventListener('click', (e) => { e.preventDefault(); openModal(modalLicencia); });
licenseBadge.addEventListener('click', () => openModal(modalLicencia));

// ─── Cuenta de Gmail ─────────────────────────────────────────────────────────
// Todo el OAuth vive en el service worker: este popup se cierra al perder el
// foco, y la ventana de consentimiento de Google se lo roba.
function renderGmailStatus() {
  if (gmailAccount) {
    gmailStatusEl.textContent = `🟢 ${gmailAccount}`;
    btnConectarGmail.textContent = 'Cambiar de cuenta';
    btnDesconectarGmail.style.display = '';
  } else {
    gmailStatusEl.textContent = '🔴 Ninguna cuenta conectada';
    btnConectarGmail.textContent = 'Conectar cuenta de Gmail';
    btnDesconectarGmail.style.display = 'none';
  }
  updateSendButtonState();
}

function refreshGmailStatus() {
  chrome.runtime.sendMessage({ action: 'GMAIL_STATUS' }, (result) => {
    if (chrome.runtime.lastError || !result) return;
    gmailAccount = result.connected ? result.email : null;
    renderGmailStatus();

    // Con licencia activa pero sin cuenta, el siguiente paso obvio es conectar.
    if (!gmailAccount && isLicenseAllowed && !hasPromptedForGmail) {
      hasPromptedForGmail = true;
      openModal(modalConfiguracion);
    }
  });
}

function connectGmail({ selectAccount }) {
  btnConectarGmail.disabled = true;
  btnConectarGmail.textContent = 'Conectando...';
  chrome.runtime.sendMessage({ action: 'GMAIL_CONNECT', selectAccount }, (result) => {
    btnConectarGmail.disabled = false;
    if (chrome.runtime.lastError || !result) {
      renderGmailStatus();
      alert('No se pudo completar la conexión con Google.');
      return;
    }
    gmailAccount = result.email || null;
    renderGmailStatus();
    if (!result.connected) {
      alert(result.error || 'No se pudo conectar la cuenta.');
    }
  });
}

btnConectarGmail.addEventListener('click', () => connectGmail({ selectAccount: !!gmailAccount }));

btnDesconectarGmail.addEventListener('click', () => {
  chrome.runtime.sendMessage({ action: 'GMAIL_DISCONNECT' }, () => {
    gmailAccount = null;
    renderGmailStatus();
  });
});

// ─── Relevo de cuenta por cuota agotada ──────────────────────────────────────
function showQuotaBanner(account, current, total, detail) {
  // El motivo real puede no ser la cuota: un token revocado o el rate limit
  // agotado tras los reintentos también pausan la campaña, y decir siempre
  // "límite diario" mandaría al usuario a buscar el problema donde no está.
  quotaBannerText.textContent =
    `${detail || 'Límite diario alcanzado'} en ${account || 'la cuenta conectada'} — se enviaron ${current} de ${total}. ` +
    `Conectá otra cuenta para continuar desde donde quedó.`;
  quotaBanner.style.display = '';
  setUIState('paused');
  // Reanudar con la misma cuenta volvería a chocar contra el mismo error: la
  // única salida útil es el botón del banner.
  resumeBtn.style.display = 'none';
}

function hideQuotaBanner() {
  quotaBanner.style.display = 'none';
}

btnRelevoCuenta.addEventListener('click', () => {
  btnRelevoCuenta.disabled = true;
  btnRelevoCuenta.textContent = 'Conectando...';
  chrome.runtime.sendMessage({ action: 'GMAIL_CONNECT', selectAccount: true }, (result) => {
    btnRelevoCuenta.disabled = false;
    btnRelevoCuenta.textContent = 'Conectar otra cuenta y continuar';
    if (chrome.runtime.lastError || !result?.connected) {
      alert(result?.error || 'No se pudo conectar la cuenta de relevo.');
      return;
    }
    gmailAccount = result.email || null;
    renderGmailStatus();
    chrome.runtime.sendMessage({ action: 'resumeSend' }, (resumed) => {
      if (chrome.runtime.lastError || !resumed?.success) {
        alert(resumed?.error || 'No se pudo reanudar la campaña.');
        hideQuotaBanner();
        setUIState('finished');
        return;
      }
      hideQuotaBanner();
      isPaused = false;
      setUIState('running');
      statusText.textContent = `▶️ Continuando desde ${gmailAccount}...`;
    });
  });
});

// ─── Licencia ────────────────────────────────────────────────────────────────
const LICENSE_REASON_TEXT = {
  no_license: 'No hay una licencia activada en este dispositivo.',
  not_found: 'La clave de licencia ingresada no existe.',
  pending: 'La licencia aún no ha iniciado su vigencia.',
  expired: 'La licencia ha vencido.',
  suspended: 'La licencia está suspendida.',
  device_not_registered: 'Este dispositivo no está registrado en la licencia.',
  device_limit_reached: 'Se alcanzó el cupo máximo de dispositivos de esta licencia.',
  offline_grace_expired: 'No se pudo validar la licencia con el servidor y venció el margen de 48h sin conexión.',
  network_error: 'No se pudo contactar al servidor de licencias.',
  invalid_state: 'Estado de licencia inconsistente. Vuelve a activarla.'
};

function renderLicenseBadge(result) {
  if (result.allowed) {
    const soonToExpire = typeof result.daysRemaining === 'number' && result.daysRemaining <= 30;
    licenseBadge.textContent = soonToExpire
      ? `🟡 ${result.companyName} — vence en ${result.daysRemaining} día(s)`
      : `🟢 ${result.companyName} — ${result.daysRemaining} día(s) restantes`;
  } else {
    licenseBadge.textContent = `🔴 ${LICENSE_REASON_TEXT[result.reason] || 'Licencia no válida.'}`;
  }

  licenseInfo.textContent = result.allowed
    ? `Empresa: ${result.companyName}\nVigente hasta: ${result.endDate}\nDías restantes: ${result.daysRemaining}`
    : LICENSE_REASON_TEXT[result.reason] || 'Licencia no válida.';
}

function refreshLicenseStatus() {
  chrome.runtime.sendMessage({ action: 'LICENSE_STATUS' }, (result) => {
    if (chrome.runtime.lastError || !result) return;
    isLicenseAllowed = result.allowed === true;
    renderLicenseBadge(result);
    updateSendButtonState();

    if (!hasPromptedForLicense && result.reason === 'no_license') {
      hasPromptedForLicense = true;
      openModal(modalLicencia);
    }
  });
}

btnActivarLicencia.addEventListener('click', () => {
  const key = (inputLicenseKey.value || '').trim();
  if (!key) {
    alert('Ingresa una clave de licencia.');
    return;
  }
  btnActivarLicencia.disabled = true;
  btnActivarLicencia.textContent = 'Activando...';
  chrome.runtime.sendMessage({ action: 'LICENSE_ACTIVATE', licenseKey: key }, (result) => {
    btnActivarLicencia.disabled = false;
    btnActivarLicencia.textContent = 'Activar';
    if (chrome.runtime.lastError || !result) {
      alert('No se pudo contactar al servidor de licencias. Intenta de nuevo.');
      return;
    }
    isLicenseAllowed = result.allowed === true;
    renderLicenseBadge(result);
    updateSendButtonState();
    if (result.allowed) {
      alert(`Licencia activada: ${result.companyName}. Vigente hasta ${result.endDate}.`);
      closeModal(modalLicencia);
    } else {
      alert(LICENSE_REASON_TEXT[result.reason] || 'No se pudo activar la licencia.');
    }
  });
});

// ─── Toggle error panel ───────────────────────────────────────────────────────
toggleErrorsBtn.addEventListener('click', () => {
  const isVisible = errorsList.style.display !== 'none';
  errorsList.style.display    = isVisible ? 'none' : '';
  copyErrorsBtn.style.display = isVisible ? 'none' : '';
  toggleErrorsBtn.textContent = isVisible
    ? `⚠️ Ver Errores (${currentFailedEmails.length})`
    : `🔼 Ocultar Errores (${currentFailedEmails.length})`;
});

copyErrorsBtn.addEventListener('click', () => {
  const text = currentFailedEmails.map(f => f.email).join('\n');
  navigator.clipboard.writeText(text).then(() => {
    copyErrorsBtn.textContent = '✅ ¡Copiado!';
    setTimeout(() => { copyErrorsBtn.textContent = 'Copiar Correos Fallidos'; }, 2000);
  });
});

// ─── Event Listeners ─────────────────────────────────────────────────────────
importBtn.addEventListener('click', () => fileInput.click());
fileInput.addEventListener('change', handleFileImport);
clearListBtn.addEventListener('click', clearListHandler);

btnCargarImagen.addEventListener('click', () => inputImagen.click());
inputImagen.addEventListener('change', handleImagenChange);
btnQuitarImagen.addEventListener('click', handleQuitarImagen);

btnCargarPdfs.addEventListener('click', () => inputPdfs.click());
inputPdfs.addEventListener('change', handlePdfsChange);

sendBtn.addEventListener('click', startSend);
pauseBtn.addEventListener('click', pauseCampaign);
resumeBtn.addEventListener('click', resumeCampaign);
cancelBtn.addEventListener('click', cancelCampaign);
resetBtn.addEventListener('click', resetCampaign);

// messageInput queda fuera a propósito: es un contenteditable, no dispara
// 'change', y con 'keyup' además se guardaba dos veces por tecla —y cada
// guardado reserializa la lista entera de destinatarios.
const syncInputs = [subjectInput, delaySeconds, smtpFrom];
syncInputs.forEach(el => {
  el.addEventListener('change', saveState);
  if (el.type !== 'checkbox') el.addEventListener('keyup', saveState);
});

// 'input' es el único evento que cubre todo lo que puede cambiar el editor:
// tipeo, pegado, arrastre de texto y los botones de formato.
messageInput.addEventListener('input', saveState);

// Toolbar de formato. mousedown con preventDefault evita que el clic robe la
// selección al editor, y execCommand aplica el formato al texto seleccionado.
document.querySelectorAll('.fmt-btn').forEach((btn) => {
  btn.addEventListener('mousedown', (e) => e.preventDefault());
  btn.addEventListener('click', () => {
    messageInput.focus();
    document.execCommand(btn.dataset.cmd, false, btn.dataset.value || null);
    saveState();
  });
});

// ─── Revisión previa de direcciones ──────────────────────────────────────────
// Detecta antes de enviar lo que la API de Gmail no avisa: un 200 al enviar
// solo significa "lo acepté para entregar", y el rebote llega después como
// correo del mailer-daemon a la bandeja, fuera del alcance de la extensión.

/**
 * Direcciones marcadas por la revisión, con el motivo. Se usan para excluirlas
 * del envío y, sobre todo, para que queden en el reporte como omitidas.
 */
let auditFindings = [];

function renderAuditBanner() {
  // Bloque de las excluidas automáticamente (los correos de relleno).
  const autoExcluidas = omittedRecipients.filter((o) => o.auto);
  if (autoExcluidas.length > 0) {
    auditExcludedTitle.textContent = `⊘ ${autoExcluidas.length} ${autoExcluidas.length === 1 ? 'correo de relleno excluido' : 'correos de relleno excluidos'}`;
    auditExcludedList.innerHTML = '';
    autoExcluidas.forEach((item) => {
      const row = document.createElement('div');
      row.textContent = item.email;
      auditExcludedList.appendChild(row);
    });
    auditExcludedBlock.style.display = '';
  } else {
    auditExcludedBlock.style.display = 'none';
  }

  // Bloque de las dudosas, que decide el usuario.
  if (auditFindings.length > 0) {
    auditTitle.textContent = `⚠️ ${auditFindings.length} ${auditFindings.length === 1 ? 'dirección sospechosa' : 'direcciones sospechosas'}`;
    auditStatus.textContent = 'no se han enviado todavía';
    auditList.innerHTML = '';

    auditFindings.forEach((finding) => {
      const row = document.createElement('div');
      const detalle = finding.suggestion
        ? `¿quisiste decir ${finding.suggestion}?`
        : PROBLEM_LABELS[finding.problem] || 'Dirección dudosa';
      row.textContent = `${finding.email} → ${detalle}`;
      row.style.color = finding.suggestion ? 'var(--text-main)' : '#fbbf24';
      auditList.appendChild(row);
    });

    // Corregir solo tiene sentido si hay typos con sugerencia.
    btnAuditCorregir.style.display = auditFindings.some((f) => f.suggestion) ? '' : 'none';
    auditSuspectBlock.style.display = '';
  } else {
    auditSuspectBlock.style.display = 'none';
  }

  auditBanner.style.display = (autoExcluidas.length > 0 || auditFindings.length > 0) ? '' : 'none';
}

async function runEmailAudit() {
  if (recipients.length === 0) {
    auditFindings = [];
    renderAuditBanner();
    return;
  }

  auditBanner.style.display = '';
  auditSuspectBlock.style.display = '';
  auditTitle.textContent = 'Revisando las direcciones...';
  auditStatus.textContent = '';
  auditList.innerHTML = '';

  const hallazgos = await auditEmails(recipients.map((r) => resolveEmail(r)));

  // Los correos de relleno se sacan del envío sin preguntar: no son un cliente
  // al que se le pueda escribir, son el hueco que dejó quien cargó la planilla.
  // Los demás casos sí se consultan, porque un dominio mal escrito se puede
  // corregir y uno dudoso podría ser un cliente bueno.
  const relleno = new Set(hallazgos.filter((f) => f.problem === 'relleno').map((f) => f.email));
  if (relleno.size > 0) {
    const nuevasExclusiones = recipients
      .filter((r) => relleno.has(resolveEmail(r)))
      .map((r) => ({
        email: resolveEmail(r),
        reason: PROBLEM_LABELS.relleno,
        contactData: r,
        auto: true
      }));

    omittedRecipients = [...omittedRecipients, ...nuevasExclusiones];
    recipients = recipients.filter((r) => !relleno.has(resolveEmail(r)));
    availableVariables = DataProcessor.getAvailableVariables(recipients);
    updateUIWithContacts();
  }

  auditFindings = hallazgos.filter((f) => f.problem !== 'relleno');
  renderAuditBanner();
}

/** Devuelve al envío los correos de relleno que se habían excluido solos. */
function reincluirRelleno() {
  const devueltos = omittedRecipients.filter((o) => o.auto);
  if (devueltos.length === 0) return;

  recipients = [...recipients, ...devueltos.map((o) => o.contactData)];
  omittedRecipients = omittedRecipients.filter((o) => !o.auto);
  availableVariables = DataProcessor.getAvailableVariables(recipients);
  updateUIWithContacts();
  renderAuditBanner();
}

/** Aplica las correcciones de dominio sobre la columna de correo del contacto. */
function corregirDirecciones() {
  const correcciones = new Map(
    auditFindings.filter((f) => f.suggestion).map((f) => [f.email, applySuggestion(f.email, f.suggestion)])
  );

  recipients = recipients.map((recipient) => {
    const key = resolveEmailKey(recipient);
    if (!key) return recipient;
    const corregido = correcciones.get(String(recipient[key] || '').trim());
    return corregido ? { ...recipient, [key]: corregido } : recipient;
  });

  updateUIWithContacts();
  runEmailAudit();
}

/**
 * Saca del envío las direcciones marcadas, pero las conserva para mandarlas al
 * registro de la campaña: el historial tiene que mostrar por qué no se les
 * escribió, no simplemente omitirlas.
 */
function excluirDirecciones() {
  const marcadas = new Map(auditFindings.map((f) => [
    f.email,
    f.suggestion ? `Dominio mal escrito (¿${f.suggestion}?)` : (PROBLEM_LABELS[f.problem] || 'Dirección dudosa')
  ]));

  // Se agregan a las que ya estaban excluidas —los correos de relleno salen
  // solos al importar—: reasignar la lista las borraría y volverían al envío.
  const nuevasExclusiones = recipients
    .filter((r) => marcadas.has(resolveEmail(r)))
    .map((r) => ({ email: resolveEmail(r), reason: marcadas.get(resolveEmail(r)), contactData: r }));

  omittedRecipients = [...omittedRecipients, ...nuevasExclusiones];
  recipients = recipients.filter((r) => !marcadas.has(resolveEmail(r)));

  auditFindings = [];
  renderAuditBanner();
  availableVariables = DataProcessor.getAvailableVariables(recipients);
  updateUIWithContacts();
}

btnAuditReincluir.addEventListener('click', reincluirRelleno);
btnAuditCorregir.addEventListener('click', corregirDirecciones);
btnAuditExcluir.addEventListener('click', excluirDirecciones);
btnAuditIgnorar.addEventListener('click', () => {
  auditFindings = [];
  renderAuditBanner();
});

// ─── Reporte e historial ─────────────────────────────────────────────────────

/**
 * Descarga un Blob. En una página de extensión alcanza con un <a download>
 * sintético; el object URL se revoca enseguida para no retener memoria.
 */
function triggerDownload(blob, filename) {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function downloadCSV(campaign) {
  const report = buildReportRows(campaign);
  if (report.headers.length === 0) {
    alert('Esa campaña no tiene resultados para exportar.');
    return;
  }
  const blob = new Blob([toCSV(report)], { type: 'text/csv;charset=utf-8;' });
  triggerDownload(blob, buildFileName(campaign, 'csv'));
}

/**
 * .xlsx nativo con el SheetJS que ya viene incluido para importar. El
 * aplicativo hermano de SMS genera una tabla HTML con extensión .xls y por eso
 * Excel avisa que el formato no coincide con la extensión cada vez que se
 * abre; acá el archivo es legítimo.
 */
function downloadXLSX(campaign) {
  const report = buildReportRows(campaign);
  if (report.headers.length === 0) {
    alert('Esa campaña no tiene resultados para exportar.');
    return;
  }
  const worksheet = XLSX.utils.aoa_to_sheet([report.headers, ...report.rows]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, 'Reporte');
  const output = XLSX.write(workbook, { bookType: 'xlsx', type: 'array' });
  const blob = new Blob([output], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  triggerDownload(blob, buildFileName(campaign, 'xlsx'));
}

function showSummary(summary) {
  resumenEnviados.textContent   = summary?.enviados ?? 0;
  resumenErrores.textContent    = summary?.errores ?? 0;
  resumenPendientes.textContent = summary?.pendientes ?? 0;

  // Las omitidas solo se muestran si las hubo: en la mayoría de las campañas
  // esta cifra es cero y ocupar lugar con un cero es ruido.
  const omitidos = summary?.omitidos ?? 0;
  resumenOmitidos.textContent = omitidos;
  resumenOmitidosBloque.style.display = omitidos > 0 ? '' : 'none';

  openModal(modalResumen);
}

function renderHistory(history) {
  historialLista.innerHTML = '';

  if (!history || history.length === 0) {
    const empty = document.createElement('p');
    empty.style.cssText = 'text-align: center; color: var(--text-muted); padding: 20px 0;';
    empty.textContent = 'Todavía no hay campañas guardadas.';
    historialLista.appendChild(empty);
    btnBorrarHistorial.style.display = 'none';
    return;
  }

  btnBorrarHistorial.style.display = '';

  history.forEach((campaign) => {
    const enviados = (campaign.results || []).filter((r) => r.status === 'enviado').length;
    const errores  = (campaign.results || []).filter((r) => r.status === 'error').length;

    const item = document.createElement('div');
    item.style.cssText = 'padding: 12px; margin-bottom: 10px; background: var(--bg-tertiary); border: 1px solid var(--border-color); border-radius: var(--radius-md);';

    const header = document.createElement('div');
    header.style.cssText = 'display: flex; justify-content: space-between; align-items: center; gap: 10px;';

    const info = document.createElement('div');
    const date = document.createElement('div');
    date.style.cssText = 'font-weight: 600; color: var(--text-main);';
    date.textContent = new Date(campaign.date).toLocaleString('es-EC');
    const detail = document.createElement('div');
    detail.style.cssText = 'font-size: 0.8rem; color: var(--text-muted); margin-top: 3px;';
    detail.textContent = `${campaign.total} destinatarios · ✅ ${enviados} · ❌ ${errores} · ${campaign.status}`;
    info.append(date, detail);

    const actions = document.createElement('div');
    actions.style.cssText = 'display: flex; gap: 6px;';

    const btnCsv = document.createElement('button');
    btnCsv.className = 'btn btn-muted';
    btnCsv.style.cssText = 'padding: 5px 10px; font-size: 0.75rem;';
    btnCsv.textContent = '📄 CSV';
    btnCsv.addEventListener('click', () => downloadCSV(campaign));

    const btnXlsx = document.createElement('button');
    btnXlsx.className = 'btn btn-muted';
    btnXlsx.style.cssText = 'padding: 5px 10px; font-size: 0.75rem;';
    btnXlsx.textContent = '📊 Excel';
    btnXlsx.addEventListener('click', () => downloadXLSX(campaign));

    actions.append(btnCsv, btnXlsx);
    header.append(info, actions);
    item.appendChild(header);
    historialLista.appendChild(item);
  });
}

function openHistory() {
  chrome.runtime.sendMessage({ action: 'HISTORY_LIST' }, (response) => {
    if (chrome.runtime.lastError) return;
    renderHistory(response?.history || []);
    openModal(modalHistorial);
  });
}

navHistorial.addEventListener('click', (e) => { e.preventDefault(); openHistory(); });

btnBorrarHistorial.addEventListener('click', () => {
  if (!confirm('¿Borrar todo el historial de campañas? No se puede deshacer.')) return;
  chrome.runtime.sendMessage({ action: 'HISTORY_CLEAR' }, () => {
    if (chrome.runtime.lastError) return;
    renderHistory([]);
  });
});

/**
 * Descarga el avance de la campaña que está pausada, sin cerrarla. Sirve para
 * ver quién ya recibió el correo y desde qué destinatario retomar con la otra
 * cuenta; los que faltan salen como Pendiente, en el mismo orden del Excel.
 */
function descargarAvance(formato) {
  chrome.runtime.sendMessage({ action: 'CAMPAIGN_SNAPSHOT' }, (response) => {
    if (chrome.runtime.lastError) return;
    if (!response?.campaign) {
      alert('No hay una campaña en curso de la que descargar el avance.');
      return;
    }
    if (formato === 'csv') downloadCSV(response.campaign);
    else downloadXLSX(response.campaign);
  });
}

btnAvanceCSV.addEventListener('click', () => descargarAvance('csv'));
btnAvanceXLSX.addEventListener('click', () => descargarAvance('xlsx'));

btnCerrarResumen.addEventListener('click', () => closeModal(modalResumen));
btnResumenCSV.addEventListener('click', () => { if (lastCampaign) downloadCSV(lastCampaign); });
btnResumenXLSX.addEventListener('click', () => { if (lastCampaign) downloadXLSX(lastCampaign); });

// ─── Background message listener ──────────────────────────────────────────────
chrome.runtime.onMessage.addListener((message) => {
  if (message?.action === 'sendProgress') {
    setProgress(message.current, message.total, message.status, message.failedEmails || [], message.rowIndex, message.rowSuccess);
    if (message.isPaused) {
      setUIState('paused');
    }
  }

  if (message?.action === 'sendComplete') {
    setProgress(message.current, message.total, message.status, message.failedEmails || []);
    setUIState('finished');

    // Este popup solo sigue vivo si el panel lateral no llegó a abrirse (p. ej.
    // en un Chrome anterior al 114). Cuando pasa, se muestra el resumen acá
    // mismo y se baja la marca para que no vuelva a aparecer al reabrirlo.
    if (message.campaign) {
      lastCampaign = message.campaign;
      showSummary(message.summary);
      chrome.storage.local.remove('campaignFinished');
    }

    const success = !message.isCancelled && (!message.failedEmails || message.failedEmails.length === 0);
    if (success && message.total > 0) {
      launchConfetti();
    }
  }

  if (message?.action === 'quotaExhausted') {
    campaignRunning = true;
    isPaused = true;
    setProgress(message.current, message.total, message.status, message.failedEmails || []);
    showQuotaBanner(message.account, message.current, message.total, message.detail);
  }
});

// ─── Initialization ───────────────────────────────────────────────────────────
setUIState('idle');
restoreState();
refreshLicenseStatus();
refreshGmailStatus();
setInterval(refreshLicenseStatus, 60000);
