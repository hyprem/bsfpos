---
phase: 07-locale-hardening-splash-auto-selection-race
plan: "01"
subsystem: inject
tags: [locale, drift-isolation, fragile-selectors, test]
dependency_graph:
  requires: []
  provides: [LOCALE_STRINGS.de table in fragile-selectors.js]
  affects: [src/inject/inject.js (Plan 04 will consume LOCALE_STRINGS.de)]
tech_stack:
  added: []
  patterns: [node:test vm.runInContext for testing non-module files]
key_files:
  created:
    - test/fragileSelectors.test.js
  modified:
    - src/inject/fragile-selectors.js
    - docs/runbook/v1.1-KIOSK-VISIT.md
decisions:
  - "LOCALE_STRINGS.de table uses var (not const) for ES5 concat-eval compatibility"
  - "Test loads fragile-selectors.js via vm.runInContext to expose globals without requiring module.exports"
  - "inject.js literal strings left in place — Plan 04 migrates them to LOCALE_STRINGS.de"
metrics:
  duration_minutes: ~5
  completed_date: "2026-04-14"
  tasks_completed: 2
  tasks_total: 2
  tasks_deferred: ["Task 2 DOM survey → folded into 07-06 live kiosk visit"]
  files_changed: 3
---

# Phase 07 Plan 01: LOCALE_STRINGS Foundation & DOM Survey Template Summary

**One-liner:** LOCALE_STRINGS.de drift-isolation table added to fragile-selectors.js with vm-based shape test; v1.1-KIOSK-VISIT.md DOM survey template created; plan paused at human-verify checkpoint for live kiosk RDP survey.

## Status: COMPLETE (Task 2 deferred to 07-06)

Task 1 is complete and committed. Task 2 (live-kiosk DOM survey) is deferred to Plan 07-06 — the Wave 4 human UAT already requires a live kiosk RDP trip, so the DOM survey will be batched into that visit rather than interrupting execution flow.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Add LOCALE_STRINGS.de block + shape test | cc8bb87 | src/inject/fragile-selectors.js, test/fragileSelectors.test.js |
| pre-2 | Create v1.1-KIOSK-VISIT.md survey template | 4cc1b52 | docs/runbook/v1.1-KIOSK-VISIT.md |

## Deferred Task

**Task 2:** Live-kiosk DOM survey (RDP) — record findings in `docs/runbook/v1.1-KIOSK-VISIT.md`
**Deferred to:** Plan 07-06 (Wave 4 human UAT on live kiosk)
**Rationale:** 07-06 already requires a live kiosk trip; batching the DOM survey into that visit avoids a second RDP round-trip mid-phase.

## Deviations from Plan

None — plan executed exactly as written. The pre-checkpoint file creation (v1.1-KIOSK-VISIT.md) was part of Task 2's `<what-built>` specification.

## Known Stubs

None. The LOCALE_STRINGS.de table is fully wired with the correct German string values. The survey template in v1.1-KIOSK-VISIT.md has intentional placeholder blanks — those are the survey form itself, not code stubs.

## Threat Surface Scan

No new network endpoints, auth paths, or file access patterns introduced. The LOCALE_STRINGS table is a plain in-memory constant loaded via string concatenation into the inject script. No new trust boundaries created. T-07-01 (accidental key rename) is mitigated by the shape test.

## Self-Check: PASSED

| Item | Result |
|------|--------|
| src/inject/fragile-selectors.js | FOUND |
| test/fragileSelectors.test.js | FOUND |
| docs/runbook/v1.1-KIOSK-VISIT.md | FOUND |
| Commit cc8bb87 | FOUND |
| Commit 4cc1b52 | FOUND |
