import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * ui/dataProcessor.js se carga en el dashboard como <script> clásico, no como
 * módulo ESM, así que no se puede importar. Se evalúa en un contexto aislado
 * —igual que lo haría el navegador— y se toma el global que define.
 */
function loadDataProcessor() {
  const code = fs.readFileSync(path.join(here, '..', 'ui', 'dataProcessor.js'), 'utf8');
  const context = { console, String, Object, Array, RegExp };
  vm.createContext(context);
  // El archivo declara `const DataProcessor`, que no queda como propiedad del
  // objeto global: se devuelve evaluando su nombre como última expresión, que
  // es también como lo alcanzan los otros scripts del dashboard.
  return vm.runInContext(`${code}\n;DataProcessor;`, context);
}

const DataProcessor = loadDataProcessor();

const contactoCompleto = () => ({
  'CORREO CLIENTE': 'ana@corp.com',
  'NOMBRE CLIENTE': 'Ana',
  'MONTO POR COBRAR': '1.200',
  VENDEDOR: 'Pedro',
  'OFICIAL CREDITO ARCHIVOS': 'X',
  'OFICIAL CREDITO CONTRATO': 'Y',
  'OFICIAL CREDITO LLAMADA': 'Z',
  HH: '8',
  GESTOR: 'Luis',
  SUPERVISOR: 'Marta',
  JEFE: 'Carlos'
});

test('las columnas internas se suprimen del contacto', () => {
  const [limpio] = DataProcessor.stripIgnoredColumns([contactoCompleto()]);
  assert.deepEqual(Object.keys(limpio), ['CORREO CLIENTE', 'NOMBRE CLIENTE', 'MONTO POR COBRAR']);
});

test('las columnas que el usuario sí usa quedan intactas', () => {
  const [limpio] = DataProcessor.stripIgnoredColumns([contactoCompleto()]);
  assert.equal(limpio['CORREO CLIENTE'], 'ana@corp.com');
  assert.equal(limpio['NOMBRE CLIENTE'], 'Ana');
  assert.equal(limpio['MONTO POR COBRAR'], '1.200');
});

test('no importan mayúsculas, acentos ni espacios de más en el encabezado', () => {
  const [limpio] = DataProcessor.stripIgnoredColumns([{
    correo: 'a@b.com',
    '  Vendedor ': 'Pedro',
    'Oficial Credito Contrato': 'Y',
    'oficial crédito archivos': 'X',
    Jefe: 'Carlos'
  }]);
  assert.deepEqual(Object.keys(limpio), ['correo']);
});

test('se acepta la grafía "OCIAL CREDITO LLAMADA" del archivo real', () => {
  const [limpio] = DataProcessor.stripIgnoredColumns([{
    correo: 'a@b.com',
    'OCIAL CREDITO LLAMADA': 'Z'
  }]);
  assert.deepEqual(Object.keys(limpio), ['correo']);
});

test('una columna que solo contiene el nombre de una ignorada no se borra', () => {
  const [limpio] = DataProcessor.stripIgnoredColumns([{
    correo: 'a@b.com',
    'JEFE DE ZONA': 'Norte',
    'OBSERVACION GESTOR': 'llamar el lunes'
  }]);
  assert.deepEqual(Object.keys(limpio), ['correo', 'JEFE DE ZONA', 'OBSERVACION GESTOR']);
});

test('varios contactos se limpian por igual', () => {
  const limpios = DataProcessor.stripIgnoredColumns([contactoCompleto(), contactoCompleto()]);
  assert.equal(limpios.length, 2);
  limpios.forEach((c) => assert.equal(c.GESTOR, undefined));
});

test('una lista vacía no rompe', () => {
  // Se compara la longitud y no con deepEqual: el arreglo lo crea el contexto
  // aislado del cargador, y su prototipo no es el mismo Array que el de acá.
  assert.equal(DataProcessor.stripIgnoredColumns([]).length, 0);
  assert.equal(DataProcessor.stripIgnoredColumns(null).length, 0);
  assert.equal(DataProcessor.stripIgnoredColumns(undefined).length, 0);
});

test('las variables ofrecidas al mensaje ya no incluyen las suprimidas', () => {
  const limpios = DataProcessor.stripIgnoredColumns([contactoCompleto()]);
  const variables = DataProcessor.getAvailableVariables(limpios);
  assert.ok(!variables.includes('GESTOR'));
  assert.ok(!variables.includes('VENDEDOR'));
  assert.ok(variables.includes('NOMBRE CLIENTE'));
});
