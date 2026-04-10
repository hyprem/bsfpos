---
phase: 05-admin-exit-logging-auto-update-branded-polish
plan: 05
type: execute
wave: 2
depends_on: ["05-04-main-orchestration-PLAN"]
files_modified:
  - src/host/host.html
  - src/host/host.css
  - src/host/host.js
autonomous: true
requirements: [ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-08, BRAND-01, BRAND-02, BRAND-03]
tags: [host-ui, branded, admin-menu, updating-cover, pin-lockout, error-variants]
must_haves:
  truths:
    - "host.html contains <div id='admin-menu'> at z-index layer 500 with the 6 buttons in safe→destructive order from UI-SPEC §Component Inventory"
    - "host.html contains <div id='update-config'> sibling at layer 500 with masked password input + Speichern + Abbrechen"
    - "host.html contains <div id='updating-cover'> at layer 300 with logo, CSS spinner, heading 'Aktualisierung läuft', subtext"
    - "host.html contains <div id='pin-lockout-panel'> inside #pin-modal .bsk-card--pin, hidden by default"
    - "host.css declares .bsk-layer--admin at z-index 500, .bsk-layer--updating at z-index 300, .bsk-spinner with @keyframes bsk-spin"
    - "host.css .bsk-btn--admin-action has min-height: 64px and font-size: 18px"
    - "host.css .bsk-btn--admin-exit overrides font-size to 20px (WCAG large-text contrast correction from UI-SPEC)"
    - "host.css .bsk-pin-lockout-countdown uses font-size: 48px, color: #F5C518, font-variant-numeric: tabular-nums"
    - "host.js wires all admin menu buttons via window.kiosk.adminMenuAction(action)"
    - "host.js handles show-pin-modal with context payload, routing context='admin' to verifyAdminPin and context='reset-loop' to the existing verifyPin path"
    - "host.js renders PIN lockout countdown in mm:ss format via setInterval, with guard against double-start"
    - "host.js handles show-admin-update-result by showing the inline result text and auto-hiding after 5 seconds"
    - "host.js handles show-magicline-error variants 'bad-release' and 'update-failed' (10s auto-dismiss for update-failed)"
    - "host.js 'Abbrechen' button in #update-config returns to admin menu without losing adminMenuOpen state"
    - "All new interactive elements in DevTools computed style have width × height ≥ 44 × 44 px"
    - "Magicline content area is visually unchanged (no new rules target [class^='css-'] or Magicline brand colors)"
  artifacts:
    - path: "src/host/host.html"
      provides: "New layer 500 admin menu + update-config, layer 300 updating cover, PIN lockout panel, 2 new magicline-error variants"
      contains: "id=\"admin-menu\""
    - path: "src/host/host.css"
      provides: ".bsk-layer--admin, .bsk-card--admin, .bsk-admin-diagnostics, .bsk-btn--admin-action, .bsk-btn--admin-exit, .bsk-layer--updating, .bsk-spinner, @keyframes bsk-spin, .bsk-pin-lockout-* styles"
      contains: "@keyframes bsk-spin"
    - path: "src/host/host.js"
      provides: "Admin menu open/close handlers, diagnostic renderer, PIN lockout countdown, PAT form submit, updating cover toggle, error variant handlers"
      contains: "verifyAdminPin"
  key_links:
    - from: "src/host/host.html"
      to: "src/host/host.css"
      via: "class names .bsk-layer--admin, .bsk-btn--admin-action, .bsk-spinner etc."
    - from: "src/host/host.js"
      to: "window.kiosk.adminMenuAction"
      via: "button click handler → invoke"
      pattern: "window\\.kiosk\\.adminMenuAction"
    - from: "src/host/host.js"
      to: "window.kiosk.verifyAdminPin"
      via: "admin PIN OK key handler"
      pattern: "verifyAdminPin"
---

