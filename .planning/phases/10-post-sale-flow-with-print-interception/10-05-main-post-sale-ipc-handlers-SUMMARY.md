---
phase: 10-post-sale-flow-with-print-interception
plan: 05
subsystem: main-ipc
tags: [main, ipc-handlers, idle-timer, dedupe-flag, audit, phase-10, sale-01, d-12, d-19, d-20]

# Dependency graph
requires:
  - phase: 10-post-sale-flow-with-print-interception
    plan: 01
    provides: "sessionReset countable-filter exclusion for reason==='sale-completed' — hardReset({reason:'sale-completed'}) no longer trips loop guard"
  - phase: 10-post-sale-flow-with-print-interception
    plan: 02
    provides: "preload surface (onShowPostSale, onHidePostSale, notifyPostSaleNextCustomer, notifyPostSaleAutoLogout) — post-sale:next-customer / post-sale:auto-logout fire into ipcMain handlers installed here; post-sale:hide has a live subscriber"
  - phase: 06-welcome-screen-lifecycle-redesign
    provides: "mode:'welcome' hardReset semantics (full-wipe + welcome:show) consumed by auto-logout handler"
provides:
  - "postSaleShown module-scoped dedupe flag (D-12) — declared, set in startPostSaleFlow, cleared in onPreReset and post-sale:next-customer handler"
  - "startPostSaleFlow({trigger}) helper — encapsulates idle-timer stop + post-sale:show IPC send + flag set + log.audit('post-sale.shown', {trigger})"
  - "ipcMain.on('post-sale:trigger') — dedupe-gated relay from magiclineView.js console-message listener (Plan 04 sender)"
  - "ipcMain.on('post-sale:next-customer') — clears flag, restarts idle timer, audits post-sale.dismissed via=next-customer"
  - "ipcMain.on('post-sale:auto-logout') — calls sessionReset.hardReset({reason:'sale-completed', mode:'welcome'}), audits post-sale.dismissed via=auto-logout"
  - "onPreReset extension — force-hides post-sale overlay via post-sale:hide IPC when postSaleShown===true before a reset executes (D-19 lone sender)"
affects:
  - "phase-10 plan 04 (magiclineView console-message relay — post-sale:trigger has a live handler)"
  - "phase-10 plan 07 (host.js overlay lifecycle — post-sale:show has a live sender, post-sale:hide channel has an authoritative sender)"
  - "phase-10 plan 09 (updateGate composition — post-sale:auto-logout path invokes hardReset sale-completed which fires onPostReset per D-18)"

# Tech tracking
tech-stack:
  added: []
  patterns:
    - "Lazy require inside handler body for idleTimer and sessionReset (matches existing Phase 5 convention in sessionReset.js)"
    - "ipcMain.removeAllListeners guard before every ipcMain.on registration (matches Phase 5 audit-sale-completed + Phase 07 register-selected pattern)"
    - "Module-scoped boolean dedupe flag with three-point lifecycle (declare → set in helper → clear in dismiss path + onPreReset) — generalizes Phase 07 welcomeTapPending pattern"
    - "Single-sender authority model for force-hide IPC (post-sale:hide only sent from onPreReset when overlay is still visible) — D-19 design_notes rationale"

key-files:
  created: []
  modified:
    - src/main/main.js

key-decisions:
  - "D-12 dedupe flag executed verbatim — set to true inside startPostSaleFlow, cleared on both hard-reset onPreReset and explicit next-customer dismiss. Zero overhead on trigger path (simple boolean check)."
  - "D-19 single-sender design applied — post-sale:hide channel has exactly one ipcMain sender (in onPreReset, guarded by postSaleShown). Host-initiated dismiss paths (button tap, countdown expiry) hide locally; no redundant round-trip IPC."
  - "Canonical audit taxonomy per RESEARCH §5 — log.audit('post-sale.shown', {trigger}) and log.audit('post-sale.dismissed', {via}). Field values 'print-intercept' / 'cart-empty-fallback' / 'next-customer' / 'auto-logout' — pass through the unredacted-string path (not in logger.js redaction allowlist)."
  - "Lazy require pattern preserved for both ./idleTimer and ./sessionReset — matches existing handler conventions in main.js and prevents circular-dep load-time crashes."

