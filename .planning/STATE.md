# Project State: Bee Strong POS Kiosk

**Last updated:** 2026-04-08

## Project Reference

**Core value:** A gym member can walk up, scan their badge, have a product scanned (or self-selected), pay, and walk away — without staff interaction and without being able to break out of the locked Magicline cash register page.

**Current focus:** Roadmap approved. Ready to plan Phase 1 (Locked-Down Shell & OS Hardening).

## Current Position

- **Milestone:** v1
- **Phase:** — (not started)
- **Plan:** —
- **Status:** Roadmap created, awaiting phase planning
- **Progress:** `[░░░░░░░░░░] 0/5 phases complete`

## Performance Metrics

- Phases complete: 0 / 5
- Plans complete: 0
- Requirements mapped: 42 / 42
- Requirements validated: 0 / 42

## Accumulated Context

### Decisions

See PROJECT.md "Key Decisions" table for the full list. Roadmap-level decisions:
- Collapsed to 5 phases per coarse granularity (research suggested 6); NFC + idle + reset combined into one phase because they share the main-process idle-timer / badge-arbiter state.
- Phase ordering strictly follows the research dependency chain: OS hardening → embed → auth-login → idle/reset → admin/update/branding.

### Open TODOs (surfaced during planning)

- Phase 1: confirm Windows 11 SKU on the gym device (blocks choice between Shell Launcher v2 vs Assigned Access + GPO). Research flagged as "needs research during planning."
- Phase 2: verify `BrowserView` vs `WebContentsView` class name for the pinned Electron 41.x line.
- Phase 4: fix latent HID first-character-drop bug from the Android prototype's `BADGE_SPEED_MS` check during the port.
- Phase 4: build a 100-cycle test harness for `clearStorageData` + `flushStore` ordering on Electron 41.
- Phase 5: make the code-signing / PAT-embedding decision before touching `electron-updater` wiring.

### Blockers

None.

## Session Continuity

### Last session summary

- Initialized project (`/gsd-new-project`): PROJECT.md, REQUIREMENTS.md, research bundle (SUMMARY, STACK, ARCHITECTURE, PITFALLS), ROADMAP.md, STATE.md.
- 42 v1 requirements mapped across 5 phases with 100% coverage.

### Next session entry point

Run `/gsd-plan-phase 1` to decompose Phase 1 (Locked-Down Shell & OS Hardening) into executable plans.

---
*State initialized: 2026-04-08*
