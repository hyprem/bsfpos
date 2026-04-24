// test/updateGate.test.js
// Phase 5 Plan 05-03: unit coverage for src/main/updateGate.js safe-window gate.
//
// Pure-module tests — updateGate.js has NO electron coupling, so no require.cache
// stubs needed.

const test = require('node:test');
const assert = require('node:assert');

const gate = require('../src/main/updateGate');

function makeLog() {
  const calls = [];
  return {
    calls,
    audit: (event, fields) => calls.push({ event, fields }),
    error: (msg) => calls.push({ event: 'error', msg }),
  };
}

function makeSessionReset() {
  let listener = null;
  return {
    onPostReset: (cb) => { listener = cb; },
    _fire: () => { if (listener) listener(); },
    _getListener: () => listener,
  };
}

test('isMaintenanceWindow: true only for hours 9, 10, and 11', () => {
  for (let h = 0; h < 24; h++) {
    const actual = gate.isMaintenanceWindow(() => h);
    const expected = (h === 9 || h === 10 || h === 11);
    assert.strictEqual(actual, expected, 'hour=' + h);
  }
});

test('onUpdateDownloaded: emits update.downloaded audit on arm', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installed = 0;
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log,
    sessionResetModule: sr,
    getHour: () => 12,
  });
  const downloaded = log.calls.find(c => c.event === 'update.downloaded');
  assert.ok(downloaded, 'update.downloaded audit missing');
  assert.deepStrictEqual(downloaded.fields, { gateState: 'waiting' });
  assert.strictEqual(installed, 0, 'install must not fire immediately');
  gate._resetForTests();
});

test('onUpdateDownloaded: post-reset trigger fires installFn exactly once', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installed = 0;
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log,
    sessionResetModule: sr,
    getHour: () => 12, // not maintenance window
  });
  sr._fire();  // post-reset fires
  assert.strictEqual(installed, 1);
  const installAudit = log.calls.find(c => c.event === 'update.install');
  assert.ok(installAudit);
  assert.strictEqual(installAudit.fields.trigger, 'post-reset');
  // Second post-reset fire must not re-install
  sr._fire();
  assert.strictEqual(installed, 1, 'second fire must be no-op');
  gate._resetForTests();
});

test('onUpdateDownloaded: maintenance-window trigger fires installFn', () => {
  gate._resetForTests();
  // Monkey-patch setInterval to run synchronously for test determinism
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  let intervalCleared = false;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer'; };
  global.clearInterval = (id) => { if (id === 'fake-timer') intervalCleared = true; };

  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 9, // maintenance window
    });
    assert.strictEqual(installed, 0, 'install must wait for interval tick');
    // Trigger the polled interval manually
    intervalFn();
    assert.strictEqual(installed, 1);
    assert.ok(intervalCleared, 'timer should be cleared after fire');
    const installAudit = log.calls.find(c => c.event === 'update.install');
    assert.strictEqual(installAudit.fields.trigger, 'maintenance-window');
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});

test('onUpdateDownloaded: first trigger wins (post-reset beats maintenance)', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-2'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 9,
    });
    sr._fire(); // post-reset wins
    // Attempting to also fire interval should be no-op
    if (intervalFn) intervalFn();
    assert.strictEqual(installed, 1);
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});

test('onUpdateDownloaded: double-arm clears prior gate', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installedA = 0, installedB = 0;
  gate.onUpdateDownloaded({
    installFn: () => installedA++,
    log, sessionResetModule: sr, getHour: () => 12,
  });
  gate.onUpdateDownloaded({
    installFn: () => installedB++,
    log, sessionResetModule: sr, getHour: () => 12,
  });
  sr._fire();
  assert.strictEqual(installedA, 0, 'first gate should have been cleared');
  assert.strictEqual(installedB, 1, 'second gate should fire');
  gate._resetForTests();
});

test('onUpdateDownloaded: throws clearly on missing args', () => {
  assert.throws(() => gate.onUpdateDownloaded(), /installFn is required/);
  assert.throws(() => gate.onUpdateDownloaded({ installFn: () => {} }), /log\.audit is required/);
  assert.throws(() => gate.onUpdateDownloaded({
    installFn: () => {},
    log: { audit: () => {} },
  }), /sessionResetModule/);
});

// --- Phase 09: getPosOpen / admin-closed-window tests -------------------------

function makeGetPosOpen(value) {
  return function() { return value; };
}

