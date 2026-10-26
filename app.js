/* NexoBar: POS Inteligente para Bares. Toda la información se guarda en el navegador. */
const money = new Intl.NumberFormat('es-CO', { style: 'currency', currency: 'COP', maximumFractionDigits: 0 });
globalThis.money = money;
const defaultState = {
  zone: 'Todas', activeCategory: 'Todos', search: '', currentOrderId: null, paymentMethod: 'Efectivo',
  categories: ['Cervezas', 'Cocteles', 'Licores', 'Sin alcohol', 'Comidas', 'Otros'],
  profile: { name: 'Mi Bar', nit: '', address: '', phone: '', ownerPhone: '+57', syncId: 'nexobar_default', image: null },
  cashShift: { status: 'closed' },
  tables: [
    { id: 'b1', name: 'Barra 1', zone: 'Barra', type: 'bar' }, { id: 'b2', name: 'Barra 2', zone: 'Barra', type: 'bar' },
    { id: 'm1', name: 'Mesa 1', zone: 'Salón' }, { id: 'm2', name: 'Mesa 2', zone: 'Salón' }, { id: 'm3', name: 'Mesa 3', zone: 'Salón' }, { id: 'm4', name: 'Mesa 4', zone: 'Salón' },
    { id: 't1', name: 'Terraza 1', zone: 'Terraza' }, { id: 't2', name: 'Terraza 2', zone: 'Terraza' }, { id: 't3', name: 'Terraza 3', zone: 'Terraza' }, { id: 'l1', name: 'Lounge', zone: 'VIP' },
  ],
  products: [],
  inventory: [],
  orders: [], payments: [], purchases: [], expenses: [], closedShifts: [],
  users: [], suppliers: [], stockLog: [], auditLog: [], invoiceCounter: 0, backupLog: [], backupSettings: {}
};
let state = structuredClone(defaultState); // provisional: bootstrap() carga los datos guardados
globalThis.state = state;
globalThis.defaultState = defaultState;

const DEMO_PRODUCTS = [
  { id: 'demo_1', name: 'Cerveza Corona Extra 355ml', category: 'Cervezas', price: 9000, cost: 4800, stock: 18, icon: '🍺' },
  { id: 'demo_2', name: 'Cerveza Club Colombia Dorada', category: 'Cervezas', price: 7000, cost: 3500, stock: 24, icon: '🍺' },
  { id: 'demo_3', name: 'Papas Francesas Rústicas', category: 'Comidas', price: 15000, cost: 6000, stock: 15, icon: '🍟' },
  { id: 'demo_4', name: 'Cerveza Stella Artois', category: 'Cervezas', price: 10000, cost: 5200, stock: 15, icon: '🍺' },
  { id: 'demo_5', name: 'Mojito Clásico', category: 'Cocteles', price: 20000, cost: 7000, stock: 12, icon: '🍸' },
  { id: 'demo_6', name: 'Gin Tonic Gordons', category: 'Cocteles', price: 24000, cost: 8500, stock: 10, icon: '🍸' },
  { id: 'demo_7', name: 'Margarita Tradicional', category: 'Cocteles', price: 22000, cost: 8000, stock: 14, icon: '🍸' },
  { id: 'demo_8', name: 'Aguardiente Antioqueño Azul 750ml', category: 'Licores', price: 75000, cost: 42000, stock: 6, icon: '🍾' },
  { id: 'demo_9', name: 'Ron Medellín Añejo 8 Años', category: 'Licores', price: 95000, cost: 55000, stock: 5, icon: '🍾' },
  { id: 'demo_10', name: 'Whisky Old Parr 12 Años', category: 'Licores', price: 180000, cost: 110000, stock: 4, icon: '🥃' },
  { id: 'demo_11', name: 'Agua Manantial con Gas 600ml', category: 'Sin alcohol', price: 3500, cost: 1500, stock: 20, icon: '🥤' },
  { id: 'demo_12', name: 'Gaseosa Coca-Cola 400ml', category: 'Sin alcohol', price: 4000, cost: 2000, stock: 24, icon: '🥤' },
  { id: 'demo_13', name: 'Red Bull Energy Drink', category: 'Sin alcohol', price: 12000, cost: 7000, stock: 16, icon: '⚡' },
  { id: 'demo_14', name: 'Nachos con Queso y Guacamole', category: 'Comidas', price: 18000, cost: 7500, stock: 12, icon: '🧀' }
];
globalThis.DEMO_PRODUCTS = DEMO_PRODUCTS;

const DEMO_TABLES = [
  { id: 'm1', name: 'Mesa 1', zone: 'Salón', type: 'table' },
  { id: 'm2', name: 'Mesa 2', zone: 'Salón', type: 'table' },
  { id: 'm3', name: 'Mesa 3', zone: 'Salón', type: 'table' },
  { id: 'm4', name: 'Mesa 4', zone: 'Salón', type: 'table' }
];
globalThis.DEMO_TABLES = DEMO_TABLES;

function getInitialDemoState() {
  const products = structuredClone(DEMO_PRODUCTS);
  const inventory = products.map(p => ({
    id: 'stock-' + p.id,
    name: p.name,
    unit: 'und',
    qty: Number(p.stock || 20),
    min: 5
  }));
  products.forEach(p => { p.inventoryId = 'stock-' + p.id; });
  const demoUser = {
    id: 'u_demo_guest',
    name: 'Invitado Demo',
    role: 'admin',
    active: true,
    mustChangePin: false,
    salt: 'demo_salt',
    pinHash: (typeof hashPin === 'function' ? hashPin('1234', 'demo_salt') : 'demo_hash'),
    createdAt: Date.now()
  };
  return {
    zone: 'Todas',
    activeCategory: 'Todos',
    search: '',
    currentOrderId: null,
    paymentMethod: 'Efectivo',
    categories: ['Todos', 'Cervezas', 'Cocteles', 'Licores', 'Sin alcohol', 'Comidas'],
    profile: {
      name: 'NexoBar (Demo Sandbox)',
      nit: '900.000.000-DEMO',
      address: 'Zona de Demostración',
      phone: '300 000 0000',
      ownerPhone: '+57',
      syncId: 'nexobar_demo',
      image: null
    },
    cashShift: { id: 'shift_demo_init', status: 'closed', openingCash: 0 },
    tables: structuredClone(DEMO_TABLES),
    inventory,
    products,
    orders: [],
    payments: [],
    purchases: [],
    expenses: [],
    closedShifts: [],
    users: [demoUser],
    suppliers: [{ id: 'sup_demo_1', name: 'Distribuidora de Licores Demo', nit: '800.123.456-1', phone: '310 000 0000', notes: 'Proveedor simulado' }],
    stockLog: [],
    auditLog: [],
    invoiceCounter: 0,
    backupLog: [],
    backupSettings: {}
  };
}
globalThis.getInitialDemoState = getInitialDemoState;

function initDemoDataIfNeeded() {
  if (!isDemoMode()) return;
  if (!Array.isArray(state.products) || state.products.length !== 14 || !Array.isArray(state.tables) || state.tables.length !== 4) {
    console.log('[NexoBar] 🧪 Inicializando catálogo de prueba en Modo Demo (Sandbox)...');
    resetDemoData({ silent: true });
  }
}
globalThis.initDemoDataIfNeeded = initDemoDataIfNeeded;

function resetDemoData({ silent = false } = {}) {
  if (!isDemoMode()) return;
  const initial = getInitialDemoState();
  state = normalizeState(initial);
  globalThis.state = state;
  saveState();
  if (typeof renderAll === 'function') renderAll();
  if (!silent) showToast('Datos de prueba reiniciados.');
}
globalThis.resetDemoData = resetDemoData;

/* ---------- Reglas de Control Comercial (Modo Demo) ---------- */
const DEMO_TX_LIMIT = 10;
const DEMO_INACTIVITY_LIMIT_MS = 2 * 60 * 60 * 1000; // 2 horas de inactividad

function getDemoTransactionCount() {
  try {
    return Number(sessionStorage.getItem('nexobar_demo_tx_count') || 0);
  } catch (e) {
    return 0;
  }
}

function incrementDemoTransactionCount() {
  if (!isDemoMode()) return;
  try {
    const next = getDemoTransactionCount() + 1;
    sessionStorage.setItem('nexobar_demo_tx_count', String(next));
    console.log(`[NexoBar] 🧪 Transacción demo registrada: ${next}/${DEMO_TX_LIMIT}`);
    return next;
  } catch (e) {
    return 0;
  }
}

function isDemoLimitReached() {
  if (!isDemoMode()) return false;
  return getDemoTransactionCount() >= DEMO_TX_LIMIT;
}

function getNetxpremiumWhatsappUrl() {
  const phone = (window.NETXPREMIUM_WHATSAPP || '').replace(/\D/g, '');
  const text = encodeURIComponent('Hola Netxpremium, he probado la demo de NexoBar POS y deseo adquirir el sistema completo sin límites.');
  return phone ? `https://wa.me/${phone}?text=${text}` : `https://wa.me/?text=${text}`;
}

function showDemoLimitModal() {
  const dlg = document.querySelector('#demoLimitDialog');
  if (dlg) {
    const waBtn = dlg.querySelector('#demoWhatsappBtn');
    if (waBtn) {
      waBtn.href = getNetxpremiumWhatsappUrl();
    }
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
  }
}

function getDemoLastActivity() {
  try {
    return Number(localStorage.getItem('nexobar_demo_last_activity') || Date.now());
  } catch (e) {
    return Date.now();
  }
}

function updateDemoActivity() {
  if (!isDemoMode()) return;
  try {
    localStorage.setItem('nexobar_demo_last_activity', String(Date.now()));
  } catch (e) {}
}

function checkDemoInactivity() {
  if (!isDemoMode()) return;
  const last = getDemoLastActivity();
  const now = Date.now();
  if (now - last >= DEMO_INACTIVITY_LIMIT_MS) {
    console.log('[NexoBar] ⏱️ Inactividad superior a 2 horas en Modo Demo. Restaurando datos iniciales...');
    resetDemoData({ silent: false });
    try {
      sessionStorage.removeItem('nexobar_demo_tx_count');
    } catch (e) {}
    updateDemoActivity();
    showToast('Datos restaurados automáticamente tras 2 horas de inactividad.');
  }
}

function initDemoInactivityWatcher() {
  if (!isDemoMode()) return;
  updateDemoActivity();
  const events = ['click', 'keydown', 'scroll', 'touchstart', 'mousemove'];
  let throttleTimer = null;
  events.forEach(evt => {
    window.addEventListener(evt, () => {
      if (!throttleTimer) {
        throttleTimer = setTimeout(() => {
          updateDemoActivity();
          throttleTimer = null;
        }, 10000);
      }
    }, { passive: true });
  });

  setInterval(checkDemoInactivity, 60000);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') {
      checkDemoInactivity();
    }
  });
}

globalThis.getDemoTransactionCount = getDemoTransactionCount;
globalThis.incrementDemoTransactionCount = incrementDemoTransactionCount;
globalThis.isDemoLimitReached = isDemoLimitReached;
globalThis.showDemoLimitModal = showDemoLimitModal;
globalThis.checkDemoInactivity = checkDemoInactivity;
globalThis.initDemoInactivityWatcher = initDemoInactivityWatcher;

let reportRange='today', reportDate='';
let purchaseDraft = [];
let editingProductId = null;
let pendingProductImage = null;
let pendingBusinessImage = null;

