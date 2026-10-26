/* NexoBar · Panel SuperAdmin SaaS (admin.html)
   Página independiente: no carga el POS ni toca sus datos locales (IndexedDB, archivo espejo).
   - Login con Supabase Auth; solo entra una cuenta con app_metadata.role === 'superadmin'.
   - Datos desde las RPC admin_get_all_negocios y admin_update_negocio_status.
   La verificación de rol aquí es solo de interfaz: las RPC deben comprobar el rol en el servidor. */

// Mismo proyecto que sync.js (no se carga sync.js aquí: arrancaría el ciclo de sincronización del POS)
const ADMIN_SUPABASE_URL = 'https://fthjtbhxqqzqpyhtynaa.supabase.co';
const ADMIN_SUPABASE_ANON_KEY = 'sb_publishable_qg2FVUMhBsIshhIRCOGISg_vLF1PLuy';
// Clave propia y sessionStorage: no se mezcla con la sesión de la terminal y se cierra con la pestaña
const ADMIN_AUTH_KEY = 'nexobar-superadmin-auth';
const EXTEND_DAYS = 30;
const NOT_SUPERADMIN = 'Acceso no autorizado: esta cuenta no tiene permisos de SuperAdmin';

let adminClient = null, negocios = [], loadingNegocios = false;
const busyIds = new Set();

const fmtInt = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 0 });
const fmtDate = new Intl.DateTimeFormat('es-CO', { day: '2-digit', month: 'short', year: 'numeric' });

function getAdminClient() {
  if (adminClient) return adminClient;
  const factory = typeof window !== 'undefined' ? window.supabase : globalThis.supabase;
  if (!factory || typeof factory.createClient !== 'function') return null;
  let storage;
  try { storage = sessionStorage; } catch { storage = undefined; } // sin sessionStorage: sesión en memoria
  adminClient = factory.createClient(ADMIN_SUPABASE_URL, ADMIN_SUPABASE_ANON_KEY, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false, storageKey: ADMIN_AUTH_KEY, ...(storage ? { storage } : {}) }
  });
  return adminClient;
}

/* ---------- Lógica pura (probada en scratch/test-admin-panel.js) ---------- */
function isSuperadmin(user) { return user?.app_metadata?.role === 'superadmin'; }
function computeMetrics(list) {
  const rows = Array.isArray(list) ? list : [];
  const active = rows.filter(n => n.activo !== false).length;
  return { total: rows.length, active, suspended: rows.length - active, sales: rows.reduce((sum, n) => sum + (Number(n.total_ventas) || 0), 0) };
}
function expiryInfo(fecha, now = Date.now()) {
  if (!fecha) return { label: 'Sin fecha', tone: 'muted' };
  const date = new Date(fecha); if (Number.isNaN(date.getTime())) return { label: 'Sin fecha', tone: 'muted' };
  const days = Math.ceil((date.getTime() - now) / 86400000);
  const label = fmtDate.format(date);
  if (days < 0) return { label, tone: 'danger', note: 'Vencida' };
  if (days <= 7) return { label, tone: 'warn', note: days === 0 ? 'Vence hoy' : `Vence en ${days} d` };
  return { label, tone: 'ok', note: `${days} días` };
}
// Parámetros de admin_update_negocio_status(p_negocio_id, p_activo, p_plan, p_extender_dias)
function statusPayload(negocio, { activo = negocio.activo !== false, extenderDias = 0 } = {}) {
  return { p_negocio_id: String(negocio.id), p_activo: Boolean(activo), p_plan: negocio.plan || null, p_extender_dias: Number(extenderDias) || 0 };
}
function escapeAdminHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, ch => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch]));
}

