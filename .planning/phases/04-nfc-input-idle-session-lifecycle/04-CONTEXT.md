# Phase 4: NFC Input, Idle & Session Lifecycle - Context

**Gathered:** 2026-04-10
**Status:** Ready for UI spec → research → planning

<domain>
## Phase Boundary

Badge scans from the Deka USB-HID reader reach Magicline's customer-search input within one second of any scan (including the very first post-boot scan), idle members are cleanly evicted with the Magicline session wiped and no cart bleed between users, and the kiosk self-heals from Magicline render-process crashes and reset storms without staff intervention. Scope covers the 13 requirements NFC-01..06 and IDLE-01..07.

Scope ends at: (a) the Magicline view has been destroyed + recreated under a cleared `persist:magicline` session, and (b) authFlow's existing Phase 3 BOOTING → LOGIN_DETECTED → CASH_REGISTER_READY cycle takes over from there. Phase 4 does not touch credentials, the admin menu (Phase 5), auto-update gating (Phase 5), or visual design of the overlays (handed to `/gsd-ui-phase 4` next).

</domain>

<decisions>
## Implementation Decisions

### A — Badge capture ownership & arbitration

- **D-01:** NFC capture lives in a new main-process module `src/main/badgeInput.js`, NOT in inject.js. Per NFC-01, page-level `document.activeElement` racing React re-renders is forbidden. The module exports `attachBadgeInput(wc)` (a `before-input-event` listener builder) and `bump()`/`isProductSearchFocused` glue for the idle timer and focus arbitration. It is called once on `mainWindow.webContents` and once inside `createMagiclineView` immediately after `attachLockdown(magiclineView.webContents)` — the two-attach pattern is required because `before-input-event` only fires on the focused webContents and focus moves between host and Magicline view.

- **D-02:** `badgeInput.js` is a NEW module — it does NOT extend `keyboardLockdown.js`. Rationale: `keyboardLockdown` is SHELL-04 suppression and must remain a single-purpose module for drift-patch blast radius. Both listeners attach to the same `before-input-event`; order is "lockdown first, badgeInput second" so a SHELL-04 chord is suppressed before it reaches the badge buffer (e.g. Alt+F4 during a scan never pollutes the buffer). badgeInput only observes; it never calls `event.preventDefault()` for non-badge characters — staff typing into the product-search field must pass through untouched.

- **D-03:** **NFC-03 first-character-drop fix.** The prototype's bug was `var lastKeyTime = 0`, causing `timeSinceLast = Date.now() - 0` (a ~46-year value) on the first keystroke, which failed the `< BADGE_SPEED_MS` check whenever the buffer was empty. Fix: `let lastKeyTime = null;` as a sentinel. On any keystroke, if `lastKeyTime === null` the keystroke is always accepted into the buffer and the timing gate only applies from the 2nd char onward. The `< 50 ms` gate from the 2nd char forward remains the scan-vs-human discriminator. After a buffer flush (commit OR timeout), `lastKeyTime` is reset back to `null` so the next scan starts clean.

