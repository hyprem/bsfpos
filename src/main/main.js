// src/main/main.js
// Bee Strong POS Kiosk — main process entry.
// Phase 1 plan 02: creates the single kiosk BrowserWindow and wires the
// ipcMain 'cash-register-ready' splash stub. Keyboard lockdown, single-instance
// lock, and globalShortcut registrations are added by plan 03 (REPLACES the
// ORCHESTRATION block below — do NOT move createMainWindow).

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, safeStorage, shell } = require('electron');
const path = require('path');
const child_process = require('child_process');
const log = require('./logger');
const { attachLockdown } = require('./keyboardLockdown');
const Store = require('electron-store').default;
const { createMagiclineView, destroyMagiclineView, setAdminHotkeyHandler } = require('./magiclineView');
const authFlow = require('./authFlow');
const adminPin = require('./adminPin');
const adminPinLockout = require('./adminPinLockout');
const autoUpdater     = require('./autoUpdater');
const updateGate      = require('./updateGate');
const sessionResetMod = require('./sessionReset');

// WR-01: set when `request-reset-loop-recovery` surfaces the PIN modal and
// cleared only after a successful app.relaunch() — or on process exit. When
// set, the `verify-pin` invoke handler intercepts PIN entry and routes to
// adminPin.verifyPin + app.relaunch, bypassing the normal authFlow path
// (which would land the user in the credentials overlay and leave the
// reset-loop counter latched until the next Windows logout).
let resetLoopPending = false;

const isDev = process.env.NODE_ENV === 'development';

// --- Phase 5 constants ------------------------------------------------
// TODO(runbook): set GITHUB_OWNER via build-time env var or here before first prod build.
const GITHUB_OWNER = process.env.BSFPOS_GH_OWNER || 'TODO-set-owner';
const GITHUB_REPO  = process.env.BSFPOS_GH_REPO  || 'bsfpos';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // D-14: every 6 hours
const HEALTH_WATCHDOG_MS       = 2 * 60 * 1000;      // D-29: 2-minute post-update watchdog
const AUTH_POLL_MS             = 2000;               // poll authFlow.getState every 2s

// --- Phase 5 module-scope state ---------------------------------------
let adminMenuOpen       = false;
let healthWatchdogTimer = null;
let authPollTimer       = null;
let updateCheckInterval = null;

// --- createMainWindow -------------------------------------------------------
// Plan 03 imports/consumes this function unchanged. Keep it self-contained.

let mainWindow = null;

// --- Phase 5 helpers --------------------------------------------------

/**
 * Send the PIN modal show IPC with `context:'admin'` so host.js knows this
 * is an admin PIN attempt (NOT a reset-loop recovery).
 */
function openAdminPinModal() {
  if (!mainWindow) return;
  log.info('adminHotkey: Ctrl+Shift+F12 pressed — surfacing admin PIN modal');
  try {
    mainWindow.webContents.send('show-pin-modal', { context: 'admin' });
  } catch (e) {
    log.error('adminHotkey.send failed: ' + (e && e.message));
  }
}

/**
 * Tries to decrypt the stored GitHub PAT and initialise the auto-updater.
 * No-ops in dev (app.isPackaged=false), when PAT is absent (D-19), or when
 * autoUpdateDisabled has been latched by a bad-release health check (D-30).
 */
function tryInitAutoUpdater(store) {
  if (store.get('autoUpdateDisabled') === true) {
    log.audit('update.check', { result: 'disabled' });
    return false;
  }
  const cipherB64 = store.get('githubUpdatePat');
  if (!cipherB64) {
    log.info('autoUpdater: no PAT stored (D-19) — auto-update silently disabled');
    return false;
  }
  let pat = null;
  try {
    pat = safeStorage.decryptString(Buffer.from(cipherB64, 'base64'));
  } catch (e) {
    log.audit('update.failed', { reason: 'pat-decrypt-failed', phase: 'init' });
    return false;
  }
  return autoUpdater.initUpdater({
    owner: GITHUB_OWNER,
    repo: GITHUB_REPO,
    pat: pat,
    store: store,
    isPackaged: app.isPackaged,
    onUpdateDownloaded: (info) => armUpdateGate(store, info),
    onUpdateFailed: (err) => {
      try {
        if (mainWindow) mainWindow.webContents.send('show-magicline-error', { variant: 'update-failed' });
      } catch (e) {
        log.error('update-failed variant send failed: ' + (e && e.message));
      }
    },
  });
}

