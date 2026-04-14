---
phase: 07-locale-hardening-splash-auto-selection-race
plan: "03"
subsystem: inject+main
tags: [splash, sentinel, ipc, security, allowlist, SPLASH-01, LOCALE-01]
dependency_graph:
  requires: [07-01 LOCALE_STRINGS.de, 07-02 locale enforcement layers]
  provides: [markRegisterReady helper, emitAutoSelectResult helper, parseAutoSelectSentinel parser, register-selected ipcMain relay, welcomeTapPending gate, splash:hide-final forward]
  affects: [src/inject/inject.js (Plan 04 will call markRegisterReady), src/main/magiclineView.js, src/main/main.js, src/host/host.js (Plan 05 will handle splash:hide-final)]
tech_stack:
  added: []
  patterns: [console.log sentinel bridge (clone of BSK_AUDIT_SALE_COMPLETED pattern), Set-based allowlist for untrusted field clamping, one-shot idempotency guard (clone of readyEmitted pattern), node:test for unit testing]
key_files:
  created:
    - test/magiclineView.sentinel.test.js
  modified:
    - src/inject/inject.js
    - src/main/magiclineView.js
    - src/main/main.js
decisions:
  - "BSK_REGISTER_SELECTED_DEGRADED branch checked before BSK_REGISTER_SELECTED (else-if) to prevent substring double-fire (T-07-07)"
  - "parseAutoSelectSentinel falls back to 'unknown' on unrecognised values — distinguishes parse failure from actual auto-select failure in audit log"
  - "welcomeTapPending cleared on onPreReset so a hard reset mid-welcome-flow does not leave a stale flag that gates the next welcome path (T-07-06)"
  - "register-selected listener uses ipcMain.removeAllListeners before re-registering — prevents listener stacking on multiple app.whenReady calls in test harnesses"
metrics:
  duration_minutes: ~8
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 4
---

# Phase 07 Plan 03: Sentinel Bridge Infrastructure Summary

**One-liner:** Sentinel bridge plumbing — markRegisterReady/emitAutoSelectResult helpers in inject.js, allowlisted parseAutoSelectSentinel parser in magiclineView.js, and welcomeTapPending-gated splash:hide-final forward in main.js; all uncalled pending Plan 04 wire-up.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add markRegisterReady helper + sentinel emitters in inject.js | cfd3c4a | src/inject/inject.js |
| 2 | Catch sentinels in magiclineView.js + relay via ipcMain with allowlist parser + main.js welcomeTapPending gate | daf85b5 | src/main/magiclineView.js, src/main/main.js, test/magiclineView.sentinel.test.js |

## What Was Built

### Task 1 — inject.js (additions only, detectAndSelectRegister untouched)

Inserted immediately after the closing brace of `detectAndSelectRegister` (line 346):

- `var registerReadyEmitted = false` — one-shot idempotency guard cloned from the `readyEmitted` pattern at §209-229.
- `function markRegisterReady(opts)` — emits `BSK_REGISTER_SELECTED` or `BSK_REGISTER_SELECTED_DEGRADED` exactly once per page load. All try/catch swallowed.
- `function emitAutoSelectResult(result, step)` — emits `BSK_AUTO_SELECT_RESULT:<result>:<step>`. No idempotency requirement; each chain step may fire one line.
- `window.__bskiosk_markRegisterReady` / `window.__bskiosk_emitAutoSelectResult` — dev-mode handles for manual DevTools testing.

No call sites in this plan — Plan 04 wires them inside the rewritten `detectAndSelectRegister`.

### Task 2 — magiclineView.js (three edits)

**parseAutoSelectSentinel function (file-top scope):**
- `PHASE07_ALLOWED_RESULTS = new Set(['ok', 'fail', 'timeout'])` — result allowlist.
- `PHASE07_ALLOWED_STEPS = new Set([...8 values...])` — step allowlist.
- `parseAutoSelectSentinel(message)` — returns `{result, step}` with both fields clamped to their allowlists (unknown on mismatch), or null on missing prefix. Handles preceding noise (Chromium console prefixes).
- Exported via `module.exports` for unit testing.

**console-message listener extension:**
- `BSK_REGISTER_SELECTED_DEGRADED` → `ipcMain.emit('register-selected', null, { degraded: true })`
- `else if BSK_REGISTER_SELECTED` → `ipcMain.emit('register-selected', null, { degraded: false })`  
  DEGRADED checked first (else-if) to prevent T-07-07 double-fire.
- `BSK_AUTO_SELECT_RESULT:...` → `log.audit('auto-select.result', parsed)` with allowlisted fields.

**Unit tests (8/8 passing):** canonical ok/done, fail at step3, timeout/unknown, out-of-range result → unknown, out-of-range step → unknown, missing prefix → null, extra colon fields ignored, preceding noise accepted.

### Task 2 — main.js (three edits)

- `let welcomeTapPending = false` — module-scope flag at line 37, adjacent to `resetLoopPending`.
- `welcomeTapPending = true` — set inside `ipcMain.on('welcome:tap')` after sender validation, before `startLoginFlow()`.
- `ipcMain.on('register-selected')` — forwards to `mainWindow.webContents.send('splash:hide-final', { degraded })` only when `welcomeTapPending` is true; clears the flag on forward. Cold-boot / idle-recovery paths log at info level and return early (T-07-06 spoofing mitigation).
- `welcomeTapPending = false` — added as first statement inside the existing `onPreReset` callback so any hard reset mid-welcome-flow clears the stale flag.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All new code paths are structurally complete. The helpers are uncalled by design — Plan 04 wires them. The `splash:hide-final` IPC is emitted but has no handler on the host side until Plan 05 — this is intentional plumbing-first sequencing stated in the plan objective.

## Threat Surface Scan

All new surfaces were explicitly modelled in the plan's threat register:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: sentinel-allowlist | src/main/magiclineView.js | T-07-04 mitigated — result/step fields from Magicline main world are clamped to Set-based allowlists before reaching audit log |
| threat_flag: ipc-gate | src/main/main.js | T-07-06 mitigated — register-selected → splash:hide-final forward is gated by welcomeTapPending set only inside sender-validated welcome:tap handler |

No new network endpoints or auth paths introduced.

## Self-Check: PASSED

| Item | Result |
|------|--------|
| src/inject/inject.js contains markRegisterReady | FOUND |
| src/inject/inject.js contains BSK_REGISTER_SELECTED_DEGRADED | FOUND |
| src/inject/inject.js contains registerReadyEmitted | FOUND |
| src/main/magiclineView.js contains function parseAutoSelectSentinel | FOUND |
| src/main/magiclineView.js contains PHASE07_ALLOWED_RESULTS | FOUND |
| src/main/magiclineView.js exports parseAutoSelectSentinel | FOUND |
| src/main/magiclineView.js contains else-if BSK_REGISTER_SELECTED ordering | FOUND |
| src/main/main.js contains let welcomeTapPending = false | FOUND |
| src/main/main.js contains ipcMain.on('register-selected') | FOUND |
| src/main/main.js contains splash:hide-final | FOUND |
| test/magiclineView.sentinel.test.js | FOUND |
| node --test test/magiclineView.sentinel.test.js | 8/8 PASS |
| node --test test/logger.audit.test.js | 8/8 PASS (regression) |
| Commit cfd3c4a | FOUND |
| Commit daf85b5 | FOUND |
