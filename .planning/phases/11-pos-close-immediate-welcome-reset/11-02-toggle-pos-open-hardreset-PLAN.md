---
phase: 11-pos-close-immediate-welcome-reset
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/main.js
autonomous: true
requirements: [ADMIN-02]
tags: [main, ipc, admin-menu, session-reset, phase-11, pos-closed]
must_haves:
  truths:
    - "Tapping POS schliessen flips posOpen to false, sends pos-state-changed IPC, then calls hardReset({reason:'pos-closed', mode:'welcome'})"
    - "The hardReset call runs AFTER store.set AND AFTER pos-state-changed.send (D-01 ordering)"
    - "Tapping POS oeffnen does NOT call hardReset (D-02; existing pos-state-changed IPC is sufficient)"
    - "If hardReset throws, posOpen stays false (no rollback), audit pos.state-changed.reset-failed is emitted, handler returns ok:true (D-04)"
    - "sessionReset hardReset is destructured-required INSIDE the case body (D-03; for scope-locality and readability — module is already eagerly loaded at module scope line 29)"
    - "Audit ordering on close: pos.state-changed first, then session.reset (D-09)"
  artifacts:
    - path: "src/main/main.js"
      provides: "Extended toggle-pos-open handler that immediately resets to closed-welcome layer when closing"
      contains: "reason: 'pos-closed'"
  key_links:
    - from: "src/main/main.js case 'toggle-pos-open'"
      to: "src/main/sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})"
      via: "in-case-body destructured require + conditional call only when next === false"
      pattern: "hardReset.*pos-closed"
    - from: "src/main/main.js case 'toggle-pos-open' failure path"
      to: "log.audit('pos.state-changed.reset-failed', {error})"
      via: "try/catch around the await hardReset call"
      pattern: "pos.state-changed.reset-failed"
---

<objective>
Extend the `case 'toggle-pos-open':` handler in `src/main/main.js` to immediately call `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` when the toggle goes from open → closed, so the closed-welcome layer surfaces as soon as the admin dismisses the menu — without waiting for the 60s idle timeout. Reverses Phase 09 D-06 ("no mid-checkout interruption") per the 2026-04-26 UAT outcome.

Purpose: Per Phase 11 success criteria 1, 2, 4, 5 — closing POS triggers an immediate background reset that runs while the admin menu is open; opening POS does NOT reset; failure handling preserves the admin's intent (no rollback) and audits the deviation.

Decision coverage in this plan:
- D-01: hardReset call ordering (AFTER store.set AND AFTER pos-state-changed.send)
- D-02: open direction (next===true) does NOT call hardReset
- D-03: destructured require inside case body (NOT hoisted as a NEW module-scope import) — see context note: the module is already eagerly loaded at line 29 of main.js, so this is for scope-locality / readability, not circular-dep avoidance
- D-04: failure handling — no rollback, audit reset-failed, return ok:true
- D-08: no main.js handler unit test (sessionReset.test.js D-05/D-06 from Plan 11-01 covers the meaningful behavior)
- D-09: audit ordering — pos.state-changed BEFORE session.reset (existing) + reset-failed on failure path

Output: ~10-15 lines added inside the existing toggle-pos-open case body in `src/main/main.js`. No new files. No test file changes (per D-08).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/REQUIREMENTS.md
@.planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md
@.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@./CLAUDE.md

<interfaces>
<!-- Current case 'toggle-pos-open' body (src/main/main.js lines 994-1003,
     verified 2026-04-26). The Phase 11 extension wraps the existing logic
     and appends the hardReset call AFTER the existing pos-state-changed.send. -->

From src/main/main.js (lines 994-1003, current pre-Phase-11):
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

From src/main/sessionReset.js (hardReset signature):
```javascript
async function hardReset({ reason, mode } = {}) { ... }
// Returns: undefined on success or suppression, throws on internal failure.
// mode normalized: (mode === 'welcome') ? 'welcome' : 'reset'
```

Existing sessionReset require shapes in main.js (verified 2026-04-26 — note the mixed conventions):
- Line 29 (module scope, eagerly loaded): `const sessionResetMod = require('./sessionReset');`
- Lines 500, 519 (call-site, member access): `require('./sessionReset').hardReset(...)` / `require('./sessionReset').init(...)`

