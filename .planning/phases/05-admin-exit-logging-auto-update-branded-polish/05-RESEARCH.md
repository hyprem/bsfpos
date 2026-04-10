# Phase 5: Admin Exit, Logging, Auto-Update & Branded Polish — Research

**Researched:** 2026-04-10
**Domain:** Electron kiosk admin controls, electron-updater private GitHub provider, electron-log v5 rotation, structured audit logging
**Confidence:** HIGH (core APIs verified; 5-file rotation requires custom archiveLogFn — documented below)

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Admin Menu UI & Items**
- D-01: Admin menu is `<div id="admin-menu">` inside `host.html` on z-index layer 500. Vertical full-width button stack. No grid, no icons. All buttons min 44×44 px.
- D-02: Button order — (1) Check for updates, (2) View logs, (3) Reload, (4) Re-enter credentials, (5) Exit to Windows.
- D-03: Diagnostic header: app version, last update check timestamp, current authFlow state, last idle-reset timestamp. Read from `app.getVersion()`, updater state, `authFlow.getState()`, Phase 4 `sessionReset` last-timestamp accessor.
- D-04: "View logs" calls `shell.openPath(app.getPath('logs'))`. No in-app log viewer.
- D-05: "Re-enter credentials" re-raises Phase 3 credentials overlay with `{ firstRun: false }`.
- D-06: "Reload" calls `mainWindow.webContents.reload()` and restarts authFlow from BOOTING.
- D-07: "Exit to Windows" calls `globalShortcut.unregisterAll()` + `app.setKiosk(false)` + `app.quit()`.
- D-08: Ctrl+Shift+F12 added to Phase 1 `reservedShortcuts` Set. Captured via both `globalShortcut.register` and `before-input-event`. Opens admin PIN modal (not admin menu directly).

**PIN Lockout**
- D-09: Lockout state persisted in electron-store under `adminPinLockout = { attempts: [timestamp,...], lockedUntil: ISOString | null }`. Survives app restart.
- D-10: 5 failed verifyPin calls within rolling 60-second window → `lockedUntil = now + 5 minutes`. Old attempts outside window pruned on each verify.
- D-11: Counter fully resets on successful PIN verify.
- D-12: During lockout, hotkey still opens PIN modal but keypad replaced with live countdown `mm:ss` + German message "Zu viele Versuche — bitte warten".
- D-13: New wrapper module `src/main/adminPinLockout.js`. Does NOT modify `adminPin.js`. Exposes `verifyPinWithLockout(store, pin)` → `{ ok: bool, locked: bool, lockedUntil: Date | null }`.

**Auto-Update Safe-Window Policy**
- D-14: `checkForUpdates()` fires on boot (after app.whenReady + PAT-available check) and every 6 hours via setInterval.
- D-15: `quitAndInstall` gated on first of: (a) Phase 4 `sessionReset` completion event, or (b) 03:00–05:00 maintenance window. Requires `sessionReset.js` to emit new `post-reset` event.
- D-16: Safe-window "idle" = just after `sessionReset` completes. New `post-reset` event on `sessionReset.js` consumed by new `updateGate.js` module.
- D-17: "Check for updates" admin action triggers check and shows result text but does NOT bypass safe-window rule. No force-install path.

**GitHub PAT Distribution**
- D-18: Repo stays private. PAT entered once via admin menu on first boot. New admin menu item "Configure auto-update" (or "Update-Zugang ändern" once set). PAT encrypted via `safeStorage.encryptString`, persisted in electron-store under `githubUpdatePat` (base64 ciphertext).
- D-19: Before PAT is set, auto-update silently disabled. Kiosk boots normally; `checkForUpdates` never called. Diagnostic header shows "Auto-Update: nicht konfiguriert".
- D-20: PAT config screen is `<div id="update-config">` on layer 500, mutually exclusive with admin menu. Single PAT text input + "Speichern" button. Input masked. PAT never logged, never displayed after save.
- D-21: Repo-privacy-audit guidance is ongoing hygiene, not Phase 5 deliverable.

**Log Redaction & Structured Events**
- D-22: Badge numbers logged as `sha256(badge).slice(0, 8)` — 8 hex chars.
- D-23: Sale-completion log line: `sale.completed badge=<hash8> at=<ISO>`. No monetary amount.
- D-24: Single unified log file `main.log`. Not a split pair.
- D-25: New helper `log.audit(event, fields)` in `src/main/logger.js`. Field-name allowlist redactor for badge/password/ciphertext fields.
- D-26: File-transport config: `maxSize = 1 MB`, 5-file rotation via custom `archiveLogFn`.
- D-27: Prior-phase `log.info(...)` lines that reference badge/credentials/ciphertext/PAT/PIN migrated to `log.audit(...)` in Phase 5. An explicit audit+migration task in the plan.
- D-28: Event taxonomy: `startup`, `startup.complete`, `auth.state`, `auth.submit`, `auth.failure`, `idle.reset`, `badge.scanned`, `sale.completed`, `update.check`, `update.downloaded`, `update.install`, `update.failed`, `pin.verify`, `pin.lockout`, `admin.open`, `admin.exit`, `crash`.

**Update Failure & Rollback**
- D-29: Bad-release detection = post-update health check on next boot. Before `quitAndInstall`, persist `{pendingVersion, installedAt}` to electron-store. 2-minute watchdog: if authFlow reaches `CASH_REGISTER_READY` within 2 minutes → flag cleared (health check passed). If boot crashes or watchdog expires → next boot sees flag → mark bad, disable auto-update.
- D-30: Rollback is manual via runbook. On detected bad release: set `autoUpdateDisabled = true` in store, log `update.failed`, boot to branded bad-release error screen. Staff re-installs previous NSIS installer over RDP.
- D-31: Bad-release state reuses `#magicline-error` layer with new variant `'bad-release'`. Text: "Update fehlgeschlagen — bitte Studio-Personal verständigen". Includes "PIN eingeben" button opening admin menu.
- D-32: New variant `'update-failed'` for install-time failure (NSIS exit code non-zero). Text: "Aktualisierung fehlgeschlagen — erneut versucht beim nächsten Neustart". Auto-dismisses after 10s or on tap.

**Branded Polish Scope**
- D-33: Phase 5 polishes only new Phase 5 surfaces. Existing surfaces unchanged.
- D-34: Existing surface polish debt deferred to next-visit batch.
- D-35: Brand palette locked to current host.css tokens.
- D-36: Touch target audit is CSS-level only.

**Updating Cover**
- D-37: `<div id="updating-cover">` on layer 300, shared with `#magicline-error`.
- D-38: Cover only visible during install/restart window. Downloads silent.
- D-39: Cover content: logo, "Aktualisierung läuft — bitte warten", infinite CSS spinner.
- D-40: Post-install first boot shows normal splash, no version toast. Silent upgrade.

