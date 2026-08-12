# 🚀 Mailer Pro — Instrucciones Completas

---

> **⚠️ Si ya tenías el backend desplegado antes de esta versión:** el soporte de
> adjuntos PDF, el límite de 60 correos/hora y la validación de licencia
> requieren el `Code.gs` actualizado. Volvé a copiar el contenido de
> `google-apps-script/Code.gs` en tu proyecto de Apps Script y hacé una
> **Nueva versión** al re-implementar (Implementar → Administrar
> implementaciones → editar (lápiz) → Versión: Nueva versión → Implementar).
> La URL del Enlace Mágico no cambia. Al re-implementar es posible que te
> pida autorizar un permiso nuevo (el script ahora hace una llamada de red al
> servidor de licencias) — aceptalo igual que la primera vez.
>
> Este backend **no usa un token manual por instalación** — en su lugar,
> valida la misma licencia que ya activaste en la extensión (menú
> "Licencia") contra el servidor de licencias antes de enviar cada correo.
> Sin una licencia activa, el backend rechaza el envío aunque alguien
> descubra la URL y la use directamente, sin pasar por la extensión.

---

## PASO 1: Crear el Backend en Google

1. Abre tu navegador e inicia sesión con la cuenta Gmail que quieres usar como remitente.
2. Ve a: https://script.google.com
3. Haz clic en "+ Nuevo proyecto".
4. Arriba donde dice "Proyecto sin título", cámbiale el nombre a: Mailer Pro Backend
5. Verás un archivo llamado Código.gs — BORRA TODO su contenido.
6. Copia y pega el contenido de `google-apps-script/Code.gs` (de esta misma carpeta).
7. Guarda con Ctrl + S.

---

## PASO 2: Desplegar el Script

8. Haz clic en el botón azul "Implementar" (arriba a la derecha).
9. Selecciona "Nueva implementación".
10. Haz clic en el ícono de engranaje al lado de "Seleccionar tipo".
11. Selecciona "Aplicación web".
12. Configura así:
    - Descripción: Mailer Pro v1
    - Ejecutar como: Yo (tu email)
    - Quién tiene acceso: Cualquiera
13. Haz clic en "Implementar".

Si te pide permisos:
14. Haz clic en "Autorizar acceso".
15. Selecciona tu cuenta de Google.
16. Haz clic en "Avanzado" (abajo a la izquierda).
17. Haz clic en "Ir a Mailer Pro Backend (no seguro)".
18. Haz clic en "Permitir".

19. Verás la URL de tu App web. HAZ CLIC EN "Copiar".
20. Haz clic en "Listo".

IMPORTANTE: Esa URL es tu "Enlace Mágico". Guárdala bien.

Para verificar: Abre esa URL en el navegador. Debes ver:
{"status":"ok","message":"Mailer Pro Backend activo"}

---

## PASO 3: Instalar la Extensión

### En Google Chrome:
1. Escribe en la barra: chrome://extensions
2. Activa "Modo desarrollador" (arriba a la derecha).
3. Haz clic en "Cargar extensión sin empaquetar".
4. Selecciona ESTA CARPETA (MailerPro).
5. Listo!

### En Brave:
1. Escribe en la barra: brave://extensions
2. Activa "Modo desarrollador".
3. Haz clic en "Cargar extensión sin empaquetar".
4. Selecciona ESTA CARPETA.
5. Listo!

### En Microsoft Edge:
1. Escribe en la barra: edge://extensions
2. Activa "Modo de desarrollador" (abajo a la izquierda).
3. Haz clic en "Cargar desempaquetada".
4. Selecciona ESTA CARPETA.
5. Listo!

### En Opera / Opera GX:
1. Escribe en la barra: opera://extensions
2. Activa "Modo desarrollador".
3. Haz clic en "Cargar extensión sin empaquetar".
4. Selecciona ESTA CARPETA.
5. Listo!

### En Firefox (versión 121+):
1. Escribe en la barra: about:debugging#/runtime/this-firefox
2. Haz clic en "Cargar complemento temporal".
3. Selecciona el archivo manifest.json de ESTA CARPETA.
4. NOTA: En Firefox se borra al cerrar el navegador.

---

## PASO 4: Configurar la Extensión

1. Haz clic en el ícono de la extensión en la barra del navegador.
2. En el menú superior, abre "Configuración".
3. Pega la URL que copiaste en el Paso 2.
4. Escribe el nombre del remitente (ej: "Mi Empresa S.A.").
5. Haz clic en "Listo".

El campo "Token de Seguridad" es opcional: solo hace falta completarlo si tu
backend fue modificado a mano para exigir un `SHARED_TOKEN` propio (ver nota
al inicio de este documento). Por defecto el backend no lo valida.

---

## PASO 5: Activar tu Licencia

1. En el menú superior, abre "Licencia" (o hacé clic en el indicador de licencia del pie de página).
2. Pega la clave de licencia que te entregó AnomalyDevs (formato `UPHONE-XXXX-XXXX-XXXX`).
3. Haz clic en "Activar".
4. El indicador pasa a 🟢 con el nombre de tu empresa y los días restantes.

Sin una licencia activa no es posible iniciar una campaña — el botón "Iniciar Campaña" permanece deshabilitado.

Si pierdes conexión a internet, la extensión sigue funcionando hasta 48 horas con la última validación exitosa (gracia offline). Pasado ese margen, hay que reconectar para revalidar.

