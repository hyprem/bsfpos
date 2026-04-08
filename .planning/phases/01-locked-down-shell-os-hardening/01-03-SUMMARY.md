---
phase: 01-locked-down-shell-os-hardening
plan: 03
subsystem: shell
tags: [electron, keyboard, lockdown, single-instance, auto-start, globalShortcut]

requires:
  - 01-01 (Electron project skeleton, logger)
  - 01-02 (main.js with createMainWindow + ORCHESTRATION marker)
provides:
  - Single-instance lock via app.requestSingleInstanceLock() as first executable call after requires (D-05)
  - Reusable attachLockdown(webContents) exported from src/main/keyboardLockdown.js — Phase 2 will attach it to the Magicline BrowserView webContents
  - Reserved shortcuts registry (reservedShortcuts Set, empty in Phase 1) — Phase 5 will add 'Ctrl+Shift+F12' per D-10
  - SUPPRESS_LIST covering all SHELL-04 required combos (Alt+F4, Alt+Tab, F11, Escape, Ctrl+W) plus D-09 defensive extras (Ctrl+R, F5, Ctrl+Shift+I, F12, Ctrl+Shift+J, Ctrl+P, Ctrl+U, Ctrl+O, Ctrl+N, Ctrl+T)
  - Bare Meta (Win) key suppression via explicit input.key check
  - D-04 runtime layer: app.setLoginItemSettings({openAtLogin: true, name: 'Bee Strong POS', path: process.execPath}) — pairs with plan 04's install-time Startup shortcut for belt-and-suspenders auto-start
  - D-11 defense-in-depth: globalShortcut.register no-ops for Alt+F4/F11/Escape during startup race; unregisterAll on will-quit
affects:
  - 02-* (Phase 2 will call attachLockdown(browserView.webContents) on the Magicline child view — per Pitfall 1, before-input-event only fires on the focused webContents)
  - 05-* (Phase 5 admin hotkey will import reservedShortcuts from src/main/keyboardLockdown.js and call .add('Ctrl+Shift+F12'))

tech-stack:
  added: []
  patterns:
    - "Keyboard lockdown isolated in src/main/keyboardLockdown.js — one module, single responsibility, reusable across every webContents that holds focus"
    - "canonical(input) accelerator builder: [Ctrl]+[Alt]+[Shift]+[Meta]+key — matches Electron's globalShortcut accelerator grammar so Phase 5 can drop 'Ctrl+Shift+F12' into reservedShortcuts by the exact string"
    - "Dev mode gating at the module level (isDev check inside attachLockdown) — zero suppression side effects during npm start"
    - "Belt-and-suspenders auto-start: runtime setLoginItemSettings layer from main.js + install-time Startup shortcut from installer.nsh (plan 04) — neither alone is sufficient, together they self-heal"

key-files:
  created:
    - "src/main/keyboardLockdown.js — attachLockdown, reservedShortcuts Set, SUPPRESS_LIST, canonical"
  modified:
    - "src/main/main.js — added globalShortcut + attachLockdown imports; replaced the ORCHESTRATION block below the marker with the hardened version (single-instance lock, setLoginItemSettings, globalShortcut, attachLockdown wiring, will-quit unregister)"

key-decisions:
  - "Kept the ORCHESTRATION marker comment verbatim so future phases can find the boundary between createMainWindow and the main.js orchestration block"
  - "No second-instance event handler — kiosk mode guarantees first window is topmost, so focusing is a no-op. Matches D-05 and SHELL-02 'silently discarded' wording"
  - "process.exit(0) alongside app.quit() on lock-fail — app.quit() is async, belt-and-suspenders exit guarantees the second instance does not continue executing any requires or side effects before the event loop unwinds"
  - "Lowercase AND uppercase Ctrl+letter entries in SUPPRESS_LIST — input.key is lowercase when Shift is not held; uppercase only when Shift is held. Including both is cheaper than a case-normalizing branch"
  - "Bare Meta key suppressed via explicit if (input.key === 'Meta') rather than a SUPPRESS_LIST entry — canonical() would emit 'Meta+Meta' which is fragile"
  - "reservedShortcuts mutation is owned by Phase 5, not this module — keeping add() calls out of keyboardLockdown.js preserves the single-responsibility contract"
  - "setLoginItemSettings gated behind !isDev per PITFALLS pitfall 2 — in dev the execPath is node_modules/electron/dist/electron.exe, registering that in HKCU Run would point Windows at an uninstallable dev dependency"
  - "globalShortcut.register gated behind !isDev — the dev developer needs Escape, F11, and Alt+F4 to work normally (DevTools, fullscreen toggle, close window)"

