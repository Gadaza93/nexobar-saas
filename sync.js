// Motor de sincronización NexoBar
const SUPABASE_URL = "https://fthjtbhxqqzqpyhtynaa.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qg2FVUMhBsIshhIRCOGISg_vLF1PLuy";
const DEFAULT_BUSINESS_ID = "nexobar_default";

let syncClient = null;
let isSyncing = false;
let syncDebounceTimer = null;
let pingTimer = null;
let realtimeChannel = null;
let deletedProductIds = [];
let deletedSaleIds = [];

function loadDeletedIds() {
  try {
    const rawProd = typeof localStorage !== "undefined" ? localStorage.getItem("nexobar_deleted_products") : null;
    if (rawProd) deletedProductIds = JSON.parse(rawProd);
    const rawSale = typeof localStorage !== "undefined" ? localStorage.getItem("nexobar_deleted_sales") : null;
    if (rawSale) deletedSaleIds = JSON.parse(rawSale);
  } catch (e) {
    /* ignore */
  }
}

function saveDeletedIds() {
  try {
    if (typeof localStorage !== "undefined") {
      localStorage.setItem("nexobar_deleted_products", JSON.stringify(deletedProductIds));
      localStorage.setItem("nexobar_deleted_sales", JSON.stringify(deletedSaleIds));
    }
  } catch (e) {
    /* ignore */
  }
}

loadDeletedIds();

function isPendingSync(item) {
  if (!item) return false;
  return item.sync_status === "nuevo_local" || item.sync_status === "pending";
}

const syncState = {
  status: "offline",
  online: (typeof navigator !== "undefined" && navigator.onLine === false) ? false : true,
  lastSyncAt: null,
  pendingCount: 0,
  lastError: null
};

// 1. Helper de fechas ISO 8601
function toIsoDate(val) {
  if (val === null || val === undefined || val === "") {
    return new Date().toISOString();
  }
  if (val instanceof Date) {
    return Number.isNaN(val.getTime()) ? new Date().toISOString() : val.toISOString();
  }
  if (typeof val === "number") {
    const num = Math.floor(val);
    const ms = String(num).length === 10 ? num * 1000 : num;
    const d = new Date(ms);
    return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
  }
  if (typeof val === "string") {
    const trimmed = val.trim();
    if (/^\d{10,15}$/.test(trimmed)) {
      const num = Number(trimmed);
      const ms = trimmed.length === 10 ? num * 1000 : num;
      const d = new Date(ms);
      return Number.isNaN(d.getTime()) ? new Date().toISOString() : d.toISOString();
    }
    if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
      return `${trimmed}T12:00:00.000Z`;
    }
    const d = new Date(trimmed);
    if (!Number.isNaN(d.getTime())) {
      return d.toISOString();
    }
  }
  const fallback = Number(val);
  return new Date(Number.isNaN(fallback) || !fallback ? Date.now() : fallback).toISOString();
}

const toValidISOString = toIsoDate;

function getBusinessId() {
  try {
    if (typeof state !== "undefined" && state?.profile?.syncId) {
      const id = String(state.profile.syncId).trim();
      if (id) return id;
    }
    if (typeof state !== "undefined" && state?.profile?.nit) {
      const cleanNit = String(state.profile.nit).replace(/\D/g, "");
      if (cleanNit) return `bar_${cleanNit}`;
    }
  } catch (e) {
    /* ignore */
  }
  return DEFAULT_BUSINESS_ID;
}

function getClient() {
  if (syncClient) return syncClient;
  try {
    const sbFactory = (typeof window !== "undefined" && window.supabase) || (typeof globalThis !== "undefined" && globalThis.supabase);
    if (sbFactory && typeof sbFactory.createClient === "function") {
      syncClient = sbFactory.createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
        auth: {
          persistSession: false,
          autoRefreshToken: false,
          detectSessionInUrl: false
        }
      });
    }
  } catch (err) {
    console.warn("[NexoSync] Error al crear cliente Supabase:", err);
    syncClient = null;
  }
  return syncClient;
}

// 2. Sanitizadores previos antes de cada upsert
function sanitizeProducto(p, bId) {
  const inv = (typeof state !== "undefined" && state?.inventory?.find(i => i.id === p.inventoryId || i.id === `stock-${p.id}`)) || {};
  const currentStock = Number((p.stock != null ? p.stock : inv.qty) ?? 0);
  return {
    id: String(p.id || `prod_${Date.now()}`),
    business_id: String(bId || DEFAULT_BUSINESS_ID),
    nombre: p.name || p.nombre || "Producto",
    categoria: p.category || p.categoria || "Otros",
    precio: Number(p.price ?? p.precio ?? 0),
    costo: Number(p.cost ?? p.costo ?? 0),
    stock: currentStock,
    min_stock: Number(inv.min ?? p.min_stock ?? 5),
    activo: p.active !== false && p.activo !== false,
    created_at: toIsoDate(p.createdAt || p.created_at || Date.now()),
    updated_at: toIsoDate(p.updated_at || p.updatedAt || Date.now())
  };
}

function sanitizeVenta(p, bId) {
  const pays = Array.isArray(p.payments) ? p.payments : [];
  const itemsList = Array.isArray(p.items) ? p.items : [];
  const primaryMethod = p.method || (pays.length > 0 ? pays.map(x => x.method).join(" + ") : "Efectivo");
  const cashierStr = String(p.cashierName || p.cashier || "");
  const orderIdStr = String(p.orderId || p.order_id || p.id);
  const shiftIdStr = String(p.shiftId || p.shift_id || "");
  const dateIso = toIsoDate(p.paidAt || p.createdAt || p.date || p.fecha);

  return {
    id: String(p.id || `pay_${Date.now()}`),
    business_id: String(bId || DEFAULT_BUSINESS_ID),
    order_id: orderIdStr,
    total: Number(p.amount ?? p.total ?? 0),
    method: primaryMethod,
    payments: pays,
    metodos_pago: pays,
    items: itemsList,
    customer: String(p.customer || ""),
    cashier: cashierStr,
    cajero: cashierStr,
    shift_id: shiftIdStr,
    fecha: dateIso,
    created_at: dateIso,
    updated_at: toIsoDate(p.updatedAt || p.updated_at || Date.now())
  };
}

function sanitizeGasto(g, bId) {
  const isCompra = Boolean(g.supplier || g.supplierId || g.lines);
  const cat = isCompra ? (g.category || g.categoria || `Compra: ${g.supplier || "Mercadería"}`) : (g.category || g.categoria || "Gasto operativo");
  const desc = isCompra ? (g.description || (g.invoice ? `Compra factura ${g.invoice} · ${g.supplier || "Proveedor"}` : "Compra de mercadería")) : (g.description || g.descripcion || "Gasto registrado");
  return {
    id: String(g.id || `gasto_${Date.now()}`),
    business_id: String(bId || DEFAULT_BUSINESS_ID),
    categoria: cat,
    descripcion: desc,
    monto: Number(g.amount ?? g.total ?? g.monto ?? 0),
    comprobante: String(g.invoice || g.receipt || g.comprobante || ""),
    proveedor_id: g.supplierId ? String(g.supplierId) : null,
    fecha: toIsoDate(g.date || g.fecha || g.createdAt),
    created_at: toIsoDate(g.createdAt || g.created_at || g.date || g.fecha),
    updated_at: toIsoDate(g.updatedAt || g.updated_at || Date.now())
  };
}

function sanitizeProveedor(s, bId) {
  return {
    id: String(s.id || `prov_${Date.now()}`),
    business_id: String(bId || DEFAULT_BUSINESS_ID),
    nombre: s.name || s.nombre || "Proveedor",
    telefono: s.phone || s.telefono || "",
    contacto: s.nit || s.contacto || "",
    direccion: s.address || s.direccion || "",
    notas: s.notes || s.notas || "",
    email: s.email || "",
    created_at: toIsoDate(s.createdAt || s.created_at || Date.now()),
    updated_at: toIsoDate(s.updatedAt || s.updated_at || Date.now())
  };
}

function sanitizeMerma(l, bId) {
  return {
    id: String(l.id || `merma_${Date.now()}`),
    business_id: String(bId || DEFAULT_BUSINESS_ID),
    producto_id: String(l.itemId || l.productId || l.producto_id || ""),
    producto_nombre: l.itemName || l.productName || l.producto_nombre || "Producto",
    cantidad: Math.abs(Number(l.delta ?? l.cantidad ?? 1)),
    motivo: l.reasonCategory || l.reason || l.motivo || "Rotura / Merma",
    observacion: l.note || l.observacion || "",
    fecha: toIsoDate(l.at || l.date || l.fecha || l.createdAt),
    created_at: toIsoDate(l.at || l.date || l.createdAt || l.created_at),
    updated_at: toIsoDate(l.updatedAt || l.updated_at || Date.now())
  };
}

