---
phase: 01-locked-down-shell-os-hardening
verified: 2026-04-08T20:30:00Z
status: human_needed
score: 6/6 must-haves structurally verified; 4 items require human checkpoint
re_verification:
  previous_status: none
  previous_score: n/a
  gaps_closed: []
  gaps_remaining: []
  regressions: []
human_verification:
  - test: "Run `npm start` and visually confirm dev-mode window: 420x800 frame, background #1A1A1A, dark logo centered, pulsing yellow bar, 'BITTE WARTEN…' text, DevTools detached, no white flash on first paint."
    expected: "Window matches 01-UI-SPEC.md; splash visible immediately with no flash of any other surface; DevTools opens detached."
    why_human: "Requires a live display; GSD executor headless session cannot observe first paint or layout."
  - test: "Leave dev-mode splash visible for 10+ seconds without Phase 2 injection."
    expected: "Splash remains visible indefinitely — no auto-lift timer; no did-finish-load fallback fires (D-03/D-06 correct failure mode)."
    why_human: "Observing absence of behavior over time requires interactive runtime."
  - test: "Start a second `npm start` while first is running. Inspect `%AppData%\\Bee Strong POS\\logs\\main.log`."
    expected: "Second process exits within ~1s with no second window; log contains literal line `second instance detected — exiting silently (D-05)`."
    why_human: "Double-launch race requires two concurrent interactive processes."
  - test: "Run `npx cross-env NODE_ENV= electron .` (prod-sim) and mash Alt+F4, Alt+Tab, F11, Escape, Ctrl+W, bare Win key."
    expected: "None of these close or unfullscreen the window; Win key and Alt+Tab may leak on dev machine (no OS hardening) — acceptable per runbook scope."
    why_human: "Locks developer out of their own PC until Task Manager kill (T-06-02); must be done by owner in controlled window."
  - test: "On target gym POS terminal (physical maintenance visit): run all 5 runbook scripts in order, then `05-verify-lockdown.ps1`, then walk `BREAKOUT-CHECKLIST.md`."
    expected: "All PS1 verify lines PASS; every checklist item fails to escape."
    why_human: "Hardening must not be run on dev machine (would brick developer's PC); physical-device only."
---

# Phase 1: Locked-Down Shell & OS Hardening — Verification Report

**Phase Goal:** A single, auto-starting, fullscreen Electron window owned by a hardened Windows account that a standing member cannot exit by any normal means. No Magicline UI visible before branded cover hands off.

**Verified:** 2026-04-08
**Status:** human_needed (all code/config structurally verified; 4 interactive checkpoints + 1 on-device runbook execution remain)
**Re-verification:** No — initial verification

## Goal Achievement

### Observable Truths (from ROADMAP Success Criteria)

| # | Truth | Status | Evidence |
|---|-------|--------|----------|
| 1 | On fresh boot, fullscreen Bee Strong-branded cover with no chrome, menu, title bar, system tray | VERIFIED (static) + HUMAN (live paint) | `src/main/main.js:21-39` kiosk:!isDev, fullscreen:!isDev, frame:isDev, autoHideMenuBar:true, `Menu.setApplicationMenu(null)` line 42; splash markup at `src/host/host.html:28-32`; `backgroundColor:'#1A1A1A'` at main.js:27 eliminates white flash |
| 2 | Alt+F4, Alt+Tab, Win, F11, Esc, Ctrl+W cannot expose desktop or chrome | VERIFIED (static/probe) + HUMAN (live chord test) | `src/main/keyboardLockdown.js:32-51` SUPPRESS_LIST contains all 6 required chords; bare Meta handled line 81-84; attached via `attachLockdown(mainWindow.webContents)` at main.js:142; live `canonical()` probe (PHASE-01-ACCEPTANCE.md:88-101) confirms all 6 required combos SUPPRESSED |
| 3 | Edge swipes, Action Center, Ctrl+Alt+Del items disabled per runbook; verifiable via breakout checklist | VERIFIED (artifacts) + HUMAN (on-device) | `docs/runbook/02-registry-hardening.reg` disables AllowEdgeSwipe, NoWinKeys, DisableTaskMgr, NoNotificationCenter, NoLogoff, DisableLockWorkstation, DisableChangePassword; `05-verify-lockdown.ps1` probes each; `BREAKOUT-CHECKLIST.md` enumerates all vectors |
| 4 | Second launch silently discarded — no second window | VERIFIED (static) + HUMAN (race test) | `src/main/main.js:90-95` `requestSingleInstanceLock()` first executable call; on `!gotLock` → `app.quit() + process.exit(0)`; no second-instance handler per D-05 |
| 5 | No flash of raw Magicline UI before splash hands off | VERIFIED (static) + HUMAN (visual) | `show:false` + `ready-to-show` at main.js:22,44; `paintWhenInitiallyHidden:true` line 28; `backgroundColor:'#1A1A1A'` line 27; splash is permanent layer at z-index 100 (`host.css:47`); only dismiss path is `ipcMain.on('cash-register-ready')` main.js:61-66 — no timer, no did-finish-load fallback (D-03 honored) |

