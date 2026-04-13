---
phase: 06-welcome-screen-lifecycle-redesign
plan: 04
subsystem: verification
tags: [verification, harness, welcome-screen, idle, next-visit-batch]
requires:
  - "06-01 (host welcome layer + preload IPC + 10s countdown)"
  - "06-02 (idleTimer 10s + sessionReset welcome branch)"
  - "06-03 (main.js cold-boot-to-welcome + welcome:tap handler)"
provides:
  - "5-cycle welcome-mode hardReset harness (test/sessionReset.welcome-harness.test.js)"
  - "06-VERIFICATION.md — Phase 6 requirement→test acceptance matrix"
  - "Phase 6 row in the Phase 1 consolidated next-visit batch"
affects:
  - test/sessionReset.welcome-harness.test.js
  - .planning/phases/06-welcome-screen-lifecycle-redesign/06-VERIFICATION.md
  - .planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md
tech-stack:
  added: []
  patterns:
    - "node:test + require.cache override mock swapping (replicates test/sessionReset.test.js exactly)"
    - "Virtual-path Module._resolveFilename hook for ./idleTimer (Plan 04-02 canonical form)"
key-files:
  created:
    - test/sessionReset.welcome-harness.test.js
    - .planning/phases/06-welcome-screen-lifecycle-redesign/06-VERIFICATION.md
    - .planning/phases/06-welcome-screen-lifecycle-redesign/06-04-SUMMARY.md
  modified:
    - .planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md
decisions:
  - "Harness placed at test/sessionReset.welcome-harness.test.js (not tests/main/... — project convention is flat test/ dir per existing test/*.test.js)"
  - "Plan's jest skeleton rewritten to node:test with require.cache mocks matching test/sessionReset.test.js exactly — node --test is the canonical runner on this repo"
  - "One single-test file with 6 assertions inside (mirrors test/sessionReset.harness.js Phase 4 approach of asserting a loop's aggregate invariants inside one test body rather than one test per assertion)"
  - "Phase 6 next-visit row appended AFTER the Phase 5 block, BEFORE the Gaps Summary header — keeps chronological ordering consistent with Phase 3/4/5 stacking"
  - "No pre-existing 'Total next-visit items:' counter found anywhere in 01-VERIFICATION.md — added one inline in the new Phase 6 subsection only, scoped to 'items added for Phase 6: 1'"
metrics:
  duration: "~8 min"
  completed: 2026-04-13
  tasks: 2
  commits: 3 (pending orchestrator hand-commit — sandbox pattern same as 06-02 Task 2 + 06-03)
---

# Phase 6 Plan 04: 5-Cycle Welcome Harness + 06-VERIFICATION.md + Phase 1 Next-Visit Row Summary

Closes Phase 6 with verification artifacts: a 5-cycle welcome-mode hardReset harness that mirrors the Phase 4 100-cycle reset harness pattern at smaller scale, a new 06-VERIFICATION.md that maps every phase requirement to its automated or physical verification step, and a new Phase 6 row appended to the Phase 1 consolidated next-visit batch so the physical welcome-loop check ships with the rest of the deferred kiosk-visit items. No production code changes — tests + docs only.

## What Was Built

### Task 1 — `test/sessionReset.welcome-harness.test.js`

New single-test harness file. Mocking strategy and module-resolution hook are byte-identical to `test/sessionReset.test.js`: `require.cache` override for `electron` + `./logger` + `./magiclineView`, and a `Module._resolveFilename` hook that maps `./idleTimer` to a virtual path for the module under test's lazy `require('./idleTimer')`. Node's built-in test runner forks per file, so this file's cache state does not leak into `test/sessionReset.test.js`.

The single test runs 5 sequential `sessionReset.hardReset({reason:'idle-expired', mode:'welcome'})` calls and asserts, inline, all 6 required invariants:

