---
quick_id: 260414-iiv
description: Ship 0.1.3 patch — fix release asset filename mismatch + flip update window to 09:00–12:00
created: 2026-04-14
mode: quick
must_haves:
  truths:
    - "package.json artifactName uses no spaces (hyphen-only or compact form)"
    - "electron-builder produces dist/<hyphen-named>-Setup-0.1.3.exe with no spaces in filename"
    - "latest.yml references the same hyphen-named file as the actual dist output"
    - "src/main/updateGate.js MAINTENANCE_HOUR_START = 9 and MAINTENANCE_HOUR_END = 12"
    - "test/updateGate.test.js maintenance-window test fixture uses getHour: () => 9 (not 3)"
    - "All test/updateGate.test.js tests pass"
    - "package.json version = 0.1.3"
    - "Two referencing doc files updated to mention 09:00-12:00 instead of 03:00-05:00"
    - "v1.0 git tag still on commit 403f860 (unchanged)"
  artifacts:
    - "src/main/updateGate.js with new constants"
    - "test/updateGate.test.js with updated fixtures"
    - "package.json with new artifactName + bumped version"
    - "Updated 05-VERIFICATION.md and v1.0-KIOSK-VISIT.md doc references"
  key_links:
    - "src/main/updateGate.js — MAINTENANCE_HOUR_START + MAINTENANCE_HOUR_END constants"
    - "test/updateGate.test.js — getHour fixtures"
    - "package.json — build.win.artifactName + version"
    - ".planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md — 4 references"
    - "docs/runbook/v1.0-KIOSK-VISIT.md — P5-20 reference"
---

# Quick Task 260414-iiv — Ship 0.1.3 patch

## Why

Two findings from the 0.1.2 kiosk visit on 2026-04-14:

1. **Release asset filename mismatch (P0 for any future release).** electron-builder produces `dist/Bee Strong POS-Setup-X.X.X.exe` (with spaces). `latest.yml` references it as `Bee-Strong-POS-Setup-X.X.X.exe` (hyphens). `gh release create` uploads it as `Bee.Strong.POS-Setup-X.X.X.exe` (dots). All three names disagree → electron-updater 404s on the download URL. Hot-fixed for v0.1.2 by manually renaming the GitHub assets, but the next release would break again. Captured in todo `2026-04-14-fix-release-asset-filename-mismatch.md`.

2. **Update maintenance window is wrong for Bee Strong (operational).** The kiosk's auto-update safe-window is 03:00–05:00 (hardcoded in `src/main/updateGate.js`). Bee Strong is open 24/7 with real night traffic, so 03:00–05:00 is exactly when members are most likely to be using the kiosk. The right window is daytime, around 09:00–12:00. Captured in the larger todo `2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md`, which agreed to bundle the constant flip into the next 0.1.x patch ahead of the full feature.

Both fixes are tiny constant changes + doc updates. Bundling them into one 0.1.3 patch.

## Scope (locked)

### Code changes

1. **`package.json` — artifactName fix.** Change `build.win.artifactName` from `"${productName}-Setup-${version}.${ext}"` to `"bee-strong-pos-Setup-${version}.${ext}"` (hyphen-only, no spaces). Effect: electron-builder produces `dist/bee-strong-pos-Setup-0.1.3.exe`, latest.yml references the same name, gh release create uploads it verbatim. All three places agree.

2. **`src/main/updateGate.js` — maintenance window constants.**
   - `MAINTENANCE_HOUR_START = 3` → `9`
   - `MAINTENANCE_HOUR_END = 5` → `12`
   - Update the comment at top of file from "03:00–05:00 maintenance window" → "09:00–12:00 maintenance window"
   - Update inline comments "03:00 inclusive" → "09:00 inclusive" and "05:00 exclusive → hours 3, 4" → "12:00 exclusive → hours 9, 10, 11"
   - Effect: `updateGate.fireWith('maintenance-window')` is allowed only during 09:00, 10:00, 11:00. Hours 3, 4 no longer count.

3. **`test/updateGate.test.js` — test fixture update.**
   - Find the maintenance-window test that uses `getHour: () => 3` and change to `getHour: () => 9` (or `10` or `11`, any hour in the new window).
   - Verify any test that uses `getHour: () => 12` still works — 12 was outside the window before (3,4 only) and is also outside the window now (9,10,11 only), so this should still pass without changes.
   - Run the full test file to confirm green.

### Version bump

4. **`package.json` — version bump.** `"version": "0.1.2"` → `"version": "0.1.3"`.

