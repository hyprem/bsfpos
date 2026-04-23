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
  // Phase 07 SPLASH-01 — welcome-path-only splash hide. Payload is { degraded: bool }.
  // Cold-boot and idle-recovery paths continue to use onHideSplash (splash:hide)
  // unchanged.
  onHideSplashFinal: (cb) => ipcRenderer.on('splash:hide-final', (_e, payload) => cb(payload || {})),

  // Phase 2 — magicline-error (now variant-aware; payload shape extended)
  onShowMagiclineError: (cb) => ipcRenderer.on('show-magicline-error', (_e, payload) => cb(payload)),
  onHideMagiclineError: (cb) => ipcRenderer.on('hide-magicline-error', () => cb()),

  // Phase 3 — credentials overlay (main → renderer)
  onShowCredentialsOverlay: (cb) => ipcRenderer.on('show-credentials-overlay', (_e, payload) => cb(payload)),
  onHideCredentialsOverlay: (cb) => ipcRenderer.on('hide-credentials-overlay', () => cb()),

  // Phase 3 — PIN modal (main → renderer)
  // Phase 5 extends payload: { context: 'admin' | 'reset-loop' } — host.js branches on context
  onShowPinModal: (cb) => ipcRenderer.on('show-pin-modal', (_e, payload) => cb(payload)),
  onHidePinModal: (cb) => ipcRenderer.on('hide-pin-modal', () => cb()),

  // Phase 3 — renderer → main (invoke)
  submitCredentials: (payload) => ipcRenderer.invoke('submit-credentials', payload),
  verifyPin:         (pin)     => ipcRenderer.invoke('verify-pin', { pin: pin }),
  requestPinRecovery:()        => ipcRenderer.invoke('request-pin-recovery'),
  launchTouchKeyboard:()       => ipcRenderer.invoke('launch-touch-keyboard'),

  // Phase 4 D-12 — idle overlay (main → renderer)
  onShowIdleOverlay: (cb) => { ipcRenderer.on('show-idle-overlay', (_e) => cb()); },
  onHideIdleOverlay: (cb) => { ipcRenderer.on('hide-idle-overlay', (_e) => cb()); },
  // Phase 4 D-12 — idle overlay (renderer → main, fire-and-forget)
  notifyIdleDismissed: () => { ipcRenderer.send('idle-dismissed'); },
  notifyIdleExpired:   () => { ipcRenderer.send('idle-expired');   },
  // Phase 4 D-19 — reset-loop admin recovery trigger (renderer → main)
  requestResetLoopRecovery: () => { ipcRenderer.send('request-reset-loop-recovery'); },

  // --- Phase 5 main → renderer subscribers ------------------------------
  onShowAdminMenu:      (cb) => ipcRenderer.on('show-admin-menu',       (_e, payload) => cb(payload)),
  onHideAdminMenu:      (cb) => ipcRenderer.on('hide-admin-menu',       () => cb()),
  onShowUpdateConfig:   (cb) => ipcRenderer.on('show-update-config',    (_e, payload) => cb(payload)),
  onHideUpdateConfig:   (cb) => ipcRenderer.on('hide-update-config',    () => cb()),
  onShowUpdatingCover:  (cb) => ipcRenderer.on('show-updating-cover',   () => cb()),
  onHideUpdatingCover:  (cb) => ipcRenderer.on('hide-updating-cover',   () => cb()),
  onShowAdminUpdateResult: (cb) => ipcRenderer.on('show-admin-update-result', (_e, payload) => cb(payload)),
  onShowPinLockout:     (cb) => ipcRenderer.on('show-pin-lockout',      (_e, payload) => cb(payload)),
  onHidePinLockout:     (cb) => ipcRenderer.on('hide-pin-lockout',      () => cb()),

  // Dev mode feedback (main → renderer)
  onDevModeChanged:     (cb) => ipcRenderer.on('dev-mode-changed', (_e, payload) => cb(payload)),

  // --- Phase 5 renderer → main invokes ---------------------------------
  verifyAdminPin:       (pin)     => ipcRenderer.invoke('verify-admin-pin',       { pin: pin }),
  getAdminDiagnostics:  ()        => ipcRenderer.invoke('get-admin-diagnostics'),
  adminMenuAction:      (action)  => ipcRenderer.invoke('admin-menu-action',      { action: action }),
  closeAdminMenu:       ()        => ipcRenderer.invoke('close-admin-menu'),
  submitUpdatePat:      (pat)     => ipcRenderer.invoke('submit-update-pat',      { pat: pat }),

  // --- Phase 6 — Welcome screen (D-02) ---------------------------------
  // Main → renderer: show welcome layer (fires on cold boot and after
  // welcome-mode hardReset completes).
  onShowWelcome:   (cb) => ipcRenderer.on('welcome:show', () => cb()),
  onHideWelcome:   (cb) => ipcRenderer.on('welcome:hide', () => cb()),
  // Renderer → main: user tapped the welcome layer; main will create
  // Magicline view + start authFlow.
  notifyWelcomeTap: () => { ipcRenderer.send('welcome:tap'); },

  // --- Phase 08 — PIN change overlay -----------------------------------
  onShowPinChangeOverlay: (cb) => ipcRenderer.on('show-pin-change-overlay', () => cb()),
  onHidePinChangeOverlay: (cb) => ipcRenderer.on('hide-pin-change-overlay', () => cb()),
  submitPinChange: (payload) => ipcRenderer.invoke('submit-pin-change', payload),
  cancelPinChange: () => ipcRenderer.invoke('cancel-pin-change'),

  // --- Phase 09 — POS open/close state -----------------------------------
  onPosStateChanged: (cb) => ipcRenderer.on('pos-state-changed', (_e, payload) => cb(payload)),

  // --- Phase 10 — Post-sale overlay (D-19) ---------------------------------
  // Main → renderer: show / hide the branded "Vielen Dank" overlay.
  onShowPostSale: (cb) => ipcRenderer.on('post-sale:show', (_e) => cb()),
  onHidePostSale: (cb) => ipcRenderer.on('post-sale:hide', (_e) => cb()),
  // Renderer → main (fire-and-forget): button tap vs countdown-expiry
  // outcomes. D-20: auto-logout triggers sessionReset.hardReset with
  // reason:'sale-completed', mode:'welcome'. next-customer keeps the
  // Magicline session alive and rearms the 60s idle timer (D-06).
  notifyPostSaleNextCustomer: () => { ipcRenderer.send('post-sale:next-customer'); },
  notifyPostSaleAutoLogout:   () => { ipcRenderer.send('post-sale:auto-logout');   },
});
