# Roadmap: Bee Strong POS Kiosk

## Shipped Milestones

- **v1.0 MVP** — 6 phases, 36 plans, shipped 2026-04-14. See [milestones/v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md). Audit posture: `tech_debt` (no critical blockers; physical verification batch deferred to next kiosk visit).

## Current Milestone: v1.1 Field-Operations Polish

**Goal:** Mature the v1.0 kiosk into a hands-off, unattended deployment by closing the small UX gaps and operational bugs surfaced during real-hardware testing on 2026-04-14.

**Granularity:** standard — 4 phases covering 7 requirements from 7 in-scope todos. No new tech, no new architecture; every item has a decision-locked implementation sketch in its source todo.

**Total v1.1 requirements:** 7 — 7 / 7 mapped, 0 / 7 closed.

**Phase numbering:** continues from v1.0 (phases 01-06 are v1.0 shipped work, still present in `.planning/phases/` because v1.0 was reconciled manually). v1.1 starts at **phase 07**.

### Grouping rationale

The 7 requirements cluster naturally into 4 risk-isolated, shippable increments:

1. **Phase 07 (LOCALE-01, SPLASH-01)** — Tightly coupled: the SPLASH-01 todo explicitly requires LOCALE-01 to land first because the German-text fragility in the auto-selection click chain is what SPLASH-01 is gating the splash on. Both are small, both touch `src/inject/` and `src/main/main.js`, both are lower-risk foundation work. Landing them together means the auto-selection chain is locale-resilient *and* race-resilient in one reviewable unit.
2. **Phase 08 (ADMIN-01, ADMIN-03, FIX-01)** — All three touch the admin-menu surface. ADMIN-01 (close button) provides admins an alternative dismiss path for FIX-01 (Kasse-nachladen wedge) and must land before or with it. ADMIN-03 (credentials overlay mode split) is a quick surgical fix on the same overlay system. Grouping them keeps the admin-menu IPC contract changes in a single reviewable surface.
3. **Phase 09 (ADMIN-02)** — POS open/close toggle with updateGate integration is large enough to stand alone: new electron-store key, new IPC, admin button with confirm modal, welcome-layer rendering variant, `updateGate` trigger source addition, and test coverage for first-trigger-wins semantics. Risk-isolated from Phase 08 so the admin-menu polish can ship and be field-validated independently if Phase 09 needs iteration.
4. **Phase 10 (SALE-01)** — The largest single REQ. New `#post-sale-overlay` host layer, Electron `-print` event interception, Microsoft Print to PDF printer pre-configuration, new `'sale-completed'` sessionReset reason (excluded from reset-loop counter), idle-timer pause, `updateGate` `onPostReset` interaction. Warrants its own phase: isolation keeps the print-hook risk contained, and landing it last means Phase 09's updateGate changes are in place before this phase couples to them.

