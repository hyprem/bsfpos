# Phase 09: POS Open/Close Toggle with Update-Window Gating - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Admin-controlled POS open/close state that gates auto-update installation. New `posOpen` boolean in electron-store (default `true`), admin menu toggle button with branded confirm modal, welcome layer "geschlossen" message when closed with tap suppressed, and a new `admin-closed-window` trigger source in `updateGate.js` that fires when `posOpen=false` AND time is within the 09:00-12:00 maintenance window.

**Explicit non-goals:**
- Post-sale overlay or print interception (Phase 10 SALE-01)
- Cash-register banner for `posOpen=false` mid-session (deferred polish per REQUIREMENTS.md)
- Auto-reopen or time-based posOpen reset
- Any changes to the existing `post-reset` or `maintenance-window` trigger semantics

</domain>

<decisions>
## Implementation Decisions

### Admin Menu Toggle Button

- **D-01:** New button "POS schliessen" / "POS offnen" placed AFTER "PIN andern" and BEFORE "Auto-Update einrichten" in the admin button stack. Groups all state-changing actions together (credentials > PIN > POS state), before utility/exit actions.
- **D-02:** When `posOpen=true`: button label "POS schliessen" (yellow styling, consistent with destructive-caution pattern). Tapping opens a branded confirm overlay (inline card at z-400, same pattern as credentials/PIN change overlays) with text "POS wirklich schliessen? Mitglieder sehen einen geschlossen-Hinweis." and Ja/Abbrechen buttons.
- **D-03:** When `posOpen=false`: button label "POS offnen" (green styling). Tapping sets `posOpen=true` immediately with NO confirmation modal. Asymmetric confirm: closing needs explicit confirmation, opening does not.
- **D-04:** Audit log: `pos.state-changed open=true|false reason=admin` emitted on every toggle.

### Welcome Closed-State Design

- **D-05:** Closed welcome screen reuses the existing branded dark background + Bee Strong logo + card layout. Replace the "Zum Kassieren tippen" CTA text with "POS derzeit geschlossen" heading and "Bitte Studio-Personal verstandigen" subtext. No tap handler fires (welcome:tap IPC suppressed). No extra status info (no clock, no attribution text).
- **D-06:** The closed state takes effect after the current session ends. If a member session is active when admin closes POS, the active Magicline session continues undisturbed. When idle timeout fires and the welcome layer returns, it shows the closed message. No mid-checkout interruption.

### updateGate Wiring

- **D-07:** DI getter pattern: add a `getPosOpen` function (reads `posOpen` from electron-store) to the `onUpdateDownloaded` opts object, same dependency-injection pattern as the existing `getHour` test hook. updateGate checks `getPosOpen()` alongside `isMaintenanceWindow()` in the existing polling interval. Clean, testable, no new event system or mutable state in updateGate.
- **D-08:** New trigger source `admin-closed-window` requires ONLY `posOpen=false` + time within maintenance window (09:00-12:00). Does NOT require a post-reset (welcome cycle). The admin explicitly closing POS is the strong signal; requiring post-reset too would defeat the purpose of the toggle.
- **D-09:** Existing triggers remain as fall-throughs with first-trigger-wins: `post-reset` fires after welcome logout if time is in window (regardless of posOpen), `maintenance-window` fires on interval if time is in window (regardless of posOpen). The `admin-closed-window` check runs in the same polling interval — whichever condition is met first wins.
- **D-10:** Audit log: `update.install trigger=admin-closed-window posOpen=false hour=N` when the new trigger fires.

### posOpen State Lifecycle

- **D-11:** `posOpen` persists in electron-store across kiosk restarts. Default is `true` (POS open). No auto-reopen — state persists until admin explicitly changes it. The time-window gate (09:00-12:00) already prevents updates from firing outside maintenance hours even if posOpen stays false indefinitely.
- **D-12:** New IPC: `admin-menu-action` case `'toggle-pos-open'` — main.js reads current `posOpen`, flips it, writes to electron-store, broadcasts `pos-state-changed` to host renderer, emits audit log.
- **D-13:** New IPC: `pos-state-changed` (main -> host) — host updates welcome layer text/tap behavior based on `posOpen` value. Also sent on app startup so host renders correct initial state.

### Claude's Discretion

- Exact CSS for the yellow "POS schliessen" and green "POS offnen" button styling — consistent with existing `.bsk-btn` patterns.
- Whether the confirm overlay is a new `#pos-close-confirm` div or reuses a generic confirm pattern.
- Whether `getPosOpen` reads store synchronously (electron-store is sync) or wraps in a function for consistency.
- Admin diagnostics header: whether to show current posOpen state in the diagnostics (low priority, nice-to-have).

