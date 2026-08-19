# Monitor lateral en vivo y reporte de campañas — Diseño

**Fecha:** 2026-08-13
**Estado:** aprobado, pendiente de plan de implementación
**Antecedente:** `2026-08-12-mailerpro-gmail-oauth-design.md` (envío directo por Gmail API)

## 1. Problema

Hoy, cuando una campaña arranca, el usuario pierde de vista el envío. El dashboard es un popup y Chrome lo cierra apenas pierde el foco: si el usuario se va a revisar el Excel o a contestar un correo, lo único que queda es el porcentaje en el badge del ícono. No sabe a qué destinatario va, ni cuántos fallaron, ni por qué.

Terminada la campaña, el rastro es igual de pobre. `ui/dashboard.html:153` ofrece un desplegable "Ver Errores" y un botón "Copiar Correos Fallidos", y nada más: no hay constancia de los envíos exitosos, no hay archivo que entregar, y al cerrar el popup se pierde todo. Para un usuario que factura una campaña de cobranzas, no poder mostrar qué se envió es un problema real.

El aplicativo hermano de SMS (`EXTENSION SMS CAMPAÑAS/SMS PRO V3.0`) ya resolvió las dos cosas: un HUD flotante que informa el avance contacto por contacto (`content.js:834`) y un historial de campañas con descarga en CSV y Excel (`dashboard.js:875-1000`). Este diseño replica ambas en MailerPro.

## 2. Objetivos

1. **Monitor en vivo:** una ventana lateral que muestre, mientras la campaña corre en segundo plano, a qué correo se está enviando y cómo avanza; con controles de pausa, reanudación y cancelación, y un log corrido de los últimos resultados.
2. **Reporte:** un resumen al terminar la campaña y un historial persistente de campañas, ambos descargables en CSV y Excel, con el detalle por destinatario.

**Fuera de alcance:** reintentar automáticamente los destinatarios fallidos, y programar campañas a futuro. Se evaluarán por separado.

## 3. Por qué un Side Panel y no un HUD inyectado

El hermano de SMS inyecta su HUD con un content script sobre `messages.google.com`, y allá tiene sentido: el envío ocurre en esa pestaña, siempre está abierta. **MailerPro no tiene ninguna página host** — envía por HTTP a la Gmail API desde el service worker, sin pestaña de por medio. Copiar el mecanismo obligaría a pedir `<all_urls>` para poder inyectar en cualquier pestaña, lo que dispara la advertencia *"Leer y cambiar todos tus datos en todos los sitios web"* al instalar. Con la verificación de Google todavía pendiente, sumar ese permiso es exactamente la fricción que conviene evitar. Además el HUD desaparecería en pestañas `chrome://` y habría que reinyectarlo en cada cambio de pestaña.

| Opción | Visible al cambiar de pestaña | Visible fuera de Chrome | Permiso |
|---|---|---|---|
| **Side Panel nativo** (elegida) | Sí | No | `sidePanel`, sin advertencia al instalar |
| Ventana `popup` independiente | Sí | Sí, hasta que otra app la tape | Ninguno |
| HUD por content script | Requiere reinyección | No | `<all_urls>`, advertencia fuerte |

Se elige el **Side Panel** (`chrome.sidePanel`, Chrome 114+): es una página de extensión normal, así que reutiliza `ui/tokens.css` y el mismo canal de mensajes que ya usa el dashboard, no pide permisos invasivos y no se cierra al perder el foco.

Un efecto secundario deseable: mientras el panel está abierto, mantiene despierto al service worker. Eso refuerza el `keepAlive()` de `background.js:35`, que hoy es la única defensa contra el reciclado del worker durante una pausa larga por cuota agotada.

## 4. Arquitectura

`background.js` sigue siendo la única fuente de verdad del estado de la campaña. Ya emite `sendProgress` (`background.js:304`) y `sendComplete` (`background.js:325`) por `chrome.runtime.sendMessage`; **el monitor se engancha a ese mismo canal**, sin inventar uno nuevo. Dashboard y monitor son dos consumidores intercambiables del mismo broadcast: cualquiera de los dos puede estar cerrado sin romper nada, porque los `sendMessage` ya van con `.catch(() => {})`.

```
                     ┌─────────────────────────────────┐
                     │        background.js            │
                     │  (única fuente de verdad)       │
                     │                                 │
   campaignLog.js ◄──┤  acumula resultado por correo   │
   (puro)            │                                 │
   historyStore.js ◄─┤  persiste en chrome.storage     │
                     └───────────┬─────────────────────┘
                                 │ sendProgress / sendComplete / quotaExhausted
                    ┌────────────┴────────────┐
                    ▼                         ▼
            ui/monitor.js             ui/dashboard.js
            (side panel,              (popup, se cierra
             siempre abierto)          al perder foco)
                                              │
                                              ▼
                                    ui/reportBuilder.js (puro)
                                       CSV  /  XLSX
```

### Cambio de fondo en `background.js`

