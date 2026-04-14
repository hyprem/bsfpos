---
quick_id: 260414-iiv
description: Ship 0.1.3 patch — fix release asset filename mismatch + flip update window to 09:00–12:00
created: 2026-04-14
completed: 2026-04-14
mode: quick
commits:
  - fc89a88  fix(0.1.3): rename release artifact + flip update window to 09-12
  - 4c3a994  docs(0.1.3): update verification + runbook + todo notes for window/artifact changes
  - 34cb20a  chore: bump version to 0.1.3
---

# Quick Task 260414-iiv — 0.1.3 Patch Summary

Two-fix patch shipped as 0.1.3 ahead of any future auto-update release: filename mismatch (P0) and maintenance window correction.

## What changed

### Code (commit fc89a88)

- **`package.json`** — `build.win.artifactName` flipped from `"${productName}-Setup-${version}.${ext}"` (which produces `Bee Strong POS-Setup-X.Y.Z.exe` with spaces) to `"bee-strong-pos-Setup-${version}.${ext}"` (hyphen-only). After this, electron-builder's dist output, `latest.yml` reference, and `gh release` upload all agree on the same filename — closing the 3-way disagreement that 404'd electron-updater on 0.1.1 → 0.1.2. `productName` itself is unchanged so the Add/Remove Programs entry still reads "Bee Strong POS".
- **`src/main/updateGate.js`** — `MAINTENANCE_HOUR_START` 3 → 9, `MAINTENANCE_HOUR_END` 5 → 12. Header comment + inline comments updated. Effect: `isMaintenanceWindow` is true only for hours 9, 10, 11 (12 excluded by `h < END`). 03:00–05:00 was peak night traffic at a 24/7 gym — daytime morning is the correct safe window.
- **`test/updateGate.test.js`** — `isMaintenanceWindow` test case re-targeted to hours 9/10/11; the two `getHour: () => 3` fixtures (maintenance-window trigger test + first-trigger-wins test) flipped to `() => 9`. The `getHour: () => 12` fixture in the post-reset test was left alone — 12 was outside the old window (3,4) and is still outside the new window (9,10,11), so it still represents "not maintenance window" exactly as the test name claims.

### Docs (commit 4c3a994)

- **`.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md`** — 5 references flipped from 03:00–05:00 / hours 3,4 → 09:00–12:00 / hours 9,10,11: `human_verification[2].why_human`, `SC-2`, the `05-03 update-gate+session-hook` plan-row, the `ADMIN-07` requirement row, and the `P5-20` deferred-physical row. `grep -c "03:00"` is now 0.
- **`docs/runbook/v1.0-KIOSK-VISIT.md`** — P5-20 (§8.3) flipped to 09:00–12:00 with a note about the 0.1.3 change. §1.1 installer filename pattern updated to mention the hyphen-only convention from 0.1.3 onward.
- **`docs/runbook/README.md`** — installer filename example updated to mention the hyphen-only pattern from 0.1.3 onward.
- **`.planning/todos/pending/2026-04-14-fix-release-asset-filename-mismatch.md`** → **`.planning/todos/completed/`** — moved (resolved by this patch). Front-matter gained `resolved: 2026-04-14` and `resolved_by: quick 260414-iiv (shipped in 0.1.3)`, plus a "Resolved" callout at the top.
- **`.planning/todos/pending/2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md`** — annotated that the bundled constant flip is now done in 0.1.3; the full POS open/close admin toggle remains as the v1.1 scope.

### Version (commit 34cb20a)

- `package.json` `version` 0.1.2 → 0.1.3.

## Deviations from plan

**1. [Rule 1 — Bug] `test/phase5-acceptance.test.js` ADMIN-07 case hard-coded the old constants.** The plan listed test fixtures only in `test/updateGate.test.js`, but `phase5-acceptance.test.js` line 113 also asserted `MAINTENANCE_HOUR_START = 3` / `END = 5` against the source text of `updateGate.js`. Without updating it, `node --test test/*.test.js` failed. Fixed by flipping the regex literals to `9` / `12` and updating the test name to `ADMIN-07: safe-window install gate (post-reset OR 09:00-12:00)`. Folded into commit fc89a88 (same logical group: code + tests). No other test files needed changes.

**2. [Rule 2 — Missing critical info] Two extra runbook references to the old installer filename.** The plan note said "do a grep for any references and update them too." Grep turned up `docs/runbook/README.md:35` (`Bee Strong POS-Setup-0.1.0.exe`) and `docs/runbook/v1.0-KIOSK-VISIT.md:23` (`Bee Strong POS-Setup-X.Y.Z.exe`) — both active runbooks, not historical Phase 1 plan/summary docs. Updated both to mention the new hyphen pattern from 0.1.3 onward while preserving the old name as a parenthetical for older builds (the rollback drill in P5-22 still uses pre-0.1.3 installers). Folded into commit 4c3a994. The historical `.planning/phases/01-locked-down-shell-os-hardening/01-04-{PLAN,SUMMARY}.md` and `01-05-PLAN.md` files that also reference the old name were left untouched (immutable phase history).

## Verification gates — all green

| Gate | Result |
|---|---|
| `node --test test/updateGate.test.js` | 8/8 pass |
| `node --test test/*.test.js` | **272/272 pass** (no regressions vs. baseline) |
| `grep "MAINTENANCE_HOUR_START = 9" src/main/updateGate.js` | 1 match |
| `grep "MAINTENANCE_HOUR_END" src/main/updateGate.js` includes `= 12` | 1 match |
| `grep "bee-strong-pos-Setup" package.json` | 1 match |
| `grep '"version": "0.1.3"' package.json` | 1 match |
| `grep -c "03:00" .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` | **0** |
| `git tag -l v1.0` | `v1.0` (untouched) |
| `git log v1.0..HEAD --oneline` | shows 3 new 0.1.3 commits + prior history |

## What the orchestrator still needs to do

- Run `npm run build` to produce `dist/bee-strong-pos-Setup-0.1.3.exe` + `latest.yml` (executor explicitly does NOT run the builder per plan constraints).
- Tag, publish, and upload the GitHub Release.
- Verify the new artifact filename in `dist/` and `latest.yml` agree (they will — that's the whole point of fix #1).

## Self-Check: PASSED

- File `.planning/quick/260414-iiv-ship-0-1-3-patch-fix-release-asset-filen/260414-iiv-SUMMARY.md`: written by this step.
- Commit fc89a88 present in `git log`.
- Commit 4c3a994 present in `git log`.
- Commit 34cb20a present in `git log` (HEAD).
- All verification gates returned expected values.
