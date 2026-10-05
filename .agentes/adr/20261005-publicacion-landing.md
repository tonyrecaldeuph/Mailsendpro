# ADR — Publicación de MailerPro 3.3.0 en la landing

**Fecha:** 2026-10-05 · **Estado:** aceptada

## Contexto

MailerPro se distribuye como sus hermanas (SMS_RCS_PRO, TelegramProSend): un zip
descargable desde `anomalydevs.qzz.io/files/` y una página de producto en
`/productos/<slug>/`. A diferencia de ellas, MailerPro depende de una app OAuth
de Google sin verificar, cuyo cupo es de 100 consentimientos **de por vida**.
Un link público convierte ese cupo en un recurso que cualquiera puede gastar.

## Decisión

1. **Conectar Gmail exige licencia vigente** (`computeGmailConnectGate` en
   `ui/licenseGate.js`, aplicado en el handler `GMAIL_CONNECT`). Sin licencia no
   se abre el consentimiento de Google.
2. **Zip por lista blanca** (`scripts/empaquetar.js`): solo `manifest.json`,
   `background.js`, `INSTRUCCIONES.md`, `ui/**` y los `.png` de `assets/`. Los
   `.pem` se rechazan aunque estén dentro de una carpeta permitida.
3. **Nombre versionado** `MailerPro-<versión>.zip`, por la caché de 4 h de
   Cloudflare sobre `/files/*` (lección de SMS_RCS_PRO 3.0.1).
4. Se publica con la función "retomar campaña" incluida (decisión del dueño del
   producto), sin haberla probado aún en el navegador.
5. Las licencias siguen como producto `sms`: el licensing-server solo acepta
   `sms` y `telegram`, y MailerPro no envía `product`. Una licencia de SMS PRO
   activa también MailerPro. Pendiente: producto `mailer` propio.

## Consecuencias (trade-offs)

- **Seguridad > simplicidad de onboarding:** el cliente tiene que activar la
  licencia antes de conectar Gmail. Es un paso más, pero el orden ya era ese en
  `INSTRUCCIONES.md`.
- **Lista blanca:** un archivo nuevo necesario en la raíz no entra hasta
  agregarlo al empaquetador. Preferible a filtrar la clave por omisión.
- **Riesgo aceptado:** "retomar campaña" sale sin smoke test en Chrome.
- **Riesgo aceptado:** licencias intercambiables entre SMS y Mailer.

## Métricas

- **Big O:** empaquetado O(n) sobre los archivos del release (≈30).
- **Big I:** publicar una versión = `npm run empaquetar` + copiar el zip a la
  landing + 1 PR + `git pull && docker compose up -d --build`. I(4), igual que
  las hermanas.