function sanitizeNegocio(profile, bId) {
  const prof = profile || {};
  const admin = (typeof state !== "undefined" && Array.isArray(state.users)) ? state.users.find(u => u.role === "admin") : null;
  const adminPin = prof.admin_pin || prof.adminPin || (admin && !admin.mustChangePin && toCyrb53Hash(`${admin.salt}:2013`) === admin.pinHash ? "2013" : "");

  return {
    id: String(bId || DEFAULT_BUSINESS_ID),
    nombre: prof.name || prof.nombre || "NexoBar",
    telefono: prof.phone || prof.ownerPhone || prof.telefono || "",
    configuracion: {
      ...prof,
      cashShift: (typeof state !== "undefined" && state?.cashShift) ? state.cashShift : { status: "closed" },
      ...(adminPin ? { admin_pin: adminPin, adminPin: adminPin } : {}),
      ...(admin ? { admin_salt: admin.salt, admin_hash: admin.pinHash, mustChangePin: Boolean(admin.mustChangePin) } : {})
    },
    created_at: toIsoDate(prof.createdAt || prof.created_at || Date.now()),
    updated_at: toIsoDate(prof.updatedAt || prof.updated_at || Date.now())
  };
}

function countPendingRecords() {
  if (typeof state === "undefined" || !state) return 0;
  let count = 0;
  try {
    if (Array.isArray(state.products)) {
      count += state.products.filter(isPendingSync).length;
    }
    if (Array.isArray(state.payments)) {
      count += state.payments.filter(isPendingSync).length;
    }
    if (Array.isArray(state.expenses)) {
      count += state.expenses.filter(isPendingSync).length;
    }
    if (Array.isArray(state.purchases)) {
      count += state.purchases.filter(isPendingSync).length;
    }
    if (Array.isArray(state.suppliers)) {
      count += state.suppliers.filter(isPendingSync).length;
    }
    if (Array.isArray(state.stockLog)) {
      count += state.stockLog.filter(isPendingSync).length;
    }
    if (state.profile && isPendingSync(state.profile)) {
      count += 1;
    }
    count += deletedProductIds.length;
    count += deletedSaleIds.length;
  } catch (e) {
    /* ignore */
  }
  return count;
}

function updateIndicator(status) {
  syncState.status = status;
  syncState.pendingCount = countPendingRecords();

  const sidebarInd = document.querySelector("#syncStatusIndicator");
  const sidebarLabel = document.querySelector("#syncLabel");

  const topbarInd = document.querySelector("#syncBadgeTopbar");
  const topbarLabel = document.querySelector("#syncBadgeLabel");

  let labelText = "";
  let topbarText = "";
  let tooltip = "";
  let statusClass = "";

  if (status === "synced") {
    statusClass = "is-synced";
    labelText = "En línea / Sincronizado";
    topbarText = "En línea / Sincronizado";
    const timeStr = syncState.lastSyncAt ? new Date(syncState.lastSyncAt).toLocaleTimeString("es-CO") : "Reciente";
    tooltip = `Conexión activa con Supabase (${timeStr}). Sin cambios pendientes.`;
  } else if (status === "syncing") {
    statusClass = "is-syncing";
    labelText = "Sincronizando...";
    topbarText = "Sincronizando...";
    tooltip = `Sincronizando datos con la nube (${syncState.pendingCount} pendientes)...`;
  } else {
    statusClass = "is-offline";
    labelText = "Modo Offline";
    topbarText = "Modo Offline";
    tooltip = "Modo sin conexión. El sistema opera 100% local sin riesgo.";
  }

  if (sidebarInd) {
    sidebarInd.className = `sync-state ${statusClass}`;
    sidebarInd.title = tooltip;
  }
  if (sidebarLabel) {
    sidebarLabel.textContent = labelText;
  }

  if (topbarInd) {
    topbarInd.className = `sync-badge-topbar ${statusClass}`;
    topbarInd.title = tooltip;
  }
  if (topbarLabel) {
    topbarLabel.textContent = topbarText;
  }
}

async function checkInitialConnection() {
  const sb = getClient();
  if (!sb) {
    updateIndicator("offline");
    return false;
  }
  try {
    const { error } = await sb.from("productos").select("id", { count: "exact", head: true });
    if (!error) {
      syncState.online = true;
      syncState.lastSyncAt = Date.now();
      updateIndicator("synced");
      return true;
    }
    updateIndicator("offline");
    return false;
  } catch (err) {
    updateIndicator("offline");
    return false;
  }
}

function scheduleSync(delay = 1000) {
  clearTimeout(syncDebounceTimer);
  syncDebounceTimer = setTimeout(() => {
    syncAll().catch(() => {});
  }, delay);
}

async function deleteProduct(productId) {
  if (!productId) return { ok: false, error: "ID de producto vacio" };
  const cleanId = String(productId);
  if (!deletedProductIds.includes(cleanId)) {
    deletedProductIds.push(cleanId);
    saveDeletedIds();
  }

  const sb = getClient();
  const isOff = typeof navigator !== "undefined" && navigator.onLine === false;
  if (sb && !isOff && syncState.online !== false) {
    try {
      const { error: delErr } = await sb.from("productos").delete().eq("id", cleanId);
      if (!delErr) {
        deletedProductIds = deletedProductIds.filter(id => id !== cleanId);
        saveDeletedIds();
        console.log(`[NexoSync] ✅ Producto '${cleanId}' eliminado de inmediato en Supabase.`);
        updateIndicator(syncState.status);
        return { ok: true, id: cleanId };
      }
      console.warn(`[NexoSync] ⚠️ Error al eliminar producto en Supabase:`, delErr.message);
    } catch (err) {
      console.warn(`[NexoSync] ⚠️ Excepcion al eliminar producto en Supabase:`, err.message);
    }
  }

  scheduleSync(500);
  return { ok: true, queued: true, id: cleanId };
}

function trackProductDeletion(productId) {
  deleteProduct(productId).catch(() => {});
}

async function deleteSale(saleId) {
  if (!saleId) return { ok: false, error: "ID de venta vacio" };
  const cleanId = String(saleId);
  if (!deletedSaleIds.includes(cleanId)) {
    deletedSaleIds.push(cleanId);
    saveDeletedIds();
  }

  const sb = getClient();
  const isOff = typeof navigator !== "undefined" && navigator.onLine === false;
  if (sb && !isOff && syncState.online !== false) {
    try {
      const { error: delErr } = await sb.from("ventas").delete().eq("id", cleanId);
      if (!delErr) {
        deletedSaleIds = deletedSaleIds.filter(id => id !== cleanId);
        saveDeletedIds();
        console.log(`[NexoSync] ✅ Venta '${cleanId}' eliminada de inmediato en Supabase.`);
        updateIndicator(syncState.status);
        return { ok: true, id: cleanId };
      }
      console.warn(`[NexoSync] ⚠️ Error al eliminar venta en Supabase:`, delErr.message);
    } catch (err) {
      console.warn(`[NexoSync] ⚠️ Excepcion al eliminar venta en Supabase:`, err.message);
    }
  }

  scheduleSync(500);
  return { ok: true, queued: true, id: cleanId };
}

// Sincronización dedicada de productos e inventario con Supabase
async function syncProductos(options = {}) {
  const sb = getClient();
  if (!sb) {
    console.warn("[NexoSync] syncProductos: Cliente Supabase no inicializado.");
    return { ok: false, error: "Cliente no inicializado" };
  }
  const bId = getBusinessId();
  try {
    // 1. Replicar eliminaciones de productos pendientes hacia Supabase primero
    if (deletedProductIds.length > 0) {
      try {
        const idsToDelete = [...deletedProductIds];
        const { error: delErr } = await sb.from("productos").delete().in("id", idsToDelete);
        if (!delErr) {
          deletedProductIds = deletedProductIds.filter(id => !idsToDelete.includes(id));
          saveDeletedIds();
          console.log(`[NexoSync] ✅ Eliminaciones de productos procesadas: ${idsToDelete.length} en Supabase.`);
        }
      } catch (e) {
        /* ignore */
      }
    }

    // 2. Filtrar únicamente productos locales marcados como nuevo_local o pending
    const rawProds = (typeof state !== "undefined" && Array.isArray(state.products)) ? state.products : [];
    const prods = rawProds.filter(p => options.force || isPendingSync(p));
    if (prods.length > 0) {
      const records = prods.map(p => sanitizeProducto(p, bId));
      const { error: prodErr } = await sb.from("productos").upsert(records, { onConflict: "id" });
      if (prodErr) {
        console.warn("[NexoSync] ⚠️ Productos:", prodErr.message);
        return { ok: false, count: prods.length, error: prodErr.message };
      }
      prods.forEach(p => { p.sync_status = "synced"; });
      console.log(`[NexoSync] ✅ Productos: ${records.length} sincronizados.`);
      return { ok: true, count: records.length };
    }
    console.log("[NexoSync] ℹ️ Productos: 0 pendientes.");
    return { ok: true, count: 0 };
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Productos excepción:", err.message);
    return { ok: false, error: err.message };
  }
}

