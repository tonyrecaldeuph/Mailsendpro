import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { inflateRawSync } from 'node:zlib';
import { estaIncluida, listarArchivosRelease, escribirZip } from '../scripts/empaquetar.js';

test('entran el manifest, el service worker, la UI, los íconos y las instrucciones', () => {
  for (const rel of ['manifest.json', 'background.js', 'INSTRUCCIONES.md', 'ui/dashboard.html', 'ui/lib/xlsx.js', 'assets/icon128.png']) {
    assert.equal(estaIncluida(rel), true, rel);
  }
});

test('nunca entra la clave privada, aunque esté dentro de una carpeta incluida', () => {
  assert.equal(estaIncluida('mailerpro-key.pem'), false);
  assert.equal(estaIncluida('ui/mailerpro-key.pem'), false);
});

test('quedan fuera tests, docs, guías internas y el script de íconos', () => {
  for (const rel of ['tests/mimeBuilder.test.js', 'docs/superpowers/plan.md', 'CLAUDE.md', 'AGENTS.md', 'package.json', 'assets/gen_icons.py', 'scripts/empaquetar.js']) {
    assert.equal(estaIncluida(rel), false, rel);
  }
});

test('la lista del release sale ordenada y sin la clave del repo real', () => {
  const raiz = path.resolve(import.meta.dirname, '..');
  const archivos = listarArchivosRelease(raiz);
  assert.deepEqual(archivos, [...archivos].sort());
  assert.ok(archivos.includes('manifest.json'));
  assert.ok(!archivos.some((rel) => rel.endsWith('.pem')));
});

test('el zip guarda cada archivo bajo MailerPro/ y se puede descomprimir', () => {
  const raiz = fs.mkdtempSync(path.join(os.tmpdir(), 'mailerpro-'));
  fs.writeFileSync(path.join(raiz, 'manifest.json'), '{"version":"9.9.9"}');
  const destino = path.join(raiz, 'dist', 'MailerPro.zip');

  escribirZip(['manifest.json'], raiz, destino);

  const zip = fs.readFileSync(destino);
  assert.equal(zip.readUInt32LE(0), 0x04034b50);
  const largoNombre = zip.readUInt16LE(26);
  const tamComprimido = zip.readUInt32LE(18);
  assert.equal(zip.toString('utf8', 30, 30 + largoNombre), 'MailerPro/manifest.json');
  const datos = zip.subarray(30 + largoNombre, 30 + largoNombre + tamComprimido);
  assert.equal(inflateRawSync(datos).toString('utf8'), '{"version":"9.9.9"}');
});
