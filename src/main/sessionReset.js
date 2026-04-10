// src/main/sessionReset.js
// -----------------------------------------------------------------------------
// Phase 4 — Single entry point for all kiosk hard resets.
//
// Plan 04-02: IDLE-03 (hard reset) + IDLE-05 (reset-loop detection).
//
// All reset paths (idle expiry, render-process-gone crash, admin menu in
// Phase 5) funnel through hardReset({reason}). The module owns two pieces of
// module-scoped state:
//
//   1. `resetting` — in-flight mutex. Set BEFORE any `await`, always cleared
//      on the unwind path. Guarantees concurrent hardReset() calls cannot
//      produce a half-logged-in state (T-04-09).
//
//   2. `resetTimestamps` — rolling 60-second window of reset events. If 3
//      resets land within the window, `loopActive` latches `true` and no
//      further hardReset() will proceed until the next `app.relaunch()`
//      (T-04-07). The counter is UNIFIED across reasons (D-18): idle + crash
//      share one window, so two crashes and one idle expiry still trip the
//      guard.
//
// D-15 step sequence (normative — do NOT reorder). See the hardReset() body
// below for the enforced 11-step flow (guard → loop-check → mutex → idle stop
// → splash overlay IPC → view teardown → partition clear → cookie flush →
// view rebuild → mutex release).
//
// NOTE: The D-15 text has a typo on step 5 (hyphen form without the colon).
// The CORRECT channel name is the colon-separated form used in hardReset()
// below, matching the Phase 1 IPC convention established in src/host/host.js
// and src/main/preload.js. See 04-RESEARCH.md Pitfall 3.
//
// LAZY REQUIRE: ./idleTimer and ./magiclineView are required INSIDE
// hardReset, not at the top of the file. idleTimer (Plan 04-01) lazy-requires
// sessionReset to break the circular dependency created by the idle-expiry
// callback. Top-level requires here would turn that cycle into a load-time
// crash.
// -----------------------------------------------------------------------------

const { session } = require('electron');
const log = require('./logger');

const RESET_WINDOW_MS      = 60_000;   // IDLE-05 rolling window
const RESET_LOOP_THRESHOLD = 3;        // IDLE-05: 3 in window trips guard

// --- Module-scoped state ---------------------------------------------------

let resetting  = false;
let loopActive = false;
const resetTimestamps = []; // Array<{ t: number, reason: string }>

let mainWindow = null;
let store      = null;

let postResetListener = null; // Phase 5 D-15/D-16: single listener for updateGate
let lastResetAt       = null; // Phase 5 D-03: ms since epoch of last successful hardReset

// --- Public API -------------------------------------------------------------

function init(opts) {
  if (!opts || !opts.mainWindow) {
    throw new Error('sessionReset.init: { mainWindow, store } is required');
  }
  mainWindow = opts.mainWindow;
  store      = opts.store;
}

