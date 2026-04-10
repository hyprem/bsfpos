// test/sessionReset.postReset.test.js
// Phase 5 coverage for the D-15/D-16 onPostReset hook added in Plan 05-03.
// Must NOT break Phase 4's existing sessionReset test suite.
//
// Mocking strategy mirrors test/sessionReset.test.js: install require.cache
// overrides for 'electron', './logger', './magiclineView', and './idleTimer'
// BEFORE the first require of sessionReset.

const test = require('node:test');
const assert = require('node:assert');

// --- Fake electron.session --------------------------------------------------
const fakeSession = {
  fromPartition: () => ({
    clearStorageData: async () => {},
    cookies: { flushStore: async () => {} },
  }),
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
} catch (_e) { /* electron not resolvable outside electron runtime — fine */ }

// --- Fake logger ------------------------------------------------------------
const fakeLog = {
  info: () => {},
  warn: () => {},
  error: () => {},
};
const loggerPath = require.resolve('../src/main/logger');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: fakeLog,
};

// --- Fake magiclineView -----------------------------------------------------
const magiclineViewPath = require.resolve('../src/main/magiclineView');
require.cache[magiclineViewPath] = {
  id: magiclineViewPath,
  filename: magiclineViewPath,
  loaded: true,
  exports: {
    destroyMagiclineView: () => {},
    createMagiclineView: () => ({ webContents: {} }),
  },
};

// --- Fake idleTimer ---------------------------------------------------------
const idleTimerPath = require.resolve('../src/main/idleTimer');
require.cache[idleTimerPath] = {
  id: idleTimerPath,
  filename: idleTimerPath,
  loaded: true,
  exports: {
    stop: () => {},
    init: () => {},
    dismiss: () => {},
    expired: () => {},
  },
};

const sessionReset = require('../src/main/sessionReset');

function makeMainWindow() {
  const sent = [];
  return {
    webContents: {
      send: (ch, payload) => sent.push({ ch, payload }),
    },
    _sent: sent,
  };
}

test('onPostReset: listener fires after successful hardReset', async () => {
  sessionReset._resetForTests();
  sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
  let fired = 0;
  sessionReset.onPostReset(() => { fired++; });
  await sessionReset.hardReset({ reason: 'test-success' });
  assert.strictEqual(fired, 1, 'listener should fire exactly once on success');
});

test('onPostReset: listener does NOT fire when call is suppressed (in-flight)', async () => {
  sessionReset._resetForTests();
  sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
  let fired = 0;
  sessionReset.onPostReset(() => { fired++; });
  // Start one reset and immediately fire a second — second returns early (resetting=true)
  const p1 = sessionReset.hardReset({ reason: 'first' });
  const p2 = sessionReset.hardReset({ reason: 'second-suppressed' });
  await Promise.all([p1, p2]);
  // The first succeeded (fired++), the second was suppressed (no additional fire)
  assert.strictEqual(fired, 1, 'suppressed reset must not fire listener');
});

test('onPostReset: listener does NOT fire on loop-detected short-circuit', async () => {
  sessionReset._resetForTests();
  sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
  let fired = 0;
  sessionReset.onPostReset(() => { fired++; });
  // 3 resets in rapid succession trips IDLE-05 loop detection on the 3rd
  await sessionReset.hardReset({ reason: 'a' });
  await sessionReset.hardReset({ reason: 'b' });
  await sessionReset.hardReset({ reason: 'c' }); // loop-active latched; early return
  // First two succeeded, third returned early on loop-active — fired should be 2
  assert.strictEqual(fired, 2, 'loop-detected reset must not fire listener; fired=' + fired);
});

test('onPostReset(null) clears the listener', async () => {
  sessionReset._resetForTests();
  sessionReset.init({ mainWindow: makeMainWindow(), store: {} });
  let fired = 0;
  sessionReset.onPostReset(() => { fired++; });
  sessionReset.onPostReset(null);
  await sessionReset.hardReset({ reason: 'cleared' });
  assert.strictEqual(fired, 0, 'cleared listener must not fire');
});
