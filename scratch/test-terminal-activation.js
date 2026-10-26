// scratch/test-terminal-activation.js
// Prueba del flujo de activación de terminal (SaaS multinegocio):
// 1. NexoSync.activateTerminal: credenciales, business_id desde app_metadata, sin red y Modo Demo.
// 2. ensureTerminalLinked / linkTerminal (app.js): terminal nueva bloqueada, instalaciones antiguas respetadas.

const fs = require('fs');
const path = require('path');
const vm = require('vm');
const assert = require('assert');

console.log('=== PRUEBAS: ACTIVACIÓN DE TERMINAL ===\n');

globalThis.__FORCE_DEMO_MODE__ = false;
let authResponse = null, lastCredentials = null;
globalThis.supabase = {
  createClient: () => ({
    auth: { signInWithPassword: async creds => { lastCredentials = creds; return authResponse; } },
    from: () => ({})
  })
};
const NexoSync = require('../sync.js');

(async () => {
  // --- 1. activateTerminal ---
  authResponse = { data: { user: { email: 'caja@bar.com', app_metadata: { business_id: 'bar_900123' }, user_metadata: {} } }, error: null };
  let res = await NexoSync.activateTerminal('caja@bar.com', 'secreta');
  assert.deepStrictEqual(res, { ok: true, businessId: 'bar_900123', email: 'caja@bar.com' });
  assert.deepStrictEqual(lastCredentials, { email: 'caja@bar.com', password: 'secreta' });
  console.log('   ✅ Credenciales válidas devuelven el business_id de app_metadata.');

  authResponse = { data: { user: null }, error: { message: 'Invalid login credentials' } };
  res = await NexoSync.activateTerminal('caja@bar.com', 'mala');
  assert.strictEqual(res.ok, false); assert.strictEqual(res.error, 'Correo o contraseña incorrectos.');
  console.log('   ✅ Credenciales inválidas muestran un error claro.');

  authResponse = { data: { user: { email: 'x@bar.com', app_metadata: {}, user_metadata: { business_id: 'otro_negocio' } } }, error: null };
  res = await NexoSync.activateTerminal('x@bar.com', 'secreta');
  assert.strictEqual(res.ok, false);
  console.log('   ✅ Se ignora business_id en user_metadata (editable por el usuario).');

  globalThis.__FORCE_DEMO_MODE__ = true;
  res = await NexoSync.activateTerminal('caja@bar.com', 'secreta');
  assert.strictEqual(res.ok, false);
  globalThis.__FORCE_DEMO_MODE__ = false;
  console.log('   ✅ En Modo Demo no se contacta a Supabase.');

  // --- 1b. El ciclo de sincronización no arranca sin terminal vinculada ---
  globalThis.state = { profile: { syncId: 'nexobar_default' } };
  assert.strictEqual(NexoSync.isTerminalLinked(), false);
  globalThis.state.terminal = { businessId: 'bar_900123' };
  assert.strictEqual(NexoSync.isTerminalLinked(), true);
  delete globalThis.state;
  console.log('   ✅ isTerminalLinked bloquea init()/scheduleSync hasta vincular la terminal.');

  // --- 2. ensureTerminalLinked / linkTerminal (extraídas de app.js) ---
  const src = fs.readFileSync(path.join(__dirname, '..', 'app.js'), 'utf8');
  const block = src.slice(src.indexOf('function linkTerminal'), src.indexOf('function showActivation'));
  const makeCtx = profile => {
    const ctx = { state: { profile: { name: 'Bar', ...profile } }, saves: 0 };
    ctx.scheduleSave = () => { ctx.saves++; };
    vm.createContext(ctx); vm.runInContext(block, ctx);
    return ctx;
  };

  let ctx = makeCtx({ syncId: 'nexobar_default' });
  assert.strictEqual(ctx.ensureTerminalLinked(false), false);
  assert.strictEqual(ctx.state.terminal, undefined);
  console.log('   ✅ Terminal nueva sin datos queda bloqueada hasta activarse.');

  ctx = makeCtx({ syncId: 'nexobar_default' });
  assert.strictEqual(ctx.ensureTerminalLinked(true), true);
  assert.strictEqual(ctx.state.terminal.businessId, 'nexobar_default');
  assert.strictEqual(ctx.state.terminal.legacy, true);
  console.log('   ✅ Instalación existente con datos no se bloquea (vinculación heredada).');

  ctx = makeCtx({ syncId: 'bar_555' });
  assert.strictEqual(ctx.ensureTerminalLinked(false), true);
  assert.strictEqual(ctx.state.terminal.businessId, 'bar_555');
  console.log('   ✅ Un syncId personalizado se respeta como negocio vinculado.');

  ctx = makeCtx({ syncId: 'nexobar_default' });
  ctx.linkTerminal('bar_900123', { email: 'caja@bar.com' });
  assert.strictEqual(ctx.state.profile.syncId, 'bar_900123');
  assert.strictEqual(ctx.state.terminal.email, 'caja@bar.com');
  assert.ok(ctx.state.terminal.linkedAt > 0);
  assert.strictEqual(ctx.saves, 1);
  assert.strictEqual(ctx.ensureTerminalLinked(false), true);
  console.log('   ✅ linkTerminal guarda el negocio en el estado y fija profile.syncId.');

  console.log('\n=== TODAS LAS PRUEBAS DE ACTIVACIÓN PASARON ===');
  process.exit(0);
})().catch(err => { console.error('❌', err); process.exit(1); });
