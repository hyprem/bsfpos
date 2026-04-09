---
phase: 02-magicline-embed-injection-layer
plan: 05
subsystem: main-process
tags: [main-process, integration, electron-store, wiring, phase-1-preservation]
status: complete
wave: 4
requirements: [EMBED-01]
dependency_graph:
  requires:
    - "Plan 02-01 (electron-store@10.1.0 dependency, .default CJS interop)"
    - "Plan 02-04 (src/main/magiclineView.js createMagiclineView export)"
    - "Phase 1 src/main/main.js orchestration block (single-instance lock, setLoginItemSettings, globalShortcut, createMainWindow, attachLockdown, will-quit, window-all-closed)"
  provides:
    - "Phase 2 main-process integration: Magicline child view is now instantiated on every app boot"
    - "electron-store config file at %AppData%/Bee Strong POS/config.json"
    - "Try/catch isolation around createMagiclineView so a Phase 2 failure leaves the Phase 1 splash visible (correct locked-down failure mode)"
  affects:
    - "Plan 02-06 (acceptance) — end-to-end happy-path is now reachable"
    - "Phase 4 IDLE-07 — recovery logic will plug into the same call site"
tech_stack:
  added: []
  patterns:
    - "Additive edit inside existing app.whenReady().then(...) block (Phase 1 orchestration preserved byte-identical)"
    - "electron-store v10 CJS interop: require('electron-store').default"
    - "Try/catch wrapper around Phase 2 entry point — splash-stays-up failure mode"
key_files:
  created: []
  modified:
    - path: "src/main/main.js"
      change: "Added 2 require lines + 14-line Phase 2 wiring block inside app.whenReady (18 insertions, 0 deletions)"
decisions:
  - "electron-store imported via .default (v10 CJS interop documented in 02-01-SUMMARY); the plan's substring check still matches the require('electron-store') prefix"
  - "Store instantiated INSIDE app.whenReady — electron-store needs app.getPath('userData') which is only available after ready"
  - "createMagiclineView wrapped in try/catch — a Phase 2 failure logs the error and leaves the Phase 1 splash visible, which is the correct locked-down UX (member sees branded splash instead of crash)"
  - "Phase 1 ipcMain.on('cash-register-ready', ...) stub left intact as legacy fallback — Plan 04 sends splash:hide directly via the drain poll, but the IPC channel is preserved per research §Wave 4 step 16"
metrics:
  duration: "~2 min"
  completed: "2026-04-09"
  tasks: 1
  files_created: 0
  files_modified: 1
  lines_added: 18
  lines_removed: 0
---

# Phase 2 Plan 05: main.js Integration Summary

Wires Plan 02-04's `createMagiclineView` factory into the existing Phase 1 `main.js` orchestration. This is the smallest plan in Phase 2 — three logical insertions, zero deletions, zero reorderings — but it is the plan that makes Phase 2 actually run. Without it, every other Phase 2 file is inert.

## Insertion Points

### Edit 1 — Top-of-file requires (after Phase 1 require block)

Inserted after the existing Phase 1 line `const { attachLockdown } = require('./keyboardLockdown');` (was line 11):

```javascript
const Store = require('electron-store').default;
const { createMagiclineView } = require('./magiclineView');
```

Final require block (lines 8–13 post-edit):

```javascript
const { app, BrowserWindow, Menu, ipcMain, globalShortcut } = require('electron');
const path = require('path');
const log = require('./logger');
const { attachLockdown } = require('./keyboardLockdown');
const Store = require('electron-store').default;
const { createMagiclineView } = require('./magiclineView');
```

### Edit 2 — Phase 2 wiring block inside app.whenReady

Inserted AFTER the Phase 1 `if (mainWindow) { attachLockdown(mainWindow.webContents); }` block and BEFORE the closing `});` of `app.whenReady().then`:

```javascript
  // --- Phase 2: Magicline child view + injection pipeline ---------------
  // createMagiclineView attaches a WebContentsView child to mainWindow, loads
  // the Magicline cash-register URL under the persist:magicline partition,
  // wires insertCSS/executeJavaScript injection on every nav, and drives the
  // splash:hide / show-magicline-error IPC channels via a 250ms main-world
  // drain poll. See src/main/magiclineView.js for the full lifecycle.
  if (mainWindow) {
    try {
      const store = new Store({ name: 'config' });
      createMagiclineView(mainWindow, store);
      log.info('phase2.magicline-view.created');
    } catch (err) {
      log.error('phase2.magicline-view.create failed: ' + (err && err.message));
    }
  }
```

## Phase 1 Preservation Audit

`git show HEAD --stat` reports `src/main/main.js | 18 ++++++++++++++++++` — **18 insertions, 0 deletions**. The diff is purely additive.

Phase 1 lines verified intact via the plan's verification script:

| Phase 1 line | Present? |
|---|---|
| `requestSingleInstanceLock` (D-05) | YES |
| `setLoginItemSettings` (D-04 layer 1) | YES |
| `globalShortcut.register` (D-11) | YES |
| `createMainWindow()` call inside app.whenReady | YES |
| `attachLockdown(mainWindow.webContents)` (D-09/D-10) | YES |
| `ipcMain.on('cash-register-ready', ...)` stub (legacy fallback) | YES |
| `splash:hide` IPC send (Phase 1 stub path) | YES |
| `will-quit` handler with `globalShortcut.unregisterAll()` | YES |
| `window-all-closed` handler with `app.quit()` | YES |
| `createMainWindow` function definition (top of file) | YES |
| ORCHESTRATION comment block (lines 73–86) | YES |
| "Phase 2 will additionally attach to the Magicline BrowserView webContents" Phase 1 hand-off comment | YES |

