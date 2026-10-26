// Test Bidirectional Sync & Force Re-Sync with Supabase using native fetch (Node 24)
const SUPABASE_URL = "https://fthjtbhxqqzqpyhtynaa.supabase.co";
const SUPABASE_ANON_KEY = "sb_publishable_qg2FVUMhBsIshhIRCOGISg_vLF1PLuy";
const DEFAULT_BUSINESS_ID = "nexobar_default";

function createRestClient(baseUrl, apiKey) {
  const headers = {
    apikey: apiKey,
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    Prefer: "return=representation"
  };

  return {
    from: (table) => {
      let queryParams = [];

      const builder = {
        select: (cols = '*', opts = {}) => {
          queryParams.push(`select=${encodeURIComponent(cols)}`);
          return builder;
        },
        eq: (col, val) => {
          queryParams.push(`${col}=eq.${encodeURIComponent(val)}`);
          return builder;
        },
        in: (col, arr) => {
          queryParams.push(`${col}=in.(${arr.map(encodeURIComponent).join(',')})`);
          return builder;
        },
        order: (col, opts = {}) => {
          queryParams.push(`order=${col}.${opts.ascending ? 'asc' : 'desc'}`);
          return builder;
        },
        limit: (n) => {
          queryParams.push(`limit=${n}`);
          return builder;
        },
        maybeSingle: async () => {
          const qs = queryParams.length ? `?${queryParams.join('&')}` : '';
          const res = await fetch(`${baseUrl}/rest/v1/${table}${qs}`, {
            headers: { ...headers, Accept: 'application/vnd.pgrst.object+json' }
          });
          if (res.status === 406 || res.status === 404) return { data: null, error: null };
          if (!res.ok) {
            const err = await res.json().catch(() => ({ message: res.statusText }));
            return { data: null, error: err };
          }
          const data = await res.json();
          return { data, error: null };
        },
        single: async () => builder.maybeSingle(),
        then: (onResolve, onReject) => {
          const qs = queryParams.length ? `?${queryParams.join('&')}` : '';
          return fetch(`${baseUrl}/rest/v1/${table}${qs}`, { headers })
            .then(async res => {
              if (!res.ok) {
                const err = await res.json().catch(() => ({ message: res.statusText }));
                return { data: null, error: err };
              }
              const data = await res.json();
              return { data, error: null };
            })
            .then(onResolve, onReject);
        },
        upsert: async (records, opts = {}) => {
          const onConflict = opts.onConflict ? `?on_conflict=${opts.onConflict}` : '';
          const res = await fetch(`${baseUrl}/rest/v1/${table}${onConflict}`, {
            method: 'POST',
            headers: { ...headers, Prefer: 'resolution=merge-duplicates,return=representation' },
            body: JSON.stringify(records)
          });
          if (!res.ok) {
            const err = await res.json().catch(() => ({ message: res.statusText }));
            return { data: null, error: err };
          }
          const data = await res.json().catch(() => null);
          return { data, error: null };
        },
        delete: () => ({
          eq: async (col, val) => {
            const res = await fetch(`${baseUrl}/rest/v1/${table}?${col}=eq.${encodeURIComponent(val)}`, {
              method: 'DELETE',
              headers
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ message: res.statusText }));
              return { error: err };
            }
            return { error: null };
          },
          in: async (col, arr) => {
            const res = await fetch(`${baseUrl}/rest/v1/${table}?${col}=in.(${arr.map(encodeURIComponent).join(',')})`, {
              method: 'DELETE',
              headers
            });
            if (!res.ok) {
              const err = await res.json().catch(() => ({ message: res.statusText }));
              return { error: err };
            }
            return { error: null };
          }
        })
      };

      return builder;
    },
    channel: () => {
      const ch = { on: () => ch, subscribe: () => ch };
      return ch;
    }
  };
}

