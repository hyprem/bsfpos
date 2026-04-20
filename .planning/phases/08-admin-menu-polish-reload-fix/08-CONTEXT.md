# Phase 08: Admin Menu Polish & Reload Fix - Context

**Gathered:** 2026-04-20
**Status:** Ready for planning

<domain>
## Phase Boundary

Three surgical fixes to the admin menu surface, plus a new PIN change path:

1. **Close button** (ADMIN-01) — Discreet top-right X button, Esc key, and Ctrl+Shift+F12 toggle to dismiss the admin menu non-destructively and return to the prior layer (welcome OR cash register).
2. **Credentials re-entry mode** (ADMIN-03) — "Anmeldedaten andern" opens credentials overlay with Magicline username + password ONLY; PIN setup fields are absent from the DOM. First-boot path unchanged.
3. **Kasse nachladen welcome-state fix** (FIX-01) — When tapped from welcome state (no Magicline view), starts a fresh session instead of calling reload() against null.
4. **PIN change button** (scope addition) — New "PIN andern" admin button with current-PIN re-verification, separate from credentials re-entry. Extends ADMIN-03 todo Part 2.

**Explicit non-goals:**
- POS open/close toggle (Phase 09 ADMIN-02)
- Post-sale overlay or print interception (Phase 10 SALE-01)
- Any changes to cold-boot/idle-recovery paths
- Any changes to the auto-update flow or PAT configuration

</domain>

<decisions>
## Implementation Decisions

### Close Button (ADMIN-01)

- **D-01:** Top-right X button on the admin menu, above the diagnostic header. Min 44x44 px tap target. Discreet style (not primary action appearance) — outlined or subtle, consistent with the dark/yellow brand palette. Uses the existing `.bsk-btn` pattern family from `host.css`.
- **D-02:** Esc key (host-side `keydown` listener while admin layer is visible) routes through the same `admin:close` handler. Only fires from the ROOT admin menu — Esc from nested screens (credentials overlay, PAT config) is handled by those screens' own cancel paths and does NOT cascade up to close the admin menu.
- **D-03:** Ctrl+Shift+F12 toggles the admin menu. Second press when admin is already open routes through `admin:close`. The hotkey handler in main.js checks `adminMenuOpen` state: if open, close; if closed, open PIN modal as before.
- **D-04:** `admin:close` handler in main.js sets `adminMenuOpen = false`, sends `hide-admin-menu` to host, and calls `setMagiclineViewVisible(true)` if a Magicline view exists (restores cash register). If no Magicline view exists (welcome state), sends `welcome:show` instead. Emits `admin.action action=close-menu` audit log line.
- **D-05:** Closing admin during PAT lockout dismisses the admin panel WITHOUT resetting the lockout countdown. On reopen (Ctrl+Shift+F12 → correct PIN), the lockout panel resumes with the existing countdown where it left off. Lockout state persists in electron-store across open/close cycles (already the case from Phase 5 D-09).

### Credentials Re-Entry Mode (ADMIN-03)

- **D-06:** The "Anmeldedaten andern" admin button sends `show-credentials-overlay` with `{ firstRun: false }` (re-entry mode). The host-side `showCredentialsOverlay(payload)` handler hides `#creds-firstrun-fields` when `firstRun === false`, removing PIN fields from the visible UI. The existing first-boot path continues to send `{ firstRun: true }` (all 4 fields). **Root cause investigation needed during research:** verify whether the current code already sends `firstRun: false` and the bug is in `host.js` rendering, or whether main.js sends the wrong payload.
- **D-07:** Audit log differentiates: `admin.action action=credentials-changed` for Magicline credential updates, `admin.action action=pin-changed` for PIN changes (from the new PIN andern path).

### PIN Change Button (scope addition beyond ADMIN-03)

