# Requirements: v1.1 Field-Operations Polish

**Defined:** 2026-04-14
**Status:** ACTIVE
**Milestone:** v1.1 Field-Operations Polish
**Theme:** Mature the v1.0 kiosk into a hands-off, unattended deployment by closing the small UX gaps and operational bugs surfaced during real-hardware testing on 2026-04-14.

**Scope source:** 7 in-scope todos captured during the 2026-04-14 hardware visit (`.planning/todos/pending/2026-04-14-*.md`). No new ambition — the goal is a mature, validated, hands-off kiosk before any new feature work.

For v1.0 archive, see `.planning/milestones/v1.0-REQUIREMENTS.md`.

## v1.1 Requirements

### Locale Hardening

- [x] **LOCALE-01**: Magicline UI is served in German (de-DE) regardless of the host Windows display language. Electron forces `lang=de-DE` via `app.commandLine.appendSwitch` and overrides `Accept-Language: de-DE,de;q=0.9` on the magicline session via `webRequest.onBeforeSendHeaders`. Locale-dependent text matches in the auto-selection click chain are moved to a single locale lookup table in `src/inject/fragile-selectors.js`, and a structured log line is emitted on auto-selection success/failure. — *Source: `2026-04-14-lock-magicline-ui-to-de-de-regardless-of-windows-language.md`* — *Phase 07, pending*

### Splash & Auto-Selection Race

- [ ] **SPLASH-01**: The post-tap splash remains visible until the register auto-selection click chain completes (or fails after bounded retry), preventing member taps from derailing the chain. A new `register-selected` / `splash:hide-final` IPC gates `splash:hide` on the welcome path; cold-boot and idle-recovery paths preserve existing behavior; a ~5 s safety timeout falls back to the existing `cash-register-ready` path so the splash can never stick. Splash blocks pointer events to the underlying view during the auto-select window. — *Source: `2026-04-14-keep-splash-visible-until-auto-selection-completes.md`* — *Phase 07, pending*

### Admin Menu Polish

- [ ] **ADMIN-01**: The admin menu has a discreet close control (top-right "X" / "Zurück", ≥44×44 px tap target) that hides the admin overlay and returns to the prior layer (welcome OR cash register) without reload, exit, or destructive action. Hardware `Esc` key (host-side `keydown`, not OS-level) and a second press of `Ctrl+Shift+F12` route through the same `admin:close` handler. Closing during PAT lockout dismisses the panel without resetting the lockout countdown. Audit log line `admin.action action=close-menu`. — *Source: `2026-04-14-admin-menu-close-button.md`* — *Phase 08, pending*

- [ ] **ADMIN-02**: An admin-controlled POS open/close toggle gates auto-update installation. New persisted `posOpen` boolean (default `true`) in electron-store. Admin menu exposes a "POS schließen" / "POS öffnen" button (yellow with confirm modal when closing; green no-confirm when opening). When `posOpen=false`, the welcome layer renders a branded "POS derzeit geschlossen" message with `welcome:tap` suppressed. `updateGate` gains a new `admin-closed-window` trigger that fires when `posOpen=false` AND the time is within the daytime maintenance window (09:00–12:00 already shipped in 0.1.3). Existing `post-reset` and `maintenance-window` triggers remain as fall-throughs with first-trigger-wins semantics. Audit log line `update.install trigger=admin-closed-window posOpen=false hour=N`. — *Source: `2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md`* — *Phase 09, pending*

- [ ] **ADMIN-03**: The "Anmeldedaten ändern" admin button opens the credentials overlay in `re-entry` mode — Magicline username + password fields ONLY, with NO PIN setup fields rendered. The existing first-boot path continues to dispatch `mode='first-run'` (all 4 fields). Audit log differentiates `admin.action action=credentials-changed` from any future PIN change path. (PIN change via a separate "PIN ändern" admin path is OUT OF SCOPE for v1.1 — captured as a stretch idea; this requirement covers only the re-entry mode split.) — *Source: `2026-04-14-anmeldedaten-andern-shows-first-run-mode.md`* — *Phase 08, pending*

### Bug Fixes

- [ ] **FIX-01**: Tapping admin menu's "Kasse nachladen" from the welcome state no longer wedges the kiosk on the BITTE WARTEN splash. The `admin:reload-magicline` IPC handler checks Magicline view existence via a new `magiclineView.exists()` method; when no view exists (welcome state), the handler triggers a fresh welcome-tap session start (Layer 2 interpretation) rather than calling `reload()` against null. — *Source: `2026-04-14-kasse-nachladen-from-welcome-leaves-kiosk-stuck.md`* — *Phase 08, pending*

### Post-Sale Flow

- [ ] **SALE-01**: A branded "Vielen Dank" overlay (`#post-sale-overlay`, z-index 180) appears immediately after a successful Magicline sale, triggered by Electron print-event interception (with cart-empty-after-payment as fallback). Microsoft Print to PDF is pre-configured as the default printer for the `bsfkiosk` user; no Chrome print preview is ever shown. The overlay shows a 10-second countdown with a "Nächster Kunde" button; on auto-dismiss, `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})` returns the kiosk to the welcome layer with a fresh session. The new `'sale-completed'` reason is excluded from the 3-in-60s reset-loop counter and fires the existing `onPostReset` hook so `updateGate` can install pending updates after a sale-driven welcome cycle. While the overlay is visible, the 60 s idle timer is paused; "Nächster Kunde" rearms it with a fresh window. Receipt PDF archiving is OUT OF SCOPE for v1.1 (deferred to v1.2+). — *Source: `2026-04-14-post-sale-vielen-dank-overlay-with-print-interception.md`* — *Phase 10, pending*

### Out of Scope (v1.1)

- Reintroducing NFC member identification — requires fresh permission/identification design (`2026-04-14-reintroduce-nfc-member-identification.md`, deferred to v1.2+)
- Receipt PDF archiving for accounting — depends on print interception landing first; capture as separate v1.2 todo if accounting needs an audit trail
- Items deferred from v1.0 visit pending RustDesk install (IDLE-05/07 physical, log RDP spot-checks, P5-21..P5-24 rollback drill)
- Separate "PIN ändern" admin path — captured as a v1.2 idea; ADMIN-03 covers only the re-entry mode bug
- Cash-register banner for `posOpen=false` mid-session — lower-priority polish on ADMIN-02; defer if scope creeps
- GSD framework tooling fix for `phases clear --confirm` destructive behavior — meta-tooling, not project scope

## Traceability

REQ-IDs mapped to phases by the `gsd-roadmapper` agent on 2026-04-14. Phase numbering continues from **phase 07** (v1.0 ended at phase 06; v1.0 phase directories remain in `.planning/phases/` because the previous milestone was reconciled manually rather than via `/gsd-complete-milestone`).

| REQ      | Phase    | Status  |
|----------|----------|---------|
| LOCALE-01 | Phase 07 | Complete |
| SPLASH-01 | Phase 07 | Pending |
| ADMIN-01  | Phase 08 | Pending |
| ADMIN-03  | Phase 08 | Pending |
| FIX-01    | Phase 08 | Pending |
| ADMIN-02  | Phase 09 | Pending |
| SALE-01   | Phase 10 | Pending |

**Coverage:** 7/7 requirements mapped. No orphans.

---
*Defined: 2026-04-14 · Roadmap mapped: 2026-04-14*
