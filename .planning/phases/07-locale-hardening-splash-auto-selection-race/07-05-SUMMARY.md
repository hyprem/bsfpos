---
phase: 07-locale-hardening-splash-auto-selection-race
plan: "05"
subsystem: host+preload
tags: [splash, pointer-events, safety-timeout, IPC, SPLASH-01]
dependency_graph:
  requires: [07-03 splash:hide-final IPC + welcomeTapPending gate]
  provides: [onHideSplashFinal preload bridge, auto-select-pending CSS, welcome-path splash gate, 5500ms safety timeout]
  affects: [src/main/preload.js, src/host/host.js, src/host/host.css]
tech_stack:
  added: []
  patterns: [module-scope state machine with clearTimeout safety valve, classList toggle for CSS state, re-entry guard (splashPendingMode flag)]
key_files:
  created: []
  modified:
    - src/main/preload.js
    - src/host/host.js
    - src/host/host.css
decisions:
  - "hideSplash is the single cleanup entry point for both cold-boot/idle-recovery (splash:hide) and welcome-path (splash:hide-final / 5500ms timer) — avoids duplicate cleanup paths"
  - "showSplash does NOT clear splashPendingMode — welcome:tap calls enterSplashPendingMode() before notifyWelcomeTap(), and main sends splash:show back as a round-trip; clearing in showSplash would stomp the flag we just set"
  - "onShowSplash subscriber re-applies auto-select-pending class when splashPendingMode is true — required because showSplash() runs classList.remove defensively, which would wipe the class added by enterSplashPendingMode on the round-trip"
  - "onHideSplashFinal guarded by if (window.kiosk.onHideSplashFinal) — tolerates preload skew during dev hot-reload without TypeError"
metrics:
  duration_minutes: ~2
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  files_changed: 3
---

# Phase 07 Plan 05: Host-Side Splash Gate (SPLASH-01) Summary

**One-liner:** Welcome-path splash gate wired end-to-end — preload bridge for splash:hide-final, .auto-select-pending pointer-events CSS, and host.js enterSplashPendingMode/hideSplashFinal with 5500 ms safety timeout closing the tap-derail window.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Expose onHideSplashFinal bridge + .auto-select-pending CSS rule | daef4be | src/main/preload.js, src/host/host.css |
| 2 | Wire host.js welcome-path splash gate with 5500ms safety timeout | a49f5cb | src/host/host.js |

## What Was Built

### Task 1 — preload.js + host.css

**preload.js (one addition):**

Added immediately after the existing `onShowSplash` line:

```js
onHideSplashFinal: (cb) => ipcRenderer.on('splash:hide-final', (_e, payload) => cb(payload || {})),
```

Subscribes to the `splash:hide-final` IPC emitted by main.js (Plan 03) only when `welcomeTapPending` is true. Payload forwarded as `{ degraded: bool }`.

**host.css (one new rule):**

```css
.bsk-layer--splash.auto-select-pending {
  pointer-events: auto;
}
```

Adjacent to the base `.bsk-layer--splash { pointer-events: none }` rule. The class is toggled by host.js and is the only difference from the base — no modification to the base rule.

### Task 2 — host.js

**Module-scope state (three variables):**
- `var splashPendingMode = false` — true only in the welcome-tap → sentinel window
- `var splashSafetyTimer = null` — handle for the 5500 ms fallback setTimeout
- `var SPLASH_SAFETY_TIMEOUT_MS = 5500` — named constant (grep: `SPLASH_SAFETY_TIMEOUT_MS`)

**`hideSplash()` (replaced body):**
Always clears timer + pending class + sets `display:none`. Single cleanup entry point for all splash-hide paths (cold-boot, idle-recovery, welcome-path final, safety timeout). Defensive clear ensures no stale state survives mode transitions.

**`showSplash()` (replaced body):**
Removes `auto-select-pending` class and sets `display:flex`. Does NOT clear `splashPendingMode` — see decisions above for ordering rationale.

**`enterSplashPendingMode()` (new function):**
Re-entry guarded on `splashPendingMode`. Sets flag, adds `.auto-select-pending` class to splash element, starts `SPLASH_SAFETY_TIMEOUT_MS` timer. Timer fires `hideSplash()` with a `console.warn('[BSK] splash safety timeout...')` warning for kiosk-visit grep.

**`hideSplashFinal(payload)` (new function):**
Accepts `{ degraded: bool }` payload (unused by host; main has already written the audit log). Delegates directly to `hideSplash()` which handles all cleanup.

**`handleWelcomeTap()` (modified):**
Now calls `enterSplashPendingMode()` before `notifyWelcomeTap()` so the pending class is applied before the IPC round-trip that causes `showSplash()` to run.

**`onShowSplash` subscriber (modified):**
Wraps `showSplash()` and re-applies `.auto-select-pending` class when `splashPendingMode` is true, compensating for `showSplash()`'s defensive classList.remove.

**`onHideSplashFinal` subscriber (new, in IPC wiring block):**
```js
if (window.kiosk.onHideSplashFinal) {
  window.kiosk.onHideSplashFinal(hideSplashFinal);
}
```

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. All code paths are structurally complete. The `hideSplashFinal` payload's `degraded` field is accepted but not currently acted on by host — this is intentional; the audit log is written on the main side (Plan 03). No future plan needs host-side degraded handling.

## Threat Surface Scan

All surfaces were explicitly modelled in the plan's threat register:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: pointer-events-gate | src/host/host.css, src/host/host.js | T-07-02 mitigated — 5500ms timer runs independently of main-side welcomeTapPending; hideSplash() always clears timer + pending class. splash:hide from cold-boot/idle-recovery also defensively clears pending state. |

No new network endpoints, auth paths, or schema changes introduced.

## Self-Check: PASSED

| Item | Result |
|------|--------|
| src/main/preload.js contains onHideSplashFinal | FOUND |
| src/main/preload.js contains splash:hide-final | FOUND |
| src/host/host.css contains .bsk-layer--splash.auto-select-pending | FOUND |
| src/host/host.css new rule sets pointer-events: auto | FOUND |
| src/host/host.js contains var splashPendingMode = false | FOUND |
| src/host/host.js contains SPLASH_SAFETY_TIMEOUT_MS = 5500 | FOUND |
| src/host/host.js contains function enterSplashPendingMode( | FOUND |
| src/host/host.js contains function hideSplashFinal( | FOUND |
| src/host/host.js contains onHideSplashFinal(hideSplashFinal) | FOUND |
| src/host/host.js hideSplash contains clearTimeout(splashSafetyTimer) | FOUND |
| src/host/host.js hideSplash contains classList.remove('auto-select-pending') | FOUND |
| src/host/host.js handleWelcomeTap calls enterSplashPendingMode before notifyWelcomeTap | FOUND |
| src/host/host.js onShowSplash handler contains splashPendingMode | FOUND |
| Commit daef4be | FOUND |
| Commit a49f5cb | FOUND |
