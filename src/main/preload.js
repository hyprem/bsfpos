// src/main/preload.js
// Runs in the isolated world. Exposes a minimal, audited surface area to the
// host.html renderer via contextBridge. No Node APIs leak.

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  isDev: process.env.NODE_ENV === 'development',
  onHideSplash: (cb) => ipcRenderer.on('splash:hide', () => cb()),
  onShowSplash: (cb) => ipcRenderer.on('splash:show', () => cb()),
});