### Claude's Discretion
- Exact German copy for admin menu button labels
- CSS spinner design for updating cover
- Exact `archiveLogFn` implementation for 5-file rotation
- Admin menu open/close transition (instant, fade, slide)
- Whether diagnostic header timestamps are absolute or relative

### Deferred Ideas (OUT OF SCOPE)
- Polish debt on existing pre-Phase-5 surfaces (splash, idle overlay, credentials, baseline magicline-error)
- Auto-rollback via cached previous install or previous GitHub release
- Force-install button in admin menu
- Public repo migration
- "Updated to vX.Y.Z" post-install toast
- In-app log viewer

</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| ADMIN-01 | Hidden hotkey Ctrl+Shift+F12 via globalShortcut + before-input-event → PIN prompt | §Admin Hotkey section — reservedShortcuts hook + canonical() function already in keyboardLockdown.js |
| ADMIN-02 | Correct PIN → drops kiosk mode → admin menu: exit, re-enter creds, reload, view logs, check updates | §Admin Menu IPC Pattern — follow existing ipcMain.handle pattern from Phases 3–4 |
| ADMIN-03 | PIN hashed at rest; 5 wrong in 60s → 5-min rate-limit lockout | §PIN Lockout — new adminPinLockout.js wrapper around existing adminPin.js |
| ADMIN-04 | Rotating log files with structured entries for all significant events | §electron-log v5 — log.audit helper + archiveLogFn 5-file rotation |
| ADMIN-05 | Logs rotate (max 1 MB / 5 files), no secrets | §electron-log v5 — custom archiveLogFn + redactor |
| ADMIN-06 | Auto-update via electron-updater + private GitHub + safeStorage-encrypted PAT | §electron-updater Private GitHub — NsisUpdater + addAuthHeader pattern |
| ADMIN-07 | Update install gated behind safe window (no mid-transaction) | §Safe-Window Gating — updateGate.js consuming sessionReset post-reset event + time check |
| ADMIN-08 | Branded updating cover during install; rollback + log on failure | §Update Failure Handling — post-update health watchdog + existing magicline-error variant pattern |
| BRAND-01 | Bee Strong logo + brand colors on all branded surfaces | §Branded Overlays — new surfaces inherit existing host.css tokens |
| BRAND-02 | min 44×44 px touch targets, high contrast, vertical-touchscreen readable | §Touch Target Audit — CSS-level min-height/min-width enforcement |
| BRAND-03 | Magicline content area visually unchanged | §Magicline Content Isolation — inject.css does not touch Magicline colors/fonts (verified) |

</phase_requirements>

---

## Summary

**Riskiest findings (5 bullets):**

1. **electron-log v5 has NO built-in N-file rotation.** The `archiveLogFn` default keeps exactly ONE `.old` file. The 5-file requirement (D-26, ADMIN-05) requires a custom `archiveLogFn` that walks a numbered file sequence (`main.1.log` through `main.5.log`) using synchronous `fs` calls. This is straightforward to implement but must be hand-coded — there is no library option to set. [VERIFIED: electron-log GitHub docs/transports/file.md]

2. **electron-updater private GitHub + runtime PAT requires `NsisUpdater` class directly, not `autoUpdater` singleton.** The singleton `autoUpdater` imports the wrong updater class on the build host vs the kiosk. To inject a runtime PAT without embedding it in the installer, instantiate `new NsisUpdater(options)` directly and call `.addAuthHeader('Bearer <pat>')` before calling `checkForUpdates()`. This is the documented pattern for runtime token injection. [VERIFIED: electron-builder BaseUpdater.ts + mintlify.wiki docs]

3. **`autoDownload` must be set to `false` before calling `checkForUpdates()`.** The default is `true` — if left at default, the updater begins downloading immediately upon finding a new version regardless of safe-window state. Set `autoUpdater.autoDownload = false`, listen for `update-available`, then call `autoUpdater.downloadUpdate()` manually (which returns a Promise). Listen to `update-downloaded` before calling `quitAndInstall`. [VERIFIED: electron-builder docs + BaseUpdater source]

4. **`Ctrl+Shift+F12` is currently in `SUPPRESS_LIST` as `'F12'`.** The existing `SUPPRESS_LIST` in `keyboardLockdown.js` blocks bare `F12`. The `canonical()` function produces `'Ctrl+Shift+F12'` for the full chord — this is NOT in SUPPRESS_LIST, so the chord will not be suppressed. Adding it to `reservedShortcuts` is the correct Phase 1 D-10 hook. The `globalShortcut.register('Ctrl+Shift+F12', handler)` call must be registered BEFORE `attachLockdown` runs, or it will have no effect (globalShortcut fires in main process before before-input-event in renderer). [VERIFIED: keyboardLockdown.js source + Electron globalShortcut behavior]

5. **`electron-log` package.json pins `~5.2.0` but npm latest in v5 line is `5.4.3`.** The `~5.2.0` pin in package.json will not receive 5.3.x or 5.4.x patches. The `archiveLogFn` API exists at 5.2.x and is unchanged at 5.4.x. The pin is safe but may miss bug fixes; the planner should note this without changing it (CLAUDE.md pins `^5.2.x`). [VERIFIED: npm view electron-log]

**Primary recommendation:** Use `NsisUpdater` directly with `addAuthHeader` for runtime PAT injection, `autoDownload: false` for manual safe-window gating, and a custom 5-file `archiveLogFn` with numbered suffixes.

---

## Standard Stack

All packages are already in `package.json`. Phase 5 adds one new dependency.

### Core (already installed)

| Library | Version in repo | Purpose | Source |
|---------|----------------|---------|--------|
| electron | ~41.1.1 (devDep) | Runtime — `globalShortcut`, `safeStorage`, `shell`, `app.isPackaged` | [VERIFIED: package.json] |
| electron-log | ~5.2.0 (dep) | Structured rotating logs, `archiveLogFn` override | [VERIFIED: package.json] |
| electron-store | ^10.1.0 (dep) | PIN lockout state, PAT ciphertext, health-check flag persistence | [VERIFIED: package.json] |
| electron-updater | NOT in package.json yet | Auto-update against private GitHub Releases | [VERIFIED: package.json — absent] |

### New Dependency Required

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| **electron-updater** | `^6.8.3` | NSIS auto-update, private GitHub via runtime PAT, update-downloaded event | Matches electron-builder 26.x family; CLAUDE.md-pinned version |

**Installation:**
```bash
npm install electron-updater@^6.8.3
```

**Version verification:** [VERIFIED: npm view electron-updater version → 6.8.3]

### Alternatives Considered

| Recommended | Alternative | Why Not |
|-------------|-------------|---------|
| `NsisUpdater` (direct class) | `autoUpdater` singleton | Singleton cannot accept runtime `addAuthHeader`; class instantiation is required for runtime PAT injection without embedding token in installer |
| Custom `archiveLogFn` for 5-file rotation | `winston-daily-rotate-file` | CLAUDE.md explicitly rules out winston; electron-log is the pinned choice |
| `safeStorage.encryptString` for PAT | Plaintext store | CLAUDE.md forbids plaintext secrets |

