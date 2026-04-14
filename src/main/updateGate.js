// src/main/updateGate.js
// Phase 5 ADMIN-07 / CONTEXT.md D-15, D-16, D-17
//
// Safe-window gate for electron-updater quitAndInstall. Consumes:
//   (a) Phase 4 sessionReset post-reset event — Phase 5's "clean slate" signal
//   (b) Clock-based 09:00–12:00 maintenance window
// Whichever fires first after update-downloaded wins; the other is cleared.
//
// NO direct electron import. installFn is dependency-injected so this module
// is pure-testable with fake clock/fake emitter.

const MAINTENANCE_POLL_MS = 60_000; // check the clock once per minute
const MAINTENANCE_HOUR_START = 9;   // 09:00 inclusive
const MAINTENANCE_HOUR_END   = 12;  // 12:00 exclusive → hours 9, 10, 11

// --- Module-scoped gate state ----------------------------------------------
let maintenanceTimer = null;
let postResetArmed  = false;
let fired           = false;

function isMaintenanceWindow(getHour) {
  const h = (typeof getHour === 'function') ? getHour() : new Date().getHours();
  return h >= MAINTENANCE_HOUR_START && h < MAINTENANCE_HOUR_END;
}

function clearGate() {
  if (maintenanceTimer) {
    clearInterval(maintenanceTimer);
    maintenanceTimer = null;
  }
  postResetArmed = false;
}

/**
 * Arm the gate after electron-updater's update-downloaded event.
 *
 * @param {object} opts
 * @param {() => void} opts.installFn
 * @param {{audit: Function, error?: Function}} opts.log
 * @param {{onPostReset: Function}} opts.sessionResetModule
 * @param {(() => number)=} opts.getHour - test hook
 */
function onUpdateDownloaded(opts) {
  if (!opts || typeof opts.installFn !== 'function') {
    throw new Error('updateGate.onUpdateDownloaded: installFn is required');
  }
  if (!opts.log || typeof opts.log.audit !== 'function') {
    throw new Error('updateGate.onUpdateDownloaded: log.audit is required');
  }
  if (!opts.sessionResetModule || typeof opts.sessionResetModule.onPostReset !== 'function') {
    throw new Error('updateGate.onUpdateDownloaded: sessionResetModule.onPostReset is required');
  }

  // If a prior gate was armed and never fired, clear it first (D-17: admin
  // menu re-check during a waiting gate should not leak timers).
  clearGate();
  fired = false;

  const { installFn, log, sessionResetModule, getHour } = opts;

  log.audit('update.downloaded', { gateState: 'waiting' });

  function fireWith(trigger) {
    if (fired) return;
    fired = true;
    clearGate();
    // Explicitly unregister the post-reset listener so a subsequent reset
    // doesn't re-trigger anything.
    try { sessionResetModule.onPostReset(null); } catch (_) { /* ignore */ }
    log.audit('update.install', { trigger: trigger });
    try {
      installFn();
    } catch (e) {
      if (log.error) log.error('updateGate.installFn-threw: ' + (e && e.message));
    }
  }

  // Arm (a): maintenance-window polling
  maintenanceTimer = setInterval(() => {
    if (isMaintenanceWindow(getHour)) {
      fireWith('maintenance-window');
    }
  }, MAINTENANCE_POLL_MS);

  // Arm (b): one-shot post-reset listener via sessionReset
  postResetArmed = true;
  sessionResetModule.onPostReset(() => {
    if (!postResetArmed) return; // defensive — already cleared
    fireWith('post-reset');
  });
}

function _resetForTests() {
  clearGate();
  fired = false;
}

function _isArmedForTests() {
  return { maintenanceTimerSet: maintenanceTimer !== null, postResetArmed: postResetArmed, fired: fired };
}

module.exports = {
  onUpdateDownloaded: onUpdateDownloaded,
  isMaintenanceWindow: isMaintenanceWindow,
  _resetForTests: _resetForTests,
  _isArmedForTests: _isArmedForTests,
  _MAINTENANCE_POLL_MS: MAINTENANCE_POLL_MS,
  _MAINTENANCE_HOUR_START: MAINTENANCE_HOUR_START,
  _MAINTENANCE_HOUR_END: MAINTENANCE_HOUR_END,
};
