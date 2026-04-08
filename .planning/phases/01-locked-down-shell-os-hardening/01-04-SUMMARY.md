---
phase: 01-locked-down-shell-os-hardening
plan: 04
subsystem: packaging
tags: [electron-builder, nsis, packaging, auto-start, installer]

requires:
  - 01-01 (Electron project skeleton, pinned electron-builder ~26.8.1)
provides:
  - electron-builder `build` block in package.json (NSIS Windows target, per-user install)
  - build/installer.nsh with customInstall + customUnInstall macros managing $SMSTARTUP shortcut
  - Reproducible `npm run build` producing `Bee Strong POS-Setup-0.1.0.exe` in dist/
  - Unpacked build artifact `dist/win-unpacked/Bee Strong POS.exe` (proven via --dir)
  - D-04 install-time auto-start layer (pairs with plan 03 runtime layer from setLoginItemSettings)
affects:
  - 01-03 (runtime layer setLoginItemSettings — together with this install-time layer delivers SHELL-03)
  - 05-* (Phase 5 BRAND-01 will add build/icon.ico to silence the "default Electron icon" warning)
  - 05-* (Phase 5 auto-update will add a `publish` block for GitHub Releases + electron-updater)

tech-stack:
  added: []
  patterns:
    - "electron-builder config lives inline in package.json (not electron-builder.yml) — simpler single-file config, no extra config file to sync"
    - "Custom NSIS macros in build/installer.nsh via build.nsis.include — electron-builder has no first-class Startup folder option"
    - "Per-user install (perMachine:false) lands in %LocalAppData%\\Programs\\Bee Strong POS\\ — no UAC, works for standard-user kiosk account"
    - "Symmetric install/uninstall: both customInstall and customUnInstall use SetShellVarContext current + $SMSTARTUP"

key-files:
  created:
    - "build/installer.nsh — customInstall/customUnInstall NSIS macros managing Startup folder shortcut"
  modified:
    - "package.json — added top-level `build` block with nsis/win/files/directories config"

key-decisions:
  - "Kept electron-builder config inline in package.json (not a separate electron-builder.yml) — single source of truth, no extra file to keep in sync with pinned deps"
  - "deleteAppDataOnUninstall:false — preserve %AppData%/Bee Strong POS/logs/ across reinstalls for post-mortem diagnosis over RDP"
  - "runAfterFinish:false — D-04 correctness: first launch happens on next user login via Startup shortcut, not from the installer itself (prevents double-launch race with single-instance lock)"
  - "No `publish` block — Phase 5 owns GitHub Releases + electron-updater wiring; adding it here would create wave merge conflicts"
  - "No code signing — explicitly out of scope per REQUIREMENTS.md; SmartScreen one-click accepted for single-device kiosk"
  - "Accepted default Electron icon for Phase 1 — build/icon.ico is deferred to Phase 5 BRAND-01 (electron-builder warns but build succeeds)"

patterns-established:
  - "All future electron-builder config additions (publish, fileAssociations, etc.) go into the package.json build block, not a separate YAML file"
  - "Install-time side effects (Startup shortcut, future registry touches) live exclusively in build/installer.nsh — clean boundary between electron-builder config and NSIS script"
  - "dist/ is gitignored and never committed — build artifacts are produced on demand via `npm run build`"

requirements-completed: [SHELL-03]

duration: ~3 min
completed: 2026-04-08
---

# Phase 01 Plan 04: electron-builder NSIS Installer + Startup Shortcut Summary

**Added electron-builder `build` block to package.json with per-user NSIS target (no UAC, no desktop/start-menu shortcut) and a custom `build/installer.nsh` that creates and removes a Startup folder shortcut on install/uninstall — delivering the D-04 install-time auto-start layer.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-08T19:50:00Z
- **Completed:** 2026-04-08T19:56:00Z
- **Tasks:** 1
- **Files modified:** 2 (1 created, 1 modified)

## Accomplishments

- `package.json` now carries a complete top-level `build` block: `appId=com.beestrongfitness.pos`, `productName=Bee Strong POS`, per-user NSIS target for x64 Windows, strict files allowlist (`src/**/*` + `package.json`, excluding `**/*.md` and `**/.gitkeep` to keep planning docs out of the installer), output → `dist/`, buildResources → `build/`.
- NSIS config locked to kiosk-appropriate defaults: `oneClick:true`, `perMachine:false`, `allowToChangeInstallationDirectory:false`, `createDesktopShortcut:false`, `createStartMenuShortcut:false`, `runAfterFinish:false`, `deleteAppDataOnUninstall:false`.
- `build/installer.nsh` created with `customInstall` and `customUnInstall` macros, both using `SetShellVarContext current` + `$SMSTARTUP\${PRODUCT_NAME}.lnk`. Symmetric install/uninstall — the uninstaller cleanly removes the Startup shortcut (T-04-03 mitigation).
- **MANDATORY verification build succeeded:** `npx electron-builder --win --dir` downloaded Electron 41.1.1 win32-x64 binary, packaged the app, and produced `dist/win-unpacked/Bee Strong POS.exe` (222 MB). This exercises the full electron-builder config parsing path and proves the `files` allowlist, `productName`, and NSIS include reference are valid.
- Plan 01 additions (scripts, dependencies, devDependencies) are preserved intact — no regression on plan-01 state.

## Task Commits

