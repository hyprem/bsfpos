// src/main/magiclineView.js
// -----------------------------------------------------------------------------
// Phase 2 — Magicline child view owner.
//
// Creates a WebContentsView (NOT deprecated BrowserView — Electron 41) child
// attached to the Phase 1 host window. Loads Magicline at the cash-register URL
// under the 'persist:magicline' session partition (D-14). Wires injection of
// inject.css + (fragile-selectors.js + inject.js) on did-start-navigation,
// dom-ready, and did-navigate-in-page. Polls the main-world __bskiosk_events
// drain queue every 250 ms and translates 'drift' / 'cash-register-ready'
// events into host-side IPC sends.
//
// OFF-LIMITS TO DRIFT PATCHES (D-11). When Magicline changes, edit src/inject/
// only. Never edit this file in response to a selector rename.
// -----------------------------------------------------------------------------

const { WebContentsView, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('./logger');
const { attachLockdown } = require('./keyboardLockdown');

const isDev = process.env.NODE_ENV === 'development';

const MAGICLINE_URL     = 'https://bee-strong-fitness.web.magicline.com/#/cash-register';
const PARTITION         = 'persist:magicline';   // D-14 — stable across phases
const DRAIN_INTERVAL_MS = 250;                    // Pattern 5 cadence
const DRIFT_MESSAGE     = 'Kasse vorübergehend nicht verfügbar — Bitte wenden Sie sich an das Studio-Personal';

// --- Load inject files at require-time (read-only, bundled) -----------------
const INJECT_CSS = fs.readFileSync(path.join(__dirname, '..', 'inject', 'inject.css'),           'utf8');
// Hide-until-ready wrapper: Magicline view must be at full bounds for
// Chromium to run layout/JS normally (a {0,0,0,0} view throttles everything
// and breaks the injected auto-login script). But at full bounds it covers
// the host UI (splash, credentials overlay, PIN modal).
//
// We use `opacity: 0` NOT `visibility: hidden` — the latter signals Chromium
// to skip paint work, which triggers aggressive throttling of MutationObserver
// / setTimeout / requestAnimationFrame on the view's JS context. That
// throttling broke cash-register-ready detection post-idle-reset (the inject
// events fire early but the final "ready" signal never arrived within the 30s
// post-submit watchdog window, while dev mode — which attaches DevTools and
// disables throttling — worked fine). `opacity: 0` keeps the view composited
// at alpha 0, so Chromium still paints frames and JS runs at normal speed.
// Host UI shows through because the view background is transparent.
// Removed on cash-register-ready so the real cash register becomes visible.
const HIDE_UNTIL_READY_CSS = 'html, body { opacity: 0 !important; background: transparent !important; }';
const FRAGILE_JS = fs.readFileSync(path.join(__dirname, '..', 'inject', 'fragile-selectors.js'), 'utf8');
const INJECT_JS  = fs.readFileSync(path.join(__dirname, '..', 'inject', 'inject.js'),            'utf8');
// Concat order: fragile first so FRAGILE_SELECTORS + STABLE_SELECTORS are in
// scope when inject.js's IIFE runs. The extra `;\n` is a safety separator
// against an unterminated statement at the end of fragile-selectors.js.
const INJECT_BUNDLE = FRAGILE_JS + '\n;\n' + INJECT_JS;

// --- Drain-queue JS expression (Pattern 5) ----------------------------------
// Executed via webContents.executeJavaScript every DRAIN_INTERVAL_MS. Returns
// the accumulated event queue and clears it atomically in the page.
const DRAIN_EXPR = '(function(){var q=window.__bskiosk_events||[];window.__bskiosk_events=[];return q;})()';

// --- Module-scoped state (single instance per app) -------------------------
let magiclineView = null;
let drainTimer    = null;
let readyFired    = false;
let driftActive   = false;
let resizeHandler = null;
// WR-01: module-scoped admin-hotkey callback so the Ctrl+Shift+F12 before-input
// listener is re-attached automatically on every view recreation (including
// after sessionReset.hardReset destroys+recreates the child view). main.js
// registers this once at startup via setAdminHotkeyHandler().
let adminHotkeyHandler = null;
// Child view starts HIDDEN (zero bounds) so the Phase 1 splash stays visible
// underneath. The view is flipped to full bounds ONLY on cash-register-ready
// (see handleInjectEvent). Drift keeps it hidden so the #magicline-error host
// overlay can show over the splash without Magicline leaking through.
let revealed      = false;
let hideCssKey    = null; // handle for removeInsertedCSS on reveal
let devMode       = false; // dev mode: skip HIDE_UNTIL_READY_CSS + auto-open DevTools

// Whitelist of event types we accept from the untrusted Magicline main world.
// A compromised Magicline could plant fake events; the worst outcome is a
// false splash-lift or a false drift overlay — both bounded by readyFired +
// driftActive one-shot guards. Never execute data, only log + send IPC.
const KNOWN_EVENT_TYPES = new Set([
  'drift',
  'cash-register-ready',
  'observer-scope-fallback',
  'observer-attach-failed',
  'login-detected',          // Phase 3 (D-03)
  'login-submitted',         // Phase 3 (D-03)
  // Phase 4 additions (D-06, D-10)
  'product-search-focused',
  'product-search-blurred',
  'activity',
]);

function computeDefaultZoom() {
  // D-09: derive from primary display workAreaSize width. Reference width is
  // Magicline's desktop minimum useful viewport (~1280 px). Clamp to [0.7, 1.25]
  // to avoid unusably small (<0.7) or oversized (>1.25) rendering on an
  // unknown real kiosk resolution. Overridable via electron-store key
  // 'magiclineZoomFactor' — see computeDefaultZoom caller.
  //
  // NOTE: As of 2026-04-08 the real kiosk screen resolution is UNKNOWN. This
  // function is a first-boot heuristic; operators MUST measure and override.
  // Tracked in Plan 06 as PENDING-HUMAN verification.
  try {
    const { width } = screen.getPrimaryDisplay().workAreaSize;
    const raw = width / 1280;
    return Math.max(0.7, Math.min(1.25, raw));
  } catch (e) {
    log.warn('magicline.zoom.computeDefault failed: ' + (e && e.message) + ' — falling back to 1.0');
    return 1.0;
  }
}

function createMagiclineView(mainWindow, store) {
  if (magiclineView) {
    log.warn('magicline.view.createMagiclineView: already created, returning existing instance');
    return magiclineView;
  }
  if (!mainWindow) {
    throw new Error('createMagiclineView: mainWindow is required');
  }
  if (!store || typeof store.get !== 'function') {
    throw new Error('createMagiclineView: electron-store instance with .get() is required');
  }

  // D-01 / D-14 / D-15: WebContentsView with partition-isolated session,
  // context isolation, sandbox, no node integration, no preload.
  magiclineView = new WebContentsView({
    webPreferences: {
      partition:        PARTITION,
      contextIsolation: true,
      sandbox:          true,
      nodeIntegration:  false,
      devTools:         isDev,
      backgroundThrottling: false,
      transparent:      true,
      // NO preload — D-15. Magicline is untrusted; all privileged ops go
      // through the host preload → ipcMain, never the child view.
    }
  });
  // Belt-and-suspenders: the constructor flag above sets backgroundThrottling
  // at creation, but the explicit post-creation call ensures it stays off
  // even when the view is hidden (the hide-CSS path nearly tipped Chromium
  // into throttling MutationObserver dispatch post-idle-reset).
  try {
    if (typeof magiclineView.webContents.setBackgroundThrottling === 'function') {
      magiclineView.webContents.setBackgroundThrottling(false);
    }
  } catch (e) {
    log.warn('magicline.setBackgroundThrottling failed: ' + (e && e.message));
  }
  // Set the view's own background to transparent so that when the injected
  // HIDE_UNTIL_READY_CSS makes body invisible, the host UI behind composites
  // through instead of the default white fill.
  try {
    magiclineView.setBackgroundColor('#00000000');
  } catch (e) { /* pre-Electron-41 WebContentsView may not support */ }

  // D-01: attach as child of the host window's contentView (NOT the
  // deprecated legacy embedded-view APIs removed in Electron 41).
  //
  // IMPORTANT: do NOT call sizeChildView here — WebContentsView is GPU-composited
  // on top of the host BrowserWindow's webContents, so a full-bounds child view
  // would cover the Phase 1 splash. Keep bounds at the default {0,0,0,0} until
  // cash-register-ready fires (handleInjectEvent). Magicline still loads and
  // runs in the background at zero bounds — it just paints nothing.
  mainWindow.contentView.addChildView(magiclineView);

  // Size the view to its FULL logical bounds from creation so Chromium runs
  // layout and JS at normal speed (rAF, setTimeout, MutationObserver). See
  // Phase 3 UAT findings: a {0,0,0,0} view is treated by Chromium as
  // non-rendering and aggressively throttles layout/JS even with
  // backgroundThrottling: false, which breaks the injected auto-login
  // script. Off-screen positioning (negative x) is also clipped to zero
  // effective bounds, so that doesn't help either.
  //
  // Visual hiding is handled by HIDE_UNTIL_READY_CSS (injected in
  // wireInjection) + transparent view background, so the host UI composites
  // through during the auto-login window. On cash-register-ready we remove
  // the hide CSS so the real cash register becomes visible.
  try {
    const { width: dw, height: dh } = mainWindow.getContentBounds();
    magiclineView.setBounds({ x: 0, y: 0, width: dw, height: dh });
  } catch (e) {
    log.warn('magicline.view.init-bounds failed: ' + (e && e.message));
  }

  // Resize handler only takes effect after the view has been revealed.
  // Before reveal, a window resize must not accidentally expand the child view.
  resizeHandler = () => { if (revealed) sizeChildView(mainWindow); };
  mainWindow.on('resize', resizeHandler);

  // D-02: reuse Phase 1 lockdown on the child view's webContents.
  // attachLockdown is a no-op in dev mode per Phase 1 D-07.
  attachLockdown(magiclineView.webContents);
  // Phase 4 (D-01, D-02, research Pattern 1): two-attach pattern mirror of
  // attachLockdown — badge input arbiter must see keystrokes on both the host
  // wc AND the Magicline child wc. Lockdown first, badgeInput second so the
  // global-shortcut no-ops are installed before the keydown listener runs.
  const { attachBadgeInput } = require('./badgeInput');
  attachBadgeInput(magiclineView.webContents);

  // WR-01: re-attach Ctrl+Shift+F12 admin hotkey listener to the newly-created
  // child webContents. This must run on EVERY createMagiclineView invocation
  // (including after sessionReset.hardReset) because the previous webContents
  // instance was destroyed and its listeners are gone. Without this re-attach
  // the admin hotkey silently stops working on the Magicline view after the
  // first hardReset — leaving only the host-wc fallback and the global
  // shortcut, either of which can fail (esp. in dev where globalShortcut is
  // not registered).
  if (typeof adminHotkeyHandler === 'function') {
    magiclineView.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      try {
        const { canonical: canon } = require('./keyboardLockdown');
        if (canon(input) === 'Ctrl+Shift+F12') {
          adminHotkeyHandler();
        }
      } catch (_) { /* swallow */ }
    });
  }

  // D-08 / D-09: zoom factor from electron-store override or runtime default.
  const zoom = store.get('magiclineZoomFactor', computeDefaultZoom());
  try {
    magiclineView.webContents.setZoomFactor(zoom);
    const source = (store.has && store.has('magiclineZoomFactor')) ? 'store' : 'default';
    log.info('magicline.zoom: factor=' + zoom + ' source=' + source);
  } catch (e) {
    log.warn('magicline.zoom.setZoomFactor failed: ' + (e && e.message));
  }

  // D-13: dev mode DevTools on child view (detached, matching host pattern).
  // Also re-open on view recreation (post-idle-reset) if admin dev mode is on.
  if (isDev || devMode) {
    try {
      magiclineView.webContents.openDevTools({ mode: 'detach' });
    } catch (e) {
      log.warn('magicline.devtools.open failed: ' + (e && e.message));
    }
  }

  wireInjection(magiclineView.webContents);
  startEventDrain(magiclineView.webContents, mainWindow);

  magiclineView.webContents.loadURL(MAGICLINE_URL).catch((err) => {
    log.error('magicline.loadURL failed: ' + (err && err.message));
  });

  log.info('magicline.view.created: partition=' + PARTITION + ' url=' + MAGICLINE_URL);

  // Phase 4 D-22 / IDLE-07: log + trigger sessionReset hard reset on crash.
  // Research pin #6: the details.reason === 'clean-exit' guard prevents a
  // recovery loop during normal app shutdown when Chromium tears the render
  // process down cleanly.
  // Phase 5 Plan 06 D-27: relay sale-completion sentinel from inject.js
  // (which runs in the Magicline main world and has no preload/IPC access)
  // to the main process via a console.log sentinel. The main-process listener
  // forwards it as the `audit-sale-completed` ipc, which emits
  // `log.audit('sale.completed', {})` in the canonical taxonomy.
  try {
    magiclineView.webContents.on('console-message', (...args) => {
      // Electron has shipped two signatures for console-message over the
      // 30..41 line: (event, level, message, line, sourceId) and
      // (event) with event.message. Handle both defensively.
      let message = '';
      if (args.length >= 3 && typeof args[2] === 'string') {
        message = args[2];
      } else if (args[0] && typeof args[0].message === 'string') {
        message = args[0].message;
      }
      if (message && message.indexOf('[BSK]') !== -1) {
        log.info('magicline.console: ' + message);
      }
      if (message && message.indexOf('BSK_AUDIT_SALE_COMPLETED') !== -1) {
        try {
          const { ipcMain } = require('electron');
          ipcMain.emit('audit-sale-completed');
        } catch (_) { /* swallow */ }
      }
    });
  } catch (e) {
    log.warn('magicline.console-message.attach failed: ' + (e && e.message));
  }

  magiclineView.webContents.on('render-process-gone', (_e, details) => {
    log.error('magicline.render-process-gone: ' + JSON.stringify(details));
    if (details && details.reason === 'clean-exit') return;
    try {
      require('./sessionReset').hardReset({ reason: 'crash' });
    } catch (e) {
      log.error('sessionReset.hardReset failed from crash path: ' + (e && e.message));
    }
  });

  return magiclineView;
}

