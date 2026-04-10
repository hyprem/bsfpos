---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 06
type: execute
wave: 3
depends_on: ["05-01-logger-deps-PLAN", "05-04-main-orchestration-PLAN", "05-05-host-ui-PLAN"]
files_modified:
  - src/main/authFlow.js
  - src/main/badgeInput.js
  - src/main/credentialsStore.js
  - src/main/magiclineView.js
  - src/main/idleTimer.js
  - src/inject/inject.js
  - test/phase5-touch-target.test.js
  - test/phase5-acceptance.test.js
  - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md
autonomous: true
requirements: [ADMIN-04, ADMIN-05, BRAND-02]
tags: [log-migration, audit, verification, touch-targets]
must_haves:
  truths:
    - "Every main-process log.info/log.warn call site that references a badge, credential, ciphertext, PAT, or PIN field goes through log.audit with the appropriate field name (so the logger redactor is applied)"
    - "A grep over src/main/**/*.js finds ZERO raw badge-number-shaped strings, password variable contents, or plaintext PAT contents being log.info-ed (only sha256 prefix via log.audit allowed)"
    - "A boot-time canonical startup event fires: log.audit('startup', {version: app.getVersion()}) in main.js app.whenReady"
    - "authFlow state transitions emit log.audit('auth.state', {from, to, reason}) in addition to the existing Phase 3 log.info lines (replace, don't duplicate)"
    - "sessionReset emits log.audit('idle.reset', {reason, count}) replacing the existing log.info hardReset line"
    - "badgeInput emits log.audit('badge.scanned', {badge: rawBuffer, length: rawBuffer.length}) on commit — logger redactor hashes it"
    - "Sale completion click emits log.audit('sale.completed', {}) from inject.js via a new IPC channel to main (or via the existing drain-poll hook)"
    - "Touch-target audit test reads host.css and asserts every .bsk-btn--admin-action / .bsk-btn--admin-exit / .bsk-pin-lockout-* computed (parsed) min-height ≥ 44"
    - "A Phase 5 acceptance test asserts that every requirement ID (ADMIN-01..08, BRAND-01..03) has at least one artifact trace in the code"
    - "A 05-VERIFICATION.md file lists all Phase 5 human-verification items for the next kiosk visit (audit file spot-check, admin menu walkthrough, bad-release recovery drill)"
  artifacts:
    - path: "src/main/authFlow.js"
      provides: "Migrated log.audit events for auth.state, auth.submit, auth.failure"
      contains: "log.audit('auth.state'"
    - path: "src/main/badgeInput.js"
      provides: "Migrated log.audit('badge.scanned', ...)"
      contains: "log.audit('badge.scanned'"
    - path: "src/main/credentialsStore.js"
      provides: "Migrated log.audit for credentials ciphertext lifecycle"
      contains: "log.audit"
    - path: "test/phase5-touch-target.test.js"
      provides: "CSS-level touch target audit for Phase 5 surfaces"
    - path: "test/phase5-acceptance.test.js"
      provides: "Requirement-ID trace test for ADMIN-01..08 and BRAND-01..03"
    - path: ".planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md"
      provides: "Human-verification checklist appended to the next-visit batch"
  key_links:
    - from: "src/main/authFlow.js"
      to: "src/main/logger.js"
      via: "log.audit event calls"
      pattern: "log\\.audit"
    - from: "src/main/badgeInput.js"
      to: "src/main/logger.js"
      via: "log.audit('badge.scanned',...) after commit"
      pattern: "badge\\.scanned"
---

<objective>
Close the three ADMIN-04/ADMIN-05/BRAND-02 gaps left after Plan 01-05:
1. **Log migration** — audit every `log.info`/`log.warn`/`log.error` call site in `src/main/**/*.js` and `src/inject/inject.js` that references a sensitive field (badge, credential, ciphertext, PAT, PIN). Migrate to `log.audit(event, fields)` with the canonical event taxonomy from CONTEXT.md D-28. Non-sensitive log lines stay as-is. Add a canonical boot `log.audit('startup',...)` in main.js and a `log.audit('sale.completed',...)` hook via inject.js → main IPC.
2. **Touch-target audit** — CSS-level test that parses host.css and asserts every Phase 5 interactive selector has `min-height >= 44` (or inherits a base class that does). BRAND-02 compliance.
3. **Phase 5 acceptance + VERIFICATION.md** — a test that cross-references the 11 Phase 5 requirement IDs against code artifacts, and a human-verification checklist for the next kiosk visit.

Purpose: Close ADMIN-04 (structured audit logging), ADMIN-05 (no secrets in logs), BRAND-02 (CSS-level touch-target compliance). Provide the final acceptance gate + human-verification artifact for Phase 5.