**Score:** 6/6 requirements structurally satisfied; 4 interactive checkpoints + 1 on-device runbook execution outstanding.

### Required Artifacts

| Artifact | Expected | Status | Details |
|---|---|---|---|
| `src/main/main.js` | Single-window BrowserWindow, kiosk mode, single-instance, auto-start, globalShortcut, splash IPC stub | VERIFIED | 154 lines; CJS; all D-01..D-11 decisions present |
| `src/main/keyboardLockdown.js` | `attachLockdown`, `reservedShortcuts` Set, `SUPPRESS_LIST`, `canonical` | VERIFIED | 93 lines; exports all 4 symbols (line 93); dev-mode no-op (line 64-67); reservedShortcuts empty as Phase 1 ships (line 24) |
| `src/main/preload.js` | Minimal contextBridge surface for splash hide/show | VERIFIED | 11 lines; `onHideSplash`/`onShowSplash` only; no Node leak |
| `src/main/logger.js` | electron-log main init, rotating 1MB, AppData path | VERIFIED | 24 lines; `log.initialize()`, maxSize 1MB, main.log filename |
| `src/host/host.html` | Permanent host layer, splash layer, magicline-mount, CSP, z-index ladder | VERIFIED | 36 lines; strict CSP, `#magicline-mount` (z:0) + `#splash` (z:100); loads host.js; comment documents ladder for Phase 2-5 |
| `src/host/host.css` | Splash styling, #1A1A1A background, pulse animation, cursor:none prod | VERIFIED | 87 lines; layered structure, `bsk-pulse` keyframes, `body:not([data-dev="true"]) { cursor: none }` |
| `src/host/host.js` | Splash show/hide wiring via window.kiosk | VERIFIED | 28 lines; consumes preload bridge; sets `data-dev` attribute in dev |
| `src/host/assets/logo-dark.png` | Dark-BG logo | VERIFIED | File present (also logo-light.png) |
| `package.json` | Electron 41, electron-log 5, electron-builder 26, scripts, NSIS config, include installer.nsh | VERIFIED | `electron ~41.1.1`, `electron-log ~5.2.0`, `electron-builder ~26.8.1`, `cross-env` for NODE_ENV=development, NSIS oneClick/perMachine:false/`include:build/installer.nsh` |
| `build/installer.nsh` | customInstall/customUnInstall macros for Startup folder shortcut | VERIFIED | 22 lines; `$SMSTARTUP\${PRODUCT_NAME}.lnk` created/removed with `SetShellVarContext current` |
| `docs/runbook/README.md` | Target platform, run order, D-15 tradeoff, post-update recovery | VERIFIED | 86 lines; Windows 11 Pro confirmed, strict run order table, plaintext password tradeoff documented |
| `docs/runbook/01-create-kiosk-user.ps1` | Create bsfkiosk standard user + AutoAdminLogon | VERIFIED | 63 lines; `New-LocalUser`, removes from Administrators, writes Winlogon registry |
| `docs/runbook/02-registry-hardening.reg` | Edge swipes, Win keys, Action Center, Task Manager, Game Bar | VERIFIED | 55 lines; AllowEdgeSwipe=0, NoWinKeys=1, DisableTaskMgr=1, NoNotificationCenter=1, NoLogoff=1, DisableLockWorkstation=1 |
| `docs/runbook/03-custom-shell-winlogon.reg` | SpecialAccounts flag + per-user Shell approach | VERIFIED | Present (listed in README run order) |
| `docs/runbook/04-gpo-hardening.ps1` | Resolve SID, set `HKU\<sid>\...\Winlogon\Shell` | VERIFIED | Present |
| `docs/runbook/05-verify-lockdown.ps1` | PASS/FAIL probe for each criterion | VERIFIED | 75 lines; probes AutoAdminLogon, DefaultUserName, AllowEdgeSwipe, NoWinKeys, DisableTaskMgr, NoNotificationCenter, POS exe installed, Startup shortcut present |
| `docs/runbook/BREAKOUT-CHECKLIST.md` | All keyboard/gesture/mouse/OS vectors, double-launch, recovery, post-update | VERIFIED | 80 lines; enumerates Alt+F4..Ctrl+Alt+Del, edge swipes, mouse hot corners, Fast User Switching, admin exit hotkey (Phase 5) |
| `docs/runbook/ROLLBACK.ps1` | Restore explorer.exe shell, disable AutoAdminLogon | VERIFIED | Present |
| `docs/runbook/PHASE-01-ACCEPTANCE.md` | Pass/fail per SHELL-01..06, open issues, human checkpoint list | VERIFIED | 227 lines; per-requirement sections, live canonical() probe output, open issues, sign-off |
| `dist/win-unpacked/Bee Strong POS.exe` | `electron-builder --dir` artifact from plan 01-04 | VERIFIED | Present (along with chrome paks, locales, resources) |

