// test/credentialsStore.test.js
// Unit tests for src/main/credentialsStore using Node's built-in node:test runner.
// Uses a mocked safeStorage (trivial bit-flip, NOT real encryption) and an in-memory store.

const path = require('path');

// -- Stub ./logger before requiring credentialsStore ----------------------
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
const {
  buildCiphertext,
  saveCredentials,
  loadCredentials,
  isStoreAvailable,
  clearCredentials,
  DECRYPT_FAILED,
} = require('../src/main/credentialsStore');

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

// Mock safeStorage — XOR-with-constant is NOT real encryption but is
// deterministic and obviously non-plaintext, which is sufficient for
// verifying the round-trip + "no plaintext in store" invariant.
function makeMockSafeStorage(opts = {}) {
  const available = opts.available !== false;
  const throwOnDecrypt = !!opts.throwOnDecrypt;
  return {
    isEncryptionAvailable() { return available; },
    encryptString(s) {
      if (!available) throw new Error('not available');
      const buf = Buffer.from(s, 'utf8');
      // trivial obfuscation — flip all bits
      for (let i = 0; i < buf.length; i++) buf[i] = buf[i] ^ 0xFF;
      // Prefix with a magic header so decryption failure can be simulated
      return Buffer.concat([Buffer.from('MOCK'), buf]);
    },
    decryptString(buf) {
      if (throwOnDecrypt) throw new Error('Error while decrypting the ciphertext');
      if (!Buffer.isBuffer(buf)) throw new Error('not a buffer');
      if (buf.slice(0, 4).toString() !== 'MOCK') throw new Error('bad header');
      const body = Buffer.from(buf.slice(4));
      for (let i = 0; i < body.length; i++) body[i] = body[i] ^ 0xFF;
      return body.toString('utf8');
    },
  };
}

// ---- buildCiphertext (pure) ----

test('buildCiphertext returns base64 string without touching store', () => {
  const ss = makeMockSafeStorage();
  const b64 = buildCiphertext(ss, { user: 'u', pass: 'p' });
  assert.strictEqual(typeof b64, 'string');
  // base64 regex
  assert.match(b64, /^[A-Za-z0-9+/]+=*$/);
});

test('buildCiphertext throws EncryptionUnavailableError when isEncryptionAvailable=false', () => {
  const ss = makeMockSafeStorage({ available: false });
  assert.throws(
    () => buildCiphertext(ss, { user: 'u', pass: 'p' }),
    (err) => err.code === 'safestorage-unavailable' || err.name === 'EncryptionUnavailableError'
  );
});

test('buildCiphertext rejects missing/empty fields', () => {
  const ss = makeMockSafeStorage();
  assert.throws(() => buildCiphertext(ss, { user: 'x' }));
  assert.throws(() => buildCiphertext(ss, { user: 'x', pass: '' }));
});

// ---- saveCredentials / loadCredentials (round-trip) ----

test('round-trip: save then load returns same credentials', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage();
  saveCredentials(store, ss, { user: 'alice@example.com', pass: 'S3cr3t!' });
  const loaded = loadCredentials(store, ss);
  assert.deepStrictEqual(loaded, { user: 'alice@example.com', pass: 'S3cr3t!' });
});

test('load returns null when store is empty', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage();
  assert.strictEqual(loadCredentials(store, ss), null);
});

test('load returns DECRYPT_FAILED when decryptString throws', () => {
  const store = makeStore();
  const ss1 = makeMockSafeStorage();
  saveCredentials(store, ss1, { user: 'u', pass: 'p' });
  const ss2 = makeMockSafeStorage({ throwOnDecrypt: true });
  assert.strictEqual(loadCredentials(store, ss2), DECRYPT_FAILED);
});

test('load returns DECRYPT_FAILED when isEncryptionAvailable is false', () => {
  const store = makeStore();
  const ss1 = makeMockSafeStorage();
  saveCredentials(store, ss1, { user: 'u', pass: 'p' });
  const ss2 = makeMockSafeStorage({ available: false });
  assert.strictEqual(loadCredentials(store, ss2), DECRYPT_FAILED);
});

test('save throws safestorage-unavailable when isEncryptionAvailable is false', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage({ available: false });
  assert.throws(() => saveCredentials(store, ss, { user: 'u', pass: 'p' }),
    /safestorage-unavailable/);
});

test('no plaintext user or pass in stored blob (AUTH-01 invariant)', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage();
  const user = 'bsk-audit-USER-9f3c2a1d@example.invalid';
  const pass = 'bsk-audit-PASS-9f3c2a1d-aB%cD!eF';
  saveCredentials(store, ss, { user, pass });
  const dump = store._dump();
  assert.strictEqual(dump.includes('bsk-audit-USER'), false, 'plaintext username leaked');
  assert.strictEqual(dump.includes('bsk-audit-PASS'), false, 'plaintext password leaked');
});

test('credentials with quotes, backslashes, unicode round-trip correctly', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage();
  const tricky = { user: 'a"b\\c', pass: 'päss\'wörd\\n"' };
  saveCredentials(store, ss, tricky);
  assert.deepStrictEqual(loadCredentials(store, ss), tricky);
});

test('save rejects missing fields', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage();
  assert.throws(() => saveCredentials(store, ss, { user: 'x' }));
  assert.throws(() => saveCredentials(store, ss, { user: 'x', pass: '' }));
});

test('clearCredentials deletes the store key', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage();
  saveCredentials(store, ss, { user: 'u', pass: 'p' });
  clearCredentials(store);
  assert.strictEqual(loadCredentials(store, ss), null);
});

test('isStoreAvailable returns true/false from mock', () => {
  assert.strictEqual(isStoreAvailable(makeMockSafeStorage()), true);
  assert.strictEqual(isStoreAvailable(makeMockSafeStorage({ available: false })), false);
});

test('saveCredentials composes buildCiphertext output into store.set', () => {
  const store = makeStore();
  const ss = makeMockSafeStorage();
  saveCredentials(store, ss, { user: 'u', pass: 'p' });
  assert.strictEqual(typeof store.get('credentialsCiphertext'), 'string');
  assert.deepStrictEqual(loadCredentials(store, ss), { user: 'u', pass: 'p' });
});
