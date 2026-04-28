---
phase: 11
plan: 02
subsystem: main-ipc
tags: [main, ipc, admin-menu, session-reset, phase-11, pos-closed, toggle-pos-open]
requires:
  - phase: 09
    provides: case 'toggle-pos-open' handler with posOpen store + pos-state-changed IPC
  - phase: 10
    provides: lazy require('./sessionReset') inside handler bodies pattern (D-10-05-04)
  - phase: 11-01
    provides: countable filter exclusion for reason==='pos-closed' (D-05) + onPostReset firing for pos-closed welcome cycles (D-06)
provides:
  - "case 'toggle-pos-open' immediately calls hardReset({reason:'pos-closed', mode:'welcome'}) when next===false"
  - "Open direction (next===true) intentionally skips hardReset (D-02)"
  - "hardReset failure handled per D-04: posOpen stays false, audit pos.state-changed.reset-failed emitted, handler still returns ok:true"
affects:
  - src/main/main.js (toggle-pos-open case body +21 lines)
tech-stack:
  added: []
  patterns:
    - "destructured + scope-local require inside case body (D-03 — diverges from line-29 module-scope and lines-500/519 call-site member-access shapes)"
    - "store.set → audit → IPC → hardReset ordering (D-01: IPC must precede hardReset to avoid one-frame open flash)"
    - "no-rollback failure handling — admin intent preserved on internal hardReset failure (D-04)"
key-files:
  created: []
  modified:
    - src/main/main.js
key-decisions:
  - "D-01 ordering: store.set + pos.state-changed audit + pos-state-changed IPC ALL fire before hardReset; verified untouched in this commit"
  - "D-02 open-direction guard: only `if (next === false)` enters the hardReset branch — open path remains a pure IPC update"
  - "D-03 require shape: const { hardReset } = require('./sessionReset') destructured INSIDE the if-block — neither hoisted nor reused from the line-29 sessionResetMod module-scope import (intentional scope-locality / readability)"
  - "D-04 failure handling: try/catch wraps require + hardReset; on throw, posOpen NOT rolled back, audit pos.state-changed.reset-failed emitted with e.message (String(e) fallback), handler still returns ok:true"
  - "D-08 honored: NO new main.test.js test added — meaningful behavior is covered by Plan 11-01's sessionReset.test.js D-05/D-06"
  - "D-09 audit ordering preserved: pos.state-changed (existing line, untouched) → session.reset (from hardReset internals) → pos.state-changed.reset-failed only on failure path"
patterns-established:
  - "In-block destructured-require placement when the dependency is conditional and scope-local — sits immediately above the call site for readability"
requirements-completed: [ADMIN-02]
metrics:
  duration_seconds: 25
  completed: 2026-04-28
---

# Phase 11 Plan 02: toggle-pos-open hardReset Summary

**One-liner:** Extended `case 'toggle-pos-open'` in `src/main/main.js` to immediately call `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` after the existing `pos-state-changed` IPC when admin closes POS — surfacing the closed-welcome layer as soon as the admin dismisses the menu, without waiting for idle timeout.

## Performance