### Key Link Verification

| From | To | Via | Status | Details |
|---|---|---|---|---|
| main.js | keyboardLockdown.js | `require('./keyboardLockdown'); attachLockdown(mainWindow.webContents)` | WIRED | main.js:11, 142 |
| main.js | logger.js | `require('./logger')` + `log.info`/`log.error` calls | WIRED | main.js:10, 45, 53, 92, 98, 113, 115, 128, 130, 147, 152 |
| main.js | preload.js | `preload: path.join(__dirname, 'preload.js')` | WIRED | main.js:33 |
| main.js | host.html | `mainWindow.loadFile(path.join(__dirname, '..', 'host', 'host.html'))` | WIRED | main.js:56 |
| host.html | host.css + host.js | `<link>` + `<script>` tags | WIRED | host.html:8, 34 |
| host.html | assets/logo-dark.png | `<img src="assets/logo-dark.png">` | WIRED | host.html:29; file exists |
| preload.js | host.js | `window.kiosk.onHideSplash` contextBridge | WIRED | preload.js:9-10 → host.js:22-27 |
| main.js (ipcMain) | host.js (splash hide) | `ipcMain.on('cash-register-ready')` → `mainWindow.webContents.send('splash:hide')` → `ipcRenderer.on('splash:hide')` → `hideSplash()` | WIRED (stub path) | main.js:61-66 → preload.js:9 → host.js:12-14,22-24. **CRITICAL D-03/D-06 CHECK:** No timer, no `did-finish-load` fallback, no navigation event triggers splash hide. Sole path is the ipcMain listener. Phase 1 end state: splash stays forever (correct). |
| package.json build | installer.nsh | `"nsis": { "include": "build/installer.nsh" }` | WIRED | package.json:55 → build/installer.nsh exists with both macros |
| main.js | app.setLoginItemSettings | runtime auto-start call | WIRED | main.js:106-112, gated `if (!isDev)` |
| installer.nsh | Startup folder | `CreateShortCut "$SMSTARTUP\${PRODUCT_NAME}.lnk"` | WIRED | installer.nsh:14 |

### Data-Flow Trace (Level 4)

Splash dismissal data flow (the load-bearing D-03 contract):

