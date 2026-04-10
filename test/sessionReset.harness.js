// test/sessionReset.harness.js
// -----------------------------------------------------------------------------
// Phase 4 IDLE-04 acceptance harness.
//
// IDLE-04 requirement text literally says "100 repeated reset cycles in a row
// never produce a half-logged-in state." This file is the automated proof of
// that requirement. It drives sessionReset.hardReset() through a literal 100-
// iteration loop (case 1), plus three supporting cases that exercise the
// concurrent-suppression path, the reset-loop guard, and the storages-list
// invariant — every cycle of every case.
//
// Mocking strategy mirrors test/sessionReset.test.js: require.cache overrides
// for 'electron', './magiclineView', './idleTimer', and './logger' are
// installed BEFORE the first require of sessionReset. Each test case calls
// sessionReset._resetForTests() between cycles to wipe module-scoped state.
// -----------------------------------------------------------------------------

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// -----------------------------------------------------------------------------
// Shared call log
// -----------------------------------------------------------------------------

let callLog = [];
function resetCallLog() { callLog = []; }

// Optional delay in clearStorageData to stress-test ordering.
let stressDelayMs = 0;
// Optional promise to control clearStorageData resolution (concurrent case).
let clearGate = null;

// -----------------------------------------------------------------------------
// Fake electron.session
// -----------------------------------------------------------------------------

const fakeSession = {
  fromPartition: (partition) => {
    callLog.push(['session.fromPartition', partition]);
    return {
      clearStorageData: async (opts) => {
        callLog.push(['clearStorageData', opts]);
        if (clearGate) {
          await clearGate;
        } else if (stressDelayMs > 0) {
          await new Promise((r) => setTimeout(r, Math.random() * stressDelayMs));
        }
      },
      cookies: {
        flushStore: async () => {
          callLog.push(['flushStore']);
        },
      },
    };
  },
};

// Install electron mock under the id 'electron' AND the resolved path.
require.cache.electron = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: { session: fakeSession },
};
try {
  const electronResolved = require.resolve('electron');
  require.cache[electronResolved] = require.cache.electron;
} catch (_e) { /* not in electron runtime — fine */ }

// -----------------------------------------------------------------------------
// Fake logger
// -----------------------------------------------------------------------------

const fakeLog = {
  _lines: { info: [], warn: [], error: [] },
  info:  (m) => fakeLog._lines.info.push(m),
  warn:  (m) => fakeLog._lines.warn.push(m),
  error: (m) => fakeLog._lines.error.push(m),
};
const loggerPath = require.resolve('../src/main/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: fakeLog,
};

// -----------------------------------------------------------------------------
// Fake magiclineView
// -----------------------------------------------------------------------------

const magiclineViewPath = require.resolve('../src/main/magiclineView');
require.cache[magiclineViewPath] = {
  id: magiclineViewPath,
  filename: magiclineViewPath,
  loaded: true,
  exports: {
    destroyMagiclineView: (_mw) => { callLog.push(['destroyMagiclineView']); },
    createMagiclineView:  (_mw, _st) => { callLog.push(['createMagiclineView']); },
  },
};

// -----------------------------------------------------------------------------
// Fake idleTimer (virtual-path shim, Plan 04-01 sibling contract stop())
// -----------------------------------------------------------------------------

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

// -----------------------------------------------------------------------------
// Module under test
// -----------------------------------------------------------------------------

const sessionReset = require('../src/main/sessionReset');

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
  stressDelayMs = 0;
  clearGate = null;
}

// Drive Date.now forward between cycles to prevent the rolling window from
// tripping loopActive while we are testing the non-loop happy path.
let fakeNow = 1_000_000;
const origDateNow = Date.now;
function installFakeClock() {
  fakeNow = 1_000_000;
  Date.now = () => fakeNow;
}
function restoreClock() {
  Date.now = origDateNow;
}