<objective>
Implement all Phase 5 host renderer surfaces per the locked UI-SPEC:
- `#admin-menu` (layer 500) with diagnostic header + 6-button stack
- `#update-config` (layer 500, mutually exclusive with admin-menu) with masked PAT input
- `#updating-cover` (layer 300, sibling of #magicline-error) with logo + CSS spinner
- `#pin-lockout-panel` inside existing `#pin-modal` with 48px countdown
- Two new `#magicline-error` variants: `bad-release` (PIN button visible) and `update-failed` (auto-dismiss 10s)

Purpose: Close ADMIN-01 (PIN prompt UI), ADMIN-02 (admin menu UI), ADMIN-03 (lockout UI), ADMIN-08 (updating cover + bad-release/update-failed), BRAND-01 (logo/colors), BRAND-02 (44×44 touch targets), BRAND-03 (Magicline content area untouched).

Output: 3 modified files. Every new element is additive; existing Phase 1-4 markup unchanged except the z-index ladder comment and the show-pin-modal payload handler (which becomes context-aware).

Scope gate: Phase 5 polishes **only new Phase 5 surfaces** per CONTEXT.md D-33. Do NOT touch existing splash, idle overlay, credentials overlay, or baseline magicline-error styling. Those live in the deferred next-visit batch.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md
@.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-CONTEXT.md
@src/host/host.html
@src/host/host.css
@src/host/host.js
@src/main/preload.js
</context>

<interfaces>
Phase 5 IPC surface consumed by host.js (from preload.js post Plan 04):

Main → Renderer (subscribe via window.kiosk.on*):
- `onShowAdminMenu(cb)` — cb receives `{version, lastUpdateCheck, authState, lastResetAt, updateStatus, patConfigured}`
- `onHideAdminMenu(cb)`
- `onShowUpdateConfig(cb)` — cb receives `{hasExistingPat: boolean}`
- `onHideUpdateConfig(cb)`
- `onShowUpdatingCover(cb)`
- `onHideUpdatingCover(cb)`
- `onShowAdminUpdateResult(cb)` — cb receives `{status: 'available'|'none'|'error'|'disabled', message?}`
- `onShowPinLockout(cb)` — cb receives `{lockedUntil: ISO string}`
- `onHidePinLockout(cb)`
- `onShowPinModal(cb)` — now receives `{context: 'admin'|'reset-loop'}` (context added in Plan 04)
- `onShowMagiclineError(cb)` — existing; now cb handles `variant: 'bad-release'|'update-failed'` in addition to prior variants

Renderer → Main (invoke):
- `verifyAdminPin(pin)` → `{ok, locked, lockedUntil}`
- `getAdminDiagnostics()` → diagnostic object
- `adminMenuAction(action)` → `{ok, result?, error?}` where action ∈ {check-updates, view-logs, reload, re-enter-credentials, configure-auto-update, exit-to-windows}
- `closeAdminMenu()` → `{ok}`
- `submitUpdatePat(pat)` → `{ok, error?}`
- `verifyPin(pin)` — EXISTING; still used for reset-loop recovery path only

PIN modal context routing in host.js:
- Current host.js code around line 342 calls `window.kiosk.verifyPin(submitted)`
- Phase 5 adds a module-scoped `let pinModalContext = 'admin';` variable set by onShowPinModal
- Phase 5 routes: if context === 'admin' → `verifyAdminPin`; if context === 'reset-loop' → existing `verifyPin` (backward compat)
</interfaces>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| member touchscreen → host renderer | Untrusted member input could flood admin menu |
| host renderer → main IPC (invoke) | Trust boundary into main process |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-05-28 | E (Elevation) | Member discovers admin menu because it's visible beneath the PIN modal | mitigate | Admin menu hidden (`style="display:none"`) until main sends `show-admin-menu` IPC. Unit-eyeball: DOM on page load has admin-menu inert |
| T-05-29 | T (Tampering) | Reset-loop PIN recovery accidentally hits verifyAdminPin → resetLoopPending lost | mitigate | Context routing in host.js pinModalContext; reset-loop context uses legacy verifyPin. Grep asserts both code paths exist |
| T-05-30 | I (Info disclosure) | PAT input field retained in DOM after save | mitigate | After submit success, input value cleared via `.value=''` and field hidden with form. Grep asserts clear step present |
| T-05-31 | T (Tampering) | Countdown setInterval leak across repeated PIN modal opens (Pitfall 4) | mitigate | Clear prior interval before starting new: `if (lockoutInterval) clearInterval(lockoutInterval);`. Grep asserts guard pattern |
| T-05-32 | D (DoS) | update-failed variant blocks kiosk forever if auto-dismiss timer leaks | mitigate | setTimeout(10_000) + one-shot pointerdown listener; both cleaned on hide. Grep asserts cleanup |
| T-05-33 | I (Info disclosure) | Admin update result text leaks PAT error details (403 body etc.) | mitigate | Only status strings shown to admin: 'Aktuell' / 'Update verfügbar — …'. Never display raw error messages from checkForUpdates |
| T-05-34 | E (Elevation) | Magicline content area theme drift from new Phase 5 CSS | mitigate | All new CSS rules target `#admin-menu, #update-config, #updating-cover, #pin-lockout-panel` classes/ids that do NOT exist inside the Magicline BrowserView. Grep asserts no selectors target `[class^="css-"]` or `.MuiBox`. BRAND-03 preserved |
</threat_model>

<tasks>

<task type="auto">
  <name>Task 1: Extend host.html with Phase 5 DOM layers</name>
  <read_first>
    - src/host/host.html (ENTIRE file — z-index ladder comment, #pin-modal structure)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md §Component Inventory (each component's DOM structure is specified verbatim)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md §Copywriting Contract (German copy)
  </read_first>
  <action>
    Make the following surgical edits to `src/host/host.html`:

    **Edit 1 — update z-index ladder comment** (lines 13-19). Replace with:
    ```html
      <!--
        Z-index ladder (per 01-UI-SPEC.md + 05-UI-SPEC.md):
          0   — #magicline-mount — Phase 2 BrowserView attach point
          100 — #splash — Phase 1 branded splash cover
          200 — #idle-overlay — Phase 4 idle "Noch da?" overlay
          300 — #magicline-error (Phase 2/3 variants + Phase 5 bad-release, update-failed)
          300 — #updating-cover — Phase 5 mutually exclusive with #magicline-error
          400 — #credentials-overlay + #pin-modal (Phase 3 + Phase 5 admin PIN lockout panel)
          500 — #admin-menu + #update-config — Phase 5 (mutually exclusive)

        Rules:
        - host.html never navigates away. Layers are toggled via `display` from host.js.
        - Strict CSP: no inline scripts, no inline event handlers — all wiring in host.js.
        - Phase 5: #admin-menu and #update-config share layer 500 (mutually exclusive).
        - Phase 5: #updating-cover and #magicline-error share layer 300 (mutually exclusive).
      -->
    ```

    **Edit 2 — add updating cover at layer 300** (insert immediately AFTER the existing `#magicline-error` closing `</div>` around line 62):
    ```html

      <!-- LAYER 300: Updating cover (Phase 5, sibling of #magicline-error) -->
      <div id="updating-cover"
           class="bsk-layer bsk-layer--updating"
           style="display:none;"
           aria-hidden="true"
           role="status"
           aria-label="Aktualisierung läuft">
        <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="220">
        <div class="bsk-spinner" aria-hidden="true"></div>
        <h1 class="bsk-updating-heading">Aktualisierung läuft</h1>
        <p class="bsk-updating-subtext">Bitte warten &mdash; der Kiosk startet gleich neu.</p>
      </div>
    ```

    **Edit 3 — add PIN lockout panel inside existing #pin-modal** (insert inside `.bsk-card--pin` AFTER the `<div class="bsk-keypad">...</div>` closing `</div>` and BEFORE the card's closing `</div>`, around line 129):
    ```html
          <!-- Phase 5 ADMIN-03: PIN lockout panel — replaces keypad view while locked -->
          <div id="pin-lockout-panel" style="display:none;" aria-live="assertive">
            <p class="bsk-pin-lockout-msg">Zu viele Versuche &mdash; bitte warten</p>
            <p id="pin-lockout-countdown" class="bsk-pin-lockout-countdown">05:00</p>
          </div>
    ```

    **Edit 4 — add admin menu at layer 500** (insert immediately BEFORE the closing `</body>` tag, before the `<script src="host.js">` line):
    ```html

      <!-- LAYER 500: Admin menu (Phase 5 D-01) -->
      <div id="admin-menu"
           class="bsk-layer bsk-layer--admin"
           style="display:none;"
           aria-hidden="true"
           role="dialog"
           aria-label="Admin-Menü">
        <div class="bsk-card bsk-card--admin">
          <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="160">
          <h2 class="bsk-card-title">Admin-Men&uuml;</h2>
          <div class="bsk-admin-diagnostics" aria-label="Systemstatus">
            <div class="bsk-diag-row"><span class="bsk-diag-label">Version</span><span class="bsk-diag-value" id="diag-version">&mdash;</span></div>
            <div class="bsk-diag-row"><span class="bsk-diag-label">Letztes Update</span><span class="bsk-diag-value" id="diag-last-update">&mdash;</span></div>
            <div class="bsk-diag-row"><span class="bsk-diag-label">Status</span><span class="bsk-diag-value" id="diag-auth-state">&mdash;</span></div>
            <div class="bsk-diag-row"><span class="bsk-diag-label">Letzter Reset</span><span class="bsk-diag-value" id="diag-last-reset">&mdash;</span></div>
            <div class="bsk-diag-row"><span class="bsk-diag-label">Auto-Update</span><span class="bsk-diag-value" id="diag-update-status">&mdash;</span></div>
          </div>
          <div class="bsk-admin-btns">
            <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-check-updates">Updates pr&uuml;fen</button>
            <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-logs">Protokolle anzeigen</button>
            <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-reload">Kasse nachladen</button>
            <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-credentials">Anmeldedaten &auml;ndern</button>
            <button type="button" class="bsk-btn bsk-btn--admin-action" id="admin-btn-update-config">Auto-Update einrichten</button>
            <button type="button" class="bsk-btn bsk-btn--admin-action bsk-btn--admin-exit" id="admin-btn-exit">Beenden</button>
          </div>
          <p id="admin-update-result" class="bsk-admin-update-result" style="display:none;"></p>
        </div>
      </div>

      <!-- LAYER 500: Update config (Phase 5 D-20, mutually exclusive with #admin-menu) -->
      <div id="update-config"
           class="bsk-layer bsk-layer--admin"
           style="display:none;"
           aria-hidden="true"
           role="dialog"
           aria-label="Auto-Update konfigurieren">
        <div class="bsk-card">
          <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="160">
          <h2 class="bsk-card-title">Auto-Update einrichten</h2>
          <p class="bsk-update-config-hint">
            GitHub Personal Access Token (PAT) mit <strong>contents:read</strong>-Berechtigung
            f&uuml;r das private Releases-Repository eingeben.
          </p>
          <label class="bsk-field">
            <span class="bsk-field-label">GitHub PAT</span>
            <input type="password" id="update-pat-input" class="bsk-input" autocomplete="off" spellcheck="false" autocapitalize="none" aria-label="GitHub Personal Access Token">
          </label>
          <p id="update-config-error" class="bsk-field-error" style="display:none;"></p>
          <button type="button" id="update-config-save" class="bsk-btn bsk-btn--primary" disabled>Speichern</button>
          <button type="button" id="update-config-cancel" class="bsk-btn">Abbrechen</button>
        </div>
      </div>
    ```

    Do NOT touch existing `#magicline-mount`, `#splash`, `#idle-overlay`, `#credentials-overlay`, or the `#pin-modal` outer structure / keypad buttons.
  </action>
  <verify>
    <automated>grep -q 'id="admin-menu"' src/host/host.html && grep -q 'id="update-config"' src/host/host.html && grep -q 'id="updating-cover"' src/host/host.html && grep -q 'id="pin-lockout-panel"' src/host/host.html && grep -q 'id="diag-version"' src/host/host.html && grep -q 'admin-btn-check-updates' src/host/host.html && grep -q 'admin-btn-exit' src/host/host.html && grep -q 'update-pat-input' src/host/host.html && grep -q 'Aktualisierung läuft' src/host/host.html && echo ok</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n 'id="admin-menu"' src/host/host.html` matches once
    - `grep -n 'id="update-config"' src/host/host.html` matches once
    - `grep -n 'id="updating-cover"' src/host/host.html` matches once
    - `grep -n 'id="pin-lockout-panel"' src/host/host.html` matches once
    - `grep -c 'id="admin-btn-' src/host/host.html` == 6 (six admin buttons)
    - All 6 button IDs present: `admin-btn-check-updates`, `admin-btn-logs`, `admin-btn-reload`, `admin-btn-credentials`, `admin-btn-update-config`, `admin-btn-exit`
    - `grep -n 'id="diag-version"' src/host/host.html` matches
    - `grep -c 'class="bsk-diag-row"' src/host/host.html` == 5 (five diagnostic rows)
    - `grep -n 'id="update-pat-input"' src/host/host.html` matches — with `type="password"`
    - `grep -n 'Aktualisierung läuft' src/host/host.html` matches (heading copy)
    - `grep -n 'Zu viele Versuche' src/host/host.html` matches (lockout message)
    - `grep -n 'Admin-Menü' src/host/host.html` matches (aria-label)
    - Z-index ladder comment contains `500 — #admin-menu`
    - `grep -n 'Beenden' src/host/host.html` matches (exit button label)
    - Existing `#splash`, `#idle-overlay`, `#credentials-overlay`, `#pin-modal`, `#magicline-mount` still present
    - `grep -c 'id="magicline-mount"' src/host/host.html` == 1 (not duplicated)
    - host.html still references `host.js` and `host.css` (lines near top and bottom unchanged)
  </acceptance_criteria>
  <done>host.html contains all 5 Phase 5 DOM additions (admin menu, update config, updating cover, PIN lockout panel, updated ladder comment); prior markup intact.</done>
</task>

<task type="auto">
  <name>Task 2: Add Phase 5 styles to host.css</name>
  <read_first>
    - src/host/host.css (ENTIRE file — understand existing .bsk-layer, .bsk-card, .bsk-btn, .bsk-input token structure)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md §Component Inventory CSS blocks (VERBATIM specs) §Typography scoped overrides §Touch Target Audit Contract
  </read_first>
  <action>
    Append the following CSS block to the END of `src/host/host.css` (after the last existing rule). Do NOT modify any existing rule. Every selector below is new and additive.

    ```css

    /* ========================================================================
       Phase 5 — Admin menu, update config, updating cover, PIN lockout, error variants
       UI-SPEC: 05-UI-SPEC.md §Component Inventory
       All rules additive; existing Phase 1-4 selectors are not touched.
       ======================================================================== */

    /* --- Admin menu + update config (Layer 500) -------------------------- */

    .bsk-layer--admin {
      z-index: 500;
      background: rgba(26, 26, 26, 0.97);
      pointer-events: auto;
      overflow-y: auto;
    }

    .bsk-card--admin {
      gap: 16px;
      padding: 32px;
      max-height: 92vh;
      overflow-y: auto;
    }

    .bsk-admin-diagnostics {
      border-top: 1px solid #3A3A3A;
      border-bottom: 1px solid #3A3A3A;
      padding: 8px 0;
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .bsk-diag-row {
      display: flex;
      justify-content: space-between;
      align-items: baseline;
      gap: 8px;
    }

    .bsk-diag-label {
      font-size: 14px;
      font-weight: 700;
      color: #9CA3AF;
      flex-shrink: 0;
    }

    .bsk-diag-value {
      font-size: 16px;
      font-weight: 400;
      color: #FFFFFF;
      text-align: right;
      word-break: break-word;
    }

    .bsk-admin-btns {
      display: flex;
      flex-direction: column;
      gap: 8px;
    }

    .bsk-btn--admin-action {
      min-height: 64px;
      width: 100%;
      font-size: 18px;
      font-weight: 700;
      background: #2A2A2A;
      color: #FFFFFF;
      border: 2px solid #3A3A3A;
      border-radius: 8px;
      text-align: center;
      letter-spacing: 0.01em;
    }

    .bsk-btn--admin-action:active {
      background: #3A3A3A;
    }

    .bsk-btn--admin-exit {
      background: #1A1A1A;
      border-color: #FF6B6B;
      color: #FF6B6B;
      margin-top: 8px;
      font-size: 20px; /* WCAG large-text contrast correction per UI-SPEC */
    }

    .bsk-btn--admin-exit:active {
      background: rgba(255, 107, 107, 0.12);
    }

    .bsk-admin-update-result {
      font-size: 14px;
      font-weight: 700;
      color: #9CA3AF;
      text-align: center;
      margin: 0;
    }

    .bsk-admin-update-result--available {
      color: #F5C518;
    }

    /* Update config (reuses .bsk-layer--admin z-index + backdrop) */

    .bsk-update-config-hint {
      font-size: 14px;
      font-weight: 400;
      color: #9CA3AF;
      text-align: center;
      margin: 0;
      line-height: 1.4;
      padding: 0 8px;
    }

    .bsk-update-config-hint strong {
      color: #FFFFFF;
      font-weight: 700;
    }

    /* --- Updating cover (Layer 300) -------------------------------------- */

    .bsk-layer--updating {
      z-index: 300;
      background: #1A1A1A;
      pointer-events: auto;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      padding: 48px 32px;
    }

    .bsk-spinner {
      width: 48px;
      height: 48px;
      border: 4px solid #3A3A3A;
      border-top-color: #F5C518;
      border-radius: 50%;
      animation: bsk-spin 0.9s linear infinite;
      margin: 24px 0 16px 0;
    }

    @keyframes bsk-spin {
      to { transform: rotate(360deg); }
    }

    .bsk-updating-heading {
      font-size: 24px;
      font-weight: 700;
      color: #FFFFFF;
      text-align: center;
      margin: 0 0 8px 0;
      line-height: 1.2;
    }

    .bsk-updating-subtext {
      font-size: 16px;
      font-weight: 400;
      color: #9CA3AF;
      text-align: center;
      margin: 0;
      padding: 0 32px;
      line-height: 1.5;
    }

    /* --- PIN modal lockout panel (inside existing #pin-modal) ------------ */

    .bsk-pin-lockout-msg {
      font-size: 16px;
      font-weight: 400;
      color: #FFFFFF;
      text-align: center;
      margin: 0 0 16px 0;
      line-height: 1.5;
      padding: 0 16px;
    }

    .bsk-pin-lockout-countdown {
      font-size: 48px;
      font-weight: 700;
      color: #F5C518;
      line-height: 1.0;
      text-align: center;
      margin: 0;
      font-variant-numeric: tabular-nums;
    }
    ```

    Do NOT add any rule targeting `[class^="css-"]`, `.MuiBox`, `.MuiButton`, or any Magicline-content selector. Phase 5 BRAND-03 explicitly preserves Magicline's own styling.
  </action>
  <verify>
    <automated>grep -q "@keyframes bsk-spin" src/host/host.css && grep -q ".bsk-layer--admin" src/host/host.css && grep -q ".bsk-layer--updating" src/host/host.css && grep -q ".bsk-pin-lockout-countdown" src/host/host.css && grep -q ".bsk-btn--admin-action" src/host/host.css && grep -q "font-size: 48px" src/host/host.css && grep -q "font-size: 20px" src/host/host.css && grep -q "min-height: 64px" src/host/host.css && ! grep -qE '\[class\^="css-"\]|\.MuiBox|\.MuiButton' src/host/host.css && echo ok</automated>
  </verify>
  <acceptance_criteria>
    - `grep -n "@keyframes bsk-spin" src/host/host.css` matches
    - `grep -n "\.bsk-layer--admin" src/host/host.css` matches
    - `grep -n "z-index: 500" src/host/host.css` matches (admin layer)
    - `grep -n "\.bsk-layer--updating" src/host/host.css` matches
    - `grep -n "z-index: 300" src/host/host.css` matches (updating cover)
    - `grep -n "\.bsk-spinner" src/host/host.css` matches
    - `grep -n "\.bsk-btn--admin-action" src/host/host.css` matches
    - `grep -n "min-height: 64px" src/host/host.css` matches
    - `grep -n "\.bsk-btn--admin-exit" src/host/host.css` matches
    - `grep -n "font-size: 20px" src/host/host.css` matches (exit button WCAG correction)
    - `grep -n "\.bsk-pin-lockout-countdown" src/host/host.css` matches
    - `grep -n "font-size: 48px" src/host/host.css` matches (lockout countdown)
    - `grep -n "font-variant-numeric: tabular-nums" src/host/host.css` matches
    - `grep -n "#F5C518" src/host/host.css` matches in Phase 5 block (inherited brand accent)
    - `grep -cE "\[class\\^=.css-.\]|\.MuiBox|\.MuiButton" src/host/host.css` == 0 (BRAND-03 preserved)
    - Pre-existing rules for `.bsk-layer--splash`, `.bsk-layer--idle`, `.bsk-layer--credentials`, `.bsk-layer--pin` still present (not deleted)
    - `grep -c "^@keyframes " src/host/host.css` ≥ 1 (bsk-spin exists; others preserved if any)
  </acceptance_criteria>
  <done>host.css has all Phase 5 Component Inventory blocks appended; no changes to prior Phase 1-4 rules; BRAND-03 Magicline-untouched contract preserved.</done>
</task>

<task type="auto">
  <name>Task 3: Extend host.js with Phase 5 wiring (admin menu, PAT form, lockout, updating cover, error variants, PIN context routing)</name>
  <read_first>
    - src/host/host.js (ENTIRE file — particularly the existing showPinModal/hidePinModal/verifyPin click handler around lines 320-360, the showMagiclineError variant handler, and the final kiosk.on* subscriber block around line 427)
    - src/main/preload.js (post Plan 04 — confirms the new window.kiosk.* methods exist)
    - .planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-UI-SPEC.md §Component Inventory (Lockout UX flow) §Copywriting Contract §Error Variants
  </read_first>
  <behavior>
    - New helper functions (IIFE-scoped):
      - `showAdminMenu(diagnostics)`, `hideAdminMenu()`
      - `showUpdateConfig(payload)`, `hideUpdateConfig()`
      - `showUpdatingCover()`, `hideUpdatingCover()`
      - `showPinLockout({lockedUntil})`, `hidePinLockout()`, `renderLockoutCountdown(deltaMs)`
      - `renderDiagnostics(d)` updates the 5 `#diag-*` spans; relative time helper for ISO/numeric timestamps
      - `showAdminUpdateResult({status, message})` toggles `#admin-update-result` visibility with `setTimeout(5000)` auto-hide
    - PIN modal context routing: new module-scoped `let pinModalContext = 'admin';`
      - `onShowPinModal(payload)` stores `pinModalContext = (payload && payload.context) || 'admin'`, then calls existing `showPinModal()` behavior (hide lockout panel, show keypad, reset PIN input)
      - Existing PIN OK key click handler uses `pinModalContext` to decide: `'admin'` → `verifyAdminPin` (new channel, result includes `locked`/`lockedUntil`); `'reset-loop'` → existing `verifyPin` legacy channel
    - Admin button handlers: each of the 6 `#admin-btn-*` buttons calls `window.kiosk.adminMenuAction('...')` with the correct action string
    - Update config form:
      - `#update-pat-input` `input` event: enable `#update-config-save` iff value.trim() non-empty AND no whitespace (`!/\s/.test(value.trim())`)
      - `#update-config-save` click: invoke `submitUpdatePat(value)`. On `{ok:true}`: clear input, hide update-config — main will send show-admin-menu. On `{ok:false}`: show error text inline (`#update-config-error`) with `'PAT ungültig — Verbindungsfehler. Bitte prüfen und erneut speichern.'` for `safestorage-unavailable` / `empty-or-whitespace`. Empty case text: `'Bitte PAT eingeben'`
      - `#update-config-cancel` click: invoke `closeAdminMenu` (NO — the cancel goes back to admin menu, not dismiss. Per UI-SPEC: "Returns to admin menu (shows #admin-menu, hides #update-config, no state change)"). So: hide update-config + re-request admin menu render via `getAdminDiagnostics()` → call showAdminMenu manually.
    - Lockout countdown:
      - `showPinLockout({lockedUntil})`: hide `.bsk-keypad`, hide `#pin-modal-error`, hide `#pin-display`, show `#pin-lockout-panel`, compute remaining ms, start `setInterval(1000)` updating `#pin-lockout-countdown` text in `mm:ss` format. **Guard**: `if (lockoutInterval) clearInterval(lockoutInterval);` before starting
      - When remaining ≤ 0: clear interval, hide `#pin-lockout-panel`, re-show `.bsk-keypad` + `#pin-display` (reset to `····`), keep modal open (staff can retry immediately)
    - Updating cover: simple show/hide toggling `#updating-cover` display
    - New magicline-error variants in existing `showMagiclineError(payload)` switch:
      - `'bad-release'`: title "Update fehlgeschlagen", subtext "Bitte Studio-Personal verständigen", `#error-pin-button` visible
      - `'update-failed'`: title "Aktualisierung fehlgeschlagen", subtext "Erneuter Versuch beim nächsten Neustart — der Kiosk läuft weiter.", `#error-pin-button` hidden, start `setTimeout(10000, () => hideMagiclineError())` AND one-shot `pointerdown` listener on the element that also calls hide. Both cleanup on hide
  </behavior>
  <action>
    Edit `src/host/host.js`. Do NOT rewrite the whole file — add new code inside the existing IIFE and update the two existing handlers (show-pin-modal subscriber and showMagiclineError switch) to honor the new contracts.

    **Edit A — add module-scoped Phase 5 state near other `let` declarations near the top of the IIFE (look for where Phase 4 idle state is declared):**
    ```javascript
      // --- Phase 5 state ------------------------------------------------------
      let pinModalContext = 'admin';          // 'admin' | 'reset-loop'
      let lockoutInterval = null;             // countdown setInterval id
      let adminUpdateResultTimer = null;      // 5s auto-hide for admin update result
      let updateFailedTimer = null;           // 10s auto-dismiss for update-failed variant
      let updateFailedHandler = null;         // one-shot pointerdown listener for update-failed
    ```

    **Edit B — add helper functions in the IIFE body (before the `kiosk.on*` subscriber block):**
    ```javascript
      // --- Phase 5 helpers ----------------------------------------------------

      function formatRelativeGerman(iso) {
        if (!iso) return 'noch nie';
        const t = (typeof iso === 'number') ? iso : Date.parse(iso);
        if (!Number.isFinite(t)) return 'noch nie';
        const diff = Date.now() - t;
        if (diff < 60_000) return 'gerade eben';
        const mins = Math.floor(diff / 60_000);
        if (mins < 60) return 'vor ' + mins + ' Min';
        const hrs = Math.floor(mins / 60);
        if (hrs < 24) return 'vor ' + hrs + ' Std';
        const days = Math.floor(hrs / 24);
        return 'vor ' + days + ' Tag(en)';
      }

      function authStateLabel(s) {
        switch (s) {
          case 'CASH_REGISTER_READY': return 'BEREIT';
          case 'LOGIN_SUBMITTED':     return 'ANMELDUNG';
          case 'LOGIN_DETECTED':      return 'LOGIN ERKANNT';
          case 'BOOTING':             return 'STARTET';
          case 'NEEDS_CREDENTIALS':   return 'KEINE DATEN';
          case 'CREDENTIALS_UNAVAILABLE': return 'FEHLER';
          default:                    return s || 'UNBEKANNT';
        }
      }

      function renderDiagnostics(d) {
        if (!d) return;
        var set = (id, text) => {
          var el = document.getElementById(id);
          if (el) el.textContent = text;
        };
        set('diag-version',       d.version ? ('v' + d.version) : '—');
        set('diag-last-update',   formatRelativeGerman(d.lastUpdateCheck));
        set('diag-auth-state',    authStateLabel(d.authState));
        set('diag-last-reset',    formatRelativeGerman(d.lastResetAt));
        set('diag-update-status', d.updateStatus || '—');
        // Swap "Configure auto-update" / "Update-Zugang ändern" label
        var cfgBtn = document.getElementById('admin-btn-update-config');
        if (cfgBtn) cfgBtn.textContent = d.patConfigured ? 'Update-Zugang ändern' : 'Auto-Update einrichten';
      }

      function showAdminMenu(diagnostics) {
        renderDiagnostics(diagnostics);
        var menu = document.getElementById('admin-menu');
        if (menu) { menu.style.display = 'flex'; menu.setAttribute('aria-hidden', 'false'); }
        // Ensure update-config is hidden
        var cfg = document.getElementById('update-config');
        if (cfg) { cfg.style.display = 'none'; cfg.setAttribute('aria-hidden', 'true'); }
      }

      function hideAdminMenu() {
        var menu = document.getElementById('admin-menu');
        if (menu) { menu.style.display = 'none'; menu.setAttribute('aria-hidden', 'true'); }
        var res = document.getElementById('admin-update-result');
        if (res) res.style.display = 'none';
        if (adminUpdateResultTimer) { clearTimeout(adminUpdateResultTimer); adminUpdateResultTimer = null; }
      }

      function showUpdateConfig(payload) {
        var cfg = document.getElementById('update-config');
        if (cfg) { cfg.style.display = 'flex'; cfg.setAttribute('aria-hidden', 'false'); }
        var menu = document.getElementById('admin-menu');
        if (menu) { menu.style.display = 'none'; menu.setAttribute('aria-hidden', 'true'); }
        var input = document.getElementById('update-pat-input');
        if (input) input.value = '';
        var save = document.getElementById('update-config-save');
        if (save) save.disabled = true;
        var err = document.getElementById('update-config-error');
        if (err) err.style.display = 'none';
      }

      function hideUpdateConfig() {
        var cfg = document.getElementById('update-config');
        if (cfg) { cfg.style.display = 'none'; cfg.setAttribute('aria-hidden', 'true'); }
        var input = document.getElementById('update-pat-input');
        if (input) input.value = ''; // defensive: never retain PAT in DOM
      }

      function showUpdatingCover() {
        var el = document.getElementById('updating-cover');
        if (el) { el.style.display = 'flex'; el.setAttribute('aria-hidden', 'false'); }
      }

      function hideUpdatingCover() {
        var el = document.getElementById('updating-cover');
        if (el) { el.style.display = 'none'; el.setAttribute('aria-hidden', 'true'); }
      }

      function showAdminUpdateResult(payload) {
        var el = document.getElementById('admin-update-result');
        if (!el) return;
        var text = '—';
        var status = payload && payload.status;
        if (status === 'none') text = 'Aktuell';
        else if (status === 'available') text = 'Update verfügbar — wird bei nächster Ruhepause installiert';
        else if (status === 'disabled') text = 'Auto-Update nicht konfiguriert';
        else if (status === 'error') text = 'Fehler bei der Update-Prüfung';
        el.textContent = text;
        el.classList.toggle('bsk-admin-update-result--available', status === 'available');
        el.style.display = 'block';
        if (adminUpdateResultTimer) clearTimeout(adminUpdateResultTimer);
        adminUpdateResultTimer = setTimeout(() => {
          el.style.display = 'none';
          adminUpdateResultTimer = null;
        }, 5000);
      }

      function formatMmSs(remainingMs) {
        if (remainingMs < 0) remainingMs = 0;
        var mins = Math.floor(remainingMs / 60_000);
        var secs = Math.floor((remainingMs % 60_000) / 1000);
        return String(mins).padStart(2, '0') + ':' + String(secs).padStart(2, '0');
      }

      function showPinLockout(payload) {
        var modal = document.getElementById('pin-modal');
        if (modal && modal.style.display === 'none') {
          modal.style.display = 'flex';
          modal.setAttribute('aria-hidden', 'false');
        }
        var keypad = document.querySelector('#pin-modal .bsk-keypad');
        var display = document.getElementById('pin-display');
        var errEl = document.getElementById('pin-modal-error');
        var panel = document.getElementById('pin-lockout-panel');
        var countdownEl = document.getElementById('pin-lockout-countdown');
        if (keypad) keypad.style.display = 'none';
        if (display) display.style.display = 'none';
        if (errEl) errEl.style.display = 'none';
        if (panel) panel.style.display = 'block';

        // PITFALL 4: guard against double setInterval
        if (lockoutInterval) { clearInterval(lockoutInterval); lockoutInterval = null; }

        var until = payload && payload.lockedUntil ? Date.parse(payload.lockedUntil) : 0;
        function tick() {
          var remaining = until - Date.now();
          if (countdownEl) countdownEl.textContent = formatMmSs(remaining);
          if (remaining <= 0) {
            clearInterval(lockoutInterval);
            lockoutInterval = null;
            hidePinLockout();
          }
        }
        tick();
        lockoutInterval = setInterval(tick, 1000);
      }

      function hidePinLockout() {
        if (lockoutInterval) { clearInterval(lockoutInterval); lockoutInterval = null; }
        var panel = document.getElementById('pin-lockout-panel');
        if (panel) panel.style.display = 'none';
        var keypad = document.querySelector('#pin-modal .bsk-keypad');
        var display = document.getElementById('pin-display');
        if (keypad) keypad.style.display = '';
        if (display) {
          display.style.display = '';
          display.textContent = '····';
        }
      }

      // --- Phase 5 admin button wiring (attach once on DOMContentLoaded) -----
      function wireAdminButtons() {
        var handlers = {
          'admin-btn-check-updates':   'check-updates',
          'admin-btn-logs':            'view-logs',
          'admin-btn-reload':          'reload',
          'admin-btn-credentials':     're-enter-credentials',
          'admin-btn-update-config':   'configure-auto-update',
          'admin-btn-exit':            'exit-to-windows',
        };
        Object.keys(handlers).forEach(function (id) {
          var btn = document.getElementById(id);
          if (!btn) return;
          btn.addEventListener('click', function () {
            if (window.kiosk && window.kiosk.adminMenuAction) {
              window.kiosk.adminMenuAction(handlers[id]);
            }
          });
        });

        // PAT config form wiring
        var patInput = document.getElementById('update-pat-input');
        var saveBtn  = document.getElementById('update-config-save');
        var cancelBtn = document.getElementById('update-config-cancel');
        var errEl    = document.getElementById('update-config-error');
        if (patInput && saveBtn) {
          patInput.addEventListener('input', function () {
            var v = patInput.value;
            saveBtn.disabled = !(v && v.trim().length > 0 && !/\s/.test(v.trim()));
          });
        }
        if (saveBtn) {
          saveBtn.addEventListener('click', async function () {
            if (!patInput || !window.kiosk || !window.kiosk.submitUpdatePat) return;
            var v = patInput.value.trim();
            if (!v) {
              if (errEl) { errEl.textContent = 'Bitte PAT eingeben'; errEl.style.display = 'block'; }
              return;
            }
            saveBtn.disabled = true;
            var r = await window.kiosk.submitUpdatePat(v);
            if (r && r.ok) {
              patInput.value = '';
              if (errEl) errEl.style.display = 'none';
              // Main sends hide-update-config + show-admin-menu — no manual work here
            } else {
              if (errEl) {
                errEl.textContent = 'PAT ungültig — Verbindungsfehler. Bitte prüfen und erneut speichern.';
                errEl.style.display = 'block';
              }
              saveBtn.disabled = false;
            }
          });
        }
        if (cancelBtn) {
          cancelBtn.addEventListener('click', async function () {
            // Return to admin menu without state change
            hideUpdateConfig();
            if (window.kiosk && window.kiosk.getAdminDiagnostics) {
              var d = await window.kiosk.getAdminDiagnostics();
              if (d) showAdminMenu(d);
            }
          });
        }
      }
      if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', wireAdminButtons);
      } else {
        wireAdminButtons();
      }
    ```

    **Edit C — update the existing PIN keypad OK-key handler to route by `pinModalContext`.**

    Find the existing handler (around line 342 per the current `grep -n "verifyPin" src/host/host.js`) that calls `window.kiosk.verifyPin(submitted)`. Replace the `verifyPin(submitted)` call with context-aware routing:

    ```javascript
        // Phase 5: route by context. Admin hotkey path uses verify-admin-pin
        // (with lockout); reset-loop recovery path uses legacy verify-pin
        // (with resetLoopPending intercept in main).
        var res;
        if (pinModalContext === 'admin' && window.kiosk.verifyAdminPin) {
          res = await window.kiosk.verifyAdminPin(submitted);
          if (res && res.locked) {
            showPinLockout({ lockedUntil: res.lockedUntil });
            // Do not close modal — lockout panel replaces keypad
            return;
          }
          if (res && res.ok) {
            // Main will send hide-pin-modal + show-admin-menu — nothing more to do
            return;
          }
          // Normal wrong-PIN: show error, reset input
          var errEl = document.getElementById('pin-modal-error');
          if (errEl) { errEl.textContent = 'Falscher PIN'; errEl.style.display = 'block'; }
          var display = document.getElementById('pin-display');
          if (display) display.textContent = '····';
          // Reset the internal PIN buffer — reuse existing logic if present
          return;
        }
        // Legacy path (context === 'reset-loop') flows through Phase 3 verify-pin
        res = await window.kiosk.verifyPin(submitted);
    ```

    IMPORTANT: The existing handler sets local PIN buffer state (`var pin = ''` or similar). Locate that buffer reset logic and invoke it in both branches so the UI is consistent. Do not rewrite the entire keypad handler — only the `verifyPin(submitted)` invocation line becomes context-aware branching.

    **Edit D — update the existing `showMagiclineError(payload)` switch statement to handle two new variants.**

    Find the current function (look for `function showMagiclineError` or `showMagiclineError =`). Add `case 'bad-release':` and `case 'update-failed':` branches. Example patch shape:

    ```javascript
      case 'bad-release': {
        title = 'Update fehlgeschlagen';
        subtext = 'Bitte Studio-Personal verständigen';
        pinBtnVisible = true;
        break;
      }
      case 'update-failed': {
        title = 'Aktualisierung fehlgeschlagen';
        subtext = 'Erneuter Versuch beim nächsten Neustart — der Kiosk läuft weiter.';
        pinBtnVisible = false;
        // 10-second auto-dismiss + one-shot tap-to-dismiss
        if (updateFailedTimer) clearTimeout(updateFailedTimer);
        if (updateFailedHandler) {
          var prev = document.getElementById('magicline-error');
          if (prev) prev.removeEventListener('pointerdown', updateFailedHandler);
        }
        updateFailedTimer = setTimeout(function () {
          hideMagiclineError();
        }, 10_000);
        updateFailedHandler = function () {
          if (updateFailedTimer) { clearTimeout(updateFailedTimer); updateFailedTimer = null; }
          var e = document.getElementById('magicline-error');
          if (e && updateFailedHandler) e.removeEventListener('pointerdown', updateFailedHandler);
          updateFailedHandler = null;
          hideMagiclineError();
        };
        var errEl = document.getElementById('magicline-error');
        if (errEl) errEl.addEventListener('pointerdown', updateFailedHandler, { once: true });
        break;
      }
    ```

    Adapt variable names to match the actual existing switch structure (title/subtext/pinBtnVisible may be named differently). The KEY constraint is: both new variants render existing `#magicline-error` with the specified copy; `update-failed` wires the 10s setTimeout + one-shot pointerdown handler with proper cleanup.

    Also update `hideMagiclineError` (or equivalent) to clear `updateFailedTimer` and remove `updateFailedHandler` if set — otherwise stale timers leak across variant changes.

    **Edit E — register all Phase 5 IPC subscribers in the existing `kiosk.on*` subscriber block** (around line 427-440). Add after the existing subscribers:

    ```javascript
      if (window.kiosk.onShowAdminMenu)       window.kiosk.onShowAdminMenu(showAdminMenu);
      if (window.kiosk.onHideAdminMenu)       window.kiosk.onHideAdminMenu(hideAdminMenu);
      if (window.kiosk.onShowUpdateConfig)    window.kiosk.onShowUpdateConfig(showUpdateConfig);
      if (window.kiosk.onHideUpdateConfig)    window.kiosk.onHideUpdateConfig(hideUpdateConfig);
      if (window.kiosk.onShowUpdatingCover)   window.kiosk.onShowUpdatingCover(showUpdatingCover);
      if (window.kiosk.onHideUpdatingCover)   window.kiosk.onHideUpdatingCover(hideUpdatingCover);
      if (window.kiosk.onShowAdminUpdateResult) window.kiosk.onShowAdminUpdateResult(showAdminUpdateResult);
      if (window.kiosk.onShowPinLockout)      window.kiosk.onShowPinLockout(showPinLockout);
      if (window.kiosk.onHidePinLockout)      window.kiosk.onHidePinLockout(hidePinLockout);
    ```

    **Edit F — update the existing `onShowPinModal` subscriber to accept payload and set context.** Find the existing line `if (window.kiosk.onShowPinModal) window.kiosk.onShowPinModal(showPinModal);` and wrap it:

    ```javascript
      if (window.kiosk.onShowPinModal) {
        window.kiosk.onShowPinModal(function (payload) {
          pinModalContext = (payload && payload.context) || 'admin';
          hidePinLockout(); // reset lockout view in case reopened
          showPinModal();
        });
      }
    ```
  </action>
  <verify>
    <automated>node --check src/host/host.js && grep -q "pinModalContext" src/host/host.js && grep -q "verifyAdminPin" src/host/host.js && grep -q "adminMenuAction" src/host/host.js && grep -q "submitUpdatePat" src/host/host.js && grep -q "showPinLockout" src/host/host.js && grep -q "lockoutInterval" src/host/host.js && grep -q "bad-release" src/host/host.js && grep -q "update-failed" src/host/host.js && grep -q "bsk-admin-update-result--available" src/host/host.js && grep -q "formatMmSs" src/host/host.js && grep -q "showUpdatingCover" src/host/host.js && echo ok</automated>
  </verify>
  <acceptance_criteria>
    - `node --check src/host/host.js` exits 0
    - `grep -n "pinModalContext" src/host/host.js` matches ≥ 3 times (declare, set, branch)
    - `grep -n "verifyAdminPin" src/host/host.js` matches (routed call)
    - `grep -nE "verifyPin\\(" src/host/host.js` still matches (legacy reset-loop path preserved)
    - `grep -n "adminMenuAction" src/host/host.js` matches
    - `grep -n "submitUpdatePat" src/host/host.js` matches
    - `grep -n "closeAdminMenu\\|getAdminDiagnostics" src/host/host.js` matches at least once
    - `grep -n "showPinLockout" src/host/host.js` matches ≥ 2 times
    - `grep -n "lockoutInterval" src/host/host.js` matches ≥ 4 times (declare, clear-before-start, clear-on-expire, clear-on-hide)
    - `grep -nE "if \\(lockoutInterval\\)[ ]*\\{[ ]*clearInterval" src/host/host.js` matches (guard pattern)
    - `grep -n "formatMmSs\\|mm:ss" src/host/host.js` matches
    - `grep -n "'bad-release'" src/host/host.js` matches
    - `grep -n "'update-failed'" src/host/host.js` matches
    - `grep -n "updateFailedTimer" src/host/host.js` matches ≥ 3 times (declare, set, clear)
    - `grep -n "pointerdown" src/host/host.js` matches (one-shot tap-to-dismiss handler)
    - `grep -n "admin-btn-check-updates" src/host/host.js` matches
    - All 6 admin button ids present: `grep -c "admin-btn-" src/host/host.js` ≥ 6
    - `grep -n "showUpdatingCover" src/host/host.js` matches ≥ 2 (def + subscribe)
    - `grep -n "getElementById('update-pat-input')" src/host/host.js` matches
    - `grep -n "patInput.value = ''" src/host/host.js` matches (PAT cleared from DOM post-save)
    - `grep -n "noch nie" src/host/host.js` matches (relative time fallback)
    - `grep -n "BEREIT" src/host/host.js` matches (auth state label)
    - `grep -n "Updates verfügbar — wird bei nächster Ruhepause installiert\\|Update verfügbar" src/host/host.js` matches
  </acceptance_criteria>
  <done>host.js wires the full Phase 5 UI surface: context-aware PIN modal, admin menu buttons, PAT form, lockout countdown with guard, updating cover, bad-release and update-failed variants.</done>
</task>

</tasks>

<verification>
1. `node --check src/host/host.js` exits 0
2. Existing Phase 1-4 IDs all still present in host.html: `grep -c 'id="splash"\|id="idle-overlay"\|id="credentials-overlay"\|id="pin-modal"\|id="magicline-error"\|id="magicline-mount"' src/host/host.html` == 6
3. No Magicline selectors in host.css: `grep -cE '\[class\^="css-"\]|\.MuiBox|\.MuiButton' src/host/host.css` == 0
4. Every new CSS rule block has the 44×44 floor satisfied: `.bsk-btn--admin-action` min-height 64, `.bsk-btn--admin-exit` min-height inherited, `.bsk-btn--primary`/`.bsk-btn` base classes inherit min-height from existing rules (verify by reading existing host.css)
5. Phase 4 `notifyIdleDismissed`/`notifyIdleExpired` still called in host.js
</verification>

<success_criteria>
- ADMIN-01 UI: PIN modal opens from Ctrl+Shift+F12 and routes via context
- ADMIN-02 UI: Admin menu with 6-button stack + diagnostic header renders from IPC payload
- ADMIN-03 UI: Lockout panel replaces keypad with live mm:ss countdown; guard prevents double-interval
- ADMIN-08 UI: Updating cover, bad-release variant, update-failed variant (10s auto-dismiss) all implemented
- BRAND-01: All new surfaces use logo + brand palette
- BRAND-02: Touch targets ≥ 44px (grep-asserted via CSS declarations)
- BRAND-03: No Magicline content selectors in host.css (grep-asserted)
</success_criteria>

<output>
After completion, create `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-05-SUMMARY.md` with:
- host.html, host.css, host.js diff line counts
- CSS rule list added (names only)
- Confirmation no Magicline selectors added
- Decision log for any UI-SPEC deviations
</output>
