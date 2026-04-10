---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 01
subsystem: logging
tags: [logging, electron-log, electron-updater, redaction, rotation, dependencies]
requires:
  - electron-log ^5.2.0 (already in deps)
  - electron-store ^10.1.0 (already in deps)
provides:
  - log.audit(event, fields) helper
  - field-name-allowlist redactor (BADGE/SECRET/CIPHER)
  - 5-file sync archiveLogFn chain
  - electron-updater ^6.8.3 available for import
affects:
  - every Phase 5 plan (05-02..05-06) consumes log.audit
  - Plan 05-03/04 imports electron-updater for NsisUpdater
tech-stack:
  added:
    - electron-updater ^6.8.3
  patterns:
    - sync-only archiveLogFn per electron-log v5 contract
    - field-name allowlist redaction (no regex scanning of values)
    - sha256(0,8) badge correlation hash
key-files:
  created:
    - test/logger.audit.test.js
    - test/logger.archiveLogFn.test.js
  modified:
    - package.json
    - package-lock.json
    - src/main/logger.js
decisions:
  - Tilde pin on electron-log flipped to caret per CLAUDE.md explicit pin rule
  - MAX_ARCHIVES=5 → 6 MB disk ceiling (1 MB maxSize × 6 files)
  - Test-only exports (_redactValue, _BADGE_FIELDS, _MAX_ARCHIVES) attached for unit-test visibility without widening public API
  - archiveLogFn wrapped in try/catch that swallows — never throw from the rotation hook per RESEARCH Gotcha 4
metrics:
  duration: "~2.5 min"
  completed: 2026-04-10
  tasks: 3
  commits: 3
---

# Phase 5 Plan 01: Logger & Dependencies Summary

**One-liner:** Installed `electron-updater@^6.8.3` and extended `src/main/logger.js` with a structured `log.audit` helper, a field-name-allowlist redactor (badge→sha256, password→***, cipher→[cipher:len]), and a sync 5-file `archiveLogFn` rotation chain capping logs at 6 MB total.

## What Shipped

### Dependencies (Task 1)
- `electron-updater@^6.8.3` added to `dependencies` (nothing in devDependencies, nothing in `build`/`publish` — PAT injection stays runtime per 05-CONTEXT D-18).
- `electron-log` pin flipped `~5.2.0` → `^5.2.0` per CLAUDE.md caret rule.
- `package-lock.json` regenerated; `npm ls electron-updater` → `electron-updater@6.8.3`.

### Logger Extensions (Task 2)
Rewrote `src/main/logger.js` in place while preserving every pre-Phase-5 export. Additions:

1. **`log.audit(event, fields)`** — emits `event=<name> k=v k=v at=<ISO>` via `log.info`, so the existing file transport, format string, and maxSize all apply unchanged.
2. **Field-name allowlist redactor** — three `Set`s drive a switch on each key:
   - `BADGE_FIELDS = {badge, badgeId, member, memberId}` → `crypto.sha256(value).slice(0,8)`
   - `SECRET_FIELDS = {password, pass, pwd}` → `'***'`
   - `CIPHER_FIELDS = {cipher, ciphertext, token, pat}` → `'[cipher:<len>]'`
   - Everything else: `String(value)` passthrough.
3. **`log.transports.file.archiveLogFn`** — called synchronously by electron-log when `maxSize` is exceeded. Walks the chain `main.5.log` (deleted) ← `main.4.log` ← `main.3.log` ← `main.2.log` ← `main.1.log` ← `main.log`, all via `fs.renameSync` / `fs.unlinkSync` / `fs.existsSync`. Wrapped in try/catch that swallows so a rotation glitch cannot crash the main process.
4. **`MAX_ARCHIVES = 5`** + existing `maxSize = 1 MB` → hard 6 MB disk ceiling (ADMIN-05).

Test-only exports attached for unit-test visibility: `_redactValue`, `_BADGE_FIELDS`, `_SECRET_FIELDS`, `_CIPHER_FIELDS`, `_MAX_ARCHIVES`. `module.exports` still returns the raw `log` object — all existing `log.info/warn/error` call sites keep working without touching them.

### Unit Tests (Task 3)
Two new files, both using Node's built-in `node:test`/`node:assert` (no new devDeps):

- **`test/logger.audit.test.js`** (8 tests) — no-fields event format, badge sha256 redaction proven against a real 10-digit badge, badgeId/member/memberId alternates, password/pass/pwd → `***`, cipher/ciphertext/token/pat → `[cipher:10]`, non-allowlisted pass-through, null/undefined safety, iteration-order serialisation.
- **`test/logger.archiveLogFn.test.js`** (4 tests) — first-rotate, full 5-file chain walk with payload content assertions at every slot, oldest-file deletion with `five-GONE` canary, missing-`main.log` safety.

**Results:** `node --test` → 12/12 green. Phase 3/4 regression suite re-run → **208/208 still green** (no logger consumers broke).

## Verification

| Check | Result |
|---|---|
| `require('electron-updater').NsisUpdater` is a function | PASS |
| `package.json` `electron-updater` → `^6.8.3` | PASS |
| `package.json` `electron-log` → `^5.2.0` (caret) | PASS |
| `npm ls electron-updater` → `electron-updater@6.8.3` | PASS |
| `node --check src/main/logger.js` | PASS |
| Logger exports: `audit`, `archiveLogFn`, `maxSize=1 MB`, `_MAX_ARCHIVES=5` | PASS |
| `node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js` | 12/12 PASS |
| Pre-existing Phase 3/4 suites | 208/208 PASS |