// The D-15 observable step order (steps 4..10).
const EXPECTED_STEP_ORDER = [
  'idleTimer.stop',
  'ipc',                 // 'splash:show'
  'destroyMagiclineView',
  'session.fromPartition',
  'clearStorageData',
  'flushStore',
  'createMagiclineView',
];

// -----------------------------------------------------------------------------
// Case 1 — 100 consecutive hardReset cycles complete D-15 step order
// -----------------------------------------------------------------------------

test('IDLE-04 harness: 100 consecutive hardReset cycles complete D-15 step order', async () => {
  resetAll();
  installFakeClock();
  try {
    const mw = makeFakeMainWindow();
    sessionReset.init({ mainWindow: mw, store: { get: () => {} } });

    // Light random delay inside clearStorageData to stress ordering.
    stressDelayMs = 5;

    for (let i = 0; i < 100; i++) {
      resetCallLog();

      await sessionReset.hardReset({ reason: 'idle-expired' });

      const kinds = callLog.map((e) => e[0]);
      assert.deepStrictEqual(
        kinds,
        EXPECTED_STEP_ORDER,
        'cycle ' + i + ' step order must match D-15 (got ' + JSON.stringify(kinds) + ')'
      );

      // Step 5 channel check every cycle.
      const ipc = callLog.find((e) => e[0] === 'ipc');
      assert.strictEqual(ipc[1], 'splash:show', 'cycle ' + i + ' step 5 channel must be splash:show');

      // Mutex must be released every cycle.
      const st = sessionReset._getStateForTests();
      assert.strictEqual(st.resetting, false, 'cycle ' + i + ' resetting must be false');
      assert.strictEqual(st.loopActive, false, 'cycle ' + i + ' loopActive must be false');

      // Advance the rolling window by 70s so the loop guard never trips.
      fakeNow += 70_000;
    }

    // Post-loop sanity: we ran exactly 100 destroy/create pairs cumulatively
    // (well, the last one — callLog is reset every iteration).
    // Side-assertion via cycle count: i hit 100.
  } finally {
    restoreClock();
  }
});

// -----------------------------------------------------------------------------
// Case 2 — concurrent hardReset calls during in-flight suppressed 100x
// -----------------------------------------------------------------------------

test('IDLE-04 harness: 100 concurrent-pair hardReset calls suppress the 2nd every time', async () => {
  resetAll();
  installFakeClock();
  try {
    const mw = makeFakeMainWindow();
    sessionReset.init({ mainWindow: mw, store: {} });

    let pairDestroyTotal = 0;
    let pairCreateTotal  = 0;

    for (let i = 0; i < 100; i++) {
      resetCallLog();
      fakeLog._lines.info.length = 0;

      // Gate clearStorageData so both hardReset calls are in-flight at once.
      let release;
      clearGate = new Promise((r) => { release = r; });

      const p1 = sessionReset.hardReset({ reason: 'idle-expired' });
      // Second call lands while the first is awaiting clearStorageData.
      const p2 = sessionReset.hardReset({ reason: 'idle-expired' });

      // Let the first call progress into its await, then release.
      await Promise.resolve();
      release();
      clearGate = null;
      await Promise.all([p1, p2]);

      const destroyCount = callLog.filter((e) => e[0] === 'destroyMagiclineView').length;
      const createCount  = callLog.filter((e) => e[0] === 'createMagiclineView').length;
      assert.strictEqual(destroyCount, 1, 'pair ' + i + ' expected exactly 1 destroy');
      assert.strictEqual(createCount,  1, 'pair ' + i + ' expected exactly 1 create');

      const suppressed = fakeLog._lines.info.some(
        (l) => l.startsWith('sessionReset.suppressed:') && l.indexOf('in-flight') !== -1
      );
      assert.ok(suppressed, 'pair ' + i + ' expected in-flight suppression log');

      pairDestroyTotal += destroyCount;
      pairCreateTotal  += createCount;

      // Advance window so this cycle does not accumulate toward loop guard.
      fakeNow += 70_000;
    }

    assert.strictEqual(pairDestroyTotal, 100, 'total destroys across 100 pairs must equal 100');
    assert.strictEqual(pairCreateTotal,  100, 'total creates across 100 pairs must equal 100');
  } finally {
    restoreClock();
  }
});

