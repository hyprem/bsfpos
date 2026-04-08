# Project Research Summary

**Project:** Bee Strong POS Kiosk
**Domain:** Single-device Windows Electron kiosk wrapping a third-party React+MUI SaaS (Magicline) web UI, with NFC HID badge input, idle/reset flow, DPAPI-encrypted credentials, and GitHub Releases auto-update
**Researched:** 2026-04-08
**Confidence:** HIGH

## Executive Summary

Bee Strong POS is a **lockdown shell around Magicline**, not a POS application in its own right. The product thesis is "wrap, don't rebuild": Magicline's existing cash register page is the checkout UI, and our job is to load it in a fullscreen Electron window, hide everything that isn't relevant to self-checkout, auto-fill the customer search field from a USB HID NFC badge scan, and make the kiosk self-heal on idle, crash, and session expiry — all without staff intervention. Every research stream converges on the same conclusion: the interesting engineering is in **injection stability, reset/recovery, and lockdown**, not in checkout UX. Anyone pulling toward "let's improve the checkout screen" is pulling toward the #1 scope killer.

The prescribed stack is deliberately minimal: **plain Electron 41 + HTML/CSS/JS, packaged by `electron-builder` (NSIS), auto-updated via `electron-updater` → GitHub Releases, credentials in the built-in `safeStorage` API (DPAPI), config in `electron-store@10`, logs in `electron-log`**. No bundler, no renderer framework, no native modules (`keytar` is archived; `node-hid` is unnecessary because the Deka reader is a keyboard wedge). The architecture is a single host `BrowserWindow` loading our own branded `host.html` with Magicline embedded in a child `BrowserView`/`WebContentsView`. Our branded overlays (idle, login splash, error, admin PIN) live in *our* DOM — never injected into Magicline's React tree. Main process is the single source of truth for credentials, idle timer, badge state, session resets, and updates.

The dominant risks are all operational, not architectural: (1) **fragile MUI `css-xxxxx` selectors** that will drift with every Magicline deploy — must be isolated in a dedicated "drift layer" with text/structure fallbacks and a boot-time self-diagnosis; (2) **idle-reset ↔ auto-login races** that can produce cross-member cart bleed — must be a mutex-guarded async state machine, not a naive `clearStorageData + reload`; (3) **Windows kiosk breakout** (edge swipes, Win keys, Ctrl+Alt+Del) — Electron's `kiosk: true` is necessary but not sufficient; requires Shell Launcher v2 or Assigned Access + GPO hardening at the OS layer; (4) **auto-update restart mid-transaction** — must be gated behind a "safe window" tied to idle-reset completion, never a naive timer; (5) **`safeStorage` bricked by Windows password reset** — mandatory fallback credential re-entry flow. Mitigations for all five exist and are cheap if designed in from phase 1, expensive to retrofit.

## Key Findings

### Recommended Stack

Plain Electron with no bundler, no renderer framework, no native modules. Every dependency not on this list is ballast for a single-device project, and several (keytar, node-hid, sentry) are explicitly rejected with cited reasons.

**Core technologies:**
- **Electron `^41.1.1`** — hosts Magicline, provides `insertCSS`/`executeJavaScript`/`session`/`safeStorage`. Pin to `~41.x`.
- **electron-builder `^26.8.1` (NSIS target)** — Windows installer + `latest.yml` for auto-update; publishes to GitHub Releases.
- **electron-updater `^6.8.3` (GitHub provider)** — zero-infra auto-update, matches "no recurring SaaS costs" budget.
- **Electron `safeStorage` (built-in)** — DPAPI-encrypted credentials. Replaces archived `keytar`.
- **electron-store `^10.1` (CJS line)** — non-secret config + encrypted credential blob. Pin to 10.x; 11.x is ESM-only.
- **electron-log `^5.2`** — rotating file logs in `%AppData%/Bee Strong POS/logs/`, RDP-readable.
- **Plain HTML/CSS/JS for overlays** — 3–5 screens; a framework would be pure ceremony.

**Explicitly rejected:** keytar (archived Dec 2022), node-hid, robotjs, React/Vue/Svelte for the shell, Webpack/Vite, TypeScript initially, Sentry/Bugsnag, Tauri/WebView2, Deka SDK.

### Expected Features

Features cluster around **resilience, reset, and lockdown** rather than checkout UX.

