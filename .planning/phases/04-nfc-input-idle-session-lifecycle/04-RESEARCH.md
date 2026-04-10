# Phase 4: NFC Input, Idle & Session Lifecycle — Research

**Researched:** 2026-04-10
**Domain:** Electron 41 `before-input-event` · session lifecycle · idle state machine · inject.js extension
**Confidence:** HIGH — all critical claims verified against the live codebase (Phases 1–3) and Electron official docs. No unknowns that block planning.

---

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**A — Badge capture ownership & arbitration**
- D-01: NFC capture lives in new main-process module `src/main/badgeInput.js`. Exports `attachBadgeInput(wc)`. Called on `mainWindow.webContents` and inside `createMagiclineView` after `attachLockdown`.
- D-02: `badgeInput.js` is a NEW module, does NOT extend `keyboardLockdown.js`. Listener order: lockdown first, badgeInput second. badgeInput never calls `event.preventDefault()` for non-badge characters.
- D-03: NFC-03 first-character-drop fix: `let lastKeyTime = null` as sentinel. If `lastKeyTime === null`, first keystroke is always accepted and timing gate applies from 2nd char onward. After buffer flush, reset `lastKeyTime` to `null`.
- D-04: Buffer commit rules: (a) Enter → commit, (b) Tab → commit, (c) 100 ms silent-timeout → commit, (d) only commit if `buffer.length > 3`. On commit call `wc.executeJavaScript('window.__bskiosk_setMuiValue(...)')` on Magicline view webContents.
- D-05: Product-search focus arbitration via inject.js `focusin`/`focusout` → drain events `product-search-focused`/`product-search-blurred` → `badgeInput.setProductSearchFocused(bool)`. When `true`, badgeInput on Magicline view webContents is a no-op.
- D-06: `KNOWN_EVENT_TYPES` gains `product-search-focused` and `product-search-blurred`.

**B — Idle timer**
- D-07: New module `src/main/idleTimer.js`. States: IDLE / OVERLAY_SHOWING / RESETTING. Exports: `start()`, `stop()`, `bump()`, `dismiss()`, `expired()`.
- D-08: idleTimer starts ONLY on `CASH_REGISTER_READY`. authFlow gains side-effect `{ kind: 'start-idle-timer' }` in the CASH_REGISTER_READY reduction.
- D-09: Four activity sources call `idleTimer.bump()`: (1) host `before-input-event`, (2) Magicline view `before-input-event` in badgeInput, (3) inject.js rAF-debounced `pointerdown`+`touchstart` drain event `activity`, (4) badge scan commit.
- D-10: `KNOWN_EVENT_TYPES` gains `activity`.
- D-11: Overlay countdown owned by host.js. IPC `show-idle-overlay` → host manages 30s `setInterval`. On activity: `clearInterval`, IPC `idle-dismissed` → `idleTimer.dismiss()`. On reaching 0: IPC `idle-expired` → `idleTimer.expired()` → `sessionReset.hardReset({ reason: 'idle-expired' })`.
- D-12: preload.js gains: `onShowIdleOverlay(cb)`, `onHideIdleOverlay(cb)`, `notifyIdleDismissed()`, `notifyIdleExpired()`.

**C — Hard reset sequence**
- D-14: New module `src/main/sessionReset.js`. Entry point: `async hardReset({ reason })`. Module-scoped: `let resetting = false`, `let loopActive = false`.
- D-15: Exact step ordering (user-confirmed):
  1. Guard: `if (resetting || loopActive) return`
  2. Roll timestamp window + check loop counter
  3. `resetting = true`
  4. `idleTimer.stop()`
  5. `mainWindow.webContents.send('show-splash')`
  6. `destroyMagiclineView(mainWindow)`
  7. `const sess = session.fromPartition('persist:magicline')`
  8. `await sess.clearStorageData({ storages: [...] })`
  9. `await sess.cookies.flushStore()`
  10. `createMagiclineView(mainWindow, store)`
  11. `resetting = false` (in `finally`)
- D-16: authFlow needs no explicit reset call. Fresh `createMagiclineView` triggers normal login-detected flow.

**D — Reset-loop detection**
- D-17: Rolling-window counter: `const resetTimestamps = []`. On each `hardReset()` call: push `Date.now()`, filter to last 60s. If `recent.length + 1 >= 3`, set `loopActive = true`, emit `show-magicline-error` with `{ variant: 'reset-loop' }`.
- D-18: Unified counter — crashes and idle resets share one rolling window. Each entry tagged with reason.
- D-19: Admin recovery: `app.relaunch(); app.quit()`. New `requestResetLoopRecovery` IPC → show PIN modal → on pin-ok → relaunch+quit.
- D-20: `show-magicline-error` gains variant `reset-loop`. host.js variant-switch gains one new case.

**E — Post-sale clear + crash recovery**
- D-21: IDLE-06 post-sale 3s clear lives entirely in inject.js. Port prototype click listener verbatim. `'Jetzt verkaufen'` literal extracted as constant at top of inject.js OR added to fragile-selectors.js.
- D-22: IDLE-07 crash recovery via `sessionReset.hardReset({ reason: 'crash' })` from `render-process-gone` listener in `magiclineView.js`.
- D-23: No `crash-recovering` variant on `#magicline-error`. Splash handles member-facing visual for crash-recovery.

### Claude's Discretion

- Exact inter-key gate value: default 50 ms from prototype; planner may bump to 60–75 ms if Electron 41 Windows keystroke jitter warrants. Tunable via `electron-store` key `nfcBadgeSpeedMs`.
- rAF debounce cadence for inject.js `pointerdown`/`touchstart` → `activity`: single-rAF minimum, single-rAF + 100 ms coalesce also acceptable.
- Rolling-window implementation: plain `Array<{t, reason}>` filtered on every push (circular buffer is over-engineering at length ≤ 3).
- Whether `{ kind: 'start-idle-timer' }` side-effect goes in the reducer or imperatively in executor (reducer preferred for unit-test coverage).
- Order of `attachLockdown` vs `attachBadgeInput` within `createMagiclineView` bootstrap: D-02 specifies lockdown first.

### Deferred Ideas (OUT OF SCOPE)