patterns-established:
  - "Phase 10 post-sale orchestration block — helper + three handlers live as one contiguous block inserted between the existing Phase 07 register-selected handler and the Phase 2 Magicline view init comment, so the full flow can be grep-located via 'Phase 10 SALE-01' marker."
  - "Post-sale flag lifecycle diagram in code comments — every site that touches postSaleShown has a cross-reference to its counterpart (declare ↔ set ↔ dual clear), making the dedupe contract self-documenting."

requirements-completed: [SALE-01]  # Partially — SALE-01 also spans plans 03, 04, 06, 07, 08, 09, 10; orchestration hub closed here

# Metrics
duration: ~3 min
completed: 2026-04-23
---

# Phase 10 Plan 05: Main.js Post-Sale IPC Handlers Summary

**Post-sale orchestration hub wired in main.js — one module-scoped dedupe flag, one helper, three IPC handlers, and a one-line onPreReset extension that doubles as the lone sender of the D-19 post-sale:hide channel. 115 additive lines, zero existing handler touched.**

## Performance

- **Duration:** ~3 min
- **Started:** 2026-04-23T08:23:41Z
- **Completed:** 2026-04-23T08:26:02Z
- **Tasks:** 1
- **Files modified:** 1

## Accomplishments

- Declared `postSaleShown` module-scoped dedupe flag at line 48 (immediately after existing `welcomeTapPending`). Set in `startPostSaleFlow`, cleared in `onPreReset` AND in the `post-sale:next-customer` handler.
- Added `startPostSaleFlow({trigger})` helper (line 441) encapsulating the three-step trigger sequence: set flag → stop idle timer → send `post-sale:show` → audit `post-sale.shown`. Lazy-requires `./idleTimer` with fallback swallow.
- Registered `ipcMain.on('post-sale:trigger')` (line 461) as the dedupe-gated relay from Plan 04's magiclineView console-message listener. Reject path logs `phase10.post-sale:trigger.ignored reason=already-shown` at info level (not warn — dual-fire is the expected happy path when print + cart-empty both fire in the same sale cycle).
- Registered `ipcMain.on('post-sale:next-customer')` (line 480) to clear the flag, lazy-require `./idleTimer` and call `.start()`, then audit `post-sale.dismissed` with `via:'next-customer'`.
- Registered `ipcMain.on('post-sale:auto-logout')` (line 497) to audit `post-sale.dismissed` with `via:'auto-logout'` then lazy-require `./sessionReset` and call `hardReset({reason:'sale-completed', mode:'welcome'})`. `postSaleShown` is implicitly cleared by the onPreReset hook during hardReset execution.
- Extended existing `onPreReset` callback (line 560-587) to (a) send `post-sale:hide` to the host IFF `postSaleShown===true` at reset time — the authoritative D-19 sender — and (b) clear `postSaleShown`. `welcomeTapPending = false;` and the `healthWatchdogTimer`/`authPollTimer` block preserved byte-for-byte.
- Each `ipcMain.on` preceded by `ipcMain.removeAllListeners(...)` guarding against hot-reload double-registration — matches the Phase 5 `audit-sale-completed` and Phase 07 `register-selected` convention.
- All audit field values pass through logger.js unredacted (confirmed against `redactValue` allowlist per RESEARCH §5).

## Task Commits

Each task was committed atomically:

1. **Task 1: Add postSaleShown flag, startPostSaleFlow helper, post-sale:hide sender in onPreReset, and three new IPC handlers** — `45ba282` (feat)

## Files Created/Modified

