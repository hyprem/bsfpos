// test/sessionReset.welcome-harness.test.js
// Phase 6 Plan 06-04 — 5-cycle welcome-mode hardReset harness.
//
// Mirrors the Phase 4 100-cycle sessionReset harness pattern at smaller scale,
// exercising the welcome branch (D-05 / D-06 / D-07) end-to-end across multiple
// consecutive cycles. Asserts:
//
//   1. Every cycle calls clearStorageData with the full 6-storage set
//      including 'localstorage' (D-07).
//   2. Every cycle destroys the Magicline view exactly once and NEVER recreates
//      it — the view stays destroyed until the next welcome:tap (D-05).
//   3. Every cycle emits a welcome:show IPC on mainWindow.webContents.send.
//   4. After 5 cycles, loopActive stays false (D-06 — welcome-idle-expired
//      resets are excluded from the 3-in-60s loop counter, verified at scale).
//   5. Every resetTimestamps entry carries mode === 'welcome' and
//      reason === 'idle-expired'.
//   6. Pre-reset and post-reset listeners fire exactly 5 times each (once per
//      cycle, for welcome mode).
//
// Mocking strategy matches test/sessionReset.test.js — require.cache overrides
// for 'electron', './magiclineView', './idleTimer', and './logger' BEFORE the
// first require of sessionReset. Node's test runner executes each test file in
// its own process so this file's cache overrides do not conflict with
// test/sessionReset.test.js running in parallel.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// -----------------------------------------------------------------------------
// Install mocks BEFORE requiring sessionReset
// -----------------------------------------------------------------------------

let callLog = [];
function resetCallLog() { callLog = []; }

// Fake electron.session
const fakeSession = {
  fromPartition: (partition) => {
    callLog.push(['session.fromPartition', partition]);
    return {
      clearStorageData: async (opts) => {
        callLog.push(['clearStorageData', opts]);
      },
      cookies: {
        // welcome path does NOT call get/set — if it ever does, this will throw
        // and fail the test loudly.
        flushStore: async () => {
          callLog.push(['flushStore']);
        },
      },
    };
  },
};

require.cache.electron = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: { session: fakeSession },
};
try {
  const electronResolved = require.resolve('electron');
  require.cache[electronResolved] = require.cache.electron;
} catch (_e) { /* electron unresolvable outside the electron runtime — fine */ }

// Fake logger
const fakeLog = {
  _lines: { info: [], warn: [], error: [], audit: [] },
  info:  (m) => fakeLog._lines.info.push(m),
  warn:  (m) => fakeLog._lines.warn.push(m),
  error: (m) => fakeLog._lines.error.push(m),
  audit: (event, fields) => {
    fakeLog._lines.audit.push({ event: event, fields: (fields || {}) });
  },
};
const loggerPath = require.resolve('../src/main/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: fakeLog,
};

// Fake magiclineView
const magiclineViewPath = require.resolve('../src/main/magiclineView');
require.cache[magiclineViewPath] = {
  id: magiclineViewPath,
  filename: magiclineViewPath,
  loaded: true,
  exports: {
    destroyMagiclineView: () => { callLog.push(['destroyMagiclineView']); },
    createMagiclineView:  () => { callLog.push(['createMagiclineView']); },
  },
};

// Fake idleTimer via virtual-path hook (module does not exist standalone on
// the main-process require graph the harness walks, identical to the pattern
// in test/sessionReset.test.js).
const Module = require('module');
const VIRTUAL_IDLE_TIMER = path.join(path.dirname(magiclineViewPath), '__virtual_idleTimer.js');
require.cache[VIRTUAL_IDLE_TIMER] = {
  id: VIRTUAL_IDLE_TIMER,
  filename: VIRTUAL_IDLE_TIMER,
  loaded: true,
  exports: {
    stop: () => { callLog.push(['idleTimer.stop']); },
  },
};
const origResolve = Module._resolveFilename;
Module._resolveFilename = function (request, parent, ...rest) {
  if (request === './idleTimer' && parent && parent.filename &&
      parent.filename.endsWith('sessionReset.js')) {
    return VIRTUAL_IDLE_TIMER;
  }
  return origResolve.call(this, request, parent, ...rest);
};

// Now require the module under test.
const sessionReset = require('../src/main/sessionReset');

// -----------------------------------------------------------------------------
// Helpers
// -----------------------------------------------------------------------------

function makeFakeMainWindow() {
  return {
    webContents: {
      send: (channel, payload) => {
        callLog.push(['ipc', channel, payload]);
      },
    },
  };
}

function resetAll() {
  sessionReset._resetForTests();
  resetCallLog();
  fakeLog._lines.info.length  = 0;
  fakeLog._lines.warn.length  = 0;
  fakeLog._lines.error.length = 0;
  fakeLog._lines.audit.length = 0;
}

