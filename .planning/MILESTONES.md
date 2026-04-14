# Milestones

## v1.0 MVP (Shipped: 2026-04-14)

**Phases:** 6 phases, 36 plans
**Requirements:** 42 / 42 closed (29 fully verified, 13 code-complete with physical verification deferred to the next-kiosk-visit batch)
**Audit:** `tech_debt` (no critical blockers; physical batch documented in `.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md`)
**Archive:** [v1.0-ROADMAP.md](milestones/v1.0-ROADMAP.md) · [v1.0-REQUIREMENTS.md](milestones/v1.0-REQUIREMENTS.md) · [v1.0-MILESTONE-AUDIT.md](milestones/v1.0-MILESTONE-AUDIT.md)

**Key accomplishments:**

- **Phase 1 — Locked-down shell:** Electron 41.1 kiosk on Win 11 Pro with single-instance lock, `before-input-event` keyboard lockdown for Alt+F4 / Alt+Tab / Win / F11 / Esc / Ctrl+W, branded splash, per-user NSIS installer with Startup-folder auto-start, and an OS-hardening runbook (Assigned Access + GPO + registry) for the dedicated `bsfkiosk` Windows user.
- **Phase 2 — Magicline embed + drift-isolated injection:** Magicline cash register loaded inside a child WebContentsView with a permanent `insertCSS` hide layer and `executeJavaScript` that ports the prototype's MUI React-native value setter, MutationObserver re-application, and dynamic element hiding. All fragile MUI `css-xxxxx` selectors isolated to a single `fragile-selectors.js` drift layer with boot-time selector self-check logging.
- **Phase 3 — Credentials + auto-login state machine:** Credentials encrypted at rest via Electron `safeStorage` (Windows DPAPI), atomic-persist to disk, branded PIN keypad credentials overlay. `authFlow` is a pure reducer + executor split walking BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY, with a branded "Credentials unavailable" failure mode behind admin PIN — never plaintext, never crash-loop. TabTip launcher verified on proxy hardware.
- **Phase 4 — NFC + idle + session lifecycle:** Main-process HID badge capture with sentinel-null arbitration (fixes the Android-prototype first-character-drop bug), 60 s activity-idle window with branded "Are you still there?" overlay, mutex-guarded hard reset (`about:blank` → `clearStorageData` → `flushStore` → reload), unified rolling-window reset-loop guard, post-sale customer-field clear, and `render-process-gone` self-recovery. Backed by a 100-cycle reset harness — 102/102 automated tests green.
- **Phase 5 — Admin / logging / auto-update / branded polish:** `Ctrl+Shift+F12` admin PIN gate (scrypt + persistent rolling-window lockout) opens an admin menu with exit / re-enter credentials / reload / view logs / check updates. `electron-updater` against private GitHub Releases (fine-grained PAT in `safeStorage`), gated by an `updateGate` safe-window so `quitAndInstall` only fires post idle-reset or in the 03:00–05:00 window. Rotating logs (1 MB × 5) under `%AppData%/Bee Strong POS/logs/` with field-name allowlist redaction. Touch-target audit landed BRAND-02 across every owned overlay.
- **Phase 6 — Welcome-screen lifecycle redesign (added 2026-04-13):** Hardware testing on 2026-04-12 reproduced a third-cycle re-login failure (stale server-side session bleeding through in-place idle resets, Magicline showing an "expired session" retry page that inject.js selectors did not match). Phase 6 replaces the register-as-resting-state model with a welcome-as-resting-state model: `cold-boot → welcome → tap → login → register → 60 s idle → 10 s "Noch da?" → full logout → welcome`. New `#welcome-screen` host layer (z-index 150) with the German "Zum Kassieren tippen" CTA, `sessionReset.hardReset({mode:'welcome'})` performs a full storage wipe (incl. localstorage), welcome-mode resets are excluded from the reset-loop counter, cold boot lands on welcome with no Magicline pre-warm. 5-cycle welcome harness 1/1 PASS, full suite 286/286 PASS, 19/19 security threats closed in `06-SECURITY.md`, 5/5 UAT scenarios passed (1 skipped).

**Hardware testing fixes folded into v1.0:** 9 source-level bugs found on the new Win 11 Pro kiosk PC during the 2026-04-12 session — splash blocking credentials input, Magicline view stealing input from host overlays, auto-login not firing after idle reset, stale `webContents` reference after view recreation, false drift errors blocking working UI, Appcues onboarding popup, register auto-selection ("Kasse auswählen" → "Self-Checkout" → "Speichern"), post-submit watchdog too aggressive, persistent-cookie preservation on idle reset. Stale-cookie self-heal path added as a backstop, then made obsolete by Phase 6's full-logout welcome lifecycle.

**Stack delivered:** Electron 41.1.1 + Node 20 LTS · electron-builder 26.8.x NSIS per-user installer · electron-updater 6.8.x against private GitHub Releases · electron-log 5.2.x rotating files · electron-store 10.1.x (CJS) · Electron `safeStorage` (DPAPI) for credentials and update PAT · plain HTML/CSS/JS overlays (no framework). Auto-launch via `app.setLoginItemSettings` + NSIS Startup-folder shortcut. No `keytar`, no `node-hid`, no SaaS dependencies.

**Verification debt rolled to next kiosk visit (19 items, all with automated backstops):**
- Phase 1 — 5 items: fresh-boot visual, splash permanence, double-launch race, prod-sim chord test, on-device runbook walk-through
- Phase 3 — 1 item: TabTip manual-button re-verify on actual kiosk terminal
- Phase 4 — 13 items: NFC-01..06 (Deka reader + test badge) + IDLE-01..07 (touchscreen + Task Manager); IDLE-05 must run LAST (destructive)
- Phase 6 — 1 item: 5-cycle welcome-loop smoke check (cold boot → 5 × idle-expire-to-welcome cycles)

Field guide for the visit: `docs/runbook/v1.0-KIOSK-VISIT.md`.

---
