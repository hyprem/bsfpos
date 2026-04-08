# Phase 1 — Acceptance Evidence

**Date:** 2026-04-08
**Environment:** Developer Windows machine (C:\Users\Nico\vscode\bsfpos) — not the target gym POS terminal
**Target device verification:** Deferred to physical-device maintenance visit per
`docs/runbook/BREAKOUT-CHECKLIST.md`. This document covers only what can be verified
from the developer's unhardened Windows machine.

**Executor note:** This plan is `autonomous: false`. Items that require an interactive
`npm start` visual check on a live window, or a prod-simulation keyboard-chord test
that would lock the developer out of their own PC (T-06-02), are explicitly marked
**PENDING-HUMAN** below. The GSD executor filled in everything it could verify without
a display: static source inspection, `node --check` syntax verification, the
`keyboardLockdown.js` `canonical()`/`SUPPRESS_LIST` probe, `package.json`
electron-builder config inspection, and presence of the plan 01-04 `--dir` build
output. It did **not** fabricate any PASS result it could not mechanically confirm.

---

## SHELL-01 — Fullscreen kiosk, no chrome

- **Result:** PENDING-HUMAN (static code inspection PASS; live window verification
  deferred to the 01-06 human-verify checkpoint)
- **Static evidence (auto-verified):** `src/main/main.js` lines 20–39 construct the
  `BrowserWindow` with `kiosk: !isDev`, `fullscreen: !isDev`, `frame: isDev`,
  `autoHideMenuBar: true`, `Menu.setApplicationMenu(null)` (line 42). This matches
  the SHELL-01 contract for a prod launch (no chrome, no menu, no frame, kiosk on).
  Dev launches intentionally show a 420x800 windowed frame for development per D-07.
- **Live evidence (PENDING-HUMAN):** Requires running `npx electron .` with `NODE_ENV`
  unset on the developer machine and visually confirming (a) the window is full
  screen, (b) no title bar / menu bar is visible, (c) no taskbar overlay. This is the
  explicit 01-06 Task 2 checkpoint — the project owner will perform this step.

## SHELL-02 — Single-instance lock

- **Result:** PENDING-HUMAN (static code inspection PASS; runtime double-launch
  verification deferred to the 01-06 Task 1 checkpoint — requires two concurrent
  `npm start` processes and inspecting `%AppData%\Bee Strong POS\logs\main.log`
  after launch).
- **Static evidence (auto-verified):** `src/main/main.js` lines 88–95 call
  `app.requestSingleInstanceLock()` as the first executable statement after the
  `require` block. On `!gotLock` the code emits the exact log line
  `second instance detected — exiting silently (D-05)` then calls `app.quit()` and
  `process.exit(0)` per D-05 (belt-and-suspenders exit; no second-instance event
  handler, which is intentional per the plan 03 decision log).
- **Log line pattern (compile-time match):** `second instance detected — exiting silently (D-05)`
- **Process-count check (PENDING-HUMAN):** The `tasklist | findstr electron` output
  after attempting a double-launch cannot be captured non-interactively from this
  executor session.
- **`%AppData%\Bee Strong POS\logs\main.log` excerpt:** NOT AVAILABLE — the logs
  directory does not yet exist on this developer machine because `npm start` has
  not been run in this session. `src/main/logger.js` is configured to write to
  `%AppData%\Bee Strong POS\logs\main.log` on first launch per plan 01-01. Human
  verifier: run `npm start`, confirm the file is created, and confirm it contains
  at least one `app ready` line.

## SHELL-03 — Auto-start on boot (D-04 belt-and-suspenders)

- **Runtime layer (plan 03):** PASS (static code inspection).
  `src/main/main.js` lines 104–117 call `app.setLoginItemSettings` with
  `openAtLogin: true`, `name: 'Bee Strong POS'`, `path: process.execPath`, gated
  behind `if (!isDev)` so a dev `npm start` does NOT register an HKCU Run entry
  pointing at `node_modules/electron/dist/electron.exe`. Confirming the HKCU Run
  key is only meaningful after installing the NSIS build on the target kiosk.
- **Install-time layer (plan 04):** PASS (build artifact present).
  `npx electron-builder --win --dir` already ran during plan 01-04 and produced
  `dist/win-unpacked/Bee Strong POS.exe` (222 MB, `ls -la` confirms mtime
  2026-04-08 19:54). `build/installer.nsh` exists and contains both
  `!macro customInstall` and `!macro customUnInstall` macros managing
  `$SMSTARTUP\${PRODUCT_NAME}.lnk` (verified by literal-string inspection during
  plan 04 acceptance, commit `4b357f5`).
