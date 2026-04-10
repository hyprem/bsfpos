# Phase 5 Verification Checklist

**Created:** 2026-04-10
**Phase:** 05-admin-exit-logging-auto-update-branded-polish
**Automated status:** All Phase 5 test files green (see list below).
**Human verification status:** **DEFERRED to next kiosk visit** — consolidated
next-visit batch lives in `.planning/phases/01-locked-down-shell-os-hardening/01-VERIFICATION.md`.

## Automated Coverage (CI — must be green before close)

- [x] `node --test test/logger.audit.test.js test/logger.archiveLogFn.test.js` — redactor + rotation (Plan 01)
- [x] `node --test test/adminPinLockout.test.js` — lockout semantics (Plan 02)
- [x] `node --test test/sessionReset.postReset.test.js test/updateGate.test.js` — gate + post-reset hook (Plan 03)
- [x] `node --test test/phase5-touch-target.test.js` — CSS-level BRAND-02 audit (Plan 06)
- [x] `node --test test/phase5-acceptance.test.js` — requirement-ID trace (Plan 06)
- [x] Phase 3/4 regression suites still green (242/242 after Plan 06 migration; 254/254 with Plan 06 additions)

## Phase 5 Human Verification — Next Kiosk Visit Batch

These items require the physical kiosk terminal with Deka reader, network
access to GitHub, and staff walk-through. They should be appended to
`01-VERIFICATION.md` as a **"Phase 5 — Deferred Physical Verification"**
subsection on Plan 06 completion.

### Admin Hotkey + PIN + Lockout (ADMIN-01, ADMIN-02, ADMIN-03)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-01 | Press `Ctrl+Shift+F12` on the running kiosk | Branded PIN modal opens (not DevTools, not Chrome menu) | [ ] |
| P5-02 | Enter correct admin PIN | Admin menu opens with 5 diagnostic rows populated (Version, Letztes Update, Status, Letzter Reset, Auto-Update) and 6 buttons in safe→destructive order | [ ] |
| P5-03 | Tap "Updates prüfen" | Inline result appears below button stack: "Aktuell" or "Update verfügbar — wird bei nächster Ruhepause installiert"; auto-hides after 5 s | [ ] |
| P5-04 | Tap "Protokolle anzeigen" | Windows Explorer opens to `%AppData%\Bee Strong POS\logs\`; close Explorer to return to kiosk | [ ] |
| P5-05 | Tap "Kasse nachladen" | Magicline view reloads; kiosk transitions back through BOOTING → CASH_REGISTER_READY | [ ] |
| P5-06 | Tap "Anmeldedaten ändern" | Credentials overlay appears in re-entry mode (no PIN setup fields) | [ ] |
| P5-07 | Enter 5 wrong PINs in under 60 s | On the 5th wrong attempt, lockout panel replaces keypad with live mm:ss countdown and message "Zu viele Versuche — bitte warten" | [ ] |
| P5-08 | Wait until countdown reaches 00:00 | Keypad re-appears automatically; correct PIN on next try opens admin menu | [ ] |
| P5-09 | During lockout, press `Ctrl+Shift+F12` again | PIN modal stays open; countdown does NOT reset or duplicate | [ ] |

### Logging (ADMIN-04, ADMIN-05)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-10 | Open `%AppData%\Bee Strong POS\logs\main.log` over RDP after a day of use | Lines for `event=startup`, `event=auth.state`, `event=idle.reset`, `event=badge.scanned`, `event=sale.completed` present | [ ] |
| P5-11 | `grep` the log directory for 10+ digit badge numbers | ZERO matches — only 8-hex sha256 prefixes should appear (e.g. `badge=a3f7c2b1`) | [ ] |
| P5-12 | `grep` the log directory for `password=` | Every hit is `password=***` (never plaintext) | [ ] |
| P5-13 | `grep` the log directory for PAT values starting with `ghp_` | Zero matches — PAT field must render as `pat=[cipher:N]` | [ ] |
| P5-14 | Count files in the logs directory after forced rotation (write > 5 MB to main.log by repeated actions) | Exactly `main.log` + `main.1.log` through `main.5.log` = 6 files max; `main.6.log` must NOT exist | [ ] |

### Auto-Update + Safe Window (ADMIN-06, ADMIN-07)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-15 | Fresh install, no PAT configured | Kiosk boots normally; admin diagnostic header shows "Auto-Update: nicht konfiguriert"; no GitHub calls in logs | [ ] |
| P5-16 | Enter valid PAT via "Auto-Update einrichten" screen | `update.check` log line appears; diagnostic header flips to "aktiv" | [ ] |
| P5-17 | Enter invalid PAT | Inline error surfaces via `show-admin-update-result`; admin menu does NOT lose state | [ ] |
| P5-18 | Publish a new tagged GitHub release while kiosk is running | Within 6 hours (or on next `Updates prüfen`), `update.downloaded` appears in logs; no visible UI change until safe window | [ ] |
| P5-19 | Trigger an idle-expiry hard reset after update-downloaded | `update.install` with `trigger=post-reset` logs; updating cover briefly visible; new version boots | [ ] |
| P5-20 | Alternatively wait until 03:00–05:00 window after a downloaded update | `update.install` with `trigger=maintenance-window` logs; new version boots | [ ] |

### Update Failure + Rollback (ADMIN-08)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-21 | Install a deliberately broken release (fails to reach CASH_REGISTER_READY) | 2-minute watchdog expires; `update.failed` with `reason=watchdog-expired` logs; bad-release variant appears on the `#magicline-error` layer with "Update fehlgeschlagen — bitte Studio-Personal verständigen" | [ ] |
| P5-22 | On bad-release screen, tap "PIN eingeben" → enter PIN | Admin menu opens; staff can view logs + exit to Windows for manual NSIS re-install | [ ] |
| P5-23 | After bad-release: reboot kiosk | `autoUpdateDisabled` latched; diagnostic header shows "Auto-Update: deaktiviert"; no automatic re-attempt | [ ] |
| P5-24 | Simulate an NSIS install-time failure (install-time exit code non-zero) | `update-failed` variant appears for 10 s with "Aktualisierung fehlgeschlagen — erneuter Versuch beim nächsten Neustart"; auto-dismisses; kiosk continues on old version | [ ] |

