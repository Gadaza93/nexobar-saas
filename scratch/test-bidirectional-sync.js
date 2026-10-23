// Test Bidirectional Sync with Supabase using native fetch (Node 24)
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
      let currentFilter = '';

      const builder = {
        select: (cols = '*', opts = {}) => {
          queryParams.push(`select=${encodeURIComponent(cols)}`);
          if (opts.count) queryParams.push(`count=${opts.count}`);
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
        single: async () => {
          return builder.maybeSingle();
        },
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
        delete: () => {
          const deleteBuilder = {
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
          };
          return deleteBuilder;
        }
      };

      return builder;
    },
    channel: (name) => ({
      on: () => ({ on: () => ({ on: () => ({ subscribe: () => {} }) }) })
    })
  };
}

async function runTests() {
  console.log("=== INICIANDO PRUEBAS DE SINCRONIZACIÓN BIDIRECCIONAL ===");
  const sb = createRestClient(SUPABASE_URL, SUPABASE_ANON_KEY);

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

  console.log("1. Verificando que NexoSync expone las nuevas funciones...");
  if (typeof NexoSync.syncCashShift !== 'function') throw new Error("syncCashShift no está expuesto");
  if (typeof NexoSync.syncSale !== 'function') throw new Error("syncSale no está expuesto");
  if (typeof NexoSync.triggerBidirectionalSync !== 'function') throw new Error("triggerBidirectionalSync no está expuesto");
  console.log("   ✅ Funciones expuestas correctamente.");

  // 2. Probar sincronización de turno de caja (Apertura)
  console.log("\n2. Probando sincronización de Apertura de Caja...");
  let shiftStatusRendered = null;
  global.renderShiftStatus = () => {
    shiftStatusRendered = global.state.cashShift?.status;
    console.log("   [renderShiftStatus llamado] Estado de caja:", shiftStatusRendered);
  };
  global.renderAll = () => console.log("   [renderAll llamado]");

  global.state = {
    profile: { name: "NexoBar Test", syncId: DEFAULT_BUSINESS_ID },
    cashShift: { id: "shift_test_100", status: "open", openingCash: 80000, date: "2026-10-23" },
    products: [],
    payments: []
  };

  const openRes = await NexoSync.syncCashShift(global.state.cashShift);
  console.log("   Resultado syncCashShift (apertura):", openRes);
  if (!openRes.ok) throw new Error("Error en syncCashShift apertura");

  // Verificar en Supabase directamente
  const { data: negRowOpen } = await sb.from("negocios").select("*").eq("id", DEFAULT_BUSINESS_ID).single();
  console.log("   Supabase negocios.configuracion.cashShift:", negRowOpen.configuracion?.cashShift);
  if (negRowOpen.configuracion?.cashShift?.status !== "open" || negRowOpen.configuracion?.cashShift?.openingCash !== 80000) {
    throw new Error("Supabase no guardó correctamente la apertura de caja");
  }
  console.log("   ✅ Apertura de caja persistida con éxito en Supabase.");

  // 3. Simular cliente Web que hace pullAllFromSupabase
  console.log("\n3. Simulando Web App que descarga (pull) el estado de caja...");
  global.state = {
    profile: { syncId: DEFAULT_BUSINESS_ID },
    cashShift: { status: "closed" },
    products: [],
    payments: []
  };

  await NexoSync.pullAllFromSupabase();
  console.log("   Estado de caja en la web tras pull:", global.state.cashShift);
  if (global.state.cashShift?.status !== "open" || global.state.cashShift?.openingCash !== 80000) {
    throw new Error("Web no hidrató correctamente la apertura de caja desde Supabase");
  }
  if (shiftStatusRendered !== "open") {
    throw new Error("renderShiftStatus no fue invocado con estado abierto");
  }
  console.log("   ✅ Web App sincronizó la caja abierta y actualizó renderShiftStatus.");

  // 4. Probar sincronización de turno de caja (Cierre)
  console.log("\n4. Probando sincronización de Cierre de Caja...");
  global.state.cashShift = { id: "shift_test_100", status: "closed", lastClosedAt: Date.now() };
  const closeRes = await NexoSync.syncCashShift(global.state.cashShift);
  console.log("   Resultado syncCashShift (cierre):", closeRes);
  if (!closeRes.ok) throw new Error("Error en syncCashShift cierre");

  // Simular descarga en el otro dispositivo
  global.state.cashShift = { status: "open", openingCash: 80000 };
  await NexoSync.pullAllFromSupabase();
  console.log("   Estado de caja en la web tras cierre pull:", global.state.cashShift);
  if (global.state.cashShift?.status !== "closed") {
    throw new Error("Web no hidrató el cierre de caja desde Supabase");
  }
  console.log("   ✅ Cierre de caja sincronizado en ambos sentidos.");

  // 5. Probar venta y descuento de stock en Supabase
  console.log("\n5. Probando descuento de stock en Supabase al registrar venta...");
  const { data: p7Initial } = await sb.from("productos").select("*").eq("id", "p7").single();
  const initialStock = Number(p7Initial?.stock ?? 10);
  console.log(`   Stock inicial de 'p7' en Supabase: ${initialStock}`);

  const newStock = initialStock > 0 ? initialStock - 1 : 10;
  const testSale = {
    id: `pay_test_${Date.now()}`,
    orderId: `ord_test_${Date.now()}`,
    amount: 35000,
    method: "Efectivo",
    payments: [{ method: "Efectivo", amount: 35000 }],
    items: [{ productId: "p7", id: "p7", name: "Aguardiente (media)", qty: 1, price: 35000 }],
    customer: "Cliente Test Sincronización",
    created_at: new Date().toISOString(),
    sync_status: "pending"
  };

  global.state.products = [{
    id: "p7",
    name: "Aguardiente (media)",
    categoria: "Licores",
    precio: 35000,
    costo: 0,
    stock: newStock,
    sync_status: "pending"
  }];
  global.state.payments = [testSale];

  console.log(`   Ejecutando syncSale con nuevo stock calculado: ${newStock}...`);
  const saleSyncRes = await NexoSync.syncSale(testSale);
  console.log("   Resultado syncSale:", saleSyncRes);
  if (!saleSyncRes.ok) throw new Error("syncSale falló: " + saleSyncRes.error);

  const { data: p7AfterSale } = await sb.from("productos").select("*").eq("id", "p7").single();
  console.log(`   Stock de 'p7' en Supabase tras la venta: ${p7AfterSale.stock}`);
  if (Number(p7AfterSale.stock) !== newStock) {
    throw new Error(`El stock en Supabase (${p7AfterSale.stock}) no coincide con el nuevo stock (${newStock})`);
  }

  const { data: saleInCloud } = await sb.from("ventas").select("*").eq("id", testSale.id).single();
  if (!saleInCloud) throw new Error("La venta no fue guardada en Supabase");
  console.log("   ✅ Venta y descuento de stock persistidos correctamente en Supabase.");

  // 6. Probar que la Web App descarga la nueva venta y el stock actualizado
  console.log("\n6. Probando descarga (Pull) en Web App de la nueva venta y stock...");
  global.state = {
    profile: { syncId: DEFAULT_BUSINESS_ID },
    cashShift: { status: "closed" },
    products: [{ id: "p7", name: "Aguardiente", stock: 999 }],
    payments: []
  };

  await NexoSync.pullAllFromSupabase();
  const webP7 = global.state.products.find(p => p.id === "p7");
  console.log(`   Stock de 'p7' en la Web App tras Pull: ${webP7?.stock}`);
  if (Number(webP7?.stock) !== newStock) {
    throw new Error(`La Web App no descargó el stock actualizado: esperado ${newStock}, obtenido ${webP7?.stock}`);
  }
  const webSale = global.state.payments.find(p => p.id === testSale.id);
  if (!webSale) throw new Error("La Web App no descargó la venta registrada");
  console.log("   ✅ Web App descargó la venta y el stock actualizado con éxito.");

  // Restaurar stock original de p7 y limpiar venta de prueba
  await sb.from("ventas").delete().eq("id", testSale.id);
  await sb.from("productos").upsert({ ...p7Initial, stock: initialStock }, { onConflict: "id" });
  console.log("   (Limpieza y restauración de stock completada)");

  console.log("\n=== TODAS LAS PRUEBAS DE SINCRONIZACIÓN PASARON EXITOSAMENTE ===");
  process.exit(0);
}

runTests().catch(err => {
  console.error("❌ ERROR EN PRUEBAS:", err);
  process.exit(1);
});