- `src/main/main.js` — +115 lines, -0 lines. Three additive insertions:
  - **Change A (+5 lines at line 44-48):** `postSaleShown` flag declaration with 4-line comment block, placed immediately after the existing `welcomeTapPending` at line 42.
  - **Change B (+19 lines inside existing onPreReset callback at lines 564-582):** Guarded `post-sale:hide` send (9 lines: 6-line comment + `if (postSaleShown) { try { ... } catch {} }` block) followed by `postSaleShown = false;` with a 2-line comment. Inserted between the existing `welcomeTapPending = false;` clear and the `healthWatchdogTimer`/`authPollTimer` block — neither of those is modified.
  - **Change C (+91 lines at lines 416-506):** Block-header comment, `startPostSaleFlow` helper, three `ipcMain.on` handlers each with `removeAllListeners` guard and explanatory comment. Inserted between the existing `ipcMain.on('register-selected', ...)` handler (ends line 414) and the `// --- Phase 2: Magicline child view + injection pipeline` comment (now at line 508).

## Exact Before/After Diff

### Change A — `postSaleShown` flag declaration (after line 42)

**Before:**
```javascript
// Phase 07 SPLASH-01: true between welcome:tap and splash:hide-final (or 5.5s timeout,
// owned by Plan 05 host-side). Gates forwarding of register-selected so that
// cold-boot / idle-recovery paths are not affected by the new sentinel.
let welcomeTapPending = false;

const isDev = process.env.NODE_ENV === 'development';
```

**After:**
```javascript
// Phase 07 SPLASH-01: true between welcome:tap and splash:hide-final (or 5.5s timeout,
// owned by Plan 05 host-side). Gates forwarding of register-selected so that
// cold-boot / idle-recovery paths are not affected by the new sentinel.
let welcomeTapPending = false;

// Phase 10 D-12: dedupe flag that gates both post-sale triggers (print-intercept
// primary + cart-empty-fallback). Set true when startPostSaleFlow runs; cleared
// on post-sale:next-customer and on every hard reset (onPreReset callback).
// Prevents double-show when both triggers fire within the same sale cycle.
let postSaleShown = false;

const isDev = process.env.NODE_ENV === 'development';
```

### Change B — onPreReset extension (inside existing callback)

**Before (lines 464-473 pre-edit):**
```javascript
sessionResetMod.onPreReset(() => {
  // Phase 07 SPLASH-01: clear welcomeTapPending on any hard reset so a
  // stale flag from a mid-flow reset does not gate the next welcome path.
  welcomeTapPending = false;
  if (healthWatchdogTimer || authPollTimer) {
    log.info('phase5.healthWatchdog.cleared-before-reset');
    if (healthWatchdogTimer) { clearTimeout(healthWatchdogTimer); healthWatchdogTimer = null; }
    if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
  }
});
```

**After (lines 560-589 post-edit):**
```javascript
sessionResetMod.onPreReset(() => {
  // Phase 07 SPLASH-01: clear welcomeTapPending on any hard reset so a
  // stale flag from a mid-flow reset does not gate the next welcome path.
  welcomeTapPending = false;
  // Phase 10 D-12 + D-19: if the post-sale overlay is currently showing and
  // a hard reset is about to execute (admin-initiated or idle-triggered),
  // force-hide it first so the user sees a clean welcome transition rather
  // than a flash of stale post-sale UI. This is the ONE AND ONLY sender of
  // the post-sale:hide IPC channel (D-19) — see <design_notes> in this plan.
  // Host-initiated dismiss paths (button tap, countdown expiry) hide locally
  // and do NOT trigger this send.
  if (postSaleShown) {
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('post-sale:hide');
      }
    } catch (e) {
      log.error('phase10.onPreReset.post-sale:hide send failed: ' + (e && e.message));
    }
  }
  // Phase 10 D-12: same rationale as welcomeTapPending — clear stale dedupe
  // flag on any hard reset so the next sale cycle can re-trigger the overlay.
  postSaleShown = false;
  if (healthWatchdogTimer || authPollTimer) {
    log.info('phase5.healthWatchdog.cleared-before-reset');
    if (healthWatchdogTimer) { clearTimeout(healthWatchdogTimer); healthWatchdogTimer = null; }
    if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
  }
});
```