---

## PASO 6: Enviar Correos

1. En la sección "Destinatarios", haz clic en "Importar Excel" y selecciona tu archivo (.xlsx o .xls).
   - La primera fila del archivo debe tener encabezados de columna.
   - Debe existir una columna llamada **CORREO CLIENTE** (también acepta "email", "correo" o "correo electrónico", sin importar mayúsculas/minúsculas ni tildes).
   - Cualquier otra columna (ej. NOMBRE CLIENTE, MONTO POR COBRAR, empresa, ciudad, etc.) queda disponible como variable del mensaje.
   - Las filas sin un email válido se descartan automáticamente.
   - Los montos y fechas se insertan tal como se ven en Excel (con símbolo de moneda, separadores, etc.), no como el número crudo.

2. Escribe el asunto del correo (también admite variables).

3. Escribe el mensaje. Las variables detectadas en tu Excel aparecen como chips debajo del mensaje — haz clic en una para insertarla en el punto del cursor. Por ejemplo, si tu Excel tiene una columna "Nombre", la variable es `{Nombre}`.

4. Adjunta una imagen (opcional, JPG/PNG/GIF/WEBP, máx. 5MB).
   La imagen se embebe directamente en el correo.

4b. Adjunta hasta 3 archivos PDF (opcional, máx. 5MB cada uno).
    Los PDF viajan como adjunto real (descargable), no se embeben en el cuerpo del correo.

5. Configura el intervalo entre envíos (segundos).
   Recomendado: 5-15 segundos.

6. Haz clic en "Iniciar Campaña".

Cada fila de la lista de destinatarios muestra su estado en vivo durante el envío: Pendiente ⏳ / Enviando... ⏳ / Enviado ✅ / Error ❌.

---

## Controles Durante el Envío

- PAUSAR: Detiene temporalmente. El progreso se conserva.
- REANUDAR: Continúa desde donde se pausó.
- CANCELAR: Detiene definitivamente la campaña.
- REINICIAR: Limpia todo para una nueva campaña (aparece al terminar).

---

## Correos Fallidos

- Si algún correo falla, aparece el botón "Ver Errores" debajo de la barra de progreso.
- Haz clic para ver la lista de correos fallidos y el motivo.
- Usa "Copiar Correos Fallidos" para copiarlos al portapapeles y reintentar.

---

## Cambiar de Cuenta Gmail

Los correos se envían desde la cuenta donde creaste el script.
Para cambiar de cuenta:

1. Cierra sesión o abre una ventana de incógnito.
2. Inicia sesión con la nueva cuenta Gmail.
3. Ve a https://script.google.com
4. Crea un nuevo proyecto y repite los Pasos 1-2.
5. Copia la NUEVA URL y pégala en "Configuración".

IMPORTANTE: La URL vieja sigue enviando desde la cuenta vieja.
Siempre usa la URL de la cuenta correcta.

---

## Límites de Gmail

- Gmail gratuito: ~500 correos por día
- Google Workspace: ~2,000 correos por día

Si superas el límite, Google bloquea tu cuenta de envío por ~24 horas.

## Intervalos Recomendados

- Menos de 50 correos: 3-5 segundos
- 50-200 correos: 5-10 segundos
- 200-500 correos: 10-15 segundos

---

## Problemas Comunes

"El archivo Excel no se importa / dice que falta la columna de correo":
- Verifica que la primera fila tenga los encabezados de columna y que una de ellas se llame "CORREO CLIENTE" (o "email", "correo", "correo electrónico").

"El botón Iniciar Campaña está deshabilitado":
- Revisa el indicador de licencia en el pie de página. Si está en 🔴, activa o renueva tu licencia en el menú "Licencia".
- Verifica que haya al menos un destinatario importado.

"La imagen no se ve en el correo":
- Algunos clientes de correo bloquean imágenes. El destinatario debe
  hacer clic en "Mostrar imágenes".
- Verifica que la imagen sea JPG, PNG, GIF o WEBP y no supere 5MB.

"El PDF no llega / error al enviar con PDF adjunto":
- Verifica que el archivo sea realmente un PDF y no supere 5MB.
- Si el backend (Code.gs) es de antes de esta versión, actualízalo (ver nota
  al inicio de este documento) — la versión vieja rechaza los PDF como tipo
  de adjunto no permitido.
- Máximo 3 PDFs por envío.

"Todos los correos fallan con 'Licencia no válida' aunque el indicador se ve 🟢":
- El backend valida la licencia de forma independiente a la extensión (cada
  correo, con caché de 15 min). Si la licencia venció o se desactivó hace
  poco, la extensión puede tardar hasta 60 segundos en refrescar su propio
  indicador. Esperá un minuto y reintentá, o revisa el estado real en el
  modal "Licencia".
- Si el problema persiste, el servidor de licencias puede estar
  inalcanzable — el backend está diseñado para NO enviar en ese caso
  (fail-closed) en vez de mandar correos sin poder confirmar la licencia.

"Error: Status 403":
- La URL del script expiró. Haz una nueva implementación en
  Google Apps Script y copia la nueva URL.

"La extensión no envía nada":
- Verifica que la URL esté correcta (ábrela en el navegador).
- Revisa la consola del navegador (F12 > Console).
- Asegúrate de haber autorizado los permisos del script.
- Verifica que la licencia esté activa (🟢) en el pie de página.
