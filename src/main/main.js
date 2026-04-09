// src/main/main.js
// Bee Strong POS Kiosk — main process entry.
// Phase 1 plan 02: creates the single kiosk BrowserWindow and wires the
// ipcMain 'cash-register-ready' splash stub. Keyboard lockdown, single-instance
// lock, and globalShortcut registrations are added by plan 03 (REPLACES the
// ORCHESTRATION block below — do NOT move createMainWindow).

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, safeStorage } = require('electron');
const path = require('path');
const child_process = require('child_process');
const log = require('./logger');
const { attachLockdown } = require('./keyboardLockdown');
const Store = require('electron-store').default;
const { createMagiclineView, destroyMagiclineView } = require('./magiclineView');
const authFlow = require('./authFlow');

const isDev = process.env.NODE_ENV === 'development';

// --- createMainWindow -------------------------------------------------------
// Plan 03 imports/consumes this function unchanged. Keep it self-contained.

let mainWindow = null;

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

  // Build the window.
  createMainWindow();

  // D-09/D-10: attach keyboard lockdown to the host webContents.
  // Phase 2 will additionally attach to the Magicline BrowserView webContents
  // via the same attachLockdown export — see Pitfall 1 in RESEARCH.md.
  if (mainWindow) {
    attachLockdown(mainWindow.webContents);
  }

  // --- Phase 2: Magicline child view + injection pipeline ---------------
  // createMagiclineView attaches a WebContentsView child to mainWindow, loads
  // the Magicline cash-register URL under the persist:magicline partition,
  // wires insertCSS/executeJavaScript injection on every nav, and drives the
  // splash:hide / show-magicline-error IPC channels via a 250ms main-world
  // drain poll. See src/main/magiclineView.js for the full lifecycle.
  if (mainWindow) {
    try {
      const store = new Store({ name: 'config' });
      const magiclineView = createMagiclineView(mainWindow, store);
      log.info('phase2.magicline-view.created');

      // --- Phase 3 auth-flow wiring ------------------------------------
      // Per research Pitfall #2: safeStorage.isEncryptionAvailable() must
      // be called AFTER at least one BrowserWindow exists. createMainWindow
      // ran before this point, so this is satisfied.
      try {
        authFlow.start({
          mainWindow: mainWindow,
          magiclineWebContents: magiclineView.webContents,
          store: store,
          safeStorage: safeStorage,
        });
        log.info('phase3.authFlow.started');
      } catch (err) {
        log.error('phase3.authFlow.start failed: ' + (err && err.message));
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
          return authFlow.handlePinAttempt(pin);
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
