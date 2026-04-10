---
phase: 04-nfc-input-idle-session-lifecycle
plan: 03
subsystem: main-process-wire-up
tags: [electron, main-process, wire-up, ipc, integration, phase-4, wave-2]
wave: 2
requires: [04-01, 04-02]
provides:
  - "host-wc attachBadgeInput"
  - "magicline-wc attachBadgeInput (two-attach pattern)"
  - "start-idle-timer side-effect on CASH_REGISTER_READY"
  - "sessionReset init wiring from main.js"
  - "idleTimer init wiring from main.js"
  - "crash → sessionReset.hardReset bridge (clean-exit guarded)"
  - "5-entry preload IPC surface for idle overlay + reset-loop recovery"
affects: [04-04, 04-05]
tech-stack:
  added: []
  patterns:
    - "Two-attach pattern (Pattern 1 from RESEARCH): listeners installed on BOTH host wc and Magicline child wc"
    - "Lazy require inside handlers to avoid circular deps (idleTimer, sessionReset, badgeInput)"
    - "Strict payload context check for admin-recovery pin-ok branch (T-04-17 mitigation)"
    - "clean-exit guard on render-process-gone to avoid recovery loop during normal shutdown (research pin #6)"
key-files:
  created: []
  modified:
    - src/main/authFlow.js
    - src/main/magiclineView.js
    - src/main/main.js
    - src/main/preload.js
    - test/authFlow.test.js
decisions:
  - "D-08: start-idle-timer side-effect is emitted from BOTH CASH_REGISTER_READY reducer branches (BOOTING and LOGIN_SUBMITTED) so the idle timer arms regardless of whether Magicline served a cached session or required login"
  - "D-19 reset-loop pin-ok: new ipcMain.on('pin-ok') handler is safe to add because Phase 3 pin flow uses ipcMain.handle('verify-pin') — different channel, zero collision risk. Strict context:'reset-loop' check is the gate."
  - "Executor lazy-requires idleTimer inside the 'start-idle-timer' case (not at file top) to preserve the reducer-purity boundary and avoid any future circular-dep risk"
metrics:
  duration: ~25min
  tasks: 3
  files-modified: 5
  tests-added: 3 (reducer) + 0 regression
  tests-passing: 89/89 across 4 suites
  completed: 2026-04-10
requirements: [NFC-01, NFC-05, NFC-06, IDLE-04, IDLE-07]
---

# Phase 4 Plan 03: Main-Process Wire-Up Summary

Surgical extension plan that lights up Plans 04-01 (badgeInput + idleTimer) and 04-02 (sessionReset) inside the existing main process. Four files touched, all additive. Zero behavioural changes to Wave-1 contracts.

## One-liner

Integrates badge-input arbitration, idle timer, session reset, and admin reset-loop recovery into the four main-process files (authFlow / magiclineView / main / preload) via the two-attach pattern, a new CASH_REGISTER_READY side-effect, and five new IPC surface entries.

## Deviations from Plan

None — plan executed exactly as written. Minor documentation notes below clarify intent.

## Line-number Reference (for drift audits)

### src/main/main.js
- **Line 136:** `attachLockdown(mainWindow.webContents)` (Phase 1, unchanged)
- **Line 140:** `const { attachBadgeInput } = require('./badgeInput');` (Phase 4 Plan 03)
- **Line 141:** `attachBadgeInput(mainWindow.webContents)` (Phase 4 Plan 03)
- **Listener order invariant:** lockdown (136) precedes badgeInput (141) — D-02 satisfied.
- **sessionReset.init + idleTimer.init:** immediately after `const store = ...` and BEFORE `createMagiclineView(mainWindow, store)`.
- **New ipcMain.on handlers:** idle-dismissed, idle-expired, request-reset-loop-recovery, pin-ok — placed inside the Phase 2 try block before `launch-touch-keyboard`.