The single-instance lock remains the first executable call after requires. The orchestration order is unchanged: lock → app.whenReady → setLoginItemSettings → globalShortcut → createMainWindow → attachLockdown → **(new)** Store + createMagiclineView.

## Source-Order Invariants

The plan's verifier asserts two ordering constraints. Both pass:

1. `createMagiclineView(mainWindow, ...)` source position > `createMainWindow();` source position — PASS
2. `createMagiclineView(mainWindow, ...)` source position > `attachLockdown(mainWindow.webContents)` source position — PASS

This guarantees `mainWindow` exists and its webContents is locked down before the Magicline child view attaches as a sibling layer.

## electron-store CJS Interop

Per the critical deviation note inherited from Plan 02-01:

```javascript
const Store = require('electron-store').default;   // CORRECT (v10 CJS shape)
// const Store = require('electron-store');         // WRONG — Store is the namespace object
```

The plan's `node -e` verification searches for the substring `require('electron-store')`, which the `.default` form still satisfies (the substring is a prefix of `require('electron-store').default`). All acceptance criteria pass without modification.

## Failure Mode

If `new Store(...)` or `createMagiclineView(...)` throws, the catch block logs:

```
phase2.magicline-view.create failed: <message>
```

…and the function returns. The Phase 1 host window remains up, the splash overlay remains visible, and the kiosk shows the branded "Bee Strong Kasse wird vorbereitet…" screen instead of crashing. This matches the locked-down UX invariant from D-06: members never see a broken page; if the cash register cannot load, they see the branded splash and a staff member resolves it via RDP.

## Operator Override Path

The Store instance writes to `%AppData%/Bee Strong POS/config.json` (the `name: 'config'` option is the load-bearing piece — operators must know this exact filename).

Override the zoom factor by editing that JSON file over RDP:

```json
{
  "magiclineZoomFactor": 0.95
}
```

Restart the kiosk. `magiclineView.js` will pick up the override on next boot via `store.get('magiclineZoomFactor', computeDefaultZoom())`.

Tracked as PENDING-HUMAN for Plan 02-06 acceptance verification (real kiosk display resolution still unknown as of 2026-04-09).

## Deviations from Plan

**1. [Rule 1 - Bug] electron-store imported via `.default` instead of plain require**
- **Found during:** Pre-execution context review (critical_deviation_note in prompt + 02-01-SUMMARY.md hand-off)
- **Issue:** The plan's example code says `const Store = require('electron-store');`, but electron-store@10.1.0 exposes the class as `require('electron-store').default` under CJS interop (the namespace object is not callable as a constructor).
- **Fix:** Used `const Store = require('electron-store').default;`. The plan's verifier substring check `require('electron-store')` still matches.
- **Files modified:** `src/main/main.js`
- **Commit:** 768764f

No other deviations. Phase 1 orchestration preserved byte-identical, single task, single commit.

## Verification

| Check | Result |
|---|---|
| `node --check src/main/main.js` exits 0 | PASS |
| `require('electron-store')` substring present | PASS |
| `require('./magiclineView')` substring present | PASS |
| `createMagiclineView(mainWindow` call present | PASS |
| `new Store({ name: 'config' })` exact match | PASS |
| `phase2.magicline-view` log line present | PASS |
| All 9 Phase 1 preservation substrings present | PASS |
| `createMagiclineView` source position > `createMainWindow();` | PASS |
| `createMagiclineView` source position > `attachLockdown(mainWindow.webContents)` | PASS |
| `git show HEAD --stat` shows 18 insertions, 0 deletions | PASS |
| Phase 2 block wrapped in try/catch | PASS |
| `store` declared as `const` inside app.whenReady (no module-scope leak) | PASS |

Note: `npm start` boot smoke-test was NOT executed in this parallel-executor run (no Magicline credentials, no display, kiosk-mode would lock the build host). It is deferred to Plan 02-06 acceptance verification on the real kiosk hardware, which is the appropriate venue for the end-to-end `phase2.magicline-view.created` log assertion.

## Hand-off Notes for Plan 02-06

When Plan 02-06 runs the acceptance verification on real hardware:

1. `npm start` should produce these log lines in order on a healthy boot:
   - `app ready (isDev=...)`
   - `mainWindow ready-to-show — showing`
   - `phase2.magicline-view.created`
   - `magicline.view.created: partition=persist:magicline url=...`
   - `magicline.zoom: factor=<N> source=default` (or `source=store` if override exists)
   - `magicline.injected: dom-ready` (after Magicline reaches dom-ready)
   - `magicline.cash-register-ready: url=...` (after the inject.js self-check passes)
2. The host window splash should lift only after `magicline.cash-register-ready` arrives via the drain poll.
3. The drift overlay path is exercised by temporarily corrupting one fragile selector in `src/inject/fragile-selectors.js` and re-launching — expected: `magicline.drift:` warn line + `show-magicline-error` IPC + visible German overlay at z-index 300.
4. The `%AppData%/Bee Strong POS/config.json` file should NOT exist on first boot (computeDefaultZoom path) and should be created lazily only when an operator writes to it. electron-store is read-only in this plan; we never `store.set` from main.js.

## Self-Check: PASSED

- `src/main/main.js` modified (FOUND, 18 insertions / 0 deletions)
- Commit 768764f: FOUND in git log (`feat(02-05): wire createMagiclineView into main.js app.whenReady`)
- All plan verification substring checks: PASSED
- Phase 1 orchestration block byte-identical except for additive insertions: VERIFIED via git diff stat (0 deletions)