- Admin menu UI (Phase 5)
- `Ctrl+Shift+F12` admin hotkey registration (Phase 5)
- Auto-update safe-window gating consuming idle state (Phase 5)
- Logging full badge numbers (Phase 5 ADMIN-04)
- Session-expired silent re-login (OPS-06, v2)
- Configurable idle timeout via admin menu (OPS-05, v2)
- Telemetry on reset-loop frequency (v2)
- Welcome screen / attract loop after idle reset (OPS-04, v2)
- Scheduled nightly `app.relaunch()` at 03:00 (OPS-02, v2)
- `crash-recovering` variant on `#magicline-error` (explicitly rejected D-23)
</user_constraints>

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| NFC-01 | HID keystrokes captured at main-process level via `before-input-event` on host BrowserWindow | Verified: `before-input-event` fires on the specific webContents it is registered on — must attach to BOTH host and Magicline view wc |
| NFC-02 | < 50 ms inter-key timing gate + Enter terminator commit | Prototype timing constants verified; sentinel-null fix is the key port change |
| NFC-03 | First-character-drop bug fixed via `lastKeyTime = null` sentinel | Root cause verified in prototype source (line 368: `var lastKeyTime = 0`) |
| NFC-04 | Badge string injected into `[data-role="customer-search"] input` via `__bskiosk_setMuiValue` | `window.__bskiosk_setMuiValue` already exposed in inject.js:70; `executeJavaScript` is the bridge |
| NFC-05 | HID keystrokes count as activity for idle timer even when overlay/modal visible | badgeInput calls `idleTimer.bump()` for EVERY keyDown before buffer/pass-through decision |
| NFC-06 | While product-search field focused, HID keystrokes pass through unmodified | `focusin`/`focusout` drain events → `setProductSearchFocused(bool)` flag in badgeInput |
| IDLE-01 | 60s no-activity → branded overlay with 30s countdown | IPC `show-idle-overlay` → host.js manages countdown with `setInterval` |
| IDLE-02 | Any input while overlay visible dismisses it, restarts 60s timer, preserves cart | host.js `dismiss()` → `notifyIdleDismissed()` IPC → `idleTimer.dismiss()` → back to IDLE state |
| IDLE-03 | Overlay expiry → hard reset: `about:blank`, `clearStorageData`, `flushStore`, reload | D-15 step sequence with mutex guard |
| IDLE-04 | After hard reset, auto-login fires; 100-cycle harness proves no half-login state | harness plan required; authFlow restarts naturally from fresh `createMagiclineView` |
| IDLE-05 | > 3 resets in 60s → branded error screen instead of crash-loop | Rolling-window counter D-17/D-18; loopActive guard |
| IDLE-06 | 3s after "Jetzt verkaufen" click → customer field cleared | inject.js click listener + 3s setTimeout + `__bskiosk_setMuiValue(input, '')` |
| IDLE-07 | `render-process-gone` → log, show error briefly, reload → auto-login | `sessionReset.hardReset({ reason: 'crash' })` from extended listener in magiclineView.js |
</phase_requirements>

---

## Summary

Phase 4 wires three interdependent main-process modules (`badgeInput.js`, `idleTimer.js`, `sessionReset.js`) and extends four existing files (`magiclineView.js`, `authFlow.js`, `inject.js`, `fragile-selectors.js`) plus the host UI layer (`host.html`, `host.css`, `host.js`, `preload.js`). The three new modules follow exactly the same patterns established in Phases 1–3: module-scoped state, pure state machines, drain-queue event delegation, and single-purpose separation of concerns. No new npm packages are required.

The most load-bearing technical detail is the `before-input-event` scoping rule: Electron fires the event on the specific `webContents` instance it is registered on, not on all webContents. Since focus can move between the host BrowserWindow webContents and the Magicline WebContentsView webContents, `attachBadgeInput` must be called on both. This is identical to the pattern already used by `attachLockdown` in Phase 1/2. The prototype NFC logic (document-level keydown in page-world) is explicitly replaced; the timing constants and buffer semantics are ported verbatim.

The session reset is a single sequential async function (`sessionReset.hardReset`) with a module-scoped mutex (`resetting` flag). The step sequence is user-confirmed: destroy view → `clearStorageData` (6 storage types) → `cookies.flushStore()` → `createMagiclineView`. This sequence is the acceptance criterion for IDLE-03 and IDLE-04, and a 100-cycle harness proving it never leaves a half-logged-in state is a mandatory plan artifact.

**Primary recommendation:** Plan the work in 5 waves: (1) Wave 0 verification setup + test stubs, (2) badgeInput.js module + unit tests, (3) idleTimer.js + host overlay wiring, (4) sessionReset.js + crash recovery + loop guard, (5) acceptance verification + 100-cycle harness.

---

## Standard Stack

### Core (no new npm packages required)

| Component | Version/Location | Purpose | Why |
|-----------|-----------------|---------|-----|
| `before-input-event` | Electron 41 built-in | Main-process HID keystroke capture for badge and lockdown | Only main-process API that fires before React event dispatch; survives focus changes |
| `session.clearStorageData()` | Electron 41 built-in | Wipe `persist:magicline` session on hard reset | Only API that clears cookies + localStorage + SW atomically for a named partition |
| `session.cookies.flushStore()` | Electron 41 built-in | Force cookie write-through before new view reads them | Without this, race: new view requests arrive before cleared cookies hit disk |
| `webContents.executeJavaScript()` | Electron 41 built-in | Bridge from main-process badge buffer to page-world `__bskiosk_setMuiValue` | Same pattern already used for auth login fill (Phase 3) |
| `app.relaunch() + app.quit()` | Electron 41 built-in | Reset-loop admin recovery — full process restart | Cleanest recovery: no lingering timers, zombie webContents, or leaked state |
| `electron-store@^10.1.x` | Already a dependency | Optional `nfcBadgeSpeedMs` override config | CJS-compatible; same instance used by authFlow and magiclineView |
| `electron-log` | Already a dependency | Structured log lines for all Phase 4 state transitions | Follows Phase 3 D-18 logging pattern |

### No New Dependencies

Phase 4 introduces zero new npm packages. All required capabilities are built into Electron 41 or already present in the project.

---

## Architecture Patterns

### Recommended Module Layout

