// scratch/test-storage-particionado.js
// Guardado del historial por mes en IndexedDB (storage.js):
// 1. El estado se guarda como núcleo + un registro por mes; al cargar se rearma completo.
// 2. Un guardado normal escribe el núcleo y los meses recientes; los meses viejos sin cambios no se tocan.
// 3. Altas, bajas, montos y cambios de sincronización en un mes viejo se detectan sin marcarlos.
// 4. Una edición en el lugar que no cambia el resumen se guarda si se marca o en la revisión completa.
// 5. Un mes que queda vacío se borra; un estado antiguo (sin partir) se carga y se parte al guardar.
// 6. Rendimiento con 55.000 ventas: cuánto se copia en cada guardado.

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const vm = require('vm');

console.log('=== PRUEBAS: HISTORIAL PARTICIONADO POR MES EN INDEXEDDB ===\n');

// IndexedDB en memoria: transacciones asíncronas, copia estructurada al escribir y registro de lo escrito
const db = new Map(); let lotes = [];
function crearConexion() {
  return {
    objectStoreNames: { contains: () => true }, createObjectStore() {}, close() {}, onversionchange: null, onclose: null,
    transaction(_store, modo) {
      const tx = { oncomplete: null, onerror: null, onabort: null }, escritas = [], borradas = [];
      tx.objectStore = () => ({
        get(k) { const rq = { onsuccess: null }; setTimeout(() => { rq.result = db.has(k) ? structuredClone(db.get(k)) : undefined; rq.onsuccess?.(); }); return rq; },
        put(v, k) { const copia = structuredClone(v); escritas.push(k); setTimeout(() => db.set(k, copia)); return { onsuccess: null }; },
        delete(k) { borradas.push(k); setTimeout(() => db.delete(k)); return { onsuccess: null }; }
      });
      setTimeout(() => setTimeout(() => { if (modo === 'readwrite') lotes.push({ escritas, borradas }); tx.oncomplete?.(); }));
      return tx;
    }
  };
}
global.indexedDB = { open() { const rq = { onsuccess: null }; setTimeout(() => { rq.result = crearConexion(); rq.onsuccess?.(); }); return rq; } };
global.window = { addEventListener() {} };
global.document = { addEventListener() {}, visibilityState: 'visible' };
global.localStorage = { getItem: () => null, setItem() {}, removeItem() {} };
global.sessionStorage = global.localStorage;
global.navigator = {};
global.showToast = () => {};
global.__FORCE_DEMO_MODE__ = false;
require('../demo-mode.js');
vm.runInThisContext(fs.readFileSync(path.join(__dirname, '..', 'storage.js'), 'utf8'), { filename: 'storage.js' });
const interno = expr => vm.runInThisContext(expr);
vm.runInThisContext('storageReady = true');

const hoy = new Date(), mesActual = `${hoy.getFullYear()}-${String(hoy.getMonth() + 1).padStart(2, '0')}`;
const venta = (id, date, extra = {}) => ({ id, date, amount: 10000, method: 'Efectivo', items: [{ name: 'Cerveza', qty: 2, price: 5000 }], sync_status: 'synced', ...extra });
const ultimoLote = () => lotes[lotes.length - 1];
let pasadas = 0;
const ok = msg => { pasadas++; console.log(`  ✓ ${msg}`); };