// -----------------------------------------------------------------------------
// Case 3 — reset-loop guard trips cleanly on cycle 3; 100 subsequent calls all suppressed
// -----------------------------------------------------------------------------

test('IDLE-04 harness: reset-loop guard trips on 3rd call and suppresses the next 100 calls', async () => {
  resetAll();
  // Do NOT advance time — we WANT the rolling window to trip.
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });

  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'idle-expired' });  // trips loop

  const stAfterTrip = sessionReset._getStateForTests();
  assert.strictEqual(stAfterTrip.loopActive, true, 'loopActive must latch on 3rd call');

  const errSent = callLog.find(
    (e) => e[0] === 'ipc' && e[1] === 'show-magicline-error'
  );
  assert.ok(errSent, 'expected show-magicline-error IPC on loop trip');
  assert.deepStrictEqual(errSent[2], { variant: 'reset-loop' });

  // Count destroy/create BEFORE the 100-suppressed burst.
  const destroyBefore = callLog.filter((e) => e[0] === 'destroyMagiclineView').length;
  const createBefore  = callLog.filter((e) => e[0] === 'createMagiclineView').length;
  assert.strictEqual(destroyBefore, 2, 'exactly 2 destroys before loop trip');
  assert.strictEqual(createBefore,  2, 'exactly 2 creates before loop trip');

  // Fire 100 more — every one must be suppressed via loop-active.
  fakeLog._lines.info.length = 0;
  for (let i = 0; i < 100; i++) {
    await sessionReset.hardReset({ reason: 'idle-expired' });
  }

  const destroyAfter = callLog.filter((e) => e[0] === 'destroyMagiclineView').length;
  const createAfter  = callLog.filter((e) => e[0] === 'createMagiclineView').length;
  assert.strictEqual(destroyAfter, 2, 'destroy count unchanged after 100 suppressed calls');
  assert.strictEqual(createAfter,  2, 'create count unchanged after 100 suppressed calls');

  // Every one of the 100 attempts must have logged loop-active suppression.
  const loopSuppressCount = fakeLog._lines.info.filter(
    (l) => l.startsWith('sessionReset.suppressed:') && l.indexOf('loop-active') !== -1
  ).length;
  assert.strictEqual(loopSuppressCount, 100, 'expected 100 loop-active suppression logs');
});

// -----------------------------------------------------------------------------
// Case 4 — clearStorageData storages array is exactly the 6 required types
// -----------------------------------------------------------------------------

test('IDLE-04 harness: clearStorageData storages list is exactly the 6 required types every cycle', async () => {
  resetAll();
  installFakeClock();
  try {
    const mw = makeFakeMainWindow();
    sessionReset.init({ mainWindow: mw, store: {} });

    const EXPECTED_STORAGES = [
      'cookies',
      'localstorage',
      'sessionstorage',
      'serviceworkers',
      'indexdb',
      'cachestorage',
    ];

    for (let i = 0; i < 10; i++) {
      resetCallLog();
      await sessionReset.hardReset({ reason: 'idle-expired' });
      const clearCall = callLog.find((e) => e[0] === 'clearStorageData');
      assert.ok(clearCall, 'cycle ' + i + ' clearStorageData must be called');
      assert.deepStrictEqual(
        clearCall[1].storages,
        EXPECTED_STORAGES,
        'cycle ' + i + ' storages list must be exactly the 6 required types in order'
      );
      assert.strictEqual(clearCall[1].storages.length, 6, 'cycle ' + i + ' storages length must be 6');
      fakeNow += 70_000;
    }
  } finally {
    restoreClock();
  }
});
