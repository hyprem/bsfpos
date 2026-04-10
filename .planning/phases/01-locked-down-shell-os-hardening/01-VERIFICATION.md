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

**This is the single source-of-truth checklist for the next physical kiosk visit.** Phase 3 (03-09 TabTip manual-button re-check) and Phase 4 (all 13 NFC + idle requirements) have been folded into this file so the tester works through one document, not three.

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

**NFC requirements (Deka USB HID + test badge required):**

- [ ] **NFC-01** — First scan after cold boot writes to customer-search input (member name visible within 1s; no first-character drop)
- [ ] **NFC-02** — Rapid 5-badge burst de-bounces correctly, all 5 commit, no stuck buffer
- [ ] **NFC-03** — First-character-drop regression fixed (sentinel-null arbitration) — scan immediately after a 90s idle-expired hard reset
- [ ] **NFC-04** — Badge input triggers Magicline React state update (MUI React-native value setter + input/change dispatch)
- [ ] **NFC-05** — Badge scanned while idle overlay visible is absorbed as dismiss, never leaks to customer field
- [ ] **NFC-06** — Badge scan during product-search focus passes through to product-search, bypasses coalesce buffer

**Idle/lifecycle requirements (touchscreen + Task Manager required):**

- [ ] **IDLE-01** — 60s idle → branded overlay visible with German copy ("Noch da?" / "SEKUNDEN" / "Weiter") + 80px yellow countdown at 30s
- [ ] **IDLE-02** — Tap mid-countdown dismisses overlay, cart + customer state preserved
- [ ] **IDLE-03** — Countdown expire → splash → clean cash register (no prior member, no cart)
- [ ] **IDLE-04** — Second manual idle reset +90s passes cleanly (harness already covers 100-cycle stress in `test/sessionReset.harness.js`)
- [ ] **IDLE-05** — 3 renderer kills in 60s → reset-loop branded error ("Kiosk muss neu gestartet werden") → admin PIN → `app.relaunch()` (**RUN THIS LAST** — disruptive, leaves kiosk in loopActive=true until PIN flow relaunches)
- [ ] **IDLE-06** — "Jetzt verkaufen" click → customer-search input cleared 3s later; sale retained in Magicline history
- [ ] **IDLE-07** — Single renderer kill → `magicline.render-process-gone` → splash → clean re-login (no reset-loop trip on first kill)

**Log spot-checks to validate in `%AppData%\Bee Strong POS\logs\main.log`:**

- `badgeInput.commit: length=N` (length only — badge content must NEVER appear)
- `idleTimer.state: IDLE -> OVERLAY_SHOWING reason=timeout`
- `idleTimer.state: OVERLAY_SHOWING -> IDLE reason=dismissed`
- `sessionReset.hardReset: reason=idle-expired count=1`
- `sessionReset.hardReset: reason=crash count=1`
- `sessionReset.loop-detected: count=3 reasons=[...]`
- `magicline.render-process-gone: {"reason":"killed",...}`

**Privacy requirement:** Use the **staging test badge only**, tied to a staging-account member. If any real member data appears in a failure log excerpt, redact before committing the filled-in checklist. No real badge numbers, no real member names in git.

**IDLE-05 ordering constraint:** IDLE-05 MUST be the last Phase 4 item executed in the visit. It intentionally trips the reset-loop guard and only recovers via the admin-PIN-driven `app.relaunch()` path — running it mid-checklist leaves the device unusable for subsequent rows.

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
