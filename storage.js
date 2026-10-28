/* Brasa POS · almacenamiento y respaldos
   - IndexedDB como almacenamiento principal (mucho más espacio que localStorage).
   - Migra automáticamente los datos que estaban en localStorage.
   - En la app de Windows (Electron) además guarda un archivo espejo en disco y respalda a una carpeta.
   Se carga ANTES de modules.js y app.js: solo declaraciones, el arranque lo hace bootstrap() en app.js. */

// isDemoMode() vive en demo-mode.js (cargado antes en index.html); en Node (pruebas) se carga aquí.
if (typeof module !== 'undefined' && typeof globalThis.isDemoMode !== 'function') require('./demo-mode.js');

function getDbName() {
  return isDemoMode() ? 'nexobar_demo_db' : 'brasa-pos';
}
globalThis.getDbName = getDbName;

const DB_STORE = 'kv', DB_KEY = 'state', LEGACY_KEY = 'brasa-pos-v1', DEMO_FALLBACK_KEY = 'nexobar_demo_state';
const BACKUP_DEFAULTS = { onClose: true, daily: true, lastAt: null, lastReason: '', lastFile: '', lastWhere: '' };
globalThis.BACKUP_DEFAULTS = BACKUP_DEFAULTS;
let storageReady = false, storageMode = 'indexeddb', storageDb = null, storageOpening = null;
let saveTimer = null, mirrorTimer = null, saveChain = Promise.resolve(), lastSaveErrorToast = 0, storageInfoAt = 0;
const storageStatus = { lastSavedAt: null, error: null, migrated: false, restoredFromFile: false };

/* ---------- IndexedDB ----------
   Una sola conexión por pestaña (storageDb) y una sola apertura en curso (storageOpening). Safari iOS congela la
   página en el BFCache al pasar entre la app y el Modo Demo con «Atrás»: la conexión vieja queda huérfana y sus
   transacciones se cancelan («Transacción cancelada»). Por eso la conexión se suelta al ocultar la página o si otra
   pestaña la necesita, y cada operación la reabre y reintenta una vez si la encuentra muerta. */