function sizeChildView(mainWindow) {
  if (!magiclineView) return;
  try {
    const { width, height } = mainWindow.getContentBounds();
    magiclineView.setBounds({ x: 0, y: 0, width: width, height: height });
  } catch (e) {
    log.warn('magicline.view.sizeChildView failed: ' + (e && e.message));
  }
}

function wireInjection(wc) {
  // Pattern 1 — three-event trigger mix:
  //   did-start-navigation : insertCSS only (beat first-paint on full reload)
  //   dom-ready            : insertCSS + executeJavaScript (primary)
  //   did-navigate-in-page : insertCSS + executeJavaScript (hash routes)
  //
  // did-navigate and did-frame-finish-load are intentionally NOT wired.

  wc.on('did-start-navigation', async (_e, _url, _isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    try {
      await wc.insertCSS(INJECT_CSS);
      if (!revealed && !hideCssKey && !devMode) {
        hideCssKey = await wc.insertCSS(HIDE_UNTIL_READY_CSS);
      }
    } catch (err) {
      log.warn('magicline.insertCSS.did-start-navigation failed: ' + (err && err.message));
    }
  });

  wc.on('dom-ready', async () => {
    try {
      await wc.insertCSS(INJECT_CSS);
      if (!revealed && !hideCssKey && !devMode) {
        hideCssKey = await wc.insertCSS(HIDE_UNTIL_READY_CSS);
      }
      await wc.executeJavaScript(INJECT_BUNDLE, true);
      log.info('magicline.injected: dom-ready');
    } catch (err) {
      log.error('magicline.inject.failed.dom-ready: ' + (err && err.message));
    }
  });

  wc.on('did-navigate-in-page', async (_e, url) => {
    try {
      await wc.insertCSS(INJECT_CSS);
      if (!revealed && !hideCssKey && !devMode) {
        hideCssKey = await wc.insertCSS(HIDE_UNTIL_READY_CSS);
      }
      await wc.executeJavaScript(INJECT_BUNDLE, true);
      log.info('magicline.injected: did-navigate-in-page url=' + url);
    } catch (err) {
      log.error('magicline.inject.failed.did-navigate-in-page: ' + (err && err.message));
    }
  });
}

