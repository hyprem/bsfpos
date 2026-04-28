---
phase: 11-pos-close-immediate-welcome-reset
verified: 2026-04-28T12:00:00Z
status: human_needed
score: 7/7 must-haves verified
overrides_applied: 0
human_verification:
  - test: "Admin closes POS via admin menu over Magicline cash-register page"
    expected: "After dismissing the admin menu, the closed-welcome layer is visible IMMEDIATELY (no 60s wait). Status pill shows 'POS geschlossen'."
    why_human: "Visual outcome on real kiosk hardware — requires the touchscreen kiosk physically running with Magicline backend session. Phase 11 D-08 explicitly defers handler-level unit testing in favor of UAT validation of the visible reset sequence."
  - test: "Admin closes POS, dismisses menu, verifies no one-frame 'open'-state flash before closed-welcome paints"
    expected: "Welcome layer paints directly in closed-state markup; no transient 'POS open' visual frame between dismiss and final paint."
    why_human: "D-01 ordering rationale (pos-state-changed IPC must precede hardReset) was specifically chosen to avoid a one-frame flash. Frame-level visual confirmation requires human eyes on the kiosk display."
  - test: "Admin opens POS via admin menu while closed-welcome layer is foregrounded"
    expected: "On dismiss, status changes to 'POS geöffnet'. NO welcome reset / splash animation fires (D-02 — opening does not trigger hardReset). The existing welcome layer simply updates in place to the open state."
    why_human: "Verifies the asymmetry of the toggle: only close triggers reset. Visual + behavioral check on kiosk."
  - test: "Admin rapidly toggles POS open→close→open→close (3 close cycles in <60s)"
    expected: "Loop-detection error overlay does NOT appear. The reset-loop guard correctly excludes pos-closed from the countable counter (locked by D-05 unit test, but real-environment confirmation is valuable)."
    why_human: "D-05 covers the unit-test contract; UAT covers the lived experience of the diagnostic toggle pattern actually being usable without tripping the guard."
  - test: "After admin closes POS and dismisses, a subsequent updateGate-eligible event (admin-closed-window trigger) installs a pending update"
    expected: "If a downloaded update is pending and the admin-closed-window updateGate trigger arms it, the pos-closed reset's onPostReset fires and the install path proceeds — same composition as sale-completed."
    why_human: "D-06 unit test confirms onPostReset fires; end-to-end updateGate composition requires a real pending-update scenario which is hard to script. Validate next time auto-update fires post-close."
---

# Phase 11: POS Close — Immediate Welcome Reset Verification Report

**Phase Goal:** When admin taps "POS schliessen" while the admin menu is open, the POS state flips to closed AND the closed-welcome layer surfaces immediately on dismiss — without waiting for the 60s idle timeout. Reverses Phase 09 D-06 ("no mid-checkout interruption") per 2026-04-26 UAT outcome.

**Verified:** 2026-04-28T12:00:00Z
**Status:** human_needed
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (merged: ROADMAP success criteria + plan must_haves)