1. **6-storage wipe every cycle** — `clearStorageData` called exactly 5 times; every call's `storages` array, after sort, equals `['cachestorage','cookies','indexdb','localstorage','serviceworkers','sessionstorage']` and has length 6. `localstorage` presence explicitly reasserted per cycle (D-07).
2. **View destroyed 5×, never recreated** — `destroyMagiclineView` count === 5, `createMagiclineView` count === 0 (D-05 — welcome mode keeps the view destroyed until the next tap).
3. **`welcome:show` IPC emitted 5×** — one per cycle, filtered from the IPC call log.
4. **`loopActive` stays false after 5 cycles** — D-06 exclusion (welcome-idle-expired resets are not countable) verified at scale. The Phase 4 counter would have latched at 3; this harness proves the filter holds through 5.
5. **All 5 `resetTimestamps` entries tagged `mode === 'welcome'` + `reason === 'idle-expired'`** — rolling 60s window still holds all 5 (they land within the same millisecond window), and every entry's shape is verified individually.
6. **Pre-reset + post-reset listeners fire exactly 5 times each** — `sessionReset.onPreReset` + `sessionReset.onPostReset` subscribed once, each counter === 5 at the end.

Additional invariant (bonus, not in plan): 5 `log.audit('idle.reset', ...)` entries, each with `mode === 'welcome'` and `reason === 'idle-expired'` — confirms the Phase 5 audit taxonomy propagates through the welcome branch.

**Result:** `node --test test/sessionReset.welcome-harness.test.js` → 1/1 PASS (≈2 ms test body, 91 ms total including module load).

### Task 2A — `06-VERIFICATION.md`

New file at `.planning/phases/06-welcome-screen-lifecycle-redesign/06-VERIFICATION.md`. Sections:

- **Phase context** — goal, plan enumeration, status.
- **Acceptance Matrix** — every Phase 6 requirement (IDLE-01, IDLE-02, IDLE-03, IDLE-04, IDLE-05, AUTH-01..04, NFC-05) mapped to its automated test file(s) and physical verification pointer. D-06 IDLE-05 marked N/A physical because the loop-counter filter is 100% automated.
- **Automated Test Inventory** — table of test files + expected counts + current result (286/286 green full suite).
- **Physical Verification** — full 7-step `Phase 6 welcome-loop smoke` checklist with expected behavior, pointing to the Phase 1 consolidated batch as the canonical location.
- **Deferred Scope** — badge-scan-on-welcome, pre-warm, analytics, i18n — all explicitly out of v1.0 per `06-CONTEXT.md`.
- **D-XX Coverage** — all 8 locked decisions (D-01..D-08) mapped to their realizing plan(s).
- **Close Posture** — code-complete + automated-green, physical deferred, does not block v1.0.

### Task 2B — Phase 6 subsection appended to `01-VERIFICATION.md`

New subsection `#### Phase 6 — Welcome Loop Physical Verification (1) (added 2026-04-13)` inserted between the existing Phase 5 block and the `### Gaps Summary` header, maintaining the chronological stacking order (Phase 1 → 3 → 4 → 5 → 6).

Content:

