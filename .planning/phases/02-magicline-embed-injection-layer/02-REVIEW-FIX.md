---
phase: 02-magicline-embed-injection-layer
fixed_at: 2026-04-09T00:00:00Z
review_path: .planning/phases/02-magicline-embed-injection-layer/02-REVIEW.md
iteration: 1
findings_in_scope: 3
fixed: 3
skipped: 0
status: all_fixed
---

# Phase 2: Code Review Fix Report

**Fixed at:** 2026-04-09
**Source review:** .planning/phases/02-magicline-embed-injection-layer/02-REVIEW.md
**Iteration:** 1

**Summary:**
- Findings in scope: 3 (Critical + Warning)
- Fixed: 3
- Skipped: 0

Scope filter: `critical_warning` — Info findings (IN-01 through IN-06) were not
in scope for this fix iteration and remain open in REVIEW.md.

## Fixed Issues

### WR-01: `cash-register-ready` ipcMain stub is dead code and diverges from Phase 2 wiring

**Files modified:** `src/main/main.js`
**Commit:** d1189ee
**Applied fix:** Deleted the `ipcMain.on('cash-register-ready', ...)` handler
and its explanatory comment from `createMainWindow()`. Also removed the now-unused
`ipcMain` destructure from the `require('electron')` import to avoid a dead
binding. Splash lift is now owned entirely by `magiclineView.handleInjectEvent`,
which sends `splash:hide` directly to `mainWindow.webContents`.

### WR-02: `nav.SidebarWrapper-sc-bb205641-0` classified STABLE but is a styled-components hash

**Files modified:** `src/inject/fragile-selectors.js`, `src/inject/inject.css`
**Commit:** e3a40aa
**Applied fix:** Moved the `nav.SidebarWrapper-sc-bb205641-0` entry out of
`STABLE_SELECTORS` and into `FRAGILE_SELECTORS` in `fragile-selectors.js`, with
a comment explaining that `-sc-<hash>-0` is a styled-components hash that
drifts like MUI `css-xxxxx`. Moved the matching rule in `inject.css` from the
STABLE data-role section to the FRAGILE section with an inline comment.
No `data-role` fallback was introduced because none is known to be exposed by
Magicline today — re-categorization alone is sufficient to route future drift
incidents to the correct runbook entry and to stop readers from treating a
sidebar rename as a "should not happen" regression.

### WR-03: `resize` listener and `drainTimer` never cleaned up; module state leaks on window teardown

**Files modified:** `src/main/magiclineView.js`, `src/main/main.js`
**Commit:** 0233fc4
**Applied fix:**
1. Hoisted `resizeHandler` from a `createMagiclineView` local into a
   module-scoped `let` alongside the existing `magiclineView`, `drainTimer`,
   `readyFired`, `driftActive` variables so the teardown path can reach it.
2. Added a `destroyMagiclineView(mainWindow)` function that:
   - clears `drainTimer` via `clearInterval` and nulls it,
   - removes the `resize` listener from `mainWindow` (inside a try/catch to
     tolerate an already-destroyed window),
   - resets `resizeHandler`, `magiclineView`, `readyFired`, `driftActive` to
     their initial values,
   - logs `magicline.view.destroyed`.
3. Added `destroyMagiclineView` to `module.exports`.
4. In `main.js`, imported `destroyMagiclineView` alongside `createMagiclineView`
   and wired `mainWindow.once('closed', ...)` to call it inside a try/catch
   (with a warn-level log on failure). Placed inside the same `try` block that
   calls `createMagiclineView` so the closed-hook is only registered when
   creation succeeded.

This unblocks Phase 4 auto-recovery: a recreated mainWindow will now see a
clean module state and `createMagiclineView` will build a fresh instance
instead of hitting the "already created" early-return, and `readyFired` will
no longer persist across window recreations.

---

_Fixed: 2026-04-09_
_Fixer: Claude (gsd-code-fixer)_
_Iteration: 1_
