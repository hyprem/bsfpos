// test/sessionReset.test.js
// Unit tests for src/main/sessionReset.js (Plan 04-02).
//
// Covers:
//   - D-15 step order (11 steps, exact)
//   - In-flight mutex (resetting flag, finally-clear)
//   - Rolling-window loop counter (D-17)
//   - Unified idle+crash counter (D-18)
//   - loopActive latch
//   - Reason tagging on timestamps
//   - show-magicline-error {variant:'reset-loop'} emission
//   - Required log lines
//
// Mocking strategy: require.cache overrides for 'electron', './magiclineView',
// './idleTimer', and './logger' BEFORE the first require of sessionReset.
// Each test calls `_resetForTests()` to wipe module-scoped state.

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');

// -----------------------------------------------------------------------------
// Install mocks BEFORE requiring sessionReset
// -----------------------------------------------------------------------------

// Shared call log — each test resets it via resetCallLog().
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
        flushStore: async () => {
          callLog.push(['flushStore']);
        },
      },
    };
  },
};

// Install electron mock in require.cache under the id 'electron'.
// Electron resolves 'electron' as a builtin-like; we inject a cache entry keyed
// by 'electron' so downstream require('electron') hits our fake.
require.cache.electron = {
  id: 'electron',
  filename: 'electron',
  loaded: true,
  exports: { session: fakeSession },
};
// Also install under the resolved path some tooling may compute.
try {
  const electronResolved = require.resolve('electron');
  require.cache[electronResolved] = require.cache.electron;
} catch (_e) { /* electron not resolvable outside electron runtime — fine */ }

// Fake logger
const fakeLog = {
  _lines: { info: [], warn: [], error: [], audit: [] },
  info: (m) => fakeLog._lines.info.push(m),
  warn: (m) => fakeLog._lines.warn.push(m),
  error: (m) => fakeLog._lines.error.push(m),
  // Phase 5 Plan 06: sessionReset emits log.audit('idle.reset', ...) on
  // each non-suppressed hardReset call. Record the full entry and mirror a
  // stringified form onto _lines.info so legacy startsWith() matchers keep
  // working during the migration.
  audit: (event, fields) => {
    const entry = { event: event, fields: (fields || {}) };
    fakeLog._lines.audit.push(entry);
    const parts = ['event=' + event];
    for (const k of Object.keys(entry.fields)) parts.push(k + '=' + String(entry.fields[k]));
    fakeLog._lines.info.push(parts.join(' '));
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
    destroyMagiclineView: (mw) => { callLog.push(['destroyMagiclineView']); },
    createMagiclineView: (mw, st) => { callLog.push(['createMagiclineView']); },
  },
};

// Fake idleTimer (module does not exist on disk yet — Plan 04-01 sibling).
// Install via Module._resolveFilename hook so `require('./idleTimer')` from
// sessionReset.js resolves to a virtual path that we pre-seed in require.cache.
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
// Fake mainWindow factory
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
  fakeLog._lines.info.length = 0;
  fakeLog._lines.warn.length = 0;
  fakeLog._lines.error.length = 0;
  fakeLog._lines.audit.length = 0;
}

// -----------------------------------------------------------------------------
// Tests
// -----------------------------------------------------------------------------

test('1st hardReset({reason:"idle-expired"}) runs all 11 D-15 steps in exact order', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => {} } });

  await sessionReset.hardReset({ reason: 'idle-expired' });

  // Expected order (steps 4..10 are observable):
  //   idleTimer.stop              (step 4)
  //   ipc splash:show             (step 5)
  //   destroyMagiclineView        (step 6)
  //   session.fromPartition       (step 7)
  //   clearStorageData            (step 8)
  //   flushStore                  (step 9)
  //   createMagiclineView         (step 10)
  const kinds = callLog.map((e) => e[0]);
  assert.deepStrictEqual(kinds, [
    'idleTimer.stop',
    'ipc',
    'destroyMagiclineView',
    'session.fromPartition',
    'clearStorageData',
    'flushStore',
    'createMagiclineView',
  ], 'step order must match D-15');
  // Step 5 channel check
  const ipc = callLog.find((e) => e[0] === 'ipc');
  assert.strictEqual(ipc[1], 'splash:show');
  // Step 11: resetting is false again
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.resetting, false);
});