function startEventDrain(wc, mainWindow) {
  if (drainTimer) { clearInterval(drainTimer); drainTimer = null; }
  drainTimer = setInterval(async () => {
    if (wc.isDestroyed()) {
      clearInterval(drainTimer);
      drainTimer = null;
      return;
    }
    let events;
    try {
      events = await wc.executeJavaScript(DRAIN_EXPR, true);
    } catch (err) {
      // Page not ready yet, navigating, or about:blank — swallow.
      return;
    }
    if (!Array.isArray(events) || events.length === 0) return;
    for (const e of events) {
      handleInjectEvent(e, mainWindow);
    }
  }, DRAIN_INTERVAL_MS);
}

function handleInjectEvent(evt, mainWindow) {
  if (!evt || typeof evt !== 'object') return;
  const type = String(evt.type || '');
  if (!KNOWN_EVENT_TYPES.has(type)) {
    log.warn('magicline.inject.unknown-event-type: ' + type);
    return;
  }
  const payload = (evt.payload && typeof evt.payload === 'object') ? evt.payload : {};

  if (type === 'drift') {
    const selector = String(payload.selector || '');
    const category = String(payload.category || 'unknown');
    const purpose  = String(payload.purpose  || '');
    log.warn('magicline.drift: selector=' + selector + ' category=' + category + ' purpose=' + purpose);
    // Only show the blocking error overlay if the cash register hasn't loaded
    // yet. Post-ready drift is informational (logged above) — the kiosk is
    // functional and showing the error overlay would cover a working UI.
    if (!driftActive && !readyFired) {
      driftActive = true;
      try {
        mainWindow.webContents.send('show-magicline-error', { message: DRIFT_MESSAGE });
      } catch (e) {
        log.error('magicline.show-magicline-error.send failed: ' + (e && e.message));
      }
    }
    return;
  }

  if (type === 'cash-register-ready') {
    if (driftActive) {
      // D-06: drift overlay takes precedence over splash lift.
      log.info('magicline.cash-register-ready.suppressed: drift-active');
      return;
    }
    if (readyFired) return;
    readyFired = true;
    log.info('magicline.cash-register-ready: url=' + String(payload.url || ''));
    // Phase 3: forward to authFlow state machine (cookie-session skip-login
    // path or LOGIN_SUBMITTED terminal success).
    try {
      require('./authFlow').notify({ type: 'cash-register-ready', payload: payload });
    } catch (e) {
      log.error('magicline.authFlow.notify.cash-register-ready failed: ' + (e && e.message));
    }
    // Reveal: the view is already at full bounds from creation (required
    // for Chromium to run JS normally — see `Size the view to its FULL
    // logical bounds from creation` comment above). Remove the
    // HIDE_UNTIL_READY_CSS so Magicline becomes visible, then tell the host
    // to hide the splash.
    try {
      revealed = true;
      if (hideCssKey) {
        magiclineView.webContents.removeInsertedCSS(hideCssKey).catch(() => {});
        hideCssKey = null;
      }
      sizeChildView(mainWindow);
    } catch (e) {
      log.error('magicline.view.reveal failed: ' + (e && e.message));
    }
    try {
      mainWindow.webContents.send('splash:hide');
    } catch (e) {
      log.error('magicline.splash-hide.send failed: ' + (e && e.message));
    }
    try {
      mainWindow.webContents.send('hide-magicline-error');
    } catch (_) {}
    return;
  }

  if (type === 'observer-scope-fallback') {
    log.warn('magicline.observer.fallback: ' + JSON.stringify(payload));
    return;
  }

  if (type === 'observer-attach-failed') {
    log.error('magicline.observer.attach-failed: ' + JSON.stringify(payload));
    return;
  }

  // Phase 3 delegation: authFlow.start(...) is called from main.js Plan 07
  // AFTER createMagiclineView returns, so require('./authFlow') here is safe
  // — authFlow is loaded by the time the first drain event arrives.
  if (type === 'login-detected' || type === 'login-submitted') {
    // Phase 3: forward to authFlow state machine. authFlow decides what to
    // do based on its current state (reduce is a pure switch).
    log.info('magicline.' + type + ': url=' + String(payload.url || ''));
    try {
      require('./authFlow').notify({ type: type, payload: payload });
    } catch (e) {
      log.error('magicline.authFlow.notify.' + type + ' failed: ' + (e && e.message));
    }
    return;
  }

  // Phase 4 (D-06, D-09 #3): badge-input arbitration — product search focus
  // toggles the badgeInput "staff product scan passthrough" flag so NFC scans
  // hit the customer-search field except when staff is scanning a product.
  if (type === 'product-search-focused') {
    try {
      require('./badgeInput').setProductSearchFocused(true);
    } catch (e) {
      log.error('magicline.badgeInput.setProductSearchFocused(true) failed: ' + (e && e.message));
    }
    return;
  }
  if (type === 'product-search-blurred') {
    try {
      require('./badgeInput').setProductSearchFocused(false);
    } catch (e) {
      log.error('magicline.badgeInput.setProductSearchFocused(false) failed: ' + (e && e.message));
    }
    return;
  }

  // Phase 4 (D-10): any touch/pointer/keyboard activity inside the Magicline
  // view bumps the idle timer so the "are you still there?" overlay is not
  // shown while a member is mid-checkout.
  if (type === 'activity') {
    try {
      require('./idleTimer').bump();
    } catch (e) {
      log.error('magicline.idleTimer.bump failed: ' + (e && e.message));
    }
    return;
  }
}