Hoy solo acumula `currentProgress.failedEmails` (`background.js:162`). Para el log en vivo y para el reporte hace falta **el resultado de cada destinatario, exitoso o no**:

```js
{ email, status, reason, timestamp, contactData }
```

donde `status` es `'enviado' | 'error' | 'pendiente'`, `reason` es el mensaje clasificado por `gmailErrors.js` cuando corresponde, y `contactData` es la fila original del Excel (necesaria para que el reporte lleve las columnas del cliente).

Ese arreglo se persiste en `chrome.storage.local` a medida que avanza. Si el service worker se recicla a mitad de campaña, el reporte no se pierde. El costo es despreciable: una escritura cada 10 segundos, que es el retardo por defecto entre correos.

## 5. Componentes

### Archivos nuevos

| Archivo | Responsabilidad |
|---|---|
| `ui/monitor.html` | Markup del side panel. Reutiliza `tokens.css` |
| `ui/monitor.js` | Escucha el broadcast, pinta progreso y log, despacha pausa/reanudar/cancelar |
| `ui/campaignLog.js` | **Puro.** Agrega entradas de resultado, recorta el log en vivo, calcula `{enviados, errores, pendientes}` |
| `ui/reportBuilder.js` | **Puro.** `buildReportRows()` y `toCSV()`. El workbook lo arma el dashboard con SheetJS a partir de esas mismas filas, para que el módulo no dependa del global `XLSX` y siga siendo testeable en Node |
| `ui/historyStore.js` | Guarda, lista y borra campañas en `chrome.storage.local`, con tope de 20 |
| `tests/campaignLog.test.js` | Unitario del acumulador y el resumen |
| `tests/reportBuilder.test.js` | Unitario del CSV y de las filas del reporte |

`reportBuilder.js` se separa de la UI a propósito. En el hermano de SMS esa lógica vive dentro de `dashboard.js` ocupando unas 150 líneas (`dashboard.js:836-1000`) mezclada con manipulación del DOM, y por eso no tiene un solo test. Acá es un módulo puro, en la misma línea que `mimeBuilder.js` y `gmailErrors.js`.

### Archivos modificados

| Archivo | Cambio |
|---|---|
| `manifest.json` | Permiso `sidePanel` y `"side_panel": { "default_path": "ui/monitor.html" }` |
| `background.js` | Acumular resultados por destinatario, persistirlos, guardar la campaña al finalizar, exponerlos en `getState` |
| `ui/dashboard.js` | Abrir el panel al iniciar campaña; modal Resumen al terminar; modal Historial |
| `ui/dashboard.html` | Modales `modal-resumen` y `modal-historial`, ítem de menú "Historial" |

## 6. El monitor lateral

```
┌─ 🚀 MAILER PRO ────── 47/500 ─┐
│ ███░░░░░░░░░░░░░░░  9%        │
│ Enviando a: cliente@ejemplo.com│
│ ✅ 45   ❌ 2                   │
│ [⏸ Pausar]   [⏹ Cancelar]     │
│ ─────────────────────────────  │
│ ✅ ana@corp.com        10:42   │
│ ❌ luis@corp.com  Invalid to…  │
│ ✅ sofia@corp.com      10:41   │
└────────────────────────────────┘
```

**Apertura:** al pulsar "Iniciar Campaña", `startSend()` (`ui/dashboard.js:564`) llama `chrome.sidePanel.open({ windowId })` antes de despachar `startSend` al background. Chrome exige un gesto del usuario para abrir el panel y ese clic lo es, así que el panel aparece solo, sin pedirle nada al usuario.

**Puesta al día:** el panel puede abrirse con la campaña ya empezada. Al cargar pide `getState` y pinta el estado actual, con el mismo criterio que ya usa `restoreState()` en el dashboard (`ui/dashboard.js:118`).

**Controles:** los botones despachan los mismos mensajes `pauseSend`, `resumeSend` y `cancelSend` que el dashboard. No hay lógica duplicada: el estado lo decide background y vuelve por broadcast a los dos consumidores.

**Log en vivo:** muestra las últimas 50 entradas. El resto no se pierde — vive en storage y sale completo en el reporte. Es un límite de DOM, no de datos: 500 filas de log en un panel de 340 px no aportan nada y hacen pesada la actualización.

**Cuota agotada:** el panel muestra el mismo banner naranja de relevo que el dashboard, escuchando el mensaje `quotaExhausted` que ya emite `pauseForQuota()` (`background.js:277`), con el botón para conectar la cuenta de relevo.

## 7. El reporte

### Resumen al terminar

Modal que se abre solo al recibir `sendComplete`, con los totales y los dos botones de descarga:

```
RESUMEN DE CAMPAÑA
  ✅ Enviados 478    ❌ Errores 22
  [📄 Descargar CSV]  [📊 Descargar Excel]
```

### Historial de campañas

Entrada nueva en el menú. Lista las campañas guardadas, más recientes primero, cada una con su fecha, cantidad de destinatarios, estado y sus propios botones de descarga. Incluye "Borrar todo el historial".

