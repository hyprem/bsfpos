# Requirements: Bee Strong POS Kiosk

**Defined:** 2026-04-08
**Core Value:** A gym member can walk up, scan their badge, have a product scanned (or self-selected), pay, and walk away — without staff interaction and without being able to break out of the locked Magicline cash register page.

## v1 Requirements

Requirements for initial release. Each maps to roadmap phases via the Traceability table.

### Kiosk Shell & OS Lockdown

- [x] **SHELL-01**: The app launches fullscreen in Electron kiosk mode with no window chrome, menu bar, address bar, or system tray visibility
- [x] **SHELL-02**: A single-instance lock prevents multiple copies of the app from running simultaneously
- [x] **SHELL-03**: The app auto-starts on Windows boot/login via `app.setLoginItemSettings` (or equivalent NSIS installer config)
- [x] **SHELL-04**: Standard keyboard escape combos (Alt+F4, Alt+Tab, Win key, F11, Esc, Ctrl+W) are intercepted and suppressed via `before-input-event` on the host window
- [x] **SHELL-05**: A dedicated Windows user account is configured with Assigned Access + GPO + registry hardening to block Windows 11 Pro kiosk breakout vectors (edge swipes, taskbar, Action Center, Ctrl+Alt+Del menu options) — documented runbook for fresh-device setup
- [x] **SHELL-06**: On app start, a Bee Strong-branded full-screen splash/cover is visible until the Magicline cash register page is loaded and confirmed hidden (no flash of unhidden Magicline UI)

### Magicline Embed & Injection

- [ ] **EMBED-01**: Magicline is loaded inside a child `BrowserView` (or `WebContentsView` — resolved at phase start) of the host window at `https://bee-strong-fitness.web.magicline.com/#/cash-register`
- [ ] **EMBED-02**: A permanent CSS hide layer is applied via `webContents.insertCSS` covering all stable `[data-role=...]` selectors identified in the prototype (sidebar, topbar, global search, categories, customer search visual box, toolbar icon buttons) and re-applied on every navigation
- [ ] **EMBED-03**: A JavaScript injection is run on every navigation via `executeJavaScript` and ports the existing prototype logic: MUI React-native value setter, dynamic element hiding (Rabatt button group by text, discount icon by SVG path), MutationObserver-driven re-application on React re-renders
- [ ] **EMBED-04**: Fragile MUI `css-xxxxx` selectors are isolated in a single `fragile-selectors.js` drift layer with text/structure fallbacks — not mixed into stable selector logic
- [ ] **EMBED-05**: A boot-time selector self-check logs a warning when any stable or fragile selector fails to match anything on the cash register page (early signal for Magicline DOM drift)
- [ ] **EMBED-06**: The CSS hide rule for the customer search box leaves the inner `<input>` element query-selectable from JS (so NFC injection still targets it)

### Credentials & Auto-Login

- [ ] **AUTH-01**: Magicline credentials are stored on disk encrypted via Electron `safeStorage` (Windows DPAPI) — plaintext storage and environment variables are forbidden
- [ ] **AUTH-02**: First-run / admin menu provides a UI to enter/update the Magicline username and password; values are encrypted and persisted immediately
- [ ] **AUTH-03**: When the app loads Magicline and the login page is detected (presence of `[data-role="username"]`), the app auto-fills `[data-role="username"]` and `[data-role="password"]` via the React-native value setter and clicks `[data-role="login-button"]`
- [ ] **AUTH-04**: The auto-login flow is reactive (state machine: BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY), not a one-shot fire-and-forget, so it fires reliably after every session reset
- [ ] **AUTH-05**: If `safeStorage.isEncryptionAvailable()` returns false or decrypt fails (e.g. after a Windows password reset breaks the DPAPI master key), the app shows a branded "Credentials unavailable — admin attention required" screen; the admin can re-enter credentials after authenticating with the admin PIN. The app must never fall back to plaintext or silently crash-loop.
- [ ] **AUTH-06**: The kiosk uses a dedicated Magicline staff account with minimum permissions needed for cash-register operation

### NFC Badge Input

- [x] **NFC-01**: USB HID keystrokes from the Deka badge reader are captured at the main-process level via `before-input-event` on the host BrowserWindow (not via page-level `document.activeElement` which races React re-renders)
- [x] **NFC-02**: Captured characters are buffered using a <50 ms inter-key timing gate to distinguish badge scans from human typing; the buffer is committed on Enter (confirmed as the Deka terminator) or on a brief timeout *(code-complete; physical verification deferred to next-visit batch)*
- [x] **NFC-03**: The latent first-character-drop bug present in the Android prototype's `BADGE_SPEED_MS` check is fixed in the Electron port (`lastKeyTime` must not start at 0 in a way that makes `timeSinceLast` huge for the first char) *(code-complete via sentinel-null arbitration; physical verification deferred to next-visit batch)*
- [x] **NFC-04**: On buffer commit with length > 3, the badge string is injected into `[data-role="customer-search"] input` via the React-native value setter and an `input`+`change` event dispatch *(code-complete; physical verification deferred to next-visit batch)*
- [x] **NFC-05**: If the idle overlay or admin PIN modal is visible, HID keystrokes count as "user activity" for the idle timer and are routed to the overlay/modal, not to Magicline
- [x] **NFC-06**: While the Magicline product search field has focus (staff scanning products), HID keystrokes pass through to Magicline naturally and are not captured into the customer-search buffer

