---
quick_id: 260414-eu9
title: Descope NFC member-badge identification from v1.0
completed: 2026-04-14
status: complete
commits:
  - 6dcc320 refactor: descope NFC member-badge identification (v1.0 post-ship adjustment)
  - 6e87ebc docs: post-ship NFC descope - update requirements, roadmap, runbook, verification
  - 0a76db1 docs: capture todo - reintroduce NFC member identification in future milestone
  - cbc9b59 chore: bump version to 0.1.2
---

# Quick Task 260414-eu9 — Descope NFC member-badge identification from v1.0

Removed the NFC badge arbiter + customer-search injection path from the codebase, updated every user-facing and planning doc to reflect that member identification is no longer performed at the kiosk, captured a v1.1 revisit option as a todo, and bumped the version to `0.1.2`. The `v1.0` git tag is unchanged (still on commit `403f860`).

## Why

Physical verification at the kiosk on 2026-04-14 surfaced a permission-policy issue: translating NFC badge IDs to Magicline members requires a Magicline staff account with **member-lookup permissions**, which the gym owner does not want to grant to the kiosk's headless `bsfkiosk` staff account. A card terminal next to the kiosk already handles all payment via Magicline's "Jetzt verkaufen" → "Kartenzahlung" flow, so member identification at the kiosk is no longer a v1.0 requirement.

## What changed

### Code + tests (commit `6dcc320`)