## Key Decisions

- **Caret flip on electron-log.** CLAUDE.md states the pin rule is `^5.2.0`, not `~5.2.0`. The Phase 1 logger was stricter than the project rule; Phase 5 aligns them.
- **Swallow in archiveLogFn.** Per RESEARCH Gotcha 4: `electron-log` does not define recovery semantics for a throwing `archiveLogFn`, so the safest posture is "best-effort + continue". The next write still succeeds into a fresh `main.log`.
- **Test-only exports via `_`-prefix.** Avoids introducing a parallel module just for testability; keeps the public surface `log.info/warn/error/audit` while still letting unit tests reach internals.
- **No value-scanning redactor.** D-25 is explicit: redaction is field-name-allowlist only. A value-pattern scanner would be both slower and prone to false positives. The Plan 06 migration is what makes the allowlist sufficient in practice.

## Threat Model Coverage

All `mitigate` rows in the PLAN threat register have unit-test backing:

| Threat | Mitigation | Test |
|---|---|---|
| T-05-01 (badge info disclosure) | `BADGE_FIELDS` → sha256(0,8) | `audit: redacts badge field to sha256 slice(0,8)` + `badgeId/member/memberId` |
| T-05-02 (password info disclosure) | `SECRET_FIELDS` → `'***'` | `audit: redacts password/pass/pwd to ***` |
| T-05-03 (PAT/token info disclosure) | `CIPHER_FIELDS` → `'[cipher:<len>]'` | `audit: redacts cipher/ciphertext/token/pat to [cipher:<len>]` |
| T-05-04 (archiveLogFn async race) | Sync fs only, no await/async | `archiveLogFn: walks chain ...` + full file-state assertions |
| T-05-05 (unbounded log growth) | `maxSize=1 MB` × `MAX_ARCHIVES=5+1` = 6 MB ceiling | `archiveLogFn: deletes main.5.log when chain is full` |

T-05-06 remains `accept` per the plan — Plan 05-06 handles the call-site migration.

## Deviations from Plan

**None.** Plan 05-01 executed exactly as written. The caret pin flip was planned in Task 1 Action Step 3.

## Commits

| Task | Type | Hash | Message |
|---|---|---|---|
| 1 | chore | `694ce9c` | add electron-updater ^6.8.3 and caret-pin electron-log |
| 2 | feat | `becc710` | add log.audit helper, redactor, and 5-file archiveLogFn |
| 3 | test | `85c04a9` | add unit tests for log.audit redactor and archiveLogFn |

## package.json Diff

```diff
 "dependencies": {
-  "electron-log": "~5.2.0",
-  "electron-store": "^10.1.0"
+  "electron-log": "^5.2.0",
+  "electron-store": "^10.1.0",
+  "electron-updater": "^6.8.3"
 },
```
(+8 transitive packages via `npm install`.)

## logger.js Final Exports

- `log.info / warn / error / debug / verbose / silly` (pre-existing, untouched)
- `log.initialize()` (pre-existing)
- `log.transports.file.*` — `level`, `maxSize=1 MB`, `format`, `fileName='main.log'`, `archiveLogFn` (new)
- `log.transports.console.*` — `level`, `format` (pre-existing)
- `log.audit(event, fields)` (new)
- Test-only: `log._redactValue`, `log._BADGE_FIELDS`, `log._SECRET_FIELDS`, `log._CIPHER_FIELDS`, `log._MAX_ARCHIVES`

## Test Output

```
tests 12   pass 12   fail 0
  ✔ audit: emits event= and at= tokens for no-fields call
  ✔ audit: redacts badge field to sha256 slice(0,8)
  ✔ audit: redacts badgeId, member, memberId fields
  ✔ audit: redacts password/pass/pwd to ***
  ✔ audit: redacts cipher/ciphertext/token/pat to [cipher:<len>]
  ✔ audit: passes non-allowlisted fields through as String()
  ✔ audit: handles null/undefined fields without throwing
  ✔ audit: multiple fields serialise in iteration order
  ✔ archiveLogFn: rotates main.log -> main.1.log on first call
  ✔ archiveLogFn: walks chain main.1->2, main.2->3, main.3->4, main.4->5
  ✔ archiveLogFn: deletes main.5.log when chain is full (no 6th file)
  ✔ archiveLogFn: does not throw on a missing main.log
```

## Gotchas Hit

None. The `path.parse` approach for building `main.<n>.log` paths handled the filename correctly on first try. `LF → CRLF` warnings from Git on Windows are benign (repo-wide convention) and do not affect diffs.

## Known Stubs

None.

## Next Plan

Plan 05-02: `adminPinLockout.js` wrapper — consumes `log.audit('pin.verify', ...)` and `log.audit('pin.lockout', ...)` from this plan.

## Self-Check: PASSED

- `src/main/logger.js` — FOUND (modified)
- `package.json` — FOUND (modified, contains `"electron-updater": "^6.8.3"`)
- `package-lock.json` — FOUND (contains `node_modules/electron-updater` entry)
- `test/logger.audit.test.js` — FOUND (created)
- `test/logger.archiveLogFn.test.js` — FOUND (created)
- Commit `694ce9c` — FOUND in `git log`
- Commit `becc710` — FOUND in `git log`
- Commit `85c04a9` — FOUND in `git log`
