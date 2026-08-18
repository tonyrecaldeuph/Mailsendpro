/**
 * Revisa una lista de destinatarios y señala las direcciones que casi seguro
 * van a rebotar, antes de gastarles un envío.
 *
 * Consulta el DNS por HTTPS contra dns.google. Se agrupa por dominio y se
 * cachea: una lista de 500 clientes suele tener menos de veinte dominios
 * distintos, así que son unas pocas consultas y no quinientas.
 */

import { getDomain, suggestDomain, interpretDnsResponse } from './emailValidator.js';

const DNS_ENDPOINT = 'https://dns.google/resolve';

// Vive mientras el dashboard esté abierto. No se persiste a propósito: un
// dominio recién comprado empieza a funcionar de un día para el otro y no
// conviene recordar para siempre que estaba mal.
const domainCache = new Map();

export const PROBLEM_LABELS = {
  typo: 'Dominio mal escrito',
  inexistente: 'El dominio no existe',
  'sin-correo': 'El dominio no recibe correo'
};

async function lookupDomain(domain) {
  if (domainCache.has(domain)) return domainCache.get(domain);

  let verdict = 'desconocido';
  try {
    const response = await fetch(`${DNS_ENDPOINT}?name=${encodeURIComponent(domain)}&type=MX`);
    if (response.ok) verdict = interpretDnsResponse(await response.json());
  } catch (err) {
    // Sin internet no se marca nada: es preferible dejar pasar una dirección
    // dudosa antes que hacerle descartar un cliente bueno por un fallo de red.
    console.warn('[audit] no se pudo consultar el dominio', domain, err?.message || err);
  }

  domainCache.set(domain, verdict);
  return verdict;
}

/**
 * @param {Array<string>} emails Direcciones ya resueltas de los destinatarios
 * @returns {Promise<Array<{email: string, problem: 'typo'|'inexistente'|'sin-correo', suggestion: string|null}>>}
 *   Solo las direcciones con algún problema; el resto no aparece.
 */
export async function auditEmails(emails) {
  const list = (emails || []).filter(Boolean);
  if (list.length === 0) return [];

  // Un typo de dominio se detecta sin red y es más específico que el resultado
  // del DNS (gmial.com además no existe, pero decir "quisiste decir gmail.com"
  // es mucho más útil que decir "no existe").
  const findings = [];
  const domainsToCheck = new Set();

  list.forEach((email) => {
    const domain = getDomain(email);
    if (!domain) return;
    const suggestion = suggestDomain(domain);
    if (suggestion) {
      findings.push({ email, problem: 'typo', suggestion });
      return;
    }
    domainsToCheck.add(domain);
  });

  const verdicts = new Map();
  await Promise.all(
    [...domainsToCheck].map(async (domain) => {
      verdicts.set(domain, await lookupDomain(domain));
    })
  );

  list.forEach((email) => {
    if (findings.some((f) => f.email === email)) return;
    const verdict = verdicts.get(getDomain(email));
    if (verdict === 'inexistente' || verdict === 'sin-correo') {
      findings.push({ email, problem: verdict, suggestion: null });
    }
  });

  return findings;
}

/** Aplica la corrección sugerida a una dirección. */
export function applySuggestion(email, suggestion) {
  const at = String(email || '').lastIndexOf('@');
  if (at === -1 || !suggestion) return email;
  return `${email.slice(0, at + 1)}${suggestion}`;
}
