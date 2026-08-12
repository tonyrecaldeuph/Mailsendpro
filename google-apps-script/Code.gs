/**
 * ============================================================
 *  MAILER PRO - Google Apps Script Backend
 * ============================================================
 *  Recibe POST desde la extension y envia via Gmail.
 *  - Licencia: valida license_key + device_id contra el mismo
 *    backend de licencias que usa la extension (licencias.
 *    anomalydevs.qzz.io) antes de enviar. Cachea el resultado
 *    15 min via PropertiesService para no golpear el servidor
 *    de licencias en cada correo de una campana grande.
 *    Fail-closed: si no se puede verificar, NO se envia.
 *  - Rate limiting: max 60 correos/hora (protege contra loops
 *    descontrolados y limites de Gmail)
 *  - Imagenes: se embeben inline en el cuerpo del correo (cid)
 *  - PDFs: se adjuntan como archivo real (no se embeben)
 * ============================================================
 *
 *  Sin SHARED_TOKEN manual: la licencia ya cumple ese rol (cada
 *  cliente activa su license_key una sola vez en la extension,
 *  nada que generar/sincronizar a mano por instalacion). Este
 *  mismo Code.gs sirve para todos los clientes sin modificarlo.
 */

const LICENSE_API_BASE      = 'https://licencias.anomalydevs.qzz.io/api/v1';
const LICENSE_CACHE_MINUTES = 15;

const MAX_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_ATTACHMENTS      = 4; // 1 imagen embebida + hasta 3 PDFs adjuntos
const RATE_LIMIT_PER_HOUR  = 60;

// ── Rate limiting via PropertiesService ──────────────────────
function checkRateLimit() {
  const props = PropertiesService.getScriptProperties();
  const now   = Date.now();
  const windowMs = 60 * 60 * 1000;

  const raw    = props.getProperty('rl_data');
  const rlData = raw ? JSON.parse(raw) : { windowStart: now, count: 0 };

  if (now - rlData.windowStart > windowMs) {
    rlData.windowStart = now;
    rlData.count = 0;
  }

  if (rlData.count >= RATE_LIMIT_PER_HOUR) {
    const resetIn = Math.ceil((windowMs - (now - rlData.windowStart)) / 60000);
    return { allowed: false, resetInMinutes: resetIn };
  }

  rlData.count += 1;
  props.setProperty('rl_data', JSON.stringify(rlData));
  return { allowed: true };
}

// ── Validacion de licencia (reemplaza al SHARED_TOKEN manual) ───
function checkLicense(licenseKey, deviceId) {
  if (!licenseKey || !deviceId) {
    return { allowed: false, reason: 'missing_license' };
  }

  const props = PropertiesService.getScriptProperties();
  const cacheKey = 'lic_' + licenseKey + '_' + deviceId;
  const cacheWindowMs = LICENSE_CACHE_MINUTES * 60 * 1000;

  const cachedRaw = props.getProperty(cacheKey);
  if (cachedRaw) {
    const cached = JSON.parse(cachedRaw);
    if (Date.now() - cached.validatedAt < cacheWindowMs) {
      return { allowed: true };
    }
  }

  try {
    const response = UrlFetchApp.fetch(LICENSE_API_BASE + '/validate', {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ license_key: licenseKey, device_id: deviceId }),
      muteHttpExceptions: true
    });

    if (response.getResponseCode() !== 200) {
      return { allowed: false, reason: 'license_invalid' };
    }

    const body = JSON.parse(response.getContentText());
    if (body.status !== 'active') {
      return { allowed: false, reason: body.status || 'license_invalid' };
    }

    props.setProperty(cacheKey, JSON.stringify({ validatedAt: Date.now() }));
    return { allowed: true };
  } catch (err) {
    // Fail-closed: si el servidor de licencias no responde, no se envia.
    // Mas seguro que dejar pasar un correo sin poder confirmar la licencia.
    return { allowed: false, reason: 'license_check_failed' };
  }
}

function sanitizeFilename(s) {
  return String(s).replace(/[\r\n\/\\]/g, '_').slice(0, 120);
}

function doPost(e) {
  try {
    const rate = checkRateLimit();
    if (!rate.allowed) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Rate limit alcanzado. Espera ' + rate.resetInMinutes + ' min.' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const data = JSON.parse(e.postData.contents);

    const license = checkLicense(data.licenseKey, data.deviceId);
    if (!license.allowed) {
      return ContentService
        .createTextOutput(JSON.stringify({ error: 'Licencia no valida (' + license.reason + ')' }))
        .setMimeType(ContentService.MimeType.JSON);
    }

    const recipientEmail = data.to;
    const subject = data.subject || '(Sin asunto)';
    const htmlBody = data.html || '';
    const fromName = data.fromName || '';

    const imageBlobs = [];
    const fileBlobs = [];
    if (data.attachments && data.attachments.length > 0) {
      if (data.attachments.length > MAX_ATTACHMENTS) {
        return ContentService
          .createTextOutput(JSON.stringify({ error: 'Too many attachments' }))
          .setMimeType(ContentService.MimeType.JSON);
      }
      for (let i = 0; i < data.attachments.length; i++) {
        const att = data.attachments[i];
        const decoded = Utilities.base64Decode(att.content);
        if (decoded.length > MAX_ATTACHMENT_BYTES) {
          return ContentService
            .createTextOutput(JSON.stringify({ error: 'Attachment too large' }))
            .setMimeType(ContentService.MimeType.JSON);
        }
        const type = att.type || 'image/png';
        const isImage = /^image\//i.test(type);
        const defaultName = isImage ? 'image.png' : 'documento.pdf';
        const filename = sanitizeFilename(att.filename || defaultName);
        const blob = Utilities.newBlob(decoded, type, filename);
        if (isImage) {
          imageBlobs.push(blob);
        } else {
          fileBlobs.push(blob);
        }
      }
    }

    // Las imagenes se embeben inline en el cuerpo via cid. Los PDFs (y
    // cualquier otro archivo no-imagen) NO se embeben - solo van como
    // adjunto real, porque un <img> apuntando a un PDF no renderiza nada.
    const inlineImages = {};
    let finalHtml = htmlBody;

    if (imageBlobs.length > 0) {
      imageBlobs.forEach(function (blob, idx) {
        inlineImages['img' + idx] = blob;
      });
      let imgTags = '';
      Object.keys(inlineImages).forEach(function (cid) {
        imgTags += '<br/><img src="cid:' + cid + '" style="max-width:100%;height:auto;" />';
      });
      finalHtml += imgTags;
    }

    const allAttachments = imageBlobs.concat(fileBlobs);
    const mailOptions = {
      htmlBody: finalHtml,
      name: fromName || undefined,
      inlineImages: inlineImages
    };

    if (allAttachments.length > 0) {
      mailOptions.attachments = allAttachments;
    }

    GmailApp.sendEmail(recipientEmail, subject, '', mailOptions);

    return ContentService
      .createTextOutput(JSON.stringify({ success: true }))
      .setMimeType(ContentService.MimeType.JSON);

  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ error: error.message }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({
      status: 'ok',
      message: 'Mailer Pro Backend activo'
    }))
    .setMimeType(ContentService.MimeType.JSON);
}
