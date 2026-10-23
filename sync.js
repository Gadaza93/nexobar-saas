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
    configuracion: {
      ...prof,
      cashShift: (typeof state !== "undefined" && state?.cashShift) ? state.cashShift : { status: "closed" }
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

// Sincronización inmediata de una venta individual y actualización de stock de sus productos en Supabase
async function syncSale(sale) {
  const sb = getClient();
  if (!sb || !sale) return { ok: false, error: "Cliente no inicializado o venta vacía" };
  const bId = getBusinessId();
  try {
    const saleRecord = sanitizeVenta(sale, bId);
    const { error: saleErr } = await sb.from("ventas").upsert(saleRecord, { onConflict: "id" });
    if (saleErr) {
      console.warn("[NexoSync] ⚠️ Error upsert venta:", saleErr.message);
      return { ok: false, error: saleErr.message };
    }
    sale.sync_status = "synced";

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
          affectedProds.forEach(p => { p.sync_status = "synced"; });
          console.log(`[NexoSync] ✅ Stock en Supabase actualizado para ${prodRecords.length} productos tras venta.`);
        }
      }
    }

    if (typeof scheduleSave === "function") scheduleSave();
    updateIndicator("synced");
    return { ok: true };
  } catch (err) {
    console.warn("[NexoSync] ⚠️ syncSale excepción:", err.message);
    return { ok: false, error: err.message };
  }
}

// Sincronización del estado de apertura / cierre de caja con Supabase
async function syncCashShift(shift) {
  const sb = getClient();
  if (!sb) {
    console.warn("[NexoSync] syncCashShift: Cliente Supabase no inicializado.");
    return { ok: false, error: "Cliente no inicializado" };
  }
  const bId = getBusinessId();
  const currentShift = shift || ((typeof state !== "undefined" && state?.cashShift) ? state.cashShift : { status: "closed" });

  try {
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

    // Intento complementario seguro en tabla turnos_caja (si existiera)
    try {
      const shiftRecord = {
        id: String(currentShift.id || `shift_${Date.now()}`),
        business_id: String(bId || DEFAULT_BUSINESS_ID),
        status: String(currentShift.status || "closed"),
        opening_cash: Number(currentShift.openingCash ?? 0),
        opened_at: toIsoDate(currentShift.openedAt || Date.now()),
        closed_at: currentShift.closedAt ? toIsoDate(currentShift.closedAt) : null,
        created_at: toIsoDate(currentShift.openedAt || Date.now()),
        updated_at: new Date().toISOString()
      };
      await sb.from("turnos_caja").upsert(shiftRecord, { onConflict: "id" });
    } catch (e) {
      /* ignore si la tabla opcional no existe */
    }

    return { ok: true, status: currentShift.status };
  } catch (err) {
    console.warn("[NexoSync] ⚠️ syncCashShift excepción:", err.message);
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

        // Actualizar de inmediato en Supabase el stock de todos los productos incluidos en estas ventas
        const affectedProductIds = new Set();
        sales.forEach(s => {
          if (Array.isArray(s.items)) {
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
              prodsToUpsert.forEach(p => { p.sync_status = "synced"; });
              console.log(`[NexoSync] ✅ Stock en Supabase actualizado para ${prodRecords.length} productos vendidos.`);
            } else {
              console.warn("[NexoSync] ⚠️ Error actualizando stock de productos tras ventas:", pErr.message);
            }
          }
        }
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
              status: latestShift.status,
              openingCash: Number(latestShift.opening_cash ?? 0),
              openedAt: new Date(latestShift.opened_at || Date.now()).getTime(),
              closedAt: latestShift.closed_at ? new Date(latestShift.closed_at).getTime() : null,
              date: (latestShift.opened_at || new Date().toISOString()).slice(0, 10)
            };
            if (typeof renderShiftStatus === "function") {
              try { renderShiftStatus(); } catch (e) { /* ignore */ }
            }
          }
        }
      } catch (e) {
        /* ignore si la tabla opcional no existe */
      }
    } catch (e) {
      console.warn("[NexoSync] Error descargando negocio:", e.message);
    }

    // 2. Productos
    try {
      const { data: prodData, error: prodErr } = await sb.from("productos").select("*").eq("business_id", bId);
      if (!prodErr && Array.isArray(prodData) && prodData.length > 0) {
        if (typeof state !== "undefined" && state) {
          if (!Array.isArray(state.products)) state.products = [];
          if (!Array.isArray(state.inventory)) state.inventory = [];
          if (!Array.isArray(state.categories)) state.categories = [];

          // Detectar si la base local tiene únicamente productos demo sin transacciones
          const isVirginDemo = state.products.length > 0 &&
            state.products.every(p => p.id && String(p.id).startsWith("p") && 4 > String(p.id).length) &&
            (!state.payments || state.payments.length === 0) &&
            (!state.purchases || state.purchases.length === 0);

          if (isVirginDemo) {
            state.products = [];
            state.inventory = [];
          }

          prodData.forEach(p => {
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
      if (!salesErr && Array.isArray(salesData) && salesData.length > 0) {
        if (typeof state !== "undefined" && state) {
          if (!Array.isArray(state.payments)) state.payments = [];
          salesData.forEach(v => {
            const existingSale = state.payments.find(p => p.id === v.id);
            if (!existingSale) {
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
                sync_status: "synced"
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
              status: row.status,
              openingCash: Number(row.opening_cash ?? 0),
              openedAt: new Date(row.opened_at || Date.now()).getTime(),
              closedAt: row.closed_at ? new Date(row.closed_at).getTime() : null,
              date: (row.opened_at || new Date().toISOString()).slice(0, 10)
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

// Función para ejecutar sincronización manual bidireccional completa (Push + Pull)
async function triggerBidirectionalSync() {
  if (typeof showToast === "function") {
    showToast("Sincronizando bidireccionalmente con Supabase...");
  }
  const ok = await checkInitialConnection();
  if (!ok) {
    if (typeof showToast === "function") {
      showToast("⚠️ Modo Offline: sin conexión a Supabase.");
    }
    return { ok: false, error: "Sin conexión" };
  }

  // 1. Subir cambios pendientes locales (Push)
  await syncAll({ force: true });

  // 2. Descargar últimos cambios remotos (Pull)
  const pullRes = await pullAllFromSupabase();

  if (typeof showToast === "function") {
    showToast(`✅ Sincronización bidireccional lista (${pullRes?.count ?? 0} registros actualizados).`);
  }
  return { ok: true, pulled: pullRes?.count ?? 0 };
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
    document.addEventListener("click", async (e) => {
      if (e.target.closest("#syncStatusIndicator") || e.target.closest("#syncBadgeTopbar") || e.target.closest("#syncNowButton")) {
        e.preventDefault();
        const btn = e.target.closest("button") || e.target.closest("div");
        if (btn) btn.classList.add("is-syncing");
        try {
          await triggerBidirectionalSync();
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
  syncCashShift,
  syncProductos,
  pullAllFromSupabase,
  triggerBidirectionalSync,
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