function closeStorageDb() {
  const db = storageDb; storageDb = null;
  try { db?.close?.(); } catch { /* ya estaba cerrada */ }
}
const IDB_OPEN_TIMEOUT = 6000; // Safari iOS a veces deja indexedDB.open sin respuesta: se corta y se reintenta
function idbOpenOnce() {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in globalThis)) return reject(new Error('Este navegador no tiene IndexedDB.'));
    let settled = false;
    const timer = setTimeout(() => { settled = true; reject(new Error('La base de datos no respondió.')); }, IDB_OPEN_TIMEOUT);
    const request = indexedDB.open(getDbName(), 1);
    request.onupgradeneeded = () => { if (!request.result.objectStoreNames.contains(DB_STORE)) request.result.createObjectStore(DB_STORE); };
    request.onsuccess = () => {
      const db = request.result;
      if (settled) { try { db.close(); } catch { /* sin conexión */ } return; } // llegó tarde: ya se reintentó
      settled = true; clearTimeout(timer);
      // Otra pestaña pide una versión nueva: se cede la conexión; la próxima operación abre otra
      db.onversionchange = () => { db.close(); if (storageDb === db) storageDb = null; };
      // El navegador la cerró por su cuenta (WebKit lo hace al congelar o descartar la página)
      db.onclose = () => { if (storageDb === db) storageDb = null; };
      resolve(db);
    };
    request.onerror = () => { if (settled) return; settled = true; clearTimeout(timer); reject(request.error || new Error('No se pudo abrir la base de datos.')); };
    // Bloqueada por una conexión anterior: se cierra la propia; la petición sigue sola en cuanto se libere
    request.onblocked = () => closeStorageDb();
  });
}
// Singleton: si ya hay una apertura en curso se devuelve la misma promesa; si falla, un reintento limpio
function idbOpen() {
  if (storageDb) return Promise.resolve(storageDb);
  if (!storageOpening) {
    storageOpening = idbOpenOnce()
      .catch(() => { closeStorageDb(); return idbOpenOnce(); })
      .then(db => { storageDb = db; return db; })
      .finally(() => { storageOpening = null; });
  }
  return storageOpening;
}
function idbRequest(db, mode, action) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(DB_STORE, mode); let result;
    const request = action(tx.objectStore(DB_STORE)); if (request) request.onsuccess = () => { result = request.result; };
    tx.oncomplete = () => resolve(result); tx.onerror = tx.onabort = () => reject(tx.error || new Error('Transacción cancelada.'));
  });
}
// Con una conexión cerrada o huérfana la transacción falla: se descarta, se abre una nueva y se reintenta una vez
async function idbRun(mode, action) {
  try { return await idbRequest(await idbOpen(), mode, action); }
  catch { closeStorageDb(); return idbRequest(await idbOpen(), mode, action); }
}
const idbGet = key => idbRun('readonly', store => store.get(key));
const idbPut = (key, value) => idbRun('readwrite', store => store.put(value, key));
function readLegacy() {
  if (isDemoMode()) return null;
  try { const raw = localStorage.getItem(LEGACY_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}
globalThis.readLegacy = readLegacy;

/* Devuelve los datos guardados (o null si es la primera vez). */
async function storageInit() {
  let saved = null;
  try { await idbOpen(); storageMode = 'indexeddb'; } catch (error) { closeStorageDb(); storageMode = 'localstorage'; storageStatus.error = String(error.message || error); }
  if (storageMode === 'indexeddb') {
    saved = (await idbGet(DB_KEY)) ?? null;
    if (!isDemoMode()) {
      if (!saved && globalThis.desktop?.loadMirror) { // IndexedDB vacío pero existe el archivo espejo del escritorio
        try { const raw = await desktop.loadMirror(); if (raw) { saved = JSON.parse(raw); storageStatus.restoredFromFile = true; await idbPut(DB_KEY, saved); } } catch { saved = null; }
      }
      if (!saved) { // migración desde localStorage (versiones anteriores)
        const legacy = readLegacy();
        if (legacy) {
          await idbPut(DB_KEY, legacy); const check = await idbGet(DB_KEY);
          if (check && JSON.stringify(check).length === JSON.stringify(legacy).length) { saved = check; storageStatus.migrated = true; try { localStorage.removeItem(LEGACY_KEY); } catch { /* sin permiso: se deja */ } } else saved = legacy;
        }
      }
    }
  } else {
    if (isDemoMode()) {
      try { const raw = sessionStorage.getItem(DEMO_FALLBACK_KEY); saved = raw ? JSON.parse(raw) : null; } catch { saved = null; }
    } else {
      saved = readLegacy();
    }
  }
  try { navigator.storage?.persist?.().catch(() => {}); } catch { /* opcional */ }
  if (!isDemoMode() && globalThis.desktop?.onFlushRequest) desktop.onFlushRequest(async () => { await flushAll(); desktop.flushDone(); });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') flushAll(); });
  // Al salir o entrar al BFCache se guarda y luego se suelta la conexión (cerrarla antes cancelaría el guardado).
  // Si la página vuelve del BFCache, la siguiente operación abre una conexión nueva.
  window.addEventListener('pagehide', () => { flushAll().finally(() => { if (storageMode === 'indexeddb') closeStorageDb(); }); });
  return saved;
}

/* ---------- Sesión de Supabase Auth ----------
   El token de la terminal vinculada se guarda en localStorage con clave propia para que, al recargar o
   reiniciar la app, las consultas sigan como 'authenticated'. NO va dentro de `state`: así no viaja al
   archivo espejo ni a los respaldos. Sin localStorage (Node, modo privado) queda solo en memoria. */
const AUTH_STORAGE_KEY = 'nexobar-auth';
const authMemory = {};
const authStorage = {
  getItem(key) { try { const value = localStorage.getItem(key); return value ?? authMemory[key] ?? null; } catch { return authMemory[key] ?? null; } },
  setItem(key, value) { authMemory[key] = value; try { localStorage.setItem(key, value); } catch { /* queda en memoria */ } },
  removeItem(key) { delete authMemory[key]; try { localStorage.removeItem(key); } catch { /* sin permiso */ } }
};
globalThis.AUTH_STORAGE_KEY = AUTH_STORAGE_KEY;
globalThis.authStorage = authStorage;

/* ---------- Guardado (agrupa cambios seguidos) ---------- */
function scheduleSave() { if (!storageReady) return; clearTimeout(saveTimer); saveTimer = setTimeout(() => { saveChain = saveChain.then(persistNow).catch(() => {}); }, 250); }
async function persistNow() {
  try {
    if (storageMode === 'indexeddb') {
      await idbPut(DB_KEY, state);
    } else if (isDemoMode()) {
      sessionStorage.setItem(DEMO_FALLBACK_KEY, JSON.stringify(state));
    } else {
      localStorage.setItem(LEGACY_KEY, JSON.stringify(state));
    }
    storageStatus.lastSavedAt = Date.now(); storageStatus.error = null;
    if (!isDemoMode()) scheduleMirror();
  } catch (error) {
    storageStatus.error = String(error.message || error);
    if (Date.now() - lastSaveErrorToast > 60000) { lastSaveErrorToast = Date.now(); showToast('⚠ No se pudo guardar en el equipo. Descarga un respaldo ahora.'); }
  }
}
function scheduleMirror() {
  if (isDemoMode()) return;
  if (!globalThis.desktop?.saveMirror) return;
  clearTimeout(mirrorTimer);
  mirrorTimer = setTimeout(() => { try { desktop.saveMirror(JSON.stringify(state)).catch(() => {}); } catch { /* sin espejo */ } }, 2000);
}
async function flushAll() {
  clearTimeout(saveTimer); clearTimeout(mirrorTimer); if (!storageReady) return;
  saveChain = saveChain.then(persistNow).catch(() => {}); await saveChain;
  if (!isDemoMode() && globalThis.desktop?.saveMirror) { try { await desktop.saveMirror(JSON.stringify(state)); } catch { /* sin espejo */ } }
}

/* ---------- Respaldos ---------- */
function backupSettings() { state.backupSettings = { ...BACKUP_DEFAULTS, ...(state.backupSettings || {}) }; return state.backupSettings; }
function backupFileName(slug) { const d = new Date(), pad = n => String(n).padStart(2, '0'); return `nexobar-pos-respaldo-${today()}_${pad(d.getHours())}${pad(d.getMinutes())}-${slug}.json`; }
async function runBackup(reason = 'Manual', slug = 'manual', delayToast = false) {
  const settings = backupSettings(), json = JSON.stringify(state), name = backupFileName(slug);
  let ok = true, where = 'Carpeta de descargas del navegador';
  if (!isDemoMode() && globalThis.desktop?.saveBackup) { try { const result = await desktop.saveBackup(name, json); ok = !!result.ok; where = result.ok ? result.path : (result.error || 'Error al guardar'); } catch (error) { ok = false; where = String(error.message || error); } }
  else { try { downloadBlob(new Blob([json], { type: 'application/json' }), isDemoMode() ? `nexobar-pos-respaldo-DEMO-${today()}.json` : name); } catch (error) { ok = false; where = String(error.message || error); } }
  const at = Date.now();
  if (ok) Object.assign(settings, { lastAt: at, lastReason: reason, lastFile: name, lastWhere: where });
  state.backupLog = [...(state.backupLog || []), { at, reason, file: name, where, bytes: json.length, ok }].slice(-30);
  saveState(); renderBackupCard(true);
  const message = ok ? (globalThis.desktop ? `Respaldo guardado en ${where}` : `Respaldo descargado: ${name}`) : '⚠ No se pudo crear el respaldo. Revisa la carpeta de respaldos.';
  if (delayToast) setTimeout(() => showToast(message), 2000); else showToast(message);
  return ok;
}
function checkDailyBackup() {
  if (!storageReady || !globalThis.desktop?.saveBackup || !backupSettings().daily) return;
  const last = backupSettings().lastAt; if (!last || localISO(new Date(last)) !== today()) runBackup('Respaldo diario automático', 'diario');
}
function startBackupSchedule() { if (!globalThis.desktop?.saveBackup) return; checkDailyBackup(); setInterval(checkDailyBackup, 30 * 60 * 1000); }

async function refreshStorageInfo(force = false) {
  const el = document.querySelector('#storageInfo'); if (!el || (!force && Date.now() - storageInfoAt < 60000)) return; storageInfoAt = Date.now();
  let text = storageMode === 'indexeddb' ? 'Almacenamiento: IndexedDB del equipo' : 'Almacenamiento: localStorage (este navegador no permite IndexedDB)';
  try { const estimate = await navigator.storage?.estimate?.(); if (estimate?.usage != null) text += ` · ${(estimate.usage / 1048576).toFixed(1)} MB en uso`; } catch { /* opcional */ }
  const syncInfo = globalThis.NexoSync?.getStatus?.();
  if (syncInfo) {
    const syncText = syncInfo.status === 'synced' ? 'Nube conectada (Sincronizado)' : syncInfo.status === 'syncing' ? 'Sincronizando con Supabase...' : 'Modo Offline (Almacenamiento 100% local)';
    text += `<br><small>Sincronización en la nube: <b>${syncText}</b></small>`;
  }
  if (globalThis.desktop?.info) { try { const info = await desktop.info(); text += `<br><small>Datos en disco: ${escapeHtml(info.dataFile)}<br>Carpeta de respaldos: ${escapeHtml(info.backupDir)}</small>`; } catch { /* opcional */ } }
  if (storageStatus.error) text += `<br><small class="warn-text">Aviso: ${escapeHtml(storageStatus.error)}</small>`;
  el.innerHTML = text;
}
function renderBackupCard(forceInfo = false) {
  const status = document.querySelector('#backupStatus'); if (!status || !state) return;
  const settings = backupSettings(), stale = !settings.lastAt || Date.now() - settings.lastAt > 26 * 3600 * 1000;
  status.className = `backup-status ${stale ? 'stale' : 'fresh'}`;
  status.innerHTML = settings.lastAt ? `<strong>Último respaldo:</strong> ${fmtDateTime(settings.lastAt)} · ${escapeHtml(settings.lastReason)}<br><small>${escapeHtml(settings.lastWhere)}</small>${stale ? '<br><small>Han pasado más de 24 horas sin respaldar.</small>' : ''}` : '<strong>Aún no hay respaldos.</strong> Haz el primero con «Respaldar ahora».';
  document.querySelector('#backupOnClose').checked = !!settings.onClose; document.querySelector('#backupDaily').checked = !!settings.daily;
  document.querySelectorAll('[data-desktop-only]').forEach(el => { el.hidden = !globalThis.desktop; });
  document.querySelector('#backupLog').innerHTML = [...(state.backupLog || [])].reverse().slice(0, 5).map(e => `<div class="report-row"><span>${fmtDateTime(e.at)} · ${escapeHtml(e.reason)}</span><b>${e.ok ? `${Math.max(1, Math.round(e.bytes / 1024))} KB` : 'Error'}</b></div>`).join('') || '<p class="muted">Sin historial todavía.</p>';
  refreshStorageInfo(forceInfo);
}

globalThis.storageInit = storageInit;
globalThis.scheduleSave = scheduleSave;
globalThis.persistNow = persistNow;
globalThis.flushAll = flushAll;
globalThis.runBackup = runBackup;
globalThis.checkDailyBackup = checkDailyBackup;
globalThis.startBackupSchedule = startBackupSchedule;
globalThis.refreshStorageInfo = refreshStorageInfo;
globalThis.renderBackupCard = renderBackupCard;
globalThis.backupSettings = backupSettings;