### Documentation updates

5. **`.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md`** — 4 references to "03:00–05:00" or "hours 3,4":
   - `why_human` text
   - `SC-2` "wait for idle reset or 03:00–05:00 window"
   - `05-03 update-gate+session-hook` "isMaintenanceWindow true only for hours 3,4"
   - `ADMIN-07` "post-reset or 03:00–05:00"
   - `P5-20` "Alternatively wait until 03:00–05:00 window"
   - Update all to reflect 09:00–12:00 / hours 9,10,11.

6. **`docs/runbook/v1.0-KIOSK-VISIT.md`** — P5-20 row mentions "03:00–05:00 window with a downloaded update". Update to "09:00–12:00 window".

7. **`.planning/todos/pending/2026-04-14-fix-release-asset-filename-mismatch.md`** — add a "Resolved 2026-04-14 in quick task 260414-iiv (shipped in 0.1.3)" note at the top, mark the file for migration to `.planning/todos/completed/` after the patch ships.

8. **`.planning/todos/pending/2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md`** — add a note that the bundled constant flip portion has been completed in 0.1.3; the full POS open/close toggle feature remains as a v1.1 todo.

## Out of scope

- The full POS open/close admin toggle (the larger half of todo `2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md`). Only the constant flip lands in 0.1.3.
- Any other todo in `.planning/todos/pending/`.
- Building the installer (`npm run build`) — the orchestrator runs this AFTER executor finishes so the artifact lives in the main repo's `dist/`, not inside a worktree.
- Pushing or publishing the new release — orchestrator handles after build.
- Touching the v1.0 git tag.

## Tasks (single plan)

### Task 1 — Execute the patch

**Files (read first):**
- `src/main/updateGate.js`
- `test/updateGate.test.js`
- `package.json`
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md`
- `docs/runbook/v1.0-KIOSK-VISIT.md`
- `.planning/todos/pending/2026-04-14-fix-release-asset-filename-mismatch.md`
- `.planning/todos/pending/2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md`

**Action:**
- Execute scope items 1–3 (code + tests) in one logical commit: `fix: rename release artifact + flip update window to 09-12 (0.1.3 patch)`
- Execute scope items 5–8 (docs + todo annotations) in a second logical commit: `docs: update verification + runbook + todo notes for 0.1.3 changes`
- Execute scope item 4 (version bump) in a third logical commit: `chore: bump version to 0.1.3`
- Move `2026-04-14-fix-release-asset-filename-mismatch.md` from `pending/` to `completed/` in the docs commit (it's now resolved by this patch).

**Verify (executor must run before declaring done):**
- `node --test test/updateGate.test.js` → all green
- `node --test test/*.test.js` → full suite all green (272/272 expected — no other tests should be affected)
- `grep "MAINTENANCE_HOUR_START = 9" src/main/updateGate.js` → 1 match
- `grep "MAINTENANCE_HOUR_END = 12" src/main/updateGate.js` → 1 match
- `grep "bee-strong-pos-Setup" package.json` → 1 match in build.win.artifactName
- `grep '"version": "0.1.3"' package.json` → 1 match
- `grep -c "03:00" .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` → 0 matches (all flipped to 09:00)
- `grep -c "03:00" docs/runbook/v1.0-KIOSK-VISIT.md` → 0 matches in the auto-update section (P5-20 row)
- `git tag -l v1.0` → still printed
- `git log v1.0..HEAD --oneline` → shows the new 3 commits + previous commits

**Done when:**
- All 8 scope items completed
- Test suite green
- 3 atomic commits (or ≤3 if logically tight)
- SUMMARY.md written at `.planning/quick/260414-iiv-ship-0-1-3-patch-fix-release-asset-filen/260414-iiv-SUMMARY.md`

## Notes to the executor

- Hours 9, 10, 11 are inclusive in the new window. Hour 12 is excluded (matches the existing `h >= START && h < END` semantics).
- The hyphen-only `artifactName` change means future `dist/` builds will have a different filename. Any scripts or docs that hardcode `Bee Strong POS-Setup-*.exe` will need updating — do a grep for any references and update them too.
- Do NOT touch any other todo files beyond the two listed in scope items 7 and 8.
- Do NOT push, do NOT publish, do NOT run `npm run build`. Orchestrator handles those.
- Do NOT touch the `v1.0` git tag.
- Do NOT update `.planning/ROADMAP.md` (quick tasks don't write to roadmap).
