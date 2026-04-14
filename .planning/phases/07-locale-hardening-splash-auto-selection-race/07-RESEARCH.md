# Phase 07: Locale Hardening & Splash Auto-Selection Race - Research

**Researched:** 2026-04-14
**Domain:** Electron locale enforcement + inject-side DOM race gating
**Confidence:** HIGH (code paths verified by direct read; Electron APIs verified against official docs + issue tracker)

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**Locale Enforcement (LOCALE-01) — belt-and-suspenders, both layers:**
1. `app.commandLine.appendSwitch('lang', 'de-DE')` in `src/main/main.js` BEFORE `app.whenReady()`.
2. Override `Accept-Language: de-DE,de;q=0.9` on the magicline session via `session.fromPartition('persist:magicline').webRequest.onBeforeSendHeaders(...)`.

**Auto-Select Selector Strategy — hybrid, stable where possible, locale text table for the rest:**
- Survey Magicline DOM on the live kiosk for stable hooks (`data-role`, `id`, `aria-*`) on each of: `Kasse auswählen` / autocomplete `Self-Checkout` option / `Speichern` submit. Fall back to text match.
- Locale strings live in `src/inject/fragile-selectors.js` in a new `LOCALE_STRINGS.de` block alongside `JETZT_VERKAUFEN_TEXT`. Exactly one place to patch. No other file in the codebase may hard-code `'Kasse auswählen'`, `'Self-Checkout'`, or `'Speichern'`.
- Structured log line `auto-select.result=ok|fail|timeout` with a `step` field on every chain run.

**Splash Gate (SPLASH-01):**
- NEW IPC `splash:hide-final` on welcome path only. Cold-boot and idle-recovery keep current `splash:hide` unchanged.
- Bridge: inject.js emits a console sentinel (same pattern as `BSK_AUDIT_SALE_COMPLETED`), from a single `markRegisterReady({degraded})` helper called from (a) end of successful chain, (b) "already on register" branch, (c) bounded-retry failure branch with `degraded:true`.
- 5s safety timeout from welcome tap; fallback to existing `cash-register-ready → splash:hide` and audit `auto-select.result=timeout`.
- Welcome-only scope. `src/host/host.js` splits the existing `splash:hide` handler.

**Pointer Blocking:**
- Splash blocks host-level pointer events while in `auto-select-pending` state (welcome path only). inject.js synthesizes clicks via `element.click()` inside Magicline DOM, not host-level pointer events, so host-level blocking closes the derail window without breaking the chain.

### Claude's Discretion
- Exact CSS mechanism for pointer block (class, state attribute, inline style).
- Retry/backoff strategy for `detectAndSelectRegister()` — must be bounded and must always emit eventually.
- Internal shape of `LOCALE_STRINGS` table (flat vs nested).
- Exact per-step log field name (`step=kasse-auswaehlen` vs `step=1`) — must be greppable.

### Deferred Ideas (OUT OF SCOPE)
- English "expired session" error-page detection in inject.js (locale fix removes the page).
- Broader i18n table beyond auto-select chain strings.
- Drift-incident audit grep helper tooling.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| LOCALE-01 | Force Magicline UI to de-DE regardless of Windows display language; move locale-dependent text to a single lookup table in `fragile-selectors.js`; structured log line on auto-selection. | §1 Electron locale mechanics; §2 webRequest header override; §3 LOCALE_STRINGS shape; §8 structured log line format. |
| SPLASH-01 | Keep post-tap splash visible + pointer-blocking until register auto-selection completes; new `splash:hide-final` IPC; 5s safety timeout; welcome-path only. | §4 sentinel bridge pattern; §5 host splash state; §6 one-shot/idempotency; §7 bounded retry; §9 risks. |
</phase_requirements>

## Summary

Phase 07 ships two tightly coupled fixes. The locale fix is mechanically simple and fully specified: Chromium's `--lang` switch plus a `webRequest.onBeforeSendHeaders` header override on the `persist:magicline` session. The splash-gate fix is a near-verbatim clone of the existing `BSK_AUDIT_SALE_COMPLETED` console-sentinel bridge, with a new welcome-only IPC channel and a host-side timer.

The single unknown is the Magicline DOM: no `data-role`/`aria-*`/`id` hooks on the three auto-select buttons are recorded anywhere in the codebase. The existing `detectAndSelectRegister()` (inject.js §261-346) uses pure text matching. **A live-kiosk DOM survey is a required Wave 0 task** — without it the planner cannot commit to "stable selector where available." If the survey finds nothing, the phase degrades gracefully to "text-match only, with strings in `LOCALE_STRINGS`" and still satisfies the requirements.

**Primary recommendation:** Land the locale fix first (tiny, isolated, low-risk), then the selector survey, then the splash-gate refactor. Test on a kiosk with Windows language set to English-US for acceptance.

## Project Constraints (from CLAUDE.md)

- **Electron 41.1.1, pin `~41.x`.** `webContents.insertCSS` / `executeJavaScript` / `session` / `safeStorage` are the load-bearing primitives. `WebContentsView` is the non-deprecated child-view API in 41.
- **No TypeScript, no bundler, no new native deps.** Plain CJS `main.js`.
- **D-21 drift rule:** fragile/drift code ONLY in `src/inject/fragile-selectors.js` and `inject.css`. Never edit `src/main/` in response to a Magicline copy/selector rename. `LOCALE_STRINGS` MUST live in `fragile-selectors.js`.
- **GSD workflow enforcement:** no direct Edit/Write without going through a GSD command.
- **electron-log audit transport** — existing canonical taxonomy (logger.js §93-96): `startup`, `auth.state`, `auth.submit`, `idle.reset`, `sale.completed`, `update.*`, `pin.*`, `admin.*`, `crash`. Format: `event=<name> k=v k=v at=<ISO>`. The new chain result line must fit this format.