Cada campaña se guarda al finalizar:

```js
{
  date: 1755100000000,
  total: 500,
  enviados: 478,
  errores: 22,
  status: 'Completada' | 'Cancelada' | 'Interrumpida',
  account: 'ventas@empresa.com',
  subject: 'Recordatorio de pago',
  results: [ { email, status, reason, timestamp, contactData } ]
}
```

Se conservan las **20 campañas más recientes**. La extensión ya declara `unlimitedStorage`, así que el tope es por higiene de la UI, no por espacio.

### Detalle exportado

Las columnas fijas van primero y después las del Excel que cargó el usuario, resueltas dinámicamente a partir del `contactData` de cada resultado:

| Correo | Estado | Motivo | Nombre | Monto | … |
|---|---|---|---|---|---|
| ana@corp.com | Enviado | | Ana | 1.200 | |
| luis@corp.com | Error | Invalid to header | Luis | 890 | |
| mario@corp.com | Pendiente | Cuota diaria agotada | Mario | 450 | |

La columna de correo se resuelve con el mismo `EMAIL_COLUMN_ALIASES` que ya usa el envío (`background.js:42`), porque el contacto conserva el nombre de columna original del Excel — puede llamarse "CORREO CLIENTE" y no `email`.

**Una campaña cancelada o interrumpida se exporta igual**, con sus destinatarios no procesados marcados como `Pendiente`. El reporte nunca debe dar por enviado lo que no se envió.

### Formatos

**CSV:** campos escapados según RFC 4180 (comillas dobles cuando el valor tiene coma, comilla o salto de línea) y BOM UTF-8 al inicio, sin el cual Excel abre los acentos rotos.

**Excel:** `.xlsx` **nativo**, generado con SheetJS. Acá se mejora sobre el hermano de SMS: aquel arma una tabla HTML con namespaces de Office y la guarda como `.xls` (`dashboard.js:929`), y por eso Excel muestra la advertencia *"el formato del archivo y la extensión no coinciden"* cada vez que se abre. MailerPro ya trae `ui/lib/xlsx.js` (SheetJS 0.20.3) para importar los destinatarios, y esa build **incluye escritura** — verificado generando un `.xlsx` válido de prueba. No hace falta agregar ninguna dependencia.

El costo de la decisión: SheetJS en su versión comunitaria no aplica estilos por celda, así que el reporte no lleva las filas coloreadas del hermano. Se compensa con la columna `Estado` explícita, que además es lo que el usuario puede filtrar en Excel. Un archivo legítimo vale más que un archivo con colores que Excel recibe con una advertencia.

La descarga se dispara con un `Blob` y un `<a download>` desde el dashboard, igual que hoy en el hermano.

## 8. Errores y casos borde

| Situación | Comportamiento |
|---|---|
| Chrome anterior a 114, sin `chrome.sidePanel` | El envío funciona igual. El panel no abre y el dashboard avisa una sola vez, sin bloquear la campaña |
| El usuario cierra el panel a mitad de campaña | No se rompe nada: el estado vive en background. Al reabrirlo se pone al día con `getState` |
| Service worker reciclado durante una pausa larga | Los resultados ya están persistidos, pero nadie llega a cerrar la campaña. Al arrancar, `background.js` busca una campaña en curso en storage sin cierre y la archiva como `Interrumpida` — es el único camino por el que se produce ese estado |
| Campaña cancelada por el usuario | Se guarda con estado `Cancelada` y los no procesados como `Pendiente` |
| Historial vacío | Los modales muestran un mensaje claro en vez de un listado en blanco, y los botones de descarga no aparecen |
| Campaña sin ningún resultado | El botón de descarga avisa que no hay datos en vez de bajar un archivo vacío |

## 9. Pruebas

**Automatizadas** (`node --test`, misma línea que `mimeBuilder` y `gmailErrors`):

- `campaignLog.js`: acumula en orden; un destinatario pendiente no se cuenta como enviado; el resumen cuadra con las entradas; el recorte del log en vivo no altera los totales.
- `reportBuilder.js`: escapado de comas, comillas y saltos de línea; BOM presente; columnas del Excel del usuario respetadas en orden; correo resuelto desde una columna llamada "CORREO CLIENTE"; una campaña cancelada exporta sus pendientes; un `results` vacío devuelve cero filas en vez de romper.

**Manual en el navegador** (no automatizable acá):

1. Iniciar campaña → el panel se abre solo y muestra el correo en curso.
2. Cambiar de pestaña → el panel sigue visible y actualizándose.
3. Pausar y reanudar desde el panel → el dashboard refleja el mismo estado al reabrirlo.
4. Cerrar el panel y reabrirlo a mitad de campaña → se pone al día.
5. Al terminar → se abre el resumen; el CSV abre con acentos correctos y el `.xlsx` abre en Excel sin advertencias.
6. Reabrir el historial tras cerrar el navegador → la campaña sigue ahí y se puede descargar.
