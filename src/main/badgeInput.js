// src/main/badgeInput.js
// Phase 4, Plan 04-01, Task 2 — NFC badge capture state machine.
// [VERIFIED: D-01..D-06 from 04-CONTEXT.md, Patterns 2+3 from 04-RESEARCH.md]
//
// Owns a single shared buffer across any webContents that attach. The NFC
// reader is a USB HID keyboard wedge; its keystrokes arrive as
// before-input-event on whichever wc has focus. We coalesce sub-50ms bursts
// into a single commit and inject via window.__bskiosk_setMuiValue.
//
// NFC-03 sentinel-null fix (D-03): the Android prototype used
// `var lastKeyTime = 0` which made the first scan's timeSinceLast be
// Date.now() (~46 years), bypassing the 50 ms gate and dropping the leading
// character. We use `null` as the sentinel and special-case it to 0 so the
// first keystroke is always buffered.
//
// NFC-05: every keyDown calls idleTimer.bump() before buffer/pass-through
// decision — ANY key activity resets the idle countdown, including product
// search typing.
//
// NFC-06: when productSearchFocused is true, keystrokes pass through without
// buffering so the Magicline product search field receives raw input. bump()
// still fires (NFC-05).
//
// Pitfall 6: lastKeyTime MUST be reset to null on commit, otherwise the next
// scan's first keystroke re-enters the NFC-03 bug.
//
// Pitfall 7: wc.executeJavaScript must skip when wc.isDestroyed() — otherwise
// a post-reset commit throws.
//
// Security (T-04-01): committed payload is interpolated via JSON.stringify so
// embedded quotes/backslashes cannot break out of the JS string literal.
//
// Security (T-04-03): log line only emits length=N, never committed content.
//
// No side effects at require time — attachBadgeInput(wc) registers the
// listener, nothing happens until the reader sends a key.

const log = require('./logger');

const BADGE_SPEED_MS    = 50;    // D-04 default (tunable via electron-store key
                                 // nfcBadgeSpeedMs in Plan 03)
const COMMIT_TIMEOUT_MS = 100;   // D-04 silent-timeout flush
const MIN_BADGE_LENGTH  = 3;     // D-04 length gate — buffer.length > 3 commits

// Module-scoped shared state (D-01: single shared buffer, NOT per-wc).
let buffer = '';
let lastKeyTime = null;          // SENTINEL — D-03 NFC-03 fix
let bufferTimer = null;
let productSearchFocused = false;

function commitBuffer(wc) {
  clearTimeout(bufferTimer);
  bufferTimer = null;

  const committed = buffer;
  buffer = '';
  lastKeyTime = null;            // Pitfall 6 reset — next scan must re-enter sentinel path

  if (committed.length <= MIN_BADGE_LENGTH) return;

  // Phase 5 D-27 / D-25: `badge` field name → BADGE_FIELDS redactor in
  // logger.js → sha256(0,8) prefix. Raw badge string never hits disk.
  log.audit('badge.scanned', { badge: committed, length: committed.length });

  if (wc.isDestroyed()) return;  // Pitfall 7

  require('./idleTimer').bump();

  wc.executeJavaScript(
    'if(window.__bskiosk_setMuiValue){' +
    'var _in=document.querySelector(\'[data-role="customer-search"] input\');' +
    'if(_in)window.__bskiosk_setMuiValue(_in,' + JSON.stringify(committed) + ');}',
    true
  ).catch((e) => log.warn('badgeInput.inject failed: ' + (e && e.message)));
}

function attachBadgeInput(wc) {
  wc.on('before-input-event', (_event, input) => {
    if (input.type !== 'keyDown') return;

    // NFC-05: every keyDown is activity — bump BEFORE the pass-through gate
    // so productSearchFocused keystrokes still reset the idle countdown.
    require('./idleTimer').bump();

    // NFC-06: pass-through when product search owns the keyboard.
    if (productSearchFocused) return;

    const key = input.key;
    const now = Date.now();
    const timeSinceLast = lastKeyTime === null ? 0 : (now - lastKeyTime);  // D-03 sentinel
    lastKeyTime = now;

    if (key === 'Enter' || key === 'Tab') {
      commitBuffer(wc);
      return;
    }

    // Filter modifier-only keystrokes (Shift, Control, Alt, ArrowDown, ...).
    if (key.length !== 1) return;

    clearTimeout(bufferTimer);

    // Admit to buffer only if we're inside a burst (either the sentinel-null
    // first char, a within-50ms continuation, or already-buffering mid-scan).
    if (timeSinceLast < BADGE_SPEED_MS || buffer.length > 0) {
      buffer += key;
    }

    bufferTimer = setTimeout(() => commitBuffer(wc), COMMIT_TIMEOUT_MS);
  });
}

function setProductSearchFocused(val) {
  productSearchFocused = !!val;
  log.info('badgeInput.productSearchFocused: ' + productSearchFocused);
}

function _resetForTests() {
  clearTimeout(bufferTimer);
  buffer = '';
  lastKeyTime = null;
  bufferTimer = null;
  productSearchFocused = false;
}

module.exports = {
  attachBadgeInput,
  setProductSearchFocused,
  _resetForTests,
  _BADGE_SPEED_MS: BADGE_SPEED_MS,
  _COMMIT_TIMEOUT_MS: COMMIT_TIMEOUT_MS,
  _MIN_BADGE_LENGTH: MIN_BADGE_LENGTH,
};