function armUpdateGate(store, info) {
  updateGate.onUpdateDownloaded({
    installFn: () => {
      log.audit('update.install', { phase: 'quitAndInstall', version: (info && info.version) || 'unknown' });
      try { if (mainWindow) mainWindow.webContents.send('show-updating-cover'); } catch (_) {}
      autoUpdater.installUpdate();
    },
    log: log,
    sessionResetModule: sessionResetMod,
  });
}

function startUpdateCheckInterval() {
  if (updateCheckInterval) clearInterval(updateCheckInterval);
  updateCheckInterval = setInterval(() => {
    autoUpdater.checkForUpdates();
  }, UPDATE_CHECK_INTERVAL_MS);
}

/**
 * D-29 post-update health watchdog. Called at the top of app.whenReady.
 * Reads `pendingUpdate` flag and arms a 2-minute timer; if authFlow reaches
 * CASH_REGISTER_READY first, the timer is cleared (healthy). Otherwise,
 * the timer expires → mark bad release + show bad-release variant.
 */
function startHealthWatchdog(store) {
  const pending = store.get('pendingUpdate');
  if (!pending || !pending.pendingVersion) return;
  log.audit('update.install', { phase: 'watchdog-started', version: pending.pendingVersion });
  healthWatchdogTimer = setTimeout(() => {
    healthWatchdogTimer = null;
    log.audit('update.failed', { reason: 'watchdog-expired', version: pending.pendingVersion });
    try { store.set('autoUpdateDisabled', true); } catch (_) {}
    try { store.delete('pendingUpdate'); } catch (_) {}
    try {
      if (mainWindow) mainWindow.webContents.send('show-magicline-error', { variant: 'bad-release' });
    } catch (_) {}
    if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
  }, HEALTH_WATCHDOG_MS);

  // Poll authFlow.getState every AUTH_POLL_MS; success clears the watchdog.
  authPollTimer = setInterval(() => {
    try {
      const af = require('./authFlow');
      const state = (typeof af.getState === 'function') ? af.getState() : null;
      if (state === 'CASH_REGISTER_READY') {
        log.audit('update.install', { phase: 'health-check-passed', version: pending.pendingVersion });
        clearHealthWatchdog(store);
      }
    } catch (e) {
      // authFlow may not be loaded yet — keep polling
    }
  }, AUTH_POLL_MS);
}

function clearHealthWatchdog(store) {
  if (healthWatchdogTimer) { clearTimeout(healthWatchdogTimer); healthWatchdogTimer = null; }
  if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
  try { store.delete('pendingUpdate'); } catch (_) {}
}

function buildAdminDiagnostics(store) {
  let authState = 'UNKNOWN';
  try {
    const af = require('./authFlow');
    authState = (typeof af.getState === 'function' && af.getState()) || 'UNKNOWN';
  } catch (_) {}
  let lastResetAt = null;
  try { lastResetAt = sessionResetMod.getLastResetAt ? sessionResetMod.getLastResetAt() : null; } catch (_) {}
  let updateStatus = 'nicht konfiguriert';
  if (store.get('autoUpdateDisabled') === true) updateStatus = 'deaktiviert';
  else if (autoUpdater.isEnabled()) updateStatus = 'aktiv';
  return {
    version: app.getVersion(),
    lastUpdateCheck: autoUpdater.getLastCheckAt(),
    authState: authState,
    lastResetAt: lastResetAt,
    updateStatus: updateStatus,
    patConfigured: !!store.get('githubUpdatePat'),
  };
}