// WR-03: teardown path. Clears all module-scoped state so a subsequent
// createMagiclineView() call after window recreation builds a fresh instance
// instead of hitting the "already created" early-return. Also unhooks the
// resize listener so the dead mainWindow can be GC'd.
//
// Intended to be called from mainWindow.once('closed', ...) inside
// createMagiclineView. Safe to call if state is already cleared.
function destroyMagiclineView(mainWindow) {
  if (drainTimer) {
    clearInterval(drainTimer);
    drainTimer = null;
  }
  if (mainWindow && resizeHandler) {
    try {
      mainWindow.removeListener('resize', resizeHandler);
    } catch (e) {
      // mainWindow may already be destroyed — safe to ignore.
    }
  }
  // CR-01: detach the child view from the host contentView and destroy the
  // underlying webContents before nulling module state. Without this, every
  // sessionReset.hardReset cycle stacks a new WebContentsView on top of the
  // orphaned one — leaking composited layers, GPU resources, and (worst)
  // leaving the old wc's before-input-event / render-process-gone listeners
  // alive. An orphaned render-process-gone listener can itself re-trigger
  // hardReset and trip the reset-loop guard on the next crash.
  if (magiclineView) {
    try {
      if (mainWindow && mainWindow.contentView &&
          typeof mainWindow.contentView.removeChildView === 'function') {
        mainWindow.contentView.removeChildView(magiclineView);
      }
    } catch (e) {
      log.warn('magicline.view.removeChildView failed: ' + (e && e.message));
    }
    try {
      const wc = magiclineView.webContents;
      if (wc && typeof wc.isDestroyed === 'function' && !wc.isDestroyed()) {
        if (typeof wc.close === 'function') {
          wc.close();
        } else if (typeof wc.destroy === 'function') {
          wc.destroy();
        }
      }
    } catch (e) {
      log.warn('magicline.view.wc.close failed: ' + (e && e.message));
    }
  }
  resizeHandler = null;
  magiclineView = null;
  readyFired    = false;
  driftActive   = false;
  revealed      = false;
  hideCssKey    = null;
  log.info('magicline.view.destroyed');
}

