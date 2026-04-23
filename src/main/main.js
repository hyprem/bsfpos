// src/main/main.js
// Bee Strong POS Kiosk — main process entry.
// Phase 1 plan 02: creates the single kiosk BrowserWindow and wires the
// ipcMain 'cash-register-ready' splash stub. Keyboard lockdown, single-instance
// lock, and globalShortcut registrations are added by plan 03 (REPLACES the
// ORCHESTRATION block below — do NOT move createMainWindow).

const { app, BrowserWindow, Menu, globalShortcut, ipcMain, safeStorage, shell, session } = require('electron');

// Phase 07 LOCALE-01 (belt-and-suspenders layer 1 of 2):
// Force Chromium to de-DE BEFORE app.whenReady(). Electron historical issues
// #17995 / #26185 show that appendSwitch('lang', ...) MUST run at top-of-file,
// not inside the whenReady handler, or it silently no-ops. This affects
// navigator.language, app.getLocale(), and default Accept-Language on document
// loads. Layer 2 is the webRequest header override below, which catches the
// cases where the --lang switch has historically been flaky for HTTP headers.
app.commandLine.appendSwitch('lang', 'de-DE');
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

// Phase 07 SPLASH-01: true between welcome:tap and splash:hide-final (or 5.5s timeout,
// owned by Plan 05 host-side). Gates forwarding of register-selected so that
// cold-boot / idle-recovery paths are not affected by the new sentinel.
let welcomeTapPending = false;

// Phase 10 D-12: dedupe flag that gates both post-sale triggers (print-intercept
// primary + cart-empty-fallback). Set true when startPostSaleFlow runs; cleared
// on post-sale:next-customer and on every hard reset (onPreReset callback).
// Prevents double-show when both triggers fire within the same sale cycle.
let postSaleShown = false;

const isDev = process.env.NODE_ENV === 'development';

// --- Phase 5 constants ------------------------------------------------
const GITHUB_OWNER = process.env.BSFPOS_GH_OWNER || 'hyprem';
const GITHUB_REPO  = process.env.BSFPOS_GH_REPO  || 'bsfpos';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // D-14: every 6 hours
const HEALTH_WATCHDOG_MS       = 2 * 60 * 1000;      // D-29: 2-minute post-update watchdog
const AUTH_POLL_MS             = 2000;               // poll authFlow.getState every 2s

// --- Phase 5 module-scope state ---------------------------------------
let adminMenuOpen       = false;
let devModeActive       = false;
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
  if (adminMenuOpen) {
    // D-03: second press closes the admin menu
    closeAdminMenu();
    return;
  }
  if (!mainWindow) return;
  log.info('adminHotkey: Ctrl+Shift+F12 pressed — surfacing admin PIN modal');
  try {
    const { setMagiclineViewVisible } = require('./magiclineView');
    setMagiclineViewVisible(false);
  } catch (_) {}
  try {
    mainWindow.webContents.send('show-pin-modal', { context: 'admin' });
  } catch (e) {
    log.error('adminHotkey.send failed: ' + (e && e.message));
  }
}