test('2nd concurrent hardReset() while resetting=true is suppressed (logs in-flight)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });

  // Kick off first reset but do not await — it will await clearStorageData.
  const p1 = sessionReset.hardReset({ reason: 'idle-expired' });
  // Immediately fire second — should hit the resetting-guard branch.
  const p2 = sessionReset.hardReset({ reason: 'idle-expired' });
  await Promise.all([p1, p2]);

  const suppressed = fakeLog._lines.info.some(
    (l) => l.startsWith('sessionReset.suppressed:') && l.indexOf('in-flight') !== -1
  );
  assert.ok(suppressed, 'expected suppression log for in-flight');
  // Only ONE createMagiclineView should have been called.
  const createCount = callLog.filter((e) => e[0] === 'createMagiclineView').length;
  assert.strictEqual(createCount, 1);
});

test('resetting flag is cleared in finally block even if clearStorageData rejects', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });

  // Monkey-patch the electron mock to throw on clearStorageData for this test.
  const origFromPartition = fakeSession.fromPartition;
  fakeSession.fromPartition = (p) => {
    callLog.push(['session.fromPartition', p]);
    return {
      clearStorageData: async () => {
        callLog.push(['clearStorageData-throwing']);
        throw new Error('simulated clearStorageData failure');
      },
      cookies: { flushStore: async () => { callLog.push(['flushStore']); } },
    };
  };

  await assert.rejects(
    () => sessionReset.hardReset({ reason: 'idle-expired' }),
    /simulated clearStorageData failure/
  );

  // Restore.
  fakeSession.fromPartition = origFromPartition;

  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.resetting, false, 'resetting must be cleared in finally');
});

test('Phase 4 reset-mode: clearStorageData uses 5 storages (NO localstorage — cookie-preservation path)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' }); // default mode='reset'
  const clearCall = callLog.find((e) => e[0] === 'clearStorageData');
  assert.ok(clearCall, 'clearStorageData must have been called');
  const opts = clearCall[1];
  assert.deepStrictEqual(opts.storages.slice().sort(), [
    'cachestorage',
    'cookies',
    'indexdb',
    'serviceworkers',
    'sessionstorage',
  ]);
  assert.strictEqual(opts.storages.length, 5);
});

test('cookies.flushStore() is awaited AFTER clearStorageData and BEFORE createMagiclineView', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const idxClear   = callLog.findIndex((e) => e[0] === 'clearStorageData');
  const idxFlush   = callLog.findIndex((e) => e[0] === 'flushStore');
  const idxCreate  = callLog.findIndex((e) => e[0] === 'createMagiclineView');
  assert.ok(idxClear >= 0 && idxFlush >= 0 && idxCreate >= 0);
  assert.ok(idxClear < idxFlush, 'clearStorageData before flushStore');
  assert.ok(idxFlush < idxCreate, 'flushStore before createMagiclineView');
});

test('destroyMagiclineView is called BEFORE createMagiclineView (Pitfall 2)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const idxDestroy = callLog.findIndex((e) => e[0] === 'destroyMagiclineView');
  const idxCreate  = callLog.findIndex((e) => e[0] === 'createMagiclineView');
  assert.ok(idxDestroy >= 0 && idxCreate >= 0);
  assert.ok(idxDestroy < idxCreate);
});

test('splash:show IPC is sent BEFORE destroyMagiclineView (step 5 before step 6)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const idxSplash  = callLog.findIndex((e) => e[0] === 'ipc' && e[1] === 'splash:show');
  const idxDestroy = callLog.findIndex((e) => e[0] === 'destroyMagiclineView');
  assert.ok(idxSplash >= 0 && idxDestroy >= 0);
  assert.ok(idxSplash < idxDestroy);
});

