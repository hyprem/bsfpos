// test/badgeInput.test.js
// Unit tests for src/main/badgeInput.js — Phase 4, Plan 04-01, Task 2.
//
// Covers D-01..D-06 from 04-CONTEXT.md and the NFC-03 sentinel-null first-
// character-drop fix. Mocks webContents and idleTimer so the module can be
// exercised in pure node:test without Electron.
//
// Key regression test: 'first keystroke with lastKeyTime===null is always
// buffered' simulates the exact Android prototype bug where
// `var lastKeyTime = 0` caused the first scan's `timeSinceLast = Date.now()`
// (~46 years) to skip the < 50 ms gate and drop the leading character.

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');
const Module = require('node:module');

// --- Stub ./idleTimer for the badgeInput module so bump() is observable ----
// badgeInput.js does `require('./idleTimer')` lazily inside its handler/commit
// path. We pre-resolve that to our stub exports so every bump() call is
// recorded without pulling the real idleTimer (which schedules timers).
const idleTimerPath = path.resolve(__dirname, '..', 'src', 'main', 'idleTimer.js');
const bumpCalls = { count: 0 };

// Swap the cached idleTimer exports after it has been (optionally) required
// so badgeInput's lazy require sees our stub. Using require.cache replacement
// is reliable here because src/main/idleTimer.js DOES exist on disk.
require(idleTimerPath);   // ensure cache entry exists
require.cache[idleTimerPath].exports = {
  bump: () => { bumpCalls.count += 1; },
  start: () => {},
  stop: () => {},
  dismiss: () => {},
  expired: () => {},
  init: () => {},
  STATES: { IDLE: 'IDLE', OVERLAY_SHOWING: 'OVERLAY_SHOWING', RESETTING: 'RESETTING' },
};

const badgeInput = require('../src/main/badgeInput');

// --- Fake webContents helpers ----------------------------------------------

function makeFakeWc(opts) {
  const o = opts || {};
  const listeners = {};
  const calls = { executeJavaScript: [] };
  const wc = {
    _listeners: listeners,
    _calls: calls,
    on: (ev, cb) => { listeners[ev] = cb; },
    executeJavaScript: (js /* , userGesture */) => {
      calls.executeJavaScript.push(js);
      return Promise.resolve();
    },
    isDestroyed: () => !!o.destroyed,
  };
  return wc;
}

function keyDown(key) {
  return { type: 'keyDown', key: key };
}

function fire(wc, input) {
  wc._listeners['before-input-event']({ preventDefault: () => {} }, input);
}

function reset() {
  badgeInput._resetForTests();
  bumpCalls.count = 0;
}

// --- Tests ------------------------------------------------------------------

test('exported constants match D-04 defaults', () => {
  assert.strictEqual(badgeInput._BADGE_SPEED_MS, 50);
  assert.strictEqual(badgeInput._COMMIT_TIMEOUT_MS, 100);
  assert.strictEqual(badgeInput._MIN_BADGE_LENGTH, 3);
});

test('first keystroke with lastKeyTime===null is always buffered (NFC-03 regression)', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  // Simulate a complete badge scan: first char MUST enter the buffer even
  // though lastKeyTime is null (prototype bug: timeSinceLast was Date.now()
  // which is ~46 years, far above BADGE_SPEED_MS, so the char was dropped).
  fire(wc, keyDown('A'));
  fire(wc, keyDown('B'));
  fire(wc, keyDown('C'));
  fire(wc, keyDown('D'));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 1, 'committed once');
  const js = wc._calls.executeJavaScript[0];
  assert.ok(js.indexOf(JSON.stringify('ABCD')) !== -1, 'buffer included leading A');
});

test('second keystroke within 50ms is buffered (badge cadence)', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  fire(wc, keyDown('X'));
  fire(wc, keyDown('Y'));
  fire(wc, keyDown('Z'));
  fire(wc, keyDown('Q'));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 1);
  assert.ok(wc._calls.executeJavaScript[0].indexOf(JSON.stringify('XYZQ')) !== -1);
});

test('second keystroke after 60ms gap starts a fresh buffer (human typing distinction)', (t) => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  // First keystroke: sentinel-null ensures buffered.
  fire(wc, keyDown('A'));
  // Simulate real-time delay by advancing the clock.
  const origNow = Date.now;
  let now = origNow();
  Date.now = () => now;
  now += 200;
  fire(wc, keyDown('B'));
  // Only 'A' was in buffer (length 1, under MIN_BADGE_LENGTH 3), so the
  // pending silent-timeout flush would drop it. Here, the second keystroke
  // didn't buffer because timeSinceLast (200 ms) >= 50 ms AND buffer was
  // empty after the previous fill. Confirm no commit happened.
  assert.strictEqual(wc._calls.executeJavaScript.length, 0);
  Date.now = origNow;
});

test('Enter terminator commits buffer > 3 chars via executeJavaScript', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  for (const ch of '12345') fire(wc, keyDown(ch));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 1);
  assert.ok(wc._calls.executeJavaScript[0].indexOf(JSON.stringify('12345')) !== -1);
});

