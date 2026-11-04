// scratch/test-tandas-pedido.js
// Pedido por tandas con el código REAL de app.js y modules.js (contexto vm, en el orden de index.html):
// 1. La tanda vive en memoria: nada se guarda hasta «Guardar pedido» o «Cobrar»; la limpieza de pedidos vacíos
//    (sincronización) no deja la mesa sin responder.
// 2. X / Escape: sin tanda cierra directo; con tanda pide confirmar y descarta sin guardar ni tocar el stock.
// 3. Cada tanda guardada es una ronda con hora; el stock se descuenta al guardar y no otra vez al cobrar;
//    la cuenta y el ticket impreso van unificados por producto.
// 5. Dividir cuenta por productos: la mesa sigue abierta con lo no pagado y no se borra de la nube hasta saldarla.
// 6. Total por cobrar en mesas y cuentas abiertas.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== PRUEBAS: PEDIDO POR TANDAS (código real) ===\n');

const ROOT = path.join(__dirname, '..');
const els = {};
function mockElement() {
  return {
    value: '', textContent: '', innerHTML: '', hidden: false, disabled: false, open: false, style: {}, dataset: {}, checked: false, className: '',
    classList: { add() {}, remove() {}, toggle() {}, contains: () => false },
    addEventListener() {}, removeEventListener() {}, setAttribute() {}, removeAttribute() {}, toggleAttribute() {},
    showModal() { this.open = true; }, close() { this.open = false; }, focus() {}, closest: () => null,
    querySelector: () => mockElement(), querySelectorAll: () => [], append() {}, appendChild() {}, matches: () => false
  };
}
const document = {
  querySelector: sel => (els[sel] = els[sel] || mockElement()), querySelectorAll: () => [], addEventListener() {},
  createElement: () => mockElement(), body: mockElement(), documentElement: mockElement(), visibilityState: 'visible'
};
const memoryStorage = () => { const d = {}; return { getItem: k => d[k] ?? null, setItem: (k, v) => { d[k] = String(v); }, removeItem: k => { delete d[k]; } }; };
const confirms = [];
let confirmAnswer = true;
const ctx = {
  console, document, navigator: { onLine: false },
  window: { location: { search: '' }, addEventListener() {}, confirm: msg => { confirms.push(String(msg)); return confirmAnswer; } },
  localStorage: memoryStorage(), sessionStorage: memoryStorage(), setTimeout: () => 0, clearTimeout() {}, setInterval: () => 0,
  structuredClone, Intl, crypto: globalThis.crypto, URLSearchParams, __IS_NODE_TEST__: true
};
ctx.globalThis = ctx; ctx.window.document = document; ctx.els = els;
vm.createContext(ctx);
for (const file of ['demo-mode.js', 'storage.js', 'modules.js', 'print.js', 'app.js']) {
  vm.runInContext(fs.readFileSync(path.join(ROOT, file), 'utf8'), ctx, { filename: file });
}
const run = code => vm.runInContext(code, ctx);
const get = code => JSON.parse(run(`JSON.stringify(${code})`));

run(`
  var toasts = [], deletedRemote = [];
  renderAll = () => {}; showToast = msg => { toasts.push(String(msg)); };
  NexoSync = { syncOrders: async () => {}, deleteActiveOrder: async id => { deletedRemote.push(id); }, syncSale: async () => {} };
  function reset() {
    state = normalizeState({ ...structuredClone(defaultState), orders: [], payments: [] });
    state.cashShift = { id: 'shift_t', status: 'open', openingCash: 0, openedAt: Date.now() };
    state.users = [{ id: 'u1', name: 'Ana', role: 'admin', active: true }]; session = 'u1';
    state.tables = [{ id: 't1', name: 'Mesa 1', zone: 'Salón' }, { id: 't2', name: 'Mesa 2', zone: 'Salón' }];
    state.products = [
      { id: 'agu', name: 'Cerveza Águila', category: 'Cervezas', price: 6000, cost: 3000, stock: 50, inventoryId: 'inv_agu' },
      { id: 'pok', name: 'Poker', category: 'Cervezas', price: 5000, cost: 2500, stock: 40, inventoryId: 'inv_pok' }
    ];
    state.inventory = [{ id: 'inv_agu', name: 'Cerveza Águila', qty: 50, min: 5, unit: 'und' }, { id: 'inv_pok', name: 'Poker', qty: 40, min: 5, unit: 'und' }];
    state.stockMovements = []; state.currentOrderId = null; orderDraft = null;
    toasts.length = 0; deletedRemote.length = 0;
  }
  const stockOf = id => state.inventory.find(i => i.id === id).qty;
  function addN(id, n) { for (let i = 0; i < n; i++) addProduct(id); }
  function pay() { openPayment(); confirmPayment(); }
`);
let s;