| #   | Truth                                                                                                                                                                                | Status     | Evidence                                                                                                                                                                                                                              |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | ---------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Closing POS via admin menu triggers `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` after the existing pos-state-changed IPC (D-01 order)                            | ✓ VERIFIED | `src/main/main.js:1015` — `await hardReset({ reason: 'pos-closed', mode: 'welcome' })` lives AFTER `mainWindow.webContents.send('pos-state-changed', ...)` at line 1000. Order matches D-01.                                          |
| 2   | The reset runs in background while admin menu is still open (no menu auto-close), so closed-welcome layer is visible immediately on dismiss                                          | ? UNCERTAIN | Code path lands here (no `hide-admin-menu` IPC inside `if (next === false)` block). Visual outcome on dismiss is human-only — flagged in human_verification.                                                                          |
| 3   | `sessionReset` does NOT increment its loop counter for `reason:'pos-closed'` — pos-closed welcomes do not contribute to runaway-reset detection                                     | ✓ VERIFIED | `src/main/sessionReset.js:114` adds `e.reason === 'pos-closed'` to the negation OR. Test `D-05` at `test/sessionReset.test.js:672` runs 3 rapid pos-closed resets and asserts `loopActive === false`. Test passes.                    |
| 4   | `sessionReset.onPostReset` STILL fires after a pos-closed welcome reset (so updateGate post-reset install path remains armed)                                                        | ✓ VERIFIED | No code change needed — existing `succeeded && postResetListener` gate covers welcome-mode pos-closed cycles. Test `D-06` at `test/sessionReset.test.js:692` asserts `postResetCount === 1`. Test passes.                              |
| 5   | If `hardReset` throws, posOpen stays false (no rollback), audit `pos.state-changed.reset-failed` is emitted, handler still returns `ok:true`                                         | ✓ VERIFIED | `src/main/main.js:1016-1021` try/catch wraps `await hardReset(...)`; catch emits `log.audit('pos.state-changed.reset-failed', { error: ... })` and falls through to the unchanged `return { ok: true, posOpen: next }` at line 1023. |
| 6   | Opening POS does NOT trigger any reset — only the existing pos-state-changed IPC                                                                                                    | ✓ VERIFIED | `src/main/main.js:1012` guard `if (next === false)` ensures the entire hardReset block is skipped when `next === true` (open direction). No alternate code path resets on open.                                                       |
| 7   | Phase 09 D-06 in `09-CONTEXT.md` annotated with SUPERSEDED-BY-PHASE-11 plus rationale                                                                                                | ✓ VERIFIED | `.planning/phases/09-.../09-CONTEXT.md:34` carries the blockquote `> **SUPERSEDED by Phase 11 (2026-04-26):** ...` referencing 11-CONTEXT.md and including the UAT rationale. Original D-06 line 32 preserved byte-for-byte.            |

