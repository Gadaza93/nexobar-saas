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

const syncState = {
  status: "offline",
  online: typeof navigator !== "undefined" ? Boolean(navigator.onLine) : false,
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
  return {
    id: String(p.id || `pay_${Date.now()}`),
    business_id: String(bId || DEFAULT_BUSINESS_ID),
    order_id: String(p.orderId || p.order_id || p.id),
    total: Number(p.amount ?? p.total ?? 0),
    method: p.method || (Array.isArray(p.payments) && p.payments.length ? p.payments.map(x => x.method).join(" + ") : "Efectivo"),
    payments: p.payments || [],
    items: p.items || [],
    customer: p.customer || "",
    cashier: p.cashierName || p.cashier || "",
    shift_id: String(p.shiftId || p.shift_id || ""),
    fecha: toIsoDate(p.paidAt || p.createdAt || p.date || p.fecha),
    created_at: toIsoDate(p.paidAt || p.createdAt || p.date || p.created_at),
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
  return {
    id: String(bId || DEFAULT_BUSINESS_ID),
    nombre: prof.name || prof.nombre || "NexoBar",
    telefono: prof.phone || prof.ownerPhone || prof.telefono || "",
    configuracion: prof || {},
    created_at: toIsoDate(prof.createdAt || prof.created_at || Date.now()),
    updated_at: toIsoDate(prof.updatedAt || prof.updated_at || Date.now())
  };
}

function countPendingRecords() {
  if (typeof state === "undefined" || !state) return 0;
  let count = 0;
  try {
    if (Array.isArray(state.products)) {
      count += state.products.filter(p => p.sync_status === "pending").length;
    }
    if (Array.isArray(state.payments)) {
      count += state.payments.filter(p => p.sync_status === "pending").length;
    }
    if (Array.isArray(state.expenses)) {
      count += state.expenses.filter(g => g.sync_status === "pending").length;
    }
    if (Array.isArray(state.purchases)) {
      count += state.purchases.filter(g => g.sync_status === "pending").length;
    }
    if (Array.isArray(state.suppliers)) {
      count += state.suppliers.filter(s => s.sync_status === "pending").length;
    }
    if (Array.isArray(state.stockLog)) {
      count += state.stockLog.filter(l => l.sync_status === "pending").length;
    }
    if (state.profile?.sync_status === "pending") {
      count += 1;
    }
    count += deletedProductIds.length;
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

function trackProductDeletion(productId) {
  if (productId && !deletedProductIds.includes(productId)) {
    deletedProductIds.push(productId);
    scheduleSync(500);
  }
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
    const rawProds = (typeof state !== "undefined" && Array.isArray(state.products)) ? state.products : [];
    const prods = rawProds.filter(p => options.force || p.sync_status === "pending" || !p.sync_status);
    if (prods.length > 0) {
      const records = prods.map(p => sanitizeProducto(p, bId));
      const { error: prodErr } = await sb.from("productos").upsert(records, { onConflict: "id" });
      if (prodErr) {
        console.warn("[NexoSync] ⚠️ Productos:", prodErr.message);
        return { ok: false, count: prods.length, error: prodErr.message };
      }
      prods.forEach(p => { p.sync_status = "synced"; });
      console.log(`[NexoSync] ✅ Productos: ${records.length} sincronizados.`);

      // Replicar eliminaciones de productos si existen
      if (deletedProductIds.length > 0) {
        try {
          const { error: delErr } = await sb.from("productos").delete().in("id", deletedProductIds);
          if (!delErr) deletedProductIds = [];
        } catch (e) {
          /* ignore */
        }
      }

      return { ok: true, count: records.length };
    }
    console.log("[NexoSync] ℹ️ Productos: 0 pendientes.");
    return { ok: true, count: 0 };
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Productos excepción:", err.message);
    return { ok: false, error: err.message };
  }
}

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

  // --- 3. VENTAS ---
  try {
    const rawSales = (typeof state !== "undefined" && Array.isArray(state.payments)) ? state.payments : [];
    const sales = rawSales.filter(p => options.force || p.sync_status === "pending" || !p.sync_status);
    if (sales.length > 0) {
      const records = sales.map(p => sanitizeVenta(p, bId));
      const { error: saleErr } = await sb.from("ventas").upsert(records, { onConflict: "id" });
      if (saleErr) {
        console.warn("[NexoSync] ⚠️ Ventas:", saleErr.message);
        results.ventas = { ok: false, count: sales.length, error: saleErr.message };
      } else {
        sales.forEach(p => { p.sync_status = "synced"; });
        console.log(`[NexoSync] ✅ Ventas: ${records.length} sincronizadas.`);
        results.ventas = { ok: true, count: records.length };
      }
    } else {
      console.log("[NexoSync] ℹ️ Ventas: 0 pendientes.");
      results.ventas = { ok: true, count: 0 };
    }
  } catch (err) {
    console.warn("[NexoSync] ⚠️ Ventas excepción:", err.message);
    results.ventas = { ok: false, error: err.message };
  }

  // --- 4. GASTOS / COMPRAS ---
  try {
    const expensesList = (typeof state !== "undefined" && Array.isArray(state.expenses)) ? state.expenses : [];
    const purchasesList = (typeof state !== "undefined" && Array.isArray(state.purchases)) ? state.purchases : [];
    const rawExpenses = [...expensesList, ...purchasesList];
    const pendingExpenses = rawExpenses.filter(g => options.force || g.sync_status === "pending" || !g.sync_status);
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
    const sups = rawSups.filter(s => options.force || s.sync_status === "pending" || !s.sync_status);
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
    const pendingMermas = rawMermas.filter(l => options.force || l.sync_status === "pending" || !l.sync_status);
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
                paidAt: sale.created_at,
                createdAt: sale.created_at,
                date: sale.created_at ? sale.created_at.slice(0, 10) : today(),
                sync_status: "synced"
              });
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
      .on("postgres_changes", { event: "*", schema: "public", table: "productos", filter: `business_id=eq.${bId}` }, () => {
        scheduleSync(1200);
      })
      .subscribe();
  } catch (e) {
    console.debug("[NexoSync] Realtime no disponible:", e.message);
  }
}

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
    document.addEventListener("click", (e) => {
      if (e.target.closest("#syncStatusIndicator") || e.target.closest("#syncBadgeTopbar")) {
        e.preventDefault();
        if (typeof showToast === "function") {
          showToast("Comprobando conexión con Supabase...");
        }
        checkInitialConnection().then(ok => {
          if (ok) syncAll({ force: true });
        });
      }
    });
  }

  clearInterval(pingTimer);
  pingTimer = setInterval(async () => {
    if (typeof document !== "undefined" && document.visibilityState === "visible") {
      const ok = await checkInitialConnection();
      if (ok && countPendingRecords() > 0) {
        scheduleSync(500);
      }
    }
  }, 45000);

  setTimeout(async () => {
    const ok = await checkInitialConnection();
    if (ok) {
      syncAll();
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
  syncProductos,
  scheduleSync,
  checkInitialConnection,
  toIsoDate,
  toValidISOString,
  trackProductDeletion,
  getBusinessId,
  getStatus: () => ({ ...syncState }),
  getPendingCount: countPendingRecords,
  SUPABASE_URL,
  SUPABASE_KEY: SUPABASE_ANON_KEY,
  SUPABASE_ANON_KEY
};