### Change C — helper + three IPC handlers (lines 416-506)

Inserted after the existing `ipcMain.on('register-selected', ...)` block (ends at line 414) and before the `// --- Phase 2: Magicline child view + injection pipeline` comment (now line 508):

```javascript
  // --- Phase 10 SALE-01: post-sale flow orchestration ----------------------
  // [Full flow documented in 8-step comment block]
  // post-sale:hide IPC (D-19): sent ONLY from onPreReset above when a reset
  // fires while postSaleShown is still true. Host-initiated dismiss paths do
  // NOT send it — they hide locally. See <design_notes> in this plan.

  // Phase 10 D-05/D-12: helper
  function startPostSaleFlow(opts) {
    var trigger = (opts && opts.trigger) || 'unknown';
    postSaleShown = true;
    try { require('./idleTimer').stop(); } catch (_) { /* swallow */ }
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('post-sale:show');
      }
    } catch (e) {
      log.error('phase10.startPostSaleFlow.send failed: ' + (e && e.message));
    }
    try { log.audit('post-sale.shown', { trigger: trigger }); } catch (_) { /* swallow */ }
  }

  // Phase 10 D-12: post-sale:trigger relay from magiclineView.js
  try { ipcMain.removeAllListeners('post-sale:trigger'); } catch (_) {}
  ipcMain.on('post-sale:trigger', function (_ev, payload) {
    try {
      if (postSaleShown) {
        log.info('phase10.post-sale:trigger.ignored reason=already-shown');
        return;
      }
      var trigger = (payload && payload.trigger) || 'unknown';
      startPostSaleFlow({ trigger: trigger });
    } catch (err) {
      log.error('phase10.post-sale:trigger failed: ' + (err && err.message));
    }
  });

  // Phase 10 D-06: next-customer button
  try { ipcMain.removeAllListeners('post-sale:next-customer'); } catch (_) {}
  ipcMain.on('post-sale:next-customer', function () {
    try {
      postSaleShown = false;
      try { require('./idleTimer').start(); } catch (_) {}
      try { log.audit('post-sale.dismissed', { via: 'next-customer' }); } catch (_) {}
    } catch (err) {
      log.error('phase10.post-sale:next-customer failed: ' + (err && err.message));
    }
  });

  // Phase 10 D-20: countdown auto-expiry — hard reset to welcome
  try { ipcMain.removeAllListeners('post-sale:auto-logout'); } catch (_) {}
  ipcMain.on('post-sale:auto-logout', function () {
    try {
      try { log.audit('post-sale.dismissed', { via: 'auto-logout' }); } catch (_) {}
      require('./sessionReset').hardReset({ reason: 'sale-completed', mode: 'welcome' });
    } catch (err) {
      log.error('phase10.post-sale:auto-logout failed: ' + (err && err.message));
    }
  });
```

(Full comment blocks preserved in src; truncated here for summary readability.)

## Line Count Delta

| Section | Before | After | Δ |
|---------|--------|-------|---|
| main.js total | 628 | 743 | +115 |
| `postSaleShown` flag block | 0 | 5 | +5 |
| onPreReset callback body | 10 | 29 | +19 |
| Helper + 3 IPC handlers block | 0 | 91 | +91 |

## IPC Channel Symmetry Audit

All channel names match Plan 02's preload surface and Plan 04's magiclineView relay contract:

| Channel | Direction | Sender (now live) | Receiver | Plan |
|---------|-----------|-------------------|----------|------|
| `post-sale:trigger` | renderer (magiclineView) → main | magiclineView.js console-message relay | `ipcMain.on('post-sale:trigger')` in main.js (this plan) | 04 → 05 |
| `post-sale:show` | main → renderer (host) | `startPostSaleFlow` in main.js (this plan) | `window.kiosk.onShowPostSale(cb)` in preload.js (Plan 02) → host.js (Plan 07) | 05 → 02 → 07 |
| `post-sale:hide` | main → renderer (host) | `onPreReset` in main.js (this plan, ONLY sender) | `window.kiosk.onHidePostSale(cb)` in preload.js (Plan 02) → host.js (Plan 07) | 05 → 02 → 07 |
| `post-sale:next-customer` | renderer (host) → main | `window.kiosk.notifyPostSaleNextCustomer()` in preload.js (Plan 02) → host.js (Plan 07) | `ipcMain.on('post-sale:next-customer')` in main.js (this plan) | 07 → 02 → 05 |
| `post-sale:auto-logout` | renderer (host) → main | `window.kiosk.notifyPostSaleAutoLogout()` in preload.js (Plan 02) → host.js (Plan 07) | `ipcMain.on('post-sale:auto-logout')` in main.js (this plan) | 07 → 02 → 05 |