---

## Architecture Patterns

### Recommended Module Structure (new in Phase 5)

```
src/
├── main/
│   ├── adminPinLockout.js    # NEW — wrapper around adminPin.js; lockout state + verifyPinWithLockout()
│   ├── updateGate.js         # NEW — safe-window predicate; consumes post-reset event + time check
│   ├── autoUpdater.js        # NEW — NsisUpdater instantiation, PAT injection, event wiring
│   ├── adminPin.js           # READ-ONLY in Phase 5 (D-13)
│   ├── logger.js             # MODIFIED — add log.audit() helper + redactor + 5-file archiveLogFn
│   ├── keyboardLockdown.js   # MODIFIED — add 'Ctrl+Shift+F12' to reservedShortcuts
│   ├── sessionReset.js       # MODIFIED — add post-reset EventEmitter emission
│   └── main.js               # MODIFIED — wire hotkey, admin IPC, updateGate, health watchdog
├── host/
│   ├── host.html             # MODIFIED — add #admin-menu, #update-config (layer 500), #updating-cover (layer 300), two new magicline-error variants
│   ├── host.js               # MODIFIED — admin menu IPC handlers, PIN lockout countdown, PAT form, updating-cover show/hide
│   └── host.css              # MODIFIED — button stack, diagnostic header, countdown, spinner, new variant text
```

### Pattern 1: NsisUpdater with Runtime PAT Injection

