# Phase 5: Admin Exit, Logging, Auto-Update & Branded Polish - Context

**Gathered:** 2026-04-10
**Status:** Ready for planning

<domain>
## Phase Boundary

Wire the hidden admin hotkey → PIN gate → admin menu, extend the existing `adminPin.js` with a persistent rate-limit lockout, stand up structured rotating logs via `electron-log` with a central redaction helper, land `electron-updater` auto-update against a private GitHub Releases feed with safe-window install gating and a post-update health-check rollback posture, and polish every **new** branded host surface for the vertical touchscreen. Scope ends at: admin menu operable, logs structured and rotating with no secrets, auto-update downloads + installs only inside the safe window, bad-release state falls back to a branded error + admin PIN for manual runbook recovery, and every Phase 5 owned surface passes a CSS-level touch-target audit. Existing pre-Phase-5 surfaces (splash, idle overlay, credentials, magicline-error) are NOT re-polished in Phase 5 — their outstanding polish debt joins the next-visit batch already tracked in STATE.md.

</domain>

<decisions>
## Implementation Decisions

### Admin Menu UI & Items
- **D-01:** Admin menu is a new sibling `<div id="admin-menu">` inside `host.html` on a new z-index layer **500** (above all existing overlays). Layout is a **vertical full-width button stack** consistent with the existing credentials overlay card style. No grid, no icons. All buttons are min 44×44 px per BRAND-02.
- **D-02:** Menu button order is **safe → destructive**: (1) Check for updates, (2) View logs, (3) Reload, (4) Re-enter credentials, (5) Exit to Windows. Rationale: puts diagnostics first, nuclear option last to reduce accidental exits when staff fumble on the touchscreen.
- **D-03:** A diagnostic header renders at the top of the admin menu: **app version, last update check timestamp, current `authFlow` state, last idle-reset timestamp**. Read from `app.getVersion()`, the updater state, `authFlow.getState()`, and Phase 4's `sessionReset` last-timestamp accessor. Zero-click "what version is this kiosk on?" over RDP via the admin menu.
- **D-04:** "View logs" button calls `shell.openPath(app.getPath('logs'))` — opens `%AppData%/Bee Strong POS/logs/` in Windows Explorer. No in-app log viewer. Explorer briefly covering the kiosk is acceptable because this action is staff-only and admin-gated.
- **D-05:** "Re-enter credentials" re-raises the existing Phase 3 credentials overlay with `{ firstRun: false }` — reuses the Phase 3 path verbatim, no new surface.
- **D-06:** "Reload" calls `mainWindow.webContents.reload()` and restarts the Phase 3 `authFlow` state machine from `BOOTING`.
- **D-07:** "Exit to Windows" calls `globalShortcut.unregisterAll()` + `app.setKiosk(false)` + `app.quit()`. It does **not** disable auto-login at the Windows level — that's an out-of-band runbook step. The admin simply lands on the Windows desktop.
- **D-08:** Ctrl+Shift+F12 is added to the Phase 1 `reservedShortcuts` Set in `keyboardLockdown.js` (the hook point Phase 1 D-10 reserved). Captured via both `globalShortcut.register` (defense-in-depth) and `before-input-event` pass-through per ADMIN-01. Opens the admin PIN modal (NOT the admin menu directly — PIN must verify first).

