// scratch/test-admin-panel.js
// Prueba del Panel SuperAdmin (admin.js) con un cliente Supabase simulado (no toca la base real):
// 1. Solo app_metadata.role === 'superadmin' entra; otra cuenta recibe el error y se cierra su sesión.
// 2. Métricas, vencimientos y parámetros de admin_update_negocio_status (toggle y +30 días).

const assert = require('assert');

console.log('=== PRUEBAS: PANEL SUPERADMIN ===\n');

globalThis.__IS_NODE_TEST__ = true;
let signInResult = null, signOutCalls = 0, rpcCalls = [], rpcResult = { data: [], error: null };
globalThis.supabase = {
  createClient: () => ({
    auth: {
      signInWithPassword: async () => signInResult,
      signOut: async () => { signOutCalls++; return { error: null }; }
    },
    rpc: async (name, params) => { rpcCalls.push({ name, params }); return rpcResult; }
  })
};
const admin = require('../admin.js');

(async () => {
  // --- 1. Login ---
  signInResult = { data: { user: { email: 'root@nexobar.co', app_metadata: { role: 'superadmin' } } }, error: null };
  let res = await admin.adminSignIn('root@nexobar.co', 'x');
  assert.strictEqual(res.ok, true);
  assert.strictEqual(signOutCalls, 0);
  console.log('   ✅ Una cuenta superadmin entra al tablero.');

  signInResult = { data: { user: { email: 'caja@bar.com', app_metadata: { business_id: 'bar_1' }, user_metadata: { role: 'superadmin' } } }, error: null };
  res = await admin.adminSignIn('caja@bar.com', 'x');
  assert.strictEqual(res.ok, false);
  assert.strictEqual(res.error, 'Acceso no autorizado: esta cuenta no tiene permisos de SuperAdmin');
  assert.strictEqual(signOutCalls, 1);
  console.log('   ✅ Cuenta sin rol (aunque user_metadata diga superadmin) recibe el error y se cierra su sesión.');

  signInResult = { data: { user: null }, error: { message: 'Invalid login credentials' } };
  res = await admin.adminSignIn('root@nexobar.co', 'mala');
  assert.strictEqual(res.error, 'Correo o contraseña incorrectos.');
  console.log('   ✅ Credenciales inválidas muestran un error claro.');

  // --- 2. Métricas ---
  const list = [
    { id: 'a', activo: true, total_ventas: 19 },
    { id: 'b', activo: false, total_ventas: '5' },
    { id: 'c', activo: true, total_ventas: null }
  ];
  assert.deepStrictEqual(admin.computeMetrics(list), { total: 3, active: 2, suspended: 1, sales: 24 });
  assert.deepStrictEqual(admin.computeMetrics(null), { total: 0, active: 0, suspended: 0, sales: 0 });
  console.log('   ✅ Métricas: total, activos, suspendidos y ventas globales.');

  const now = Date.parse('2026-10-26T12:00:00Z');
  assert.strictEqual(admin.expiryInfo('2026-10-20T00:00:00Z', now).note, 'Vencida');
  assert.strictEqual(admin.expiryInfo('2026-10-29T12:00:00Z', now).tone, 'warn');
  assert.strictEqual(admin.expiryInfo('2026-11-25T20:12:35+00:00', now).tone, 'ok');
  assert.strictEqual(admin.expiryInfo(null, now).label, 'Sin fecha');
  console.log('   ✅ Fecha de vencimiento: vencida, próxima a vencer y vigente.');

  // --- 3. RPC ---
  const negocio = { id: 'bar_central_01', activo: true, plan: 'pro' };
  rpcCalls = []; rpcResult = { data: null, error: null };
  await admin.updateNegocio(negocio, { activo: false });
  assert.deepStrictEqual(rpcCalls[0], { name: 'admin_update_negocio_status', params: { p_negocio_id: 'bar_central_01', p_activo: false, p_plan: 'pro', p_extender_dias: 0 } });
  console.log('   ✅ Suspender envía p_activo=false conservando el plan y sin extender días.');

  rpcCalls = [];
  await admin.updateNegocio(negocio, { extenderDias: admin.EXTEND_DAYS });
  assert.deepStrictEqual(rpcCalls[0].params, { p_negocio_id: 'bar_central_01', p_activo: true, p_plan: 'pro', p_extender_dias: 30 });
  console.log('   ✅ "+30 días" conserva estado y plan y envía p_extender_dias=30.');

  rpcResult = { data: null, error: { message: 'permission denied' } };
  await assert.rejects(() => admin.updateNegocio(negocio, { activo: false }), /permission denied/);
  rpcResult = { data: [{ id: 'x', nombre: 'X' }], error: null }; rpcCalls = [];
  assert.deepStrictEqual(await admin.fetchNegocios(), [{ id: 'x', nombre: 'X' }]);
  assert.strictEqual(rpcCalls[0].name, 'admin_get_all_negocios');
  console.log('   ✅ La lista sale de admin_get_all_negocios y los errores de la RPC se propagan.');

  assert.strictEqual(admin.escapeAdminHtml('<img src=x onerror=1>'), '&lt;img src=x onerror=1&gt;');
  console.log('   ✅ Nombres de negocio escapados antes de pintarlos.');

  console.log('\n=== TODAS LAS PRUEBAS DEL PANEL SUPERADMIN PASARON ===');
  process.exit(0);
})().catch(err => { console.error('❌', err); process.exit(1); });