- **D-04:** Buffer commit rules: (a) `Enter` keystroke → commit immediately (Deka terminator, confirmed by the prototype); (b) `Tab` keystroke → commit immediately (defensive — some HID wedges emit Tab); (c) silent-timeout flush 100 ms after the last buffered character → commit; (d) commit only if `buffer.length > 3` (the prototype's length gate — rejects stray single chars). On commit, inject the badge via `wc.executeJavaScript('window.__bskiosk_setMuiValue(document.querySelector(\\'[data-role="customer-search"] input\\'), ' + JSON.stringify(buffer) + ')', true)` on the Magicline view webContents. `__bskiosk_setMuiValue` is already exposed for this exact purpose (inject.js:70, commented "Phase 4 NFC injection").

- **D-05:** **Product-search focus arbitration (NFC-06).** inject.js adds `focusin` / `focusout` listeners on `document` that check whether the event target matches `[data-role="product-search"] input` (or any descendant of `[data-role="product-search"]`). On transitions, it emits drain-queue events `product-search-focused` / `product-search-blurred`. magiclineView's drain handler forwards these via a new function `badgeInput.setProductSearchFocused(bool)`. badgeInput keeps a module-scoped boolean; when `true`, the `before-input-event` listener on the Magicline view webContents becomes a no-op (keystrokes pass through to Magicline as normal keyboard input and end up in the product-search field). When `false`, the normal buffer-and-commit behavior runs. The host window's badgeInput listener is unaffected by this flag because product-search focus by definition implies the Magicline view has focus.

- **D-06:** `KNOWN_EVENT_TYPES` in `magiclineView.js` gains two new entries: `product-search-focused` and `product-search-blurred`. Forwarded to `require('./badgeInput').setProductSearchFocused(evt.type === 'product-search-focused')` inside `handleInjectEvent`. Follows Phase 3 D-03's pattern of extending the whitelist one entry at a time.

### B — Idle timer ownership & activity sources

- **D-07:** New main-process module `src/main/idleTimer.js`. Pure state machine with three states: `IDLE` (the 60 s countdown is running), `OVERLAY_SHOWING` (the branded "Are you still there?" overlay is up with a 30 s countdown owned by host.js), `RESETTING` (sessionReset is in flight). Exports: `start()`, `stop()`, `bump()`, `dismiss()` (called on overlay dismissal IPC from host), `expired()` (called on overlay countdown-zero IPC from host). State ownership is main; visible countdown is host.js.

- **D-08:** **idleTimer starts ONLY on `CASH_REGISTER_READY`.** authFlow.js is already the authoritative source for that transition (`CASH_REGISTER_READY` terminal) — Phase 4 adds a new side-effect kind `{ kind: 'start-idle-timer' }` in the CASH_REGISTER_READY reduction and a matching case in authFlow's executor that calls `require('./idleTimer').start()`. This guarantees the splash is down before the idle overlay could ever show, and means no special splash-vs-idle z-fighting case exists. idleTimer.stop() is called at the beginning of every `sessionReset.hardReset()` run so the next idleTimer.start() on the post-reset CASH_REGISTER_READY is a clean restart.

- **D-09:** Activity sources that call `idleTimer.bump()` (confirmed by user during discuss — all four are wired):
  1. **Host `before-input-event`** — keyboardLockdown's existing listener adds `require('./idleTimer').bump()` for every non-suppressed keyDown (PIN modal input, credentials overlay typing, idle overlay dismiss). Must not leak into dev mode (the whole listener is gated `if (isDev) return`).
  2. **Magicline view `before-input-event`** — badgeInput.js's own listener calls `idleTimer.bump()` for EVERY keyDown it sees, regardless of buffer vs pass-through decision. (Staff typing into product-search still counts as activity.)
  3. **inject.js pointerdown + touchstart drain event** — inject.js attaches rAF-debounced listeners on `document` for `pointerdown` and `touchstart` that emit a new drain-queue event type `activity`. magiclineView's `handleInjectEvent` forwards it as `require('./idleTimer').bump()`. This is the ONLY channel for touch-on-Magicline to reach main; without it, a member tapping the product list would not reset the idle timer. rAF debounce is required because MUI's synthetic event churn would otherwise emit dozens per second.
  4. **Badge scan commit** — badgeInput's commit path calls `idleTimer.bump()` immediately before the `executeJavaScript` inject. NFC-05 requirement.

- **D-10:** `KNOWN_EVENT_TYPES` gains a third new entry: `activity`. One-line addition following D-06's pattern.

- **D-11:** **Overlay countdown owned by host.js.** Main IPCs `show-idle-overlay` (with no payload). host.js flips the `#idle-overlay` sibling div to visible, starts a single `setInterval(… 1000)` that updates a visible countdown from 30 → 0, and attaches its own `pointerdown` / `touchstart` / `keydown` listener. On any activity before 0: clear interval, hide overlay, IPC `idle-dismissed` back to main → `idleTimer.dismiss()` → reset back to `IDLE`. On reaching 0: clear interval, hide overlay, IPC `idle-expired` back to main → `idleTimer.expired()` → calls `sessionReset.hardReset({ reason: 'idle-expired' })`. Rationale: fewer IPC round-trips, smoother visible countdown (not dependent on main process main-thread responsiveness), main stays pure state-machine.

- **D-12:** preload.js gains: `onShowIdleOverlay(cb)`, `onHideIdleOverlay(cb)` (main → renderer), `notifyIdleDismissed()`, `notifyIdleExpired()` (renderer → main, fire-and-forget `ipcRenderer.send`). Follows Phase 3 D-12 pattern.

- **D-13:** `#idle-overlay` sibling div added to host.html on **z-index layer 200** (already reserved in the Phase 1 ladder comment: *"200 — Phase 4 idle overlay (sibling added later)"*). Visual design (copy, countdown ring shape, dismiss affordance) is handed to `/gsd-ui-phase 4` — this CONTEXT.md only fixes the DOM structure requirement (sibling div + `display:none` default + CSS layer 200).

### C — Hard reset sequence & mutex

- **D-14:** New main-process module `src/main/sessionReset.js`. Single public entry point: `async hardReset({ reason })`. Module-scoped state: `let resetting = false;` and `let loopActive = false;` (D-17). All reset triggers (idleTimer expiry, render-process-gone, admin menu in Phase 5) go through this single function. Keeps the 100-cycle harness surface small.

- **D-15:** **Exact step ordering** (user-confirmed — matches the STATE.md "100-cycle `clearStorageData` + `flushStore` ordering harness" TODO):
  1. `if (resetting || loopActive) { log.info('sessionReset.suppressed: ' + (resetting ? "in-flight" : "loop-active")); return; }`
  2. Roll the timestamp window + check loop counter (D-18) — if the window is already ≥3, transition into loopActive and short-circuit.
  3. `resetting = true;` — set the in-flight guard.
  4. `idleTimer.stop()` — prevent any late overlay-expiry firing during the reset.
  5. `mainWindow.webContents.send('show-splash')` — re-cover the view so members see splash, not a flash of empty content.
  6. `destroyMagiclineView(mainWindow)` — reuses the existing WR-03 teardown path, which already clears `drainTimer`, `readyFired`, `driftActive`, `revealed`, `hideCssKey`. No new hooks needed in magiclineView.js.
  7. `const sess = session.fromPartition('persist:magicline');`
  8. `await sess.clearStorageData({ storages: ['cookies', 'localstorage', 'sessionstorage', 'serviceworkers', 'indexdb', 'cachestorage'] });` — explicit storages list rejects "clear everything including shared workers we don't own." Planner verifies each storage name against the Electron 41 docs.
  9. `await sess.cookies.flushStore();` — guarantees the cleared cookies are written to disk before the new view can re-read them. Without this, race conditions between the next Magicline request and the IndexedDB/cookies write can let the old session survive.
  10. `createMagiclineView(mainWindow, store);` — fresh instance with fresh drain timer. authFlow is already wired from main.js:161 so the next `login-detected` drain event drives the normal re-login cycle with no additional hooks.
  11. `resetting = false;` — in a `finally` block, immediately after step 10. A subsequent legitimate reset request during the ~12 s re-login window is allowed (prevents deadlock if boot-watchdog fires).

- **D-16:** **authFlow needs no explicit reset call from sessionReset.** Phase 3 D-19 made the state machine stateless across reboots — every `app.whenReady()` starts at `BOOTING`. A fresh `createMagiclineView` triggers the normal login-detected flow exactly as if the app had just started. sessionReset.js MUST NOT import or call into authFlow. The only cross-module call is `destroyMagiclineView` + `createMagiclineView` (both already exported from `src/main/magiclineView.js`).

### D — Reset-loop detection & admin recovery

- **D-17:** Rolling-window counter in sessionReset.js: `const resetTimestamps = [];` On every `hardReset()` call (after the `resetting` guard passes), push `Date.now()` and filter to the last 60 s: `const now = Date.now(); const recent = resetTimestamps.filter(t => now - t < 60_000); resetTimestamps.length = 0; resetTimestamps.push(...recent, now);`. If `recent.length + 1 >= 3` (i.e. this would be the 3rd reset within the window), do NOT proceed: set `loopActive = true`, emit `show-magicline-error` with `{ variant: 'reset-loop' }`, log `sessionReset.loop-detected: count=3 reasons=[...]`.

- **D-18:** **Unified counter — crashes and idle resets share one rolling window** (IDLE-05 requirement text explicitly says "prevents crash-loop bricking", so crash-driven resets absolutely must count). Each push to `resetTimestamps` is tagged with its reason: `resetTimestamps.push({ t: Date.now(), reason })`, logged in the `loop-detected` message so operators can see whether a storm was crash-driven vs idle-driven. Single counter guarantees mixed storms (2 idle + 2 crash in 60 s) still trip IDLE-05.

- **D-19:** **Admin recovery path: `app.relaunch() + app.quit()`.** The reset-loop overlay uses the existing `#magicline-error` element with a new variant `'reset-loop'`. The "PIN eingeben" button (`#error-pin-button`, already in host.html from Phase 3) is wired to a new variant-aware click path: on current variants (`credentials-unavailable` / `login-failed`) it calls Phase 3's `requestPinRecovery`; on the new `'reset-loop'` variant it calls a new `requestResetLoopRecovery` IPC. The main handler for that IPC shows `#pin-modal` (already wired), on pin-ok calls `app.relaunch(); app.quit();`. Rationale: simplest and most thorough recovery; admin is already physically touching the kiosk; guarantees no lingering timers, zombie webContents, or leaked state. ~5–10 s downtime is acceptable for an admin-only path.

- **D-20:** **Variant propagation.** Phase 2's `show-magicline-error` IPC already carries a `variant` field per Phase 3 D-09. Phase 4 adds one more enum value: `variant: 'reset-loop'`. host.js's existing variant-switch gains one more case that (a) renders a different German message (exact copy → UI-SPEC), (b) shows the PIN button wired to `requestResetLoopRecovery` instead of `requestPinRecovery`. Zero new IPC channels for the error overlay itself.

### E — Post-sale clear + crash recovery integration

- **D-21:** **IDLE-06 post-sale 3 s clear lives ENTIRELY in inject.js.** Port the prototype click listener verbatim:
  ```js
  document.addEventListener('click', function (e) {
    var btn = e.target.closest('[data-role="button"]');
    if (btn && btn.textContent.trim() === 'Jetzt verkaufen') {
      setTimeout(function () {
        var input = document.querySelector('[data-role="customer-search"] input');
        if (input) window.__bskiosk_setMuiValue(input, '');
      }, 3000);
    }
  });
  ```
  No main-process involvement. No new drain events. Main never sees the sale. Rationale: (a) the `'Jetzt verkaufen'` button-text match is itself a fragile-selector concern — when Magicline renames it, the fix lives in the drift-patch blast radius (`src/inject/`) where drift fixes already belong (Phase 2 D-11); (b) the 3 s delay is a purely local visual behavior, not a state-machine transition; (c) follows Phase 2's "prototype porting" rule (Phase 2 D-12) — the prototype logic is load-bearing and verbatim-portable. **The button-text literal `'Jetzt verkaufen'` MUST be extracted as a constant at the top of inject.js (or added to fragile-selectors.js as a structural text entry) so a drift incident is a one-line fix.**

- **D-22:** **IDLE-07 crash recovery reuses the sessionReset.hardReset single code path.** magiclineView.js's existing `render-process-gone` listener (currently log-only at line 199) is extended:
  ```js
  magiclineView.webContents.on('render-process-gone', (_e, details) => {
    log.error('magicline.render-process-gone: ' + JSON.stringify(details));
    try {
      require('./sessionReset').hardReset({ reason: 'crash' });
    } catch (e) {
      log.error('sessionReset.hardReset failed from crash path: ' + (e && e.message));
    }
  });
  ```
  sessionReset's `reason: 'crash'` is recorded in the rolling-window reset counter (D-18), so a crash storm trips IDLE-05's loop detection. The normal destroy+recreate+authFlow cycle takes over. No separate crash-recovery code path.

- **D-23:** **No `'crash-recovering'` variant on `#magicline-error`.** sessionReset already re-shows the branded splash as step 5 of D-15. A separate "something went wrong" overlay on a transient crash would alarm members unnecessarily — the member-facing visual for both idle-reset and crash-recovery is identical: splash → cash register. Operators see the crash via `main.log` (`magicline.render-process-gone: ...` + `sessionReset.loop-detected` if it storms). **Reconciled from discuss:** E2 question suggested a brief crash-recovering cover, E3 question selected "no explicit cover — splash handles it". E3's selection wins; the `show-magicline-error {variant:'crash-recovering'}` step from E2's label is DROPPED.

### Claude's Discretion

- Exact inter-key gate value: D-04 sets 100 ms silent-timeout + commits on Enter/Tab + `length > 3` gate, but the `BADGE_SPEED_MS = 50` constant from the prototype is a tunable number — planner may bump to 60 or 75 ms if research on the actual Deka reader's burst cadence suggests it. The 50 ms figure came from the Android prototype; Electron 41 on Windows may have slightly different keystroke arrival jitter. Default 50 ms, override via an `electron-store` key `nfcBadgeSpeedMs` if a human verification step flags dropped chars.
- Exact debounce cadence for the inject.js `pointerdown` / `touchstart` → `activity` drain event: single-rAF is minimum, single-rAF + 100 ms coalesce is also acceptable. The idle timer has 60 s resolution so firing "activity" at 16 ms vs 100 ms granularity is indistinguishable.
- Rolling-window implementation: plain `Array<{t, reason}>` filtered on every push is fine; a circular buffer is over-engineering at `length ≤ 3`.
- Whether `#idle-overlay` is a full-viewport opaque cover or a semi-translucent overlay — visual decision, handed to `/gsd-ui-phase 4`.
- The exact German copy for (a) the idle overlay, (b) the reset-loop variant error message, (c) the "PIN eingeben" button on the reset-loop variant. All deferred to UI-SPEC.
- Whether to add a `kind: 'start-idle-timer'` side-effect to authFlow's reducer on CASH_REGISTER_READY transition (cleanest — follows Phase 3 reducer pattern), or wire it imperatively in authFlow's executor after `reduce()` returns CASH_REGISTER_READY. Both are acceptable; the reducer side-effect is preferred for unit-test coverage.
- Order of `attachLockdown` vs `attachBadgeInput` within the `createMagiclineView` bootstrap: D-02 specifies "lockdown first, badgeInput second". If planning finds the listener-order semantics of `before-input-event` make this a no-op, either order is fine.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

### Project Context
- `.planning/PROJECT.md` — full project vision, prescriptive stack, "no multi-tenant" single-device constraint, maintenance-via-RDP constraint
- `.planning/REQUIREMENTS.md` §NFC Badge Input — NFC-01 through NFC-06 requirement text
- `.planning/REQUIREMENTS.md` §Idle, Reset & Recovery — IDLE-01 through IDLE-07 requirement text
- `.planning/ROADMAP.md` §Phase 4 — goal, 6 success criteria, Phase 3 dependency, Phase 5 downstream dependency
- `CLAUDE.md` — stack pins (Electron ~41.1.1, `electron-store@^10.1.x` CJS, plain JS, no bundler), NFC "HID keyboard wedge, no node-hid" rule, "no robotjs/nut-js" rule (React-native value setter only)
- `docs/BeeStrong_POS_Kiosk_Project.md` — **contains the prototype NFC + idle + reset logic** at lines ~363–445. Planner ports verbatim per the Phase 2 D-12 prototype-porting rule. Also selector table at ~lines 490–510 (customer-search, product-search, Jetzt verkaufen button).

### Phase 1 Interface
- `.planning/phases/01-locked-down-shell-os-hardening/01-CONTEXT.md` — `host.html` layered structure, z-index ladder with layer 200 reserved for Phase 4 idle overlay
- `src/main/keyboardLockdown.js:63-91` — `attachLockdown(webContents)` is reused UNCHANGED by Phase 4 (badgeInput is a separate listener, not a patch to lockdown). Also `reservedShortcuts` Set — Phase 4 does NOT add to it.
- `src/main/main.js:136` — `attachLockdown(mainWindow.webContents)` call site (Phase 4 `attachBadgeInput(mainWindow.webContents)` goes immediately after this line)
- `src/main/logger.js` — shared electron-log instance; all `badgeInput.*`, `idleTimer.*`, `sessionReset.*` log lines go through it. Required for AUTH-04-style verifiable acceptance.

### Phase 2 Interface (load-bearing)
- `.planning/phases/02-magicline-embed-injection-layer/02-CONTEXT.md` — D-03/D-04 splash lift semantics, D-10 inject file layout, D-11 drift-patch blast radius contract (Phase 4 respects: post-sale clear + `Jetzt verkaufen` literal + focus-arbitration listeners all live in `src/inject/`), D-14 `persist:magicline` partition name (Phase 4 clears this exact partition)
- `src/main/magiclineView.js` — `createMagiclineView`, `destroyMagiclineView` (WR-03 teardown path used by sessionReset D-15), `KNOWN_EVENT_TYPES` (Phase 4 adds `product-search-focused`, `product-search-blurred`, `activity`), `handleInjectEvent` (Phase 4 adds three delegations), `render-process-gone` listener at line 199 (Phase 4 extends). **Phase 4 must NOT build a second drain loop.**
- `src/inject/inject.js` — `window.__bskiosk_setMuiValue` (reused directly for NFC injection per inject.js:70 comment), `emit()` helper (reused for new event types), idempotency guard at line 36, `hideDynamicElements` (Rabatt button text-match as the pattern for `Jetzt verkaufen` text-match in D-21), MutationObserver scaffolding
- `src/inject/fragile-selectors.js` — STABLE entries for `[data-role="customer-search"]` (line 48) and `[data-role="product-search"]` already exist from Phase 2; Phase 4 reuses these selectors directly without adding new entries. The `'Jetzt verkaufen'` literal is a new structural-text drift entry per D-21.
- `src/host/host.html` — z-index ladder comment (layer 200 reserved), `#splash` element (referenced by sessionReset step 5), `#magicline-error` element (Phase 4 adds `reset-loop` variant support). Phase 4 adds `#idle-overlay` as a layer-200 sibling.
- `src/host/host.css` — brand tokens + z-index tokens; Phase 4 adds one new layer-200 token for the idle overlay, reusing brand colors from Phase 1.
- `src/host/host.js` — IPC subscription pattern, variant-switch for `show-magicline-error` (Phase 4 adds `reset-loop` case). Phase 4 adds new handlers for `show-idle-overlay` / `hide-idle-overlay` + the self-managed 30 s countdown.
- `src/main/preload.js` — `contextBridge` surface `window.kiosk`; Phase 4 adds `onShowIdleOverlay`, `onHideIdleOverlay`, `notifyIdleDismissed`, `notifyIdleExpired`, `requestResetLoopRecovery`.

### Phase 3 Interface
- `.planning/phases/03-credentials-auto-login-state-machine/03-CONTEXT.md` — D-09 "one overlay, N variants" rule (Phase 4 adds `reset-loop` as the 4th variant: drift / credentials-unavailable / login-failed / reset-loop), D-18 state transition logging pattern (Phase 4 logs `idleTimer.state: X -> Y reason=Z` and `sessionReset.state: X -> Y reason=Z`), D-19 "authFlow stateless across reboots" rule (sessionReset D-16 depends on this), D-20 idempotent re-injection contract (Phase 4's inject.js additions must respect the `__bskiosk_injected__` guard)
- `src/main/authFlow.js:115-124` — the existing `cash-register-ready` reduction in BOOTING (Phase 4 adds `{kind:'start-idle-timer'}` here), plus the reducer skeleton for the `start-idle-timer` side-effect kind
- `src/main/main.js:145-253` — `createMagiclineView` wiring site; Phase 4 adds `attachBadgeInput(mainWindow.webContents)` after line 136, and `attachBadgeInput(magiclineView.webContents)` happens inside `createMagiclineView` (or via an accessor callback from main). sessionReset.js needs access to `mainWindow` + `store` — either via a small init-on-start module or via function arguments.
- `src/host/host.html:33-41` — existing `#magicline-error` element and `#error-pin-button` button that Phase 4 wires for the new `reset-loop` variant (D-19)

### External Docs (consult during research)
- Electron docs: [`session.clearStorageData`](https://www.electronjs.org/docs/latest/api/session#sesclearstoragedataoptions) — exact `storages` string list for Electron 41, whether `'all'` is equivalent to the 6 we name
- Electron docs: [`session.cookies.flushStore`](https://www.electronjs.org/docs/latest/api/cookies#cookiesflushstore) — ordering guarantees with clearStorageData
- Electron docs: [`webContents.before-input-event`](https://www.electronjs.org/docs/latest/api/web-contents#event-before-input-event) — multi-listener ordering, `preventDefault` semantics, `input.type === 'keyDown'` contract
- Electron docs: [`app.relaunch`](https://www.electronjs.org/docs/latest/api/app#apprelaunchoptions) — Windows NSIS installer compatibility, single-instance-lock handoff semantics
- Electron docs: `render-process-gone` event — `details.reason` enum (crashed, killed, oom, etc.) for logging
- MDN: `focusin` / `focusout` bubbling behavior vs `focus` / `blur` — D-05 uses focusin/focusout specifically because they bubble
- STATE.md TODO: `clearStorageData` + `flushStore` ordering 100-cycle test harness — Phase 4 research produces the harness; planner schedules it as an explicit plan task

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 1, 2, 3)

- **`window.__bskiosk_setMuiValue(input, value)`** — `src/inject/inject.js:62-70`. Exposed specifically for Phase 4 NFC injection (comment: *"Phase 3 auto-login and Phase 4 NFC injection BOTH reuse this helper"*). No new setter needed.
- **Drain-queue infrastructure** — `src/main/magiclineView.js:50` (`DRAIN_EXPR`), `:263-283` (`startEventDrain`), `:285-373` (`handleInjectEvent`). Phase 4 plugs three new event types into the existing loop.
- **`KNOWN_EVENT_TYPES` whitelist** — `src/main/magiclineView.js:69-76`. Phase 4 adds `'product-search-focused'`, `'product-search-blurred'`, `'activity'`. Three-line additive diff.
- **`emit(type, payload)` in inject.js** — `src/inject/inject.js:48-56`. Reused for new event types.
- **`attachLockdown(webContents)`** — `src/main/keyboardLockdown.js:63-91`. UNCHANGED by Phase 4; badgeInput attaches a separate listener. D-02 explicitly avoids extending keyboardLockdown to keep SHELL-04 suppression single-purpose.
- **`destroyMagiclineView(mainWindow)` (WR-03 teardown)** — `src/main/magiclineView.js:382-401`. Already clears all module-scoped Magicline state; sessionReset.js calls it unchanged.
- **`createMagiclineView(mainWindow, store)`** — `src/main/magiclineView.js:98-204`. Fresh-instance early-return is handled by the preceding `destroyMagiclineView` call. No new parameters needed.
- **`#magicline-error` overlay + `#error-pin-button`** — `src/host/host.html:33-41`. Phase 4 adds one new variant (`reset-loop`) to the existing variant-switch in host.js (from Phase 3 D-09).
- **`logger.js`** — `src/main/logger.js`, rotating file transport at `%AppData%/Bee Strong POS/logs/main.log`. All Phase 4 structured log lines (`badgeInput.commit: length=N`, `idleTimer.state: X -> Y reason=Z`, `sessionReset.hardReset: reason=... count=N`, `sessionReset.loop-detected: count=3 reasons=[...]`) go through this same logger.
- **authFlow reducer side-effect pattern** — `src/main/authFlow.js:64-138`. Phase 4 follows the same `{ kind, ...payload }` shape for `{ kind: 'start-idle-timer' }` added to CASH_REGISTER_READY's side-effect list.
- **electron-store instance** — `src/main/main.js:147`. Reusable for Phase 4's optional `nfcBadgeSpeedMs` override.

### Established Patterns (from Phases 1–3)

- **Main process owns state; page world emits signals via drain queue.** Phase 4 follows verbatim: badgeInput state (buffer, lastKeyTime, productSearchFocused) lives in main; inject.js only emits signals (`product-search-focused`, `product-search-blurred`, `activity`) and exposes helpers (`__bskiosk_setMuiValue` already done).
- **One-shot guards + module-scoped state.** `readyFired`, `driftActive` (Phase 2), `authFailedActive`-style (Phase 3). Phase 4 adds `resetting`, `loopActive` in sessionReset.js; `productSearchFocused` in badgeInput.js; the idleTimer state enum.
- **Idempotent re-injection.** `__bskiosk_injected__` contract from Phase 2 D-20. Phase 4's new inject.js listeners (focusin/focusout, pointerdown/touchstart, click for Jetzt verkaufen) MUST be attached inside the one-time setup path, NOT the re-injection early-return path. The re-injection path only re-runs `hideDynamic + detectReady + detectLogin`.
- **Kebab-case IPC channels.** Phase 4: `show-idle-overlay`, `hide-idle-overlay`, `idle-dismissed`, `idle-expired`, `request-reset-loop-recovery`.
- **CommonJS main, raw-string inject.** No bundler. New inject.js additions are concatenated into the existing `INJECT_JS` string by `fs.readFileSync` at magiclineView require-time.
- **Variant-aware overlay reuse.** Phase 3 D-09's "one overlay, N variants" rule. Phase 4 adds `reset-loop` as variant #4 without touching the DOM structure of `#magicline-error`.
- **Prototype porting.** Phase 2 D-12 rule. Phase 4's inject.js additions (pointerdown activity listener, post-sale click listener, NFC buffer logic IF it had been kept in page-world) port verbatim from `docs/BeeStrong_POS_Kiosk_Project.md` lines ~363–445. NFC capture specifically moves to main-process per NFC-01, but the timing constants and commit semantics port verbatim.

### Integration Points

- **Phase 4 → Phase 1:** `keyboardLockdown.js` gains NO patches; Phase 4's `attachBadgeInput` is a parallel listener. `main.js` gains three call sites: `attachBadgeInput(mainWindow.webContents)` after line 136, `sessionReset` module init inside the magicline-view try-block, and the render-process-gone listener extension inside `createMagiclineView` (which means the edit is to `magiclineView.js`, not `main.js`).
- **Phase 4 → Phase 2:** `magiclineView.js` gains (a) three new `KNOWN_EVENT_TYPES`, (b) three `handleInjectEvent` delegations (to `badgeInput.setProductSearchFocused`, `idleTimer.bump`), (c) an `attachBadgeInput(magiclineView.webContents)` call after the existing `attachLockdown` call, (d) an extended `render-process-gone` handler that calls `sessionReset.hardReset`. `inject.js` gains (a) focusin/focusout listeners, (b) pointerdown + touchstart rAF-debounced activity emitter, (c) post-sale click listener with 3 s setTimeout + `__bskiosk_setMuiValue('')` clear (D-21). `fragile-selectors.js` gets a new structural-text entry for the `'Jetzt verkaufen'` literal (D-21).
- **Phase 4 → Phase 3:** `authFlow.js`'s BOOTING → CASH_REGISTER_READY reduction gets one new side-effect `{ kind: 'start-idle-timer' }` added to its side-effect list; executor gains a matching `case 'start-idle-timer'`. `preload.js` gains 4 new IPC surface entries (D-12 + D-19's `requestResetLoopRecovery`). `host.html`'s variant-switch in `host.js` gains one new case for `reset-loop`. **Zero changes** to credentialsStore, adminPin, or the existing reducer states.
- **Phase 4 → Phase 5:** idleTimer.state + sessionReset.state transitions are logged (D-11 log format), which Phase 5's auto-update safe-window gate will consume to detect "idle window" for update installation. Phase 5 will add a getter/subscription API to idleTimer; Phase 4 just needs to leave the state-transition log in a machine-parseable format. No API handshake in Phase 4.

</code_context>

<specifics>
## Specific Ideas

- **NFC-01 is hard-locked to main-process capture.** The prototype used page-level `document.addEventListener('keydown')`, but the requirement text explicitly forbids that because React activeElement races. Phase 4 honors the requirement: badgeInput.js is a main-process `before-input-event` listener, no exceptions. This is a breaking change from the prototype — the planner is aware and the prototype serves as the timing-constant source, not the structural source.
- **The first-character-drop bug is a load-bearing fix, not a nice-to-have.** Every kiosk member scans their badge as THE FIRST keystroke after idle — if the fix is wrong, every single scan fails. The sentinel-`null` pattern in D-03 is the minimum viable fix; planner must include a unit test that constructs an `input.type === 'keyDown'` event, passes it to the handler with `lastKeyTime === null`, and asserts the first char is buffered.
- **The splash is the single member-visible signal for all resets.** Idle-reset, crash-reset, and manual-reset all look identical to the member: splash → cash register. Operators diagnose the difference via `main.log`. No crash-specific overlay, no idle-specific overlay — the idle countdown ("Are you still there?") is pre-reset, not post-reset.
- **The "Jetzt verkaufen" button text is drift-fragile.** If Magicline renames it (localization change, e.g. "Jetzt kassieren", or a German button-library swap), IDLE-06 silently breaks. Planner MUST extract the literal as a constant at the top of inject.js (or as a structural-text entry in fragile-selectors.js) so a drift incident is a one-line patch in the drift blast radius, not a grep-the-codebase exercise.
- **The 100-cycle reset harness is REQUIREMENT-SPEC text** (IDLE-04 success criterion: *"100 repeated reset cycles in a row never produce a half-logged-in state"*). It is not optional QA — it is the verification artifact for IDLE-03 and IDLE-04. Planner must schedule the harness as a Phase 4 plan task with its own acceptance pass, not fold it into general verification.
- **Reset-loop recovery via `app.relaunch()` is deliberate.** The simpler "clear counter + single manual reset" alternative was considered and rejected during discuss: if the underlying cause is persistent (Magicline degraded, DNS failure, Deka reader brownout), clearing the counter just re-arms the loop. A full process restart is the same mental model staff already use for every other computer problem.
- **Unified reset counter for idle + crash is IDLE-05 intent.** The requirement text says "prevents crash-loop bricking" — crash-loops must count. Separate counters would let 2 idle + 2 crash within 60 s slip through.
- **No visual design decisions in this CONTEXT.md.** Phase 4 has `UI hint: yes`. All visual specifics (idle overlay layout, countdown ring, German copy, color palettes, reset-loop error wording, "PIN eingeben" button styling for the new variant) are handed to `/gsd-ui-phase 4` next per the STATE.md sequencing: `discuss → ui-phase → plan-phase`.

</specifics>

<deferred>
## Deferred Ideas (NOT Phase 4 scope)

- **Admin menu UI (Exit, Reload, View logs, Check for updates)** — Phase 5. Phase 4 only wires a `requestResetLoopRecovery` IPC that calls `app.relaunch()`; the full menu is Phase 5.
- **`Ctrl+Shift+F12` admin hotkey registration** — Phase 5 (per Phase 3 D-20 deferred). Phase 4 does not add to `reservedShortcuts`.
- **Auto-update safe-window gating consuming idle state** — Phase 5. Phase 4 just produces machine-parseable `idleTimer.state:` log lines; Phase 5 adds the subscription API.
- **Logging full badge numbers** — explicitly forbidden by ADMIN-05 (Phase 5) and PROJECT.md. Phase 4's `badgeInput.commit` log line logs `length=N`, NOT the badge content. Even a hashed prefix log is Phase 5's ADMIN-04 surface, not Phase 4.
- **Session-expired silent re-login** — OPS-06 (v2). Phase 4 does not detect mid-transaction Magicline 401s; those appear as a login page via the normal re-injection cycle and Phase 3's authFlow handles them, but there is no explicit "server-side logout" detection in Phase 4.
- **Configurable idle timeout via admin menu** — OPS-05 (v2). Phase 4 hard-codes 60 s idle + 30 s countdown (requirement text).
- **Telemetry on reset-loop frequency** — OPS (v2). Rotating log file is sufficient for RDP diagnosis.
- **Welcome screen / attract loop after idle reset** — OPS-04 (v2). Post-reset UX is just "clean cash register, no customer".
- **Scheduled nightly `app.relaunch()` at 03:00** — OPS-02 (v2). Phase 4's only relaunch path is the reset-loop admin recovery.
- **Alternative NFC buffer timing constants** — deferred to verification; default 50 ms prototype value + 100 ms silent-timeout, tunable via `electron-store` key `nfcBadgeSpeedMs`.
- **`'crash-recovering'` variant on `#magicline-error`** — explicitly rejected during discuss (D-23 reconciliation). Members see splash only.

</deferred>

---

*Phase: 04-nfc-input-idle-session-lifecycle*
*Context gathered: 2026-04-10*