## Standard Stack

No new dependencies. All APIs are already in the project's dependency graph:

| API | Location | Purpose |
|-----|----------|---------|
| `app.commandLine.appendSwitch('lang', 'de-DE')` | Electron core (already used in main.js for other switches if any; safe to add) | Forces Chromium UI locale, affects `navigator.language` and Accept-Language |
| `session.fromPartition('persist:magicline').webRequest.onBeforeSendHeaders` | Electron core, already accessible via `magiclineView.js` webContents | Second-layer Accept-Language override |
| `console.log('BSK_…')` sentinel relayed via `webContents.on('console-message', …)` | Existing pattern, `magiclineView.js` §262-281 | inject → main bridge for `register-selected` |
| `setTimeout` + renderer IPC | Existing `host.js` patterns | 5s safety timeout |

**Version verification:** all consumed APIs are Electron core; no npm package versions to verify for this phase. The project is pinned to `electron@~41.x` per CLAUDE.md.

## §1 — Electron Locale Mechanics (authoritative)

**Ordering requirement [CITED: electronjs.org/docs/latest/api/command-line-switches; VERIFIED: electron/electron#17995, #26185]:**

Command-line switches appended via `app.commandLine.appendSwitch` must be set **before the `ready` event is emitted**. For `lang`, this means **before `app.whenReady()`** — i.e. in top-level main.js code at require time, not inside the `.then()` handler.

Correct pattern:
```js
// src/main/main.js — top of file, before any app.whenReady() call
const { app } = require('electron');
app.commandLine.appendSwitch('lang', 'de-DE');
// ... later ...
app.whenReady().then(() => { /* ... */ });
```

**Historical caveats [CITED: electron/electron PR #26185 — "fix: set app locale after user's script is loaded", merged pre-Electron 12]:**
There was a pre-Electron-12 bug where `appendSwitch('lang', …)` did not change `app.getLocale()`. Fixed. For Electron 41 the switch works, but the project's belt-and-suspenders decision to also override `Accept-Language` is well-justified: historical Electron issues (#17995, #28992, #3034) show the `--lang` switch has been flaky across versions for HTTP header propagation specifically (as opposed to `navigator.language`, which it reliably sets). [ASSUMED: flakiness is for HTTP header propagation — verified via issue titles; exact current behavior in 41 not verified.]

**What `--lang` affects:**
- `navigator.language` / `navigator.languages` in all renderers — HIGH confidence.
- `app.getLocale()` return value — HIGH confidence post-#26185.
- Default `Accept-Language` header on XHR / fetch / document loads — MEDIUM confidence (historically flaky; hence the override).

**What it does NOT affect:**
- Session-specific request headers already overridden via `webRequest` (those win).
- Per-partition session language if the user has previously set one (none in this project).

## §2 — webRequest.onBeforeSendHeaders on persist:magicline

**Signature [CITED: electronjs.org/docs/latest/api/web-request]:**
```js
session.webRequest.onBeforeSendHeaders([filter,] listener)
// listener: (details, callback) => callback({ requestHeaders })
```

**Minimal working pattern (clone this):**
```js
// src/main/main.js — inside app.whenReady(), BEFORE createMagiclineView is called
const { session } = require('electron');
const magicSession = session.fromPartition('persist:magicline');
magicSession.webRequest.onBeforeSendHeaders((details, callback) => {
  details.requestHeaders['Accept-Language'] = 'de-DE,de;q=0.9';
  callback({ requestHeaders: details.requestHeaders });
});
```

**Placement requirements:**
- Must run **before** `createMagiclineView(mainWindow, store)` is called — otherwise the first `loadURL(MAGICLINE_URL)` race will issue requests with the default header. Currently `createMagiclineView` is called inside the `welcome:tap` handler (`main.js:478-492` via `startLoginFlow` closure at `main.js:421-436`), which runs after `app.whenReady()`. Register `onBeforeSendHeaders` in the `app.whenReady().then(...)` block at the same place `sessionReset.init()` and `idleTimer.init()` run (around `main.js:365-368`), before any `welcome:tap` can fire.
- A filter is NOT required — an unfiltered listener on the partition-specific session is cheap (only fires for that partition's requests, which are all Magicline) and avoids maintaining a URL allowlist.

**Pitfalls:**
- Must call `callback({ requestHeaders: details.requestHeaders })` — NOT `callback({})` (that silently drops all headers) and NOT `callback({ cancel: false })` alone.
- Header names are normalized but case-sensitive in the object you pass back. Use `'Accept-Language'` exactly; don't also set `'accept-language'` — that produces two headers [ASSUMED: based on general webRequest behavior; not verified for Electron 41 specifically].
- Registering twice (e.g. on HMR reload in dev) replaces the previous listener [CITED: webRequest docs — "Passing null will unset the listener"]. Safe.
- `onBeforeSendHeaders` registered AFTER the session has already loaded a URL: the listener takes effect for subsequent requests, but the already-sent first document request is unchanged. **This is a race you must prevent** — register in `app.whenReady()` before the welcome-tap path creates the view.

## §3 — Magicline DOM Survey: BLOCKED, needs live-kiosk capture

**Grepped the codebase for stable hooks on `Kasse auswählen` / `Self-Checkout` / `Speichern` — result:**

No `data-role`, `aria-*`, or `id` hints recorded anywhere for these three buttons. The existing `detectAndSelectRegister()` at `src/inject/inject.js:267-346` uses pure text matching:

- `Kasse auswählen`: iterates `document.querySelectorAll('[data-role="button"]')` and matches on `textContent.trim()` (inject.js:270-277). `data-role="button"` is stable across Magicline — this is the generic button class, not an auto-select-specific hook.
- `Self-Checkout` option: `document.querySelectorAll('[role="option"]')` + `textContent` match (inject.js:310-318). `role="option"` is ARIA-standard MUI Autocomplete output — stable, but not specific to this dropdown.
- `Speichern` submit: `document.querySelectorAll('[type="submit"][data-role="button"]')` + `textContent` match (inject.js:325-330). Same stability as above.

**Action for the planner:** schedule a Wave 0 "DOM survey" task. Over RDP to the kiosk, open DevTools on the Magicline view (dev mode, `src/main/magiclineView.js:235-241`), trigger the auto-select page, and inspect each of the 3 buttons for any `data-*`, `aria-label`, `aria-labelledby`, `id`, or `name` attribute that uniquely identifies them. Record findings in the plan's VERIFICATION.md.

**Fallback if no stable hooks exist (likely):** the hybrid strategy degenerates to "text match only, strings in `LOCALE_STRINGS.de`". This still satisfies D-21 (single-file drift blast radius) and LOCALE-01's requirement 2. Document this in the plan as the expected outcome.

## §4 — Sentinel Bridge Pattern (clone target)

The `BSK_AUDIT_SALE_COMPLETED` bridge is the canonical cross-world transport. Locations:

**Emit side — `src/inject/inject.js:96-108`:**
```js
// inside the click listener for 'Jetzt verkaufen'
document.addEventListener('click', function (e) {
  try {
    var btn = e.target && e.target.closest && e.target.closest('[data-role="button"]');
    if (!btn) return;
    if (btn.textContent && btn.textContent.trim() === JETZT_VERKAUFEN_TEXT) {
      try { console.log('BSK_AUDIT_SALE_COMPLETED'); } catch (e) { /* swallow */ }
      // ...
    }
  } catch (err) { /* swallow */ }
});
```

**Catch side — `src/main/magiclineView.js:262-281` (console-message listener on the child view's webContents):**
```js
magiclineView.webContents.on('console-message', (...args) => {
  let message = '';
  if (args.length >= 3 && typeof args[2] === 'string') {
    message = args[2];
  } else if (args[0] && typeof args[0].message === 'string') {
    message = args[0].message;
  }
  if (message && message.indexOf('[BSK]') !== -1) {
    log.info('magicline.console: ' + message);
  }
  if (message && message.indexOf('BSK_AUDIT_SALE_COMPLETED') !== -1) {
    try {
      const { ipcMain } = require('electron');
      ipcMain.emit('audit-sale-completed');
    } catch (_) { /* swallow */ }
  }
});
```

**Forward side — `src/main/main.js:345-350` (ipcMain.on listener converts the cross-process emit into a host webContents.send):**
```js
ipcMain.on('audit-sale-completed', () => {
  try { log.audit('sale.completed', {}); } catch (_) {}
});
```

Note the dual Electron signature handling (pre-41 `(event, level, message, line, sourceId)` vs 41's `(event)` with `event.message`) — **reuse the same defensive message-extraction code verbatim**, don't write a second one.

**Recommended new sentinels for Phase 07:**
- `BSK_REGISTER_SELECTED` — emitted by `markRegisterReady({degraded:false})` on success or "already-on-register" path.
- `BSK_REGISTER_SELECTED_DEGRADED` — emitted by `markRegisterReady({degraded:true})` on bounded-retry exhaustion.

Two distinct sentinels are cleaner than one with JSON payload, matching the existing "string contains" detection idiom in `magiclineView.js`. The catch side emits a single ipcMain event `'register-selected'` with a boolean arg; main.js forwards to host as `'splash:hide-final'` (or reuses `'splash:hide'` on degraded, depending on planner choice — recommend separate IPC).

## §5 — Splash State in host.js (current behavior)

**Current wiring:**
- Splash element: `#splash` (`src/host/host.js:21, 259, 811`).
- Current hide: `function hideSplash() { var el = document.getElementById('splash'); if (el) el.style.display = 'none'; }` (host.js:20-23).
- Current show: `function showSplash() { ... el.style.display = 'flex'; }` (host.js:24-27).
- Subscribed: `window.kiosk.onHideSplash(hideSplash)` and `onShowSplash(showSplash)` at host.js:775-776.
- Layer CSS: `.bsk-layer--splash { z-index: 100; pointer-events: none; }` (`src/host/host.css:46-50`). Comment explicitly reads: "splash is informational, not interactive".

**Z-index context (host.css):**
- Splash: 100
- Welcome: 150
- Magicline error: 300 (pointer-events: auto — blocks touches)
- Credentials overlay / update config: 300 / 527
- Idle overlay: 200
- PIN modal / admin: 400 / 500

**For the `auto-select-pending` state, the splash must flip `pointer-events` from `none` to `auto`** to close the derail window. The welcome layer (z-index 150) is hidden at this point (host.js:40-42 `hideWelcome()` called via `welcome:hide` IPC at main.js:486 before `splash:show`), so splash at z-index 100 is the topmost visible interactive-candidate layer during the auto-select window. PIN modal (z-index 400) and admin (500) are both above splash — admin PIN overlay can still be surfaced if Ctrl+Shift+F12 is pressed during the auto-select window, so the splash pointer-block does NOT imprison the kiosk. **Verify:** planner should confirm no layer at z-index 101-149 is shown during the welcome→register window. From code review, nothing is.

**Recommended CSS shape (Claude's discretion per CONTEXT.md):**
```css
.bsk-layer--splash.auto-select-pending {
  pointer-events: auto;  /* welcome-path only; toggled on in welcome-tap, off on splash:hide-final / splash:hide */
}
```
Add/remove the class in `host.js` inside the new `onHideSplashFinal` handler and the existing `hideSplash` handler; set it on `welcome:tap` (host.js:50-54 `handleWelcomeTap`) before `notifyWelcomeTap()` fires.

## §6 — One-Shot / Idempotency Semantics

**Current `detectReady()` → `emit('cash-register-ready', ...)` guard (inject.js:209-229):**
```js
var readyEmitted = false;
function detectReady() {
  if (readyEmitted) return;
  try {
    if (!location.hash || !/^#\/cash-register(\/|$|\?)/i.test(location.hash)) return;
    var el = document.querySelector('[data-role="product-search"] input');
    if (!el) return;
    readyEmitted = true;
    emit('cash-register-ready', { url: location.hash });
    selfCheck();
  } catch (e) { /* swallow */ }
}
```

**Guarantee:** the module-scoped `readyEmitted` boolean is set before the emit, and `detectReady()` is the only caller. `detectReady()` is invoked from (a) initial pass (inject.js:425), (b) the rAF-debounced `schedule()` (inject.js:398), and (c) the re-injection idempotency path (inject.js:38). All three share the same closure, so the guard holds across MutationObserver re-fires AND across `did-navigate-in-page` re-executions of the IIFE (because `window.__bskiosk_injected__` gates re-entry at inject.js:36-41).

**For `markRegisterReady({degraded})`, clone the same shape:**
```js
var registerReadyEmitted = false;
function markRegisterReady(opts) {
  if (registerReadyEmitted) return;
  registerReadyEmitted = true;
  var degraded = !!(opts && opts.degraded);
  try {
    console.log(degraded ? 'BSK_REGISTER_SELECTED_DEGRADED' : 'BSK_REGISTER_SELECTED');
  } catch (e) { /* swallow */ }
}
window.__bskiosk_markRegisterReady = markRegisterReady;
```

**Call sites (all three must route through this helper):**
1. Successful chain end — after the `Speichern` click resolves (inject.js:329 area).
2. "Already on register" branch — when `detectReady()` fires and no `Kasse auswählen` button was ever found. Currently `detectAndSelectRegister()` early-returns at inject.js:278 when `kasseBtn` is null; this branch needs to call `markRegisterReady({degraded:false})` to unblock the splash. Note: only call it when we are in the welcome path AND confirmed on the cash register page (not on arbitrary `did-navigate-in-page` ticks). Gate on `readyEmitted && !kasseBtn && !registerSelectInProgress`.
3. Bounded retry exhaustion — new retry loop (see §7) calls `markRegisterReady({degraded:true})` after N failed attempts.

**Idempotency across welcome cycles:** the IIFE runs once per page load. After a welcome-mode hardReset, the Magicline view is destroyed and recreated (`magiclineView.destroyMagiclineView` / `createMagiclineView`), which loads a fresh page and re-runs the IIFE from scratch — so `registerReadyEmitted` is naturally reset to `false` for each welcome cycle. No manual reset needed.

## §7 — Bounded Retry Shape for detectAndSelectRegister()

**Current shape (inject.js:267-346):** single best-effort pass. On `MutationObserver` fire, `detectAndSelectRegister()` runs inside the rAF-debounced `schedule()` (inject.js:400). If the `Kasse auswählen` button isn't in the DOM yet, it simply early-returns (inject.js:278) and waits for the next mutation to re-fire. `registerSelectInProgress` prevents re-entry during the 500+500+500ms nested setTimeout chain (~1.5s total).

**The chain's internal timing (inject.js:286-342):**
- Step 2 (popup indicator / focus): 500ms after Step 1 click
- Step 3 (option click): +500ms = 1000ms
- Step 4 (Speichern): +500ms = 1500ms

**Problem:** if any step's DOM isn't rendered yet when its setTimeout fires, the chain silently fails — `registerSelectInProgress` is reset to `false` in the catch/null-target branches, but there's no retry and no emit. The splash-gate in Phase 07 surfaces this bug by leaving the splash stuck.

**Recommended retry strategy (fits inside 5s safety timeout):**

Replace the nested setTimeout chain with a state-machine + rAF/MutationObserver-driven step advancement, with **per-step bounded wait** rather than fixed 500ms delays:

```js
// Pseudocode shape for the plan
var CHAIN_STATES = { IDLE, STEP1_KASSE, STEP2_POPUP, STEP3_OPTION, STEP4_SPEICHERN, DONE };
var chainState = IDLE;
var chainAttempts = 0;
var MAX_CHAIN_ATTEMPTS = 3;       // per step
var STEP_TIMEOUT_MS = 1200;        // max wait for a step's DOM to appear; 4 steps × 1200ms = 4800ms < 5000ms host timeout
var stepStartedAt = 0;

function chainTick() {
  if (chainState === DONE) return;
  var now = Date.now();
  if (stepStartedAt === 0) stepStartedAt = now;

  // Try to advance the current step
  if (chainState === IDLE) {
    var kasse = findKasseButton();
    if (kasse) { kasse.click(); chainState = STEP2_POPUP; stepStartedAt = 0; chainAttempts = 0; return; }
  } else if (chainState === STEP2_POPUP) {
    var popup = document.querySelector('.MuiAutocomplete-popupIndicator');
    if (popup) { popup.click(); chainState = STEP3_OPTION; stepStartedAt = 0; chainAttempts = 0; return; }
  } else if (chainState === STEP3_OPTION) {
    var opt = findSelfCheckoutOption();
    if (opt) { opt.click(); chainState = STEP4_SPEICHERN; stepStartedAt = 0; chainAttempts = 0; return; }
  } else if (chainState === STEP4_SPEICHERN) {
    var save = findSpeichernButton();
    if (save) { save.click(); chainState = DONE; markRegisterReady({degraded:false}); return; }
  }

  // Step didn't advance — check timeout
  if (now - stepStartedAt > STEP_TIMEOUT_MS) {
    // Degrade: this step will never fire
    emitAutoSelectResult('fail', currentStepName(chainState));
    markRegisterReady({degraded:true});
    chainState = DONE;
  }
}
```

Tick `chainTick()` from the existing rAF-debounced `schedule()` (inject.js:392-402) AND from a dedicated 100ms setInterval while chain is active (to progress even when MutationObserver is quiet between step clicks). Clear the interval on DONE.

**Distinguishing "button not rendered yet" from "button will never render":** the per-step 1200ms timeout. A button in flight from Magicline's API call normally renders within ~200-400ms; 1200ms is ~3× normal, enough signal that something is wrong without being so long that the user notices. Total worst case 4×1200 = 4800ms, 200ms of headroom under the host's 5000ms safety timeout.

**Attempt counter:** `chainAttempts` is vestigial in the shape above — not strictly needed because the time-based gate is simpler. The planner may prefer attempt-counted instead of time-counted; either shape fits.

## §8 — Structured Log Line Format

**Existing audit format (logger.js:100-109):**
```
event=<name> k=v k=v at=<ISO>
```
Produced by `log.audit(event, fields)`. Whitespace-separated `k=v` pairs, ISO8601 `at=` timestamp appended last. Canonical event taxonomy is comment-enumerated at logger.js:93-96.

**Existing examples (from grep):**
- `event=startup version=... isDev=... at=...`
- `event=idle.reset reason=... count=... mode=... at=...` (sessionReset.js:124)
- `event=sale.completed at=...` (main.js:349)
- `event=pin.lockout lockedUntil=... at=...`

**Recommended new audit event for Phase 07:**

```js
log.audit('auto-select.result', { result: 'ok', step: 'done' });
// → event=auto-select.result result=ok step=done at=2026-04-14T12:34:56.789Z

log.audit('auto-select.result', { result: 'fail', step: 'step3-self-checkout' });
// → event=auto-select.result result=fail step=step3-self-checkout at=...

log.audit('auto-select.result', { result: 'timeout', step: 'unknown' });
// → event=auto-select.result result=timeout step=unknown at=...
```

**Field recommendations:**
- `result` ∈ `{ok, fail, timeout}` — required.
- `step` ∈ `{idle, step1-kasse, step2-popup, step3-self-checkout, step4-speichern, done, unknown}` — required, kebab-case so `grep 'step=step3'` works.
- Optionally `degraded=true|false` as a third field on the `ok` path to disambiguate "already on register, no chain needed" from "chain ran and succeeded" — planner decision.

**Add `auto-select.result` to the canonical taxonomy comment** in `src/main/logger.js:93-96` so the next audit reviewer sees it as a known event, not a stray.

**Emit location:** inject.js emits the result intent via the sentinel bridge, same pattern as `BSK_AUDIT_SALE_COMPLETED`. Main-process side in `magiclineView.js` console-message listener parses the sentinel and calls `log.audit('auto-select.result', ...)`. Recommended transport: a structured sentinel like `BSK_AUTO_SELECT_RESULT:ok:done` (colon-delimited) so one string parse extracts both fields. Example catch side:

```js
if (message && message.indexOf('BSK_AUTO_SELECT_RESULT:') !== -1) {
  var parts = message.substring(message.indexOf('BSK_AUTO_SELECT_RESULT:') + 23).split(':');
  var result = parts[0] || 'unknown';
  var step = parts[1] || 'unknown';
  try { log.audit('auto-select.result', { result: result, step: step }); } catch (_) {}
}
```

## §9 — Risks and Unknowns

1. **webRequest race on first load.** If `onBeforeSendHeaders` is registered AFTER `createMagiclineView`, the first document request already flew with default headers and the Magicline SPA may cache a locale decision in localStorage. **Mitigation:** register the header override in `app.whenReady().then(...)` at the same place `sessionReset.init()` / `idleTimer.init()` run (`main.js:365-368`), which is before `welcome:tap` can fire and therefore before `createMagiclineView` is called. [HIGH confidence this placement works given code flow.]

2. **--lang switch not honored if set in the wrong place.** Electron issue #17995 documents `appendSwitch('lang')` silently failing when set after `app.whenReady()`. **Mitigation:** top-of-file placement, before any other `app.*` call. Verify via `app.getLocale()` log line at `startup` audit event.

3. **MUI Autocomplete option list renders asynchronously after popup click.** The current 500ms Step 2→Step 3 delay is a guess; on slow kiosks or under load it may miss. The §7 bounded-retry shape fixes this (waits up to 1200ms per step).

4. **`[data-role="product-search"] input` may briefly exist on the "Kasse auswählen" pre-selection page** (speculative — needs DOM survey to confirm). If so, `detectReady()` fires → `cash-register-ready` → splash:hide fallback races ahead of the auto-select chain. **Mitigation:** the `detectReady()` guard at inject.js:218-220 checks `location.hash === /^#\/cash-register/` — if Magicline uses a different hash for the selection page (e.g. `#/cash-register/select-register`), `detectReady()` correctly stays latched. [ASSUMED — actual hash behavior on the selection page is not recorded anywhere; Wave 0 DOM survey should capture `location.hash` on each step.]

5. **Splash pointer-block interacting with admin PIN.** Admin PIN modal is z-index 400 (host.css:143-146), splash is z-index 100 with `.auto-select-pending` flipping `pointer-events` to `auto`. PIN modal sits above and has its own `pointer-events: auto`, so Ctrl+Shift+F12 → admin PIN still reaches the PIN overlay. **No regression.** Verify by test on kiosk.

6. **5-second host timeout races the inject-side 4800ms chain timeout.** If the chain exhausts its internal time budget (~4800ms) but the sentinel takes ~250ms to drain through the console-message → ipcMain → host IPC path, the host 5000ms timeout could fire first and emit `auto-select.result=timeout` even though the chain actually degraded-completed. **Mitigation options:** (a) bump host timeout to 5500ms for safety, or (b) have the host timeout still emit `splash:hide` but suppress the `timeout` audit line if a `register-selected` / `register-selected-degraded` sentinel arrives within the next 500ms. Recommend (a) — simpler.

7. **Locale override breaks login page detection.** `inject.js` detects login via `[data-role="username"]` (stable across locales). No text matching on the login page exists in the codebase. **No risk.**

8. **Already-on-register branch double-firing against cold-boot.** Cold-boot and idle-recovery paths still use `cash-register-ready → splash:hide` (per CONTEXT.md locked decision). If `markRegisterReady()` is called from the "already on register" branch on a cold-boot flow, the host's `splash:hide-final` handler will be a no-op because host.js only listens for it on the welcome path. **Mitigation:** `markRegisterReady()` fires the sentinel unconditionally; host-side handler silently ignores if no welcome tap is pending. Belt-and-suspenders check: main.js maintains a "welcome-path pending" flag set on `welcome:tap` and cleared on `splash:hide-final` or timeout; only forwards the sentinel to host when flag is set.

## §10 — Test Strategy

Given the kiosk has no automated UI test harness and this is inherently a visual/race condition phase, the test plan is layered:

**Unit-testable (pure functions, in `test/`):**
- `LOCALE_STRINGS` table shape — assert `LOCALE_STRINGS.de.KASSE_AUSWAEHLEN === 'Kasse auswählen'` etc. Guards accidental table edits.
- Log line formatter round-trip — feed `log.audit('auto-select.result', {result:'ok', step:'done'})` to a mock logger, assert the emitted line matches `/^event=auto-select\.result result=ok step=done at=/`.
- Sentinel parse function — given string `'BSK_AUTO_SELECT_RESULT:fail:step3-self-checkout'`, assert parser extracts `{result:'fail', step:'step3-self-checkout'}`.
- Bounded retry state machine — if extracted as a pure function, unit-test the state transitions against a fake `now`.

**Dev-mode Electron run (no kiosk needed — developer workstation):**
- `NODE_ENV=development npm start`, open DevTools on Magicline view, set `document.documentElement.lang` and confirm `navigator.language === 'de-DE'`.
- Inspect Network tab first request to `bee-strong-fitness.web.magicline.com` — confirm `Accept-Language: de-DE,de;q=0.9`.
- Force `chainState` transitions in DevTools via `window.__bskiosk_markRegisterReady({degraded:true})` and confirm splash hides.

**Live kiosk over RDP (required — the only place the race reproduces):**
- Set Windows display language to English-US (Settings → Time & Language → Language). Confirm Magicline UI still renders German after kiosk restart.
- Complete 5 consecutive welcome→tap→register→idle→welcome cycles. Each should emit `event=auto-select.result result=ok` in `%AppData%/Bee Strong POS/logs/`.
- During the ~1-2s auto-select window, deliberately tap random points on the splash — confirm no tap reaches the underlying Magicline view. Magicline's click chain should still complete.
- Deliberately open DevTools, manually remove `Self-Checkout` from the autocomplete DOM before Step 3 fires, confirm the chain degrades with `auto-select.result=fail step=step3-self-checkout` and the splash hides after ≤5s.
- Restore Windows language to German for kiosk production use.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Electron 41's `--lang` switch is flaky specifically for HTTP header propagation (vs navigator.language) | §1 | Low — the belt-and-suspenders webRequest override protects against this |
| A2 | `'Accept-Language'` header name casing matters in Electron 41 webRequest roundtrip | §2 | Low — could produce duplicate header, kiosk visit would surface it |
| A3 | Magicline's autocomplete for register selection uses a different `location.hash` than `/#/cash-register` during the selection page | §9.4 | Medium — if same hash, `detectReady()` races the auto-select chain; plan must verify hash on survey |
| A4 | No host-layer element at z-index 101-149 is shown during the welcome→register window | §5 | Low — code review confirms; verify as part of kiosk test |
| A5 | The sentinel drain latency through console-message → ipcMain → host IPC is <500ms | §9.6 | Low — existing `BSK_AUDIT_SALE_COMPLETED` works in practice; same transport |

## Open Questions (RESOLVED)

1. **Stable DOM hooks on the 3 auto-select buttons.**
   - RESOLVED: Plan 01 Task 2 (Wave 0 live-kiosk DOM survey) captures stable hooks; falls through to LOCALE_STRINGS.de text matches where none exist.
   - What we know: codebase uses pure text matching; no `data-role`/`aria`/`id` hints recorded.
   - What's unclear: whether Magicline actually exposes stable hooks.
   - Recommendation: Wave 0 live-kiosk DOM survey. Plan assumes "text match only" if survey comes back empty.

2. **`location.hash` value on the register-selection page.**
   - RESOLVED: Plan 01 Task 2 records the observed hash; Plan 04 state machine uses the readyEmitted guard so detectReady is a no-op during the chain.
   - What we know: `#/cash-register` is used post-selection. Case-insensitive regex in `detectReady()` handles both `#/cash-register` and `#/cash-Register`.
   - What's unclear: whether Magicline routes to a distinct sub-hash (e.g. `#/cash-register/select`) on the selection page, or keeps the same hash and conditionally renders the selection UI.
   - Recommendation: capture `location.hash` during the DOM survey. If same hash, add a sentinel check in `detectReady()` to require the absence of `Kasse auswählen` button before emitting.

3. **Whether `auto-select.result` should be added to canonical taxonomy.**
   - RESOLVED: Plan 02 Task 2 updates src/main/logger.js canonical event taxonomy comment to include auto-select.result.
   - What we know: `logger.js:93-96` enumerates canonical events in a comment. New events should be added there for discoverability.
   - What's unclear: whether the phase should update the comment or leave a follow-up. Recommend: update as part of this phase, one-line change.

## Environment Availability

Phase 07 is pure code + config. No new external tools, services, or runtimes. Electron 41, Node 20 LTS, existing electron-log / electron-store / WebContentsView APIs. Kiosk access via RDP required for final acceptance.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Electron core APIs (`commandLine`, `webRequest`, `console-message`) | LOCALE-01, SPLASH-01 | ✓ | 41.x | — |
| Kiosk RDP access | Acceptance test only | ✓ | — | Dev-mode run covers most of the path |
| Windows English display language toggle | Locale regression test | ✓ (Windows 11 Pro per MEMORY.md) | — | — |

## Validation Architecture

`.planning/config.json` not inspected in this session; assuming `nyquist_validation` is enabled per default.

### Test Framework
| Property | Value |
|----------|-------|
| Framework | node's built-in `node:test` [ASSUMED — no test framework grep run; planner should verify against existing `test/` dir] |
| Config file | none inferred |
| Quick run command | `npm test` [ASSUMED — verify in package.json] |
| Full suite command | `npm test` |

### Phase Requirements → Test Map
| Req ID | Behavior | Test Type | Automated Command | File Exists? |
|--------|----------|-----------|-------------------|-------------|
| LOCALE-01 | `LOCALE_STRINGS.de` table contains all 3 keys and non-empty values | unit | `node --test test/fragileSelectors.test.js` | ❌ Wave 0 |
| LOCALE-01 | Sentinel parser round-trips `BSK_AUTO_SELECT_RESULT:ok:done` to `{result,step}` | unit | `node --test test/magiclineView.test.js` | likely ❌ Wave 0 |
| LOCALE-01 | `log.audit('auto-select.result', …)` emits canonical format | unit | `node --test test/logger.test.js` | likely ✅ (existing logger tests) — add case |
| SPLASH-01 | Host splash pointer-events toggle on welcome tap → splash:hide-final | manual | — | N/A |
| SPLASH-01 | 5s safety timeout forwards `auto-select.result=timeout` and hides splash | manual + partial unit (timer logic only) | dev-mode run + DevTools | N/A automated |
| SPLASH-01 | Bounded retry state machine transitions | unit (if state machine is extracted) | `node --test test/autoSelectChain.test.js` | ❌ Wave 0 |

### Sampling Rate
- **Per task commit:** `npm test` on changed files
- **Per wave merge:** full `npm test`
- **Phase gate:** full test suite green + live-kiosk acceptance walkthrough (§10)

### Wave 0 Gaps
- [ ] Live-kiosk DOM survey (§3) — findings recorded in plan's VERIFICATION.md
- [ ] `test/fragileSelectors.test.js` — asserts `LOCALE_STRINGS` shape
- [ ] Extraction of auto-select chain state machine into a testable pure function (planner decision — may be in-file in inject.js if unit testing the string would require loading the IIFE, which is non-trivial)
- [ ] Verify `package.json` test command and existing `test/` layout

## Security Domain

Security enforcement assumed enabled. Phase 07 does NOT touch credentials, encryption, session auth, or admin PIN. The changes are:
- Chromium locale switch (no data flow)
- Session HTTP header override (adds a header, reveals no user data)
- IPC channel addition (`splash:hide-final`) — same sender-validation pattern as existing `welcome:tap` handler at `main.js:480` must be applied
- Console sentinel bridge — same trust posture as existing `BSK_AUDIT_SALE_COMPLETED`; Magicline main world is treated as untrusted but the sentinel-matched branch only triggers IPC relay + log, never data execution (matches §D-15 of project)

### Applicable ASVS Categories
| ASVS Category | Applies | Standard Control |
|---------------|---------|-----------------|
| V2 Authentication | no | unchanged |
| V3 Session Management | no | unchanged (persist:magicline untouched beyond header override) |
| V4 Access Control | no | unchanged |
| V5 Input Validation | yes (minimal) | Sentinel parser must reject unexpected formats — fall back to `unknown` fields, never `eval` or JSON.parse user-controlled strings |
| V6 Cryptography | no | unchanged |

### Known Threat Patterns
| Pattern | STRIDE | Standard Mitigation |
|---------|--------|---------------------|
| Compromised Magicline main world emits forged sentinel | Spoofing / Tampering | Sentinel only triggers `log.audit` + `splash:hide-final` IPC — bounded blast radius, cannot escalate; matches existing `BSK_AUDIT_SALE_COMPLETED` trust model |
| IPC spoofing of `splash:hide-final` from a non-mainWindow sender | Spoofing | Sender validation `ev.sender !== mainWindow.webContents` — clone from `main.js:480` |

## Sources

### Primary (HIGH confidence — direct code reads)
- `src/main/main.js` lines 1-100, 330-500 — welcome:tap IPC, sale-completed listener, app lifecycle
- `src/main/magiclineView.js` lines 25-28 (PARTITION), 262-281 (console-message bridge), 309-355 (inject wiring), 378-460 (cash-register-ready handler)
- `src/main/preload.js` lines 14, 69-73 — onHideSplash, welcome IPC bridges
- `src/inject/inject.js` lines 28-42 (idempotency), 91-108 (sale sentinel), 196-230 (cash-register-ready guard), 260-346 (detectAndSelectRegister chain)
- `src/inject/fragile-selectors.js` lines 44-54 — JETZT_VERKAUFEN_TEXT pattern (model for LOCALE_STRINGS)
- `src/host/host.js` lines 20-55 (splash + welcome handlers), 255-263, 755-821 (IPC wiring, splash dev-mode opacity)
- `src/host/host.css` lines 41-153 — layer z-index + pointer-events map
- `src/main/logger.js` lines 85-117 — log.audit format and taxonomy
- `.planning/phases/07-locale-hardening-splash-auto-selection-race/07-CONTEXT.md` — locked decisions
- `.planning/REQUIREMENTS.md`, `.planning/ROADMAP.md` — phase requirements
- `.planning/phases/06-welcome-screen-lifecycle-redesign/06-CONTEXT.md` — D-02/D-03/D-05 lifecycle contracts

### Secondary (HIGH confidence — official Electron docs)
- [Electron command-line switches](https://www.electronjs.org/docs/latest/api/command-line-switches) — appendSwitch timing
- [Electron webRequest API](https://www.electronjs.org/docs/latest/api/web-request) — onBeforeSendHeaders signature and callback contract

### Tertiary (MEDIUM confidence — Electron issue tracker)
- [electron/electron#17995 — SetLocale through appendSwitch not working](https://github.com/electron/electron/issues/17995)
- [electron/electron#26185 — fix: set app locale after user's script is loaded](https://github.com/electron/electron/pull/26185)
- [electron/electron#3034 — Accept-Language header doesn't list system's locale](https://github.com/electron/electron/issues/3034)
- [electron/electron#28992 — navigator.languages & accept-language header only show one default](https://github.com/electron/electron/issues/28992)

## Metadata

**Confidence breakdown:**
- Electron locale mechanics: HIGH (official docs + issue history, belt-and-suspenders approach already covers residual uncertainty)
- webRequest header override: HIGH (standard pattern, partition already isolated)
- Sentinel bridge pattern: HIGH (verbatim clone of working code)
- Splash state and pointer-blocking: HIGH (CSS map directly read, no ambiguity)
- detectAndSelectRegister chain + retry: MEDIUM (current code read; proposed state machine is sound but un-tested on live Magicline DOM)
- DOM survey findings: LOW / BLOCKED (nothing recorded; requires Wave 0 live capture)

**Research date:** 2026-04-14
**Valid until:** 2026-05-14 (30 days — Electron APIs stable; Magicline DOM is volatile, so the survey task is what ages fastest)

## RESEARCH COMPLETE

**Phase:** 07 - Locale Hardening & Splash Auto-Selection Race
**Confidence:** HIGH overall, with one BLOCKED sub-area (live-kiosk DOM survey) flagged as a Wave 0 task.

### Key Findings
- Electron locale fix is a 2-line main.js change (top-of-file `appendSwitch` + post-`whenReady` `webRequest.onBeforeSendHeaders` on `persist:magicline`); historical issues justify the belt-and-suspenders approach already locked in CONTEXT.md.
- The `BSK_AUDIT_SALE_COMPLETED` console-sentinel bridge is the canonical pattern for the new `register-selected` signal — clone verbatim from `src/main/magiclineView.js:262-281` and `src/inject/inject.js:96-108`.
- Splash at z-index 100 with `pointer-events: none` needs an `.auto-select-pending` class that flips to `auto`. Admin PIN modal at z-index 400 remains reachable — no regression.
- **No stable DOM hooks are recorded** for the 3 auto-select buttons. Current code uses pure text matching. A live-kiosk DOM survey is a required Wave 0 task; the phase should plan for the likely outcome "text-match only, strings in `LOCALE_STRINGS.de`".
- The current nested `setTimeout` chain (inject.js:286-342) is race-fragile and should be replaced with a state-machine + per-step 1200ms bounded wait (4×1200 = 4800ms, fits under the 5000ms host safety timeout).
- Structured log line: `event=auto-select.result result=ok|fail|timeout step=<kebab-name> at=<ISO>` — matches the existing `log.audit` format at `logger.js:100-109`. Add `auto-select.result` to the canonical taxonomy comment.

### File Created
`.planning/phases/07-locale-hardening-splash-auto-selection-race/07-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Electron APIs | HIGH | Official docs + issue history verified |
| Sentinel bridge clone | HIGH | Working code pattern exists in-repo |
| Splash / z-index wiring | HIGH | CSS + host.js directly read |
| Retry shape | MEDIUM | Sound design but not validated against live DOM timing |
| DOM stable hooks | LOW / BLOCKED | No data in codebase; Wave 0 survey required |

### Open Questions (RESOLVED)
1. Stable DOM hooks for the 3 auto-select buttons — requires live-kiosk survey.
2. `location.hash` value during the register-selection page — determines whether `detectReady()` needs an additional guard.
3. Whether to add `auto-select.result` to the taxonomy comment in `logger.js` (recommend yes, part of this phase).

### Ready for Planning
Research complete. The planner can lift snippets from §2 (webRequest pattern), §4 (sentinel bridge), §6 (markRegisterReady shape), §7 (retry state machine), and §8 (audit log format) directly into task actions. The single Wave 0 gap (DOM survey) should be the first task in the plan — every later task is cleaner once the survey result is known.