### Idle, Reset & Recovery

- [x] **IDLE-01**: After 60 seconds without user input (keyboard, touch, NFC scan, mouse), a fullscreen translucent Bee Strong-branded "Are you still there?" overlay appears with a visible countdown (default 30 s) and a "Tap to continue" button
- [x] **IDLE-02**: Any user input while the overlay is visible dismisses it and restarts the 60 s idle timer without clearing Magicline state
- [x] **IDLE-03**: If the overlay countdown expires without interaction, the app performs a hard session reset: navigate to `about:blank`, `await session.clearStorageData()`, `await cookies.flushStore()`, reload Magicline — fully mutex-guarded so no two resets can overlap *(code-complete; 100-cycle automated harness proves mutex + step-order; physical verification deferred to next-visit batch)*
- [x] **IDLE-04**: After a hard reset, the auto-login state machine fires again automatically; the member sees only the branded splash, then the clean cash register with no cart, no prior customer
- [x] **IDLE-05**: Reset-loop detection triggers a branded error screen if more than 3 resets occur within 60 seconds (prevents crash-loop bricking) *(code-complete via unified rolling-window counter D-18; automated tests prove loop-detected trip + suppression; physical verification deferred to next-visit batch, must run LAST as destructive)*
- [x] **IDLE-06**: 3 seconds after the "Jetzt verkaufen" button is clicked, the customer search field is cleared (post-sale reset, does not drop cart history/receipts)
- [x] **IDLE-07**: On `render-process-gone` (Magicline BrowserView crash), the app logs the crash, shows the branded error screen briefly, and reloads the view — auto-login fires as normal

### Admin Exit, Logging & Updates

- [ ] **ADMIN-01**: A hidden hotkey combination (default `Ctrl+Shift+F12`) is captured via both `globalShortcut` and `before-input-event` and opens a PIN prompt
- [ ] **ADMIN-02**: On correct PIN entry, the app drops kiosk mode and reveals an admin menu: exit to Windows, re-enter Magicline credentials, reload app, view logs, trigger update check
- [x] **ADMIN-03**: The PIN is hashed at rest (not plaintext); after 5 incorrect attempts in 60 s, the PIN prompt is rate-limited for 5 minutes
- [x] **ADMIN-04**: All significant runtime events (startup, crash, login success/failure, idle reset, badge scan with hashed/prefix badge only, sale completion click, update check, update applied, errors) are written to rotating local log files via `electron-log` under `%AppData%/Bee Strong POS/logs/`
- [x] **ADMIN-05**: Logs rotate by size (max 1 MB per file, max 5 files) and never include full badge numbers, passwords, or Magicline session tokens
- [ ] **ADMIN-06**: The app auto-updates via `electron-updater` against a private GitHub Releases feed using a fine-grained PAT with only `contents:read` scope, stored via `safeStorage`
- [x] **ADMIN-07**: Update installation is gated behind a safe window — `quitAndInstall` is only called when the app is idle (no active member transaction, just after an idle reset, or during a 03:00–05:00 maintenance window); never mid-transaction
- [ ] **ADMIN-08**: During update download/install the user sees a branded "Updating, please wait" cover; on update failure the app falls back to the previous version and logs the failure

### Branding & UX

- [ ] **BRAND-01**: The branded host UI (splash, idle overlay, admin PIN modal, error screen, credentials screen, updating cover) uses Bee Strong logo and brand colors
- [ ] **BRAND-02**: All branded overlay UI is readable and operable on a vertical touchscreen with minimum 44x44 px touch targets and high contrast
- [ ] **BRAND-03**: The Magicline content area itself is NOT re-themed (colors, fonts unchanged) — only hidden elements are modified

## v2 Requirements

Deferred to future release. Tracked but not in current roadmap.

### Operational

- **OPS-01**: Selector-health self-check reports as a structured diagnostic file readable via admin menu without RDP
- **OPS-02**: Scheduled nightly `app.relaunch()` at 03:00 to shed any long-running memory
- **OPS-03**: Staff-only status chip overlay showing connectivity, last update, and last sale time
- **OPS-04**: Welcome screen / attract loop when the kiosk is idle (after hard reset)
- **OPS-05**: Configurable idle timeout / overlay countdown via admin menu
- **OPS-06**: Session-expired silent re-login when Magicline server-side logs out a still-active session
- **OPS-07**: Offline detection with branded "Connection lost — please try again" screen and automatic recovery
- **OPS-08**: Hashed audit log of transactions (badge prefix + amount + timestamp) for staff reconciliation

