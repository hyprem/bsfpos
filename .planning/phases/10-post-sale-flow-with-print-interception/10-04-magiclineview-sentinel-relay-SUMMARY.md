---
phase: 10-post-sale-flow-with-print-interception
plan: 04
subsystem: magicline-view
tags: [magicline-view, console-message, sentinel, ipc-relay, post-sale, phase-10]

requires:
  - phase: 10-03-inject-print-override-fallback
    provides: "inject.js emits BSK_PRINT_INTERCEPTED (window.print override) + BSK_POST_SALE_FALLBACK (cart-empty MutationObserver) sentinels on Magicline console"
  - phase: 10-05-main-post-sale-ipc-handlers
    provides: "ipcMain.on('post-sale:trigger') registered in main.js — dedupes via postSaleShown and calls startPostSaleFlow({trigger})"
provides:
  - "Two console-message sentinel branches in magiclineView.js relaying BSK_PRINT_INTERCEPTED and BSK_POST_SALE_FALLBACK to ipcMain.emit('post-sale:trigger', null, {trigger})"
  - "Completes the inject.js -> console.log -> magiclineView.js -> ipcMain -> main.js chain for post-sale triggering"
affects: [10-09-updategate-composition-test, 10-10-nsis-default-printer-runbook]

tech-stack:
  added: []
  patterns:
    - "Sentinel relay (plain if, not else-if) when no substring collision exists between adjacent sentinels"
    - "Inline lazy require('electron').ipcMain per branch (never hoisted to module scope) matching existing relay style"

key-files:
  created: []
  modified:
    - "src/main/magiclineView.js (+23 lines in the console-message handler; zero deletions)"

key-decisions:
  - "D-10-04-01: Both new branches use plain `if` (not `else if`). Verified via PATTERNS §magiclineView.js: BSK_PRINT_INTERCEPTED and BSK_POST_SALE_FALLBACK have no substring collision with each other or with existing sentinels, so no ordering guard is required (contrast with BSK_REGISTER_SELECTED_DEGRADED which MUST precede plain BSK_REGISTER_SELECTED via else-if)."
  - "D-10-04-02: No `webContents.on('-print', ...)` or `webContents.on('before-print', ...)` listener installed — per RESEARCH §1, the -print event is an undocumented internal Electron event (electron/electron#22796 wontfix) not present in Electron 41's public API. JS-level window.print override in inject.js is the approved replacement; this plan only extends the console-message relay to receive its sentinel."
  - "D-10-04-03: Inline `const { ipcMain } = require('electron')` inside each branch (matching the existing BSK_AUDIT_SALE_COMPLETED / BSK_REGISTER_SELECTED pattern byte-for-byte) — NOT hoisted to module scope. The swallow-catch around each require is the established failure-isolation convention."
  - "D-10-04-04: Trigger payload strings are verbatim `'print-intercept'` and `'cart-empty-fallback'` — these are the exact values main.js Plan 05's handler passes into `startPostSaleFlow({trigger})` and into `log.audit('post-sale.shown', {trigger})`."
  - "D-10-04-05: Channel name is the INTERNAL main-process relay `post-sale:trigger` (NOT the main->renderer `post-sale:show`). Plan 05's single ipcMain.on('post-sale:trigger') listener gates via postSaleShown and fans out `post-sale:show` to the host once."

patterns-established:
  - "Pattern: inject.js console.log('BSK_*') -> magiclineView.js console-message indexOf match -> ipcMain.emit(channel, null, payload) -> main.js ipcMain.on(channel) handler — fourth and fifth example in the codebase, structurally identical to the existing BSK_AUDIT_SALE_COMPLETED and BSK_REGISTER_SELECTED* relays"
  - "Pattern: plain `if` (not `else if`) for console-message branches whose sentinel names have no substring collision with each other or with existing sentinels — explicit comment in plan documents the collision analysis"

requirements-completed: [SALE-01]

duration: 1 min
completed: 2026-04-24
---

# Phase 10 Plan 04: magiclineView Sentinel Relay Summary

**Two console-message branches added to magiclineView.js relaying BSK_PRINT_INTERCEPTED + BSK_POST_SALE_FALLBACK sentinels to ipcMain.emit('post-sale:trigger', null, {trigger}) — closes the inject->console->main relay chain for the post-sale overlay without installing any nonexistent -print webContents listener.**

## Performance

- **Duration:** 1 min
- **Started:** 2026-04-24T06:35:04Z
- **Completed:** 2026-04-24T06:36:04Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Added two new console-message sentinel branches to `src/main/magiclineView.js` (23 additive lines, zero deletions)
- `BSK_PRINT_INTERCEPTED` branch relays to `ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' })`
- `BSK_POST_SALE_FALLBACK` branch relays to `ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' })`
- Both branches inserted at the exact location specified (AFTER BSK_REGISTER_SELECTED else-if closing brace, BEFORE the PHASE07_SENTINEL_PREFIX `if` block)
- Both branches use plain `if` (no substring collision between the two new sentinels, no collision with any existing sentinel)
- Zero `-print` and zero `before-print` webContents event listeners installed (per RESEARCH §1; verified via grep)
- Existing BSK_AUDIT_SALE_COMPLETED, BSK_REGISTER_SELECTED_DEGRADED else-if ordering, PHASE07_SENTINEL_PREFIX parser, `[BSK]` log forwarding, and `render-process-gone` handler all preserved byte-for-byte
- 40/40 existing tests still green (`node --test test/postSale.test.js test/sessionReset.test.js`)