test('idleTimer.stop is called BEFORE splash:show (step 4 before step 5)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const idxStop   = callLog.findIndex((e) => e[0] === 'idleTimer.stop');
  const idxSplash = callLog.findIndex((e) => e[0] === 'ipc' && e[1] === 'splash:show');
  assert.ok(idxStop >= 0 && idxSplash >= 0);
  assert.ok(idxStop < idxSplash);
});

test('3 rapid calls within 60s window: 1st+2nd succeed, 3rd trips loopActive', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });

  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'idle-expired' });

  // 3rd should have tripped the loop latch and emitted reset-loop error.
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, true);
  const errSent = callLog.find(
    (e) => e[0] === 'ipc' && e[1] === 'show-magicline-error'
  );
  assert.ok(errSent, 'expected show-magicline-error IPC');
  assert.deepStrictEqual(errSent[2], { variant: 'reset-loop' });
  // Only 2 createMagiclineView calls (third never ran).
  const createCount = callLog.filter((e) => e[0] === 'createMagiclineView').length;
  assert.strictEqual(createCount, 2);
});

test('after loopActive is set, all subsequent hardReset calls are suppressed (logs loop-active)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'idle-expired' }); // trips loop

  // Clear logs and call again — must be suppressed with loop-active.
  fakeLog._lines.info.length = 0;
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const suppressed = fakeLog._lines.info.some(
    (l) => l.startsWith('sessionReset.suppressed:') && l.indexOf('loop-active') !== -1
  );
  assert.ok(suppressed, 'expected loop-active suppression log');
});

test('loopActive trip logs sessionReset.loop-detected with reasons array', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'crash' });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const loopLine = fakeLog._lines.error.find(
    (l) => l.startsWith('sessionReset.loop-detected:')
  );
  assert.ok(loopLine, 'expected loop-detected error log');
  assert.ok(loopLine.indexOf('idle-expired') !== -1);
  assert.ok(loopLine.indexOf('crash') !== -1);
  assert.ok(loopLine.indexOf('count=3') !== -1);
});

test('unified counter: 1 idle-expired + 1 crash + 1 idle-expired within 60s trips loop (D-18)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'crash' });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, true, 'unified counter must trip on mixed reasons');
});

test('reset older than 60s is filtered out of rolling window before counter check', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });

  // Monkey-patch Date.now for deterministic control.
  const realNow = Date.now;
  let fakeNow = 1_000_000;
  Date.now = () => fakeNow;

  try {
    await sessionReset.hardReset({ reason: 'idle-expired' }); // t=1_000_000
    fakeNow += 30_000;
    await sessionReset.hardReset({ reason: 'idle-expired' }); // t=1_030_000
    fakeNow += 31_000; // 61 s after first → first falls out of window
    await sessionReset.hardReset({ reason: 'idle-expired' }); // t=1_061_000
    // Only 2 timestamps in the last 60s → loop should NOT trip.
    const st = sessionReset._getStateForTests();
    assert.strictEqual(st.loopActive, false, 'first reset must age out of window');
    assert.strictEqual(st.resetTimestamps.length, 2);
  } finally {
    Date.now = realNow;
  }
});

test('reason tagging: each timestamps entry is {t, reason}', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  await sessionReset.hardReset({ reason: 'crash' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.resetTimestamps.length, 2);
  for (const entry of st.resetTimestamps) {
    assert.strictEqual(typeof entry.t, 'number');
    assert.strictEqual(typeof entry.reason, 'string');
  }
  assert.strictEqual(st.resetTimestamps[0].reason, 'idle-expired');
  assert.strictEqual(st.resetTimestamps[1].reason, 'crash');
});

test('hardReset with no init throws clearly-named error', async () => {
  resetAll();
  // Do NOT call init.
  await assert.rejects(
    () => sessionReset.hardReset({ reason: 'idle-expired' }),
    /init.*mainWindow.*was never called/
  );
});

test('audit event idle.reset fires on each non-suppressed hardReset call (Phase 5 Plan 06)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired' });
  const entry = fakeLog._lines.audit.find(
    (e) => e.event === 'idle.reset' && e.fields.reason === 'idle-expired' && e.fields.count === 1
  );
  assert.ok(entry, 'expected idle.reset audit event with {reason:idle-expired, count:1}');
});