/* ---------- Supabase ---------- */
async function adminSignIn(email, password) {
  const sb = getAdminClient();
  if (!sb) return { ok: false, error: 'No se pudo cargar Supabase. Revisa tu conexión a internet y recarga.' };
  try {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) return { ok: false, error: /invalid|credentials/i.test(error.message || '') ? 'Correo o contraseña incorrectos.' : `No se pudo ingresar: ${error.message}` };
    if (!isSuperadmin(data?.user)) { await sb.auth.signOut({ scope: 'local' }); return { ok: false, error: NOT_SUPERADMIN }; }
    return { ok: true, user: data.user };
  } catch (err) {
    return { ok: false, error: 'No se pudo conectar con el servidor. Intenta de nuevo.' };
  }
}
async function fetchNegocios() {
  const { data, error } = await getAdminClient().rpc('admin_get_all_negocios');
  if (error) throw new Error(error.message || 'Error al consultar los negocios');
  return Array.isArray(data) ? data : [];
}
async function updateNegocio(negocio, options) {
  const { error } = await getAdminClient().rpc('admin_update_negocio_status', statusPayload(negocio, options));
  if (error) throw new Error(error.message || 'Error al actualizar el negocio');
}

/* ---------- Interfaz ---------- */
const $ = selector => document.querySelector(selector);
let toastTimer = null;
function adminToast(message) {
  const el = $('#toast'); if (!el) return;
  el.textContent = message; el.classList.add('visible');
  clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('visible'), 3200);
}
function showView(view) {
  $('#adminBooting').hidden = true;
  $('#adminLogin').hidden = view !== 'login';
  $('#adminApp').hidden = view !== 'app';
}
function showLoginView(message = '') {
  negocios = []; showView('login');
  $('#adminLoginError').textContent = message;
  $('#adminPassword').value = '';
  $('#adminEmail').focus();
}
function showDashboard(user) {
  showView('app');
  $('#adminWho').textContent = user?.email || '';
  loadNegocios();
}

function renderMetrics() {
  const m = computeMetrics(negocios);
  $('#metricTotal').textContent = fmtInt.format(m.total);
  $('#metricActive').textContent = fmtInt.format(m.active);
  $('#metricSuspended').textContent = fmtInt.format(m.suspended);
  $('#metricSales').textContent = fmtInt.format(m.sales);
}
function renderTableMessage(text, withRetry = false) {
  $('#negociosBody').innerHTML = `<tr><td colspan="8" class="admin-empty">${escapeAdminHtml(text)}${withRetry ? ' <button type="button" class="outline-button admin-small" data-action="reload">Reintentar</button>' : ''}</td></tr>`;
}
function renderNegocios() {
  renderMetrics();
  if (!negocios.length) return renderTableMessage('Aún no hay negocios registrados.');
  $('#negociosBody').innerHTML = negocios.map(n => {
    const active = n.activo !== false, busy = busyIds.has(String(n.id)), exp = expiryInfo(n.fecha_vencimiento);
    const id = escapeAdminHtml(n.id);
    return `<tr class="${active ? '' : 'is-suspended-row'}">
      <td><code class="admin-id">${id}</code></td>
      <td><strong>${escapeAdminHtml(n.nombre || 'Sin nombre')}</strong></td>
      <td><span class="admin-plan">${escapeAdminHtml(n.plan || '—')}</span></td>
      <td class="num">${fmtInt.format(Number(n.total_productos) || 0)}</td>
      <td class="num">${fmtInt.format(Number(n.total_ventas) || 0)}</td>
      <td><span class="admin-expiry is-${exp.tone}">${escapeAdminHtml(exp.label)}${exp.note ? `<small>${escapeAdminHtml(exp.note)}</small>` : ''}</span></td>
      <td><span class="admin-badge ${active ? 'is-active' : 'is-suspended'}">${active ? 'Activo' : 'Suspendido'}</span></td>
      <td class="actions"><div class="admin-actions">
        <button type="button" class="admin-switch" role="switch" aria-checked="${active}" data-action="toggle" data-id="${id}" ${busy ? 'disabled' : ''} title="${active ? 'Suspender' : 'Activar'} ${escapeAdminHtml(n.nombre || n.id)}"><span class="admin-switch-track"><span class="admin-switch-thumb"></span></span><span class="admin-switch-label">${active ? 'Activo' : 'Suspendido'}</span></button>
        <button type="button" class="outline-button admin-small" data-action="extend" data-id="${id}" ${busy ? 'disabled' : ''}>+${EXTEND_DAYS} días</button>
      </div></td>
    </tr>`;
  }).join('');
}
async function loadNegocios({ quiet = false } = {}) {
  if (loadingNegocios) return; loadingNegocios = true;
  if (!quiet && !negocios.length) renderTableMessage('Cargando negocios…');
  $('#adminRefresh').disabled = true;
  try {
    negocios = await fetchNegocios();
    renderNegocios();
    $('#adminLastUpdate').textContent = `Actualizado ${new Date().toLocaleTimeString('es-CO')}`;
  } catch (err) {
    renderMetrics(); renderTableMessage(`No se pudieron cargar los negocios: ${err.message}`, true);
  } finally {
    loadingNegocios = false; $('#adminRefresh').disabled = false;
  }
}
// Cambia estado o extiende la licencia y vuelve a consultar la lista completa
async function applyNegocioChange(id, kind) {
  const negocio = negocios.find(n => String(n.id) === id); if (!negocio || busyIds.has(id)) return;
  const active = negocio.activo !== false, name = negocio.nombre || negocio.id;
  if (kind === 'toggle' && active && !confirm(`¿Suspender «${name}»? Su POS quedará bloqueado hasta reactivarlo.`)) return;
  const options = kind === 'toggle' ? { activo: !active } : { extenderDias: EXTEND_DAYS };
  busyIds.add(id); renderNegocios();
  try {
    await updateNegocio(negocio, options);
    adminToast(kind === 'extend' ? `Licencia de «${name}» extendida ${EXTEND_DAYS} días.` : `«${name}» ${active ? 'suspendido' : 'activado'}.`);
  } catch (err) {
    adminToast(`⚠ No se pudo actualizar «${name}»: ${err.message}`);
  } finally {
    busyIds.delete(id);
    await loadNegocios({ quiet: true });
  }
}

