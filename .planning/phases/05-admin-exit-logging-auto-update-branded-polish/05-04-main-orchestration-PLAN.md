---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 04
type: execute
wave: 2
depends_on: ["05-01-logger-deps-PLAN", "05-02-admin-pin-lockout-PLAN", "05-03-update-gate-session-hook-PLAN"]
files_modified:
  - src/main/autoUpdater.js
  - src/main/keyboardLockdown.js
  - src/main/main.js
  - src/main/preload.js
autonomous: true
requirements: [ADMIN-01, ADMIN-02, ADMIN-06, ADMIN-07, ADMIN-08]
tags: [main-process, orchestration, ipc, hotkey, electron-updater, health-watchdog]
must_haves:
  truths:
    - "'Ctrl+Shift+F12' appears in the reservedShortcuts Set exported by keyboardLockdown.js"
    - "Pressing Ctrl+Shift+F12 in the running kiosk (before-input-event handler) calls the admin PIN modal opener via IPC 'show-pin-modal' with context:'admin'"
    - "ipcMain.handle('verify-admin-pin') is registered and delegates to adminPinLockout.verifyPinWithLockout (NOT the legacy verify-pin channel)"
    - "On admin PIN success, main sends 'show-admin-menu' IPC with a diagnostic payload {version, lastUpdateCheck, authState, lastResetAt, updateStatus}"
    - "ipcMain.handle('admin-menu-action') routes actions: check-updates, view-logs, reload, re-enter-credentials, configure-auto-update, exit-to-windows"
    - "submit-update-pat IPC handler encrypts the PAT via safeStorage and stores it under 'githubUpdatePat' key"
    - "autoUpdater.js exposes initUpdater, checkForUpdates, downloadUpdate, installUpdate — constructed via `new NsisUpdater(opts)` with autoDownload=false and autoInstallOnAppQuit=false"
    - "On boot, if pendingUpdate flag is set in store, a 2-minute watchdog starts; authFlow reaching CASH_REGISTER_READY clears it; expiration sets autoUpdateDisabled and shows 'bad-release' error variant"
    - "All update events emit log.audit with canonical taxonomy names (update.check, update.downloaded, update.install, update.failed)"
    - "Admin PIN attempts during reset-loop recovery still flow through the EXISTING verify-pin channel (resetLoopPending intercept preserved)"
  artifacts:
    - path: "src/main/autoUpdater.js"
      provides: "NsisUpdater wrapper with PAT injection, autoDownload=false, health watchdog hooks"
      exports: ["initUpdater", "checkForUpdates", "downloadUpdate", "installUpdate", "isEnabled"]
    - path: "src/main/keyboardLockdown.js"
      provides: "reservedShortcuts with Ctrl+Shift+F12 registered at module load"
      contains: "reservedShortcuts.add('Ctrl+Shift+F12')"
    - path: "src/main/main.js"
      provides: "Phase 5 orchestration: hotkey wiring, admin IPC handlers, update gate, health watchdog"
      contains: "verify-admin-pin"
    - path: "src/main/preload.js"
      provides: "Phase 5 IPC surface additions for admin menu, update-config, updating cover"
      contains: "verifyAdminPin"
  key_links:
    - from: "src/main/main.js"
      to: "src/main/adminPinLockout.js"
      via: "verifyPinWithLockout invoked in verify-admin-pin handler"
      pattern: "verifyPinWithLockout"
    - from: "src/main/main.js"
      to: "src/main/autoUpdater.js"
      via: "initUpdater called in whenReady if PAT configured"
      pattern: "initUpdater"
    - from: "src/main/main.js"
      to: "src/main/updateGate.js"
      via: "onUpdateDownloaded armed in update-downloaded handler"
      pattern: "updateGate\\.onUpdateDownloaded"
    - from: "src/main/main.js"
      to: "src/main/authFlow.js"
      via: "clearHealthWatchdog called from authFlow CASH_REGISTER_READY transition"
      pattern: "clearHealthWatchdog"
    - from: "src/main/main.js"
      to: "src/main/sessionReset.js"
      via: "passed to updateGate.onUpdateDownloaded as sessionResetModule"
      pattern: "sessionResetModule"
---

<objective>
Wire all Phase 5 main-process behavior: (a) `src/main/autoUpdater.js` — a dedicated `NsisUpdater` wrapper with runtime PAT injection, autoDownload=false, autoInstallOnAppQuit=false, log.audit event wiring; (b) register `Ctrl+Shift+F12` in `keyboardLockdown.js` reservedShortcuts; (c) extend `main.js` with the hotkey handler (globalShortcut + before-input-event on BOTH host and Magicline webContents per RESEARCH Gotcha 5), the admin IPC channels (`verify-admin-pin`, `admin-menu-action`, `submit-update-pat`), the post-update health watchdog, and the updateGate wiring against sessionReset + autoUpdater; (d) extend `preload.js` with the Phase 5 IPC surface.

Purpose: Close ADMIN-01, ADMIN-02, ADMIN-06, ADMIN-07, ADMIN-08. Complete the main-process half of Phase 5 so Plan 05 (host UI) has a stable IPC surface to render against.

Output: 1 new module (`autoUpdater.js`), 3 modified modules (`keyboardLockdown.js` small, `main.js` substantial, `preload.js` additive).

CRITICAL NON-REGRESSIONS:
- Phase 3 `resetLoopPending` intercept in the `verify-pin` handler (lines 213-239 of current main.js) MUST NOT be touched. Admin PIN flows through a NEW `verify-admin-pin` channel per RESEARCH Pitfall 6.
- Phase 4 `idle-dismissed`/`idle-expired`/`request-reset-loop-recovery` handlers MUST still work.
- `createMainWindow` function MUST remain structurally intact (Phase 1 ORCHESTRATION marker contract).
- `attachLockdown` MUST be called AFTER `reservedShortcuts.add('Ctrl+Shift+F12')` — the set is read at event time, but per RESEARCH Gotcha 5 the add happens before attachLockdown for ordering clarity.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md
@src/main/main.js
@src/main/keyboardLockdown.js
@src/main/preload.js
@src/main/adminPin.js
@src/main/credentialsStore.js
@src/main/authFlow.js
@src/main/sessionReset.js
</context>

<interfaces>
Phase 5 IPC surface — full catalogue this plan implements:

Main → Renderer (send):
- `show-pin-modal` payload `{ context: 'admin' | 'reset-loop' }` (context extended in Phase 5)
- `show-admin-menu` payload `{ version, lastUpdateCheck, authState, lastResetAt, updateStatus, patConfigured }`
- `hide-admin-menu` (no payload)
- `show-update-config` payload `{ hasExistingPat: boolean }`
- `hide-update-config`
- `show-updating-cover`
- `hide-updating-cover`
- `show-admin-update-result` payload `{ status: 'available' | 'none' | 'error', message?: string }`
- `show-pin-lockout` payload `{ lockedUntil: string /* ISO */ }`
- `hide-pin-lockout`
- `show-magicline-error` variants extended: `'bad-release' | 'update-failed'` (Phase 3 existing channel)

Renderer → Main (invoke):
- `verify-admin-pin` payload `{ pin }` → `{ ok, locked, lockedUntil }`
- `admin-menu-action` payload `{ action: 'check-updates' | 'view-logs' | 'reload' | 're-enter-credentials' | 'configure-auto-update' | 'exit-to-windows' }` → `{ ok, [result] }`
- `submit-update-pat` payload `{ pat }` → `{ ok, error? }`
- `close-admin-menu` (no payload) → `{ ok }` — for PAT config "Abbrechen" returning to admin menu
- `get-admin-diagnostics` → `{ version, lastUpdateCheck, authState, lastResetAt, updateStatus, patConfigured }`

