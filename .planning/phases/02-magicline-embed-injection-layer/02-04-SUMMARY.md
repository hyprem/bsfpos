---
phase: 02-magicline-embed-injection-layer
plan: 04
subsystem: main-process
tags: [main-process, web-contents-view, injection-lifecycle, drain-poll, zoom-factor, session-partition]
status: complete
wave: 3
requirements: [EMBED-01, EMBED-02, EMBED-03, EMBED-05]
dependency_graph:
  requires:
    - "Plan 02-01 (electron-store dependency, show-magicline-error / splash:hide IPC channels)"
    - "Plan 02-02 (src/inject/inject.css + src/inject/fragile-selectors.js)"
    - "Plan 02-03 (src/inject/inject.js main-world IIFE + window.__bskiosk_events drain queue)"
    - "Phase 1 src/main/keyboardLockdown.js attachLockdown export (D-02)"
    - "Phase 1 src/main/logger.js electron-log instance"
  provides:
    - "createMagiclineView(mainWindow, store) factory — single entry point for Plan 05 to wire from main.js"
    - "WebContentsView child of host window under persist:magicline partition"
    - "Three-event injection pipeline (did-start-navigation CSS, dom-ready CSS+JS, did-navigate-in-page CSS+JS)"
    - "250 ms drain poll translating __bskiosk_events -> show-magicline-error / splash:hide IPC"
    - "computeDefaultZoom heuristic (workAreaSize.width/1280 clamped [0.7, 1.25])"
  affects:
    - "Plan 02-05 (main.js integration will import createMagiclineView and call it after createMainWindow)"
    - "Plan 02-06 (acceptance verification will exercise drift + ready end-to-end)"
    - "Phase 4 IDLE-07 (render-process-gone handler will grow recovery logic here)"
tech_stack:
  added: []
  patterns:
    - "Pattern 1: Persistent injection on every navigation (3-event trigger mix)"
    - "Pattern 5: executeJavaScript drain-queue poll (stateless expression, 250 ms cadence)"
    - "WebContentsView + contentView.addChildView (Electron 41 API)"
    - "session.fromPartition('persist:magicline') via webPreferences.partition (D-14)"
    - "Module-scoped one-shot guards (driftActive, readyFired) for idempotent IPC emission"
key_files:
  created:
    - path: "src/main/magiclineView.js"
      lines: 284
      provides: "createMagiclineView factory + WebContentsView lifecycle + injection wiring + drain poll + drift/ready IPC translation"
  modified: []
decisions:
  - "require-time inject bundle: fs.readFileSync at module load for INJECT_CSS / FRAGILE_JS / INJECT_JS so every reinjection uses a stable snapshot and disk reads do not happen per navigation event"
  - "INJECT_BUNDLE concatenation uses a '\\n;\\n' separator between fragile-selectors.js and inject.js to defensively terminate any trailing statement in the fragile fragment before the IIFE begins"
  - "KNOWN_EVENT_TYPES whitelist applied BEFORE any payload handling (Security Domain V5) — unknown types log.warn and drop, so a compromised Magicline cannot inject new event types"
  - "driftActive is a module-scoped one-shot: first drift event fires the IPC, subsequent drift events still log.warn per selector but do not re-send show-magicline-error, preventing overlay flashing on sustained drift storms"
  - "readyFired suppressed while driftActive (D-06) — if drift wins the race, splash never lifts and the overlay remains visible; this is the correct locked-down UX"
  - "renderer-process-gone handler logs only — Phase 4 owns recovery per plan boundaries"
metrics:
  duration: "~5 min"
  completed: "2026-04-09"
  tasks: 1
  files_created: 1
  files_modified: 0
  lines_added: 284
---

# Phase 2 Plan 04: Magicline Child View Owner Summary

Implements `src/main/magiclineView.js` — the single main-process module that owns the Magicline `WebContentsView` child for the rest of the project. Creates the view bound to the Phase 1 host window under the `persist:magicline` session partition, reuses Phase 1 keyboard lockdown, applies an electron-store-overridable zoom factor, wires insertCSS + executeJavaScript on the three-event injection mix from Plan 02-RESEARCH Pattern 1, and polls `window.__bskiosk_events` every 250 ms to translate `drift` / `cash-register-ready` events into host-side IPC (`show-magicline-error` / `splash:hide`). This plan combines the outputs of Plans 01 (electron-store + host overlay + IPC channels), 02 (inject.css + fragile-selectors.js), and 03 (inject.js) into a single working injection pipeline ready for Plan 05 integration.