**Must have (table stakes, T1–T15, all P1):** T1 kiosk lockdown, T2 auto-login, T3 safeStorage creds, T4 NFC capture with <50 ms timing gate, T5 React-native value setter, T6 permanent CSS hide list, T7 dynamic JS hiding via MutationObserver, T8 post-sale 3 s reset, T9 60 s idle overlay, T10 idle hard reset, T11 crash recovery, T12 auto-start, T13 admin exit + PIN, T14 touch sizing, T15 rotating logs.

**Should have (differentiators, within weeks of launch):** D1 branded overlays, D2 auto-update (critical first time Magicline drifts), D4 offline-mode branded screen, D5 session-expired silent re-login, D7 badge scan feedback, D8 selector-health boot check, D9 admin panel.

**Defer (v2+):** D3 staff status chip, D6 hashed audit log, D10 welcome screen, D11 configurable timeout.

**Aggressively rejected anti-features (A1–A15):** custom checkout UI, restyling Magicline content, Magicline vending API, hosted crash reporting, full badge numbers in logs, multi-device abstraction, PIN pad/cash drawer/receipt printer, raw Magicline errors shown to members, voice/biometric, i18n, member update UI, member product search, cart total overlay.

### Architecture Approach

**One host `BrowserWindow`** loads our own `host.html` (branded overlays), with a child `BrowserView`/`WebContentsView` embedding Magicline. Overlays live in *our* DOM. Main process is single source of truth. Two preloads with `contextBridge`, `nodeIntegration: false`, `contextIsolation: true`, `sandbox: true`.

**Major components (main process):**
1. **AppBootstrap + HostWindow** — lifecycle, single-instance lock, kiosk window, `before-input-event` keyboard lockdown
2. **MagiclineView + InjectionService** — BrowserView + re-apply `insertCSS`/`executeJavaScript` on every nav
3. **CredentialStore** — `safeStorage` with decrypt-failure fallback
4. **IdleController + SessionResetService** — 60 s timer; mutex-guarded async reset (`about:blank` → `clearStorageData` → `flushStore` → reload → auto-login)
5. **AdminExitController** — `globalShortcut` + `before-input-event` → PIN → drop kiosk
6. **Logger** — rotating `electron-log` with structured events
7. **UpdateService** — `electron-updater` gated by safe-window signals or 04:00 maintenance window
8. **CrashWatcher** — `render-process-gone` → log + reload

**Key decision:** host window + child BrowserView (not one window loading Magicline, not two separate windows) — isolates branded overlays from React re-renders and single-sources HID focus routing.

### Critical Pitfalls

1. **Fragile MUI `css-xxxxx` drift** — isolate in single `fragile-selectors.js` with text/structure fallbacks + boot-time self-diagnosis. Never restyle Magicline content.
2. **Idle reset ↔ auto-login race** — strict sequential `about:blank` → `await clearStorageData` → `await clearCache` → `await cookies.flushStore` → `loadURL`, mutex-guarded, with loop detection (>3 reloads/60 s).
3. **`insertCSS` flash-of-unhidden-UI** — inject at preload / `did-start-navigation`, plus a branded splash cover that lifts only after JS confirms hide rules matched.
4. **Windows kiosk breakout** — Shell Launcher v2 or Assigned Access + GPO hardening + physical USB blocking. Test full `kiosk-mode-breakout` checklist.
5. **Auto-update mid-transaction** — never call `quitAndInstall` from running code; gate behind safe-window signal or 04:00 window; show branded updating screen.

Also documented: safeStorage bricking by Windows password reset, latent HID first-character-drop bug in prototype, MutationObserver CPU loop, long-running memory leaks, Magicline server-side logout invisible state.

## Implications for Roadmap

### Phase 1: Walking Skeleton + OS Hardening
Branded splash, fullscreen kiosk, no escape, Shell Launcher/Assigned Access + GPO on dedicated Windows account, single-instance lock, auto-start. Demo environment must match deployed environment from day one.

### Phase 2: Magicline Embed + Injection & Drift Isolation
Child BrowserView; re-injection on every nav; stable vs fragile selector split; `hideDynamicElements` for text/SVG-path; boot-time selector self-check; no flash-of-unhidden-UI. Biggest ongoing maintenance risk — retrofit is expensive.

### Phase 3: Credentials + Auto-Login State Machine
`safeStorage` + integrity marker + fallback re-entry; reactive login state machine (BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY); one-shot credential delivery via preload. Must precede session-reset.

### Phase 4: NFC Input + Session Lifecycle State Machine
Main-process-side badge buffer via `before-input-event`; modal-state routing; 30 s idle countdown; mutex-guarded async reset with loop detection; 3 s post-sale reset; `render-process-gone` handler. The two features most likely to embarrass launch.

