# Milestones

## v1.0 MVP (Shipped: 2026-04-12)

**Phases completed:** 5 phases, 32 plans, 23 tasks

**Key accomplishments:**

- Electron 41.1 project skeleton with pinned deps, CommonJS package.json, electron-log rotating file logger, and brand assets staged for ASAR bundling.
- Single 420x800 dev / fullscreen prod kiosk BrowserWindow loading a permanent host.html overlay with a branded dark splash, contextBridge preload, and the ipcMain cash-register-ready stub Phase 2 will fire.
- Hardened main.js orchestration: single-instance lock as first executable call, reusable attachLockdown module wired to the host webContents, globalShortcut defense-in-depth for the startup race, and runtime HKCU Run registration — delivering SHELL-02, SHELL-04, and the D-04 runtime auto-start layer.
- Added electron-builder `build` block to package.json with per-user NSIS target (no UAC, no desktop/start-menu shortcut) and a custom `build/installer.nsh` that creates and removes a Startup folder shortcut on install/uninstall — delivering the D-04 install-time auto-start layer.
- Wrote `docs/runbook/PHASE-01-ACCEPTANCE.md` — the structural + static-inspection acceptance evidence for SHELL-01..06. Ran the keyboardLockdown `canonical()` probe live and confirmed all SHELL-04 required combos are SUPPRESSED. Captured the electron-builder warning baseline from the plan-04 `--dir` build. Explicitly marked the 4 interactive visual/chord checks as PENDING-HUMAN for the 01-06 owner checkpoints, rather than fabricating pass results.
- Zero occurrences of `BrowserView(`, `setBrowserView`, or `addBrowserView`
- 1. [Rule 1 - Bug] electron-store imported via `.default` instead of plain require
- Primary signal:
- Write path:
- Status: Task 1 complete. Task 2 deferred to next session.
- Status:
- Chosen path: authoritative declaration in fragile-selectors.js only.
- Phase 4 closed with 102/102 automated tests green (unit + integration + 100-cycle harness); all 13 physical requirements deferred to a consolidated next-kiosk-visit checklist because kiosk hardware was unavailable on the execution date and the Deka NFC reader has never been physically validated against the Electron build.
- One-liner:
- One-liner:
- One-liner:
- One-liner:
- One-liner:

---
