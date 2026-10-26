/* NexoBar · aplicación de escritorio (Windows).
   Abre la app web en una ventana propia y le da acceso al disco para:
   - guardar un archivo espejo de la base de datos (además de IndexedDB),
   - guardar respaldos en una carpeta (por defecto Documentos\NexoBar\Respaldos). */
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

const gotLock = app.requestSingleInstanceLock(); // una sola ventana del POS a la vez
if (!gotLock) app.quit();

let win = null, flushed = false;
const userDir = () => app.getPath('userData');
const configFile = () => path.join(userDir(), 'config.json');
const mirrorFile = () => path.join(userDir(), 'datos', 'nexobar-pos.json');
const legacyMirrorFile = () => path.join(userDir(), 'datos', 'brasa-pos.json'); // instalaciones anteriores al cambio de nombre
const BACKUP_PATTERN = /^(nexobar|brasa)-pos-respaldo-.*\.json$/, KEEP_BACKUPS = 120;

function readConfig() { try { return JSON.parse(fs.readFileSync(configFile(), 'utf8')); } catch { return {}; } }
function writeConfig(config) { fs.mkdirSync(userDir(), { recursive: true }); fs.writeFileSync(configFile(), JSON.stringify(config, null, 2)); }
function backupDir() { const legacyDir = path.join(app.getPath('documents'), 'BrasaPOS', 'Respaldos'); const defaultDir = fs.existsSync(legacyDir) ? legacyDir : path.join(app.getPath('documents'), 'NexoBar', 'Respaldos'); const dir = readConfig().backupDir || defaultDir; fs.mkdirSync(dir, { recursive: true }); return dir; }
function atomicWrite(file, data) { fs.mkdirSync(path.dirname(file), { recursive: true }); const tmp = `${file}.tmp`; fs.writeFileSync(tmp, data); fs.renameSync(tmp, file); }
function pruneBackups(dir) {
  const files = fs.readdirSync(dir).filter(name => BACKUP_PATTERN.test(name)).sort().reverse();
  files.slice(KEEP_BACKUPS).forEach(name => { try { fs.unlinkSync(path.join(dir, name)); } catch { /* en uso */ } });
}

ipcMain.handle('mirror:load', () => {
  for (const file of [mirrorFile(), legacyMirrorFile()]) { try { return fs.readFileSync(file, 'utf8'); } catch { /* no existe */ } }
  return null;
});
ipcMain.handle('mirror:save', (_event, json) => {
  try {
    const file = mirrorFile();
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs > 3600 * 1000) fs.copyFileSync(file, `${file}.bak`); // una copia previa por hora como máximo
    atomicWrite(file, String(json)); return true;
  } catch { return false; }
});
ipcMain.handle('backup:save', (_event, name, json) => {
  try { const dir = backupDir(), file = path.join(dir, path.basename(String(name))); fs.writeFileSync(file, String(json)); pruneBackups(dir); return { ok: true, path: file }; }
  catch (error) { return { ok: false, error: String(error.message || error) }; }
});
ipcMain.handle('backup:openFolder', () => shell.openPath(backupDir()));
ipcMain.handle('backup:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(win, { title: 'Carpeta para los respaldos', properties: ['openDirectory', 'createDirectory'] });
  if (result.canceled || !result.filePaths[0]) return null;
  const config = readConfig(); config.backupDir = result.filePaths[0]; writeConfig(config); return config.backupDir;
});
ipcMain.handle('app:info', () => ({ backupDir: backupDir(), dataFile: mirrorFile(), version: app.getVersion(), platform: process.platform }));
ipcMain.on('app:flushed', () => { flushed = true; if (win) win.close(); });

function createWindow() {
  win = new BrowserWindow({
    width: 1366, height: 820, minWidth: 1024, minHeight: 640, show: false, backgroundColor: '#181A20', title: 'NexoBar', icon: path.join(__dirname, '..', 'build', 'icon.png'),
    webPreferences: { preload: path.join(__dirname, 'preload.js'), contextIsolation: true, nodeIntegration: false, sandbox: true, spellcheck: false },
  });
  Menu.setApplicationMenu(null);
  win.once('ready-to-show', () => { win.maximize(); win.show(); });
  win.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
  win.webContents.on('will-navigate', event => event.preventDefault());
  win.on('close', event => { // antes de cerrar, la app termina de guardar sus datos (máx. 4 s)
    if (flushed) return; event.preventDefault();
    win.webContents.send('app:flush'); setTimeout(() => { flushed = true; if (win) win.close(); }, 4000);
  });
  win.on('closed', () => { win = null; });
  win.loadFile(path.join(__dirname, '..', 'index.html'));
}

if (gotLock) app.whenReady().then(createWindow);
app.on('second-instance', () => { if (win) { if (win.isMinimized()) win.restore(); win.focus(); } });
app.on('window-all-closed', () => app.quit());