patterns-established:
  - "All future webContents that the user can focus (Phase 2 BrowserView, any future child views) MUST receive attachLockdown() — there is no global handler, each focused webContents fires its own before-input-event"
  - "New suppression combos are added to SUPPRESS_LIST in src/main/keyboardLockdown.js, not scattered across main.js — one file to audit when a Magicline update changes which shortcuts are safe to let through"
  - "will-quit is the canonical place to release process-wide Electron resources (globalShortcut.unregisterAll); future phases registering other process-wide resources follow the same pattern"

requirements-completed: [SHELL-02, SHELL-04]

duration: ~4 min
completed: 2026-04-08
---

# Phase 01 Plan 03: Keyboard Lockdown + Single-Instance + Auto-Start Summary

**Hardened main.js orchestration: single-instance lock as first executable call, reusable attachLockdown module wired to the host webContents, globalShortcut defense-in-depth for the startup race, and runtime HKCU Run registration — delivering SHELL-02, SHELL-04, and the D-04 runtime auto-start layer.**

## Performance

- **Duration:** ~4 min
- **Started:** 2026-04-08T18:03:16Z
- **Completed:** 2026-04-08T18:07:00Z
- **Tasks:** 2
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `src/main/keyboardLockdown.js` created with the exact Phase 1 → Phase 2 → Phase 5 integration contract: `attachLockdown(webContents)`, `reservedShortcuts` Set (empty in Phase 1), `SUPPRESS_LIST` Set, and `canonical(input)` accelerator builder
- `SUPPRESS_LIST` covers all six SHELL-04 required combos (Alt+F4, Alt+Tab, F11, Escape, Ctrl+W both cases) plus D-09 defensive extras (Ctrl+R/r, Ctrl+Shift+R, F5, Ctrl+Shift+I, F12, Ctrl+Shift+J, Ctrl+P/p, Ctrl+U/u, Ctrl+O/o, Ctrl+N/n, Ctrl+T/t)
- `canonical({control: true, shift: true, key: 'F12'})` returns exactly `'Ctrl+Shift+F12'` — verified via node one-liner. Phase 5 can drop that string into `reservedShortcuts.add()` and the handler will pass it through unchanged
- Dev-mode no-op: `attachLockdown` returns immediately when `process.env.NODE_ENV === 'development'`, logging `keyboardLockdown: dev mode — suppression disabled`
- Bare Meta (Win) key suppressed via explicit `if (input.key === 'Meta')` — catches naked Win press regardless of how `canonical()` would stringify it
- `src/main/main.js` top-of-file now destructures `globalShortcut` alongside `app, BrowserWindow, Menu, ipcMain` and imports `{ attachLockdown }` from `./keyboardLockdown` — both changes live above the ORCHESTRATION marker so the split between window construction and orchestration stays clean
- The ORCHESTRATION block below the marker has been replaced with the hardened version from the plan: single-instance lock → whenReady → setLoginItemSettings (prod only) → globalShortcut.register no-ops (prod only) → createMainWindow → attachLockdown(mainWindow.webContents) → will-quit unregisters → window-all-closed quits
- Single-instance lock is the first executable call after requires; `app.requestSingleInstanceLock()` → false branch calls both `app.quit()` AND `process.exit(0)` per D-05, with no second-instance event handler registered (kiosk mode topmost-window guarantee)
- `app.setLoginItemSettings` call writes HKCU Run entry `Bee Strong POS` → `process.execPath` on every prod boot; gated behind `!isDev` per PITFALLS pitfall 2 so dev runs never register node_modules electron.exe
- `globalShortcut.register` for `Alt+F4`, `F11`, `Escape` with empty handlers catches the ~50-500ms startup race window; `globalShortcut.unregisterAll()` called on `will-quit` for clean shutdown
- `createMainWindow` function body untouched — still exports `{ createMainWindow, isDev }` via `module.exports` as plan 02 wrote it
- ORCHESTRATION marker comment preserved verbatim (`grep -c` returns 1) so the comment stays a reliable anchor for any future plan that needs to edit the orchestration block

