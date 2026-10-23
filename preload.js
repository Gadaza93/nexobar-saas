/* NexoBar · Puente seguro (Preload) entre Electron y la interfaz web del POS
   Expone APIs protegidas en window.desktop sin activar nodeIntegration.
*/
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('desktop', {
  isDesktop: true,
  loadMirror: () => ipcRenderer.invoke('mirror:load'),
  saveMirror: json => ipcRenderer.invoke('mirror:save', json),
  saveBackup: (name, json) => ipcRenderer.invoke('backup:save', name, json),
  openBackupFolder: () => ipcRenderer.invoke('backup:openFolder'),
  chooseBackupFolder: () => ipcRenderer.invoke('backup:chooseFolder'),
  info: () => ipcRenderer.invoke('app:info'),
  onFlushRequest: callback => ipcRenderer.on('app:flush', () => callback()),
  flushDone: () => ipcRenderer.send('app:flushed')
});