test('admin-closed-window: posOpen=false in window fires trigger', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw1'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 10,
      getPosOpen: makeGetPosOpen(false),
    });
    intervalFn();
    assert.strictEqual(installed, 1);
    const audit = log.calls.find(c => c.event === 'update.install');
    assert.strictEqual(audit.fields.trigger, 'admin-closed-window');
    assert.strictEqual(audit.fields.posOpen, false);
    assert.strictEqual(audit.fields.hour, 10);
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});

test('admin-closed-window: posOpen=false out of window does NOT fire', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw2'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 14,
      getPosOpen: makeGetPosOpen(false),
    });
    intervalFn();
    assert.strictEqual(installed, 0);
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});

test('admin-closed-window: posOpen=true in window falls through to maintenance-window', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw3'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 10,
      getPosOpen: makeGetPosOpen(true),
    });
    intervalFn();
    assert.strictEqual(installed, 1);
    const audit = log.calls.find(c => c.event === 'update.install');
    assert.strictEqual(audit.fields.trigger, 'maintenance-window');
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});

test('first-trigger-wins: admin-closed-window vs post-reset', () => {
  gate._resetForTests();
  const origSetInterval = global.setInterval;
  const origClearInterval = global.clearInterval;
  let intervalFn = null;
  global.setInterval = (fn) => { intervalFn = fn; return 'fake-timer-acw4'; };
  global.clearInterval = () => {};
  try {
    const log = makeLog();
    const sr = makeSessionReset();
    let installed = 0;
    gate.onUpdateDownloaded({
      installFn: () => installed++,
      log,
      sessionResetModule: sr,
      getHour: () => 10,
      getPosOpen: makeGetPosOpen(false),
    });
    // post-reset fires first
    sr._fire();
    // then interval ticks
    intervalFn();
    assert.strictEqual(installed, 1, 'only one install — first trigger wins');
    const audit = log.calls.find(c => c.event === 'update.install');
    assert.strictEqual(audit.fields.trigger, 'post-reset');
  } finally {
    global.setInterval = origSetInterval;
    global.clearInterval = origClearInterval;
    gate._resetForTests();
  }
});

test('onUpdateDownloaded: installFn throw is logged not propagated', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  gate.onUpdateDownloaded({
    installFn: () => { throw new Error('boom'); },
    log, sessionResetModule: sr, getHour: () => 12,
  });
  assert.doesNotThrow(() => sr._fire());
  const errCall = log.calls.find(c => c.event === 'error');
  assert.ok(errCall, 'error should be logged');
  gate._resetForTests();
});

// --- Phase 10 D-18: sale-completed → onPostReset → updateGate composition -----
// SALE-01 success criterion 4 requires the onPostReset hook to fire for
// sale-completed cycles so pending updates install after a sale-driven
// welcome cycle. updateGate.js is NOT modified for Phase 10 — this test
// proves the existing onPostReset single-slot listener composes correctly.
//
// The test is structurally identical to the 'post-reset trigger fires
// installFn exactly once' test — updateGate does not care WHY onPostReset
// fired, only that it fired. The value of this test is documentation:
// readers see sale-completed explicitly covered in the test suite.

test('D-18: sale-completed hardReset → onPostReset → updateGate install composes correctly', () => {
  gate._resetForTests();
  const log = makeLog();
  const sr = makeSessionReset();
  let installed = 0;
  gate.onUpdateDownloaded({
    installFn: () => installed++,
    log,
    sessionResetModule: sr,
    getHour: () => 12, // outside maintenance window — post-reset trigger path wins
  });
  // Simulate: a sale-completed hardReset completes → sessionReset fires its
  // single-slot postResetListener → updateGate's callback (registered via
  // gate.onUpdateDownloaded → sr.onPostReset) fires → installFn invoked once.
  sr._fire();
  assert.strictEqual(installed, 1, 'updateGate must install after sale-completed onPostReset');
  const installAudit = log.calls.find(c => c.event === 'update.install');
  assert.ok(installAudit, 'update.install audit must be emitted');
  // D-18: trigger field value is 'post-reset' — NOT 'sale-completed'. updateGate
  // does not differentiate between onPostReset causes; sale-completed simply
  // uses the same hook as idle-expired.
  assert.strictEqual(installAudit.fields.trigger, 'post-reset');

  // First-trigger-wins: a second post-reset fire (e.g. two sales in a row)
  // does NOT re-install. Phase 05 D-15/D-16 semantics preserved for sale-completed.
  sr._fire();
  assert.strictEqual(installed, 1, 'second post-reset (from a second sale-completed) must be no-op');

  gate._resetForTests();
});
