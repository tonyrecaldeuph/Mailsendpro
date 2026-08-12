/**
 * Lógica de procesamiento de archivos Excel usando SheetJS.
 * A diferencia del formato fijo de la extensión de SMS, MailerPro acepta
 * cualquier columna: cada encabezado del Excel queda disponible como
 * variable de mensaje ({Columna}). Solo la columna de correo es obligatoria.
 */

// Encabezados aceptados para la columna de correo (case-insensitive, sin
// espacios extra). "CORREO CLIENTE" es el formato real que usa la empresa;
// se aceptan alias comunes para no romper otros archivos.
const EMAIL_COLUMN_ALIASES = ['correo cliente', 'email', 'correo', 'correo electronico', 'e-mail'];

const DataProcessor = {
    /**
     * Lee un archivo Excel y devuelve contactos con todas sus columnas.
     * @param {File} file - El archivo subido (.xlsx / .xls).
     * @returns {Promise<Array<Object>>} - Contactos, uno por fila válida.
     */
    async readContacts(file) {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();

            reader.onload = (e) => {
                try {
                    const data = new Uint8Array(e.target.result);
                    const workbook = XLSX.read(data, { type: 'array' });

                    const firstSheetName = workbook.SheetNames[0];
                    const worksheet = workbook.Sheets[firstSheetName];

                    // raw:false conserva el texto formateado tal como se ve en Excel
                    // (montos con símbolo de moneda/separadores, fechas, ceros a la
                    // izquierda) en vez del valor numérico crudo subyacente — importante
                    // para columnas como MONTO POR COBRAR que se insertan tal cual en el mensaje.
                    const rows = XLSX.utils.sheet_to_json(worksheet, { header: 1, defval: '', raw: false });
                    if (!rows.length) {
                        reject('El archivo Excel está vacío.');
                        return;
                    }

                    const headers = rows[0].map(h => String(h).trim());
                    const emailIndex = headers.findIndex(h => EMAIL_COLUMN_ALIASES.includes(normalizeHeader(h)));
                    if (emailIndex === -1) {
                        reject('No se encontró una columna de correo (ej. "CORREO CLIENTE") en el archivo. Verifica los encabezados de la primera fila.');
                        return;
                    }

                    const contacts = [];
                    for (let i = 1; i < rows.length; i++) {
                        const row = rows[i];
                        const email = String(row[emailIndex] ?? '').trim();
                        if (!validateEmail(email)) continue;

                        const contact = {};
                        headers.forEach((header, colIndex) => {
                            if (!header) return;
                            contact[header] = String(row[colIndex] ?? '').trim();
                        });
                        contacts.push(contact);
                    }

                    if (contacts.length === 0) {
                        reject('No se encontraron filas con un email válido. Verifica la columna de correo.');
                        return;
                    }

                    resolve(contacts);
                } catch (error) {
                    console.error('Error procesando archivo:', error);
                    reject('Error al leer el archivo. Asegúrate que sea un archivo Excel (.xlsx) válido.');
                }
            };

            reader.onerror = () => reject('Error al leer el archivo.');
            reader.readAsArrayBuffer(file);
        });
    },

    /**
     * Devuelve las columnas disponibles como variables para el mensaje.
     * @param {Array<Object>} contacts - Lista de contactos.
     * @returns {Array<string>} - Nombres de columnas.
     */
    getAvailableVariables(contacts) {
        if (contacts.length === 0) return [];
        return Object.keys(contacts[0]);
    }
};

function validateEmail(email) {
    return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim());
}

function normalizeHeader(header) {
    return String(header)
        .trim()
        .toLowerCase()
        .replace(/[áàäâ]/g, 'a')
        .replace(/[éèëê]/g, 'e')
        .replace(/[íìïî]/g, 'i')
        .replace(/[óòöô]/g, 'o')
        .replace(/[úùüû]/g, 'u')
        .replace(/\s+/g, ' ');
}