## What Was Built

`src/main/magiclineView.js` — 284-line CommonJS module. Single export surface:

```javascript
module.exports = {
  createMagiclineView,           // (mainWindow, store) -> WebContentsView
  _computeDefaultZoom,           // test/diagnostics only
  _DRIFT_MESSAGE,                // test/diagnostics only
  _PARTITION,                    // test/diagnostics only
};
```

### Module sections

1. **Require-time bundle load.** `fs.readFileSync` on `../inject/inject.css`, `../inject/fragile-selectors.js`, `../inject/inject.js`. Concatenates `FRAGILE_JS + '\n;\n' + INJECT_JS` so `FRAGILE_SELECTORS` + `STABLE_SELECTORS` are in scope when the inject.js IIFE runs.
2. **Constants.** `MAGICLINE_URL`, `PARTITION = 'persist:magicline'`, `DRAIN_INTERVAL_MS = 250`, `DRIFT_MESSAGE` (exact German copy from D-06), `DRAIN_EXPR` (single-line `(function(){...})()` expression).
3. **Module state.** `magiclineView`, `drainTimer`, `readyFired`, `driftActive` at module scope.
4. **`KNOWN_EVENT_TYPES` whitelist.** Set of 4 accepted event types (see §Event Whitelist below).
5. **`computeDefaultZoom()`.** First-boot zoom heuristic (see §Zoom Factor below).
6. **`createMagiclineView(mainWindow, store)`.** Double-call guard + argument validation, `new WebContentsView` with partition / contextIsolation / sandbox / no nodeIntegration / no preload, `mainWindow.contentView.addChildView`, resize handler, `attachLockdown` on child webContents, zoom factor from store (fallback to computeDefaultZoom), dev-only `openDevTools({mode:'detach'})`, `wireInjection`, `startEventDrain`, `loadURL`, `render-process-gone` logging.
7. **`sizeChildView(mainWindow)`.** `mainWindow.getContentBounds()` -> `magiclineView.setBounds({x:0,y:0,...})`.
8. **`wireInjection(wc)`.** Three listeners. `did-start-navigation` (main-frame only) calls `insertCSS` only. `dom-ready` calls `insertCSS` + `executeJavaScript(INJECT_BUNDLE, true)`. `did-navigate-in-page` calls `insertCSS` + `executeJavaScript(INJECT_BUNDLE, true)`. `did-navigate` and `did-frame-finish-load` intentionally NOT wired.
9. **`startEventDrain(wc, mainWindow)`.** Clears any existing interval, then `setInterval` every 250 ms: isDestroyed check -> `executeJavaScript(DRAIN_EXPR, true)` -> foreach event -> `handleInjectEvent`. Swallows executeJavaScript errors (page navigating / about:blank).
10. **`handleInjectEvent(evt, mainWindow)`.** Type validation against whitelist, payload defensiveness, one-shot IPC sends for drift + ready.

## Event Whitelist and Rationale (V5 input validation)

```javascript
const KNOWN_EVENT_TYPES = new Set([
  'drift',                      // EMBED-05 self-check failure
  'cash-register-ready',        // splash lift one-shot
  'observer-scope-fallback',    // inject.js MutationObserver fallback to document.body
  'observer-attach-failed'      // inject.js MutationObserver attach error
]);
```

**Rationale (Security Domain §V5):** Magicline runs in the child view's main world, which we do not trust (D-15: no preload, no contextBridge). A compromised or upstream-modified Magicline page could plant arbitrary objects into `window.__bskiosk_events`. The whitelist is the narrow boundary where main-process code meets untrusted page data:

- Only the 4 listed types are accepted. Unknown types log `magicline.inject.unknown-event-type:` and drop — no IPC send, no handler dispatch.
- Event payloads are coerced via `String(payload.selector || '')` / `String(payload.category || '')` before being logged or sent over IPC. The main process never executes data from the page.
- The `driftActive` and `readyFired` one-shot guards cap the blast radius even if an attacker gets past the whitelist: at worst a compromised page can trigger at most one false splash-lift or one false drift overlay per page load.
- The observer fallback / attach-failed types are log-only — no IPC emitted — so accepting them costs nothing.

This matches the "never execute data from the main world" invariant locked in 02-CONTEXT.md D-15.

## BrowserView Reference Audit

**Zero occurrences of `BrowserView(`, `setBrowserView`, or `addBrowserView`** in `src/main/magiclineView.js`. Verified via the plan's `node -e` forbidden-substring check (exit 0). The module uses `WebContentsView` + `mainWindow.contentView.addChildView` exclusively, matching the Electron 41 supported embedded-view API. The initial draft briefly mentioned the legacy API names in a clarifying comment; that comment was rewritten to say "deprecated legacy embedded-view APIs removed in Electron 41" instead, so no legacy API identifier appears anywhere in the file — not even in comments.

## D-15: No Preload on Child View

The `webPreferences` block for the `WebContentsView` contains:

```javascript
webPreferences: {
  partition:        PARTITION,
  contextIsolation: true,
  sandbox:          true,
  nodeIntegration:  false,
  devTools:         isDev,
  // NO preload — D-15. Magicline is untrusted; all privileged ops go
  // through the host preload → ipcMain, never the child view.
}
```

**No `preload:` key is set.** Verified via the plan's forbidden-substring check (`preload:` is in the forbidden list). The child view's preload slot is intentionally empty. All privileged operations (showing the error overlay, lifting the splash) flow through the host window's preload + ipcMain contract established in Plan 02-01. The drain poll is the ONLY channel by which the Magicline main world communicates with the main process, and it is a stateless read from `window.__bskiosk_events` executed by the main process itself — the page cannot push anything actively.

## Zoom Factor Formula and PENDING-HUMAN Flag

```javascript
function computeDefaultZoom() {
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  const raw = width / 1280;
  return Math.max(0.7, Math.min(1.25, raw));
}
```

- **Reference width:** `1280` px — Magicline's desktop minimum useful viewport.
- **Source:** `screen.getPrimaryDisplay().workAreaSize.width` (excludes taskbar).
- **Clamp range:** `[0.7, 1.25]` — below 0.7 the cash-register UI becomes unreadable; above 1.25 MUI buttons start to overflow the vertical kiosk layout.
- **Override key:** `magiclineZoomFactor` on electron-store. Operators can set this via admin RDP (future Plan 05/06 of this phase or Phase 5 admin surface).
- **Source-of-truth log line:** `magicline.zoom: factor=<N> source=<store|default>`.

**PENDING-HUMAN (A1 assumption from 02-RESEARCH.md §Assumptions).** The real kiosk display resolution is UNKNOWN as of 2026-04-08. This function is a first-boot heuristic only; operators MUST measure the actual workAreaSize on the physical POS terminal and override via `magiclineZoomFactor` if the default is off. This is tracked as a PENDING-HUMAN verification item for Plan 06 acceptance. If `screen.getPrimaryDisplay()` throws on an unusual display topology, the fallback is `1.0` with a `log.warn`.

## IPC Send Surface

`magiclineView.js` is strictly send-side. It imports neither `ipcMain` nor `ipcRenderer`, and it registers zero `ipcMain.on` handlers (verified by the forbidden-substring check). It writes to exactly two host-side IPC channels established by Plan 02-01:

| Channel                 | Payload              | When                                                    |
|-------------------------|----------------------|---------------------------------------------------------|
| `show-magicline-error`  | `{ message: <de> }`  | First `drift` event per page load, once                 |
| `splash:hide`           | (none)               | First `cash-register-ready` per page load, unless drift |

The Phase 1 `ipcMain.on('cash-register-ready', ...)` stub in `main.js` remains untouched — it continues to function as a legacy fallback channel but is not used by this module.

## Requirement Guarantees