## Out of Scope

Explicitly excluded. Documented to prevent scope creep.

| Feature | Reason |
|---------|--------|
| Custom POS UI / own checkout flow | Would require duplicating Magicline product/pricing/membership data; exactly what wrapping the SaaS UI is designed to avoid |
| Magicline `/open-api/device/vending/` API integration | API is for actual vending machines; no product catalogue endpoint; customer confirmed unsuitable |
| Restyling Magicline's content area (colors/fonts) | High maintenance cost vs. Magicline updates, low member-visible value, multiplies fragile CSS problem |
| Multi-device / multi-gym support | Single device at one location; no multi-tenant abstraction needed |
| Android / Fully Kiosk Browser path | Abandoned due to WebView drift and unwinnable React re-render battle — dual-boot device boots Windows instead |
| Tauri / WebView2 / native C# host | Electron's `insertCSS` and `executeJavaScript` are the proven primitives for injection against a React SaaS we don't control; alternatives risk weeks of edge cases for no practical benefit |
| Deka SDK / `.aar` integration | Reader confirmed working as USB HID keyboard wedge; SDK adds platform coupling for zero benefit |
| Hosted crash reporting (Sentry, Bugsnag) | Single device, RDP available, no recurring-cost infrastructure in budget |
| Full badge numbers in logs | Privacy / anti-fraud — hashed or prefix-only only |
| PIN pad / cash drawer / receipt printer integration | Members use Magicline-managed payment (stored card / membership credit), no cash |
| Voice control / biometric auth | Not in scope for a badge-scan kiosk |
| Internationalization | German-only, single location |
| Code-signed Windows installer | Single device, one-time install via RDP, SmartScreen one-click is acceptable for v1 — revisit if >1 device |
| Member-facing product search / cart total overlay | Magicline content area is the sole checkout UI; adding parallel overlays multiplies drift risk |

## Traceability

Which phases cover which requirements. Filled in during roadmap creation.

| Requirement | Phase | Status |
|-------------|-------|--------|
| SHELL-01 | Phase 1 | Complete |
| SHELL-02 | Phase 1 | Complete |
| SHELL-03 | Phase 1 | Complete |
| SHELL-04 | Phase 1 | Complete |
| SHELL-05 | Phase 1 | Complete |
| SHELL-06 | Phase 1 | Complete |
| EMBED-01 | Phase 2 | Pending |
| EMBED-02 | Phase 2 | Pending |
| EMBED-03 | Phase 2 | Pending |
| EMBED-04 | Phase 2 | Pending |
| EMBED-05 | Phase 2 | Pending |
| EMBED-06 | Phase 2 | Pending |
| AUTH-01 | Phase 3 | Pending |
| AUTH-02 | Phase 3 | Pending |
| AUTH-03 | Phase 3 | Pending |
| AUTH-04 | Phase 3 | Pending |
| AUTH-05 | Phase 3 | Pending |
| AUTH-06 | Phase 3 | Pending |
| NFC-01 | Phase 4 | Code complete (physical deferred) |
| NFC-02 | Phase 4 | Code complete (physical deferred) |
| NFC-03 | Phase 4 | Code complete (physical deferred) |
| NFC-04 | Phase 4 | Code complete (physical deferred) |
| NFC-05 | Phase 4 | Code complete (physical deferred) |
| NFC-06 | Phase 4 | Code complete (physical deferred) |
| IDLE-01 | Phase 4 | Code complete (physical deferred) |
| IDLE-02 | Phase 4 | Code complete (physical deferred) |
| IDLE-03 | Phase 4 | Code complete (physical deferred) |
| IDLE-04 | Phase 4 | Code complete (100-cycle harness green; physical spot-check deferred) |
| IDLE-05 | Phase 4 | Code complete (physical deferred — runs LAST) |
| IDLE-06 | Phase 4 | Code complete (physical deferred) |
| IDLE-07 | Phase 4 | Code complete (physical deferred) |
| ADMIN-01 | Phase 5 | Pending |
| ADMIN-02 | Phase 5 | Pending |
| ADMIN-03 | Phase 5 | Complete |
| ADMIN-04 | Phase 5 | Complete |
| ADMIN-05 | Phase 5 | Complete |
| ADMIN-06 | Phase 5 | Pending |
| ADMIN-07 | Phase 5 | Complete |
| ADMIN-08 | Phase 5 | Pending |
| BRAND-01 | Phase 5 | Pending |
| BRAND-02 | Phase 5 | Pending |
| BRAND-03 | Phase 5 | Pending |

**Coverage:**
- v1 requirements: 42 total
- Mapped to phases: 42 (100%)
- Unmapped: 0

---
*Requirements defined: 2026-04-08*
*Last updated: 2026-04-08 after roadmap creation (traceability filled)*