function normalizeState(saved) {
  if (isDemoMode() && (!saved || !saved.tables || saved.tables.length !== 4 || !saved.products || saved.products.length !== 14)) {
    saved = getInitialDemoState();
  }
  const normalized = {
    ...structuredClone(defaultState),
    ...saved,
    categories: [...new Set([...(saved?.categories || defaultState.categories), ...((saved?.products || []).map(product => product.category).filter(Boolean))])],
    profile: { ...defaultState.profile, ...(saved?.profile || {}), syncId: isDemoMode() ? 'nexobar_demo' : (saved?.profile?.syncId || 'nexobar_default') },
    cashShift: saved?.cashShift || { status: 'closed' },
    inventory: Array.isArray(saved?.inventory) ? structuredClone(saved.inventory) : [],
    products: Array.isArray(saved?.products) ? structuredClone(saved.products) : [],
    purchases: saved?.purchases || [],
    expenses: saved?.expenses || [],
    closedShifts: saved?.closedShifts || []
  };

  if (isDemoMode()) {
    normalized.tables = (Array.isArray(saved?.tables) && saved.tables.length === 4) ? structuredClone(saved.tables) : structuredClone(DEMO_TABLES);
    normalized.profile.name = 'NexoBar (Demo Sandbox)';
    normalized.users = [
      {
        id: 'u_demo_guest',
        name: 'Invitado Demo',
        role: 'admin',
        active: true,
        mustChangePin: false,
        salt: 'demo_salt',
        pinHash: (typeof hashPin === 'function' ? hashPin('1234', 'demo_salt') : 'demo_hash'),
        createdAt: Date.now()
      }
    ];
  }

  // Si saved traía los productos demo antiguos ("p1".."p12") sin transacciones reales, limpiarlos a cero
  const isLegacyDemo = normalized.products.length > 0 &&
    normalized.products.every(p => p.id && String(p.id).startsWith('p') && String(p.id).length < 5) &&
    (!normalized.payments || normalized.payments.length === 0) &&
    (!normalized.purchases || normalized.purchases.length === 0);

  if (isLegacyDemo) {
    normalized.products = [];
    normalized.inventory = [];
  }

  if (!normalized.products || normalized.products.length === 0) {
    normalized.products = [];
    normalized.inventory = [];
  } else {
    normalized.products.forEach(product => {
      product.cost = Number(product.cost || 0);
      if (!product.inventoryId) {
        const inventoryId = `stock-${product.id}`;
        const stockCandidates = Object.entries(product.recipe || {}).map(([id, amount]) => {
          const supply = normalized.inventory.find(item => item.id === id);
          return supply && amount ? supply.qty / amount : 0;
        });
        const initialStock = stockCandidates.length ? Math.max(0, Math.floor(Math.min(...stockCandidates))) : 0;
        if (!normalized.inventory.some(item => item.id === inventoryId)) {
          normalized.inventory.push({ id: inventoryId, name: product.name, unit: 'und', qty: initialStock, min: 5 });
        }
        product.inventoryId = inventoryId;
      } else if (!normalized.inventory.some(item => item.id === product.inventoryId)) {
        normalized.inventory.push({ id: product.inventoryId, name: product.name, unit: 'und', qty: 0, min: 5 });
      }
    });

    const validInventoryIds = new Set(normalized.products.map(p => p.inventoryId).filter(Boolean));
    normalized.inventory = normalized.inventory.filter(item => validInventoryIds.has(item.id));
    normalized.inventory.forEach(item => {
      if (item.min == null || Number.isNaN(Number(item.min))) item.min = 5;
    });
    normalized.products.forEach(product => {
      const supply = normalized.inventory.find(item => item.id === product.inventoryId);
      if (product.stock == null && supply) {
        product.stock = supply.qty;
      }
    });
  }

  const validTableIds = new Set((saved?.tables || defaultState.tables || []).map(t => t.id));
  normalized.orders = (saved?.orders || []).filter(order => {
    if (!order) return false;
    const st = String(order.status || '').toLowerCase();
    const isPaid = st === 'paid' || st === 'closed' || st === 'cerrada' || st === 'cancelada';
    if (isPaid) return false;
    const hasItems = Array.isArray(order.items) && order.items.length > 0 && order.items.some(i => (Number(i.qty) || 0) > 0);
    if (!hasItems) return false;
    const isKnownTable = validTableIds.has(order.tableId);
    const isKnownCustom = Boolean(order.isCustom) || order.tableId === 'walkin';
    return isKnownTable || isKnownCustom;
  }).map(order => ({
    ...order,
    status: 'open',
    items: (order.items || []).map(item => {
      const product = normalized.products.find(p => p.id === item.productId);
      return { ...item, inventoryId: item.inventoryId || product?.inventoryId, cost: Number(item.cost ?? product?.cost ?? 0) };
    })
  }));
  ensureExtras(normalized);
  return normalized;
}
globalThis.normalizeState = normalizeState;
function saveState() {
  scheduleSave();
  if (globalThis.NexoSync?.scheduleSync) {
    globalThis.NexoSync.scheduleSync();
  }
}
globalThis.saveState = saveState;
function localISO(d) { return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }
function today() { return localISO(new Date()); }
function displayDate() { return new Intl.DateTimeFormat('es-CO', { weekday: 'long', day: 'numeric', month: 'long' }).format(new Date()).replace(/^./, c => c.toUpperCase()); }
function getOrder(id) { return (state.orders || []).find(o => o.id === id); }
function isOrderOpen(order) {
  if (!order) return false;
  const st = String(order.status || '').toLowerCase();
  const isOpen = st === 'open' || st === 'abierto' || st === 'pendiente';
  if (!isOpen || st === 'paid' || st === 'closed' || st === 'cerrada' || st === 'cancelada') return false;
  if (!Array.isArray(order.items) || order.items.length === 0) return false;
  return order.items.some(i => (Number(i.qty) || 0) > 0);
}
function activeOrders() { return (state.orders || []).filter(isOrderOpen); }
function activeOrderForTable(tableId) { return (state.orders || []).find(o => o.tableId === tableId && isOrderOpen(o)); }
function orderTotal(order) {
  if (!order || !Array.isArray(order.items)) return 0;
  return order.items.reduce((sum, item) => sum + (Number(item.price) || 0) * (Number(item.qty) || 0), 0);
}
function paymentsToday() { return state.payments.filter(p => p.date === today()); }
function cleanupOrphanOrders() {
  if (!state || !Array.isArray(state.orders)) return;
  const validTableIds = new Set((state.tables || []).map(t => t.id));
  const prevCount = state.orders.length;
  state.orders = state.orders.filter(order => {
    if (!order) return false;
    const st = String(order.status || '').toLowerCase();
    const isPaid = (st === 'paid' || st === 'closed' || st === 'cerrada' || st === 'cancelada');
    if (isPaid) return false;
    const hasItems = Array.isArray(order.items) && order.items.length > 0 && order.items.some(i => (Number(i.qty) || 0) > 0);
    if (!hasItems) return false;
    const isKnownTable = validTableIds.has(order.tableId);
    const isKnownCustom = Boolean(order.isCustom) || order.tableId === 'walkin';
    return isKnownTable || isKnownCustom;
  });
  if (state.orders.length !== prevCount) {
    saveState();
  }
}
globalThis.cleanupOrphanOrders = cleanupOrphanOrders;
globalThis.localISO = localISO;
globalThis.today = today;
globalThis.displayDate = displayDate;
globalThis.getOrder = getOrder;
globalThis.isOrderOpen = isOrderOpen;
globalThis.activeOrders = activeOrders;
globalThis.activeOrderForTable = activeOrderForTable;
globalThis.orderTotal = orderTotal;
globalThis.paymentsToday = paymentsToday;
function formatQty(value) { return Number.isInteger(value) ? value : value.toFixed(1).replace('.', ','); }
function formatDate(date) { const d = new Date(`${date}T12:00:00`); return Number.isNaN(d.getTime()) ? '—' : new Intl.DateTimeFormat('es-CO', { day:'2-digit', month:'short' }).format(d); }
function uid(prefix) { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
function showToast(message) { const el = document.querySelector('#toast'); el.textContent = message; el.classList.add('visible'); setTimeout(() => el.classList.remove('visible'), 2500); }
function isShiftOpen() { return state.cashShift?.status === 'open'; }
function currentShiftPayments() { return state.payments.filter(payment=>payment.shiftId===state.cashShift?.id); }
function cashSalesToday() {
  return currentShiftPayments().reduce((sum, payment) => {
    if (Array.isArray(payment.payments) && payment.payments.length > 0) {
      return sum + payment.payments.filter(p => p.method === 'Efectivo').reduce((s, p) => s + p.amount, 0);
    }
    return sum + (payment.method === 'Efectivo' ? payment.amount : 0);
  }, 0);
}
function otherSalesToday() {
  return currentShiftPayments().reduce((sum, payment) => {
    if (Array.isArray(payment.payments) && payment.payments.length > 0) {
      return sum + payment.payments.filter(p => p.method !== 'Efectivo').reduce((s, p) => s + p.amount, 0);
    }
    return sum + (payment.method !== 'Efectivo' ? payment.amount : 0);
  }, 0);
}
function cashExpensesToday() { return state.expenses.filter(expense=>expense.shiftId===state.cashShift?.id&&expense.method==='Efectivo').reduce((sum,expense)=>sum+expense.amount,0); }
function cashPurchasesToday() { return state.purchases.filter(purchase=>purchase.shiftId===state.cashShift?.id&&purchase.method==='Efectivo').reduce((sum,purchase)=>sum+purchase.total,0); }
function expectedCash() { if (!isShiftOpen()) return 0; return Number(state.cashShift?.openingCash || 0)+cashSalesToday()-cashExpensesToday()-cashPurchasesToday(); }
globalThis.formatQty = formatQty;
globalThis.formatDate = formatDate;
globalThis.isShiftOpen = isShiftOpen;
globalThis.currentShiftPayments = currentShiftPayments;
globalThis.cashSalesToday = cashSalesToday;
globalThis.otherSalesToday = otherSalesToday;
globalThis.cashExpensesToday = cashExpensesToday;
globalThis.cashPurchasesToday = cashPurchasesToday;
globalThis.expectedCash = expectedCash;
function renderBrand() { const mark=document.querySelector('#brandMark'), label=document.querySelector('#brandLabel');if(label)label.innerHTML=`NexoBar <strong>POS</strong>`;if(mark)mark.innerHTML=`<img src="logo.png" alt="NexoBar" />`; }
function renderShiftStatus() { const button=document.querySelector('#shiftStatusButton');if(isShiftOpen()){button.textContent=`Caja abierta · Base ${money.format(state.cashShift.openingCash || 0)}`;button.classList.remove('closed');}else{button.textContent='Caja cerrada · Abrir turno';button.classList.add('closed');} if(typeof globalThis.syncMobileShiftBtn==='function') globalThis.syncMobileShiftBtn(); }
function renderCategoryOptions() { document.querySelector('#categoryOptions').innerHTML=state.categories.map(category=>`<option value="${escapeHtml(category)}"></option>`).join(''); }
function renderProfile() { const profile=state.profile || defaultState.profile;document.querySelector('#businessName').value=profile.name || '';if(document.querySelector('#businessNit'))document.querySelector('#businessNit').value=profile.nit || '';document.querySelector('#businessAddress').value=profile.address || '';document.querySelector('#businessPhone').value=profile.phone || '';if(document.querySelector('#businessOwnerPhone'))document.querySelector('#businessOwnerPhone').value=profile.ownerPhone || '+57';if(document.querySelector('#businessSyncId'))document.querySelector('#businessSyncId').value=profile.syncId || 'nexobar_default';setImagePreview(document.querySelector('#profileImagePreview'),profile.image,profile.name || 'N'); }
function openCustomOrders() {
  const tableIds = new Set((state.tables || []).map(t => t.id));
  return activeOrders().filter(order => order.isCustom || order.tableId === 'walkin' || !tableIds.has(order.tableId));
}
function renderCustomOrders() {
  const orders = openCustomOrders();
  const listEl = document.querySelector('#customOrdersList');
  if (!listEl) return;
  if (!orders.length) {
    listEl.innerHTML = '<p class="muted">No hay cuentas personalizadas ni pedidos en barra abiertos.</p>';
    return;
  }
  listEl.innerHTML = orders.map(order => {
    const totalItems = order.items.reduce((sum, item) => sum + (Number(item.qty) || 0), 0);
    const totalMoney = orderTotal(order);
    const tag = order.isCustom ? 'Personalizada' : (order.tableId === 'walkin' ? 'Barra' : 'Comanda');
    return `<div class="custom-order-card" data-order-card="${order.id}"><div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px;"><div><div style="display:flex;align-items:center;gap:6px;flex-wrap:wrap;"><strong>${escapeHtml(order.tableName || 'Cuenta')}</strong><span class="history-tag" style="font-size:9px;padding:2px 5px;">${tag}</span></div><span style="color:var(--muted);font-size:12px;margin-top:4px;display:block;">${totalItems} ${totalItems === 1 ? 'producto' : 'productos'} · ${elapsedLabel(order.createdAt)}</span></div><b style="color:var(--accent);font-size:15px;white-space:nowrap;">${money.format(totalMoney)}</b></div><div style="display:flex;gap:6px;margin-top:12px;"><button class="outline-button" style="flex:1;padding:6px 8px;font-size:12px;" data-open-custom-order="${order.id}">Ver / Editar</button><button class="primary-button" style="flex:1;padding:6px 8px;font-size:12px;" data-pay-custom-order="${order.id}">Cobrar</button><button class="remove-line" style="padding:4px 8px;" data-delete-custom-order="${order.id}" title="Anular cuenta">×</button></div></div>`;
  }).join('');
}
function paymentTimestamp(payment) { return payment.paidAt || payment.createdAt || new Date(`${payment.date || today()}T12:00:00`).getTime(); }
function invoiceReference(payment,index=0) { return payment.invoiceNo || `FAC-${String(index + 1).padStart(5,'0')}`; }
function paymentTendersMarkup(payment) {
  if (Array.isArray(payment.payments) && payment.payments.length > 0) {
    return `<div class="invoice-tenders-list">${payment.payments.map(p => `<span class="tender-badge"><strong>${escapeHtml(p.method)}:</strong> ${money.format(p.amount)}${p.received && p.received > p.amount ? ` (Recibido ${money.format(p.received)} · Cambio ${money.format(p.change || 0)})` : ''}</span>`).join('')}</div>`;
  }
  return '';
}
function invoiceItemsMarkup(payment) {
  const itemsHtml = `<div class="invoice-items">${(payment.items || []).map(item=>`<div class="invoice-item"><span>${item.qty} × ${escapeHtml(item.name)}</span><b>${money.format(item.qty*item.price)}</b></div>`).join('')}</div>`;
  const breakdown = paymentTendersMarkup(payment);
  return breakdown ? itemsHtml + breakdown : itemsHtml;
}
function setImagePreview(element,image,fallback) { element.innerHTML=image?`<img src="${image}" alt="Vista previa" />`:escapeHtml(String(fallback || 'N').charAt(0).toUpperCase()); }

function renderAll() {
  document.querySelector('#todayLabel').textContent = displayDate().replace(/^./, c => c.toUpperCase());
  renderBrand();
  renderShiftStatus();
  renderNavigation();
  renderStats();
  renderZones();
  renderTables();
  renderCustomOrders();
  if (typeof renderRecentInvoices === 'function') renderRecentInvoices(); else if (typeof globalThis.renderRecentInvoices === 'function') globalThis.renderRecentInvoices();
  renderCategoryOptions();
  renderProducts();
  renderInventory();
  renderPurchases();
  if (typeof renderReports === 'function') renderReports(); else if (typeof globalThis.renderReports === 'function') globalThis.renderReports();
  renderHistory();
  renderProfile();
  if (typeof applyPermissions === 'function') applyPermissions(); else if (typeof globalThis.applyPermissions === 'function') globalThis.applyPermissions();
  if (typeof renderUserChip === 'function') renderUserChip(); else if (typeof globalThis.renderUserChip === 'function') globalThis.renderUserChip();
  if (typeof renderInvoices === 'function') renderInvoices(); else if (typeof globalThis.renderInvoices === 'function') globalThis.renderInvoices();
  if (typeof renderSuppliers === 'function') renderSuppliers(); else if (typeof globalThis.renderSuppliers === 'function') globalThis.renderSuppliers();
  if (typeof renderStockLog === 'function') renderStockLog(); else if (typeof globalThis.renderStockLog === 'function') globalThis.renderStockLog();
  if (typeof renderTeam === 'function') renderTeam(); else if (typeof globalThis.renderTeam === 'function') globalThis.renderTeam();
  if (typeof renderBackupCard === 'function') renderBackupCard(); else if (typeof globalThis.renderBackupCard === 'function') globalThis.renderBackupCard();
}
function renderNavigation() { const low = state.inventory.filter(i => i.qty <= i.min).length; document.querySelector('#inventoryBadge').textContent = low; }
function renderStats() {
  const payments = paymentsToday();
  const sold = payments.reduce((s,p) => s+p.amount, 0);
  const active = activeOrders();
  const tableIds = new Set((state.tables || []).map(t => t.id));
  const activeTableOrders = active.filter(order => !order.isCustom && order.tableId !== 'walkin' && tableIds.has(order.tableId));

  document.querySelector('#salesToday').textContent = money.format(sold);
  document.querySelector('#salesCount').textContent = `${payments.length} ${payments.length === 1 ? 'cuenta cerrada' : 'cuentas cerradas'}`;
  document.querySelector('#activeTables').textContent = activeTableOrders.length;
  document.querySelector('#activeItems').textContent = `${active.reduce((s,o)=>s+o.items.reduce((n,i)=>n+(Number(i.qty)||0),0),0)} bebidas y snacks`;
  document.querySelector('#openOrdersCount').textContent = active.length;
  document.querySelector('#cashExpected').textContent = isShiftOpen() ? money.format(expectedCash()) : 'Caja cerrada';
}
function renderZones() { const zones = ['Todas', ...new Set(state.tables.map(t => t.zone))]; document.querySelector('#zoneFilter').innerHTML = zones.map(z => `<button class="segment ${state.zone === z ? 'active':''}" data-zone="${z}">${z}</button>`).join(''); }
function elapsedLabel(ts) { const mins = Math.max(0, Math.floor((Date.now() - (ts || Date.now())) / 60000)); if (mins < 1) return 'Recién abierta'; if (mins < 60) return `Abierta hace ${mins} min`; const h = Math.floor(mins / 60), m = mins % 60; return `Abierta hace ${h} h${m ? ` ${m} min` : ''}`; }
function renderTables() { const tables = state.tables.filter(t => state.zone === 'Todas' || t.zone === state.zone); document.querySelector('#tableGrid').innerHTML = tables.map(table => { const order = activeOrderForTable(table.id); const long = order && Date.now() - (order.createdAt || Date.now()) >= 120 * 60000; return `<button class="table-card ${order ? 'occupied':''} ${table.type || ''}" data-table="${table.id}"><span class="table-top"><span class="table-name">${escapeHtml(table.name)}</span><span class="table-zone">${escapeHtml(table.zone)}</span></span>${order ? `<span class="table-bottom"><span class="table-amount">${money.format(orderTotal(order))}</span><span class="table-time ${long ? 'long' : ''}">${elapsedLabel(order.createdAt)}</span></span>` : '<span class="table-status empty">Disponible</span>'}</button>`; }).join(''); }
globalThis.renderShiftStatus = renderShiftStatus;
globalThis.renderStats = renderStats;
globalThis.renderTables = renderTables;
globalThis.renderCustomOrders = renderCustomOrders;
globalThis.renderAll = renderAll;
function renderInventory() {
  const lows = state.inventory.filter(i => i.qty <= i.min && i.qty > 0);
  const outOfStock = state.inventory.filter(i => i.qty <= 0);
  document.querySelector('#inventorySummary').innerHTML = `<div class="summary-item"><span>Productos en stock</span><strong>${state.inventory.length}</strong></div><div class="summary-item ${lows.length?'warning':''}"><span>Bajo stock</span><strong>${lows.length}</strong></div><div class="summary-item ${outOfStock.length?'danger':''}"><span>Agotados</span><strong>${outOfStock.length}</strong></div><div class="summary-item"><span>Última actualización</span><strong>Ahora</strong></div>`;
  if (!state.inventory || state.inventory.length === 0) {
    document.querySelector('#inventoryTable').innerHTML = '<tr><td colspan="5" class="muted" style="text-align:center;padding:32px 16px;font-size:14px;">No hay productos ni existencias registradas.</td></tr>';
    return;
  }
  document.querySelector('#inventoryTable').innerHTML = state.inventory.map(item => {
    let badge = '';
    if (item.qty <= 0) {
      badge = '<span class="status status-out">Agotado</span>';
    } else if (item.qty <= item.min) {
      badge = '<span class="status status-low">Bajo stock</span>';
    } else {
      badge = '<span class="status status-good">Disponible</span>';
    }
    return `<tr><td><strong>${escapeHtml(item.name)}</strong><br><small class="muted">${escapeHtml(item.unit)}</small></td><td><b>${formatQty(item.qty)}</b> ${escapeHtml(item.unit)}</td><td>${formatQty(item.min)} ${escapeHtml(item.unit)}</td><td>${badge}</td><td><button class="mini-action" data-adjust="${item.id}">Ajustar</button></td></tr>`;
  }).join('');
}
function renderPurchases() { const purchases = state.purchases.filter(p => p.date === today()); const expenses = state.expenses.filter(e => e.date === today()); document.querySelector('#purchasesTotal').textContent = money.format(purchases.reduce((sum,p)=>sum+p.total,0)); document.querySelector('#purchaseInvoiceCount').textContent = purchases.length; document.querySelector('#expensesTotal').textContent = money.format(expenses.reduce((sum,e)=>sum+e.amount,0)); document.querySelector('#purchasesList').innerHTML = state.purchases.slice(-6).reverse().map(p => `<div class="activity-item"><div><strong>${escapeHtml(p.supplier)}</strong><span>Factura ${escapeHtml(p.invoice)} · ${p.lines.length} ${p.lines.length === 1 ? 'producto' : 'productos'}</span></div><div><b>${money.format(p.total)}</b><small>${formatDate(p.date)}</small></div></div>`).join('') || '<p class="muted">Aún no has ingresado facturas de compra.</p>'; document.querySelector('#expensesList').innerHTML = state.expenses.slice(-6).reverse().map(e => `<div class="activity-item"><div><strong>${escapeHtml(e.category)}</strong><span>${escapeHtml(e.description)} · ${escapeHtml(e.method)}</span></div><div><b>${money.format(e.amount)}</b><small>${formatDate(e.date)}</small></div></div>`).join('') || '<p class="muted">Aún no hay pagos de servicios u otros gastos.</p>'; }
function renderHistory() { const movements=[...state.payments.map((payment,index)=>({time:paymentTimestamp(payment),type:'Factura',title:`${invoiceReference(payment,index)} · ${payment.customer || 'Venta mostrador'}`,detail:`${payment.method} · ${money.format(payment.amount)}`,amount:payment.amount,items:invoiceItemsMarkup(payment)})),...state.purchases.map(purchase=>({time:purchase.createdAt || new Date(`${purchase.date}T12:00:00`).getTime(),type:'Compra',title:`Factura de compra ${purchase.invoice}`,detail:`${purchase.supplier} · ${purchase.method || 'Sin medio de pago'} · ${purchase.lines.length} productos`,amount:purchase.total,items:`<div class="invoice-items">${purchase.lines.map(line=>`<div class="invoice-item"><span>${line.qty} × ${escapeHtml(line.productName || line.supplyName || 'Producto')}</span><b>${money.format(line.total)}</b></div>`).join('')}</div>`})),...state.expenses.map(expense=>({time:expense.createdAt || new Date(`${expense.date}T12:00:00`).getTime(),type:'Gasto',title:expense.category,detail:`${expense.description} · ${expense.method}`,amount:expense.amount})),...state.closedShifts.map(shift=>({time:shift.closedAt,type:'Cierre',title:'Cierre de turno',detail:`Ventas ${money.format(shift.totalSales || 0)} · Efectivo esperado ${money.format(shift.expected || 0)}`,amount:shift.counted}))].sort((a,b)=>b.time-a.time);const totalMovements=movements.length;movements.splice(20);document.querySelector('#historyList').innerHTML=movements.length?movements.map(movement=>`<article class="history-card"><span class="history-tag">${movement.type}</span><div class="history-head"><div><strong>${escapeHtml(movement.title)}</strong><span>${new Date(movement.time).toLocaleString('es-CO')} · ${escapeHtml(movement.detail)}</span></div><b>${money.format(movement.amount || 0)}</b></div>${movement.items || ''}</article>`).join('')+(totalMovements>20?`<p class="muted history-more">Mostrando los últimos 20 de ${totalMovements} movimientos.</p>`:''):'<p class="muted">El historial se llenará con facturas, compras, gastos y cierres.</p>'; }

// Obtiene la lista unificada y limpia de productos para el POS (state.products + state.inventory)
function getPOSProducts() {
  if (typeof state === 'undefined' || !state) return [];
  if (!Array.isArray(state.products)) state.products = [];
  if (!Array.isArray(state.inventory)) state.inventory = [];

  const invMap = new Map();
  state.inventory.forEach(inv => {
    if (inv && inv.id) invMap.set(String(inv.id), inv);
  });

  const knownInvIds = new Set();
  const knownProductIds = new Set();

  state.products.forEach(p => {
    if (!p) return;
    const pId = String(p.id);
    knownProductIds.add(pId);
    const invId = p.inventoryId || `stock-${p.id}`;
    knownInvIds.add(String(invId));
    knownInvIds.add(pId);

    const inv = invMap.get(String(invId)) || invMap.get(pId) || null;
    const invStock = inv ? Number(inv.qty) : (p.stock != null ? Number(p.stock) : 0);
    p.stock = Number.isFinite(invStock) ? invStock : 0;
    if (!p.category || !String(p.category).trim()) {
      p.category = inv?.category || 'General';
    }
  });

  // Si existen insumos en inventario sin producto correspondiente, incorporarlos como productos vendibles
  state.inventory.forEach(inv => {
    if (!inv || !inv.name) return;
    const invIdStr = String(inv.id);
    const cleanId = invIdStr.startsWith('stock-') ? invIdStr.replace(/^stock-/, '') : invIdStr;
    if (!knownInvIds.has(invIdStr) && !knownProductIds.has(cleanId) && !knownProductIds.has(invIdStr)) {
      const newProd = {
        id: cleanId.startsWith('prod_') || cleanId.startsWith('p') ? cleanId : `prod_${cleanId}`,
        name: inv.name,
        category: inv.category || 'General',
        price: Number(inv.price ?? inv.cost ?? 0),
        cost: Number(inv.cost ?? 0),
        stock: Number(inv.qty ?? 0),
        inventoryId: inv.id,
        recipe: { [inv.id]: 1 },
        icon: '🍾',
        image: null,
        active: true,
        sync_status: 'pending'
      };
      state.products.push(newProd);
      knownProductIds.add(String(newProd.id));
      knownInvIds.add(invIdStr);
    }
  });

  // Filtrar productos válidos (NO exigir 'activo: true' ni 'disponible_pos: true')
  return state.products.filter(p => {
    if (!p || !p.id) return false;
    // Solo excluir si explícitamente se configuró como inactivo
    if (p.active === false || p.activo === false || p.disponible_pos === false || p.disponible === false) {
      return false;
    }
    return true;
  });
}
globalThis.getPOSProducts = getPOSProducts;

function checkShiftIsOpen() {
  if (typeof requireOpenShift === 'function') return requireOpenShift();
  if (typeof globalThis.requireOpenShift === 'function') return globalThis.requireOpenShift();
  return typeof isShiftOpen === 'function' ? isShiftOpen() : true;
}

function openOrder(tableId = null) {
  if (!checkShiftIsOpen()) return;
  let table;
  if (tableId) table = state.tables.find(t => t.id === tableId);
  else table = { id: 'walkin', name: 'Venta en barra', zone: 'Barra' };
  if (!table) table = { id: tableId || 'walkin', name: 'Mesa', zone: 'Salón' };

  let order = activeOrderForTable(table.id);
  if (!order) {
    if (isDemoMode() && isDemoLimitReached()) {
      showDemoLimitModal();
      return;
    }
    order = {
      id: uid('ord'),
      tableId: table.id,
      tableName: table.name,
      items: [],
      note: '',
      status: 'open',
      createdAt: Date.now(),
      shiftId: state.cashShift?.id || null,
      sync_status: 'pending',
      ...actor()
    };
    state.orders.push(order);
    if (isDemoMode()) {
      incrementDemoTransactionCount();
    }
    saveState();
  }
  state.currentOrderId = order.id;

  // Garantizar pestaña 'Todos' y buscador limpio por defecto al abrir
  state.activeCategory = 'Todos';
  state.search = '';
  const searchInput = document.querySelector('#productSearch');
  if (searchInput) searchInput.value = '';

  const zoneEl = document.querySelector('#orderZone');
  if (zoneEl) zoneEl.textContent = (table.zone || 'BARRA').toUpperCase();
  const titleEl = document.querySelector('#orderTitle');
  if (titleEl) titleEl.textContent = table.name || 'Pedido';
  const noteEl = document.querySelector('#orderNote');
  if (noteEl) noteEl.value = order.note || '';

  const orderDlg = document.querySelector('#orderDialog');
  if (orderDlg) {
    if (typeof orderDlg.showModal === 'function') orderDlg.showModal();
    else orderDlg.setAttribute('open', '');
  }
  if (typeof globalThis.switchOrderTab === 'function') globalThis.switchOrderTab('products');
  renderOrderDialog();
}
globalThis.openOrder = openOrder;

function openCustomOrder(orderId) {
  if (!checkShiftIsOpen()) return;
  const order = getOrder(orderId);
  if (!order) return;
  state.currentOrderId = order.id;

  // Garantizar pestaña 'Todos' y buscador limpio por defecto al abrir
  state.activeCategory = 'Todos';
  state.search = '';
  const searchInput = document.querySelector('#productSearch');
  if (searchInput) searchInput.value = '';

  const zoneEl = document.querySelector('#orderZone');
  if (zoneEl) zoneEl.textContent = 'CUENTA ABIERTA';
  const titleEl = document.querySelector('#orderTitle');
  if (titleEl) titleEl.textContent = order.tableName || 'Cuenta personalizada';
  const noteEl = document.querySelector('#orderNote');
  if (noteEl) noteEl.value = order.note || '';

  const orderDlg = document.querySelector('#orderDialog');
  if (orderDlg) {
    if (typeof orderDlg.showModal === 'function') orderDlg.showModal();
    else orderDlg.setAttribute('open', '');
  }
  if (typeof globalThis.switchOrderTab === 'function') globalThis.switchOrderTab('products');
  renderOrderDialog();
}
globalThis.openCustomOrder = openCustomOrder;

function openCustomOrderDialog() { if(!requireOpenShift())return;document.querySelector('#customOrderName').value='';document.querySelector('#customOrderDialog').showModal(); }
function createCustomOrder() {
  if (isDemoMode() && isDemoLimitReached()) {
    document.querySelector('#customOrderDialog')?.close();
    showDemoLimitModal();
    return;
  }
  const name = document.querySelector('#customOrderName').value.trim();
  if (!name) return showToast('Escribe un nombre para la cuenta.');
  const order = {
    id: uid('ord'),
    tableId: uid('custom'),
    tableName: name,
    isCustom: true,
    items: [],
    note: '',
    status: 'open',
    createdAt: Date.now(),
    shiftId: state.cashShift?.id || null,
    sync_status: 'pending',
    ...actor()
  };
  state.orders.push(order);
  if (isDemoMode()) {
    incrementDemoTransactionCount();
  }
  saveState();
  if (globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(() => {});
  document.querySelector('#customOrderDialog').close();
  renderAll();
  openCustomOrder(order.id);
}
function openTablesDialog() { renderTableManagement();document.querySelector('#newTableName').value='';document.querySelector('#newTableZone').value='Salón';document.querySelector('#tablesDialog').showModal(); }
function renderTableManagement() { const zones=['Barra','Salón','Terraza','VIP'];document.querySelector('#tableManagementList').innerHTML=state.tables.map(table=>`<div class="table-management-row"><input data-table-name="${table.id}" type="text" value="${escapeHtml(table.name)}" /><select data-table-zone="${table.id}">${zones.map(zone=>`<option ${table.zone===zone?'selected':''}>${zone}</option>`).join('')}</select><button class="outline-button" data-save-table="${table.id}">Guardar</button><button class="remove-line" data-delete-table="${table.id}" aria-label="Eliminar mesa">×</button></div>`).join(''); }
function saveTable(tableId) { const table=state.tables.find(item=>item.id===tableId),name=document.querySelector(`[data-table-name="${tableId}"]`)?.value.trim(),zone=document.querySelector(`[data-table-zone="${tableId}"]`)?.value;if(!table||!name)return showToast('La mesa necesita un nombre.');if(state.tables.some(item=>item.id!==tableId&&item.name.toLowerCase()===name.toLowerCase()))return showToast('Ya existe una mesa con ese nombre.');table.name=name;table.zone=zone;state.orders.forEach(order=>{if(order.tableId===tableId)order.tableName=name;});saveState();renderTableManagement();renderAll();showToast('Mesa actualizada.'); }
function addTable() { const name=document.querySelector('#newTableName').value.trim(),zone=document.querySelector('#newTableZone').value;if(!name)return showToast('Escribe el nombre de la mesa.');if(state.tables.some(table=>table.name.toLowerCase()===name.toLowerCase()))return showToast('Ya existe una mesa con ese nombre.');state.tables.push({id:uid('table'),name,zone});saveState();renderTableManagement();renderAll();showToast('Mesa creada.'); }
function deleteTable(tableId) { const table=state.tables.find(item=>item.id===tableId);if(!table)return;if(activeOrderForTable(tableId))return showToast('Cobra o elimina el pedido activo antes de eliminar esta mesa.');if(!window.confirm(`¿Eliminar ${table.name}?`))return;state.tables=state.tables.filter(item=>item.id!==tableId);saveState();renderTableManagement();renderAll();showToast('Mesa eliminada.'); }
function productVisual(product) {
  if (!product) return '🍾';
  return product.image ? `<img src="${product.image}" alt="${escapeHtml(product.name || 'Producto')}" />` : escapeHtml(product.icon || '🍾');
}
globalThis.productVisual = productVisual;

function renderOrderDialog() {
  const order = getOrder(state.currentOrderId);
  if (!order) return;

  const catTabsEl = document.querySelector('#categoryTabs');
  const prodGridEl = document.querySelector('#productGrid');
  const searchInput = document.querySelector('#productSearch');

  if (!catTabsEl || !prodGridEl) return;

  // 1. Obtener lista completa de productos desde estado global / IndexedDB
  const allProducts = getPOSProducts();

  // 2. Extraer categorías únicas para los tabs
  const rawCats = allProducts.map(p => String(p.category || 'General').trim()).filter(Boolean);
  const uniqueCats = [...new Set(rawCats)];
  if (uniqueCats.length === 0 && Array.isArray(state.categories)) {
    state.categories.forEach(c => {
      const clean = String(c || '').trim();
      if (clean && !uniqueCats.includes(clean)) uniqueCats.push(clean);
    });
  }
  const categories = ['Todos', ...uniqueCats];

  // Si la categoría activa actual no es válida o quedó desactualizada, volver a 'Todos'
  if (!state.activeCategory || !categories.includes(state.activeCategory)) {
    state.activeCategory = 'Todos';
  }

  // Renderizar pestañas de categorías
  catTabsEl.innerHTML = categories.map(cat => `
    <button type="button" class="category-button ${state.activeCategory === cat ? 'active' : ''}" data-category="${escapeHtml(cat)}">
      ${escapeHtml(cat)}
    </button>
  `).join('');

  // 3. Filtrar productos según categoría activa y buscador
  const search = String(state.search || '').trim().toLowerCase();
  if (searchInput && document.activeElement !== searchInput && searchInput.value !== (state.search || '')) {
    searchInput.value = state.search || '';
  }

  const products = allProducts.filter(p => {
    if (!p) return false;
    const pCat = String(p.category || 'General').trim();
    if (state.activeCategory !== 'Todos' && pCat.toLowerCase() !== state.activeCategory.toLowerCase()) {
      return false;
    }
    if (search) {
      const pName = String(p.name || '').toLowerCase();
      const pCode = String(p.code || '').toLowerCase();
      const pCatLower = pCat.toLowerCase();
      if (!pName.includes(search) && !pCode.includes(search) && !pCatLower.includes(search)) {
        return false;
      }
    }
    return true;
  });

  // 4. Renderizar tarjetas de productos con nombre, precio, categoría y stock
  if (products.length > 0) {
    prodGridEl.innerHTML = products.map(p => {
      const stockVal = Number(p.stock ?? 0);
      const isOutOfStock = stockVal <= 0;
      const stockBadge = stockVal > 0
        ? `<span class="product-stock-tag stock-available">${formatQty(stockVal)} disp.</span>`
        : `<span class="product-stock-tag stock-out">Agotado</span>`;

      return `
        <button type="button" class="product ${isOutOfStock ? 'is-out-of-stock' : ''}" data-product="${escapeHtml(p.id)}" title="${escapeHtml(p.name || 'Producto')}">
          <div class="product-header-row">
            <span class="product-icon">${productVisual(p)}</span>
            <span class="product-category-chip">${escapeHtml(p.category || 'General')}</span>
          </div>
          <strong class="product-title">${escapeHtml(p.name || 'Producto')}</strong>
          <div class="product-footer-row">
            <span class="product-price">${money.format(p.price || 0)}</span>
            ${stockBadge}
          </div>
        </button>
      `;
    }).join('');
  } else {
    const isGlobalEmpty = allProducts.length === 0;
    prodGridEl.innerHTML = isGlobalEmpty
      ? `
        <div class="pos-empty-catalog" style="grid-column: 1 / -1; text-align: center; padding: 48px 16px; color: var(--muted);">
          <div style="font-size: 32px; margin-bottom: 12px;">📦</div>
          <p style="font-size: 15px; font-weight: 700; color: var(--text); margin-bottom: 6px;">No hay productos registrados</p>
          <p style="font-size: 13px; margin: 0 auto 16px; max-width: 340px;">Crea productos nuevos en la sección de Productos o importa tu catálogo desde Excel / CSV.</p>
        </div>
      `
      : `
        <div class="pos-empty-catalog" style="grid-column: 1 / -1; text-align: center; padding: 40px 16px; color: var(--muted);">
          <div style="font-size: 28px; margin-bottom: 8px;">🔍</div>
          <p style="font-size: 14px; font-weight: 600; color: var(--text); margin-bottom: 4px;">No encontramos ese producto</p>
          <small style="color: var(--muted);">${search ? `Ningún producto coincide con "${escapeHtml(search)}"` : 'No hay productos en esta categoría'}</small>
        </div>
      `;
  }

  // 5. Renderizar ticket items
  const ticketEl = document.querySelector('#ticketItems');
  if (ticketEl) {
    ticketEl.innerHTML = order.items.length
      ? order.items.map(item => `
          <div class="ticket-item">
            <div>
              <strong>${escapeHtml(item.name)}</strong>
              ${item.category ? `<small class="muted" style="display:block;font-size:11px;">${escapeHtml(item.category)}</small>` : ''}
            </div>
            <span class="item-price">${money.format((item.price || 0) * (item.qty || 1))}</span>
            <div class="quantity-control">
              <button type="button" data-item-change="${escapeHtml(item.productId)}" data-delta="-1" aria-label="Disminuir">−</button>
              <span>${item.qty}</span>
              <button type="button" data-item-change="${escapeHtml(item.productId)}" data-delta="1" aria-label="Aumentar">+</button>
            </div>
          </div>
        `).join('')
      : '<p class="empty-ticket">Agrega productos para iniciar el pedido.</p>';
  }

  const orderTotalEl = document.querySelector('#orderTotal');
  if (orderTotalEl) orderTotalEl.textContent = money.format(orderTotal(order));

  const deleteBtn = document.querySelector('#deleteOrderButton');
  if (deleteBtn) deleteBtn.style.visibility = order.items.length ? 'visible' : 'hidden';

  const paidNote = document.querySelector('#paidNote');
  if (paidNote) {
    paidNote.hidden = !order.paidAmount;
    paidNote.textContent = order.paidAmount ? `Ya pagado en cuentas separadas: ${money.format(order.paidAmount)}` : '';
  }

  const isDemo = isDemoMode();
  const twTop = document.querySelector('#ticketWatermarkTop');
  const twBottom = document.querySelector('#ticketWatermarkBottom');
  if (twTop) twTop.hidden = !isDemo;
  if (twBottom) twBottom.hidden = !isDemo;
}
globalThis.renderOrderDialog = renderOrderDialog;
globalThis.renderPOSProducts = renderOrderDialog;
globalThis.loadProductsToOrder = renderOrderDialog;

function addProduct(productId) {
  const order = getOrder(state.currentOrderId);
  const prods = getPOSProducts();
  const product = prods.find(p => p.id === productId);
  if (!order || !product) return;
  const found = order.items.find(i => i.productId === productId);
  if (found) found.qty++;
  else {
    order.items.push({
      productId: product.id,
      name: product.name,
      price: product.price,
      cost: Number(product.cost || 0),
      category: product.category,
      qty: 1,
      inventoryId: product.inventoryId || `stock-${product.id}`,
      recipe: product.recipe || { [product.inventoryId || `stock-${product.id}`]: 1 }
    });
  }
  order.sync_status = 'pending';
  order.updatedAt = Date.now();
  saveState();
  if (globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(() => {});
  renderOrderDialog();
}
globalThis.addProduct = addProduct;
function changeItem(productId, delta) { const order=getOrder(state.currentOrderId); const item=order?.items.find(i=>i.productId===productId); if(!item)return; item.qty+=Number(delta); if(item.qty<=0)order.items=order.items.filter(i=>i!==item); order.sync_status='pending'; order.updatedAt=Date.now(); saveState(); if(globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(()=>{}); renderOrderDialog(); }
function saveOrder() { const order=getOrder(state.currentOrderId); if(!order)return; order.note=document.querySelector('#orderNote').value.trim(); order.sync_status='pending'; order.updatedAt=Date.now(); if(!order.items.length){state.orders=state.orders.filter(o=>o.id!==order.id);saveState();if(globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(()=>{});document.querySelector('#orderDialog').close();state.currentOrderId=null;renderAll();return showToast('Pedido vacío descartado.');} saveState();if(globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(()=>{});document.querySelector('#orderDialog').close();state.currentOrderId=null;renderAll();showToast('Pedido guardado. Queda abierto hasta cobrarlo.'); }
const PAYMENT_METHODS = ['Efectivo', 'Nequi', 'Daviplata', 'Tarjeta / Datáfono', 'Transferencia'];
let activePaymentMethod = 'Efectivo';
let currentCheckout = null;
let currentTenders = [];
let splitBillData = {
  mode: 'equal',
  people: 2,
  paidPartIndices: [],
  itemQuantities: {}
};

function openPayment(customCheckout = null) {
  if (!requireOpenShift()) return;
  const order = getOrder(state.currentOrderId);
  if (!order && !customCheckout) return;
  if (!customCheckout && !order?.items.length) return showToast('Agrega al menos un producto antes de cobrar.');

  if (customCheckout) {
    currentCheckout = customCheckout;
  } else {
    currentCheckout = {
      orderId: order.id,
      type: 'full',
      items: structuredClone(order.items),
      total: orderTotal(order),
      customerName: order.tableName,
      tableId: order.tableId
    };
  }

  currentTenders = [];
  activePaymentMethod = state.paymentMethod || 'Efectivo';
  if (!PAYMENT_METHODS.includes(activePaymentMethod)) activePaymentMethod = 'Efectivo';

  const dialog = document.querySelector('#paymentDialog');
  if (dialog) dialog.showModal();

  const isDemo = isDemoMode();
  const pwTop = document.querySelector('#payWatermarkTop');
  const pwBottom = document.querySelector('#payWatermarkBottom');
  if (pwTop) pwTop.hidden = !isDemo;
  if (pwBottom) pwBottom.hidden = !isDemo;

  refreshPaymentUI();
}
globalThis.openPayment = openPayment;

function renderPaymentOptions() {
  const container = document.querySelector('#paymentOptions');
  if (!container) return;
  container.innerHTML = PAYMENT_METHODS.map(m => `
    <button type="button" class="payment-method-chip ${activePaymentMethod === m ? 'active' : ''}" data-pay-method="${escapeHtml(m)}">
      ${escapeHtml(m)}
    </button>
  `).join('');
}

function refreshPaymentUI() {
  if (!currentCheckout) return;
  const covered = currentTenders.reduce((s, t) => s + t.amount, 0);
  const pending = Math.max(0, currentCheckout.total - covered);

  const titleEl = document.querySelector('#paymentTitle');
  if (titleEl) titleEl.textContent = `${escapeHtml(currentCheckout.customerName)} · ${money.format(currentCheckout.total)}`;

  const totalEl = document.querySelector('#payTotalAmount');
  if (totalEl) totalEl.textContent = money.format(currentCheckout.total);

  const coveredEl = document.querySelector('#payCoveredAmount');
  if (coveredEl) coveredEl.textContent = money.format(covered);

  const pendingEl = document.querySelector('#payPendingAmount');
  if (pendingEl) pendingEl.textContent = money.format(pending);

  renderPaymentOptions();

  const amountInput = document.querySelector('#amountReceived');
  if (amountInput && document.activeElement !== amountInput) {
    amountInput.value = pending > 0 ? pending : '';
  }

  const cashBox = document.querySelector('#tenderCashBox');
  if (cashBox) {
    cashBox.style.display = activePaymentMethod === 'Efectivo' ? 'block' : 'none';
  }

  const cashRecInput = document.querySelector('#tenderCashReceived');
  if (cashRecInput && activePaymentMethod !== 'Efectivo') {
    cashRecInput.value = '';
  }

  updateTenderChange();
  renderPaymentTendersList();

  const confirmBtn = document.querySelector('#confirmPaymentButton');
  if (confirmBtn) {
    const isDone = covered >= currentCheckout.total;
    const canFinalizeDirectly = currentTenders.length === 0 && pending > 0;
    confirmBtn.disabled = !isDone && !canFinalizeDirectly;
    confirmBtn.textContent = isDone ? 'Finalizar Cobro' : `Cobrar ${money.format(pending)} con ${activePaymentMethod}`;
  }
}

function updateTenderChange() {
  if (!currentCheckout) return;
  const tenderAmount = Number(document.querySelector('#amountReceived')?.value || 0);
  const cashReceived = Number(document.querySelector('#tenderCashReceived')?.value || 0);
  const changeMsg = document.querySelector('#changeMessage');
  if (!changeMsg) return;

  if (activePaymentMethod !== 'Efectivo') {
    changeMsg.textContent = tenderAmount > 0 ? `Pago electrónico por ${money.format(tenderAmount)}.` : '';
    changeMsg.className = 'change-message';
    return;
  }

  if (!tenderAmount) {
    changeMsg.textContent = 'Indica el monto a abonar en efectivo.';
    changeMsg.className = 'change-message muted';
    return;
  }

  if (cashReceived <= 0) {
    changeMsg.textContent = `Abono de ${money.format(tenderAmount)} en efectivo.`;
    changeMsg.className = 'change-message';
    return;
  }

  const diff = cashReceived - tenderAmount;
  if (diff >= 0) {
    changeMsg.textContent = `Cambio / vueltas: ${money.format(diff)}`;
    changeMsg.className = 'change-message positive';
  } else {
    changeMsg.textContent = `Faltan ${money.format(Math.abs(diff))} para cubrir el monto.`;
    changeMsg.className = 'change-message negative';
  }
}

function addPaymentTender() {
  if (!currentCheckout) return;
  const covered = currentTenders.reduce((s, t) => s + t.amount, 0);
  const pending = Math.max(0, currentCheckout.total - covered);
  if (pending <= 0) return showToast('El total de la cuenta ya está cubierto.');

  let amount = Number(document.querySelector('#amountReceived')?.value || 0);
  if (amount <= 0) return showToast('Ingresa un monto válido a pagar.');
  if (amount > pending) amount = pending;

  let received = amount;
  let change = 0;
  if (activePaymentMethod === 'Efectivo') {
    const rawCash = Number(document.querySelector('#tenderCashReceived')?.value || 0);
    if (rawCash > 0) {
      if (rawCash < amount) return showToast('El efectivo recibido es menor que el monto a abonar.');
      received = rawCash;
      change = rawCash - amount;
    }
  }

  currentTenders.push({
    method: activePaymentMethod,
    amount,
    received,
    change
  });

  const cashRecInput = document.querySelector('#tenderCashReceived');
  if (cashRecInput) cashRecInput.value = '';

  refreshPaymentUI();
}
globalThis.openPayment = openPayment;

function removePaymentTender(index) {
  if (index >= 0 && index < currentTenders.length) {
    currentTenders.splice(index, 1);
    refreshPaymentUI();
  }
}

function renderPaymentTendersList() {
  const container = document.querySelector('#paymentTendersList');
  if (!container) return;
  if (!currentTenders.length) {
    container.innerHTML = '<p class="muted empty-tenders-msg">Aún no has agregado pagos. Puedes combinar varios métodos o finalizar directamente.</p>';
    return;
  }
  container.innerHTML = currentTenders.map((t, idx) => `
    <div class="tender-row-item">
      <div class="tender-info">
        <span class="tender-method-tag">${escapeHtml(t.method)}</span>
        <strong class="tender-amount-text">${money.format(t.amount)}</strong>
        ${t.method === 'Efectivo' && t.received > t.amount ? `<small class="muted">(Recibido: ${money.format(t.received)} · Cambio: ${money.format(t.change)})</small>` : ''}
      </div>
      <button type="button" class="remove-tender-btn" data-remove-tender="${idx}" aria-label="Quitar pago">✕</button>
    </div>
  `).join('');
}

function deductInventory(order) {
  const nowIso = new Date().toISOString();
  order.items.forEach(item => {
    const qtySold = Number(item.qty || 0);
    if (!qtySold) return;

    const prodId = item.productId || item.id;
    const product = state.products.find(p => p.id === prodId || (item.inventoryId && p.inventoryId === item.inventoryId));
    const invId = item.inventoryId || product?.inventoryId || (prodId ? `stock-${prodId}` : null);
    const supply = invId ? state.inventory.find(i => i.id === invId) : null;

    // 1. Resta ÚNICA de stock en el producto y su inventario local
    if (product) {
      const prevStock = Number(product.stock != null ? product.stock : (supply?.qty ?? 0));
      const nextStock = Math.max(0, Number((prevStock - qtySold).toFixed(2)));
      product.stock = nextStock;
      product.updated_at = nowIso;
      product.sync_status = 'pending';
    }

    if (supply) {
      supply.qty = product ? product.stock : Math.max(0, Number((supply.qty - qtySold).toFixed(2)));
    }

    // 2. Si es un cóctel/receta con insumos secundarios distintos al producto, descontar solo los insumos adicionales
    if (item.recipe && Object.keys(item.recipe).length > 0) {
      Object.entries(item.recipe).forEach(([id, amount]) => {
        // Regla estricta: si el insumo es el mismo inventario del producto, OMITIR (nunca restar doble)
        if (id === invId || id === supply?.id || id === product?.inventoryId || id === prodId) return;
        const sup = state.inventory.find(i => i.id === id);
        if (sup) {
          sup.qty = Math.max(0, Number((sup.qty - amount * qtySold).toFixed(2)));
        }
      });
    }
  });
}

function confirmPayment() {
  if (!requireOpenShift()) return;
  const order = getOrder(currentCheckout?.orderId || state.currentOrderId);
  if (!order || !currentCheckout) return;

  let covered = currentTenders.reduce((s, t) => s + t.amount, 0);
  const pending = Math.max(0, currentCheckout.total - covered);

  if (pending > 0 && currentTenders.length === 0) {
    let received = pending;
    let change = 0;
    if (activePaymentMethod === 'Efectivo') {
      const rawCash = Number(document.querySelector('#tenderCashReceived')?.value || 0);
      if (rawCash > 0) {
        if (rawCash < pending) return showToast('El efectivo recibido es menor que el total.');
        received = rawCash;
        change = rawCash - pending;
      }
    }
    currentTenders.push({
      method: activePaymentMethod,
      amount: pending,
      received,
      change
    });
    covered = pending;
  } else if (covered < currentCheckout.total) {
    return showToast(`Faltan ${money.format(currentCheckout.total - covered)} por cubrir.`);
  }

  deductInventory({ items: currentCheckout.items });

  if (currentCheckout.type === 'full') {
    order.items = [];
    order.status = 'paid';
    order.paidAt = Date.now();
    order.paidAmount = Number(order.paidAmount || 0) + currentCheckout.total;
  } else if (currentCheckout.type === 'selection') {
    currentCheckout.items.forEach(selItem => {
      const oi = order.items.find(i => i.productId === selItem.productId);
      if (oi) oi.qty -= selItem.qty;
    });
    order.items = order.items.filter(i => i.qty > 0);
    order.paidAmount = Number(order.paidAmount || 0) + currentCheckout.total;
    if (order.items.length === 0) {
      order.status = 'paid';
      order.paidAt = Date.now();
    }
  } else if (currentCheckout.type === 'equal_fraction') {
    if (currentCheckout.isLastFraction || order.items.length === 0) {
      order.items = [];
      order.status = 'paid';
      order.paidAt = Date.now();
      order.paidAmount = Number(order.paidAmount || 0) + currentCheckout.total;
    } else {
      currentCheckout.items.forEach(fracItem => {
        const oi = order.items.find(i => i.productId === fracItem.productId);
        if (oi) oi.qty = Math.max(0, Number((oi.qty - fracItem.qty).toFixed(2)));
      });
      order.items = order.items.filter(i => i.qty > 0);
      order.paidAmount = Number(order.paidAmount || 0) + currentCheckout.total;
    }
    if (splitBillData.paidPartIndices && currentCheckout.fractionIndex) {
      splitBillData.paidPartIndices.push(currentCheckout.fractionIndex);
    }
  }

  const primaryMethod = currentTenders.length === 1 ? currentTenders[0].method : currentTenders.map(t => t.method).join(' + ');
  const paidAt = Date.now();

  const newPayment = {
    id: uid('pay'),
    invoiceNo: nextInvoiceNo(),
    date: today(),
    paidAt,
    createdAt: paidAt,
    orderId: order.id,
    customer: currentCheckout.customerName,
    amount: currentCheckout.total,
    method: primaryMethod,
    payments: currentTenders.map(t => ({
      method: t.method,
      amount: t.amount,
      received: t.received || t.amount,
      change: t.change || 0
    })),
    items: currentCheckout.items,
    shiftId: state.cashShift.id,
    cashierId: actor().userId,
    cashierName: actor().userName,
    waiterId: order.userId || null,
    waiterName: order.userName || '',
    sync_status: 'pending'
  };

  state.payments.push(newPayment);
  saveState();
  if (globalThis.NexoSync?.deleteActiveOrder) {
    globalThis.NexoSync.deleteActiveOrder(order.id).catch(() => {});
  }
  if (globalThis.NexoSync?.syncOrders) {
    globalThis.NexoSync.syncOrders().catch(() => {});
  }

  if (globalThis.NexoSync && typeof globalThis.NexoSync.syncSale === 'function') {
    globalThis.NexoSync.syncSale(newPayment).catch(err => console.warn('[NexoSync] Error post-venta syncSale:', err));
  } else if (globalThis.NexoSync && typeof globalThis.NexoSync.syncAll === 'function') {
    globalThis.NexoSync.syncAll().catch(err => console.warn('[NexoSync] Error post-venta:', err));
  }

  const payDlg = document.querySelector('#paymentDialog');
  if (payDlg) payDlg.close();

  const isComplete = order.status === 'paid';
  if (isComplete) {
    const splitDlg = document.querySelector('#splitBillDialog');
    if (splitDlg && splitDlg.open) splitDlg.close();
    const orderDlg = document.querySelector('#orderDialog');
    if (orderDlg && orderDlg.open) orderDlg.close();
    state.currentOrderId = null;
    showToast('Cuenta liquidada en su totalidad · Mesa disponible.');
  } else {
    const splitDlg = document.querySelector('#splitBillDialog');
    if (splitDlg && splitDlg.open) {
      renderSplitBill();
    }
    renderOrderDialog();
    showToast(`Fracción cobrada · ${money.format(currentCheckout.total)}. Quedan ${money.format(orderTotal(order))} en la mesa.`);
  }

  currentCheckout = null;
  currentTenders = [];
  renderAll();
}

function openSplitBill() {
  if (!requireOpenShift()) return;
  const order = getOrder(state.currentOrderId);
  if (!order || !order.items.length) return showToast('No hay productos en la mesa para dividir.');

  splitBillData.orderId = order.id;
  splitBillData.itemQuantities = {};
  splitBillData.paidPartIndices = [];

  const dialog = document.querySelector('#splitBillDialog');
  if (dialog) {
    dialog.showModal();
    renderSplitBill();
  }
}

function setSplitBillMode(mode) {
  splitBillData.mode = mode;
  const isEq = mode === 'equal';
  document.querySelector('#splitModeEqualBtn')?.classList.toggle('active', isEq);
  document.querySelector('#splitModeItemsBtn')?.classList.toggle('active', !isEq);
  document.querySelector('#splitEqualSection')?.toggleAttribute('hidden', !isEq);
  document.querySelector('#splitItemsSection')?.toggleAttribute('hidden', isEq);
  renderSplitBill();
}

function changeSplitPeople(delta) {
  let count = (splitBillData.people || 2) + delta;
  if (count < 2) count = 2;
  if (count > 20) count = 20;
  splitBillData.people = count;
  splitBillData.paidPartIndices = [];
  renderSplitBill();
}

function setSplitPeopleExact(count) {
  splitBillData.people = Math.max(2, Math.min(20, count));
  splitBillData.paidPartIndices = [];
  renderSplitBill();
}

function renderSplitBill() {
  const order = getOrder(state.currentOrderId || splitBillData.orderId);
  if (!order) return;
  const total = orderTotal(order);

  const titleEl = document.querySelector('#splitBillTitle');
  if (titleEl) titleEl.textContent = `Dividir cuenta · ${order.tableName} (${money.format(total)})`;

  if (splitBillData.mode === 'equal') {
    renderSplitEqual(order, total);
  } else {
    renderSplitItems(order);
  }
}

function renderSplitEqual(order, total) {
  const n = splitBillData.people || 2;
  const peopleCountInput = document.querySelector('#splitPeopleCount');
  if (peopleCountInput) peopleCountInput.value = n;

  document.querySelectorAll('.people-preset-btn').forEach(b => {
    b.classList.toggle('active', Number(b.dataset.people) === n);
  });

  const totalOrderEl = document.querySelector('#splitEqualTotalOrder');
  if (totalOrderEl) totalOrderEl.textContent = money.format(total);

  const perPerson = Math.round(total / n);
  const perPersonEl = document.querySelector('#splitEqualPerPerson');
  if (perPersonEl) perPersonEl.textContent = `${money.format(perPerson)} c/u`;

  const listEl = document.querySelector('#splitFractionsList');
  if (!listEl) return;

  const paidSet = new Set(splitBillData.paidPartIndices || []);
  let html = '';

  for (let i = 1; i <= n; i++) {
    const isPaid = paidSet.has(i);
    const isLast = i === n;
    const fractionAmount = isLast ? (total - (perPerson * (n - 1))) : perPerson;

    html += `
      <div class="fraction-card ${isPaid ? 'paid' : ''}">
        <div class="fraction-meta">
          <span class="fraction-badge">Persona ${i} de ${n}</span>
          <strong class="fraction-amount">${money.format(fractionAmount)}</strong>
        </div>
        <div class="fraction-action">
          ${isPaid
            ? `<span class="paid-status-badge">✓ Cobrado</span>`
            : `<button type="button" class="primary-button charge-fraction-btn" data-charge-part="${i}" data-amount="${fractionAmount}">Cobrar Fracción</button>`
          }
        </div>
      </div>
    `;
  }
  listEl.innerHTML = html;
}

function chargeEqualPart(partIndex, fractionAmount) {
  const order = getOrder(state.currentOrderId || splitBillData.orderId);
  if (!order || !order.items.length) return showToast('No hay saldo pendiente en esta mesa.');

  const n = splitBillData.people || 2;
  const isLast = (splitBillData.paidPartIndices.length + 1 >= n) || partIndex === n;

  const remainingFractions = Math.max(1, n - splitBillData.paidPartIndices.length);
  const fractionFactor = 1 / remainingFractions;

  const itemsForFraction = order.items.map(item => {
    const qty = isLast ? item.qty : Math.max(0.01, Number((item.qty * fractionFactor).toFixed(2)));
    return {
      ...structuredClone(item),
      qty
    };
  });

  openPayment({
    orderId: order.id,
    type: 'equal_fraction',
    items: itemsForFraction,
    total: fractionAmount,
    customerName: `${order.tableName} · Fracción ${partIndex}/${n}`,
    fractionIndex: partIndex,
    totalFractions: n,
    isLastFraction: isLast
  });
}

function renderSplitItems(order) {
  const tbody = document.querySelector('#splitItemsTableBody');
  if (!tbody) return;

  let totalSelected = 0;
  let totalUnits = 0;

  tbody.innerHTML = order.items.map(item => {
    const sel = Math.min(item.qty, Math.max(0, splitBillData.itemQuantities[item.productId] || 0));
    splitBillData.itemQuantities[item.productId] = sel;
    const subtotal = sel * item.price;
    totalSelected += subtotal;
    totalUnits += sel;

    return `
      <tr class="${sel > 0 ? 'row-selected' : ''}">
        <td><strong>${escapeHtml(item.name)}</strong><br><small class="muted">${money.format(item.price)} c/u</small></td>
        <td>${item.qty}</td>
        <td>
          <div class="quantity-control">
            <button type="button" data-split-item-dec="${item.productId}">−</button>
            <span>${sel}</span>
            <button type="button" data-split-item-inc="${item.productId}" ${sel >= item.qty ? 'disabled' : ''}>+</button>
          </div>
        </td>
        <td class="text-right"><b>${money.format(subtotal)}</b></td>
      </tr>
    `;
  }).join('');

  const unitsEl = document.querySelector('#splitItemsSelectedUnits');
  if (unitsEl) unitsEl.textContent = totalUnits;

  const totalEl = document.querySelector('#splitItemsSelectedTotal');
  if (totalEl) totalEl.textContent = money.format(totalSelected);

  const chargeBtn = document.querySelector('#chargeSelectedItemsBtn');
  if (chargeBtn) chargeBtn.disabled = totalUnits === 0;
}

function changeSplitItemQty(productId, delta) {
  const order = getOrder(state.currentOrderId || splitBillData.orderId);
  const item = order?.items.find(i => i.productId === productId);
  if (!item) return;

  const cur = splitBillData.itemQuantities[productId] || 0;
  const next = Math.max(0, Math.min(item.qty, cur + delta));
  splitBillData.itemQuantities[productId] = next;
  renderSplitItems(order);
}

function selectAllSplitItems() {
  const order = getOrder(state.currentOrderId || splitBillData.orderId);
  if (!order) return;
  order.items.forEach(i => { splitBillData.itemQuantities[i.productId] = i.qty; });
  renderSplitItems(order);
}

function clearSplitItems() {
  const order = getOrder(state.currentOrderId || splitBillData.orderId);
  if (!order) return;
  order.items.forEach(i => { splitBillData.itemQuantities[i.productId] = 0; });
  renderSplitItems(order);
}

function chargeSelectedSplitItems() {
  const order = getOrder(state.currentOrderId || splitBillData.orderId);
  if (!order) return;

  const itemsToCharge = order.items
    .filter(i => (splitBillData.itemQuantities[i.productId] || 0) > 0)
    .map(i => ({
      ...structuredClone(i),
      qty: splitBillData.itemQuantities[i.productId]
    }));

  if (!itemsToCharge.length) return showToast('Selecciona al menos una unidad a cobrar.');

  const total = itemsToCharge.reduce((sum, i) => sum + (i.price * i.qty), 0);

  openPayment({
    orderId: order.id,
    type: 'selection',
    items: itemsToCharge,
    total,
    customerName: `${order.tableName} · Ítems seleccionados`
  });
}
function openInventoryDialog(itemId=null) { const select=document.querySelector('#inventorySelect'); select.innerHTML=state.inventory.map(i=>`<option value="${i.id}">${i.name} (${formatQty(i.qty)} ${i.unit})</option>`).join(''); if(itemId)select.value=itemId; document.querySelector('#inventoryAmount').value='';document.querySelector('#inventoryReason').value='';document.querySelector('#inventoryDialog').showModal(); }
function openProductDialog(productId=null) { editingProductId=productId;const product=productId && state.products.find(item=>item.id===productId), stock=product && state.inventory.find(item=>item.id===product.inventoryId);pendingProductImage=product?.image || null;document.querySelector('#productName').value=product?.name || '';document.querySelector('#productCategory').value=product?.category || '';document.querySelector('#productCost').value=product?.cost ?? '';document.querySelector('#productPrice').value=product?.price ?? '';document.querySelector('#productStock').value=stock?.qty ?? '';document.querySelector('#productMinStock').value=stock?.min ?? 5;document.querySelector('#productUnit').value=stock?.unit || 'und';document.querySelector('#productImage').value='';setImagePreview(document.querySelector('#productImagePreview'),pendingProductImage,product?.icon || '🍾');document.querySelector('#productDialog h2').textContent=product ? 'Editar producto' : 'Nuevo producto';document.querySelector('#saveProductButton').textContent=product ? 'Guardar cambios' : 'Crear producto e inventario';document.querySelector('#productDialog').showModal(); }
function saveProduct() { const name=document.querySelector('#productName').value.trim(), category=document.querySelector('#productCategory').value.trim() || 'Otros'; const costRaw=document.querySelector('#productCost').value, priceRaw=document.querySelector('#productPrice').value, stockRaw=document.querySelector('#productStock').value, minRaw=document.querySelector('#productMinStock').value; const cost=Number(costRaw), price=Number(priceRaw), stock=Number(stockRaw || 0), min=minRaw==='' ? 5 : Number(minRaw || 0), unit=document.querySelector('#productUnit').value; if(!name || costRaw==='' || priceRaw==='' || cost<0 || price<=0 || stock<0 || min<0) return showToast('Completa nombre, costo, precio de venta y existencias válidas.');if(!state.categories.includes(category))state.categories.push(category);let product=editingProductId && state.products.find(item=>item.id===editingProductId);if(product){const supply=state.inventory.find(item=>item.id===product.inventoryId);product.name=name;product.category=category;product.cost=cost;product.price=price;product.image=pendingProductImage;product.sync_status='pending';if(supply){supply.name=name;supply.unit=unit;supply.qty=stock;supply.min=min;}else{const inventoryId=uid('inv');state.inventory.push({id:inventoryId,name,unit,qty:stock,min});product.inventoryId=inventoryId;product.recipe={[inventoryId]:1};}}else{const inventoryId=uid('inv'), productId=uid('prod');state.inventory.push({id:inventoryId,name,unit,qty:stock,min});state.products.push({id:productId,name,category,cost,price,icon:'🍾',image:pendingProductImage,inventoryId,recipe:{[inventoryId]:1},sync_status:'pending'});}saveState();document.querySelector('#productDialog').close();renderAll();showToast(product ? 'Producto actualizado.' : 'Producto creado con su stock inicial.'); }
function deleteProduct(productId) { const product=state.products.find(item=>item.id===productId);if(!product)return;if(!window.confirm(`¿Eliminar ${product.name}? Esta acción no borra facturas ni ventas históricas.`))return;if(globalThis.NexoSync?.deleteProduct){globalThis.NexoSync.deleteProduct(productId);}else if(globalThis.NexoSync?.trackProductDeletion){globalThis.NexoSync.trackProductDeletion(productId);}const targetInventoryId=product.inventoryId || `stock-${productId}`;state.products=state.products.filter(item=>item.id!==productId);if(state.products.length===0){state.inventory=[];}else{const validInventoryIds=new Set(state.products.map(p=>p.inventoryId).filter(Boolean));state.inventory=state.inventory.filter(item=>item.id!==targetInventoryId&&item.id!==product.inventoryId&&item.id!==`stock-${productId}`&&item.id!==productId&&validInventoryIds.has(item.id));}saveState();renderAll();showToast('Producto eliminado del catálogo.'); }
globalThis.deleteProduct = deleteProduct;
function openCategoriesDialog() { renderCategoryList();document.querySelector('#newCategoryName').value='';document.querySelector('#categoriesDialog').showModal(); }
function renderCategoryList() { document.querySelector('#categoryList').innerHTML=state.categories.map((category,index)=>`<div class="category-row"><input id="categoryName-${index}" type="text" value="${escapeHtml(category)}" /><button class="outline-button" data-save-category="${index}">Guardar</button><button class="remove-line" data-delete-category="${index}" aria-label="Eliminar categoría">×</button></div>`).join(''); }
function addCategory() { const category=document.querySelector('#newCategoryName').value.trim();if(!category)return showToast('Escribe un nombre de categoría.');if(state.categories.some(item=>item.toLowerCase()===category.toLowerCase()))return showToast('Esa categoría ya existe.');state.categories.push(category);saveState();document.querySelector('#newCategoryName').value='';renderCategoryList();renderCategoryOptions();showToast('Categoría creada.'); }
function saveCategory(index) { const oldCategory=state.categories[index], nextCategory=document.querySelector(`#categoryName-${index}`).value.trim();if(!nextCategory)return showToast('La categoría necesita un nombre.');if(state.categories.some((item,itemIndex)=>itemIndex!==index&&item.toLowerCase()===nextCategory.toLowerCase()))return showToast('Ya existe una categoría con ese nombre.');state.categories[index]=nextCategory;state.products.forEach(product=>{if(product.category===oldCategory)product.category=nextCategory;});saveState();renderCategoryList();renderAll();showToast('Categoría actualizada.'); }
function deleteCategory(index) { const category=state.categories[index];if(state.categories.length===1)return showToast('Debe existir al menos una categoría.');if(!window.confirm(`¿Eliminar la categoría ${category}? Sus productos quedarán en “Otros”.`))return;state.categories.splice(index,1);if(!state.categories.includes('Otros'))state.categories.push('Otros');state.products.forEach(product=>{if(product.category===category)product.category='Otros';});saveState();renderCategoryList();renderAll();showToast('Categoría eliminada.'); }
function readLocalImage(file,onLoad) { if(!file)return;if(!file.type.startsWith('image/'))return showToast('Selecciona un archivo de imagen.');if(file.size>1500000)return showToast('Usa una imagen de máximo 1,5 MB.');const reader=new FileReader();reader.onload=()=>onLoad(reader.result);reader.readAsDataURL(file); }
function saveProfile() { const name=document.querySelector('#businessName').value.trim(),nit=document.querySelector('#businessNit')?document.querySelector('#businessNit').value.trim():(state.profile?.nit || ''),address=document.querySelector('#businessAddress').value.trim(),phone=document.querySelector('#businessPhone').value.trim(),ownerPhone=document.querySelector('#businessOwnerPhone')?.value.trim() || '+57',syncId=document.querySelector('#businessSyncId')?.value.trim() || 'nexobar_default';if(!name)return showToast('Indica el nombre del negocio.');state.profile={...state.profile,name,nit,address,phone,ownerPhone,syncId,sync_status:'pending',image:pendingBusinessImage ?? state.profile.image};saveState();renderAll();showToast('Información del negocio guardada.'); }
function openPurchaseDialog() { if(!requireOpenShift())return;if(!state.products.length) return showToast('Crea primero un producto.'); const product=state.products[0];purchaseDraft=[{productId:product.id,qty:1,unitCost:defaultUnitCost(product)}]; document.querySelector('#purchaseSupplier').value='';document.querySelector('#purchaseInvoice').value='';document.querySelector('#purchaseDate').value=today();document.querySelector('#purchaseMethod').value='Efectivo';renderPurchaseLines();document.querySelector('#purchaseDialog').showModal(); }
function renderPurchaseLines() { const selectOptions=state.products.map(product=>`<option value="${product.id}">${escapeHtml(product.name)} · costo prom. ${money.format(product.cost || 0)}</option>`).join(''); document.querySelector('#purchaseLines').innerHTML=purchaseDraft.map((line,index)=>`<div class="purchase-line"><select data-purchase-index="${index}" data-purchase-field="productId">${selectOptions}</select><input data-purchase-index="${index}" data-purchase-field="qty" type="number" min="0.1" step="0.1" value="${line.qty}" aria-label="Cantidad" /><input data-purchase-index="${index}" data-purchase-field="unitCost" type="number" min="0" value="${line.unitCost}" aria-label="Costo unitario" /><button class="remove-line" data-remove-purchase-line="${index}" aria-label="Eliminar producto">×</button></div>`).join(''); purchaseDraft.forEach((line,index)=>{const select=document.querySelector(`[data-purchase-index="${index}"][data-purchase-field="productId"]`);if(select)select.value=line.productId;}); updatePurchaseTotal(); }
function updatePurchaseDraft(target) { const line=purchaseDraft[Number(target.dataset.purchaseIndex)];if(!line)return;const field=target.dataset.purchaseField;if(field==='productId'){line.productId=target.value;line.unitCost=defaultUnitCost(state.products.find(product=>product.id===line.productId));renderPurchaseLines();return;}line[field]=Number(target.value || 0);updatePurchaseTotal(); }
function updatePurchaseTotal() { document.querySelector('#purchaseTotal').textContent=money.format(purchaseDraft.reduce((sum,line)=>sum+(Number(line.qty)||0)*(Number(line.unitCost)||0),0)); }
function addPurchaseLine() { const product=state.products[0];purchaseDraft.push({productId:product.id,qty:1,unitCost:defaultUnitCost(product)});renderPurchaseLines(); }
function removePurchaseLine(index) { if(purchaseDraft.length===1)return showToast('La factura debe tener al menos un producto.');purchaseDraft.splice(index,1);renderPurchaseLines(); }
function openExpenseDialog() { if(!requireOpenShift())return;document.querySelector('#expenseCategory').value='Servicios públicos';document.querySelector('#expenseDescription').value='';document.querySelector('#expenseAmount').value='';document.querySelector('#expenseMethod').value='Efectivo';document.querySelector('#expenseDate').value=today();document.querySelector('#expenseDialog').showModal(); }
function saveExpense() {
  if (!requireOpenShift()) return;
  const category = document.querySelector('#expenseCategory').value,
        description = document.querySelector('#expenseDescription').value.trim(),
        amount = Number(document.querySelector('#expenseAmount').value),
        method = document.querySelector('#expenseMethod').value,
        date = document.querySelector('#expenseDate').value;
  if (!description || !amount || !date) return showToast('Completa la descripción, el valor y la fecha del gasto.');
  state.expenses.push({
    id: uid('expense'),
    category,
    description,
    amount,
    method,
    date,
    createdAt: Date.now(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    shiftId: state.cashShift.id,
    sync_status: 'pending'
  });
  saveState();
  document.querySelector('#expenseDialog').close();
  renderAll();
  showToast('Gasto registrado.');
  if (globalThis.NexoSync?.syncAll) {
    globalThis.NexoSync.syncAll().catch(() => {});
  }
}
function openShiftDialog() { if(isShiftOpen())return openCloseDialog();document.querySelector('#openingCash').value='';document.querySelector('#openShiftDialog').showModal(); }
function confirmOpenShift() {
  const raw = document.querySelector('#openingCash').value, openingCash = Number(raw);
  if (raw === '' || openingCash < 0) return showToast('Indica la base inicial de efectivo, incluso si es $0.');
  state.cashShift = { id: uid('shift'), status: 'open', date: today(), openedAt: Date.now(), openingCash };
  saveState();
  document.querySelector('#openShiftDialog').close();
  renderAll();
  showToast('Turno de caja abierto.');
  if (globalThis.NexoSync?.syncCashShift) {
    globalThis.NexoSync.syncCashShift(state.cashShift).catch(() => {});
  }
}
function openCloseDialog() { if(!isShiftOpen())return openShiftDialog();const expected=expectedCash(), totalSales=currentShiftPayments().reduce((sum,payment)=>sum+payment.amount,0);document.querySelector('#closeSummary').innerHTML=`<div><span>Base inicial</span><strong>${money.format(state.cashShift.openingCash || 0)}</strong></div><div><span>Ventas en efectivo</span><strong>${money.format(cashSalesToday())}</strong></div><div><span>Ventas por otros medios</span><strong>${money.format(otherSalesToday())}</strong></div><div><span>Compras y gastos en efectivo</span><strong>− ${money.format(cashExpensesToday()+cashPurchasesToday())}</strong></div><div><span>Venta total del turno</span><strong>${money.format(totalSales)}</strong></div>`;document.querySelector('#expectedCashInClose').textContent=money.format(expected);document.querySelector('#countedCash').value=0;resetCashCounter();document.querySelector('#cashDifference').textContent='';document.querySelector('#closeDialog').showModal(); }
function checkCashDifference() { const diff=Number(document.querySelector('#countedCash').value||0)-expectedCash();const el=document.querySelector('#cashDifference');el.textContent=diff===0?'Caja cuadrada.':`${diff>0?'Sobrante':'Faltante'}: ${money.format(Math.abs(diff))}`;el.className=`change-message ${diff===0?'positive':'negative'}`; }
let lastClosedShift = null;
function confirmClose() {
  if (!isShiftOpen()) return;
  const expected = expectedCash(),
        counted = Number(document.querySelector('#countedCash').value || 0),
        totalSales = currentShiftPayments().reduce((sum, payment) => sum + payment.amount, 0);

  const closedShift = {
    id: state.cashShift.id,
    date: today(),
    openedAt: state.cashShift.openedAt,
    closedAt: Date.now(),
    openingCash: state.cashShift.openingCash,
    cashSales: cashSalesToday(),
    otherSales: otherSalesToday(),
    cashExpenses: cashExpensesToday() + cashPurchasesToday(),
    totalSales,
    expected,
    counted,
    difference: counted - expected,
    breakdown: cashCounts(),
    closedBy: actor().userName || 'Cajero'
  };

  state.closedShifts.push(closedShift);
  lastClosedShift = closedShift;
  state.cashShift = { status: 'closed', lastClosedAt: Date.now() };
  saveState();
  document.querySelector('#closeDialog').close();
  renderAll();
  showToast('Cierre de caja registrado.');
  if (globalThis.NexoSync?.syncCashShift) {
    globalThis.NexoSync.syncCashShift(state.cashShift, closedShift).catch(() => {});
  }
  openCloseSuccessDialog(closedShift);
}

async function forceResetShift() {
  if (!window.confirm('¿Seguro que deseas forzar el cierre del turno activo y reiniciar el saldo esperado de caja a $0?')) return;
  const now = Date.now();
  const prevShift = state.cashShift || {};
  const closedShift = {
    id: prevShift.id || uid('shift'),
    date: prevShift.date || today(),
    openedAt: prevShift.openedAt || now,
    closedAt: now,
    openingCash: Number(prevShift.openingCash || 0),
    cashSales: cashSalesToday(),
    otherSales: otherSalesToday(),
    cashExpenses: cashExpensesToday() + cashPurchasesToday(),
    totalSales: currentShiftPayments().reduce((sum, p) => sum + p.amount, 0),
    expected: expectedCash(),
    counted: 0,
    difference: -expectedCash(),
    closedBy: (typeof actor === 'function' ? actor() : (globalThis.actor ? globalThis.actor() : {})).userName || 'Administrador',
    reason: 'Cierre forzado / Reinicio manual'
  };

  if (!Array.isArray(state.closedShifts)) state.closedShifts = [];
  state.closedShifts.push(closedShift);
  lastClosedShift = closedShift;
  state.cashShift = { status: 'closed', lastClosedAt: now };
  saveState();
  if (globalThis.NexoSync?.syncCashShift) {
    await globalThis.NexoSync.syncCashShift(state.cashShift, closedShift).catch(() => {});
  }
  const closeDlg = document.querySelector('#closeDialog');
  if (closeDlg) closeDlg.close();
  renderAll();
  showToast('Turno cerrado forzosamente. Saldo de caja reiniciado a $0.');
}
globalThis.forceResetShift = forceResetShift;

function openCloseSuccessDialog(closedShift) {
  const content = document.querySelector('#closeSuccessContent');
  if (!content) return;
  const diff = closedShift.difference;
  const diffLabel = diff === 0
    ? '<span class="status status-good">Caja cuadrada</span>'
    : (diff > 0 ? `<span class="status status-good">Sobrante: ${money.format(diff)}</span>` : `<span class="status status-out">Faltante: ${money.format(Math.abs(diff))}</span>`);

  content.innerHTML = `
    <div class="close-card-summary">
      <div class="close-summary-row"><span>Fecha:</span><strong>${new Date(closedShift.closedAt).toLocaleString('es-CO')}</strong></div>
      <div class="close-summary-row"><span>Cerrado por:</span><strong>${escapeHtml(closedShift.closedBy || 'Cajero')}</strong></div>
      <div class="close-summary-row highlight"><span>Venta total turno:</span><strong class="text-orange">${money.format(closedShift.totalSales)}</strong></div>
      <div class="close-summary-row"><span>Efectivo esperado:</span><strong>${money.format(closedShift.expected)}</strong></div>
      <div class="close-summary-row"><span>Efectivo físico:</span><strong>${money.format(closedShift.counted)}</strong></div>
      <div class="close-summary-row"><span>Estado arqueo:</span><strong>${diffLabel}</strong></div>
    </div>
  `;
  const isDemo = isDemoMode();
  const cswTop = document.querySelector('#closeSuccessWatermarkTop');
  const cswBottom = document.querySelector('#closeSuccessWatermarkBottom');
  if (cswTop) cswTop.hidden = !isDemo;
  if (cswBottom) cswBottom.hidden = !isDemo;

  document.querySelector('#closeSuccessDialog')?.showModal();
}

function buildCloseWhatsappUrl(closedShift) {
  const rawPhone = (state.profile?.ownerPhone || '+57').trim();
  let phoneClean = rawPhone.replace(/[^\d+]/g, '').replace(/^\+/, '');
  if (phoneClean.length === 10 && phoneClean.startsWith('3')) {
    phoneClean = '57' + phoneClean;
  }
  if (!phoneClean || phoneClean === '57') {
    phoneClean = '';
  }

  const shiftPayments = state.payments.filter(p => p.shiftId === closedShift.id);
  const totalSales = closedShift.totalSales != null ? closedShift.totalSales : shiftPayments.reduce((s, p) => s + p.amount, 0);

  const tenders = {
    Efectivo: 0,
    Nequi: 0,
    Daviplata: 0,
    'Tarjeta / Datáfono': 0,
    Transferencia: 0
  };

  shiftPayments.forEach(p => {
    if (Array.isArray(p.payments) && p.payments.length > 0) {
      p.payments.forEach(t => {
        let k = t.method;
        if (k.toLowerCase().includes('tarjeta') || k.toLowerCase().includes('datáfono') || k.toLowerCase().includes('datafono')) k = 'Tarjeta / Datáfono';
        else if (k.toLowerCase().includes('nequi')) k = 'Nequi';
        else if (k.toLowerCase().includes('daviplata')) k = 'Daviplata';
        else if (k.toLowerCase().includes('transf')) k = 'Transferencia';
        else if (k.toLowerCase().includes('efectivo')) k = 'Efectivo';
        tenders[k] = (tenders[k] || 0) + t.amount;
      });
    } else {
      let k = p.method;
      if (k.toLowerCase().includes('tarjeta') || k.toLowerCase().includes('datáfono') || k.toLowerCase().includes('datafono')) k = 'Tarjeta / Datáfono';
      else if (k.toLowerCase().includes('nequi')) k = 'Nequi';
      else if (k.toLowerCase().includes('daviplata')) k = 'Daviplata';
      else if (k.toLowerCase().includes('transf')) k = 'Transferencia';
      else if (k.toLowerCase().includes('efectivo')) k = 'Efectivo';
      tenders[k] = (tenders[k] || 0) + p.amount;
    }
  });

  const shiftMermas = state.stockLog.filter(e => e.type === 'merma' && e.at >= closedShift.openedAt && e.at <= (closedShift.closedAt || Date.now()));
  const mermasUnits = shiftMermas.reduce((s, e) => s + Math.abs(e.delta), 0);
  const mermasCost = shiftMermas.reduce((s, e) => s + Math.abs(e.value || 0), 0);

  const closedDateStr = new Date(closedShift.closedAt || Date.now()).toLocaleString('es-CO');
  const cashierName = closedShift.closedBy || actor().userName || 'Cajero de turno';

  const lines = [
    `📊 *NexoBar - Cierre de Caja*`,
    `📅 Fecha: ${closedDateStr}`,
    `👤 Turno cerrado por: ${cashierName}`,
    `💰 *Total Ventas:* ${money.format(totalSales)}`,
    `--------------------------`,
    `💵 Efectivo: ${money.format(tenders['Efectivo'] || 0)}`,
    `📱 Nequi: ${money.format(tenders['Nequi'] || 0)}`,
    `💳 Daviplata: ${money.format(tenders['Daviplata'] || 0)}`,
    `💳 Tarjeta / Datáfono: ${money.format(tenders['Tarjeta / Datáfono'] || 0)}`,
    `🔄 Transferencias: ${money.format(tenders['Transferencia'] || 0)}`,
    `--------------------------`,
    `👥 Cuentas/Mesas atendidas: ${shiftPayments.length}`,
    `⚠️ Cortesías / Mermas: ${formatQty(mermasUnits)} und (${money.format(mermasCost)})`,
    `📥 Base inicial en caja: ${money.format(closedShift.openingCash || 0)}`,
    `💵 Efectivo reportado en caja: ${money.format(closedShift.counted || 0)}`
  ];

  if (closedShift.difference !== 0) {
    const diffSign = closedShift.difference > 0 ? 'Sobrante' : 'Faltante';
    lines.push(`⚖️ Diferencia: ${diffSign} ${money.format(Math.abs(closedShift.difference))}`);
  }

  const text = encodeURIComponent(lines.join('\n'));
  return phoneClean ? `https://wa.me/${phoneClean}?text=${text}` : `https://wa.me/?text=${text}`;
}

function sendCloseWhatsapp(closedShift = null) {
  const shift = closedShift || lastClosedShift || state.closedShifts.slice(-1)[0];
  if (!shift) return showToast('No hay turno cerrado para enviar.');
  const url = buildCloseWhatsappUrl(shift);
  window.open(url, '_blank');
}

function printShiftZ(closedShift = null) {
  const shift = closedShift || lastClosedShift || state.closedShifts.slice(-1)[0];
  if (!shift) return showToast('No hay cierre disponible.');
  const profile = state.profile || defaultState.profile;
  const shiftPayments = state.payments.filter(p => p.shiftId === shift.id);
  const totalSales = shift.totalSales != null ? shift.totalSales : shiftPayments.reduce((s, p) => s + p.amount, 0);

  const isDemo = isDemoMode();
  const demoWatermarkHtml = isDemo ? `
    <div class="center bold demo-watermark" style="border:1.5px dashed #444;padding:6px;margin:8px 0;font-size:11px;letter-spacing:0.5px;background:#f3f4f6;">
      DOCUMENTO DE DEMOSTRACIÓN — NETXPREMIUM
    </div>
  ` : '';

  const printWindow = window.open('', '_blank', 'width=380,height=600');
  if (!printWindow) return window.print();

  printWindow.document.write(`
    <!DOCTYPE html>
    <html>
      <head>
        <title>Ticket Z - Cierre de Turno</title>
        <style>
          body { font-family: monospace; font-size: 12px; margin: 15px; color: #000; }
          .center { text-align: center; }
          hr { border: 0; border-top: 1px dashed #000; margin: 10px 0; }
          .row { display: flex; justify-content: space-between; margin: 3px 0; }
          .bold { font-weight: bold; }
        </style>
      </head>
      <body>
        ${demoWatermarkHtml}
        <div class="center">
          <h2 style="margin:0">${escapeHtml(profile.name || 'NexoBar')}</h2>
          ${profile.nit ? `<div>NIT: ${escapeHtml(profile.nit)}</div>` : ''}
          ${profile.address ? `<div>${escapeHtml(profile.address)}</div>` : ''}
          ${profile.phone ? `<div>Tel: ${escapeHtml(profile.phone)}</div>` : ''}
          <div class="bold" style="margin-top:5px">COMPROBANTE DE CIERRE (TICKET Z)</div>
        </div>
        <hr>
        <div class="row"><span>Fecha:</span><span>${new Date(shift.closedAt).toLocaleString('es-CO')}</span></div>
        <div class="row"><span>Cajero:</span><span>${escapeHtml(shift.closedBy || 'Cajero')}</span></div>
        <div class="row"><span>Cuentas:</span><span>${shiftPayments.length}</span></div>
        <hr>
        <div class="row bold"><span>TOTAL VENTAS:</span><span>${money.format(totalSales)}</span></div>
        <div class="row"><span>Ventas Efectivo:</span><span>${money.format(shift.cashSales || 0)}</span></div>
        <div class="row"><span>Otros medios:</span><span>${money.format(shift.otherSales || 0)}</span></div>
        <div class="row"><span>Compras/Gastos:</span><span>- ${money.format(shift.cashExpenses || 0)}</span></div>
        <hr>
        <div class="row"><span>Base inicial:</span><span>${money.format(shift.openingCash || 0)}</span></div>
        <div class="row"><span>Efectivo esperado:</span><span>${money.format(shift.expected || 0)}</span></div>
        <div class="row bold"><span>Efectivo contado:</span><span>${money.format(shift.counted || 0)}</span></div>
        <div class="row bold"><span>Diferencia:</span><span>${shift.difference >= 0 ? '+' : ''}${money.format(shift.difference || 0)}</span></div>
        <hr>
        ${demoWatermarkHtml}
        <div class="center" style="margin-top:15px">*** NexoBar POS ***</div>
        <script>window.onload = function() { window.print(); }<\/script>
      </body>
    </html>
  `);
  printWindow.document.close();
}
globalThis.printShiftZ = printShiftZ;

function getLowAndOutOfStockItems() {
  return state.inventory.filter(i => i.qty <= i.min).map(item => {
    const ideal = Math.max(item.min * 2, item.min + 5);
    const needed = Math.max(1, Math.round(ideal - item.qty));
    return {
      ...item,
      ideal,
      needed,
      isOut: item.qty <= 0
    };
  }).sort((a, b) => a.qty - b.qty);
}

function openPurchaseSuggestDialog() {
  const items = getLowAndOutOfStockItems();
  const listEl = document.querySelector('#suggestedItemsList');
  if (!listEl) return;

  if (!items.length) {
    listEl.innerHTML = '<div class="empty-suggested-card"><p class="text-success">🎉 ¡Excelente! Todos los productos están con existencias por encima del stock mínimo.</p></div>';
    document.querySelector('#copyPurchaseOrderButton').disabled = true;
  } else {
    document.querySelector('#copyPurchaseOrderButton').disabled = false;
    listEl.innerHTML = items.map(i => `
      <div class="suggested-item-card ${i.isOut ? 'out-of-stock' : 'low-stock'}">
        <div class="suggested-item-info">
          <strong>${escapeHtml(i.name)}</strong>
          <small class="muted">Actual: <b>${formatQty(i.qty)} ${escapeHtml(i.unit)}</b> · Mínimo: ${formatQty(i.min)} ${escapeHtml(i.unit)} · Ideal: ${formatQty(i.ideal)} ${escapeHtml(i.unit)}</small>
        </div>
        <div class="suggested-item-needed">
          <span class="needed-label">Pedir:</span>
          <strong class="needed-qty text-orange">${i.needed} ${escapeHtml(i.unit)}</strong>
          <span class="status ${i.isOut ? 'status-out' : 'status-low'}">${i.isOut ? 'Agotado' : 'Bajo stock'}</span>
        </div>
      </div>
    `).join('');
  }
  document.querySelector('#purchaseSuggestDialog')?.showModal();
}

function copyPurchaseOrder() {
  const items = getLowAndOutOfStockItems();
  if (!items.length) return showToast('No hay productos que requieran reposición.');

  const dateStr = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'long', year: 'numeric' }).format(new Date());
  const lines = [
    `*${state.profile?.name || 'NexoBar'} - Pedido de Reposición [${dateStr}]*`,
    `--------------------------------------------------`
  ];
  items.forEach(i => {
    lines.push(`- ${i.name}: ${i.needed} ${i.unit}${i.isOut ? ' (AGOTADO)' : ''}`);
  });
  lines.push(`--------------------------------------------------`);
  lines.push(`Total referencias a reponer: ${items.length}`);

  const textToCopy = lines.join('\n');
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(textToCopy).then(() => {
      showToast('¡Pedido de reposición copiado al portapapeles!');
    }).catch(() => {
      fallbackCopyText(textToCopy);
    });
  } else {
    fallbackCopyText(textToCopy);
  }
}

function fallbackCopyText(text) {
  const ta = document.createElement('textarea');
  ta.value = text;
  ta.style.position = 'fixed';
  ta.style.left = '-9999px';
  document.body.appendChild(ta);
  ta.select();
  try {
    document.execCommand('copy');
    showToast('¡Pedido de reposición copiado al portapapeles!');
  } catch {
    showToast('No se pudo copiar automáticamente.');
  }
  document.body.removeChild(ta);
}
function exportBackup() { const blob=new Blob([JSON.stringify(state,null,2)],{type:'application/json'});const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`nexobar-pos-respaldo-${today()}.json`;a.click();URL.revokeObjectURL(url);showToast('Respaldo descargado.'); }
function importBackup(file) { const reader=new FileReader();reader.onload=()=>{try{const incoming=JSON.parse(reader.result);if(!incoming.tables||!incoming.products||!incoming.inventory)throw new Error();state=normalizeState(incoming);saveState();renderAll();afterStateReplaced();showToast('Respaldo restaurado correctamente.');}catch{showToast('El archivo de respaldo no es válido.');}};reader.readAsText(file); }
function escapeHtml(str){return String(str).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]));}
globalThis.escapeHtml = escapeHtml;

document.addEventListener('click', event => {
  const target = event.target.closest('button');
  if (!target) return;
  if (target.dataset.view) {
    document.querySelectorAll('.view').forEach(v => v.classList.toggle('active-view', v.id === target.dataset.view));
    document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === target.dataset.view));
    document.querySelector('#pageTitle').textContent = target.textContent.replace(/\d+/g, '').trim();
    return;
  }
  if (target.dataset.zone) { state.zone = target.dataset.zone; renderZones(); renderTables(); }
  if (target.dataset.table) openOrder(target.dataset.table);
  if (target.dataset.openCustomOrder) openCustomOrder(target.dataset.openCustomOrder);
  if (target.dataset.category) { state.activeCategory = target.dataset.category; renderOrderDialog(); }
  if (target.dataset.product) addProduct(target.dataset.product);
  if (target.dataset.itemChange) changeItem(target.dataset.itemChange, target.dataset.delta);
  if (target.dataset.method) { state.paymentMethod = target.dataset.method; renderPaymentOptions(); updateTenderChange(); }
  if (target.dataset.payMethod) { activePaymentMethod = target.dataset.payMethod; state.paymentMethod = activePaymentMethod; refreshPaymentUI(); }
  if (target.id === 'addTenderButton') addPaymentTender();
  if (target.dataset.removeTender !== undefined) removePaymentTender(Number(target.dataset.removeTender));
  if (target.id === 'splitBillButton') openSplitBill();
  if (target.id === 'splitModeEqualBtn') setSplitBillMode('equal');
  if (target.id === 'splitModeItemsBtn') setSplitBillMode('items');
  if (target.id === 'splitPeopleDec') changeSplitPeople(-1);
  if (target.id === 'splitPeopleInc') changeSplitPeople(1);
  if (target.dataset.people) setSplitPeopleExact(Number(target.dataset.people));
  if (target.dataset.chargePart) chargeEqualPart(Number(target.dataset.chargePart), Number(target.dataset.amount));
  if (target.dataset.splitItemDec) changeSplitItemQty(target.dataset.splitItemDec, -1);
  if (target.dataset.splitItemInc) changeSplitItemQty(target.dataset.splitItemInc, 1);
  if (target.id === 'splitSelectAllBtn') selectAllSplitItems();
  if (target.id === 'splitClearBtn') clearSplitItems();
  if (target.id === 'chargeSelectedItemsBtn') chargeSelectedSplitItems();
  if (target.dataset.adjust) openInventoryDialog(target.dataset.adjust);
  if (target.dataset.close) {
    const dlgId = target.dataset.close;
    if (dlgId === 'orderDialog' && state.currentOrderId) {
      const curOrder = getOrder(state.currentOrderId);
      if (curOrder && (!curOrder.items || curOrder.items.length === 0 || !curOrder.items.some(i => (Number(i.qty) || 0) > 0))) {
        state.orders = state.orders.filter(o => o.id !== curOrder.id);
        state.currentOrderId = null;
        saveState();
        if (globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(() => {});
        renderAll();
      }
    }
    document.querySelector(`#${dlgId}`)?.close();
  }
  if (target.dataset.payCustomOrder) {
    const oId = target.dataset.payCustomOrder;
    state.currentOrderId = oId;
    openPayment();
  }
  if (target.dataset.deleteCustomOrder) {
    const oId = target.dataset.deleteCustomOrder;
    const ord = getOrder(oId);
    if (ord && window.confirm(`¿Eliminar o anular la cuenta "${ord.tableName || 'Cuenta'}"?`)) {
      state.orders = state.orders.filter(o => o.id !== oId);
      saveState();
      if (globalThis.NexoSync?.deleteActiveOrder) globalThis.NexoSync.deleteActiveOrder(oId).catch(() => {});
      if (globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(() => {});
      renderAll();
      showToast('Cuenta eliminada.');
    }
  }
  if (target.id === 'forceResetShiftButton' || target.id === 'resetShiftConfigButton') forceResetShift();
  if (target.dataset.editProduct) openProductDialog(target.dataset.editProduct);
  if (target.dataset.deleteProduct) deleteProduct(target.dataset.deleteProduct);
  if (target.dataset.saveCategory !== undefined) saveCategory(Number(target.dataset.saveCategory));
  if (target.dataset.deleteCategory !== undefined) deleteCategory(Number(target.dataset.deleteCategory));
  if (target.dataset.saveTable) saveTable(target.dataset.saveTable);
  if (target.dataset.deleteTable) deleteTable(target.dataset.deleteTable);
  if (target.id === 'newOrderButton') openOrder();
  if (target.id === 'manageTablesButton') openTablesDialog();
  if (target.id === 'addTableButton') addTable();
  if (target.id === 'newCustomOrderButton') openCustomOrderDialog();
  if (target.id === 'createCustomOrderButton') createCustomOrder();
  if (target.id === 'saveOrderButton') saveOrder();
  if (target.id === 'chargeButton') openPayment();
  if (target.id === 'confirmPaymentButton') confirmPayment();
  if (target.id === 'deleteOrderButton') deleteCurrentOrder();
  if (target.id === 'adjustInventoryButton') openInventoryDialog();
  if (target.id === 'saveInventoryButton') saveInventory();
  if (target.id === 'newProductButton') openProductDialog();
  if (target.id === 'saveProductButton') saveProduct();
  if (target.id === 'manageCategoriesButton') openCategoriesDialog();
  if (target.id === 'addCategoryButton') addCategory();
  if (target.id === 'newPurchaseButton') openPurchaseDialog();
  if (target.id === 'addPurchaseLineButton') addPurchaseLine();
  if (target.dataset.removePurchaseLine !== undefined) removePurchaseLine(Number(target.dataset.removePurchaseLine));
  if (target.id === 'recordPurchaseButton') savePurchase();
  if (target.id === 'newExpenseButton') openExpenseDialog();
  if (target.id === 'saveExpenseButton') saveExpense();
  if (target.id === 'shiftStatusButton') isShiftOpen() ? openCloseDialog() : openShiftDialog();
  if (target.id === 'confirmOpenShiftButton') confirmOpenShift();
  if (target.id === 'closeShiftButton' || target.id === 'openCloseButton') openCloseDialog();
  if (target.id === 'confirmCloseButton') confirmClose();
  if (target.id === 'sendCloseWhatsappBtn') sendCloseWhatsapp();
  if (target.id === 'printCloseZBtn') printShiftZ();
  if (target.id === 'purchaseSuggestButton') openPurchaseSuggestDialog();
  if (target.id === 'copyPurchaseOrderButton') copyPurchaseOrder();
  if (target.id === 'saveProfileButton') saveProfile();
  if (target.id === 'exportButton') exportBackup();
  if (target.id === 'menuButton') document.querySelector('#menuDialog').showModal();
});
const searchEl = document.querySelector('#productSearch');
if (searchEl) {
  searchEl.addEventListener('input', e => {
    state.search = e.target.value || '';
    renderOrderDialog();
  });
  searchEl.addEventListener('search', () => {
    state.search = searchEl.value || '';
    renderOrderDialog();
  });
}
document.querySelector('#orderNote').addEventListener('input', e => { const order = getOrder(state.currentOrderId); if (order) { order.note = e.target.value; saveState(); } });
document.querySelector('#amountReceived').addEventListener('input', updateTenderChange);
document.querySelector('#tenderCashReceived')?.addEventListener('input', updateTenderChange);
document.querySelector('#countedCash').addEventListener('input', checkCashDifference);
document.querySelector('#importInput').addEventListener('change', e => { if (e.target.files[0]) importBackup(e.target.files[0]); e.target.value = ''; });
document.addEventListener('input', e => { if (e.target.dataset.purchaseIndex !== undefined) updatePurchaseDraft(e.target); });
document.addEventListener('change', e => { if (e.target.dataset.purchaseIndex !== undefined) updatePurchaseDraft(e.target); });
document.querySelector('#productImage').addEventListener('change', event => { const file = event.target.files[0]; readLocalImage(file, image => { pendingProductImage = image; setImagePreview(document.querySelector('#productImagePreview'), image, '🍾'); }); });
document.querySelector('#businessImage').addEventListener('change', event => { const file = event.target.files[0]; readLocalImage(file, image => { pendingBusinessImage = image; setImagePreview(document.querySelector('#profileImagePreview'), image, document.querySelector('#businessName').value || 'N'); }); });
if ('serviceWorker' in navigator && !window.desktop) window.addEventListener('load', () => navigator.serviceWorker.register('./service-worker.js').then(reg => reg.update().catch(() => {})).catch(() => { }));
async function bootstrap() {
  let saved;
  try { saved = await storageInit(); }
  catch (error) {
    console.error(error);
    document.body.insertAdjacentHTML('afterbegin', `<div class="fatal-error"><strong>No se pudo abrir la base de datos.</strong><br>Cierra otras ventanas de la app y recarga. Tus datos no se modificaron. (${escapeHtml(String(error.message || error))})</div>`);
    return;
  }

  const isFreshLocal = !saved || (
    (!saved.payments || saved.payments.length === 0) &&
    (!saved.purchases || saved.purchases.length === 0) &&
    (!saved.expenses || saved.expenses.length === 0) &&
    (!saved.products || saved.products.length === 0 || (saved.products.length <= 12 && saved.products[0]?.id === 'p1'))
  );

  if (isDemoMode()) {
    if (!saved || !Array.isArray(saved.products) || saved.products.length !== 14 || !Array.isArray(saved.tables) || saved.tables.length !== 4) {
      saved = getInitialDemoState();
    }
  }

  state = normalizeState(saved || defaultState);
  globalThis.state = state;
  storageReady = true;

  if (isDemoMode()) {
    resetDemoData({ silent: true });
    initDemoInactivityWatcher();
  } else {
    // Restos de una sesión demo anterior: no deciden el modo, pero no deben quedar en producción
    try { localStorage.removeItem('nexobar_demo_last_activity'); sessionStorage.removeItem('nexobar_demo_tx_count'); } catch { /* sin permiso */ }
  }

  scheduleSave();
  cleanupOrphanOrders();

  // Si hay conexión y NO estamos en Modo Demo, sincronizar con Supabase (descargar turno de caja y pedidos activos)
  if (!isDemoMode() && typeof navigator !== 'undefined' && navigator.onLine && globalThis.NexoSync?.pullAllFromSupabase) {
    try {
      const pullRes = await globalThis.NexoSync.pullAllFromSupabase();
      if (pullRes && pullRes.ok && pullRes.count > 0) {
        console.log(`[NexoSync] Base local hidratada con éxito desde Supabase: ${pullRes.count} registros.`);
      }
      cleanupOrphanOrders();
    } catch (e) {
      console.warn('[NexoSync] No se pudo descargar datos iniciales de Supabase:', e);
    }
  }

  try {
    renderAll();
    initModules();
    startBackupSchedule();
    if (globalThis.NexoSync?.init) globalThis.NexoSync.init();
    setInterval(() => { if (document.visibilityState === 'visible' && !document.querySelector('dialog[open]')) renderTables(); }, 60000);
  }
  catch (error) {
    console.error(error);
    document.body.insertAdjacentHTML('afterbegin', `<div class="fatal-error"><strong>La app tuvo un error al iniciar.</strong> Tus datos están a salvo; descarga un respaldo y avísanos. (${escapeHtml(String(error.message || error))})</div>`);
  }
}
if (typeof window !== 'undefined' && typeof window.addEventListener === 'function' && !globalThis.__IS_NODE_TEST__) {
  bootstrap();
}

const BILLS=[2000,5000,10000,20000,50000,100000], COINS=[50,100,200,500,1000];
function cashCounterRow(value,kind) { return `<label class="denom-row"><span class="denom-label">${money.format(value)}</span><input type="number" min="0" step="1" inputmode="numeric" placeholder="0" data-denom="${value}" data-kind="${kind}" aria-label="Cantidad de ${kind} de ${money.format(value)}" /><b class="denom-sub" data-denom-sub="${value}">$0</b></label>`; }
function renderCashCounter() { const el=document.querySelector('#cashCounter'); if(!el)return; el.innerHTML=`<div class="denom-group"><h4>Billetes</h4>${BILLS.map(v=>cashCounterRow(v,'billetes')).join('')}</div><div class="denom-group"><h4>Monedas</h4>${COINS.map(v=>cashCounterRow(v,'monedas')).join('')}</div>`; }
function cashCounts() { const counts={}; document.querySelectorAll('#cashCounter input[data-denom]').forEach(input=>{const qty=Math.max(0,Math.floor(Number(input.value||0)));if(qty)counts[input.dataset.denom]=qty;}); return counts; }
function updateCashCounter() { let total=0; document.querySelectorAll('#cashCounter input[data-denom]').forEach(input=>{const value=Number(input.dataset.denom),qty=Math.max(0,Math.floor(Number(input.value||0))),sub=value*qty;total+=sub;document.querySelector(`[data-denom-sub="${value}"]`).textContent=money.format(sub);}); document.querySelector('#countedCash').value=total; checkCashDifference(); }
function resetCashCounter() { renderCashCounter(); }
if (!globalThis.__IS_NODE_TEST__) {
  renderCashCounter();
  document.querySelector('#cashCounter')?.addEventListener('input',updateCashCounter);
}
document.querySelector('#cashCounter').addEventListener('focusin',e=>{if(e.target.matches('input'))e.target.select();});

/* Reportes por período */
function parseISO(s) { const [y,m,d]=s.split('-').map(Number); return new Date(y,m-1,d); }
function reportBounds() { const end=today(); if(reportRange==='date'&&reportDate)return {from:reportDate,to:reportDate}; if(reportRange==='today'||reportRange==='date')return {from:end,to:end}; const start=parseISO(end); start.setDate(start.getDate()-(Number(reportRange)-1)); return {from:localISO(start),to:end}; }
function reportPayments() { const {from,to}=reportBounds(); return state.payments.filter(p=>p.date>=from&&p.date<=to); }
function shortDate(s,withYear=false) { return parseISO(s).toLocaleDateString('es-CO',{day:'numeric',month:'short',...(withYear?{year:'numeric'}:{})}).replace('.',''); }
function renderReportPeriod() {
  const {from,to}=reportBounds(), single=from===to;
  document.querySelectorAll('[data-report-range]').forEach(b=>b.classList.toggle('active',b.dataset.reportRange===reportRange));
  document.querySelector('#reportDate').classList.toggle('active',reportRange==='date');
  const heading=reportRange==='today'?'Resumen de hoy':reportRange==='date'?`Resumen del ${shortDate(from,true)}`:`Resumen · últimos ${reportRange} días`;
  document.querySelector('#reportHeading').textContent=heading;
  document.querySelector('#reportSubheading').textContent=single?'Datos generados desde este dispositivo.':`Del ${shortDate(from)} al ${shortDate(to,true)} · datos generados desde este dispositivo.`;
  document.querySelector('#opsTitle').textContent=reportRange==='today'?'Compras y gastos de hoy':single?'Compras y gastos del día':'Compras y gastos del período';
  const card=document.querySelector('#dailyChartCard'); card.hidden=single; if(single)return;
  const totals={}; for(let d=parseISO(from);localISO(d)<=to;d.setDate(d.getDate()+1))totals[localISO(d)]=0;
  state.payments.forEach(p=>{if(p.date in totals)totals[p.date]+=p.amount;});
  const days=Object.entries(totals), max=Math.max(1,...days.map(([,v])=>v)), sum=days.reduce((s,[,v])=>s+v,0), best=days.reduce((a,b)=>b[1]>a[1]?b:a,days[0]), compact=new Intl.NumberFormat('es-CO',{notation:'compact',maximumFractionDigits:1});
  document.querySelector('#dailyChart').innerHTML=days.map(([date,value])=>{const d=parseISO(date), label=days.length<=7?d.toLocaleDateString('es-CO',{weekday:'short'}).replace('.','')+' '+d.getDate():d.getDate();return `<div class="day-col" title="${shortDate(date)}: ${money.format(value)}"><span class="day-val">${days.length<=15&&value?compact.format(value):''}</span><div class="day-bar"><i style="height:${value?Math.max(3,value/max*100):0}%"></i></div><span class="day-label">${label}</span></div>`;}).join('');
  document.querySelector('#dailySummary').innerHTML=`<div class="report-row"><span>Ventas del período</span><b>${money.format(sum)}</b></div><div class="report-row"><span>Promedio diario</span><b>${money.format(sum/days.length)}</b></div><div class="report-row"><span>Mejor día</span><b>${sum?`${shortDate(best[0])} · ${money.format(best[1])}`:'—'}</b></div>`;
}
globalThis.renderReportPeriod = renderReportPeriod;
globalThis.shortDate = shortDate;
globalThis.reportBounds = reportBounds;
globalThis.reportPayments = reportPayments;
globalThis.parseISO = parseISO;
document.addEventListener('click',e=>{const b=e.target.closest('[data-report-range]');if(!b)return;reportRange=b.dataset.reportRange;renderReports();});
(function(){const input=document.querySelector('#reportDate');input.max=today();input.addEventListener('change',()=>{if(!input.value)return;reportDate=input.value;reportRange='date';renderReports();});})();


// ===== Menú móvil (hamburguesa) =====
(function setupMobileMenu() {
  const btnOpen    = document.querySelector('#btn-mobile-menu');
  const btnClose   = document.querySelector('#btn-close-drawer');
  const overlay    = document.querySelector('#mobileMenuOverlay');
  const drawer     = document.querySelector('#mobileDrawer');
  if (!btnOpen || !drawer || !overlay) return;

  function openDrawer() {
    if (drawer?.classList) drawer.classList.add('open');
    if (overlay?.classList) overlay.classList.add('open');
    if (drawer?.removeAttribute) drawer.removeAttribute('aria-hidden');
    if (overlay?.removeAttribute) overlay.removeAttribute('aria-hidden');
  }
  function closeDrawer() {
    if (drawer?.classList) drawer.classList.remove('open');
    if (overlay?.classList) overlay.classList.remove('open');
    if (drawer?.setAttribute) drawer.setAttribute('aria-hidden', 'true');
    if (overlay?.setAttribute) overlay.setAttribute('aria-hidden', 'true');
  }

  if (btnOpen?.addEventListener) btnOpen.addEventListener('click', openDrawer);
  if (btnClose?.addEventListener) btnClose.addEventListener('click', closeDrawer);
  if (overlay?.addEventListener) overlay.addEventListener('click', closeDrawer);

  // Auto-cierre al hacer clic en cualquier nav-link del drawer
  if (typeof drawer.querySelectorAll === 'function') {
    drawer.querySelectorAll('.nav-link').forEach(function(link) {
      if (link?.addEventListener) link.addEventListener('click', closeDrawer);
    });
  }

  // Sincronizar estado del turno de caja en el botón del drawer
  function syncMobileShiftBtn() {
    const btn = document.querySelector('#mobileShiftBtn');
    if (!btn) return;
    const isOpen = state.cashShift && state.cashShift.status === 'open';
    btn.textContent = isOpen ? 'Caja abierta — Cerrar turno' : 'Caja cerrada — Abrir turno';
    if (btn.classList) {
      if (isOpen) btn.classList.remove('closed');
      else btn.classList.add('closed');
    }
  }
  globalThis.syncMobileShiftBtn = syncMobileShiftBtn;

  const mobileShiftBtn = document.querySelector('#mobileShiftBtn');
  if (mobileShiftBtn?.addEventListener) {
    mobileShiftBtn.addEventListener('click', function() {
      closeDrawer();
      const shiftBtn = document.querySelector('#shiftButton') || document.querySelector('#shiftStatusButton');
      if (shiftBtn?.click) shiftBtn.click();
    });
  }

  // Actualizar nombre del negocio en el drawer
  const brandLabel = document.querySelector('#mobileDrawerBrand');
  if (brandLabel) {
    const mainBrand = document.querySelector('#brandLabel');
    if (mainBrand && mainBrand.textContent) brandLabel.textContent = mainBrand.textContent;
  }
})();

// ===== Modal de comanda: pestañas móviles + barra flotante =====
(function setupOrderModalMobile() {
  function updateMobileOrderBar() {
    const order = getOrder(state.currentOrderId);
    const count = order ? order.items.reduce(function(s, i) { return s + (i.qty || 1); }, 0) : 0;
    const total = order ? orderTotal(order) : 0;

    const countEl = document.querySelector('#mobileOrderCount');
    const barCount = document.querySelector('#mobileBarCount');
    const barTotal = document.querySelector('#mobileBarTotal');
    const barTicketBtn = document.querySelector('#mobileBarTicketBtn');
    const barChargeBtn = document.querySelector('#mobileBarChargeBtn');

    if (countEl) countEl.textContent = count;
    if (barCount) barCount.textContent = count + (count === 1 ? ' producto' : ' productos');
    if (barTotal) barTotal.textContent = money.format(total);
    if (barTicketBtn) barTicketBtn.disabled = (count === 0);
    if (barChargeBtn) barChargeBtn.disabled = (count === 0);
  }
  globalThis.updateMobileOrderBar = updateMobileOrderBar;

  function switchToTab(tab) {
    const catalogPanel = document.querySelector('.catalog-panel');
    const ticketPanel  = document.querySelector('.ticket-panel');
    const barEl        = document.querySelector('#mobileOrderBar');
    const tabProducts  = document.querySelector('#orderTabProducts');
    const tabTicket    = document.querySelector('#orderTabTicket');
    if (!catalogPanel || !ticketPanel) return;

    if (tab === 'ticket') {
      if (catalogPanel.classList) catalogPanel.classList.add('tab-hidden');
      if (ticketPanel.classList) ticketPanel.classList.add('tab-visible');
      if (barEl?.classList) barEl.classList.add('tab-hidden');
      if (tabProducts?.classList) tabProducts.classList.remove('active');
      if (tabTicket?.classList) tabTicket.classList.add('active');
    } else {
      if (catalogPanel.classList) catalogPanel.classList.remove('tab-hidden');
      if (ticketPanel.classList) ticketPanel.classList.remove('tab-visible');
      if (barEl?.classList) barEl.classList.remove('tab-hidden');
      if (tabProducts?.classList) tabProducts.classList.add('active');
      if (tabTicket?.classList) tabTicket.classList.remove('active');
    }
    updateMobileOrderBar();
  }
  globalThis.switchOrderTab = switchToTab;

  document.addEventListener('click', function(e) {
    // Tab switch via botones de pestaña
    const tabBtn = e.target.closest('[data-tab]');
    if (tabBtn && tabBtn.closest('#orderTabsMobile')) {
      switchToTab(tabBtn.dataset.tab);
      return;
    }
    // Botón "Ver comanda" o resumen en la barra flotante
    if (e.target.closest('#mobileBarTicketBtn') || e.target.closest('#mobileBarInfo')) {
      switchToTab('ticket');
      return;
    }
    // Botón "Cobrar" en la barra flotante
    if (e.target.closest('#mobileBarChargeBtn')) {
      if (typeof openPayment === 'function') openPayment();
      return;
    }
  });

  // Al abrir el diálogo, resetear siempre a tab Productos
  const orderDlg = document.querySelector('#orderDialog');
  if (orderDlg && typeof orderDlg.addEventListener === 'function') {
    orderDlg.addEventListener('close', function() {
      switchToTab('products');
    });
  }

  // Parchar renderOrderDialog para actualizar la barra flotante cada vez que se llama
  const _origRender = globalThis.renderOrderDialog;
  if (typeof _origRender === 'function') {
    globalThis.renderOrderDialog = function() {
      _origRender();
      updateMobileOrderBar();
    };
  }
})();