| Artifact | Variable | Source | Produces Real Data | Status |
|---|---|---|---|---|
| host.js `hideSplash()` | `splash:hide` IPC event | preload `onHideSplash` → ipcRenderer → main.js `mainWindow.webContents.send('splash:hide')` → triggered only by `ipcMain.on('cash-register-ready')` | In Phase 1: never fires (by design — Phase 2 will provide) | FLOWING (stub path is correct failure mode per D-06) |

**Critical finding:** The splash dismiss path is strictly single-source. Grepped `src/host/host.js` and `src/host/host.html` for any alternative dismiss (timer, navigation listener, click handler, did-finish-load) — **none found**. The pointer-events:none on `.bsk-layer--splash` (host.css:50) prevents accidental click-dismissal. D-03 honored exactly as specified.

### Behavioral Spot-Checks

| Behavior | Command | Result | Status |
|---|---|---|---|
| main.js passes Node syntax check | `node --check src/main/main.js` | (per 01-06 SUMMARY: passes) | PASS (from plan summary; not re-run here) |
| keyboardLockdown.js exports expected symbols | static inspection of module.exports line 93 | exports `attachLockdown, reservedShortcuts, SUPPRESS_LIST, canonical` | PASS |
| SUPPRESS_LIST contains all 6 SHELL-04 chords | grep `src/main/keyboardLockdown.js:32-51` | Alt+F4, Alt+Tab, F11, Escape, Ctrl+w/W present; bare Meta handled line 81-84 | PASS |
| package.json Electron version matches PROJECT.md pin | read package.json | `"electron": "~41.1.1"` ✓ | PASS |
| electron-store NOT in dependencies (CJS concern not yet introduced) | read package.json | Only `electron-log` in deps (correct for Phase 1) | PASS |
| `dist/win-unpacked/Bee Strong POS.exe` present (plan 01-04 artifact) | `ls dist/win-unpacked/` | Bee Strong POS.exe + Chromium files listed | PASS |
| No TODO/FIXME/placeholder in src/ | Grep across src/ | No matches | PASS |
| Live `canonical()` probe for 6 required SHELL-04 chords | per PHASE-01-ACCEPTANCE.md:88-101 | All 6 SUPPRESSED | PASS |
| Live window first paint (no white flash) | interactive npm start | — | HUMAN |
| Double-launch race produces single window + log line | interactive two-process npm start | — | HUMAN |
| Prod-sim chord test (Alt+F4 etc.) on running window | interactive `NODE_ENV= electron .` | — | HUMAN |
| On-device `05-verify-lockdown.ps1` all PASS | physical maintenance visit | — | HUMAN |

### Requirements Coverage

| Requirement | Source Plan | Description | Status | Evidence |
|---|---|---|---|---|
| SHELL-01 | 01-02 | Fullscreen kiosk, no chrome/menu/tray | SATISFIED (structural) + HUMAN live | main.js:21-39 + Menu.setApplicationMenu(null) line 42 |
| SHELL-02 | 01-03 | Single-instance lock | SATISFIED (structural) + HUMAN race | main.js:90-95 |
| SHELL-03 | 01-03 + 01-04 | Auto-start (runtime + install) | SATISFIED | main.js:106-112 (runtime) + build/installer.nsh (install-time) |
| SHELL-04 | 01-03 | Keyboard escape suppression | SATISFIED (static + probe) + HUMAN live chord | keyboardLockdown.js:32-89 + live canonical() probe |
| SHELL-05 | 01-05 | Windows hardening runbook | SATISFIED (artifacts) + HUMAN on-device | 8 files in docs/runbook/ |
| SHELL-06 | 01-02 | Branded splash, no flash | SATISFIED (structural) + HUMAN visual | backgroundColor + show:false + ready-to-show + ipcMain-only dismiss |

No orphaned requirements. No ROADMAP requirements unclaimed by any plan.

### Anti-Patterns Found

| File | Line | Pattern | Severity | Impact |
|---|---|---|---|---|
| — | — | No TODO/FIXME/placeholder found | — | Clean |

