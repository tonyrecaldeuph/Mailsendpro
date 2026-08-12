# MailerPro — Envío directo por Gmail API con relevo de cuentas

**Fecha:** 2026-08-12
**Estado:** Aprobado (decisiones confirmadas por el usuario durante brainstorming)

## 1. Contexto y problema

MailerPro envía hoy a través de un backend propio de cada cliente en Google Apps Script. Eso obliga a un setup de veinte pasos (crear proyecto, pegar `Code.gs`, desplegar, autorizar, copiar la URL) y, si el usuario no pega esa URL en "Configuración", `startSend()` corta con un `alert` y la campaña no arranca (`ui/dashboard.js:552`).

Dos problemas concretos:

1. **El paso de configuración bloquea al usuario.** Es el motivo original de este rediseño.
2. **El techo de envío es cuatro veces menor de lo documentado.** Apps Script limita a **100 destinatarios/día** en cuentas gmail.com gratuitas (1.500 en Workspace), no los ~500 que promete `INSTRUCCIONES.md:192`. Ese es el límite de Gmail directo, no el de Apps Script.

**Objetivo operativo:** cubrir **1.000 envíos por día**, sin backend por cliente y sin paso de configuración manual.

Enviando directo por la Gmail API con OAuth, cada cuenta aporta su límite real de Gmail (~500/día en gmail.com, ~2.000 en Workspace). Los 1.000 se cubren con dos casillas propias de la empresa, relevando la segunda cuando la primera agota su cuota.

## 2. Decisiones tomadas

| Tema | Decisión | Motivo |
|---|---|---|
| Flujo OAuth | `chrome.identity.launchWebAuthFlow` con flujo implícito (`response_type=token`) | Portable a Chrome/Brave/Edge/Opera con un solo código, sin `client_secret` embebido (la carpeta se entrega al cliente), y el usuario elige desde qué cuenta envía |
| Apps Script | Corte limpio: se elimina `google-apps-script/Code.gs` y toda su ruta de envío | Nadie depende del backend viejo; una sola ruta de envío que mantener |
| Licencia | Validación online obligatoria contra `licencias.anomalydevs.qzz.io` al iniciar cada campaña | Hoy la valida `Code.gs` del lado del servidor; sin ese backend quedaría solo el gate en JS del cliente |
| Firefox | Fuera de soporte | `identity.getRedirectURL()` en Firefox devuelve un UUID distinto por instalación, imposible de registrar en Google Cloud |
| App OAuth | "Producción" sin verificar | No exige cargar el correo de cada cliente como usuario de prueba; el tope de 100 cuentas coincide con la escala actual |
| Relevo de cuenta | Manual: la campaña se pausa y el usuario conecta la siguiente cuenta | Control explícito de qué casilla envía qué; sin lógica de rotación automática |

**Fuera de alcance:** rotación automática entre cuentas pre-autorizadas, reparto proporcional desde el inicio, soporte Firefox, verificación OAuth de Google (se tramitará al superar las 100 cuentas), programación de campañas.

## 3. Arquitectura

```
ui/gmailAuth.js     (nuevo)  ── OAuth: conectar, detectar, renovar, revocar
ui/mimeBuilder.js   (nuevo)  ── construcción del mensaje RFC 2822 (función pura)
background.js       (cambia) ── envío contra la Gmail API + pausa por cuota
ui/dashboard.js     (cambia) ── bloque "Cuenta de envío", banner de relevo
ui/dashboard.html   (cambia) ── modal Configuración sin URL ni Token
manifest.json       (cambia) ── permiso identity, host_permissions, key estable
google-apps-script/ (se elimina)
```

### 3.1 `ui/gmailAuth.js`

Módulo ESM que encapsula todo lo relacionado con OAuth. Nadie fuera de este archivo construye URLs de Google ni lee tokens del storage.

**Corre siempre en el service worker, nunca en el popup.** El dashboard es un popup de la extensión y se cierra al perder el foco: si `launchWebAuthFlow` se disparara desde ahí, la ventana de consentimiento de Google le robaría el foco, el popup moriría y la promesa del token se perdería. `dashboard.js` se comunica por mensajes (`GMAIL_STATUS`, `GMAIL_CONNECT`, `GMAIL_DISCONNECT`), el mismo patrón que ya usa la licencia.