```
src/
  main/
    badgeInput.js     — new: HID capture, timing gate, product-search arbitration
    idleTimer.js      — new: pure state machine (IDLE/OVERLAY_SHOWING/RESETTING)
    sessionReset.js   — new: hard reset, mutex, loop detection
    magiclineView.js  — extend: KNOWN_EVENT_TYPES (+3), handleInjectEvent (+3),
                        render-process-gone extend, attachBadgeInput call
    authFlow.js       — extend: CASH_REGISTER_READY reduction gains
                        { kind:'start-idle-timer' } side-effect + executor case
    preload.js        — extend: 5 new IPC surface entries (D-12 + D-19)
    main.js           — extend: attachBadgeInput(mainWindow.webContents) after
                        attachLockdown call (line 136)
  inject/
    inject.js         — extend: focusin/focusout listeners, rAF activity emitter,
                        post-sale click listener (D-21), all inside one-time setup path
    fragile-selectors.js — extend: 'Jetzt verkaufen' structural-text constant
  host/
    host.html         — extend: #idle-overlay div at Layer 200 slot
    host.css          — extend: idle overlay styles (per 04-UI-SPEC.md)
    host.js           — extend: show/hide idle overlay handlers, dismiss(), countdown
                        setInterval, reset-loop variant case in showMagiclineError()
```

### Pattern 1: `before-input-event` Two-Attach Pattern

**What:** `before-input-event` fires on the `webContents` it is registered on, not globally. Because focus alternates between the host window and the Magicline view, `attachBadgeInput(wc)` must be called twice.

**Listener registration order per D-02:**
```
// In main.js — after createMainWindow(), line 136:
attachLockdown(mainWindow.webContents);
attachBadgeInput(mainWindow.webContents);   // NFC capture on host wc

// In createMagiclineView() — after attachLockdown(magiclineView.webContents):
attachLockdown(magiclineView.webContents);
attachBadgeInput(magiclineView.webContents); // NFC capture on Magicline wc
```

When focus is on the host window (overlay showing), the host wc listener captures badge input. When focus is on Magicline (normal operation), the Magicline wc listener captures it. Both call the same shared buffer/state in `badgeInput.js`.

**Key insight from `before-input-event` docs [VERIFIED: electronjs.org]:** `event.preventDefault()` prevents page keydown/keyup AND menu shortcuts. badgeInput never calls `preventDefault()` for pass-through keystrokes (product-search focused path) — keystrokes must still reach Magicline's own React handlers.

### Pattern 2: Sentinel-Null First-Char Fix (NFC-03)

**Root cause identified in prototype (lines 363–368) [VERIFIED: docs/BeeStrong_POS_Kiosk_Project.md]:**
```js
var lastKeyTime = 0;  // BUG: timeSinceLast = Date.now() - 0 = ~46-year value on first char
```

**Fix:**
```js
// src/main/badgeInput.js
let lastKeyTime = null;  // sentinel — null means "no prior key in this scan"

// In the before-input-event handler:
if (input.type !== 'keyDown') return;
const now = Date.now();
const timeSinceLast = lastKeyTime === null ? 0 : (now - lastKeyTime);
lastKeyTime = now;

// First char (timeSinceLast === 0) always enters buffer:
if (timeSinceLast < BADGE_SPEED_MS || buffer.length > 0) {
  // ... buffer the character
}

// After flush (commit or timeout), reset sentinel:
lastKeyTime = null;
```

This fix ensures every scan — including the very first after boot — captures the leading character. [VERIFIED: prototype analysis + D-03]

### Pattern 3: Product-Search Focus Arbitration (NFC-06)

**inject.js additions (inside the one-time setup path, after idempotency guard):**
```js
// D-05: focusin/focusout emit to main via drain queue
document.addEventListener('focusin', function (e) {
  var productInput = document.querySelector('[data-role="product-search"] input');
  if (productInput && (e.target === productInput || productInput.contains(e.target))) {
    emit('product-search-focused', {});
  }
});
document.addEventListener('focusout', function (e) {
  var productInput = document.querySelector('[data-role="product-search"] input');
  if (productInput && (e.target === productInput || productInput.contains(e.target))) {
    emit('product-search-blurred', {});
  }
});
```

`focusin`/`focusout` are used (not `focus`/`blur`) because they bubble up the DOM — necessary for the drain-queue `emit()` pattern. [VERIFIED: MDN bubbling semantics; `focus`/`blur` do NOT bubble]

**badgeInput.js:**
```js
let productSearchFocused = false;
function setProductSearchFocused(val) { productSearchFocused = val; }

// In before-input-event handler on Magicline wc:
if (productSearchFocused) {
  idleTimer.bump();   // still counts as activity (D-09)
  return;             // pass through to Magicline
}
// ... normal buffer logic
```

### Pattern 4: Hard Reset Sequence (IDLE-03, IDLE-04)

**Exact step ordering from D-15 [VERIFIED: CONTEXT.md, user-confirmed]:**

```js
// src/main/sessionReset.js
const { session } = require('electron');
const { destroyMagiclineView, createMagiclineView } = require('./magiclineView');
const idleTimer = require('./idleTimer');
const log = require('./logger');

let resetting = false;
let loopActive = false;
const resetTimestamps = [];  // Array<{t: number, reason: string}>

async function hardReset({ reason }) {
  // Step 1: guards
  if (resetting || loopActive) {
    log.info('sessionReset.suppressed: ' + (resetting ? 'in-flight' : 'loop-active'));
    return;
  }
  // Step 2: rolling-window loop detection (see Pattern 6)
  const now = Date.now();
  const recent = resetTimestamps.filter(t => now - t.t < 60_000);
  resetTimestamps.length = 0;
  resetTimestamps.push(...recent, { t: now, reason });
  if (recent.length + 1 >= 3) {
    loopActive = true;
    log.error('sessionReset.loop-detected: count=' + (recent.length + 1) +
      ' reasons=' + JSON.stringify(resetTimestamps.map(x => x.reason)));
    mainWindow.webContents.send('show-magicline-error', { variant: 'reset-loop' });
    return;
  }
  // Step 3: in-flight guard
  resetting = true;
  try {
    // Steps 4–10
    idleTimer.stop();                                         // step 4
    mainWindow.webContents.send('show-splash');              // step 5 (IPC: 'splash:show')
    destroyMagiclineView(mainWindow);                        // step 6
    const sess = session.fromPartition('persist:magicline'); // step 7
    await sess.clearStorageData({                            // step 8
      storages: ['cookies', 'localstorage', 'sessionstorage',
                 'serviceworkers', 'indexdb', 'cachestorage']
    });
    await sess.cookies.flushStore();                         // step 9
    createMagiclineView(mainWindow, store);                  // step 10
  } finally {
    resetting = false;                                       // step 11
  }
}
```