// Sincronización inmediata de una venta individual y actualización de stock de sus productos en Supabase
async function syncSale(sale) {
  const sb = getClient();
  if (!sb || !sale) return { ok: false, error: "Cliente no inicializado o venta vacía" };
  const bId = getBusinessId();
  try {
    const saleRecord = sanitizeVenta(sale, bId);
    const { error: saleErr } = await sb.from("ventas").upsert(saleRecord, { onConflict: "id" });
    if (saleErr) {
      console.error(`[NexoSync] ❌ Error exacto al subir venta '${sale.id}':`, saleErr.message || saleErr, saleRecord);
      return { ok: false, error: saleErr.message };
    }
    sale.sync_status = "synced";
    sale.synced = true;

    // Actualizar de inmediato en Supabase el stock de los productos vendidos
    if (Array.isArray(sale.items) && sale.items.length > 0 && typeof state !== "undefined" && Array.isArray(state.products)) {
      const pIds = new Set();
      sale.items.forEach(it => {
        const id = it.productId || it.id;
        if (id) pIds.add(String(id));
      });
      const affectedProds = state.products.filter(p => pIds.has(String(p.id)));
      if (affectedProds.length > 0) {
        const prodRecords = affectedProds.map(p => sanitizeProducto(p, bId));
        const { error: prodErr } = await sb.from("productos").upsert(prodRecords, { onConflict: "id" });
        if (prodErr) {
          console.warn("[NexoSync] ⚠️ Error actualizando stock tras syncSale:", prodErr.message);
        } else {
          affectedProds.forEach(p => { p.sync_status = "synced"; p.synced = true; });
          console.log(`[NexoSync] ✅ Stock en Supabase actualizado para ${prodRecords.length} productos tras venta.`);
        }
      }
    }

    if (typeof scheduleSave === "function") scheduleSave();
    updateIndicator("synced");
    return { ok: true };
  } catch (err) {
    console.error("[NexoSync] ❌ syncSale excepción:", err.message);
    return { ok: false, error: err.message };
  }
}

// Sincronización del estado de apertura / cierre de caja con Supabase (negocios, turnos_caja, cajas)
async function syncCashShift(shift) {
  const sb = getClient();
  if (!sb) {
    console.warn("[NexoSync] syncCashShift: Cliente Supabase no inicializado.");
    return { ok: false, error: "Cliente no inicializado" };
  }
  const bId = getBusinessId();
  const currentShift = shift || ((typeof state !== "undefined" && state?.cashShift) ? state.cashShift : { status: "closed" });

  try {
    // 1. Persistir de forma segura en 'negocios' (configuracion.cashShift JSONB)
    const prof = (typeof state !== "undefined" && state?.profile) ? state.profile : {};
    const businessPayload = {
      id: String(bId || DEFAULT_BUSINESS_ID),
      nombre: prof.name || prof.nombre || "NexoBar",
      telefono: prof.phone || prof.ownerPhone || prof.telefono || "",
      configuracion: {
        ...prof,
        cashShift: currentShift
      },
      updated_at: new Date().toISOString()
    };

    const { error: negErr } = await sb.from("negocios").upsert(businessPayload, { onConflict: "id" });
    if (negErr) {
      console.warn("[NexoSync] ⚠️ Error sincronizando cashShift en negocios:", negErr.message);
    } else {
      console.log(`[NexoSync] ✅ Turno de caja sincronizado en Supabase ('negocios'): ${currentShift.status}`);
    }

    // 2. Soporte para tabla 'turnos_caja' con columnas business_id, estado, monto_apertura, fecha_apertura
    try {
      const shiftRecord = {
        id: String(currentShift.id || `shift_${Date.now()}`),
        business_id: String(bId || DEFAULT_BUSINESS_ID),
        estado: String(currentShift.status || "closed"),
        monto_apertura: Number(currentShift.openingCash ?? 0),
        fecha_apertura: toIsoDate(currentShift.openedAt || Date.now()),
        fecha_cierre: currentShift.closedAt ? toIsoDate(currentShift.closedAt) : null,
        created_at: toIsoDate(currentShift.openedAt || Date.now()),
        updated_at: new Date().toISOString()
      };
      const { error: tcErr } = await sb.from("turnos_caja").upsert(shiftRecord, { onConflict: "id" });
      if (!tcErr) {
        console.log("[NexoSync] ✅ Turno de caja registrado en tabla 'turnos_caja'.");
      }
    } catch (e) {
      /* ignore si la tabla opcional turnos_caja no existe */
    }

    // 3. Soporte para tabla 'cajas' con columnas business_id, estado, monto_apertura, fecha_apertura
    try {
      const cajaRecord = {
        id: String(currentShift.id || `caja_${Date.now()}`),
        business_id: String(bId || DEFAULT_BUSINESS_ID),
        estado: String(currentShift.status || "closed"),
        monto_apertura: Number(currentShift.openingCash ?? 0),
        fecha_apertura: toIsoDate(currentShift.openedAt || Date.now()),
        fecha_cierre: currentShift.closedAt ? toIsoDate(currentShift.closedAt) : null,
        created_at: toIsoDate(currentShift.openedAt || Date.now()),
        updated_at: new Date().toISOString()
      };
      const { error: cErr } = await sb.from("cajas").upsert(cajaRecord, { onConflict: "id" });
      if (!cErr) {
        console.log("[NexoSync] ✅ Turno de caja registrado en tabla 'cajas'.");
      }
    } catch (e) {
      /* ignore si la tabla opcional cajas no existe */
    }

    return { ok: true, status: currentShift.status };
  } catch (err) {
    console.warn("[NexoSync] ⚠️ syncCashShift excepción:", err.message);
    return { ok: false, error: err.message };
  }
}

// Algoritmo hash compatible cyrb53 sin caracteres menor que
function toCyrb53Hash(str, seed = 0) {
  let h1 = 0xdeadbeef ^ seed, h2 = 0x41c6ce57 ^ seed;
  for (let i = 0; str.length > i; i++) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  return (4294967296 * (2097151 & h2) + (h1 >>> 0)).toString(36);
}

// Actualizar el PIN de administrador en la memoria local y cache sin alterar el flujo offline
function applyAdminPinLocally(pin, salt, hash) {
  if (!pin || typeof state === "undefined" || !state) return;
  if (!Array.isArray(state.users)) state.users = [];

  let admin = state.users.find(u => u.role === "admin");
  if (!admin) {
    admin = {
      id: `usr_${Date.now()}`,
      name: "Administrador",
      role: "admin",
      active: true,
      createdAt: Date.now()
    };
    state.users.push(admin);
  }

  const cleanPin = String(pin).trim();
  const s = salt || admin.salt || Math.random().toString(36).slice(2, 10);
  const h = toCyrb53Hash(`${s}:${cleanPin}`);

  admin.salt = s;
  admin.pinHash = h;
  admin.mustChangePin = false;

  if (state.profile) {
    state.profile.admin_pin = cleanPin;
    state.profile.adminPin = cleanPin;
  }

  const pinDlg = typeof document !== "undefined" ? document.querySelector("#pinDialog") : null;
  if (pinDlg && pinDlg.open && typeof forcedPinChange !== "undefined" && !forcedPinChange) {
    try { pinDlg.close(); } catch (e) { /* ignore */ }
  }

  if (typeof renderLogin === "function") {
    try { renderLogin(); } catch (e) { /* ignore */ }
  }
  if (typeof saveState === "function") saveState();
  if (typeof scheduleSave === "function") scheduleSave();
}