- **Duration:** ~25 seconds (working-tree implementation already present from prior aborted run; this run validated, committed, and documented it)
- **Started:** 2026-04-28T10:49:01Z
- **Completed:** 2026-04-28T10:49:26Z
- **Tasks:** 1
- **Files modified:** 1 (`src/main/main.js`)
- **Lines added:** +21 (within plan's +13 to +22 range)

## Accomplishments

- Closing POS via admin menu now immediately triggers `hardReset({reason:'pos-closed', mode:'welcome'})` — Phase 11 success criterion 1 satisfied.
- Opening POS does NOT trigger a reset — D-02 guard `if (next === false)` ensures asymmetry — Phase 11 success criterion 4 satisfied.
- Failure path is deterministic: posOpen stays false, audit `pos.state-changed.reset-failed` emitted, handler returns `ok:true` — D-04 satisfied.
- Pre-existing line-29 module-scope `const sessionResetMod = require('./sessionReset');` preserved untouched — no duplicate, no removal, no aliasing.
- Plan 11-01's 34/34 sessionReset.test.js tests still pass — no regression of the filter-exclusion or onPostReset-firing contracts that Plan 11-02 depends on.

## Task Commits

1. **Task 1: Extend toggle-pos-open handler to immediate-reset on close (D-01..D-04, D-09)** — `ef51d2c` (feat)

_Note: per D-08, no test commit was added for this plan. The meaningful behavior is regression-locked by Plan 11-01's `D-05` (filter exclusion) and `D-06` (onPostReset firing) tests in `test/sessionReset.test.js`._

## Before / After Diff

**Before** (`src/main/main.js` lines 994-1003, pre-Phase-11):

```javascript
case 'toggle-pos-open': {
  var current = store.get('posOpen', true);
  var next = !current;
  store.set('posOpen', next);
  log.audit('pos.state-changed', { open: next, reason: 'admin' });
  try {
    mainWindow.webContents.send('pos-state-changed', { posOpen: next });
  } catch (_) {}
  return { ok: true, posOpen: next };
}
```

**After** (`src/main/main.js` lines 994-1024, post-Phase-11-02):

```javascript
case 'toggle-pos-open': {
  var current = store.get('posOpen', true);
  var next = !current;
  store.set('posOpen', next);
  log.audit('pos.state-changed', { open: next, reason: 'admin' });
  try {
    mainWindow.webContents.send('pos-state-changed', { posOpen: next });
  } catch (_) {}
  // Phase 11 D-01..D-04: on close (next===false), immediately hardReset to
  // closed-welcome so the layer surfaces as soon as admin dismisses the menu.
  // Order matters: pos-state-changed IPC MUST be sent BEFORE hardReset so the
  // welcome layer DOM is in closed-state markup when welcome:show fires
  // (otherwise a one-frame "open" flash). Open direction (next===true) does
  // NOT reset — existing pos-state-changed update is sufficient (D-02).
  // D-03: destructured require lives INSIDE this block for scope-locality /
  // readability. The module is already eagerly loaded at module scope (line 29
  // `const sessionResetMod = require('./sessionReset')`), so this require is a
  // no-op import re-export — semantically free, organizationally clean.
  if (next === false) {
    try {
      const { hardReset } = require('./sessionReset');
      await hardReset({ reason: 'pos-closed', mode: 'welcome' });
    } catch (e) {
      // D-04: do NOT roll back posOpen. The store already shows false and
      // stays that way; admin's intent is preserved. The closed-welcome
      // layer will render at the next natural reset (idle/sale-completed).
      log.audit('pos.state-changed.reset-failed', { error: (e && e.message) || String(e) });
    }
  }
  return { ok: true, posOpen: next };
}
```

**Delta:** +21 lines (10 comment lines + 9 code lines + 2 closing brace lines). Existing 9 lines (case open, store ops, audit, IPC try/catch, return, case close) preserved byte-identical.

## Verification

### Automated checks (all passing)

| Check | Result |
|-------|--------|
| `node --check src/main/main.js` | exit 0 — syntax OK |
| `node --test test/sessionReset.test.js` | 34/34 pass (32 baseline + 2 new D-05/D-06 from Plan 11-01) |
| `grep -c "reason: 'pos-closed'" src/main/main.js` | 1 |
| `grep -c "if (next === false)" src/main/main.js` | 1 |
| `grep -c "pos.state-changed.reset-failed" src/main/main.js` | 1 |
| `grep -cE "^\s+const \{ hardReset \} = require\('\./sessionReset'\)" src/main/main.js` | 1 (in-block, indented — D-03 placement) |
| `grep -cE "^const \{ hardReset \}" src/main/main.js` | 0 (NOT hoisted to module scope — D-03 anti-hoist) |
| `grep -c "const sessionResetMod = require('./sessionReset')" src/main/main.js` | 2 — line 29 (preserved) + comment quote on line 1010 |
| `grep -c "case 'toggle-pos-open'" src/main/main.js` | 1 (existing case unchanged) |
| `grep -c "require('./sessionReset')" src/main/main.js` | 5 — line 29 + lines 500/519 (existing) + line 1014 (new in-block) + line 1010 (comment quote) |

The pre-existing `const sessionResetMod = require('./sessionReset');` on line 29 is preserved unchanged. The grep returns 2 because the comment block on line 1010 quotes that exact string for traceability — semantically there is still exactly ONE module-scope require statement.

### Acceptance criteria — Task 1

| Criterion | Result |
|-----------|--------|
| File contains `case 'toggle-pos-open':` (existing case present) | Yes |
| File contains `if (next === false)` (D-02 guard) | Yes |
| `const { hardReset } = require('./sessionReset')` is indented inside case body (NOT module column 0) | Yes — D-03 in-block |
| File contains `await hardReset({ reason: 'pos-closed', mode: 'welcome' })` | Yes — D-01 payload |
| File contains `'pos.state-changed.reset-failed'` | Yes — D-04 audit |
| `Phase 11 D-01` comment present above new block | Yes |
| Original `log.audit('pos.state-changed', ...)` preserved BEFORE new if-block | Yes — D-09 ordering |
| Original `mainWindow.webContents.send('pos-state-changed', ...)` preserved BEFORE new if-block | Yes — D-01 ordering |
| Original `return { ok: true, posOpen: next };` preserved AFTER new if-block (including failure path) | Yes — D-04 #3 |
| `node --check src/main/main.js` exit 0 (await legal because handler is async) | Yes |
| `node --test test/sessionReset.test.js` exit 0 | Yes (34/34) |
| No new file created, no other case in switch modified | Yes — surgical edit |
| Line count delta within +13 to +22 | +21 (within range) |

### Phase 11 success criteria coverage

- **Criterion 1** (closing POS triggers immediate hardReset): satisfied — case body now calls `hardReset({reason:'pos-closed', mode:'welcome'})` after store.set + pos-state-changed.send.
- **Criterion 2** (closed-welcome layer foregrounds on admin-menu dismiss): code path lands here; visual outcome verified at human UAT time.
- **Criterion 4** (opening POS does NOT trigger reset): satisfied — `if (next === false)` guard skips hardReset on open.
- **Criterion 5** (audit lines preserved + new failure-path audit): satisfied — existing `pos.state-changed` line untouched; new `pos.state-changed.reset-failed` only fires on the failure path.

## Decisions Made

All decisions sourced from `11-CONTEXT.md`. No new decisions introduced in this plan.

| Decision | Implementation |
|----------|----------------|
| D-01 — hardReset ordering | `await hardReset(...)` placed AFTER `store.set` AND AFTER the existing `mainWindow.webContents.send('pos-state-changed', ...)` |
| D-02 — open direction skip | `if (next === false)` guard wraps the entire hardReset block; `next === true` falls through to the unchanged return |
| D-03 — destructured in-block require | `const { hardReset } = require('./sessionReset');` inside the `if (next === false)` block (NOT hoisted, NOT reused from line-29 sessionResetMod) |
| D-04 — failure handling | `try { ... } catch (e) { log.audit('pos.state-changed.reset-failed', { error: (e && e.message) || String(e) }); }`; no posOpen rollback; return statement unchanged |
| D-08 — no main.test.js test | Honored — no test file created, no test file modified |
| D-09 — audit ordering | Preserved — existing `log.audit('pos.state-changed', ...)` line untouched; new failure-path audit only emits on catch |

## Deviations from Plan

None — the working-tree edit (placed by a prior aborted /gsd-execute-phase run) matched the plan's prescribed code byte-for-byte. This run's job was to validate, commit, and document the existing diff. No code changes were needed.

The earlier aborted run apparently:
- Wrote the correct +21 lines to `src/main/main.js`
- Did NOT commit
- Did NOT run automated checks
- Did NOT produce SUMMARY.md

This run completed those three remaining steps. Per D-08, no test was added for the toggle handler glue. Per the orchestrator instructions, Phase 09 docs (D-10 supersede note) are intentionally NOT touched here — that's Plan 11-03's scope.

## Threat Flags

None — the plan's `<threat_model>` (T-11-02-01..04, all LOW severity) covers the surface this code introduces. No new network endpoints, no new auth paths, no schema changes. The new audit event `pos.state-changed.reset-failed` writes only the JS error message string to the local audit log, consistent with the existing electron-log audit pattern.

## Self-Check: PASSED

- File `src/main/main.js` modified — confirmed (commit `ef51d2c`, +21 lines, no deletions).
- Commit `ef51d2c` exists in git log — confirmed via `git rev-parse --short HEAD`.
- All 34 tests pass under `node --test test/sessionReset.test.js` — confirmed (Plan 11-01's D-05/D-06 still locked, Phase 10 D-17/D-18 still locked, Phase 6 baseline still locked).
- `node --check src/main/main.js` exits 0 — confirmed.
- Line-29 `const sessionResetMod = require('./sessionReset');` preserved untouched — confirmed.
- No other case in the switch (`exit-to-windows`, `dev-mode`, etc.) modified — confirmed via `git diff` only touching the toggle-pos-open block.
- No test file added or modified (D-08 honored) — confirmed via `git status` clean post-commit.
- Phase 09 docs untouched (Plan 11-03's scope) — confirmed.