async function hardReset({ reason }) {
  // D-15 step 1 — in-flight / loop-active guard
  if (resetting || loopActive) {
    log.info(
      'sessionReset.suppressed: ' +
      (resetting ? 'in-flight' : 'loop-active') +
      ' reason=' + reason
    );
    return;
  }

  if (!mainWindow) {
    throw new Error('sessionReset.hardReset: init({mainWindow, store}) was never called');
  }

  // D-15 step 2 — rolling-window loop detection (D-17 / D-18 unified counter)
  const now = Date.now();
  const recent = resetTimestamps.filter((e) => now - e.t < RESET_WINDOW_MS);
  resetTimestamps.length = 0;
  resetTimestamps.push(...recent, { t: now, reason: reason });
  if (recent.length + 1 >= RESET_LOOP_THRESHOLD) {
    loopActive = true;
    log.error(
      'sessionReset.loop-detected: count=' + (recent.length + 1) +
      ' reasons=' + JSON.stringify(resetTimestamps.map((x) => x.reason))
    );
    try {
      mainWindow.webContents.send('show-magicline-error', { variant: 'reset-loop' });
    } catch (e) {
      log.error('sessionReset.loop-ipc-failed: ' + (e && e.message));
    }
    return;
  }

  log.info(
    'sessionReset.hardReset: reason=' + reason + ' count=' + (recent.length + 1)
  );

  // D-15 step 3 — SET in-flight mutex BEFORE the first await
  let succeeded = false;
  resetting = true;
  try {
    // Step 4 — stop idle timer (lazy require to break circular dep with Plan 04-01)
    require('./idleTimer').stop();

    // Step 5 — tell renderer to show splash overlay.
    // CRITICAL: channel is splash:show (colon-separated — RESEARCH pitfall 3
    // corrects the D-15 typo of the hyphenated form).
    mainWindow.webContents.send('splash:show');

    // Step 6 — destroy the current Magicline child view.
    // Lazy require: magiclineView pulls in Electron `WebContentsView` which
    // is only safe to load inside the electron runtime.
    const { destroyMagiclineView, createMagiclineView } = require('./magiclineView');
    destroyMagiclineView(mainWindow);

    // Step 7 — get the persistent Magicline session partition.
    const sess = session.fromPartition('persist:magicline');

    // Step 8 — clear exactly 6 storage types (D-15). filesystem, shadercache,
    // and websql are deliberately excluded per D-15 / T-04-10 accept.
    await sess.clearStorageData({
      storages: [
        'cookies',
        'localstorage',
        'sessionstorage',
        'serviceworkers',
        'indexdb',
        'cachestorage',
      ],
    });

    // Step 9 — flush cookie DB to disk BEFORE recreating the view so the new
    // view's first navigation sees an empty jar (Assumption A5).
    await sess.cookies.flushStore();

    // Step 10 — recreate Magicline child view; auto-login will follow.
    createMagiclineView(mainWindow, store);
    succeeded = true;
    lastResetAt = Date.now();
  } finally {
    // Step 11 — always clear the mutex, even on throw (T-04-11).
    resetting = false;
  }

  // Phase 5 D-15/D-16: post-reset listener fires ONLY on successful completion
  if (succeeded && postResetListener) {
    try {
      postResetListener();
    } catch (e) {
      log.error('sessionReset.postReset-listener-threw: ' + (e && e.message));
    }
  }
}

// --- Test-only helpers ------------------------------------------------------

function _resetForTests() {
  resetting = false;
  loopActive = false;
  resetTimestamps.length = 0;
  mainWindow = null;
  store      = null;
  postResetListener = null; // Phase 5
  lastResetAt = null;       // Phase 5
}

/**
 * Phase 5 D-03: returns ms-since-epoch of the last successful hardReset,
 * or null if none has completed since boot. Consumed by the admin menu
 * diagnostic header.
 */
function getLastResetAt() {
  return lastResetAt;
}

/**
 * Phase 5 D-15/D-16: register a single post-reset callback.
 * Fires ONLY after a hardReset() completes successfully (not on in-flight
 * or loop-detected short-circuits). Consumed by updateGate.js to gate
 * electron-updater quitAndInstall.
 *
 * @param {(() => void)|null} cb - listener, or null to clear
 */
function onPostReset(cb) {
  postResetListener = (typeof cb === 'function') ? cb : null;
}

function _getStateForTests() {
  return {
    resetting: resetting,
    loopActive: loopActive,
    resetTimestamps: resetTimestamps.slice(),
  };
}

module.exports = {
  init: init,
  hardReset: hardReset,
  onPostReset: onPostReset,   // Phase 5 D-15/D-16
  getLastResetAt: getLastResetAt, // Phase 5 D-03
  _resetForTests: _resetForTests,
  _getStateForTests: _getStateForTests,
  _RESET_WINDOW_MS: RESET_WINDOW_MS,
  _RESET_LOOP_THRESHOLD: RESET_LOOP_THRESHOLD,
};