Every channel has exactly one authoritative sender and one authoritative receiver. Dead-channel risk closed.

## Confirmation — No Existing Handler Modified

Verified by `git diff HEAD~1 -- src/main/main.js` showing only additive insertions:
- `audit-sale-completed` handler (lines 384-389 post-edit, was lines 378-383 pre-edit) — unchanged
- `register-selected` handler (lines 396-414 post-edit, was lines 390-408 pre-edit) — unchanged
- Existing `onPreReset` callback statements (welcomeTapPending clear + healthWatchdogTimer/authPollTimer block) — unchanged
- Second `onPreReset` callback (post-reset re-arm, lines 593-600 post-edit) — unchanged
- Every other `ipcMain.on(...)` in the file — unchanged

## Acceptance Criteria Verification

| Criterion | Status |
|-----------|--------|
| Contains `let postSaleShown = false` | PASSED (line 48) |
| Contains `function startPostSaleFlow(opts)` | PASSED (line 441) |
| Contains `ipcMain.on('post-sale:trigger'` | PASSED (line 461) |
| Contains `ipcMain.on('post-sale:next-customer'` | PASSED (line 480) |
| Contains `ipcMain.on('post-sale:auto-logout'` | PASSED (line 497) |
| Contains `require('./idleTimer').stop()` | PASSED (line 444) |
| Contains `require('./idleTimer').start()` | PASSED (line 483) |
| Contains `require('./sessionReset').hardReset({ reason: 'sale-completed', mode: 'welcome' })` | PASSED (line 500) |
| Contains `log.audit('post-sale.shown', { trigger: trigger })` | PASSED (line 452) |
| Contains `log.audit('post-sale.dismissed', { via: 'next-customer' })` | PASSED (line 484) |
| Contains `log.audit('post-sale.dismissed', { via: 'auto-logout' })` | PASSED (line 499) |
| `grep -c "post-sale:hide" src/main/main.js` >= 1 | PASSED (6 matches — comments + send) |
| `grep -c "mainWindow.webContents.send('post-sale:hide')" src/main/main.js` == 1 | PASSED (1) |
| `post-sale:hide` send wrapped in `if (postSaleShown)` guard in onPreReset | PASSED (line 571) |
| `grep -c "postSaleShown = false" src/main/main.js` >= 3 | PASSED (3: declaration at 48, onPreReset clear at 582, next-customer clear at 482) |
| `grep -c "postSaleShown = true" src/main/main.js` == 1 | PASSED (1: inside startPostSaleFlow at 443) |
| `grep -c "ipcMain.removeAllListeners('post-sale:" src/main/main.js` == 3 | PASSED (3) |
| Each `ipcMain.on('post-sale:...')` preceded by `ipcMain.removeAllListeners` | PASSED (trigger at 460→461, next-customer at 479→480, auto-logout at 496→497) |
| `node --check src/main/main.js` exits 0 | PASSED (SYNTAX OK) |
| Existing `audit-sale-completed` handler unchanged | PASSED (git diff shows no modifications) |
| Existing `register-selected` handler unchanged | PASSED (git diff shows no modifications) |

## Plan 01 Regression Test

`node --test test/sessionReset.test.js` — 32/32 tests pass, 0 fail. No regressions introduced to the D-17/D-18 assertions from Plan 01.

```
ℹ tests 32
ℹ pass 32
ℹ fail 0
```