Existing preserved (Phase 3/4):
- `verify-pin` (ONLY for reset-loop recovery via resetLoopPending intercept)
- `submit-credentials`, `request-pin-recovery`, `launch-touch-keyboard`
- `idle-dismissed`, `idle-expired`, `request-reset-loop-recovery`

sessionReset surface addition (needed in main.js wiring):
- `sessionReset.onPostReset(cb)` is already available after Plan 05-03
- Need a `sessionReset.getLastResetAt()` accessor: **add this micro-export** in this plan since Plan 03 didn't ship it — OR use `_getStateForTests()` (not appropriate for prod). Add a proper accessor.

authFlow surface needs (existing as of Phase 3):
- `authFlow.getState(): string` — Phase 3 Plan 3-04 exported this; verify via `grep`

health watchdog:
- `let healthWatchdogTimer = null;` module-scoped in main.js
- `clearHealthWatchdog(store, log)` function; called from authFlow's CASH_REGISTER_READY transition via an injected callback during `authFlow.start({...})`
- **authFlow.start accepts `onCashRegisterReady` callback?** — Phase 3 Plan 3-07 may not have exposed one. If absent, Phase 5 must hook via a different mechanism: listen to `authFlow`'s existing state-log IPC/observer. The simplest viable path: after `authFlow.start(...)`, register a polling check that reads `authFlow.getState()` every 2s until it equals `'CASH_REGISTER_READY'` OR the 2-minute watchdog expires. This avoids modifying authFlow.js at all.
</interfaces>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Ctrl+Shift+F12 keystroke → globalShortcut / before-input-event | Member (untrusted) could mash keys; hotkey leads only to PIN gate |
| renderer (host.html) → main IPC verify-admin-pin | Untrusted PIN input |
| renderer → main IPC submit-update-pat | Admin-entered PAT crosses renderer boundary once |
| electron-updater (HTTPS GitHub) → main | Remote code via signed NSIS installer |
| main process → disk (%AppData%) | PAT ciphertext, pendingUpdate flag, autoUpdateDisabled flag |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-18 | E (Elevation) | Admin PIN flows through the wrong IPC channel and hits resetLoopPending intercept → app.relaunch instead of admin menu | mitigate | NEW channel `verify-admin-pin` registered separately; existing `verify-pin` unchanged. Task 3 grep assertion confirms both handlers exist with correct targets |
| T-05-19 | E (Elevation) | Kiosk escape via admin menu "Exit to Windows" without PIN gate | mitigate | admin-menu-action handler rejects requests unless an internal `adminMenuOpen` flag is set, which is only set after verify-admin-pin returns ok:true |
| T-05-20 | I (Info disclosure) | PAT logged in plaintext on save | mitigate | log.audit('update.pat.configured',{pat:'...'}) — pat field hits CIPHER_FIELDS redactor → [cipher:N]. Grep asserts no `log.info.*pat` without audit |
| T-05-21 | T (Tampering) | PAT embedded in installer (#2314) | mitigate | NsisUpdater constructed WITHOUT any publish.token; PAT injected via `addAuthHeader` at runtime only. Grep asserts package.json.build.publish.token is absent |
| T-05-22 | S (Spoofing) | Fake NSIS payload from attacker-controlled GitHub redirect | mitigate | electron-updater verifies sha512 of downloaded file against latest.yml; standard electron-builder behavior, not overridden |
| T-05-23 | D (DoS) | checkForUpdates called every minute, hammering GitHub API | mitigate | setInterval(6 * 60 * 60_000) per CONTEXT.md D-14 — once per 6 hours + once on boot |
| T-05-24 | T (Tampering) | Bad release bricks kiosk | mitigate | Health watchdog: pendingUpdate flag + 2-min timeout; expiry → autoUpdateDisabled + bad-release variant. Never auto-rollback (D-30 manual runbook) |
| T-05-25 | E (Elevation) | globalShortcut Ctrl+Shift+F12 not registered before lockdown; chord reaches DevTools in prod | mitigate | Registration BEFORE attachLockdown per RESEARCH Gotcha 5; grep asserts order in main.js |
| T-05-26 | R (Repudiation) | No audit trail for admin menu actions | mitigate | log.audit('admin.open', {}) on verify-admin-pin success; log.audit('admin.exit',{action}) on each admin-menu-action |
| T-05-27 | E (Elevation) | shell.openPath(logs) fails in kiosk mode | mitigate | Drop kiosk mode via `app.setKiosk(false)` before shell.openPath per RESEARCH Gotcha 7 (admin menu context already drops kiosk conceptually) |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Create autoUpdater.js wrapper around NsisUpdater</name>
  <read_first>
    - src/main/credentialsStore.js (safeStorage encrypt/decrypt pattern for reference)
    - src/main/logger.js (post Plan 01 — for log.audit)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Pattern 1 §Pitfall 1 §Pitfall 2 §Gotcha 2 §Gotcha 3 §Gotcha 9
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md §D-14 §D-18 §D-19 §D-29 §D-30
    - package.json (confirm electron-updater present from Plan 01)
  </read_first>
  <behavior>
    - Module imports `NsisUpdater` from 'electron-updater' at top (require; CommonJS)
    - `initUpdater({ owner, repo, pat, log, store, onUpdateDownloaded, onUpdateFailed })` constructs `new NsisUpdater({provider:'github', owner, repo, private:true})`, sets `autoDownload=false`, `autoInstallOnAppQuit=false`, `logger=log`, calls `updater.addAuthHeader('Bearer ' + pat)`, registers event handlers that emit log.audit and delegate to onUpdateDownloaded/onUpdateFailed, stores updater instance in module scope
    - `checkForUpdates()` returns a promise; on reject or thrown error, logs `log.audit('update.check', {result:'error', reason: err.message})` and swallows the error
    - On `update-available`: log.audit('update.check', {result:'available', version: info.version}) and `updater.downloadUpdate()`
    - On `update-not-available`: log.audit('update.check', {result:'none'})
    - On `update-downloaded`: log.audit('update.downloaded', {version: info.version}); before calling onUpdateDownloaded, write `store.set('pendingUpdate', {pendingVersion: info.version, installedAt: new Date().toISOString()})`; then call onUpdateDownloaded(info) so main.js can arm updateGate
    - On `error` event: log.audit('update.failed', {reason: err.message, phase: 'runtime'}) and call onUpdateFailed(err)
    - `installUpdate()` calls `updater.quitAndInstall(true, true)` (isSilent=true, isForceRunAfter=true per RESEARCH Pattern 1)
    - `isEnabled()` returns `updater !== null`
    - Do NOT call any updater method if `app.isPackaged === false` (Gotcha 2); export a `_devModeNoop` guard that initUpdater checks via a `isPackaged` arg or by calling `require('electron').app.isPackaged`
  </behavior>
  <action>
    Create `src/main/autoUpdater.js`:

    ```javascript
    // src/main/autoUpdater.js
    // Phase 5 ADMIN-06, ADMIN-07, ADMIN-08.
    //
    // Wraps electron-updater's NsisUpdater class directly (NOT the autoUpdater
    // singleton) so we can inject the GitHub PAT at runtime via addAuthHeader
    // without embedding it in the installer (RESEARCH Pitfall 1, #2314).
    //
    // All public entry points are dev-safe: calls are no-ops when
    // app.isPackaged === false (Gotcha 2).
    //
    // Download gating: autoDownload=false + autoInstallOnAppQuit=false.
    // Install only via installUpdate() called from updateGate.js safe-window
    // trigger.

    const { NsisUpdater } = require('electron-updater');
    const log = require('./logger');

    let updater = null;
    let enabled = false;
    let lastCheckAt = null;

    /**
     * Construct the updater with a decrypted PAT. Idempotent: calling twice
     * replaces the prior instance (detaches listeners on the old one).
     *
     * @param {object} opts
     * @param {string} opts.owner - GitHub owner/org (from env or hard-coded)
     * @param {string} opts.repo  - GitHub repo name
     * @param {string} opts.pat   - Fine-grained PAT (contents:read)
     * @param {object} opts.store - electron-store for pendingUpdate persistence
     * @param {boolean} opts.isPackaged - typically require('electron').app.isPackaged
     * @param {(info) => void} opts.onUpdateDownloaded - main.js arms updateGate here
     * @param {(err) => void}  opts.onUpdateFailed - main.js shows update-failed variant
     * @returns {boolean} true if updater was constructed, false in dev / missing args
     */
    function initUpdater(opts) {
      if (!opts) return false;
      if (!opts.isPackaged) {
        log.info('autoUpdater.skipped: dev mode (app.isPackaged=false)');
        enabled = false;
        return false;
      }
      if (!opts.pat || typeof opts.pat !== 'string' || opts.pat.length === 0) {
        log.info('autoUpdater.skipped: no PAT configured');
        enabled = false;
        return false;
      }
      if (!opts.owner || !opts.repo) {
        log.warn('autoUpdater.skipped: owner/repo missing');
        enabled = false;
        return false;
      }

      // Tear down any prior instance
      if (updater) {
        try { updater.removeAllListeners(); } catch (_) {}
        updater = null;
      }

      updater = new NsisUpdater({
        provider: 'github',
        owner: opts.owner,
        repo: opts.repo,
        private: true,
      });

      // CRITICAL: gate all installs behind safe-window manually
      updater.autoDownload = false;
      updater.autoInstallOnAppQuit = false;
      updater.logger = log;
      updater.addAuthHeader('Bearer ' + opts.pat);

      updater.on('checking-for-update', () => {
        lastCheckAt = new Date().toISOString();
        log.audit('update.check', { result: 'started' });
      });

      updater.on('update-available', (info) => {
        log.audit('update.check', { result: 'available', version: (info && info.version) || 'unknown' });
        // Kick off download explicitly since autoDownload=false
        updater.downloadUpdate().catch((err) => {
          log.audit('update.failed', { reason: String(err && err.message), phase: 'download' });
          if (typeof opts.onUpdateFailed === 'function') opts.onUpdateFailed(err);
        });
      });

      updater.on('update-not-available', () => {
        log.audit('update.check', { result: 'none' });
      });

      updater.on('update-downloaded', (info) => {
        const version = (info && info.version) || 'unknown';
        log.audit('update.downloaded', { version: version });
        // D-29: persist pendingUpdate BEFORE handing control to updateGate
        try {
          opts.store.set('pendingUpdate', {
            pendingVersion: version,
            installedAt: new Date().toISOString(),
          });
        } catch (e) {
          log.error('autoUpdater.pendingUpdate-persist-failed: ' + (e && e.message));
        }
        if (typeof opts.onUpdateDownloaded === 'function') {
          opts.onUpdateDownloaded(info);
        }
      });

      updater.on('error', (err) => {
        log.audit('update.failed', { reason: String(err && err.message), phase: 'runtime' });
        if (typeof opts.onUpdateFailed === 'function') opts.onUpdateFailed(err);
      });

      enabled = true;
      log.info('autoUpdater.initialized: owner=' + opts.owner + ' repo=' + opts.repo);
      return true;
    }

    function isEnabled() {
      return enabled;
    }

    function getLastCheckAt() {
      return lastCheckAt;
    }

    /**
     * Trigger a check. Returns a promise that RESOLVES (not rejects) even on
     * failure — errors are logged and swallowed. Result can be:
     *   'available' | 'none' | 'error' | 'disabled'
     */
    async function checkForUpdates() {
      if (!enabled || !updater) return { result: 'disabled' };
      try {
        const res = await updater.checkForUpdates();
        // electron-updater returns { updateInfo, cancellationToken, versionInfo }
        // The update-available / update-not-available events do the real work.
        // This return is for the admin menu "Updates prüfen" synchronous feedback.
        if (res && res.updateInfo && res.updateInfo.version) {
          return { result: 'available', version: res.updateInfo.version };
        }
        return { result: 'none' };
      } catch (err) {
        log.audit('update.failed', { reason: String(err && err.message), phase: 'check' });
        return { result: 'error', error: String(err && err.message) };
      }
    }

    /**
     * Called by updateGate.js when the safe window is open.
     * Invokes updater.quitAndInstall(isSilent=true, isForceRunAfter=true).
     */
    function installUpdate() {
      if (!enabled || !updater) {
        log.warn('autoUpdater.installUpdate: called while disabled — no-op');
        return;
      }
      log.audit('update.install', { phase: 'quitAndInstall' });
      try {
        updater.quitAndInstall(true, true);
      } catch (err) {
        log.audit('update.failed', { reason: String(err && err.message), phase: 'quitAndInstall' });
      }
    }

    function _resetForTests() {
      if (updater) {
        try { updater.removeAllListeners(); } catch (_) {}
      }
      updater = null;
      enabled = false;
      lastCheckAt = null;
    }

    module.exports = {
      initUpdater,
      checkForUpdates,
      installUpdate,
      isEnabled,
      getLastCheckAt,
      _resetForTests,
    };
    ```

    NOTE: The implementer must verify `NsisUpdater` is the correct export name at electron-updater 6.8.3. If it's `require('electron-updater').NsisUpdater` returns undefined, try `require('electron-updater/out/NsisUpdater').NsisUpdater` as a fallback; confirm via `node -e "console.log(Object.keys(require('electron-updater')))"`. Task 1 acceptance includes a runtime node check that `NsisUpdater` is a function.
  </action>
  <verify>
    <automated>node --check src/main/autoUpdater.js && node -e "const u=require('./src/main/autoUpdater');if(typeof u.initUpdater!=='function')process.exit(1);if(typeof u.installUpdate!=='function')process.exit(2);if(typeof u.checkForUpdates!=='function')process.exit(3);if(typeof u.isEnabled!=='function')process.exit(4);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - `node --check src/main/autoUpdater.js` exits 0
    - `grep -n "require('electron-updater')" src/main/autoUpdater.js` matches
    - `grep -n "NsisUpdater" src/main/autoUpdater.js` matches at least twice
    - `grep -n "autoDownload = false" src/main/autoUpdater.js` matches
    - `grep -n "autoInstallOnAppQuit = false" src/main/autoUpdater.js` matches
    - `grep -n "addAuthHeader" src/main/autoUpdater.js` matches
    - `grep -n "quitAndInstall(true, true)" src/main/autoUpdater.js` matches
    - `grep -n "pendingUpdate" src/main/autoUpdater.js` matches
    - `grep -nE "log\.audit\('update\.(check|downloaded|install|failed)'" src/main/autoUpdater.js` matches at least 5 times
    - `node -e "const u=require('./src/main/autoUpdater');const r=u.initUpdater({isPackaged:false});if(r!==false)process.exit(1);console.log('ok');"` exits 0 (dev-mode no-op behaves correctly)
  </acceptance_criteria>
  <done>autoUpdater.js constructed with safe defaults, PAT injection path, and dev-mode no-op.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add Ctrl+Shift+F12 to keyboardLockdown reservedShortcuts</name>
  <read_first>
    - src/main/keyboardLockdown.js (entire file — understand reservedShortcuts Set creation)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Ctrl+Shift+F12 Hotkey — Detailed Analysis §Gotcha 5
  </read_first>
  <behavior>
    - The `reservedShortcuts` Set is pre-populated with `'Ctrl+Shift+F12'` at module load
    - Pre-existing `attachLockdown`, `canonical`, `SUPPRESS_LIST` behavior unchanged
    - `F12` (bare) still in SUPPRESS_LIST — DevTools must not open in prod
    - `grep -c "reservedShortcuts" src/main/keyboardLockdown.js` unchanged (just the existing three references + one add)
  </behavior>
  <action>
    Edit `src/main/keyboardLockdown.js`. On the line immediately AFTER `const reservedShortcuts = new Set();` (currently line 24), insert:

    ```javascript

    // Phase 5 D-08: register the admin hotkey. main.js installs a handler on
    // before-input-event that opens the admin PIN modal when canonical() ===
    // 'Ctrl+Shift+F12'. Adding to the Set here (at module load) guarantees the
    // set is populated before attachLockdown runs (RESEARCH Gotcha 5).
    reservedShortcuts.add('Ctrl+Shift+F12');
    ```

    Do NOT change any other line. Do NOT add this to SUPPRESS_LIST (it must pass through, not be suppressed).
  </action>
  <verify>
    <automated>node --check src/main/keyboardLockdown.js && node -e "const m=require('./src/main/keyboardLockdown');if(!m.reservedShortcuts.has('Ctrl+Shift+F12'))process.exit(1);if(!m.SUPPRESS_LIST.has('F12'))process.exit(2);if(typeof m.attachLockdown!=='function')process.exit(3);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "reservedShortcuts.add('Ctrl+Shift+F12')" src/main/keyboardLockdown.js` matches exactly once
    - `node -e "require('./src/main/keyboardLockdown').reservedShortcuts.has('Ctrl+Shift+F12')"` returns true (exit 0)
    - Bare `'F12'` still present in SUPPRESS_LIST (`grep -n "'F12'" src/main/keyboardLockdown.js` matches)
    - `node --check src/main/keyboardLockdown.js` exits 0
    - `git diff src/main/keyboardLockdown.js` shows ≤ 8 added lines, 0 deleted lines
  </acceptance_criteria>
  <done>Ctrl+Shift+F12 registered in reservedShortcuts at module load; no other keyboardLockdown changes.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Extend main.js with Phase 5 orchestration (hotkey, IPC handlers, updater, health watchdog)</name>
  <read_first>
    - src/main/main.js (ENTIRE file — particularly ORCHESTRATION block lines 76+ and existing IPC handlers 204-308)
    - src/main/authFlow.js (confirm `getState()` export exists and returns a string; identify CASH_REGISTER_READY state constant)
    - src/main/adminPin.js (confirm `hasPin` exists — used to detect first-run)
    - src/main/adminPinLockout.js (Plan 02 — verifyPinWithLockout signature)
    - src/main/updateGate.js (Plan 03 — onUpdateDownloaded signature)
    - src/main/sessionReset.js (Plan 03 — onPostReset signature)
    - src/main/autoUpdater.js (Task 1 — initUpdater, checkForUpdates, installUpdate)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Pattern 6 §Pattern 7 §Gotcha 1 §Pitfall 5
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md §D-01 §D-04 §D-06 §D-07 §D-08 §D-14 §D-17 §D-18 §D-19 §D-29
  </read_first>
  <behavior>
    - After `attachLockdown(mainWindow.webContents)` call (line 145), register `globalShortcut.register('Ctrl+Shift+F12', openAdminPinModal)` in prod only
    - The `before-input-event` hotkey handler attached to host webContents AND (inside createMagiclineView branch) to magiclineView.webContents, both calling openAdminPinModal when canonical === 'Ctrl+Shift+F12'
    - `openAdminPinModal` is a local function that sends `show-pin-modal` IPC with `{ context: 'admin' }`
    - `adminMenuOpen` module-scoped flag, true iff admin PIN verified; reset on admin-menu-action 'exit-to-windows' / 'reload' / 'close-admin-menu'
    - NEW `ipcMain.handle('verify-admin-pin')` handler: calls `adminPinLockout.verifyPinWithLockout(store, pin)`. On `ok:true` → set `adminMenuOpen=true`, log.audit('admin.open',{}), send `hide-pin-modal`, build diagnostics payload, send `show-admin-menu`. On `locked:true` → send `show-pin-lockout` with lockedUntil. Return result to renderer. **Handler MUST check `context` — reset-loop path must still flow through `verify-pin` channel (NOT this one).**
    - NEW `ipcMain.handle('get-admin-diagnostics')` returns `{ version: app.getVersion(), lastUpdateCheck: autoUpdater.getLastCheckAt(), authState: authFlow.getState(), lastResetAt: sessionReset.getLastResetAt() || null, updateStatus: ..., patConfigured: store.has('githubUpdatePat') }`
    - NEW `ipcMain.handle('admin-menu-action')` dispatches:
      - `check-updates`: call `autoUpdater.checkForUpdates()`; return result; send `show-admin-update-result` with status
      - `view-logs`: `app.setKiosk(false)`, `shell.openPath(app.getPath('logs'))`, log.audit('admin.exit',{action:'view-logs'})
      - `reload`: `mainWindow.webContents.reload()`; reset `adminMenuOpen=false`; log.audit('admin.exit',{action:'reload'})
      - `re-enter-credentials`: send `hide-admin-menu`; send `show-credentials-overlay` with `{firstRun:false}`; log.audit('admin.exit',{action:'re-enter-credentials'})
      - `configure-auto-update`: send `hide-admin-menu`; send `show-update-config` with `{hasExistingPat: store.has('githubUpdatePat')}`
      - `exit-to-windows`: log.audit('admin.exit',{action:'exit'}), `globalShortcut.unregisterAll()`, `app.setKiosk(false)`, `app.quit()`
      - Reject any action if `adminMenuOpen === false`
    - NEW `ipcMain.handle('submit-update-pat')`: validate non-empty + no whitespace. Encrypt via `safeStorage.encryptString(pat).toString('base64')`, `store.set('githubUpdatePat', cipherB64)`. log.audit('update.pat.configured', {pat}) — pat is redacted by logger. Attempt initUpdater immediately; on success send `hide-update-config` + `show-admin-menu` (with refreshed diagnostics). On failure log error and return ok:false.
    - NEW `ipcMain.handle('close-admin-menu')` sets `adminMenuOpen=false`, sends `hide-admin-menu`. Used by admin menu close paths.
    - **Boot-time updater init**: after `authFlow.start` wiring, attempt to decrypt `githubUpdatePat` and call `autoUpdater.initUpdater({owner, repo, pat, store, isPackaged: app.isPackaged, onUpdateDownloaded: armUpdateGate, onUpdateFailed: showUpdateFailedVariant})`. `owner` and `repo` constants live at top of main.js (`const GITHUB_OWNER = 'TODO-set-via-env'; const GITHUB_REPO = 'bsfpos';`) — mark with TODO comment so runbook can set them. If PAT missing → skip silently (D-19).
    - **Boot-time update check**: if `autoUpdater.isEnabled()`, call `autoUpdater.checkForUpdates()` once after `authFlow.start`, then `setInterval(() => autoUpdater.checkForUpdates(), 6 * 60 * 60_000)` (D-14)
    - **Health watchdog**: at top of `app.whenReady`, read `store.get('pendingUpdate')`. If truthy, start a `setTimeout(WATCHDOG_MS)` that calls `markBadRelease()` on expiry (sets `autoUpdateDisabled=true`, deletes `pendingUpdate`, log.audit('update.failed',{reason:'watchdog-expired', version: pendingUpdate.pendingVersion}), sends `show-magicline-error` with `variant:'bad-release'`). Expose a `clearHealthWatchdog` local function. Poll authFlow.getState() every 2s until CASH_REGISTER_READY → clear the watchdog and log.audit('update.install',{version, result:'ok'}), delete pendingUpdate.
    - **armUpdateGate(info)**: calls `updateGate.onUpdateDownloaded({installFn: () => { mainWindow.webContents.send('show-updating-cover'); autoUpdater.installUpdate(); }, log, sessionResetModule: sessionReset})`
    - **showUpdateFailedVariant(err)**: `mainWindow.webContents.send('show-magicline-error', {variant:'update-failed'})` — D-32 auto-dismiss handled by host.js
    - **`disabled` check**: if `store.get('autoUpdateDisabled') === true`, skip initUpdater entirely — log.audit('update.check',{result:'disabled'}) once on boot
    - Existing Phase 3 `verify-pin` handler + resetLoopPending intercept: UNTOUCHED
  </behavior>
  <action>
    Edit `src/main/main.js`. The changes are localized to:
    1. New imports at top (after existing imports ~line 16)
    2. New constants + module-scope state after imports (~line 24)
    3. New helper functions BEFORE `createMainWindow` (around line 28)
    4. New logic inside `app.whenReady().then(...)` AFTER existing `attachLockdown(mainWindow.webContents)` line
    5. New `ipcMain.handle(...)` blocks AFTER existing Phase 3/4 IPC handlers (~line 308)

    **Do NOT modify** createMainWindow (lines 28-74), existing `verify-pin` handler (lines 213-239), existing Phase 4 `idle-*` / `request-reset-loop-recovery` handlers, or the `will-quit`/`window-all-closed` tail.

    Step-by-step edits:

    **Edit A — imports (after line 16 `const adminPin = require('./adminPin');`):**
    ```javascript
    const { shell } = require('electron');
    const adminPinLockout = require('./adminPinLockout');
    const autoUpdater    = require('./autoUpdater');
    const updateGate     = require('./updateGate');
    const sessionResetMod = require('./sessionReset');
    ```
    (Note: the `shell` is a separate import because the current line 8 destructure does not include it. Append to the `electron` import instead: change line 8 from `const { app, BrowserWindow, Menu, globalShortcut, ipcMain, safeStorage } = require('electron');` to add `shell` inside the destructure. Do this rather than a second require.)

    **Edit B — constants + state (after `let resetLoopPending = false;` around line 24):**
    ```javascript
    // --- Phase 5 constants ------------------------------------------------
    // TODO(runbook): set GITHUB_OWNER via build-time env var or here before first prod build.
    const GITHUB_OWNER = process.env.BSFPOS_GH_OWNER || 'TODO-set-owner';
    const GITHUB_REPO  = process.env.BSFPOS_GH_REPO  || 'bsfpos';
    const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000; // D-14: every 6 hours
    const HEALTH_WATCHDOG_MS       = 2 * 60 * 1000;      // D-29: 2-minute post-update watchdog
    const AUTH_POLL_MS             = 2000;               // poll authFlow.getState every 2s

    // --- Phase 5 module-scope state ---------------------------------------
    let adminMenuOpen       = false;
    let healthWatchdogTimer = null;
    let authPollTimer       = null;
    let updateCheckInterval = null;
    ```

    **Edit C — helper functions (place just ABOVE `function createMainWindow()` around line 33):**
    ```javascript
    // --- Phase 5 helpers --------------------------------------------------

    /**
     * Send the PIN modal show IPC with `context:'admin'` so host.js knows this
     * is an admin PIN attempt (NOT a reset-loop recovery).
     */
    function openAdminPinModal() {
      if (!mainWindow) return;
      log.info('adminHotkey: Ctrl+Shift+F12 pressed — surfacing admin PIN modal');
      try {
        mainWindow.webContents.send('show-pin-modal', { context: 'admin' });
      } catch (e) {
        log.error('adminHotkey.send failed: ' + (e && e.message));
      }
    }

    /**
     * Tries to decrypt the stored GitHub PAT and initialise the auto-updater.
     * No-ops in dev (app.isPackaged=false), when PAT is absent (D-19), or when
     * autoUpdateDisabled has been latched by a bad-release health check (D-30).
     */
    function tryInitAutoUpdater(store) {
      if (store.get('autoUpdateDisabled') === true) {
        log.audit('update.check', { result: 'disabled' });
        return false;
      }
      const cipherB64 = store.get('githubUpdatePat');
      if (!cipherB64) {
        log.info('autoUpdater: no PAT stored (D-19) — auto-update silently disabled');
        return false;
      }
      let pat = null;
      try {
        pat = safeStorage.decryptString(Buffer.from(cipherB64, 'base64'));
      } catch (e) {
        log.audit('update.failed', { reason: 'pat-decrypt-failed', phase: 'init' });
        return false;
      }
      return autoUpdater.initUpdater({
        owner: GITHUB_OWNER,
        repo: GITHUB_REPO,
        pat: pat,
        store: store,
        isPackaged: app.isPackaged,
        onUpdateDownloaded: (info) => armUpdateGate(store, info),
        onUpdateFailed: (err) => {
          try {
            mainWindow.webContents.send('show-magicline-error', { variant: 'update-failed' });
          } catch (e) {
            log.error('update-failed variant send failed: ' + (e && e.message));
          }
        },
      });
    }

    function armUpdateGate(store, info) {
      updateGate.onUpdateDownloaded({
        installFn: () => {
          log.audit('update.install', { phase: 'quitAndInstall', version: (info && info.version) || 'unknown' });
          try { mainWindow.webContents.send('show-updating-cover'); } catch (_) {}
          autoUpdater.installUpdate();
        },
        log: log,
        sessionResetModule: sessionResetMod,
      });
    }

    function startUpdateCheckInterval() {
      if (updateCheckInterval) clearInterval(updateCheckInterval);
      updateCheckInterval = setInterval(() => {
        autoUpdater.checkForUpdates();
      }, UPDATE_CHECK_INTERVAL_MS);
    }

    /**
     * D-29 post-update health watchdog. Called at the top of app.whenReady.
     * Reads `pendingUpdate` flag and arms a 2-minute timer; if authFlow reaches
     * CASH_REGISTER_READY first, the timer is cleared (healthy). Otherwise,
     * the timer expires → mark bad release + show bad-release variant.
     */
    function startHealthWatchdog(store) {
      const pending = store.get('pendingUpdate');
      if (!pending || !pending.pendingVersion) return;
      log.audit('update.install', { phase: 'watchdog-started', version: pending.pendingVersion });
      healthWatchdogTimer = setTimeout(() => {
        healthWatchdogTimer = null;
        log.audit('update.failed', { reason: 'watchdog-expired', version: pending.pendingVersion });
        try { store.set('autoUpdateDisabled', true); } catch (_) {}
        try { store.delete('pendingUpdate'); } catch (_) {}
        try {
          if (mainWindow) mainWindow.webContents.send('show-magicline-error', { variant: 'bad-release' });
        } catch (_) {}
        if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
      }, HEALTH_WATCHDOG_MS);

      // Poll authFlow.getState every AUTH_POLL_MS; success clears the watchdog.
      authPollTimer = setInterval(() => {
        try {
          const state = require('./authFlow').getState && require('./authFlow').getState();
          if (state === 'CASH_REGISTER_READY') {
            log.audit('update.install', { phase: 'health-check-passed', version: pending.pendingVersion });
            clearHealthWatchdog(store);
          }
        } catch (e) {
          // authFlow may not be loaded yet — keep polling
        }
      }, AUTH_POLL_MS);
    }

    function clearHealthWatchdog(store) {
      if (healthWatchdogTimer) { clearTimeout(healthWatchdogTimer); healthWatchdogTimer = null; }
      if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
      try { store.delete('pendingUpdate'); } catch (_) {}
    }

    function buildAdminDiagnostics(store) {
      let authState = 'UNKNOWN';
      try { authState = require('./authFlow').getState() || 'UNKNOWN'; } catch (_) {}
      let lastResetAt = null;
      try { lastResetAt = sessionResetMod.getLastResetAt ? sessionResetMod.getLastResetAt() : null; } catch (_) {}
      let updateStatus = 'nicht konfiguriert';
      if (store.get('autoUpdateDisabled') === true) updateStatus = 'deaktiviert';
      else if (autoUpdater.isEnabled()) updateStatus = 'aktiv';
      return {
        version: app.getVersion(),
        lastUpdateCheck: autoUpdater.getLastCheckAt(),
        authState: authState,
        lastResetAt: lastResetAt,
        updateStatus: updateStatus,
        patConfigured: !!store.get('githubUpdatePat'),
      };
    }
    ```

    **Edit D — add Ctrl+Shift+F12 globalShortcut registration inside `app.whenReady` (right after the existing `if (!isDev) { const chords = ['Alt+F4', ...` block, around line 136):**
    ```javascript
    // Phase 5 D-08: register admin hotkey via globalShortcut (defense-in-depth)
    if (!isDev) {
      const adminOk = globalShortcut.register('Ctrl+Shift+F12', openAdminPinModal);
      if (!adminOk) {
        log.warn('globalShortcut.register(Ctrl+Shift+F12) returned false — will still work via before-input-event');
      } else {
        log.info('globalShortcut registered: Ctrl+Shift+F12 (admin hotkey)');
      }
    }
    ```

    **Edit E — after the existing `attachLockdown(mainWindow.webContents)` (around line 145), add the host-wc before-input-event handler for the hotkey:**
    ```javascript
    // Phase 5 D-08: before-input-event fallback on host webContents
    mainWindow.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const { canonical: canon } = require('./keyboardLockdown');
      if (canon(input) === 'Ctrl+Shift+F12') {
        openAdminPinModal();
      }
    });
    ```

    **Edit F — inside the `try { ... createMagiclineView(mainWindow, store); ... }` block, AFTER `const magiclineView = createMagiclineView(mainWindow, store);` (around line 170), add the same before-input-event handler on the Magicline webContents:**
    ```javascript
    // Phase 5 D-08: admin hotkey also captured on Magicline child wc when it has focus
    magiclineView.webContents.on('before-input-event', (_event, input) => {
      if (input.type !== 'keyDown') return;
      const { canonical: canon } = require('./keyboardLockdown');
      if (canon(input) === 'Ctrl+Shift+F12') {
        openAdminPinModal();
      }
    });
    ```

    **Edit G — start the health watchdog BEFORE `startAuthFlow` runs (it must observe the auth state transitions). Insert immediately after `require('./idleTimer').init(mainWindow);`:**
    ```javascript
    // Phase 5 D-29: post-update health watchdog (runs before authFlow.start so
    // the auth-state poller picks up CASH_REGISTER_READY when it arrives).
    startHealthWatchdog(store);
    ```

    **Edit H — after `authFlow.start({...})` succeeds (inside the `startAuthFlow` function body, after `log.info('phase3.authFlow.started')`), add the auto-updater boot sequence:**
    ```javascript
          // Phase 5 D-14, D-18, D-19: attempt to initialise auto-updater
          try {
            const ok = tryInitAutoUpdater(store);
            if (ok) {
              // Initial check, then every 6 hours
              autoUpdater.checkForUpdates();
              startUpdateCheckInterval();
            }
          } catch (err) {
            log.error('phase5.autoUpdater.init failed: ' + (err && err.message));
          }
    ```

    **Edit I — NEW IPC handlers, insert AFTER the existing `ipcMain.handle('launch-touch-keyboard', ...)` block (around line 308, before the closing `} catch (err) {` of the try block):**
    ```javascript
          // === Phase 5 IPC handlers ================================================

          // --- verify-admin-pin: admin hotkey → PIN modal → admin menu
          ipcMain.handle('verify-admin-pin', async (_e, payload) => {
            try {
              const pin = (payload && typeof payload.pin === 'string') ? payload.pin : '';
              const result = adminPinLockout.verifyPinWithLockout(store, pin);
              if (result.ok) {
                adminMenuOpen = true;
                log.audit('admin.open', {});
                try {
                  mainWindow.webContents.send('hide-pin-modal');
                  const diagnostics = buildAdminDiagnostics(store);
                  mainWindow.webContents.send('show-admin-menu', diagnostics);
                } catch (_) {}
                return { ok: true, locked: false, lockedUntil: null };
              }
              if (result.locked) {
                log.audit('pin.lockout', { lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null });
                try {
                  mainWindow.webContents.send('show-pin-lockout', {
                    lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null,
                  });
                } catch (_) {}
              } else {
                log.audit('pin.verify', { result: 'fail' });
              }
              return {
                ok: false,
                locked: !!result.locked,
                lockedUntil: result.lockedUntil ? result.lockedUntil.toISOString() : null,
              };
            } catch (err) {
              log.error('ipc.verify-admin-pin failed: ' + (err && err.message));
              return { ok: false, locked: false, lockedUntil: null };
            }
          });

          // --- get-admin-diagnostics: refresh diagnostic header on demand
          ipcMain.handle('get-admin-diagnostics', async () => {
            try {
              return buildAdminDiagnostics(store);
            } catch (err) {
              log.error('ipc.get-admin-diagnostics failed: ' + (err && err.message));
              return null;
            }
          });

          // --- admin-menu-action: dispatch admin menu button taps
          ipcMain.handle('admin-menu-action', async (_e, payload) => {
            const action = payload && payload.action;
            if (!adminMenuOpen) {
              log.warn('admin-menu-action: refused — adminMenuOpen=false (action=' + action + ')');
              return { ok: false, error: 'not-authorised' };
            }
            log.audit('admin.exit', { action: String(action) });
            try {
              switch (action) {
                case 'check-updates': {
                  const r = await autoUpdater.checkForUpdates();
                  try {
                    mainWindow.webContents.send('show-admin-update-result', {
                      status: r.result,
                      message: r.error || null,
                    });
                  } catch (_) {}
                  return { ok: true, result: r };
                }
                case 'view-logs': {
                  try { app.setKiosk(false); } catch (_) {}
                  try { await shell.openPath(app.getPath('logs')); } catch (e) {
                    log.error('shell.openPath failed: ' + (e && e.message));
                    return { ok: false, error: String(e && e.message) };
                  }
                  return { ok: true };
                }
                case 'reload': {
                  adminMenuOpen = false;
                  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
                  try { mainWindow.webContents.reload(); } catch (_) {}
                  return { ok: true };
                }
                case 're-enter-credentials': {
                  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
                  try { mainWindow.webContents.send('show-credentials-overlay', { firstRun: false }); } catch (_) {}
                  adminMenuOpen = false;
                  return { ok: true };
                }
                case 'configure-auto-update': {
                  try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
                  try {
                    mainWindow.webContents.send('show-update-config', {
                      hasExistingPat: !!store.get('githubUpdatePat'),
                    });
                  } catch (_) {}
                  return { ok: true };
                }
                case 'exit-to-windows': {
                  try { globalShortcut.unregisterAll(); } catch (_) {}
                  try { app.setKiosk(false); } catch (_) {}
                  adminMenuOpen = false;
                  app.quit();
                  return { ok: true };
                }
                default:
                  return { ok: false, error: 'unknown-action' };
              }
            } catch (err) {
              log.error('ipc.admin-menu-action failed: ' + (err && err.message));
              return { ok: false, error: String(err && err.message) };
            }
          });

          // --- close-admin-menu: PAT config cancel / explicit close
          ipcMain.handle('close-admin-menu', async () => {
            adminMenuOpen = false;
            try { mainWindow.webContents.send('hide-admin-menu'); } catch (_) {}
            return { ok: true };
          });

          // --- submit-update-pat: save PAT, re-initialise updater
          ipcMain.handle('submit-update-pat', async (_e, payload) => {
            try {
              const pat = (payload && typeof payload.pat === 'string') ? payload.pat.trim() : '';
              if (!pat || /\s/.test(pat)) {
                return { ok: false, error: 'empty-or-whitespace' };
              }
              if (!safeStorage.isEncryptionAvailable()) {
                log.audit('update.failed', { reason: 'safestorage-unavailable', phase: 'pat-save' });
                return { ok: false, error: 'safestorage-unavailable' };
              }
              const cipher = safeStorage.encryptString(pat);
              store.set('githubUpdatePat', cipher.toString('base64'));
              // Clearing the disabled flag: admin entering a PAT means "try again"
              try { store.delete('autoUpdateDisabled'); } catch (_) {}
              log.audit('update.pat.configured', { pat: pat });
              const initOk = tryInitAutoUpdater(store);
              if (initOk) {
                autoUpdater.checkForUpdates();
                startUpdateCheckInterval();
              }
              // Return to admin menu with refreshed diagnostics
              adminMenuOpen = true;
              try { mainWindow.webContents.send('hide-update-config'); } catch (_) {}
              try { mainWindow.webContents.send('show-admin-menu', buildAdminDiagnostics(store)); } catch (_) {}
              return { ok: true };
            } catch (err) {
              log.error('ipc.submit-update-pat failed: ' + (err && err.message));
              return { ok: false, error: String(err && err.message) };
            }
          });
    ```

    **Edit J — small addition to sessionReset.js inside Plan 05-04 scope for `getLastResetAt()`:** Since Plan 03 did NOT add this accessor, Plan 04 adds it.

    Edit `src/main/sessionReset.js`:
    - Add module-scoped `let lastResetAt = null;` near the other state declarations
    - Inside `hardReset`, on the `succeeded = true;` line (from Plan 03), ALSO set `lastResetAt = Date.now();` immediately after
    - Export `getLastResetAt: () => lastResetAt` via the module.exports block

    ```javascript
    // In sessionReset.js module-scoped state:
    let lastResetAt = null;

    // Inside hardReset, after step 10 createMagiclineView:
    succeeded = true;
    lastResetAt = Date.now();

    // In _resetForTests:
    lastResetAt = null;

    // In module.exports:
    getLastResetAt: function() { return lastResetAt; },
    ```

    Do NOT touch the rest of sessionReset.js. This is a 4-line addition on top of Plan 03's changes.
  </action>
  <verify>
    <automated>node --check src/main/main.js src/main/autoUpdater.js src/main/sessionReset.js && node -e "const m=require('./src/main/sessionReset');if(typeof m.getLastResetAt!=='function')process.exit(1);if(typeof m.onPostReset!=='function')process.exit(2);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - `node --check src/main/main.js` exits 0
    - `node --check src/main/sessionReset.js` exits 0
    - `grep -n "ipcMain.handle('verify-admin-pin'" src/main/main.js` matches exactly once
    - `grep -n "ipcMain.handle('verify-pin'" src/main/main.js` matches exactly once (Phase 3 preserved)
    - `grep -n "ipcMain.handle('admin-menu-action'" src/main/main.js` matches
    - `grep -n "ipcMain.handle('submit-update-pat'" src/main/main.js` matches
    - `grep -n "ipcMain.handle('get-admin-diagnostics'" src/main/main.js` matches
    - `grep -n "ipcMain.handle('close-admin-menu'" src/main/main.js` matches
    - `grep -n "adminPinLockout.verifyPinWithLockout" src/main/main.js` matches
    - `grep -n "resetLoopPending" src/main/main.js` matches (Phase 3 intercept preserved — should be ≥2)
    - `grep -n "openAdminPinModal" src/main/main.js` matches ≥ 4 times (def + globalShortcut + host wc handler + magicline wc handler)
    - `grep -n "Ctrl+Shift+F12" src/main/main.js` matches ≥ 3 times
    - `grep -n "tryInitAutoUpdater" src/main/main.js` matches ≥ 2 times
    - `grep -n "armUpdateGate" src/main/main.js` matches ≥ 2 times
    - `grep -n "startHealthWatchdog" src/main/main.js` matches ≥ 2 times
    - `grep -n "clearHealthWatchdog" src/main/main.js` matches ≥ 2 times
    - `grep -n "HEALTH_WATCHDOG_MS" src/main/main.js` matches ≥ 2 times
    - `grep -n "pendingUpdate" src/main/main.js` matches
    - `grep -n "autoUpdateDisabled" src/main/main.js` matches
    - `grep -n "shell.openPath" src/main/main.js` matches
    - `grep -n "app.setKiosk(false)" src/main/main.js` matches ≥ 2 times (view-logs + exit-to-windows)
    - `grep -n "getLastResetAt" src/main/sessionReset.js` matches ≥ 2 times (export + setter)
    - `grep -n "lastResetAt" src/main/sessionReset.js` matches ≥ 3 times
    - Phase 1 ORCHESTRATION marker comment still present: `grep -n "ORCHESTRATION" src/main/main.js` matches
    - `grep -n "function createMainWindow" src/main/main.js` matches (function not removed/renamed)
    - `grep -c "ipcMain.handle" src/main/main.js` ≥ 10 (Phase 3: submit-credentials, verify-pin, request-pin-recovery, launch-touch-keyboard = 4; Phase 5: verify-admin-pin, admin-menu-action, submit-update-pat, get-admin-diagnostics, close-admin-menu = 5 → total ≥ 9)
    - `grep -n "BSFPOS_GH_OWNER" src/main/main.js` matches (TODO runbook marker)
    - No `publish` token anywhere: `grep -nE "publish.*token" package.json` returns nothing
  </acceptance_criteria>
  <done>main.js extended with all Phase 5 IPC handlers, hotkey wiring, updater boot sequence, and health watchdog. sessionReset.getLastResetAt() added. Phase 1-4 symbols preserved.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 4: Extend preload.js with Phase 5 IPC surface</name>
  <read_first>
    - src/main/preload.js (entire file)
    - Task 3 action (new IPC channel names — keep this list in sync)
  </read_first>
  <behavior>
    - Existing Phase 1-4 exposed methods unchanged
    - New exposed methods for admin menu, update config, updating cover, PIN lockout, admin-specific verify
  </behavior>
  <action>
    Edit `src/main/preload.js`. After the existing `requestResetLoopRecovery` line (before the closing `});`), add the Phase 5 additions:

    ```javascript

      // --- Phase 5 main → renderer subscribers ------------------------------
      onShowAdminMenu:      (cb) => ipcRenderer.on('show-admin-menu',       (_e, payload) => cb(payload)),
      onHideAdminMenu:      (cb) => ipcRenderer.on('hide-admin-menu',       () => cb()),
      onShowUpdateConfig:   (cb) => ipcRenderer.on('show-update-config',    (_e, payload) => cb(payload)),
      onHideUpdateConfig:   (cb) => ipcRenderer.on('hide-update-config',    () => cb()),
      onShowUpdatingCover:  (cb) => ipcRenderer.on('show-updating-cover',   () => cb()),
      onHideUpdatingCover:  (cb) => ipcRenderer.on('hide-updating-cover',   () => cb()),
      onShowAdminUpdateResult: (cb) => ipcRenderer.on('show-admin-update-result', (_e, payload) => cb(payload)),
      onShowPinLockout:     (cb) => ipcRenderer.on('show-pin-lockout',      (_e, payload) => cb(payload)),
      onHidePinLockout:     (cb) => ipcRenderer.on('hide-pin-lockout',      () => cb()),

      // --- Phase 5 renderer → main invokes ---------------------------------
      verifyAdminPin:       (pin)     => ipcRenderer.invoke('verify-admin-pin',       { pin: pin }),
      getAdminDiagnostics:  ()        => ipcRenderer.invoke('get-admin-diagnostics'),
      adminMenuAction:      (action)  => ipcRenderer.invoke('admin-menu-action',      { action: action }),
      closeAdminMenu:       ()        => ipcRenderer.invoke('close-admin-menu'),
      submitUpdatePat:      (pat)     => ipcRenderer.invoke('submit-update-pat',      { pat: pat }),
    ```

    Also update the onShowPinModal subscriber signature to pass through the payload (so host.js can distinguish `context:'admin'` vs `context:'reset-loop'`):

    Change the existing line:
    ```javascript
    onShowPinModal: (cb) => ipcRenderer.on('show-pin-modal', () => cb()),
    ```
    to:
    ```javascript
    onShowPinModal: (cb) => ipcRenderer.on('show-pin-modal', (_e, payload) => cb(payload)),
    ```

    Do NOT remove any existing method. Do NOT rename any existing method.
  </action>
  <verify>
    <automated>node --check src/main/preload.js && grep -cE "verifyAdminPin|adminMenuAction|submitUpdatePat|onShowAdminMenu|onShowPinLockout|onShowUpdatingCover|closeAdminMenu|getAdminDiagnostics|onShowUpdateConfig|onShowAdminUpdateResult" src/main/preload.js | awk '{if($1<10)exit 1}'
    <automated>node --check src/main/preload.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --check src/main/preload.js` exits 0
    - `grep -n "verifyAdminPin" src/main/preload.js` matches
    - `grep -n "adminMenuAction" src/main/preload.js` matches
    - `grep -n "submitUpdatePat" src/main/preload.js` matches
    - `grep -n "getAdminDiagnostics" src/main/preload.js` matches
    - `grep -n "closeAdminMenu" src/main/preload.js` matches
    - `grep -n "onShowAdminMenu" src/main/preload.js` matches
    - `grep -n "onHideAdminMenu" src/main/preload.js` matches
    - `grep -n "onShowUpdateConfig" src/main/preload.js` matches
    - `grep -n "onHideUpdateConfig" src/main/preload.js` matches
    - `grep -n "onShowUpdatingCover" src/main/preload.js` matches
    - `grep -n "onHideUpdatingCover" src/main/preload.js` matches
    - `grep -n "onShowPinLockout" src/main/preload.js` matches
    - `grep -n "onShowAdminUpdateResult" src/main/preload.js` matches
    - `grep -nE "onShowPinModal.*_e, payload" src/main/preload.js` matches (payload passthrough)
    - Existing Phase 1-4 methods still present: `grep -nE "onHideSplash|submitCredentials|verifyPin|requestResetLoopRecovery|notifyIdleDismissed" src/main/preload.js` matches all 5
  </acceptance_criteria>
  <done>preload.js exposes the full Phase 5 IPC surface; prior Phase 1-4 surface untouched.</done>
</task>

</tasks>

<verification>
1. `node --check src/main/autoUpdater.js src/main/main.js src/main/preload.js src/main/keyboardLockdown.js src/main/sessionReset.js` exits 0
2. `node -e "require('./src/main/autoUpdater');require('./src/main/keyboardLockdown');require('./src/main/updateGate');require('./src/main/adminPinLockout');require('./src/main/sessionReset');console.log('all loadable')"` prints `all loadable`
3. `grep -c "ipcMain.handle" src/main/main.js` ≥ 9 (4 pre-existing + 5 new Phase 5)
4. Existing Phase 4 sessionReset tests still green (run `node --test test/sessionReset*.test.js` if present)
5. Plan 02 and Plan 03 unit tests still green
6. `node --check src/main/main.js` exits 0
7. No `publish.token` in package.json
8. `grep -n "resetLoopPending" src/main/main.js` matches ≥ 2 (Phase 3 intercept preserved)
</verification>

<success_criteria>
- ADMIN-01: Ctrl+Shift+F12 triggers admin PIN modal via globalShortcut + before-input-event on both host and Magicline webContents
- ADMIN-02: Correct admin PIN opens admin menu with diagnostic payload; all 6 admin actions dispatchable via `admin-menu-action` IPC
- ADMIN-06: Private-GitHub auto-update wired via NsisUpdater + runtime addAuthHeader; PAT stored via safeStorage
- ADMIN-07: updateGate arms on update-downloaded, installs on first of (post-reset | 03:00–05:00)
- ADMIN-08: Health watchdog marks bad release on 2-min failure; bad-release variant shown; autoUpdateDisabled latched
- Phase 3 reset-loop recovery (`resetLoopPending` intercept) preserved — admin PIN uses a SEPARATE IPC channel
- Dev-mode no-ops: no network calls, no pendingUpdate writes when `app.isPackaged === false`
</success_criteria>

<output>
After completion, create `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-04-SUMMARY.md` with:
- main.js line-count delta
- Full Phase 5 IPC channel list (send + invoke)
- Confirmation that Phase 3 `verify-pin` + `resetLoopPending` code block is byte-identical to pre-Plan-04
- Decision log for any deviations (e.g. if NsisUpdater export needed a fallback path)
</output>