// ---------- 1. Tanda en memoria y mesa que no se queda sin responder ----------
run(`reset(); openOrder('t1'); addN('agu', 2);`);
assert.strictEqual(get('state.orders.length'), 0, 'Agregar productos no guarda la mesa');
assert.strictEqual(get('stockOf("inv_agu")'), 50, 'Agregar productos no toca el stock');
assert.ok(get('els["#ticketItems"].innerHTML').includes('Nueva tanda'), 'La cuenta muestra la nueva tanda');
assert.strictEqual(get('els["#orderTotal"].textContent').replace(/\D/g, ''), '12000', 'El total incluye la tanda');
// Antes: la mesa recién abierta era un pedido vacío en state.orders y la sincronización lo borraba → clics sin efecto
run(`cleanupOrphanOrders(); NexoSync.mergeRemoteOrders?.([]); addProduct('agu');`);
assert.strictEqual(get('orderDraft.items[0].qty'), 3, 'Tras la limpieza de pedidos vacíos los clics siguen sumando');
console.log('✅ 1. La tanda vive en memoria y sobrevive a la limpieza de pedidos vacíos');

// ---------- 2. X / Escape ----------
confirms.length = 0; confirmAnswer = false;
assert.strictEqual(run('requestCloseOrderDialog()'), false, 'Con tanda y «Cancelar» el modal no se cierra');
assert.ok(confirms[0].includes('descartar los productos sin guardar'), 'Pregunta si descartar');
assert.strictEqual(get('orderDraft.items[0].qty'), 3, 'La tanda se conserva al no confirmar');
confirmAnswer = true;
assert.strictEqual(run('requestCloseOrderDialog()'), true, 'Con tanda y «Aceptar» se cierra');
assert.strictEqual(get('state.orders.length'), 0, 'Descartar no guarda nada');
assert.strictEqual(get('stockOf("inv_agu")'), 50, 'Descartar no toca el stock');
confirms.length = 0;
run(`openOrder('t1');`);
assert.strictEqual(run('requestCloseOrderDialog()'), true, 'Sin tanda se cierra directo');
assert.strictEqual(confirms.length, 0, 'Sin tanda no pregunta nada');
console.log('✅ 2. La X y Escape descartan la tanda solo tras confirmar');