// Sincronización del PIN de Administrador con Supabase (negocios.configuracion.admin_pin)
async function syncAdminPin(pin, user) {
  const sb = getClient();
  if (!sb || !pin) return { ok: false, error: "Cliente Supabase no disponible o PIN vacío" };
  const bId = getBusinessId();
  const cleanPin = String(pin).trim();
  const u = user || ((typeof state !== "undefined" && Array.isArray(state.users)) ? state.users.find(x => x.role === "admin") : null);
  const salt = u?.salt || Math.random().toString(36).slice(2, 10);
  const hash = toCyrb53Hash(`${salt}:${cleanPin}`);

  // Actualizar primero en la base local (offline-first)
  applyAdminPinLocally(cleanPin, salt, hash);

  try {
    const prof = (typeof state !== "undefined" && state?.profile) ? state.profile : {};
    const currentShift = (typeof state !== "undefined" && state?.cashShift) ? state.cashShift : { status: "closed" };
    const updatedConfig = {
      ...prof,
      admin_pin: cleanPin,
      adminPin: cleanPin,
      admin_salt: salt,
      admin_hash: hash,
      mustChangePin: false,
      cashShift: currentShift
    };

    const businessPayload = {
      id: String(bId || DEFAULT_BUSINESS_ID),
      nombre: prof.name || prof.nombre || "NexoBar",
      telefono: prof.phone || prof.ownerPhone || prof.telefono || "",
      configuracion: updatedConfig,
      updated_at: new Date().toISOString()
    };

    // 1. Intentar persistir con columna opcional 'admin_pin' en la tabla negocios
    try {
      const { error: colErr } = await sb.from("negocios").upsert({ ...businessPayload, admin_pin: cleanPin }, { onConflict: "id" });
      if (!colErr) {
        console.log("[NexoSync] ✅ PIN de admin sincronizado en columna 'admin_pin' de Supabase.");
        return { ok: true, pin: cleanPin };
      }
    } catch (e) {
      /* ignore si la columna directa no existe */
    }

    // 2. Persistir en la columna JSONB 'configuracion' (siempre compatible)
    const { error: negErr } = await sb.from("negocios").upsert(businessPayload, { onConflict: "id" });
    if (negErr) {
      console.warn("[NexoSync] ⚠️ Error sincronizando admin_pin en negocios:", negErr.message);
      return { ok: false, error: negErr.message };
    }

    console.log("[NexoSync] ✅ PIN de administración sincronizado exitosamente en Supabase ('negocios').");
    return { ok: true, pin: cleanPin };
  } catch (err) {
    console.warn("[NexoSync] ⚠️ syncAdminPin excepción:", err.message);
    return { ok: false, error: err.message };
  }
}

// Sincronización dedicada de ventas (pushSales): contrasta ventas locales con Supabase y sube las pendientes
async function syncSales(options = {}) {
  const sb = getClient();
  if (!sb) {
    console.warn("[NexoSync] syncSales: Cliente Supabase no inicializado.");
    return { ok: false, error: "Cliente no inicializado" };
  }
  const bId = getBusinessId();
  try {
    // 1. Replicar eliminaciones de ventas pendientes hacia Supabase primero
    if (deletedSaleIds.length > 0) {
      try {
        const idsToDelete = [...deletedSaleIds];
        const { error: delErr } = await sb.from("ventas").delete().in("id", idsToDelete);
        if (!delErr) {
          deletedSaleIds = deletedSaleIds.filter(id => !idsToDelete.includes(id));
          saveDeletedIds();
          console.log(`[NexoSync] ✅ Eliminaciones de ventas procesadas: ${idsToDelete.length} en Supabase.`);
        }
      } catch (e) {
        /* ignore */
      }
    }

    // 2. Tomar únicamente ventas locales marcadas como nuevo_local o pending
    const rawSales = (typeof state !== "undefined" && Array.isArray(state.payments)) ? state.payments : [];
    const sales = rawSales.filter(p => options.force || isPendingSync(p));

    if (sales.length > 0) {
      console.log(`[NexoSync] 📤 Subiendo ${sales.length} ventas locales hacia Supabase...`);
      const records = sales.map(p => sanitizeVenta(p, bId));

      // Intento por lote primero
      const { error: saleErr } = await sb.from("ventas").upsert(records, { onConflict: "id" });

      if (!saleErr) {
        sales.forEach(p => {
          p.sync_status = "synced";
          p.synced = true;
        });
        console.log(`[NexoSync] ✅ Ventas: ${records.length} sincronizadas por lote.`);
      } else {
        console.warn("[NexoSync] ⚠️ Error en subida por lote de ventas:", saleErr.message || saleErr);
        console.log("[NexoSync] 🔁 Reintentando subida individual para depurar cada venta...");

        let successCount = 0;
        let failCount = 0;

        for (let i = 0; sales.length > i; i++) {
          const saleItem = sales[i];
          const singleRecord = sanitizeVenta(saleItem, bId);
          try {
            const { error: singleErr } = await sb.from("ventas").upsert(singleRecord, { onConflict: "id" });
            if (singleErr) {
              console.error(`[NexoSync] ❌ Error exacto al subir venta ID '${saleItem.id}':`, singleErr.message || singleErr, singleRecord);
              failCount++;
            } else {
              saleItem.sync_status = "synced";
              saleItem.synced = true;
              successCount++;
            }
          } catch (ex) {
            console.error(`[NexoSync] ❌ Excepción al subir venta ID '${saleItem.id}':`, ex.message, singleRecord);
            failCount++;
          }
        }

        console.log(`[NexoSync] 📊 Resultado individual: ${successCount} exitosas, ${failCount} con error.`);
        if (0 >= successCount && failCount > 0) {
          return { ok: false, count: 0, failed: failCount, error: saleErr.message };
        }
      }

      // Actualizar stock en Supabase de los productos incluidos en las ventas sincronizadas
      const affectedProductIds = new Set();
      sales.forEach(s => {
        if (s.sync_status === "synced" && Array.isArray(s.items)) {
          s.items.forEach(it => {
            const pid = it.productId || it.id;
            if (pid) affectedProductIds.add(String(pid));
          });
        }
      });

      if (affectedProductIds.size > 0 && typeof state !== "undefined" && Array.isArray(state.products)) {
        const prodsToUpsert = state.products.filter(p => affectedProductIds.has(String(p.id)));
        if (prodsToUpsert.length > 0) {
          const prodRecords = prodsToUpsert.map(p => sanitizeProducto(p, bId));
          const { error: pErr } = await sb.from("productos").upsert(prodRecords, { onConflict: "id" });
          if (!pErr) {
            prodsToUpsert.forEach(p => { p.sync_status = "synced"; p.synced = true; });
            console.log(`[NexoSync] ✅ Stock en Supabase actualizado para ${prodRecords.length} productos vendidos.`);
          } else {
            console.warn("[NexoSync] ⚠️ Error actualizando stock de productos tras ventas:", pErr.message);
          }
        }
      }

      const totalOk = sales.filter(s => s.sync_status === "synced").length;
      return { ok: true, count: totalOk };
    }

    console.log("[NexoSync] ℹ️ Ventas: 0 pendientes.");
    return { ok: true, count: 0 };
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Ventas excepción:", err.message);
    return { ok: false, error: err.message };
  }
}

const pushSales = syncSales;