- 7-step welcome-loop smoke checklist (single `- [ ]` row with nested numbered steps) covering cold boot → welcome paint → first tap → Magicline render → 60s idle → 10s "Noch da?" countdown → repeat ×5 → optional badge-on-welcome no-effect check.
- Pass criteria explicit: 5/5 cycles clean, no error screens, no cart persistence, countdown starts at 10, badge ignored.
- Pointer to `06-VERIFICATION.md` as the per-requirement spec (matches the Phase 4 / Phase 5 pattern of pointing back to the phase's own verification doc).

**Counter handling:** per the plan's pre-edit instruction, I ran `grep "Total next-visit items"` against `01-VERIFICATION.md` before editing. **No pre-existing counter was found anywhere in the file** — the consolidated-batch section never adopted an explicit integer total; Phase 3 / Phase 4 / Phase 5 subsections each carry their own "(N)" count in the heading (e.g. "Phase 4 — Deferred Physical Verification" with 13 rows enumerated inline). To stay consistent with that style, the new Phase 6 heading carries `(1)` and the subsection footer says `**Total next-visit items added for Phase 6: 1**`. No other occurrences exist in the file to update. This is a mild deviation from the plan's acceptance criteria literal `"updated to 20"` — the 20 target assumed a counter that does not exist in the repo's current state of this file.

## Verification

**Plan `<verify>` automated checks — both tasks:**

```
ok Acceptance Matrix
ok IDLE-02
ok welcome-harness
ok D-06
ok v1 Phase 6
ok v1 welcome-loop
```

All 6 substring checks from the plan's `node -e` verify block pass.

**Full test suite:** `node --test test/*.test.js` → **286/286 PASS** (was 285 before this plan; +1 new harness test, no regressions).

**Harness-only run:** `node --test test/sessionReset.welcome-harness.test.js` → 1/1 PASS.

## Deviations from Plan

1. **Test file location: `test/sessionReset.welcome-harness.test.js`, not `tests/main/sessionReset.welcome-harness.test.js`.** Prompt explicitly ordered this deviation ("Place file under `test/` not `tests/main/` ... to match project convention"). Repo has no `tests/main/` directory; all tests live in flat `test/*.test.js`.
2. **Test framework: `node:test`, not jest.** Prompt + existing `test/sessionReset.test.js` confirm the project uses Node's built-in test runner. Plan's jest skeleton was rewritten to use `node:test` + `assert` + `require.cache` mock swapping to match the canonical pattern.
3. **"Total next-visit items:" counter — no pre-existing occurrence in the file.** Documented above under Task 2B. Added a scoped "items added for Phase 6: 1" line inside the new subsection rather than fabricating a global total that the rest of the file never adopted. [Rule 3 — blocker: plan's pre-edit grep would have returned zero hits; the plan's literal "updated to 20" target was unattainable.]

No Rules 1/2 auto-fixes triggered — this plan is purely additive (new test file + new doc file + doc append). No pre-existing code changed.

## Decisions Realised

| D-XX | Behavior | How this plan verifies |
|------|----------|------------------------|
| D-04 | Overlay countdown = 10s | Documented in Acceptance Matrix row IDLE-02; physical step 3 checks visible countdown starts at "10" |
| D-05 | `hardReset({mode:'welcome'})` destroys view and does not recreate | Harness Assertion 2 + physical step 5 (clean cash register on next tap implies view was fully recreated from scratch) |
| D-06 | Welcome idle-expired excluded from loop counter | Harness Assertion 4 at scale (5 cycles, loopActive stays false) + physical step 6 (5 consecutive cycles without reset-loop error) |
| D-07 | Full 6-storage wipe including localstorage | Harness Assertion 1 explicitly sorts + compares the storages array per cycle and re-checks `localstorage` membership |

## Known Stubs

None. Test file and verification docs are wired end-to-end against the real `src/main/sessionReset.js` welcome branch (via mocked electron `session` + `magiclineView` + `idleTimer` + `logger`, same scheme as the existing Phase 4 test suite).

## Threat Flags

None. This plan only adds test code and documentation — no new runtime surface, no new IPC, no new trust boundaries crossed. Matches `06-04-PLAN.md` `<threat_model>` T-06-18 and T-06-19, both dispositioned `accept`.

## Commits (pending orchestrator hand-commit — same sandbox pattern as 06-02 + 06-03)

The executor did not attempt `git commit` in this run. Orchestrator should hand-commit the three staged groups using:

1. **Task 1 — harness test:**
   `test(phase-06-04): 5-cycle welcome harness`
   Files:
   - `test/sessionReset.welcome-harness.test.js`

2. **Task 2 — verification docs:**
   `docs(phase-06-04): verification + next-visit row`
   Files:
   - `.planning/phases/06-welcome-screen-lifecycle-redesign/06-VERIFICATION.md`
   - `.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md`

3. **Summary:**
   `docs(phase-06-04): summary`
   Files:
   - `.planning/phases/06-welcome-screen-lifecycle-redesign/06-04-SUMMARY.md`

## Self-Check: PASSED

- `test/sessionReset.welcome-harness.test.js`: FOUND — 1/1 test passes; full suite 286/286 green
- `.planning/phases/06-welcome-screen-lifecycle-redesign/06-VERIFICATION.md`: FOUND — all 6 plan `<verify>` substring checks pass
- `.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md`: FOUND — Phase 6 subsection present (grep `Phase 6` + `welcome-loop` both match)
- `.planning/phases/06-welcome-screen-lifecycle-redesign/06-04-SUMMARY.md`: FOUND (this file)
- No production code changed (grep of `src/` untouched this plan)
- No pre-existing tests regressed (286 vs 285 baseline, +1 new, 0 removed, 0 failing)
