---
phase: 11-pos-close-immediate-welcome-reset
reviewed: 2026-04-28T00:00:00Z
depth: standard
files_reviewed: 3
files_reviewed_list:
  - src/main/sessionReset.js
  - src/main/main.js
  - test/sessionReset.test.js
findings:
  critical: 0
  warning: 0
  info: 3
  total: 3
status: issues_found
---

# Phase 11: Code Review Report

**Reviewed:** 2026-04-28
**Depth:** standard
**Files Reviewed:** 3
**Status:** issues_found (info-only)

## Summary

Phase 11 introduces an immediate hard reset to the closed-welcome layer when the
admin closes the POS via the admin menu (Plan 11-02), and extends the reset-loop
counter exclusion list so this admin-driven cycle does not trip the 3-in-60s
guard (Plan 11-01).

The implementation is small, surgical, and consistent with the precedent set in
Phase 10 (`sale-completed` exclusion). No critical issues, no warnings — three
info-level observations are recorded below as small clarity / hygiene notes.

Notable strengths:

- IPC ordering (`pos-state-changed` BEFORE `hardReset`) is documented inline
  with the rationale (avoids one-frame "open" flash while welcome:show fires
  against closed-state markup).
- The "do NOT roll back posOpen" decision (D-04) is explicitly enforced AND
  audited via `pos.state-changed.reset-failed`, preserving admin intent if the
  reset throws.
- Tests (D-05/D-06) follow the exact shape of the Phase 10 sale-completed
  tests, including audit-event assertions and `onPostReset(null)` cleanup to
  prevent module-scope contamination across tests.
- The `pos-closed` filter clause sits next to the existing `sale-completed`
  clause with a comment block documenting the same "mode check omitted because
  always arrives with mode:'welcome'" reasoning, keeping future maintainers
  in-sync with the intent.

## Info

### IN-01: Duplicate sessionReset import inside `case 'toggle-pos-open'`

**File:** `src/main/main.js:1014`
**Issue:** The handler destructures `const { hardReset } = require('./sessionReset')` inside the `case` block even though `sessionResetMod` is already imported eagerly at module scope (line 29). The author has explicitly acknowledged this in the inline comment ("destructured require lives INSIDE this block for scope-locality / readability ... semantically free, organizationally clean") so this is a deliberate style decision, not an oversight. Mentioned only because future readers diffing this against the rest of the file will see two patterns for the same dependency and may "fix" one.
**Fix:** Optional — either keep the comment as-is, or reuse the module-scope binding:
```js
await sessionResetMod.hardReset({ reason: 'pos-closed', mode: 'welcome' });
```
No behavior change either way. If kept, the existing comment is sufficient documentation.

### IN-02: `pos-closed` filter clause is unconditional on `mode`

**File:** `src/main/sessionReset.js:110-116`
**Issue:** The new clause `e.reason === 'pos-closed'` excludes the entry from the loop counter regardless of `mode`. The inline comment correctly notes the only current caller (main.js `case 'toggle-pos-open'`) always passes `mode:'welcome'`, so the unconditional form is operationally equivalent today. This matches the precedent set by the `sale-completed` clause on the line above. The risk is purely future-facing: if someone adds a non-welcome `pos-closed` reset path later (e.g. an admin "force reload while closed" feature), it would silently bypass the loop guard. Not a defect against the current plan.
**Fix:** Optional — if you want to make the assumption load-bearing in the code rather than the comment, tighten the predicate:
```js
(e.reason === 'pos-closed' && e.mode === 'welcome')
```
This would also be a uniform shape with the existing `idle-expired && welcome` clause. Skip if you prefer to keep `pos-closed` and `sale-completed` symmetric.

### IN-03: In-flight / loop-active suppression of the immediate reset is silent to the admin

**File:** `src/main/main.js:1012-1022`
**Issue:** `hardReset` short-circuits (returns without throwing) when `resetting=true` (a concurrent reset is already in flight) or when `loopActive=true` (the 3-in-60s latch has tripped earlier in the session). In those cases the `try/catch` in `toggle-pos-open` does NOT fire — so no `pos.state-changed.reset-failed` audit is emitted, and the admin sees a successful `{ok:true, posOpen:false}` return even though the closed-welcome layer was not surfaced immediately. This is consistent with the D-04 intent ("the closed-welcome layer will render at the next natural reset"), so it is not a defect — but it does mean the operational signal "admin closed POS but the immediate reset was suppressed" is currently invisible in audit logs.
**Fix:** Optional — if observability of the suppressed-immediate path matters, hardReset itself already logs `sessionReset.suppressed: in-flight|loop-active` at info level (line 81-86 of sessionReset.js). That existing line is sufficient for RDP-grep diagnostics. No change required unless you want a dedicated audit event for this branch.

---

_Reviewed: 2026-04-28_
_Reviewer: Claude (gsd-code-reviewer)_
_Depth: standard_