const EXPECTED_WELCOME_STORAGES = [
  'cachestorage',
  'cookies',
  'indexdb',
  'localstorage',
  'serviceworkers',
  'sessionstorage',
];

// -----------------------------------------------------------------------------
// Test: 5-cycle welcome-mode harness
// -----------------------------------------------------------------------------

test('Phase 6: survives 5 consecutive welcome-mode resets without tripping loop guard', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => {}, set: () => {} } });

  let preFired  = 0;
  let postFired = 0;
  sessionReset.onPreReset(() => { preFired++; });
  sessionReset.onPostReset(() => { postFired++; });

  for (let i = 0; i < 5; i++) {
    await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  }

  // --- Assertion 1: every cycle calls clearStorageData with the full 6-set ---
  const clearCalls = callLog.filter((e) => e[0] === 'clearStorageData');
  assert.strictEqual(
    clearCalls.length, 5,
    'clearStorageData must be called exactly 5 times (once per cycle)'
  );
  for (let i = 0; i < clearCalls.length; i++) {
    const storages = clearCalls[i][1].storages.slice().sort();
    assert.deepStrictEqual(
      storages, EXPECTED_WELCOME_STORAGES,
      'cycle ' + (i + 1) + ' must clear all 6 storages including localstorage'
    );
    assert.strictEqual(
      clearCalls[i][1].storages.length, 6,
      'cycle ' + (i + 1) + ' storages length must be 6'
    );
    assert.ok(
      clearCalls[i][1].storages.indexOf('localstorage') !== -1,
      'cycle ' + (i + 1) + ' must include localstorage (D-07)'
    );
  }

  // --- Assertion 2: view destroyed every cycle, NEVER recreated -------------
  const destroyCount = callLog.filter((e) => e[0] === 'destroyMagiclineView').length;
  const createCount  = callLog.filter((e) => e[0] === 'createMagiclineView').length;
  assert.strictEqual(destroyCount, 5, 'destroyMagiclineView must fire exactly 5 times');
  assert.strictEqual(createCount,  0, 'createMagiclineView must NEVER fire in welcome mode');

  // --- Assertion 3: welcome:show IPC emitted every cycle --------------------
  const welcomeShowCalls = callLog.filter(
    (e) => e[0] === 'ipc' && e[1] === 'welcome:show'
  );
  assert.strictEqual(
    welcomeShowCalls.length, 5,
    'welcome:show IPC must be emitted exactly 5 times (once per cycle)'
  );

  // --- Assertion 4: loopActive stays false after 5 cycles (D-06 at scale) ---
  const st = sessionReset._getStateForTests();
  assert.strictEqual(
    st.loopActive, false,
    'loopActive must stay false across 5 welcome-idle-expired resets (D-06)'
  );

  // --- Assertion 5: resetTimestamps length ≤ 5 + all entries welcome mode ---
  assert.ok(
    st.resetTimestamps.length <= 5,
    'resetTimestamps length must be ≤ 5; got ' + st.resetTimestamps.length
  );
  // We pushed 5 within the same rolling 60s window, so we expect exactly 5.
  assert.strictEqual(
    st.resetTimestamps.length, 5,
    'all 5 cycles should still sit in the rolling 60s window'
  );
  for (let i = 0; i < st.resetTimestamps.length; i++) {
    const entry = st.resetTimestamps[i];
    assert.strictEqual(
      entry.mode, 'welcome',
      'resetTimestamps[' + i + '].mode must be "welcome"'
    );
    assert.strictEqual(
      entry.reason, 'idle-expired',
      'resetTimestamps[' + i + '].reason must be "idle-expired"'
    );
    assert.strictEqual(
      typeof entry.t, 'number',
      'resetTimestamps[' + i + '].t must be a number'
    );
  }

  // --- Assertion 6: pre/post listeners fired exactly 5 times each -----------
  assert.strictEqual(
    preFired, 5,
    'pre-reset listener must fire exactly once per cycle (expected 5, got ' + preFired + ')'
  );
  assert.strictEqual(
    postFired, 5,
    'post-reset listener must fire exactly once per cycle (expected 5, got ' + postFired + ')'
  );

  // --- Additional invariant: every cycle audited as idle.reset mode=welcome -
  const welcomeAudits = fakeLog._lines.audit.filter(
    (e) => e.event === 'idle.reset' && e.fields.mode === 'welcome' && e.fields.reason === 'idle-expired'
  );
  assert.strictEqual(
    welcomeAudits.length, 5,
    'idle.reset audit event must fire once per cycle with mode=welcome'
  );

  // Clean up the module-scoped post-reset listener so other test files run in
  // the same process (unlikely — node --test forks per file — but cheap).
  sessionReset.onPostReset(null);
});