## Task Commits

Each task was committed atomically:

1. **Task 1: Add BSK_PRINT_INTERCEPTED + BSK_POST_SALE_FALLBACK sentinel branches** — `f233656` (feat)

**Plan metadata:** (see final docs commit below)

## Files Created/Modified

- `src/main/magiclineView.js` — Added two console-message branches (23 additive lines between line 331 and the PHASE07_SENTINEL_PREFIX block at line 356 post-edit). No deletions. File grew 747 → 770 lines.

## Exact Inserted Block

Verbatim block inserted immediately after line 331 (the closing `}` of the `BSK_REGISTER_SELECTED` else-if) and before the `PHASE07_SENTINEL_PREFIX` `if` block:

```javascript
      // Phase 10 D-10 (revised per RESEARCH §1): window.print override primary
      // trigger. inject.js overrides window.print to emit this sentinel instead
      // of opening Chrome's print preview. The -print webContents event does
      // NOT exist in Electron 41's public API (electron/electron#22796 wontfix);
      // the JS-level override is the approved replacement.
      if (message && message.indexOf('BSK_PRINT_INTERCEPTED') !== -1) {
        try {
          const { ipcMain } = require('electron');
          ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
        } catch (_) { /* swallow */ }
      }

      // Phase 10 D-11: cart-empty-after-payment MutationObserver fallback.
      // Fires when inject.js observer detects cart non-zero->zero within 120s
      // of a 'Jetzt verkaufen' click (debounced 500ms inside inject.js).
      // Defense-in-depth if Magicline's print call bypasses window.print.
      if (message && message.indexOf('BSK_POST_SALE_FALLBACK') !== -1) {
        try {
          const { ipcMain } = require('electron');
          ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
        } catch (_) { /* swallow */ }
      }
```

Lines 333-354 of the file post-edit. Indentation (6 spaces) matches the existing sibling branches.

## Acceptance Criteria — Evidence Table

| # | Criterion | Command | Expected | Actual | Result |
|---|-----------|---------|----------|--------|--------|
| 1 | Contains `BSK_PRINT_INTERCEPTED` | `grep -c "BSK_PRINT_INTERCEPTED" src/main/magiclineView.js` | >= 1 | 1 | PASS |
| 2 | Contains `BSK_POST_SALE_FALLBACK` | `grep -c "BSK_POST_SALE_FALLBACK" src/main/magiclineView.js` | >= 1 | 1 | PASS |
| 3 | Contains `post-sale:trigger` | `grep -c "post-sale:trigger" src/main/magiclineView.js` | exactly 2 | 2 | PASS |
| 4 | Contains `trigger: 'print-intercept'` | `grep -c "trigger: 'print-intercept'" src/main/magiclineView.js` | 1 | 1 | PASS |
| 5 | Contains `trigger: 'cart-empty-fallback'` | `grep -c "trigger: 'cart-empty-fallback'" src/main/magiclineView.js` | 1 | 1 | PASS |
| 6 | No `-print` webContents listener | `grep -c "'-print'" src/main/magiclineView.js` | 0 | 0 | PASS |
| 7 | No `before-print` listener | `grep -c "'before-print'" src/main/magiclineView.js` | 0 | 0 | PASS |
| 8 | Syntax valid | `node --check src/main/magiclineView.js` | exit 0 | exit 0 | PASS |
| 9 | BSK_AUDIT_SALE_COMPLETED preserved | `grep -c "BSK_AUDIT_SALE_COMPLETED" src/main/magiclineView.js` | 1 | 1 | PASS |
| 10 | BSK_REGISTER_SELECTED_DEGRADED ordering preserved (DEGRADED `if` before plain `else if`) | `grep -n "BSK_REGISTER_SELECTED" src/main/magiclineView.js` | line 318 before line 323 | 318 DEGRADED `if`, 323 plain `else if` | PASS |
| 11 | render-process-gone handler preserved | `grep -c "render-process-gone" src/main/magiclineView.js` | >= 1 | 4 (handler + pattern strings) | PASS |
| 12 | Both new branches use plain `if` (not `else if`) | Visual diff inspection | plain `if` on both | both `if (message && message.indexOf('BSK_PRINT_INTERCEPTED')...` and `if (message && message.indexOf('BSK_POST_SALE_FALLBACK')...` start with plain `if` | PASS |

All 12 acceptance criteria PASS.

## No -print / before-print Listener — Confirmation

