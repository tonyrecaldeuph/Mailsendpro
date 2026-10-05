# 🚀 Mailer Pro — Instrucciones Completas

---

> **⚠️ Si venías de una versión anterior:** Mailer Pro ya no usa un backend de
> Google Apps Script. Los correos salen directamente de tu cuenta de Gmail,
> autorizada una sola vez desde la extensión. Podés borrar el proyecto
> "Mailer Pro Backend" de script.google.com: no se usa más. La URL que tenías
> cargada en "Configuración" se elimina sola al abrir esta versión.

---

## PASO 1: Instalar la Extensión

### En Google Chrome:
1. Escribe en la barra: chrome://extensions
2. Activa "Modo desarrollador" (arriba a la derecha).
3. Haz clic en "Cargar extensión sin empaquetar".
4. Selecciona ESTA CARPETA (MailerPro).

### En Brave:
1. Escribe en la barra: brave://extensions — mismos pasos que Chrome.

### En Microsoft Edge:
1. Escribe en la barra: edge://extensions
2. Activa "Modo de desarrollador" (abajo a la izquierda).
3. Haz clic en "Cargar desempaquetada" y selecciona ESTA CARPETA.

### En Opera / Opera GX:
1. Escribe en la barra: opera://extensions — mismos pasos que Chrome.

> Firefox no está soportado: su sistema de autorización genera una dirección
> distinta en cada instalación, incompatible con el permiso de Google.

---

## PASO 2: Activar tu Licencia

1. Haz clic en el ícono de la extensión.
2. En el menú superior, abre "Licencia" (o el indicador del pie de página).
3. Pega la clave que te entregó AnomalyDevs (formato `ANOMALYDEVS-XXXX-XXXX-XXXX`).
4. Haz clic en "Activar". El indicador pasa a 🟢 con el nombre de tu empresa.

Sin licencia activa el botón "Iniciar Campaña" permanece deshabilitado. Si
pierdes conexión, la extensión sigue funcionando 48 horas con la última
validación exitosa.

---

## PASO 3: Conectar tu Cuenta de Gmail

Este paso requiere la licencia activa del paso 2: sin ella, la extensión no
abre la autorización de Google.

1. En el menú superior, abre "Configuración".
2. Haz clic en "Conectar cuenta de Gmail".
3. Elige la cuenta desde la que quieres enviar.
4. Google muestra una pantalla que dice que la aplicación no está verificada.
   Haz clic en "Configuración avanzada" y luego en "Ir a Mailer Pro (no seguro)".
   Es normal: la app está en proceso de verificación con Google.
5. Haz clic en "Continuar" para autorizar el envío de correos.
6. El estado pasa a 🟢 con tu dirección.
7. Escribe el nombre del remitente (ej: "Mi Empresa S.A.") y haz clic en "Listo".

Ese nombre es solo lo que ve el destinatario. La dirección real siempre es la
de la cuenta conectada — Gmail no permite enviar desde otra.

**A partir de acá no hay que repetir nada:** cada vez que abras la extensión,
si esa cuenta tiene la sesión abierta en el navegador, aparece conectada sola.
Si dice 🔴, es porque cerraste sesión de Google o cambiaste de cuenta: un clic
en "Conectar cuenta de Gmail" y listo.

---

## PASO 4: Enviar Correos

1. En "Destinatarios", haz clic en "Importar Excel" y selecciona tu archivo
   (.xlsx o .xls).
   - La primera fila debe tener los encabezados de columna.
   - Debe existir una columna **CORREO CLIENTE** (también acepta "email",
     "correo" o "correo electrónico", sin importar mayúsculas ni tildes).
   - Cualquier otra columna queda disponible como variable del mensaje.
   - Las filas sin email válido se descartan automáticamente.
   - Los montos y fechas se insertan tal como se ven en Excel.

2. Escribe el asunto (también admite variables).

3. Escribe el mensaje. Las variables detectadas aparecen como chips debajo:
   haz clic en una para insertarla. Ejemplo: `{Nombre}`.

4. Adjunta una imagen (opcional, JPG/PNG/GIF/WEBP, máx. 5MB). Se embebe en el
   cuerpo del correo.