| Función | Entrada | Salida | Comportamiento |
|---|---|---|---|
| `detectActiveAccount()` | — | `{ email } \| null` | Intento silencioso (`interactive: false`, `prompt=none`). Devuelve `null` si no hay sesión de Google en el navegador o la cuenta nunca autorizó. No abre ventanas. |
| `connect({ selectAccount })` | `selectAccount: boolean` | `{ email }` | Flujo interactivo. Con `selectAccount: true` fuerza `prompt=select_account` para elegir la casilla de relevo. |
| `getAccessToken()` | — | `string` | Devuelve el token vigente. Si faltan menos de 2 minutos para su vencimiento, lo renueva en silencio con `login_hint` de la cuenta actual. Lanza `AuthRequiredError` si no puede. |
| `getConnectedAccount()` | — | `{ email } \| null` | Lee el estado persistido, sin red. |
| `disconnect()` | — | — | `POST https://oauth2.googleapis.com/revoke?token=…` y limpieza del storage. |

**URL de autorización**

```
https://accounts.google.com/o/oauth2/v2/auth
  ?client_id=<CLIENT_ID>
  &response_type=token
  &redirect_uri=<chrome.identity.getRedirectURL()>
  &scope=https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/userinfo.email
  &prompt=<none|select_account|consent>
  &login_hint=<email>        (solo en renovación silenciosa)
```

Google responde redirigiendo a `https://<ID-extensión>.chromiumapp.org/#access_token=…&expires_in=3599&token_type=Bearer`. El correo de la cuenta se obtiene con `GET https://www.googleapis.com/oauth2/v3/userinfo` usando ese token.

`gmail.send` es un scope **sensible** (no restringido): requiere verificación de Google para superar las 100 cuentas, pero **no** la auditoría de seguridad CASA que exigen `gmail.compose` o `gmail.modify`.

**Estado persistido**

- `chrome.storage.session`: `gmail_access_token`, `gmail_token_expiry`. Memoria pura, se borra al cerrar el navegador.
- `chrome.storage.local`: `gmail_account_email` (para mostrar el badge y para el `login_hint` de la renovación silenciosa).
- Al iniciar, se eliminan de `chrome.storage.local` las claves `apiKey` y `apiToken` que hayan quedado de instalaciones previas.

### 3.2 `ui/mimeBuilder.js`

Función pura, sin `chrome.*` ni red, por lo tanto testeable de verdad. Es la pieza que reemplaza la lógica de armado de correo que hoy vive en `Code.gs`.

```js
buildMimeMessage({ fromName, fromEmail, to, subject, html, inlineImages, attachments }) → string
```

Estructura según el contenido:

| Contenido | Estructura |
|---|---|
| Solo HTML | `text/html; charset=UTF-8` (base64) |
| HTML + imagen | `multipart/related` [ html, imagen con `Content-ID: <img0>` y `Content-Disposition: inline` ] |
| HTML + PDFs | `multipart/mixed` [ html, pdfs con `Content-Disposition: attachment` ] |
| HTML + imagen + PDFs | `multipart/mixed` [ `multipart/related` [ html, imagen ], pdfs ] |

Detalles que importan: `Subject` y el nombre del remitente van codificados en **RFC 2047** (`=?UTF-8?B?…?=`) para que los acentos no lleguen rotos; el HTML viaja en base64 para no pelear con quoted-printable ni con líneas de más de 998 caracteres; los adjuntos se cortan en líneas de 76 caracteres; los nombres de archivo se sanitizan igual que hoy hace `sanitizeFilename()` en `Code.gs`.

La imagen se referencia desde el HTML con `<img src="cid:img0">`, replicando el comportamiento actual del backend (que hoy agrega el `<img>` al final del cuerpo).

### 3.3 `background.js`

`sendEmails(payload)` cambia de transporte. El `payload` pierde `apiKey` y `apiToken`.

```
POST https://gmail.googleapis.com/upload/gmail/v1/users/me/messages/send?uploadType=media
Authorization: Bearer <token>
Content-Type: message/rfc822

<MIME crudo>
```

