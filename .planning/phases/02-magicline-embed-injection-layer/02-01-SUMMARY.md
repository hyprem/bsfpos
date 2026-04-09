---
phase: 02-magicline-embed-injection-layer
plan: 01
subsystem: host-renderer
tags: [electron, host-overlay, ipc, dependency, electron-store]
status: complete
wave: 1
requirements: [EMBED-01]
dependency_graph:
  requires:
    - "Phase 1 host renderer (host.html, host.css, host.js, preload.js)"
    - "Phase 1 contextBridge convention (callback-only, T-02-01)"
  provides:
    - "electron-store@10.1.0 runtime dependency (CJS interop)"
    - "#magicline-error host overlay layer at z-index 300"
    - "window.kiosk.onShowMagiclineError / onHideMagiclineError callbacks"
    - "IPC channels 'show-magicline-error' and 'hide-magicline-error'"
  affects:
    - "Plan 02-04 (drift detection / D-09 zoom override) — will consume both the dependency and the IPC channels"
    - "Plan 02-05 (acceptance) — will validate the overlay end-to-end"
tech_stack:
  added:
    - "electron-store@10.1.0 (CJS line, .default export)"
  patterns:
    - "Additive sibling layer in host.html (matches Phase 1 splash pattern)"
    - "Callback-only contextBridge surface (T-02-01 convention preserved)"
key_files:
  created: []
  modified:
    - path: "package.json"
      change: "Added electron-store ^10.1.0 to dependencies"
    - path: "package-lock.json"
      change: "Lockfile regenerated for electron-store + transitive deps"
    - path: "src/host/host.html"
      change: "Added #magicline-error sibling layer; updated z-index ladder comment"
    - path: "src/host/host.css"
      change: "Appended .bsk-layer--magicline-error + .bsk-error-title + .bsk-error-subtext rules"
    - path: "src/host/host.js"
      change: "Added showMagiclineError + hideMagiclineError handlers and subscriptions"
    - path: "src/main/preload.js"
      change: "Extended window.kiosk with onShowMagiclineError + onHideMagiclineError callbacks"
decisions:
  - "Pinned electron-store to ^10.1.0 (resolved 10.1.0) to stay on the CJS line — 11.x is ESM-only and would break the CommonJS main process"
  - "Added the z-index 300 layer alongside the existing ledger comment (Phase 5 may stack at 300+ — drift error and updating cover are conceptually the same slot)"
  - "showMagiclineError accepts an optional payload.message to override .bsk-error-subtext, enabling Plan 04/05 to surface contextual drift reasons without owning a second IPC channel"
metrics:
  duration: "~5 min"
  completed: "2026-04-09"
  tasks: 3
  files_modified: 6
---

# Phase 2 Plan 01: Host overlay + electron-store dependency Summary

Foundation plan that prepares the Phase 2 host renderer surface and installs the electron-store dependency Plan 04 needs for the D-09 zoom-factor override. Adds an additive #magicline-error overlay layer at z-index 300 plus two new contextBridge callbacks (`onShowMagiclineError` / `onHideMagiclineError`) wired to the IPC channels `show-magicline-error` and `hide-magicline-error` that downstream main-process plans will drive on Magicline drift events. All Phase 1 surface area (splash layer, splash IPC, build block, CSP, electron-log) is preserved intact.

## Resolved Versions

| Package | Requested | Resolved |
|---|---|---|
| electron-store | ^10.1.0 | 10.1.0 |

## Tasks

### Task 1 — Install electron-store@^10.1.0 (commit 19f273b)

- Ran `npm install electron-store@^10.1.0 --save`
- Resolved to electron-store 10.1.0 exactly
- 392 packages added (electron-store + transitive deps: conf, ajv, dot-prop, env-paths, etc.)
- Phase 1 dependencies (`electron-log ~5.2.0`) and the entire `build` block (NSIS appId, installer.nsh include) are unchanged
- `node -e "require('electron-store')"` exits 0 with no ERR_REQUIRE_ESM
- See "Deviations" below for the .default interop note

### Task 2 — Add #magicline-error overlay (commit fdd7b16)

- Inserted new sibling `<div id="magicline-error">` after `#splash` and before `<script src="host.js">`
- `style="display:none;" aria-hidden="true" role="alert"` — hidden on first paint even before host.css parses
- German copy is exact: title "Kasse vorübergehend nicht verfügbar", subtext "Bitte wenden Sie sich an das Studio-Personal"
- Reuses the Phase 1 `assets/logo-dark.png` asset (no new files added)
- Updated the z-index ladder comment in host.html: `300 — #magicline-error (Phase 2 D-06/D-07) + Phase 5 error/updating covers`
- Appended new CSS rules to host.css (no existing rule modified):
  - `.bsk-layer--magicline-error` — z-index 300, `#1A1A1A` background, `pointer-events: auto` so members cannot reach the drifted Magicline page underneath
  - `.bsk-error-title` — 28px / 600 / `#F5C518` (brand accent), centered
  - `.bsk-error-subtext` — 16px / `#9CA3AF` (brand subtext), centered
- Phase 1 `.bsk-layer--splash` rule, splash structure, and CSP `<meta>` are intact

### Task 3 — Extend preload + host with show/hide IPC wiring (commit 8ecf1f4)

- Added two new callback exports to `contextBridge.exposeInMainWorld('kiosk', { ... })`:
  - `onShowMagiclineError(cb)` — subscribes to `'show-magicline-error'` and forwards `payload` to the cb (`(_e, payload) => cb(payload)`)
  - `onHideMagiclineError(cb)` — subscribes to `'hide-magicline-error'`