### PIN Lockout UX (ADMIN-03)
- **D-09:** Rate-limit state is **persisted in `electron-store` (`config.json`)** under a new key `adminPinLockout = { attempts: [timestamp,...], lockedUntil: ISOString | null }`. Survives app restart so a crash-and-relaunch attack cannot reset the counter. Shares the same store instance already used for credentials/PIN hash — zero new infra.
- **D-10:** Lockout trigger: 5 failed `verifyPin` calls within a rolling 60-second window → set `lockedUntil = now + 5 minutes`. Old attempts outside the 60s window are pruned on each verify call.
- **D-11:** Counter fully resets on successful PIN verify (attempts cleared, lockedUntil cleared). Matches user expectation — once staff is in, slate is clean.
- **D-12:** During lockout, **the Ctrl+Shift+F12 hotkey still opens the PIN modal**, but the keypad is replaced with a **live countdown** (`mm:ss`, ticks every second) and the German message "Zu viele Versuche — bitte warten". Rationale: staff needs visible feedback that the lockout is timed and auto-resolves, otherwise they assume the hotkey is broken and call for support.
- **D-13:** Lockout logic is a **new wrapper module `src/main/adminPinLockout.js`** — NOT a modification to `adminPin.js`. Preserves the Phase 3 D-10 contract ("Phase 5 will add rate-limit lockout ON TOP of this module without modifying it"). The wrapper exposes `verifyPinWithLockout(store, pin)` → `{ ok: bool, locked: bool, lockedUntil: Date | null }`. `adminPin.js` stays pure and unit-testable.