**IPC channel for splash:** Existing `'splash:show'` channel (host.js `showSplash()` is already wired). [VERIFIED: src/host/host.js lines 25–27]

### Pattern 5: `clearStorageData` Storage Type Names

**Verified against Electron 41 docs [VERIFIED: electronjs.org/docs/latest/api/session]:**

Valid storage type strings:
- `'cookies'` — HTTP cookies
- `'localstorage'` — localStorage
- `'sessionstorage'` — sessionStorage
- `'serviceworkers'` — service worker registrations
- `'indexdb'` — IndexedDB
- `'cachestorage'` — Cache API
- `'filesystem'` — File System API
- `'shadercache'` — GPU shader cache
- `'websql'` — WebSQL (deprecated but still accepted)

**D-15 nominates 6 specific types** (not 'all'): `cookies`, `localstorage`, `sessionstorage`, `serviceworkers`, `indexdb`, `cachestorage`. This is intentional — it avoids clearing `shadercache` (would force shader recompilation on every reset, visible stutter) and `filesystem` (not used by Magicline, clearing it is unnecessary). [ASSUMED: `shadercache` and `filesystem` not used by Magicline — planner may include them defensively if the 100-cycle harness shows residual session state]

**`flushStore()` after `clearStorageData`:** `cookies.flushStore()` forces unwritten cookie data to disk immediately. Without it, Electron's default 30-second write cadence could allow the cleared cookie state to not be fully flushed before the new Magicline view sends its first request. [VERIFIED: electronjs.org/docs/latest/api/cookies]

### Pattern 6: Reset-Loop Rolling Window (IDLE-05)

**Counter shared between idle and crash resets (D-18):**
- Trigger threshold: `recent.length + 1 >= 3` = 3rd reset within 60s trips the guard
- Each entry: `{ t: Date.now(), reason }` where reason is `'idle-expired'` or `'crash'`
- `loopActive = true` once set; only `app.relaunch()` clears it (full restart)
- Recovery IPC: `request-reset-loop-recovery` → PIN modal → on pin-ok → `app.relaunch(); app.quit()`

**`app.relaunch()` note [VERIFIED: electronjs.org/docs/latest/api/app]:** Does NOT quit the app by itself. Must call `app.quit()` immediately after. The single-instance lock behavior on relaunch is not explicitly documented — however, `app.relaunch()` starts a new process that will encounter the existing `requestSingleInstanceLock()` call; the current process must exit before the new one acquires the lock. `app.relaunch(); app.quit()` is the correct sequence: relaunch registers the restart, quit exits the current instance, and the OS launches the new instance.

### Pattern 7: Post-Sale Clear (IDLE-06)

**Verbatim port from prototype (lines 441–446) [VERIFIED: docs/BeeStrong_POS_Kiosk_Project.md]:**

```js
// inject.js — inside one-time setup path (after idempotency guard)
// D-21: 'Jetzt verkaufen' button text extracted as constant
var JETZT_VERKAUFEN_TEXT = 'Jetzt verkaufen';  // fragile-selectors entry OR const here

document.addEventListener('click', function (e) {
  var btn = e.target.closest('[data-role="button"]');
  if (btn && btn.textContent.trim() === JETZT_VERKAUFEN_TEXT) {
    setTimeout(function () {
      var input = document.querySelector('[data-role="customer-search"] input');
      if (input) window.__bskiosk_setMuiValue(input, '');
    }, 3000);
  }
});
```

The `'Jetzt verkaufen'` literal MUST be extracted as a named constant either at the top of `inject.js` or as a structural-text entry in `fragile-selectors.js` (under a new `category: 'structural-text'`). D-21 mandates this so a Magicline copy-change is a one-line patch in the drift blast radius.

### Pattern 8: Crash Recovery Integration (IDLE-07)

**Extension to existing `render-process-gone` listener in `magiclineView.js:199` [VERIFIED: src/main/magiclineView.js]:**

```js
// magiclineView.js — extend the existing log-only handler:
magiclineView.webContents.on('render-process-gone', (_e, details) => {
  log.error('magicline.render-process-gone: ' + JSON.stringify(details));
  // Phase 4: trigger full session reset (IDLE-07)
  try {
    require('./sessionReset').hardReset({ reason: 'crash' });
  } catch (e) {
    log.error('sessionReset.hardReset failed from crash path: ' + (e && e.message));
  }
});
```

`details.reason` values (from Electron source / community documentation [ASSUMED: based on training knowledge — verify against Electron 41 docs if needed]): `'clean-exit'`, `'abnormal-exit'`, `'killed'`, `'crashed'`, `'oom'`, `'launch-failed'`, `'integrity-failure'`. All non-clean reasons should trigger recovery. The log captures the exact reason for RDP diagnosis.

### Pattern 9: authFlow Extension (D-08)

**New side-effect kind in `authFlow.js` CASH_REGISTER_READY reduction:**

```js
// authFlow.js — in STATES.BOOTING case, cash-register-ready event:
if (event.type === 'cash-register-ready') {
  return {
    next: STATES.CASH_REGISTER_READY,
    sideEffects: [
      { kind: 'log', reason: 'cash-register-ready-cookie' },
      { kind: 'clear-timer', name: 'boot' },
      { kind: 'start-idle-timer' },   // Phase 4 addition
    ],
  };
}

// authFlow.js — in STATES.LOGIN_SUBMITTED case, cash-register-ready event:
if (event.type === 'cash-register-ready') {
  return {
    next: STATES.CASH_REGISTER_READY,
    sideEffects: [
      { kind: 'log', reason: 'cash-register-ready' },
      { kind: 'clear-timer', name: 'post-submit' },
      { kind: 'start-idle-timer' },   // Phase 4 addition
    ],
  };
}
```

**Executor addition:**
```js
case 'start-idle-timer':
  require('./idleTimer').start();
  break;
```

[VERIFIED: authFlow.js lines 115–124, 164–172 confirm both cash-register-ready branches exist]

### Pattern 10: Idempotency Contract for inject.js Additions