1. **Task 1: electron-builder build block + installer.nsh** — `4b357f5` (feat)

## Files Created/Modified

- `package.json` — added top-level `build` block with `appId`, `productName`, `copyright`, `directories`, `files` allowlist, `win.target[0]=nsis/x64`, `artifactName=${productName}-Setup-${version}.${ext}`, and full `nsis` block
- `build/installer.nsh` — custom NSIS macros: `customInstall` creates `$SMSTARTUP\${PRODUCT_NAME}.lnk` pointing at `$INSTDIR\${PRODUCT_FILENAME}.exe`; `customUnInstall` deletes the same shortcut

## Decisions Made

- Inline `build` block in `package.json` rather than a separate `electron-builder.yml` — single source of truth, no extra file to track, matches the "one config file" kiosk-simplicity philosophy.
- `deleteAppDataOnUninstall:false` preserves `%AppData%/Bee Strong POS/logs/` across reinstalls so post-mortem diagnosis survives a reinstall triggered by staff.
- `runAfterFinish:false` is deliberate per D-04: the first launch happens via the Startup shortcut on next login, not from the installer. This avoids a race between the installer-launched process and the shortcut-launched process at next boot (the single-instance lock from plan 03 would catch it, but not triggering the race in the first place is cleaner).
- No `publish` block and no code-signing config — explicitly deferred to Phase 5 (auto-update + BRAND-01) and explicitly out of scope (REQUIREMENTS.md Out of Scope table).
- Accepted the Electron default diamond icon for Phase 1. `build/icon.ico` is a Phase 5 BRAND-01 deliverable.

## electron-builder Warnings Recorded (Phase 5 BRAND-01 Baseline)

Captured verbatim from `npx electron-builder --win --dir` run:

- `default Electron icon is used  reason=application icon is not set` — expected; add `build/icon.ico` in Phase 5 BRAND-01 to silence.
- `(node:40108) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities` — upstream electron-builder warning, not caused by our code; will be addressed when bumping electron-builder.

No errors. No signing attempted (out of scope). Build produced `dist/win-unpacked/Bee Strong POS.exe` successfully.

## Deviations from Plan

None - plan executed exactly as written.

## Issues Encountered

None. The `--dir` build took ~2 minutes including the first-time Electron 41.1.1 binary download (~142 MB) and winCodeSign-2.6.0 tool download. Subsequent builds on the same machine will be faster (cached).

Git emitted CRLF line-ending warnings on Windows for `package.json` and `build/installer.nsh` — expected, no impact, same as plan 02.

## User Setup Required

None for Phase 1. To produce the full signed installer (Phase 5), the operator will eventually need to run `npm run build` (without `--dir`) which invokes NSIS proper. The Phase 1 acceptance of the `--dir` unpacked build is sufficient to prove the configuration is valid and the installer layer is exercised end-to-end.

## Next Phase Readiness

- Phase 5 auto-update (WAVE) can now: add a `publish` block to `package.json.build` pointing at GitHub Releases, and pair it with `electron-updater` wiring in `src/main/main.js`. The existing NSIS config already produces the `latest.yml` metadata `electron-updater` consumes.
- Phase 5 BRAND-01 can now: drop a real `build/icon.ico` into the existing `buildResources` directory — no package.json change needed, electron-builder will pick it up automatically and silence the "default Electron icon is used" warning.
- Phase 1 plan 03 (runtime `setLoginItemSettings` layer) and this plan 04 (install-time Startup shortcut layer) together complete SHELL-03 per D-04 belt-and-suspenders: if the Startup shortcut is deleted, the runtime layer re-creates the HKCU Run entry on next boot; if the HKCU Run entry is deleted, the Startup shortcut still fires. Both safely coexist behind the single-instance lock from plan 03.

## Known Stubs

None. `build/icon.ico` is explicitly deferred to Phase 5 BRAND-01 with a documented electron-builder warning baseline — not a stub, a deliberate scope boundary.

## Self-Check: PASSED

- FOUND: package.json (contains `build.appId = com.beestrongfitness.pos`, `build.productName = Bee Strong POS`, `build.nsis.perMachine = false`, `build.nsis.oneClick = true`, `build.nsis.createDesktopShortcut = false`, `build.nsis.createStartMenuShortcut = false`, `build.nsis.runAfterFinish = false`, `build.nsis.include = build/installer.nsh`, `build.win.target[0].target = nsis`, `build.win.target[0].arch = [x64]`)
- FOUND: package.json does NOT contain a `publish` key (Phase 5 scope)
- FOUND: package.json still contains plan-01 scripts (`start`, `start:prod`, `build`, `build:dir`, `postinstall`) and devDependencies (electron ~41.1.1, electron-builder ~26.8.1, cross-env ~7.0.3) and dependency electron-log ~5.2.0
- FOUND: build/installer.nsh (contains `!macro customInstall`, `!macro customUnInstall`, `$SMSTARTUP`, `${PRODUCT_NAME}.lnk`)
- VERIFIED: plan verification script node -e "..." exits 0 with output "OK"
- VERIFIED: `npx electron-builder --win --dir` completed successfully, produced `dist/win-unpacked/Bee Strong POS.exe` (222 MB)
- FOUND: commit 4b357f5 (Task 1 — feat(01-04): add electron-builder NSIS config and Startup shortcut installer.nsh)

---
*Phase: 01-locked-down-shell-os-hardening*
*Completed: 2026-04-08*
