// src/main/adminPinLockout.js
// Phase 5 ADMIN-03 / CONTEXT.md D-09..D-13
//
// Rate-limit lockout wrapper around adminPin.verifyPin. Adds a rolling
// 60-second failure window; after 5 failures latches a 5-minute lockout.
// Persists ALL state to electron-store under key `adminPinLockout` so a
// crash-and-relaunch attack cannot reset the counter.
//
// CONTRACT: src/main/adminPin.js is NEVER modified by Phase 5.
// (Phase 3 D-10 hand-off: "Phase 5 adds lockout ON TOP of this module".)
//
// All timestamps are numeric Unix ms internally; persisted lockedUntil is
// an ISO string for JSON-friendly storage.

const adminPin = require('./adminPin');

const WINDOW_MS = 60_000;          // D-10: 60-second rolling failure window
const MAX_ATTEMPTS = 5;            // D-10: 5 failures trips lockout
const LOCKOUT_MS = 5 * 60_000;     // D-10: 5-minute lockout

const STORE_KEY = 'adminPinLockout';

function readState(store) {
  const raw = store.get(STORE_KEY);
  if (!raw || typeof raw !== 'object') {
    return { attempts: [], lockedUntil: null };
  }
  return {
    attempts: Array.isArray(raw.attempts)
      ? raw.attempts.filter((t) => typeof t === 'number')
      : [],
    lockedUntil: typeof raw.lockedUntil === 'string' ? raw.lockedUntil : null,
  };
}

function isCurrentlyLocked(state, now) {
  if (!state.lockedUntil) return false;
  const until = new Date(state.lockedUntil).getTime();
  return Number.isFinite(until) && until > now;
}

function prune(attempts, now) {
  return attempts.filter((t) => typeof t === 'number' && now - t < WINDOW_MS);
}

/**
 * Verify a PIN attempt with persistent rate-limit lockout.
 *
 * @param {object} store - electron-store instance with .get/.set
 * @param {string} pin - user-entered PIN digits
 * @returns {{ok:boolean, locked:boolean, lockedUntil:(Date|null)}}
 */
function verifyPinWithLockout(store, pin) {
  const now = Date.now();
  const state = readState(store);

  // D-12: currently locked — refuse without burning a scrypt call (T-05-10)
  if (isCurrentlyLocked(state, now)) {
    return {
      ok: false,
      locked: true,
      lockedUntil: new Date(state.lockedUntil),
    };
  }

  // Prune stale attempts outside rolling window
  state.attempts = prune(state.attempts, now);
  // Clear any expired lockedUntil so a post-expiry good PIN returns cleanly
  if (state.lockedUntil) {
    state.lockedUntil = null;
  }

  // Delegate to Phase 3 adminPin (scrypt + timingSafeEqual)
  const ok = adminPin.verifyPin(store, pin);

  if (ok) {
    // D-11: full reset on success
    store.set(STORE_KEY, { attempts: [], lockedUntil: null });
    return { ok: true, locked: false, lockedUntil: null };
  }

  // Failed — record attempt
  state.attempts.push(now);
  let lockedUntilIso = null;
  if (state.attempts.length >= MAX_ATTEMPTS) {
    lockedUntilIso = new Date(now + LOCKOUT_MS).toISOString();
  }

  // Atomic single-key write. Write BEFORE returning per RESEARCH Pitfall 3
  // so a kill-and-relaunch cannot reset the counter (T-05-08).
  store.set(STORE_KEY, {
    attempts: state.attempts,
    lockedUntil: lockedUntilIso,
  });

  return {
    ok: false,
    locked: state.attempts.length >= MAX_ATTEMPTS,
    lockedUntil: lockedUntilIso ? new Date(lockedUntilIso) : null,
  };
}

module.exports = {
  verifyPinWithLockout,
  // Test-only exports
  _WINDOW_MS: WINDOW_MS,
  _MAX_ATTEMPTS: MAX_ATTEMPTS,
  _LOCKOUT_MS: LOCKOUT_MS,
  _STORE_KEY: STORE_KEY,
};