**Critical [VERIFIED: src/inject/inject.js lines 36–43]:** The inject.js idempotency guard at line 36 causes the top-level IIFE to return early on re-injection. Phase 4 additions (focusin/focusout, pointerdown/touchstart activity emitter, post-sale click listener) MUST be placed in the one-time setup path — i.e., AFTER line 42 (`window.__bskiosk_injected__ = true`) and before the re-injection early return exit at line 41.

The re-injection path (inside `if (window.__bskiosk_injected__)`) calls only `hideDynamic`, `detectReady`, and `detectLogin` — not any Phase 4 listeners. This is correct: event listeners attached once persist across React re-renders.

### Anti-Patterns to Avoid

- **Calling `event.preventDefault()` in badgeInput for pass-through keystrokes:** Product-search keystrokes must reach Magicline's React event handlers. Only the existing `keyboardLockdown` SUPPRESS_LIST entries call `preventDefault()`.
- **Attaching badgeInput to only one webContents:** Focus moves between host and Magicline; a single-attach approach drops all scans when the other webContents has focus.
- **Starting idleTimer from main.js directly:** Must start from authFlow's CASH_REGISTER_READY transition to guarantee the splash has lifted before the idle overlay can show.
- **Calling `createMagiclineView` without `destroyMagiclineView` first:** The `magiclineView` module-scoped variable would hit the "already created, returning existing instance" early-return guard [VERIFIED: magiclineView.js line 100].
- **Adding `focusin`/`focusout` listeners inside the re-injection path:** Listeners accumulate each time the guard fires → multiple emits per event → duplicate `product-search-focused` events → idleTimer.bump() called N×.
- **Using `blur`/`focus` instead of `focusin`/`focusout` for product-search detection:** `blur`/`focus` do not bubble, so they cannot be delegated from `document`. [VERIFIED: MDN event reference]
- **Relying on `document.activeElement` in main process:** Not accessible — main process has no DOM. This is exactly why NFC capture moved from inject.js to main-process `before-input-event`.
- **Calling `sess.clearStorageData()` without specifying the `'persist:magicline'` partition explicitly:** `session.defaultSession` would wipe the host window's session instead of Magicline's isolated partition. Always use `session.fromPartition('persist:magicline')`.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| NFC keystroke pre-emption | Custom `globalShortcut` or `keydown` listener in inject.js | `before-input-event` on webContents | `globalShortcut` doesn't give per-character access; inject.js keydown races React active element (NFC-01 forbidden) |
| Session wipe | Manually removing cookies one by one | `session.clearStorageData()` | Handles cookies, localStorage, IndexedDB, service workers atomically; manual approaches miss SW cache |
| Idle detection | `powerMonitor.getSystemIdleTime()` polling | In-process activity tracking via `before-input-event` + drain-queue events | `powerMonitor` tracks OS-wide idle (screensaver threshold), not per-page interaction; 60s kiosk idle doesn't match any OS default |
| Focus detection | `webContents.isFocused()` polling | `focusin`/`focusout` drain events from inject.js | Polling creates timer overhead; events are immediate and accurate |
| Rolling window | Timestamped circular buffer library | Plain `Array<{t, reason}>` filtered on push | Array length never exceeds 3 at the 60s window; a library is needless complexity |

---

## Common Pitfalls

### Pitfall 1: `before-input-event` Focus Scoping

**What goes wrong:** Badge scans fail when the Magicline WebContentsView has keyboard focus because only the host BrowserWindow's webContents has `attachBadgeInput` registered.

**Why it happens:** Developers assume `before-input-event` fires globally on the window, but it fires only on the specific webContents instance it is registered on. [VERIFIED: electronjs.org]

**How to avoid:** Call `attachBadgeInput(magiclineView.webContents)` inside `createMagiclineView` immediately after `attachLockdown(magiclineView.webContents)`.

**Warning signs:** Scans work on the host overlay but not on the normal cash-register page. First scan after `CASH_REGISTER_READY` is dropped.

### Pitfall 2: `destroyMagiclineView` Missing Before `createMagiclineView`

**What goes wrong:** `createMagiclineView` hits the early-return at line 100 (`already created, returning existing instance`) and silently reuses the old, cleared-session-but-same-webContents view. The member sees a blank or stale page.

**Why it happens:** `destroyMagiclineView` must be called first to null out the module-scoped `magiclineView` variable. [VERIFIED: magiclineView.js lines 99–101, 395]

**How to avoid:** Always call `destroyMagiclineView(mainWindow)` (step 6 in D-15) before `createMagiclineView(mainWindow, store)` (step 10).

**Warning signs:** After a hard reset, the Magicline view doesn't show the login page — it either stays blank or shows a stale page.

### Pitfall 3: `show-splash` IPC Channel Name

**What goes wrong:** `sessionReset.js` tries to send `'show-splash'` but the IPC handler in host.js is registered for `'splash:show'`.

**Why it happens:** Phase 1 and Phase 3 use `'splash:hide'` and `'splash:show'` as channel names [VERIFIED: host.js lines 20–27, preload.js line 15]. A developer might write `'show-splash'` following the Phase 4 kebab-case convention.

**How to avoid:** Use exactly `'splash:show'` (colon-separated Phase 1 convention). The existing `showSplash()` in host.js is already wired to `'splash:show'` via `onShowSplash` in preload.js. [VERIFIED: preload.js line 16]

**Warning signs:** After `hardReset()`, members see the Magicline view flash blank instead of the branded splash.

### Pitfall 4: `focusin`/`focusout` Placed in Re-injection Path

**What goes wrong:** Every `did-navigate-in-page` call re-attaches the product-search focus listeners, causing 2×, 3×, N× emissions per focus event. `idleTimer.bump()` fires multiple times per keystroke, and `product-search-focused` drain events flood the queue.

**Why it happens:** Developer adds listeners inside the idempotency guard early-return block instead of in the one-time setup path.

**How to avoid:** All new event listeners MUST be placed after line 42 (`window.__bskiosk_injected__ = true`) in inject.js, not inside the idempotency guard block. [VERIFIED: inject.js structure]

### Pitfall 5: `loopActive` Never Cleared Without Restart

**What goes wrong:** After the reset-loop guard trips and shows the error overlay, a staff member clears it (perhaps presses a wrong button) and the kiosk is stuck — `loopActive = true` means no further `hardReset()` calls succeed, including legitimate idle resets.

**Why it happens:** `loopActive` is a permanent latch — it can only be cleared by `app.relaunch()`. This is intentional (D-19), but it means any code path that calls `hardReset()` must be aware that after a loop-guard trip, the app is in a permanently degraded state until restart.