(async () => {
  // 1. Guardar y volver a cargar
  global.state = {
    profile: { name: 'Bar' }, products: [{ id: 'p1' }], orders: [],
    payments: [venta('v1', '2025-11-03'), venta('v2', '2025-11-20'), venta('v3', '2026-01-05'), venta('v4', `${mesActual}-01`)],
    expenses: [{ id: 'g1', date: '2025-11-04', amount: 5000, sync_status: 'synced' }], purchases: []
  };
  await interno('persistNow')();
  assert.deepStrictEqual(db.get('state').payments, [], 'el núcleo no lleva el historial');
  assert.deepStrictEqual([...db.get('state').__historial].sort(), ['hist:expenses:2025-11', 'hist:payments:2025-11', `hist:payments:${mesActual}`, 'hist:payments:2026-01'].sort());
  const cargado = await interno('storageInit')();
  assert.deepStrictEqual(cargado.payments.map(p => p.id).sort(), ['v1', 'v2', 'v3', 'v4']);
  assert.strictEqual(cargado.expenses.length, 1); assert.strictEqual(cargado.profile.name, 'Bar'); assert(!('__historial' in cargado));
  global.state = cargado;
  ok('se guarda como núcleo + un registro por mes y al cargar se rearma completo');

  // 2. Guardado normal: núcleo + mes actual; los meses viejos no se tocan
  state.payments.push(venta('v5', `${mesActual}-02`, { sync_status: 'pending' }));
  await interno('persistNow')();
  assert.deepStrictEqual(ultimoLote().escritas, ['state', `hist:payments:${mesActual}`], JSON.stringify(ultimoLote()));
  await interno('persistNow')();
  assert.deepStrictEqual(ultimoLote().escritas, ['state'], 'sin cambios: solo el núcleo (el mes actual se compara y no se reescribe)');
  ok('un guardado normal escribe el núcleo y el mes actual; los meses viejos sin cambios no se escriben');

  // 3. Cambios en un mes viejo detectados por el resumen
  state.payments = state.payments.filter(p => p.id !== 'v1'); // factura anulada
  await interno('persistNow')();
  assert(ultimoLote().escritas.includes('hist:payments:2025-11'), 'baja en mes viejo');
  state.payments.find(p => p.id === 'v3').sync_status = 'pending'; // corrección pendiente de subir
  await interno('persistNow')();
  assert(ultimoLote().escritas.includes('hist:payments:2026-01'), 'cambio de sincronización en mes viejo');
  state.payments.find(p => p.id === 'v3').amount = 12000;
  await interno('persistNow')();
  assert(ultimoLote().escritas.includes('hist:payments:2026-01'), 'cambio de monto en mes viejo');
  ok('bajas, montos y estado de sincronización en meses viejos se detectan sin marcarlos');

  // 4. Edición en el lugar que no cambia el resumen
  state.payments.find(p => p.id === 'v2').customer = 'Mesa 9';
  await interno('persistNow')();
  assert(!ultimoLote().escritas.includes('hist:payments:2025-11'), 'la revisión rápida no la ve');
  await interno('flushAll')(); // al ocultar o cerrar la app: revisión completa
  assert(ultimoLote().escritas.includes('hist:payments:2025-11'), 'la revisión completa la guarda');
  state.payments.find(p => p.id === 'v2').customer = 'Mesa 10';
  interno('marcarHistorialModificado')('payments', state.payments.find(p => p.id === 'v2'));
  await interno('persistNow')();
  assert(ultimoLote().escritas.includes('hist:payments:2025-11'), 'marcada: se guarda en el siguiente guardado');
  vm.runInThisContext('histUltimaRevision = Date.now() - HIST_REVISION_MS - 1');
  state.payments.find(p => p.id === 'v2').customer = 'Mesa 11';
  await interno('persistNow')();
  assert(ultimoLote().escritas.includes('hist:payments:2025-11'), 'pasados 10 minutos, el guardado normal hace la revisión completa');
  const recargado = await interno('storageInit')();
  assert.strictEqual(recargado.payments.find(p => p.id === 'v2').customer, 'Mesa 11');
  assert.strictEqual(recargado.payments.find(p => p.id === 'v3').amount, 12000);
  global.state = recargado;
  ok('una edición en el lugar se guarda si se marca, al cerrar u ocultar la app, o en la revisión cada 10 minutos');

  // 5. Mes vacío y estado antiguo
  state.expenses = [];
  await interno('persistNow')();
  assert(ultimoLote().borradas.includes('hist:expenses:2025-11') && !db.has('hist:expenses:2025-11'));
  db.clear();
  db.set('state', { profile: { name: 'Antiguo' }, payments: [venta('a1', '2025-06-01'), venta('a2', `${mesActual}-03`)], expenses: [], purchases: [] });
  vm.runInThisContext('histGuardado = {}');
  global.state = await interno('storageInit')();
  assert.strictEqual(state.payments.length, 2);
  await interno('persistNow')();
  assert(db.has('hist:payments:2025-06') && db.get('state').payments.length === 0, 'se parte en el primer guardado');
  global.state = await interno('storageInit')();
  assert.deepStrictEqual(state.payments.map(p => p.id).sort(), ['a1', 'a2']);
  ok('un mes vacío se borra; un estado antiguo sin partir se carga igual y se parte al guardar');

  // 6. Rendimiento con un año de un bar con mucho movimiento
  const n = 55000, meses = 12, base = new Date(hoy.getFullYear(), hoy.getMonth() - (meses - 1), 1);
  state.payments = Array.from({ length: n }, (_, i) => { const d = new Date(base.getFullYear(), base.getMonth() + Math.floor(i * meses / n), 1 + (i % 28)); return venta(`y${i}`, `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`); });
  await interno('persistNow')(); // primera vez: escribe todos los meses
  state.payments.push(venta('nueva', `${mesActual}-04`));
  const copiado = () => ultimoLote().escritas.filter(k => k.startsWith('hist:')).reduce((s, k) => s + JSON.stringify(db.get(k)).length, JSON.stringify(db.get('state')).length);
  let t = performance.now(); await interno('persistNow')(); const ms = performance.now() - t;
  const parcial = copiado(), completo = JSON.stringify(state).length;
  assert(parcial * 5 < completo, `cada guardado copia mucho menos que el estado entero (${parcial} vs ${completo})`);
  t = performance.now(); structuredClone(state); const msAntes = performance.now() - t;
  ok(`55.000 ventas: cada guardado copia ${(parcial / 1048576).toFixed(1)} MB de ${(completo / 1048576).toFixed(1)} MB (antes: copia completa, ${msAntes.toFixed(0)} ms aquí; ahora ${ms.toFixed(0)} ms con la revisión de resúmenes)`);

  console.log(`\n${pasadas} PRUEBAS SUPERADAS`);
  process.exit(0);
})().catch(e => { console.error('✗', e); process.exit(1); });