// 4. Método global syncAll(): sincronización secuencial de todas las colecciones con console.log de resultados
async function syncAll(options = {}) {
  if (isSyncing) return { ok: false, error: "Sync already in progress" };
  const sb = getClient();
  if (!sb) {
    console.error("[NexoSync] Error: Cliente Supabase no inicializado.");
    updateIndicator("offline");
    return { ok: false, error: "Cliente no inicializado" };
  }

  isSyncing = true;
  updateIndicator("syncing");
  const bId = getBusinessId();
  const results = {};

  console.log(`[NexoSync] 🚀 Iniciando sincronización completa para negocio: '${bId}'...`);

  // --- 1. NEGOCIOS ---
  try {
    if (typeof state !== "undefined" && state?.profile && (options.force || state.profile.sync_status === "pending" || !state.profile.sync_status)) {
      const payload = sanitizeNegocio(state.profile, bId);
      const { error: profErr } = await sb.from("negocios").upsert(payload, { onConflict: "id" });
      if (profErr) {
        console.warn("[NexoSync] ⚠️ Negocios:", profErr.message);
        results.negocios = { ok: false, error: profErr.message };
      } else {
        if (state?.profile) state.profile.sync_status = "synced";
        console.log("[NexoSync] ✅ Negocios: Sincronizado.");
        results.negocios = { ok: true };
      }
    } else {
      results.negocios = { ok: true, count: 0 };
    }
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Negocios excepción:", err.message);
    results.negocios = { ok: false, error: err.message };
  }

  // --- 2. PRODUCTOS ---
  results.productos = await syncProductos(options);

  // --- 3. VENTAS (syncSales / pushSales) ---
  results.ventas = await syncSales(options);

  // --- 4. GASTOS / COMPRAS ---
  try {
    const expensesList = (typeof state !== "undefined" && Array.isArray(state.expenses)) ? state.expenses : [];
    const purchasesList = (typeof state !== "undefined" && Array.isArray(state.purchases)) ? state.purchases : [];
    const rawExpenses = [...expensesList, ...purchasesList];
    const pendingExpenses = rawExpenses.filter(g => options.force || isPendingSync(g));
    if (pendingExpenses.length > 0) {
      const records = pendingExpenses.map(g => sanitizeGasto(g, bId));
      const { error: gastoErr } = await sb.from("gastos").upsert(records, { onConflict: "id" });
      if (gastoErr) {
        console.warn("[NexoSync] ⚠️ Gastos / Compras:", gastoErr.message);
        results.gastos = { ok: false, count: pendingExpenses.length, error: gastoErr.message };
      } else {
        pendingExpenses.forEach(g => { g.sync_status = "synced"; });
        console.log(`[NexoSync] ✅ Gastos / Compras: ${records.length} sincronizados.`);
        results.gastos = { ok: true, count: records.length };
      }
    } else {
      console.log("[NexoSync] ℹ️ Gastos / Compras: 0 pendientes.");
      results.gastos = { ok: true, count: 0 };
    }
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Gastos / Compras excepción:", err.message);
    results.gastos = { ok: false, error: err.message };
  }

  // --- 5. PROVEEDORES ---
  try {
    const rawSups = (typeof state !== "undefined" && Array.isArray(state.suppliers)) ? state.suppliers : [];
    const sups = rawSups.filter(s => options.force || isPendingSync(s));
    if (sups.length > 0) {
      const records = sups.map(s => sanitizeProveedor(s, bId));
      const { error: supErr } = await sb.from("proveedores").upsert(records, { onConflict: "id" });
      if (supErr) {
        console.warn("[NexoSync] ⚠️ Proveedores:", supErr.message);
        results.proveedores = { ok: false, count: sups.length, error: supErr.message };
      } else {
        sups.forEach(s => { s.sync_status = "synced"; });
        console.log(`[NexoSync] ✅ Proveedores: ${records.length} sincronizados.`);
        results.proveedores = { ok: true, count: records.length };
      }
    } else {
      console.log("[NexoSync] ℹ️ Proveedores: 0 pendientes.");
      results.proveedores = { ok: true, count: 0 };
    }
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Proveedores excepción:", err.message);
    results.proveedores = { ok: false, error: err.message };
  }

  // --- 6. MERMAS ---
  try {
    const stockLogs = (typeof state !== "undefined" && Array.isArray(state.stockLog)) ? state.stockLog : [];
    const rawMermas = stockLogs.filter(l => l.delta && String(l.delta).startsWith("-"));
    const pendingMermas = rawMermas.filter(l => options.force || isPendingSync(l));
    if (pendingMermas.length > 0) {
      const records = pendingMermas.map(l => sanitizeMerma(l, bId));
      const { error: mermaErr } = await sb.from("mermas").upsert(records, { onConflict: "id" });
      if (mermaErr) {
        console.warn("[NexoSync] ⚠️ Mermas:", mermaErr.message);
        results.mermas = { ok: false, count: pendingMermas.length, error: mermaErr.message };
      } else {
        pendingMermas.forEach(l => { l.sync_status = "synced"; });
        console.log(`[NexoSync] ✅ Mermas: ${records.length} sincronizadas.`);
        results.mermas = { ok: true, count: records.length };
      }
    } else {
      console.log("[NexoSync] ℹ️ Mermas: 0 pendientes.");
      results.mermas = { ok: true, count: 0 };
    }
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Mermas excepción:", err.message);
    results.mermas = { ok: false, error: err.message };
  }

  syncState.lastSyncAt = Date.now();
  syncState.lastError = null;
  isSyncing = false;
  updateIndicator("synced");

  if (typeof scheduleSave === "function") scheduleSave();
  return results;
}

const syncData = syncAll;

