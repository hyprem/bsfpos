---
phase: 07-locale-hardening-splash-auto-selection-race
plan: "04"
subsystem: inject
tags: [state-machine, locale, SPLASH-01, LOCALE-01, sentinel]
dependency_graph:
  requires: [07-01 LOCALE_STRINGS.de, 07-03 markRegisterReady + emitAutoSelectResult]
  provides: [state-machine detectAndSelectRegister wired to LOCALE_STRINGS.de + sentinel helpers]
  affects: [src/inject/inject.js]
tech_stack:
  added: []
  patterns: [bounded state machine with per-step timeout + fallback setInterval, LOCALE_STRINGS.de text matching]
key_files:
  created: []
  modified:
    - src/inject/inject.js
decisions:
  - "CHAIN_IDLE does not advance to CHAIN_STEP2 until findKasseBtn() finds the button — avoids premature click on other pages"
  - "already-on-register branch gates on readyEmitted (set only inside cash-register hash guard) — T-07-09 mitigation"
  - "chainFinish is re-entrancy safe (CHAIN_DONE early-return) preventing double-emit via both rAF tick and fallback interval"
  - "chainAdvanceTo resets chainStepStartedAt to 0 so each step gets a fresh 1200 ms budget from first DOM check"
  - "CHAIN_STEP1 state constant defined but chain skips directly to CHAIN_STEP2 after clicking Kasse button in IDLE — step1 is the click itself"
metrics:
  duration_minutes: ~5
  completed_date: "2026-04-14"
  tasks_completed: 1
  tasks_total: 1
  files_changed: 1
---

# Phase 07 Plan 04: Bounded State Machine for detectAndSelectRegister Summary

**One-liner:** Nested-setTimeout detectAndSelectRegister replaced with a 1200 ms-per-step bounded state machine wired to LOCALE_STRINGS.de and calling markRegisterReady/emitAutoSelectResult on every terminal outcome.

## Tasks Completed

| Task | Name | Commit | Files |
|------|------|--------|-------|
| 1 | Rewrite detectAndSelectRegister as bounded state machine wired to LOCALE_STRINGS and sentinels | 56413d6 | src/inject/inject.js |

## What Was Built

### Task 1 — inject.js (full replacement of §261-346)

The pre-Phase-07 `detectAndSelectRegister` was a nested-setTimeout chain with four 500 ms waits, hard-coded German strings, no bounded termination, and no calls to the Plan 03 sentinel helpers. It was replaced with a state machine:

**State constants:** `CHAIN_IDLE`, `CHAIN_STEP1`, `CHAIN_STEP2`, `CHAIN_STEP3`, `CHAIN_STEP4`, `CHAIN_DONE`

**Per-step timeout:** `CHAIN_STEP_TIMEOUT_MS = 1200`. If the expected DOM element does not appear within 1200 ms of entering a step, `chainFinish('fail', currentStep, true)` fires — triggering `emitAutoSelectResult + markRegisterReady({degraded:true})` and transitioning to DONE.

**Total worst-case wall time:** 4 steps × 1200 ms = 4800 ms. The Plan 05 host-side safety timeout is 5500 ms — 700 ms headroom ensures the chain always emits before the host falls back.

**Terminal outcomes (all route through chainFinish):**
1. Successful Speichern click → `chainFinish('ok', 'done', false)`
2. Already-on-register (readyEmitted && no Kasse button) → `chainFinish('ok', 'already-on-register', false)`
3. Step timeout → `chainFinish('fail', chainState, true)`

**Locale wiring:** All three German text matches now use `LOCALE_STRINGS.de.KASSE_AUSWAEHLEN`, `LOCALE_STRINGS.de.SELF_CHECKOUT_OPTION`, and `LOCALE_STRINGS.de.SPEICHERN`. Zero hard-coded German strings remain in the chain.

**Tick sources:** The existing rAF-debounced `schedule()` → `detectAndSelectRegister()` call is unchanged and acts as the primary tick. A 100 ms `setInterval` fallback is started on the first `detectAndSelectRegister()` call and auto-clears on DONE — this covers quiet DOM gaps between synthetic clicks where MutationObserver may not fire.

**Re-entrancy safety:** `chainFinish` early-returns if `chainState === CHAIN_DONE`. `chainFallbackTimer` checked before starting to prevent duplicate intervals.

**already-on-register guard:** `alreadyOnRegisterEmitted` flag + `readyEmitted` dependency. `readyEmitted` is only set inside the `#/cash-register` hash regex guard in `detectReady()` (§209-229) so the already-on-register branch can never fire on a non-cash-register URL (T-07-09 mitigation).

**Unchanged:** The `detectAndSelectRegister()` function signature is still a parameterless function — the existing callers in the rAF pipeline at ~line 443 require no changes.

## Deviations from Plan

None — plan executed exactly as written.

## Known Stubs

None. The state machine is fully wired to the LOCALE_STRINGS.de table and the Plan 03 sentinel helpers. Call sites from Plan 03's Plan 05 wire-up (splash:hide-final forward on host side) are not yet implemented — that is Plan 05, not a stub in this plan.

## Threat Surface Scan

All surfaces were explicitly modelled in the plan's threat register:

| Flag | File | Description |
|------|------|-------------|
| threat_flag: state-machine-terminal | src/inject/inject.js | T-07-10 mitigated — chainFinish always clears fallback timer; per-step timeout forces DONE in ≤4800 ms worst case |
| threat_flag: synthetic-click-guard | src/inject/inject.js | T-07-09 mitigated — IDLE→STEP2 transition requires exact LOCALE_STRINGS.de.KASSE_AUSWAEHLEN text match; already-on-register branch requires readyEmitted (hash-guarded) |

## Self-Check: PASSED

| Item | Result |
|------|--------|
| src/inject/inject.js contains LOCALE_STRINGS.de.KASSE_AUSWAEHLEN | FOUND |
| src/inject/inject.js contains LOCALE_STRINGS.de.SELF_CHECKOUT_OPTION | FOUND |
| src/inject/inject.js contains LOCALE_STRINGS.de.SPEICHERN | FOUND |
| src/inject/inject.js contains CHAIN_STEP_TIMEOUT_MS = 1200 | FOUND |
| src/inject/inject.js contains function chainFinish( | FOUND |
| src/inject/inject.js contains alreadyOnRegisterEmitted | FOUND |
| src/inject/inject.js contains chainFallbackTimer | FOUND |
| No hard-coded 'Kasse auswählen' literal | CONFIRMED |
| No hard-coded 'Self-Checkout' literal | CONFIRMED |
| No hard-coded 'Speichern' literal | CONFIRMED |
| chainFinish appears at least 3 times | CONFIRMED (3 call sites: already-on-register, step timeout, step4 success) |
| node --test test/fragileSelectors.test.js | 3/3 PASS |
| node --test test/magiclineView.sentinel.test.js | 8/8 PASS |
| Commit 56413d6 | FOUND |