- **EMBED-01** Magicline loads in a `WebContentsView` child of the host window at `https://bee-strong-fitness.web.magicline.com/#/cash-register` under `persist:magicline`.
- **EMBED-02** `insertCSS` is called on `did-start-navigation`, `dom-ready`, and `did-navigate-in-page` — three triggers.
- **EMBED-03** `executeJavaScript(INJECT_BUNDLE, true)` is called on `dom-ready` and `did-navigate-in-page` with fragile-selectors.js + inject.js concatenated.
- **EMBED-05** Drift events from the inject.js boot-time self-check drain into `log.warn` + `show-magicline-error` IPC exactly once per page load (driftActive guard).
- **D-06** `cash-register-ready` is suppressed while `driftActive` so drift overlay always wins.
- **D-09** Zoom factor derives from `computeDefaultZoom()` with electron-store `magiclineZoomFactor` override.
- **D-14** `PARTITION = 'persist:magicline'` is the single stable constant.
- **D-15** No preload on the child view's webPreferences.

## Deviations from Plan

One trivial cosmetic fix, no functional impact:

**1. [Rule 3 - Verification artifact] Comment reference to legacy embedded-view API**
- **Found during:** Task 1 verification
- **Issue:** The initial draft contained a comment that named the deprecated legacy APIs verbatim as a clarifying note ("NOT the deprecated mainWindow.setBrowserView / addBrowserView API"). The plan's own forbidden-substring check lists those identifiers in the forbidden set to keep legacy API names out of the file, so the grep flagged the comment even though it was intentionally documenting non-use.
- **Fix:** Rewrote the comment to say "NOT the deprecated legacy embedded-view APIs removed in Electron 41" without naming the specific identifiers. Intent preserved, verification script passes.
- **Files modified:** `src/main/magiclineView.js` (comment on line 107–108 only)
- **Commit:** 58fcbe1 (single commit for this plan — fix was applied before commit)

No other deviations. The module matches the plan skeleton plus the 9 clarifications listed in the plan's implementation notes.

## Verification Results

| Check                                                                           | Result |
|----------------------------------------------------------------------------------|--------|
| `node --check src/main/magiclineView.js`                                         | PASS (exit 0) |
| All 37 required substrings present                                               | PASS |
| All 7 forbidden substrings absent (BrowserView(, setBrowserView, addBrowserView, preload:, ipcMain.on, keytar, node-hid) | PASS |
| File >= 150 lines                                                                | PASS (284 lines) |
| `grep "css-p8umht|css-qo4f3u|css-1b1c5ke" src/main/magiclineView.js`             | no matches (EMBED-04 preserved) |
| `module.exports.createMagiclineView` is a function at source level               | PASS |
| Exactly 3 injection-event listeners (`did-start-navigation`, `dom-ready`, `did-navigate-in-page`) | PASS |
| `did-navigate` / `did-frame-finish-load` NOT listed                              | PASS |

## Hand-off Notes for Plan 05

When Plan 05 integrates this module into `main.js`:

1. **Import:** `const { createMagiclineView } = require('./magiclineView');`
2. **electron-store:** use `const Store = require('electron-store').default;` (the v10 CJS interop shape documented in Plan 02-01's deviation note) and construct a `new Store()` instance at app-ready time.
3. **Call order:** after `createMainWindow()` and `attachLockdown(mainWindow.webContents)`, call `createMagiclineView(mainWindow, storeInstance)`.
4. **Single instance:** repeated calls return the existing view and log a warning; the `already-created` guard handles main.js refactors that might accidentally call twice.
5. **Legacy Phase 1 `ipcMain.on('cash-register-ready', ...)`:** leave it in main.js. It is now a no-op in the happy path (the drain poll sends `splash:hide` directly), but it stays as a fallback in case a future inject.js variant emits the legacy IPC instead of pushing to the drain queue.
6. **`render-process-gone` recovery:** this module only logs. Phase 4 IDLE-07 owns the reload / relaunch logic.

## Self-Check: PASSED

- `src/main/magiclineView.js`: FOUND (284 lines, node --check exit 0)
- Commit 58fcbe1: FOUND in git log (`feat(02-04): add src/main/magiclineView.js WebContentsView owner`)
- All verification substring checks: PASSED
- Fragile selector isolation (EMBED-04): PRESERVED (zero matches in src/main/magiclineView.js)