async function handleLoginSubmit(event) {
  event.preventDefault();
  const email = $('#adminEmail').value.trim().toLowerCase(), password = $('#adminPassword').value;
  const errorEl = $('#adminLoginError'), submit = $('#adminLoginSubmit');
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) { errorEl.textContent = 'Escribe un correo electrónico válido.'; return; }
  if (!password) { errorEl.textContent = 'Escribe la contraseña.'; return; }
  submit.disabled = true; submit.textContent = 'Verificando…'; errorEl.textContent = '';
  const result = await adminSignIn(email, password);
  submit.disabled = false; submit.textContent = 'Ingresar al panel';
  if (!result.ok) { errorEl.textContent = result.error; $('#adminPassword').value = ''; return $('#adminPassword').focus(); }
  $('#adminPassword').value = '';
  showDashboard(result.user);
}
async function handleLogout() {
  try { await getAdminClient()?.auth.signOut({ scope: 'local' }); } catch { /* sin conexión: se descarta la sesión local */ }
  showLoginView();
}

async function initAdmin() {
  $('#adminLoginForm').addEventListener('submit', handleLoginSubmit);
  $('#adminLogout').addEventListener('click', handleLogout);
  $('#adminRefresh').addEventListener('click', () => loadNegocios());
  $('#negociosBody').addEventListener('click', event => {
    const button = event.target.closest('button[data-action]'); if (!button) return;
    if (button.dataset.action === 'reload') return loadNegocios();
    applyNegocioChange(button.dataset.id, button.dataset.action);
  });

  const sb = getAdminClient();
  if (!sb) return showLoginView('No se pudo cargar Supabase. Revisa tu conexión a internet y recarga.');
  sb.auth.onAuthStateChange(event => { if (event === 'SIGNED_OUT' && !$('#adminApp').hidden) showLoginView('La sesión se cerró. Ingresa de nuevo.'); });
  try {
    const { data } = await sb.auth.getSession();
    const user = data?.session?.user;
    if (user && isSuperadmin(user)) return showDashboard(user);
    if (user) await sb.auth.signOut({ scope: 'local' }); // sesión válida pero sin rol: no se reutiliza
    showLoginView(user ? NOT_SUPERADMIN : '');
  } catch {
    showLoginView();
  }
}

if (typeof document !== 'undefined' && typeof document.addEventListener === 'function' && !globalThis.__IS_NODE_TEST__) {
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', initAdmin); else initAdmin();
}
if (typeof module !== 'undefined' && module.exports) {
  module.exports = { isSuperadmin, computeMetrics, expiryInfo, statusPayload, escapeAdminHtml, adminSignIn, fetchNegocios, updateNegocio, NOT_SUPERADMIN, EXTEND_DAYS };
}
