/* NexoBar · Aplicación de escritorio nativa (Windows - Electron)
   Abre la aplicación POS en una ventana nativa con:
   - Resolución inicial de 1280x800 (redimensionable y maximizada)
   - Barra de menú oculta para experiencia inmersiva de POS
   - Soporte 100% offline con base de datos en disco y respaldos automáticos
   - Acceso al sistema de archivos local mediante IPC seguro (preload)
*/
const { app, BrowserWindow, ipcMain, dialog, shell, Menu } = require('electron');
const path = require('path');
const fs = require('fs');

// Control de instancia única (evita abrir dos cajas simultáneas en la misma máquina)
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
}

let win = null;
let flushed = false;

const userDir = () => app.getPath('userData');
const configFile = () => path.join(userDir(), 'config.json');
const mirrorFile = () => path.join(userDir(), 'datos', 'nexobar-pos.json');
const legacyMirrorFile = () => path.join(userDir(), 'datos', 'brasa-pos.json'); // instalaciones anteriores al cambio de nombre
const BACKUP_PATTERN = /^(nexobar|brasa)-pos-respaldo-.*\.json$/;
const KEEP_BACKUPS = 120;

function readConfig() {
  try {
    return JSON.parse(fs.readFileSync(configFile(), 'utf8'));
  } catch {
    return {};
  }
}

function writeConfig(config) {
  fs.mkdirSync(userDir(), { recursive: true });
  fs.writeFileSync(configFile(), JSON.stringify(config, null, 2));
}

function backupDir() {
  const legacyDir = path.join(app.getPath('documents'), 'BrasaPOS', 'Respaldos');
  const defaultDir = fs.existsSync(legacyDir) ? legacyDir : path.join(app.getPath('documents'), 'NexoBar', 'Respaldos');
  const dir = readConfig().backupDir || defaultDir;
  fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function atomicWrite(file, data) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, data);
  fs.renameSync(tmp, file);
}

function pruneBackups(dir) {
  try {
    const files = fs.readdirSync(dir).filter(name => BACKUP_PATTERN.test(name)).sort().reverse();
    files.slice(KEEP_BACKUPS).forEach(name => {
      try { fs.unlinkSync(path.join(dir, name)); } catch { /* archivo en uso */ }
    });
  } catch {
    /* ignore */
  }
}

// Canales de comunicación segura (IPC)
ipcMain.handle('mirror:load', () => {
  for (const file of [mirrorFile(), legacyMirrorFile()]) {
    try {
      return fs.readFileSync(file, 'utf8');
    } catch {
      /* no existe: probar el siguiente */
    }
  }
  return null;
});

ipcMain.handle('mirror:save', (_event, json) => {
  try {
    const file = mirrorFile();
    if (fs.existsSync(file) && Date.now() - fs.statSync(file).mtimeMs > 3600 * 1000) {
      fs.copyFileSync(file, `${file}.bak`);
    }
    atomicWrite(file, String(json));
    return true;
  } catch {
    return false;
  }
});

ipcMain.handle('backup:save', (_event, name, json) => {
  try {
    const dir = backupDir();
    const file = path.join(dir, path.basename(String(name)));
    fs.writeFileSync(file, String(json));
    pruneBackups(dir);
    return { ok: true, path: file };
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  }
});

ipcMain.handle('backup:openFolder', () => shell.openPath(backupDir()));

ipcMain.handle('backup:chooseFolder', async () => {
  const result = await dialog.showOpenDialog(win, {
    title: 'Carpeta de respaldos de NexoBar',
    properties: ['openDirectory', 'createDirectory']
  });
  if (result.canceled || !result.filePaths[0]) return null;
  const config = readConfig();
  config.backupDir = result.filePaths[0];
  writeConfig(config);
  return config.backupDir;
});

ipcMain.handle('app:info', () => ({
  backupDir: backupDir(),
  dataFile: mirrorFile(),
  version: app.getVersion(),
  platform: process.platform
}));