Output: migrated log sites in 5 main-process modules + 1 inject.js site, 2 new test files, 1 VERIFICATION.md, no new production code modules.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md
@src/main/logger.js
@src/main/authFlow.js
@src/main/badgeInput.js
@src/main/credentialsStore.js
@src/main/magiclineView.js
@src/main/idleTimer.js
@src/main/sessionReset.js
@src/inject/inject.js
</context>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| existing log.info call sites → logger | Historically some Phase 3/4 log lines contain field names that should be redacted (badge, ciphertext, PAT). Migration closes this gap |
| test harness → disk | Touch-target test only READs host.css; no writes outside tmp |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-35 | I (Info disclosure) | Raw badge number in a Phase 4 log.info line leaks via `%AppData%\logs\main.log` → RDP operator | mitigate | Audit + migrate every badge-referencing log.info to log.audit. Unit test (`test/phase5-no-raw-badge.test.js`) greps src/main for suspicious patterns |
| T-05-36 | I (Info disclosure) | Credential ciphertext bytes logged as hex dump for debugging | mitigate | credentialsStore.js migration: length-only via CIPHER_FIELDS redactor |
| T-05-37 | I (Info disclosure) | PAT logged on init failure error message | mitigate | autoUpdater.js Plan 04 already uses log.audit; Plan 06 confirms no `log.info.*pat` in any file via grep |
| T-05-38 | T (Tampering) | BRAND-02 regression: admin menu button shrinks below 44px in a future rule change | mitigate | CSS-level touch-target test in CI — parses rules and asserts min-height floors |
| T-05-39 | R (Repudiation) | Sale completions not captured in audit log | mitigate | inject.js → main IPC channel `audit-sale-completed` + main log.audit('sale.completed',...) |
</threat_model>

<tasks>