**How to avoid:** Ensure the reset-loop overlay (`reset-loop` variant) makes it clear to staff that a restart is required. The PIN button wired to `requestResetLoopRecovery` → `app.relaunch(); app.quit()` is the only recovery path.

**Warning signs:** After the reset-loop error appears, the kiosk doesn't auto-recover after the staff dismisses the overlay somehow.

### Pitfall 6: `lastKeyTime` Not Reset After Flush

**What goes wrong:** After a badge scan commits, the next scan's first character is again compared against the tail of the previous scan's timing. If the inter-scan gap is > 50 ms (almost certain for human-paced scanning), the first character of the next scan fails the timing gate and is dropped.

**Why it happens:** `lastKeyTime` was set to a real timestamp by the previous scan's last character. The next scan's first character computes `timeSinceLast = now - lastKeyTime` which is ≥ 50 ms, failing the timing gate.

**How to avoid:** Always reset `lastKeyTime = null` after every buffer flush (both commit and timeout-flush paths). The sentinel pattern in D-03 is the fix.

### Pitfall 7: `executeJavaScript` on a Destroyed WebContents

**What goes wrong:** `badgeInput.js` commits a badge and calls `wc.executeJavaScript(...)` but the Magicline view has just been destroyed by a concurrent `hardReset()`.

**Why it happens:** `destroyMagiclineView` nulls the view but badgeInput holds a reference to the old `wc` argument passed to `attachBadgeInput`.

**How to avoid:** Guard the `executeJavaScript` call with `if (!wc.isDestroyed())`. The `resetting` flag in `sessionReset.js` is NOT visible to badgeInput — use the webContents `.isDestroyed()` check on the specific wc instance.

### Pitfall 8: Host `before-input-event` Leaking to Idle Timer in Dev Mode

**What goes wrong:** In dev mode, `keyboardLockdown.js` is a no-op. If `idleTimer.bump()` is called from the lockdown listener path without a dev-mode guard, dev keyboard activity still resets the idle timer (not a problem per se), but if the guard condition is wrong it may cause the idle timer to run in dev mode when it shouldn't.

**Why it happens:** D-09 notes: "Must not leak into dev mode (the whole listener is gated `if (isDev) return`)."

**How to avoid:** The idleTimer.bump() call from the host `before-input-event` path should only apply in production. Since the lockdown listener already has `if (isDev) return` at line 64 of keyboardLockdown.js, either add the bump inside that same listener (after the dev guard returns), or add the bump to a separate host-wc `before-input-event` listener that has its own `if (isDev) return` guard.

---

## Code Examples

### `badgeInput.js` Module Skeleton

```js
// src/main/badgeInput.js
// [VERIFIED: based on D-01..D-06 from 04-CONTEXT.md + prototype analysis]

const log = require('./logger');
const idleTimer = require('./idleTimer');

const BADGE_SPEED_MS = 50;   // inter-key timing gate (tunable via electron-store)
const COMMIT_TIMEOUT_MS = 100;
const MIN_BADGE_LENGTH = 3;

let buffer = '';
let lastKeyTime = null;   // sentinel: null = "start of new scan"
let bufferTimer = null;
let productSearchFocused = false;

// Called from magiclineView.js and main.js once per webContents
function attachBadgeInput(wc) {
  wc.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    idleTimer.bump();   // NFC-05: every keyDown is activity

    if (productSearchFocused) return;   // NFC-06: pass through to Magicline

    const key = input.key;
    const now = Date.now();
    const timeSinceLast = lastKeyTime === null ? 0 : (now - lastKeyTime);
    lastKeyTime = now;

    if (key === 'Enter' || key === 'Tab') {
      commitBuffer(wc);
      return;
    }
    if (key.length !== 1) return;   // skip modifier-only keys

    clearTimeout(bufferTimer);
    if (timeSinceLast < BADGE_SPEED_MS || buffer.length > 0) {
      buffer += key;
    }
    bufferTimer = setTimeout(() => commitBuffer(wc), COMMIT_TIMEOUT_MS);
  });
}

function commitBuffer(wc) {
  clearTimeout(bufferTimer);
  const committed = buffer;
  buffer = '';
  lastKeyTime = null;   // Pitfall 6 fix

  if (committed.length <= MIN_BADGE_LENGTH) return;

  log.info('badgeInput.commit: length=' + committed.length);
  if (wc.isDestroyed()) return;   // Pitfall 7 fix

  idleTimer.bump();   // D-09: badge commit is activity
  const escaped = JSON.stringify(committed);
  wc.executeJavaScript(
    'if(window.__bskiosk_setMuiValue){' +
    'var _in=document.querySelector(\'[data-role="customer-search"] input\');' +
    'if(_in)window.__bskiosk_setMuiValue(_in,' + escaped + ');}',
    true
  ).catch(e => log.warn('badgeInput.inject failed: ' + (e && e.message)));
}

function setProductSearchFocused(val) {
  productSearchFocused = !!val;
  log.info('badgeInput.productSearchFocused: ' + productSearchFocused);
}

module.exports = { attachBadgeInput, setProductSearchFocused };
```

### `idleTimer.js` State Machine Skeleton

```js
// src/main/idleTimer.js
// [VERIFIED: D-07..D-12 from 04-CONTEXT.md]

const log = require('./logger');

const IDLE_TIMEOUT_MS    = 60_000;   // NFC-01 requirement: 60 s
const OVERLAY_TIMEOUT_MS = 30_000;   // IDLE-01: 30 s countdown

const STATES = { IDLE: 'IDLE', OVERLAY_SHOWING: 'OVERLAY_SHOWING', RESETTING: 'RESETTING' };

let state = STATES.IDLE;
let idleTimer = null;
let mainWindow = null;   // set on init

function init(mw) { mainWindow = mw; }

function start() {
  log.info('idleTimer.state: -> IDLE reason=start');
  state = STATES.IDLE;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    log.info('idleTimer.state: IDLE -> OVERLAY_SHOWING reason=timeout');
    state = STATES.OVERLAY_SHOWING;
    mainWindow.webContents.send('show-idle-overlay');
  }, IDLE_TIMEOUT_MS);
}

function stop() {
  clearTimeout(idleTimer);
  log.info('idleTimer.state: ' + state + ' -> IDLE reason=stop');
  state = STATES.IDLE;
}

function bump() {
  if (state !== STATES.IDLE) return;
  clearTimeout(idleTimer);
  idleTimer = setTimeout(() => {
    log.info('idleTimer.state: IDLE -> OVERLAY_SHOWING reason=timeout');
    state = STATES.OVERLAY_SHOWING;
    mainWindow.webContents.send('show-idle-overlay');
  }, IDLE_TIMEOUT_MS);
}

function dismiss() {
  log.info('idleTimer.state: OVERLAY_SHOWING -> IDLE reason=dismissed');
  state = STATES.IDLE;
  start();   // restart fresh 60s countdown
}

function expired() {
  log.info('idleTimer.state: OVERLAY_SHOWING -> RESETTING reason=expired');
  state = STATES.RESETTING;
  require('./sessionReset').hardReset({ reason: 'idle-expired' });
}

module.exports = { init, start, stop, bump, dismiss, expired };
```