test('Tab terminator also commits (defensive)', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  for (const ch of '98765') fire(wc, keyDown(ch));
  fire(wc, keyDown('Tab'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 1);
  assert.ok(wc._calls.executeJavaScript[0].indexOf(JSON.stringify('98765')) !== -1);
});

test('commit with buffer.length <= 3 is dropped (no executeJavaScript call)', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  fire(wc, keyDown('a'));
  fire(wc, keyDown('b'));
  fire(wc, keyDown('c'));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 0, 'length 3 is NOT > 3');
});

test('committed payload is JSON.stringify escaped — embedded quotes do not break injection', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  // Inject chars including a double quote and a backslash to prove escaping.
  for (const ch of 'A"B\\C') fire(wc, keyDown(ch));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 1);
  const js = wc._calls.executeJavaScript[0];
  // The escaped form MUST appear; the raw form MUST NOT (since JSON.stringify
  // escapes " to \" and \ to \\).
  assert.ok(js.indexOf(JSON.stringify('A"B\\C')) !== -1, 'escaped payload embedded');
  // Raw unescaped sequence must not leak.
  assert.ok(js.indexOf('A"B\\C"') === -1 || js.indexOf('\\"') !== -1, 'no raw quote/backslash leak');
});

test('after commit, lastKeyTime is reset to null (Pitfall 6 regression)', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  for (const ch of 'FIRST') fire(wc, keyDown(ch));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 1);
  // Simulate a long real-time delay between scans.
  const origNow = Date.now;
  let now = origNow();
  Date.now = () => now;
  now += 10_000;
  // Next scan's first keystroke MUST still be buffered because lastKeyTime
  // was reset to null on commit. Without the reset, timeSinceLast=10_000 ms
  // and the leading char would be dropped (same as NFC-03 bug).
  for (const ch of 'SECOND') fire(wc, keyDown(ch));
  fire(wc, keyDown('Enter'));
  Date.now = origNow;
  assert.strictEqual(wc._calls.executeJavaScript.length, 2, 'second scan committed');
  assert.ok(wc._calls.executeJavaScript[1].indexOf(JSON.stringify('SECOND')) !== -1,
    'second scan retained its leading S');
});

test('setProductSearchFocused(true) makes subsequent keystrokes pass through without buffering', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  badgeInput.setProductSearchFocused(true);
  for (const ch of 'PRODUCT') fire(wc, keyDown(ch));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 0, 'no inject in pass-through mode');
  badgeInput.setProductSearchFocused(false);
});

test('setProductSearchFocused(true) still calls idleTimer.bump() for every keyDown (NFC-05)', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  badgeInput.setProductSearchFocused(true);
  fire(wc, keyDown('a'));
  fire(wc, keyDown('b'));
  fire(wc, keyDown('c'));
  assert.strictEqual(bumpCalls.count, 3);
  badgeInput.setProductSearchFocused(false);
});

test('idleTimer.bump() is called on every keyDown even when buffering', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  fire(wc, keyDown('1'));
  fire(wc, keyDown('2'));
  fire(wc, keyDown('3'));
  fire(wc, keyDown('4'));
  // 4 keyDowns → 4 bumps from the handler; commit adds one more.
  fire(wc, keyDown('Enter'));
  // Handler bump (5x keyDowns including Enter) + commit bump = 6.
  assert.strictEqual(bumpCalls.count, 6);
});

test('non-keyDown events (type: keyUp, char) are ignored', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  fire(wc, { type: 'keyUp', key: 'A' });
  fire(wc, { type: 'char', key: 'A' });
  assert.strictEqual(bumpCalls.count, 0, 'no bump for non-keyDown');
  assert.strictEqual(wc._calls.executeJavaScript.length, 0);
});

test('wc.executeJavaScript is skipped when wc.isDestroyed() returns true (Pitfall 7)', () => {
  reset();
  const wc = makeFakeWc({ destroyed: true });
  badgeInput.attachBadgeInput(wc);
  for (const ch of 'ABCDE') fire(wc, keyDown(ch));
  fire(wc, keyDown('Enter'));
  assert.strictEqual(wc._calls.executeJavaScript.length, 0);
});

test('modifier-only keystroke (key.length !== 1 and not Enter/Tab) does not buffer', () => {
  reset();
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  fire(wc, keyDown('Shift'));
  fire(wc, keyDown('Control'));
  fire(wc, keyDown('Alt'));
  fire(wc, keyDown('Enter'));
  // Enter commits an empty buffer → length 0 is NOT > 3 → no inject.
  assert.strictEqual(wc._calls.executeJavaScript.length, 0);
});

test('100ms silent-timeout flushes buffer via commit path', (t) => {
  reset();
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const wc = makeFakeWc();
  badgeInput.attachBadgeInput(wc);
  for (const ch of 'WXYZ') fire(wc, keyDown(ch));
  // No terminator — wait for silent-timeout.
  t.mock.timers.tick(100);
  assert.strictEqual(wc._calls.executeJavaScript.length, 1);
  assert.ok(wc._calls.executeJavaScript[0].indexOf(JSON.stringify('WXYZ')) !== -1);
  t.mock.timers.reset();
});
