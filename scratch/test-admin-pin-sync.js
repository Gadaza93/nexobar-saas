// Test Centralized Admin PIN Sync with Supabase (Desktop <-> Supabase <-> Web)
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
        }
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
  console.log("=== INICIANDO PRUEBAS DE CENTRALIZACIÓN DE PIN DE ADMINISTRADOR ===");
  const sb = createRestClient(SUPABASE_URL, SUPABASE_ANON_KEY);

  // 1. Mock global
  global.window = global;
  global.supabase = { createClient: () => sb };
  global.document = {
    querySelector: () => ({
      classList: { add: () => {}, remove: () => {} },
      textContent: '',
      title: '',
      className: '',
      open: false,
      close: () => {}
    }),
    querySelectorAll: () => [],
    addEventListener: () => {}
  };
  global.navigator = { onLine: true };
  global.showToast = msg => console.log("   [Toast]:", msg);

  delete require.cache[require.resolve('../modules.js')];
  require('../modules.js');

  delete require.cache[require.resolve('../sync.js')];
  require('../sync.js');
  const NexoSync = global.NexoSync;

  console.log("1. Verificando funciones de PIN expuestas...");
  if (typeof NexoSync.syncAdminPin !== 'function') throw new Error("syncAdminPin no está expuesto en NexoSync");
  if (typeof NexoSync.applyAdminPinLocally !== 'function') throw new Error("applyAdminPinLocally no está expuesto en NexoSync");
  console.log("   ✅ Funciones expuestas correctamente.");

  // 2. Persistir PIN '2013' a Supabase
  console.log("\n2. Guardando PIN de administración '2013' en Supabase...");
  global.state = {
    profile: { syncId: DEFAULT_BUSINESS_ID, name: "NexoBar Test" },
    users: [{
      id: "usr_admin",
      name: "Administrador",
      role: "admin",
      salt: "testsalt1",
      pinHash: global.hashPin("2013", "testsalt1"),
      active: true,
      mustChangePin: false
    }]
  };

  const syncRes = await NexoSync.syncAdminPin("2013", global.state.users[0]);
  console.log("   Resultado syncAdminPin:", syncRes);
  if (!syncRes.ok) throw new Error("syncAdminPin falló: " + syncRes.error);

  // Verificar en Supabase directamente
  const { data: negRow } = await sb.from("negocios").select("*").eq("id", DEFAULT_BUSINESS_ID).single();
  const cloudPin = negRow?.admin_pin || negRow?.configuracion?.admin_pin;
  console.log("   Supabase configuracion.admin_pin:", cloudPin);
  if (cloudPin !== "2013") {
    throw new Error(`PIN en Supabase (${cloudPin}) no coincide con 2013`);
  }
  console.log("   ✅ PIN 2013 persistido exitosamente en Supabase.");

  // 3. Simular apertura en un NUEVO dispositivo o navegador (IndexedDB vacío)
  console.log("\n3. Simulando apertura de la app en un dispositivo o navegador NUEVO...");
  global.state = {
    profile: { syncId: DEFAULT_BUSINESS_ID },
    users: [{
      id: "usr_default",
      name: "Administrador",
      role: "admin",
      salt: "defaultsalt",
      pinHash: global.hashPin("1234", "defaultsalt"), // PIN por defecto antes de sync
      active: true,
      mustChangePin: true // Forzaba cambio de PIN
    }],
    payments: [],
    products: []
  };

  console.log("   Estado antes de pull: mustChangePin =", global.state.users[0].mustChangePin);
  console.log("   Descargando configuración de negocio desde Supabase con pullAllFromSupabase...");
  await NexoSync.pullAllFromSupabase();

  const adminUser = global.state.users.find(u => u.role === "admin");
  console.log("   Estado después de pull:");
  console.log("   - mustChangePin:", adminUser.mustChangePin);
  console.log("   - profile.admin_pin:", global.state.profile?.admin_pin);

  if (adminUser.mustChangePin !== false) {
    throw new Error("El nuevo dispositivo sigue pidiendo cambiar la clave inicial (mustChangePin sigue en true)");
  }

  // Verificar autenticación del PIN
  const isValid2013 = global.hashPin("2013", adminUser.salt) === adminUser.pinHash;
  const isValid1234 = global.hashPin("1234", adminUser.salt) === adminUser.pinHash;

  console.log("   Validación PIN 2013 (correcto):", isValid2013);
  console.log("   Validación PIN 1234 (por defecto antiguo):", isValid1234);

  if (!isValid2013) throw new Error("El PIN '2013' centralizado no fue aceptado");
  if (isValid1234) throw new Error("El PIN '1234' antiguo por defecto fue aceptado cuando no debería");

  console.log("   ✅ El nuevo dispositivo adoptó automáticamente el PIN '2013' sin solicitar cambio inicial.");

  // 4. Probar actualización de PIN desde cualquier dispositivo
  console.log("\n4. Probando cambio de PIN a '4321' y replicación...");
  const updateRes = await NexoSync.syncAdminPin("4321", adminUser);
  if (!updateRes.ok) throw new Error("Fallo al actualizar a 4321");

  // Re-descargar en otro cliente simulado
  global.state.users = [{
    id: "usr_client2",
    name: "Administrador",
    role: "admin",
    salt: "s2",
    pinHash: "oldhash",
    mustChangePin: true
  }];
  await NexoSync.pullAllFromSupabase();
  const client2Admin = global.state.users.find(u => u.role === "admin");
  const isClient2Valid4321 = global.hashPin("4321", client2Admin.salt) === client2Admin.pinHash;
  if (!isClient2Valid4321) throw new Error("Cliente 2 no descargó el nuevo PIN 4321");
  console.log("   ✅ Cambio de PIN replicado exitosamente en el segundo dispositivo.");

  // Restaurar PIN original 2013
  await NexoSync.syncAdminPin("2013", adminUser);
  console.log("   (PIN '2013' restaurado en Supabase)");

  console.log("\n=== TODAS LAS PRUEBAS DE PIN PASARON EXITOSAMENTE ===");
  process.exit(0);
}

runTests().catch(err => {
  console.error("❌ ERROR EN PRUEBAS:", err);
  process.exit(1);
});
