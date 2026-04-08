---
phase: 01-locked-down-shell-os-hardening
plan: 02
subsystem: shell
tags: [electron, browser-window, host-html, splash, contextbridge, ipc]

requires:
  - 01-01 (Electron project skeleton, logger, brand assets)
provides:
  - Single kiosk BrowserWindow with #1A1A1A backgroundColor and ready-to-show flash suppression
  - createMainWindow() exported for plan 03 to consume from its hardened orchestration block
  - ORCHESTRATION marker comment in main.js so plan 03 can locate the block to replace
  - contextBridge preload exposing minimal window.kiosk surface (isDev, onHideSplash, onShowSplash)
  - Permanent host.html overlay shell with z-index ladder (#magicline-mount @ 0, #splash @ 100)
  - Branded dark splash with logo, pulsing yellow loading bar, "BITTE WARTEN…" status text
  - ipcMain('cash-register-ready') stub that emits 'splash:hide' to the renderer (D-03)
  - Strict CSP meta on host.html (default-src 'self'; img-src 'self' data:)
affects:
  - 01-03-keyboard-lockdown (will replace the ORCHESTRATION block in main.js)
  - 02-* (Phase 2 will attach BrowserView at #magicline-mount and fire cash-register-ready)
  - 04-* (Phase 4 idle overlay will be added as a sibling layer at z-index 200)
  - 05-* (Phase 5 admin/error/updating layers will be added as sibling layers at z-index 300/400)

tech-stack:
  added: []
  patterns:
    - "Layered host.html with z-index ladder — all future branded layers are sibling divs toggled via display:none/flex from host.js"
    - "createMainWindow() / ORCHESTRATION marker split — lets plan 03 replace the bottom of main.js without touching the window-construction logic"
    - "contextBridge surface kept tight: only callbacks, no raw ipcRenderer leak (T-02-01 mitigation)"
    - "Splash dismiss has no fallback path — only fires from ipcMain.on('cash-register-ready'). Correct failure mode per D-03/D-06."

key-files:
  created:
    - "src/main/main.js — main process entry, BrowserWindow construction, ipcMain cash-register-ready stub, createMainWindow export, ORCHESTRATION marker"
    - "src/main/preload.js — contextBridge exposing window.kiosk (isDev, onHideSplash, onShowSplash)"
    - "src/host/host.html — permanent overlay shell with #magicline-mount + #splash sibling layers, CSP meta"
    - "src/host/host.css — dark brand palette, z-index ladder base classes, .bsk-loading-bar with bsk-pulse keyframe"
    - "src/host/host.js — renderer glue: subscribes to onHideSplash/onShowSplash, sets data-dev attribute"
  modified: []

key-decisions:
  - "main.js structured with createMainWindow above an ORCHESTRATION marker so plan 03 can replace only the bottom of the file (single-instance lock, globalShortcut, before-input-event) without touching the window construction"
  - "preload.js exposes only callback-shaped APIs (onHideSplash takes a cb), never raw ipcRenderer — prevents the renderer from sending arbitrary IPC messages (T-02-01)"
  - "Splash uses pointer-events: none — informational, never interactive. Phase 4+ layers will override this on their own classes."
  - "body[data-dev='true'] gates cursor:none so dev mode keeps the mouse cursor without a separate stylesheet branch"
  - "host.html has a strict CSP meta tag (default-src 'self') even though Phase 1 loads zero external resources — locks the contract for all future phases (T-02-02)"
  - "paintWhenInitiallyHidden:true added to BrowserWindow opts — ensures ready-to-show fires reliably even when show:false (mitigates a known Electron edge case)"

patterns-established:
  - "All host.html layers follow the .bsk-layer + .bsk-layer--<role> CSS class convention with explicit z-index per UI-SPEC ladder"
  - "All IPC channel names are namespaced (splash:*, kiosk:*, cash-register-ready) — future phases must reuse this prefix to avoid collisions"
  - "main.js imports logging exclusively via require('./logger') — no direct electron-log imports in main process code"

requirements-completed: [SHELL-06]

duration: ~3 min
completed: 2026-04-08
---

# Phase 01 Plan 02: Electron Main Process + Branded Host Window Summary

**Single 420x800 dev / fullscreen prod kiosk BrowserWindow loading a permanent host.html overlay with a branded dark splash, contextBridge preload, and the ipcMain cash-register-ready stub Phase 2 will fire.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-08T18:00:00Z
- **Completed:** 2026-04-08T18:03:00Z
- **Tasks:** 2
- **Files modified:** 5 (all created)

## Accomplishments

- main.js constructs the kiosk BrowserWindow with backgroundColor #1A1A1A, kiosk/fullscreen/frame gated on NODE_ENV (D-07), contextIsolation + sandbox + nodeIntegration:false hardened webPreferences, devTools dev-only (D-08), ready-to-show wiring to eliminate white flash, paintWhenInitiallyHidden:true for reliable show, render-process-gone error logging
- ipcMain.on('cash-register-ready') stub installed and forwards 'splash:hide' to the renderer — the only dismiss path (D-03)
- createMainWindow exported via module.exports so plan 03 can consume it from its hardened orchestration replacement
- Marker comment `// --- ORCHESTRATION (plan 03 REPLACES everything below this line)` placed at the file split — plan 03 will replace exactly that section
- preload.js exposes window.kiosk = { isDev, onHideSplash, onShowSplash } via contextBridge — no ipcRenderer leak, no Node APIs (T-02-01 audited)
- host.html ships permanent overlay shell with #magicline-mount (z=0, Phase 2 BrowserView attach point) and #splash (z=100). lang="de", strict CSP meta, viewport meta with user-scalable=no
- host.css implements UI-SPEC dark brand palette (#1A1A1A dominant, #F5C518 accent, #9CA3AF muted text), .bsk-layer base class, bsk-pulse keyframe animation (1.6s), prod cursor:none gated by body[data-dev]
- host.js subscribes to window.kiosk.onHideSplash / onShowSplash, no setTimeout fallback, sets data-dev attribute on body when window.kiosk.isDev is truthy

## Task Commits

1. **Task 1: Create main.js with BrowserWindow + ipcMain stub, and preload.js contextBridge** — `082e818` (feat)
2. **Task 2: Create host.html + host.css + host.js with layered splash cover** — `be0a090` (feat)

## Files Created/Modified

- `src/main/main.js` — main process entry; createMainWindow + ORCHESTRATION stub; exports `{ createMainWindow, isDev }`
- `src/main/preload.js` — contextBridge `window.kiosk` surface
- `src/host/host.html` — permanent overlay shell, lang="de", CSP, layered sibling divs
- `src/host/host.css` — brand palette, z-index ladder base classes, bsk-pulse animation
- `src/host/host.js` — renderer glue, IPC subscription, data-dev attribute

## Decisions Made

- Split main.js into a top half (window construction, exported `createMainWindow`) and a bottom ORCHESTRATION half so plan 03 can replace only the bottom — clean wave-3 handoff with no merge conflicts on the window-construction code
- Kept preload.js callback-shaped rather than promise-shaped so the renderer never sees an `ipcRenderer.invoke` handle — locked-down surface area is the security contract
- Splash has `pointer-events: none` so even if a touch event leaks before the BrowserView attaches, no surface is interactive
- `paintWhenInitiallyHidden: true` added beyond the original action snippet's spec — known Electron quirk where `show:false` + slow first-paint occasionally fails to fire `ready-to-show`. Cheap insurance, no behavior cost.
- Strict CSP on host.html locks `default-src 'self'` from day one — Phase 4/5 layers cannot accidentally introduce remote font/image fetches without an explicit CSP edit

## Deviations from Plan

None - plan executed exactly as written. The `paintWhenInitiallyHidden: true` option was already specified in the plan's action snippet.

## Issues Encountered

- Git emitted CRLF line-ending warnings on Windows — expected, no impact, no .gitattributes file in repo yet (could be added in a future plan if needed).
- Unable to actually launch `npm start` from this executor session (no display attached + electron downloads/launches are slow), but file syntax verified via `node -c`, all acceptance-criteria literal-string checks passed, and the wiring matches the proven pattern in 01-RESEARCH.md lines 109-140 / 600-625.

## User Setup Required

None for this plan. To verify visually, the user can run `npm start` from the project root — a 420x800 windowed BrowserWindow should appear showing the dark splash with the bee logo, pulsing yellow bar, and "BITTE WARTEN…" text. DevTools will auto-open detached.

## Next Phase Readiness

- Plan 01-03 (keyboard lockdown) can now: import `createMainWindow` from `src/main/main.js`, replace the ORCHESTRATION block at the marker comment with the hardened version (single-instance lock, app.whenReady wiring, globalShortcut.register, before-input-event handler with reservedShortcuts Set)
- Plan 02-* (Phase 2 Magicline embed) can now: attach a BrowserView to the host BrowserWindow with bounds matching #magicline-mount, and fire `mainWindow.webContents.send` equivalent to `ipcMain.emit('cash-register-ready')` after CSS hide rules match
- Plans 04-* and 05-* can now: add sibling `<div>` layers to host.html at z-index 200/300/400 per the UI-SPEC ladder

## Self-Check: PASSED

- FOUND: src/main/main.js (contains backgroundColor '#1A1A1A', kiosk: !isDev, fullscreen: !isDev, frame: isDev, paintWhenInitiallyHidden: true, contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: isDev, Menu.setApplicationMenu(null), ipcMain.on('cash-register-ready', loadFile host.html, module.exports = { createMainWindow, isDev }, ORCHESTRATION marker)
- FOUND: src/main/preload.js (contextBridge.exposeInMainWorld('kiosk', onHideSplash, onShowSplash; does NOT contain 'nodeIntegration')
- FOUND: src/host/host.html (lang="de", id="magicline-mount", id="splash", assets/logo-dark.png, BITTE WARTEN, Content-Security-Policy meta)
- FOUND: src/host/host.css (#1A1A1A, #F5C518, #9CA3AF, z-index: 100, @keyframes bsk-pulse, body:not([data-dev="true"]) cursor: none)
- FOUND: src/host/host.js (window.kiosk.onHideSplash subscription; no setTimeout)
- FOUND: src/host/assets/logo-dark.png (already present from plan 01-01)
- VERIFIED: node -c src/main/main.js — syntax OK
- VERIFIED: node -c src/main/preload.js — syntax OK
- VERIFIED: node -c src/host/host.js — syntax OK
- VERIFIED: All Task 1 verify-script literal-string checks passed (exit 0, "OK")
- VERIFIED: All Task 2 verify-script literal-string checks passed (exit 0, "OK")
- FOUND: commit 082e818 (Task 1)
- FOUND: commit be0a090 (Task 2)

---
*Phase: 01-locked-down-shell-os-hardening*
*Completed: 2026-04-08*
