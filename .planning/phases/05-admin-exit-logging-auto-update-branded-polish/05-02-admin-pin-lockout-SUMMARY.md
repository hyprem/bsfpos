---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 02
subsystem: admin-security
tags: [security, admin, lockout, rate-limit, persistence, ADMIN-03]
requires:
  - src/main/adminPin.js (Phase 3, read-only contract)
  - electron-store instance (dependency-injected .get/.set)
provides:
  - verifyPinWithLockout(store, pin) → {ok, locked, lockedUntil}
  - Persistent rolling-window rate-limit lockout (5 fails / 60s → 5 min)
  - Crash-resistant counter (written before return on each failed attempt)
affects:
  - Plan 05-04 (main orchestration) will wire this to ipcMain.handle('verify-admin-pin')
  - Plan 05-06 (log migration) will add log.audit('pin.verify'/'pin.lockout') at the caller
tech-stack:
  added: []
  patterns:
    - Dependency-injected store for pure unit testability
    - Timing-side-channel safety: no scrypt call while locked
    - Write-before-return persistence per RESEARCH Pitfall 3
    - Field-name-allowlist-friendly return shape (no secrets in payload)
key-files:
  created:
    - src/main/adminPinLockout.js
    - test/adminPinLockout.test.js
  modified: []
decisions:
  - Phase 3 adminPin.js left with zero diff (D-10 contract preserved)
  - Test-only exports (_WINDOW_MS, _MAX_ATTEMPTS, _LOCKOUT_MS, _STORE_KEY) via underscore prefix
  - adminPin.verifyPin stubbed via require-cache override in tests (no real scrypt records needed)
  - Audit logging (log.audit) deliberately NOT emitted from wrapper — caller's responsibility per Plan 04
metrics:
  duration: "~4 min"
  completed: 2026-04-10
  tasks: 2
  commits: 2
requirements: [ADMIN-03]
---

# Phase 5 Plan 02: Admin PIN Lockout Summary

**One-liner:** Shipped `src/main/adminPinLockout.js` — a pure, dependency-injected wrapper around `adminPin.verifyPin` that adds a persistent rolling-window rate-limit lockout (5 failed attempts inside 60 s → 5-minute lockout), crash-resistant via electron-store, with a timing-side-channel-safe lockout short-circuit.

## What Shipped

### New Module: `src/main/adminPinLockout.js` (Task 1)

Exports:

- `verifyPinWithLockout(store, pin)` → `{ ok: boolean, locked: boolean, lockedUntil: Date|null }`
- `_WINDOW_MS = 60_000`
- `_MAX_ATTEMPTS = 5`
- `_LOCKOUT_MS = 300_000`
- `_STORE_KEY = 'adminPinLockout'`

Behavior:

1. Reads persisted `{attempts:number[], lockedUntil:string|null}` from `store.get('adminPinLockout')` (defaults cleanly to empty).
2. If `lockedUntil > now`: short-circuits with `{ok:false, locked:true, lockedUntil:Date}` **without** calling `adminPin.verifyPin` (T-05-10 timing side-channel mitigation).
3. Prunes attempts older than `WINDOW_MS`; clears any expired `lockedUntil`.
4. Delegates to `adminPin.verifyPin(store, pin)` (Phase 3 scrypt + timingSafeEqual).
5. On success: `store.set('adminPinLockout', {attempts:[], lockedUntil:null})` — full reset per D-11.
6. On failure: pushes `now` to attempts; if `attempts.length >= MAX_ATTEMPTS`, latches `lockedUntil = now + LOCKOUT_MS`; writes state **before** returning (T-05-08 crash-resistance per RESEARCH Pitfall 3).

Module is pure: no `require('electron')`, no module-scoped mutable state, no globals. All state lives in the injected `store`.

### Unit Tests: `test/adminPinLockout.test.js` (Task 2)

10 tests using only `node:test` + `node:assert`. `adminPin.verifyPin` is stubbed via `require.cache` override so each test drives ok/fail deterministically without constructing real scrypt records. Store stub is a `Map`-backed object that deep-clones on `set` to simulate JSON persistence.

Cases:

1. Constants: `MAX_ATTEMPTS=5`, `WINDOW_MS=60_000`, `LOCKOUT_MS=300_000`
2. Happy path — first-try correct PIN → `{ok:true, locked:false, lockedUntil:null}` + clean persisted state
3. Single failure — `attempts.length == 1`, `locked:false`
4. 5 consecutive failures — trips lockout on the 5th, `lockedUntil` ISO string ~5 min in the future
5. While locked — subsequent calls return `locked:true` and **never** invoke `adminPin.verifyPin` (asserts `verifyCallCount` delta = 0)
6. Crash+restart persistence — shared store across "sessions" preserves lockout
7. Expired lockout + correct PIN — returns `ok:true` and clears state; `adminPin.verifyPin` IS called
8. Rolling window pruning — 4 stale (70 s old) attempts + 1 new fresh → `attempts.length == 1`, not locked
9. Mid-window success reset — 3 failures then success → counter fully cleared
10. Per-attempt write — 4 failures → 4 store writes (no batching)

## Verification

| Check | Result |
|---|---|
| `node --check src/main/adminPinLockout.js` | PASS |
| Exports: `verifyPinWithLockout`, `_WINDOW_MS=60000`, `_MAX_ATTEMPTS=5`, `_LOCKOUT_MS=300000` | PASS |
| No `require('electron')` in adminPinLockout.js | PASS |
| `git diff --stat src/main/adminPin.js` empty (Phase 3 contract preserved) | PASS |
| `node --test test/adminPinLockout.test.js` | 10/10 PASS |
| Full suite `node --test "test/**/*.test.js"` | 230/230 PASS (was 220, +10 new) |

## Threat Model Coverage

All `mitigate` rows from the plan threat register have unit-test backing:

| Threat | Mitigation | Test |
|---|---|---|
| T-05-07 (brute-force PIN) | 5-attempt cap + 5-min lockout | `5 consecutive failures trip lockout on the 5th` |
| T-05-08 (kill-process counter reset) | Store write before return on each failed attempt | `store write happens on EVERY failed attempt` + `lockout persists across wrapper calls with shared store` |
| T-05-10 (timing side-channel during lockout) | Skip `adminPin.verifyPin` entirely while locked | `while locked: ... without calling adminPin.verifyPin` (asserts `verifyCallCount` unchanged) |

Accepted threats (T-05-09 serialised IPC, T-05-11 disk tampering, T-05-12 audit trail) documented in plan and carried forward.

## Deviations from Plan

**None.** Plan 05-02 executed exactly as written. The implementation code block in Task 1's `<action>` was used verbatim, and the 10-test suite in Task 2's `<action>` was used verbatim.

## Commits

| Task | Type | Hash | Message |
|---|---|---|---|
| 1 | feat | `adea44d` | add adminPinLockout wrapper with rolling window and 5-min lockout |
| 2 | test | `538a303` | add 10 unit tests for adminPinLockout wrapper |

## Test Output (abridged)

```
✔ constants: MAX_ATTEMPTS=5, WINDOW_MS=60000, LOCKOUT_MS=300000
✔ happy path: first-try correct PIN returns ok:true, locked:false
✔ single failure: ok:false, locked:false, attempts=[t]
✔ 5 consecutive failures trip lockout on the 5th
✔ while locked: subsequent calls return locked:true without calling adminPin.verifyPin
✔ lockout persists across wrapper calls with shared store (simulates crash+restart)
✔ correct PIN after lockout expiry returns ok:true and clears state
✔ attempts outside 60s window are pruned
✔ successful PIN fully resets counter mid-window
✔ store write happens on EVERY failed attempt (no batching)
ℹ tests 10   pass 10   fail 0
```

## Gotchas Hit

None. The `require.cache` stub + Map-backed store pattern from earlier Phase 3/4 tests ported directly.

## Known Stubs

None. The "stubs" in the test file are the intentional `adminPin.verifyPin` fake — that is test infrastructure, not shipped code.

## Next Plan

Plan 05-03: Update gate & session hook. Plan 04 will import `verifyPinWithLockout` and wire it to `ipcMain.handle('verify-admin-pin')`, emitting `log.audit('pin.verify', ...)` and `log.audit('pin.lockout', ...)` at the call site per the plan's deliberate separation of audit-emission from pure state logic.

## Self-Check: PASSED

- `src/main/adminPinLockout.js` — FOUND
- `test/adminPinLockout.test.js` — FOUND
- `src/main/adminPin.js` — FOUND and UNMODIFIED (zero diff)
- Commit `adea44d` — FOUND in `git log`
- Commit `538a303` — FOUND in `git log`
- `node --check` clean
- 10/10 plan-local tests green, 230/230 full suite green
