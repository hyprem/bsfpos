# Phase 1: Locked-Down Shell & OS Hardening - Research

**Researched:** 2026-04-08
**Domain:** Electron 41 Windows kiosk shell + Win11 OS hardening
**Confidence:** HIGH on Electron APIs, MEDIUM-HIGH on Win11 kiosk lockdown mechanism pick (pending SKU verification on device)

## Summary

Phase 1 builds a single Electron 41 `BrowserWindow` in kiosk mode that loads a local `host.html` branded overlay, with broad-sweep keyboard suppression via `before-input-event`, single-instance lock, belt-and-suspenders auto-start (NSIS Startup shortcut + `app.setLoginItemSettings`), and an OS-layer hardening runbook consisting of executable `.reg`/`.ps1` scripts.

The single most important finding: **Electron userspace alone CANNOT suppress Win+D, Win+R, Alt+Tab, Ctrl+Alt+Del, Win+L, or Ctrl+Shift+Esc** (confirmed by Electron issue #40159 [CITED: github.com/electron/electron/issues/40159]). These must be suppressed at the OS layer via registry/GPO and a locked Windows account — which is exactly why D-12 mandates a scriptable runbook.

The second critical finding: **Windows 11 Pro's built-in Assigned Access only supports UWP apps for single-app kiosk mode, not Win32 desktop apps** [CITED: learn.microsoft.com/windows/configuration/assigned-access/]. Shell Launcher v2 (the supported path for Win32 apps like our Electron build) requires **Windows 11 Enterprise, Education, or IoT Enterprise** — NOT Pro [CITED: learn.microsoft.com/windows/configuration/shell-launcher/]. This is a hard blocker requiring SKU verification on the gym device before Phase 1 implementation.

**Primary recommendation:** Implement the Electron shell per D-01..D-11 decisions. For OS hardening (SHELL-05 / D-13), resolve the Win11 SKU as the very first planning task, then pick one of three paths:
1. **Win11 Enterprise/Education/IoT** → Shell Launcher v2 (recommended path, replaces explorer.exe cleanly)
2. **Win11 Pro** → Custom shell via `HKLM\...\Winlogon\Shell` registry (per-user via `SpecialAccounts\UserList` + per-user HKCU Winlogon), plus GPO/registry hardening — technically works, less supported
3. **Win11 Pro with Edition upgrade acceptable** → Upgrade to Education (cheapest path) and use Shell Launcher v2

## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Single `BrowserWindow` (kiosk mode) loads branded `host.html` as permanent overlay layer for ALL app surfaces (splash now, idle overlay / PIN modal / error / updating cover later). Phase 1 ships splash only; later phases add sibling `<div>`s toggled via IPC.
- **D-02:** Phase 2 will attach a child `BrowserView` / `WebContentsView` (class name resolved at Phase 2). Phase 1 must NOT preclude this — host window is a full-size content host with splash as an opaque top layer.
- **D-03:** Splash is lifted only on IPC event `cash-register-ready` from the injection layer. Phase 1 ships `ipcMain.on('cash-register-ready', ...)` stub. No timer fallback, no `did-finish-load` shortcut. Phase 1 success = splash stays visible forever on a fresh device (correct end state).
- **D-04:** Belt-and-suspenders auto-start: NSIS Startup folder shortcut AT install time AND `app.setLoginItemSettings({openAtLogin: true, name: 'Bee Strong POS'})` every boot as self-heal. Both safely coexist because of D-05 single-instance lock.
- **D-05:** `app.requestSingleInstanceLock()` at top of `main.js`. If it returns false → `app.quit()` immediately. No `second-instance` handler. Matches SHELL-02 "silently discarded".
- **D-06:** Phase 1 ends at splash visible. NO credential UI (Phase 3). NO "waiting for setup" placeholder.
- **D-07:** Dev mode gated by `process.env.NODE_ENV === 'development'` set via `npm start`. Dev: `kiosk: false`, `frame: true`, 420x800 window, `before-input-event` no-op, `globalShortcut` skipped.
- **D-08:** Dev mode auto-opens DevTools detached. Prod suppresses Ctrl+Shift+I, F12, Ctrl+Shift+J; no DevTools path.
- **D-09:** Broad-sweep suppression list — SHELL-04 required: Alt+F4, Alt+Tab, Meta (Win), F11, Esc, Ctrl+W. Defensive extras: Ctrl+R, Ctrl+Shift+R, F5, Ctrl+Shift+I, F12, Ctrl+Shift+J, Ctrl+P, Ctrl+U, Ctrl+O, Ctrl+N, Ctrl+T.
- **D-10:** Phase 1 exports a `reservedShortcuts: Set<string>` (canonical accelerator strings). `before-input-event` handler checks this Set BEFORE suppressing. Empty in Phase 1; Phase 5 adds `Ctrl+Shift+F12`.
- **D-11:** Defense in depth — `globalShortcut.register` no-op handlers for Alt+F4, F11, Esc in `app.whenReady()`, unregistered on `will-quit`.
- **D-12:** SHELL-05 deliverable = executable scripts under `docs/runbook/` (.reg + PowerShell), not a manual checklist. Fresh Win11 → kiosk-ready by running scripts in order. GUI-only steps in a short companion checklist.
- **D-13:** Shell Launcher v2 vs Assigned Access vs GPO — depends on Win11 SKU, resolved in research.

### Claude's Discretion

- Splash layout, animation timing, logo placement (use `3 BSF_vertical_for dark BG.png` if dark splash, else `1 BSF_vertical.png`).
- File/module layout inside Electron project (`main.js`, `preload.js`, `host.html`, etc.) — `main.js` MUST be CommonJS per electron-store 10.x CJS pin.
- Suppression list structure (array of accelerator strings vs predicate function) — either is fine as long as `reservedShortcuts` is consulted first.
- Dev mode window dimensions (420x800 starting suggestion).
- `package.json` scripts: `npm start` sets `NODE_ENV=development` and runs `electron .`; `npm run build` runs `electron-builder --win`.

### Deferred Ideas (OUT OF SCOPE for Phase 1)

- Admin exit hotkey wiring — Phase 5.
- Idle overlay, PIN modal, updating cover, error screen — Phases 4/5.
- First-run credential capture UI — Phase 3.
- Code signing — out of scope for v1 entirely.
- Welcome / attract loop — v2 (OPS-04).

## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SHELL-01 | Fullscreen Electron kiosk, no chrome/menu/tray | §Electron Kiosk Mode, §BrowserWindow Config |
| SHELL-02 | Single-instance lock | §Single Instance Lock Pattern |
| SHELL-03 | Auto-start on Windows boot | §Auto-Start Mechanisms |
| SHELL-04 | Suppress Alt+F4/Alt+Tab/Win/F11/Esc/Ctrl+W | §before-input-event Mechanics, §What CANNOT Be Suppressed |
| SHELL-05 | Hardened Windows account + runbook | §Windows 11 Kiosk Lockdown, §OS Hardening Runbook |
| SHELL-06 | Branded splash until cash register hidden | §Flash-of-Unhidden-UI Prevention, §host.html Overlay Architecture |

## Standard Stack

### Core (already pinned in CLAUDE.md — verify versions at install time)

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| electron | `^41.1.1` (devDep) | Chromium + Node runtime | Per CLAUDE.md + PROJECT.md prescriptive stack. `kiosk: true`, `before-input-event`, `globalShortcut`, `app.requestSingleInstanceLock`, `app.setLoginItemSettings` all stable since Electron 15+ [CITED: electronjs.org/docs/latest/api/browser-window]. |
| electron-builder | `^26.8.1` (devDep) | NSIS packager, auto-generates Startup folder shortcut | Standard Windows packager [CITED: electron.build/nsis.html]. |
| electron-log | `^5.2.x` | Rotating file logging | Phase 5 dependency — install now for early boot event logging in Phase 1. |
| electron-store | `^10.1.x` (CJS) | Flag file for "first run complete" | CJS pin per CLAUDE.md (11.x is ESM-only). Phase 1 may defer until Phase 3; not strictly needed for splash-only Phase 1. |

**Phase 1 minimum deps:** `electron` (devDep), `electron-builder` (devDep), `electron-log`. Defer `electron-store`, `electron-updater`, `safeStorage` wiring to later phases.

**Installation:**
```bash
npm init -y
npm install --save-dev electron@~41.1 electron-builder@~26.8
npm install electron-log@~5.2
```

**Version verification at plan start:**
```bash
npm view electron version
npm view electron-builder version
npm view electron-log version
```
Confirm current-stable versions match CLAUDE.md pins before writing `package.json`. [ASSUMED] — versions in CLAUDE.md were set during project research; re-verify in Wave 0 of the plan.

## Electron Kiosk Mode Specifics (Win11)

### What `kiosk: true` actually does [CITED: electronjs.org/docs/latest/api/browser-window]

- Enters OS-native kiosk mode (on Windows: fullscreen, no window chrome, no title bar).
- `BrowserWindow.setKiosk(flag)` toggles it at runtime (Phase 5 admin exit needs this).
- `BrowserWindow.isKiosk()` queries state.

### What `kiosk: true` does NOT do

- Does NOT hide Windows taskbar reliably on all configurations — `fullscreen: true` is additionally needed, and even then edge swipes / Win+D can reveal it.
- Does NOT suppress any keyboard shortcuts — that is `before-input-event`'s job.
- Does NOT prevent focus loss to OS-level popups (Action Center, notifications, Cortana).
- Does NOT prevent Alt+Tab or the Win key — those require either OS-layer registry/GPO suppression OR the Windows account to be locked via Shell Launcher / Assigned Access.
- Does NOT replace `explorer.exe` — taskbar and Start menu still exist, just hidden behind fullscreen window.

### Recommended `BrowserWindow` construction for Phase 1 (production)

```javascript
// [CITED: electronjs.org/docs/latest/api/browser-window]
const mainWindow = new BrowserWindow({
  show: false,                    // don't show until ready-to-show → prevents white flash
  kiosk: !isDev,                  // D-07 dev gating
  fullscreen: !isDev,
  frame: isDev,                   // D-07
  autoHideMenuBar: true,
  backgroundColor: '#000000',     // matches splash bg → zero flash [CRITICAL for SHELL-06, Phase 2 handoff]
  paintWhenInitiallyHidden: true, // render while hidden so ready-to-show is instant
  width: isDev ? 420 : undefined, // D-07 dev dimensions
  height: isDev ? 800 : undefined,
  webPreferences: {
    preload: path.join(__dirname, 'preload.js'),
    contextIsolation: true,
    nodeIntegration: false,
    sandbox: true,
    devTools: isDev,              // D-08: prod disables DevTools entirely
  },
});

// Remove app menu entirely (belt + braces vs autoHideMenuBar)
Menu.setApplicationMenu(null);

mainWindow.once('ready-to-show', () => mainWindow.show());
mainWindow.loadFile('host.html');
```

**Why `show: false` + `ready-to-show`:** Prevents the flash-of-white-window between window creation and first paint of `host.html`. Established Electron pattern [CITED: electronjs.org/docs/latest/tutorial/window-customization].

**Why `backgroundColor: '#000000'` (or brand dark):** When Phase 2 attaches a child `BrowserView` / `WebContentsView` underneath, any gap between window paint and BrowserView paint shows this color — NOT white. Set it to the splash background color (or pure black/brand color) so the Phase 2 handoff is seamless. This is the Phase 1 contribution to SHELL-06.

## `before-input-event` Mechanics [CITED: electronjs.org/docs/latest/api/web-contents]

### Event shape

```javascript
// [CITED: electronjs.org/docs/latest/api/web-contents#event-before-input-event]
mainWindow.webContents.on('before-input-event', (event, input) => {
  // input: {
  //   type: 'keyDown' | 'keyUp' | 'char' | 'rawKeyDown',
  //   key: string,          // KeyboardEvent.key (e.g. 'F4', 'Tab', 'Meta', 'Escape')
  //   code: string,         // KeyboardEvent.code
  //   isAutoRepeat: boolean,
  //   isComposing: boolean,
  //   shift: boolean,
  //   control: boolean,
  //   alt: boolean,
  //   meta: boolean,        // Windows key
  //   location: number,
  //   modifiers: string[],
  // }
  if (shouldSuppress(input)) event.preventDefault();
});
```

### `event.preventDefault()` behavior [CITED: electronjs.org/docs/latest/api/web-contents]

- Prevents the page's `keydown`/`keyup` events AND any menu accelerator that would otherwise fire.
- Works for: Alt+F4 (tested in many kiosk projects), F11 (fullscreen toggle), F12 / Ctrl+Shift+I (DevTools), Ctrl+R (reload), Ctrl+W (close), Escape (exit fullscreen).
- Fires for BOTH `keyDown` and `keyUp` — filter on `input.type === 'keyDown'` to suppress once.

### What CANNOT be suppressed from Electron userspace [CITED: github.com/electron/electron/issues/40159]

This is the critical gap. These shortcuts are intercepted by the Windows kernel / winlogon BEFORE they reach any user-mode process:

| Key combo | Why | Mitigation |
|-----------|-----|-----------|
| **Ctrl+Alt+Del** | Secure Attention Sequence, kernel-level, by Windows security design | GPO: `DisableCAD` + Assigned Access / Shell Launcher restricts menu entries |
| **Win+L** | Lock workstation, winlogon-level | GPO: `DisableLockWorkstation = 1` |
| **Ctrl+Shift+Esc** | Direct Task Manager launch, winlogon | GPO: `DisableTaskMgr = 1` |
| **Win+D** | Show desktop, shell-level | Requires shell replacement (Shell Launcher) OR `NoWinKeys` registry |
| **Win+R** | Run dialog, shell-level | `NoRun = 1` registry policy |
| **Win+Tab** | Task view, shell-level | `NoWinKeys` registry / Shell Launcher |
| **Alt+Tab** | Window switcher, shell-level — Electron issue #40159 confirms userspace cannot block | `NoWinKeys = 1` OR Shell Launcher |
| **Edge swipes** (Action Center, Task View) | Touch/shell-level | `AllowEdgeSwipe = 0` registry |
| **Win key overlay / Start menu** | Explorer shell | Shell Launcher replaces explorer.exe entirely |

**Electron suppression IS sufficient for:** Alt+F4, F11, F12, Esc, Ctrl+W, Ctrl+R, Ctrl+Shift+R, Ctrl+Shift+I, Ctrl+Shift+J, Ctrl+P, Ctrl+U, Ctrl+O, Ctrl+N, Ctrl+T, plain `Meta` key (when not combined with Win-combo chords).

**Implication:** SHELL-04 is a two-layer requirement. Electron layer (Phase 1 code) handles the 6 required combos that are in-process events. OS layer (Phase 1 runbook) handles the rest. D-13's mechanism pick determines which OS-layer tool does the heavy lifting.

### Suppression handler pattern (honors D-09 + D-10)

```javascript
// src/keyboardLockdown.js
const reservedShortcuts = new Set(); // D-10: Phase 5 will add 'Ctrl+Shift+F12'

// Canonical accelerator string builder
function canonical(input) {
  const parts = [];
  if (input.control) parts.push('Ctrl');
  if (input.alt) parts.push('Alt');
  if (input.shift) parts.push('Shift');
  if (input.meta) parts.push('Meta');
  parts.push(input.key);
  return parts.join('+');
}

// D-09: broad-sweep blocklist
const SUPPRESS_LIST = new Set([
  // SHELL-04 required
  'Alt+F4', 'Alt+Tab', 'Meta', 'F11', 'Escape', 'Ctrl+w', 'Ctrl+W',
  // Defensive extras (D-09)
  'Ctrl+r', 'Ctrl+R', 'Ctrl+Shift+R', 'F5',
  'Ctrl+Shift+I', 'F12', 'Ctrl+Shift+J',
  'Ctrl+p', 'Ctrl+P', 'Ctrl+u', 'Ctrl+U',
  'Ctrl+o', 'Ctrl+O', 'Ctrl+n', 'Ctrl+N', 'Ctrl+t', 'Ctrl+T',
]);

function attachLockdown(webContents, isDev) {
  if (isDev) return; // D-07
  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    const accel = canonical(input);
    // D-10: reserved shortcuts pass through (empty in Phase 1)
    if (reservedShortcuts.has(accel)) return;
    // Block meta (bare Win key) too
    if (input.key === 'Meta' || SUPPRESS_LIST.has(accel)) {
      event.preventDefault();
    }
  });
}

module.exports = { attachLockdown, reservedShortcuts };
```

**Case sensitivity note:** `input.key` for letter keys returns the lowercase letter unless Shift is held, so `'Ctrl+w'` and `'Ctrl+W'` should both be in the set defensively.

**Known quirk [CITED: github.com/electron/electron/issues/37336]:** Calling `event.preventDefault()` in `before-input-event` blocks the subsequent `keyUp` from firing. Not a problem for Phase 1 (we only care about suppression) but Phase 4 NFC badge capture will need to handle this — out of scope here.

## `globalShortcut` Registration Race (D-11)

### Timing [CITED: electronjs.org/docs/latest/api/global-shortcut]

- `globalShortcut.register(accel, callback)` only works after `app.whenReady()`.
- Registrations are process-global (OS-level hotkeys).
- Must be unregistered in `will-quit` (`globalShortcut.unregisterAll()`) to avoid leaks across relaunches.

### The race D-11 addresses

Between `app.whenReady()` firing and `mainWindow.show()` completing its kiosk transition, there is a window (~50-500ms on slow hardware) where the app is alive but NOT focused and NOT in kiosk mode. During this split-second, if the user is mashing Alt+F4 from a pre-existing Windows session (or if autorun conflicts with a user login), those key events go to the last-focused app — potentially letting a shortcut through before `before-input-event` is wired.

### Defense-in-depth pattern (D-11)

```javascript
// In app.whenReady() handler, BEFORE createWindow()
if (!isDev) {
  // D-11: no-op handlers catch OS-level chords during the startup race
  globalShortcut.register('Alt+F4', () => {});
  globalShortcut.register('F11', () => {});
  globalShortcut.register('Escape', () => {});
}

// In 'will-quit':
app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});
```

**Note:** `globalShortcut` and `before-input-event` do NOT conflict. `globalShortcut` intercepts at the OS level regardless of focus; `before-input-event` intercepts at the webContents level. Using both is the documented belt-and-braces pattern for kiosk apps.

**Important:** `globalShortcut.register` returns `false` if the accelerator is already taken by another app. Phase 1 should log this but not crash — it's informational.

## Single Instance Lock Pattern (D-05)

### API semantics [CITED: electronjs.org/docs/latest/api/app#apprequestsingleinstancelock]

- `app.requestSingleInstanceLock()` returns `true` if this is the first instance, `false` otherwise.
- MUST be called as early as possible in `main.js` — before `app.whenReady()`, before any `BrowserWindow`, before any heavy imports.
- If `false`, the correct action is `app.quit()` (or `app.exit(0)` for faster termination without teardown).

### Canonical placement (top of main.js)

```javascript
// main.js — top of file, before app.whenReady()
const { app, BrowserWindow, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');

// D-05: single-instance lock — if we're the second instance, quit immediately
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0); // belt + braces to ensure no code after this runs
}

// No 'second-instance' handler (D-05) — kiosk mode guarantees first window is topmost.

app.whenReady().then(() => {
  // ... rest of startup
});
```

**Why `process.exit(0)` after `app.quit()`:** `app.quit()` is async (waits for all windows to close, fires `before-quit`, etc.). On a double-launch race, we want the second process gone immediately so its log lines don't interleave. `process.exit(0)` is safe here because we're pre-whenReady.

## Auto-Start Mechanisms (D-04, SHELL-03)

### Layer 1: `app.setLoginItemSettings` (runtime self-heal) [CITED: electronjs.org/docs/latest/api/app#appsetloginitemsettingssettings]

```javascript
// Called on every boot in app.whenReady() — self-heals if NSIS shortcut was deleted
if (!isDev) {
  app.setLoginItemSettings({
    openAtLogin: true,
    openAsHidden: false,
    name: 'Bee Strong POS',
    path: process.execPath,
    args: [],
  });
}
```

**What this does on Windows [CITED: Electron docs]:** Creates a registry entry under `HKCU\Software\Microsoft\Windows\CurrentVersion\Run\Bee Strong POS` pointing at the current exe. Per-user (HKCU), which is correct — the kiosk account is the only account that should auto-launch.

**Caveats:**
- Uses current exe path, which under NSIS install points to `%LocalAppData%\Programs\Bee Strong POS\Bee Strong POS.exe` (per-user install — correct for our kiosk account model).
- Does NOT fire before user login. It fires on shell startup for the logged-in user. Auto-login of the Windows user itself is SEPARATE and handled by the runbook (`AutoAdminLogon` registry).
- Idempotent — safe to call every boot.

### Layer 2: NSIS Startup folder shortcut (install-time) [CITED: electron.build/nsis.html]

electron-builder does NOT have a first-class "create Startup folder shortcut" option. The standard pattern is a custom NSIS include script that adds the shortcut during install and removes it during uninstall:

```yaml
# electron-builder.yml (or "build" key in package.json)
appId: com.beestrongfitness.pos
productName: Bee Strong POS
directories:
  output: dist
win:
  target:
    - target: nsis
      arch: x64
  artifactName: "${productName}-Setup-${version}.${ext}"
nsis:
  oneClick: true                   # single-click installer, no wizard
  perMachine: false                # per-user install → %LocalAppData% → writable without admin
  allowToChangeInstallationDirectory: false
  createDesktopShortcut: false     # no desktop icon on a kiosk
  createStartMenuShortcut: false   # no start menu entry either
  runAfterFinish: false            # D-04 safety: let the next boot / app.setLoginItemSettings handle it
  include: build/installer.nsh     # custom NSIS to add Startup folder shortcut
```

```nsis
# build/installer.nsh
!macro customInstall
  CreateShortCut "$SMSTARTUP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
!macroend

!macro customUnInstall
  Delete "$SMSTARTUP\${PRODUCT_NAME}.lnk"
!macroend
```

**`$SMSTARTUP`** in NSIS resolves to the **per-user** Startup folder (`%AppData%\Microsoft\Windows\Start Menu\Programs\Startup`) when `RequestExecutionLevel user` is in effect — which it is for `perMachine: false` electron-builder installs [CITED: electron-userland/electron-builder#1145]. This is the correct scope for our kiosk model.

**Why both layers:** D-04 belt-and-suspenders. If the Startup shortcut is manually deleted (a staff member "cleaning up"), `app.setLoginItemSettings` on the next boot re-adds the `HKCU\...\Run` entry. If the registry entry is wiped, the next app install re-adds the Startup shortcut. Single-instance lock (D-05) prevents duplication if both fire.

### Verification commands (for the runbook)

```powershell
# Verify HKCU Run entry
Get-ItemProperty "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" | Select-Object "Bee Strong POS"

# Verify Startup folder shortcut
Test-Path "$env:APPDATA\Microsoft\Windows\Start Menu\Programs\Startup\Bee Strong POS.lnk"
```

## Windows 11 Kiosk Lockdown Mechanism (D-13 Resolution)

### The SKU matrix [CITED: learn.microsoft.com/windows/configuration/kiosk/]

| Win11 SKU | Assigned Access (UWP only) | Shell Launcher v2 (Win32 OK) |
|-----------|---------------------------|------------------------------|
| Home | ❌ No | ❌ No |
| **Pro** | ✅ UWP only — **cannot lock Win32 Electron app** | ❌ Not supported |
| Enterprise | ✅ | ✅ |
| Education | ✅ | ✅ |
| IoT Enterprise | ✅ | ✅ |

**The blocker:** Our Electron build is a Win32 classic desktop app, NOT a UWP/MSIX app. [CITED: learn.microsoft.com/windows/configuration/assigned-access/configure-single-app-kiosk] — Assigned Access single-app kiosk mode requires the app to be a UWP app or Microsoft Edge. Electron apps can be MSIX-packaged (electron-builder supports this), but it adds certificate + signing complexity we explicitly excluded.

**Shell Launcher v2** [CITED: learn.microsoft.com/windows/configuration/shell-launcher/] replaces `explorer.exe` with any Win32 executable on a per-user basis, and supports running our Electron app as the shell — but requires **Win11 Enterprise / Education / IoT Enterprise**. Not Pro.

### Recommended decision tree (for Wave 0 of the plan)

**Task 0.1: Verify the gym device's Win11 SKU.** Run on the device: `winver` or `Get-ComputerInfo | Select-Object WindowsProductName, OsEdition`. Wait for operator response before writing the runbook.

**If SKU = Windows 11 Enterprise / Education / IoT Enterprise:**
- ✅ Use **Shell Launcher v2**. Configure via PowerShell (scriptable) to replace `explorer.exe` with the Bee Strong POS executable for the dedicated kiosk local user account.
- Add GPO/registry hardening as defense-in-depth for edge swipes, Ctrl+Alt+Del menu, etc.
- This is the cleanest path — no taskbar, no Start menu, no Explorer shell at all.

**If SKU = Windows 11 Pro (most likely):**
- ❌ Shell Launcher unavailable. Assigned Access only supports UWP (not our app).
- Fallback: **Custom shell via registry** — set `HKEY_LOCAL_MACHINE\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon\Shell` to the Electron exe **per-user via the `SpecialAccounts` + HKCU Winlogon** pattern [CITED: learn.microsoft.com/answers/questions/1158081/]. The normal admin account still gets `explorer.exe`; the dedicated kiosk local account gets `"C:\Program Files\Bee Strong POS\Bee Strong POS.exe"` as its shell.
- PLUS aggressive GPO / registry hardening (see runbook contents below).
- PLUS `AutoAdminLogon` registry so the kiosk account logs in at boot without a password prompt.
- **Warning [CITED: tenforums.com/customization/162697/]:** Modern Win11 cumulative updates sometimes reset custom shell registry values. The runbook must include a verification check and the operator must re-run the hardening script after major Windows updates. Flag this in STATE.md Open TODOs.

**If SKU = Windows 11 Home:**
- ❌ No Assigned Access, no Shell Launcher, no GPO editor. Must upgrade to Pro (minimum) or Education (recommended). Block phase planning until SKU upgrade decision is made.

**Recommendation for ambiguous SKU:** Plan for Win11 Pro path (most common for small business). If the device turns out to be Enterprise/Education, Shell Launcher v2 is an additive upgrade — the Electron app itself is unchanged, only the runbook scripts differ.

### OS Hardening Runbook Contents (D-12)

**Target location:** `docs/runbook/`

**Required files:**

```
docs/runbook/
├── README.md                          # Run order, verification, troubleshooting
├── 01-create-kiosk-user.ps1          # Create local "kiosk" user, auto-logon setup
├── 02-registry-hardening.reg         # Disable edge swipes, lock shortcuts, taskbar, etc.
├── 03-gpo-hardening.ps1              # Local policy tweaks via LGPO or PowerShell
├── 04a-shell-launcher-setup.ps1      # (Enterprise/Education path)
├── 04b-custom-shell-registry.reg     # (Pro path — HKLM Winlogon Shell per-user)
├── 05-verify-lockdown.ps1            # Checklist runner: probes taskbar, Action Center, etc.
└── BREAKOUT-CHECKLIST.md             # kiosk-mode-breakout vectors to test post-install
```

**Key registry entries for `02-registry-hardening.reg`** [CITED: multiple MS Learn GPO refs]:

```registry
Windows Registry Editor Version 5.00

; Disable edge swipes (Action Center, Task View from left edge)
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\Windows\EdgeUI]
"AllowEdgeSwipe"=dword:00000000
"DisableCharmsHint"=dword:00000001
"DisableTLcorner"=dword:00000001
"DisableTRcorner"=dword:00000001

; Disable Win key combos (Win+R, Win+D, Win+Tab, Alt+Tab)
[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Policies\Explorer]
"NoWinKeys"=dword:00000001
"NoRun"=dword:00000001
"NoClose"=dword:00000001
"NoDesktop"=dword:00000001
"NoTrayContextMenu"=dword:00000001
"NoViewContextMenu"=dword:00000001

; Disable Ctrl+Alt+Del menu items
[HKEY_CURRENT_USER\Software\Microsoft\Windows\CurrentVersion\Policies\System]
"DisableTaskMgr"=dword:00000001
"DisableLockWorkstation"=dword:00000001
"DisableChangePassword"=dword:00000001
"NoLogoff"=dword:00000001

; Hide taskbar / disable Cortana / disable notifications
[HKEY_CURRENT_USER\Software\Policies\Microsoft\Windows\Explorer]
"NoNotificationCenter"=dword:00000001
"DisableNotificationCenter"=dword:00000001
"HideSCAHealth"=dword:00000001
"HideSCAVolume"=dword:00000001
"HideSCANetwork"=dword:00000001

; Disable Windows Ink workspace
[HKEY_LOCAL_MACHINE\SOFTWARE\Policies\Microsoft\WindowsInkWorkspace]
"AllowWindowsInkWorkspace"=dword:00000000
```

**`01-create-kiosk-user.ps1` essentials:**

```powershell
# Create dedicated local user (no password — required for AutoAdminLogon without plain-text password risk)
# NOTE: For AutoAdminLogon with a password, the password lives in HKLM Winlogon as plain text.
# Acceptable here ONLY because the kiosk account has no privileges and no access to sensitive resources.
$username = "bsfkiosk"
$password = ConvertTo-SecureString "change-me-on-device" -AsPlainText -Force
New-LocalUser -Name $username -Password $password -FullName "Bee Strong Kiosk" -Description "Kiosk autologin account"
Add-LocalGroupMember -Group "Users" -Member $username  # standard user, NOT admin

# Configure AutoAdminLogon
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "AutoAdminLogon" -Value "1"
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "DefaultUserName" -Value $username
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "DefaultPassword" -Value "change-me-on-device"
Set-ItemProperty "HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Winlogon" -Name "DefaultDomainName" -Value $env:COMPUTERNAME
```

**`BREAKOUT-CHECKLIST.md`** must reference `github.com/ikarus23/kiosk-mode-breakout` and enumerate every vector the operator must test against the live device post-install. This is SHELL-05's verification criterion per the runbook.

## host.html Overlay Architecture (D-01, D-02, D-03, SHELL-06)

### Design principle: layered sibling `<div>`s, main process toggles via IPC

The `host.html` renderer is the PERMANENT container for all branded surfaces. Phase 1 ships the splash layer only, but the file structure must accommodate siblings without re-engineering.

### Recommended `host.html` skeleton

```html
<!DOCTYPE html>
<html lang="de">
<head>
  <meta charset="UTF-8">
  <meta http-equiv="Content-Security-Policy" content="default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:;">
  <title>Bee Strong POS</title>
  <link rel="stylesheet" href="host.css">
</head>
<body>
  <!--
    Layer stack (z-index ascending):
      0: container for Phase 2 BrowserView (reserved empty region; view is attached by main)
      100: splash cover (Phase 1) — initially visible
      200: error screen (Phase 5) — hidden
      300: updating cover (Phase 5) — hidden
      400: idle overlay (Phase 4) — hidden
      500: credentials screen (Phase 3) — hidden
      600: admin PIN modal (Phase 5) — hidden
  -->

  <div id="magicline-mount" class="layer layer-base"></div>

  <div id="splash" class="layer layer-splash" data-visible="true">
    <img src="assets/logo.png" alt="Bee Strong Fitness" class="splash-logo">
    <div class="splash-message">Starte Kasse…</div>
  </div>

  <!-- Phase 4 will add: <div id="idle-overlay" class="layer layer-idle" data-visible="false">...</div> -->
  <!-- Phase 5 will add: <div id="admin-pin" class="layer layer-admin" data-visible="false">...</div> -->

  <script src="host.js"></script>
</body>
</html>
```

### `host.css` layering strategy

```css
html, body {
  margin: 0; padding: 0; width: 100%; height: 100%;
  background: #000;                    /* must match BrowserWindow backgroundColor */
  overflow: hidden;
  user-select: none;                   /* no text selection on touch */
  -webkit-user-select: none;
  cursor: none;                        /* hide cursor on touchscreen — optional */
  font-family: -apple-system, 'Segoe UI', system-ui, sans-serif;
}

.layer {
  position: fixed;
  inset: 0;
  width: 100vw;
  height: 100vh;
  display: flex;
  align-items: center;
  justify-content: center;
  flex-direction: column;
  transition: opacity 200ms ease-out;
}

.layer[data-visible="false"] {
  opacity: 0;
  pointer-events: none;
  visibility: hidden;
}

.layer[data-visible="true"] {
  opacity: 1;
  pointer-events: auto;
  visibility: visible;
}

.layer-base  { z-index: 0;   background: #000; }  /* Phase 2 BrowserView attach point */
.layer-splash { z-index: 100; background: #000; }
/* Future layers: idle 400, admin 600, etc. */
```

### `host.js` — IPC bridge to main

```javascript
// host.js (renderer) — consumes the contextBridge API exposed by preload.js
// Preload exposes: window.kiosk.onShowLayer(name, callback), window.kiosk.onHideLayer(...)

function setLayerVisible(id, visible) {
  const el = document.getElementById(id);
  if (el) el.setAttribute('data-visible', String(visible));
}

// Phase 1: listen for splash hide (will fire in Phase 2 via cash-register-ready IPC → main → host)
window.kiosk.onHideSplash(() => setLayerVisible('splash', false));
window.kiosk.onShowSplash(() => setLayerVisible('splash', true));
```

### `preload.js` — contextBridge

```javascript
// preload.js — runs in isolated world, exposes minimal API to host.html
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('kiosk', {
  // Phase 1 splash control (main → host)
  onHideSplash: (cb) => ipcRenderer.on('splash:hide', cb),
  onShowSplash: (cb) => ipcRenderer.on('splash:show', cb),
  // Phase 2+ will add: onShowOverlay, onHideOverlay, etc.
});
```

### Main-side splash stub (D-03)

```javascript
// main.js — in app.whenReady() after window creation
ipcMain.on('cash-register-ready', () => {
  // D-03: Phase 1 ships this stub. Phase 2 will trigger it from injection layer.
  log.info('cash-register-ready IPC received — lifting splash');
  mainWindow.webContents.send('splash:hide');
});
```

**Critical:** Phase 1 defines the IPC contract and the stub listener. It does NOT trigger the event. On a fresh device, the splash stays visible forever — that is the correct Phase 1 end state per D-06.

## Flash-of-Unhidden-UI Prevention (Phase 1 responsibilities for SHELL-06)

Per PITFALLS.md Pitfall 2, FOUUI is a critical risk Phase 2 will face. Phase 1 establishes the foundations:

1. **`backgroundColor: '#000000'` on BrowserWindow** — prevents white flash between window creation and first `host.html` paint.
2. **`show: false` + `ready-to-show` event** — window is not shown until `host.html` has fully rendered, so first visible frame is already branded.
3. **Splash layer opacity = 1 at load** — `data-visible="true"` default in the HTML so no JS is needed to make it opaque. Even if `host.js` fails to run, the splash is visible.
4. **Splash z-index above Phase 2 BrowserView mount point** — when Phase 2 attaches the BrowserView at `#magicline-mount` (z-index 0), the splash (z-index 100) is above it by CSS ordering. Even if Magicline paints before CSS injection, it's behind the splash cover.
5. **`paintWhenInitiallyHidden: true`** — forces the window to render while hidden, so `ready-to-show` fires reliably.

## Architecture Patterns

### Pattern 1: Main process is single source of truth (reused from ARCHITECTURE.md Pattern 3)

All lifecycle state (kiosk state, splash visibility, Phase 2+ timers) lives in main. Renderer is pure presentation, triggered only by IPC from main.

### Pattern 2: contextIsolation + sandbox always on

```javascript
webPreferences: {
  contextIsolation: true,
  nodeIntegration: false,
  sandbox: true,
  preload: path.join(__dirname, 'preload.js'),
}
```

Phase 1 establishes this as the non-negotiable baseline for every webContents in the project.

### Pattern 3: Initialization order in main.js

```
1. require electron APIs
2. requestSingleInstanceLock() — quit if false
3. Const declarations (paths, isDev flag)
4. app.whenReady() =>
   4a. Menu.setApplicationMenu(null)
   4b. setLoginItemSettings (D-04 layer 1)
   4c. globalShortcut.register no-ops (D-11)
   4d. createMainWindow() — includes ipcMain.on listener for 'cash-register-ready' (D-03)
   4e. attachKeyboardLockdown(mainWindow.webContents) (D-09/D-10)
5. app.on('will-quit') => globalShortcut.unregisterAll()
6. app.on('window-all-closed') => app.quit() (even on macOS — this is a kiosk)
```

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Registry editing from install | Custom scripts | electron-builder NSIS + `installer.nsh` | Battle-tested, uninstaller mirrors installer |
| Auto-start registry entry | Manual `reg add` at runtime | `app.setLoginItemSettings` | Cross-platform, Electron-managed, idempotent |
| Keyboard blocking | Global Windows hook (SetWindowsHookEx) | `before-input-event` + `globalShortcut` | Native hooks need a native module; two Electron APIs already cover the webContents-level need |
| Shell replacement | `SetUserObjectSecurity` or custom service | Shell Launcher v2 OR Winlogon `Shell` registry | OS-provided mechanisms are the only ones Windows Update won't reset |
| Splash screen | Separate splash BrowserWindow, close on main ready | Permanent overlay div in `host.html` | D-01 — one window, one DOM, no cross-window sync |
| Single-instance check | Lockfile in userData | `app.requestSingleInstanceLock()` | Handles crash cases correctly, atomic |

## Common Pitfalls (Phase 1 specific)

### Pitfall 1: `before-input-event` only fires on focused webContents

**What goes wrong:** In Phase 2 the Magicline BrowserView will have focus most of the time, not the host webContents. If `before-input-event` is attached ONLY to `mainWindow.webContents`, keystrokes that go to Magicline are NOT caught by the lockdown.

**How to avoid:** Phase 1 attaches lockdown to `mainWindow.webContents`. Phase 2 MUST additionally attach the same handler to the Magicline BrowserView's webContents. Export `attachLockdown(webContents)` as a reusable function so Phase 2 can call it with a one-liner. Document this in the Phase 1 → Phase 2 handoff notes.

**Warning sign:** Alt+F4 suppression works on `host.html` in Phase 1 but stops working after Phase 2 attaches the BrowserView.

### Pitfall 2: `setLoginItemSettings` needs the exe path after NSIS install, not `electron.exe` in dev

**What goes wrong:** Calling `setLoginItemSettings` during `npm start` registers `node.exe` or `electron.exe` from node_modules as the auto-start app. On reboot, Windows tries to launch it, fails silently or produces confusing errors.

**How to avoid:** D-07 gates the call behind `!isDev`. Dev mode never writes the Run registry entry. Production mode uses `process.execPath`, which at runtime points to the installed `Bee Strong POS.exe`.

### Pitfall 3: `oneClick: true` + `perMachine: true` requires admin, breaks per-user install

**What goes wrong:** electron-builder NSIS defaults might install system-wide, requiring admin elevation. On the kiosk Windows account (standard user), the installer UAC-prompts and fails.

**How to avoid:** Set `perMachine: false` explicitly. Per-user install lands in `%LocalAppData%\Programs\Bee Strong POS\`, no admin required, matches the kiosk account's privilege level [CITED: electron.build/nsis.html].

### Pitfall 4: Windows Update resetting custom shell registry (Pro path only)

**What goes wrong:** After a Win11 feature update, the `HKLM\Winlogon\Shell` value gets reset to `explorer.exe`, and on next boot the kiosk user sees the Windows desktop.

**How to avoid:** Runbook must include a PowerShell script scheduled via Task Scheduler (or triggered manually by staff post-update) that re-asserts the shell registry value. Document in `BREAKOUT-CHECKLIST.md` under "Post-Windows-Update verification steps".

**Warning sign:** After a Windows Update, the kiosk boots to Windows desktop instead of the Electron app.

### Pitfall 5: `kiosk: true` on a multi-monitor system may only cover the primary display

**What goes wrong:** If a technician plugs in a second monitor over RDP for debugging, `kiosk: true` only locks the primary display; the secondary shows the normal desktop.

**How to avoid:** Not relevant for Phase 1 (single kiosk monitor), but document in runbook: "Do not attach external monitors while kiosk is running." Phase 5 admin exit is the correct maintenance path.

### Pitfall 6: `app.requestSingleInstanceLock()` called after `app.whenReady()` is too late

**What goes wrong:** The lock check happens after window creation has started; a race window exists where two windows briefly exist before the second instance quits.

**How to avoid:** Call it BEFORE any `app.whenReady()` registration. See canonical placement in §Single Instance Lock Pattern. Mandatory as the first executable line after `require`.

## Runtime State Inventory

Phase 1 creates a fresh project from scratch — no pre-existing runtime state to migrate. Verified by STATE.md "Last session summary" (project just initialized) and `code_context.Reusable Assets = None`.

| Category | Items Found | Action Required |
|----------|-------------|------------------|
| Stored data | None — greenfield phase | — |
| Live service config | None | — |
| OS-registered state | **Phase 1 CREATES new state:** (1) `HKCU\...\Run\Bee Strong POS` registry entry via `setLoginItemSettings`, (2) `$SMSTARTUP\Bee Strong POS.lnk` via NSIS, (3) dedicated local kiosk Windows user, (4) runbook registry hardening entries, (5) Winlogon shell or Shell Launcher config. All tracked in runbook README for reproducibility. | Uninstaller must mirror (NSIS `customUnInstall` + documented runbook rollback script) |
| Secrets/env vars | None in Phase 1 (credentials are Phase 3) | — |
| Build artifacts | None yet — first `npm install` in Phase 1 creates `package-lock.json`, `node_modules/`, `dist/` | Add to `.gitignore` (node_modules, dist, *.log) |

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js >= 20 LTS | electron-builder build host | Must verify on dev machine | — | Install from nodejs.org |
| npm | Package management | Comes with Node | — | — |
| Windows build toolchain | Some electron-builder native optional modules | Not required for Phase 1 (no native modules) | — | — |
| Electron 41.x | Runtime | Installed via `npm install` | 41.1.1 | — |
| Windows 11 SKU | Runbook mechanism pick (D-13) | **UNKNOWN — blocks runbook finalization** | — | Plan for Pro path, upgrade to Shell Launcher path if SKU allows |
| Target kiosk device | Integration test / runbook dry-run | Available via RDP (per PROJECT.md) | — | Test on a Win11 Pro VM first |

**Missing dependencies with no fallback:**
- **Win11 SKU verification on the gym device** — blocks runbook finalization. Plan Wave 0 must include this as Task 0.1, blocking all runbook tasks until resolved.

**Missing dependencies with fallback:**
- If no live access to the kiosk device during development, a Win11 Pro VM is sufficient for Electron-layer verification. OS hardening runbook must still be validated on the real device before Phase 1 sign-off.

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | None yet — project is greenfield. Recommend **Playwright for Electron** (official, supports spawning Electron via `_electron.launch()`) for end-to-end window assertions. |
| Config file | none — see Wave 0 |
| Quick run command | `npm test` (to be defined in Wave 0) |
| Full suite command | `npm test` |

**Recommendation:** For Phase 1, most verification is manual-on-device (did the kiosk lock down? did Alt+F4 get blocked? did the runbook produce a locked user account?). Unit-testable logic is minimal: the `canonical()` accelerator builder and the `SUPPRESS_LIST`/`reservedShortcuts` decision logic. Light touch — don't over-invest in tests for a 3-file phase.

### Phase Requirements → Test Map

| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| SHELL-01 | Fullscreen kiosk, no chrome | manual-on-device + Playwright spawn assertion (`win.isKiosk() === true`) | `npm test -- shell-01` | ❌ Wave 0 |
| SHELL-02 | Second launch silently discarded | unit: single-instance lock returns false on second call | Not directly testable in-process — manual smoke test | manual |
| SHELL-03 | Auto-start on boot | manual verification post-install: reboot device, observe auto-launch | — | manual |
| SHELL-04 | 6 keyboard combos suppressed | unit: `canonical()` + `SUPPRESS_LIST` contains every combo; integration: Playwright sends keys, asserts window still open | `npm test -- keyboard-lockdown` | ❌ Wave 0 |
| SHELL-05 | Runbook produces locked account | manual-on-device: run scripts on a fresh Win11 install, verify against BREAKOUT-CHECKLIST.md | — | manual |
| SHELL-06 | Splash visible until cash-register-ready | Playwright: spawn Electron, assert `#splash[data-visible="true"]` on load, send IPC, assert hidden | `npm test -- splash` | ❌ Wave 0 |

### Sampling Rate

- **Per task commit:** `npm test` (Playwright spawn suite, < 30s)
- **Per wave merge:** `npm test` + manual smoke on Win11 VM (kiosk mode, keyboard combos)
- **Phase gate:** Full suite green + manual runbook dry-run on real kiosk device + BREAKOUT-CHECKLIST.md walk-through

### Wave 0 Gaps

- [ ] `package.json` scripts with `test` target
- [ ] `npm install --save-dev playwright @playwright/test` (light addition; acceptable for dev-only testing of Electron shell)
- [ ] `tests/electron-launch.spec.js` — spawn Electron via Playwright, assert kiosk state, splash visible, IPC listener present
- [ ] `tests/keyboard-lockdown.spec.js` — unit tests for `canonical()` and suppression decision logic
- [ ] `docs/runbook/BREAKOUT-CHECKLIST.md` — manual verification list referencing kiosk-mode-breakout repo

**Alternative if Playwright feels heavy:** Node's built-in `node:test` for unit testing `canonical()` + `SUPPRESS_LIST` logic, and manual-only for kiosk/splash verification. Defer Playwright to Phase 2+ when there's actual page content to test. **Recommended for Phase 1** — minimizes new deps.

## Security Domain

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | partial | Windows user auth (AutoAdminLogon) — documented tradeoff; kiosk user has no privileges |
| V3 Session Management | no | Phase 3 handles Magicline session; Phase 1 has no sessions |
| V4 Access Control | yes | Kiosk user = standard (not admin); Shell Launcher / custom shell prevents desktop access |
| V5 Input Validation | no | No user input processing in Phase 1 (splash is static) |
| V6 Cryptography | no | Phase 3 (safeStorage / DPAPI) |
| V7 Error Handling | partial | Logging via electron-log (Phase 1 establishes log dir structure) |
| V14 Configuration | yes | `contextIsolation`, `nodeIntegration: false`, `sandbox: true`, `devTools: false` in prod |

### Known Threat Patterns for Electron Kiosk + Win11

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Kiosk breakout via keyboard shortcut | Elevation of Privilege | `before-input-event` + `globalShortcut` + OS-layer GPO/registry hardening (layered) |
| Unauthorized DevTools access | Information Disclosure | `devTools: false` in `webPreferences` + suppress Ctrl+Shift+I/F12 in input event |
| Node.js API exposure to renderer XSS | Tampering / Elevation | `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true` — non-negotiable baseline |
| Plaintext Windows password in Winlogon | Information Disclosure | Documented tradeoff: standard-user kiosk account with no access to anything sensitive; acceptable per threat model (physical access = game over anyway) |
| USB rubber ducky attack via Deka port | Tampering | Physical USB port blocker on Deka reader (runbook notes); BIOS USB whitelist if available |
| Custom shell registry reset by Windows Update (Pro path) | Availability | Task Scheduler script re-asserts shell on boot; post-update verification in runbook |

## Code Examples

### Complete `main.js` skeleton

```javascript
// main.js — Phase 1 Locked-Down Shell
// Keep CommonJS per electron-store 10.x pin (CLAUDE.md stack note)
const { app, BrowserWindow, Menu, globalShortcut, ipcMain } = require('electron');
const path = require('path');
const log = require('electron-log');
const { attachLockdown } = require('./src/keyboardLockdown');

// D-05: single-instance lock — MUST be before anything else
const gotLock = app.requestSingleInstanceLock();
if (!gotLock) {
  app.quit();
  process.exit(0);
}

const isDev = process.env.NODE_ENV === 'development';
let mainWindow = null;

// Configure logging
log.transports.file.resolvePathFn = () =>
  path.join(app.getPath('userData'), 'logs', 'main.log');
log.info(`Bee Strong POS starting — isDev=${isDev}, version=${app.getVersion()}`);

function createMainWindow() {
  mainWindow = new BrowserWindow({
    show: false,
    kiosk: !isDev,
    fullscreen: !isDev,
    frame: isDev,
    autoHideMenuBar: true,
    backgroundColor: '#000000',
    paintWhenInitiallyHidden: true,
    width: isDev ? 420 : undefined,
    height: isDev ? 800 : undefined,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
      devTools: isDev,
    },
  });

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    if (isDev) mainWindow.webContents.openDevTools({ mode: 'detach' });
    log.info('Main window ready-to-show fired');
  });

  mainWindow.loadFile('host.html');
  attachLockdown(mainWindow.webContents, isDev);

  // D-03: IPC stub for Phase 2 splash lift
  ipcMain.on('cash-register-ready', () => {
    log.info('cash-register-ready received → hiding splash');
    mainWindow.webContents.send('splash:hide');
  });
}

app.whenReady().then(() => {
  Menu.setApplicationMenu(null);

  // D-04 layer 1: self-heal auto-start
  if (!isDev) {
    app.setLoginItemSettings({
      openAtLogin: true,
      name: 'Bee Strong POS',
      path: process.execPath,
    });
  }

  // D-11: defense-in-depth globalShortcut no-ops
  if (!isDev) {
    globalShortcut.register('Alt+F4', () => {});
    globalShortcut.register('F11', () => {});
    globalShortcut.register('Escape', () => {});
  }

  createMainWindow();
});

app.on('will-quit', () => {
  globalShortcut.unregisterAll();
});

app.on('window-all-closed', () => {
  app.quit();
});
```

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `BrowserView` for child content | `WebContentsView` + `BaseWindow` | Electron 30+ | Phase 2 decision — Electron 41 supports both; `BrowserView` is deprecated but still functional. Defer choice to Phase 2 per D-02. |
| `remote` module for main/renderer bridge | `contextBridge` + `ipcRenderer` via preload | Electron 14+ | Non-negotiable baseline; `remote` is removed entirely. |
| `keytar` for credentials | `safeStorage` (DPAPI) | keytar archived Dec 2022 | Phase 3 concern, already pinned in CLAUDE.md. |

**Deprecated / outdated:**
- `app.makeSingleInstance` — replaced by `app.requestSingleInstanceLock` since Electron 4. Use the current one.
- `webPreferences.nodeIntegration: true` + no context isolation — considered actively unsafe; our baseline is `contextIsolation: true, sandbox: true`.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `event.preventDefault()` in `before-input-event` reliably blocks Alt+F4 on Win11 Electron 41 | §before-input-event | If wrong: SHELL-04 fails for Alt+F4 specifically; Phase 1 exit criterion blocked. Mitigation: D-11 globalShortcut no-op is a fallback; OS-layer `DisableCAD`-style hardening is belt+braces. Verify in Wave 0 integration test. |
| A2 | The gym's Win11 SKU is "Pro" | §Windows 11 Kiosk Lockdown | If wrong (Enterprise/Education): better! Shell Launcher v2 is cleaner. If Home: BLOCKING, requires upgrade. **Task 0.1 of plan MUST verify before runbook work starts.** |
| A3 | `$SMSTARTUP` in NSIS resolves to per-user Startup folder for `perMachine: false` installs | §Auto-Start Mechanisms | If wrong: shortcut lands in wrong location, D-04 layer 2 fails silently (D-04 layer 1 still works). Verify by building installer and checking file location. |
| A4 | `app.setLoginItemSettings` writes `HKCU\...\Run` registry entry (not Startup folder) | §Auto-Start Mechanisms | If wrong: might conflict with NSIS shortcut. Verify post-install by inspecting both locations. Low risk — both D-04 layers are independently valid. |
| A5 | Win11 feature updates occasionally reset HKLM Winlogon `Shell` value | §Pitfall 4 | If wrong (no reset): runbook post-update step is unnecessary but harmless. If right: runbook must include it. Document as "verify after first Win Update; adjust runbook accordingly." |
| A6 | Electron 41.1.1 is a real current release (per CLAUDE.md) | §Core Stack | If wrong: pin to whatever `npm view electron version` reports in Wave 0. CLAUDE.md was generated during project research; trusted but verify. |
| A7 | `sandbox: true` + `contextIsolation: true` works with a simple preload on Electron 41 | §BrowserWindow config | If wrong: would need to drop sandbox. Very low risk — this is the documented default pattern since Electron 20+. |
| A8 | `AutoAdminLogon` with plaintext password in registry is an acceptable tradeoff for this kiosk threat model | §Runbook | User should confirm during planning discussion. Physical access to the device already means game over for any POS; standard-user kiosk account has no escalation path. If user rejects: alternative is manual login by staff at open time, which loses the unattended-boot property. |

## Open Questions (RESOLVED)

1. **Windows 11 SKU on the gym device** — Task 0.1 of the plan, blocks D-13 resolution.
   - What we know: Pro is most likely for small business; Enterprise/Education would be ideal.
   - What's unclear: Not yet verified.
   - Recommendation: First plan task is a PowerShell one-liner to run on the device (`Get-ComputerInfo | Select OsName, OsEdition`), then proceed.
   - **RESOLVED (2026-04-08):** Windows 11 Pro confirmed. See CONTEXT.md D-14 — chosen mechanism is custom HKLM\Winlogon\Shell registry fallback + GPO hardening (Assigned Access is UWP-only, Shell Launcher v2 is Enterprise-only).

2. **Does Phase 1 need electron-log from day one, or can logging be deferred to Phase 5?**
   - What we know: Phase 5 is the designated logging phase (ADMIN-04).
   - What's unclear: Phase 1 has useful boot events (`single-instance-lock-failed`, `before-input-event-attached`, `cash-register-ready-received`).
   - Recommendation: Install `electron-log` in Phase 1, set up the rotating file transport minimally, start logging phase-1 events immediately. Phase 5 adds structure (audit log separation, levels) on top. Zero extra cost.
   - **RESOLVED (2026-04-08):** Install in Phase 1. Plan 01-01 adds electron-log ^5.2.x to dependencies and plan 01-02 wires the transport. Rationale: audit trail for single-instance-lock rejection and startup errors is valuable from day one.

3. **Should `AutoAdminLogon` be in scope for Phase 1 runbook, or is it a manual GUI step?**
   - What we know: Scriptable via registry (`HKLM\Winlogon\DefaultPassword` + `AutoAdminLogon=1`).
   - What's unclear: Security review — plaintext password in registry.
   - Recommendation: Include in the runbook as an optional script (`01a-autologin-setup.ps1`), document the tradeoff in README.md, let the operator decide at install time. Default to ON for unattended-kiosk posture per PROJECT.md reliability constraint.
   - **RESOLVED (2026-04-08):** Scripted via PowerShell in plan 01-05. Plaintext password tradeoff accepted per CONTEXT.md D-15; runbook README documents mitigations (standard-user kiosk account, BitLocker, strong local-admin password).

4. **Does electron-builder's NSIS `perMachine: false` mode support installing without admin when the Windows user is standard (non-admin)?**
   - What we know: Yes, `perMachine: false` + `oneClick: true` installs to `%LocalAppData%` without elevation.
   - What's unclear: Whether initial install from the admin account for the kiosk account needs extra steps (SID confusion).
   - Recommendation: Install from the admin account during provisioning, then copy the installed files to the kiosk user's `%LocalAppData%` OR run the installer once from the kiosk user account after creating it. Test both paths.
   - **RESOLVED (2026-04-08):** perMachine: false (per-user install) in plan 01-04. Kiosk account installs the app itself during initial provisioning per runbook instructions; Startup folder shortcut lives in the kiosk user's %APPDATA%\Microsoft\Windows\Start Menu\Programs\Startup.

## Sources

### Primary (HIGH confidence)

- [Electron BrowserWindow docs](https://www.electronjs.org/docs/latest/api/browser-window) — kiosk option, backgroundColor, paintWhenInitiallyHidden, show/ready-to-show
- [Electron webContents docs — before-input-event](https://www.electronjs.org/docs/latest/api/web-contents) — event shape, preventDefault behavior
- [Electron app.requestSingleInstanceLock](https://www.electronjs.org/docs/latest/api/app) — lock semantics
- [Electron setLoginItemSettings](https://www.electronjs.org/docs/latest/api/app) — Windows registry behavior
- [Electron globalShortcut](https://www.electronjs.org/docs/latest/api/global-shortcut) — registration timing
- [electron-builder NSIS docs](https://www.electron.build/nsis.html) — perMachine, oneClick, customInstall macros
- [electron-builder Common Configuration](https://www.electron.build/configuration.html) — `build` key structure
- [Microsoft Learn — Windows Kiosk Configuration Overview](https://learn.microsoft.com/en-us/windows/configuration/kiosk/) — SKU matrix
- [Microsoft Learn — Assigned Access Single-App Kiosk](https://learn.microsoft.com/en-us/windows/configuration/assigned-access/configure-single-app-kiosk) — UWP-only limitation
- [Microsoft Learn — Shell Launcher v2](https://learn.microsoft.com/en-us/windows/configuration/shell-launcher/) — Enterprise/Education requirement
- `.planning/research/ARCHITECTURE.md` §"Host Window + Child BrowserView", §"Patterns 1–6" — reused
- `.planning/research/PITFALLS.md` Pitfall 2 (FOUUI), Pitfall 7 (kiosk breakout) — reused

### Secondary (MEDIUM confidence)

- [Electron issue #40159 — can't prevent Win+D, Win+R, Alt+Tab](https://github.com/electron/electron/issues/40159) — confirms the userspace suppression gap
- [Electron issue #19279 — before-input-event preventDefault and menu accelerators](https://github.com/electron/electron/issues/19279)
- [Electron issue #37336 — preventDefault blocks keyup](https://github.com/electron/electron/issues/37336)
- [electron-userland/electron-builder #1145 — NSIS Startup folder](https://github.com/electron-userland/electron-builder/issues/1145) — `$SMSTARTUP` pattern
- [mobile-jon.com Deep Dive Windows 11 Kiosks Part 1 / Part 2](https://mobile-jon.com/2025/01/15/deep-dive-into-windows-11-kiosks-part-1-assigned-access/) — practical Win11 kiosk config walkthrough (2025)

### Tertiary (verify during implementation)

- [Microsoft Q&A — HKLM Winlogon Shell replacement](https://learn.microsoft.com/en-us/answers/questions/1158081/) — per-user custom shell pattern for Win11 Pro fallback
- [kiosk-mode-breakout repo](https://github.com/ikarus23/kiosk-mode-breakout) — breakout vector catalog, referenced in runbook

## Metadata

**Confidence breakdown:**
- Electron APIs (kiosk, before-input-event, single-instance, globalShortcut, setLoginItemSettings): HIGH — stable since Electron 15+, multiple authoritative sources agree, well-trodden path.
- electron-builder NSIS + `$SMSTARTUP` shortcut: HIGH — documented pattern from electron-builder issues, widely used.
- Win11 kiosk lockdown (Shell Launcher v2 vs Assigned Access vs custom shell): MEDIUM-HIGH for the decision tree (MS Learn is authoritative), LOW for the exact Pro-path custom-shell registry steps (must be validated on real Win11 Pro 24H2+ — some community reports of Windows Update resetting values). D-13 resolution requires SKU verification as Task 0.1.
- Phase 1 → Phase 2 / Phase 5 handoff interfaces: HIGH — D-01..D-13 explicitly define them.
- Runbook scripts (exact .reg / .ps1 contents): MEDIUM — structure is correct, individual registry keys must be validated against a clean Win11 Pro VM before shipping to the gym device.

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (30 days — Electron 41 is current stable, Win11 kiosk docs are stable). Re-verify before Phase 1 execution if this date passes.
