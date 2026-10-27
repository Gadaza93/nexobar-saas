/* Brasa POS · módulos adicionales
   Roles y PIN, auditoría, facturas editables, proveedores y costo promedio,
   mermas y conteo físico, reportes analíticos y exportación a Excel/PDF.
   Se carga ANTES de app.js: aquí solo hay declaraciones; el arranque ocurre en DOMContentLoaded. */

/* ============ Roles, permisos y PIN ============ */
const ROLE_LABELS = { admin: 'Administrador', cajero: 'Cajero', mesero: 'Mesero' };
// Edita esta tabla para ajustar lo que puede hacer cada rol. '*' = todo.
const ROLE_PERMS = {
  admin: '*',
  cajero: ['view.pos', 'view.invoices', 'view.inventory', 'view.purchases', 'order', 'charge', 'cancelOrder', 'shift', 'purchases', 'inventory', 'merma'],
  mesero: ['view.pos', 'order'],
};
const PIN_LENGTH = 4;
let session = null; // id del usuario con sesión iniciada
let loginTarget = null, loginPin = '', loginFails = 0, loginLockUntil = 0;
let editingUserId = null, forcedPinChange = false;

function me() { return session ? state.users.find(u => u.id === session && u.active !== false) || null : null; }
function can(perm) {
  const isDemo = typeof isDemoMode === 'function' ? isDemoMode() : !!globalThis.isDemoMode?.();
  if (isDemo) return true;
  const user = me();
  if (!user) return false;
  const perms = ROLE_PERMS[user.role];
  return perms === '*' || (Array.isArray(perms) && perms.includes(perm));
}
function actor() { const user = me(); return { userId: user?.id || null, userName: user?.name || '' }; }
globalThis.me = me;
globalThis.can = can;
globalThis.actor = actor;
function deny() { showToast('Tu rol no tiene permiso para esta acción.'); }
function guard(name, perm) { const original = globalThis[name]; if (typeof original !== 'function') return; globalThis[name] = function (...args) { if (!can(perm)) { deny(); return; } return original.apply(this, args); }; }
function initials(name) { return String(name || '?').trim().split(/\s+/).slice(0, 2).map(w => w[0]).join('').toUpperCase() || '?'; }
function fmtDateTime(ts) { return new Date(ts).toLocaleString('es-CO', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }); }