## Task Commits

1. **Task 1: Create src/main/keyboardLockdown.js with attachLockdown + reservedShortcuts** — `8ecdf86` (feat)
2. **Task 2: Replace main.js ORCHESTRATION block with hardened version** — `6a98a38` (feat)

## Files Created/Modified

- `src/main/keyboardLockdown.js` — new module exporting attachLockdown, reservedShortcuts Set, SUPPRESS_LIST Set, canonical function
- `src/main/main.js` — added globalShortcut to electron require destructure, added `const { attachLockdown } = require('./keyboardLockdown')`, replaced ORCHESTRATION block below marker with hardened version

## Decisions Made

- **No second-instance handler:** D-05 is explicit — kiosk mode guarantees the first window is topmost, so there is nothing to focus. Omitting the handler is correct, not an oversight. Also prevents an attacker-launched second process from reaching the first process's handler code at all.
- **Belt-and-suspenders exit on lock-fail:** `app.quit()` + `process.exit(0)` together. `app.quit()` is async (waits for events to drain) — `process.exit(0)` immediately after guarantees no further code executes in the second instance, even if a require elsewhere in the file tree had side effects.
- **Dual-case Ctrl+letter entries in SUPPRESS_LIST:** Electron's `input.key` reports lowercase letters when Shift is not held and uppercase when it is. Adding both cases is O(1) lookup cost and removes one branch from the hot path.
- **Explicit Meta-key branch:** `canonical({meta: true, key: 'Meta'})` would produce `'Meta+Meta'` which is fragile and relies on internal details. A dedicated `if (input.key === 'Meta') event.preventDefault()` is clearer and handles the bare Win-key press unambiguously.
- **reservedShortcuts mutation lives in Phase 5:** This module exports the Set but never calls `.add()` on it. Phase 5 will require this module and call `.add('Ctrl+Shift+F12')` from its own plan's code. Keeps the Phase 1 module single-responsibility.
- **Dev gating at two layers:** `attachLockdown` no-ops in dev AND the main.js `if (!isDev)` guard around `setLoginItemSettings` + `globalShortcut.register` blocks. Two layers because the cost of accidentally registering HKCU Run entries pointing at node_modules/electron.exe during development is high (dev machine pollution) and the cost of double-checking is zero.
- **globalShortcut only for 3 chords, not all of SUPPRESS_LIST:** `globalShortcut` is defense-in-depth for the startup race only. The real handler is `before-input-event`. Registering 20+ global shortcuts would add process-wide side effects for negligible value over the ~50-500ms race window.

## Deviations from Plan

None - plan executed exactly as written. Task 2 edit preserved `createMainWindow` above the marker verbatim and only added the two import-layer changes (globalShortcut + attachLockdown) plus the full ORCHESTRATION replacement below the marker.

## Issues Encountered

- Git emitted CRLF line-ending warnings on Windows for both new/modified files — expected, same as plans 02 and 04, no .gitattributes file in repo.
- Unable to actually launch `electron .` from this executor session to visually verify suppression behavior — file syntax verified via `node --check`, all acceptance-criteria literal-string checks passed, and the wiring matches the canonical patterns in `.planning/phases/01-locked-down-shell-os-hardening/01-RESEARCH.md`. Visual/functional verification is left for the next time the developer runs `npm start` or `electron .` on the kiosk-target Windows machine.

## User Setup Required