async function runTests() {
  console.log("=== INICIANDO PRUEBAS DE FORZAR RE-SINCRONIZACIÓN Y SUBIDA DE VENTAS ===");
  const sb = createRestClient(SUPABASE_URL, SUPABASE_ANON_KEY);
  // Terminal vinculada con sesión de Supabase Auth (checkInitialConnection exige sesión para no consultar como 'anon')
  sb.auth = { getSession: async () => ({ data: { session: { access_token: "test" } }, error: null }) };

  // 1. Mock global
  global.window = global;
  global.supabase = { createClient: () => sb };
  global.document = {
    querySelector: () => ({
      classList: { add: () => {}, remove: () => {} },
      textContent: '',
      title: '',
      className: ''
    }),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  global.navigator = { onLine: true };
  global.showToast = msg => console.log("   [Toast]:", msg);

  delete require.cache[require.resolve('../sync.js')];
  require('../sync.js');
  const NexoSync = global.NexoSync;

  console.log("1. Verificando funciones requeridas en NexoSync...");
  if (typeof NexoSync.syncSales !== 'function') throw new Error("syncSales no está expuesto");
  if (typeof NexoSync.pushSales !== 'function') throw new Error("pushSales no está expuesto");
  if (typeof NexoSync.forceSyncAll !== 'function') throw new Error("forceSyncAll no está expuesto");
  if (typeof NexoSync.syncCashShift !== 'function') throw new Error("syncCashShift no está expuesto");
  console.log("   ✅ Todas las funciones expuestas en NexoSync.");

  // 2. Probar que syncSales detecta ventas locales que no están en Supabase
  console.log("\n2. Probando detección y subida de ventas locales faltantes...");
  const testSaleId = `pay_diag_${Date.now()}`;
  const mockSale = {
    id: testSaleId,
    orderId: `ord_diag_${Date.now()}`,
    amount: 25000,
    method: "Nequi",
    payments: [{ method: "Nequi", amount: 25000 }],
    items: [{ productId: "p7", id: "p7", name: "Aguardiente (media)", qty: 1, price: 25000 }],
    customer: "Mesa 4 Test",
    cashierName: "Administrador",
    shiftId: "shift_test_diag",
    created_at: new Date().toISOString(),
    // Simulamos que localmente estaba marcada como synced, pero en Supabase no existe aún
    synced: false,
    sync_status: "pending"
  };

  global.state = {
    profile: { syncId: DEFAULT_BUSINESS_ID, name: "NexoBar Test" },
    cashShift: { id: "shift_test_diag", status: "open", openingCash: 95000 },
    products: [{ id: "p7", name: "Aguardiente", stock: 10, sync_status: "synced" }],
    payments: [mockSale]
  };

  const salesPushRes = await NexoSync.syncSales();
  console.log("   Resultado syncSales:", salesPushRes);
  if (!salesPushRes.ok) throw new Error("syncSales falló");
  if (mockSale.synced !== true || mockSale.sync_status !== "synced") {
    throw new Error("La venta no fue marcada como synced = true");
  }
  console.log("   ✅ Venta subida y marcada con synced = true y sync_status = 'synced'.");

  // Verificar en Supabase
  const { data: cloudSale } = await sb.from("ventas").select("*").eq("id", testSaleId).single();
  if (!cloudSale) throw new Error("La venta no se encuentra en Supabase");
  console.log("   ✅ Venta confirmada en Supabase:", cloudSale.id, "Monto:", cloudSale.total);

  // 3. Probar forceSyncAll
  console.log("\n3. Probando forceSyncAll (Forzar re-sincronización total)...");
  let shiftStatusCalled = false;
  global.renderShiftStatus = () => { shiftStatusCalled = true; };
  global.renderAll = () => {};

  const forceRes = await NexoSync.forceSyncAll();
  console.log("   Resultado forceSyncAll:", forceRes);
  if (!forceRes.ok) throw new Error("forceSyncAll falló");
  console.log("   ✅ forceSyncAll ejecutado exitosamente.");

  // Limpiar venta de prueba en Supabase
  await sb.from("ventas").delete().eq("id", testSaleId);
  console.log("   (Limpieza completada)");

  console.log("\n=== TODAS LAS PRUEBAS PASARON EXITOSAMENTE ===");
  process.exit(0);
}

runTests().catch(err => {
  console.error("❌ ERROR EN PRUEBAS:", err);
  process.exit(1);
});