function cyrb53(str, seed = 0) { let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed; for (let i = 0, ch; i < str.length; i++) { ch = str.charCodeAt(i); h1 = Math.imul(h1 ^ ch, 2654435761); h2 = Math.imul(h2 ^ ch, 1597334677); } h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909); h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909); return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36); }
function hashPin(pin, salt) { return cyrb53(`${salt}:${pin}`); }
function uid(prefix = 'id') { return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`; }
globalThis.uid = globalThis.uid || uid;
function newUser(name, role, pin) { const salt = Math.random().toString(36).slice(2, 10); return { id: uid('usr'), name, role, salt, pinHash: hashPin(pin, salt), active: true, createdAt: Date.now() }; }
function setUserPin(user, pin) { user.salt = Math.random().toString(36).slice(2, 10); user.pinHash = hashPin(pin, user.salt); }
globalThis.cyrb53 = cyrb53;
globalThis.hashPin = hashPin;
globalThis.setUserPin = setUserPin;

/* Completa los datos nuevos al cargar o restaurar un respaldo (se llama desde normalizeState). */
function ensureExtras(s) {
  // Se clonan para no compartir referencias con defaultState ni con el respaldo importado.
  ['users', 'suppliers', 'stockLog', 'auditLog', 'backupLog'].forEach(key => { s[key] = Array.isArray(s[key]) ? structuredClone(s[key]) : []; });
  s.backupSettings = { ...BACKUP_DEFAULTS, ...(s.backupSettings || {}) };
  s.invoiceCounter = Number(s.invoiceCounter || 0);
  if (typeof isDemoMode === 'function' && isDemoMode()) {
    s.users = [
      {
        id: 'u_demo_guest',
        name: 'Invitado Demo',
        role: 'admin',
        active: true,
        mustChangePin: false,
        salt: 'demo_salt',
        pinHash: hashPin('1234', 'demo_salt'),
        createdAt: Date.now()
      }
    ];
  } else if (!s.users.length) {
    const existingPin = s.profile?.admin_pin || s.profile?.adminPin;
    const admin = newUser('Administrador', 'admin', existingPin || '1234');
    admin.mustChangePin = !existingPin;
    s.users.push(admin);
  }
  (s.purchases || []).forEach(purchase => {
    if (purchase.supplierId || !purchase.supplier) return;
    let supplier = s.suppliers.find(item => item.name.toLowerCase() === String(purchase.supplier).toLowerCase());
    if (!supplier) { supplier = { id: uid('sup'), name: purchase.supplier, nit: '', phone: '', notes: '' }; s.suppliers.push(supplier); }
    purchase.supplierId = supplier.id;
  });
  const numberOf = p => parseInt(String(p.invoiceNo || '').replace(/\D/g, ''), 10);
  let counter = Math.max(s.invoiceCounter, ...(s.payments || []).map(p => numberOf(p)).filter(Number.isFinite), 0);
  [...(s.payments || [])].filter(p => !p.invoiceNo).sort((a, b) => paymentTimestamp(a) - paymentTimestamp(b)).forEach(p => { counter++; p.invoiceNo = `FAC-${String(counter).padStart(5, '0')}`; });
  s.invoiceCounter = counter;
}
globalThis.ensureExtras = ensureExtras;
function nextInvoiceNo() { state.invoiceCounter = Number(state.invoiceCounter || 0) + 1; return `FAC-${String(state.invoiceCounter).padStart(5, '0')}`; }
function afterStateReplaced() { if (!me()) showLogin(); }

function logAudit(action, detail = '', extra = {}) {
  state.auditLog.push({ id: uid('aud'), at: Date.now(), userId: me()?.id || null, userName: me()?.name || 'Sistema', action, detail, ...extra });
  if (state.auditLog.length > 1000) state.auditLog.splice(0, state.auditLog.length - 1000);
}

function requireOpenShift() {
  const isOpen = (typeof isShiftOpen === 'function' ? isShiftOpen() : (globalThis.isShiftOpen ? globalThis.isShiftOpen() : (globalThis.state?.cashShift?.status === 'open')));
  if (isOpen) return true;
  if (typeof can === 'function' && can('shift')) {
    document.querySelector('#openShiftDialog')?.showModal?.();
    if (typeof showToast === 'function') showToast('Debes abrir un turno de caja antes de registrar movimientos.');
  } else {
    if (typeof showToast === 'function') showToast('La caja está cerrada. Pide al cajero o al administrador que abra el turno.');
  }
  return false;
}
globalThis.requireOpenShift = requireOpenShift;

function showView(id) {
  document.querySelectorAll('.view').forEach(v => v.classList.toggle('active-view', v.id === id));
  document.querySelectorAll('.nav-link').forEach(b => b.classList.toggle('active', b.dataset.view === id));
  const button = document.querySelector(`.nav-link[data-view="${id}"]`);
  document.querySelector('#pageTitle').textContent = button ? button.textContent.replace(/\d+/g, '').trim() : '';
}
function applyPermissions() {
  document.querySelectorAll('[data-perm]').forEach(el => { el.hidden = !can(el.dataset.perm); });
  const active = document.querySelector('.view.active-view'), nav = active && document.querySelector(`.nav-link[data-view="${active.id}"]`);
  if (me() && nav && nav.hidden) showView('pos');
}
function renderUserChip() { const user = me(), chip = document.querySelector('#userChip'); chip.hidden = !user; chip.textContent = user ? initials(user.name) : '?'; chip.title = user ? `${user.name} · ${ROLE_LABELS[user.role]}` : ''; }

/* ---------- Inicio de sesión con PIN ---------- */
function renderLogin() {
  document.querySelector('#loginTitle').textContent = 'NexoBar';
  const active = state.users.filter(u => u.active !== false), target = state.users.find(u => u.id === loginTarget);
  document.querySelector('#loginUsers').hidden = !!target; document.querySelector('#loginPinBox').hidden = !target;
  document.querySelector('#loginUsers').innerHTML = active.map(u => `<button class="login-user" data-login-user="${u.id}"><span class="mini-avatar">${escapeHtml(initials(u.name))}</span><strong>${escapeHtml(u.name)}</strong><small>${ROLE_LABELS[u.role] || u.role}</small></button>`).join('');
  document.querySelector('#loginWho').textContent = target ? target.name : '';
  document.querySelectorAll('#pinDots i').forEach((dot, index) => dot.classList.toggle('filled', index < loginPin.length));
  const firstRun = state.users.find(u => u.mustChangePin && u.role === 'admin');
  document.querySelector('#loginHint').textContent = firstRun ? `Primer ingreso: usuario «${firstRun.name}», PIN 1234. Se te pedirá cambiarlo.` : '';
}
function setLoginError(message) { document.querySelector('#loginError').textContent = message || ''; }
function showLogin() {
  session = null; sessionStorage.removeItem('brasa-session'); loginTarget = null; loginPin = ''; setLoginError('');
  document.querySelectorAll('dialog[open]').forEach(d => { if (d.id !== 'loginDialog') d.close(); });
  renderLogin(); const dialog = document.querySelector('#loginDialog'); if (!dialog.open) dialog.showModal(); applyPermissions(); renderUserChip();
  if (typeof enforceSubscription === 'function') enforceSubscription(); // la suscripción suspendida queda por encima del login
}
function pressPin(key) {
  if (!loginTarget) return;
  if (Date.now() < loginLockUntil) return setLoginError(`Demasiados intentos. Espera ${Math.ceil((loginLockUntil - Date.now()) / 1000)} s.`);
  if (key === 'back') loginPin = loginPin.slice(0, -1); else if (/^\d$/.test(key) && loginPin.length < PIN_LENGTH) loginPin += key;
  setLoginError(''); renderLogin(); if (loginPin.length === PIN_LENGTH) attemptLogin();
}
function attemptLogin() {
  const user = state.users.find(u => u.id === loginTarget);
  if (user && user.active !== false && hashPin(loginPin, user.salt) === user.pinHash) { loginFails = 0; return completeLogin(user); }
  loginFails++; loginPin = '';
  if (loginFails >= 5) { loginLockUntil = Date.now() + 30000; loginFails = 0; setLoginError('Demasiados intentos. Espera 30 segundos.'); } else setLoginError('PIN incorrecto.');
  renderLogin();
}
function completeLogin(user) {
  session = user.id; sessionStorage.setItem('brasa-session', user.id); user.lastLogin = Date.now(); saveState();
  loginTarget = null; loginPin = ''; document.querySelector('#loginDialog').close();
  applyPermissions(); renderAll(); showView('pos'); showToast(`Hola, ${user.name}.`);
  if (user.mustChangePin) openPinDialog(true);
}
function openSessionDialog() { const user = me(); if (!user) return; document.querySelector('#sessionName').textContent = user.name; document.querySelector('#sessionRole').textContent = ROLE_LABELS[user.role]; document.querySelector('#sessionDialog').showModal(); }
function openPinDialog(forced = false) { forcedPinChange = forced; document.querySelector('#newPin').value = ''; document.querySelector('#confirmPin').value = ''; document.querySelector('#pinDialogClose').hidden = forced; document.querySelector('#pinForcedNote').hidden = !forced; document.querySelector('#sessionDialog').close(); document.querySelector('#pinDialog').showModal(); }
function savePin() {
  const user = me(); if (!user) return;
  const pin = document.querySelector('#newPin').value.trim(), confirm = document.querySelector('#confirmPin').value.trim();
  if (!/^\d{4}$/.test(pin)) return showToast('El PIN debe tener exactamente 4 números.');
  if (pin !== confirm) return showToast('Los dos PIN no coinciden.');
  if (hashPin(pin, user.salt) === user.pinHash) return showToast('Elige un PIN diferente al actual.');
  setUserPin(user, pin); user.mustChangePin = false; logAudit('PIN cambiado', user.name); saveState();
  forcedPinChange = false; document.querySelector('#pinDialog').close(); renderAll(); showToast('PIN actualizado.');
  if (user.role === 'admin' && globalThis.NexoSync?.syncAdminPin) {
    globalThis.NexoSync.syncAdminPin(pin, user).catch(err => console.warn('[NexoSync] Error syncAdminPin:', err));
  }
}

/* ---------- Equipo y bitácora ---------- */
function renderTeam() {
  if (!can('view.team')) return;
  document.querySelector('#teamTable').innerHTML = state.users.map(u => `<tr><td><strong>${escapeHtml(u.name)}</strong></td><td>${ROLE_LABELS[u.role] || u.role}</td><td><span class="status ${u.active === false ? 'low' : 'good'}">${u.active === false ? 'Inactivo' : 'Activo'}</span></td><td>${u.lastLogin ? fmtDateTime(u.lastLogin) : '—'}</td><td><button class="mini-action" data-edit-user="${u.id}">Editar</button></td></tr>`).join('');
  const rows = [...state.auditLog].reverse().slice(0, 40);
  document.querySelector('#auditTable').innerHTML = rows.map(e => `<tr><td>${fmtDateTime(e.at)}</td><td>${escapeHtml(e.userName || '')}</td><td><strong>${escapeHtml(e.action)}</strong></td><td>${escapeHtml(e.detail || '')}</td><td>${escapeHtml(e.reason || '')}</td></tr>`).join('') || '<tr><td colspan="5" class="muted">Aún no hay movimientos auditados.</td></tr>';
}
function openUserDialog(id = null) {
  if (!can('team')) return deny();
  editingUserId = id; const user = id && state.users.find(u => u.id === id);
  document.querySelector('#userDialogTitle').textContent = user ? 'Editar usuario' : 'Nuevo usuario';
  document.querySelector('#userName').value = user?.name || ''; document.querySelector('#userRole').value = user?.role || 'mesero';
  document.querySelector('#userPin').value = ''; document.querySelector('#userActive').checked = user ? user.active !== false : true;
  document.querySelector('#userPinLabel').textContent = user ? 'Nuevo PIN de 4 dígitos (vacío = no cambiar)' : 'PIN de 4 dígitos';
  document.querySelector('#userDialog').showModal();
}
function saveUser() {
  if (!can('team')) return deny();
  const name = document.querySelector('#userName').value.trim(), role = document.querySelector('#userRole').value, pin = document.querySelector('#userPin').value.trim(), active = document.querySelector('#userActive').checked;
  const user = editingUserId && state.users.find(u => u.id === editingUserId);
  if (!name) return showToast('Escribe el nombre del usuario.');
  if ((!user && !/^\d{4}$/.test(pin)) || (user && pin && !/^\d{4}$/.test(pin))) return showToast('El PIN debe tener exactamente 4 números.');
  if (state.users.some(u => u.id !== editingUserId && u.name.toLowerCase() === name.toLowerCase())) return showToast('Ya existe un usuario con ese nombre.');
  const otherAdmins = state.users.filter(u => u.id !== editingUserId && u.role === 'admin' && u.active !== false).length;
  if (!otherAdmins && !(role === 'admin' && active)) return showToast('Debe existir al menos un administrador activo.');
  if (user) {
    const changes = [];
    if (user.name !== name) changes.push(`nombre «${user.name}» → «${name}»`); if (user.role !== role) changes.push(`rol ${ROLE_LABELS[user.role]} → ${ROLE_LABELS[role]}`); if ((user.active !== false) !== active) changes.push(active ? 'reactivado' : 'desactivado'); if (pin) changes.push('PIN restablecido');
    Object.assign(user, { name, role, active });
    if (pin) {
      setUserPin(user, pin);
      user.mustChangePin = user.id !== me()?.id;
      if (user.role === 'admin' && globalThis.NexoSync?.syncAdminPin) {
        globalThis.NexoSync.syncAdminPin(pin, user).catch(err => console.warn('[NexoSync] Error syncAdminPin:', err));
      }
    }
    logAudit('Usuario editado', `${name}${changes.length ? ': ' + changes.join(', ') : ''}`);
  } else {
    const created = newUser(name, role, pin);
    created.mustChangePin = true;
    state.users.push(created);
    if (created.role === 'admin' && globalThis.NexoSync?.syncAdminPin) {
      globalThis.NexoSync.syncAdminPin(pin, created).catch(err => console.warn('[NexoSync] Error syncAdminPin:', err));
    }
    logAudit('Usuario creado', `${name} · ${ROLE_LABELS[role]}`);
  }
  saveState(); document.querySelector('#userDialog').close(); renderAll(); if (!me()) showLogin(); showToast('Usuario guardado.');
}

/* ============ Facturas: ver, corregir y eliminar ============ */
const invoiceFilter = { date: '', method: '', q: '' }; // date: '' = hoy · 'all' = todas · 'AAAA-MM-DD'
let invoiceDraft = null, invoiceToDelete = null;

function invoiceCardMarkup(payment, { actions = false } = {}) {
  const who = [payment.waiterName && `Mesero: ${escapeHtml(payment.waiterName)}`, payment.cashierName && `Cajero: ${escapeHtml(payment.cashierName)}`].filter(Boolean).join(' · ');
  const edited = payment.editedAt ? `<span class="badge-edited" title="${escapeHtml((payment.edits || []).slice(-1)[0]?.reason || '')}">Editada · ${fmtDateTime(payment.editedAt)}</span>` : '';
  // Reimprimir: cualquiera que vea las facturas; editar/eliminar: solo con permiso invoiceEdit
  const editButtons = can('invoiceEdit') ? `<button class="mini-action" data-edit-invoice="${payment.id}">Editar</button><button class="mini-action delete-action" data-delete-invoice="${payment.id}">Eliminar</button>` : '';
  const buttons = actions ? `<div class="invoice-actions"><button class="mini-action" data-print-invoice="${payment.id}" title="Reimprimir ticket">🖨 Imprimir</button>${editButtons}</div>` : '';
  return `<article class="invoice-card"><div class="invoice-head"><div><strong>${escapeHtml(payment.invoiceNo || 'FAC')} · ${escapeHtml(payment.customer || 'Venta mostrador')}</strong><span>${new Date(paymentTimestamp(payment)).toLocaleString('es-CO')} · ${escapeHtml(payment.method)}${who ? ' · ' + who : ''}</span>${edited}</div><b>${money.format(payment.amount)}</b></div>${invoiceItemsMarkup(payment)}${buttons}</article>`;
}
function renderRecentInvoices() {
  const invoices = [...state.payments].sort((a, b) => paymentTimestamp(b) - paymentTimestamp(a)).slice(0, 5);
  document.querySelector('#recentInvoices').innerHTML = invoices.length ? invoices.map(p => invoiceCardMarkup(p, { actions: true })).join('') : '<p class="muted">Aún no hay facturas cobradas.</p>';
}
function filteredInvoices() {
  const f = invoiceFilter, day = f.date === 'all' ? null : (f.date || today()), q = f.q.trim().toLowerCase();
  return [...state.payments].filter(p => (!day || p.date === day) && (!f.method || p.method === f.method || (Array.isArray(p.payments) && p.payments.some(t => t.method === f.method))) && (!q || [p.invoiceNo, p.customer, p.waiterName, p.cashierName, ...(p.items || []).map(i => i.name)].join(' ').toLowerCase().includes(q))).sort((a, b) => paymentTimestamp(b) - paymentTimestamp(a));
}
function renderInvoices() {
  if (!can('view.invoices')) return;
  const list = filteredInvoices(), total = list.reduce((s, p) => s + p.amount, 0), edited = list.filter(p => p.editedAt).length;
  document.querySelector('#invoiceDate').value = invoiceFilter.date === 'all' ? '' : (invoiceFilter.date || today());
  document.querySelector('#invoiceSummary').innerHTML = `<div class="summary-item"><span>Facturas</span><strong>${list.length}</strong></div><div class="summary-item"><span>Total</span><strong>${money.format(total)}</strong></div><div class="summary-item ${edited ? 'warning' : ''}"><span>Editadas</span><strong>${edited}</strong></div>`;
  document.querySelector('#invoiceList').innerHTML = (list.slice(0, 100).map(p => invoiceCardMarkup(p, { actions: true })).join('') || '<p class="muted">No hay facturas con esos filtros.</p>') + (list.length > 100 ? `<p class="muted history-more">Mostrando las 100 más recientes de ${list.length}. Afina la búsqueda para ver otras.</p>` : '');
}

/* Ajusta el inventario cuando cambia lo vendido: soldDelta > 0 descuenta, < 0 devuelve. */
function adjustSoldStock(item, soldDelta) {
  if (!soldDelta) return;
  const nowIso = new Date().toISOString();
  const apply = (supply, amount) => { supply.qty = Math.max(0, Number((supply.qty - amount).toFixed(2))); };
  const prod = state.products.find(p => p.id === (item.productId || item.id) || (item.inventoryId && p.inventoryId === item.inventoryId));
  const invId = item.inventoryId || prod?.inventoryId || (prod ? `stock-${prod.id}` : null);
  const supply = invId ? state.inventory.find(i => i.id === invId) : null;

  if (prod) {
    const prevStock = Number(prod.stock != null ? prod.stock : (supply?.qty ?? 0));
    prod.stock = Math.max(0, Number((prevStock - soldDelta).toFixed(2)));
    prod.updated_at = nowIso;
    prod.sync_status = 'pending';
  }
  if (supply) {
    supply.qty = prod ? prod.stock : Math.max(0, Number((supply.qty - soldDelta).toFixed(2)));
  }

  // Receta con insumos secundarios distintos al producto (omitir si es el mismo insumo)
  Object.entries(item.recipe || {}).forEach(([id, amount]) => {
    if (id === invId || id === supply?.id || id === prod?.inventoryId || id === prod?.id) return;
    const sup = state.inventory.find(i => i.id === id);
    if (sup) {
      apply(sup, amount * soldDelta);
    }
  });
}
function draftTotal() { return (invoiceDraft?.items || []).reduce((s, i) => s + (Number(i.price) || 0) * (Number(i.qty) || 0), 0); }
function openInvoiceEdit(id) {
  if (!can('invoiceEdit')) return deny();
  const payment = state.payments.find(p => p.id === id); if (!payment) return;
  invoiceDraft = { id, customer: payment.customer || '', method: payment.method, items: structuredClone(payment.items || []), tenders: invoiceTendersOf(payment) };
  document.querySelector('#invoiceDialogNo').textContent = payment.invoiceNo || 'FACTURA';
  document.querySelector('#invoiceCustomer').value = invoiceDraft.customer;
  const standardMethods = ['Efectivo', 'Nequi', 'Daviplata', 'Tarjeta / Datáfono', 'Transferencia'];
  const allMethods = Array.from(new Set([...standardMethods, payment.method].filter(Boolean)));
  document.querySelector('#invoiceMethodEdit').innerHTML = allMethods.map(m => `<option ${payment.method === m ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('');
  document.querySelector('#invoiceAddProduct').innerHTML = state.products.map(p => `<option value="${p.id}">${escapeHtml(p.name)} · ${money.format(p.price)}</option>`).join('');
  document.querySelector('#invoiceReason').value = '';
  const warning = document.querySelector('#invoiceWarning'), closedShift = !isShiftOpen() || payment.shiftId !== state.cashShift?.id;
  warning.hidden = !closedShift; warning.textContent = closedShift ? 'Esta factura pertenece a un turno de caja que ya cerró. El cierre guardado de ese turno no se recalcula; la corrección sí queda en reportes y bitácora.' : '';
  renderInvoiceDraft(); document.querySelector('#invoiceDialog').showModal();
}
/* Desglose de pagos de una factura. La caja (cashSalesToday / otherSalesToday), el arqueo Z y el reporte de WhatsApp
   suman payment.payments: toda corrección reescribe ese desglose junto con payment.method y payment.amount. */
function invoiceTendersOf(payment) {
  const list = Array.isArray(payment.payments) && payment.payments.length ? payment.payments : [{ method: payment.method || 'Efectivo', amount: payment.amount }];
  return list.map(t => ({ method: t.method, amount: Number(t.amount) || 0, received: Number(t.received) || Number(t.amount) || 0, change: Number(t.change) || 0 }));
}
// Un solo medio: el monto sigue al total (en efectivo se conserva lo recibido si alcanza). Pago mixto: las filas editadas.
function rebuildInvoiceTenders(original, draftTenders, method, total) {
  if (draftTenders.length <= 1) {
    const prev = original[0], keepCash = method === 'Efectivo' && prev?.method === 'Efectivo' && prev.received >= total;
    return [{ method, amount: total, received: keepCash ? prev.received : total, change: keepCash ? prev.received - total : 0 }];
  }
  return draftTenders.map((t, i) => {
    const prev = original[i];
    return prev && prev.method === t.method && prev.amount === t.amount ? { ...prev } : { method: t.method, amount: t.amount, received: t.amount, change: 0 };
  });
}
function tendersMethodLabel(tenders) { return tenders.length === 1 ? tenders[0].method : tenders.map(t => t.method).join(' + '); }
function renderInvoiceTenders() {
  const box = document.querySelector('#invoiceTendersBox'); if (!box || !invoiceDraft) return;
  const mixed = invoiceDraft.tenders.length > 1, select = document.querySelector('#invoiceMethodEdit');
  box.hidden = !mixed; if (select) select.disabled = mixed;
  if (!mixed) return;
  const methods = Array.from(new Set([...(typeof PAYMENT_METHODS !== 'undefined' ? PAYMENT_METHODS : ['Efectivo']), ...invoiceDraft.tenders.map(t => t.method)].filter(Boolean)));
  document.querySelector('#invoiceTenders').innerHTML = invoiceDraft.tenders.map((t, i) => `<div class="invoice-tender-row"><select data-inv-tender="${i}" data-inv-tender-field="method" aria-label="Medio de pago">${methods.map(m => `<option ${m === t.method ? 'selected' : ''}>${escapeHtml(m)}</option>`).join('')}</select><input type="number" min="0" step="100" value="${t.amount}" data-inv-tender="${i}" data-inv-tender-field="amount" aria-label="Monto" /><button class="remove-line" data-remove-inv-tender="${i}" title="Quitar este medio">×</button></div>`).join('');
  renderInvoiceTendersStatus();
}
function renderInvoiceTendersStatus() {
  const el = document.querySelector('#invoiceTendersStatus'); if (!el || !invoiceDraft || invoiceDraft.tenders.length < 2) return;
  const sum = invoiceDraft.tenders.reduce((s, t) => s + (Number(t.amount) || 0), 0), total = draftTotal(), diff = total - sum;
  el.textContent = diff === 0 ? `El desglose cuadra con el total (${money.format(total)}).` : `El desglose suma ${money.format(sum)}: ${diff > 0 ? 'faltan' : 'sobran'} ${money.format(Math.abs(diff))} para el total de ${money.format(total)}.`;
  el.className = diff === 0 ? 'muted' : 'warn-text';
}
function renderInvoiceDraft() {
  if (!invoiceDraft) return; const original = state.payments.find(p => p.id === invoiceDraft.id), total = draftTotal(), diff = total - (original?.amount || 0);
  document.querySelector('#invoiceLines').innerHTML = invoiceDraft.items.map((item, index) => `<div class="invoice-line"><strong>${escapeHtml(item.name)}</strong><input type="number" min="0" step="1" value="${item.qty}" data-inv-line="${index}" data-inv-field="qty" aria-label="Cantidad" /><input type="number" min="0" step="100" value="${item.price}" data-inv-line="${index}" data-inv-field="price" aria-label="Precio unitario" /><b>${money.format((Number(item.price) || 0) * (Number(item.qty) || 0))}</b><button class="remove-line" data-remove-inv-line="${index}" aria-label="Quitar producto">×</button></div>`).join('');
  document.querySelector('#invoiceNewTotal').textContent = money.format(total);
  document.querySelector('#invoiceDiff').textContent = diff === 0 ? 'El total no cambia.' : `Total original ${money.format(original?.amount || 0)} · diferencia ${diff > 0 ? '+' : '−'}${money.format(Math.abs(diff))}`;
  renderInvoiceTenders();
}
function addInvoiceLine() {
  if (!invoiceDraft) return; const product = state.products.find(p => p.id === document.querySelector('#invoiceAddProduct').value); if (!product) return;
  const found = invoiceDraft.items.find(i => i.productId === product.id);
  if (found) found.qty = Number(found.qty) + 1; else invoiceDraft.items.push({ productId: product.id, name: product.name, price: product.price, cost: Number(product.cost || 0), qty: 1, inventoryId: product.inventoryId, recipe: product.recipe, category: product.category });
  renderInvoiceDraft();
}
function saveInvoiceEdit() {
  if (!can('invoiceEdit')) return deny(); if (!invoiceDraft) return;
  const payment = state.payments.find(p => p.id === invoiceDraft.id); if (!payment) return;
  const reason = document.querySelector('#invoiceReason').value.trim();
  if (reason.length < 3) return showToast('Escribe el motivo de la corrección.');
  const draftItems = invoiceDraft.items.map(i => ({ ...i, qty: Number(i.qty) || 0, price: Number(i.price) || 0 }));
  const linesKey = list => JSON.stringify(list.map(i => [i.name, Number(i.qty) || 0, Number(i.price) || 0]));
  // Parte de una cuenta dividida en partes iguales: sus líneas (abono / ajuste) cuadran con las demás partes; solo se corrige el pago o el cliente
  if (payment.splitShare && linesKey(draftItems) !== linesKey(payment.items || [])) return showToast('Esta factura es una parte de una cuenta dividida: solo se puede corregir el medio de pago o el cliente. Para cambiar productos, elimínala y vuelve a cobrar.');
  const items = payment.splitShare ? structuredClone(payment.items || []) : draftItems.filter(i => i.qty > 0);
  if (!payment.splitShare) {
    if (!items.length) return showToast('La factura necesita al menos un producto. Si todo fue un error, elimínala.');
    if (items.some(i => !Number.isInteger(i.qty) || i.price < 0)) return showToast('Las cantidades deben ser enteras y los precios no pueden ser negativos.');
  }
  const newAmount = items.reduce((s, i) => s + i.price * i.qty, 0);
  const draftTenders = invoiceDraft.tenders.map(t => ({ method: String(t.method || '').trim(), amount: Math.round(Number(t.amount) || 0) }));
  if (draftTenders.length > 1) {
    if (draftTenders.some(t => !t.method || t.amount <= 0)) return showToast('Cada medio del pago mixto necesita un monto mayor a $0.');
    const sum = draftTenders.reduce((s, t) => s + t.amount, 0);
    if (sum !== newAmount) return showToast(`El desglose del pago suma ${money.format(sum)} y la factura ${money.format(newAmount)}. Ajusta los montos.`);
  }
  const tenders = rebuildInvoiceTenders(invoiceTendersOf(payment), draftTenders, document.querySelector('#invoiceMethodEdit').value, newAmount);
  const before = { customer: payment.customer, method: payment.method, amount: payment.amount, items: structuredClone(payment.items || []), payments: structuredClone(payment.payments || []) };
  if (!payment.splitShare) {
    const oldQty = {}, newQty = {}, sample = {};
    before.items.forEach(i => { oldQty[i.productId] = (oldQty[i.productId] || 0) + i.qty; sample[i.productId] = i; });
    items.forEach(i => { newQty[i.productId] = (newQty[i.productId] || 0) + i.qty; sample[i.productId] = i; });
    new Set([...Object.keys(oldQty), ...Object.keys(newQty)]).forEach(id => adjustSoldStock(sample[id], (newQty[id] || 0) - (oldQty[id] || 0)));
  }
  payment.items = items; payment.amount = newAmount;
  payment.customer = document.querySelector('#invoiceCustomer').value.trim() || payment.customer;
  payment.payments = tenders; payment.method = tendersMethodLabel(tenders);
  payment.sync_status = 'pending'; // la corrección también se sube a Supabase (monto, productos y desglose)
  payment.editedAt = Date.now(); payment.editedBy = actor().userName; payment.edits = [...(payment.edits || []), { at: payment.editedAt, by: payment.editedBy, reason, before }];
  logAudit('Factura editada', `${payment.invoiceNo} · ${money.format(before.amount)} → ${money.format(payment.amount)}${before.method !== payment.method ? ` · ${before.method} → ${payment.method}` : ''}`, { reason, data: { before } });
  saveState(); invoiceDraft = null; document.querySelector('#invoiceDialog').close(); renderAll(); showToast(`${payment.invoiceNo} corregida.`);
}
function openInvoiceDelete(id) {
  if (!can('invoiceEdit')) return deny(); const payment = state.payments.find(p => p.id === id); if (!payment) return;
  invoiceToDelete = id;
  document.querySelector('#invoiceDeleteSummary').innerHTML = `<strong>${escapeHtml(payment.invoiceNo)} · ${escapeHtml(payment.customer || 'Venta mostrador')}</strong><span>${money.format(payment.amount)} · ${escapeHtml(payment.method)}</span>${invoiceItemsMarkup(payment)}`;
  document.querySelector('#invoiceRestoreStock').checked = true; document.querySelector('#invoiceDeleteReason').value = '';
  document.querySelector('#invoiceDeleteDialog').showModal();
}
function confirmDeleteInvoice() {
  if (!can('invoiceEdit')) return deny(); const payment = state.payments.find(p => p.id === invoiceToDelete); if (!payment) return;
  const reason = document.querySelector('#invoiceDeleteReason').value.trim(); if (reason.length < 3) return showToast('Escribe el motivo para eliminar la factura.');
  const restore = document.querySelector('#invoiceRestoreStock').checked;
  if (restore) (payment.items || []).forEach(item => adjustSoldStock(item, -item.qty));
  if (globalThis.NexoSync?.deleteSale) {
    globalThis.NexoSync.deleteSale(payment.id);
  }
  state.payments = state.payments.filter(p => p.id !== payment.id);
  logAudit('Factura eliminada', `${payment.invoiceNo} · ${payment.customer || 'Venta mostrador'} · ${money.format(payment.amount)} · ${payment.method}${restore ? ' · inventario devuelto' : ''}`, { reason, data: structuredClone(payment) });
  saveState(); invoiceToDelete = null; document.querySelector('#invoiceDeleteDialog').close(); renderAll(); showToast(`${payment.invoiceNo} eliminada.`);
}

/* ============ Proveedores y costo promedio ============ */
let editingSupplierId = null;
function defaultUnitCost(product) { return Number(product?.lastCost ?? product?.cost ?? 0); }
function upsertSupplier(name) {
  const clean = name.trim(); let supplier = state.suppliers.find(s => s.name.toLowerCase() === clean.toLowerCase());
  if (!supplier) { supplier = { id: uid('sup'), name: clean, nit: '', phone: '', notes: '' }; state.suppliers.push(supplier); }
  return supplier;
}
function supplierStats(supplier) { const list = state.purchases.filter(p => p.supplierId === supplier.id); return { count: list.length, total: list.reduce((s, p) => s + p.total, 0), last: list.map(p => p.date).sort().pop() || '' }; }
function renderSuppliers() {
  document.querySelector('#supplierOptions').innerHTML = state.suppliers.map(s => `<option value="${escapeHtml(s.name)}"></option>`).join('');
  document.querySelector('#suppliersTable').innerHTML = state.suppliers.map(s => { const st = supplierStats(s); return `<tr><td><strong>${escapeHtml(s.name)}</strong>${s.notes ? `<br><small class="muted">${escapeHtml(s.notes)}</small>` : ''}</td><td>${escapeHtml(s.nit || '—')}</td><td>${escapeHtml(s.phone || '—')}</td><td>${st.count}</td><td>${money.format(st.total)}</td><td>${st.last ? formatDate(st.last) : '—'}</td><td><div class="product-actions"><button class="mini-action" data-edit-supplier="${s.id}">Editar</button><button class="mini-action delete-action" data-delete-supplier="${s.id}">Eliminar</button></div></td></tr>`; }).join('') || '<tr><td colspan="7" class="muted">Aún no hay proveedores. Se crean solos al registrar una factura de compra.</td></tr>';
}
function openSupplierDialog(id = null) {
  if (!can('purchases')) return deny(); editingSupplierId = id; const s = id && state.suppliers.find(x => x.id === id);
  document.querySelector('#supplierDialogTitle').textContent = s ? 'Editar proveedor' : 'Nuevo proveedor';
  document.querySelector('#supplierName').value = s?.name || ''; document.querySelector('#supplierNit').value = s?.nit || ''; document.querySelector('#supplierPhone').value = s?.phone || ''; document.querySelector('#supplierNotes').value = s?.notes || '';
  document.querySelector('#supplierDialog').showModal();
}
function saveSupplier() {
  if (!can('purchases')) return deny(); const name = document.querySelector('#supplierName').value.trim(); if (!name) return showToast('Escribe el nombre del proveedor.');
  if (state.suppliers.some(s => s.id !== editingSupplierId && s.name.toLowerCase() === name.toLowerCase())) return showToast('Ya existe un proveedor con ese nombre.');
  const data = { name, nit: document.querySelector('#supplierNit').value.trim(), phone: document.querySelector('#supplierPhone').value.trim(), notes: document.querySelector('#supplierNotes').value.trim() };
  const existing = editingSupplierId && state.suppliers.find(s => s.id === editingSupplierId);
  if (existing) { Object.assign(existing, data); state.purchases.forEach(p => { if (p.supplierId === existing.id) p.supplier = name; }); } else state.suppliers.push({ id: uid('sup'), ...data });
  saveState(); document.querySelector('#supplierDialog').close(); renderAll(); showToast('Proveedor guardado.');
}
function deleteSupplier(id) {
  if (!can('purchases')) return deny(); const s = state.suppliers.find(x => x.id === id); if (!s) return;
  const st = supplierStats(s); if (st.count) return showToast(`${s.name} tiene ${st.count} facturas de compra y no se puede eliminar.`);
  if (!window.confirm(`¿Eliminar al proveedor ${s.name}?`)) return;
  state.suppliers = state.suppliers.filter(x => x.id !== id); saveState(); renderAll(); showToast('Proveedor eliminado.');
}

/* Productos: costo promedio ponderado (ya no solo el último costo). */
function renderProducts() {
  const tbody = document.querySelector('#productsTable');
  if (!state.products || state.products.length === 0) {
    tbody.innerHTML = '<tr><td colspan="8" class="muted" style="text-align:center;padding:36px 16px;font-size:14px;">No hay productos registrados. Crea uno nuevo o importa tu archivo Excel.</td></tr>';
    return;
  }
  tbody.innerHTML = state.products.map(product => {
    const stock = state.inventory.find(item => item.id === product.inventoryId), cost = Number(product.cost || 0), profit = Number(product.price || 0) - cost, margin = cost ? profit / cost * 100 : 0;
    const last = product.lastCost !== undefined && Math.round(product.lastCost) !== Math.round(cost) ? `<br><small class="muted">Última compra ${money.format(product.lastCost)}</small>` : '';
    return `<tr><td><strong>${escapeHtml(product.name)}</strong></td><td>${escapeHtml(product.category || 'Sin categoría')}</td><td>${money.format(cost)}${last}</td><td><strong>${money.format(product.price)}</strong></td><td><strong>${money.format(profit)}</strong></td><td>${cost ? `${margin.toFixed(1)}%` : '<span class="muted">—</span>'}</td><td>${stock ? `${formatQty(stock.qty)} ${stock.unit}` : '<span class="muted">Sin stock</span>'}</td><td><div class="product-actions"><button class="mini-action" data-edit-product="${product.id}">Editar</button><button class="mini-action delete-action" data-delete-product="${product.id}">Eliminar</button></div></td></tr>`;
  }).join('');
}
globalThis.renderProducts = renderProducts;
function savePurchase() {
  if (!requireOpenShift()) return;
  const supplierName = document.querySelector('#purchaseSupplier').value.trim(), invoice = document.querySelector('#purchaseInvoice').value.trim(), date = document.querySelector('#purchaseDate').value, method = document.querySelector('#purchaseMethod').value;
  if (!supplierName || !invoice || !date) return showToast('Indica proveedor, número y fecha de la factura.');
  if (purchaseDraft.some(line => !line.productId || line.qty <= 0 || line.unitCost < 0)) return showToast('Revisa cantidades y costos de la factura.');
  const supplier = upsertSupplier(supplierName);
  const lines = purchaseDraft.map(line => { const product = state.products.find(item => item.id === line.productId); return { ...line, productName: product.name, total: line.qty * line.unitCost }; });
  lines.forEach(line => {
    const product = state.products.find(item => item.id === line.productId), supply = state.inventory.find(item => item.id === product?.inventoryId);
    const stockBefore = supply ? Math.max(0, Number(supply.qty || 0)) : Math.max(0, Number(product?.stock || 0));
    const newStock = Number((stockBefore + line.qty).toFixed(2));
    if (supply) supply.qty = newStock;
    if (product) {
      product.stock = newStock;
      product.updated_at = new Date().toISOString();
      product.sync_status = 'pending';
      const costBefore = Number(product.cost || 0);
      const average = stockBefore > 0 && costBefore > 0 ? (stockBefore * costBefore + line.qty * line.unitCost) / (stockBefore + line.qty) : line.unitCost;
      line.avgCostAfter = Math.round(average * 100) / 100;
      product.cost = line.avgCostAfter;
      product.lastCost = line.unitCost;
    }
  });
  const total = lines.reduce((sum, line) => sum + line.total, 0);
  state.purchases.push({
    id: uid('buy'),
    supplier: supplier.name,
    supplierId: supplier.id,
    invoice,
    date,
    method,
    lines,
    total,
    createdAt: Date.now(),
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
    shiftId: state.cashShift.id,
    userName: actor().userName,
    sync_status: 'pending'
  });
  saveState();
  document.querySelector('#purchaseDialog').close();
  renderAll();
  showToast('Factura guardada: inventario sumado y costo promedio actualizado.');
  if (globalThis.NexoSync?.syncAll) {
    globalThis.NexoSync.syncAll().catch(() => {});
  }
}

/* ============ Mermas, conteo físico y ajustes ============ */
function supplyProduct(supplyId) {
  return state.products.find(p => p.inventoryId === supplyId || p.id === supplyId);
}
function supplyUnitCost(supplyId) {
  return Number(supplyProduct(supplyId)?.cost || 0);
}
function supplyUnitPrice(supplyId) {
  return Number(supplyProduct(supplyId)?.price || 0);
}
function logStock(entry) {
  state.stockLog.push({ id: uid('stk'), at: Date.now(), date: today(), userName: actor().userName, sync_status: 'pending', ...entry });
  if (state.stockLog.length > 2000) state.stockLog.splice(0, state.stockLog.length - 2000);
  if (globalThis.NexoSync?.scheduleSync) globalThis.NexoSync.scheduleSync();
}
const STOCK_TYPES = {
  merma: 'Merma / Ajuste',
  conteo: 'Conteo físico',
  ajuste: 'Ajuste manual'
};
function renderStockLog() {
  const rows = [...state.stockLog].reverse().slice(0, 20);
  const tbody = document.querySelector('#stockLogTable');
  if (!tbody) return;
  tbody.innerHTML = rows.map(e => {
    const costVal = e.value != null ? Math.abs(e.value) : (e.cost ? Math.abs(e.delta * e.cost) : 0);
    const saleVal = e.saleValue != null ? Math.abs(e.saleValue) : (e.price ? Math.abs(e.delta * e.price) : 0);
    const reasonText = e.reasonCategory || e.reason || STOCK_TYPES[e.type] || e.type;
    return `
      <tr>
        <td>${fmtDateTime(e.at)}</td>
        <td><span class="status ${e.delta < 0 ? 'status-out' : 'status-good'}">${escapeHtml(reasonText)}</span></td>
        <td><strong>${escapeHtml(e.itemName)}</strong></td>
        <td><b>${e.delta > 0 ? '+' : ''}${formatQty(e.delta)}</b> ${escapeHtml(e.unit || '')}</td>
        <td>${costVal > 0 ? money.format(costVal) : '—'}</td>
        <td>${saleVal > 0 ? money.format(saleVal) : '—'}</td>
        <td><small class="muted">${escapeHtml(e.note || e.reason || '—')}</small></td>
        <td>${escapeHtml(e.userName || '')}</td>
      </tr>
    `;
  }).join('') || '<tr><td colspan="8" class="muted">Aún no hay ajustes, mermas ni conteos registrados.</td></tr>';
}

globalThis.renderRecentInvoices = renderRecentInvoices;
globalThis.renderInvoices = renderInvoices;
globalThis.applyPermissions = applyPermissions;
globalThis.renderUserChip = renderUserChip;
globalThis.renderTeam = renderTeam;
globalThis.renderSuppliers = renderSuppliers;
globalThis.renderStockLog = renderStockLog;
globalThis.renderReports = renderReports;
globalThis.printReport = printReport;
globalThis.reportSheets = reportSheets;
globalThis.exportReportXlsx = exportReportXlsx;
function saveInventory() {
  if (!requireOpenShift()) return;
  const item = state.inventory.find(i => i.id === document.querySelector('#inventorySelect').value), delta = Number(document.querySelector('#inventoryAmount').value), reason = document.querySelector('#inventoryReason').value.trim();
  if (!item || !delta) return showToast('Indica una cantidad válida.');
  const before = item.qty; item.qty = Math.max(0, Number((item.qty + delta).toFixed(2))); const real = Number((item.qty - before).toFixed(2));
  const p = supplyProduct(item.id);
  if (p) {
    p.stock = item.qty;
    p.updated_at = new Date().toISOString();
    p.sync_status = 'pending';
  }
  const cost = supplyUnitCost(item.id), price = supplyUnitPrice(item.id);
  logStock({ type: 'ajuste', reasonCategory: reason || 'Ajuste manual', itemId: item.id, itemName: item.name, unit: item.unit, delta: real, cost, price, value: real * cost, saleValue: real * price, reason: reason || 'Ajuste manual' });
  saveState(); document.querySelector('#inventoryDialog').close(); renderAll(); showToast('Inventario actualizado.');
}
function openWasteDialog() {
  if (!can('merma')) return deny();
  document.querySelector('#wasteItem').innerHTML = state.inventory.map(i => {
    const p = supplyProduct(i.id);
    return `<option value="${i.id}">${escapeHtml(i.name)} (Stock: ${formatQty(i.qty)} ${escapeHtml(i.unit)} · Costo: ${money.format(p?.cost || 0)})</option>`;
  }).join('');
  document.querySelector('#wasteQty').value = '';
  document.querySelector('#wasteNote').value = '';
  document.querySelector('#wasteReason').value = 'Rotura / Merma';
  updateWasteValue();
  document.querySelector('#wasteDialog').showModal();
}
function updateWasteValue() {
  const item = state.inventory.find(i => i.id === document.querySelector('#wasteItem')?.value);
  const qty = Number(document.querySelector('#wasteQty')?.value || 0);
  const el = document.querySelector('#wasteValue');
  if (!el) return;
  if (!item || !(qty > 0)) {
    el.textContent = 'Indica la cantidad a descontar para ver la valoración contable ($0 en ventas/caja).';
    return;
  }
  const cost = supplyUnitCost(item.id);
  const price = supplyUnitPrice(item.id);
  el.innerHTML = `<strong>Valoración contable:</strong> Pérdida al costo: <b>${money.format(qty * cost)}</b> · Precio venta: <b>${money.format(qty * price)}</b> <br><small class="muted">($0 de impacto financiero en caja y ventas)</small>`;
}
function saveWaste() {
  if (!can('merma')) return deny();
  const item = state.inventory.find(i => i.id === document.querySelector('#wasteItem')?.value);
  const qty = Number(document.querySelector('#wasteQty')?.value);
  const reason = document.querySelector('#wasteReason')?.value || 'Rotura / Merma';
  const note = document.querySelector('#wasteNote')?.value.trim() || '';
  if (!item || !(qty > 0)) return showToast('Indica la cantidad a descontar.');
  if (qty > item.qty) return showToast(`En el sistema solo hay ${formatQty(item.qty)} ${item.unit}.`);

  const cost = supplyUnitCost(item.id);
  const price = supplyUnitPrice(item.id);

  // Descontar inmediatamente del inventario
  item.qty = Math.max(0, Number((item.qty - qty).toFixed(2)));
  const prod = supplyProduct(item.id);
  if (prod) {
    prod.stock = item.qty;
    prod.updated_at = new Date().toISOString();
    prod.sync_status = 'pending';
  }

  logStock({
    type: 'merma',
    reasonCategory: reason,
    itemId: item.id,
    itemName: item.name,
    unit: item.unit,
    delta: -qty,
    cost,
    price,
    value: -qty * cost,
    saleValue: -qty * price,
    reason,
    note
  });

  logAudit('Ajuste de stock registrado', `${formatQty(qty)} ${item.unit} de ${item.name} · ${reason}${note ? ' (' + note + ')' : ''}`);
  saveState();
  document.querySelector('#wasteDialog').close();
  renderAll();
  showToast(`Ajuste registrado: -${formatQty(qty)} ${item.unit} de ${item.name} (${reason}).`);
}
function openCountDialog() {
  if (!can('conteo')) return deny();
  document.querySelector('#countBody').innerHTML = state.inventory.map(i => `<tr data-count-row="${i.id}"><td><strong>${escapeHtml(i.name)}</strong><br><small class="muted">${escapeHtml(i.unit)}</small></td><td>${formatQty(i.qty)}</td><td><input type="number" min="0" step="0.01" inputmode="decimal" data-count-item="${i.id}" placeholder="—" /></td><td class="count-diff" data-count-diff="${i.id}">—</td></tr>`).join('');
  document.querySelector('#countNote').value = ''; updateCountTotals(); document.querySelector('#countDialog').showModal();
}
function countLines() {
  const lines = [];
  document.querySelectorAll('#countBody input[data-count-item]').forEach(input => {
    if (input.value === '') return; const item = state.inventory.find(i => i.id === input.dataset.countItem), counted = Number(input.value); if (!item || !Number.isFinite(counted) || counted < 0) return;
    lines.push({ item, counted, diff: Number((counted - item.qty).toFixed(2)) });
  });
  return lines;
}
function updateCountTotals() {
  const lines = countLines(); let value = 0;
  document.querySelectorAll('#countBody [data-count-diff]').forEach(cell => { cell.textContent = '—'; cell.className = 'count-diff'; });
  lines.forEach(({ item, diff }) => { value += diff * supplyUnitCost(item.id); const cell = document.querySelector(`[data-count-diff="${item.id}"]`); if (cell) { cell.textContent = diff === 0 ? 'Cuadra' : `${diff > 0 ? '+' : ''}${formatQty(diff)}`; cell.className = `count-diff ${diff === 0 ? 'ok' : diff < 0 ? 'neg' : 'pos'}`; } });
  document.querySelector('#countTotal').textContent = `${value < 0 ? '−' : value > 0 ? '+' : ''}${money.format(Math.abs(value))}`;
}
function applyCount() {
  if (!can('conteo')) return deny(); const lines = countLines(); if (!lines.length) return showToast('Escribe al menos una cantidad contada.');
  const note = document.querySelector('#countNote').value.trim() || 'Conteo físico', changed = lines.filter(l => l.diff !== 0); let value = 0;
  changed.forEach(({ item, counted, diff }) => { const v = diff * supplyUnitCost(item.id); value += v; item.qty = counted; logStock({ type: 'conteo', itemId: item.id, itemName: item.name, unit: item.unit, delta: diff, value: v, reason: note }); });
  logAudit('Conteo físico', `${lines.length} insumos contados · ${changed.length} con diferencia · ${value < 0 ? '−' : '+'}${money.format(Math.abs(value))}`, { reason: note });
  saveState(); document.querySelector('#countDialog').close(); renderAll(); showToast(changed.length ? `Conteo aplicado: ${changed.length} diferencias ajustadas.` : 'Conteo aplicado: todo cuadra.');
}

/* Anular un pedido abierto deja constancia en la bitácora. */
function deleteCurrentOrder() {
  const order = getOrder(state.currentOrderId); if (!order) return;
  if (order.items.length && !window.confirm(`¿Eliminar el pedido de ${order.tableName} por ${money.format(orderTotal(order))}?`)) return;
  logAudit('Pedido eliminado', `${order.tableName} · ${money.format(orderTotal(order))} · ${order.items.length} productos`, { data: structuredClone(order) });
  state.orders = state.orders.filter(o => o.id !== order.id); saveState(); if (globalThis.NexoSync?.deleteActiveOrder) globalThis.NexoSync.deleteActiveOrder(order.id).catch(() => {}); if (globalThis.NexoSync?.syncOrders) globalThis.NexoSync.syncOrders().catch(() => {}); document.querySelector('#orderDialog').close(); state.currentOrderId = null; renderAll(); showToast('Pedido eliminado.');
}

/* ============ Reportes analíticos ============ */
const WEEKDAYS = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'], WEEKDAY_ORDER = [1, 2, 3, 4, 5, 6, 0];
const HOUR_ORDER = [...Array(12).keys()].map(i => i + 12).concat([...Array(12).keys()]); // 12:00 → 11:59, así la noche queda junta
function previousBounds() {
  const { from, to } = reportBounds(), days = Math.round((parseISO(to) - parseISO(from)) / 86400000) + 1;
  const pTo = parseISO(from); pTo.setDate(pTo.getDate() - 1); const pFrom = new Date(pTo); pFrom.setDate(pFrom.getDate() - (days - 1));
  return { from: localISO(pFrom), to: localISO(pTo), days };
}
function paymentsBetween(from, to) { return state.payments.filter(p => p.date >= from && p.date <= to); }
function itemCost(item) { return Number(item.cost ?? state.products.find(p => p.id === item.productId)?.cost ?? 0); }
function itemCategory(item) { return item.category || state.products.find(p => p.id === item.productId)?.category || 'Sin categoría'; }
function paymentMetrics(payments) {
  const total = payments.reduce((s, p) => s + p.amount, 0), count = payments.length, cost = payments.reduce((s, p) => s + (p.items || []).reduce((c, i) => c + itemCost(i) * i.qty, 0), 0), profit = total - cost;
  return { total, count, avg: count ? total / count : 0, cost, profit, margin: total ? profit / total * 100 : 0 };
}
function reportDataset() {
  const { from, to } = reportBounds(), prev = previousBounds(), payments = reportPayments(), prevPayments = paymentsBetween(prev.from, prev.to);
  const data = { from, to, prev, payments, cur: paymentMetrics(payments), old: paymentMetrics(prevPayments), byMethod: {}, byProduct: {}, byCategory: {}, byWaiter: {}, hours: Array(24).fill(0), hourCount: Array(24).fill(0), weekdays: Array(7).fill(0), weekdayDays: Array(7).fill(0) };
  payments.forEach(p => {
    if (Array.isArray(p.payments) && p.payments.length > 0) {
      p.payments.forEach(tender => {
        data.byMethod[tender.method] = (data.byMethod[tender.method] || 0) + tender.amount;
      });
    } else {
      data.byMethod[p.method] = (data.byMethod[p.method] || 0) + p.amount;
    }
    const waiter = p.waiterName || 'Sin asignar'; const w = data.byWaiter[waiter] || (data.byWaiter[waiter] = { sales: 0, count: 0 }); w.sales += p.amount; w.count++;
    const hour = new Date(paymentTimestamp(p)).getHours(); data.hours[hour] += p.amount; data.hourCount[hour]++;
    data.weekdays[parseISO(p.date).getDay()] += p.amount;
    (p.items || []).filter(item => !item.splitLine).forEach(item => {
      const sales = item.price * item.qty, cost = itemCost(item) * item.qty, category = itemCategory(item);
      const prod = data.byProduct[item.name] || (data.byProduct[item.name] = { qty: 0, sales: 0, cost: 0, category }); prod.qty += item.qty; prod.sales += sales; prod.cost += cost;
      const cat = data.byCategory[category] || (data.byCategory[category] = { qty: 0, sales: 0, cost: 0 }); cat.qty += item.qty; cat.sales += sales; cat.cost += cost;
    });
  });
  for (let d = parseISO(from), n = 0; localISO(d) <= to && n < 800; d.setDate(d.getDate() + 1), n++) data.weekdayDays[d.getDay()]++;
  data.purchases = state.purchases.filter(p => p.date >= from && p.date <= to); data.expenses = state.expenses.filter(e => e.date >= from && e.date <= to);
  data.stock = state.stockLog.filter(e => e.date >= from && e.date <= to);
  const sum = (type, sign) => data.stock.filter(e => e.type === type && Math.sign(e.value) === sign).reduce((s, e) => s + Math.abs(e.value), 0);
  data.mermas = sum('merma', -1); data.faltantes = sum('conteo', -1); data.sobrantes = sum('conteo', 1);
  data.stockLoss = data.mermas + data.faltantes - data.sobrantes; data.profitAfterLoss = data.cur.profit - data.stockLoss;
  return data;
}
function deltaCell(cur, prev, { inverse = false, pts = false } = {}) {
  if (!prev && !cur) return '<span class="delta flat">—</span>'; if (!prev) return '<span class="delta up">Nuevo</span>';
  const d = pts ? cur - prev : (cur - prev) / Math.abs(prev) * 100, cls = Math.abs(d) < 0.05 ? 'flat' : ((d > 0) !== inverse ? 'up' : 'down');
  return `<span class="delta ${cls}">${d > 0.05 ? '▲' : d < -0.05 ? '▼' : '■'} ${Math.abs(d).toFixed(1)}${pts ? ' pts' : '%'}</span>`;
}
function columnChart(cols) {
  const max = Math.max(1, ...cols.map(c => c.value));
  return cols.map(c => `<div class="day-col ${c.peak ? 'peak' : ''}" title="${escapeHtml(c.title)}"><span class="day-val">${escapeHtml(c.top || '')}</span><div class="day-bar"><i style="height:${c.value ? Math.max(3, c.value / max * 100) : 0}%"></i></div><span class="day-label">${escapeHtml(String(c.label))}</span></div>`).join('');
}
function rowList(rows) { return rows.map(([label, value]) => `<div class="report-row"><span>${label}</span><b>${value}</b></div>`).join(''); }
function hourLabel(h) { return `${String(h).padStart(2, '0')}:00`; }

function renderReports() {
  if (typeof renderReportPeriod === 'function') renderReportPeriod(); else if (typeof globalThis.renderReportPeriod === 'function') globalThis.renderReportPeriod();
  const isDemo = typeof isDemoMode === 'function' ? isDemoMode() : !!globalThis.isDemoMode?.();
  const wmTop = document.querySelector('#reportWatermarkTop');
  const wmBottom = document.querySelector('#reportWatermarkBottom');
  if (wmTop) wmTop.hidden = !isDemo;
  if (wmBottom) wmBottom.hidden = !isDemo;

  const $ = s => document.querySelector(s), d = reportDataset(), { cur, old } = d, compact = new Intl.NumberFormat('es-CO', { notation: 'compact', maximumFractionDigits: 1 });
  $('#reportTotal').textContent = money.format(cur.total);
  $('#reportTicket').textContent = `${cur.count} ${cur.count === 1 ? 'ticket' : 'tickets'} · Promedio ${money.format(cur.avg)}`;
  $('#paymentReport').innerHTML = Object.keys(d.byMethod).length ? rowList(Object.entries(d.byMethod).map(([m, v]) => [escapeHtml(m), money.format(v)])) : '<p class="muted">Aún no hay pagos registrados.</p>';
  const ranking = Object.entries(d.byProduct).sort((a, b) => b[1].qty - a[1].qty).slice(0, 5);
  $('#productReport').innerHTML = ranking.length ? rowList(ranking.map(([name, v], i) => [`${i + 1}. ${escapeHtml(name)}`, `${v.qty} und`])) : '<p class="muted">Aún no hay productos vendidos.</p>';
  const top = Object.entries(d.byProduct).sort((a, b) => b[1].sales - a[1].sales).slice(0, 5), topMax = top[0]?.[1].sales || 1;
  $('#profitChart').innerHTML = top.length ? top.map(([name, v]) => `<div class="chart-row"><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><div class="chart-track"><div class="chart-fill" style="width:${Math.max(4, v.sales / topMax * 100)}%"></div></div><strong>${money.format(v.sales)}</strong></div>`).join('') : '<p class="muted">Las ventas cerradas aparecerán aquí.</p>';
  $('#profitReport').innerHTML = rowList([['Ventas netas', money.format(cur.total)], ['Costo de productos vendidos', money.format(cur.cost)], ['Utilidad bruta', money.format(cur.profit)], ['Margen bruto', `${cur.margin.toFixed(1)}%`], ['Mermas y faltantes (neto)', `− ${money.format(d.stockLoss)}`], ['Utilidad tras mermas', money.format(d.profitAfterLoss)]]);
  const purchasesTotal = d.purchases.reduce((s, p) => s + p.total, 0), expensesTotal = d.expenses.reduce((s, e) => s + e.amount, 0);
  $('#operationsReport').innerHTML = rowList([['Compras de mercancía', money.format(purchasesTotal)], ['Servicios y otros gastos', money.format(expensesTotal)], ['Flujo registrado', money.format(cur.total - purchasesTotal - expensesTotal)]]);
  $('#expectedCashInClose').textContent = money.format(paymentsToday().filter(p => p.method === 'Efectivo').reduce((s, p) => s + p.amount, 0));

  // Comparativo con el período anterior
  $('#comparisonRange').textContent = `${shortDate(d.from)}${d.from === d.to ? '' : ' – ' + shortDate(d.to)} frente a ${shortDate(d.prev.from)}${d.prev.from === d.prev.to ? '' : ' – ' + shortDate(d.prev.to)}`;
  const cmp = [['Ventas', cur.total, old.total, money.format.bind(money), {}], ['Facturas', cur.count, old.count, String, {}], ['Ticket promedio', cur.avg, old.avg, money.format.bind(money), {}], ['Costo de ventas', cur.cost, old.cost, money.format.bind(money), { inverse: true }], ['Utilidad bruta', cur.profit, old.profit, money.format.bind(money), {}], ['Margen bruto', cur.margin, old.margin, v => `${v.toFixed(1)}%`, { pts: true }]];
  $('#comparisonReport').innerHTML = `<table class="compare-table"><thead><tr><th></th><th>Actual</th><th>Anterior</th><th>Variación</th></tr></thead><tbody>${cmp.map(([label, a, b, fmt, opts]) => `<tr><td>${label}</td><td><strong>${fmt(a)}</strong></td><td>${fmt(b)}</td><td>${deltaCell(a, b, opts)}</td></tr>`).join('')}</tbody></table>`;

  // Ventas por hora
  const maxHour = Math.max(...d.hours), peakHour = d.hours.indexOf(maxHour);
  $('#hourChart').innerHTML = columnChart(HOUR_ORDER.map(h => ({ label: String(h).padStart(2, '0'), value: d.hours[h], peak: maxHour > 0 && h === peakHour, top: d.hours[h] && d.hours[h] >= maxHour * .5 ? compact.format(d.hours[h]) : '', title: `${hourLabel(h)} – ${hourLabel((h + 1) % 24)}: ${money.format(d.hours[h])} · ${d.hourCount[h]} ${d.hourCount[h] === 1 ? 'factura' : 'facturas'}` })));
  const active = HOUR_ORDER.filter(h => d.hours[h] > 0);
  $('#hourSummary').innerHTML = maxHour ? rowList([['Hora pico', `${hourLabel(peakHour)} – ${hourLabel((peakHour + 1) % 24)} · ${money.format(maxHour)}`], ['Primera venta (franja)', hourLabel(active[0])], ['Última venta (franja)', hourLabel(active[active.length - 1])]]) : '<p class="muted">Sin ventas en este período.</p>';

  // Por día de la semana
  const maxDay = Math.max(...d.weekdays), peakDay = d.weekdays.indexOf(maxDay);
  $('#weekdayChart').innerHTML = columnChart(WEEKDAY_ORDER.map((n, i) => ({ label: WEEKDAYS[i], value: d.weekdays[n], peak: maxDay > 0 && n === peakDay, top: d.weekdays[n] ? compact.format(d.weekdays[n]) : '', title: `${WEEKDAYS[i]}: ${money.format(d.weekdays[n])} en ${d.weekdayDays[n]} ${d.weekdayDays[n] === 1 ? 'día' : 'días'}` })));
  $('#weekdaySummary').innerHTML = maxDay ? rowList(WEEKDAY_ORDER.filter(n => d.weekdayDays[n]).map(n => [WEEKDAYS[WEEKDAY_ORDER.indexOf(n)], `${money.format(d.weekdays[n])} · prom. ${money.format(d.weekdays[n] / d.weekdayDays[n])}`])) : '<p class="muted">Sin ventas en este período.</p>';

  // Por categoría y por vendedor
  const cats = Object.entries(d.byCategory).sort((a, b) => b[1].sales - a[1].sales), catMax = cats[0]?.[1].sales || 1, catTotal = cats.reduce((s, [, v]) => s + v.sales, 0) || 1;
  $('#categoryChart').innerHTML = cats.length ? cats.map(([name, v]) => `<div class="chart-row"><span title="${escapeHtml(name)}">${escapeHtml(name)} · ${(v.sales / catTotal * 100).toFixed(0)}%</span><div class="chart-track"><div class="chart-fill" style="width:${Math.max(4, v.sales / catMax * 100)}%"></div></div><strong>${money.format(v.sales)}</strong></div>`).join('') : '<p class="muted">Aún no hay ventas por categoría.</p>';
  $('#waiterReport').innerHTML = Object.keys(d.byWaiter).length ? rowList(Object.entries(d.byWaiter).sort((a, b) => b[1].sales - a[1].sales).map(([name, v]) => [`${escapeHtml(name)} <small class="muted">· ${v.count} fact.</small>`, money.format(v.sales)])) : '<p class="muted">Aún no hay ventas.</p>';
  const mermasBreakdown = {
    'Rotura / Merma': { qty: 0, cost: 0, sale: 0 },
    'Cortesía de la casa': { qty: 0, cost: 0, sale: 0 },
    'Consumo de personal': { qty: 0, cost: 0, sale: 0 },
    'Otro ajuste': { qty: 0, cost: 0, sale: 0 }
  };
  let totalBajasQty = 0, totalBajasCost = 0, totalBajasSale = 0;
  (d.stock || []).forEach(e => {
    if (e.delta < 0) {
      const cat = e.reasonCategory || e.reason || '';
      let k = 'Otro ajuste';
      if (cat.includes('Rotura') || cat.includes('Merma')) k = 'Rotura / Merma';
      else if (cat.includes('Cortesía') || cat.includes('Cortesia')) k = 'Cortesía de la casa';
      else if (cat.includes('Consumo') || cat.includes('personal')) k = 'Consumo de personal';

      const q = Math.abs(e.delta);
      const c = e.value != null ? Math.abs(e.value) : (e.cost ? q * e.cost : 0);
      const s = e.saleValue != null ? Math.abs(e.saleValue) : (e.price ? q * e.price : 0);

      mermasBreakdown[k].qty += q;
      mermasBreakdown[k].cost += c;
      mermasBreakdown[k].sale += s;

      totalBajasQty += q;
      totalBajasCost += c;
      totalBajasSale += s;
    }
  });

  const stockRows = [
    ['Roturas y mermas', `${formatQty(mermasBreakdown['Rotura / Merma'].qty)} und · Costo: ${money.format(mermasBreakdown['Rotura / Merma'].cost)} (Venta: ${money.format(mermasBreakdown['Rotura / Merma'].sale)})`],
    ['Cortesías de la casa', `${formatQty(mermasBreakdown['Cortesía de la casa'].qty)} und · Costo: ${money.format(mermasBreakdown['Cortesía de la casa'].cost)} (Venta: ${money.format(mermasBreakdown['Cortesía de la casa'].sale)})`],
    ['Consumo de personal', `${formatQty(mermasBreakdown['Consumo de personal'].qty)} und · Costo: ${money.format(mermasBreakdown['Consumo de personal'].cost)} (Venta: ${money.format(mermasBreakdown['Consumo de personal'].sale)})`],
    ['Otros ajustes y conteo', `${formatQty(mermasBreakdown['Otro ajuste'].qty)} und · Costo: ${money.format(mermasBreakdown['Otro ajuste'].cost)}`],
    ['TOTAL BAJAS AUDITADAS', `<strong>${formatQty(totalBajasQty)} und · ${money.format(totalBajasCost)} costo (${money.format(totalBajasSale)} venta)</strong>`]
  ];
  $('#stockReport').innerHTML = rowList(stockRows);
}

/* ---------- Exportar a Excel (.xlsx real, sin librerías) ---------- */
const CRC_TABLE = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
function crc32(bytes) { let c = 0xFFFFFFFF; for (let i = 0; i < bytes.length; i++) c = CRC_TABLE[(c ^ bytes[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
function zipStore(files) {
  const enc = new TextEncoder(), parts = [], central = []; let offset = 0;
  const now = new Date(), dosTime = (now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1), dosDate = ((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate();
  files.forEach(file => {
    const name = enc.encode(file.name), data = enc.encode(file.content), crc = crc32(data), local = new DataView(new ArrayBuffer(30));
    local.setUint32(0, 0x04034b50, true); local.setUint16(4, 20, true); local.setUint16(6, 0x0800, true); local.setUint16(8, 0, true); local.setUint16(10, dosTime, true); local.setUint16(12, dosDate, true); local.setUint32(14, crc, true); local.setUint32(18, data.length, true); local.setUint32(22, data.length, true); local.setUint16(26, name.length, true); local.setUint16(28, 0, true);
    parts.push(new Uint8Array(local.buffer), name, data);
    const cen = new DataView(new ArrayBuffer(46));
    cen.setUint32(0, 0x02014b50, true); cen.setUint16(4, 20, true); cen.setUint16(6, 20, true); cen.setUint16(8, 0x0800, true); cen.setUint16(10, 0, true); cen.setUint16(12, dosTime, true); cen.setUint16(14, dosDate, true); cen.setUint32(16, crc, true); cen.setUint32(20, data.length, true); cen.setUint32(24, data.length, true); cen.setUint16(28, name.length, true); cen.setUint32(42, offset, true);
    central.push(new Uint8Array(cen.buffer), name); offset += 30 + name.length + data.length;
  });
  const cdSize = central.reduce((s, c) => s + c.length, 0), end = new DataView(new ArrayBuffer(22));
  end.setUint32(0, 0x06054b50, true); end.setUint16(8, files.length, true); end.setUint16(10, files.length, true); end.setUint32(12, cdSize, true); end.setUint32(16, offset, true);
  return new Blob([...parts, ...central, new Uint8Array(end.buffer)], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
}
function xmlEsc(s) { return String(s).replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c])).replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, ''); }
function colName(index) { let s = '', n = index + 1; while (n > 0) { const m = (n - 1) % 26; s = String.fromCharCode(65 + m) + s; n = Math.floor((n - 1) / 26); } return s; }
const XS = { head: 1, money: 2, int: 3, pct: 4, bold: 5, title: 6, dec: 7 };
const cellM = v => ({ v, s: XS.money }), cellI = v => ({ v, s: XS.int }), cellP = v => ({ v, s: XS.pct }), cellH = v => ({ v, s: XS.head }), cellB = v => ({ v, s: XS.bold }), cellD = v => ({ v, s: XS.dec });
function sheetXml(rows, widths = []) {
  const body = rows.map((row, r) => `<row r="${r + 1}">${row.map((cell, c) => {
    const spec = cell !== null && typeof cell === 'object' ? cell : { v: cell, s: 0 }, ref = `${colName(c)}${r + 1}`, style = spec.s ? ` s="${spec.s}"` : '';
    if (spec.v === '' || spec.v === null || spec.v === undefined) return '';
    return typeof spec.v === 'number' && Number.isFinite(spec.v) ? `<c r="${ref}"${style}><v>${spec.v}</v></c>` : `<c r="${ref}"${style} t="inlineStr"><is><t xml:space="preserve">${xmlEsc(spec.v)}</t></is></c>`;
  }).join('')}</row>`).join('');
  const cols = widths.length ? `<cols>${widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join('')}</cols>` : '';
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetViews><sheetView workbookViewId="0"/></sheetViews>${cols}<sheetData>${body}</sheetData></worksheet>`;
}
const XLSX_STYLES = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><numFmts count="2"><numFmt numFmtId="164" formatCode="&quot;$&quot;#,##0"/><numFmt numFmtId="165" formatCode="0.0&quot;%&quot;"/></numFmts><fonts count="4"><font><sz val="11"/><name val="Calibri"/></font><font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font><font><b/><sz val="14"/><name val="Calibri"/></font><font><b/><sz val="11"/><name val="Calibri"/></font></fonts><fills count="3"><fill><patternFill patternType="none"/></fill><fill><patternFill patternType="gray125"/></fill><fill><patternFill patternType="solid"><fgColor rgb="FF155E41"/><bgColor indexed="64"/></patternFill></fill></fills><borders count="1"><border><left/><right/><top/><bottom/><diagonal/></border></borders><cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs><cellXfs count="8"><xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/><xf numFmtId="0" fontId="1" fillId="2" borderId="0" xfId="0" applyFont="1" applyFill="1"/><xf numFmtId="164" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="3" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="165" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/><xf numFmtId="0" fontId="3" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="0" fontId="2" fillId="0" borderId="0" xfId="0" applyFont="1"/><xf numFmtId="4" fontId="0" fillId="0" borderId="0" xfId="0" applyNumberFormat="1"/></cellXfs><cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles></styleSheet>';
function buildXlsx(sheets) {
  const files = [
    { name: '[Content_Types].xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join('')}</Types>` },
    { name: '_rels/.rels', content: '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>' },
    { name: 'xl/workbook.xml', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${sheets.map((s, i) => `<sheet name="${xmlEsc(s.name)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join('')}</sheets></workbook>` },
    { name: 'xl/_rels/workbook.xml.rels', content: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join('')}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>` },
    { name: 'xl/styles.xml', content: XLSX_STYLES },
    ...sheets.map((s, i) => ({ name: `xl/worksheets/sheet${i + 1}.xml`, content: sheetXml(s.rows, s.widths) })),
  ];
  return zipStore(files);
}
function variation(cur, prev) { return prev ? cellP(Number(((cur - prev) / Math.abs(prev) * 100).toFixed(1))) : '—'; }
function reportSheets() {
  const d = reportDataset(), { cur, old } = d, time = p => new Date(paymentTimestamp(p)).toLocaleTimeString('es-CO', { hour: '2-digit', minute: '2-digit' }), period = d.from === d.to ? d.from : `${d.from} a ${d.to}`;
  const sheets = [];
  sheets.push({ name: 'Resumen', widths: [34, 20, 20, 16], rows: [
    [{ v: `Reporte de ventas · ${state.profile?.name || 'NexoBar'}`, s: XS.title }], ['Período', period], ['Período anterior', d.prev.from === d.prev.to ? d.prev.from : `${d.prev.from} a ${d.prev.to}`], ['Generado', new Date().toLocaleString('es-CO')], [],
    [cellH('Indicador'), cellH('Actual'), cellH('Período anterior'), cellH('Variación')],
    ['Ventas', cellM(cur.total), cellM(old.total), variation(cur.total, old.total)], ['Facturas', cellI(cur.count), cellI(old.count), variation(cur.count, old.count)], ['Ticket promedio', cellM(cur.avg), cellM(old.avg), variation(cur.avg, old.avg)],
    ['Costo de ventas', cellM(cur.cost), cellM(old.cost), variation(cur.cost, old.cost)], ['Utilidad bruta', cellM(cur.profit), cellM(old.profit), variation(cur.profit, old.profit)], ['Margen bruto', cellP(Number(cur.margin.toFixed(1))), cellP(Number(old.margin.toFixed(1))), ''], [],
    [cellB('Inventario')], ['Mermas (costo)', cellM(d.mermas)], ['Faltantes en conteo', cellM(d.faltantes)], ['Sobrantes en conteo', cellM(d.sobrantes)], ['Pérdida neta de inventario', cellM(d.stockLoss)], ['Utilidad tras mermas', cellM(d.profitAfterLoss)], [],
    [cellH('Medio de pago'), cellH('Total')], ...Object.entries(d.byMethod).map(([m, v]) => [m, cellM(v)]),
  ] });
  sheets.push({ name: 'Facturas', widths: [12, 12, 8, 24, 18, 18, 14, 14, 10], rows: [['N.º', 'Fecha', 'Hora', 'Mesa / cliente', 'Mesero', 'Cajero', 'Medio de pago', 'Total', 'Editada'].map(cellH), ...[...d.payments].sort((a, b) => paymentTimestamp(a) - paymentTimestamp(b)).map(p => [p.invoiceNo || '', p.date, time(p), p.customer || '', p.waiterName || '', p.cashierName || '', p.method, cellM(p.amount), p.editedAt ? 'Sí' : ''])] });
  sheets.push({ name: 'Detalle de ventas', widths: [12, 12, 28, 16, 8, 12, 12, 14, 14, 14], rows: [['Factura', 'Fecha', 'Producto', 'Categoría', 'Cant.', 'Precio', 'Costo unit.', 'Venta', 'Costo', 'Utilidad'].map(cellH), ...d.payments.flatMap(p => (p.items || []).map(i => [p.invoiceNo || '', p.date, i.name, itemCategory(i), cellI(i.qty), cellM(i.price), cellM(itemCost(i)), cellM(i.price * i.qty), cellM(itemCost(i) * i.qty), cellM((i.price - itemCost(i)) * i.qty)]))] });
  const grouped = (obj, withCat) => Object.entries(obj).sort((a, b) => b[1].sales - a[1].sales).map(([name, v]) => [name, ...(withCat ? [v.category] : []), cellI(v.qty), cellM(v.sales), cellM(v.cost), cellM(v.sales - v.cost), cellP(v.sales ? Number(((v.sales - v.cost) / v.sales * 100).toFixed(1)) : 0)]);
  sheets.push({ name: 'Por producto', widths: [28, 16, 10, 14, 14, 14, 10], rows: [['Producto', 'Categoría', 'Cant.', 'Ventas', 'Costo', 'Utilidad', 'Margen'].map(cellH), ...grouped(d.byProduct, true)] });
  sheets.push({ name: 'Por categoría', widths: [24, 10, 14, 14, 14, 10], rows: [['Categoría', 'Cant.', 'Ventas', 'Costo', 'Utilidad', 'Margen'].map(cellH), ...grouped(d.byCategory, false)] });
  sheets.push({ name: 'Por hora', widths: [14, 14, 12], rows: [['Hora', 'Ventas', 'Facturas'].map(cellH), ...HOUR_ORDER.map(h => [`${hourLabel(h)} – ${hourLabel((h + 1) % 24)}`, cellM(d.hours[h]), cellI(d.hourCount[h])])] });
  sheets.push({ name: 'Por día de semana', widths: [14, 14, 12, 18], rows: [['Día', 'Ventas', 'Días en el período', 'Promedio por día'].map(cellH), ...WEEKDAY_ORDER.map((n, i) => [WEEKDAYS[i], cellM(d.weekdays[n]), cellI(d.weekdayDays[n]), cellM(d.weekdayDays[n] ? d.weekdays[n] / d.weekdayDays[n] : 0)])] });
  sheets.push({ name: 'Por vendedor', widths: [24, 14, 12], rows: [['Mesero', 'Ventas', 'Facturas'].map(cellH), ...Object.entries(d.byWaiter).sort((a, b) => b[1].sales - a[1].sales).map(([n, v]) => [n, cellM(v.sales), cellI(v.count)])] });
  sheets.push({ name: 'Compras', widths: [12, 24, 16, 14, 14, 10], rows: [['Fecha', 'Proveedor', 'Factura', 'Medio de pago', 'Total', 'Productos'].map(cellH), ...d.purchases.map(p => [p.date, p.supplier, p.invoice, p.method || '', cellM(p.total), cellI(p.lines.length)])] });
  sheets.push({ name: 'Gastos', widths: [12, 22, 34, 14, 14], rows: [['Fecha', 'Tipo', 'Descripción', 'Medio de pago', 'Valor'].map(cellH), ...d.expenses.map(e => [e.date, e.category, e.description, e.method, cellM(e.amount)])] });
  sheets.push({ name: 'Mermas y conteos', widths: [12, 16, 24, 12, 8, 14, 34, 16], rows: [['Fecha', 'Tipo', 'Insumo', 'Cantidad', 'Unidad', 'Valor', 'Motivo', 'Usuario'].map(cellH), ...d.stock.map(e => [e.date, STOCK_TYPES[e.type] || e.type, e.itemName, cellD(e.delta), e.unit || '', cellM(e.value || 0), e.reason || '', e.userName || ''])] });

  const isDemo = typeof isDemoMode === 'function' ? isDemoMode() : !!globalThis.isDemoMode?.();
  if (isDemo) {
    sheets.forEach(s => {
      s.rows.unshift([{ v: 'DOCUMENTO DE DEMOSTRACIÓN — NETXPREMIUM', s: XS.title }]);
      s.rows.push([], [{ v: 'DOCUMENTO DE DEMOSTRACIÓN — NETXPREMIUM', s: XS.bold }]);
    });
  }
  return sheets;
}
function downloadBlob(blob, filename) { const url = URL.createObjectURL(blob), a = document.createElement('a'); a.href = url; a.download = filename; document.body.appendChild(a); a.click(); a.remove(); setTimeout(() => URL.revokeObjectURL(url), 1500); }
function exportReportXlsx() {
  if (!can('view.reports')) return deny();
  const isDemo = typeof isDemoMode === 'function' ? isDemoMode() : !!globalThis.isDemoMode?.();
  const { from, to } = reportBounds();
  const filename = isDemo ? `reporte-DEMO-NETXPREMIUM-${from}${from === to ? '' : '_a_' + to}.xlsx` : `reporte-${from}${from === to ? '' : '_a_' + to}.xlsx`;
  downloadBlob(buildXlsx(reportSheets()), filename);
  showToast('Reporte de Excel descargado.');
}
function printReport() {
  if (!can('view.reports')) return deny();
  const isDemo = typeof isDemoMode === 'function' ? isDemoMode() : !!globalThis.isDemoMode?.();
  const watermarkPrefix = isDemo ? 'DOCUMENTO DE DEMOSTRACIÓN — NETXPREMIUM · ' : '';
  const { from, to } = reportBounds();
  const headerEl = document.querySelector('#printHeader');
  if (headerEl) {
    headerEl.textContent = `${watermarkPrefix}${state.profile?.name || 'NexoBar'} · Reporte ${from === to ? 'del ' + shortDate(from, true) : 'del ' + shortDate(from) + ' al ' + shortDate(to, true)} · generado ${new Date().toLocaleString('es-CO')}`;
  }
  const footerEl = document.querySelector('#printFooter');
  if (footerEl) {
    footerEl.textContent = isDemo ? 'DOCUMENTO DE DEMOSTRACIÓN — NETXPREMIUM' : '';
    footerEl.hidden = !isDemo;
  }
  window.print();
}

/* ============ Eventos y arranque ============ */
function handleModuleClick(event) {
  const t = event.target.closest('button'); if (!t) return; const d = t.dataset;
  if (d.loginUser) { loginTarget = d.loginUser; loginPin = ''; setLoginError(''); return renderLogin(); }
  if (d.key !== undefined) return pressPin(d.key);
  if (d.editUser) return openUserDialog(d.editUser);
  if (d.printInvoice) return printPaymentReceipt(d.printInvoice, { reprint: true });
  if (d.editInvoice) return openInvoiceEdit(d.editInvoice);
  if (d.deleteInvoice) return openInvoiceDelete(d.deleteInvoice);
  if (d.removeInvTender !== undefined && invoiceDraft) { invoiceDraft.tenders.splice(Number(d.removeInvTender), 1); if (invoiceDraft.tenders.length === 1) document.querySelector('#invoiceMethodEdit').value = invoiceDraft.tenders[0].method; return renderInvoiceTenders(); }
  if (d.removeInvLine !== undefined) { invoiceDraft.items.splice(Number(d.removeInvLine), 1); return renderInvoiceDraft(); }
  if (d.editSupplier) return openSupplierDialog(d.editSupplier);
  if (d.deleteSupplier) return deleteSupplier(d.deleteSupplier);
  const actions = {
    loginBackButton: () => { loginTarget = null; loginPin = ''; setLoginError(''); renderLogin(); }, userChip: openSessionDialog, logoutButton: showLogin, changePinButton: () => openPinDialog(false), savePinButton: savePin,
    newUserButton: () => openUserDialog(), saveUserButton: saveUser, saveInvoiceButton: saveInvoiceEdit, invoiceAddButton: addInvoiceLine, invoiceAddTender: () => { if (!invoiceDraft) return; invoiceDraft.tenders.push({ method: 'Nequi', amount: 0 }); renderInvoiceTenders(); }, confirmDeleteInvoiceButton: confirmDeleteInvoice,
    invoiceTodayButton: () => { invoiceFilter.date = ''; renderInvoices(); }, invoiceAllButton: () => { invoiceFilter.date = 'all'; renderInvoices(); },
    newSupplierButton: () => openSupplierDialog(), saveSupplierButton: saveSupplier, newWasteButton: openWasteDialog, saveWasteButton: saveWaste, newCountButton: openCountDialog, applyCountButton: applyCount,
    exportXlsxButton: exportReportXlsx, printReportButton: printReport,
    downloadTemplateBtn: () => globalThis.downloadProductTemplate && globalThis.downloadProductTemplate(),
    importProductsBtn: () => globalThis.openImportProductsDialog && globalThis.openImportProductsDialog(),
    themeToggle: () => { const light = document.documentElement.dataset.theme !== 'light'; if (light) document.documentElement.dataset.theme = 'light'; else delete document.documentElement.dataset.theme; try { localStorage.setItem('nexobar-theme', light ? 'light' : 'dark'); localStorage.setItem('brasa-theme', light ? 'light' : 'dark'); } catch { /* sin almacenamiento */ } },
    backupNowButton: () => { if (!can('backup')) return deny(); runBackup('Manual', 'manual'); },
    openBackupFolderButton: () => { if (globalThis.desktop) desktop.openBackupFolder(); },
    chooseBackupFolderButton: async () => { if (!can('backup') || !globalThis.desktop) return deny(); const dir = await desktop.chooseBackupFolder(); if (dir) { showToast('Carpeta de respaldos actualizada.'); refreshStorageInfo(true); } },
  };
  if (actions[t.id]) actions[t.id]();
}
function handleModuleInput(event) {
  const t = event.target;
  if (t.dataset.invLine !== undefined && invoiceDraft) {
    const item = invoiceDraft.items[Number(t.dataset.invLine)]; if (!item) return; item[t.dataset.invField] = t.value === '' ? 0 : Number(t.value);
    const row = t.closest('.invoice-line'); if (row) row.querySelector('b').textContent = money.format((Number(item.price) || 0) * (Number(item.qty) || 0));
    const original = state.payments.find(p => p.id === invoiceDraft.id), total = draftTotal(), diff = total - (original?.amount || 0);
    renderInvoiceTendersStatus();
    document.querySelector('#invoiceNewTotal').textContent = money.format(total); document.querySelector('#invoiceDiff').textContent = diff === 0 ? 'El total no cambia.' : `Total original ${money.format(original?.amount || 0)} · diferencia ${diff > 0 ? '+' : '−'}${money.format(Math.abs(diff))}`;
  }
  if (t.dataset.invTender !== undefined && invoiceDraft) { const tender = invoiceDraft.tenders[Number(t.dataset.invTender)]; if (tender && t.dataset.invTenderField === 'amount') { tender.amount = t.value === '' ? 0 : Number(t.value); renderInvoiceTendersStatus(); } }
  if (t.id === 'wasteQty') updateWasteValue(); if (t.dataset.countItem !== undefined) updateCountTotals();
  if (t.id === 'invoiceSearch') { invoiceFilter.q = t.value; renderInvoices(); }
}
function handleModuleChange(event) {
  const t = event.target;
  if (t.dataset.invTender !== undefined && t.dataset.invTenderField === 'method' && invoiceDraft) { const tender = invoiceDraft.tenders[Number(t.dataset.invTender)]; if (tender) tender.method = t.value; }
  if (t.id === 'wasteItem') updateWasteValue();
  if (t.id === 'invoiceDate') { invoiceFilter.date = t.value || 'all'; renderInvoices(); }
  if (t.id === 'invoiceMethod') { invoiceFilter.method = t.value; renderInvoices(); }
  if (t.id === 'backupOnClose' || t.id === 'backupDaily') { if (!can('backup')) { renderBackupCard(); return deny(); } const s = backupSettings(); s[t.id === 'backupOnClose' ? 'onClose' : 'daily'] = t.checked; saveState(); showToast('Preferencia de respaldo guardada.'); }
}
function handleLoginKeys(event) {
  if (!document.querySelector('#loginDialog').open || !loginTarget) return;
  if (/^\d$/.test(event.key)) { event.preventDefault(); pressPin(event.key); } else if (event.key === 'Backspace') { event.preventDefault(); pressPin('back'); }
}
function initModules() {
  ['openPayment', 'confirmPayment'].forEach(n => guard(n, 'charge'));
  ['openShiftDialog', 'openCloseDialog', 'confirmOpenShift', 'confirmClose'].forEach(n => guard(n, 'shift'));
  ['openProductDialog', 'saveProduct', 'deleteProduct', 'openImportProductsDialog'].forEach(n => guard(n, 'products'));
  ['openTablesDialog', 'addTable', 'saveTable', 'deleteTable'].forEach(n => guard(n, 'tables'));
  ['openCategoriesDialog', 'addCategory', 'saveCategory', 'deleteCategory'].forEach(n => guard(n, 'categories'));
  ['saveProfile'].forEach(n => guard(n, 'profile')); ['exportBackup', 'importBackup'].forEach(n => guard(n, 'backup'));
  ['openPurchaseDialog', 'savePurchase', 'openExpenseDialog', 'saveExpense'].forEach(n => guard(n, 'purchases'));
  ['openInventoryDialog', 'saveInventory'].forEach(n => guard(n, 'inventory')); guard('deleteCurrentOrder', 'cancelOrder');
  const closeShift = globalThis.confirmClose; // al cerrar caja se respalda toda la base de datos
  globalThis.confirmClose = function (...args) { const wasOpen = isShiftOpen(), result = closeShift.apply(this, args); if (wasOpen && !isShiftOpen() && backupSettings().onClose) runBackup('Cierre de caja', 'cierre', true); return result; };
  document.addEventListener('click', handleModuleClick); document.addEventListener('input', handleModuleInput); document.addEventListener('change', handleModuleChange); document.addEventListener('keydown', handleLoginKeys);
  document.querySelector('#loginDialog').addEventListener('cancel', e => e.preventDefault());
  document.querySelector('#pinDialog').addEventListener('cancel', e => { if (forcedPinChange) e.preventDefault(); });
  if (typeof isDemoMode === 'function' && isDemoMode()) {
    const guest = state.users.find(u => u.id === 'u_demo_guest') || state.users[0];
    if (guest) {
      session = guest.id;
      applyPermissions();
      renderAll();
      const loginDlg = document.querySelector('#loginDialog');
      if (loginDlg && loginDlg.open) loginDlg.close();
    }
    return;
  }
  const saved = sessionStorage.getItem('brasa-session');
  if (saved && state.users.some(u => u.id === saved && u.active !== false)) { session = saved; applyPermissions(); renderAll(); if (me().mustChangePin) openPinDialog(true); } else showLogin();
}
globalThis.initModules = initModules;