5. Adjunta hasta 3 PDFs (opcional, máx. 5MB cada uno). Viajan como adjunto
   descargable. Entre todos los adjuntos no pueden superar 18 MB.

6. Configura el intervalo entre envíos. Recomendado: 5-15 segundos.

7. Haz clic en "Iniciar Campaña".

Cada fila muestra su estado en vivo: Pendiente ⏳ / Enviando... ⏳ /
Enviado ✅ / Error ❌.

---

## Límites de Gmail y envíos de más de 500 correos

Cada cuenta tiene su propio límite diario:

- Gmail gratuito: ~500 correos por día
- Google Workspace: ~2.000 correos por día

**Cuando una cuenta agota su límite, la campaña no se pierde.** Se pausa sola
en el destinatario exacto donde iba y aparece un aviso naranja:

> Límite diario alcanzado en cobranzas@empresa.com — se enviaron 500 de 1.000.

Haz clic en "Conectar otra cuenta y continuar", elige la segunda casilla y la
campaña sigue desde donde quedó. Los correos ya enviados no se repiten y no
hay que volver a importar el Excel. Así se cubren 1.000 envíos en un día con
dos cuentas.

Las cuentas de relevo deben ser casillas propias de la empresa, y el correo,
solicitado por el destinatario. Rotar cuentas para mandar correo no solicitado
termina con las casillas suspendidas por Google.

## Intervalos Recomendados

- Menos de 50 correos: 3-5 segundos
- 50-200 correos: 5-10 segundos
- 200-500 correos: 10-15 segundos

---

## Controles Durante el Envío

- PAUSAR: detiene temporalmente. El progreso se conserva.
- REANUDAR: continúa desde donde se pausó.
- CANCELAR: detiene definitivamente la campaña.
- REINICIAR: limpia todo para una nueva campaña.

---

## Si se corta el envío (retomar campaña)

Si Chrome se cierra, se reinicia la PC o se cae la conexión a mitad de una
campaña, el avance no se pierde: cada correo queda registrado apenas sale.

1. Al volver a abrir la extensión aparece un aviso azul de campaña
   interrumpida, con cuántos correos ya salieron.
2. Haz clic en "Retomar envío desde donde quedó" y vuelve a subir el mismo
   Excel.
3. Se envía solo a quienes faltan: los que ya recibieron el correo (o dieron
   error) no se repiten.

Desde el mismo aviso puedes descargar el avance en CSV o Excel, o descartar la
campaña si no quieres continuarla.

---

## Correos Fallidos

- Si algún correo falla, aparece "Ver Errores" debajo de la barra de progreso.
- "Copiar Correos Fallidos" los copia al portapapeles para reintentar.

---

## Problemas Comunes

"El botón Iniciar Campaña está deshabilitado":
- Revisa el indicador de licencia del pie de página (debe estar en 🟢).
- Verifica que haya destinatarios importados.
- Abre "Configuración": debe haber una cuenta de Gmail conectada (🟢).

"Dice que la cuenta está desconectada y yo tengo Gmail abierto":
- Es una cuenta distinta de la que autorizaste, o cerraste sesión de Google.
  Haz clic en "Conectar cuenta de Gmail" y elige la correcta.

"Google dice que la aplicación no está verificada":
- Es esperado. Haz clic en "Configuración avanzada" → "Ir a Mailer Pro".

"El archivo Excel no se importa / falta la columna de correo":
- La primera fila debe tener encabezados y una columna debe llamarse
  "CORREO CLIENTE" (o "email", "correo", "correo electrónico").

"La imagen no se ve en el correo":
- Algunos clientes de correo bloquean imágenes; el destinatario debe hacer
  clic en "Mostrar imágenes".
- Verifica que la imagen sea JPG, PNG, GIF o WEBP y no supere 5MB.

"El PDF no llega":
- Verifica que sea realmente un PDF y no supere 5MB. Máximo 3 por envío.

"Todos los correos fallan por licencia":
- La licencia se valida contra el servidor al iniciar cada campaña. Si venció
  o se desactivó, revisa el estado real en el modal "Licencia".