// ---------- 3. Rondas, stock al guardar y cuenta unificada ----------
run(`reset(); openOrder('t1'); addN('agu', 5); saveOrder();`);
s = get(`(() => { const o = state.orders[0]; return { items: o.items, rounds: o.rounds, applied: o.stockApplied, stock: stockOf('inv_agu'), sync: o.sync_status }; })()`);
assert.strictEqual(s.rounds.length, 1, 'Guardar crea la ronda 1');
assert.ok(s.rounds[0].at > 0 && s.rounds[0].by === 'Ana', 'La ronda lleva hora y quién la pidió');
assert.strictEqual(s.stock, 45, 'El stock se descuenta al guardar la tanda');
assert.deepStrictEqual(s.applied, { agu: 5 }, 'Se anota lo ya descontado');
assert.strictEqual(s.sync, 'pending', 'La mesa queda pendiente de subir');
run(`openOrder('t1'); addN('agu', 3); addProduct('pok'); saveOrder();`);
s = get(`(() => { const o = state.orders[0]; return { items: o.items.map(i => [i.productId, i.qty]), rounds: o.rounds.length, view: orderRoundsView(o).map(r => [r.number, r.items.map(i => i.qty)]), agu: stockOf('inv_agu'), pok: stockOf('inv_pok') }; })()`);
assert.deepStrictEqual(s.items, [['agu', 8], ['pok', 1]], 'La cuenta suma las rondas por producto');
assert.strictEqual(s.rounds, 2, 'La segunda tanda es la ronda 2');
assert.deepStrictEqual(s.view, [[1, [5]], [2, [3, 1]]], 'En pantalla se ve el detalle por ronda');
assert.deepStrictEqual([s.agu, s.pok], [42, 39], 'Cada tanda descuenta su stock');
run(`openOrder('t1'); pay();`);
s = get(`({ agu: stockOf('inv_agu'), pok: stockOf('inv_pok'), status: state.orders[0].status, invoice: state.payments[0].items.map(i => [i.productId, i.qty]), deleted: deletedRemote.length })`);
assert.deepStrictEqual([s.agu, s.pok], [42, 39], 'Al cobrar no se descuenta otra vez');
assert.strictEqual(s.status, 'paid', 'La mesa queda cobrada');
assert.deepStrictEqual(s.invoice, [['agu', 8], ['pok', 1]], 'La factura lleva una línea por producto');
assert.strictEqual(s.deleted, 1, 'La mesa saldada sale de la nube');
const html = run(`buildReceiptHtml({ invoiceNo: 'F1', amount: 53000, items: [{ productId: 'agu', name: 'Cerveza Águila', price: 6000, qty: 5 }, { productId: 'pok', name: 'Poker', price: 5000, qty: 1 }, { productId: 'agu', name: 'Cerveza Águila', price: 6000, qty: 3 }] })`);
assert.strictEqual((html.match(/Cerveza Águila/g) || []).length, 1, 'El ticket impreso une el mismo producto');
assert.ok(html.includes('8 x'), 'El ticket imprime 8 Águilas en una línea');
console.log('✅ 3. Rondas con hora, stock al guardar (sin doble descuento) y ticket unificado');

// ---------- «Cobrar» con tanda pendiente: la confirma y la cobra ----------
run(`reset(); openOrder('t2'); addN('pok', 2); pay();`);
s = get(`({ pok: stockOf('inv_pok'), status: state.orders[0].status, amount: state.payments[0].amount, rounds: state.orders[0].rounds.length })`);
assert.deepStrictEqual(s, { pok: 38, status: 'paid', amount: 10000, rounds: 1 }, '«Cobrar» guarda la tanda, descuenta una vez y cobra');
console.log('✅ «Cobrar» con tanda pendiente la guarda y la cobra');

// ---------- 5. Dividir cuenta por productos ----------
run(`reset(); openOrder('t1'); addN('agu', 5); saveOrder(); openOrder('t1');
  openSplitBill(); setSplitBillMode('items'); changeSplitItemQty('agu', 1); changeSplitItemQty('agu', 1); changeSplitItemQty('agu', 1);
  chargeSelectedSplitItems(); confirmPayment();`);
s = get(`(() => { const o = state.orders[0]; return { status: o.status, qty: o.items[0].qty, open: isOrderOpen(o), pending: orderPending(o), invoice: state.payments[0].items.map(i => i.qty), amount: state.payments[0].amount, deleted: deletedRemote.length, stock: stockOf('inv_agu'), view: orderRoundsView(o).map(r => r.items.map(i => i.qty)) }; })()`);
assert.strictEqual(s.status, 'open', 'Tras cobrar 3 de 5 la mesa sigue abierta');
assert.strictEqual(s.qty, 2, 'Quedan exactamente los 2 no pagados');
assert.strictEqual(s.pending, 12000, 'El saldo es lo no pagado');
assert.deepStrictEqual(s.invoice, [3], 'La factura lleva solo lo seleccionado');
assert.strictEqual(s.amount, 18000, 'Se cobra solo lo seleccionado');
assert.strictEqual(s.deleted, 0, 'Un cobro parcial no borra la mesa de la nube (el aviso de borrado la cerraba)');
assert.strictEqual(s.stock, 45, 'El cobro parcial no vuelve a descontar');
assert.deepStrictEqual(s.view, [[2]], 'La ronda muestra lo que falta por pagar');
run(`openSplitBill(); setSplitBillMode('items'); selectAllSplitItems(); chargeSelectedSplitItems(); confirmPayment();`);
s = get(`({ status: state.orders[0].status, deleted: deletedRemote.length, stock: stockOf('inv_agu'), invoices: state.payments.length })`);
assert.deepStrictEqual(s, { status: 'paid', deleted: 1, stock: 45, invoices: 2 }, 'Con el saldo en 0 la mesa se cierra y sale de la nube');
console.log('✅ 5. Dividir cuenta deja la mesa abierta con lo no pagado y solo la cierra en 0');