Se usa el endpoint de **subida** (`/upload/gmail/v1/…`) y no el de metadatos: este último obliga a meter el mensaje entero codificado en base64url dentro de un JSON, lo que infla el cuerpo un 33% y choca con el techo de tamaño de request; los límites actuales de la UI permiten 1 imagen de 5 MB más 3 PDFs de 5 MB, que codificados pasan de 27 MB. El endpoint de subida acepta el MIME crudo, es el camino documentado para adjuntos, y evita el paso de codificación.

**El token se pide dentro del bucle**, no antes. `getAccessToken()` cachea, así que el costo es nulo, y esto hace que el relevo de cuenta funcione sin reestructurar nada: al reanudar con otra cuenta, el envío siguiente toma el token nuevo automáticamente.

Antes del primer correo, `sendEmails` valida la licencia online (`validateLicense()`); si no está activa o el servidor no responde, la campaña no arranca y devuelve el motivo. La gracia offline de 48 h se mantiene solo para el indicador del footer.

**Validación de tamaño:** antes de arrancar se suma el peso de los adjuntos. Si supera **18 MB** (≈24 MB una vez codificados, contra el techo de 25 MB de Gmail) la campaña no inicia y avisa cuál adjunto sacar.

### 3.4 Manejo de errores

| Situación | Detección | Respuesta |
|---|---|---|
| Token vencido o revocado | HTTP 401 | Renovación silenciosa y un reintento. Si falla: pausa en estado `auth_required` con pedido de reconexión |
| Límite por minuto | `reason` = `rateLimitExceeded` o `userRateLimitExceeded` | Backoff exponencial, hasta 3 intentos. Si los tres fallan se trata como cuota agotada (fila siguiente) |
| **Cuota diaria agotada** | `reason` = `quotaExceeded` o `dailyLimitExceeded`, o mensaje que matchea `/daily limit\|sending limit\|quota/i` | **Pausa la campaña** en estado `quota_exhausted`, sin marcar como fallidos los destinatarios pendientes |
| Dirección inválida | HTTP 400 o `5.1.1` en la respuesta | Error de esa fila (❌), la campaña sigue |
| Red caída | `fetch` rechaza | Backoff, 3 intentos, después error de esa fila |
| Licencia no válida | Respuesta del servidor de licencias | La campaña no arranca |

### 3.5 Relevo de cuenta

1. Gmail devuelve cuota agotada en el destinatario *N*.
2. `background.js` marca `isPaused = true` y `quotaExhausted = true`, y emite `sendProgress` con el motivo. El bucle queda esperando en el `while (isPaused)` que ya existe. Los destinatarios de *N* en adelante siguen en "Pendiente ⏳".
3. El dashboard muestra un banner: *"Límite diario alcanzado en cobranzas@empresa.com — se enviaron 500 de 1.000. Conectá otra cuenta para continuar."* con el botón **Conectar otra cuenta**.
4. El botón llama a `connect({ selectAccount: true })`, que abre el selector de cuentas de Google.
5. Con la cuenta nueva conectada, el dashboard manda `resumeSend`. El bucle continúa desde *N* y el envío siguiente usa el token de la casilla nueva.

Los destinatarios ya enviados conservan su ✅ y no se reprocesan. No hay que re-importar el Excel.

Los correos del segundo tramo salen con la dirección de la segunda casilla; el "Nombre remitente" configurado se mantiene igual en ambos tramos.

### 3.6 UI

**Modal "Configuración"** — se eliminan el campo de URL de Apps Script y el de Token de Seguridad. Entra el bloque **Cuenta de envío**:

- Sin conectar: 🔴 *Ninguna cuenta conectada* + botón **Conectar cuenta de Gmail**.
- Conectada: 🟢 `cobranzas@empresa.com` + botón **Desconectar**.

"Nombre remitente" se mantiene, con su rol aclarado en el texto de ayuda: es solo el nombre visible; la dirección real siempre es la de la cuenta conectada, porque Gmail no permite falsificar el `From:`.

**Al abrir el dashboard** se ejecuta `detectActiveAccount()`. Si el navegador tiene sesión de Google activa con una cuenta que ya autorizó, el badge aparece en 🟢 sin intervención. Si no, queda 🔴 y el botón "Iniciar Campaña" deshabilitado.