// Defensive accessor for main.js Plan 03-07 wiring. Returns the child view's
// webContents (the thing Phase 3 authFlow interpolates into) or null if the
// view has not been created yet / was torn down. Callers may equivalently
// read `.webContents` off the instance returned by createMagiclineView — this
// accessor is for cases where module-scoped lookup is cleaner than threading
// the instance through a closure.
function getMagiclineWebContents() {
  return magiclineView ? magiclineView.webContents : null;
}

// Hide/show the Magicline child view so the host HTML (credentials overlay,
// admin menu, etc.) can receive keyboard and pointer input. The child
// WebContentsView sits on top of the host webContents in the compositor and
// captures all input even when visually transparent. Setting bounds to zero
// removes it from the input path without destroying the view or its session.
let savedBounds = null;
function setMagiclineViewVisible(visible) {
  if (!magiclineView) return;
  try {
    if (!visible) {
      savedBounds = magiclineView.getBounds();
      magiclineView.setBounds({ x: 0, y: 0, width: 0, height: 0 });
    } else if (savedBounds) {
      magiclineView.setBounds(savedBounds);
      savedBounds = null;
    }
  } catch (e) {
    log.warn('magicline.view.setVisible failed: ' + (e && e.message));
  }
}

// Self-heal helper for authFlow: clear the Magicline partition cookies and
// reload the current view. Used when the boot watchdog expires with a stale
// preserved cookie — Magicline may be rendering an "access expired" error
// page that our inject script can't detect as a login form, so we wipe the
// session and let Magicline redirect to a clean login form.
async function clearCookiesAndReload() {
  if (!magiclineView) return;
  try {
    const wc = magiclineView.webContents;
    if (!wc || wc.isDestroyed()) return;
    // Reset the hide CSS key so wireInjection can re-apply HIDE_UNTIL_READY_CSS
    // on the reload — otherwise the view stays revealed mid-reload.
    readyFired = false;
    revealed   = false;
    if (hideCssKey) {
      try { await wc.removeInsertedCSS(hideCssKey); } catch (_) {}
      hideCssKey = null;
    }
    // Self-heal is a "fully clean slate" recovery — clear cookies AND
    // localStorage/sessionStorage. We keep localStorage on normal idle resets
    // (to preserve register selection etc.) but here we're already in an
    // unhealthy state, and Magicline's SPA uses localStorage to remember the
    // last visited route. Leaving it in place causes the post-self-heal login
    // to land on e.g. #/customermanagement/search instead of #/cash-register.
    await wc.session.clearStorageData({
      storages: ['cookies', 'localstorage', 'sessionstorage', 'indexdb', 'cachestorage'],
    });
    log.info('magicline.self-heal: cookies + localStorage cleared, reloading');
    await wc.loadURL(MAGICLINE_URL);
  } catch (e) {
    log.warn('magicline.clearCookiesAndReload failed: ' + (e && e.message));
  }
}