None for this plan. To validate end-to-end:
1. Run `npm start` — dev window should appear normally, keyboard suppression disabled, no HKCU Run entry created, single-instance lock enforced.
2. Run two concurrent `npm start` sessions (or better, run `electron .` with `NODE_ENV` unset twice in a row) — the second instance should exit silently; the first window should NOT receive a focus event.
3. For prod simulation: build with `npm run build:dir` (plan 04), launch `dist/win-unpacked/Bee Strong POS.exe`, then try Alt+F4 / F11 / Escape / Ctrl+W / Alt+Tab / Win key — none should close or unfullscreen the window. DevTools shortcuts (Ctrl+Shift+I, F12, Ctrl+Shift+J) should also be suppressed.
4. After a prod boot, `Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" | Select-Object "Bee Strong POS"` should return the registered exe path.

## Next Phase Readiness

- **Phase 01 plan 06** (if any phase-01 integration / verification plan remains): single-instance + keyboard lockdown + auto-start are all wired and ready to be exercised.
- **Phase 02 (Magicline embed):** MUST call `attachLockdown(browserView.webContents)` (or `webContentsView.webContents`) immediately after attaching the child view, using `const { attachLockdown } = require('./keyboardLockdown')`. Without this, Alt+F4 etc. will escape when focus moves to the Magicline view (Pitfall 1 in RESEARCH.md — before-input-event fires only on the focused webContents).
- **Phase 05 (Admin hotkey):** imports `const { reservedShortcuts } = require('./keyboardLockdown')` and calls `reservedShortcuts.add('Ctrl+Shift+F12')` before registering its own listener for that chord. No changes to keyboardLockdown.js itself required.
- **Phase 01 plan 04** (already complete): install-time Startup shortcut layer is in place; together with this plan's runtime `setLoginItemSettings` layer, SHELL-03 is fully delivered per the D-04 belt-and-suspenders model. If either layer is deleted by an operator, the other still fires on next boot.

## Known Stubs

None. `attachLockdown` is a no-op in dev by design (D-07), not a stub. `reservedShortcuts` is intentionally empty in Phase 1 — Phase 5 will add the admin hotkey entry; this is a documented scope boundary, not missing functionality.

## Self-Check: PASSED

- FOUND: src/main/keyboardLockdown.js (exports attachLockdown, reservedShortcuts, SUPPRESS_LIST, canonical)
- FOUND: src/main/main.js contains `globalShortcut` in electron require destructure
- FOUND: src/main/main.js contains `const { attachLockdown } = require('./keyboardLockdown');`
- FOUND: src/main/main.js contains `app.requestSingleInstanceLock()` followed by `app.quit()` + `process.exit(0)` on !gotLock branch
- FOUND: src/main/main.js contains `app.setLoginItemSettings(` inside `if (!isDev)` with `name: 'Bee Strong POS'` and `path: process.execPath`
- FOUND: src/main/main.js contains `globalShortcut.register(chord, () => {` inside `if (!isDev)` for Alt+F4/F11/Escape loop
- FOUND: src/main/main.js contains `globalShortcut.unregisterAll()` inside `will-quit` handler
- FOUND: src/main/main.js contains `attachLockdown(mainWindow.webContents)` after `createMainWindow()` inside whenReady callback
- FOUND: src/main/main.js does NOT contain a `second-instance` event handler
- VERIFIED: `grep -c "// --- ORCHESTRATION (plan 03 REPLACES everything below this line) -----------" src/main/main.js` returns 1
- VERIFIED: `node --check src/main/keyboardLockdown.js` — syntax OK
- VERIFIED: `node --check src/main/main.js` — syntax OK
- VERIFIED: Task 1 verify script (node -e with 11 assertions) exits 0 with output "OK"
- VERIFIED: Task 2 verify script (node -e with 10 assertions) exits 0 with output "OK"
- VERIFIED: requestSingleInstanceLock call appears before app.whenReady call in file order
- FOUND: commit 8ecdf86 (Task 1)
- FOUND: commit 6a98a38 (Task 2)

---
*Phase: 01-locked-down-shell-os-hardening*
*Completed: 2026-04-08*