- **D-08:** New admin menu button "PIN andern" placed after "Anmeldedaten andern" and before "Auto-Update einrichten" in the button stack. Follows Phase 5 D-02 safe-to-destructive ordering (credentials and PIN changes grouped together, before update/exit actions).
- **D-09:** PIN change flow: opens a focused overlay (reuses the credentials overlay card style, layer 400, mutually exclusive with credentials overlay). Fields: "Aktuelle PIN" (4-6 digits) -> "Neue PIN" (4-6 digits) -> "PIN bestatigen" (4-6 digits) -> "Speichern" button. Cancel button returns to admin menu.
- **D-10:** Requires re-entry of the CURRENT PIN before allowing the change (defense in depth). Uses `adminPin.verifyPin(store, currentPin)` — the existing Phase 3 module, not the lockout wrapper. Rationale: the admin already proved PIN to enter the menu, but re-verification prevents a maintenance tech from quietly changing the PIN.
- **D-11:** On successful PIN change: updates the scrypt hash in electron-store via `adminPin.setPin(store, newPin)`, emits `admin.action action=pin-changed`, returns to admin menu. Does NOT reset lockout state (lockout is keyed to failed attempts, not to PIN changes).

### Kasse Nachladen Welcome-State Fix (FIX-01)

- **D-12:** The `admin-menu-action` handler for `reload` checks Magicline view existence via a new public `magiclineView.exists()` method (wraps `getMagiclineWebContents() !== null`).
- **D-13:** When `magiclineView.exists()` returns false (welcome state): admin menu closes, and the handler triggers the same flow as a welcome tap — creates Magicline view, starts authFlow, shows splash, runs auto-select chain. This is the todo's "Layer 2" interpretation: Kasse nachladen from welcome = "start a fresh session right now."
- **D-14:** When `magiclineView.exists()` returns true (active session): existing behavior unchanged — `magiclineView.reload()` + authFlow restart from BOOTING.
- **D-15:** Admin menu always closes before the fresh session/reload starts. Splash appears immediately (same as a normal welcome tap flow). Admin sees the standard BITTE WARTEN splash during login.

### Claude's Discretion

- Exact CSS for the X button (icon glyph vs. text "X" vs. SVG, hover/pressed states) — must be consistent with the dark/yellow palette and existing button patterns.
- Whether the PIN change overlay reuses `#credentials-overlay` with a third mode or is a new `#pin-change-overlay` div — implementation detail, pick whatever keeps the HTML cleanest.
- Exact error messages for PIN change validation failures (mismatch, too short, wrong current PIN) — German, consistent with existing credential form patterns.
- Whether `magiclineView.exists()` is a standalone export or a method on an object — match the existing module's export style.

### Folded Todos

- **`2026-04-14-admin-menu-close-button.md`** — Source todo for ADMIN-01. Close button, Esc key, Ctrl+Shift+F12 toggle, lockout-safe close.
- **`2026-04-14-anmeldedaten-andern-shows-first-run-mode.md`** — Source todo for ADMIN-03. Re-entry mode split + PIN change path.
- **`2026-04-14-kasse-nachladen-from-welcome-leaves-kiosk-stuck.md`** — Source todo for FIX-01. Welcome-state-aware reload with fresh session start.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Requirements & Roadmap
- `.planning/REQUIREMENTS.md` — ADMIN-01, ADMIN-03, FIX-01 acceptance criteria
- `.planning/ROADMAP.md` — Phase 08 goal, success criteria, and dependency on Phase 07
- `.planning/todos/pending/2026-04-14-admin-menu-close-button.md` — ADMIN-01 source problem report with edge cases
- `.planning/todos/pending/2026-04-14-anmeldedaten-andern-shows-first-run-mode.md` — ADMIN-03 source problem report with threat analysis
- `.planning/todos/pending/2026-04-14-kasse-nachladen-from-welcome-leaves-kiosk-stuck.md` — FIX-01 source problem report with root cause analysis