// Dev mode: set a module flag so future view recreations (after idle reset)
// skip HIDE_UNTIL_READY_CSS injection, and immediately remove the CSS on the
// current view. Also opens DevTools on the Magicline webContents.
function enableDevMode() {
  devMode = true;
  if (!magiclineView) return;
  try {
    if (hideCssKey) {
      magiclineView.webContents.removeInsertedCSS(hideCssKey).catch(() => {});
      hideCssKey = null;
    }
  } catch (_) {}
  try {
    magiclineView.webContents.openDevTools({ mode: 'detach' });
  } catch (_) {}
}

function disableDevMode() {
  devMode = false;
  if (!magiclineView) return;
  try {
    magiclineView.webContents.closeDevTools();
  } catch (_) {}
}

function isDevMode() {
  return devMode;
}

// WR-01: main.js calls this once at startup to register the admin hotkey
// callback. The callback is re-applied inside createMagiclineView so every
// view recreation (after sessionReset.hardReset) gets a fresh listener on the
// new webContents instance.
function setAdminHotkeyHandler(fn) {
  adminHotkeyHandler = (typeof fn === 'function') ? fn : null;
}

module.exports = {
  createMagiclineView,
  destroyMagiclineView,
  getMagiclineWebContents,
  setMagiclineViewVisible,
  setAdminHotkeyHandler,
  enableDevMode,
  disableDevMode,
  isDevMode,
  clearCookiesAndReload,
  // Exported for tests / diagnostics only — do NOT call from main.js:
  _computeDefaultZoom: computeDefaultZoom,
  _DRIFT_MESSAGE: DRIFT_MESSAGE,
  _PARTITION: PARTITION,
};
