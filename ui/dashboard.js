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

// Configuración (antes "Enlace Mágico")
const navConfiguracion  = document.getElementById('nav-configuracion');
const modalConfiguracion = document.getElementById('modal-configuracion');
const btnCerrarConfiguracion = document.getElementById('btn-cerrar-configuracion');
const apiKeyInput       = document.getElementById('apiKey');
const apiTokenInput     = document.getElementById('apiToken');
const smtpFrom          = document.getElementById('smtpFrom');

// Soporte
const navSoporte        = document.getElementById('nav-soporte');
const modalSoporte       = document.getElementById('modal-soporte');

// Licencia
const navLicencia       = document.getElementById('nav-licencia');
const modalLicencia      = document.getElementById('modal-licencia');
const licenseBadge      = document.getElementById('license-badge');
const licenseInfo       = document.getElementById('license-info');
const inputLicenseKey   = document.getElementById('input-license-key');
const btnActivarLicencia = document.getElementById('btn-activar-licencia');

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

// ─── Persistence ─────────────────────────────────────────────────────────────
function saveState() {
  chrome.storage.local.set({
    subject:    subjectInput.value,
    message:    messageInput.value,
    delaySeconds: delaySeconds.value,
    smtpFrom:   smtpFrom.value,
    apiKey:     apiKeyInput.value,
    apiToken:   apiTokenInput.value,
    recipients
  });
}

function restoreState() {
  chrome.storage.local.get(null, (state) => {
    if (state.subject       !== undefined) subjectInput.value   = state.subject;
    if (state.message       !== undefined) messageInput.value   = state.message;
    if (state.delaySeconds  !== undefined) delaySeconds.value   = state.delaySeconds;
    if (state.smtpFrom      !== undefined) smtpFrom.value       = state.smtpFrom;
    if (state.apiKey !== undefined) apiKeyInput.value = state.apiKey;
    if (state.apiToken !== undefined) apiTokenInput.value = state.apiToken;

    if (state.recipients && state.recipients.length) {
      recipients = state.recipients;
      availableVariables = DataProcessor.getAvailableVariables(recipients);
      updateUIWithContacts();
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
    tag.addEventListener('click', () => insertVariable(variable));
    variableTags.appendChild(tag);
  });
}

function insertVariable(variable) {
  const start = messageInput.selectionStart;
  const end = messageInput.selectionEnd;
  const text = messageInput.value;
  const before = text.substring(0, start);
  const after = text.substring(end);

  messageInput.value = `${before}{${variable}}${after}`;
  messageInput.focus();
  messageInput.selectionStart = messageInput.selectionEnd = start + variable.length + 2;
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
function updateSendButtonState() {
  sendBtn.disabled = !(recipients.length > 0 && isLicenseAllowed && !campaignRunning);
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
  if (!apiKeyInput.value) {
    alert('Configuración incompleta. Abre "Configuración" y pega la URL de Google Script.');
    return;
  }
  // El Token de Seguridad es opcional: el backend estándar no lo valida (ver
  // INSTRUCCIONES.md). Se sigue enviando si está cargado, por si el usuario
  // configuró un SHARED_TOKEN propio en su copia del script.

  currentFailedEmails = [];
  errorsContainer.style.display = 'none';
  errorsList.style.display      = 'none';
  errorsList.innerHTML          = '';
  toggleErrorsBtn.textContent   = 'Ver Errores (0)';
  copyErrorsBtn.style.display   = 'none';

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

  setProgress(0, recipients.length, '🚀 Iniciando campaña...', []);
  setUIState('running');
  campaignRunning = true;
  isPaused = false;

  const payload = {
    apiKey:       apiKeyInput.value,
    apiToken:     apiTokenInput.value,
    fromEmail:    smtpFrom.value.replace(/[\r\n]/g, '').slice(0, 100),
    recipients,
    subject:      subjectInput.value,
    message:      messageInput.value,
    attachments:  [...attachments, ...pdfAttachments],
    delaySeconds: parseInt(delaySeconds.value) || 10
  };

  chrome.runtime.sendMessage({ action: 'startSend', payload }, (response) => {
    if (chrome.runtime.lastError) console.warn(chrome.runtime.lastError.message);
    if (response?.error) alert('Error: ' + response.error);
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

navLicencia.addEventListener('click', (e) => { e.preventDefault(); openModal(modalLicencia); });
licenseBadge.addEventListener('click', () => openModal(modalLicencia));

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

// ─── Toggle password visibility ───────────────────────────────────────────────
function attachToggle(btnId, inputEl) {
  const btn = document.getElementById(btnId);
  if (!btn) return;
  btn.addEventListener('click', (e) => {
    e.preventDefault();
    if (inputEl.type === 'password') {
      inputEl.type = 'text';
      btn.textContent = '🙈';
    } else {
      inputEl.type = 'password';
      btn.textContent = '👁️';
    }
  });
}
attachToggle('togglePass', apiKeyInput);
attachToggle('toggleToken', apiTokenInput);

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

const syncInputs = [subjectInput, messageInput, delaySeconds, smtpFrom, apiKeyInput, apiTokenInput];
syncInputs.forEach(el => {
  el.addEventListener('change', saveState);
  if (el.type !== 'checkbox') el.addEventListener('keyup', saveState);
});

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

    const success = !message.isCancelled && (!message.failedEmails || message.failedEmails.length === 0);
    if (success && message.total > 0) {
      launchConfetti();
    }
  }
});

// ─── Initialization ───────────────────────────────────────────────────────────
setUIState('idle');
restoreState();
refreshLicenseStatus();
setInterval(refreshLicenseStatus, 60000);