### Prior Phase Contracts
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md` — D-01 (admin menu structure, layer 500), D-02 (button order), D-03 (diagnostic header), D-05 (re-enter credentials reuses Phase 3 overlay), D-08 (Ctrl+Shift+F12 hotkey wiring), D-09..D-13 (PIN lockout state in electron-store)
- `.planning/phases/03-credentials-auto-login-state-machine/03-CONTEXT.md` — `adminPin.js` contract (D-10: "Phase 5 adds lockout ON TOP without modifying"), credentials overlay `firstRun` parameter

### Existing Source Files Phase 08 Modifies
- `src/host/host.html` — `#admin-menu` (add X button), `#credentials-overlay` (verify mode rendering), possibly add `#pin-change-overlay`
- `src/host/host.js` — `showAdminMenu()`, `hideAdminMenu()`, Esc keydown listener, `showCredentialsOverlay(payload)` mode handling
- `src/host/host.css` — X button styling, PIN change overlay styling
- `src/main/main.js` — `admin-menu-action` handler (reload branch + new pin-change branch), `close-admin-menu` handler, Ctrl+Shift+F12 toggle logic, `verify-admin-pin` handler (lockout resume)
- `src/main/magiclineView.js` — add `exists()` public method
- `src/main/preload.js` — expose any new IPC channels (pin-change submit, admin:close from host)
- `src/main/adminPin.js` — READ-ONLY (used by PIN change flow via existing `verifyPin` + `setPin`)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`showCredentialsOverlay(payload)`** in host.js (lines 299-318) — Already has `firstRun` toggling for `#creds-firstrun-fields`. Phase 08 verifies this works correctly and may fix the IPC payload if that's the bug root cause.
- **`adminPin.verifyPin(store, pin)` + `adminPin.setPin(store, pin)`** — Phase 3 module, used directly by PIN change flow. No modification needed.
- **`adminPinLockout.verifyPinWithLockout(store, pin)`** — Phase 5 wrapper. Used by the PIN modal entry flow, NOT by the PIN change re-verification (which uses raw `adminPin.verifyPin`).
- **`log.audit(event, fields)`** — Phase 5 structured audit logging. Used for all new audit events.
- **Existing `close-admin-menu` IPC handler** (main.js lines 842-850) — Currently only used by PAT config cancel. Phase 08 extends this as the canonical admin:close path.

### Established Patterns
- **Sibling divs on layered z-index, IPC-toggled** — Phase 1 D-01. All new surfaces follow this.
- **Main sends, host renders** — admin menu state (`adminMenuOpen`) lives in main.js. Host.js is a dumb renderer.
- **`wireAdminButtons()`** pattern (host.js lines 671-745) — maps button IDs to action strings, attaches click handlers. Phase 08 adds new button ID mappings here.
- **`.bsk-btn--primary` + card patterns** in host.css — reused for PIN change overlay and X button.

### Integration Points
- `main.js` `admin-menu-action` switch (lines 751-834) — add `pin-change` action case, modify `reload` case with `magiclineView.exists()` check.
- `main.js` `verify-admin-pin` handler (lines 694-727) — modify to check `adminMenuOpen` and toggle if already open (Ctrl+Shift+F12 toggle behavior).
- `host.js` admin button wiring (lines 673-679) — add `#admin-btn-pin-change` mapping.
- `host.html` admin menu button list — insert new button and X close button.

</code_context>

<specifics>
## Specific Ideas

- The Ctrl+Shift+F12 toggle is natural: the hotkey handler already checks state. If `adminMenuOpen === true`, skip PIN modal and route straight to `admin:close`.
- The "fresh session on reload from welcome" behavior means admin gets exactly what a customer gets on tap — no special admin session path, just the standard welcome-tap flow.
- PIN change re-verification (entering current PIN again) is defense in depth, not UI friction — it prevents the "maintenance tech quietly resets PIN" threat from the ADMIN-03 todo.
- The credentials overlay bug may be as simple as main.js sending the wrong `firstRun` value in the `re-enter-credentials` action handler — research should verify the actual IPC payload before assuming a host.js rendering bug.

</specifics>

<deferred>
## Deferred Ideas

- **POS open/close toggle** — ADMIN-02, Phase 09 scope. User mentioned during discussion; already mapped in roadmap.
- **"PIN andern" as a separate admin path** was originally marked out of scope in REQUIREMENTS.md for v1.1 but has been folded INTO Phase 08 per user decision during this discussion. REQUIREMENTS.md should be updated to reflect this scope addition.
- **Cash-register banner for `posOpen=false` mid-session** — lower-priority polish on ADMIN-02, explicitly deferred in REQUIREMENTS.md.

### Reviewed Todos (not folded)
- `2026-04-14-gsd-new-milestone-phases-clear-destructive.md` — meta-tooling fix, not project scope.

</deferred>

---

*Phase: 08-admin-menu-polish-reload-fix*
*Context gathered: 2026-04-20*