// ---------------------------------------------------------------------------
// Phase 6: welcome-mode hardReset
// ---------------------------------------------------------------------------

test('Phase 6 Test 1: welcome mode clears all 6 storages including localstorage', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  const clearCall = callLog.find((e) => e[0] === 'clearStorageData');
  assert.ok(clearCall, 'clearStorageData must have been called');
  const opts = clearCall[1];
  assert.deepStrictEqual(opts.storages.slice().sort(), [
    'cachestorage',
    'cookies',
    'indexdb',
    'localstorage',
    'serviceworkers',
    'sessionstorage',
  ]);
  assert.strictEqual(opts.storages.length, 6);
});

test('Phase 6 Test 2: welcome mode destroys view and does NOT call createMagiclineView', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  const destroyCount = callLog.filter((e) => e[0] === 'destroyMagiclineView').length;
  const createCount = callLog.filter((e) => e[0] === 'createMagiclineView').length;
  assert.strictEqual(destroyCount, 1, 'view destroyed exactly once');
  assert.strictEqual(createCount, 0, 'view NOT recreated — stays destroyed until next tap');
});

test('Phase 6 Test 3: welcome mode emits welcome:show IPC AFTER clearStorageData + flushStore', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  const idxClear = callLog.findIndex((e) => e[0] === 'clearStorageData');
  const idxFlush = callLog.findIndex((e) => e[0] === 'flushStore');
  const idxWelcome = callLog.findIndex((e) => e[0] === 'ipc' && e[1] === 'welcome:show');
  assert.ok(idxWelcome >= 0, 'welcome:show IPC was sent');
  assert.ok(idxClear < idxWelcome, 'clearStorageData before welcome:show');
  assert.ok(idxFlush < idxWelcome, 'flushStore before welcome:show');
});

test('Phase 6 Test 4: welcome mode does NOT save/restore persistent cookies', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  // Monkey-patch session to record cookies.get / cookies.set calls.
  const origFromPartition = fakeSession.fromPartition;
  let getCalled = 0;
  let setCalled = 0;
  fakeSession.fromPartition = (p) => {
    callLog.push(['session.fromPartition', p]);
    return {
      clearStorageData: async (opts) => { callLog.push(['clearStorageData', opts]); },
      cookies: {
        get: async () => { getCalled++; return []; },
        set: async () => { setCalled++; },
        flushStore: async () => { callLog.push(['flushStore']); },
      },
    };
  };
  try {
    sessionReset.init({ mainWindow: mw, store: {} });
    await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
    assert.strictEqual(getCalled, 0, 'welcome mode must NOT call cookies.get');
    assert.strictEqual(setCalled, 0, 'welcome mode must NOT call cookies.set');
  } finally {
    fakeSession.fromPartition = origFromPartition;
  }
});

test('Phase 6 Test 5: welcome-mode entries in resetTimestamps carry mode:welcome', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.resetTimestamps.length, 1);
  assert.strictEqual(st.resetTimestamps[0].reason, 'idle-expired');
  assert.strictEqual(st.resetTimestamps[0].mode, 'welcome');
});

test('Phase 6 Test 6: three welcome-mode resets within 60s do NOT latch loopActive (D-06)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, false, 'welcome-logouts must be excluded from loop counter');
});

test('Phase 6 Test 7: three reset-mode resets still latch loopActive (regression)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'crash', mode: 'reset' });
  await sessionReset.hardReset({ reason: 'crash', mode: 'reset' });
  await sessionReset.hardReset({ reason: 'crash', mode: 'reset' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, true, 'non-welcome resets still count');
});

test('Phase 6 Test 8a: 2 welcome + 1 crash does NOT trip loop (only 1 countable)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'crash' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, false);
});

test('Phase 6 Test 8b: 2 welcome + 2 crash does NOT trip (only 2 countable)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'crash' });
  await sessionReset.hardReset({ reason: 'crash' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, false);
});

