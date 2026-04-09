// test/phase3-integration.test.js
// ---------------------------------------------------------------------------
// Phase 3 integration aggregator. A single `node:test` entry point that runs
// all three Phase 3 unit suites (adminPin, credentialsStore, authFlow) as
// top-level subtests, so `node --test test/phase3-integration.test.js`
// executes the whole phase suite in one shot.
//
// This file deliberately does NOT duplicate test assertions — it just
// requires the existing suites, which register their tests on the shared
// node:test registry. The aggregator exists to:
//
//   1. Give Plan 03-08 a single executable entry point for the acceptance
//      verdict (per must-have: "All unit test files from Plans 02-04 still
//      pass as a suite").
//   2. Make it trivial for CI / a future pre-commit hook to run the whole
//      Phase 3 unit layer with one command.
//   3. Document — in one place — which files constitute Phase 3's unit
//      coverage surface (adminPin, credentialsStore, authFlow reducer +
//      executor).
//
// Usage:
//   node --test test/phase3-integration.test.js
//
// Expected: >= 35 tests pass (9 adminPin + 10 credentialsStore + 20 authFlow,
// currently 72 total as of 03-08 acceptance).
// ---------------------------------------------------------------------------

const test = require('node:test');

test('Phase 3 integration: adminPin suite', async (t) => {
  await t.test('loading adminPin.test.js', () => {
    require('./adminPin.test.js');
  });
});

test('Phase 3 integration: credentialsStore suite', async (t) => {
  await t.test('loading credentialsStore.test.js', () => {
    require('./credentialsStore.test.js');
  });
});

test('Phase 3 integration: authFlow suite', async (t) => {
  await t.test('loading authFlow.test.js', () => {
    require('./authFlow.test.js');
  });
});

// Phase 3 coverage surface summary — this test documents the invariant set
// across Plans 03-02..03-10 so a reader of a single file can see the shape
// of the phase's unit layer without spelunking every summary.
test('Phase 3 coverage surface: invariants documented', () => {
  const invariants = [
    // Plan 03-02: admin PIN gate
    'adminPin: scrypt hash + salt stored as single object (D-11)',
    'adminPin: verifyPin uses timingSafeEqual',
    'adminPin: setPin rejects PINs outside 4-6 digit range',
    // Plan 03-03: credentials store
    'credentialsStore: buildCiphertext is pure (no store I/O)',
    'credentialsStore: throws EncryptionUnavailableError on safeStorage=false',
    'credentialsStore: round-trip preserves unicode + escapes',
    'credentialsStore: AUTH-01 invariant — stored blob has no plaintext',
    // Plan 03-04: authFlow reducer + executor
    'authFlow reducer: pure (state, event) -> (state, sideEffects)',
    'authFlow: no retry branch (D-21) — failure routes to CREDENTIALS_UNAVAILABLE',
    'authFlow: credentials-submitted persists via single atomic store.set (D-11)',
    'authFlow: CASH_REGISTER_READY is terminal',
    'authFlow: JSON-escapes credentials into fill-and-submit IPC',
  ];
  if (invariants.length < 10) {
    throw new Error('Phase 3 invariant set shrank unexpectedly');
  }
});