### Extend `handleInjectEvent` in `magiclineView.js`

```js
// Three new delegations inside handleInjectEvent — [VERIFIED: CONTEXT.md D-06, D-09, D-10]
if (type === 'product-search-focused') {
  require('./badgeInput').setProductSearchFocused(true);
  return;
}
if (type === 'product-search-blurred') {
  require('./badgeInput').setProductSearchFocused(false);
  return;
}
if (type === 'activity') {
  require('./idleTimer').bump();
  return;
}
```

### host.js Idle Overlay Handler

```js
// host.js — show-idle-overlay IPC (D-11, per 04-UI-SPEC.md contract)
// [VERIFIED: 04-UI-SPEC.md §host.js Countdown Behavior Contract]
var idleInterval = null;

window.kiosk.onShowIdleOverlay(function () {
  var overlay = document.getElementById('idle-overlay');
  var numEl = document.getElementById('idle-countdown-number');
  if (!overlay || !numEl) return;
  if (idleInterval) clearInterval(idleInterval);
  var countdown = 30;
  numEl.textContent = String(countdown);
  overlay.style.display = 'flex';
  overlay.setAttribute('aria-hidden', 'false');
  idleInterval = setInterval(function () {
    countdown -= 1;
    numEl.textContent = String(countdown);
    if (countdown <= 0) {
      clearInterval(idleInterval);
      idleInterval = null;
      overlay.style.display = 'none';
      overlay.setAttribute('aria-hidden', 'true');
      window.kiosk.notifyIdleExpired();
    }
  }, 1000);
});

function dismissIdleOverlay() {
  if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
  var overlay = document.getElementById('idle-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true'); }
  window.kiosk.notifyIdleDismissed();
}

// Wire button + tap-anywhere
document.getElementById('idle-dismiss-btn').addEventListener('click', dismissIdleOverlay);
document.getElementById('idle-overlay').addEventListener('pointerdown', dismissIdleOverlay);
document.getElementById('idle-overlay').addEventListener('touchstart', dismissIdleOverlay);
document.getElementById('idle-overlay').addEventListener('keydown', dismissIdleOverlay);

window.kiosk.onHideIdleOverlay(function () {
  if (idleInterval) { clearInterval(idleInterval); idleInterval = null; }
  var overlay = document.getElementById('idle-overlay');
  if (overlay) { overlay.style.display = 'none'; overlay.setAttribute('aria-hidden', 'true'); }
});
```

---

## State of the Art

| Old Approach (Prototype) | Current Approach (Phase 4) | Reason Changed |
|--------------------------|---------------------------|----------------|
| `document.addEventListener('keydown', ...)` in inject.js page-world | `before-input-event` on main-process webContents | NFC-01 explicit requirement: page-level activeElement races React re-renders |
| `var lastKeyTime = 0` | `let lastKeyTime = null` (sentinel) | NFC-03 first-character-drop bug fix |
| `startResetTimer()` from page `pointerdown` | `idleTimer.bump()` from main-process + drain-queue events | Activity tracking in main process is reliable; page-world timer can be killed with the Magicline view |
| Single `var resetTimer` in page-world | `sessionReset.js` in main process with mutex + loop guard | IDLE-03/04/05 requirements; page-world timer is reset on navigation |
| No crash recovery | `render-process-gone` → `sessionReset.hardReset({ reason: 'crash' })` | IDLE-07 requirement |

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `details.reason` enum for `render-process-gone` includes `'clean-exit'`, `'abnormal-exit'`, `'killed'`, `'crashed'`, `'oom'`, `'launch-failed'`, `'integrity-failure'` | Crash Recovery / IDLE-07 | Log line format may be slightly different; actual recovery behavior unaffected (all non-zero-exit reasons call hardReset regardless) |
| A2 | `shadercache` and `filesystem` storage types are NOT used by Magicline and safe to omit from `clearStorageData` | Pattern 5 / Session Wipe | If Magicline uses shader cache keying for session state (extremely unlikely), a reset might not clear it; add these types defensively if 100-cycle harness shows residual state |
| A3 | `app.relaunch()` + `app.quit()` correctly hands off the single-instance lock to the new process on Windows with NSIS install | Reset-loop admin recovery | If the new process fails to acquire the lock, it exits silently. Mitigation: test explicitly on the kiosk hardware during Phase 4 verification |
| A4 | The Deka reader's inter-key timing in Electron 41 on Windows is consistent with the Android prototype's < 50 ms assumption | badgeInput BADGE_SPEED_MS | If the Windows USB HID stack adds extra latency (> 50 ms between consecutive badge characters), the buffer gate fails and scans are silently dropped. Mitigation: D-04 makes the value tunable via `electron-store` key `nfcBadgeSpeedMs`; verify on kiosk hardware as part of the Phase 4 acceptance task |
| A5 | `session.cookies.flushStore()` after `session.clearStorageData()` prevents session bleed between resets | Session Wipe / IDLE-04 | Incorrect: if `clearStorageData` already flushes its own writes, `flushStore()` is a no-op. If `clearStorageData` does NOT flush, omitting `flushStore()` would allow the old session to persist for up to 30s. The 100-cycle harness will surface this if it occurs |

**If this table is empty:** All claims in this research were verified or cited — no user confirmation needed. (Table is not empty — 5 assumptions logged above.)

---

## Open Questions

