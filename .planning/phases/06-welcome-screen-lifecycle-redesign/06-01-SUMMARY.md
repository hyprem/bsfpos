---
phase: 06-welcome-screen-lifecycle-redesign
plan: 01
subsystem: host-renderer
tags: [welcome-screen, ipc, idle-overlay, d-02, d-04]
requires: []
provides:
  - "#welcome-screen layer (z-index 150) in host.html/css"
  - "welcome:show / welcome:hide / welcome:tap IPC surface on window.kiosk"
  - "Idle overlay countdown initialised to 10s (was 30s)"
affects:
  - src/host/host.html
  - src/host/host.css
  - src/host/host.js
  - src/main/preload.js
tech-stack:
  added: []
  patterns:
    - "Callback-shaped contextBridge preload entries (onShowWelcome/onHideWelcome/notifyWelcomeTap)"
    - "Colon-separated IPC channel names for Phase 6 (welcome:show/welcome:hide/welcome:tap)"
    - "Layer toggled via display:none/flex + aria-hidden, consistent with Phase 1-5 layers"
key-files:
  created: []
  modified:
    - src/host/host.html
    - src/host/host.css
    - src/host/host.js
    - src/main/preload.js
decisions:
  - "Welcome layer placed at z-index 150 (above base 0, below splash 100 reorder: welcome under splash so splash can still cover welcome during first-tap loading transition per D-03)"
  - "Full-viewport tap target — no dedicated button (D-02)"
  - "Badge keystrokes during welcome are intentionally ignored (NFC-05 deferred)"
metrics:
  duration: "~6 min"
  completed: 2026-04-13
  tasks: 2
  commits: 2
---

# Phase 6 Plan 01: Welcome Layer + Preload IPC + Idle Countdown 10s Summary

Renderer-side scaffolding for the new welcome-as-resting-state lifecycle: new `#welcome-screen` host layer with German CTA "Zum Kassieren tippen", callback-shaped preload IPC bridges (`welcome:show` / `welcome:hide` / `welcome:tap`), and the D-04 idle countdown text shortened from 30s to 10s. No main-process changes in this plan — Plan 06-03 will drive the layer from main.

## What Was Built

### Task 1 — Welcome layer markup + CSS (commit `b39e3d2`)

- `src/host/host.html`:
  - Added `150 — #welcome-screen` entry to the z-index ladder comment block between `100 — #splash` and `200 — #idle-overlay`.
  - Inserted new `#welcome-screen` div (`role="button"`, `tabindex="0"`, `aria-label="Zum Kassieren tippen"`, `display:none;` default) containing the Bee Strong logo (260px) and `<h1 class="bsk-welcome-title">Zum Kassieren tippen</h1>`, positioned immediately before the Phase 4 `#idle-overlay` layer.
  - One-character edit: `<span id="idle-countdown-number">30</span>` → `10` so first paint matches D-04 before `showIdleOverlay` runs.
- `src/host/host.css`: appended new `/* Phase 6: Welcome screen */` section between splash rules and `.bsk-layer--magicline-error` with:
  - `.bsk-layer--welcome { z-index: 150; background: #1A1A1A; cursor: pointer; pointer-events: auto; }`
  - `.bsk-welcome-title { font-size: 48px; font-weight: 700; color: #F5C518; ... max-width: 80vw; }`

No other layers (idle, magicline-error, credentials, pin-modal, admin-menu) were touched.

### Task 2 — Preload IPC + host.js wiring + countdown literals (commit `3373da5`)

- `src/main/preload.js`: extended `contextBridge.exposeInMainWorld('kiosk', {...})` with three new entries (after the Phase 5 `submitUpdatePat` line):
  - `onShowWelcome: (cb) => ipcRenderer.on('welcome:show', () => cb())`
  - `onHideWelcome: (cb) => ipcRenderer.on('welcome:hide', () => cb())`
  - `notifyWelcomeTap: () => { ipcRenderer.send('welcome:tap'); }`
  - Follows the callback-only shape of existing Phase 1-5 entries — no raw `ipcRenderer` exposed to host.js. Colon-separated channel names per Phase 1 convention.
- `src/host/host.js`:
  - New "Phase 6 — Welcome screen" block before the Magicline error block: `showWelcome()`, `hideWelcome()`, `handleWelcomeTap(ev)`. `handleWelcomeTap` calls `ev.stopPropagation()` and fires `window.kiosk.notifyWelcomeTap()` inside a try/catch.
  - `wireStatic()`: after the keypad-button loop, registers `pointerdown` and `touchstart` listeners on `#welcome-screen` → `handleWelcomeTap`. A block comment documents NFC-05: badge keystrokes during welcome are intentionally not forwarded.
  - `if (window.kiosk)` block: adds `onShowWelcome(showWelcome)` and `onHideWelcome(hideWelcome)` subscriptions alongside the Phase 5 `onHidePinLockout` entry.
  - `showIdleOverlay()`: `var countdown = 30` → `10`, `numEl.textContent = '30'` → `'10'` (D-04).

## Verification

- Automated per-task node-inline checks (see PLAN `<verify>`): **PASS** for both tasks.
- Full test suite: project has no `test` script (only `start` / `build` / `build:dir`) — the PLAN's `npm test` check was a soft fallback (`|| echo 'no host tests (ok)'`), so there are no tests to regress.
- Manual smoke path available per PLAN `<verification>`:
  1. `npm start`; splash clears.
  2. DevTools (main eval): `mainWindow.webContents.send('welcome:show')` → full-viewport yellow CTA on black.
  3. Tap welcome → `welcome:tap` IPC fires (no main handler yet — Plan 06-03 adds it).
  4. Force idle overlay → countdown starts at "10" not "30".

## Deviations from Plan

None — plan executed exactly as written.

## Threat Flags

No new trust boundaries introduced. All new IPC entries follow the Phase 1-5 callback-only pattern and are listed in the PLAN's `<threat_model>` (T-06-01..T-06-05). Sender validation is deferred to Plan 06-03 (T-06-02 mitigation plan).

## Self-Check: PASSED

- src/host/host.html: FOUND (welcome-screen div, z-index ladder entry, idle-countdown-number=10)
- src/host/host.css: FOUND (.bsk-layer--welcome, .bsk-welcome-title)
- src/host/host.js: FOUND (showWelcome/hideWelcome/handleWelcomeTap, pointerdown listener, onShowWelcome subscription, countdown=10)
- src/main/preload.js: FOUND (welcome:show, welcome:hide, welcome:tap, notifyWelcomeTap)
- commit b39e3d2: FOUND
- commit 3373da5: FOUND