- **electron-builder warnings (from plan 01-04 `--dir` build, recorded verbatim —
  Phase 5 BRAND-01 baseline):**
  - `default Electron icon is used  reason=application icon is not set`
  - `(node:40108) [DEP0190] DeprecationWarning: Passing args to a child process with shell option true can lead to security vulnerabilities`

  No errors. No signing attempted (explicitly out of scope per REQUIREMENTS.md).
  These two warnings are the baseline that Phase 5 BRAND-01 will silence (the
  first by adding `build/icon.ico`; the second by an upstream electron-builder
  bump).

## SHELL-04 — Keyboard escape suppression

- **Result:** PASS (for all SHELL-04 required combos) with one informational note
  below.
- **`canonical()` + `SUPPRESS_LIST` probe output** (captured live from
  `node -e` on the developer machine, 2026-04-08):

  ```
  Alt+F4             -> Alt+F4             SUPPRESSED
  Alt+Tab            -> Alt+Tab            SUPPRESSED
  F11                -> F11                SUPPRESSED
  Escape             -> Escape             SUPPRESSED
  Ctrl+w             -> Ctrl+w             SUPPRESSED
  Ctrl+W (shift)     -> Ctrl+Shift+W       LEAKED    ← see note
  Meta bare          -> Meta               SUPPRESSED
  Ctrl+r             -> Ctrl+r             SUPPRESSED
  F5                 -> F5                 SUPPRESSED
  F12                -> F12                SUPPRESSED
  Ctrl+Shift+I       -> Ctrl+Shift+I       SUPPRESSED
  ```

  **Note on the `Ctrl+Shift+W` LEAKED row:** This is NOT a SHELL-04 failure.
  SHELL-04 requires suppression of `Ctrl+W` (close tab / window), which Electron
  reports as `input.key='w'` (lowercase, no shift) in `before-input-event`. The
  probe row above labelled `Ctrl+W (shift)` deliberately passes
  `{control:true, shift:true, key:'W'}` — that is the `Ctrl+Shift+W` accelerator,
  which is a completely different chord (Chromium "re-open closed tab") and is
  not part of SHELL-04. The canonical `Ctrl+w` row directly above it is
  SUPPRESSED, which is the SHELL-04 requirement. This row is included only to
  show the probe exercised the alternate form and behaved predictably. If
  defensive coverage of `Ctrl+Shift+W` is ever desired, add it to `SUPPRESS_LIST`
  in `src/main/keyboardLockdown.js:32`. Tracked under "Open issues" below.
- **Live prod-sim chord test (Alt+F4, F11, Escape, Ctrl+W) in a running
  `npx electron .` window:** PENDING-HUMAN. Must be exercised manually at the
  01-06 Task 1 checkpoint because the dev machine has no OS-layer hardening, so
  a running prod-sim locks the developer out until they kill the Electron process
  via Task Manager (T-06-02 acceptance).
- **Alt+Tab, bare Meta on dev machine:** Expected partial failure on the
  unhardened developer PC (`NoWinKeys` / `AllowEdgeSwipe` registry hardening from
  `docs/runbook/02-registry-hardening.reg` is NOT applied to the dev machine —
  only to the target kiosk device). Mitigated by plan 05 runbook on the target
  device.
- **Ctrl+Shift+F12 admin hotkey reservation:** `reservedShortcuts` Set is exported
  empty from `src/main/keyboardLockdown.js` per the plan-03 decision to defer
  the `.add('Ctrl+Shift+F12')` call to Phase 5 ADMIN-01. Not a Phase 1 deliverable.

## SHELL-05 — OS hardening runbook

- **Result:** PASS (file presence).
- **All 8 `docs/runbook/` files present** (verified via `ls docs/runbook/`):
  - `01-create-kiosk-user.ps1`
  - `02-registry-hardening.reg`
  - `03-custom-shell-winlogon.reg`
  - `04-gpo-hardening.ps1`
  - `05-verify-lockdown.ps1`
  - `BREAKOUT-CHECKLIST.md`
  - `README.md`
  - `ROLLBACK.ps1`
- **Target-device execution:** DEFERRED to the physical-device maintenance visit.
  The operator running the runbook on the gym POS terminal is expected to run
  `docs/runbook/05-verify-lockdown.ps1` as the final PASS/FAIL gate and attach
  its output here (or to `docs/runbook/BREAKOUT-CHECKLIST.md`) after that visit.
  **The developer machine is deliberately NOT hardened with this runbook** — we
  do not want the executor's PC to be locked into kiosk mode.

## SHELL-06 — Branded splash, no flash

- **Result:** PENDING-HUMAN (static code inspection PASS; first-paint visual
  confirmation deferred to the 01-06 Task 2 checkpoint).