Phase 11 D-03 intentionally introduces a NEW shape — destructured + scoped to the case body:
```javascript
const { hardReset } = require('./sessionReset');
```
Rationale: the module is already eagerly loaded at line 29, so the require inside the case body is a no-op import re-export — semantically free. The destructured + in-block placement is for scope-locality and readability (the dependency declaration sits immediately above the call site, not 1000 lines away in the imports block). It is NOT a lazy-load for circular-dep avoidance — that distinction was a misread in earlier drafts; correct it here.

The `admin-menu-action` IPC handler containing this case is `async`, so `await` inside the case body is legal. Confirm by reading the surrounding `ipcMain.handle('admin-menu-action', async ...)` line above the `switch`.

The `log` and `store` references inside this case body are already in scope via closure from the outer handler — no new imports needed beyond the in-case-body destructured `sessionReset` require.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Extend toggle-pos-open handler to immediate-reset on close (D-01..D-04, D-09)</name>
  <read_first>
    - src/main/main.js (FULL `case 'toggle-pos-open':` block at lines 994-1003 + the surrounding `ipcMain.handle('admin-menu-action', async (...) =>` line above the switch — confirm the handler is `async` so `await` is legal)
    - src/main/main.js line 29: confirm the existing module-scope `const sessionResetMod = require('./sessionReset');` (NOTE: this means the module is already eagerly loaded — the D-03 in-case-body destructured require is for scope-locality, NOT circular-dep avoidance)
    - src/main/main.js lines 500 and 519: existing call-site `require('./sessionReset').xxx()` shape — Phase 11 D-03 intentionally diverges from BOTH this shape AND the line-29 module-scope shape, prescribing destructured `const { hardReset } = require('./sessionReset');` INSIDE the case body for readability
    - src/main/sessionReset.js (lines 73-130 — confirm hardReset signature and that throwing is possible from internal paths)
    - .planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md §Decisions D-01..D-04, D-09 (ordering, open-direction skip, in-case-body destructured require, failure handling, audit sequence) — note D-03's stated "circular-dep" rationale is moot per main.js line 29; the decision STANDS as scope-locality / readability convention
  </read_first>
  <files>src/main/main.js</files>
  <action>
Modify the `case 'toggle-pos-open':` block at lines 994-1003 of `src/main/main.js`. Keep the existing 8-line body intact and APPEND the new immediate-reset logic AFTER the existing `pos-state-changed.send` call and BEFORE the `return { ok: true, posOpen: next };` statement.

**Exact current code (lines 994-1003 — DO NOT delete or reorder these lines):**
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

**Exact target code (replace the entire case block above with):**
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