function createMainWindow() {
  mainWindow = new BrowserWindow({
    show: false,                      // don't show until ready-to-show → prevents white flash
    kiosk: !isDev,                    // D-07 dev gating
    fullscreen: !isDev,
    frame: isDev,                     // D-07
    autoHideMenuBar: true,
    backgroundColor: '#1A1A1A',       // UI-SPEC dominant color — zero flash at Phase 2 handoff
    paintWhenInitiallyHidden: true,   // ensures ready-to-show fires reliably
    width: isDev ? 420 : undefined,   // D-07 dev dimensions (vertical tablet sim)
    height: isDev ? 800 : undefined,
    resizable: isDev,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,                // D-08: prod has no DevTools path
    },
  });

  // Belt + braces vs autoHideMenuBar
  Menu.setApplicationMenu(null);

  mainWindow.once('ready-to-show', () => {
    log.info('mainWindow ready-to-show — showing');
    mainWindow.show();
    if (isDev) {
      mainWindow.webContents.openDevTools({ mode: 'detach' });
    }
  });

  mainWindow.webContents.on('render-process-gone', (_e, details) => {
    log.error('render-process-gone', details);
  });

  mainWindow.loadFile(path.join(__dirname, '..', 'host', 'host.html'));

  return mainWindow;
}

module.exports = { createMainWindow, isDev };

// --- ORCHESTRATION (plan 03 REPLACES everything below this line) -----------
//
// Order matters (per RESEARCH.md §Initialization order in main.js):
//   1. requestSingleInstanceLock() — FIRST executable call after requires.
//      If false → app.quit() + process.exit(0), no second-instance handler.
//   2. app.whenReady():
//      a. Menu.setApplicationMenu(null) — already done inside createMainWindow.
//      b. setLoginItemSettings (D-04 layer 1) — prod only.
//      c. globalShortcut.register no-ops (D-11) — prod only, catches OS chords
//         during startup race before mainWindow has focus.
//      d. createMainWindow() — builds the BrowserWindow + ipcMain stub.
//      e. attachLockdown(mainWindow.webContents) — D-09/D-10.
//   3. will-quit → globalShortcut.unregisterAll().
//   4. window-all-closed → app.quit() (kiosk: no macOS dock pattern).

// D-05: Single-instance lock. MUST be the first executable call after requires.
// No second-instance handler — kiosk mode guarantees the first window is topmost.
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  log.warn('second instance detected — exiting silently (D-05)');
  app.quit();
  process.exit(0);
}

