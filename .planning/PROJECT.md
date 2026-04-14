# Bee Strong POS Kiosk

## What This Is

A self-service POS kiosk app for Bee Strong Fitness gym. It runs on a single Windows-based POS terminal and wraps the Magicline cloud cash register web UI in a locked-down Electron shell, so gym members can buy products themselves by scanning their NFC badge — using Magicline's existing web interface as the backend without any custom POS logic of our own.

## Core Value

A gym member can walk up, scan their badge, have a product scanned (or self-selected), pay, and walk away — without any staff interaction and without ever seeing or being able to break out of the locked Magicline cash register page.

## Current State

**v1.0 MVP shipped 2026-04-14.** 6 phases, 36 plans, 42/42 requirements closed (all code-complete and automated-test-green). Audit posture: `tech_debt` — no critical blockers, 50 row-level physical verification checks consolidated into the next-kiosk-visit batch (`.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md`); deferral is row-level only, not requirement-level. Field guide: `docs/runbook/v1.0-KIOSK-VISIT.md`. Detailed accomplishments: see `.planning/MILESTONES.md`. Full archive: `.planning/milestones/v1.0-ROADMAP.md` + `v1.0-REQUIREMENTS.md`.

## Next Milestone Goals

To be defined. Run `/gsd-new-milestone` to start the next version. Likely candidates parked from v1.0 deferrals: badge-scan-on-welcome shortcut, attract loop animation, configurable idle timeouts, OPS-* observability surfaces.

## Requirements

### Validated

<!-- Shipped and confirmed valuable. -->

- [x] **v1.0 MVP** (shipped 2026-04-14): fullscreen Electron kiosk on Win 11 Pro, OS-hardened `bsfkiosk` user account, Magicline cash register embedded with drift-isolated CSS+JS injection, DPAPI-encrypted credentials with reactive auto-login state machine, NFC badge capture with first-character-drop fix, welcome-screen lifecycle (cold-boot → welcome → tap → login → 60s idle → 10s "Noch da?" → full-logout → welcome) replacing in-place idle reset, hidden Ctrl+Shift+F12 admin exit with scrypt-hashed PIN + lockout, electron-updater against private GitHub Releases gated by safe-window, rotating redacted logs, branded touch-ready overlays. **Validation gate at next kiosk visit:** the 50 deferred physical-verification rows must pass before the v1.0 build is declared field-validated.

### Active

<!-- Current scope. Building toward these. -->

(None — awaiting next milestone definition.)

### Out of Scope

<!-- Explicit boundaries. Includes reasoning to prevent re-adding. -->

- Magicline `/open-api/device/vending/` API integration — confirmed unsuitable for this use case; we must wrap the actual Magicline UI to get correct product/pricing/membership behavior
- Custom POS UI (own product catalogue, own checkout flow) — would require duplicating Magicline's product/price/membership data and is exactly what wrapping the SaaS UI lets us avoid
- Multi-device / multi-gym support — only one terminal at one location; no multi-tenant config, no per-device branding system
- Android / Fully Kiosk Browser path — abandoned because WebView updates and CSS-vs-React-rerender battles are unsustainable; the device is dual-boot, just boot Windows
- Restyling Magicline's content area (colors, fonts inside the cash register UI) — high maintenance cost vs. Magicline updates, low value vs. just hiding what we don't want
- Tauri / WebView2 / native C# host — Electron's `insertCSS` and `executeJavaScript` are the proven primitives for surviving React re-renders against a SaaS we don't control; alternatives risk weeks of injection edge cases
- Deka SDK / `.aar` integration — confirmed the reader works as USB HID keyboard wedge, no SDK needed
- Theming / customization beyond branded overlays — ship the functional kiosk first

## Context

**Background — what already exists:**
- A working Android prototype on the same dual-boot device using Fully Kiosk Browser PLUS with JavaScript injection. It works but suffers from constant React re-render fights, fragile MUI auto-generated CSS class names, and outdated WebView issues
- A detailed working JS injection script (badge capture, MUI value setter, dynamic element hiding, reset logic) ready to be ported into Electron's `executeJavaScript` — proven against the live Magicline UI
- A detailed CSS hide list with stable `[data-role=...]` selectors and a few fragile MUI auto-class selectors flagged for re-verification on Magicline updates
- The hardware: Chinese OEM POS terminal with dual-boot (Android 11 / Windows), touchscreen, Deka USB HID NFC reader