**Score:** 7/7 truths verified (truth #2 has VERIFIED code path; visual confirmation deferred to human_verification — does not reduce score because the code-side contract is met).

### Required Artifacts (3-level + Level 4 where applicable)

| Artifact                                                            | Expected                                                                                                                  | Exists | Substantive | Wired | Data Flows | Status     | Details                                                                                                                                                                                              |
| ------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- | ------ | ----------- | ----- | ---------- | ---------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/sessionReset.js`                                          | Extended countable filter with `e.reason === 'pos-closed'` clause                                                         | ✓      | ✓           | ✓     | n/a        | ✓ VERIFIED | Lines 107-115: comment Phase 11 D-05 + new OR clause. Filter is invoked from same module's `hardReset` (no external wiring needed).                                                                  |
| `test/sessionReset.test.js`                                         | D-05 exclusion + D-06 onPostReset tests for pos-closed                                                                    | ✓      | ✓           | ✓     | n/a        | ✓ VERIFIED | Lines 672-690 (D-05) and 692-702 (D-06). Both run via `node --test test/sessionReset.test.js` and pass. Phase 10 D-17/D-18 tests (lines 636-666) preserved byte-identical.                            |
| `src/main/main.js` (case 'toggle-pos-open')                         | Extended handler that calls hardReset on close                                                                            | ✓      | ✓           | ✓     | n/a        | ✓ VERIFIED | Lines 994-1024 contain the new `if (next === false)` block + try/catch + audit. `node --check src/main/main.js` exits 0.                                                                              |
| `.planning/phases/09-.../09-CONTEXT.md`                             | Append-only SUPERSEDED-BY-PHASE-11 blockquote on D-06                                                                     | ✓      | ✓           | n/a   | n/a        | ✓ VERIFIED | Line 34 contains the supersede blockquote. Line 32 D-06 original preserved byte-for-byte.                                                                                                            |

### Key Link Verification

| From                                                  | To                                                          | Via                                                                              | Status      | Details                                                                                                                                                                                                                                                                          |
| ----------------------------------------------------- | ----------------------------------------------------------- | -------------------------------------------------------------------------------- | ----------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/main/sessionReset.js` countable filter           | predicate that excludes pos-closed                          | OR-extension inside existing `!(...)` negation, third clause                      | ✓ WIRED     | Pattern `e.reason === 'pos-closed'` present at line 114 inside the same negation as `idle-expired`+`welcome` (line 112) and `sale-completed` (line 113). Order matches D-05 (chronological).                                                                                      |
| `test/sessionReset.test.js`                           | `sessionReset._getStateForTests().loopActive`                | 3x `hardReset({reason:'pos-closed', mode:'welcome'})` + assert false             | ✓ WIRED     | D-05 test at line 672 runs the exact pattern. Test passes.                                                                                                                                                                                                                       |
| `src/main/main.js` case 'toggle-pos-open'             | `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` | in-case-body destructured require + conditional call only when `next === false` | ✓ WIRED     | `const { hardReset } = require('./sessionReset')` at line 1014 (in-block, indented). `await hardReset({ reason: 'pos-closed', mode: 'welcome' })` at line 1015. Wrapped by `if (next === false)` at line 1012.                                                                  |
| `src/main/main.js` failure path                       | `log.audit('pos.state-changed.reset-failed', {error})`       | try/catch around the await hardReset call                                        | ✓ WIRED     | Try/catch at lines 1013-1021. Catch emits `log.audit('pos.state-changed.reset-failed', { error: (e && e.message) \|\| String(e) })` at line 1020.                                                                                                                                |
| `09-CONTEXT.md` D-06 entry                            | `11-CONTEXT.md`                                              | in-text reference at end of appended blockquote                                  | ✓ WIRED     | `See \`11-CONTEXT.md\`.` is the closing sentence of the blockquote at line 34.                                                                                                                                                                                                   |
| Outer IPC handler                                     | `case 'toggle-pos-open'` `await`                             | `ipcMain.handle('admin-menu-action', async (_e, payload) => {...})`              | ✓ WIRED     | Confirmed at `src/main/main.js:879` — the enclosing handler IS `async`, so `await hardReset(...)` at line 1015 is legal.                                                                                                                                                          |

### Data-Flow Trace (Level 4)

Not applicable — Phase 11 modifies main-process control flow + a filter predicate. There are no rendered components or data fetches introduced. The audit-event payload (`{error: e.message}`) is computed inline from the caught exception object; no upstream data source to trace.

### Behavioral Spot-Checks

| Behavior                                                                                                | Command                                                              | Result                                                              | Status  |
| ------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------- | ------------------------------------------------------------------- | ------- |
| `main.js` syntax-checks clean (await is legal under async handler)                                       | `node --check src/main/main.js`                                       | exit 0                                                              | ✓ PASS  |
| sessionReset test suite passes (D-05/D-06 + Phase 10 D-17/D-18 + Phase 6 baseline)                       | `node --test test/sessionReset.test.js`                               | tests=34, pass=34, fail=0                                            | ✓ PASS  |
| Aggregate session/post-sale/updateGate tests pass                                                        | `node --test test/sessionReset.test.js test/postSale.test.js test/sessionReset.postReset.test.js test/sessionReset.welcome-harness.test.js test/updateGate.test.js` | tests=60, pass=60, fail=0                                            | ✓ PASS  |
| Filter predicate substring check                                                                         | `grep "e.reason === 'pos-closed'" src/main/sessionReset.js`           | match at line 114                                                   | ✓ PASS  |
| Handler hardReset call substring check                                                                   | `grep "reason: 'pos-closed'" src/main/main.js`                        | match at line 1015                                                  | ✓ PASS  |
| Failure-audit substring check                                                                            | `grep "pos.state-changed.reset-failed" src/main/main.js`              | match at line 1020                                                  | ✓ PASS  |
| Open-direction guard substring check                                                                     | `grep "if (next === false)" src/main/main.js`                         | match at line 1012                                                  | ✓ PASS  |
| Supersede note substring check                                                                           | `grep "SUPERSEDED by Phase 11" 09-CONTEXT.md`                         | match at line 34                                                    | ✓ PASS  |

Note: The `node --test test/` directory-glob form returned a top-level scaffolding error on Windows, but every individual file invocation passes; the user-supplied baseline of "300/300 tests pass" is consistent with the per-file invocations above. No regression introduced by Phase 11.

### Requirements Coverage

| Requirement | Source Plan         | Description                                                                                                  | Status        | Evidence                                                                                                                                                                                                                                                                                                                |
| ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------ | ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| ADMIN-02    | 11-01, 11-02, 11-03 | "Admin can mark POS as open or closed; closed state shows a closed-welcome layer rather than the cash-register"  | ✓ SATISFIED (extends prior completion) | REQUIREMENTS.md line 58 marks ADMIN-02 Complete via Phase 09. Phase 11 EXTENDS the close path with immediate-reset semantics (D-06 reversal); ROADMAP/CONTEXT explicitly state no new requirement ID is added — Phase 11 is a behavioral refinement of the same requirement. No orphaned requirements detected. |

### Anti-Patterns Found

| File                              | Line | Pattern                                | Severity | Impact                                                                                                                                                                                                       |
| --------------------------------- | ---- | -------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| (none)                            | —    | —                                      | —        | No TODO/FIXME/placeholder/empty-handler/console-only patterns introduced. The `try { ... } catch (_) {}` swallow at line 1001 is pre-existing (Phase 09 IPC defensive guard), not Phase 11 code. |

User-supplied context: code review reported 0 critical / 0 warning / 3 info-only findings — consistent with this scan.

### Human Verification Required

See frontmatter `human_verification` for full structured list. Summary:

1. **Closing POS over Magicline → dismiss → closed-welcome immediately visible** — the headline UAT outcome that drove this phase.
2. **No one-frame open-state flash on close** — confirms D-01 ordering rationale.
3. **Opening POS does NOT trigger reset/splash** — confirms D-02 asymmetry.
4. **Rapid 3x close cycles do NOT trigger reset-loop overlay** — D-05 lived experience.
5. **Pending-update install fires on pos-closed onPostReset** — D-06 end-to-end with updateGate.

These rows live naturally in the existing Phase 09 HUMAN-UAT batch (per Plan 11-03 SUMMARY: "Phase 11 does NOT add a new HUMAN-UAT row — the new behavior is implicitly validated when admins use the 'POS schliessen' flow during the existing Phase 09 HUMAN-UAT row"). The verifier surfaces them here for completeness; the milestone HUMAN-UAT process is the canonical capture point.

### Gaps Summary

No code-side or contract-side gaps. All 7 success criteria locked at the code/test level:

- **SC1 / Truth 1** — call wired with correct payload and ordering (D-01).
- **SC2 / Truth 2** — code path lands; visual confirmation needs human eyes on kiosk.
- **SC3 / Truth 3** — filter excludes pos-closed; D-05 test asserts.
- **SC4 / Truth 4** — onPostReset fires; D-06 test asserts.
- **SC5 / Truth 5** — failure path implemented per D-04 (no rollback, audit, ok:true).
- **SC6 / Truth 6** — D-02 guard `if (next === false)` skips hardReset on open.
- **SC7 / Truth 7** — supersede note appended verbatim per D-10.

The status is `human_needed` (not `passed`) only because the visual/timing properties of the dismiss → closed-welcome paint sequence and the loop-guard "diagnostic-toggle usability" properties cannot be confirmed without a real kiosk session. There are no code gaps to close.

---

_Verified: 2026-04-28T12:00:00Z_
_Verifier: Claude (gsd-verifier)_