// ---------- Pedidos de versiones anteriores: el stock se descuenta al cobrar, como antes ----------
run(`reset(); state.orders = [{ id: 'ord_old', tableId: 't1', tableName: 'Mesa 1', status: 'open', createdAt: Date.now(), items: [{ productId: 'agu', name: 'Cerveza Águila', price: 6000, qty: 4, inventoryId: 'inv_agu' }] }];
  openOrder('t1');`);
assert.deepStrictEqual(get('orderRoundsView(state.orders[0]).map(r => [r.legacy, r.items[0].qty])'), [[true, 4]], 'Lo pedido sin rondas se muestra como pedido inicial');
run(`pay();`);
assert.strictEqual(get('stockOf("inv_agu")'), 46, 'Un pedido anterior descuenta su stock al cobrar');
console.log('✅ Pedidos anteriores sin rondas siguen descontando al cobrar');

// ---------- Anular y quitar productos guardados devuelven el stock ----------
run(`reset(); openOrder('t1'); addN('agu', 4); saveOrder(); openOrder('t1');`);
const roundId = get('state.orders[0].rounds[0].id');
run(`removeSavedItem('agu', ${JSON.stringify(roundId)});`);
s = get(`({ qty: state.orders[0].items[0].qty, round: state.orders[0].rounds[0].items[0].qty, stock: stockOf('inv_agu'), applied: state.orders[0].stockApplied.agu })`);
assert.deepStrictEqual(s, { qty: 3, round: 3, stock: 47, applied: 3 }, 'Quitar una unidad guardada devuelve su stock');
run(`deleteCurrentOrder();`);
assert.deepStrictEqual(get('({ orders: state.orders.length, stock: stockOf("inv_agu"), deleted: deletedRemote.length })'), { orders: 0, stock: 50, deleted: 1 }, 'Eliminar el pedido devuelve todo lo descontado');
run(`session = null; state.users[0].role = 'mesero'; session = 'u1'; openOrder('t1'); addN('agu', 2); saveOrder(); openOrder('t1'); removeSavedItem('agu', state.orders[0].rounds[0].id);`);
assert.strictEqual(get('state.orders[0].items[0].qty'), 2, 'Un mesero no quita productos ya guardados');
console.log('✅ Anular o quitar productos guardados devuelve el stock (solo con permiso de anular)');

// ---------- Unir mesas conserva rondas y stock descontado ----------
run(`reset(); openOrder('t1'); addN('agu', 2); saveOrder(); openOrder('t2'); addN('pok', 1); saveOrder();
  moveOrderToTable(state.orders[0].id, 't2', { confirmMerge: () => true });`);
s = get(`(() => { const o = activeOrderForTable('t2'); return { rounds: o.rounds.length, applied: o.stockApplied, orders: activeOrders().length }; })()`);
assert.deepStrictEqual(s, { rounds: 2, applied: { pok: 1, agu: 2 }, orders: 1 }, 'La cuenta unida lleva las rondas y el stock descontado de ambas');
run(`openOrder('t2'); pay();`);
assert.deepStrictEqual(get('[stockOf("inv_agu"), stockOf("inv_pok")]'), [48, 39], 'Cobrar la cuenta unida no descuenta otra vez');
console.log('✅ Unir mesas conserva rondas y stock descontado');

// ---------- 6. Total por cobrar ----------
run(`reset(); openOrder('t1'); addN('agu', 2); saveOrder(); openOrder('t2'); addN('pok', 3); saveOrder(); openOrder('t1'); addN('agu', 10);`);
assert.deepStrictEqual(get('openOrdersSummary()'), { count: 2, total: 27000 }, 'Suma lo pendiente de las cuentas abiertas (sin tandas sin guardar)');
run(`renderStats();`);
assert.ok(get('els["#openMoneyTotal"].textContent').replace(/\D/g, '') === '27000', 'La barra del salón muestra el total');
console.log('✅ 6. Total por cobrar en mesas y cuentas abiertas');

console.log('\n=== TODAS LAS PRUEBAS DE PEDIDO POR TANDAS PASARON ===');
