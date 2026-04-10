---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 01
type: execute
wave: 1
depends_on: []
files_modified:
  - package.json
  - package-lock.json
  - src/main/logger.js
  - test/logger.audit.test.js
  - test/logger.archiveLogFn.test.js
autonomous: true
requirements: [ADMIN-04, ADMIN-05]
tags: [logging, electron-log, dependencies, redaction, rotation]
must_haves:
  truths:
    - "electron-updater ^6.8.3 is listed in package.json dependencies and installed"
    - "log.audit(event, fields) exists as a function on the logger module"
    - "Calling log.audit with a `badge` field writes a line containing 8 hex chars (sha256 prefix), not the raw badge"
    - "Calling log.audit with a `password` field writes `password=***`"
    - "Calling log.audit with a `pat`/`token`/`cipher`/`ciphertext` field writes `[cipher:<len>]`, never the raw value"
    - "The archiveLogFn walks main.log → main.1.log → main.2.log → main.3.log → main.4.log → main.5.log with the 5th archive deleted on overflow"
    - "Every audit line includes `event=<name>` and `at=<ISO>` tokens"
  artifacts:
    - path: "package.json"
      provides: "electron-updater ^6.8.3 dep + electron-log caret pin"
      contains: "\"electron-updater\": \"^6.8.3\""
    - path: "src/main/logger.js"
      provides: "log.audit helper, redactor, 5-file archiveLogFn"
      contains: "log.audit = function"
    - path: "test/logger.audit.test.js"
      provides: "Unit tests for log.audit + redactor"
    - path: "test/logger.archiveLogFn.test.js"
      provides: "Unit tests for 5-file rotation chain"
  key_links:
    - from: "src/main/logger.js"
      to: "electron-log/main"
      via: "log.transports.file.archiveLogFn assignment"
      pattern: "log\\.transports\\.file\\.archiveLogFn\\s*="
---

<objective>
Add `electron-updater@^6.8.3` to dependencies and extend the existing `src/main/logger.js` with (a) a `log.audit(event, fields)` helper that writes structured redacted lines, (b) a field-name allowlist redactor for badge / password / ciphertext fields, and (c) a custom 5-file rotation `archiveLogFn` that walks `main.log → main.1.log → … → main.5.log`.

Purpose: unblock ADMIN-04 (structured audit logging with no secrets) and ADMIN-05 (max 5 rotated files); install the missing `electron-updater` dependency so Plan 04 can import it. Every other Phase 5 plan depends on this module.

Output: updated package.json + package-lock.json, rewritten `src/main/logger.js`, two unit-test files proving audit + rotation.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md
@src/main/logger.js
@CLAUDE.md
</context>

<interfaces>
Current logger.js exports (to preserve):
```javascript
// src/main/logger.js — EXISTING exports
const log = require('electron-log/main');
log.initialize();
log.transports.file.level = 'info';
log.transports.file.maxSize = 1024 * 1024; // 1 MB — KEEP
log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
log.transports.file.fileName = 'main.log';
log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';
module.exports = log;
```

All existing call sites use `log.info/warn/error(string)` — these MUST keep working after this plan. Adding `log.audit` is additive.

Contract for the new API:
```javascript
log.audit(event: string, fields?: Record<string, unknown>): void
// Writes a single log.info line in the format:
//   "event=<event> k1=v1 k2=v2 at=<ISO8601>"
// With redaction applied to fields whose key is in the allowlist sets.
```

Redaction rules (CONTEXT.md D-25, RESEARCH §Pattern 5):
- BADGE_FIELDS = {'badge','badgeId','member','memberId'} → sha256(value).slice(0,8)
- SECRET_FIELDS = {'password','pass','pwd'} → '***'
- CIPHER_FIELDS = {'cipher','ciphertext','token','pat'} → '[cipher:<len>]'
- Other keys: pass value through via String(value)

