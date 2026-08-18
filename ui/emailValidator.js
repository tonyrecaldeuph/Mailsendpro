/**
 * Detección de direcciones que casi seguro van a rebotar, antes de gastar un
 * envío en ellas.
 *
 * Cubre las dos causas habituales de una dirección mal cargada en el Excel:
 * el dominio mal tipeado (gmial.com) y el dominio que no recibe correo. Lo que
 * no puede saber es si el buzón existe: para eso habría que leer los avisos de
 * rebote de la bandeja de entrada, y eso exige un permiso de Gmail restringido
 * que arrastra una auditoría de seguridad anual carísima.
 *
 * Módulo puro: la consulta DNS la hace quien lo use, acá solo se interpreta.
 */

/** Los dominios de correo personales más frecuentes en las listas de la empresa. */
export const COMMON_DOMAINS = [
  'gmail.com',
  'hotmail.com',
  'hotmail.es',
  'outlook.com',
  'outlook.es',
  'yahoo.com',
  'yahoo.es',
  'live.com',
  'icloud.com'
];

export function getDomain(email) {
  const text = String(email || '').trim().toLowerCase();
  const at = text.lastIndexOf('@');
  if (at === -1) return '';
  return text.slice(at + 1);
}

/** Distancia de edición: cuántos caracteres hay que cambiar para llegar de a a b. */
export function levenshtein(a, b) {
  const source = String(a || '');
  const target = String(b || '');
  if (source === target) return 0;
  if (!source.length) return target.length;
  if (!target.length) return source.length;

  let previous = Array.from({ length: target.length + 1 }, (_, i) => i);

  for (let i = 0; i < source.length; i += 1) {
    const current = [i + 1];
    for (let j = 0; j < target.length; j += 1) {
      const cost = source[i] === target[j] ? 0 : 1;
      current[j + 1] = Math.min(
        current[j] + 1,          // inserción
        previous[j + 1] + 1,     // borrado
        previous[j] + cost       // sustitución
      );
    }
    previous = current;
  }

  return previous[target.length];
}

/**
 * Sugiere el dominio correcto cuando el escrito se parece demasiado a uno
 * común. Devuelve null si el dominio ya es correcto o si no se parece a
 * ninguno: un dominio corporativo propio nunca debe generar sugerencias.
 *
 * @returns {string|null}
 */
export function suggestDomain(domain) {
  const clean = String(domain || '').trim().toLowerCase();
  if (!clean) return null;
  if (COMMON_DOMAINS.includes(clean)) return null;

  let best = null;
  let bestDistance = Infinity;

  COMMON_DOMAINS.forEach((candidate) => {
    const distance = levenshtein(clean, candidate);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = candidate;
    }
  });

  // Hasta dos ediciones se considera un typo; de ahí en más son dominios
  // distintos y sugerir sería adivinar. "uphone.com.ec" queda a más de dos de
  // cualquier dominio común, así que se respeta tal cual.
  return bestDistance <= 2 ? best : null;
}

/**
 * Traduce la respuesta de DNS-over-HTTPS a algo accionable.
 *
 * @param {Object|null} response Cuerpo JSON de dns.google/resolve
 * @returns {'ok'|'inexistente'|'sin-correo'|'desconocido'}
 *   'desconocido' cuando no se puede afirmar nada —sin internet, respuesta
 *   rara—: en ese caso no se marca nada, porque un falso positivo haría que el
 *   usuario descarte a un cliente bueno.
 */
export function interpretDnsResponse(response) {
  if (!response || typeof response.Status !== 'number') return 'desconocido';

  // 3 = NXDOMAIN: el dominio no existe.
  if (response.Status === 3) return 'inexistente';
  if (response.Status !== 0) return 'desconocido';

  // Tipo 15 es MX. Sin ningún MX, nadie recibe correo en ese dominio.
  // Un MX que apunta a la raíz —"0 ." , el "null MX" de RFC 7505— es la forma
  // estándar de declarar que el dominio no recibe correo, así que no cuenta.
  const hasMx = (response.Answer || []).some((record) => {
    if (record.type !== 15) return false;
    const host = String(record.data || '').split(' ').slice(1).join(' ').trim();
    return host !== '' && host !== '.';
  });

  return hasMx ? 'ok' : 'sin-correo';
}