Per RESEARCH §1, the D-10 original `webContents.on('-print', ...)` path was replaced by the `BSK_PRINT_INTERCEPTED` sentinel relay because Electron 41's public API does not expose an `-print` event (electron/electron#22796 wontfix). This plan explicitly did NOT install any such listener. Verified:

```
$ grep -c "'-print'" src/main/magiclineView.js
0
$ grep -c "'before-print'" src/main/magiclineView.js
0
```

## Line Count Delta

- Pre-edit: 747 lines
- Post-edit: 770 lines
- Delta: +23 lines (15 code + 8 comment, zero deletions)

Breakdown:
- 5 comment lines for BSK_PRINT_INTERCEPTED preamble
- 6 code lines for BSK_PRINT_INTERCEPTED branch (`if` + `try` + `const require` + `ipcMain.emit` + `} catch (_) { ... }` + closing `}`)
- 1 blank separator line
- 3 comment lines for BSK_POST_SALE_FALLBACK preamble
- 6 code lines for BSK_POST_SALE_FALLBACK branch
- 2 additional blank separator lines (one leading, one trailing)

## DEGRADED Else-If Ordering Guard — Confirmed Preserved

The existing substring-collision guard for `BSK_REGISTER_SELECTED_DEGRADED` vs plain `BSK_REGISTER_SELECTED` is untouched. Verified via line-by-line grep:

```
315:      // DEGRADED must be checked first (else-if) — BSK_REGISTER_SELECTED is a
316:      // substring of BSK_REGISTER_SELECTED_DEGRADED and would double-fire
318:      if (message && message.indexOf('BSK_REGISTER_SELECTED_DEGRADED') !== -1) {
323:      } else if (message && message.indexOf('BSK_REGISTER_SELECTED') !== -1) {
```

The DEGRADED `if` at line 318 precedes the plain `else if` at line 323, preserving the Phase 07 T-07-07 double-fire mitigation exactly.

## Regression Test Results

```
$ node --test test/postSale.test.js test/sessionReset.test.js
...
ℹ tests 40
ℹ suites 0
ℹ pass 40
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ duration_ms 116.8503
```

40/40 tests green — zero regression from this plan.

## Decisions Made

- **D-10-04-01:** Both new branches use plain `if` (not `else if`). BSK_POST_SALE_FALLBACK is not a substring of BSK_PRINT_INTERCEPTED (and neither is a substring of any existing sentinel), so no ordering guard is required. Contrast with the BSK_REGISTER_SELECTED_DEGRADED / plain BSK_REGISTER_SELECTED pair which MUST use else-if.
- **D-10-04-02:** No `-print` / `before-print` webContents listener installed (RESEARCH §1 — event does not exist in Electron 41 public API).
- **D-10-04-03:** Inline `const { ipcMain } = require('electron')` inside each branch, matching the existing relay pattern byte-for-byte. Not hoisted to module scope.
- **D-10-04-04:** Trigger payload strings verbatim: `'print-intercept'` and `'cart-empty-fallback'`. These exact values are consumed by main.js Plan 05's listener.
- **D-10-04-05:** Channel is `post-sale:trigger` (INTERNAL main-process relay), not `post-sale:show` (main->renderer fanout).

## Deviations from Plan

None - plan executed exactly as written.

The inserted block matches the plan's `<action>` code block character-for-character (modulo line endings, which are CRLF consistent with the rest of the file).

## Issues Encountered

None.

## User Setup Required

None - no external service configuration required.

## Next Phase Readiness

- Phase 10 Plan 04 complete. The inject -> console -> magiclineView -> ipcMain -> main.js relay chain for the post-sale overlay is now fully wired on disk:
  - Plan 03 (inject.js): emits `BSK_PRINT_INTERCEPTED` via window.print override, emits `BSK_POST_SALE_FALLBACK` via cart-empty MutationObserver — already on disk (commits 9b7b906, e2d2ead).
  - Plan 04 (this plan): magiclineView.js relays both sentinels to `ipcMain.emit('post-sale:trigger', null, {trigger})` — DONE in commit f233656.
  - Plan 05 (main.js): ipcMain.on('post-sale:trigger') handler dedupes via postSaleShown and calls startPostSaleFlow — already on disk (commit 45ba282).
  - Plans 06/07 (host.html/css/js): overlay visual surface and lifecycle — already on disk.
  - Plan 08 (test/postSale.test.js): state machine tests — already on disk (commit c26261e).
- Remaining phase work: plan 09 updateGate composition test, plan 10 NSIS default printer runbook (code already on disk as commits 5833cd9/0f6cab9, awaits hardware verification checkpoint). Plans 03 and 10 remain parked at their hardware-verification checkpoints per STATE.md; code is in place.
- No blockers introduced by this plan.

## Self-Check: PASSED

- `src/main/magiclineView.js` exists on disk — FOUND
- Commit `f233656` present in git log — FOUND
- All 12 acceptance criteria PASS (table above)
- 40/40 regression tests still green
- Line count delta matches expected +23 lines
- CRLF line endings preserved (verified via `file` command)

---
*Phase: 10-post-sale-flow-with-print-interception*
*Completed: 2026-04-24*