// 5. Descarga e hidratación completa desde Supabase (Initial Pull / Hydration)
async function pullAllFromSupabase(businessId) {
  const sb = getClient();
  if (!sb) {
    console.warn("[NexoSync] pullAllFromSupabase: Cliente Supabase no inicializado.");
    return { ok: false, error: "Cliente no inicializado" };
  }
  const bId = businessId || getBusinessId() || DEFAULT_BUSINESS_ID;
  console.log(`[NexoSync] 📥 Iniciando descarga (pull) desde Supabase para negocio: '${bId}'...`);
  updateIndicator("syncing");

  const results = {
    negocios: 0,
    productos: 0,
    ventas: 0,
    gastos: 0,
    proveedores: 0,
    mermas: 0
  };

  try {
    // 1. Negocios
    try {
      const { data: negData, error: negErr } = await sb.from("negocios").select("*").eq("id", bId).maybeSingle();
      if (!negErr && negData) {
        if (typeof state !== "undefined" && state) {
          state.profile = {
            ...state.profile,
            ...(negData.configuracion || {}),
            name: negData.nombre || state.profile?.name || "NexoBar",
            phone: negData.telefono || state.profile?.phone || "",
            syncId: bId,
            sync_status: "synced"
          };

          // Hidratar estado de apertura / cierre de caja desde la configuración remota
          if (negData.configuracion && typeof negData.configuracion.cashShift === "object" && negData.configuracion.cashShift !== null) {
            state.cashShift = negData.configuracion.cashShift;
            if (typeof renderShiftStatus === "function") {
              try { renderShiftStatus(); } catch (e) { /* ignore */ }
            }
          }

          // Centralización y descarga del PIN de Administrador desde Supabase
          const remotePin = negData.admin_pin || negData.configuracion?.admin_pin || negData.configuracion?.adminPin;
          if (remotePin) {
            applyAdminPinLocally(
              remotePin,
              negData.configuracion?.admin_salt,
              negData.configuracion?.admin_hash
            );
          }

          results.negocios = 1;
        }
      }

      // Consulta de respaldo complementaria a tabla turnos_caja (si existiera)
      try {
        const { data: shiftRows, error: sErr } = await sb.from("turnos_caja").select("*").eq("business_id", bId).order("updated_at", { ascending: false }).limit(1);
        if (!sErr && Array.isArray(shiftRows) && shiftRows.length > 0) {
          const latestShift = shiftRows[0];
          if (latestShift && typeof state !== "undefined" && state) {
            state.cashShift = {
              id: latestShift.id,
              status: latestShift.estado || latestShift.status || "closed",
              openingCash: Number(latestShift.monto_apertura ?? latestShift.opening_cash ?? 0),
              openedAt: new Date(latestShift.fecha_apertura || latestShift.opened_at || Date.now()).getTime(),
              closedAt: (latestShift.fecha_cierre || latestShift.closed_at) ? new Date(latestShift.fecha_cierre || latestShift.closed_at).getTime() : null,
              date: (latestShift.fecha_apertura || latestShift.opened_at || new Date().toISOString()).slice(0, 10)
            };
            if (typeof renderShiftStatus === "function") {
              try { renderShiftStatus(); } catch (e) { /* ignore */ }
            }
          }
        }
      } catch (e) {
        /* ignore si la tabla opcional turnos_caja no existe */
      }

      // Consulta de respaldo complementaria a tabla cajas (si existiera)
      try {
        const { data: cajaRows, error: cErr } = await sb.from("cajas").select("*").eq("business_id", bId).order("updated_at", { ascending: false }).limit(1);
        if (!cErr && Array.isArray(cajaRows) && cajaRows.length > 0) {
          const latestCaja = cajaRows[0];
          if (latestCaja && typeof state !== "undefined" && state) {
            state.cashShift = {
              id: latestCaja.id,
              status: latestCaja.estado || latestCaja.status || "closed",
              openingCash: Number(latestCaja.monto_apertura ?? latestCaja.opening_cash ?? 0),
              openedAt: new Date(latestCaja.fecha_apertura || latestCaja.opened_at || Date.now()).getTime(),
              closedAt: (latestCaja.fecha_cierre || latestCaja.closed_at) ? new Date(latestCaja.fecha_cierre || latestCaja.closed_at).getTime() : null,
              date: (latestCaja.fecha_apertura || latestCaja.opened_at || new Date().toISOString()).slice(0, 10)
            };
            if (typeof renderShiftStatus === "function") {
              try { renderShiftStatus(); } catch (e) { /* ignore */ }
            }
          }
        }
      } catch (e) {
        /* ignore si la tabla opcional cajas no existe */
      }
    } catch (e) {
      console.warn("[NexoSync] Error descargando negocio:", e.message);
    }

    // 2. Productos
    try {
      const { data: prodData, error: prodErr } = await sb.from("productos").select("*").eq("business_id", bId);
      if (!prodErr && Array.isArray(prodData)) {
        if (typeof state !== "undefined" && state) {
          if (!Array.isArray(state.products)) state.products = [];
          if (!Array.isArray(state.inventory)) state.inventory = [];
          if (!Array.isArray(state.categories)) state.categories = [];

          // Limpiar productos demo antiguos si existen
          const isLegacyDemo = state.products.length > 0 &&
            state.products.every(p => p.id && String(p.id).startsWith("p") && 5 > String(p.id).length) &&
            (!state.payments || state.payments.length === 0) &&
            (!state.purchases || state.purchases.length === 0);

          if (isLegacyDemo) {
            state.products = [];
            state.inventory = [];
          }

          // Eliminar localmente los productos que fueron borrados en Supabase (si no estan pendientes de subida)
          const remoteProdIds = new Set(prodData.map(p => String(p.id)));
          state.products = state.products.filter(p => isPendingSync(p) || remoteProdIds.has(String(p.id)));
          const validInvIds = new Set(state.products.map(p => p.inventoryId).filter(Boolean));
          state.inventory = state.inventory.filter(i => validInvIds.has(i.id));

          prodData.forEach(p => {
            if (deletedProductIds.includes(String(p.id))) {
              return; // Ignorar producto eliminado localmente
            }
            const currentStock = Number(p.stock ?? 0);
            const invId = `stock-${p.id}`;
            const existingProd = state.products.find(x => x.id === p.id);

            if (existingProd) {
              existingProd.name = p.nombre || existingProd.name;
              existingProd.category = p.categoria || existingProd.category;
              existingProd.price = Number(p.precio ?? existingProd.price ?? 0);
              existingProd.cost = Number(p.costo ?? existingProd.cost ?? 0);
              existingProd.stock = currentStock;
              existingProd.active = p.activo !== false;
              existingProd.updated_at = toIsoDate(p.updated_at);
              existingProd.sync_status = "synced";
            } else {
              state.products.push({
                id: String(p.id),
                name: p.nombre || "Producto",
                category: p.categoria || "Otros",
                price: Number(p.precio ?? 0),
                cost: Number(p.costo ?? 0),
                stock: currentStock,
                icon: "🍺",
                image: null,
                inventoryId: invId,
                recipe: { [invId]: 1 },
                active: p.activo !== false,
                createdAt: toIsoDate(p.created_at),
                created_at: toIsoDate(p.created_at),
                updated_at: toIsoDate(p.updated_at),
                sync_status: "synced"
              });
            }

            // Sincronizar insumo de inventario local correspondiente
            let invItem = state.inventory.find(i => i.id === invId || i.id === existingProd?.inventoryId);
            if (invItem) {
              invItem.name = p.nombre || invItem.name;
              invItem.qty = currentStock;
              invItem.min = Number(p.min_stock ?? invItem.min ?? 5);
            } else {
              state.inventory.push({
                id: invId,
                name: p.nombre || "Producto",
                unit: "und",
                qty: currentStock,
                min: Number(p.min_stock ?? 5)
              });
            }

            if (p.categoria && !state.categories.includes(p.categoria)) {
              state.categories.push(p.categoria);
            }
          });
          results.productos = prodData.length;
        }
      }
    } catch (e) {
      console.warn("[NexoSync] Error descargando productos:", e.message);
    }

    // 3. Ventas
    try {
      const { data: salesData, error: salesErr } = await sb.from("ventas").select("*").eq("business_id", bId);
      if (!salesErr && Array.isArray(salesData)) {
        if (typeof state !== "undefined" && state) {
          if (!Array.isArray(state.payments)) state.payments = [];

          // Eliminar localmente las ventas que fueron borradas en Supabase (si no estan pendientes)
          const remoteSaleIds = new Set(salesData.map(v => String(v.id)));
          state.payments = state.payments.filter(p => isPendingSync(p) || remoteSaleIds.has(String(p.id)));

          salesData.forEach(v => {
            if (deletedSaleIds.includes(String(v.id))) {
              return; // Ignorar venta eliminada localmente
            }
            const existingSale = state.payments.find(p => p.id === v.id);
            if (existingSale) {
              existingSale.sync_status = "synced";
              existingSale.synced = true;
            } else {
              const parsedDate = v.fecha ? String(v.fecha).slice(0, 10) : (typeof today === "function" ? today() : new Date().toISOString().slice(0, 10));
              state.payments.push({
                id: String(v.id),
                orderId: String(v.order_id || v.id),
                amount: Number(v.total ?? 0),
                method: v.method || "Efectivo",
                payments: Array.isArray(v.payments) ? v.payments : [],
                items: Array.isArray(v.items) ? v.items : [],
                customer: v.customer || "",
                cashierName: v.cashier || "",
                shiftId: String(v.shift_id || ""),
                date: parsedDate,
                paidAt: new Date(v.created_at || v.fecha || Date.now()).getTime(),
                createdAt: new Date(v.created_at || v.fecha || Date.now()).getTime(),
                created_at: toIsoDate(v.created_at || v.fecha),
                updated_at: toIsoDate(v.updated_at),
                sync_status: "synced",
                synced: true
              });
            }
          });
          results.ventas = salesData.length;
        }
      }
    } catch (e) {
      console.warn("[NexoSync] Error descargando ventas:", e.message);
    }

    // 4. Gastos / Compras
    try {
      const { data: gastosData, error: gastosErr } = await sb.from("gastos").select("*").eq("business_id", bId);
      if (!gastosErr && Array.isArray(gastosData) && gastosData.length > 0) {
        if (typeof state !== "undefined" && state) {
          if (!Array.isArray(state.expenses)) state.expenses = [];
          if (!Array.isArray(state.purchases)) state.purchases = [];

          gastosData.forEach(g => {
            const isPurchase = Boolean(g.proveedor_id || String(g.id).startsWith("pur-") || String(g.categoria).startsWith("Compra"));
            const parsedDate = g.fecha ? String(g.fecha).slice(0, 10) : (typeof today === "function" ? today() : new Date().toISOString().slice(0, 10));

            if (isPurchase) {
              if (!state.purchases.some(p => p.id === g.id)) {
                state.purchases.push({
                  id: String(g.id),
                  invoice: String(g.comprobante || ""),
                  supplier: String(g.descripcion || "Proveedor"),
                  supplierId: g.proveedor_id ? String(g.proveedor_id) : null,
                  date: parsedDate,
                  method: "Efectivo",
                  lines: [],
                  total: Number(g.monto ?? 0),
                  createdAt: new Date(g.created_at || g.fecha || Date.now()).getTime(),
                  created_at: toIsoDate(g.created_at || g.fecha),
                  updated_at: toIsoDate(g.updated_at),
                  sync_status: "synced"
                });
              }
            } else {
              if (!state.expenses.some(e => e.id === g.id)) {
                state.expenses.push({
                  id: String(g.id),
                  category: String(g.categoria || "Gasto operativo"),
                  description: String(g.descripcion || "Gasto registrado"),
                  amount: Number(g.monto ?? 0),
                  method: "Efectivo",
                  date: parsedDate,
                  createdAt: new Date(g.created_at || g.fecha || Date.now()).getTime(),
                  created_at: toIsoDate(g.created_at || g.fecha),
                  updated_at: toIsoDate(g.updated_at),
                  sync_status: "synced"
                });
              }
            }
          });
          results.gastos = gastosData.length;
        }
      }
    } catch (e) {
      console.warn("[NexoSync] Error descargando gastos:", e.message);
    }

    // 5. Proveedores
    try {
      const { data: provData, error: provErr } = await sb.from("proveedores").select("*").eq("business_id", bId);
      if (!provErr && Array.isArray(provData) && provData.length > 0) {
        if (typeof state !== "undefined" && state) {
          if (!Array.isArray(state.suppliers)) state.suppliers = [];
          provData.forEach(s => {
            const existing = state.suppliers.find(x => x.id === s.id);
            if (existing) {
              existing.name = s.nombre || existing.name;
              existing.phone = s.telefono || existing.phone;
              existing.nit = s.contacto || existing.nit;
              existing.address = s.direccion || existing.address;
              existing.notes = s.notas || existing.notes;
              existing.email = s.email || existing.email;
              existing.sync_status = "synced";
            } else {
              state.suppliers.push({
                id: String(s.id),
                name: s.nombre || "Proveedor",
                phone: s.telefono || "",
                nit: s.contacto || "",
                address: s.direccion || "",
                notes: s.notas || "",
                email: s.email || "",
                createdAt: toIsoDate(s.created_at),
                created_at: toIsoDate(s.created_at),
                updated_at: toIsoDate(s.updated_at),
                sync_status: "synced"
              });
            }
          });
          results.proveedores = provData.length;
        }
      }
    } catch (e) {
      console.warn("[NexoSync] Error descargando proveedores:", e.message);
    }

    // 6. Mermas
    try {
      const { data: mermaData, error: mermaErr } = await sb.from("mermas").select("*").eq("business_id", bId);
      if (!mermaErr && Array.isArray(mermaData) && mermaData.length > 0) {
        if (typeof state !== "undefined" && state) {
          if (!Array.isArray(state.stockLog)) state.stockLog = [];
          mermaData.forEach(m => {
            if (!state.stockLog.some(l => l.id === m.id)) {
              const parsedDate = m.fecha ? String(m.fecha).slice(0, 10) : (typeof today === "function" ? today() : new Date().toISOString().slice(0, 10));
              state.stockLog.push({
                id: String(m.id),
                at: new Date(m.fecha || m.created_at || Date.now()).getTime(),
                date: parsedDate,
                type: "merma",
                reasonCategory: m.motivo || "Rotura / Merma",
                reason: m.motivo || "Rotura / Merma",
                itemId: String(m.producto_id || ""),
                itemName: String(m.producto_nombre || "Producto"),
                delta: -Math.abs(Number(m.cantidad || 1)),
                note: String(m.observacion || ""),
                sync_status: "synced"
              });
            }
          });
          results.mermas = mermaData.length;
        }
      }
    } catch (e) {
      console.warn("[NexoSync] Error descargando mermas:", e.message);
    }

    // Persistir estado en IndexedDB / localStorage inmediatamente
    if (typeof scheduleSave === "function") scheduleSave();
    if (typeof persistNow === "function") {
      try { await persistNow(); } catch (e) { /* ignore */ }
    }

    syncState.lastSyncAt = Date.now();
    syncState.lastError = null;
    updateIndicator("synced");

    const totalCount = results.negocios + results.productos + results.ventas + results.gastos + results.proveedores + results.mermas;
    console.log(`[NexoSync] 📥 Descarga completada: ${totalCount} registros procesados.`, results);

    if (typeof renderShiftStatus === "function") {
      try { renderShiftStatus(); } catch (e) { /* ignore */ }
    }
    if (typeof renderAll === "function") {
      try { renderAll(); } catch (e) { /* ignore */ }
    }

    return { ok: true, count: totalCount, details: results };
  } catch (err) {
    console.error("[NexoSync] Error en pullAllFromSupabase:", err);
    updateIndicator("offline");
    return { ok: false, error: err.message };
  }
}