5-file rotation chain (RESEARCH §Pattern 4 — corrected):
1. Delete `main.5.log` if exists
2. Rename `main.4.log` → `main.5.log`
3. Rename `main.3.log` → `main.4.log`
4. Rename `main.2.log` → `main.3.log`
5. Rename `main.1.log` → `main.2.log`
6. Rename `main.log` (the `oldLogFile.toString()` path) → `main.1.log`
All via sync `fs` calls. Never await inside archiveLogFn (Gotcha 4).
</interfaces>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| call site → logger | Arbitrary field values (including user input, badge numbers, PATs) cross into the logger |
| logger → disk | Rendered log lines are persisted to `%AppData%\Bee Strong POS\logs\main.log` |
| disk → RDP operator | Log files readable by any Windows user with RDP access to the kiosk account |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-01 | I (Info disclosure) | log.audit redactor — badge fields | mitigate | Field-name allowlist in BADGE_FIELDS → sha256().slice(0,8). Unit test asserts raw 10-digit badge `'4200000012345'` is replaced in output (ADMIN-05) |
| T-05-02 | I (Info disclosure) | log.audit redactor — password fields | mitigate | SECRET_FIELDS allowlist → `'***'`. Unit test asserts `{password:'hunter2'}` never appears in output |
| T-05-03 | I (Info disclosure) | log.audit redactor — PAT/token fields | mitigate | CIPHER_FIELDS allowlist → `[cipher:<len>]`. Unit test asserts `{pat:'ghp_abc123...'}` produces `pat=[cipher:N]` only |
| T-05-04 | T (Tampering) / I | archiveLogFn async race | mitigate | Use only sync fs (`fs.renameSync`, `fs.existsSync`, `fs.unlinkSync`) per RESEARCH Gotcha 4. Unit test verifies all 6 file states after simulated rotation |
| T-05-05 | D (DoS) | Unbounded log growth | mitigate | `maxSize = 1 MB` (already set) + archiveLogFn caps at 6 files total = 6 MB ceiling (ADMIN-05) |
| T-05-06 | I | Non-allowlisted field accidentally holding a secret | accept | Field-name allowlist is the contract. Plan 06 migrates all existing log sites. Non-allowlisted leaks are a Plan 06 regression, not a logger defect |
</threat_model>

<tasks>