**Informational notes** (not blockers, not regressions):
- `Ctrl+Shift+W` is not in SUPPRESS_LIST — documented in PHASE-01-ACCEPTANCE.md Open Issues as informational, NOT a SHELL-04 requirement (Ctrl+W lowercase IS suppressed). Acceptable.
- Default Electron icon still used (tracked baseline for Phase 5 BRAND-01).
- `DEP0190` electron-builder deprecation warning (tracked baseline for Phase 5 BRAND-01).
- `reservedShortcuts` Set exported empty — correct for Phase 1; Phase 5 ADMIN-01 will `.add('Ctrl+Shift+F12')`.

### Human Verification Required (Next Kiosk Visit — consolidated batch)

**This is the single source-of-truth checklist for the next physical kiosk visit.** Phase 3 (03-09 TabTip manual-button re-check) and Phase 4 (7 idle requirements, post NFC descope) have been folded into this file so the tester works through one document, not three. **2026-04-14: NFC-01..06 DESCOPED** (quick 260414-eu9) — the Phase 4 section dropped from 13 to 7 rows.

#### Phase 1 — Original deferred items

1. **`npm start` visual checkpoint** — Dev window 420x800, #1A1A1A, dark logo, pulsing bar, "BITTE WARTEN…", DevTools detached, no white flash on first paint.
2. **Splash permanence** — Leave splash visible 10+ s without any Phase 2 injection; confirm it does NOT auto-lift.
3. **Double-launch race** — Second `npm start` exits ~1 s with no second window; `main.log` contains `second instance detected — exiting silently (D-05)`.
4. **Prod-sim chord test** — `NODE_ENV= electron .`; Alt+F4/F11/Escape/Ctrl+W do not close or unfullscreen. Exit via Task Manager.
5. **On-device runbook** — Physical maintenance visit: run 01..05 scripts, then `05-verify-lockdown.ps1`, then walk `BREAKOUT-CHECKLIST.md`.

#### Phase 3 — Deferred soft re-check (added 2026-04-10 via 03-09)

- [ ] **TabTip manual-button path re-verified on production kiosk hardware** — proxy box DESKTOP-P1E98A1 confirmed `C:\Program Files\Common Files\microsoft shared\ink\TabTip.exe` launches on manual invoke (no auto-invoke). Repeat on the actual Bee Strong POS terminal to catch any Windows 11 Pro vs Windows 10 drift in the TabTip path.

#### Phase 4 — Deferred Physical Verification (added 2026-04-10)

**Reason:** Kiosk hardware not at hand at phase 4 close; Deka NFC reader has never been physically validated. Automated test coverage is 100% (102/102 green across Phase 4 + harness).

**Authoritative per-requirement spec:** `.planning/phases/04-nfc-input-idle-session-lifecycle/04-VERIFICATION.md` (expected-behavior text, PASS conditions, FAIL conditions, log-line assertions for each row).

**NFC requirements:** DESCOPED 2026-04-14 (quick 260414-eu9). NFC-01..06 are no longer part of v1.0 — member identification at the kiosk is not performed; the card terminal next to the kiosk handles payment. HID-wedge keystrokes still work: they land in the Magicline product-search input (focused on cash-register-ready) so staff can still scan product barcodes during a session. See `.planning/MILESTONES.md` Post-ship scope adjustment section for the full rationale.

**Idle/lifecycle requirements (touchscreen + Task Manager required):**

- [ ] **IDLE-01** — 60s idle → branded overlay visible with German copy ("Noch da?" / "SEKUNDEN" / "Weiter") + 80px yellow countdown at 30s
- [ ] **IDLE-02** — Tap mid-countdown dismisses overlay, cart + customer state preserved
- [ ] **IDLE-03** — Countdown expire → splash → clean cash register (no prior member, no cart)
- [ ] **IDLE-04** — Second manual idle reset +90s passes cleanly (harness already covers 100-cycle stress in `test/sessionReset.harness.js`)
- [ ] **IDLE-05** — 3 renderer kills in 60s → reset-loop branded error ("Kiosk muss neu gestartet werden") → admin PIN → `app.relaunch()` (**RUN THIS LAST** — disruptive, leaves kiosk in loopActive=true until PIN flow relaunches)
- [ ] **IDLE-06** — "Jetzt verkaufen" click → customer-search input cleared 3s later; sale retained in Magicline history
- [ ] **IDLE-07** — Single renderer kill → `magicline.render-process-gone` → splash → clean re-login (no reset-loop trip on first kill)