Dependencies flow: 07 → 08 → 09 → 10 (10 depends on 09's updateGate trigger source being in place; 08 depends on 07 only for ordering simplicity, not technical coupling).

## Phases

- [x] **Phase 07: Locale Hardening & Splash Auto-Selection Race** — Force Magicline to de-DE and gate splash on register-selected, not cash-register-ready. (completed 2026-04-14)
- [x] **Phase 08: Admin Menu Polish & Reload Fix** — Close button, re-entry credentials mode, and welcome-state-aware Kasse nachladen. (completed 2026-04-20)
- [x] **Phase 09: POS Open/Close Toggle with Update-Window Gating** — Admin-controlled POS state gates auto-update installation to a daytime window. (completed 2026-04-20)
- [x] **Phase 10: Post-Sale Flow with Print Interception** — Branded "Vielen Dank" overlay, Electron print interception, and auto-logout to welcome after sale. (completed 2026-04-24, 2 hardware checkpoints pending)
- [x] **Phase 11: POS Close — Immediate Welcome Reset** — Reverse Phase 09 D-06 so closing POS triggers an immediate background sessionReset to the closed-welcome layer, surfacing the closed state without waiting for idle. (completed 2026-04-28)

## Phase Details

### Phase 07: Locale Hardening & Splash Auto-Selection Race
**Goal:** The Magicline UI is always German regardless of Windows display language, and the post-tap splash stays up until the register auto-selection chain finishes so members can't derail it mid-click.
**Depends on:** v1.0 Phase 06 (welcome-as-resting-state) — shipped
**Requirements:** LOCALE-01, SPLASH-01
**Success Criteria** (what must be TRUE):
  1. On a kiosk with Windows set to English, Magicline serves the cash register UI in German and the auto-selection click chain (`Kasse auswählen` → `Self-Checkout` → `Speichern`) completes successfully on first welcome tap.
  2. Locale-dependent text matches used by the auto-selection chain live in a single lookup table in `src/inject/fragile-selectors.js`, and a structured `auto-select.result=ok|fail` log line is emitted on every chain run.
  3. After a welcome tap, the splash remains visible and blocks pointer events to the underlying Magicline view until `register-selected` / `splash:hide-final` fires (or a ~5 s safety timeout falls back to the existing `cash-register-ready` path); the splash never sticks forever.
  4. Cold-boot and idle-recovery splash paths preserve their existing behavior and are not regressed by the new welcome-path gating.
**Plans:** 6/6 plans complete
- [x] 07-01-PLAN.md — Wave 0: LOCALE_STRINGS.de table + live-kiosk DOM survey
- [x] 07-02-PLAN.md — Locale enforcement: --lang=de-DE + webRequest Accept-Language override
- [x] 07-03-PLAN.md — Sentinel bridge + markRegisterReady helper + host IPC gate
- [x] 07-04-PLAN.md — Auto-select state machine rewrite wired to LOCALE_STRINGS
- [x] 07-05-PLAN.md — Welcome-path splash gate + 5500ms safety timeout
- [x] 07-06-PLAN.md — Kiosk-visit verification checklist (LOCALE-01 + SPLASH-01)
**UI hint**: yes

### Phase 08: Admin Menu Polish & Reload Fix
**Goal:** Admins can dismiss the admin menu non-destructively, change only Magicline credentials without exposing PIN-reset fields, and recover from "Kasse nachladen" tapped on the welcome layer without wedging the kiosk.
**Depends on:** Phase 07
**Requirements:** ADMIN-01, ADMIN-03, FIX-01
**Success Criteria** (what must be TRUE):
  1. Admin menu has a discreet top-right close control (≥44×44 px) that hides the overlay and returns to the prior layer (welcome OR cash register) without reload, exit, or destructive action; hardware `Esc` (host-side `keydown`) and a second press of `Ctrl+Shift+F12` route through the same `admin:close` handler.
  2. Closing the admin menu during PAT lockout dismisses the panel without resetting the lockout countdown, and audit log line `admin.action action=close-menu` is emitted.
  3. Tapping "Anmeldedaten ändern" from the admin menu opens the credentials overlay in `re-entry` mode with Magicline username + password fields only; PIN setup fields are absent from the DOM. First-boot flow still dispatches `mode='first-run'` with all 4 fields.
  4. Tapping "Kasse nachladen" from the welcome layer (no Magicline view in memory) starts a fresh welcome-tap session rather than calling `reload()` against null; the kiosk never wedges on the BITTE WARTEN splash from this path.
  5. A public `magiclineView.exists()` method exists and is used by the `admin:reload-magicline` IPC handler to branch on view existence.
**Plans:** 2/2 plans complete
- [x] 08-01-PLAN.md — Main-process: magiclineView.exists(), closeAdminMenu helper, toggle, reload fix, PIN change IPC
- [x] 08-02-PLAN.md — Host-side: X close button, Esc handler, credentials title fix, PIN change overlay
**UI hint**: yes

### Phase 09: POS Open/Close Toggle with Update-Window Gating
**Goal:** An admin can explicitly mark the POS "closed" from the admin menu; when closed, the welcome layer shows a branded geschlossen message and auto-update installs are allowed to fire inside the daytime maintenance window.
**Depends on:** Phase 08 (admin menu surface is stable)
**Requirements:** ADMIN-02
**Success Criteria** (what must be TRUE):
  1. A `posOpen` boolean (default `true`) persists in electron-store across kiosk restarts, and the admin menu exposes a "POS schließen" / "POS öffnen" button that toggles it (yellow + confirm modal when closing; green + no confirm when opening).
  2. When `posOpen=false`, the welcome layer renders a branded "POS derzeit geschlossen" / "Bitte Studio-Personal verständigen" message and `welcome:tap` is suppressed — the screen is informational only.
  3. `updateGate` fires installation via a new `admin-closed-window` trigger when `posOpen=false` AND time is within the daytime maintenance window (09:00–12:00 as shipped in 0.1.3); existing `post-reset` and `maintenance-window` triggers remain as first-trigger-wins fall-throughs.
  4. Audit log line `update.install trigger=admin-closed-window posOpen=false hour=N` is emitted when the new trigger fires, and `pos.state-changed open=true|false reason=admin` is emitted on every toggle.
  5. `test/updateGate.test.js` covers: `posOpen=false` in-window fires, `posOpen=false` out-of-window does not, `posOpen=true` in-window falls through to `maintenance-window`, and first-trigger-wins between `admin-closed-window` and `post-reset`.
**Plans:** 2/2 plans complete
- [x] 09-01-PLAN.md — Main-process backbone: updateGate getPosOpen + admin-closed-window trigger, toggle-pos-open IPC, diagnostics, startup broadcast, preload channel, 4 new tests
- [x] 09-02-PLAN.md — Host-side UI: POS toggle button + confirm overlay + welcome closed-state + IPC subscriber + diagnostics row + human verification
**UI hint**: yes

### Phase 10: Post-Sale Flow with Print Interception
**Goal:** After a successful Magicline sale, a branded "Vielen Dank" overlay appears immediately (triggered by Electron print interception with cart-empty fallback), counts down 10 seconds, and returns the kiosk to a fresh welcome session — without ever showing Chrome's print preview.
**Depends on:** Phase 09 (`updateGate` `post-reset`/trigger surface is stable before `sale-completed` reason hooks into it)
**Requirements:** SALE-01
**Success Criteria** (what must be TRUE):
  1. Microsoft Print to PDF is pre-configured as the default printer for the `bsfkiosk` Windows user, and Chrome's print preview window is never visible to the member after a successful sale.
  2. A `#post-sale-overlay` host layer (z-index 180, branded dark with yellow "Vielen Dank!") appears immediately after a successful sale, triggered by Electron `-print` event interception with a cart-empty-after-payment DOM-mutation fallback; the overlay shows a 10-second countdown and a "Nächster Kunde" button.
  3. On auto-dismiss after 10 s, `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})` returns the kiosk to the welcome layer with a fresh session; on "Nächster Kunde" tap, the overlay hides and the cash register stays visible with a rearmed 60 s idle timer.
  4. The new `'sale-completed'` reason is excluded from the 3-in-60 s reset-loop counter, and the existing `onPostReset` hook still fires so `updateGate` can install pending updates after a sale-driven welcome cycle (first-trigger-wins against the other trigger sources still holds).
  5. While `#post-sale-overlay` is visible, the 60 s idle timer is paused; "Nächster Kunde" rearms it with a fresh window.
  6. `test/postSale.test.js` covers the countdown, auto-dismiss, and "Nächster Kunde" paths; `test/sessionReset.test.js` covers the new `'sale-completed'` reason + loop-counter exclusion.
**Plans:** 8/10 plans complete
- [x] 10-01-sessionreset-loop-filter-PLAN.md — Extend sessionReset countable filter to exclude sale-completed (D-17) + add D-17/D-18 tests
- [x] 10-02-preload-post-sale-ipc-PLAN.md — Expose four post-sale IPC methods on window.kiosk (D-19)
- [ ] 10-03-inject-print-override-fallback-PLAN.md — inject.js window.print override (BSK_PRINT_INTERCEPTED) + cart-empty MutationObserver fallback (BSK_POST_SALE_FALLBACK) + placeholder cart selector [HUMAN CHECKPOINT]
- [x] 10-04-magiclineview-sentinel-relay-PLAN.md — Two new console-message sentinel branches relaying to ipcMain.emit('post-sale:trigger') (no -print listener per RESEARCH §1)
- [x] 10-05-main-post-sale-ipc-handlers-PLAN.md — main.js postSaleShown flag + startPostSaleFlow helper + three IPC handlers (trigger/next-customer/auto-logout) + onPreReset extension
- [x] 10-06-host-html-css-post-sale-layer-PLAN.md — #post-sale-overlay z-180 layer + .bsk-layer--post-sale / .bsk-post-sale-title CSS + updated z-index ladder comment
- [x] 10-07-host-js-overlay-lifecycle-PLAN.md — showPostSaleOverlay/hidePostSaleOverlay + postSaleResolved first-wins guard + button handler + IPC subscribers
- [x] 10-08-postsale-test-PLAN.md — test/postSale.test.js state machine tests (dedupe, next-customer, auto-logout, trigger routing)
- [x] 10-09-updategate-composition-test-PLAN.md — test/updateGate.test.js D-18 composition test (sale-completed → onPostReset → install)
- [ ] 10-10-nsis-default-printer-runbook-PLAN.md — NSIS customInstall PowerShell for default printer (D-14) + docs/runbook/default-printer-setup.md (D-15) [HUMAN CHECKPOINT]
**UI hint**: yes

### Phase 11: POS Close — Immediate Welcome Reset
**Goal:** Closing the POS from the admin menu immediately triggers a background sessionReset to the closed-welcome layer, so the closed state surfaces as soon as the admin menu dismisses — without waiting for the 60 s idle timeout. Reverses Phase 09 D-06.
**Depends on:** Phase 09 (POS toggle + closed-welcome rendering), Phase 10 (sessionReset reason filter pattern from `sale-completed`)
**Requirements:** ADMIN-02 (extends; D-06 reversed)
**Success Criteria** (what must be TRUE):
  1. Tapping "POS schließen" + confirm sets `posOpen=false`, then immediately calls `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` so the kiosk transitions to the closed-welcome layer regardless of the layer that was foregrounded when admin opened the menu (cash register, welcome, error, etc.).
  2. The reset runs while the admin menu is open; on admin-menu close (X / Esc / Ctrl+Shift+F12), the prior-layer restoration target is the new closed-welcome layer (not the cash register that was visible before).
  3. The new `'pos-closed'` reason is excluded from the 3-in-60 s reset-loop counter (mirrors Phase 10 `sale-completed` filter), and `onPostReset` still fires so `updateGate` can install pending updates after a pos-closed reset (first-trigger-wins still holds).
  4. Tapping "POS öffnen" does NOT trigger a session reset — the existing `pos-state-changed` IPC path already updates the welcome layer in place (no asymmetry change for the open direction).
  5. Audit log line `pos.state-changed open=false reason=admin` is emitted (existing), and the immediate reset emits `session.reset reason=pos-closed mode=welcome` (existing sessionReset audit pattern).
  6. `test/sessionReset.test.js` extends to cover: `pos-closed` excluded from loop counter, `onPostReset` fires for `pos-closed` (mirrors sale-completed D-17/D-18 tests). Per 11-CONTEXT D-08, the toggle-pos-open handler glue itself is NOT directly unit-tested — its meaningful behavior (filter exclusion + onPostReset firing) is covered transitively by the sessionReset tests above, mirroring how Phase 10 covers post-sale main.js glue. UAT verifies the visible behavior end-to-end.
  7. Phase 09 D-06 is updated in `.planning/phases/09-*/09-CONTEXT.md` with a SUPERSEDED-BY-PHASE-11 annotation, plus a one-line rationale (UAT 2026-04-26: admin tapping through to register to reach menu lands user back on register after dismiss; immediate reset matches admin mental model).
**Plans:** 3/3 plans complete
- [x] 11-01-sessionreset-pos-closed-filter-PLAN.md — sessionReset countable filter exclusion + D-05/D-06 tests for pos-closed (mirrors Phase 10 D-17/D-18)
- [x] 11-02-toggle-pos-open-hardreset-PLAN.md — main.js toggle-pos-open immediate-reset on close (D-01..D-04, D-09)
- [x] 11-03-phase09-d06-supersede-note-PLAN.md — Append SUPERSEDED-BY-PHASE-11 note to 09-CONTEXT.md D-06 (D-10)
**UI hint**: no — main + sessionReset only; no new visual surfaces.

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 07. Locale Hardening & Splash Race | 6/6 | Complete    | 2026-04-14 |
| 08. Admin Menu Polish & Reload Fix | 2/2 | Complete   | 2026-04-20 |
| 09. POS Open/Close & Update Gating | 2/2 | Complete   | 2026-04-20 |
| 10. Post-Sale Flow & Print Interception | 8/10 | Complete (2 hardware UAT pending) | 2026-04-24 |
| 11. POS Close — Immediate Welcome Reset | 3/3 | Complete    | 2026-04-28 |

## Coverage

- LOCALE-01 → Phase 07
- SPLASH-01 → Phase 07
- ADMIN-01 → Phase 08
- ADMIN-03 → Phase 08
- FIX-01   → Phase 08
- ADMIN-02 → Phase 09 (extended by Phase 11; D-06 reversed)
- SALE-01  → Phase 10

**Coverage:** 7/7 v1.1 requirements mapped. No orphans. Every phase has at least one requirement. Phase 11 is a UAT-driven D-06 reversal and does not introduce a new requirement.

## Next Milestone

No milestone beyond v1.1 is planned. After v1.1 ships, candidates include: reintroduce NFC member identification, receipt PDF archiving, RustDesk-dependent v1.0 deferred field items.

---
*v1.1 roadmap created: 2026-04-14*