### src/main/magiclineView.js
- **Line 172:** `attachLockdown(magiclineView.webContents)` (Phase 2, unchanged)
- **Line 177:** `const { attachBadgeInput } = require('./badgeInput');` (Phase 4 Plan 03)
- **Line 178:** `attachBadgeInput(magiclineView.webContents)` (Phase 4 Plan 03)
- **Listener order invariant:** lockdown (172) precedes badgeInput (178) — D-02 satisfied.
- **KNOWN_EVENT_TYPES:** 3 new entries appended (product-search-focused, product-search-blurred, activity).
- **handleInjectEvent:** 3 new type branches appended after login-detected/login-submitted, each with try/catch + log.error on failure.
- **render-process-gone:** extended from log-only to log + `sessionReset.hardReset({reason:'crash'})` with `details.reason === 'clean-exit'` guard on line 214 (research pin #6).

## Key Contracts Honoured

| Contract | Holder | Verification |
|----------|--------|--------------|
| Two-attach pattern (Pattern 1) | main.js + magiclineView.js | grep confirms `attachBadgeInput` called on both host wc and Magicline child wc |
| Lockdown-before-badgeInput (D-02) | Both files | Line-number assertions above |
| Reducer purity (D-08) | authFlow.js | side-effect is plain data `{kind:'start-idle-timer'}`; executor does lazy require |
| No modification of Wave-1 files | badgeInput.js, idleTimer.js, sessionReset.js | `git diff` shows zero changes to these files |
| clean-exit guard (research pin #6) | magiclineView.js line 214 | prevents recovery loop on normal shutdown |
| Strict context on pin-ok (T-04-17) | main.js pin-ok handler | `payload && payload.context === 'reset-loop'` check |
| Phase 3 pin-ok flow preserved | authFlow → verify-pin invoke | Phase 3 uses ipcMain.handle('verify-pin'); new pin-ok listener is on a different channel — no collision |

## pin-ok Handler Note (D-19)

Phase 3's PIN verification flow uses `ipcMain.handle('verify-pin', ...)` → `authFlow.handlePinAttempt`, which emits `pin-ok` / `pin-bad` internally as state-machine events (NOT as ipcMain channels). There was therefore no pre-existing `ipcMain.on('pin-ok')` handler to preserve. The new Plan 03 `ipcMain.on('pin-ok')` handler is additive and strictly gated on `payload.context === 'reset-loop'`; any call without that context falls through to a `log.warn` no-op. Future plans that need to piggyback on this channel must honour the context check.

## IPC Surface Additions (preload.js)

All five entries are in the existing `contextBridge.exposeInMainWorld('kiosk', {...})` object:

| Direction | Entry | Channel |
|-----------|-------|---------|
| main → renderer | `onShowIdleOverlay(cb)` | `show-idle-overlay` |
| main → renderer | `onHideIdleOverlay(cb)` | `hide-idle-overlay` |
| renderer → main | `notifyIdleDismissed()` | `idle-dismissed` |
| renderer → main | `notifyIdleExpired()` | `idle-expired` |
| renderer → main | `requestResetLoopRecovery()` | `request-reset-loop-recovery` |

All fire-and-forget, zero payload (T-04-14 mitigation — no `require`/`fs`/`electron` surface).

## Test Results

```
node --test test/authFlow.test.js test/sessionReset.test.js test/badgeInput.test.js test/idleTimer.test.js
tests 89 | pass 89 | fail 0
```

3 new reducer tests added to test/authFlow.test.js:
1. `BOOTING + cash-register-ready emits {kind:"start-idle-timer"} side-effect (Phase 4 D-08)`
2. `LOGIN_SUBMITTED + cash-register-ready emits {kind:"start-idle-timer"} side-effect (Phase 4 D-08)`
3. `non-cash-register-ready events do NOT emit start-idle-timer (Phase 4 D-08)`

All 4 existing test suites (authFlow, sessionReset, badgeInput, idleTimer) pass with zero regressions.

## Commits

- `c10b5ea` test(04-03): add failing tests for start-idle-timer side-effect (TDD RED)
- `df27237` feat(04-03): emit start-idle-timer side-effect on CASH_REGISTER_READY (TDD GREEN)
- `02bb7c2` feat(04-03): wire badgeInput + idleTimer + sessionReset into magiclineView
- `350af67` feat(04-03): wire host badgeInput + sessionReset/idleTimer init + IPC surface

## Known Stubs

None. All wired paths are real — the remaining cosmetic gap is the renderer-side idle overlay DOM itself, which is the explicit scope of plan 04-04.

## Next

Plan 04-04 (Wave 2, parallel sibling of 04-03) owns the renderer/inject side: inject.js event emissions (product-search-focused/blurred/activity), host.html idle overlay markup, and `window.kiosk.onShowIdleOverlay` wiring in host.js. Plan 04-05 is the acceptance/regression pass.

## Self-Check: PASSED

- FOUND: src/main/authFlow.js (grep `'start-idle-timer'` → 3 hits: 2 reducer emissions + 1 executor case)
- FOUND: src/main/magiclineView.js (grep `attachBadgeInput(magiclineView.webContents)` → 1 hit at line 178)
- FOUND: src/main/magiclineView.js (grep `hardReset({ reason: 'crash' })` → 1 hit)
- FOUND: src/main/magiclineView.js (grep `details.reason === 'clean-exit'` → 1 hit at line 214)
- FOUND: src/main/main.js (grep `attachBadgeInput(mainWindow.webContents)` → 1 hit at line 141)
- FOUND: src/main/main.js (grep `require('./sessionReset').init` → 1 hit)
- FOUND: src/main/main.js (grep `require('./idleTimer').init` → 1 hit)
- FOUND: src/main/preload.js (5 new entries: onShowIdleOverlay, onHideIdleOverlay, notifyIdleDismissed, notifyIdleExpired, requestResetLoopRecovery)
- FOUND: commit c10b5ea (RED)
- FOUND: commit df27237 (GREEN)
- FOUND: commit 02bb7c2 (magiclineView)
- FOUND: commit 350af67 (main + preload)
- TESTS: 89/89 passing across 4 suites