**Log spot-checks to validate in `%AppData%\Bee Strong POS\logs\main.log`:**

- `idleTimer.state: IDLE -> OVERLAY_SHOWING reason=timeout`
- `idleTimer.state: OVERLAY_SHOWING -> IDLE reason=dismissed`
- `sessionReset.hardReset: reason=idle-expired count=1`
- `sessionReset.hardReset: reason=crash count=1`
- `sessionReset.loop-detected: count=3 reasons=[...]`
- `magicline.render-process-gone: {"reason":"killed",...}`

**Privacy requirement:** Use the **staging test badge only**, tied to a staging-account member. If any real member data appears in a failure log excerpt, redact before committing the filled-in checklist. No real badge numbers, no real member names in git.

**IDLE-05 ordering constraint:** IDLE-05 MUST be the last Phase 4 item executed in the visit. It intentionally trips the reset-loop guard and only recovers via the admin-PIN-driven `app.relaunch()` path — running it mid-checklist leaves the device unusable for subsequent rows.

#### Phase 5 — Deferred Physical Verification (added 2026-04-10)

**Reason:** Kiosk hardware not at hand at phase 5 close. Automated test coverage is 100% (265/265 green), 11/11 Phase 5 requirements (ADMIN-01..08 + BRAND-01..03) structurally verified in code, 10/10 code review findings fixed. These 30 rows require the physical kiosk terminal with Deka NFC reader, vertical touchscreen, Windows kiosk user, and real GitHub Releases + PAT.

**Source of truth:** `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` (rows reproduced inline below for single-doc workflow).