// Impresión de tickets: ventana oculta temporal con el HTML del comprobante.
// El HTML va a un archivo temporal (un logo en data URL puede superar el límite de URL de Chromium).
ipcMain.handle('print:receipt', async (_event, html, options = {}) => {
  if (typeof html !== 'string' || !html || html.length > 8 * 1024 * 1024) return { ok: false, error: 'Contenido de impresión no válido.' };
  const silent = Boolean(options && options.silent);
  const deviceName = options && typeof options.printerName === 'string' ? options.printerName.trim() : '';
  const tmpFile = path.join(app.getPath('temp'), `nexobar-ticket-${Date.now()}-${Math.random().toString(36).slice(2)}.html`);
  let printWin = null;
  try {
    fs.writeFileSync(tmpFile, html, 'utf8');
    printWin = new BrowserWindow({ show: false, width: 420, height: 900, webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, javascript: false } });
    printWin.webContents.setWindowOpenHandler(() => ({ action: 'deny' }));
    printWin.webContents.on('will-navigate', event => event.preventDefault());
    await printWin.loadFile(tmpFile);
    return await new Promise(resolve => {
      printWin.webContents.print({ silent, printBackground: true, margins: { marginType: 'none' }, ...(deviceName ? { deviceName } : {}) }, (success, failureReason) => {
        const cancelled = !success && /cancel/i.test(String(failureReason || ''));
        resolve({ ok: success, cancelled, error: success || cancelled ? null : String(failureReason || 'Error de impresión') });
      });
    });
  } catch (error) {
    return { ok: false, error: String(error.message || error) };
  } finally {
    if (printWin && !printWin.isDestroyed()) printWin.destroy();
    fs.unlink(tmpFile, () => {});
  }
});

ipcMain.handle('print:listPrinters', async () => {
  if (!win) return [];
  try {
    const printers = await win.webContents.getPrintersAsync();
    return printers.map(p => ({ name: p.name, displayName: p.displayName || p.name, isDefault: Boolean(p.isDefault) }));
  } catch {
    return [];
  }
});

ipcMain.on('app:flushed', () => {
  flushed = true;
  if (win) win.close();
});

// Única excepción al bloqueo de ventanas: enlaces de WhatsApp (https://wa.me/...), abiertos fuera de la app
function isWhatsAppUrl(url) {
  try { const u = new URL(url); return u.protocol === 'https:' && u.hostname === 'wa.me'; } catch { return false; }
}

function createWindow() {
  const preloadPath = fs.existsSync(path.join(__dirname, 'preload.js'))
    ? path.join(__dirname, 'preload.js')
    : path.join(__dirname, 'electron', 'preload.js');

  const iconCandidates = [
    path.join(__dirname, 'build', 'icon.png'),
    path.join(__dirname, 'build', 'icon.ico'),
    path.join(__dirname, 'logo.png')
  ];
  const iconPath = iconCandidates.find(p => fs.existsSync(p)) || iconCandidates[0];

  win = new BrowserWindow({
    width: 1280,
    height: 800,
    minWidth: 1024,
    minHeight: 640,
    show: false,
    backgroundColor: '#12141A',
    title: 'NexoBar · POS Inteligente',
    icon: iconPath,
    webPreferences: {
      preload: preloadPath,
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      spellcheck: false
    }
  });

  // Ocultar barra de menú nativa para interfaz táctil/POS limpia
  Menu.setApplicationMenu(null);

  win.once('ready-to-show', () => {
    win.show();
  });

  // Seguridad: evitar navegación externa o popups accidentales
  win.webContents.setWindowOpenHandler(({ url }) => { if (isWhatsAppUrl(url)) shell.openExternal(url); return { action: 'deny' }; });
  win.webContents.on('will-navigate', (event, url) => { event.preventDefault(); if (isWhatsAppUrl(url)) shell.openExternal(url); });

  // Al cerrar la ventana, esperar hasta 4s para vaciar cualquier guardado en cola
  win.on('close', event => {
    if (flushed) return;
    event.preventDefault();
    win.webContents.send('app:flush');
    setTimeout(() => {
      flushed = true;
      if (win) win.close();
    }, 4000);
  });

  win.on('closed', () => {
    win = null;
  });

  win.loadFile(path.join(__dirname, 'index.html'));
}

if (gotLock) {
  app.whenReady().then(createWindow);
}

app.on('second-instance', () => {
  if (win) {
    if (win.isMinimized()) win.restore();
    win.focus();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});