<task type="auto" tdd="true">
  <name>Task 1: Install electron-updater and fix electron-log pin</name>
  <read_first>
    - package.json (current deps block — confirm electron-log is `~5.2.x` and electron-updater is absent)
    - CLAUDE.md §Technology Stack (electron-updater ^6.8.3, electron-log ^5.2.x pin rules)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Standard Stack + Gotcha 6
  </read_first>
  <behavior>
    - After install, `require('electron-updater').NsisUpdater` resolves to a constructor (not undefined)
    - package.json `dependencies.electron-updater` matches `^6.8.3`
    - package.json `dependencies.electron-log` is `^5.2.0` (caret, not tilde — CLAUDE.md pin)
    - `package-lock.json` is updated and committed
  </behavior>
  <action>
    1. Run `npm install --save electron-updater@^6.8.3` from repo root.
    2. Open `package.json`, confirm `"electron-updater": "^6.8.3"` appears under `dependencies`.
    3. If `"electron-log"` is pinned as `~5.2.0` (tilde), change it to `^5.2.0` (caret) per CLAUDE.md. If already `^5.2.x`, leave unchanged.
    4. Run `npm install` once more to regenerate `package-lock.json` with the caret range.
    5. Run `node -e "console.log(typeof require('electron-updater').NsisUpdater)"` — MUST print `function`.
    6. Do NOT modify any other dependency. Do NOT add electron-updater to `devDependencies`. Do NOT touch the `build` / `publish` block in package.json — PAT injection is runtime per Plan 04 (RESEARCH Pitfall 1).
  </action>
  <verify>
    <automated>node -e "const u=require('electron-updater');if(typeof u.NsisUpdater!=='function')process.exit(1);const p=require('./package.json');if(!/^\^6\.8\./.test(p.dependencies['electron-updater']))process.exit(2);if(!/^\^5\.2\./.test(p.dependencies['electron-log']))process.exit(3);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -F '"electron-updater": "^6.8.' package.json` succeeds
    - `grep -F '"electron-log": "^5.2.' package.json` succeeds
    - `node -e "require('electron-updater').NsisUpdater"` exits 0
    - `package-lock.json` contains `node_modules/electron-updater` entry
    - `npm ls electron-updater` prints `electron-updater@6.8.3` (or any `6.8.x`)
    - No changes to `devDependencies`, `build`, or `publish` blocks
  </acceptance_criteria>
  <done>electron-updater installed and importable; electron-log pin is caret per CLAUDE.md.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 2: Add log.audit helper + redactor + 5-file archiveLogFn to logger.js</name>
  <read_first>
    - src/main/logger.js (entire file — will be rewritten in-place)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-RESEARCH.md §Pattern 4 §Pattern 5 §Gotcha 4
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md §D-22 §D-25 §D-26 §D-28
    - src/main/adminPin.js (imports `./logger`; confirm `log.info/warn/error` call-site pattern)
    - src/main/sessionReset.js (also imports `./logger`)
  </read_first>
  <behavior>
    - `log.audit('badge.scanned', {badge:'4200000012345'})` writes a line whose text payload equals `event=badge.scanned badge=<8hex> at=<ISO>` where `<8hex>` is the first 8 chars of sha256('4200000012345')
    - `log.audit('pin.verify', {password:'hunter2', result:'fail'})` contains `password=***` and `result=fail`, never `hunter2`
    - `log.audit('update.downloaded', {pat:'ghp_xxx', version:'1.2.3'})` contains `pat=[cipher:7]` and `version=1.2.3`
    - `log.audit('startup', null)` writes `event=startup at=<ISO>` with no field tokens
    - The module still exports the raw `log` object — all prior `log.info/warn/error` call sites continue working
    - `log.transports.file.archiveLogFn` is assigned to a function that, when invoked with a fake LogFile whose `.toString()` returns a path, performs the rename chain using sync fs
    - `log.transports.file.maxSize` remains `1024 * 1024`
  </behavior>
  <action>
    Rewrite `src/main/logger.js` in place. Structure:

    ```javascript
    // src/main/logger.js
    // Phase 1: electron-log v5 init, 1 MB rotation
    // Phase 5: log.audit helper + redactor (ADMIN-04/05 D-25) + 5-file archiveLogFn (D-26)

    const log = require('electron-log/main');
    const fs = require('fs');
    const path = require('path');
    const crypto = require('crypto');

    log.initialize();

    // --- File transport -----------------------------------------------------
    log.transports.file.level = 'info';
    log.transports.file.maxSize = 1024 * 1024; // 1 MB (ADMIN-05)
    log.transports.file.format = '[{y}-{m}-{d} {h}:{i}:{s}.{ms}] [{level}] {text}';
    log.transports.file.fileName = 'main.log';

    // --- Phase 5 D-26: 5-file rotation chain --------------------------------
    const MAX_ARCHIVES = 5;

    log.transports.file.archiveLogFn = function archiveLog(oldLogFile) {
      // Called synchronously by electron-log when maxSize exceeded.
      // oldLogFile.toString() is the full path to main.log.
      // MUST use only sync fs (Gotcha 4).
      try {
        const currentPath = oldLogFile.toString();
        const info = path.parse(currentPath);
        const archivePath = (n) => path.join(info.dir, info.name + '.' + n + info.ext);

        // Step 1: delete main.5.log if it exists (drops oldest)
        const oldest = archivePath(MAX_ARCHIVES);
        if (fs.existsSync(oldest)) {
          fs.unlinkSync(oldest);
        }

        // Steps 2..5: walk 4→5, 3→4, 2→3, 1→2
        for (let i = MAX_ARCHIVES - 1; i >= 1; i--) {
          const src = archivePath(i);
          const dst = archivePath(i + 1);
          if (fs.existsSync(src)) {
            fs.renameSync(src, dst);
          }
        }

        // Step 6: rename main.log → main.1.log
        if (fs.existsSync(currentPath)) {
          fs.renameSync(currentPath, archivePath(1));
        }
      } catch (e) {
        // Never throw from archiveLogFn — electron-log swallows but best-effort
        // next write will still succeed into a fresh main.log.
      }
    };

    // --- Console transport --------------------------------------------------
    log.transports.console.level = process.env.NODE_ENV === 'development' ? 'debug' : 'warn';
    log.transports.console.format = '[{h}:{i}:{s}.{ms}] [{level}] {text}';

    // --- Phase 5 D-25: redactor ---------------------------------------------
    const BADGE_FIELDS  = new Set(['badge', 'badgeId', 'member', 'memberId']);
    const SECRET_FIELDS = new Set(['password', 'pass', 'pwd']);
    const CIPHER_FIELDS = new Set(['cipher', 'ciphertext', 'token', 'pat']);

    function redactValue(key, value) {
      if (BADGE_FIELDS.has(key)) {
        if (value == null) return '';
        return crypto.createHash('sha256').update(String(value)).digest('hex').slice(0, 8);
      }
      if (SECRET_FIELDS.has(key)) {
        return '***';
      }
      if (CIPHER_FIELDS.has(key)) {
        const len = typeof value === 'string' ? value.length : (value == null ? 0 : String(value).length);
        return '[cipher:' + len + ']';
      }
      return String(value);
    }

    // --- Phase 5 D-25: log.audit helper -------------------------------------
    // Canonical taxonomy (D-28): startup, startup.complete, auth.state, auth.submit,
    // auth.failure, idle.reset, badge.scanned, sale.completed, update.check,
    // update.downloaded, update.install, update.failed, pin.verify, pin.lockout,
    // admin.open, admin.exit, crash.
    log.audit = function audit(event, fields) {
      const parts = ['event=' + event];
      if (fields && typeof fields === 'object') {
        for (const k of Object.keys(fields)) {
          parts.push(k + '=' + redactValue(k, fields[k]));
        }
      }
      parts.push('at=' + new Date().toISOString());
      log.info(parts.join(' '));
    };

    // Test-only exports (non-enumerable — attached for unit tests only)
    log._redactValue = redactValue;
    log._BADGE_FIELDS = BADGE_FIELDS;
    log._SECRET_FIELDS = SECRET_FIELDS;
    log._CIPHER_FIELDS = CIPHER_FIELDS;
    log._MAX_ARCHIVES = MAX_ARCHIVES;

    module.exports = log;
    ```

    Do NOT change the module.exports shape (still the raw `log`). Do NOT remove any existing configuration. Do NOT touch `log.transports.file.fileName` or the format strings.
  </action>
  <verify>
    <automated>node -e "const l=require('./src/main/logger');if(typeof l.audit!=='function')process.exit(1);if(typeof l.transports.file.archiveLogFn!=='function')process.exit(2);if(l.transports.file.maxSize!==1024*1024)process.exit(3);if(l._MAX_ARCHIVES!==5)process.exit(4);if(typeof l.info!=='function')process.exit(5);console.log('ok');"</automated>
  </verify>
  <acceptance_criteria>
    - `grep -nE "^log\.audit\s*=\s*function" src/main/logger.js` matches
    - `grep -nE "archiveLogFn\s*=\s*function archiveLog" src/main/logger.js` matches
    - `grep -nE "BADGE_FIELDS\s*=\s*new Set\(\[" src/main/logger.js` matches
    - `grep -nE "MAX_ARCHIVES\s*=\s*5" src/main/logger.js` matches
    - `grep -nE "fs\.renameSync" src/main/logger.js` matches at least twice (loop + final rename)
    - `grep -nE "crypto\.createHash\('sha256'\)" src/main/logger.js` matches
    - `grep -n "maxSize = 1024 \* 1024" src/main/logger.js` matches (size preserved)
    - `node --check src/main/logger.js` exits 0
    - `node -e "const l=require('./src/main/logger');if(!l.audit||!l._redactValue)process.exit(1);"` exits 0
    - No use of `fs.promises`, `await`, `async` inside archiveLogFn (`grep -n "await\|async\|fs\.promises" src/main/logger.js` MUST print nothing inside the archiveLogFn block — verify manually or via a narrower grep)
  </acceptance_criteria>
  <done>logger.js exports `log` with a working `log.audit`, a redactor, and a 5-file sync archiveLogFn. All prior log.info/warn/error call sites remain valid.</done>