<task type="auto">
  <name>Task 1: Audit and migrate sensitive log sites in main-process modules</name>
  <read_first>
    - src/main/logger.js (audit helper — verify log.audit is available post Plan 01)
    - src/main/authFlow.js (entire file — identify every log.info that references creds/pin/state)
    - src/main/badgeInput.js (entire file — identify the commit log.info where the badge string appears)
    - src/main/credentialsStore.js (entire file — identify any log.info that references ciphertext)
    - src/main/magiclineView.js (entire file — identify any log.info touching credentials/auth)
    - src/main/sessionReset.js (entire file — identify the `sessionReset.hardReset` log.info line)
    - src/main/idleTimer.js (check for any PIN/credential references)
    - src/inject/inject.js (entire file — identify sale-completed hook point and badge log)
    - src/main/main.js (for startup log.audit insertion point)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md §D-27 §D-28 (event taxonomy)
  </read_first>
  <action>
    **Audit step (reads only):** Run these greps and enumerate every hit:
    - `grep -nE "log\.(info|warn|error)" src/main/authFlow.js src/main/badgeInput.js src/main/credentialsStore.js src/main/magiclineView.js src/main/sessionReset.js src/main/idleTimer.js src/inject/inject.js`
    - `grep -nEi "badge|credential|password|cipher|pat\b|pin" src/main/authFlow.js src/main/badgeInput.js src/main/credentialsStore.js src/main/magiclineView.js src/main/sessionReset.js src/main/idleTimer.js src/inject/inject.js`

    Cross-reference: for every log line whose text contains a sensitive-field reference, MIGRATE it to log.audit. For every log line that is purely a state/lifecycle/debug message with no sensitive content, LEAVE it as log.info.

    **Migration rules (D-27 / D-28):**
    - `log.info('auth.state: X -> Y reason=Z')` → `log.audit('auth.state', {from:'X', to:'Y', reason:'Z'})`. Keep only ONE of log.audit or log.info — not both. The logger.audit writes via log.info internally so the underlying file entry remains.
    - `log.info('badgeInput commit: <length>')` → `log.audit('badge.scanned', {badge: bufferString, length: bufferString.length})` — the `badge` field hits the BADGE_FIELDS redactor → sha256 prefix
    - `log.info('credentialsStore.save: len=<n>')` → `log.audit('credentials.saved', {cipher: ciphertextString})` — the `cipher` field hits CIPHER_FIELDS → `[cipher:N]`
    - `log.info('sessionReset.hardReset: reason=X count=Y')` → `log.audit('idle.reset', {reason, count})`
    - Any `log.warn/error` containing PAT / PIN / credential → migrate to `log.audit(event, {..., reason})` where the sensitive field name is in the allowlist

    **Boot startup event (main.js addition):** At the top of `app.whenReady().then(() => { ... })` (the existing Phase 1 `log.info('app ready (isDev=' + isDev + ')')` line), ADD immediately after:
    ```javascript
      log.audit('startup', { version: app.getVersion(), isDev: isDev });
    ```
    Do NOT remove the existing `log.info` — the audit taxonomy is additive at startup. And after `createMainWindow()` + `attachLockdown` complete, add:
    ```javascript
      log.audit('startup.complete', {});
    ```

    **Sale-completed hook:**
    - In `src/inject/inject.js`, find the "Jetzt verkaufen" click hook (Phase 4 Plan 04-04 added this). When the click is detected AND the post-sale clear timer is scheduled, send a new IPC: `window.bskBridge.auditSaleCompleted && window.bskBridge.auditSaleCompleted()` (or use the existing `ipcRenderer` bridge pattern). If inject.js does not currently have an IPC bridge to main (it uses the main-world `window.kiosk` object via preload), use `window.postMessage` + a host.js listener that relays to main via a new preload method `notifySaleCompleted: () => ipcRenderer.send('audit-sale-completed')`. **Simplest path:** add the preload method AND an `ipcMain.on('audit-sale-completed', ...)` handler in `main.js` that emits `log.audit('sale.completed', {})`.
    - Add to `src/main/preload.js` (at end of the kiosk surface):
      ```javascript
      notifySaleCompleted: () => ipcRenderer.send('audit-sale-completed'),
      ```
    - Add to `src/main/main.js` inside the try block with other IPC handlers:
      ```javascript
      ipcMain.on('audit-sale-completed', () => {
        try { log.audit('sale.completed', {}); } catch (_) {}
      });
      ```
    - In `src/inject/inject.js` at the "Jetzt verkaufen" click hook, call `window.kiosk && window.kiosk.notifySaleCompleted && window.kiosk.notifySaleCompleted();` — note inject.js runs inside the Magicline WebContentsView which has its OWN preload. **CRITICAL:** the inject.js script runs in the Magicline webContents via `executeJavaScript`, not via preload. The host `window.kiosk` is NOT accessible there. Instead, use `console.log('BSK_AUDIT_SALE_COMPLETED')` + hook in main.js `magiclineView.webContents.on('console-message', ...)` listener that matches this sentinel and emits log.audit.

    Actually the cleanest path: magiclineView.js already attaches a `console-message` listener (check the file). If it does, add a branch matching `'BSK_AUDIT_SALE_COMPLETED'` and emit `log.audit('sale.completed', {})` from main. If it does not, add such a listener. In inject.js at the post-sale-clear scheduling point, add `console.log('BSK_AUDIT_SALE_COMPLETED');`.

    Implementation detail the executor must decide:
    1. `grep -n "console-message" src/main/magiclineView.js` — if there's already a handler, extend it
    2. Otherwise add a minimal handler in `createMagiclineView` after the view is constructed:
       ```javascript
       view.webContents.on('console-message', (_e, _level, message) => {
         if (typeof message === 'string' && message.indexOf('BSK_AUDIT_SALE_COMPLETED') !== -1) {
           try { log.audit('sale.completed', {}); } catch (_) {}
         }
       });
       ```
    3. Add `console.log('BSK_AUDIT_SALE_COMPLETED');` inside inject.js at the Jetzt-verkaufen click handler, next to the existing post-sale clear logic

    **Migration constraint:** Do NOT rewrite any non-log code. Do NOT change any function signatures. Do NOT rename variables. The migration is STRICTLY log-line swaps + 2 new IPC / console-message wiring points.
  </action>
  <verify>
    <automated>node --check src/main/authFlow.js src/main/badgeInput.js src/main/credentialsStore.js src/main/sessionReset.js src/main/magiclineView.js src/main/idleTimer.js src/main/main.js src/main/preload.js src/inject/inject.js && grep -c "log.audit" src/main/authFlow.js src/main/badgeInput.js src/main/credentialsStore.js src/main/sessionReset.js src/main/main.js | grep -v ":0" | wc -l | awk '{if($1<5)exit 1}'</automated>
  </verify>
  <acceptance_criteria>
    - `node --check` on all modified files exits 0
    - `grep -n "log.audit('startup'" src/main/main.js` matches once
    - `grep -n "log.audit('startup.complete'" src/main/main.js` matches once
    - `grep -c "log.audit" src/main/authFlow.js` ≥ 2 (auth.state + auth.failure/submit)
    - `grep -c "log.audit('badge.scanned'" src/main/badgeInput.js` ≥ 1
    - `grep -c "log.audit" src/main/credentialsStore.js` ≥ 1 (credentials.saved or similar)
    - `grep -c "log.audit('idle.reset'" src/main/sessionReset.js` ≥ 1
    - `grep -n "log.audit('sale.completed'" src/main/main.js` matches once
    - `grep -n "BSK_AUDIT_SALE_COMPLETED" src/inject/inject.js` matches once
    - `grep -n "BSK_AUDIT_SALE_COMPLETED" src/main/magiclineView.js` matches once
    - No raw-badge-shaped log references: `grep -nE "log\\.(info|warn|error)\\(['\"].*badge.*['\"].*\\+" src/main/badgeInput.js` returns nothing (concatenation of raw badge into log.info string)
    - No `log.info.*password|log.info.*\\.pat\\b|log.info.*cipher` matches in src/main: `! grep -nE "log\\.(info|warn|error)\\([^)]*\\bpat\\b|log\\.(info|warn|error)\\([^)]*password|log\\.(info|warn|error)\\([^)]*\\bcipher\\b" src/main/*.js`
    - All Phase 3/4 existing tests still green (run the existing test suites)
    - Canonical taxonomy events covered: `grep -hE "log\.audit\('[a-z.]+'" src/main/*.js | grep -oE "'[a-z.]+'" | sort -u` includes at least: `'auth.state'`, `'badge.scanned'`, `'idle.reset'`, `'sale.completed'`, `'startup'`, `'startup.complete'`
  </acceptance_criteria>
  <done>All sensitive log sites migrated to log.audit with taxonomy events; startup + sale.completed hooks wired; no raw secret/badge references remain in log.info/warn/error calls.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: CSS-level touch target audit test</name>
  <read_first>
    - src/host/host.css (post Plan 05 — confirm all Phase 5 selectors exist)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md §Touch Target Audit Contract (table listing every selector + its declared min-height)
  </read_first>
  <behavior>
    - Reads `src/host/host.css` as text
    - For each Phase 5 interactive selector in the UI-SPEC touch-target table, finds its rule block and asserts `min-height` is declared with a numeric value ≥ 44 (or for update-config Speichern/Abbrechen: asserts `.bsk-btn--primary` or `.bsk-btn` declares a min-height elsewhere in host.css that is ≥ 44 — this is Phase 3 inheritance, verified transitively)
    - Test is a pure regex/string parser, not a DOM render
  </behavior>
  <action>
    Create `test/phase5-touch-target.test.js`:

    ```javascript
    // test/phase5-touch-target.test.js
    // Phase 5 BRAND-02: CSS-level touch target audit.
    // Verifies that every Phase 5 interactive selector declares (or inherits
    // from a base class) a min-height >= 44px.
    const test = require('node:test');
    const assert = require('node:assert');
    const fs = require('fs');
    const path = require('path');

    const cssPath = path.join(__dirname, '..', 'src', 'host', 'host.css');
    const css = fs.readFileSync(cssPath, 'utf8');

    // Extract the rule block for a given selector. Returns the body text
    // between `{` and the matching `}`. Handles simple single-level rules only.
    function getRuleBody(selector) {
      // Build a regex that finds "<selector> { ... }" without nesting
      const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      const re = new RegExp(escaped + '\\s*\\{([^}]*)\\}', 'm');
      const m = css.match(re);
      return m ? m[1] : null;
    }

    function getMinHeightPx(selector) {
      const body = getRuleBody(selector);
      if (!body) return null;
      const m = body.match(/min-height\s*:\s*(\d+)px/);
      return m ? parseInt(m[1], 10) : null;
    }

    test('CSS file loads', () => {
      assert.ok(css.length > 0);
    });

    test('.bsk-btn--admin-action declares min-height >= 44px', () => {
      const mh = getMinHeightPx('.bsk-btn--admin-action');
      assert.ok(mh !== null, '.bsk-btn--admin-action rule or min-height missing');
      assert.ok(mh >= 44, '.bsk-btn--admin-action min-height=' + mh + ' < 44');
    });

    test('.bsk-btn--admin-action min-height specifically 64px per UI-SPEC', () => {
      assert.strictEqual(getMinHeightPx('.bsk-btn--admin-action'), 64);
    });

    test('.bsk-btn--admin-exit inherits or declares min-height >= 44 (UI-SPEC: font-size 20px scoped)', () => {
      // admin-exit inherits .bsk-btn--admin-action min-height:64px via CSS cascade.
      // Explicitly assert the font-size override is present.
      const body = getRuleBody('.bsk-btn--admin-exit');
      assert.ok(body !== null, '.bsk-btn--admin-exit rule missing');
      assert.match(body, /font-size\s*:\s*20px/, '.bsk-btn--admin-exit missing 20px WCAG override');
    });

    test('.bsk-btn base class declares min-height >= 44px (Phase 3 inheritance path for update-config buttons)', () => {
      const mh = getMinHeightPx('.bsk-btn');
      assert.ok(mh !== null, '.bsk-btn base rule missing min-height (required for update-config Abbrechen button)');
      assert.ok(mh >= 44, '.bsk-btn min-height=' + mh + ' < 44 — BRAND-02 violation');
    });

    test('.bsk-btn--primary declares min-height >= 44px (update-config Speichern button)', () => {
      // .bsk-btn--primary either has its own min-height or inherits from .bsk-btn.
      // Assert at least one of the two has a floor.
      const primaryMh = getMinHeightPx('.bsk-btn--primary');
      const baseMh    = getMinHeightPx('.bsk-btn');
      const effective = primaryMh !== null ? primaryMh : baseMh;
      assert.ok(effective !== null, 'no min-height found on .bsk-btn--primary or .bsk-btn');
      assert.ok(effective >= 44, 'effective min-height=' + effective + ' < 44');
    });

    test('.bsk-input declares min-height >= 44px (PAT input field)', () => {
      const mh = getMinHeightPx('.bsk-input');
      assert.ok(mh !== null, '.bsk-input rule missing min-height');
      assert.ok(mh >= 44, '.bsk-input min-height=' + mh + ' < 44 — BRAND-02 violation for PAT field');
    });

    test('.bsk-layer--admin declares z-index: 500 per UI-SPEC layer ladder', () => {
      const body = getRuleBody('.bsk-layer--admin');
      assert.ok(body !== null);
      assert.match(body, /z-index\s*:\s*500/);
    });

    test('.bsk-layer--updating declares z-index: 300 per UI-SPEC layer ladder', () => {
      const body = getRuleBody('.bsk-layer--updating');
      assert.ok(body !== null);
      assert.match(body, /z-index\s*:\s*300/);
    });

    test('.bsk-pin-lockout-countdown declares font-size: 48px and tabular-nums', () => {
      const body = getRuleBody('.bsk-pin-lockout-countdown');
      assert.ok(body !== null);
      assert.match(body, /font-size\s*:\s*48px/);
      assert.match(body, /font-variant-numeric\s*:\s*tabular-nums/);
    });

    test('no Magicline content selectors in host.css (BRAND-03)', () => {
      const bad = [
        /\[class\^=\"css-\"\]/,
        /\.MuiBox/,
        /\.MuiButton/,
        /\.MuiTypography/,
      ];
      for (const re of bad) {
        assert.doesNotMatch(css, re, 'Magicline selector leaked into host.css: ' + re);
      }
    });

    test('@keyframes bsk-spin is declared (updating cover spinner)', () => {
      assert.match(css, /@keyframes\s+bsk-spin/);
    });
    ```
  </action>
  <verify>
    <automated>node --test test/phase5-touch-target.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/phase5-touch-target.test.js` exits 0
    - All 12 tests pass
    - Test file uses only Node builtins (`node:test`, `node:assert`, `fs`, `path`)
    - If any test fails, the error message clearly identifies WHICH selector and WHAT value was found
  </acceptance_criteria>
  <done>Phase 5 BRAND-02 touch-target audit and BRAND-03 Magicline-isolation checks are automated and green.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Phase 5 acceptance test + 05-VERIFICATION.md</name>
  <read_first>
    - All 5 prior Phase 5 plan files (01-05) to extract the requirement-ID to artifact mapping
    - .planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md (reference format for the human-verification checklist)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md §Touch Target Audit Contract
  </read_first>
  <behavior>
    - `test/phase5-acceptance.test.js` is a grep-harness test: for each Phase 5 requirement ID, asserts that at least one source file matches a predefined pattern proving the requirement is implemented
    - `05-VERIFICATION.md` is a human-readable checklist of items to verify on the real kiosk during the next maintenance visit, parallel to `01-VERIFICATION.md`
  </behavior>
  <action>
    Create `test/phase5-acceptance.test.js`:

    ```javascript
    // test/phase5-acceptance.test.js
    // Phase 5 requirement → artifact trace. Every ADMIN-* and BRAND-* requirement
    // must be grep-anchored to at least one code artifact. Fails loudly if a
    // future refactor removes the marker.
    const test = require('node:test');
    const assert = require('node:assert');
    const fs = require('fs');
    const path = require('path');

    const root = path.join(__dirname, '..');
    function read(rel) {
      return fs.readFileSync(path.join(root, rel), 'utf8');
    }

    const mainJs            = read('src/main/main.js');
    const keyboardLockdown  = read('src/main/keyboardLockdown.js');
    const autoUpdater       = read('src/main/autoUpdater.js');
    const updateGate        = read('src/main/updateGate.js');
    const adminPinLockout   = read('src/main/adminPinLockout.js');
    const logger            = read('src/main/logger.js');
    const sessionReset      = read('src/main/sessionReset.js');
    const hostHtml          = read('src/host/host.html');
    const hostCss           = read('src/host/host.css');
    const hostJs            = read('src/host/host.js');

    test('ADMIN-01: Ctrl+Shift+F12 → PIN prompt (reservedShortcuts + globalShortcut + before-input-event)', () => {
      assert.match(keyboardLockdown, /reservedShortcuts\.add\('Ctrl\+Shift\+F12'\)/);
      assert.match(mainJs, /globalShortcut\.register\('Ctrl\+Shift\+F12'/);
      assert.match(mainJs, /openAdminPinModal/);
      assert.ok(mainJs.match(/Ctrl\+Shift\+F12/g).length >= 3, 'expected Ctrl+Shift+F12 referenced in main.js at least 3 times');
    });

    test('ADMIN-02: Admin menu with 6 actions', () => {
      const actions = ['check-updates', 'view-logs', 'reload', 're-enter-credentials', 'configure-auto-update', 'exit-to-windows'];
      for (const a of actions) {
        assert.ok(mainJs.includes("'" + a + "'"), 'missing admin action handler: ' + a);
      }
      assert.match(hostHtml, /id="admin-menu"/);
      assert.match(hostHtml, /id="admin-btn-check-updates"/);
      assert.match(hostHtml, /id="admin-btn-exit"/);
      assert.match(hostJs, /adminMenuAction/);
    });

    test('ADMIN-03: PIN hashed + 5-wrong-in-60s → 5-min lockout', () => {
      assert.match(adminPinLockout, /MAX_ATTEMPTS\s*=\s*5/);
      assert.match(adminPinLockout, /WINDOW_MS\s*=\s*60_?000/);
      assert.match(adminPinLockout, /LOCKOUT_MS\s*=\s*5\s*\*\s*60_?000/);
      assert.match(mainJs, /ipcMain\.handle\('verify-admin-pin'/);
      assert.match(hostHtml, /id="pin-lockout-panel"/);
      assert.match(hostJs, /showPinLockout/);
    });

    test('ADMIN-04: Structured rotating logs + taxonomy events', () => {
      assert.match(logger, /log\.audit = function/);
      assert.match(logger, /archiveLogFn/);
      // Taxonomy sampling — at least these 5 must appear in main
      const events = ["'startup'", "'startup.complete'", "'auth.state'", "'idle.reset'", "'sale.completed'"];
      const mainBundle = mainJs + sessionReset + read('src/main/authFlow.js') + read('src/main/badgeInput.js');
      for (const e of events) {
        assert.ok(mainBundle.includes(e), 'missing log.audit event: ' + e);
      }
    });

    test('ADMIN-05: 5-file rotation + redactor (no raw secrets)', () => {
      assert.match(logger, /MAX_ARCHIVES\s*=\s*5/);
      assert.match(logger, /BADGE_FIELDS/);
      assert.match(logger, /SECRET_FIELDS/);
      assert.match(logger, /CIPHER_FIELDS/);
      // No log.info calls with raw pat / password / cipher field names across main/
      const files = ['src/main/authFlow.js','src/main/badgeInput.js','src/main/credentialsStore.js','src/main/main.js','src/main/autoUpdater.js'];
      for (const f of files) {
        const src = read(f);
        assert.doesNotMatch(src, /log\.(info|warn|error)\([^)]*\bpat\s*:/i, f + ' leaks pat field in log.info');
        assert.doesNotMatch(src, /log\.(info|warn|error)\([^)]*\bpassword\s*:/i, f + ' leaks password field in log.info');
      }
    });

    test('ADMIN-06: electron-updater with addAuthHeader + NsisUpdater (no embedded PAT)', () => {
      assert.match(autoUpdater, /NsisUpdater/);
      assert.match(autoUpdater, /addAuthHeader/);
      assert.match(autoUpdater, /autoDownload\s*=\s*false/);
      assert.match(autoUpdater, /autoInstallOnAppQuit\s*=\s*false/);
      assert.match(mainJs, /ipcMain\.handle\('submit-update-pat'/);
      assert.match(mainJs, /safeStorage\.encryptString/);
      // package.json must not contain a publish.token
      const pkg = read('package.json');
      assert.doesNotMatch(pkg, /"token"\s*:/);
    });

    test('ADMIN-07: safe-window install gate (post-reset OR 03:00–05:00)', () => {
      assert.match(updateGate, /MAINTENANCE_HOUR_START\s*=\s*3/);
      assert.match(updateGate, /MAINTENANCE_HOUR_END\s*=\s*5/);
      assert.match(updateGate, /'post-reset'/);
      assert.match(updateGate, /'maintenance-window'/);
      assert.match(sessionReset, /onPostReset/);
    });

    test('ADMIN-08: updating cover + bad-release/update-failed variants + health watchdog', () => {
      assert.match(hostHtml, /id="updating-cover"/);
      assert.match(hostJs, /'bad-release'/);
      assert.match(hostJs, /'update-failed'/);
      assert.match(mainJs, /pendingUpdate/);
      assert.match(mainJs, /HEALTH_WATCHDOG_MS/);
      assert.match(mainJs, /autoUpdateDisabled/);
    });

    test('BRAND-01: Logo + brand colors on all new Phase 5 surfaces', () => {
      // Check that all new surfaces include the logo asset
      const newSurfacePatterns = [
        /id="admin-menu"[\s\S]*?assets\/logo-dark\.png/,
        /id="update-config"[\s\S]*?assets\/logo-dark\.png/,
        /id="updating-cover"[\s\S]*?assets\/logo-dark\.png/,
      ];
      for (const re of newSurfacePatterns) {
        assert.match(hostHtml, re);
      }
      // Brand accent #F5C518 referenced in Phase 5 CSS block
      assert.match(hostCss, /#F5C518/);
    });

    test('BRAND-02: CSS touch target floors declared', () => {
      // Admin menu buttons >= 64 per UI-SPEC
      assert.match(hostCss, /\.bsk-btn--admin-action[\s\S]*?min-height:\s*64px/);
      // Base .bsk-btn has a 44px floor (Phase 3 inheritance for update-config cancel button)
      assert.match(hostCss, /\.bsk-btn\s*\{[\s\S]*?min-height:\s*(44|4[5-9]|[5-9]\d|\d{3,})px/);
    });

    test('BRAND-03: Magicline content area not themed', () => {
      const bad = [/\[class\^=\"css-\"\]/, /\.MuiBox/, /\.MuiButton/, /\.MuiTypography/];
      for (const re of bad) {
        assert.doesNotMatch(hostCss, re);
      }
    });
    ```

    Create `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md`:

    ```markdown
    # Phase 5 Verification Checklist

    **Created:** 2026-04-10
    **Phase:** 05-admin-exit-logging-auto-update-branded-polish
    **Automated status:** [filled on completion of Plans 01-06]
    **Human verification status:** **DEFERRED to next kiosk visit** (consolidated next-visit batch lives in `01-VERIFICATION.md`)

    ## Automated Coverage (CI — must be green before close)

    - [ ] `node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js` — redactor + rotation (Plan 01)
    - [ ] `node --test test/adminPinLockout.test.js` — lockout semantics (Plan 02)
    - [ ] `node --test test/sessionReset.postReset.test.js test/updateGate.test.js` — gate + post-reset hook (Plan 03)
    - [ ] `node --test test/phase5-touch-target.test.js` — CSS-level BRAND-02 audit (Plan 06)
    - [ ] `node --test test/phase5-acceptance.test.js` — requirement-ID trace (Plan 06)
    - [ ] Phase 3/4 regression suites still green

    ## Phase 5 Human Verification — Next Kiosk Visit Batch

    These items require the physical kiosk terminal with Deka reader, network access to GitHub, and staff walk-through. Append to `01-VERIFICATION.md` "Phase 5 — Deferred Physical Verification" subsection.

    ### Admin Hotkey + PIN + Lockout (ADMIN-01, ADMIN-02, ADMIN-03)

    | # | Action | Expected | Status |
    |---|--------|----------|--------|
    | P5-01 | Press `Ctrl+Shift+F12` on the running kiosk | Branded PIN modal opens (not DevTools, not Chrome menu) | [ ] |
    | P5-02 | Enter correct admin PIN | Admin menu opens with 5 diagnostic rows populated (Version, Letztes Update, Status, Letzter Reset, Auto-Update) and 6 buttons in safe→destructive order | [ ] |
    | P5-03 | Tap "Updates prüfen" | Inline result appears below button stack: "Aktuell" or "Update verfügbar — wird bei nächster Ruhepause installiert"; auto-hides after 5 s | [ ] |
    | P5-04 | Tap "Protokolle anzeigen" | Windows Explorer opens to `%AppData%\Bee Strong POS\logs\`; close Explorer to return to kiosk | [ ] |
    | P5-05 | Tap "Kasse nachladen" | Magicline view reloads; kiosk transitions back through BOOTING → CASH_REGISTER_READY | [ ] |
    | P5-06 | Tap "Anmeldedaten ändern" | Credentials overlay appears in re-entry mode (no PIN setup fields) | [ ] |
    | P5-07 | Enter 5 wrong PINs in under 60 s | On the 5th wrong attempt, lockout panel replaces keypad with live mm:ss countdown and message "Zu viele Versuche — bitte warten" | [ ] |
    | P5-08 | Wait until countdown reaches 00:00 | Keypad re-appears automatically; correct PIN on next try opens admin menu | [ ] |
    | P5-09 | During lockout, press `Ctrl+Shift+F12` again | PIN modal stays open; countdown does NOT reset or duplicate | [ ] |

    ### Logging (ADMIN-04, ADMIN-05)

    | # | Action | Expected | Status |
    |---|--------|----------|--------|
    | P5-10 | Open `%AppData%\Bee Strong POS\logs\main.log` over RDP after a day of use | Lines for `event=startup`, `event=auth.state`, `event=idle.reset`, `event=badge.scanned`, `event=sale.completed` present | [ ] |
    | P5-11 | `grep` the log directory for 10+ digit badge numbers | ZERO matches — only 8-hex sha256 prefixes should appear | [ ] |
    | P5-12 | `grep` the log directory for `password=` | Every hit is `password=***` (never plaintext) | [ ] |
    | P5-13 | `grep` the log directory for PAT values starting with `ghp_` | Zero matches — PAT field must render as `pat=[cipher:N]` | [ ] |
    | P5-14 | Count files in the logs directory after forced rotation (write > 5 MB to main.log by repeated actions) | Exactly `main.log` + `main.1.log` through `main.5.log` = 6 files max; `main.6.log` must NOT exist | [ ] |

    ### Auto-Update + Safe Window (ADMIN-06, ADMIN-07)

    | # | Action | Expected | Status |
    |---|--------|----------|--------|
    | P5-15 | Fresh install, no PAT configured | Kiosk boots normally; admin diagnostic header shows "Auto-Update: nicht konfiguriert"; no GitHub calls in logs | [ ] |
    | P5-16 | Enter valid PAT via "Auto-Update einrichten" screen | `update.check` log line appears; diagnostic header flips to "aktiv" | [ ] |
    | P5-17 | Enter invalid PAT | Inline error "PAT ungültig — Verbindungsfehler. Bitte prüfen und erneut speichern."; admin menu does NOT lose state | [ ] |
    | P5-18 | Publish a new tagged GitHub release while kiosk is running | Within 6 hours (or on next `Updates prüfen`), `update.downloaded` appears in logs; no visible UI change until safe window | [ ] |
    | P5-19 | Trigger an idle-expiry hard reset after update-downloaded | `update.install` with `trigger=post-reset` logs; updating cover briefly visible; new version boots | [ ] |
    | P5-20 | Alternatively wait until 03:00–05:00 window after a downloaded update | `update.install` with `trigger=maintenance-window` logs; new version boots | [ ] |

    ### Update Failure + Rollback (ADMIN-08)

    | # | Action | Expected | Status |
    |---|--------|----------|--------|
    | P5-21 | Install a deliberately broken release (fails to reach CASH_REGISTER_READY) | 2-minute watchdog expires; `update.failed` with `reason=watchdog-expired` logs; bad-release variant appears on the `#magicline-error` layer with "Update fehlgeschlagen — Bitte Studio-Personal verständigen" | [ ] |
    | P5-22 | On bad-release screen, tap "PIN eingeben" → enter PIN | Admin menu opens; staff can view logs + exit to Windows for manual NSIS re-install | [ ] |
    | P5-23 | After bad-release: reboot kiosk | `autoUpdateDisabled` latched; diagnostic header shows "Auto-Update: deaktiviert"; no automatic re-attempt | [ ] |
    | P5-24 | Simulate an NSIS install-time failure (install-time exit code non-zero) | `update-failed` variant appears for 10 s with "Aktualisierung fehlgeschlagen — erneuter Versuch beim nächsten Neustart"; auto-dismisses; kiosk continues on old version | [ ] |

    ### Branded Polish (BRAND-01, BRAND-02, BRAND-03)

    | # | Action | Expected | Status |
    |---|--------|----------|--------|
    | P5-25 | Visual inspection of admin menu on the vertical touchscreen | Logo centered, yellow (`#F5C518`) border, dark (`#1A1A1A`) background, all buttons readable at arm's length | [ ] |
    | P5-26 | Tap every admin menu button with a fingertip (not stylus) | Each button registers the tap on first try; no mis-taps due to under-size targets | [ ] |
    | P5-27 | Visual inspection of updating cover during a real update | Logo + rotating spinner + "Aktualisierung läuft" + subtext; no Magicline chrome bleed-through | [ ] |
    | P5-28 | Visual inspection of Magicline content area after all Phase 5 changes | Magicline colors, fonts, and layout unchanged from Phase 4 baseline | [ ] |
    | P5-29 | Visual inspection of PAT config screen | Masked input, disabled Speichern until non-empty input, German hint text visible | [ ] |
    | P5-30 | Visual inspection of PIN lockout countdown | 48 px yellow mm:ss, non-jittering (tabular-nums), readable at 60–80 cm | [ ] |

    ## Rollback Runbook (referenced by bad-release variant)

    1. Staff notices bad-release screen on a site visit or remote RDP.
    2. Tap "PIN eingeben" → enter admin PIN → admin menu opens.
    3. Tap "Beenden" → kiosk drops to Windows desktop.
    4. Copy previous `Bee Strong POS Setup X.Y.Z.exe` via RDP/USB to the kiosk.
    5. Run the installer; it will replace the broken version.
    6. Reboot; auto-start launches the fresh install.
    7. If the new PAT is still stored, auto-update resumes on next check.
    8. If the operator wants auto-update to stay disabled, leave `autoUpdateDisabled=true` in `%AppData%\Bee Strong POS\config.json` — the diagnostic header will show "deaktiviert". Delete the flag (or tap "Auto-Update einrichten" and re-enter the PAT) to re-enable.

    ---

    *Phase 5 verification checklist — deferred human portion routes to `01-VERIFICATION.md` "Phase 5 — Deferred Physical Verification" subsection on Plan 06 completion.*
    ```
  </action>
  <verify>
    <automated>node --test test/phase5-acceptance.test.js && test -f .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md && grep -q "Phase 5 Verification Checklist" .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/phase5-acceptance.test.js` exits 0 with all 11 tests green
    - `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` exists
    - VERIFICATION.md contains sections for ADMIN-01..08 and BRAND-01..03
    - VERIFICATION.md contains at least 30 numbered P5-* checklist items
    - VERIFICATION.md includes the rollback runbook section
    - All 11 requirement IDs (ADMIN-01..08, BRAND-01..03) appear as acceptance test names
    - `node --test test/phase5-touch-target.test.js test/phase5-acceptance.test.js` both green
  </acceptance_criteria>
  <done>Phase 5 acceptance test + VERIFICATION.md shipped; all 11 requirements grep-anchored to code artifacts; human checklist ready for next kiosk visit.</done>
</task>

</tasks>

<verification>
1. All Phase 5 test files green: `node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js test/adminPinLockout.test.js test/sessionReset.postReset.test.js test/updateGate.test.js test/phase5-touch-target.test.js test/phase5-acceptance.test.js`
2. Phase 3/4 regression suites still green (run existing suites)
3. No raw secret patterns in any main-process log.info/warn/error
4. `grep -rE "log\\.audit\\('(startup|auth\\.state|badge\\.scanned|idle\\.reset|sale\\.completed|update\\.(check|downloaded|install|failed)|pin\\.(verify|lockout)|admin\\.(open|exit))'" src/main/` finds ≥ 10 distinct events
5. `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` exists
</verification>

<success_criteria>
- ADMIN-04 fully implemented (taxonomy events emitted, structured format)
- ADMIN-05 fully implemented (redactor applied, 5-file rotation, no raw secrets in source)
- BRAND-02 automated via CSS-level test
- All 11 Phase 5 requirements grep-anchored via acceptance test
- Human verification checklist ready for next kiosk visit (parallel to Phase 1 batch)
- No production code regression — only log-line swaps and 2 new IPC/console-message wiring points
</success_criteria>

<output>
After completion, create `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-06-SUMMARY.md` with:
- Count of log.info → log.audit migrations per file
- Test pass counts across all 7 Phase 5 test files
- Confirmation Phase 3/4 regression suites still green
- Link to 05-VERIFICATION.md
- Remaining Phase 5 work (should be zero — this is the acceptance plan)
</output>
