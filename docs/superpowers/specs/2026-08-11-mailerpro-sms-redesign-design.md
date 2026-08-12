# MailerPro — Rediseño alineado a "SMS PRO V3.0"

**Fecha:** 2026-08-11
**Estado:** Aprobado (decisiones confirmadas por el usuario durante brainstorming; ítems sin pregunta explícita resuelven a la opción recomendada, por directiva expresa de continuar sin pausas).

## 1. Contexto

MailerPro es una extensión de Chrome (MV3) para envío masivo de emails vía un backend en Google Apps Script (Gmail). Su producto hermano, **SMS PRO V3.0** (`EXTENSION SMS CAMPAÑAS/SMS PRO V3.0`), automatiza campañas SMS/RCS vía Google Messages Web y ya tiene: sistema de diseño propio (tema oscuro + acento verde), un dashboard de 800×600 con header/nav/footer, ingesta de contactos por Excel con variables dinámicas por columna, y control de licencias contra un backend propio (`licencias.anomalydevs.qzz.io`).

Este documento define cómo traer a MailerPro: (1) el mismo lenguaje visual y estructura de dashboard, (2) ingesta de datos solo por Excel con cualquier columna como variable, (3) control de licencia reusando el mismo backend, y (4) el logotipo UPHONE con fondo transparente.

**Fuera de alcance** (decisión explícita del usuario): variantes de mensaje con sintaxis spin, biblioteca de promociones guardadas, modal de historial de campañas, indicador de conexión a Google Messages/"abrir hoja". MailerPro conserva sus funciones actuales (asunto, mensaje HTML con variables, 1 imagen adjunta embebida inline, intervalo entre envíos, pausar/reanudar/cancelar/reiniciar, lista de errores) — solo cambian de "piel" y de método de ingreso de datos.

## 2. Estructura de archivos

Se replica la organización del hermano para que ambos proyectos compartan convención:

```
MailerPro/
├── manifest.json
├── background.js
├── assets/                          (antes icons/)
│   ├── icon16.png, icon48.png, icon128.png   (UPHONE, fondo transparente)
│   ├── logo_uphone.png                        (wordmark sin fondo — logo de header)
│   └── gen_icons.py                           (se mantiene, ya no genera fondo)
├── ui/
│   ├── dashboard.html                (antes popup.html)
│   ├── dashboard.js                  (antes popup.js)
│   ├── dataProcessor.js              (nuevo — lectura de Excel)
│   ├── licenseClient.js              (nuevo — cliente HTTP de licencias, ESM)
│   ├── licenseGate.js                (nuevo — lógica pura de vigencia, ESM)
│   ├── tokens.css                    (nuevo — copiado 1:1 del hermano)
│   ├── dashboard.css                 (nuevo — adaptado del hermano)
│   └── lib/xlsx.js                   (se mueve tal cual desde libs/)
└── INSTRUCCIONES.md
```

`google-apps-script/Code.gs` **no se toca**: sigue siendo el relay de Gmail con su propio `SHARED_TOKEN`. El control de licencia es una capa del lado del cliente (extensión), independiente del Apps Script — igual que en el hermano, donde la licencia gatea el botón de envío en la extensión, no el backend de mensajería.

## 3. Backend de licencias

Se reutiliza el mismo servidor (`https://licencias.anomalydevs.qzz.io/api/v1`) y el mismo esquema (`licenses` sin columna de "producto" — una license_key es válida para cualquier extensión que la use). Implicancia a documentar para el usuario: cada extensión instalada genera su propio `device_id` aleatorio (guardado en `chrome.storage.local`, aislado por extensión), así que activar la misma licencia en MailerPro y en SMS Pro en la misma máquina consume **dos** cupos de `max_devices`, no uno. No requiere cambios de esquema — es una consecuencia esperada de reusar el backend sin scope por producto, y se deja igual que hoy lo maneja el hermano.

Componentes (mismo patrón que el hermano, adaptado a ESM porque `manifest.json` de MailerPro declara `"type": "module"` en el service worker — el hermano usa `importScripts`, que no está disponible en service workers de tipo módulo):

- **`ui/licenseGate.js`**: `computeGateDecision(cachedState, nowMs)` puro, sin `chrome.*`. Gracia offline de 48h. `export` en vez de `module.exports`.
- **`ui/licenseClient.js`**: `activateLicense`, `validateLicense`, `getCachedLicenseState`, `getLicenseGate`, manejo de `device_id`/`device_label`. `import { computeGateDecision } from './licenseGate.js'`.
- **`background.js`**: `import './ui/licenseGate.js'` y `import './ui/licenseClient.js'` (o re-export desde un único punto), alarma `licenseValidationAlarm` cada 6h (`chrome.alarms`, requiere agregar el permiso), handlers de mensajes `LICENSE_ACTIVATE` y `LICENSE_STATUS` idénticos al hermano.
- **UI**: badge de licencia en el footer (🟢/🟡/🔴 + empresa + días restantes), modal "Licencia" accesible desde el nav y desde el badge, con input de clave + botón Activar. Mismos textos de `LICENSE_REASON_TEXT` traducidos del hermano.