## Decisions Made

None beyond what the plan specified. All D-decision rationale (D-12 dedupe, D-19 single-sender, D-20 hardReset params, D-06 idle-rearm, canonical audit taxonomy per RESEARCH §5) applied verbatim.

## Deviations from Plan

None - plan executed exactly as written.

The three changes map one-to-one to the plan's Change A / Change B / Change C specification, including the exact comment wording, the `var` vs `let` style choice inside `startPostSaleFlow`, the lazy `require` pattern, the `webContents.isDestroyed()` guard, and the `ipcMain.removeAllListeners` preamble on every handler registration.

---

**Total deviations:** 0
**Impact on plan:** None — plan executed exactly as written, including line delta (+115) and "no existing handler modified" constraint.

## Issues Encountered

None. Single task executed linearly; `node --check` green after each insertion; Plan 01 regression test green on first run.

Note: Read-before-edit advisory reminders fired after each Edit call on main.js. These were advisory — the runtime did not reject any edit because main.js had been Read at session start and re-Read at intermediate offsets before each change-block insertion. All three edits succeeded on first call.

## Next Plan Readiness

Plan 10-05 closes the orchestration-hub gap for the post-sale flow. Downstream consumers can now wire up:

- **Plan 10-04 (magiclineView console-message relay):** READY — `post-sale:trigger` now has a live receiver with the dedupe gate + startPostSaleFlow plumbing in place. Plan 04 can emit `ipcMain.emit('post-sale:trigger', null, {trigger:'print-intercept'|'cart-empty-fallback'})` directly.
- **Plan 10-06 (host HTML/CSS post-sale layer):** READY — unblocked in W2 parallel (no dependency on this plan).
- **Plan 10-07 (host.js overlay lifecycle):** READY — `window.kiosk.onShowPostSale(cb)` has a live main-side sender (`startPostSaleFlow`), `window.kiosk.onHidePostSale(cb)` has a live main-side sender (onPreReset force-hide), and `window.kiosk.notifyPostSaleNextCustomer()` + `window.kiosk.notifyPostSaleAutoLogout()` have live main-side handlers that fulfil the D-06 and D-20 semantics.
- **Plan 10-09 (updateGate composition test):** READY — the auto-logout path calls `hardReset({reason:'sale-completed', mode:'welcome'})` which fires onPreReset (now also sending post-sale:hide) and onPostReset per Plan 01 D-18 verification.

No blockers or concerns. Wave 2 is partially closed (05 done; 04 + 06 remain). Wave 3 (07, 08, 09) is unblocked on main.js dependency.

## User Setup Required

None — no external service configuration required.

## Threat Flags

None — plan 10-05 operates entirely within the trust boundaries enumerated in the plan's threat register (T-10-05-01 through T-10-05-08). No new security-relevant surface introduced beyond the three IPC channels (`post-sale:trigger`, `post-sale:next-customer`, `post-sale:auto-logout`) and one outbound force-hide (`post-sale:hide`), all of which were pre-dispositioned in the threat model. No new file access, no new network surface, no new schema at trust boundaries.

## Self-Check: PASSED

**Created files:** None (plan only modifies existing src/main/main.js)

**Modified files:**
- `src/main/main.js` — FOUND, contains all required substrings (postSaleShown declaration, startPostSaleFlow function, three ipcMain.on handlers, three ipcMain.removeAllListeners guards, onPreReset post-sale:hide send + postSaleShown clear, all audit event strings, hardReset reason/mode params)

**Commits:**
- `45ba282` — FOUND in `git log --oneline` (feat(10-05): wire post-sale orchestration IPC handlers in main.js)

**Syntax check:**
- `node --check src/main/main.js` — SYNTAX OK

**Regression check:**
- `node --test test/sessionReset.test.js` — 32 pass, 0 fail (Plan 01 tests still green)

---
*Phase: 10-post-sale-flow-with-print-interception*
*Plan: 05 — main-post-sale-ipc-handlers*
*Completed: 2026-04-23*
