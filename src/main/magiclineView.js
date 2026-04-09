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
// Child view starts HIDDEN (zero bounds) so the Phase 1 splash stays visible
// underneath. The view is flipped to full bounds ONLY on cash-register-ready
// (see handleInjectEvent). Drift keeps it hidden so the #magicline-error host
// overlay can show over the splash without Magicline leaking through.
let revealed      = false;

// Whitelist of event types we accept from the untrusted Magicline main world.
// A compromised Magicline could plant fake events; the worst outcome is a
// false splash-lift or a false drift overlay — both bounded by readyFired +
// driftActive one-shot guards. Never execute data, only log + send IPC.
const KNOWN_EVENT_TYPES = new Set([
  'drift',
  'cash-register-ready',
  'observer-scope-fallback',
  'observer-attach-failed',
  'login-detected',     // Phase 3 (D-03)
  'login-submitted'     // Phase 3 (D-03)
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
      // NO preload — D-15. Magicline is untrusted; all privileged ops go
      // through the host preload → ipcMain, never the child view.
    }
  });

  // D-01: attach as child of the host window's contentView (NOT the
  // deprecated legacy embedded-view APIs removed in Electron 41).
  //
  // IMPORTANT: do NOT call sizeChildView here — WebContentsView is GPU-composited
  // on top of the host BrowserWindow's webContents, so a full-bounds child view
  // would cover the Phase 1 splash. Keep bounds at the default {0,0,0,0} until
  // cash-register-ready fires (handleInjectEvent). Magicline still loads and
  // runs in the background at zero bounds — it just paints nothing.
  mainWindow.contentView.addChildView(magiclineView);

  // Resize handler only takes effect after the view has been revealed.
  // Before reveal, a window resize must not accidentally expand the child view.
  resizeHandler = () => { if (revealed) sizeChildView(mainWindow); };
  mainWindow.on('resize', resizeHandler);

  // D-02: reuse Phase 1 lockdown on the child view's webContents.
  // attachLockdown is a no-op in dev mode per Phase 1 D-07.
  attachLockdown(magiclineView.webContents);

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
  if (isDev) {
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

  // Render-process-gone logging only — Phase 4 will handle recovery.
  magiclineView.webContents.on('render-process-gone', (_e, details) => {
    log.error('magicline.render-process-gone: ' + JSON.stringify(details));
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
    } catch (err) {
      log.warn('magicline.insertCSS.did-start-navigation failed: ' + (err && err.message));
    }
  });

  wc.on('dom-ready', async () => {
    try {
      await wc.insertCSS(INJECT_CSS);
      await wc.executeJavaScript(INJECT_BUNDLE, true);
      log.info('magicline.injected: dom-ready');
    } catch (err) {
      log.error('magicline.inject.failed.dom-ready: ' + (err && err.message));
    }
  });

  wc.on('did-navigate-in-page', async (_e, url) => {
    try {
      await wc.insertCSS(INJECT_CSS);
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
    if (!driftActive) {
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
    // Reveal the Magicline child view first (paints Magicline at full bounds),
    // THEN tell the host to hide the splash. Order matters — sizing up before
    // splash-hide ensures the cash register is on-screen the instant the splash
    // fades, with no black-flash gap.
    try {
      revealed = true;
      sizeChildView(mainWindow);
    } catch (e) {
      log.error('magicline.view.reveal failed: ' + (e && e.message));
    }
    try {
      mainWindow.webContents.send('splash:hide');
    } catch (e) {
      log.error('magicline.splash-hide.send failed: ' + (e && e.message));
    }
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
  resizeHandler = null;
  magiclineView = null;
  readyFired    = false;
  driftActive   = false;
  revealed      = false;
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

module.exports = {
  createMagiclineView,
  destroyMagiclineView,
  getMagiclineWebContents,
  // Exported for tests / diagnostics only — do NOT call from main.js:
  _computeDefaultZoom: computeDefaultZoom,
  _DRIFT_MESSAGE: DRIFT_MESSAGE,
  _PARTITION: PARTITION,
};