##### Admin Hotkey + PIN + Lockout (ADMIN-01, ADMIN-02, ADMIN-03)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-01 | Press `Ctrl+Shift+F12` on the running kiosk | Branded PIN modal opens (not DevTools, not Chrome menu) | [ ] |
| P5-02 | Enter correct admin PIN | Admin menu opens with 5 diagnostic rows (Version, Letztes Update, Status, Letzter Reset, Auto-Update) and 6 buttons in safe→destructive order | [ ] |
| P5-03 | Tap "Updates prüfen" | Inline result appears: "Aktuell" or "Update verfügbar — wird bei nächster Ruhepause installiert"; auto-hides after 5 s | [ ] |
| P5-04 | Tap "Protokolle anzeigen" | Windows Explorer opens to `%AppData%\Bee Strong POS\logs\`; close Explorer to return to kiosk | [ ] |
| P5-05 | Tap "Kasse nachladen" | Magicline view reloads; kiosk transitions BOOTING → CASH_REGISTER_READY | [ ] |
| P5-06 | Tap "Anmeldedaten ändern" | Credentials overlay appears in re-entry mode (no PIN setup fields) | [ ] |
| P5-07 | Enter 5 wrong PINs in under 60 s | On the 5th wrong attempt, lockout panel replaces keypad with live mm:ss countdown and "Zu viele Versuche — bitte warten" | [ ] |
| P5-08 | Wait until countdown reaches 00:00 | Keypad re-appears automatically; correct PIN on next try opens admin menu | [ ] |
| P5-09 | During lockout, press `Ctrl+Shift+F12` again | PIN modal stays open; countdown does NOT reset or duplicate | [ ] |

##### Logging (ADMIN-04, ADMIN-05)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-10 | Open `%AppData%\Bee Strong POS\logs\main.log` over RDP after a day of use | Lines for `event=startup`, `event=auth.state`, `event=idle.reset`, `event=badge.scanned`, `event=sale.completed` present | [ ] |
| P5-11 | `grep` the log directory for 10+ digit badge numbers | ZERO matches — only 8-hex sha256 prefixes should appear (e.g. `badge=a3f7c2b1`) | [ ] |
| P5-12 | `grep` the log directory for `password=` | Every hit is `password=***` (never plaintext) | [ ] |
| P5-13 | `grep` the log directory for PAT values starting with `ghp_` | Zero matches — PAT field must render as `pat=[cipher:N]` | [ ] |
| P5-14 | Force log rotation (>5 MB to main.log) | Exactly `main.log` + `main.1.log` through `main.5.log` = 6 files max; `main.6.log` must NOT exist | [ ] |

##### Auto-Update + Safe Window (ADMIN-06, ADMIN-07)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-15 | Fresh install, no PAT configured | Kiosk boots normally; admin header shows "Auto-Update: nicht konfiguriert"; no GitHub calls in logs | [ ] |
| P5-16 | Enter valid PAT via "Auto-Update einrichten" screen | `update.check` log line appears; header flips to "aktiv" | [ ] |
| P5-17 | Enter invalid PAT | Inline error surfaces via `show-admin-update-result`; admin menu does NOT lose state | [ ] |
| P5-18 | Publish a new tagged GitHub release while kiosk is running | Within 6 hours (or on next `Updates prüfen`), `update.downloaded` appears; no visible UI change until safe window | [ ] |
| P5-19 | Trigger an idle-expiry hard reset after update-downloaded | `update.install` with `trigger=post-reset` logs; updating cover visible; new version boots | [ ] |
| P5-20 | Alternatively wait until 03:00–05:00 window after a downloaded update | `update.install` with `trigger=maintenance-window` logs; new version boots | [ ] |

##### Update Failure + Rollback (ADMIN-08)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-21 | Install a deliberately broken release (fails to reach CASH_REGISTER_READY) | 2-minute watchdog expires; `update.failed` with `reason=watchdog-expired` logs; bad-release variant shows "Update fehlgeschlagen — bitte Studio-Personal verständigen" | [ ] |
| P5-22 | On bad-release screen, tap "PIN eingeben" → enter PIN | Admin menu opens; staff can view logs + exit to Windows for manual NSIS re-install | [ ] |
| P5-23 | After bad-release: reboot kiosk | `autoUpdateDisabled` latched; header shows "Auto-Update: deaktiviert"; no automatic re-attempt | [ ] |
| P5-24 | Simulate an NSIS install-time failure | `update-failed` variant appears for 10 s with "Aktualisierung fehlgeschlagen — erneuter Versuch beim nächsten Neustart"; auto-dismisses; kiosk continues on old version | [ ] |

##### Branded Polish (BRAND-01, BRAND-02, BRAND-03)

| # | Action | Expected | Status |
|---|--------|----------|--------|
| P5-25 | Visual inspection of admin menu on the vertical touchscreen | Logo centered, yellow (`#F5C518`) accents, dark (`#1A1A1A`) background, readable at arm's length | [ ] |
| P5-26 | Tap every admin menu button with a fingertip (not stylus) | Each button registers the tap on first try; no mis-taps due to under-size targets | [ ] |
| P5-27 | Visual inspection of updating cover during a real update | Logo + rotating spinner + "Aktualisierung läuft" + subtext; no Magicline chrome bleed-through | [ ] |
| P5-28 | Visual inspection of Magicline content area after all Phase 5 changes | Magicline colors, fonts, and layout unchanged from Phase 4 baseline (BRAND-03 guard) | [ ] |
| P5-29 | Visual inspection of PAT config screen | Masked input, disabled Speichern until non-empty input, German hint text visible | [ ] |
| P5-30 | Visual inspection of PIN lockout countdown | 48 px yellow mm:ss, non-jittering (tabular-nums), readable at 60–80 cm | [ ] |

**Phase 5 ordering constraint:** Run P5-21..P5-24 (rollback drill) LAST among Phase 5 rows — it intentionally installs a broken build and latches `autoUpdateDisabled`. Subsequent automated-update rows cannot execute after it without resetting the flag.

#### Phase 6 — Welcome Loop Physical Verification (1) (added 2026-04-13)