### Auto-Update Safe-Window Policy (ADMIN-06, ADMIN-07)
- **D-14:** `electron-updater` `checkForUpdates()` fires **on boot (after `app.whenReady` + PAT-available check) and every 6 hours** via `setInterval`. Catches releases within one business day without hammering the GitHub API.
- **D-15:** `quitAndInstall` is gated behind a safe-window predicate that fires on the **first** of: (a) a Phase 4 `sessionReset` completion event, or (b) entering the **03:00–05:00 maintenance window**. Whichever comes first after `update-downloaded` wins. Never mid-transaction. Requires `sessionReset.js` to emit a new `post-reset` event (small addition to Phase 4's module).
- **D-16:** "Idle" for safe-window purposes = **just after `sessionReset` completes** — Phase 4's canonical "clean slate" moment (cart empty, cash-register-ready state). NOT the idle overlay timeout. New `post-reset` event on `sessionReset.js` is consumed by a new `updateGate.js` module in `src/main/`.
- **D-17:** "Check for updates" from the admin menu **triggers a check and shows the result ('Aktuell' / 'Update verfügbar — wird bei n\u00e4chster Ruhepause installiert') but does NOT bypass the safe-window rule**. No force-install path. Rationale: mid-transaction safety always wins, even under admin control. Staff needing an immediate install should use the Exit-to-Windows path and install the NSIS manually.

### GitHub PAT Distribution (ADMIN-06)
- **D-18:** Repo stays **private**. PAT is **entered once via the admin menu on first boot** — a new admin menu item **"Configure auto-update"** that appears when no PAT is stored (and as "Update-Zugang \u00e4ndern" once it is). PAT is encrypted via `safeStorage.encryptString` and persisted in `electron-store` under `githubUpdatePat` (base64 ciphertext). Installer ships with no secrets — mitigates electron-builder issue #2314 (PAT embedded in installer).
- **D-19:** Before PAT is set, auto-update is **silently disabled**. Kiosk boots and operates normally; `checkForUpdates` is never called. Admin menu diagnostic header shows "Auto-Update: nicht konfiguriert". No blocking screen, no daily nag — matches the "install-visit-driven" operating model in PROJECT.md.
- **D-20:** The "Configure auto-update" screen is a sibling `<div id="update-config">` inside `host.html` (new layer 500, shared with admin menu since they're mutually exclusive). Single text input for PAT + "Speichern" button. No validation beyond "non-empty and does not contain whitespace" — the next `checkForUpdates` call is the real validator, and failure logs the error class and re-opens the config screen. PAT is never logged, never displayed after save (input masked).
- **D-21:** Repo-privacy-audit recommendation (from discussion area 4 second question) is recorded as **ongoing hygiene guidance**, not a Phase 5 deliverable: any future flip to a public repo must first grep history for accidentally committed secrets. Captured here so it's not lost.

### Log Redaction & Structured Events (ADMIN-04, ADMIN-05)
- **D-22:** Badge numbers in logs are rendered as `sha256(badge).slice(0, 8)` — 8 hex chars, e.g. `a3f7c2b1`. Enables correlation ("same member scanned 3 times") without storing the actual badge. Uses Node's built-in `crypto` — no new deps. 32 bits of entropy = zero collision risk at a single gym's member count.
- **D-23:** Sale-completion log line is **click-event + hashed badge only, no monetary amount**: `sale.completed badge=a3f7c2b1 at=<ISO>`. Matches ADMIN-04 wording ("sale completion click") and avoids pulling any amount from the fragile Magicline DOM. Magicline owns the actual sale record.
- **D-24:** Single unified log file — **`main.log`**, not a split main/audit pair. All structured event lines go through the same `electron-log` transport. ADMIN-05's "max 5 files" budget applies to this one file.
- **D-25:** New central helper **`log.audit(event, fields)`** in `src/main/logger.js`. Runs every value in `fields` through a redactor:
  - Badge numbers → `sha256().slice(0,8)` (detected by a field name allowlist: `badge`, `badgeId`, `member`, `memberId`).
  - Passwords → `'***'` (field name allowlist: `password`, `pass`, `pwd`).
  - Ciphertexts → `cipher.length` only (field name allowlist: `cipher`, `ciphertext`, `token`, `pat`).
  - All other values pass through.
  Emits a stable `event=<name> k=v k=v` format consumable by `grep` over RDP.
- **D-26:** `electron-log` file-transport config is extended: `maxSize = 1 MB` (already set) and **`archiveLogFn` / file-rotation is extended to keep up to 5 rotated files** per ADMIN-05. Current logger.js only keeps `main.log` + `main.old.log` — researcher must confirm electron-log v5's multi-file rotation API (`archiveLogFn` signature or alternative).
- **D-27:** Prior-phase log lines are **retrofitted** in Phase 5: every existing `log.info(...)` in `src/main/**` that references badge, credentials, ciphertext, PAT, or PIN gets migrated to `log.audit(...)`. The plan must include an explicit audit+migration task. Any `log.info` that has no sensitive fields stays as-is. This is scope creep only if we also touch non-log code — we won't.
- **D-28:** Event taxonomy (extend as phases need): `startup`, `startup.complete`, `auth.state`, `auth.submit`, `auth.failure`, `idle.reset`, `badge.scanned`, `sale.completed`, `update.check`, `update.downloaded`, `update.install`, `update.failed`, `pin.verify`, `pin.lockout`, `admin.open`, `admin.exit`, `crash`. Every line includes `event=` + `at=<ISO>` + event-specific fields.

### Update Failure & Rollback (ADMIN-08)
- **D-29:** "Bad release" detection = **post-update health check on next boot**. Before `quitAndInstall`, persist `{pendingVersion, installedAt}` to `electron-store`. On next boot, `main.js` reads the flag first-thing. A 2-minute watchdog starts: if `authFlow` reaches `CASH_REGISTER_READY` within 2 minutes, the flag is cleared (health check passed, `log.audit('update.install', {version, result:'ok'})`). If the boot crashes or the watchdog expires, the NEXT boot sees the flag still set → mark the version as bad, disable auto-update, route to branded bad-release error screen.
- **D-30:** Rollback mechanism is **manual via runbook**. On detected bad release, the kiosk (a) sets `autoUpdateDisabled = true` in `electron-store`, (b) logs `update.failed`, (c) boots to the branded bad-release error screen. Staff re-installs the previous NSIS installer over RDP as part of the documented maintenance runbook. Rationale: `electron-updater` has no supported auto-rollback API; a crash-loop auto-rollback is riskier than a "freeze and alert" posture; matches the PROJECT.md "maintenance visit" cadence.
- **D-31:** The bad-release state reuses the existing `#magicline-error` layer with a **new variant `'bad-release'`**. Text: "Update fehlgeschlagen — bitte Studio-Personal verständigen". Includes the "PIN eingeben" button that opens the admin menu for recovery. Extends the Phase 3 D-09 IPC pattern (`show-magicline-error { variant }`) without adding a new layer.
- **D-32:** Add a second new variant `'update-failed'` to the same `#magicline-error` layer for the distinct case where an install attempt fails AT install time (NSIS exit code non-zero) — less severe than bad-release because the old version is still installed. Text: "Aktualisierung fehlgeschlagen — erneut versucht beim n\u00e4chsten Neustart". Auto-dismisses after 10s or on tap, kiosk continues normally on the old version.

### Branded Polish Scope (BRAND-01, BRAND-02, BRAND-03)
- **D-33:** Phase 5 polishes **only the new Phase 5 surfaces**: admin menu (D-01), admin PIN lockout UI (D-12), updating cover (D-36), PAT entry screen (D-20), and the two new `#magicline-error` variants (D-31, D-32). Existing surfaces (splash, idle overlay, credentials, baseline magicline-error) ship unchanged.
- **D-34:** The four existing surfaces have acknowledged polish debt (spacing, real-kiosk-resolution visual checks, TabTip coexistence) — **recorded as deferred polish debt in the `<deferred>` section below** and routed to the existing "next-visit batch" already tracked in STATE.md. Not Phase 5 work.
- **D-35:** Brand palette is **locked to current `host.css` tokens**: yellow `#F5C518` accents on dark `#1A1A1A` background, `#FFFFFF` primary text, `#9CA3AF` secondary text, `#FF6B6B` error text. All new Phase 5 surfaces inherit these via existing CSS custom properties (or add them if not yet extracted — a light refactor inside Phase 5 is acceptable). No new palette tokens, no admin-red accent.
- **D-36:** Touch target audit is **CSS-level only**, not physical. A Phase 5 verification task enumerates every interactive element on the new surfaces (buttons, PIN keypad, PAT input) and asserts computed `width >= 44 && height >= 44` via a test harness or manual review. Physical-touchscreen verification joins the existing next-visit batch.

### Updating Cover (ADMIN-08)
- **D-37:** Updating cover is a new sibling `<div id="updating-cover">` on **layer 300**, shared with `#magicline-error` since they're mutually exclusive states. Matches the `host.html` ladder comment already at that layer.
- **D-38:** Cover is **only visible during the install/restart window** (quitAndInstall fires → new version's splash paints). Downloads are silent in the background — members never see a cover during normal operation. Honors the "mid-transaction member never sees an update restart" success criterion.
- **D-39:** Cover content: Bee Strong logo (same asset as splash), German text **"Aktualisierung läuft — bitte warten"**, and an infinite CSS spinner. No progress bar (install progress is not surfaced by electron-updater and by this point the download is complete anyway). Same dark background + brand tokens as the splash for visual continuity.
- **D-40:** Post-install first boot shows the **normal splash** with NO "updated to vX.Y.Z" toast. Silent upgrade from the member's perspective. Staff verify the new version via the admin menu diagnostic header (D-03).

### Claude's Discretion
- Exact German copy for admin menu button labels and diagnostic header field names — planner picks from a short list, consistent with existing Phase 1–4 German (e.g., "Kasse nachladen", "Anmeldedaten \u00e4ndern", "Updates pr\u00fcfen", "Protokolle anzeigen", "Beenden").
- CSS spinner design for the updating cover (single rotating element, SVG or pure CSS) — any approach consistent with the dark/yellow palette is fine.
- Exact `archiveLogFn` implementation for 5-file rotation — researcher determines the supported electron-log v5 API and planner wires it.
- Admin menu open/close transition (instant, fade, slide) — Claude picks something consistent with the existing credentials overlay.
- Whether the diagnostic header timestamps are absolute or relative ("vor 3 Min") — Claude picks relative for readability.

### Folded Todos
None — no pending todos matched Phase 5 scope during cross-reference.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before planning or implementing.**

### Project-Level
- `.planning/PROJECT.md` — security rules (no plaintext secrets, DPAPI via safeStorage), reliability posture (auto-recover, maintenance-visit cadence), budget constraint (no recurring SaaS), Magicline-drift isolation rule.
- `.planning/REQUIREMENTS.md` §Admin Exit, Logging & Updates — ADMIN-01 through ADMIN-08 literal acceptance criteria.
- `.planning/REQUIREMENTS.md` §Branding & UX — BRAND-01, BRAND-02, BRAND-03.
- `.planning/ROADMAP.md` §Phase 5 — the five success-criterion sentences that define phase acceptance.
- `CLAUDE.md` §Technology Stack — electron-updater + GitHub provider pattern, electron-log v5 rotation, safeStorage DPAPI, electron-store 10.x CJS pin, electron-builder NSIS target, cautionary note on PAT-embedded installers (#2314).

### Prior Phase Contracts Phase 5 Consumes
- `.planning/phases/01-locked-down-shell-os-hardening/01-CONTEXT.md` D-01 (host.html permanent layer), D-10 (reservedShortcuts Set), D-11 (globalShortcut defense-in-depth).
- `.planning/phases/02-magicline-embed-injection-layer/02-CONTEXT.md` — `#magicline-error` layer, IPC `show-magicline-error { variant }`, drift-patch-blast-radius principle (fragile selectors isolated).
- `.planning/phases/03-credentials-auto-login-state-machine/03-CONTEXT.md` D-10, D-11, D-18 — `adminPin.js` contract ("Phase 5 adds lockout ON TOP without modifying"), first-run PIN capture pattern, structured-log transition format. D-09 error-overlay variant pattern (`'drift' | 'credentials-unavailable' | 'login-failed'`) — Phase 5 extends with `'bad-release'` and `'update-failed'` variants.
- `.planning/phases/04-nfc-input-idle-session-lifecycle/04-CONTEXT.md` — idle timer state machine, sessionReset module, the signals Phase 5 consumes for safe-window gating.

### Existing Source Files Phase 5 Modifies or Extends
- `src/main/adminPin.js` — READ-ONLY in Phase 5 (preserves Phase 3 D-10 contract). Lockout logic lives in a new `src/main/adminPinLockout.js` wrapper.
- `src/main/keyboardLockdown.js` — adds `Ctrl+Shift+F12` to the `reservedShortcuts` Set export (Phase 1 D-10 hook point).
- `src/main/logger.js` — adds `log.audit(event, fields)` helper + redactor + 5-file rotation config.
- `src/main/main.js` — wires Ctrl+Shift+F12 hotkey → admin PIN modal → admin menu IPC; wires `updateGate.js` + `electron-updater` calls; wires post-update health-check watchdog on boot.
- `src/main/sessionReset.js` — emits a new `post-reset` event consumed by `updateGate.js`.
- `src/main/authFlow.js` and other Phase 1–4 modules — log-line migration from `log.info` to `log.audit` where sensitive fields are present (D-27).
- `src/host/host.html` — adds `#admin-menu` + `#update-config` on new layer 500, `#updating-cover` on existing layer 300, two new `#magicline-error` variants.
- `src/host/host.js` — IPC handlers for admin menu open/close/button actions, PIN lockout countdown renderer, PAT config form submit, updating-cover show/hide.
- `src/host/host.css` — button stack, diagnostic header, countdown display, spinner, new variant text. All using existing brand tokens.
- Brand assets at repo root: `1 BSF_vertical.png` (light bg), `3 BSF_vertical_for dark BG.png` (dark bg). The dark-bg asset is the one the updating cover uses (same as splash).

### External Docs (web — researcher fetches as needed)
- Electron `safeStorage` API — https://www.electronjs.org/docs/latest/api/safe-storage (for PAT encryption).
- Electron `shell.openPath` — for "View logs" folder opening.
- `electron-updater` GitHub provider — https://www.electron.build/auto-update.html (private repo + PAT setup, `update-downloaded` event, `quitAndInstall` semantics).
- `electron-log` v5 file transport rotation — https://github.com/megahertz/electron-log/blob/master/docs/transports/file.md (confirm `archiveLogFn` or equivalent for max-5-files).
- Node `crypto.createHash('sha256')` — built-in, for badge hashing.

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets
- **`src/main/adminPin.js`** — scrypt verify/set already shipped (Phase 3). Phase 5 wraps it, does NOT modify it. Exposes `verifyPin(store, pin) → bool` and `setPin(store, pin)`.
- **`src/main/logger.js`** — electron-log v5 initialized, `log.info/warn/error` already used repo-wide. 1 MB rotation already set. Phase 5 adds `log.audit` helper + 5-file rotation config + redactor.
- **`src/main/keyboardLockdown.js`** — `reservedShortcuts` Set export exists (Phase 1 D-10). Phase 5 inserts `Ctrl+Shift+F12` into the set and wires the handler in `main.js`.
- **`src/main/credentialsStore.js`** — `safeStorage` round-trip pattern proven. Phase 5 reuses the exact pattern for GitHub PAT storage (new store key `githubUpdatePat`).
- **`src/main/sessionReset.js`** — exists and is the canonical "clean slate" signal source (Phase 4). Phase 5 adds a `post-reset` event emission (small addition).
- **`src/main/idleTimer.js`** — exposes state-change events that `updateGate.js` can observe as a secondary signal if needed.
- **`src/host/host.html`** — layer ladder 200/300/400 already in place with comments noting Phase 5 extensions. Phase 5 adds layer 500 (admin menu + PAT config) and a new sibling div on layer 300 (updating cover).
- **`src/host/host.css`** — brand palette tokens already defined: `#F5C518` yellow, `#1A1A1A` / `#222222` dark, `#FFFFFF` / `#9CA3AF` text, `#FF6B6B` error red. Button hover/pressed states, PIN keypad grid, touch-target min-sizes all established from Phase 3 PIN modal — admin menu buttons reuse the `.bsk-btn--primary` + card patterns.
- **Phase 3 D-09 error-overlay variant pattern** — extend, don't replace. New variants `'bad-release'` and `'update-failed'` join `'drift' | 'credentials-unavailable' | 'login-failed'`.

### Established Patterns
- **Main → renderer IPC is send-only**; renderer → main is the existing `ipcRenderer.invoke` channel already used for PIN submit and credentials submit. Admin menu actions follow the same pattern (host.js invokes, main.js handles).
- **State machines live in main, not inject.js or host.js** — Phase 3 D-01. Phase 5 honors this: `updateGate.js` and the lockout wrapper are main-process modules; host.js just renders and forwards clicks.
- **Structured log events** — format from Phase 3 D-18 (`'auth.state: prev -> next reason=x'`) is the pattern. Phase 5's `log.audit` extends it with `event=<name> k=v k=v at=<ISO>`.
- **Atomic store writes** — Phase 3 D-11 (electron-store `store.set({a, b})` is a single atomic write). Phase 5 respects this when updating lockout state + PAT.
- **Sibling divs on layered z-index, IPC-toggled** — Phase 1 D-01. Every new Phase 5 surface follows this pattern, no BrowserView, no iframe, no new BrowserWindow.

### Integration Points
- `main.js` orchestration block (below the `// ORCHESTRATION` marker reserved by Phase 1 D-03) — Phase 5's hotkey wiring, admin menu IPC handlers, update gate wiring, and post-update health check all land here or in small modules imported here.
- `host.html` ladder comment at the top of the file — update it with layer 500 when adding the admin menu.
- `sessionReset.js` — needs a small `EventEmitter` addition or callback export for the `post-reset` signal; Phase 5 researcher should confirm the simplest way to extend it without breaking Phase 4 tests.

### Creative Options
- The diagnostic header in the admin menu could double as the "poke point" for live debugging over RDP — any value worth checking on a running kiosk belongs there, not in a separate debug surface.
- The `log.audit` helper is a natural place to centralize event taxonomy (D-28) — Phase 5 establishes the canonical event names that future phases reuse.
- The update gate (`updateGate.js`) can be tested deterministically by injecting a fake clock + fake sessionReset emitter — no real updater or timer required for unit tests.

</code_context>

<specifics>
## Specific Ideas

- "Safe → destructive" admin button order is an explicit anti-foot-gun choice: staff fumbling on a touchscreen should land on diagnostics (updates, logs) first, not Reload or Exit. Do not reorder later without user sign-off.
- Updating cover should feel like a "coordinated brand moment" with the splash — same logo, same dark background, same typography. Not a technical modal.
- Live countdown during PIN lockout is explicitly chosen over silent suppression because "staff might assume the hotkey is broken and call for support" — the visible countdown is the documentation.
- German-only UI copy, consistent with Phase 1–4 (Bee Strong Fitness is a German gym). No English fallback.
- "Check for updates" admin action never force-installs. Mid-transaction safety always wins, even under admin control. This is a deliberate foot-gun removal, not a missing feature.
- Private repo + PAT-via-admin-menu is the chosen path even though public-repo is simpler, because the user prefers source-privacy. The installer bootstrap gap (no updates until PAT entered) is acceptable given the maintenance-visit cadence.
- Post-update health check is the SINGLE source of truth for "is this release bad?" — not HTTP health probes, not Magicline round-trips, just "did `authFlow` reach CASH_REGISTER_READY within 2 minutes of boot after an install?"

</specifics>

<deferred>
## Deferred Ideas

### Polish debt on existing pre-Phase-5 surfaces
Routed to the existing next-visit batch tracked in STATE.md. Not Phase 5 work.

- **Splash (Phase 1)** — real-kiosk-resolution sizing of the logo, loading indicator refinement, fade-in timing. Dependent on physical kiosk visit for visual check.
- **Idle overlay (Phase 4)** — visual polish on real hardware, animation timing, countdown font hinting.
- **Credentials overlay (Phase 3)** — touch target audit against Windows TabTip coexistence, field spacing, keyboard affordance.
- **Magicline-error screen (Phase 2/3)** — consistency check once the new Phase 5 variants (`bad-release`, `update-failed`) are in place — verify the whole variant family renders coherently on real hardware.

### Auto-rollback via cached previous install
Attempted design notes:
- Keep previous app folder alongside new, swap shortcut on health check failure.
Rejected because Windows locked-file semantics + electron-updater incompatibility make this genuinely risky. Manual runbook rollback is the current answer. Revisit only if bad releases become frequent enough to warrant the engineering cost.

### Auto-rollback via previous GitHub release
Rejected — a broken kiosk may not be able to reliably execute the rollback path. Manual re-install is the safer recovery.

### Force-install button in admin menu
Rejected in D-17. If user experience demands it later, revisit as a long-press or confirm-dialog-gated action, but NOT as a primary button.

### Public repo migration
Noted in D-21 as ongoing hygiene guidance. If the project ever flips to public, audit history for secrets first.

### "Updated to vX.Y.Z" post-install toast
Rejected in D-40. Silent upgrade is the user-facing policy. Version is always in the admin menu diagnostic header.

### In-app log viewer
Rejected in D-04. `shell.openPath` into Explorer is the chosen path. Revisit only if RDP becomes unreliable.

### Reviewed Todos (not folded)
None — no todos surfaced during cross-reference.

</deferred>

---

*Phase: 05-admin-exit-logging-auto-update-branded-polish*
*Context gathered: 2026-04-10*
