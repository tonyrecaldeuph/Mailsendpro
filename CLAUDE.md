# MailerPro — guía para Claude Code

Extensión de Chrome (Manifest V3) para envío masivo de correo **directamente
desde la cuenta de Gmail del usuario** vía Gmail API. v3.3.0, rama `main`.

## Comandos

```bash
node --test          # suite completa — 115 tests, <1s
npm run empaquetar   # genera dist/MailerPro-<versión>.zip para la landing
node --test tests/mimeBuilder.test.js   # un archivo
```

No hay build, ni bundler, ni `npm install`: **cero dependencias**. El código
que se escribe es el que corre. `ui/lib/xlsx.js` está vendored a propósito.

Para probar en el navegador: `chrome://extensions` → Modo desarrollador →
"Cargar extensión sin empaquetar" → seleccionar esta carpeta. Tras editar
`background.js` hay que pulsar recargar en esa página.

## Arquitectura

- `background.js` (service worker, ~640 líneas) — **único orquestador**. Mantiene
  el estado de la campaña en curso, el bucle de envío, pausa/cancelación y
  cuota agotada. Importa todo lo demás como módulos ESM.
- `ui/*.js` — módulos de lógica pura, sin `chrome.*`, por eso son testeables
  desde Node: `mimeBuilder`, `emailValidator`, `dataProcessor`,
  `recipientFields`, `reportBuilder`, `suspectReport`, `campaignLog`,
  `gmailErrors`.
- `ui/gmailAuth.js`, `ui/historyStore.js`, `ui/licenseClient.js` — sí tocan
  APIs de Chrome; se testean solo en su parte pura.
- `ui/dashboard.html|js` — popup principal. `ui/monitor.html|js` — side panel.
- `tests/` — `node:test` + `node:assert/strict`, un archivo por módulo.

## Restricciones que NO hay que romper

1. **El service worker MV3 muere a los ~30s sin llamadas a API de extensión, y
   un `setTimeout` encadenado no cuenta como actividad.** Por eso existe
   `keepAlive()` en `background.js`. Si se agrega cualquier espera larga
   (pausa por cuota, backoff), tiene que pasar por `keepAlive()` o el worker
   se recicla y el bucle de envío desaparece sin dejar rastro.
2. **El campo `key` del `manifest.json` fija el extension ID.** Cambiarlo
   invalida el OAuth de Google y todas las licencias emitidas.
3. `mailerpro-key.pem` está en `.gitignore` (`*.pem`). No commitearla nunca ni
   pegar su contenido en un chat o en un log.
4. El progreso de campaña se persiste **después de cada correo**, no al final:
   si Chrome recicla el worker, el reporte se reconstruye. No mover esa
   escritura fuera del bucle.

## Convenciones

- ESM en todo (`"type": "module"`), sin transpilación.
- Los comentarios explican **el porqué**, no el qué — sobre todo las rarezas de
  MV3 y de la Gmail API. Mantener ese estilo.
- Mensajes de commit en español, minúscula, prefijo `feat:` / `fix:` / `merge:`.
- Los textos de UI son para usuario final no técnico: español rioplatense,
  sin jerga.

## Envío y fallos

El envío usa el endpoint de *upload* (`uploadType=media`) para mandar el MIME
crudo, no el de metadatos. `MAX_RATE_RETRIES = 3`. Los errores se clasifican en
`ui/gmailErrors.js`; la cuota agotada **pausa** la campaña en vez de abortarla,
para que el usuario conecte una segunda cuenta.

Antes de tocar reintentos, cuotas, backoff, la alarma de licencia (6h) o
cualquier camino de fallo del envío: **usar la skill `reliability-pass`**.

---

## Sesgo de estilo (Clean Code, versión nano)

Destilado de *Clean Code* (Robert C. Martin) por [agent-rules-books](https://github.com/ciembor/agent-rules-books) (MIT).
Prueba a 2 semanas: si no cambia nada visible, se borra esta sección.


### When to use

Use when you need a small always-on bias toward readable, low-surprise code.

### Primary bias to correct

Working code is not automatically clean code.

### Decision rules

- Preserve behavior, write for the next reader, and leave touched code cleaner within scope.
- Write for local reasoning and use precise names with one term per concept.
- Split boolean flags, mixed abstraction levels, and hidden side effects out of functions.
- Separate commands from queries and keep parameters small and meaningful.
- Keep the happy path readable; make invalid states, errors, and cleanup explicit instead of implicit.
- Use comments only for rationale or contracts, not to explain confusing code.
- When touching code, remove the smell most likely to make the next change risky or unclear.

### Trigger rules

- When a function both mutates and answers, split it.
- When a comment explains the flow, simplify the code first.
- When async, concurrency, or framework quirks spread the change, reduce shared mutable state and add the right boundary instead of more branching.

### Final checklist

- Local reasoning preserved?
- Clear names?
- Clear mutation boundaries?
- One smell removed?