- IPC channel names are load-bearing for Plan 04/05 — they are the strings `'show-magicline-error'` / `'hide-magicline-error'` exactly
- No raw `ipcRenderer` is exposed — the T-02-01 callback-only convention is preserved
- Added two new functions inside the existing host.js IIFE (no Phase 1 logic touched):
  - `showMagiclineError(payload)` — toggles `display:flex`, sets `aria-hidden=false`, and (optionally) overrides `.bsk-error-subtext.textContent` if `payload.message` is a non-empty string. This lets Plan 04/05 surface contextual drift reasons without owning a second IPC channel.
  - `hideMagiclineError()` — toggles `display:none`, sets `aria-hidden=true`
- Both subscriptions are wired with the same `if (window.kiosk && window.kiosk.onX)` defensive guard pattern Phase 1 uses
- `node --check src/main/preload.js` exits 0 (no syntax errors)

## Deviations from Plan

### Auto-fixed / documented

**1. [Rule 2 - Critical info] electron-store@10.1.0 CJS interop shape**
- **Found during:** Task 1 verification
- **Issue:** The plan's verify command checks `typeof Store === 'function'` against `require('electron-store')`. In electron-store@10.1.0 the CJS export is actually `{ __esModule: true, default: <class Store> }` — `typeof` of the namespace is `'object'`, not `'function'`. The class itself sits at `.default`.
- **Why it doesn't break the plan:** The acceptance criteria's load-bearing checks all pass — the require itself succeeds (no `ERR_REQUIRE_ESM`), the version starts with `10.`, the dependency is in the right block, and the Phase 1 build block + electron-log are intact. The plan's `typeof === 'function'` line was a research-time assumption about the v10 export shape.
- **Fix:** No code change needed in this plan (electron-store is not yet imported anywhere). Documented in this SUMMARY and in the Task 1 commit message so Plan 04 knows the correct import pattern is `const Store = require('electron-store').default;` rather than `const Store = require('electron-store');`.
- **Files modified:** none (documentation only)
- **Commit:** 19f273b (note in commit message body)

No other deviations. Tasks 2 and 3 executed exactly as written.

## Verification

| Check | Result |
|---|---|
| `npm install` adds electron-store@10.1.0 to dependencies | PASS |
| `node -e "require('electron-store')"` exits 0 (no ESM error) | PASS |
| `node_modules/electron-store/package.json` version starts with `10.` | PASS (10.1.0) |
| Phase 1 `appId: com.beestrongfitness.pos` still in package.json `build` block | PASS |
| Phase 1 `electron-log` still in dependencies | PASS |
| host.html `#magicline-error` exists, after `#splash`, with German copy | PASS |
| host.html `#splash` and CSP `<meta>` intact | PASS |
| host.css `.bsk-layer--magicline-error { z-index: 300 }` present | PASS |
| host.css `.bsk-layer--splash` and Phase 1 rules intact | PASS |
| preload.js exposes `onShowMagiclineError` + `onHideMagiclineError` on `window.kiosk` | PASS |
| preload.js IPC channels are exactly `'show-magicline-error'` / `'hide-magicline-error'` | PASS |
| preload.js does NOT expose raw `ipcRenderer` (callback-only T-02-01) | PASS |
| preload.js `onHideSplash` / `onShowSplash` still present | PASS |
| host.js `showMagiclineError` / `hideMagiclineError` defined and subscribed | PASS |
| host.js `hideSplash` / `showSplash` Phase 1 logic intact | PASS |
| `node --check src/main/preload.js` exits 0 | PASS |

## Phase 1 Surface Preservation Audit

Confirmed unchanged:
- `src/main/main.js` — not modified
- `src/main/keyboardLockdown.js` — not modified
- `src/main/logger.js` — not modified
- `src/host/host.html` `#splash` div, CSP meta, z-index ladder structure (only the comment text on line 17 was tightened to mention #magicline-error; ladder slots themselves are unchanged)
- `src/host/host.css` `.bsk-layer--splash` and all Phase 1 rules (only appended new rules)
- `src/main/preload.js` `onHideSplash` / `onShowSplash` / `isDev` (only added two new callbacks)
- `src/host/host.js` `hideSplash` / `showSplash` and the Phase 1 IIFE structure (only added two new functions and two new subscriptions inside the same IIFE)
- package.json `build` block (NSIS, appId, installer.nsh include, electron-log dependency)

## Hand-off Notes for Plan 04

When Plan 04 wires the drift watchdog:

1. **Importing electron-store:** use `const Store = require('electron-store').default;` — the v10 CJS interop puts the class on `.default`, not on the module root.
2. **Showing the overlay from main:** `mainWindow.webContents.send('show-magicline-error', { message: 'Optional German subtext override' })`. Omit `message` to keep the default "Bitte wenden Sie sich an das Studio-Personal" subtext.
3. **Hiding it:** `mainWindow.webContents.send('hide-magicline-error')` — no payload.
4. **The overlay sits at z-index 300** with `pointer-events: auto`, so it fully blocks touch input from reaching the Magicline child view underneath. Plan 04 does not need to detach or hide the child view to make the cover effective.
5. **The host renderer is the only consumer** of these channels — there is no listener in the Magicline child view's preload (and there shouldn't be).

## Self-Check: PASSED

- `package.json` modified: FOUND
- `package-lock.json` modified: FOUND
- `src/host/host.html` modified: FOUND (#magicline-error present)
- `src/host/host.css` modified: FOUND (.bsk-layer--magicline-error present)
- `src/host/host.js` modified: FOUND (showMagiclineError defined)
- `src/main/preload.js` modified: FOUND (onShowMagiclineError exported)
- Commit 19f273b: FOUND (Task 1)
- Commit fdd7b16: FOUND (Task 2)
- Commit 8ecf1f4: FOUND (Task 3)