### Folded Todos

- **`2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md`** — Source todo for ADMIN-02. Full problem analysis, solution design, and test plan. Note: the maintenance window constant flip (03:00-05:00 -> 09:00-12:00) was already shipped in 0.1.3 (quick 260414-iiv).

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — ADMIN-02 acceptance criteria and success criteria
- `.planning/ROADMAP.md` — Phase 09 goal, success criteria, dependencies on Phase 08
- `.planning/todos/pending/2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md` — Source problem report with full solution design, state model, IPC contracts, updateGate changes, and test plan

### Prior Phase Contracts
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md` — D-15/D-16/D-17 (updateGate architecture), D-02 (button ordering), D-14 (update check interval)
- `.planning/phases/08-admin-menu-polish-reload-fix/08-CONTEXT.md` — D-01 through D-05 (admin menu close button, Esc handler, current button stack ordering)

### Existing Source Files Phase 09 Modifies
- `src/main/updateGate.js` — Add `admin-closed-window` trigger, accept `getPosOpen` in opts
- `src/main/main.js` — Add `toggle-pos-open` admin-menu-action case, pass `getPosOpen` to updateGate, broadcast `pos-state-changed`
- `src/main/preload.js` — Expose `onPosStateChanged` IPC channel
- `src/host/host.html` — Add POS toggle button, confirm overlay, closed-state welcome text
- `src/host/host.css` — Yellow/green button variants, confirm overlay styles
- `src/host/host.js` — Toggle button handler, confirm overlay logic, welcome closed-state rendering, `pos-state-changed` subscriber
- `test/updateGate.test.js` — New test cases for `admin-closed-window` trigger

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`updateGate.onUpdateDownloaded(opts)`** — Already accepts DI opts (`installFn`, `log`, `sessionResetModule`, `getHour`). Adding `getPosOpen` follows the same pattern. Polling interval already exists (`MAINTENANCE_POLL_MS = 60000`).
- **`isMaintenanceWindow(getHour)`** — Existing function checks 09:00-12:00. Can be composed: `if (getPosOpen() === false && isMaintenanceWindow(getHour)) fireWith('admin-closed-window')`.
- **`wireAdminButtons()` pattern** in host.js — Maps button IDs to action strings. Phase 09 adds `#admin-btn-pos-toggle` mapping.
- **Confirm overlay pattern** from Phase 08 — PIN change overlay (z-400, branded card, Ja/Abbrechen buttons) can be adapted for the POS close confirmation.
- **`buildAdminDiagnostics(store)`** in main.js — Already reads store state for admin menu. Can include `posOpen` value to inform button rendering.

### Established Patterns
- **Admin menu state lives in main.js** — `adminMenuOpen` flag, all action handlers in `admin-menu-action` switch. posOpen toggle follows this pattern.
- **electron-store for persistent state** — `adminPinHash`, `pendingUpdate`, etc. `posOpen` follows the same persistence pattern.
- **Main sends, host renders** — main.js owns the state, sends IPC to host for rendering. posOpen state change follows this.

### Integration Points
- `main.js` `admin-menu-action` switch — add `toggle-pos-open` case
- `main.js` `updateGate.onUpdateDownloaded()` call — add `getPosOpen` to opts
- `host.js` welcome layer rendering — conditionally show closed message based on `posOpen`
- `host.js` `showAdminMenu(diagnostics)` — render button label based on `posOpen` from diagnostics
- `test/updateGate.test.js` — extend existing test structure with `getPosOpen` mock

</code_context>

<specifics>
## Specific Ideas

- The `posOpen` toggle is intentionally asymmetric: closing requires confirmation (destructive from the member's perspective), opening does not (always safe).
- The existing `maintenance-window` trigger stays as a fallback even with `posOpen=true` — this preserves the existing behavior where updates can still land during quiet hours without admin intervention.
- `pos-state-changed` IPC should be sent on app startup (not just on toggle) so the welcome layer renders the correct state immediately after a reboot where `posOpen=false` was persisted.

</specifics>

<deferred>
## Deferred Ideas

- **Cash-register banner for `posOpen=false` mid-session** — Explicitly deferred in REQUIREMENTS.md. Lower-priority polish; the current behavior (session continues, closed message appears on next welcome cycle) is sufficient.
- **Auto-reopen after N hours** — Discussed and rejected. Time-window gate already prevents off-hours updates. Admin controls the state explicitly.

</deferred>

---

*Phase: 09-pos-open-close-toggle-with-update-window-gating*
*Context gathered: 2026-04-20*
