// test/adminPin.test.js
// Unit tests for src/main/adminPin using Node's built-in node:test runner.
// Stubs src/main/logger to avoid pulling in electron-log/main under a pure Node context.

const path = require('path');
const Module = require('module');

// -- Stub ./logger before requiring adminPin -------------------------------
// src/main/logger.js does `require('electron-log/main')` which is Electron-only.
// Inject a no-op logger into require.cache under the exact resolved path
// adminPin will look up via `require('./logger')`.
const loggerPath = path.resolve(__dirname, '..', 'src', 'main', 'logger.js');
require.cache[loggerPath] = {
  id: loggerPath,
  filename: loggerPath,
  loaded: true,
  exports: {
    info: () => {},
    warn: () => {},
    error: () => {},
    debug: () => {},
  },
};

const test = require('node:test');
const assert = require('node:assert');
const { buildRecord, setPin, verifyPin, hasPin, _SCRYPT_PARAMS } = require('../src/main/adminPin');

function makeStore() {
  const data = {};
  return {
    get(k, def) { return k in data ? data[k] : def; },
    set(k, v) {
      if (typeof k === 'object') Object.assign(data, k);
      else data[k] = v;
    },
    has(k) { return k in data; },
    delete(k) { delete data[k]; },
    _dump() { return JSON.stringify(data); },
  };
}

// ---- buildRecord (pure) ----

test('buildRecord returns {hash, salt, params}', () => {
  const r = buildRecord('1234');
  assert.strictEqual(typeof r.hash, 'string');
  assert.strictEqual(typeof r.salt, 'string');
  assert.strictEqual(typeof r.params, 'object');
  assert.ok(r.params.N > 0);
  assert.strictEqual(r.params.N, _SCRYPT_PARAMS.N);
});

test('buildRecord is pure — does not touch any store', () => {
  // Pass nothing; if buildRecord touched a store it would throw.
  const r1 = buildRecord('1234');
  const r2 = buildRecord('1234');
  // Different salts on each call
  assert.notStrictEqual(r1.salt, r2.salt);
  // Different hashes (because different salts)
  assert.notStrictEqual(r1.hash, r2.hash);
});

test('buildRecord rejects too-short PIN', () => {
  assert.throws(() => buildRecord('123'), /invalid format/);
});

test('buildRecord rejects too-long PIN', () => {
  assert.throws(() => buildRecord('1234567'), /invalid format/);
});

test('buildRecord rejects non-numeric PIN', () => {
  assert.throws(() => buildRecord('abcd'), /invalid format/);
});

test('buildRecord rejects non-string PIN', () => {
  assert.throws(() => buildRecord(1234), /invalid format/);
});

// ---- setPin (thin wrapper) ----

test('setPin then verifyPin with same PIN returns true', () => {
  const store = makeStore();
  setPin(store, '1234');
  assert.strictEqual(verifyPin(store, '1234'), true);
});

test('setPin then verifyPin with wrong PIN returns false', () => {
  const store = makeStore();
  setPin(store, '1234');
  assert.strictEqual(verifyPin(store, '9999'), false);
});

test('verifyPin with no record returns false', () => {
  const store = makeStore();
  assert.strictEqual(verifyPin(store, '1234'), false);
});

test('verifyPin with empty string returns false', () => {
  const store = makeStore();
  setPin(store, '1234');
  assert.strictEqual(verifyPin(store, ''), false);
});

test('stored record does not contain plaintext PIN', () => {
  const store = makeStore();
  setPin(store, '1234');
  assert.strictEqual(store._dump().includes('1234'), false,
    'plaintext PIN leaked into store');
});

test('hasPin transitions false -> true on setPin', () => {
  const store = makeStore();
  assert.strictEqual(hasPin(store), false);
  setPin(store, '5678');
  assert.strictEqual(hasPin(store), true);
});

test('PIN length 6 is accepted', () => {
  const store = makeStore();
  setPin(store, '123456');
  assert.strictEqual(verifyPin(store, '123456'), true);
});

test('setPin composes buildRecord output into store.set', () => {
  // Verify the wrapper writes the EXACT shape buildRecord returns.
  const store = makeStore();
  setPin(store, '4321');
  const stored = store.get('adminPin');
  assert.ok(stored && stored.hash && stored.salt && stored.params);
  assert.strictEqual(stored.params.N, _SCRYPT_PARAMS.N);
});
