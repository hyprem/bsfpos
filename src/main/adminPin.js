// src/main/adminPin.js
// Admin PIN gate — scrypt hash + timingSafeEqual verify.
// Phase 3: AUTH-05 recovery dependency (minimal surface).
// Phase 5: ADMIN-03 will add rate-limit lockout ON TOP of this module
//          without modifying it. Do not add lockout state here.
//
// Builder/wrapper split: buildRecord() is a pure function that returns
// the persistable record WITHOUT touching the store, so Plan 04's
// first-run path can compose adminPin + credentialsCiphertext into a
// single atomic store.set({...}) call (D-11, RESEARCH §electron-store Atomicity).

const crypto = require('crypto');
const log = require('./logger');

// Chosen per 03-01-KIOSK-VERIFICATION.md §scrypt Benchmark.
// Research default: N=16384, r=8, p=1, keylen=32, maxmem=64MB.
// The kiosk CPU benchmark is DEFERRED to plan 03-09 (next kiosk visit).
// If 03-09 measures the median outside the 50-250 ms band it will update
// this constant and add a `// N adjusted per 03-09 benchmark: median was XXX ms` comment.
const SCRYPT_PARAMS = Object.freeze({
  N: 16384,
  r: 8,
  p: 1,
  keylen: 32,
  maxmem: 64 * 1024 * 1024,
});

const PIN_REGEX = /^[0-9]{4,6}$/;

function validatePinFormat(pin) {
  if (typeof pin !== 'string' || !PIN_REGEX.test(pin)) {
    throw new Error('adminPin: invalid format (must be 4-6 digits)');
  }
}

function hashPin(pin, saltBuf, params) {
  // NOTE: scryptSync blocks the main process for ~50-300ms on kiosk hardware.
  // This is acceptable because PIN verify happens only on the recovery path
  // (rare) and the user is expecting "checking..." feedback.
  return crypto.scryptSync(pin, saltBuf, params.keylen, {
    N: params.N, r: params.r, p: params.p, maxmem: params.maxmem,
  });
}

// ---------------------------------------------------------------------------
// Pure builder — does NOT touch the store. Returns the persistable object.
// Consumed by setPin() (thin wrapper below) AND by Plan 04's
// handleCredentialsSubmit() which composes the record into a single
// atomic store.set({adminPin, credentialsCiphertext}) call.
// ---------------------------------------------------------------------------
function buildRecord(pin) {
  validatePinFormat(pin);
  const salt = crypto.randomBytes(16);
  const hash = hashPin(pin, salt, SCRYPT_PARAMS);
  return {
    hash:   hash.toString('hex'),
    salt:   salt.toString('hex'),
    params: {
      N: SCRYPT_PARAMS.N,
      r: SCRYPT_PARAMS.r,
      p: SCRYPT_PARAMS.p,
      keylen: SCRYPT_PARAMS.keylen,
      maxmem: SCRYPT_PARAMS.maxmem,
    },
  };
}

// Thin wrapper: build + persist in one shot. Back-compat for any non-first-run
// callers. Plan 04's first-run path does NOT call this — it calls buildRecord
// directly and composes the atomic multi-key store.set itself.
function setPin(store, newPin) {
  const record = buildRecord(newPin);
  store.set('adminPin', record);
  log.info('adminPin.set: N=' + record.params.N);
}

function verifyPin(store, input) {
  try {
    if (typeof input !== 'string' || input.length === 0) return false;
    const rec = store.get('adminPin');
    if (!rec || !rec.hash || !rec.salt || !rec.params) {
      log.warn('adminPin.verify: no record stored');
      return false;
    }
    const salt = Buffer.from(rec.salt, 'hex');
    const expected = Buffer.from(rec.hash, 'hex');
    const actual = hashPin(input, salt, rec.params);
    if (actual.length !== expected.length) return false;
    // CRITICAL: use timingSafeEqual, NEVER === or Buffer.equals
    return crypto.timingSafeEqual(actual, expected);
  } catch (e) {
    log.error('adminPin.verify failed: ' + (e && e.message));
    return false;
  }
}

function hasPin(store) {
  try {
    const rec = store.get('adminPin');
    return !!(rec && rec.hash && rec.salt && rec.params);
  } catch (e) {
    return false;
  }
}

exports.buildRecord = buildRecord;
exports.setPin = setPin;
exports.verifyPin = verifyPin;
exports.hasPin = hasPin;
exports._SCRYPT_PARAMS = SCRYPT_PARAMS;
