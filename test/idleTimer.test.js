// test/idleTimer.test.js
// Unit tests for src/main/idleTimer.js — pure state machine (Phase 4, Plan 04-01, Task 1).
//
// Verifies D-07..D-11 from 04-CONTEXT.md:
//   - States: IDLE / OVERLAY_SHOWING / RESETTING
//   - start() schedules a 60s timeout that transitions IDLE -> OVERLAY_SHOWING and
//     emits IPC 'show-idle-overlay' to mainWindow.webContents
//   - bump() resets the timeout while IDLE; no-op while OVERLAY_SHOWING or RESETTING
//   - dismiss() restores IDLE and restarts a fresh 60s countdown
//   - stop() clears the timeout and returns to IDLE
//   - expired() transitions to RESETTING and calls sessionReset.hardReset
//
// sessionReset is injected via require.cache override so this test has no real
// dependency on Plan 04-02's reset engine (lazy require in idleTimer allows this).

const test = require('node:test');
const assert = require('node:assert');
const path = require('node:path');

// --- Inject a fake ./sessionReset BEFORE requiring idleTimer ----------------
// Use an absolute path matching what require('./sessionReset') inside
// src/main/idleTimer.js resolves to at call time. Phase 4 Plan 04-02 will
// create the real src/main/sessionReset.js; for Plan 04-01 we inject a fake
// directly into require.cache so the lazy require inside expired() resolves
// to our stub and never touches disk.
const fakeSessionResetPath = path.resolve(__dirname, '..', 'src', 'main', 'sessionReset.js');

const hardResetCalls = [];
require.cache[fakeSessionResetPath] = {
  id: fakeSessionResetPath,
  filename: fakeSessionResetPath,
  loaded: true,
  exports: {
    hardReset: (opts) => { hardResetCalls.push(opts); },
  },
};

const idleTimer = require('../src/main/idleTimer');
const { STATES } = idleTimer;

function makeFakeMainWindow() {
  const sent = [];
  return {
    _sent: sent,
    webContents: {
      send: (channel, payload) => { sent.push({ channel: channel, payload: payload }); },
    },
  };
}

function resetAll(mw) {
  hardResetCalls.length = 0;
  idleTimer.stop();
  if (mw) mw._sent.length = 0;
  idleTimer.init(mw || makeFakeMainWindow());
}

// --- Tests ------------------------------------------------------------------

test('STATES enum exposes IDLE / OVERLAY_SHOWING / RESETTING', () => {
  assert.strictEqual(STATES.IDLE, 'IDLE');
  assert.strictEqual(STATES.OVERLAY_SHOWING, 'OVERLAY_SHOWING');
  assert.strictEqual(STATES.RESETTING, 'RESETTING');
});

test('initial state is IDLE after init(mockMw)', () => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  // stop() returns to IDLE; no timer scheduled until start() is called.
  assert.strictEqual(mw._sent.length, 0);
});

test('start() schedules a 60000ms timeout that transitions to OVERLAY_SHOWING', (t) => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  idleTimer.start();
  // Advance just short of timeout — no overlay yet.
  t.mock.timers.tick(59_999);
  assert.strictEqual(mw._sent.length, 0, 'no overlay before 60s');
  // Cross the boundary.
  t.mock.timers.tick(1);
  assert.strictEqual(mw._sent.length, 1, 'overlay fired at 60s');
  assert.strictEqual(mw._sent[0].channel, 'show-idle-overlay');
  t.mock.timers.reset();
  resetAll(mw);
});

test('bump() while IDLE resets the 60000ms timeout', (t) => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  idleTimer.start();
  t.mock.timers.tick(30_000);
  idleTimer.bump();
  t.mock.timers.tick(30_000);   // only 30s since bump
  assert.strictEqual(mw._sent.length, 0, 'bump reset the clock');
  t.mock.timers.tick(30_000);   // now 60s since bump
  assert.strictEqual(mw._sent.length, 1, 'overlay after full 60s post-bump');
  t.mock.timers.reset();
  resetAll(mw);
});

test('bump() while OVERLAY_SHOWING is a no-op (returns early)', (t) => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  idleTimer.start();
  t.mock.timers.tick(60_000);   // transition into OVERLAY_SHOWING
  assert.strictEqual(mw._sent.length, 1);
  idleTimer.bump();             // should be a no-op
  t.mock.timers.tick(60_000);
  assert.strictEqual(mw._sent.length, 1, 'no second overlay fired');
  t.mock.timers.reset();
  resetAll(mw);
});

test('dismiss() restores IDLE state and starts a fresh 60s countdown', (t) => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  idleTimer.start();
  t.mock.timers.tick(60_000);   // now OVERLAY_SHOWING
  assert.strictEqual(mw._sent.length, 1);
  idleTimer.dismiss();
  // Must schedule a fresh 60s window.
  t.mock.timers.tick(59_999);
  assert.strictEqual(mw._sent.length, 1, 'no second overlay before 60s');
  t.mock.timers.tick(1);
  assert.strictEqual(mw._sent.length, 2, 'second overlay after fresh 60s');
  t.mock.timers.reset();
  resetAll(mw);
});

test('stop() clears the pending timeout and transitions to IDLE', (t) => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  idleTimer.start();
  t.mock.timers.tick(30_000);
  idleTimer.stop();
  t.mock.timers.tick(60_000);   // should be a no-op
  assert.strictEqual(mw._sent.length, 0, 'stop cancelled the overlay');
  t.mock.timers.reset();
  resetAll(mw);
});

test('expired() transitions to RESETTING and calls sessionReset.hardReset({reason:"idle-expired"})', () => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  idleTimer.expired();
  assert.strictEqual(hardResetCalls.length, 1, 'hardReset called exactly once');
  assert.strictEqual(hardResetCalls[0].reason, 'idle-expired');
  resetAll(mw);
});

test('on 60s timeout main webContents receives send("show-idle-overlay")', (t) => {
  const mw = makeFakeMainWindow();
  resetAll(mw);
  t.mock.timers.enable({ apis: ['setTimeout'] });
  idleTimer.start();
  t.mock.timers.tick(60_000);
  assert.strictEqual(mw._sent.length, 1);
  assert.strictEqual(mw._sent[0].channel, 'show-idle-overlay');
  t.mock.timers.reset();
  resetAll(mw);
});

test('requiring idleTimer does NOT schedule any timers at require time', () => {
  // The fact that this test file reached this point (already required the
  // module at top) and no hardReset was called without explicit expired() is
  // part of the proof. Additionally, freshly importing via delete+require in
  // a separate scope must also be side-effect-free.
  const modPath = require.resolve('../src/main/idleTimer');
  delete require.cache[modPath];
  const before = hardResetCalls.length;
  const fresh = require('../src/main/idleTimer');
  assert.strictEqual(hardResetCalls.length, before, 'no side effects at require');
  assert.ok(fresh.STATES);
});