The singleton `autoUpdater` exported from `electron-updater` resolves to the correct platform updater at runtime, but it does NOT support `addAuthHeader` (it's a getter). For runtime PAT injection without embedding in the installer, use the class directly:

```javascript
// src/main/autoUpdater.js
// Source: electron-builder mintlify.wiki docs + BaseUpdater.ts
const { NsisUpdater } = require('electron-updater');

let updater = null;

function initUpdater({ pat, onDownloaded, onError, onAvailable, onNotAvailable }) {
  const options = {
    provider: 'github',
    owner: 'your-org',
    repo: 'bsfpos',
    private: true,
  };
  updater = new NsisUpdater(options);
  updater.autoDownload = false;           // CRITICAL: gate download manually
  updater.autoInstallOnAppQuit = false;   // CRITICAL: gate install via safe-window only
  updater.logger = require('./logger');   // wire electron-log as updater logger
  updater.addAuthHeader('Bearer ' + pat);

  updater.on('update-available',     (info) => onAvailable(info));
  updater.on('update-not-available', (info) => onNotAvailable(info));
  updater.on('update-downloaded',    (info) => onDownloaded(info));
  updater.on('error',                (err)  => onError(err));
  return updater;
}

function checkForUpdates() {
  if (!updater) return Promise.resolve(null);
  return updater.checkForUpdates();
}

function downloadUpdate() {
  if (!updater) return Promise.resolve(null);
  return updater.downloadUpdate();
}

// Called by updateGate.js when safe window is open AND update-downloaded has fired.
function installUpdate() {
  if (!updater) return;
  // isSilent=true (Windows NSIS silent install), isForceRunAfter=true (relaunch after)
  updater.quitAndInstall(true, true);
}

module.exports = { initUpdater, checkForUpdates, downloadUpdate, installUpdate };
```

[VERIFIED: electron-builder docs — autoDownload, autoInstallOnAppQuit, addAuthHeader; BaseUpdater.ts — quitAndInstall(isSilent, isForceRunAfter)]

### Pattern 2: Safe-Window Gating (updateGate.js)

The gate must satisfy BOTH conditions before calling `installUpdate()`:
- `update-downloaded` event has fired (download complete)
- Safe window is open: just after a `sessionReset` `post-reset` event OR current time is 03:00–05:00

```javascript
// src/main/updateGate.js
// Consumes: sessionReset post-reset event (new in Phase 5)
//           clock check for 03:00-05:00 window
// Produces: calls installUpdate() at the right moment

const { EventEmitter } = require('events');

let updateReady = false;   // set true on 'update-downloaded'
let gateTimer = null;

function isMaintenanceWindow() {
  const h = new Date().getHours();
  return h >= 3 && h < 5;
}

function tryInstall(installFn, log) {
  if (!updateReady) return;
  // Always safe to install: either maintenance window or called from post-reset handler
  installFn();
}

function onUpdateDownloaded(installFn, log, sessionResetEmitter) {
  updateReady = true;
  log.audit('update.downloaded', { gateState: 'waiting' });

  // Arm the maintenance-window polling (check every 60s)
  if (gateTimer) clearInterval(gateTimer);
  gateTimer = setInterval(() => {
    if (isMaintenanceWindow()) {
      clearInterval(gateTimer);
      gateTimer = null;
      log.audit('update.install', { trigger: 'maintenance-window' });
      tryInstall(installFn, log);
    }
  }, 60_000);

  // Listen for sessionReset post-reset (Phase 4 D-15/D-16 contract)
  sessionResetEmitter.once('post-reset', () => {
    if (updateReady) {
      if (gateTimer) { clearInterval(gateTimer); gateTimer = null; }
      log.audit('update.install', { trigger: 'post-reset' });
      tryInstall(installFn, log);
    }
  });
}

module.exports = { onUpdateDownloaded, isMaintenanceWindow };
```

### Pattern 3: adminPinLockout.js Wrapper

The wrapper calls through to `adminPin.verifyPin` and manages the `adminPinLockout` store key. `adminPin.js` is never modified.

```javascript
// src/main/adminPinLockout.js
// Source: CONTEXT.md D-09 through D-13
const adminPin = require('./adminPin');
const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const LOCKOUT_MS = 5 * 60_000;

function verifyPinWithLockout(store, pin) {
  let lockout = store.get('adminPinLockout') || { attempts: [], lockedUntil: null };
  const now = Date.now();

  // Check if currently locked out
  if (lockout.lockedUntil && now < new Date(lockout.lockedUntil).getTime()) {
    return { ok: false, locked: true, lockedUntil: new Date(lockout.lockedUntil) };
  }

  // Prune attempts outside rolling window
  lockout.attempts = (lockout.attempts || []).filter(t => now - t < WINDOW_MS);

  const ok = adminPin.verifyPin(store, pin);
  if (ok) {
    // D-11: full reset on success
    store.set('adminPinLockout', { attempts: [], lockedUntil: null });
    return { ok: true, locked: false, lockedUntil: null };
  }

  // Failed — record attempt
  lockout.attempts.push(now);
  if (lockout.attempts.length >= MAX_ATTEMPTS) {
    lockout.lockedUntil = new Date(now + LOCKOUT_MS).toISOString();
  }
  store.set('adminPinLockout', lockout);
  return {
    ok: false,
    locked: lockout.attempts.length >= MAX_ATTEMPTS,
    lockedUntil: lockout.lockedUntil ? new Date(lockout.lockedUntil) : null,
  };
}

module.exports = { verifyPinWithLockout };
```

### Pattern 4: Custom 5-File archiveLogFn

electron-log v5 `archiveLogFn` signature: `(oldLogFile: LogFile) => void`. The argument is a `LogFile` instance — calling `.toString()` gives the full path. The function must run synchronously.

```javascript
// Inside src/main/logger.js
// Source: electron-log docs/transports/file.md (archiveLogFn signature)
const fs = require('fs');
const path = require('path');
const MAX_ARCHIVES = 5;

log.transports.file.archiveLogFn = function archiveLog(oldLogFile) {
  const filePath = oldLogFile.toString();
  const info = path.parse(filePath);

  // Rotate: main.5.log deleted, main.4→5, main.3→4 ... main.1→2, main→main.1
  for (let i = MAX_ARCHIVES; i >= 1; i--) {
    const older = path.join(info.dir, info.name + '.' + i + info.ext);
    const newer = i === 1
      ? filePath
      : path.join(info.dir, info.name + '.' + (i - 1) + info.ext);
    if (fs.existsSync(older)) {
      if (i === MAX_ARCHIVES) {
        try { fs.unlinkSync(older); } catch (e) { /* ignore */ }
      } else {
        try { fs.renameSync(older, path.join(info.dir, info.name + '.' + (i + 1) + info.ext)); } catch (e) { /* ignore */ }
      }
    }
    if (i === 1 && fs.existsSync(newer)) {
      try { fs.renameSync(newer, path.join(info.dir, info.name + '.1' + info.ext)); } catch (e) { /* ignore */ }
    }
  }
};
```

Note: The loop above has a subtle off-by-one. The correct implementation walks from highest to lowest:
1. Delete `main.5.log` if exists
2. Rename `main.4.log` → `main.5.log`
3. Rename `main.3.log` → `main.4.log`
4. Rename `main.2.log` → `main.3.log`
5. Rename `main.1.log` → `main.2.log`
6. Rename `main.log` → `main.1.log`
7. electron-log then opens fresh `main.log`

This is the canonical rotation pattern. The planner should write a clean loop that walks `i` from MAX_ARCHIVES down to 1 with this exact rename chain.

### Pattern 5: log.audit() Helper with Redactor

```javascript
// src/main/logger.js additions
// Source: CONTEXT.md D-25, D-28

const crypto = require('crypto');

const BADGE_FIELDS   = new Set(['badge', 'badgeId', 'member', 'memberId']);
const SECRET_FIELDS  = new Set(['password', 'pass', 'pwd']);
const CIPHER_FIELDS  = new Set(['cipher', 'ciphertext', 'token', 'pat']);

function redactValue(key, value) {
  if (BADGE_FIELDS.has(key) && typeof value === 'string') {
    return crypto.createHash('sha256').update(value).digest('hex').slice(0, 8);
  }
  if (SECRET_FIELDS.has(key)) return '***';
  if (CIPHER_FIELDS.has(key)) {
    const len = typeof value === 'string' ? value.length : '?';
    return '[cipher:' + len + ']';
  }
  return value;
}

log.audit = function audit(event, fields) {
  const parts = ['event=' + event];
  if (fields) {
    for (const [k, v] of Object.entries(fields)) {
      parts.push(k + '=' + redactValue(k, v));
    }
  }
  parts.push('at=' + new Date().toISOString());
  log.info(parts.join(' '));
};
```

[VERIFIED: Node built-in `crypto.createHash('sha256')` — no new dependency]

### Pattern 6: Ctrl+Shift+F12 Hotkey Wiring

Two-layer registration per D-08:

```javascript
// In main.js ORCHESTRATION block (after createMainWindow):

// Layer 1: add to reservedShortcuts so before-input-event passes it through
const { reservedShortcuts } = require('./keyboardLockdown');
reservedShortcuts.add('Ctrl+Shift+F12');

// Layer 2: globalShortcut defense-in-depth (catches OS-level focus gaps)
if (!isDev) {
  const ok = globalShortcut.register('Ctrl+Shift+F12', () => {
    openAdminPinModal();
  });
  if (!ok) log.warn('globalShortcut Ctrl+Shift+F12 registration failed');
}

// Layer 3: before-input-event handler on BOTH webContents (host + magicline view)
// The canonical() function in keyboardLockdown already produces 'Ctrl+Shift+F12'
// for this chord. The reservedShortcuts.has() check lets it pass through.
// Downstream handler must be attached to before-input-event that checks the accel:
mainWindow.webContents.on('before-input-event', (event, input) => {
  if (input.type !== 'keyDown') return;
  const { canonical } = require('./keyboardLockdown');
  if (canonical(input) === 'Ctrl+Shift+F12') {
    openAdminPinModal();
  }
});
// ALSO attach to magiclineView.webContents after it is created (same handler)
```

**Critical:** The Magicline WebContentsView also needs the before-input-event handler — if Magicline has focus (member is looking at the cash register), globalShortcut will catch it at the OS level, but the before-input-event handler on the magicline webContents is belt-and-braces defense.

[VERIFIED: keyboardLockdown.js source — reservedShortcuts.has() check is already in before-input-event handler]

### Pattern 7: Post-Update Health Watchdog

```javascript
// In main.js — first thing inside app.whenReady(), BEFORE authFlow starts:
const store = new Store({ name: 'config' });
const pendingUpdate = store.get('pendingUpdate'); // { pendingVersion, installedAt }

let healthWatchdogTimer = null;
if (pendingUpdate && pendingUpdate.pendingVersion) {
  const WATCHDOG_MS = 2 * 60_000; // D-29: 2-minute watchdog
  healthWatchdogTimer = setTimeout(() => {
    // Watchdog expired — mark as bad release
    log.audit('update.failed', {
      version: pendingUpdate.pendingVersion,
      reason: 'watchdog-expired',
    });
    store.set('autoUpdateDisabled', true);
    store.delete('pendingUpdate');
    mainWindow.webContents.send('show-magicline-error', { variant: 'bad-release' });
  }, WATCHDOG_MS);
}

// In authFlow — when CASH_REGISTER_READY state is reached:
// authFlow must call clearHealthWatchdog() exported from main.js setup
function clearHealthWatchdog(store, log) {
  if (healthWatchdogTimer) {
    clearTimeout(healthWatchdogTimer);
    healthWatchdogTimer = null;
    const pv = store.get('pendingUpdate');
    if (pv) {
      log.audit('update.install', { version: pv.pendingVersion, result: 'ok' });
      store.delete('pendingUpdate');
    }
  }
}
```

### Anti-Patterns to Avoid

- **Never embed PAT in `publish.token` inside `package.json` or `electron-builder.yml`.** The token ends up in `app-update.yml` inside the NSIS installer's resources folder, readable by anyone who extracts the installer. CLAUDE.md §cautionary note on PAT-embedded installers (#2314). [VERIFIED: electron-builder #2314]
- **Never call `autoUpdater.checkForUpdates()` in dev mode.** `app.isPackaged` is false in dev. Always gate behind `if (app.isPackaged)`. [ASSUMED — standard Electron pattern; no docs gap]
- **Never use `autoInstallOnAppQuit = true`.** This is the default — it bypasses the safe-window gate if the user (or OS) quits the app outside a session reset. Always set to `false`. [VERIFIED: electron-builder docs]
- **Never use `autoDownload = true`.** Default would start downloading as soon as `update-available` fires, before any safe-window decision is made. [VERIFIED: electron-builder docs]
- **Do not call `verifyPin` directly from host.js for admin flows.** The existing `ipcMain.handle('verify-pin')` handler has a `resetLoopPending` branch — Phase 5 must route admin PIN attempts through a NEW `ipcMain.handle('verify-admin-pin')` channel that calls `verifyPinWithLockout`, so the two PIN flows don't share state. [VERIFIED: main.js source — resetLoopPending intercept in verify-pin]

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| DPAPI encryption for PAT | Custom AES/XOR | `safeStorage.encryptString` (built-in Electron) | DPAPI is tied to Windows logon — only the configured user can decrypt; no key management needed |
| Log file write with rotation | Custom file stream | `electron-log` file transport + custom `archiveLogFn` | electron-log handles flush, file handle lifecycle, and size check atomically |
| Update check + download | GitHub API `fetch` + manual delta | `electron-updater` + NSIS diff patching | Handles `.yml` parsing, sha512 verification, NSIS silent install, Windows UAC elevation |
| PIN hash | bcrypt (npm dep) or MD5 | Node built-in `crypto.scryptSync` (already in adminPin.js) | Already proven + benchmarked at N=16384 on kiosk hardware (94.8ms, acceptable) |
| Badge hash | Custom obfuscation | Node built-in `crypto.createHash('sha256')` | Deterministic, no key, 8-char prefix is enough for correlation without re-identification |
| Timed countdown display | `sleep`-based loop | `setInterval` in host.js | Already the established pattern in idle overlay countdown |
| CSS spinner | Lottie / GIF animation | Pure CSS `@keyframes rotate` on a `border-top: solid` element | Zero runtime cost, no asset, consistent with "plain HTML overlays" mandate |

**Key insight:** The entire Phase 5 feature set is achievable without any new npm dependencies beyond `electron-updater`. Every other building block (crypto, fs, EventEmitter, safeStorage) is either Node built-in or already installed.

---

## Fragility / Gotchas

### Gotcha 1: verify-pin IPC Channel Conflict
**What goes wrong:** Phase 5 admin PIN attempts flow through the existing `ipcMain.handle('verify-pin')` handler, which has a `resetLoopPending` branch that intercepts PIN entry and routes to `app.relaunch()`. If admin unlock is wired to the same channel, a leftover `resetLoopPending = true` state will cause a `quitAndInstall` command to instead trigger `app.relaunch()` — catastrophic confusion.

**How to avoid:** Register a **new** `ipcMain.handle('verify-admin-pin')` channel that calls `verifyPinWithLockout(store, pin)`. The existing `'verify-pin'` channel stays as-is for the reset-loop recovery path. Update `preload.js` to expose both: `verifyPin` (existing) and `verifyAdminPin` (new).

**Warning signs:** Admin menu never opens after a reset-loop event even with correct PIN.

### Gotcha 2: app.isPackaged Guard on Updater
**What goes wrong:** `checkForUpdates()` called in dev throws or silently no-ops because there is no `app-update.yml` in dev.

**How to avoid:** Gate all updater calls behind `if (app.isPackaged)`. In dev, the `initUpdater` call is skipped entirely and the diagnostic header shows "Auto-Update: Entwicklungsmodus".

### Gotcha 3: NsisUpdater vs Portable
**What goes wrong:** If someone runs the packaged app via the `--dir` output (portable), `NsisUpdater` calls NSIS installer paths that don't exist, causing a crash on `quitAndInstall`.

**How to avoid:** The project always uses the NSIS installer target (not portable — confirmed in package.json). The `--dir` build is for local testing only, never deployed. Gate `quitAndInstall` behind `app.isPackaged` which is `false` for portable/unpackaged. [VERIFIED: package.json build config — nsis target only]

### Gotcha 4: electron-log archiveLogFn Called from File Transport's Sync Path
**What goes wrong:** `archiveLogFn` runs synchronously during log write. If the custom rotation uses async `fs.promises` inside it, the next write starts on the not-yet-renamed old file — partial log loss.

**How to avoid:** Use only synchronous `fs.renameSync`, `fs.unlinkSync`, `fs.existsSync` inside `archiveLogFn`. Never `await` inside it.

### Gotcha 5: globalShortcut Registration Order vs Lockdown Attach
**What goes wrong:** If `globalShortcut.register('Ctrl+Shift+F12')` is called AFTER `attachLockdown(mainWindow.webContents)`, the before-input-event handler is already attached and will see `reservedShortcuts` — but if the globalShortcut registration fails (already taken by another app), the before-input-event fallback still works. Failure is graceful, but the registration should happen before `attachLockdown` to avoid any transient gaps.

**How to avoid:** Register all globalShortcuts (including Ctrl+Shift+F12) in the `app.whenReady` block BEFORE calling `attachLockdown`. Add `reservedShortcuts.add('Ctrl+Shift+F12')` BEFORE the `attachLockdown` call.

### Gotcha 6: electron-log package.json Pin is ~5.2.0 but Latest v5 is 5.4.3
**What goes wrong:** The `~5.2.0` pin (tilde) allows only `5.2.x` patches. The `archiveLogFn` API is identical at 5.2.x through 5.4.x, but the 5.3.x/5.4.x line may have bug fixes. CLAUDE.md says `^5.2.x` (caret) which allows minor bumps within v5 — the package.json currently uses tilde.

**How to avoid:** The planner should note this discrepancy. Consider updating to `^5.2.0` (caret) in package.json to allow minor upgrades within v5. This is low-risk and CLAUDE.md-aligned. [VERIFIED: npm view output + package.json]

### Gotcha 7: shell.openPath Opens Explorer — Brief Kiosk Break
**What goes wrong:** `shell.openPath(app.getPath('logs'))` opens Windows Explorer, which appears on top of the kiosk. The admin menu is still visible behind Explorer. When Explorer is closed, the kiosk returns.

**How to avoid:** Per D-04, this is explicitly accepted behavior — it is staff-only and admin-gated. No mitigation needed. Document in the runbook that the kiosk temporarily shows Explorer when logs are viewed, and Explorer must be closed manually before returning to kiosk operation. The admin must call `app.setKiosk(false)` before `shell.openPath` for Explorer to display correctly on Windows 11 in kiosk mode.

**Warning signs:** `shell.openPath` returns an error string on Windows if called while `kiosk: true` is set and Windows is in Assigned Access mode — Explorer may be blocked by the Assigned Access policy. The planner should include a task to verify this on the actual kiosk hardware.

### Gotcha 8: safeStorage and PAT Entry via Admin Menu
**What goes wrong:** `safeStorage.encryptString` requires an existing BrowserWindow to be initialized (documented Electron requirement). If the admin menu tries to save the PAT before the main window is ready, encryption fails.

**How to avoid:** This is already satisfied — the admin menu is only accessible after the main window is fully shown and the user has authenticated with a PIN. The window lifecycle guarantee is already met. [VERIFIED: Phase 3 research note in main.js comments — "safeStorage.isEncryptionAvailable() must be called AFTER at least one BrowserWindow exists"]

### Gotcha 9: autoInstallOnAppQuit Default True
**What goes wrong:** If `autoInstallOnAppQuit` is not explicitly set to `false`, the NSIS installer fires when the app quits for ANY reason (even `app.setKiosk(false)` + `app.quit()` from the admin "Exit to Windows" action), not just the safe window. An admin exit triggers an unintended mid-session update.

**How to avoid:** Set `updater.autoInstallOnAppQuit = false` immediately after constructing `NsisUpdater`. Only call `quitAndInstall` explicitly from `updateGate.js`. [VERIFIED: electron-builder docs + BaseUpdater.ts]

---

## Common Pitfalls

### Pitfall 1: PAT in app-update.yml (the #2314 anti-pattern)
**What goes wrong:** If `token` is placed in the `publish` block of `package.json` or `electron-builder.yml`, electron-builder bakes it into `app-update.yml` inside the packaged NSIS installer under `resources/`. Anyone who extracts the installer `.exe` with 7-Zip can read the PAT in plaintext.

**Why it happens:** The electron-builder docs show `token` as a `publish` config option, giving the impression it is the canonical way to configure private repo access.

**How to avoid:** Never set `token` in `publish` config. Use `NsisUpdater` class directly + `addAuthHeader('Bearer ' + decryptedPat)` at runtime. The PAT is loaded from the electron-store ciphertext, decrypted via `safeStorage.decryptString`, and injected only in memory. [CITED: github.com/electron-userland/electron-builder/issues/2314]

### Pitfall 2: update-available Fires Before Download Complete
**What goes wrong:** Code listening to `update-available` and calling `quitAndInstall()` immediately will crash — the download has not started yet.

**Why it happens:** `update-available` fires as soon as the version check returns a newer version. The download has not begun. `quitAndInstall` requires the download to be complete (`update-downloaded` event).

**How to avoid:** Listen to `update-downloaded` (not `update-available`) before calling `quitAndInstall`. With `autoDownload: false`, explicitly call `downloadUpdate()` in the `update-available` handler. `quitAndInstall()` only in the `update-downloaded` handler (via updateGate).

### Pitfall 3: Lockout Counter Not Surviving Crash + Restart
**What goes wrong:** If lockout state is in-memory only, an attacker who knows the PIN is locked out can kill the process via Task Manager (or trigger a crash) to reset the counter.

**Why it happens:** Natural first-pass implementation puts the counter in module scope.

**How to avoid:** Per D-09, persist `adminPinLockout` to electron-store on every failed attempt. Already decided — just make sure the store write happens BEFORE returning the failure response to the renderer. [VERIFIED: D-09 decision]

### Pitfall 4: Countdown Timer Leaking Across PIN Modal Shows
**What goes wrong:** If the lockout countdown `setInterval` is started in host.js when the lockout screen shows, and then the admin closes and re-opens the PIN modal (e.g., by pressing Ctrl+Shift+F12 again), a second interval starts. Both intervals tick, causing double-decrement or conflicting countdown values.

**Why it happens:** Identical to the idle overlay double-show race documented in host.js comments (the guard pattern `if (idleInterval) clearInterval(idleInterval)` was added for exactly this reason).

**How to avoid:** Apply the same guard in the lockout countdown: clear any existing countdown interval before starting a new one. Store the interval reference in a module-scoped variable in the IIFE.

### Pitfall 5: quitAndInstall + Single-Instance Lock
**What goes wrong:** After `quitAndInstall(true, true)`, the NSIS installer relaunches the app. The first boot after update triggers the single-instance lock. If the previous process has not fully exited when the new instance launches, `requestSingleInstanceLock()` returns false and the new instance exits immediately — the kiosk never comes back.

**Why it happens:** NSIS silent install with `isForceRunAfter=true` relaunches quickly. Windows may not have freed the lock file yet.

**How to avoid:** In the NSIS installer context, `quitAndInstall(true, true)` is standard and electron handles this correctly — the old process exits before the installer runs. This is a documented-safe pattern for NSIS. The health watchdog in Phase 5 will catch any failure to reach CASH_REGISTER_READY regardless. [ASSUMED — based on standard electron-updater NSIS behavior; physical verification required on kiosk hardware post-deploy]

---

## Ctrl+Shift+F12 Hotkey — Detailed Analysis

The existing `SUPPRESS_LIST` in `keyboardLockdown.js` includes `'F12'` (bare F12 = DevTools). The `canonical()` function builds `'Ctrl+Shift+F12'` from `{control:true, shift:true, key:'F12'}`. This string is NOT in `SUPPRESS_LIST`, so it is not suppressed.

Current flow without Phase 5 changes:
1. Ctrl+Shift+F12 pressed → `canonical()` = `'Ctrl+Shift+F12'`
2. `reservedShortcuts.has('Ctrl+Shift+F12')` = false (empty set in Phase 1)
3. `SUPPRESS_LIST.has('Ctrl+Shift+F12')` = false
4. Event passes through to Chromium → triggers Chromium's default DevTools behavior (if devTools enabled) or no-op (if devTools disabled, as in prod)

After Phase 5:
1. `reservedShortcuts.add('Ctrl+Shift+F12')` added in main.js before `attachLockdown`
2. `globalShortcut.register('Ctrl+Shift+F12', handler)` registered
3. In before-input-event: `reservedShortcuts.has('Ctrl+Shift+F12')` = true → event passes through → downstream handler in main.js fires `openAdminPinModal()`

The `globalShortcut.register` fires at the OS level (regardless of which window/webContents has focus), while the `before-input-event` handler on each webContents fires only when that webContents has focus. Both are needed for defense-in-depth per D-08. [VERIFIED: keyboardLockdown.js source code analysis]

---

## Runtime State Inventory

Phase 5 is not a rename/refactor phase — this section is scoped to Phase 5's own new persisted state, not a general rename audit.

| Category | New State Added in Phase 5 | Action |
|----------|---------------------------|--------|
| electron-store (`config.json`) | `adminPinLockout: {attempts, lockedUntil}` | New key; initialized on first failed attempt |
| electron-store (`config.json`) | `githubUpdatePat` (base64 ciphertext) | New key; set via admin PAT config screen |
| electron-store (`config.json`) | `autoUpdateDisabled: bool` | New key; set on bad-release detection |
| electron-store (`config.json`) | `pendingUpdate: {pendingVersion, installedAt}` | New key; set before quitAndInstall, cleared on health-check pass |
| `%AppData%/Bee Strong POS/logs/main.log` | Existing file; archiveLogFn changes rotation behavior | No migration; existing log data preserved |

No OS-level registered state, no database, no external service config is added in Phase 5.

---

## Environment Availability

| Dependency | Required By | Available | Notes |
|------------|------------|-----------|-------|
| Node.js `crypto` | Badge hashing, PIN hashing | Built-in | Already used in adminPin.js |
| Node.js `fs` (sync) | archiveLogFn rotation | Built-in | Used in archiveLogFn synchronously |
| Node.js `events` (EventEmitter) | sessionReset post-reset event | Built-in | sessionReset.js is already a module, add EventEmitter |
| electron `safeStorage` | PAT encryption | Built-in Electron | Already proven in credentialsStore.js |
| electron `shell` | View logs folder open | Built-in Electron | Standard API |
| electron `globalShortcut` | Ctrl+Shift+F12 registration | Built-in Electron | Already used in main.js |
| electron-updater | Auto-update | NOT installed | Add to dependencies: `npm install electron-updater@^6.8.3` |
| GitHub repo (private) | Update releases feed | Requires PAT setup | Staff enters PAT on first admin menu access |

**Missing dependencies with no fallback:**
- `electron-updater` — required for ADMIN-06/07/08. Must be added to `package.json` before Phase 5 implementation.

**Missing dependencies with fallback:**
- GitHub access (no PAT configured) — auto-update silently disabled per D-19. Kiosk remains operational.

---

## Code Examples

### Verified Pattern: electron-updater Private GitHub + Runtime PAT

```javascript
// Source: electron-builder mintlify.wiki docs + BaseUpdater.ts
const { NsisUpdater } = require('electron-updater');

const options = { provider: 'github', owner: 'YOUR_ORG', repo: 'bsfpos', private: true };
const updater = new NsisUpdater(options);
updater.autoDownload = false;
updater.autoInstallOnAppQuit = false;
updater.addAuthHeader('Bearer ' + decryptedPat);

updater.on('update-available',  (info) => { /* trigger download */ updater.downloadUpdate(); });
updater.on('update-downloaded', (info) => { /* signal gate */ });
updater.on('error',             (err)  => { /* log and handle */ });

// ONLY call quitAndInstall from safe-window gate:
updater.quitAndInstall(/* isSilent= */ true, /* isForceRunAfter= */ true);
```
[VERIFIED: electron-builder docs, BaseUpdater.ts source]

### Verified Pattern: electron-log archiveLogFn Signature

```javascript
// Source: electron-log docs/transports/file.md
log.transports.file.archiveLogFn = function archiveLog(oldLogFile) {
  // oldLogFile.toString() gives the current (full) log file path
  // This fn is called synchronously — use only sync fs calls
  const filePath = oldLogFile.toString();
  // ... rename chain here ...
};
```
[VERIFIED: electron-log GitHub docs/transports/file.md]

### Verified Pattern: safeStorage Round-Trip for PAT

```javascript
// Source: credentialsStore.js (Phase 3 — already proven)
const { safeStorage } = require('electron');

// Encrypt:
const cipherBuf = safeStorage.encryptString(pat);
store.set('githubUpdatePat', cipherBuf.toString('base64'));

// Decrypt:
const cipherBase64 = store.get('githubUpdatePat');
const decrypted = safeStorage.decryptString(Buffer.from(cipherBase64, 'base64'));
```
[VERIFIED: Phase 3 credentialsStore.js — identical pattern]

### Verified Pattern: shell.openPath for View Logs

```javascript
// Source: Electron shell API (built-in)
const { shell, app } = require('electron');
// Must call app.setKiosk(false) first if in kiosk mode, or Explorer may be blocked
app.setKiosk(false);
shell.openPath(app.getPath('logs')); // Opens %AppData%/Bee Strong POS/logs/ in Explorer
// Kiosk mode is NOT re-enabled here — admin menu context means kiosk is already dropped
```

### Verified Pattern: IPC Architecture for Admin Menu

Following the established send-only main→renderer / invoke renderer→main pattern:

```javascript
// preload.js additions (Phase 5):
onShowAdminMenu:    (cb) => ipcRenderer.on('show-admin-menu',    (_e, payload) => cb(payload)),
onHideAdminMenu:    (cb) => ipcRenderer.on('hide-admin-menu',    () => cb()),
onShowUpdateConfig: (cb) => ipcRenderer.on('show-update-config', (_e, payload) => cb(payload)),
onUpdatingCover:    (cb) => ipcRenderer.on('show-updating-cover',() => cb()),
onHideUpdatingCover:(cb) => ipcRenderer.on('hide-updating-cover',() => cb()),
onLockoutState:     (cb) => ipcRenderer.on('pin-lockout-state',  (_e, payload) => cb(payload)),
verifyAdminPin:     (pin)    => ipcRenderer.invoke('verify-admin-pin', { pin }),
submitPat:          (pat)    => ipcRenderer.invoke('submit-update-pat', { pat }),
adminMenuAction:    (action) => ipcRenderer.invoke('admin-menu-action', { action }),
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `GH_TOKEN` env var on user machine | Runtime PAT via `addAuthHeader` | electron-builder v8 era | No secrets in environment variables on the kiosk; admin enters PAT once via UI |
| `archiveLog` option name | `archiveLogFn` property name | electron-log v5 (renamed from v4) | Code using old `archiveLog` option silently ignored in v5 |
| `autoUpdater.setFeedURL()` | electron-builder generates `app-update.yml` automatically | electron-builder v20+ | `setFeedURL` is now only for Squirrel; never call it with electron-builder |
| `keytar` for secrets | `safeStorage` (built-in Electron 15+) | Dec 2022 (keytar archived) | No native compilation, no external dep, DPAPI-backed |

**Deprecated / outdated:**
- `archiveLog` option (v4 name): silently ignored in v5. Use `archiveLogFn`. [VERIFIED: electron-log docs]
- `autoUpdater.setFeedURL()`: for Squirrel only. Never use with electron-builder. [VERIFIED: electron-builder docs]
- Embedding `token` in `publish` config: creates PAT-in-installer vulnerability (#2314). [CITED: github.com/electron-userland/electron-builder/issues/2314]

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `quitAndInstall(true, true)` on NSIS will exit the old process cleanly before the new instance acquires the single-instance lock | Pitfall 5 | Kiosk fails to restart after update; health watchdog catches and logs but manual recovery still needed |
| A2 | `shell.openPath(app.getPath('logs'))` works correctly when kiosk mode has been dropped via `app.setKiosk(false)` before the call | Common Pitfall — shell.openPath | Explorer might not open; staff cannot view logs; fallback is RDP file browser |
| A3 | GitHub fine-grained PAT with `contents:read` scope is sufficient for `electron-updater` GitHub API calls | Auto-Update section | If updater requires additional scopes (e.g., `releases:read`), the first `checkForUpdates` will fail with 403; error is logged and update is disabled |
| A4 | electron-log `archiveLogFn` is called synchronously and blocks the next write until complete | archiveLogFn pattern | If async, rotation may produce corrupt/partial log files; use sync fs calls only as a precaution |
| A5 | NsisUpdater direct class instantiation and `addAuthHeader` are stable public API in electron-updater v6.8.x | Standard Stack | If method is removed/renamed in a patch, runtime PAT injection breaks silently at next update check; mitigation: pin to `^6.8.3` and review release notes on update |

---

## Open Questions (RESOLVED)

1. **Fine-grained PAT scope — `contents:read` vs `releases:read`**
   - What we know: ADMIN-06 says "fine-grained PAT with only `contents:read` scope". The electron-updater GitHub provider fetches `releases/latest` via the GitHub API.
   - What was unclear: Whether `contents:read` is sufficient or if `releases:read` (a separate fine-grained scope) is needed for GitHub Releases API access.
   - **RESOLVED:** Start with `contents:read` (matches ADMIN-06 literally). The first `checkForUpdates` call after PAT setup is the real validator (per D-20); if it returns 403 the runbook instructs staff to add `metadata:read` as the next candidate. Log the GitHub error class verbatim so staff can diagnose scope issues without opening DevTools. No code change is needed for either path — the scope is a PAT-creation step, not a client config.

2. **sessionReset EventEmitter extension — callback vs EventEmitter**
   - What we know: `sessionReset.js` currently exports functions and module-scoped state. `updateGate.js` needs a `post-reset` signal after `hardReset()` completes successfully.
   - What was unclear: Whether to extend sessionReset with a Node `EventEmitter` mixin or export a callback registration function.
   - **RESOLVED:** Use callback registration — `sessionReset.onPostReset(callback)` that stores a single listener and invokes it after step 11 (mutex release) in `hardReset()`. This avoids adding EventEmitter to the module, matches the existing single-export module style, and is sufficient because only `updateGate.js` needs this signal. The hook MUST fire only on successful reset completion (not on guard/loop-active short-circuits) to preserve the Phase 4 D-15 contract.

---

## Project Constraints (from CLAUDE.md)

These directives apply to Phase 5 with the same authority as locked decisions:

| Directive | Phase 5 Impact |
|-----------|---------------|
| `electron ^41.1.1` pinned | Use Electron's built-in APIs only — no polyfills |
| `electron-log ^5.2.x` | Use 5.2.x API surface; `archiveLogFn` (not `archiveLog`) |
| `electron-store ^10.1.x` CJS | All new store keys use the existing CJS store instance |
| `electron-updater ^6.8.3` | New dep; add to `dependencies` (not devDependencies) |
| `safeStorage` only for secrets | PAT must use safeStorage; never plaintext |
| No keytar, no node-hid, no Sentry | Already satisfied — Phase 5 adds no disallowed deps |
| `main.js` is CommonJS | All new modules use `require()`/`module.exports`, no ESM |
| Plain HTML/CSS/JS for overlays | No React, no Svelte for admin menu, updating cover, PAT config |
| No bundler | Serve new HTML/JS files from disk as-is |
| German-only UI copy | All new user-facing text must be in German |
| Code-signed Windows installer is explicitly OUT OF SCOPE for v1 | Per REQUIREMENTS.md "Out of Scope" table: SmartScreen one-click is acceptable for v1. Do not add codesign step to electron-builder config. |

---

## Sources

### Primary (HIGH confidence)
- `src/main/keyboardLockdown.js` — reservedShortcuts Set, canonical() function, SUPPRESS_LIST: existing code read directly
- `src/main/main.js` — verify-pin channel + resetLoopPending intercept: existing code read directly  
- `src/main/adminPin.js` — scrypt parameters, verifyPin API: existing code read directly
- `src/main/sessionReset.js` — hardReset flow, post-reset hook point: existing code read directly
- `src/main/logger.js` — current electron-log init, transport config: existing code read directly
- `src/host/host.html` — layer ladder, existing div IDs: existing code read directly
- `package.json` — installed deps, versions, build config: existing code read directly
- electron-log GitHub docs/transports/file.md — archiveLogFn signature, maxSize, rotation semantics [VERIFIED via WebFetch]
- electron-builder mintlify.wiki auto-update setup — autoDownload, autoInstallOnAppQuit, addAuthHeader, quitAndInstall params [VERIFIED via WebFetch]
- `npm view electron-updater version` → 6.8.3 [VERIFIED via Bash]
- `npm view electron-log` v5 list → 5.4.3 latest; ~5.2.0 pin in package.json [VERIFIED via Bash]

### Secondary (MEDIUM confidence)
- electron-builder BaseUpdater.ts source — quitAndInstall(isSilent, isForceRunAfter) signature [VERIFIED via WebFetch of GitHub source]
- Electron autoUpdater API docs — quitAndInstall behavior, before-quit-for-update event [VERIFIED via WebFetch electronjs.org]

### Tertiary (LOW confidence / ASSUMED)
- NSIS single-instance + quitAndInstall restart interaction (A1) — standard community knowledge, not explicitly in official docs
- `contents:read` PAT scope sufficiency for GitHub Releases API (A3) — needs validation at first checkForUpdates call

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all packages verified against npm/package.json; one new dep (electron-updater) confirmed at 6.8.3
- Admin hotkey architecture: HIGH — keyboardLockdown.js source read and analyzed; reservedShortcuts hook confirmed
- PIN lockout module: HIGH — adminPin.js contract verified; lockout wrapper pattern is straightforward
- electron-updater private repo + runtime PAT: HIGH — addAuthHeader pattern verified from BaseUpdater.ts and mintlify docs; #2314 anti-pattern confirmed
- electron-log 5-file rotation: MEDIUM-HIGH — archiveLogFn exists and signature confirmed; the custom rotation loop must be written by the planner (no library function for N-file keeping)
- Safe-window gating: HIGH — updateGate.js pattern derived from CONTEXT.md D-15/D-16 + sessionReset.js code review
- Post-update health watchdog: HIGH — CONTEXT.md D-29/D-30 is specific; setTimeout/store pattern is straightforward
- shell.openPath kiosk-mode interaction (A2): LOW — needs on-device verification

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (electron-updater/electron-log APIs are stable; Electron 41 is current supported line)