function setupRealtime() {
  const sb = getClient();
  if (!sb || typeof sb.channel !== "function") return;
  try {
    if (realtimeChannel) {
      sb.removeChannel(realtimeChannel);
    }
    const bId = getBusinessId();
    realtimeChannel = sb.channel(`nexobar_rt_${bId}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "ventas", filter: `business_id=eq.${bId}` }, payload => {
        if (payload?.new) {
          const sale = payload.new;
          if (typeof state !== "undefined" && Array.isArray(state.payments)) {
            if (!state.payments.some(p => p.id === sale.id)) {
              state.payments.unshift({
                id: sale.id,
                orderId: sale.order_id,
                amount: sale.total,
                method: sale.method,
                payments: sale.payments || [],
                items: sale.items || [],
                customer: sale.customer,
                cashierName: sale.cashier,
                shiftId: sale.shift_id,
                paidAt: new Date(sale.created_at || Date.now()).getTime(),
                createdAt: new Date(sale.created_at || Date.now()).getTime(),
                date: sale.fecha ? String(sale.fecha).slice(0, 10) : new Date().toISOString().slice(0, 10),
                sync_status: "synced"
              });

              // Descontar inmediatamente en el inventario local los productos vendidos
              if (Array.isArray(sale.items) && Array.isArray(state.products)) {
                sale.items.forEach(it => {
                  const pid = it.productId || it.id;
                  const p = state.products.find(prod => prod.id === pid);
                  if (p) {
                    const qty = Number(it.qty || 1);
                    p.stock = Math.max(0, Number((Number(p.stock ?? 0) - qty).toFixed(2)));
                    const inv = state.inventory?.find(i => i.id === p.inventoryId || i.id === `stock-${p.id}`);
                    if (inv) inv.qty = p.stock;
                  }
                });
              }

              if (typeof scheduleSave === "function") scheduleSave();
              if (typeof renderAll === "function") renderAll();
              if (typeof showToast === "function") {
                const moneyFmt = typeof money !== "undefined" ? money.format(sale.total) : `$${sale.total}`;
                showToast(`🔔 Venta registrada en vivo: ${moneyFmt}`);
              }
            }
          }
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "productos", filter: `business_id=eq.${bId}` }, payload => {
        if (payload?.new) {
          const p = payload.new;
          if (typeof state !== "undefined" && Array.isArray(state.products)) {
            const existing = state.products.find(x => x.id === p.id);
            const currentStock = Number(p.stock ?? 0);
            const invId = `stock-${p.id}`;

            if (existing) {
              existing.name = p.nombre || existing.name;
              existing.category = p.categoria || existing.category;
              existing.price = Number(p.precio ?? existing.price ?? 0);
              existing.cost = Number(p.costo ?? existing.cost ?? 0);
              existing.stock = currentStock;
              existing.active = p.activo !== false;
              existing.updated_at = toIsoDate(p.updated_at);
              existing.sync_status = "synced";
            } else {
              state.products.push({
                id: String(p.id),
                name: p.nombre || "Producto",
                category: p.categoria || "Otros",
                price: Number(p.precio ?? 0),
                cost: Number(p.costo ?? 0),
                stock: currentStock,
                icon: "🍺",
                image: null,
                inventoryId: invId,
                recipe: { [invId]: 1 },
                active: p.activo !== false,
                createdAt: toIsoDate(p.created_at),
                created_at: toIsoDate(p.created_at),
                updated_at: toIsoDate(p.updated_at),
                sync_status: "synced"
              });
            }

            if (Array.isArray(state.inventory)) {
              let invItem = state.inventory.find(i => i.id === invId || i.id === existing?.inventoryId);
              if (invItem) {
                invItem.name = p.nombre || invItem.name;
                invItem.qty = currentStock;
                invItem.min = Number(p.min_stock ?? invItem.min ?? 5);
              } else {
                state.inventory.push({
                  id: invId,
                  name: p.nombre || "Producto",
                  unit: "und",
                  qty: currentStock,
                  min: Number(p.min_stock ?? 5)
                });
              }
            }

            if (typeof scheduleSave === "function") scheduleSave();
            if (typeof renderAll === "function") renderAll();
          }
        } else if (payload?.eventType === "DELETE" && payload?.old?.id) {
          if (typeof state !== "undefined" && Array.isArray(state.products)) {
            state.products = state.products.filter(x => x.id !== payload.old.id);
            if (typeof scheduleSave === "function") scheduleSave();
            if (typeof renderAll === "function") renderAll();
          }
        } else {
          pullAllFromSupabase();
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "negocios", filter: `id=eq.${bId}` }, payload => {
        if (payload?.new) {
          const row = payload.new;
          if (typeof state !== "undefined" && state) {
            if (row.nombre && state.profile) state.profile.name = row.nombre;
            if (row.telefono && state.profile) state.profile.phone = row.telefono;

            // Sincronización en vivo del PIN de administración
            const newAdminPin = row.admin_pin || row.configuracion?.admin_pin || row.configuracion?.adminPin;
            if (newAdminPin) {
              applyAdminPinLocally(
                newAdminPin,
                row.configuracion?.admin_salt,
                row.configuracion?.admin_hash
              );
            }

            const remoteShift = row.configuracion?.cashShift;
            if (remoteShift && typeof remoteShift === "object") {
              state.cashShift = remoteShift;
              if (typeof renderShiftStatus === "function") {
                try { renderShiftStatus(); } catch (e) { /* ignore */ }
              }
              if (typeof renderAll === "function") {
                try { renderAll(); } catch (e) { /* ignore */ }
              }
              if (typeof scheduleSave === "function") scheduleSave();
              if (typeof showToast === "function") {
                const isOpen = remoteShift.status === "open";
                showToast(isOpen ? "🟢 Turno de caja abierto en vivo" : "🔴 Turno de caja cerrado en vivo");
              }
            }
          }
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "turnos_caja", filter: `business_id=eq.${bId}` }, payload => {
        if (payload?.new) {
          const row = payload.new;
          if (typeof state !== "undefined" && state) {
            state.cashShift = {
              id: row.id,
              status: row.estado || row.status || "closed",
              openingCash: Number(row.monto_apertura ?? row.opening_cash ?? 0),
              openedAt: new Date(row.fecha_apertura || row.opened_at || Date.now()).getTime(),
              closedAt: (row.fecha_cierre || row.closed_at) ? new Date(row.fecha_cierre || row.closed_at).getTime() : null,
              date: (row.fecha_apertura || row.opened_at || new Date().toISOString()).slice(0, 10)
            };
            if (typeof scheduleSave === "function") scheduleSave();
            if (typeof renderShiftStatus === "function") renderShiftStatus();
            if (typeof renderAll === "function") renderAll();
          }
        }
      })
      .on("postgres_changes", { event: "*", schema: "public", table: "cajas", filter: `business_id=eq.${bId}` }, payload => {
        if (payload?.new) {
          const row = payload.new;
          if (typeof state !== "undefined" && state) {
            state.cashShift = {
              id: row.id,
              status: row.estado || row.status || "closed",
              openingCash: Number(row.monto_apertura ?? row.opening_cash ?? 0),
              openedAt: new Date(row.fecha_apertura || row.opened_at || Date.now()).getTime(),
              closedAt: (row.fecha_cierre || row.closed_at) ? new Date(row.fecha_cierre || row.closed_at).getTime() : null,
              date: (row.fecha_apertura || row.opened_at || new Date().toISOString()).slice(0, 10)
            };
            if (typeof scheduleSave === "function") scheduleSave();
            if (typeof renderShiftStatus === "function") renderShiftStatus();
            if (typeof renderAll === "function") renderAll();
          }
        }
      })
      .subscribe();
  } catch (e) {
    console.debug("[NexoSync] Realtime no disponible:", e.message);
  }
}

// 6. Forzar re-sincronización total: contrasta todas las ventas locales con Supabase y sube de inmediato las faltantes
async function forceSyncAll() {
  console.log("[NexoSync] 🔄 Iniciando Forzar Re-sincronización Total...");
  if (typeof showToast === "function") {
    showToast("Revisando ventas locales y contrastando con Supabase...");
  }
  const ok = await checkInitialConnection();
  if (!ok) {
    if (typeof showToast === "function") {
      showToast("⚠️ Modo Offline: sin conexión a Supabase.");
    }
    return { ok: false, error: "Sin conexión" };
  }

  // 1. Marcar registros locales para forzar revisión y subida
  if (typeof state !== "undefined" && state) {
    if (Array.isArray(state.payments)) {
      state.payments.forEach(p => { p.sync_status = "pending"; p.synced = false; });
    }
    if (Array.isArray(state.products)) {
      state.products.forEach(p => { p.sync_status = "pending"; p.synced = false; });
    }
    if (Array.isArray(state.expenses)) {
      state.expenses.forEach(e => { e.sync_status = "pending"; e.synced = false; });
    }
    if (Array.isArray(state.purchases)) {
      state.purchases.forEach(pur => { pur.sync_status = "pending"; pur.synced = false; });
    }
  }

  // 2. Subida forzada completa (Push): syncAll({ force: true }) contrasta IDs y sube todas las ventas pendientes
  const pushRes = await syncAll({ force: true });

  // 3. Sincronizar inmediatamente el estado actual de la caja
  if (typeof state !== "undefined" && state?.cashShift) {
    await syncCashShift(state.cashShift);
  }

  // 4. Descargar últimos cambios remotos (Pull)
  const pullRes = await pullAllFromSupabase();

  const totalVentas = (typeof state !== "undefined" && Array.isArray(state.payments)) ? state.payments.length : 0;
  const pushedVentas = pushRes?.ventas?.count ?? 0;
  console.log(`[NexoSync] 🏁 Re-sincronización completada. Ventas locales: ${totalVentas}, ventas subidas: ${pushedVentas}.`);

  if (typeof showToast === "function") {
    showToast(`✅ Re-sincronización total lista: ${totalVentas} ventas verificadas, ${pullRes?.count ?? 0} registros en total.`);
  }

  return { ok: true, pushedVentas, pullCount: pullRes?.count ?? 0 };
}

const triggerBidirectionalSync = forceSyncAll;

function init() {
  updateIndicator(typeof navigator !== "undefined" && navigator.onLine ? "syncing" : "offline");

  if (typeof window !== "undefined" && typeof window.addEventListener === "function") {
    window.addEventListener("online", () => {
      syncState.online = true;
      updateIndicator("syncing");
      checkInitialConnection().then(ok => {
        if (ok) {
          scheduleSync(300);
          setupRealtime();
        }
      });
    });

    window.addEventListener("offline", () => {
      syncState.online = false;
      updateIndicator("offline");
    });
  }

  if (typeof document !== "undefined" && typeof document.addEventListener === "function") {
    document.addEventListener("click", async (e) => {
      if (e.target.closest("#syncStatusIndicator") || e.target.closest("#syncBadgeTopbar") || e.target.closest("#syncNowButton")) {
        e.preventDefault();
        const btn = e.target.closest("button") || e.target.closest("div");
        if (btn) btn.classList.add("is-syncing");
        try {
          await forceSyncAll();
        } finally {
          if (btn) btn.classList.remove("is-syncing");
        }
      }
      if (e.target.closest("#pullFromCloudButton") || e.target.closest("#sidebarPullButton")) {
        e.preventDefault();
        const btn = e.target.closest("button");
        if (btn) btn.disabled = true;
        if (typeof showToast === "function") {
          showToast("Descargando datos desde Supabase...");
        }
        try {
          const res = await pullAllFromSupabase();
          if (res?.ok) {
            if (typeof showToast === "function") {
              showToast(`✅ Descarga completada: ${res.count} registros.`);
            }
            const statusEl = document.querySelector("#cloudSyncStatus");
            if (statusEl) {
              statusEl.textContent = `Última descarga: ${new Date().toLocaleTimeString("es-CO")} (${res.count} registros sincronizados).`;
            }
          } else {
            if (typeof showToast === "function") {
              showToast("⚠️ Error al descargar: " + (res?.error || "Revisa tu conexión"));
            }
          }
        } catch (err) {
          if (typeof showToast === "function") {
            showToast("Error en descarga: " + err.message);
          }
        } finally {
          if (btn) btn.disabled = false;
        }
      }
    });
  }

  // Sondeo periódico cada 30 segundos (Push de pendientes + Pull de cambios remotos)
  clearInterval(pingTimer);
  pingTimer = setInterval(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      const ok = await checkInitialConnection();
      if (ok) {
        if (countPendingRecords() > 0) {
          await syncAll();
        }
        await pullAllFromSupabase();
      }
    }
  }, 30000);

  // Inicialización y descarga al arrancar la aplicación
  setTimeout(async () => {
    const ok = await checkInitialConnection();
    if (ok) {
      if (typeof state !== "undefined" && state) {
        const localAdmin = state.users?.find(u => u.role === "admin");
        const pinToSync = state.profile?.admin_pin || state.profile?.adminPin || (localAdmin && !localAdmin.mustChangePin && toCyrb53Hash(`${localAdmin.salt}:2013`) === localAdmin.pinHash ? "2013" : "");
        if (localAdmin && !localAdmin.mustChangePin && pinToSync) {
          syncAdminPin(pinToSync, localAdmin).catch(() => {});
        }
      }
      if (countPendingRecords() > 0) {
        await syncAll();
      }
      await pullAllFromSupabase();
      setupRealtime();
    }
  }, 300);
}

// Inicialización segura al cargar
if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", init);
  } else {
    setTimeout(init, 100);
  }
}

// Exportación global en window y globalThis
const rootScope = typeof window !== "undefined" ? window : (typeof globalThis !== "undefined" ? globalThis : this);
rootScope.NexoSync = {
  init,
  syncAll,
  syncData,
  syncSale,
  syncSales,
  pushSales,
  syncCashShift,
  syncAdminPin,
  applyAdminPinLocally,
  syncProductos,
  pullAllFromSupabase,
  forceSyncAll,
  triggerBidirectionalSync,
  scheduleSync,
  checkInitialConnection,
  toIsoDate,
  toValidISOString,
  trackProductDeletion,
  deleteProduct,
  deleteSale,
  getBusinessId,
  getStatus: () => ({ ...syncState }),
  getPendingCount: countPendingRecords,
  SUPABASE_URL,
  SUPABASE_KEY: SUPABASE_ANON_KEY,
  SUPABASE_ANON_KEY
};