app.whenReady().then(() => {
  log.info('app ready (isDev=' + isDev + ')');
  // Phase 5 D-28 / Plan 06: canonical startup audit event.
  try { log.audit('startup', { version: app.getVersion(), isDev: isDev }); } catch (_) {}

  // D-04 layer 1: runtime self-heal auto-start.
  // Writes HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Bee Strong POS
  // pointing at the current exe. Gated behind !isDev per PITFALLS.md pitfall 2
  // (avoid registering node.exe/electron.exe from node_modules in dev).
  if (!isDev) {
    try {
      app.setLoginItemSettings({
        openAtLogin: true,
        openAsHidden: false,
        name: 'Bee Strong POS',
        path: process.execPath,
        args: [],
      });
      log.info('setLoginItemSettings: HKCU Run entry asserted for ' + process.execPath);
    } catch (err) {
      log.error('setLoginItemSettings failed', err);
    }
  }

  // D-11: Defense-in-depth globalShortcut no-ops. Catches OS chords during
  // the ~50-500ms startup race before before-input-event is wired.
  if (!isDev) {
    const chords = ['Alt+F4', 'F11', 'Escape'];
    for (const chord of chords) {
      const ok = globalShortcut.register(chord, () => {
        // no-op — we only want to prevent the default OS handler
      });
      if (!ok) {
        log.warn('globalShortcut.register(' + chord + ') returned false (already taken?)');
      } else {
        log.info('globalShortcut registered: ' + chord);
      }
    }
  }

  // Phase 5 D-08: register admin hotkey via globalShortcut (defense-in-depth)
  if (!isDev) {
    const adminOk = globalShortcut.register('Ctrl+Shift+F12', openAdminPinModal);
    if (!adminOk) {
      log.warn('globalShortcut.register(Ctrl+Shift+F12) returned false — will still work via before-input-event');
    } else {
      log.info('globalShortcut registered: Ctrl+Shift+F12 (admin hotkey)');
    }
  }

  // Build the window.
  createMainWindow();

  // D-09/D-10: attach keyboard lockdown to the host webContents.
  // Phase 2 will additionally attach to the Magicline BrowserView webContents
  // via the same attachLockdown export — see Pitfall 1 in RESEARCH.md.
  if (mainWindow) {
    attachLockdown(mainWindow.webContents);
    // Phase 4 (D-01, D-02, research Pattern 1): two-attach pattern — badge
    // input arbiter must see keystrokes on BOTH the host wc and the Magicline
    // child wc. Lockdown first, badgeInput second (D-02).
    const { attachBadgeInput } = require('./badgeInput');
    attachBadgeInput(mainWindow.webContents);

    // Phase 5 D-08: before-input-event fallback on host webContents
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const { canonical: canon } = require('./keyboardLockdown');
      if (canon(input) === 'Ctrl+Shift+F12') {
        openAdminPinModal();
      }
    });

    // Phase 5 D-28 / Plan 06: mark the startup sequence as complete once the
    // host wc has lockdown + badge input + admin-hotkey wiring attached.
    try { log.audit('startup.complete', {}); } catch (_) {}
  }

  // Phase 5 Plan 06 D-27: sale-completion audit hook.
  // inject.js emits the sentinel `BSK_AUDIT_SALE_COMPLETED` on console in the
  // Magicline main world at the 'Jetzt verkaufen' click; magiclineView.js
  // relays it via this IPC channel for the canonical `sale.completed` event.
  try {
    ipcMain.removeAllListeners('audit-sale-completed');
  } catch (_) {}
  ipcMain.on('audit-sale-completed', () => {
    try { log.audit('sale.completed', {}); } catch (_) {}
  });

  // --- Phase 2: Magicline child view + injection pipeline ---------------
  // createMagiclineView attaches a WebContentsView child to mainWindow, loads
  // the Magicline cash-register URL under the persist:magicline partition,
  // wires insertCSS/executeJavaScript injection on every nav, and drives the
  // splash:hide / show-magicline-error IPC channels via a 250ms main-world
  // drain poll. See src/main/magiclineView.js for the full lifecycle.
  if (mainWindow) {
    try {
      const store = new Store({ name: 'config' });
      // Phase 4 (D-14): sessionReset must be initialised BEFORE any code path
      // that could call hardReset() — idle expiry, render-process-gone crash
      // handler in magiclineView, or admin menu recovery in Phase 5. init is
      // idempotent but calling hardReset without init throws.
      require('./sessionReset').init({ mainWindow: mainWindow, store: store });
      // Phase 4 (D-07): idleTimer needs the host wc so it can send
      // 'show-idle-overlay' / 'hide-idle-overlay' IPCs to host.html.
      require('./idleTimer').init(mainWindow);

      // Phase 5 D-29: post-update health watchdog (runs before authFlow.start so
      // the auth-state poller picks up CASH_REGISTER_READY when it arrives).
      startHealthWatchdog(store);

      // WR-01: register the admin hotkey callback BEFORE createMagiclineView
      // so the initial view instance picks it up. magiclineView re-applies the
      // listener on every recreation (post-hardReset), so this single call is
      // sufficient for the entire app lifetime — without this, the hotkey
      // silently stops working on the Magicline child view after any
      // sessionReset.hardReset.
      setAdminHotkeyHandler(openAdminPinModal);

      const magiclineView = createMagiclineView(mainWindow, store);
      log.info('phase2.magicline-view.created');

      // --- Phase 3 auth-flow wiring ------------------------------------
      // Per research Pitfall #2: safeStorage.isEncryptionAvailable() must
      // be called AFTER at least one BrowserWindow exists. createMainWindow
      // ran before this point, so this is satisfied.
      //
      // Timing: start() emits show-credentials-overlay IPC synchronously on
      // first run. The host renderer's ipcRenderer.on subscribers are only
      // attached once host.js has loaded, which happens at/after 'did-finish-load'.
      // Firing start() before the renderer is ready drops the IPC silently.
      // Defer start() until the host webContents has finished loading.
      const startAuthFlow = () => {
        try {
          authFlow.start({
            mainWindow: mainWindow,
            webContents: magiclineView.webContents,
            store: store,
            safeStorage: safeStorage,
            log: log,
          });
          log.info('phase3.authFlow.started');

          // Phase 5 D-14, D-18, D-19: attempt to initialise auto-updater
          try {
            const ok = tryInitAutoUpdater(store);
            if (ok) {
              // Initial check, then every 6 hours
              autoUpdater.checkForUpdates();
              startUpdateCheckInterval();
            }
          } catch (err) {
            log.error('phase5.autoUpdater.init failed: ' + (err && err.message));
          }
        } catch (err) {
          log.error('phase3.authFlow.start failed: ' + (err && err.message));
        }
      };
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', startAuthFlow);
      } else {
        startAuthFlow();
      }

      // --- Phase 3 IPC handlers ----------------------------------------
      ipcMain.handle('submit-credentials', async (_e, payload) => {
        try {
          return authFlow.handleCredentialsSubmit(payload);
        } catch (err) {
          log.error('ipc.submit-credentials failed: ' + (err && err.message));
          return { ok: false, error: String(err && err.message) };
        }
      });

      ipcMain.handle('verify-pin', async (_e, payload) => {
        try {
          const pin = (payload && typeof payload.pin === 'string') ? payload.pin : '';
          // CR-02: legacy verify-pin (reset-loop recovery AND authFlow
          // pin-recovery) MUST route through adminPinLockout so a bad actor
          // cannot brute-force via this channel. Both branches share the same
          // PIN material as verify-admin-pin, so they must share the same
          // rolling 5-in-60s / 5-minute lockout counter.
          const result = adminPinLockout.verifyPinWithLockout(store, pin);
          if (result.locked) {
            log.audit('pin.lockout', {
              lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null,
              via: 'verify-pin',
            });
            try {
              mainWindow.webContents.send('show-pin-lockout', {
                lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null,
              });
            } catch (_) {}
            return { ok: false, locked: true };
          }
          if (!result.ok) {
            if (resetLoopPending) {
              log.warn('sessionReset.admin-recovery: bad PIN');
              return { ok: false };
            }
            authFlow.notify({ type: 'pin-bad' });
            return { ok: false };
          }
          // PIN verified. Two success branches: reset-loop relaunch OR the
          // authFlow pin-recovery path (which transitions via pin-ok notify).
          if (resetLoopPending) {
            log.info('sessionReset.admin-recovery: PIN ok — app.relaunch + app.quit');
            resetLoopPending = false;
            app.relaunch();
            app.quit();
            return { ok: true };
          }
          authFlow.notify({ type: 'pin-ok' });
          return { ok: true };
        } catch (err) {
          log.error('ipc.verify-pin failed: ' + (err && err.message));
          return { ok: false };
        }
      });

      ipcMain.handle('request-pin-recovery', async () => {
        try {
          authFlow.handlePinRecoveryRequested();
          return { ok: true };
        } catch (err) {
          log.error('ipc.request-pin-recovery failed: ' + (err && err.message));
          return { ok: false };
        }
      });

      // --- Phase 3 launch-touch-keyboard (TabTip manual fallback) ------
      // Research §Windows TabTip Verdict: TabTip auto-invoke is unreliable
      // under Assigned Access. The credentials overlay has explicit
      // "Tastatur" buttons next to each text field that invoke this handler
      // as a manual fallback. On the real kiosk, the path is
      // "C:\Program Files\Common Files\microsoft shared\ink\TabTip.exe"
      // — see Wave 0 verification file for the verdict.
      // Phase 4 D-12: idle overlay round-trip (renderer → main).
      // idleTimer.dismiss/expired are idempotent (Plan 04-01 contract).
      ipcMain.on('idle-dismissed', () => {
        try {
          require('./idleTimer').dismiss();
        } catch (err) {
          log.error('ipc.idle-dismissed failed: ' + (err && err.message));
        }
      });
      ipcMain.on('idle-expired', () => {
        try {
          require('./idleTimer').expired();
        } catch (err) {
          log.error('ipc.idle-expired failed: ' + (err && err.message));
        }
      });
      // Phase 4 D-19: reset-loop admin recovery — surfaces the PIN modal so
      // the admin can authorise an app.relaunch(). Admin PIN remains the gate
      // (T-04-16). The actual relaunch fires only after pin-ok with
      // context:'reset-loop' is received.
      ipcMain.on('request-reset-loop-recovery', () => {
        log.warn('sessionReset.admin-recovery.requested: surfacing PIN modal');
        // WR-01: latch the reset-loop pending flag BEFORE sending show-pin-modal
        // so the next verify-pin invoke is intercepted and routed to
        // app.relaunch instead of authFlow.
        resetLoopPending = true;
        try {
          mainWindow.webContents.send('show-pin-modal', { context: 'reset-loop' });
        } catch (err) {
          log.error('ipc.request-reset-loop-recovery send failed: ' + (err && err.message));
        }
      });

      ipcMain.handle('launch-touch-keyboard', async () => {
        if (process.platform !== 'win32') {
          log.info('ipc.launch-touch-keyboard: no-op on non-win32');
          return { ok: false, error: 'not-windows' };
        }
        return await new Promise((resolve) => {
          const cmd = '"C:\\\\Program Files\\\\Common Files\\\\microsoft shared\\\\ink\\\\TabTip.exe"';
          child_process.exec(cmd, (err) => {
            if (err) {
              log.warn('ipc.launch-touch-keyboard exec failed: ' + (err && err.message));
              resolve({ ok: false, error: String(err && err.message) });
            } else {
              log.info('ipc.launch-touch-keyboard: tabtip launched');
              resolve({ ok: true });
            }
          });
        });
      });

      // === Phase 5 IPC handlers ================================================

      // --- verify-admin-pin: admin hotkey → PIN modal → admin menu
      ipcMain.handle('verify-admin-pin', async (_e, payload) => {
        try {
          const pin = (payload && typeof payload.pin === 'string') ? payload.pin : '';
          const result = adminPinLockout.verifyPinWithLockout(store, pin);
          if (result.ok) {
            adminMenuOpen = true;
            log.audit('admin.open', {});
            try {
              mainWindow.webContents.send('hide-pin-modal');
              const diagnostics = buildAdminDiagnostics(store);
              mainWindow.webContents.send('show-admin-menu', diagnostics);
            } catch (_) {}
            return { ok: true, locked: false, lockedUntil: null };
          }
          if (result.locked) {
            log.audit('pin.lockout', { lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null });
            try {
              mainWindow.webContents.send('show-pin-lockout', {
                lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null,
              });
            } catch (_) {}
          } else {
            log.audit('pin.verify', { result: 'fail' });
          }
          return {
            ok: false,
            locked: !!result.locked,
            lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null,
          };
        } catch (err) {
          log.error('ipc.verify-admin-pin failed: ' + (err && err.message));
          return { ok: false, locked: false, lockedUntil: null };
        }
      });

      // --- get-admin-diagnostics: refresh diagnostic header on demand
      ipcMain.handle('get-admin-diagnostics', async () => {
        try {
          return buildAdminDiagnostics(store);
        } catch (err) {
          log.error('ipc.get-admin-diagnostics failed: ' + (err && err.message));
          return null;
        }
      });

      // --- admin-menu-action: dispatch admin menu button taps
      ipcMain.handle('admin-menu-action', async (_e, payload) => {
        const action = payload && payload.action;
        if (!adminMenuOpen) {
          log.warn('admin-menu-action: refused — adminMenuOpen=false (action=' + action + ')');
          return { ok: false, error: 'not-authorised' };
        }
        log.audit('admin.exit', { action: String(action) });
        try {
          switch (action) {
            case 'check-updates': {
              const r = await autoUpdater.checkForUpdates();
              try {
                mainWindow.webContents.send('show-admin-update-result', {
                  status: r.result,
                  message: r.error || null,
                });
              } catch (_) {}
              return { ok: true, result: r };
            }
            case 'view-logs': {
              try { app.setKiosk(false); } catch (_) {}
              try { await shell.openPath(app.getPath('logs')); } catch (e) {
                log.error('shell.openPath failed: ' + (e && e.message));
                return { ok: false, error: String(e && e.message) };
              }
              return { ok: true };
            }
            case 'reload': {
              adminMenuOpen = false;
              try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
              try { mainWindow.webContents.reload(); } catch (_) {}
              return { ok: true };
            }
            case 're-enter-credentials': {
              try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
              try { mainWindow.webContents.send('show-credentials-overlay', { firstRun: false }); } catch (_) {}
              adminMenuOpen = false;
              return { ok: true };
            }
            case 'configure-auto-update': {
              try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
              try {
                mainWindow.webContents.send('show-update-config', {
                  hasExistingPat: !!store.get('githubUpdatePat'),
                });
              } catch (_) {}
              return { ok: true };
            }
            case 'exit-to-windows': {
              try { globalShortcut.unregisterAll(); } catch (_) {}
              try { app.setKiosk(false); } catch (_) {}
              adminMenuOpen = false;
              app.quit();
              return { ok: true };
            }
            default:
              return { ok: false, error: 'unknown-action' };
          }
        } catch (err) {
          log.error('ipc.admin-menu-action failed: ' + (err && err.message));
          return { ok: false, error: String(err && err.message) };
        }
      });

      // --- close-admin-menu: PAT config cancel / explicit close
      ipcMain.handle('close-admin-menu', async () => {
        adminMenuOpen = false;
        try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
        return { ok: true };
      });

      // --- submit-update-pat: save PAT, re-initialise updater
      ipcMain.handle('submit-update-pat', async (_e, payload) => {
        try {
          const pat = (payload && typeof payload.pat === 'string') ? payload.pat.trim() : '';
          if (!pat || /\s/.test(pat)) {
            return { ok: false, error: 'empty-or-whitespace' };
          }
          if (!safeStorage.isEncryptionAvailable()) {
            log.audit('update.failed', { reason: 'safestorage-unavailable', phase: 'pat-save' });
            return { ok: false, error: 'safestorage-unavailable' };
          }
          const cipher = safeStorage.encryptString(pat);
          store.set('githubUpdatePat', cipher.toString('base64'));
          // Clearing the disabled flag: admin entering a PAT means "try again"
          try { store.delete('autoUpdateDisabled'); } catch (_) {}
          // CR-01: never pass the raw PAT (even field-named 'pat' that the
          // logger redactor allowlist would catch) into the audit log. Length
          // alone is sufficient for operational telemetry.
          log.audit('update.pat.configured', { length: pat.length });
          const initOk = tryInitAutoUpdater(store);
          if (initOk) {
            autoUpdater.checkForUpdates();
            startUpdateCheckInterval();
          }
          // Return to admin menu with refreshed diagnostics
          adminMenuOpen = true;
          try { mainWindow.webContents.send('hide-update-config'); } catch (_) {}
          try { mainWindow.webContents.send('show-admin-menu', buildAdminDiagnostics(store)); } catch (_) {}
          return { ok: true };
        } catch (err) {
          log.error('ipc.submit-update-pat failed: ' + (err && err.message));
          return { ok: false, error: String(err && err.message) };
        }
      });

      // WR-03: tear down module-scoped magiclineView state on window close so
      // Phase 4 auto-recovery (window recreation on crash/hang) starts from a
      // clean slate. Without this, drainTimer keeps firing against a destroyed
      // webContents, resizeHandler leaks closures against the dead window, and
      // readyFired/driftActive persist — preventing the recovered kiosk from
      // ever lifting its splash again.
      mainWindow.once('closed', () => {
        try {
          destroyMagiclineView(mainWindow);
        } catch (e) {
          log.warn('phase2.magicline-view.destroy failed: ' + (e && e.message));
        }
      });
    } catch (err) {
      log.error('phase2.magicline-view.create failed: ' + (err && err.message));
    }
  }
});

app.on('will-quit', () => {
  log.info('will-quit — unregistering global shortcuts');
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  log.info('window-all-closed — quitting');
  app.quit();
});
