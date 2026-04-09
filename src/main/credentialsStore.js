// src/main/credentialsStore.js
// -----------------------------------------------------------------------------
// Phase 3 — credential round-trip module.
// Purely about encrypt/decrypt/store/load — the state machine (authFlow.js)
// is the caller. safeStorage is injected so this module is unit-testable
// with a mock. No electron import at module scope.
//
// AUTH-01: credentials at rest MUST be DPAPI ciphertext, never plaintext.
// AUTH-02: single save entry point persists the encrypted blob atomically.
//
// Builder/wrapper split: buildCiphertext() is a pure function that returns
// the persistable base64 string WITHOUT touching the store, so Plan 04's
// first-run path can compose adminPin + credentialsCiphertext into a single
// atomic store.set({...}) call (D-11, RESEARCH §electron-store Atomicity).
// -----------------------------------------------------------------------------

const log = require('./logger');

const STORE_KEY = 'credentialsCiphertext';
const DECRYPT_FAILED = 'DECRYPT_FAILED';

class EncryptionUnavailableError extends Error {
  constructor(message) {
    super(message || 'safestorage-unavailable');
    this.name = 'EncryptionUnavailableError';
    this.code = 'safestorage-unavailable';
  }
}

function isStoreAvailable(safeStorage) {
  try {
    return safeStorage && typeof safeStorage.isEncryptionAvailable === 'function'
      && safeStorage.isEncryptionAvailable() === true;
  } catch (e) {
    log.warn('credentialsStore.isStoreAvailable threw: ' + (e && e.message));
    return false;
  }
}

// ---------------------------------------------------------------------------
// Pure builder — does NOT touch the store. Returns the base64 ciphertext.
// Consumed by saveCredentials() (thin wrapper below) AND by Plan 04's
// handleCredentialsSubmit() which composes the ciphertext into a single
// atomic store.set({adminPin, credentialsCiphertext}) call.
// ---------------------------------------------------------------------------
function buildCiphertext(safeStorage, creds) {
  if (!creds || typeof creds.user !== 'string' || typeof creds.pass !== 'string') {
    throw new Error('credentialsStore.buildCiphertext: creds must be {user: string, pass: string}');
  }
  if (creds.user.length === 0 || creds.pass.length === 0) {
    throw new Error('credentialsStore.buildCiphertext: user/pass must be non-empty');
  }
  if (!isStoreAvailable(safeStorage)) {
    // CRITICAL per PROJECT.md: NEVER fall back to plaintext.
    throw new EncryptionUnavailableError('safestorage-unavailable');
  }
  // Research §safeStorage Round-Trip Pattern:
  //   plaintext JSON -> encryptString -> Buffer -> .toString('base64')
  const plaintext = JSON.stringify({ user: creds.user, pass: creds.pass });
  const cipherBuf = safeStorage.encryptString(plaintext);
  if (!Buffer.isBuffer(cipherBuf)) {
    // Defensive — docs say Buffer, but guard anyway.
    throw new Error('credentialsStore.buildCiphertext: encryptString did not return a Buffer');
  }
  return cipherBuf.toString('base64');
}

// Thin wrapper: build + persist in one shot. Back-compat for any callers
// that just want to save. Plan 04's first-run path does NOT call this —
// it calls buildCiphertext directly and composes the atomic multi-key
// store.set itself.
function saveCredentials(store, safeStorage, creds) {
  const cipherB64 = buildCiphertext(safeStorage, creds);
  store.set(STORE_KEY, cipherB64);
  // NEVER log the cipherB64 content or its length — length can leak a weak signal about
  // password length across users.
  log.info('credentialsStore.save: persisted (encrypted)');
}

function loadCredentials(store, safeStorage) {
  try {
    if (!isStoreAvailable(safeStorage)) {
      log.warn('credentialsStore.load: safestorage-unavailable');
      return DECRYPT_FAILED;
    }
    if (!store.has(STORE_KEY)) {
      return null; // first run
    }
    const cipherB64 = store.get(STORE_KEY);
    if (typeof cipherB64 !== 'string' || cipherB64.length === 0) {
      return null;
    }
    // Research §safeStorage Round-Trip Pattern:
    //   Buffer.from(b64,'base64') -> decryptString -> JSON.parse
    const cipherBuf = Buffer.from(cipherB64, 'base64');
    let plaintext;
    try {
      plaintext = safeStorage.decryptString(cipherBuf);
    } catch (e) {
      // Pitfall #1: DPAPI master key rotation on Windows password reset
      // makes ciphertext undecryptable. Pitfall #3: base64 corruption.
      log.warn('credentialsStore.decryptString threw (likely DPAPI rotation): ' + (e && e.message));
      return DECRYPT_FAILED;
    }
    let parsed;
    try {
      parsed = JSON.parse(plaintext);
    } catch (e) {
      log.error('credentialsStore.load: JSON.parse failed on decrypted plaintext');
      return DECRYPT_FAILED;
    }
    if (!parsed || typeof parsed.user !== 'string' || typeof parsed.pass !== 'string') {
      log.error('credentialsStore.load: decrypted shape invalid');
      return DECRYPT_FAILED;
    }
    return { user: parsed.user, pass: parsed.pass };
  } catch (e) {
    log.error('credentialsStore.load unexpected error: ' + (e && e.message));
    return DECRYPT_FAILED;
  }
}

function clearCredentials(store) {
  try {
    store.delete(STORE_KEY);
    log.info('credentialsStore.clear: credentialsCiphertext deleted');
  } catch (e) {
    log.warn('credentialsStore.clear failed: ' + (e && e.message));
  }
}

exports.buildCiphertext = buildCiphertext;
exports.saveCredentials = saveCredentials;
exports.loadCredentials = loadCredentials;
exports.isStoreAvailable = isStoreAvailable;
exports.clearCredentials = clearCredentials;
exports.DECRYPT_FAILED = DECRYPT_FAILED;
exports.EncryptionUnavailableError = EncryptionUnavailableError;
exports._STORE_KEY = STORE_KEY;