test('Phase 6 Test 8c: 2 welcome + 3 crash DOES trip (3 countable)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'crash' });
  await sessionReset.hardReset({ reason: 'crash' });
  await sessionReset.hardReset({ reason: 'crash' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, true);
});

test('Phase 6 Test 9: log.audit("idle.reset") includes mode field (default=reset, welcome when set)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });

  await sessionReset.hardReset({ reason: 'idle-expired' }); // default mode
  const defaultEntry = fakeLog._lines.audit.find(
    (e) => e.event === 'idle.reset' && e.fields.mode === 'reset'
  );
  assert.ok(defaultEntry, 'default mode in audit must be "reset"');

  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  const welcomeEntry = fakeLog._lines.audit.find(
    (e) => e.event === 'idle.reset' && e.fields.mode === 'welcome'
  );
  assert.ok(welcomeEntry, 'welcome mode must appear in audit');
});

test('Phase 6 Test 10: preReset and postReset listeners both fire for welcome mode on success', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });

  let preFired = 0;
  let postFired = 0;
  sessionReset.onPreReset(() => { preFired++; });
  sessionReset.onPostReset(() => { postFired++; });

  await sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  assert.strictEqual(preFired, 1, 'preReset listener fires in welcome mode');
  assert.strictEqual(postFired, 1, 'postReset listener fires in welcome mode');

  // Clear post listener to avoid contamination across tests via module-scoped state.
  sessionReset.onPostReset(null);
});

test('Phase 6 Test 11: missing mode defaults to "reset" and preserves Phase 4 behavior (recreates view)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  await sessionReset.hardReset({ reason: 'crash' }); // no mode field
  const createCount = callLog.filter((e) => e[0] === 'createMagiclineView').length;
  assert.strictEqual(createCount, 1, 'default path must recreate the view');
  // And the welcome:show IPC must NOT have been sent
  const welcomeIpc = callLog.find((e) => e[0] === 'ipc' && e[1] === 'welcome:show');
  assert.strictEqual(welcomeIpc, undefined, 'default path must NOT send welcome:show');
});

test('Phase 6 Test 12: welcome mode respects in-flight mutex', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: {} });
  const p1 = sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  const p2 = sessionReset.hardReset({ reason: 'idle-expired', mode: 'welcome' });
  await Promise.all([p1, p2]);
  // Only one destroyMagiclineView should have happened.
  const destroyCount = callLog.filter((e) => e[0] === 'destroyMagiclineView').length;
  assert.strictEqual(destroyCount, 1, 'second concurrent welcome-reset was suppressed');
});

// ---------------------------------------------------------------------------
// Phase 10: sale-completed loop-counter exclusion (D-17) + onPostReset (D-18)
// ---------------------------------------------------------------------------

test('D-17: 3x hardReset({reason:"sale-completed"}) within 60s does NOT trip loop guard', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  // store.get needed for welcome-mode IPC (pos-state-changed broadcast)
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  const st = sessionReset._getStateForTests();
  assert.strictEqual(st.loopActive, false, 'sale-completed resets must not trip loop guard');
  // All 3 must have emitted audit events (not suppressed)
  const auditLines = fakeLog._lines.audit.filter(e => e.event === 'idle.reset');
  assert.strictEqual(auditLines.length, 3, 'all 3 resets must emit idle.reset audit');
  // Assert the reason field is tagged correctly
  for (const entry of auditLines) {
    assert.strictEqual(entry.fields.reason, 'sale-completed');
    assert.strictEqual(entry.fields.mode, 'welcome');
  }
});

test('D-18: sale-completed reset still fires onPostReset (updateGate composition)', async () => {
  resetAll();
  const mw = makeFakeMainWindow();
  sessionReset.init({ mainWindow: mw, store: { get: () => true } });
  let postResetCount = 0;
  sessionReset.onPostReset(() => { postResetCount++; });
  await sessionReset.hardReset({ reason: 'sale-completed', mode: 'welcome' });
  assert.strictEqual(postResetCount, 1, 'onPostReset must fire for sale-completed welcome cycle');
  // Clear post listener to avoid contamination across tests via module-scoped state.
  sessionReset.onPostReset(null);
});
