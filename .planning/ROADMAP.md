# Roadmap: Bee Strong POS Kiosk

**Created:** 2026-04-08
**Granularity:** coarse (target 3-5 phases)
**Total v1 requirements:** 42
**Coverage:** 42 / 42 mapped
**Core Value:** A gym member can walk up, scan their badge, have a product scanned (or self-selected), pay, and walk away — without staff interaction and without being able to break out of the locked Magicline cash register page.

## Phases

- [ ] **Phase 1: Locked-Down Shell & OS Hardening** - Branded Electron kiosk window that cannot be escaped, backed by a hardened Windows user account
- [ ] **Phase 2: Magicline Embed & Injection Layer** - Magicline cash register renders inside a child BrowserView with a permanent, drift-isolated hide layer and no flash of unhidden UI
- [ ] **Phase 3: Credentials & Auto-Login State Machine** - The kiosk boots straight into an authenticated cash register using DPAPI-encrypted credentials, with a safe failure mode when decryption is unavailable
- [x] **Phase 4: NFC Input, Idle & Session Lifecycle** - Badge scans land in the customer field, idle members are reset without cart bleed, and the session recovers automatically from crashes and loops *(deferred-close: automated-green, physical verification bundled into Phase 1 next-visit batch)*
- [ ] **Phase 5: Admin Exit, Logging, Auto-Update & Branded Polish** - An operator can unlock the kiosk with a hidden PIN, the device self-updates safely from GitHub Releases, every significant event is logged, and all branded overlays are touch-ready

## Phase Details

### Phase 1: Locked-Down Shell & OS Hardening
**Goal**: A single, auto-starting, fullscreen Electron window owned by a hardened Windows account that a standing member cannot exit by any normal means.
**Depends on**: Nothing (foundation)
**Requirements**: SHELL-01, SHELL-02, SHELL-03, SHELL-04, SHELL-05, SHELL-06
**Success Criteria** (what must be TRUE):
  1. On a fresh boot of the configured Windows user, the POS terminal auto-launches straight into a fullscreen Bee Strong-branded cover with no taskbar, menu bar, title bar, or system tray visible.
  2. A member mashing Alt+F4, Alt+Tab, Win, F11, Esc, and Ctrl+W in any combination cannot expose Windows desktop, another app, or any Electron chrome.
  3. Edge swipes, Action Center, and the Ctrl+Alt+Del menu options are either disabled or reduced to only "Sign out" per the documented Assigned Access + GPO runbook, verifiable against a kiosk-breakout checklist on the live device.
  4. Launching the app a second time (e.g. via the Startup shortcut racing with a manual launch) does not produce two windows — the second attempt is silently discarded.
  5. On app start, no Magicline UI is ever visible before the branded cover hands off; the transition is a single visual step from splash to hidden-cash-register, never a flash of raw Magicline chrome.
**Plans**: 6 plans
- [x] 01-01-PLAN.md — Project bootstrap (package.json, deps, electron-log, brand assets, directory skeleton)
- [x] 01-02-PLAN.md — Host window + host.html + preload + branded splash layer (SHELL-01, SHELL-06)
- [x] 01-03-PLAN.md — Keyboard lockdown + single-instance lock + runtime auto-start + globalShortcut (SHELL-02, SHELL-03 runtime, SHELL-04)
- [x] 01-04-PLAN.md — electron-builder NSIS config + installer.nsh Startup folder shortcut (SHELL-03 install-time)
- [x] 01-05-PLAN.md — OS hardening runbook (PowerShell + .reg scripts, breakout checklist, rollback) (SHELL-05)
- [x] 01-06-PLAN.md — Phase 1 acceptance verification + human visual checkpoint
**UI hint**: yes

### Phase 2: Magicline Embed & Injection Layer
**Goal**: Magicline's cash register page is embedded, persistently stripped down to only the elements needed for self-checkout, and resilient to React re-renders and Magicline DOM drift.
**Depends on**: Phase 1
**Requirements**: EMBED-01, EMBED-02, EMBED-03, EMBED-04, EMBED-05, EMBED-06
**Success Criteria** (what must be TRUE):
  1. After the splash lifts, the member sees the Magicline cash register page with the sidebar, topbar, global search, categories, customer search visual box, toolbar icon buttons, Rabatt button group, and discount icon all invisible — and they stay invisible after Magicline performs a React re-render or hash navigation.
  2. When Magicline ships an update that renames a fragile `css-xxxxx` class, an operator can find and patch every fragile selector in exactly one file (`fragile-selectors.js`) without touching stable-selector code.
  3. On every boot, the app writes a structured log line naming any stable or fragile selector that matched zero elements on the cash register page, giving an early warning of Magicline drift before members notice.
  4. A JS call of the form `document.querySelector('[data-role="customer-search"] input')` from the injected script still returns a live input element even though the visual customer search box is hidden.