**Reason:** Phase 6 replaced the in-place idle-reset re-login with a welcome-screen bookended lifecycle (`cold boot → welcome → tap → register → 60s idle → 10s "Noch da?" → logout → welcome`). Automated coverage is 100% (286/286 green including the new 5-cycle welcome harness `test/sessionReset.welcome-harness.test.js`), but the end-to-end kiosk-hardware regression test must be re-run on the production terminal to confirm the 2026-04-12 third-cycle stale-session bug no longer reproduces.

**Authoritative per-requirement spec:** `.planning/phases/06-welcome-screen-lifecycle-redesign/06-VERIFICATION.md`.

- [ ] **Phase 6 welcome-loop smoke** — on a fresh kiosk cold boot:
  1. Splash → welcome layer appears with "Zum Kassieren tippen" copy in brand yellow (`#F5C518`) on `#1A1A1A`. Magicline view is NOT pre-warmed in the background.
  2. Tap the welcome layer → splash loading cover → Magicline cash register renders within ~5s (first-tap pays the full login latency, per D-03).
  3. Wait 60s without interaction → "Noch da?" overlay appears with countdown starting at **"10"** (not "30" — D-04).
  4. Let the 10s countdown expire without tapping → overlay dismisses → brief splash → welcome layer reappears (welcome:show emitted by `sessionReset.js` welcome branch; Magicline view stays destroyed).
  5. Tap welcome again → fresh login → clean cash register (no cart bleed, no prior customer, no stale-session error page).
  6. **Repeat steps 2–5 FIVE times consecutively.** Expected: every cycle lands on a clean cash register; the "Kiosk muss neu gestartet werden" reset-loop error screen is NEVER shown (D-06 excludes welcome logouts from the 3-in-60s loop counter).
  7. ~~Optional (Deka reader connected): scan a staging badge while the welcome layer is visible → expect **no effect**~~ **N/A under NFC descope (2026-04-14):** the badge input path is removed entirely.

  **Pass criteria:** 5/5 cycles clean, no error screens, cart never persists across cycles, countdown starts at 10.

**Total next-visit items added for Phase 6: 1** (this single consolidated welcome-loop row covers IDLE-01..05 and AUTH-01..04 in one walk-through — see 06-VERIFICATION.md Acceptance Matrix for the per-requirement mapping. NFC-05 facet DESCOPED 2026-04-14 with the rest of NFC-01..06).

### Gaps Summary

**No code/config gaps.** Every SHELL-01..06 requirement has a concrete implementation in the codebase, wired through the expected data path, with no stubs, fabricated claims, or shortcuts around D-03 (splash permanence) or D-06 (correct Phase 1 end state).

The Phase 1 acceptance document (`docs/runbook/PHASE-01-ACCEPTANCE.md`) correctly demarcates four items as PENDING-HUMAN rather than fabricating passes — this is honest scope handling and aligns with the plan's `autonomous: false` flag. The executor did NOT claim any PASS it could not mechanically confirm.

**Phase 1 is structurally shippable. Final PASS requires the 4 interactive owner checkpoints + the on-device runbook execution, all of which are explicitly documented in PHASE-01-ACCEPTANCE.md and 01-06-SUMMARY.md as out-of-session work.**

## Final Verdict

**PHASE PASS WITH HUMAN CHECKPOINTS**

- All 6 SHELL requirements are structurally satisfied by real code and real runbook artifacts.
- All wiring is correct (main ↔ lockdown ↔ preload ↔ host; splash dismiss path is single-source IPC per D-03).
- No fabricated claims, no stubs, no regressions between plans.
- 4 interactive checkpoints + 1 physical-device runbook execution remain — explicitly documented in PHASE-01-ACCEPTANCE.md and acceptable under the plan's `autonomous: false` contract.

Proceed to Phase 2 after the owner completes the 01-06 checkpoints (items 1–4 above). Item 5 (on-device runbook) may be deferred to the next physical maintenance visit and does not block Phase 2 development work on the developer machine.

---

*Verified: 2026-04-08T20:30:00Z*
*Verifier: Claude (gsd-verifier)*