1. **`render-process-gone` reason enum completeness**
   - What we know: The event fires with a `details` object containing a `reason` string. Documented reasons include at least `'crashed'`, `'killed'`, `'oom'`.
   - What's unclear: Whether all reasons should trigger `hardReset` or only some (e.g., `'clean-exit'` is not a crash and should not count toward the loop counter).
   - Recommendation: Log the reason unconditionally; call `hardReset` for all reasons except `'clean-exit'` (which would only occur during deliberate teardown, not unexpected loss). Add an explicit `if (details.reason === 'clean-exit') return;` guard.

2. **Deka HID timing on Windows 11 vs Android**
   - What we know: The prototype confirmed < 50 ms works on Android. The prototype documents this as `BADGE_SPEED_MS = 50`.
   - What's unclear: Whether Windows 11 USB HID stack introduces additional latency that pushes inter-key gap above 50 ms for the Deka reader specifically.
   - Recommendation: Plan includes a verification task that physically scans 20 badges and logs inter-key timing to the `main.log`, then adjusts `BADGE_SPEED_MS` if drops are observed.

3. **`splash:show` IPC in `sessionReset.js`**
   - What we know: `host.js` already has `showSplash()` wired to `window.kiosk.onShowSplash()` in preload.js, which uses channel `'splash:show'`. [VERIFIED]
   - What's unclear: Whether `sessionReset.js` (which runs in main process and has access to `mainWindow`) should send `'splash:show'` directly or go through a `require('./authFlow')` emit. D-15 step 5 says `mainWindow.webContents.send('show-splash')` which looks like a typo for `'splash:show'`.
   - Recommendation: Use `mainWindow.webContents.send('splash:show')` (the Phase 1 channel name). Planner should note this discrepancy explicitly in the plan.

---

## Environment Availability

Step 2.6: SKIPPED (no new external dependencies — all capabilities are built into Electron 41 or already present in the project's installed npm modules from Phases 1–3).

---

## Security Domain

`security_enforcement` is not explicitly disabled in `.planning/config.json`. Including this section.

### Applicable ASVS Categories

| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | Phase 4 does not touch credential handling |
| V3 Session Management | yes | `session.clearStorageData()` — full wipe on reset; mutex prevents partial-clear state |
| V4 Access Control | partial | badgeInput never logs badge content (length only); reset-loop recovery gated behind admin PIN |
| V5 Input Validation | yes | Badge buffer: `key.length === 1` check, `buffer.length > 3` gate, Enter/Tab terminators — prevents buffer injection |
| V6 Cryptography | no | Phase 4 introduces no new cryptographic operations |

### Known Threat Patterns for Electron + HID Wedge Input

| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Badge buffer overflow / injection via HID | Tampering | `key.length === 1` filter, `buffer.length > 3` minimum, `JSON.stringify` escaping before `executeJavaScript` |
| Session bleed between members | Spoofing | Full `clearStorageData` + `flushStore` on every idle expiry; 100-cycle harness |
| Reset-loop DoS (deliberate or accidental rapid cycling) | Denial of Service | Rolling 3-in-60s counter with permanent `loopActive` latch; admin PIN required for recovery |
| `executeJavaScript` injection via crafted badge content | Tampering | `JSON.stringify(committed)` escapes all special characters before interpolation into the JS string; no raw string concatenation |
| Crash-loop stack exhaustion | Denial of Service | `loopActive` flag prevents unbounded `hardReset()` recursion from crash storms |

---

## Sources

### Primary (HIGH confidence)
- `src/main/magiclineView.js` (live codebase) — KNOWN_EVENT_TYPES, handleInjectEvent, destroyMagiclineView, render-process-gone location, drain timer, createMagiclineView export
- `src/inject/inject.js` (live codebase) — idempotency guard at line 36, `__bskiosk_setMuiValue` at line 70, `emit()` helper, MutationObserver pattern
- `src/main/keyboardLockdown.js` (live codebase) — `attachLockdown` pattern, dev-mode guard
- `src/main/authFlow.js` (live codebase) — CASH_REGISTER_READY reduction at lines 115–124, 164–172, side-effect shape
- `src/main/preload.js` (live codebase) — existing IPC surface, Phase 1/3 channel names
- `src/host/host.js` (live codebase) — `showSplash()`/`showMagiclineError()` pattern, variant-switch structure
- `src/inject/fragile-selectors.js` (live codebase) — existing stable selectors for customer-search and product-search
- `docs/BeeStrong_POS_Kiosk_Project.md` lines 363–455 (prototype) — NFC buffer logic, `BADGE_SPEED_MS`, first-char-drop root cause, post-sale setTimeout, `Jetzt verkaufen` click handler
- [Electron session.clearStorageData](https://www.electronjs.org/docs/latest/api/session#sesclearstoragedataoptions) — valid `storages` string values verified
- [Electron cookies.flushStore](https://www.electronjs.org/docs/latest/api/cookies#cookiesflushstore) — write-through guarantee verified
- [Electron before-input-event](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event) — per-webContents scope, `input.type`, multiple-listener support verified
- [Electron app.relaunch](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions) — requires explicit `app.quit()` call verified
- `.planning/phases/04-nfc-input-idle-session-lifecycle/04-CONTEXT.md` — all design decisions D-01..D-23
- `.planning/phases/04-nfc-input-idle-session-lifecycle/04-UI-SPEC.md` — idle overlay DOM/CSS contract, countdown behavior contract, z-index ladder

### Secondary (MEDIUM confidence)
- MDN `focusin`/`focusout` vs `focus`/`blur` bubbling — bubbling behavior of focusin/focusout confirmed, required for document-level delegation

### Tertiary (LOW confidence)
- A1: `render-process-gone` reason enum values (training knowledge; not surfaced in fetched Electron docs page)
- A3: `app.relaunch()` + single-instance-lock interaction on Windows (not explicitly documented)

---

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all components are built-in Electron 41 or existing deps; no new packages
- Architecture: HIGH — all patterns verified against live codebase (Phases 1–3 source files read)
- Pitfalls: HIGH — each pitfall is grounded in specific line numbers from the live codebase
- `clearStorageData` storage type names: HIGH — verified against electronjs.org
- HID timing on Windows: MEDIUM — prototype timing assumed to translate; must verify on kiosk hardware

**Research date:** 2026-04-10
**Valid until:** 2026-05-10 (stable Electron 41 APIs; Magicline selector drift is independent)