### Phase 5: Admin Exit + Logging + Auto-Update
`globalShortcut` + `before-input-event` admin hotkey; PIN modal with lockout; rotating structured logs; `electron-updater` with safe-window gating; branded updating cover; NSIS installer + auto-start; code-signing decision. Depends on Phase 4.

### Phase 6: Hardening, Branding & Long-Running Reliability
Branded overlays, offline screen, session-expired silent re-login, scan feedback, daily 03:00 `app.relaunch()`, memory monitoring, full checklist pass, on-device 7-day test.

### Phase Ordering Rationale

- Phase 1 first: OS lockdown must match dev environment.
- Phase 2 before 3: auto-login depends on the injection pipeline detecting the login page reliably.
- Phase 3 before 4: reset loop requires reactive idempotent auto-login.
- Phase 4 before 5: auto-update safe-window gating depends on session-lifecycle state signals.
- Phase 6 last: branding/hygiene assume stable state machines + IPC.

### Research Flags

**Needs research during planning:**
- **Phase 1:** Shell Launcher v2 vs Assigned Access vs GPO depends on gym device's Windows SKU. Re-enumerate `kiosk-mode-breakout` for current Win 11 build.
- **Phase 2:** `BrowserView` vs `WebContentsView` class for Electron 41; overlay hide mechanism prototype bake-off.
- **Phase 4:** Latent HID first-character-drop bug analysis; `clearStorageData` + `flushStore` ordering test harness on Electron 41.
- **Phase 5:** Safe-window signal wiring; code-signing cert vs SmartScreen acceptance decision.

**Standard patterns (skip research-phase):**
- **Phase 3:** `safeStorage` well-documented; fallback re-entry is a standard decrypt-or-prompt pattern.
- **Phase 6:** Standard CSS, `electron-log` rotation, `app.relaunch()` scheduling.

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | Verified against current npm + official docs; Electron 41.1.1 confirmed; keytar archival confirmed; electron-store 10 vs 11 ESM break confirmed. |
| Features | HIGH | T1–T15 from working prototype or PROJECT.md; D1–D11 MEDIUM (industry convention); A1–A15 HIGH (explicit scope or thesis violation). |
| Architecture | HIGH | Grounded in working prototype + stable Electron primitives. MEDIUM on exact `BrowserView` vs `WebContentsView` class name and overlay hide mechanism. |
| Pitfalls | HIGH | Every pitfall backed by cited GitHub issue or official doc. MEDIUM on exact `clearStorageData` race under Electron 41 and `electron-updater` kiosk edge cases. |

**Overall confidence:** HIGH.

### Gaps to Address

- **Windows license SKU on gym device** — blocks Phase 1 detailed planning.
- **Electron 41 `BrowserView` vs `WebContentsView` class** — verify at Phase 2 start.
- **Latent HID first-character drop** in prototype's `BADGE_SPEED_MS` — fix during Phase 4 port.
- **`clearStorageData` + `flushStore` exact ordering on Electron 41** — test harness in Phase 4 (100 reset cycles, zero half-logged-in).
- **Code-signing decision** for NSIS installer — affects SmartScreen UX and auto-update trust path; call before Phase 5.
- **Magicline selector drift cadence** — unknowable upfront; architecture already isolates, accept and monitor.
- **Gym IT Windows password-rotation policy** — if rotated, Phase 3 fallback re-entry must be runbook-documented before first rotation.

## Sources

Primary: `.planning/PROJECT.md`, `BeeStrong_POS_Kiosk_Project.md`, Electron docs (safeStorage, BrowserWindow, BrowserView/WebContentsView, contextBridge, session.clearStorageData, globalShortcut, kiosk), electron-builder/updater/log docs, MUI customization docs, Microsoft Learn (Shell Launcher v2, Assigned Access, DPAPI), github.com/ikarus23/kiosk-mode-breakout.

Secondary: VS Code #185677, Element #1947 (keytar migration), Electron #9776/#15928/#18585/#24130 (clearStorageData), #34614 (safeStorage), electron-builder #1589/#7785/#8436 (auto-update restart), mobile-jon (Win 11 Assigned Access), Hexnode (kiosk hardening).

Tertiary (cross-check): Hashmato, AVIXA Xchange, Kiosk Industry, Level Access, Aila, Gantner, Elatec (kiosk UX conventions); l-trondirect, NI forum (HID focus-dependency).