### Branded Polish (BRAND-01, BRAND-02, BRAND-03)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-25 | Visual inspection of admin menu on the vertical touchscreen | Logo centered, yellow (`#F5C518`) accents, dark (`#1A1A1A`) background, all buttons readable at arm's length | [ ] |
| P5-26 | Tap every admin menu button with a fingertip (not stylus) | Each button registers the tap on first try; no mis-taps due to under-size targets | [ ] |
| P5-27 | Visual inspection of updating cover during a real update | Logo + rotating spinner + "Aktualisierung läuft" + subtext; no Magicline chrome bleed-through | [ ] |
| P5-28 | Visual inspection of Magicline content area after all Phase 5 changes | Magicline colors, fonts, and layout unchanged from Phase 4 baseline | [ ] |
| P5-29 | Visual inspection of PAT config screen | Masked input, disabled Speichern until non-empty input, German hint text visible | [ ] |
| P5-30 | Visual inspection of PIN lockout countdown | 48 px yellow mm:ss, non-jittering (tabular-nums), readable at 60–80 cm | [ ] |

## Rollback Runbook (referenced by the bad-release variant)

1. Staff notices bad-release screen on a site visit or remote RDP.
2. Tap "PIN eingeben" → enter admin PIN → admin menu opens.
3. Tap "Beenden" → kiosk drops to Windows desktop.
4. Copy previous `Bee Strong POS Setup X.Y.Z.exe` via RDP/USB to the kiosk.
5. Run the installer; it will replace the broken version.
6. Reboot; auto-start launches the fresh install.
7. If the new PAT is still stored, auto-update resumes on next check.
8. If the operator wants auto-update to stay disabled, leave
   `autoUpdateDisabled=true` in `%AppData%\Bee Strong POS\config.json` — the
   diagnostic header will show "deaktiviert". Delete the flag (or tap
   "Auto-Update einrichten" and re-enter the PAT) to re-enable.

---

*Phase 5 verification checklist — deferred human portion routes to
`01-VERIFICATION.md` "Phase 5 — Deferred Physical Verification" subsection on
Plan 06 completion.*
