// src/main/preload.js
// Runs in the isolated world. Exposes a minimal, audited surface area to the
// host.html renderer via contextBridge. No Node APIs leak.
//
// Phase 1: splash + magicline-error listeners
// Phase 3: credentials overlay, PIN modal, variant-aware error, touch kbd

const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  isDev: process.env.NODE_ENV === 'development',

  // Phase 1 — splash
  onHideSplash: (cb) => ipcRenderer.on('splash:hide', () => cb()),
  onShowSplash: (cb) => ipcRenderer.on('splash:show', () => cb()),

  // Phase 2 — magicline-error (now variant-aware; payload shape extended)
  onShowMagiclineError: (cb) => ipcRenderer.on('show-magicline-error', (_e, payload) => cb(payload)),
  onHideMagiclineError: (cb) => ipcRenderer.on('hide-magicline-error', () => cb()),

  // Phase 3 — credentials overlay (main → renderer)
  onShowCredentialsOverlay: (cb) => ipcRenderer.on('show-credentials-overlay', (_e, payload) => cb(payload)),
  onHideCredentialsOverlay: (cb) => ipcRenderer.on('hide-credentials-overlay', () => cb()),

  // Phase 3 — PIN modal (main → renderer)
  onShowPinModal: (cb) => ipcRenderer.on('show-pin-modal', () => cb()),
  onHidePinModal: (cb) => ipcRenderer.on('hide-pin-modal', () => cb()),

  // Phase 3 — renderer → main (invoke)
  submitCredentials: (payload) => ipcRenderer.invoke('submit-credentials', payload),
  verifyPin:         (pin)     => ipcRenderer.invoke('verify-pin', { pin: pin }),
  requestPinRecovery:()        => ipcRenderer.invoke('request-pin-recovery'),
  launchTouchKeyboard:()       => ipcRenderer.invoke('launch-touch-keyboard'),
});