</task>

<task type="auto" tdd="true">
  <name>Task 3: Unit tests for log.audit redactor and archiveLogFn rotation</name>
  <read_first>
    - src/main/logger.js (post Task 2 rewrite)
    - test/ (any existing *.test.js for the test harness pattern — reuse node --test or whatever Phase 3/4 used)
    - .planning/phases/04-nfc-input-idle-session-lifecycle/ for an example test file structure if needed
  </read_first>
  <behavior>
    - Test file 1 (audit): asserts redaction for every field in each allowlist, asserts pass-through for non-allowlisted fields, asserts `event=` prefix and `at=` suffix, asserts log.audit is a no-throw on null/undefined fields
    - Test file 2 (rotation): creates a temp dir with `main.log` + `main.1.log` + `main.4.log` + `main.5.log`, invokes archiveLogFn with a fake LogFile whose `.toString()` returns the temp main.log path, asserts final state: no `main.log` (renamed to `main.1`), `main.1`→`main.2`, `main.4`→`main.5`, old `main.5` gone
  </behavior>
  <action>
    Create `test/logger.audit.test.js`:

    ```javascript
    // test/logger.audit.test.js
    const test = require('node:test');
    const assert = require('node:assert');
    const crypto = require('crypto');

    // Stub out electron-log before requiring logger so tests run without electron.
    // electron-log/main works in a plain Node context; if initialize() throws,
    // we just need the module to load far enough to install .audit.
    const log = require('../src/main/logger');

    // Capture log.info output by monkey-patching.
    function captureAudit(fn) {
      const captured = [];
      const orig = log.info;
      log.info = (msg) => captured.push(msg);
      try { fn(); } finally { log.info = orig; }
      return captured;
    }

    test('audit: emits event= and at= tokens for no-fields call', () => {
      const [line] = captureAudit(() => log.audit('startup'));
      assert.match(line, /^event=startup /);
      assert.match(line, / at=\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/);
    });

    test('audit: redacts badge field to sha256 slice(0,8)', () => {
      const raw = '4200000012345';
      const expected = crypto.createHash('sha256').update(raw).digest('hex').slice(0, 8);
      const [line] = captureAudit(() => log.audit('badge.scanned', { badge: raw }));
      assert.ok(line.includes('badge=' + expected), 'line: ' + line);
      assert.ok(!line.includes(raw), 'raw badge leaked: ' + line);
    });

    test('audit: redacts badgeId, member, memberId fields', () => {
      for (const key of ['badgeId', 'member', 'memberId']) {
        const [line] = captureAudit(() => log.audit('t', { [key]: 'secret-value-123' }));
        assert.ok(!line.includes('secret-value-123'), key + ' leaked: ' + line);
        assert.match(line, new RegExp(key + '=[0-9a-f]{8}'));
      }
    });

    test('audit: redacts password/pass/pwd to ***', () => {
      for (const key of ['password', 'pass', 'pwd']) {
        const [line] = captureAudit(() => log.audit('t', { [key]: 'hunter2' }));
        assert.ok(!line.includes('hunter2'), key + ' leaked: ' + line);
        assert.ok(line.includes(key + '=***'), 'no *** for ' + key + ': ' + line);
      }
    });

    test('audit: redacts cipher/ciphertext/token/pat to [cipher:<len>]', () => {
      for (const key of ['cipher', 'ciphertext', 'token', 'pat']) {
        const [line] = captureAudit(() => log.audit('t', { [key]: 'ghp_abcdef' }));
        assert.ok(!line.includes('ghp_abcdef'), key + ' leaked: ' + line);
        assert.match(line, new RegExp(key + '=\\[cipher:10\\]'));
      }
    });

    test('audit: passes non-allowlisted fields through as String()', () => {
      const [line] = captureAudit(() => log.audit('t', { version: '1.2.3', count: 42 }));
      assert.ok(line.includes('version=1.2.3'));
      assert.ok(line.includes('count=42'));
    });

    test('audit: handles null/undefined fields without throwing', () => {
      assert.doesNotThrow(() => log.audit('t', null));
      assert.doesNotThrow(() => log.audit('t', undefined));
      assert.doesNotThrow(() => log.audit('t'));
    });

    test('audit: multiple fields serialise in iteration order', () => {
      const [line] = captureAudit(() => log.audit('update.check', { version: '1.0', result: 'ok' }));
      assert.match(line, /^event=update\.check version=1\.0 result=ok at=/);
    });
    ```

    Create `test/logger.archiveLogFn.test.js`:

    ```javascript
    // test/logger.archiveLogFn.test.js
    const test = require('node:test');
    const assert = require('node:assert');
    const fs = require('fs');
    const path = require('path');
    const os = require('os');

    const log = require('../src/main/logger');

    function makeFakeLogFile(p) {
      return { toString: () => p };
    }

    test('archiveLogFn: rotates main.log → main.1.log on first call', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
      const main = path.join(dir, 'main.log');
      fs.writeFileSync(main, 'current');

      log.transports.file.archiveLogFn(makeFakeLogFile(main));

      assert.ok(!fs.existsSync(main), 'main.log should have been renamed');
      assert.ok(fs.existsSync(path.join(dir, 'main.1.log')), 'main.1.log should exist');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'main.1.log'), 'utf8'), 'current');

      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('archiveLogFn: walks chain main.1→2, main.2→3, main.3→4, main.4→5', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
      const main = path.join(dir, 'main.log');
      fs.writeFileSync(main, 'current');
      fs.writeFileSync(path.join(dir, 'main.1.log'), 'one');
      fs.writeFileSync(path.join(dir, 'main.2.log'), 'two');
      fs.writeFileSync(path.join(dir, 'main.3.log'), 'three');
      fs.writeFileSync(path.join(dir, 'main.4.log'), 'four');

      log.transports.file.archiveLogFn(makeFakeLogFile(main));

      assert.strictEqual(fs.readFileSync(path.join(dir, 'main.1.log'), 'utf8'), 'current');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'main.2.log'), 'utf8'), 'one');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'main.3.log'), 'utf8'), 'two');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'main.4.log'), 'utf8'), 'three');
      assert.strictEqual(fs.readFileSync(path.join(dir, 'main.5.log'), 'utf8'), 'four');
      assert.ok(!fs.existsSync(main));

      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('archiveLogFn: deletes main.5.log when chain is full (no 6th file)', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
      const main = path.join(dir, 'main.log');
      fs.writeFileSync(main, 'current');
      fs.writeFileSync(path.join(dir, 'main.1.log'), 'one');
      fs.writeFileSync(path.join(dir, 'main.2.log'), 'two');
      fs.writeFileSync(path.join(dir, 'main.3.log'), 'three');
      fs.writeFileSync(path.join(dir, 'main.4.log'), 'four');
      fs.writeFileSync(path.join(dir, 'main.5.log'), 'five-GONE');

      log.transports.file.archiveLogFn(makeFakeLogFile(main));

      // five-GONE must be unlinked, not survive as a 6th file
      assert.strictEqual(fs.readFileSync(path.join(dir, 'main.5.log'), 'utf8'), 'four');
      assert.ok(!fs.readdirSync(dir).includes('main.6.log'));
      // Total files in dir = main.1..5 = 5 files, no main.log
      const files = fs.readdirSync(dir).filter(f => f.startsWith('main'));
      assert.strictEqual(files.length, 5, 'expected exactly 5 archives, got: ' + files.join(','));

      fs.rmSync(dir, { recursive: true, force: true });
    });

    test('archiveLogFn: does not throw on a missing main.log', () => {
      const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bsk-logrotate-'));
      const main = path.join(dir, 'main.log');
      assert.doesNotThrow(() => log.transports.file.archiveLogFn(makeFakeLogFile(main)));
      fs.rmSync(dir, { recursive: true, force: true });
    });
    ```

    Run both test files with `node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js`.
  </action>
  <verify>
    <automated>node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js</automated>
  </verify>
  <acceptance_criteria>
    - `node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js` exits 0
    - Output contains `# pass 12` (8 audit tests + 4 rotation tests) or equivalent all-green summary
    - No `# fail` lines
    - `grep -nE "badge=[0-9a-f]{8}" test/logger.audit.test.js` matches
    - `grep -nE "five-GONE" test/logger.archiveLogFn.test.js` matches
    - Tests use only Node builtins (`node:test`, `node:assert`, `fs`, `path`, `os`, `crypto`) — no new npm deps
  </acceptance_criteria>
  <done>Two test files green; redactor + 5-file chain proven by unit tests.</done>
</task>

</tasks>

<verification>
1. `node -e "require('electron-updater').NsisUpdater"` exits 0
2. `node --check src/main/logger.js` exits 0
3. `node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js` all green
4. `grep -c "^log\.audit" src/main/logger.js` ≥ 1
5. No existing `log.info(...)` call site in `src/main/` breaks (run Phase 3/4 existing test suites — they must still pass)
</verification>

<success_criteria>
- electron-updater@^6.8.3 installed and importable
- `log.audit(event, fields)` exists and redacts badge/secret/cipher fields correctly
- 5-file archiveLogFn proven via unit test (main.log → main.1.log → … → main.5.log → deleted)
- All pre-existing log.info/warn/error call sites keep working (no logger export shape change)
- Existing Phase 3/4 test suites still pass
</success_criteria>

<output>
After completion, create `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-01-SUMMARY.md` with:
- Final package.json diff (lines added/changed)
- logger.js final exports list
- Test output (pass count)
- Any gotchas hit during archiveLogFn implementation
</output>