La primera vez que se usa una cuenta nueva hay un clic obligatorio de "Permitir" en la pantalla de consentimiento de Google. No es evitable: sin token OAuth no hay envío por la Gmail API. A partir de ese consentimiento, la detección es silenciosa.

`updateSendButtonState()` pasa a exigir: destinatarios cargados, licencia activa, **cuenta conectada** y campaña no en curso. El `alert` de configuración incompleta desaparece: si falta la cuenta, se abre el modal de Configuración. El arranque encadena lo que ya hace con la licencia — primero el modal de Licencia si no está activa, después el de Configuración si no hay cuenta.

### 3.7 `manifest.json`

- `permissions`: agregar `"identity"`.
- `host_permissions`: quitar `script.google.com` y `script.googleusercontent.com`; agregar `https://gmail.googleapis.com/*`, `https://oauth2.googleapis.com/*`, `https://www.googleapis.com/*`.
- Quitar `browser_specific_settings` (Firefox sale de soporte).
- Agregar `"key"` para que el ID de la extensión sea estable entre instalaciones desempaquetadas, requisito del redirect registrado en Google Cloud:

```sh
openssl genrsa 2048 | openssl pkcs8 -topk8 -nocrypt -out mailerpro-key.pem
openssl rsa -in mailerpro-key.pem -pubout -outform DER | openssl base64 -A   # → valor de "key"
openssl rsa -in mailerpro-key.pem -pubout -outform DER | shasum -a 256 | head -c32 | tr 0-9a-f a-p   # → ID
```

El `.pem` no se distribuye: queda guardado fuera de la carpeta de la extensión.

## 4. Prerrequisito operativo (una sola vez)

1. Proyecto nuevo en Google Cloud Console y habilitar la **Gmail API**.
2. Pantalla de consentimiento OAuth, tipo **Externo**, publicada en **Producción** (sin verificar). Scopes: `gmail.send` y `userinfo.email`.
3. Credencial **ID de cliente OAuth → Aplicación web**, con URI de redirección autorizado `https://<ID-extensión>.chromiumapp.org/`.
4. Pegar el `client_id` en la constante `CLIENT_ID` de `ui/gmailAuth.js`. No hay secreto que guardar.

Hasta que Google verifique la app, cada cliente ve una pantalla de advertencia y debe entrar por *Configuración avanzada → Ir a Mailer Pro*, con un tope de 100 cuentas en total. Se documenta en `INSTRUCCIONES.md`.

## 5. Documentación a actualizar

`INSTRUCCIONES.md` pierde los PASOS 1 y 2 completos (crear y desplegar el backend) y la sección "Cambiar de cuenta Gmail". El PASO 4 se reescribe como "Conectar tu cuenta de Gmail", con la pantalla de advertencia de Google explicada. Se agrega "Qué hacer cuando se agota el límite diario" describiendo el relevo. Se corrigen los límites reales (~500/día en gmail.com, ~2.000 en Workspace, por cuenta) y se quita Firefox de la lista de navegadores.

Nota a incluir: las casillas de relevo deben ser cuentas propias de la empresa y el correo, solicitado por el destinatario. Rotar cuentas para eludir límites en correo masivo no solicitado termina en suspensión de las casillas.

## 6. Verificación

No hay test runner en el proyecto (extensión estática, sin build step).

- `node --check` sobre cada `.js` nuevo o modificado.
- **Test unitario real de `mimeBuilder.js`** con `node:test`, por ser una función pura y por ser el punto donde un error rompe el 100% de los envíos: estructura de partes en los cuatro casos de contenido, headers RFC 2047 con acentos, `Content-ID` de la imagen inline, corte de líneas base64.
- Revisión manual de que `manifest.json` sea JSON válido y que las rutas referenciadas existan.
- **Limitación explícita:** el flujo OAuth y el envío real no se pueden probar desde este entorno — requieren un navegador, un `client_id` real y cuentas Gmail. La pausa por cuota agotada tampoco es reproducible sin quemar 500 envíos reales; se verifica con una respuesta simulada de la API.