- **Deleted** `src/main/badgeInput.js` (133 LOC) — HID buffering + arbitration module with sentinel-null first-char fix
- **Deleted** `test/badgeInput.test.js` (280 LOC, 14 assertions)
- **`src/main/main.js`** — removed `attachBadgeInput(mainWindow.webContents)` wiring. Inline comment explains that `before-input-event` listener that remains on the host wc is admin-hotkey only, not badge-related.
- **`src/main/magiclineView.js`** —
  - Removed the second `attachBadgeInput(magiclineView.webContents)` (two-attach pattern mirror)
  - Collapsed `product-search-focused` / `product-search-blurred` event branches into a single drop-through (whitelist entries kept so inject.js emits don't log "unknown event type")
  - **Added focus call** on `cash-register-ready` after `splash:hide` and `hide-magicline-error` send: `magiclineView.webContents.executeJavaScript("(function(){try{var el=document.querySelector('[data-role=\\\"product-search\\\"] input');if(el)el.focus();}catch(e){}})();", true)`. This is the single HID path under the descope — HID-wedge keystrokes now land directly in the Magicline product-search input without main-process buffering.
- **`src/inject/inject.js`** — removed the 3s post-sale `customer-search` clear (the only remaining React-value-setter injection path). Sale audit sentinel `BSK_AUDIT_SALE_COMPLETED` is preserved.
- **`src/inject/fragile-selectors.js`** — dropped `[data-role="customer-search"]` selector entry from `STABLE_SELECTORS`. Updated `JETZT_VERKAUFEN_TEXT` comment (no longer references customer-search clear).
- **`src/inject/inject.css`** — **unchanged.** The customer-search hide rule stays as defense-in-depth so members never see the field even though the kiosk no longer writes to it.
- **`test/phase4-integration.test.js`** — comment update only (no NFC-specific assertions existed here — the badgeInput reference was a comment listing Phase 4 unit suites).
- **`test/phase5-acceptance.test.js`** — removed the `read('src/main/badgeInput.js')` and the `'badge.scanned'` event check (the suite validates the log.audit event taxonomy) and removed `src/main/badgeInput.js` from the secret-leak file list.
- **Added** `test/productSearchFocus.test.js` — new source-grep contract test with two assertions:
  1. `magiclineView.js` cash-register-ready handler contains an `executeJavaScript` call targeting `[data-role="product-search"] input` with `.focus()`
  2. Neither `main.js` nor `magiclineView.js` references `require('./badgeInput')` or `attachBadgeInput` anywhere

**Test suite:** 286/286 → 272/272 green (−14 from deleted badgeInput suite, +2 from new focus suite; net −12 tests). The Phase 4 integration suite count held steady (no NFC assertions removed).

### Documentation (commit `6e87ebc`)

10 files touched:

| File | Change |
|------|--------|
| `CLAUDE.md` | Core Value dropped "scanning their NFC badge" phrasing; card terminal mentioned |
| `.planning/PROJECT.md` | Same Core Value update + new Key Decisions table row capturing the descope rationale and outcome |
| `.planning/milestones/v1.0-REQUIREMENTS.md` | Post-ship addendum section near top; NFC-01..06 marked `(DESCOPED post-ship 2026-04-14)` inline; shipped count 42 → 36; mapping table row updated; dual Core Value (original + post-descope); Phase 4 row count 13 → 7 |
| `.planning/milestones/v1.0-ROADMAP.md` | Matching post-ship addendum paragraph near top |
| `.planning/MILESTONES.md` | New `### Post-ship scope adjustment (2026-04-14)` section under the v1.0 entry |
| `.planning/STATE.md` | Next-visit batch count 50 → 44; Phase 4 row description "13 rows" → "7 rows" + NFC descope note; Phase 6 row description NFC-05 facet N/A note |
| `docs/runbook/v1.0-KIOSK-VISIT.md` | **§6.1 NFC subsection deleted entirely** (6 rows); §6 header renamed "13 rows" → "7 rows"; §6.2 renumbered to §6.1; §6.3 log spot-checks dropped `badgeInput.commit: length=N` line; §7 optional badge-on-welcome step marked N/A; §11 Quick Reference §6.2 refs → §6.1; post-visit commit message example "50 rows passed" → "44 rows passed"; new "What changed" row 5 explaining the NFC descope; footer version bumped to 1.2 |
| `.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md` | NFC-01..06 rows replaced with a DESCOPED notice; Phase 6 optional badge-on-welcome bullet marked N/A; Phase 6 total-coverage sentence updated; log spot-checks drop the `badgeInput.commit` line |
| `.planning/phases/04-nfc-input-idle-session-lifecycle/04-VERIFICATION.md` | Top-of-file blockquote DESCOPED banner pointing at MILESTONES.md |
| `.planning/todos/pending/2026-04-14-keep-splash-visible-until-auto-selection-completes.md` | Added an N/A-under-descope bullet for NFC routing in the "Edge cases to handle" section. **Deviation note:** the plan said to "drop the NFC-routing edge case" from this file, but on reading the file there was no pre-existing NFC edge case — only Auto-selection-not-needed, Auto-selection-fails, and Touch-event swallowing. Preferred the conservative interpretation and added a note rather than deleting unrelated content. |

### New v1.1 todo (commit `0a76db1`)

Created `.planning/todos/pending/2026-04-14-reintroduce-nfc-member-identification.md` with frontmatter (created timestamp, title, area=general, files=src/main/*, src/inject/*) and a Problem section explaining the permission-policy constraint plus two revisit options:

- **Option A:** Grant member-lookup permissions to the kiosk staff account and revert the descope (last known-good implementation at the v1.0 tag, commit `403f860`)
- **Option B:** Non-Magicline identification mechanism (manual entry, QR, external directory service)

### Version bump (commit `cbc9b59`)

`package.json` 0.1.1 → 0.1.2.

## Out of scope (intentionally not done)

- **No `npm run build`** — orchestrator runs the build after executor finishes so the artifact lives in the main repo's `dist/`, not inside a worktree.
- **No push, no publish, no GitHub Release** — orchestrator / user handle.
- **`v1.0` git tag is untouched** — still on commit `403f860` as a historical marker.
- **ROADMAP.md not updated** — quick tasks don't write to roadmap.
- **Welcome lifecycle, idle timers, sessionReset, authFlow, admin menu, auto-update, branded polish, Phase 6 plumbing** — none of these were touched; the descope is surgical.
- **`inject.css` customer-search hide rule** — intentionally kept (defense-in-depth per plan scope item 5).

## Deviations from plan

1. **`test/phase4-integration.test.js` had no NFC-specific assertions.** The plan assumed NFC test cases existed in this file (scope item 7: "drop the NFC-related test cases"). On reading the file, only a single *comment* mentioned `badgeInput` (as one of the per-phase unit suites the integration suite does not duplicate). Updated the comment, made no assertion removals. — Rule 1 / conservative interpretation.

2. **Register auto-selection is NOT in `magiclineView.js`.** The plan's "Notes to the executor" suggested the cash-register-ready handler already does an `executeJavaScript` for register auto-selection (hardware fix #7 from 2026-04-12) and that the new focus call should be appended to that same block. On reading both files, the register auto-selection actually lives in `src/inject/inject.js` (function `detectAndSelectRegister()`, called from the MutationObserver rAF loop), not in `magiclineView.js`. The cash-register-ready handler in `magiclineView.js` had no pre-existing `executeJavaScript` call. Added a new, cleanly-commented `executeJavaScript` block for the focus call. This is still a single round-trip because the focus call runs once on `cash-register-ready`, not on every MutationObserver tick. — Rule 3 / plan note clarification.

3. **Splash-visible todo edit (scope item 19).** The plan instructed to "drop the NFC-routing edge case (now N/A under the descope). Leave the rest." On reading the file, there was no pre-existing NFC-routing edge case — only Auto-selection-not-needed, Auto-selection-fails, and Touch-event-swallowing. Added a strikethrough N/A note under the descope rather than deleting unrelated content (conservative). — Plan precondition unmet, conservative interpretation.

4. **`magiclineView.js` `KNOWN_EVENT_TYPES` Set kept `product-search-focused` / `product-search-blurred` entries.** The phase4-integration.test.js integration test asserts these literals exist in the Set. Rather than removing them (and having to update the test), kept them in the whitelist and collapsed the branches into a single drop-through. This preserves the test contract and avoids "unknown event type" warnings from inject.js still emitting these (the focusin/focusout listeners in inject.js are cheap and not worth touching for a descope). — Rule 3 / avoid scope creep.

5. **Log spot-check line dropped in 01-VERIFICATION.md.** The plan listed which doc sections to update but didn't explicitly mention removing the `badgeInput.commit: length=N` log spot-check. Since `badgeInput.js` is deleted, that line will never appear again, so removing the spot-check was a correctness follow-through (Rule 2). Same applies to the runbook §6 log spot-check list.

No Rule 4 (architectural) deviations. No auth gates. No blockers. No scope creep beyond the plan.

## Verification evidence

```
=== git ls-files filter ===
$ git ls-files | grep -E "src/main/badgeInput.js|test/badgeInput.test.js"
(no output — 0 matches)

=== test suite ===
$ node --test test/*.test.js
tests 272  pass 272  fail 0  duration_ms ~980

=== DESCOPED marker count ===
$ grep -c "DESCOPED" .planning/milestones/v1.0-REQUIREMENTS.md
10  (≥6 required)

=== MILESTONES post-ship section ===
$ grep "Post-ship scope adjustment" .planning/MILESTONES.md
### Post-ship scope adjustment (2026-04-14)

=== version ===
$ grep '"version"' package.json
  "version": "0.1.2",

=== v1.0 tag intact ===
$ git tag -l v1.0
v1.0

=== commits past v1.0 ===
$ git log v1.0..HEAD --oneline
cbc9b59 chore: bump version to 0.1.2
0a76db1 docs: capture todo - reintroduce NFC member identification in future milestone
6e87ebc docs: post-ship NFC descope - update requirements, roadmap, runbook, verification
6dcc320 refactor: descope NFC member-badge identification (v1.0 post-ship adjustment)
(plus 5 prior commits from 2026-04-14 morning — todo captures, auto-update wiring, runbook rewrite)
```

## Known stubs

None. The removed code paths are fully excised; no dead-data stubs left in the UI layer. The customer-search inject.css hide rule is an intentional defense-in-depth retention, not a stub.

## Threat flags

None. No new network endpoints, auth paths, file access patterns, or schema changes introduced by this task. The descope *reduces* attack surface (no HID buffer, no React-value-setter write path to a member-identifying field, no persisted-badge audit events).

## Self-Check: PASSED

- [x] `src/main/badgeInput.js` removed from git index (`git ls-files` → 0)
- [x] `test/badgeInput.test.js` removed from git index (`git ls-files` → 0)
- [x] `test/productSearchFocus.test.js` exists and runs green
- [x] `.planning/todos/pending/2026-04-14-reintroduce-nfc-member-identification.md` created
- [x] Commit `6dcc320` present in `git log` — refactor: descope NFC
- [x] Commit `6e87ebc` present in `git log` — docs: post-ship NFC descope
- [x] Commit `0a76db1` present in `git log` — docs: capture todo reintroduce
- [x] Commit `cbc9b59` present in `git log` — chore: bump version
- [x] 272/272 tests green
- [x] `"version": "0.1.2"` in package.json
- [x] `v1.0` git tag still printed by `git tag -l v1.0`