**Plans**: TBD
**UI hint**: yes

### Phase 3: Credentials & Auto-Login State Machine
**Goal**: The kiosk stores its Magicline credentials safely and reactively drives itself from login page to cash-register-ready on every boot and after every session reset.
**Depends on**: Phase 2 (injection pipeline must reliably detect the login page before auto-login can hook into it)
**Requirements**: AUTH-01, AUTH-02, AUTH-03, AUTH-04, AUTH-05, AUTH-06
**Success Criteria** (what must be TRUE):
  1. On first run, an operator can enter a Magicline staff-account username and password through a branded credentials screen; on the next cold boot the kiosk reaches the cash register with zero human input.
  2. Inspecting `%AppData%\Bee Strong POS\` on disk shows no plaintext username, password, or environment variable containing credentials — only an encrypted blob that only the configured Windows user can decrypt.
  3. Whenever Magicline serves the login page (cold boot, session reset, server-side logout), the kiosk transitions through BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY and lands on the cash register without staff intervention, verifiable by triggering a reset and watching the state transitions in the log.
  4. If `safeStorage.isEncryptionAvailable()` returns false or decryption fails, the kiosk shows a branded "Credentials unavailable — admin attention required" screen instead of crash-looping or writing plaintext, and an admin can restore operation by entering the admin PIN and re-typing credentials.
**Plans**: 10 plans
- [x] 03-01-PLAN.md — Wave 0 dev-box verification (failed-login DOM probe; TabTip and scrypt deferred to 03-09)
- [x] 03-02-PLAN.md — adminPin.js scrypt hash + timingSafeEqual verify (AUTH-05)
- [x] 03-03-PLAN.md — credentialsStore.js safeStorage round-trip (AUTH-01, AUTH-02)
- [x] 03-04-PLAN.md — authFlow.js pure reducer + executor state machine (AUTH-03, AUTH-04, AUTH-05)
- [x] 03-05-PLAN.md — inject.js detectLogin + fillAndSubmitLogin + magiclineView delegation (AUTH-03)
- [x] 03-06-PLAN.md — host.html credentials overlay + 3×4 PIN keypad + preload.js surface (AUTH-02, AUTH-05)
- [x] 03-07-PLAN.md — main.js wiring: authFlow.start + ipcMain handlers + tabtip launcher (AUTH-02, AUTH-04, AUTH-05, AUTH-06)
- [x] 03-08-PLAN.md — Phase 3 acceptance: plaintext audit + unit suite + human verification (AUTH-01..06)
- [x] 03-09-PLAN.md — Wave 0 real-kiosk probes (TabTip verdict + scrypt benchmark on kiosk hardware)
- [x] 03-10-PLAN.md — authFlow executor recovery + D-11 atomic-persist gap closure
**UI hint**: yes

### Phase 4: NFC Input, Idle & Session Lifecycle
**Goal**: Badge scans reach the customer field without racing React, idle members are cleanly reset with no cart bleed, and the kiosk self-heals from render crashes and reset loops.
**Depends on**: Phase 3 (the reset loop requires idempotent auto-login to be reliable)
**Requirements**: NFC-01, NFC-02, NFC-03, NFC-04, NFC-05, NFC-06, IDLE-01, IDLE-02, IDLE-03, IDLE-04, IDLE-05, IDLE-06, IDLE-07
**Success Criteria** (what must be TRUE):
  1. A member scanning their Deka badge sees their name appear in the Magicline customer field within one second, on the very first scan after boot (no dropped first character) and on every subsequent scan, including repeatedly in a row.
  2. While staff have the Magicline product-search field focused, product barcode scans type into that field normally and are not hijacked into the customer-search buffer.
  3. After 60 seconds of no keyboard, touch, NFC, or mouse activity, a branded "Are you still there?" overlay appears with a visible 30 s countdown; any touch, tap, or keypress dismisses it and returns the same cart untouched.
  4. Letting the overlay expire wipes the Magicline session completely (cookies, storage, service workers) and returns the member-facing screen to a clean cash register with no prior customer and no prior cart — and 100 repeated reset cycles in a row never produce a half-logged-in state.
  5. Clicking "Jetzt verkaufen" clears the customer search field three seconds later while keeping the completed sale in Magicline's history, and a Magicline BrowserView crash (simulated via Task Manager) auto-recovers into a branded error screen followed by a clean re-login.
  6. If more than three hard resets fire within 60 seconds, the kiosk stops looping and shows a branded error screen instead of bricking itself in a reset storm.
**Plans**: 5 plans
- [x] 04-01-PLAN.md — idleTimer.js + badgeInput.js pure main modules + unit tests (NFC-01..06, IDLE-01, IDLE-02)
- [x] 04-02-PLAN.md — sessionReset.js mutex + unified rolling-window loop counter + unit tests (IDLE-03, IDLE-05)
- [x] 04-03-PLAN.md — main-process wire-up: magiclineView delegations, authFlow start-idle-timer side-effect, main.js + preload.js IPC surface (NFC-01, NFC-05, NFC-06, IDLE-04, IDLE-07)
- [x] 04-04-PLAN.md — renderer wire-up: inject.js listeners, fragile-selectors JETZT_VERKAUFEN_TEXT, host.html/css/js idle overlay + reset-loop variant (NFC-06, IDLE-01, IDLE-02, IDLE-06)
- [x] 04-05-PLAN.md — 100-cycle reset harness + integration tests + human kiosk verification checklist (IDLE-04 acceptance + all 13 requirements) — **deferred-close: automated 102/102 green, 13 physical rows moved to Phase 1 next-visit batch**
**UI hint**: yes

### Phase 5: Admin Exit, Logging, Auto-Update & Branded Polish
**Goal**: The kiosk is operable, diagnosable, and self-updating in the field, with every branded surface polished for a vertical touchscreen and every significant event captured in rotating logs.
**Depends on**: Phase 4 (auto-update safe-window gating consumes session-lifecycle signals; branded polish assumes stable overlays and state machines)
**Requirements**: ADMIN-01, ADMIN-02, ADMIN-03, ADMIN-04, ADMIN-05, ADMIN-06, ADMIN-07, ADMIN-08, BRAND-01, BRAND-02, BRAND-03
**Success Criteria** (what must be TRUE):
  1. Pressing Ctrl+Shift+F12 anywhere in the running kiosk opens a branded PIN prompt; entering the correct PIN drops kiosk mode and reveals an admin menu with Exit to Windows, Re-enter credentials, Reload, View logs, and Check for updates — and five wrong PIN attempts in under a minute lock the prompt for five minutes.
  2. Publishing a new tagged release to the private GitHub repository causes the kiosk to download the update in the background, wait for the next idle reset or the 03:00–05:00 window, show a branded "Updating, please wait" cover, and come back on the new version — a mid-transaction member never sees an update restart.
  3. Opening `%AppData%\Bee Strong POS\logs\` over RDP after a day of use shows rotating files (max 1 MB, max 5 files) with structured entries for startup, login success/failure, idle reset, badge scans (hashed or prefix-only), sale completions, update events, and errors — and no file contains a full badge number, password, or Magicline session token.
  4. Every branded surface the app owns (splash, idle overlay, credentials screen, admin PIN, updating cover, error screen) uses the Bee Strong logo and brand colors, is readable and operable on the vertical touchscreen with minimum 44x44 px touch targets, and the Magicline content area itself is visually unchanged (same colors, same fonts) except for hidden elements.
  5. An update that fails to install rolls the kiosk back to the previous working version automatically and logs the failure, so a bad release cannot brick the device between staff visits.
**Plans**: TBD
**UI hint**: yes

## Progress

| Phase | Plans Complete | Status | Completed |
|-------|----------------|--------|-----------|
| 1. Locked-Down Shell & OS Hardening | 6/6 | Complete (visual debt in next-visit batch) | 2026-04-08 |
| 2. Magicline Embed & Injection Layer | 5/5 | Complete | 2026-04-09 |
| 3. Credentials & Auto-Login State Machine | 10/10 | Complete (TabTip re-check in next-visit batch) | 2026-04-10 |
| 4. NFC Input, Idle & Session Lifecycle | 5/5 | Complete (deferred-close: 13 physical rows in next-visit batch) | 2026-04-10 |
| 5. Admin Exit, Logging, Auto-Update & Branded Polish | 0/TBD | Not started | - |

## Notes

- **Dependency chain (from research):** Phase 1 OS hardening first (dev env must match deployed); Phase 2 embed before Phase 3 auth-login (injection pipeline must detect the login page); Phase 3 auto-login before Phase 4 idle/reset (reset loop depends on idempotent auto-login); Phase 4 before Phase 5 auto-update (safe-window gating depends on session lifecycle state).
- **Coarse granularity calibration:** Adjacent research phases (credentials + auto-login as one, NFC + idle + reset as one, admin + logging + updates + branding as one) have been collapsed to land at 5 phases without creating an unbuildable mega-phase. Phase 4 is the heaviest by requirement count (13) because NFC and idle/reset are tightly coupled through the shared idle-timer / badge-arbiter state in main — splitting them would force artificial re-wiring.
- **Research flags carried into planning:** `BrowserView` vs `WebContentsView` verification (Phase 2), HID first-character-drop bug port (Phase 4), `clearStorageData` + `flushStore` ordering test harness (Phase 4), code-signing / PAT-embedding decision (Phase 5).

---
*Roadmap created: 2026-04-08*
