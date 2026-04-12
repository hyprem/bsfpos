// src/main/idleTimer.js
// Phase 4, Plan 04-01, Task 1 — pure idle state machine.
// [VERIFIED: D-07..D-12 from 04-CONTEXT.md, Pattern 9 from 04-RESEARCH.md]
//
// States: IDLE / OVERLAY_SHOWING / RESETTING.
// Exports: init(mw), start(), stop(), bump(), dismiss(), expired(), STATES.
//
// Side-effect contract:
//   - On 60s timeout (IDLE -> OVERLAY_SHOWING): send 'show-idle-overlay' IPC to
//     mainWindow.webContents. host.js owns the 30s countdown per D-11.
//   - On expired() (OVERLAY_SHOWING -> RESETTING): call sessionReset.hardReset
//     with { reason: 'idle-expired' }. Lazy require to avoid circular dep and
//     to allow Plan 04-01 to ship before Plan 04-02's reset engine exists.
//
// Logging contract: every state transition emits exactly one log.info line in
// the format `idleTimer.state: <from> -> <to> reason=<reason>` so Phase 5's
// audit parser can grep for them.
//
// IMPORTANT: this module has ZERO side effects at require time. No timer is
// scheduled until start() is called from authFlow's CASH_REGISTER_READY
// start-idle-timer side-effect (D-08, wired in Plan 04-03).

const log = require('./logger');

const IDLE_TIMEOUT_MS    = 60_000;   // NFC-01 / IDLE-01: 60s of no input
const OVERLAY_TIMEOUT_MS = 30_000;   // IDLE-01: 30s host.js countdown (exported
                                     // for reference; host owns the countdown)

const STATES = Object.freeze({
  IDLE: 'IDLE',
  OVERLAY_SHOWING: 'OVERLAY_SHOWING',
  RESETTING: 'RESETTING',
});

let state = STATES.IDLE;
let idleTimerHandle = null;
let mainWindow = null;

function init(mw) {
  mainWindow = mw;
}

function onTimeout() {
  log.info('idleTimer.state: IDLE -> OVERLAY_SHOWING reason=timeout');
  state = STATES.OVERLAY_SHOWING;
  if (!mainWindow || !mainWindow.webContents) return;
  // Pitfall 7 — guard against destroyed wc when the fake mw doesn't expose it.
  if (typeof mainWindow.webContents.isDestroyed === 'function'
      && mainWindow.webContents.isDestroyed()) return;
  try {
    const { setMagiclineViewVisible } = require('./magiclineView');
    setMagiclineViewVisible(false);
  } catch (_) {}
  try {
    mainWindow.webContents.send('show-idle-overlay');
  } catch (e) {
    log.warn('idleTimer.send failed: ' + (e && e.message));
  }
}

function start() {
  log.info('idleTimer.state: ' + state + ' -> IDLE reason=start');
  state = STATES.IDLE;
  clearTimeout(idleTimerHandle);
  idleTimerHandle = setTimeout(onTimeout, IDLE_TIMEOUT_MS);
}

function stop() {
  clearTimeout(idleTimerHandle);
  idleTimerHandle = null;
  log.info('idleTimer.state: ' + state + ' -> IDLE reason=stop');
  state = STATES.IDLE;
}

function bump() {
  if (state !== STATES.IDLE) return;
  clearTimeout(idleTimerHandle);
  idleTimerHandle = setTimeout(onTimeout, IDLE_TIMEOUT_MS);
}

function dismiss() {
  log.info('idleTimer.state: OVERLAY_SHOWING -> IDLE reason=dismissed');
  state = STATES.IDLE;
  try {
    const { setMagiclineViewVisible } = require('./magiclineView');
    setMagiclineViewVisible(true);
  } catch (_) {}
  start();   // fresh 60s countdown
}

function expired() {
  log.info('idleTimer.state: OVERLAY_SHOWING -> RESETTING reason=expired');
  state = STATES.RESETTING;
  // Lazy require — breaks circular dep (sessionReset will call stop() in Plan 04-02)
  // and allows Plan 04-01 to ship before src/main/sessionReset.js exists in tree.
  require('./sessionReset').hardReset({ reason: 'idle-expired' });
}

module.exports = {
  init,
  start,
  stop,
  bump,
  dismiss,
  expired,
  STATES,
  _IDLE_TIMEOUT_MS: IDLE_TIMEOUT_MS,
  _OVERLAY_TIMEOUT_MS: OVERLAY_TIMEOUT_MS,
};