**Critical constraints:**
- The `const { hardReset } = require('./sessionReset')` MUST be inside the `if (next === false)` block (D-03 — destructured + scoped to the case body, NOT a NEW hoisted module-scope import). The pre-existing module-scope import on line 29 (`const sessionResetMod = require('./sessionReset');`) is UNTOUCHED — do NOT remove it, do NOT alias it, do NOT add a second one at module scope.
- The destructuring `const { hardReset } = require('./sessionReset')` is the prescribed Phase 11 shape — it intentionally differs from the line-29 non-destructured assignment AND from the lines-500/519 call-site member access. D-03 chose destructured + in-block placement for readability (the dependency sits right above the call site).
- `await hardReset(...)` requires the enclosing handler to be `async`. Verify the `ipcMain.handle('admin-menu-action', async (event, action) => { ... })` line above the switch IS `async` BEFORE saving — if not, the planner has misread the file and execution must stop and re-read.
- The try/catch wraps ONLY the require + hardReset call (the inner try). If `require('./sessionReset')` somehow throws, the catch will still run and emit `pos.state-changed.reset-failed` — acceptable: any require failure means the file is broken in a way the admin needs to see in audit, and posOpen still stays false so the admin's intent lands.
- The audit event name is `'pos.state-changed.reset-failed'` (period-separated, suffix `.reset-failed`) per D-04. Do NOT rename to `pos.reset-failed` or `session.reset-failed` — the event-name convention is decision-locked.
- The audit payload shape is `{ error: <message-string> }` — extracts `e.message` defensively (handles non-Error throws via the `String(e)` fallback).
- `return { ok: true, posOpen: next };` is UNCHANGED — even on hardReset failure (D-04 #3: handler returns ok:true because the admin-side intent landed; the renderer should NOT see the reset failure).
- D-02: the open direction (`next === true`) MUST NOT enter the if block — there is exactly one `if (next === false)` guard.
- D-09 audit ordering: `log.audit('pos.state-changed', ...)` fires FIRST (existing line, untouched), then sessionReset internally emits `idle.reset reason=pos-closed mode=welcome` SECOND (from the hardReset call), then on failure `pos.state-changed.reset-failed` fires THIRD. No reordering of the existing audit line.
- Do NOT add any NEW top-of-file `require`. The pre-existing line 29 module-scope import stays exactly as it is. The new in-case-body destructured require is the only new require statement, and it must live inside the if-block.
- Do NOT add any user-facing console.log or info logs beyond the audit call. Project comment-discipline applies: comments only where they encode a decision or pitfall.
- Do NOT modify any other case in the same switch (`exit-to-windows`, `dev-mode`, etc.) — surgical edit to one case only.
  </action>
  <verify>
    <automated>grep -q "reason: 'pos-closed'" src/main/main.js &amp;&amp; grep -q "if (next === false)" src/main/main.js &amp;&amp; grep -q "pos.state-changed.reset-failed" src/main/main.js &amp;&amp; grep -qE "^\s+const \{ hardReset \} = require\('\./sessionReset'\)" src/main/main.js &amp;&amp; node --test test/sessionReset.test.js &amp;&amp; node --check src/main/main.js</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `case 'toggle-pos-open':` (existing case still present)
    - File contains exact substring `if (next === false)` (D-02 guard — open direction skipped)
    - `grep -cE "^\s+const \{ hardReset \} = require\('\./sessionReset'\)" src/main/main.js` returns exactly 1 (verifies the destructured require lives indented inside the case body, NOT at module column 0 — D-03 in-block placement)
    - `grep -cE "^const \{ hardReset \}" src/main/main.js` returns 0 (verifies the destructured require is NOT hoisted to module scope — D-03 anti-hoist guard)
    - `grep -c "const sessionResetMod = require('./sessionReset')" src/main/main.js` returns exactly 1 (verifies the pre-existing line-29 module-scope import is preserved untouched — neither removed nor duplicated)
    - File contains exact substring `await hardReset({ reason: 'pos-closed', mode: 'welcome' })` (D-01 — exact reason + mode payload)
    - File contains exact substring `'pos.state-changed.reset-failed'` (D-04 audit event name)
    - File contains exact substring `Phase 11 D-01` in a comment above the new block (decision traceability)
    - The original line `log.audit('pos.state-changed', { open: next, reason: 'admin' });` is preserved UNCHANGED and appears BEFORE the new `if (next === false)` block (D-09 ordering)
    - The original line `mainWindow.webContents.send('pos-state-changed', { posOpen: next });` is preserved UNCHANGED and appears BEFORE the new `if (next === false)` block (D-01 ordering — IPC before hardReset)
    - The original `return { ok: true, posOpen: next };` is preserved UNCHANGED and appears AFTER the new `if (next === false)` block — including on the hardReset-failure path (D-04 #3)
    - `grep -c "require('./sessionReset')" src/main/main.js` — value MUST equal pre-edit count + 1 (the new in-case-body destructured require is the only addition; the line-29 module-scope require, the line-500 post-sale require, and the line-519 init require all remain)
    - `node --check src/main/main.js` exits 0 (syntax valid; the `await` is legal because the enclosing handler is `async`)
    - `node --test test/sessionReset.test.js` exits 0 (Plan 11-01 tests still pass — the new caller does not regress sessionReset behavior)
    - No new file created, no other case in the switch modified
    - Line count delta in `main.js`: +13 to +22 (the new if-block + comments; range widened slightly to accommodate the expanded D-03 rationale comment)
  </acceptance_criteria>
  <done>
    Closing POS via the admin menu now triggers an immediate `hardReset({reason:'pos-closed', mode:'welcome'})` after the existing pos-state-changed IPC is sent. Opening POS does NOT trigger reset. hardReset failures audit `pos.state-changed.reset-failed` and the handler still returns `ok:true`. The destructured `const { hardReset } = require('./sessionReset')` lives inside the `if (next === false)` block per D-03 (scope-locality), and the pre-existing line-29 `const sessionResetMod = require('./sessionReset');` is preserved untouched. Existing tests still pass; main.js syntax-checks clean.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → main (admin-menu-action IPC) | Existing boundary, unchanged. The toggle-pos-open action arrives via the established IPC channel that is already gated by Phase 5 admin PIN entry + Phase 9 admin menu confirm modal. No new IPC surface. |
| main → main (toggle-pos-open → sessionReset.hardReset) | Internal main-process call. Both modules run with full privilege; no trust boundary crossed. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-11-02-01 | E (Elevation of privilege) | toggle-pos-open IPC handler | accept | Existing admin PIN gate (Phase 5) + admin menu confirm modal (Phase 9) cover authorization. The new hardReset call inherits the same gate — no new entry path. |
| T-11-02-02 | D (Denial of service) | hardReset failure path | mitigate | D-04 explicitly handles hardReset throws: posOpen stays false, audit event emitted, handler returns ok:true. The closed-welcome layer renders at the next natural reset trigger. Failure cannot wedge the kiosk because the admin-side state intent is preserved independently of the reset path. |
| T-11-02-03 | T (Tampering) | reason string `'pos-closed'` | accept | The reason string is a hard-coded literal in main.js, never read from external input. Phase 11-01's filter excludes it from the loop counter; an attacker would need code-write access to alter it (out of scope). |
| T-11-02-04 | I (Information disclosure) | audit log `pos.state-changed.reset-failed error=<msg>` | accept | The audit payload contains only the JS error message, which surfaces internal sessionReset failure details to the local audit log file (RDP-accessible to admin only, per CLAUDE.md). No PII, no credentials. Acceptable for post-mortem diagnostics. |

Severity: LOW. No threats above LOW. The new code lives entirely behind the existing main-process IPC + admin PIN trust boundary.
</threat_model>

<verification>
- `node --check src/main/main.js` exits 0 (syntax valid)
- `grep -c "case 'toggle-pos-open'" src/main/main.js` returns exactly 1
- `grep -c "reason: 'pos-closed'" src/main/main.js` returns exactly 1
- `grep -cE "^\s+const \{ hardReset \} = require\('\./sessionReset'\)" src/main/main.js` returns exactly 1 (in-block, indented — verifies D-03 placement)
- `grep -cE "^const \{ hardReset \}" src/main/main.js` returns 0 (NOT hoisted to module scope — verifies D-03 anti-hoist)
- `grep -c "const sessionResetMod = require('./sessionReset')" src/main/main.js` returns exactly 1 (pre-existing line-29 import preserved)
- `grep -c "pos.state-changed.reset-failed" src/main/main.js` returns exactly 1
- `node --test test/sessionReset.test.js` exits 0 (Plan 11-01 tests unaffected)
</verification>

<success_criteria>
- Phase 11 success criterion 1 satisfied: closing POS calls `hardReset({reason:'pos-closed', mode:'welcome'})` immediately, AFTER store.set + pos-state-changed.send (D-01 ordering)
- Phase 11 success criterion 2 supported: the reset runs while admin menu is open; the closed-welcome layer is what foregrounds when the admin dismisses (verified end-to-end via human UAT — the code path lands here, the visual outcome is checked at UAT time)
- Phase 11 success criterion 4 satisfied: opening POS does NOT call hardReset (D-02 guard)
- Phase 11 success criterion 5 satisfied: existing `pos.state-changed` audit still fires unchanged; the new `pos.state-changed.reset-failed` fires only on the failure path; the existing `session.reset` audit fires from sessionReset internals during hardReset (per Phase 4 audit pattern, no change here)
- D-08 honored: NO new test for this handler in main.test.js; the meaningful behavior (filter exclusion + onPostReset firing) is covered by Plan 11-01's sessionReset.test.js D-05/D-06 tests
- File delta limited to the toggle-pos-open case body (~13-22 added lines), no other code touched
</success_criteria>

<output>
After completion, create `.planning/phases/11-pos-close-immediate-welcome-reset/11-02-SUMMARY.md` documenting:
- Exact before/after diff of the toggle-pos-open case body
- Confirmation that the destructured `const { hardReset } = require('./sessionReset')` is INSIDE the `if (next === false)` block (D-03)
- Confirmation that the pre-existing line-29 `const sessionResetMod = require('./sessionReset');` module-scope import is preserved untouched
- Confirmation that no other case in the switch was modified
- Confirmation `node --check src/main/main.js` exits 0
- Confirmation `node --test test/sessionReset.test.js` still passes
- A note that per D-08 there is intentionally NO new main.test.js — the meaningful behavior is covered by Plan 11-01's sessionReset.test.js D-05/D-06 tests
</output>
</content>