- **Static evidence (auto-verified):**
  - `backgroundColor: '#1A1A1A'` present in `src/main/main.js:27` — this is the
    UI-SPEC dominant dark colour, so there is zero flash of white even before
    `host.html` finishes parsing.
  - `show: false` (line 22) + `ready-to-show` handler (lines 44–50) pattern is in
    place. The window is only made visible after its first paint is ready,
    eliminating the white-flash window entirely.
  - `paintWhenInitiallyHidden: true` (line 28) is set as the documented
    belt-and-suspenders insurance against an Electron quirk where
    `show: false` + slow first paint occasionally fails to fire `ready-to-show`.
  - `src/host/host.html` is loaded via `mainWindow.loadFile` (line 56) and ships
    a strict CSP meta, a `#splash` layer at z-index 100, the Bee Strong dark logo
    asset, a pulsing yellow loading bar (`bsk-pulse` keyframes in `host.css`),
    and the "BITTE WARTEN…" German status text. Plan 01-02 acceptance already
    verified all of these via literal-string checks (commit `be0a090`).
  - `ipcMain.on('cash-register-ready', ...)` (lines 61–66) is the sole splash
    dismiss path — D-03 / D-06 correct failure mode. In Phase 1 on a fresh
    device, this handler never fires because Phase 2 has not yet attached the
    Magicline view, so the splash stays visible indefinitely. This IS the
    Phase 1 end state.
- **Live evidence (PENDING-HUMAN):** Observing the window's first paint for a
  flash of white, confirming the splash layout, logo, bar animation, and status
  text match `.planning/phases/01-locked-down-shell-os-hardening/01-UI-SPEC.md`
  must be done by a human at the 01-06 Task 2 checkpoint.

## Open issues

- **`Ctrl+Shift+W` leak** (informational, NOT a SHELL-04 regression): not in the
  SHELL-04 requirement list and not a common kiosk escape vector, but trivially
  closable by adding `'Ctrl+Shift+W'` to `SUPPRESS_LIST` in
  `src/main/keyboardLockdown.js`. Deferred as a defensive hardening nice-to-have
  for Phase 5 (no requirement ID).
- **`main.log` not yet created on developer machine**: the `%AppData%\Bee Strong POS\logs\`
  directory will be created on the first `npm start`. The human checkpoint in
  01-06 Task 1 will exercise that path and confirm an `app ready` line is
  written.
- **Default Electron icon still in use** (informational): tracked as the Phase 5
  BRAND-01 baseline — see the SHELL-03 warnings block above.
- **Dev-machine OS-layer chords (Alt+Tab, bare Meta)**: not blocked on the dev
  machine by design — the plan 05 runbook handles this on the target kiosk
  device. Documented here so a future reviewer does not mistake the dev-machine
  leak for a Phase 1 failure.

## Items the human verifier must confirm (01-06 checkpoints)

The GSD executor cannot confirm these from a headless tool session. The
acceptance review MUST cover them before Phase 1 is declared complete:

1. `npm start` opens a 420x800 windowed frame, background `#1A1A1A`, Bee Strong
   dark logo centred, pulsing yellow bar below the logo, "BITTE WARTEN…" status
   text, DevTools auto-opens detached. No white flash on first paint.
2. The splash stays visible indefinitely (does NOT auto-lift) for at least 10 s.
3. `%AppData%\Bee Strong POS\logs\main.log` is created and contains an
   `app ready (isDev=true)` line after that `npm start`.
4. Starting a second concurrent `npm start` while the first is running: second
   process exits within ~1 s with no second window; `main.log` contains the
   literal line `second instance detected — exiting silently (D-05)`.
5. `npx electron .` (NODE_ENV unset) launches fullscreen kiosk, no frame, no
   menu bar, splash visible; Alt+F4 / F11 / Escape / Ctrl+W do not close or
   unfullscreen the window. (Alt+Tab / bare Win key may leak on the dev machine
   — not a Phase 1 failure.) Exit via Task Manager is expected and documented.

## Sign-off

- **Automated checks:** PASS (syntax, static code inspection, `canonical()` probe
  for SHELL-04 required combos, runbook file presence, `--dir` build artifact
  presence, electron-builder warning capture, NSIS include + macros present).
- **Human visual checkpoint (01-06 Task 2):** PENDING — awaiting project owner.
- **Target-device runbook execution:** DEFERRED to the physical maintenance visit
  per `docs/runbook/BREAKOUT-CHECKLIST.md`.

**Phase 1 is structurally shippable** — the Electron shell is installable, the
host splash is wired to SHELL-01/02/03/04/06, the runbook exists and is ready to
run against the target device, the NSIS `--dir` build succeeds, and no blocker
was found during automated verification. Final PASS/FAIL on the interactive
items is the responsibility of the 01-06 human checkpoints and, for SHELL-05,
of the on-device maintenance visit.