**Why Electron over Android in one line:** on Windows, `insertCSS`/`executeJavaScript` are engine-level and survive React re-renders; on Android Fully Kiosk we were fighting React on every paint.

**Magicline UI quirks that drive design:**
- React + Material UI app, so direct DOM input typing doesn't update React state — must use `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set` then dispatch `input` + `change` events
- Stable `[data-role=...]` selectors exist for most things we care about
- A handful of `css-xxxxx` MUI auto-class selectors are fragile and will need re-verification when Magicline ships updates
- No public catalogue endpoint; the vending API is for actual vending machines, not custom POS UIs

**Live URL:** `https://bee-strong-fitness.web.magicline.com/#/cash-register`

**Detailed reference:** see `BeeStrong_POS_Kiosk_Project.md` at the project root for the full Android prototype, JS/CSS scripts, NFC timing logic, and Magicline selector inventory.

## Constraints

- **Tech stack**: Electron (latest stable), Node, HTML/CSS/JS — chosen because the existing prototype JS ports directly and `insertCSS`/`executeJavaScript` survive React re-renders
- **Target OS**: Windows on the existing dual-boot POS terminal — no new hardware, just reboot from Android side
- **Backend**: Magicline SaaS at `bee-strong-fitness.web.magicline.com` — we don't control it; selectors and behavior may shift on Magicline updates
- **Hardware**: Touchscreen kiosk in vertical/tablet orientation; Deka NFC reader as USB HID keyboard wedge (no SDK)
- **Devices**: Exactly one device — no multi-tenant abstractions
- **Budget**: Self-built; no recurring SaaS costs (no Sentry, no hosted update server). Auto-update via free GitHub Releases
- **Security**: Magicline credentials must never be stored plaintext on disk; use Windows DPAPI via Electron `safeStorage`. Hidden admin exit must require a PIN
- **Reliability**: Must auto-recover from crashes, idle timeouts, and Magicline session expiry without staff intervention — staff visit for maintenance only
- **Maintenance**: Remote access via RDP/TeamViewer; no local debugging UI other than the hidden admin exit
- **Magicline drift**: Fragile MUI `css-xxxxx` selectors will break on some Magicline updates — design must isolate them so they're easy to re-verify and update

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| Electron on Windows over Android + Fully Kiosk | `insertCSS`/`executeJavaScript` survive React re-renders at engine level; no WebView version drift; no MUI re-render battle | — Pending |
| Wrap Magicline web UI rather than build custom POS on vending API | Vending API is for vending machines, lacks product catalogue, and would require duplicating Magicline data/pricing | — Pending |
| Electron over Tauri / WebView2 / C# host | Existing prototype JS ports directly; `electron-updater` + GitHub Releases is one-config auto-update; injection reliability is the proven primitive | — Pending |
| Credentials in Electron `safeStorage` (Windows DPAPI) | Encrypted at rest, only this Windows user can decrypt, no plaintext on disk, no env var leakage to other processes | — Pending |
| Auto-update from GitHub Releases via `electron-updater` | Free, no infra to host, integrates cleanly with Electron build | — Pending |
| Idle reset must clear Electron session (cookies, storage) | Cart must be dropped between members; the only reliable way to drop Magicline cart state we don't control is to drop the session and re-login | — Pending |
| Login via selector-based form fill, not key/tab simulation | Selectors `[data-role="username/password/login-button"]` are stable; React-native value setter is already proven for badge input — same trick applies | — Pending |
| NFC reader as USB HID keyboard wedge, no Deka SDK | Confirmed working in prototype; SDK adds platform coupling for zero benefit | — Pending |
| Local log files only, no remote crash reporting | Single device, RDP available, no need for Sentry infra/cost | — Pending |
| Branded overlays only; Magicline content area unchanged | Restyling Magicline content compounds the fragile-CSS problem on every Magicline update | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd-transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd-complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-04-14 after v1.0 milestone archival*
