---
gsd_state_version: 1.0
milestone: v1.1
milestone_name: Field-Operations Polish
status: executing
last_updated: "2026-04-23T08:45:00Z"
last_activity: 2026-04-23
progress:
  total_phases: 4
  completed_phases: 3
  total_plans: 20
  completed_plans: 14
  percent: 70
---

# Project State: Bee Strong POS Kiosk

**Last updated:** 2026-04-23 (Phase 10 Plan 06 COMPLETE — #post-sale-overlay z-180 host layer DIV + .bsk-layer--post-sale + .bsk-post-sale-title CSS landed in host.html/host.css; zero existing rule modified; Plan 07 overlay lifecycle now has the DOM hooks to bind against)

## Project Reference

**Core value:** A gym member can walk up, scan or self-select a product, pay at the card terminal next to the kiosk, and walk away — without staff interaction and without being able to break out of the locked Magicline cash register page. (NFC member identification descoped 2026-04-14, see MILESTONES.md.)

**Current focus:** Phase 10 — post-sale-flow-with-print-interception

## Current Position

Phase: 10 (post-sale-flow-with-print-interception) — IN PROGRESS
Plan: 4 of 10 complete (10-01 sessionreset-loop-filter, 10-02 preload-post-sale-ipc, 10-05 main-post-sale-ipc-handlers, 10-06 host-html-css-post-sale-layer)

- **Milestone:** v1.1 Field-Operations Polish — STARTED 2026-04-14
- **Status:** Executing
- **Phase:** 10 — post-sale-flow-with-print-interception (10 plans planned, 3 waves)
- **Plan:** 4 of 10 complete
- **Last activity:** 2026-04-23

## Key Decisions (Phase 10)

- **D-10-06-01:** UI-SPEC §Component Inventory 1 HTML block copied verbatim into host.html — insertion point chosen as the `#magicline-error` line (places post-sale-overlay immediately before magicline-error in source order, preserving z-index-ascending grouping for 180 → 300). Z-index ladder comment preamble updated to reference 01-UI-SPEC + 05-UI-SPEC + 10-UI-SPEC.
- **D-10-06-02:** "Nächster Kunde" button uses THREE reused classes (`.bsk-btn .bsk-btn--primary .bsk-btn--idle-dismiss`) with zero new Phase-10 button modifier. D-04 grants discretion; construction-level parity with `.bsk-btn--idle-dismiss` is preferred over a new alias that could drift.
- **D-10-06-03:** `.bsk-post-sale-title` uses margin `16px 0 16px 0` (mirrors `.bsk-idle-title` vertical rhythm) rather than `.bsk-welcome-title`'s `32px 0 0 0`. Needed for symmetric vertical spacing inside the flex column stack (logo → title → countdown → subtext → button).
- **D-10-06-04:** New CSS blocks appended at true EOF with zero modifications to existing rules — `grep -c ".bsk-layer--idle " src/host/host.css` returns 3 (unchanged), `grep -c ".bsk-idle-number" src/host/host.css` returns 1 (unchanged). Full additive append is 28 lines including banner comment.
- **D-10-01-01:** Phase 10 D-17 executed verbatim — countable filter extended with `|| reason === 'sale-completed'` inside existing `!(...)` negation. `mode` check intentionally omitted for sale-completed (reason alone is canonical; sale-completed always arrives with `mode:'welcome'`).
- **D-10-01-02:** D-18 requires no code change — existing `succeeded && postResetListener` gate at sessionReset.js lines 249-256 already covers sale-completed welcome cycles (welcome-mode branch sets `succeeded=true` at line 186). Verified by new D-18 test.
- **D-10-01-03:** D-18 test appends `sessionReset.onPostReset(null)` cleanup call (matching Phase 6 Test 10 convention at line 605) to prevent module-scoped listener contamination across tests.
- **D-10-02-01:** Preload surface for D-19 follows Phase 4 idle-overlay template verbatim — `ipcRenderer.on` for main→renderer subscribers (onShowPostSale / onHidePostSale) and `ipcRenderer.send` for renderer→main fire-and-forget notifiers (notifyPostSaleNextCustomer / notifyPostSaleAutoLogout). No `ipcRenderer.invoke` — overlay lifecycle IPC has no return values.
- **D-10-02-02:** Canonical channel names applied exactly per D-19: `post-sale:show`, `post-sale:hide`, `post-sale:next-customer`, `post-sale:auto-logout` — colon-separated, extending the Phase 06 `welcome:*` convention.
- **D-10-05-01:** `postSaleShown` module-scoped dedupe flag follows Phase 07 `welcomeTapPending` pattern verbatim — declared once, set in the helper, cleared in two places (explicit dismiss handler + onPreReset). Comment block cross-references every lifecycle site.
- **D-10-05-02:** D-19 executed as single-sender authority model — `post-sale:hide` has exactly one ipcMain sender (in onPreReset, guarded by `if (postSaleShown)`). Host-initiated dismiss paths (button tap → next-customer, countdown expiry → auto-logout) hide locally without a round-trip IPC; only main-initiated reset paths force-hide the overlay.
- **D-10-05-03:** Each new `ipcMain.on('post-sale:*')` registration preceded by `ipcMain.removeAllListeners(...)` — matches the Phase 5 `audit-sale-completed` + Phase 07 `register-selected` convention. Guards against hot-reload double-registration.
- **D-10-05-04:** Lazy `require('./idleTimer')` and `require('./sessionReset')` inside handler bodies — matches existing handler pattern in main.js and prevents circular-dep load-time crashes. `try { ... } catch (_) {}` swallow fallback on `.stop()`/`.start()` per the "never let an audit or IPC-relay fail take down the handler" convention.

## Key Decisions (Phase 07)

- **D-07-01:** appendSwitch('lang','de-DE') placed at top-of-file before app.whenReady() — must not be inside whenReady handler or silently no-ops (Electron #17995/#26185)
- **D-07-02:** persist:magicline webRequest.onBeforeSendHeaders uses no URL filter — partition already isolated to Magicline traffic, avoids allowlist drift
- **D-07-03:** Header key uses exact casing 'Accept-Language' (not lowercase) to avoid duplicate-header issue per 07-RESEARCH.md §2
- **D-07-04:** BSK_REGISTER_SELECTED_DEGRADED checked before plain BSK_REGISTER_SELECTED (else-if) to prevent substring double-fire (T-07-07)
- **D-07-05:** welcomeTapPending flag gates splash:hide-final forward — cold-boot/idle-recovery paths unaffected by the new sentinel (T-07-06)
- **D-07-06:** detectAndSelectRegister replaced with bounded state machine — 1200 ms per-step timeout, 4800 ms worst-case, all German strings via LOCALE_STRINGS.de, chainFinish() always emits both markRegisterReady + emitAutoSelectResult on every terminal outcome
- **D-07-07:** hideSplash is the single cleanup entry point for all splash-hide paths (cold-boot, idle-recovery, welcome-path final, 5500ms safety timeout) — avoids duplicate cleanup logic across paths
- **D-07-08:** showSplash does NOT clear splashPendingMode — enterSplashPendingMode() is called before notifyWelcomeTap round-trip; main sends splash:show back which runs showSplash; clearing in showSplash would stomp the pending flag we just set

**Phase numbering note:** v1.1 continues from phase 07 because v1.0 ended at phase 06 and the v1.0 phase directories (`01-..` through `06-..`) are still present in `.planning/phases/` — v1.0 was reconciled manually rather than via `/gsd-complete-milestone`. Do NOT pass `--reset-phase-numbers` to any GSD command on this milestone.

**v1.0 (SHIPPED 2026-04-14):** 6 phases, 36 plans, 36 / 42 effective requirements (NFC-01..06 descoped post-ship). For accomplishments, see `.planning/MILESTONES.md`. For full archive, see `.planning/milestones/v1.0-ROADMAP.md` and `v1.0-REQUIREMENTS.md`.

## v1.1 Phase Overview

| Phase | Name | Requirements | Status |
|-------|------|--------------|--------|
| 07 | Locale Hardening & Splash Race | LOCALE-01, SPLASH-01 | Complete (6/6 plans) |
| 08 | Admin Menu Polish & Reload Fix | ADMIN-01, ADMIN-03, FIX-01 | Complete (2/2 plans, human UAT pending) |
| 09 | POS Open/Close & Update Gating | ADMIN-02 | Complete (2/2 plans, human UAT pending) |
| 10 | Post-Sale Flow & Print Interception | SALE-01 | Executing (3/10 plans) |

Coverage: 7/7 v1.1 requirements mapped.

## Outstanding Field Work (v1.0 carry-over)

**Next kiosk visit batch (44 rows, all with automated backstops):**

- Phase 1: 5 rows — fresh-boot visual, splash permanence, double-launch race, prod-sim chord test, on-device runbook walk-through
- Phase 3: 1 row — TabTip manual-button re-verify on actual kiosk terminal
- Phase 4: 7 rows — IDLE-01..07 (IDLE-05 must run LAST, destructive). NFC-01..06 **DESCOPED 2026-04-14** (quick 260414-eu9). Several IDLE rows are subsumed by the Phase 6 welcome-loop walk; see `docs/runbook/v1.0-KIOSK-VISIT.md`.
- Phase 5: 30 rows — P5-01..P5-30 covering admin hotkey + PIN + lockout, RDP log spot-checks, auto-update + safe window, rollback drill, branded polish (P5-21..P5-24 rollback drill must run LAST)
- Phase 6: 1 row — 5-cycle welcome-loop smoke check (covers IDLE-01..05, AUTH-01..04 in one walk; NFC-05 facet N/A under descope)

Field guide: `docs/runbook/v1.0-KIOSK-VISIT.md`. Authoritative per-requirement specs in each phase's VERIFICATION.md, consolidated under `.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md` "Human Verification Required (Next Kiosk Visit — consolidated batch)".

## Next Action

Continue Phase 10 execution. Plans 10-01 (sessionreset-loop-filter), 10-02 (preload-post-sale-ipc), 10-05 (main-post-sale-ipc-handlers), and 10-06 (host-html-css post-sale layer) are COMPLETE. Plans 10-03 and 10-10 remain parked at their hardware-verification checkpoints; the code they install (preload IPC surface from 10-02, sessionReset filter from 10-01, three-handler orchestration block from 10-05, host-side visual surface from 10-06) is already on disk. Remaining work: plan 04 magiclineView sentinel relay (now has a live `post-sale:trigger` receiver), plan 07 host.js overlay lifecycle (now has both live main-side senders AND addressable DOM nodes `#post-sale-overlay` / `#post-sale-countdown-number` / `#post-sale-next-btn`), plan 08 postSale state-machine test, plan 09 updateGate-composition test (auto-logout path calls `hardReset({reason:'sale-completed', mode:'welcome'})` which fires onPostReset per Plan 01 D-18 verification). D-10 revised per RESEARCH §1: `window.print` override in inject.js replaces the nonexistent Electron 41 `-print` event; D-11 cart-empty MutationObserver kept as defense-in-depth. Phase 09 POS open/close toggle is complete with 3 human UAT items pending next kiosk visit.

### Quick Tasks Completed

| # | Description | Date | Commit | Directory |
|---|-------------|------|--------|-----------|
| 260414-eu9 | Descope NFC member-badge identification from v1.0 | 2026-04-14 | cbc9b59 | [260414-eu9-descope-nfc-member-badge-identification-](./quick/260414-eu9-descope-nfc-member-badge-identification-/) |
| 260414-iiv | Ship 0.1.3 patch — fix release asset filename mismatch + flip update window to 09:00–12:00 | 2026-04-14 | 34cb20a | [260414-iiv-ship-0-1-3-patch-fix-release-asset-filen](./quick/260414-iiv-ship-0-1-3-patch-fix-release-asset-filen/) |

**Last activity:** 2026-04-23 — Phase 10 Plan 06 complete (host HTML/CSS post-sale layer: #post-sale-overlay z-180 DIV + .bsk-layer--post-sale / .bsk-post-sale-title CSS — zero existing rule modified; Plan 07 unblocked with addressable DOM nodes)

---
*State initialized: 2026-04-08 · v1.0 archived: 2026-04-14 · NFC descoped: 2026-04-14 · v1.1 roadmap: 2026-04-14*
