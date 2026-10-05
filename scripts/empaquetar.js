/**
 * Genera dist/MailerPro-<versión>.zip, el paquete que se publica en la landing.
 *
 * Lista blanca y no lista negra: mailerpro-key.pem vive en la raíz del repo y,
 * si se filtra, cualquiera puede publicar una extensión con nuestro ID y
 * secuestrar el OAuth de Google. Lo que no está explícitamente permitido no
 * entra, aunque alguien agregue archivos nuevos al repo.
 *
 * El nombre lleva la versión porque Cloudflare cachea /files/* 4 h: con un
 * nombre fijo, otras PCs seguían bajando la versión anterior.
 *
 * Sin dependencias: ZIP con deflate de node:zlib y fecha fija, así dos
 * corridas sobre el mismo código dan el mismo archivo byte a byte.
 */
import fs from 'node:fs';
import path from 'node:path';
import { deflateRawSync, crc32 } from 'node:zlib';

const PREFIJO_RELEASE = 'MailerPro/';
const FECHA_FIJA = new Date(Date.UTC(2026, 0, 1));
const ARCHIVOS_RAIZ = new Set(['manifest.json', 'background.js', 'INSTRUCCIONES.md']);
const CARPETAS_RELEASE = ['ui', 'assets'];
const EXTENSIONES_ASSETS = new Set(['.png']);

export function estaIncluida(rel) {
  if (rel.endsWith('.pem')) return false;
  if (ARCHIVOS_RAIZ.has(rel)) return true;
  if (rel.startsWith('ui/')) return true;
  if (rel.startsWith('assets/')) return EXTENSIONES_ASSETS.has(path.extname(rel));
  return false;
}

export function listarArchivosRelease(raiz) {
  const encontrados = [...ARCHIVOS_RAIZ].filter((rel) => fs.existsSync(path.join(raiz, rel)));
  for (const carpeta of CARPETAS_RELEASE) {
    const entradas = fs.readdirSync(path.join(raiz, carpeta), { recursive: true, withFileTypes: true });
    for (const entrada of entradas) {
      if (!entrada.isFile()) continue;
      const rel = path.relative(raiz, path.join(entrada.parentPath, entrada.name)).split(path.sep).join('/');
      if (estaIncluida(rel)) encontrados.push(rel);
    }
  }
  return encontrados.sort();
}

export function escribirZip(archivos, raiz, destino) {
  const { dosTime, dosDate } = fechaDos(FECHA_FIJA);
  const locales = [];
  const centrales = [];
  let desplazamiento = 0;

  for (const rel of archivos) {
    const contenido = fs.readFileSync(path.join(raiz, ...rel.split('/')));
    const comprimido = deflateRawSync(contenido);
    const entrada = {
      nombre: Buffer.from(`${PREFIJO_RELEASE}${rel}`, 'utf8'),
      crc: crc32(contenido) >>> 0,
      tamComprimido: comprimido.length,
      tamOriginal: contenido.length,
      dosTime,
      dosDate
    };
    const local = cabeceraLocal(entrada);
    locales.push(local, entrada.nombre, comprimido);
    centrales.push(entradaCentral(entrada, desplazamiento), entrada.nombre);
    desplazamiento += local.length + entrada.nombre.length + comprimido.length;
  }

  const directorio = Buffer.concat(centrales);
  const fin = finDeDirectorio(archivos.length, directorio.length, desplazamiento);
  fs.mkdirSync(path.dirname(destino), { recursive: true });
  fs.writeFileSync(destino, Buffer.concat([...locales, directorio, fin]));
  return destino;
}

function fechaDos(fecha) {
  return {
    dosTime: (fecha.getUTCHours() << 11) | (fecha.getUTCMinutes() << 5) | Math.floor(fecha.getUTCSeconds() / 2),
    dosDate: ((fecha.getUTCFullYear() - 1980) << 9) | ((fecha.getUTCMonth() + 1) << 5) | fecha.getUTCDate()
  };
}

function cabeceraLocal(e) {
  const buf = Buffer.alloc(30);
  buf.writeUInt32LE(0x04034b50, 0);
  buf.writeUInt16LE(20, 4);
  buf.writeUInt16LE(0x0800, 6); // bit 11: nombres en UTF-8
  buf.writeUInt16LE(8, 8); // deflate
  buf.writeUInt16LE(e.dosTime, 10);
  buf.writeUInt16LE(e.dosDate, 12);
  buf.writeUInt32LE(e.crc, 14);
  buf.writeUInt32LE(e.tamComprimido, 18);
  buf.writeUInt32LE(e.tamOriginal, 22);
  buf.writeUInt16LE(e.nombre.length, 26);
  return buf;
}

function entradaCentral(e, offsetLocal) {
  const buf = Buffer.alloc(46);
  buf.writeUInt32LE(0x02014b50, 0);
  buf.writeUInt16LE(20, 4);
  buf.writeUInt16LE(20, 6);
  buf.writeUInt16LE(0x0800, 8);
  buf.writeUInt16LE(8, 10);
  buf.writeUInt16LE(e.dosTime, 12);
  buf.writeUInt16LE(e.dosDate, 14);
  buf.writeUInt32LE(e.crc, 16);
  buf.writeUInt32LE(e.tamComprimido, 20);
  buf.writeUInt32LE(e.tamOriginal, 24);
  buf.writeUInt16LE(e.nombre.length, 28);
  buf.writeUInt32LE(offsetLocal, 42);
  return buf;
}

function finDeDirectorio(cantidad, tamDirectorio, inicioDirectorio) {
  const buf = Buffer.alloc(22);
  buf.writeUInt32LE(0x06054b50, 0);
  buf.writeUInt16LE(cantidad, 8);
  buf.writeUInt16LE(cantidad, 10);
  buf.writeUInt32LE(tamDirectorio, 12);
  buf.writeUInt32LE(inicioDirectorio, 16);
  return buf;
}

if (import.meta.filename === path.resolve(process.argv[1] || '')) {
  const raiz = path.resolve(import.meta.dirname, '..');
  const { version } = JSON.parse(fs.readFileSync(path.join(raiz, 'manifest.json'), 'utf8'));
  const destino = path.join(raiz, 'dist', `MailerPro-${version}.zip`);
  const archivos = listarArchivosRelease(raiz);
  escribirZip(archivos, raiz, destino);
  console.log(`Release escrito: ${destino} (${archivos.length} archivos)`);
}