`manifest.json` gana: permiso `"alarms"` y `host_permissions` `"https://licencias.anomalydevs.qzz.io/*"`.

## 4. Ingesta de datos — solo Excel, columnas dinámicas

- Se elimina el textarea de ingreso manual y la importación `.txt`. Solo `.xlsx`/`.xls` vía `ui/dataProcessor.js`.
- `dataProcessor.js` lee la primera hoja, toma la fila 1 como encabezados, y expone **todas las columnas** del archivo como propiedades del contacto (no solo `email`/`nombre`). Debe existir una columna cuyo encabezado normalizado (minúsculas, sin espacios) sea `email`; las filas sin email válido se descartan. El resto de columnas quedan disponibles como variables de mensaje.
- Variables: se mantiene la sintaxis de un solo corchete `{Columna}` (no `{{Columna}}` como el hermano) para no romper la convención ya documentada de MailerPro (`{nombre}`, `{email}`). El reemplazo en el envío es case-insensitive por nombre de columna. La UI de chips (`variable-tag`) se adapta para mostrar `{Columna}` en vez de `{{Columna}}`.
- Visualización: se reemplaza el preview de chips limitado a 30 por una lista tipo tabla (`contacts-list` / `contact-row`, igual que el hermano): una fila por contacto, un input readonly por columna, límite de renderizado de 500 filas en el DOM (con aviso si hay más), y una columna de estado por fila (`Pendiente ⏳` / `Enviado ✅` / `Error ❌`) que se actualiza en vivo durante el envío.

## 5. Rediseño visual — dashboard 800×600

Layout confirmado por el usuario: ventana fija de 800×600 (igual que el hermano), con:

- **Header**: logo UPHONE (wordmark sin fondo) + nav con 3 ítems — *Soporte*, *Licencia*, *Configuración* (nuevo, reemplaza al panel colapsable "Enlace Mágico" actual) — cada uno abre un modal.
- **Secciones** (grid de 2 columnas donde aplique, igual que el hermano):
  - *Destinatarios*: badge de conteo + botón "Importar Excel" + `contacts-list`.
  - *Mensaje*: asunto, textarea de mensaje HTML, chips de variables detectadas, carga de imagen (1, con preview y botón eliminar — funcionalidad ya existente, solo re-vestida).
  - *Opciones de envío*: tarjeta `option-card` con el campo "Intervalo entre envíos" actual (sin agregar min/max aleatorio — fuera de alcance).
- **Footer**: badge de licencia a la izquierda; a la derecha, los botones de control (Iniciar/Pausar/Reanudar/Cancelar/Reiniciar) restilizados con las clases `btn-accent` / `btn-warning-pause` / `btn-success-resume` / `btn-danger-stop` del hermano.
- **Modales**: Soporte (mismo contacto que usa el hermano — es la línea de soporte de la empresa, no cambia por producto), Licencia, Configuración (URL del Apps Script + Token + Nombre remitente — antes el panel "Enlace Mágico").

`tokens.css` se copia sin cambios (mismos colores, spacing, radios). `dashboard.css` se adapta reusando las mismas clases (`.section`, `.option-card`, `.contact-row`, `.modal-*`, `.btn-*`, `.badge`, `.variable-tag`) quitando lo específico de SMS (promociones, variantes, conexión).

## 6. Logotipo

Se genera una versión del wordmark "UPHONE" (letra U y palomita en verde `#2ebd59`, resto en blanco) con **fondo transparente** en vez del rectángulo oscuro actual, mediante remoción por color de fondo (chroma key sobre el `#1a1a1a`/similar de fondo) preservando antialiasing en los bordes de las letras. Se usa para:
- `assets/logo_uphone.png` (logo del header del dashboard).
- `assets/icon16.png`, `icon48.png`, `icon128.png` (ícono de la extensión en la barra del navegador).

El logo pequeño de crédito "anomalydevs" se retira del header (queda reemplazado por el wordmark UPHONE, decisión confirmada).

## 7. Manejo de errores / casos borde

- Excel sin columna `email`: mismo mensaje de error claro que hoy (rechazar el archivo, no la campaña).
- Licencia no activada al abrir el dashboard por primera vez: se abre automáticamente el modal de Licencia (igual que el hermano, con `hasPromptedForLicense` para no repetir en cada refresh).
- Botón "Iniciar Campaña" deshabilitado si: no hay contactos, o la licencia no está en estado `allowed`, o campaña ya en curso — mismo gate combinado que el hermano (`updateSendButtonState`), sin el chequeo de conexión (no aplica a MailerPro).
- Falla de red al validar licencia: se conserva el último estado cacheado (gracia offline de 48h), igual que el hermano.

## 8. Verificación

No hay test runner configurado en este proyecto (extensión estática, sin build step). Verificación:
- `node --check` sobre cada `.js` nuevo/modificado para detectar errores de sintaxis.
- Revisión manual de que `manifest.json` sea JSON válido y que todas las rutas referenciadas (`ui/dashboard.html`, `assets/icon*.png`, etc.) existan en disco.
- No es posible cargar la extensión en Chrome real ni probar el flujo de licencia contra el backend en vivo desde este entorno; se deja constancia explícita de esta limitación en el reporte final en vez de afirmar que fue probado end-to-end.
