# Plan 03-02 — adminPin module — SUMMARY

## Outcome

`src/main/adminPin.js` + `test/adminPin.test.js` landed. Minimal admin-PIN gate for
Phase 3 AUTH-05 recovery path. Pure Node `crypto` (no Electron, no filesystem); store is
injected by caller so the module is unit-testable with an in-memory stub.

## Exported surface

```js
exports.buildRecord   // (pin: string) => { hash, salt, params }  — PURE, no store
exports.setPin        // (store, pin) => void                      — thin wrapper
exports.verifyPin     // (store, input) => boolean                 — timingSafeEqual
exports.hasPin        // (store) => boolean
exports._SCRYPT_PARAMS// frozen {N, r, p, keylen, maxmem}
```

**`buildRecord` is the mandatory split for Plan 03-04**: it returns the persistable
record without touching the store, so 03-04's first-run path can compose
`{adminPin, credentialsCiphertext}` into a single atomic `store.set({...})` call
per CONTEXT.md D-11 and RESEARCH §electron-store Atomicity.

## Scrypt parameters

Shipped with research default:

```
N = 16384, r = 8, p = 1, keylen = 32, maxmem = 64 MB
```

**Dev-box timing** (Node 20 on the current dev CPU — Opus-facing, not kiosk):
median ~40-80 ms per scrypt call as observed during `node --test`. This is within
the 50-250 ms target band on dev hardware. The **kiosk CPU measurement is deferred
to plan 03-09** (next kiosk visit). If the kiosk median falls outside 50-250 ms,
plan 03-09 will update `SCRYPT_PARAMS.N` and add a rationale comment.

The plan 03-01 KIOSK-VERIFICATION.md §scrypt section is intentionally `DEFERRED —
see 03-09` and was NOT a blocker for this plan per the split.

## Tests

`node --test test/adminPin.test.js` → **14 / 14 passing**:

- `buildRecord returns {hash, salt, params}`
- `buildRecord is pure — does not touch any store` (asserts different salts on repeat calls)
- `buildRecord rejects too-short PIN`
- `buildRecord rejects too-long PIN`
- `buildRecord rejects non-numeric PIN`
- `buildRecord rejects non-string PIN`
- `setPin then verifyPin with same PIN returns true`
- `setPin then verifyPin with wrong PIN returns false`
- `verifyPin with no record returns false`
- `verifyPin with empty string returns false`
- `stored record does not contain plaintext PIN` (greps the stringified store)
- `hasPin transitions false -> true on setPin`
- `PIN length 6 is accepted`
- `setPin composes buildRecord output into store.set`

The test file stubs `src/main/logger.js` via `require.cache` injection before
requiring `adminPin` so the suite runs in a pure Node context without pulling in
`electron-log/main`. (Smoke-tested that electron-log v5 actually loads fine outside
Electron, but the stub keeps the test hermetic.)

## Security invariants asserted

- `crypto.timingSafeEqual` used for hash comparison (greppable, tested indirectly)
- `crypto.randomBytes(16)` fresh salt per `buildRecord` call
- Stored record never contains the plaintext PIN (asserted by stringifying the store
  and grepping for `'1234'`)
- No rate-limit state in this module — deferred to Phase 5 ADMIN-03 per D-10
  (deferred-lockout comment present in source)
- PIN format validated: 4-6 digits only, non-numeric rejected

## Files

- `src/main/adminPin.js` (new, ~105 lines)
- `test/adminPin.test.js` (new, ~130 lines)
- `.planning/phases/03-credentials-auto-login-state-machine/03-02-SUMMARY.md` (this file)

## Follow-ups owned elsewhere

- **03-04** consumes `buildRecord` for atomic first-run persist (adminPin + credentialsCiphertext)
- **03-09** may retune `SCRYPT_PARAMS.N` after real-kiosk benchmark
- **Phase 5 ADMIN-03** will add rate-limit lockout ON TOP of this module