function closeAdminMenu() {
  adminMenuOpen = false;
  log.audit('admin.action', { action: 'close-menu' });
  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
  const { exists: mvExists, setMagiclineViewVisible } = require('./magiclineView');
  if (mvExists()) {
    try { setMagiclineViewVisible(true); } catch (_) {}
  } else {
    try { mainWindow.webContents.send('welcome:show'); } catch (_) {}
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
      // WR-02: guard against updater firing after shutdown / window close so
      // the try/catch does not swallow real programming errors.
      if (!mainWindow || mainWindow.isDestroyed()) return;
      try {
        mainWindow.webContents.send('show-magicline-error', { variant: 'update-failed' });
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
    getPosOpen: function() { return store.get('posOpen', true); },
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
    posOpen: store.get('posOpen', true),
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
    // NFC descope (2026-04-14, quick 260414-eu9): badgeInput wiring removed.
    // The HID reader now sends keystrokes directly into the Magicline
    // product-search input (focused on cash-register-ready in magiclineView.js);
    // no main-process buffering / arbiter is needed.

    // Phase 5 D-08: before-input-event fallback on host webContents
    // (admin hotkey only — idle activity tracking lives in inject.js `activity`
    // emitter, unrelated to this listener).
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const { canonical: canon } = require('./keyboardLockdown');
      if (canon(input) === 'Ctrl+Shift+F12') {
        openAdminPinModal();
      }
    });

    // Phase 5 D-28 / Plan 06: mark the startup sequence as complete once the
    // host wc has lockdown + admin-hotkey wiring attached.
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

  // Phase 07 SPLASH-01: register-selected sentinel relay.
  // Forwarded by magiclineView.js console-message listener when inject.js emits
  // BSK_REGISTER_SELECTED or BSK_REGISTER_SELECTED_DEGRADED. Only forwarded to
  // the host as splash:hide-final when welcomeTapPending is true (T-07-06
  // spoofing mitigation — cold-boot / idle-recovery paths leave the flag false).
  try { ipcMain.removeAllListeners('register-selected'); } catch (_) {}
  ipcMain.on('register-selected', (_ev, payload) => {
    try {
      // Only forward to host on the welcome path. Cold-boot / idle-recovery
      // paths still use cash-register-ready → splash:hide unchanged.
      if (!welcomeTapPending) {
        log.info('phase07.register-selected.ignored reason=no-welcome-pending');
        return;
      }
      welcomeTapPending = false;
      const degraded = !!(payload && payload.degraded);
      log.info('phase07.register-selected forwarded degraded=' + degraded);
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('splash:hide-final', { degraded: degraded });
      }
    } catch (err) {
      try { log.error('phase07.register-selected failed: ' + (err && err.message)); } catch (_) {}
    }
  });

  // --- Phase 10 SALE-01: post-sale flow orchestration ----------------------
  // The complete post-sale flow:
  //   1. Magicline calls window.print (or cart-empties after payment)
  //   2. inject.js emits BSK_PRINT_INTERCEPTED (or BSK_POST_SALE_FALLBACK)
  //   3. magiclineView.js console-message listener relays via
  //      ipcMain.emit('post-sale:trigger', null, {trigger})
  //   4. THIS handler gates via postSaleShown dedupe, calls startPostSaleFlow
  //   5. startPostSaleFlow stops idle timer, sends post-sale:show to host,
  //      emits post-sale.shown audit
  //   6. Host shows overlay with 10s countdown (host.js Plan 07)
  //   7. On button tap (next-customer): clears flag, restarts idle timer
  //   8. On auto-expiry (auto-logout): hardReset({reason:'sale-completed',
  //      mode:'welcome'}) which internally triggers onPostReset for updateGate
  //
  // post-sale:hide IPC (D-19): sent ONLY from onPreReset above when a reset
  // fires while postSaleShown is still true. Host-initiated dismiss paths do
  // NOT send it — they hide locally. See <design_notes> in this plan.
  //
  // The helper encapsulates steps 4-5 to keep the trigger handler trivial
  // and to ensure BOTH primary and fallback trigger paths share the exact
  // same idle-timer stop + audit + IPC-send sequence.

  // Phase 10 D-05/D-12: helper encapsulates idle-timer stop + IPC send +
  // flag set + audit. Called from the post-sale:trigger handler after the
  // dedupe gate passes.
  function startPostSaleFlow(opts) {
    var trigger = (opts && opts.trigger) || 'unknown';
    postSaleShown = true;
    try { require('./idleTimer').stop(); } catch (_) { /* idleTimer lazy-required — safe to swallow */ }
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('post-sale:show');
      }
    } catch (e) {
      log.error('phase10.startPostSaleFlow.send failed: ' + (e && e.message));
    }
    try { log.audit('post-sale.shown', { trigger: trigger }); } catch (_) { /* swallow */ }
  }

  // Phase 10 D-12: post-sale:trigger relay from magiclineView.js console-message.
  // Payload: { trigger: 'print-intercept' | 'cart-empty-fallback' }.
  // Dedupe: if postSaleShown is already true (another trigger already fired),
  // silently no-op and log at info level (not warn — dual-fire is expected
  // when both print and cart-empty happen in the same sale).
  try { ipcMain.removeAllListeners('post-sale:trigger'); } catch (_) {}
  ipcMain.on('post-sale:trigger', function (_ev, payload) {
    try {
      if (postSaleShown) {
        log.info('phase10.post-sale:trigger.ignored reason=already-shown');
        return;
      }
      var trigger = (payload && payload.trigger) || 'unknown';
      startPostSaleFlow({ trigger: trigger });
    } catch (err) {
      log.error('phase10.post-sale:trigger failed: ' + (err && err.message));
    }
  });

  // Phase 10 D-06: next-customer button — keep Magicline session alive, rearm
  // the 60s idle timer. The Magicline view stays visible; the cart stays as-is
  // (member may want to buy a second item). No sessionReset here — that is
  // the auto-logout path only. host.js hides the overlay locally on button
  // tap (Plan 07) — no post-sale:hide needed on this path.
  try { ipcMain.removeAllListeners('post-sale:next-customer'); } catch (_) {}
  ipcMain.on('post-sale:next-customer', function () {
    try {
      postSaleShown = false;
      try { require('./idleTimer').start(); } catch (_) {}
      try { log.audit('post-sale.dismissed', { via: 'next-customer' }); } catch (_) {}
    } catch (err) {
      log.error('phase10.post-sale:next-customer failed: ' + (err && err.message));
    }
  });

  // Phase 10 D-20: countdown auto-expiry — hard reset to welcome. The reason
  // 'sale-completed' is excluded from the 3-in-60s loop counter (Plan 01)
  // and still fires onPostReset for updateGate install composition (D-18).
  // postSaleShown is implicitly cleared by onPreReset in the hardReset path,
  // which ALSO sends post-sale:hide to the host (D-19) so the overlay is
  // hidden before the welcome layer shows.
  try { ipcMain.removeAllListeners('post-sale:auto-logout'); } catch (_) {}
  ipcMain.on('post-sale:auto-logout', function () {
    try {
      try { log.audit('post-sale.dismissed', { via: 'auto-logout' }); } catch (_) {}
      require('./sessionReset').hardReset({ reason: 'sale-completed', mode: 'welcome' });
    } catch (err) {
      log.error('phase10.post-sale:auto-logout failed: ' + (err && err.message));
    }
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

      // Phase 07 LOCALE-01 (belt-and-suspenders layer 2 of 2):
      // Force Accept-Language on every request issued by the Magicline
      // partition. Registered HERE (inside whenReady, before welcome:tap is
      // ever dispatched) so the FIRST document request from createMagiclineView
      // already carries the German header — otherwise the Magicline SPA may
      // cache an English locale decision in localStorage for persist:magicline.
      // See 07-RESEARCH.md §2 and §9 item 1.
      try {
        const magicSession = session.fromPartition('persist:magicline');
        magicSession.webRequest.onBeforeSendHeaders((details, callback) => {
          try {
            details.requestHeaders['Accept-Language'] = 'de-DE,de;q=0.9';
          } catch (_) { /* swallow — never drop the request */ }
          callback({ requestHeaders: details.requestHeaders });
        });
        log.info('phase07.locale.accept-language-override-installed partition=persist:magicline');
      } catch (err) {
        log.error('phase07.locale.accept-language-override-failed: ' + (err && err.message));
      }

      // Phase 07 LOCALE-01: record effective locale for kiosk-visit greps.
      try {
        log.audit('startup.locale', { lang: app.getLocale() });
      } catch (_) {}

      // Phase 5 D-29: post-update health watchdog (runs before authFlow.start so
      // the auth-state poller picks up CASH_REGISTER_READY when it arrives).
      startHealthWatchdog(store);

      // WR-08: when a hard reset lands during the post-update health window,
      // the watchdog's auth-poller would otherwise keep polling against a
      // detached state OR the watchdog could expire and incorrectly latch
      // autoUpdateDisabled. Clear both timers on every hard reset; if the
      // pendingUpdate flag is still present afterwards (i.e. the reset was
      // unrelated to the update), re-arm from scratch so the next
      // CASH_REGISTER_READY still counts as a healthy post-update boot.
      sessionResetMod.onPreReset(() => {
        // Phase 07 SPLASH-01: clear welcomeTapPending on any hard reset so a
        // stale flag from a mid-flow reset does not gate the next welcome path.
        welcomeTapPending = false;
        // Phase 10 D-12 + D-19: if the post-sale overlay is currently showing and
        // a hard reset is about to execute (admin-initiated or idle-triggered),
        // force-hide it first so the user sees a clean welcome transition rather
        // than a flash of stale post-sale UI. This is the ONE AND ONLY sender of
        // the post-sale:hide IPC channel (D-19) — see <design_notes> in this plan.
        // Host-initiated dismiss paths (button tap, countdown expiry) hide locally
        // and do NOT trigger this send.
        if (postSaleShown) {
          try {
            if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
              mainWindow.webContents.send('post-sale:hide');
            }
          } catch (e) {
            log.error('phase10.onPreReset.post-sale:hide send failed: ' + (e && e.message));
          }
        }
        // Phase 10 D-12: same rationale as welcomeTapPending — clear stale dedupe
        // flag on any hard reset so the next sale cycle can re-trigger the overlay.
        postSaleShown = false;
        if (healthWatchdogTimer || authPollTimer) {
          log.info('phase5.healthWatchdog.cleared-before-reset');
          if (healthWatchdogTimer) { clearTimeout(healthWatchdogTimer); healthWatchdogTimer = null; }
          if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
        }
      });
      // Post-reset re-arm: sessionReset.onPostReset is owned by updateGate
      // (single-slot), so we cannot chain there. Use a short timer after the
      // pre-reset hook fires; by then the new view has been rebuilt and
      // authFlow is poised to transition through CASH_REGISTER_READY. If
      // pendingUpdate is already gone (update succeeded), this is a no-op.
      sessionResetMod.onPreReset(() => {
        setTimeout(() => {
          if (store.get('pendingUpdate')) {
            log.info('phase5.healthWatchdog.re-armed-after-reset');
            startHealthWatchdog(store);
          }
        }, 500);
      });

      // WR-01: register the admin hotkey callback BEFORE createMagiclineView
      // so the initial view instance picks it up. magiclineView re-applies the
      // listener on every recreation (post-hardReset), so this single call is
      // sufficient for the entire app lifetime — without this, the hotkey
      // silently stops working on the Magicline child view after any
      // sessionReset.hardReset.
      setAdminHotkeyHandler(openAdminPinModal);

      // Phase 6 D-03: cold boot does NOT create the Magicline view. Instead, main
      // commands the host to show the welcome layer. The Magicline view is created
      // lazily on the first welcome:tap (see ipcMain.on('welcome:tap') below), and
      // recreated automatically after any non-welcome hardReset (sessionReset.js
      // mode:'reset' branch still calls createMagiclineView). Welcome-mode hardReset
      // (Plan 06-02) keeps the view destroyed and re-shows welcome itself.

      // Helper: starts (or restarts) the login flow. Ensures a Magicline view exists,
      // then kicks authFlow. Safe to call multiple times — createMagiclineView is
      // idempotent (returns the existing instance if one is already attached), and
      // authFlow.start re-seeds currentState to BOOTING and reloads credentials.
      const startLoginFlow = () => {
        try {
          const view = createMagiclineView(mainWindow, store);
          log.info('phase6.login-flow.view-ready');
          authFlow.start({
            mainWindow: mainWindow,
            webContents: view.webContents,
            store: store,
            safeStorage: safeStorage,
            log: log,
          });
          log.info('phase3.authFlow.started');
        } catch (err) {
          log.error('phase6.startLoginFlow failed: ' + (err && err.message));
        }
      };

      // Cold-boot auto-updater init is INDEPENDENT of the Magicline view and still
      // runs at app.whenReady time (not per welcome:tap). Preserve Phase 5 wiring.
      const runAutoUpdaterInit = () => {
        try {
          const ok = tryInitAutoUpdater(store);
          if (ok) {
            autoUpdater.checkForUpdates();
            startUpdateCheckInterval();
          }
        } catch (err) {
          log.error('phase5.autoUpdater.init failed: ' + (err && err.message));
        }
      };

      // Cold-boot welcome command — deferred until the host renderer is ready so
      // the IPC is not dropped. Same did-finish-load pattern as the old Phase 3
      // startAuthFlow timing guard. MUST send splash:hide before welcome:show
      // because the Phase 1 splash layer currently hides only on Magicline
      // did-finish-load, and no Magicline view exists at cold boot.
      const showWelcomeOnColdBoot = () => {
        try {
          mainWindow.webContents.send('splash:hide');
          mainWindow.webContents.send('welcome:show');
          var posOpen = store.get('posOpen', true);
          mainWindow.webContents.send('pos-state-changed', { posOpen: posOpen });
          log.info('phase6.cold-boot.welcome-shown');
        } catch (err) {
          log.error('phase6.cold-boot.welcome:show failed: ' + (err && err.message));
        }
        runAutoUpdaterInit();
      };
      if (mainWindow.webContents.isLoading()) {
        mainWindow.webContents.once('did-finish-load', showWelcomeOnColdBoot);
      } else {
        showWelcomeOnColdBoot();
      }

      // Phase 6 D-02 / D-03 — welcome:tap IPC.
      // User tapped the welcome layer. Hide welcome, show splash as a loading cover
      // while the ~3-5s login flow runs, create the Magicline view, start authFlow.
      // Idempotent: if a view already exists (e.g. double-tap), createMagiclineView
      // returns the existing instance and authFlow.start re-seeds currentState.
      ipcMain.on('welcome:tap', (ev) => {
        // Sender validation — only trust the host mainWindow webContents.
        if (ev.sender !== mainWindow.webContents) {
          log.warn('phase6.welcome:tap from unknown sender — ignored');
          return;
        }
        log.info('phase6.welcome:tap received — starting login flow');
        welcomeTapPending = true; // Phase 07 SPLASH-01: arm splash:hide-final gate
        try {
          mainWindow.webContents.send('welcome:hide');
          mainWindow.webContents.send('splash:show');
        } catch (err) {
          log.error('phase6.welcome:tap send failed: ' + (err && err.message));
        }
        startLoginFlow();
      });

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
          // WR-06: clear the reset-loop latch so a verify-pin that follows
          // this recovery flow does NOT take the relaunch branch (which would
          // surprise the user expecting the credentials overlay).
          resetLoopPending = false;
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
          child_process.execFile(
            'C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe',
            [],
            (err) => {
              if (err) {
                log.warn('ipc.launch-touch-keyboard execFile failed: ' + (err && err.message));
                resolve({ ok: false, error: String(err && err.message) });
              } else {
                log.info('ipc.launch-touch-keyboard: tabtip launched');
                resolve({ ok: true });
              }
            }
          );
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
        // WR-03: emit admin.action for button taps; admin.exit is reserved
        // for the actual exit-to-windows path so log parsers can count real
        // kiosk exits.
        log.audit('admin.action', { action: String(action) });
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
              // WR-04: do NOT toggle kiosk mode off — there is no re-enable
              // path, so after the admin closes Explorer the kiosk would stay
              // out of kiosk mode for the next member session. Explorer opens
              // as a separate process and will appear behind the kiosk window;
              // if the admin needs to see it they can use exit-to-windows.
              try { await shell.openPath(app.getPath('logs')); } catch (e) {
                log.error('shell.openPath failed: ' + (e && e.message));
                return { ok: false, error: String(e && e.message) };
              }
              return { ok: true };
            }
            case 'reload': {
              adminMenuOpen = false;
              try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
              const { exists: mvExists, getMagiclineWebContents } = require('./magiclineView');
              if (mvExists()) {
                // D-14: Active session — reload Magicline view (NOT host window) + restart authFlow
                try {
                  const wc = getMagiclineWebContents();
                  if (wc && !wc.isDestroyed()) {
                    welcomeTapPending = true; // arm Phase 07 splash gate for reload path
                    mainWindow.webContents.send('splash:show');
                    authFlow.start({
                      mainWindow: mainWindow,
                      webContents: wc,
                      store: store,
                      safeStorage: safeStorage,
                      log: log,
                    });
                    wc.reload();
                  }
                } catch (e) { log.error('admin reload failed: ' + (e && e.message)); }
              } else {
                // D-13: Welcome state — start fresh session (Layer 2 behavior)
                welcomeTapPending = true; // arm Phase 07 splash gate for reload-from-welcome path
                try { mainWindow.webContents.send('welcome:hide'); } catch (_) {}
                try { mainWindow.webContents.send('splash:show'); } catch (_) {}
                startLoginFlow();
              }
              return { ok: true };
            }
            case 're-enter-credentials': {
              try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
              try {
                const { setMagiclineViewVisible } = require('./magiclineView');
                setMagiclineViewVisible(false);
              } catch (_) {}
              try { mainWindow.webContents.send('show-credentials-overlay', { firstRun: false }); } catch (_) {}
              adminMenuOpen = false;
              log.audit('admin.action', { action: 'credentials-changed' }); // D-07
              return { ok: true };
            }
            case 'pin-change': {
              // D-08/D-09: hide admin menu, show PIN change overlay
              try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
              try { mainWindow.webContents.send('show-pin-change-overlay'); } catch (_) {}
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
            case 'toggle-dev-mode': {
              devModeActive = !devModeActive;
              log.info('admin.dev-mode: ' + (devModeActive ? 'ON' : 'OFF'));
              const mv = require('./magiclineView');
              if (devModeActive) {
                // Exit kiosk mode so taskbar/alt-tab work. Do NOT resize the
                // window — keep Magicline full-size and visible. DevTools is
                // detached and can be dragged around on top.
                try { mainWindow.setKiosk(false); } catch (_) {}
                mv.enableDevMode();
                try { mainWindow.webContents.openDevTools({ mode: 'detach' }); } catch (_) {}
              } else {
                mv.disableDevMode();
                try { mainWindow.webContents.closeDevTools(); } catch (_) {}
                try { mainWindow.setKiosk(true); } catch (_) {}
              }
              // Notify renderer to update button label + fade host overlays
              try {
                mainWindow.webContents.send('dev-mode-changed', { active: devModeActive });
              } catch (_) {}
              adminMenuOpen = false;
              try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
              return { ok: true, devMode: devModeActive };
            }
            case 'toggle-pos-open': {
              var current = store.get('posOpen', true);
              var next = !current;
              store.set('posOpen', next);
              log.audit('pos.state-changed', { open: next, reason: 'admin' });
              try {
                mainWindow.webContents.send('pos-state-changed', { posOpen: next });
              } catch (_) {}
              return { ok: true, posOpen: next };
            }
            case 'exit-to-windows': {
              // WR-03: canonical admin.exit event reserved for actual exit.
              log.audit('admin.exit', {});
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

      // --- close-admin-menu: PAT config cancel / explicit close / X button / Esc
      ipcMain.handle('close-admin-menu', async () => {
        closeAdminMenu();
        return { ok: true };
      });

      // --- Phase 08: PIN change submission (D-10, D-11) ---
      ipcMain.handle('submit-pin-change', async (_e, payload) => {
        if (!payload || typeof payload.currentPin !== 'string' || typeof payload.newPin !== 'string') {
          return { ok: false, error: 'invalid-payload' };
        }
        // D-10: re-verify current PIN using raw adminPin (NOT lockout wrapper)
        const ok = adminPin.verifyPin(store, payload.currentPin);
        if (!ok) {
          log.audit('pin.verify', { result: 'fail', via: 'pin-change' });
          return { ok: false, error: 'wrong-pin' };
        }
        try {
          adminPin.setPin(store, payload.newPin);
          log.audit('admin.action', { action: 'pin-changed' });
          // Return to admin menu after successful PIN change
          adminMenuOpen = true;
          try { mainWindow.webContents.send('hide-pin-change-overlay'); } catch (_) {}
          try {
            const d = buildAdminDiagnostics(store);
            mainWindow.webContents.send('show-admin-menu', d);
          } catch (_) {}
          return { ok: true };
        } catch (e) {
          log.error('ipc.submit-pin-change failed: ' + (e && e.message));
          return { ok: false, error: String(e && e.message) };
        }
      });

      // --- Phase 08: PIN change cancel — return to admin menu
      ipcMain.handle('cancel-pin-change', async () => {
        adminMenuOpen = true;
        try { mainWindow.webContents.send('hide-pin-change-overlay'); } catch (_) {}
        try {
          const d = buildAdminDiagnostics(store);
          mainWindow.webContents.send('show-admin-menu', d);
        } catch (_) {}
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
