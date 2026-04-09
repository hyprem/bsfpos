# Phase 3: Credentials & Auto-Login State Machine — Research

**Researched:** 2026-04-09
**Domain:** Electron credential storage (DPAPI), state-machine-driven web form automation against an unowned React/MUI SaaS, Windows Assigned Access touch-keyboard behavior
**Confidence:** HIGH on stack/electron-store/safeStorage/state-machine; MEDIUM on TabTip-under-Assigned-Access (Microsoft Q&A reports unreliable behavior — mitigation strategy proposed); MEDIUM on scrypt parameters (no real kiosk-CPU benchmark, methodology defined for plan-time measurement)

## Summary

Phase 3 is **architecturally additive on top of Phase 2** — every primitive it needs already exists (the drain-queue poll, `__bskiosk_setMuiValue`, the `#magicline-error` overlay, the `electron-store` instance, the `electron-log` channel, the layer-400 z-index slot). The work is: (1) one new main-process module `authFlow.js` that subscribes to the existing drain queue and reduces `(state, event) → (state, sideEffects)`; (2) one tiny `adminPin.js` module wrapping `crypto.scryptSync`; (3) two additive helpers in `inject.js` (`detectLogin`, `__bskiosk_fillAndSubmitLogin`); (4) two new event types in `KNOWN_EVENT_TYPES`; (5) two new sibling overlays in `host.html` on layer 400.

The **single architectural risk** is **D-17 (Windows TabTip auto-invoke under Assigned Access)**. Microsoft Q&A and the Electron issue tracker confirm this is unreliable for non-UWP apps even with `EnableDesktopModeAutoInvoke=1`. The mitigation is **a built-in 3×4 numeric keypad for the PIN modal** (which is touch-only and trivial to build) and **launching `TabTip.exe` as a child process** when the credentials overlay is shown (alpha-numeric input where a custom keyboard is too much scope for Phase 3). Both fallbacks are cheap and Phase 3 should ship with them rather than depend on auto-invoke working.

The **prototype document does NOT contain a Magicline login automation snippet** — only a Fully Kiosk Browser JSON config (`FILL_FIELD` / `CLICK` actions, no DOM-level click semantics). Phase 3 must therefore derive login behavior from the proven Phase 2 `setMuiValue` helper plus a plain `.click()` on `[data-role="login-button"]`. There is no "verbatim port" to do — the planner should not hunt for one.

**Primary recommendation:** Build `authFlow.js` as a pure switch-on-`(state, event)` reducer with a thin "executor" wrapping side effects. Reuse `#magicline-error` for `CREDENTIALS_UNAVAILABLE` and `LOGIN_FAILED` as `variant`-tagged messages. Persist `{credentialsCiphertext, adminPinHash, adminPinSalt}` in a single `store.set({...})` call (atomic per electron-store's whole-file write contract). Ship a 3×4 numeric keypad for the PIN modal regardless of TabTip — it is 30 lines of HTML/CSS and removes a load-bearing assumption.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

**State Machine Ownership & Location**
- **D-01:** Auth state machine in new module `src/main/authFlow.js`. States: `BOOTING` → `NEEDS_CREDENTIALS` (first-run only) → `LOGIN_DETECTED` → `LOGIN_SUBMITTED` → `CASH_REGISTER_READY` | `LOGIN_FAILED` | `CREDENTIALS_UNAVAILABLE`. `authFlow` is the single source of truth; inject.js only emits signals.
- **D-02:** `authFlow` subscribes to the existing 250 ms drain-queue poll in `magiclineView.js`. No new polling loop. Either extend `handleInjectEvent` to delegate auth events to `authFlow.notify(evt)`, or refactor the drain into a tiny event-bus module both consume — pick the smaller diff.
- **D-03:** Two new event types added to `KNOWN_EVENT_TYPES`:
  - `login-detected` — once per page load when `[data-role="username"]` is live AND `location.hash` is NOT cash-register. Payload `{ url }`.
  - `login-submitted` — emitted immediately after the login button click. Payload `{ url }`.
  - `cash-register-ready` (existing) is the SUCCESS terminal.
  - **No `login-failed` event from inject.js** — failure is detected by `authFlow` as "still seeing login-detected after T ms post-submit", never by reading Magicline error banners.

**Login Detection (inject.js side)**
- **D-04:** `inject.js` adds `detectLogin()` mirroring `detectReady()`. Gate on `[data-role="username"]` present AND `location.hash` NOT cash-register. Emits `login-detected` once per page load (deduped by a module-level flag, reset on full page load — NOT on the idempotency guard re-entry). Also exposes `window.__bskiosk_fillAndSubmitLogin(user, pass)` which: queries the three `[data-role]` selectors, calls existing `__bskiosk_setMuiValue` on each input, waits one rAF, clicks the login button, emits `login-submitted`. Credentials are NEVER persisted in inject.js scope — they are interpolated at call time by the main process via `executeJavaScript`.
- **D-05:** `fragile-selectors.js` gains three new STABLE entries: `[data-role="username"]`, `[data-role="password"]`, `[data-role="login-button"]`. They participate in the EMBED-05 self-check on the login page. Phase 3 extends the self-check **trigger** so it runs in both "login visible" and "cash register ready" states — but does NOT change the selector list format.

**State Machine Behavior (main side)**
- **D-06:** On `BOOTING`, `authFlow` checks `safeStorage.isEncryptionAvailable()`:
  - `false` → `CREDENTIALS_UNAVAILABLE`, branded error overlay, no further Magicline interaction until admin recovery.
  - `true` → load + decrypt the blob from `electron-store` key `credentialsCiphertext`. Missing key → `NEEDS_CREDENTIALS` (first run), raise IPC `show-credentials-overlay` with `{ firstRun: true }`. Decrypt throws → `CREDENTIALS_UNAVAILABLE`. Decrypt succeeds → hold creds in module-scoped variable, wait for `login-detected`.
- **D-07:** On `login-detected` while holding decrypted creds: transition `LOGIN_DETECTED`, call `wc.executeJavaScript('window.__bskiosk_fillAndSubmitLogin(' + JSON.stringify(user) + ',' + JSON.stringify(pass) + ')')`, start an 8-second watchdog. On `login-submitted`, restart the watchdog for another 8 s looking for `cash-register-ready`. On `cash-register-ready` → `CASH_REGISTER_READY` terminal. On watchdog expiry OR `login-detected` firing a second time after submit → increment retry counter.
- **D-08:** Retry policy: **up to 3 total submit attempts**, 2-second backoff between attempts. On 3rd failure → `LOGIN_FAILED`, IPC `show-magicline-error` with `LOGIN_FAILED` variant ("Anmeldung fehlgeschlagen — Bitte Studio-Personal verständigen"). Suppress subsequent `cash-register-ready` via a one-shot guard `authFailedActive` (Phase 2 pattern). Recovery = admin PIN → re-enter credentials. Retry counter resets on `cash-register-ready` OR fresh admin recovery.
- **D-09:** `CREDENTIALS_UNAVAILABLE` and `LOGIN_FAILED` BOTH render through the existing `#magicline-error` div Phase 2 already added. Add a `variant: 'drift' | 'credentials-unavailable' | 'login-failed'` parameter on the `show-magicline-error` IPC. The error screen gets a new "PIN eingeben" touch button that IPCs back to `authFlow` to start the admin-recovery flow. Phase 2's drift overlay keeps the same surface with no PIN button — differentiated by the IPC payload variant.

**Minimal Admin PIN Gate (AUTH-05 dependency)**
- **D-10:** Phase 3 ships the **minimum PIN surface** — NOT the full Phase 5 admin menu. Surface: a scrypt hash in `electron-store` under `adminPinHash`, salt in `adminPinSalt`. Use Node's built-in `crypto.scryptSync`, no native deps. Helper `src/main/adminPin.js` exporting `verifyPin(input)` and `setPin(newPin)`. PIN modal on host layer 400, sibling div in `host.html`, handled by `host.js`. Numeric-only input, 4–6 digits, 44×44 touch buttons. On successful verify from `CREDENTIALS_UNAVAILABLE` or `LOGIN_FAILED` → transition to `NEEDS_CREDENTIALS` and raise the credentials overlay with `{ firstRun: false }`. **Phase 5 contract:** Phase 5's admin menu module will `require('./adminPin')` and reuse `verifyPin` / `setPin` as-is.
- **D-11:** First-run capture also captures the initial admin PIN on the **same overlay**. Fields: `Admin-PIN (4–6 Ziffern)`, `PIN wiederholen`, `Magicline Benutzername`, `Magicline Passwort`. Single submit persists PIN hash + credentials ciphertext atomically (one `store.set({...})` call). `NEEDS_CREDENTIALS` is the only state that shows PIN-setup fields; AUTH-05 recovery shows credentials-only.

**Credentials Storage**
- **D-12:** `safeStorage.encryptString(JSON.stringify({ username, password }))` → `Buffer` → `.toString('base64')` → persisted in `electron-store` under `credentialsCiphertext`. JSON wrapper recovers both fields atomically. Same store instance Phase 2 already opens (`new Store({ name: 'config' })` in `main.js`). Single `config.json` holds `magiclineZoomFactor`, `credentialsCiphertext`, `adminPinHash`, `adminPinSalt`.
- **D-13:** **Plaintext audit:** verification step greps `%AppData%/Bee Strong POS/config.json` AND `%AppData%/Bee Strong POS/logs/main.log` for the test username and password after a full boot cycle. Asserts zero plaintext matches. Asserts no `process.env.MAGICLINE_*` or `BSF_CREDENTIALS` exists at runtime.

**Credentials Overlay UI**
- **D-14:** Sibling `<div id="credentials-overlay">` in `host.html` on z-index layer 400 (already reserved). Rendered by `host.js` in response to IPC `show-credentials-overlay` / `hide-credentials-overlay`. No separate BrowserWindow, no iframe, no React.
- **D-15:** Overlay fields (re-entry mode): username (text, required, trim), password (password input + show/hide toggle 44×44), `Speichern & Anmelden` primary button (disabled until both fields non-empty), inline error text slot. First-run mode adds: `Admin-PIN (4–6 Ziffern)` and `PIN wiederholen` (numeric, minlength 4, maxlength 6, equality check).
- **D-16:** Submit is synchronous from UI POV: click → disable button → IPC `submit-credentials` `{ firstRun, pin?, username, password }` → main encrypts + stores → main transitions `authFlow` to `BOOTING` which immediately re-reads the store. Failed login re-raises the same overlay with inline error text — no double-modal, no toast. The splash stays up underneath as the visual "in progress" cue.
- **D-17:** **TabTip strategy:** rely on Windows' built-in TabTip to pop on focus under the kiosk user account. **No custom softkeyboard in Phase 3.** Research must verify TabTip auto-invokes under Assigned Access — if not, TabTip becomes a blocker routing to a deferred custom-softkeyboard phase.

**Logging**
- **D-18:** Every state transition logs one structured line via Phase 1's shared `electron-log`: `log.info('auth.state: ' + prev + ' -> ' + next + ' reason=' + reason)`. Never log credentials, PIN, or ciphertext length. `reason` enum: `boot`, `creds-loaded`, `login-detected`, `submit-fired`, `watchdog-expired`, `retry`, `max-retries`, `pin-ok`, `pin-bad`, `safestorage-unavailable`, `decrypt-failed`. This log stream is the AUTH-04 verification artifact.

**Session Reset Seam**
- **D-19:** Phase 3 does NOT clear `persist:magicline` — that is Phase 4. State machine is **stateless across reboots**: no persisted `currentState` key. Every boot starts at `BOOTING`. Phase 4's idle reset just causes Magicline to re-serve login, and Phase 3's normal flow handles it.
- **D-20:** `authFlow` must be **idempotent under re-injection**. Phase 2 re-runs `executeJavaScript(INJECT_BUNDLE)` on every `dom-ready` and `did-navigate-in-page`. `detectLogin` emits `login-detected` once per page load guarded by a module-level flag reset on each page's initial execution (not on the idempotency-guard re-entry). authFlow's retry counter is scoped to one login cycle, not the process lifetime.

### Claude's Discretion

- Exact wording on the `LOGIN_FAILED` message variant (German, brand tone, matching Phase 2 drift-message style).
- Scrypt cost parameters (`N`, `r`, `p`) — pick a pair giving ~100 ms verify on the kiosk CPU (research output).
- Whether `fillAndSubmitLogin` should `await` a brief MutationObserver on the login button to confirm DOM removal before emitting `login-submitted`, or whether plain click + single rAF is enough.
- Show/hide password toggle: SVG eye icon vs text "Zeigen"/"Verbergen" — brand taste.
- Whether `adminPinHash` and `adminPinSalt` are two sibling keys or a single `{hash, salt, params}` object. Single object is cleaner.
- The exact refactor shape of the drain-queue handling when `authFlow` joins (event-bus module vs direct `authFlow.notify` call).

### Deferred Ideas (OUT OF SCOPE)

- Custom on-screen alpha-numeric softkeyboard (only if TabTip proves unworkable — routes to a new phase).
- Separate "Test login" button in the credentials overlay.
- Password strength / complexity rules.
- Credential rotation or expiry.
- Full admin menu (Exit to Windows, Reload, View logs, Check for updates) — Phase 5.
- `Ctrl+Shift+F12` admin hotkey registration — Phase 5.
- Session-expiry detection (silent re-login when Magicline 401s mid-session) — Phase 5.
- Rate-limiting brute force on the PIN modal — Phase 5.
- Telemetry on login-retry frequency / auth-failure rate — v2, OPS layer.
- Biometric unlock / Windows Hello — never.
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| AUTH-01 | Credentials stored on disk encrypted via Electron `safeStorage` (Windows DPAPI) — plaintext storage and env vars forbidden | §safeStorage Round-Trip Pattern, §Plaintext Audit Methodology, §Pitfalls (DPAPI master-key rotation) |
| AUTH-02 | First-run / admin menu UI to enter/update credentials; values encrypted and persisted immediately | §Credentials Overlay reuse plan (D-14/D-15), §electron-store Atomicity (single `store.set` write) |
| AUTH-03 | Auto-fill `[data-role="username"]` / `[data-role="password"]` via React-native value setter and click `[data-role="login-button"]` when login page detected | §Existing Patterns to Reuse (`__bskiosk_setMuiValue` already exposed), §Login Click Semantics |
| AUTH-04 | Auto-login is reactive state machine (BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY) | §State Machine Reducer Shape, §Watchdog Timing, §Idempotency on Re-Injection |
| AUTH-05 | If `safeStorage.isEncryptionAvailable()` returns false or decrypt fails, show "Credentials unavailable" screen; admin can re-enter via PIN | §safeStorage Failure Modes, §scrypt Parameters, §Login Failure Detection |
| AUTH-06 | Use a dedicated Magicline staff account with minimum permissions | Operational, not technical — surfaced in plan as a runbook checklist item; no code work in Phase 3 |
</phase_requirements>

## Existing Patterns to Reuse (Phases 1 & 2)

**[VERIFIED: codebase grep]** All file:line references confirmed in this session.

| Asset | Location | Phase 3 use |
|-------|----------|-------------|
| `window.__bskiosk_setMuiValue(input, value)` | `src/inject/inject.js:61-69` (declared), `:69` (exposed on window) | Called from `__bskiosk_fillAndSubmitLogin` for username + password inputs. Phase 2 comment at `:59-60` explicitly says "Phase 3 auto-login and Phase 4 NFC injection BOTH reuse this helper" — no new setter implementation |
| `emit(type, payload)` helper | `src/inject/inject.js:47-55` | Reused for `login-detected` and `login-submitted` — no changes to the emit mechanism |
| `__bskiosk_injected__` idempotency guard | `src/inject/inject.js:36-41` | `detectLogin` must respect this — on guard re-entry, call `__bskiosk_detectLogin()` (mirroring how `:38` calls `__bskiosk_detectReady()`). The `loginEmitted` flag is reset only on a fresh page load, not on re-injection (see §Idempotency on Re-Injection below) |
| `detectReady` pattern | `src/inject/inject.js:140-161` | Structural template for `detectLogin`. Note the case-insensitive anchored hash regex at `:149` — `detectLogin` is its **negation**: only emit when hash does NOT match `^#\/cash-register(\/|$|\?)/i` |
| Drain queue (`window.__bskiosk_events`) | `src/inject/inject.js:42`, drained by `src/main/magiclineView.js:42` (`DRAIN_EXPR`), `:216-236` (`startEventDrain`) | New event types just push onto this queue. **No new poll loop.** |
| `KNOWN_EVENT_TYPES` whitelist | `src/main/magiclineView.js:60-65` | Add `'login-detected'` and `'login-submitted'`. Tiny diff. |
| `handleInjectEvent` dispatcher | `src/main/magiclineView.js:238-299` | Add two more `if (type === '...')` blocks that delegate to `require('./authFlow').notify(evt)`. Smaller diff than refactoring to an event-bus module. |
| One-shot guard pattern | `readyFired` (`magiclineView.js:48`), `driftActive` (`:48`) | Phase 3 adds `authFailedActive` following the **same pattern, in the same module** so all guards are colocated and auditable |
| `electron-store` instance | `src/main/main.js:145` (`new Store({ name: 'config' })`) | **Reuse directly** for `credentialsCiphertext`, `adminPinHash`, `adminPinSalt`. **Do not create a second store file.** Pass it into `authFlow.start(mainWindow, store)`. |
| `#magicline-error` overlay | `src/host/host.html:34-38`, styled `src/host/host.css:88-114` | Reused for `CREDENTIALS_UNAVAILABLE` and `LOGIN_FAILED`. Add a `variant` parameter on the IPC payload. The host.js `showMagiclineError` handler at `host.js:22-31` is already parametrized — extend it. |
| `host.html` z-index ladder | `src/host/host.html:12-24` (comment), `:18` ("`400 — Phase 3/5 credentials + admin PIN modal`") | Layer 400 is **already reserved**. Phase 3 adds `#credentials-overlay` and `#pin-modal` as siblings on layer 400. |
| Brand tokens / layer base styles | `src/host/host.css:29-51` (`.bsk-layer`), `:55-86` (logo, status text) | Reuse for credentials overlay + PIN modal. Vertical-tablet 44×44 touch targets are already brand convention. |
| `electron-log` instance | `src/main/logger.js` (default export) | All `auth.state` lines go through this single import. Rotation is already configured (`transports.file.maxSize = 1MB`, `:15`). |
| `attachLockdown` | `src/main/keyboardLockdown.js` | Phase 3 does NOT touch `reservedShortcuts`. The admin hotkey is Phase 5. |
| `host.js` IPC subscription pattern | `src/host/host.js:40-51` | Phase 3 adds new subscriptions in the same shape (`if (window.kiosk.onShowCredentialsOverlay) window.kiosk.onShowCredentialsOverlay(handler)`) |
| `preload.js` `contextBridge` surface | `src/main/preload.js:7-13` | Phase 3 adds: `onShowCredentialsOverlay`, `onHideCredentialsOverlay`, `submitCredentials(payload)` (renderer→main, use `ipcRenderer.invoke` via a `kiosk.submitCredentials` method), `onShowPinModal`, `verifyPin(input)`, plus the variant param on the existing `onShowMagiclineError` (already parameterized) |

## Prototype Login Automation (canonical answer to D-04)

**[VERIFIED: codebase read of `BeeStrong_POS_Kiosk_Project.md` lines 70-100, 363-455]**

**Finding: the prototype document does NOT contain a JavaScript snippet for Magicline login form automation.** The only login automation in the prototype is the **Fully Kiosk Browser "Web Automation" JSON config** at lines 72-99:

```json
[
  { "status": 1, "url": "https://bee-strong-fitness.web.magicline.com*",
    "action": "FILL_FIELD", "target": "ID",
    "id": "[data-role='username']", "value": "YOUR_EMAIL" },
  { "status": 1, "url": "https://bee-strong-fitness.web.magicline.com*",
    "action": "FILL_FIELD", "target": "ID",
    "id": "[data-role='password']", "value": "YOUR_PASSWORD" },
  { "status": 1, "url": "https://bee-strong-fitness.web.magicline.com*",
    "action": "CLICK", "target": "ID",
    "id": "[data-role='login-button']", "value": "" }
]
```

This is a **declarative Fully Kiosk DSL**, not JavaScript. Fully Kiosk's `FILL_FIELD` action does whatever it does internally — it does not give us a DOM-event sequence to copy. The prototype JS file in the same document (`inject.js` at lines 363-455) covers **only**: `setMuiValue`, `hideDynamicElements`, NFC keystroke buffering, post-sale reset, and MutationObserver setup. **There is no `loginAutomation()` function, no `clickLoginButton()` helper, and no submit-timing logic anywhere in the prototype.**

**Implication for Phase 3:** there is no "verbatim port" to do for login automation. The planner should NOT spend time hunting for one. Phase 3 must derive the form-fill+submit semantics from the proven primitives we already have:
1. `setMuiValue` is **proven** against the live Magicline UI for the customer-search input — same React+MUI pattern as the login inputs, so it will work for username + password identically.
2. The button click is a **plain `.click()`** on `[data-role="login-button"]` — see §Login Click Semantics below for justification.

**The Fully Kiosk JSON's three-step ordering (fill username → fill password → click button) is the only "behavioral spec" we have, and it matches what Phase 3 will do.**

## Login Click Semantics (D-03)

**[VERIFIED: React + MUI behavior, well-documented]** **[ASSUMED: that Magicline's specific login button does not require synthetic mousedown/mouseup]** — the prototype Fully Kiosk config uses a single `CLICK` action and "works in production" per CLAUDE.md, which is the strongest evidence we have.

**Recommendation: a plain `el.click()` is sufficient.** Reasoning:

1. MUI's `Button` component renders an HTML `<button>` whose React `onClick` handler is bound via React's synthetic event system. React's synthetic event delegation listens for the **native `click` event at the document root** and dispatches synthetic events on whichever element has a matching `onClick` prop. Calling `HTMLElement.prototype.click()` fires a real `click` event, which bubbles to React's delegated listener, which calls the handler. **This is the same mechanism that makes the prototype's `Jetzt verkaufen` click handler work** at `BeeStrong_POS_Kiosk_Project.md:217-224`, where a real user click triggers a JS-side `click` listener with no special handling.
2. There is **no documented case** in MUI of a `<Button>` requiring synthetic `mousedown`/`mouseup` events instead of `click`. MUI's `ButtonBase` uses `onClick` exclusively for the primary action; mouse-down/up are only used for the ripple effect, which is purely visual.
3. If the button required `mousedown`+`mouseup` (e.g. some MUI form components have validation that runs on `blur` of the previous field), the prototype's Fully Kiosk `CLICK` action would not work — and CLAUDE.md confirms the Android prototype was working.

**Recommended `__bskiosk_fillAndSubmitLogin` body:**

```javascript
window.__bskiosk_fillAndSubmitLogin = function (user, pass) {
  try {
    var u = document.querySelector('[data-role="username"]');
    var p = document.querySelector('[data-role="password"]');
    var b = document.querySelector('[data-role="login-button"]');
    if (!u || !p || !b) {
      // Selectors missing — let watchdog catch it. Do NOT emit failure here;
      // the absent selector will already have triggered a 'drift' event from
      // selfCheck() once the page hydrates.
      return false;
    }
    window.__bskiosk_setMuiValue(u, user);
    window.__bskiosk_setMuiValue(p, pass);
    // Single rAF lets MUI's controlled-input state settle before the click.
    window.requestAnimationFrame(function () {
      try {
        b.click();
        window.__bskiosk_events.push({
          type: 'login-submitted',
          payload: { url: location.hash },
          t: Date.now()
        });
      } catch (e) { /* watchdog will catch */ }
    });
    return true;
  } catch (e) {
    return false;
  }
};
```

**On the discretion question (await MutationObserver on button removal vs plain click + rAF):** **plain click + single rAF is enough.** Rationale: the watchdog already exists as the failure backstop. Adding a MutationObserver on the button costs ~30 lines of inject.js to detect a success signal that `cash-register-ready` already provides via the drain queue. Two paths to the same answer is worse than one path.

## Login Failure Detection (D-08, blocker question 4)

**[ASSUMED — no Magicline DOM observation possible from research]** **[VERIFIED: D-03 architectural decision]**

CONTEXT.md D-03 explicitly bans reading Magicline error banners (selector drift risk), so the failure signal must be **DOM-presence-based on stable selectors only**. Of the three candidates:

| Candidate signal | Stable? | False-positive risk | Verdict |
|------------------|---------|---------------------|---------|
| (a) URL stays at login hash | YES — hash is part of Magicline's routing contract | LOW — but slow round-trip on bad creds means we may sample mid-transition | Use as **secondary** signal |
| (b) `[data-role="username"]` re-appears in DOM | YES — same selector Phase 3 already adds to STABLE | MEDIUM — if React re-renders the form on a state change | Use as **primary** signal via `detectLogin` re-firing |
| (c) Magicline error banner element | NO — Magicline-specific class, will drift | HIGH | **Banned by D-03** |

**Recommended primary signal: `login-detected` firing a second time after `login-submitted`.** Concretely:

- After `login-submitted` is observed by `authFlow`, the watchdog starts (8 s).
- If `login-detected` arrives during the watchdog window → failure → retry.
- If the watchdog expires without `cash-register-ready` AND without a new `login-detected` → also failure → retry. (This catches the case where Magicline shows an error overlay that re-renders the page without unmounting the username field, so `loginEmitted` stays `true` and no second `login-detected` fires.)

This means **`detectLogin`'s `loginEmitted` flag must reset on every fresh page load** (which it does — see §Idempotency on Re-Injection) so a Magicline-side re-route after a failed login causes a new page load and a new `login-detected` event. If Magicline does NOT re-route on failure (it just stays on the same hash), the watchdog timeout is the only signal, and the retry path still works.

**Defensive belt-and-braces:** the `__bskiosk_fillAndSubmitLogin` helper can also re-set `readyEmitted` and `loginEmitted` on every call to ensure the next page-load detection cycle is clean. Planner's call.

## Watchdog Timing (D-07, blocker question 5)

**[VERIFIED: code review of magiclineView.js polling cadence]** **[ASSUMED: that 8 s post-submit is enough on a kiosk-grade Wi-Fi connection — no actual kiosk RTT measurement]**

CONTEXT.md D-07 picks 8 s. Sanity check against Magicline + kiosk-grade Wi-Fi:

- Magicline is a SaaS hosted at `web.magicline.com` (German hosting, judging by domain). A POS terminal on a German gym's Wi-Fi will see typical RTT 30–100 ms, login round-trip (POST `/login` → 302 → fetch `/#/cash-register` → React hydrate → first paint → `[data-role="product-search"]` mount) probably 1–3 s on a fresh connection, up to 5 s on a cold cache.
- The Phase 2 drain poll runs at 250 ms cadence — so the tail latency between an event being emitted and being seen by `authFlow` is up to 250 ms.
- 8 s is **comfortable** for the median case and gives **3× headroom** over a 2.5 s typical login flow. It is tight but acceptable for the worst case.

**Recommendation: keep 8 s for post-submit watchdog.** Add a **separate, longer 12-second initial-detect watchdog** — i.e. if `BOOTING` does not see `login-detected` OR `cash-register-ready` within 12 s of `dom-ready`, that is a different failure (Magicline didn't load at all, or hung mid-hydration) and should log `boot-watchdog-expired` → transition to `CREDENTIALS_UNAVAILABLE` overlay variant `'magicline-unreachable'` (or just reuse `'login-failed'` with appropriate copy — planner's call). This catches the "Magicline is down" scenario which would otherwise hang at the splash forever.

**Backoff between retries:** D-08 says 2 s. That is fine — short enough to feel responsive, long enough that we don't hammer Magicline with three submits in 600 ms.

**Final timer table:**

| Timer | Duration | Trigger | Expiry action |
|-------|----------|---------|---------------|
| Post-submit watchdog | **8 s** | `login-submitted` received | Treat as failed attempt; retry or escalate |
| Boot watchdog | **12 s** | `BOOTING` entered with creds loaded | Escalate to `LOGIN_FAILED` (Magicline unreachable) |
| Inter-retry backoff | **2 s** | Failed attempt counted, attempts < 3 | Re-call `fillAndSubmitLogin` |
| Submit→detect grace | **None** — sample drain immediately | — | — |

## Windows TabTip Verdict (D-17, **CRITICAL BLOCKER**)

**[CITED: Microsoft Q&A — single-app Kiosk on Windows 11, on-screen keyboard does not appear](https://learn.microsoft.com/en-us/answers/questions/5606954/single-app-kiosk-mode-on-windows-11-on-screen-keyb)** **[CITED: Electron issue #8037 — Cannot open Windows 10 Touch Keyboard from Electron](https://github.com/electron/electron/issues/8037)** **[CITED: Electron issue #21816 — child_process.exec start tabtip.exe not shown](https://github.com/electron/electron/issues/21816)**

### Verdict: **TabTip auto-invoke is UNRELIABLE for Electron under Assigned Access — DO NOT depend on it.**

Microsoft's own answer documents that:
1. Windows treats desktop applications (including Electron) **differently from UWP apps** — text-field detection in non-UWP apps does not reliably trigger TabTip in Single-App Kiosk mode.
2. Even with `HKCU\Software\Microsoft\TabletTip\1.7\EnableDesktopModeAutoInvoke = 1` and `EdgeTargetMode = 1` set, "auto-invocation may not work reliably in Single-App Kiosk".
3. Electron issues #8037 (open since 2017, never fully resolved) and #21816 confirm that even **manually launching `tabtip.exe`** from an Electron app fails to display the keyboard in some Windows versions — the process starts but the keyboard window does not appear.

### What the registry knob actually does (when it works)

```reg
[HKEY_CURRENT_USER\Software\Microsoft\TabletTip\1.7]
"EnableDesktopModeAutoInvoke"=dword:00000001
```

This tells Windows to auto-invoke the touch keyboard when a text input gains focus on a touchscreen device — but the detection logic is brittle for non-UWP HTML inputs and known to fail under Assigned Access.

### Mitigation strategy (REQUIRED — do not skip)

The phase MUST ship with **two layers of defense** so TabTip working/not-working is not a deployment-time blocker:

1. **PIN modal: ship a built-in 3×4 numeric keypad in `host.html`.** Numeric input is small enough that a custom keypad is **30 lines of HTML/CSS** and removes 100% of the TabTip dependency for the AUTH-05 recovery path. **This is the recommended Phase 3 default.** See §PIN Modal Numeric Input UX below for layout.
2. **Credentials overlay: ship a "Tastatur" button next to each text field that explicitly invokes `tabtip.exe` via Node `child_process.exec`.** This gives the operator a manual escape hatch even if auto-invoke fails. The button is a 44×44 touch target with a keyboard icon. Operators are technical users (RDP-authenticated staff), not members, so a manual-launch button is acceptable scope for first-run + recovery flows. The Phase 1 OS-hardening runbook should also assert the registry keys above so that auto-invoke works **when it can**.
3. **Document in the phase runbook:** "If the touch keyboard does not appear automatically when you tap a text field, tap the keyboard icon button next to the field."

### Alternative if even manual launch fails

If on-device testing reveals that even `child_process.exec("tabtip.exe")` fails to show the keyboard, the fallback escalation is:
- **Build a full alpha-numeric softkeyboard in `host.html`.** This is **out of scope for Phase 3** per D-17 deferred-ideas — it would route to a new phase. But it is the known-good fallback if Phase 3 hits the worst case.

### Phase opening directive

This is a **Wave 0 task in the plan**, not an end-of-phase verification. Plan Wave 0 should:
1. Build the credentials overlay UI with both the input fields AND the "Tastatur" button stub.
2. Build the PIN modal with the 3×4 numeric keypad (NOT TabTip-dependent).
3. Test on the real kiosk hardware that tapping the username field (a) auto-invokes TabTip OR (b) the Tastatur button manually invokes it.
4. If both fail, escalate to the planner immediately and route to the deferred custom-softkeyboard phase.

## PIN Modal Numeric Input UX (blocker question 13)

**Recommendation: hand-built 3×4 numeric keypad.** Reasoning:

- **Zero TabTip dependency** — works regardless of registry knobs, Assigned Access quirks, or Windows version.
- **30 lines of HTML/CSS** — twelve buttons in a CSS grid, each 80×80 px (well above 44×44 minimum). Layout: rows `1 2 3 / 4 5 6 / 7 8 9 / ⌫ 0 ✓`.
- **No keyboard-event handling needed** — each button has an `onclick` that appends/clears a PIN buffer in `host.js`, masked with `•` characters in the display field.
- **Reuses brand tokens** — yellow primary (#F5C518), dark background (#1A1A1A), same font stack as splash.
- **Phase 5 contract is preserved** — the PIN modal becomes a sibling div like the splash; Phase 5's admin menu can show or hide it via the existing `show-pin-modal` IPC.

**Don't use `<input type="tel" inputmode="numeric" pattern="[0-9]*">` for the PIN.** Reasoning: that approach **depends on TabTip**, which is exactly the load-bearing assumption we are trying to remove. The keypad is independent of any OS-level keyboard.

## safeStorage Round-Trip Pattern (D-12, blocker question 8)

**[CITED: Electron safeStorage docs](https://www.electronjs.org/docs/latest/api/safe-storage)** **[CITED: Freek Van der Herten — Replacing Keytar with safeStorage in Ray](https://freek.dev/2103-replacing-keytar-with-electrons-safestorage-in-ray)**

**`encryptString` returns a `Buffer`, not a string.** This is the critical detail. Round-trip:

```javascript
// --- encrypt ---
const { safeStorage } = require('electron');
if (!safeStorage.isEncryptionAvailable()) {
  throw new Error('safestorage-unavailable');
}
const plaintext  = JSON.stringify({ username: u, password: p });
const cipherBuf  = safeStorage.encryptString(plaintext);     // Buffer
const cipherB64  = cipherBuf.toString('base64');             // string for JSON store
store.set({
  credentialsCiphertext: cipherB64,
  adminPinHash: hashHex,
  adminPinSalt: saltHex,
});

// --- decrypt ---
const cipherB64Loaded = store.get('credentialsCiphertext');
if (!cipherB64Loaded) return null;     // first run
const cipherBufLoaded = Buffer.from(cipherB64Loaded, 'base64');
let plaintextLoaded;
try {
  plaintextLoaded = safeStorage.decryptString(cipherBufLoaded);
} catch (e) {
  // Most likely DPAPI master-key rotation — see §Pitfalls
  log.warn('auth.decrypt-failed: ' + (e && e.message));
  return 'decrypt-failed';
}
const { username, password } = JSON.parse(plaintextLoaded);
```

**Three things to know:**

1. **`isEncryptionAvailable()` MUST be called only after `app.whenReady()`** — calling it earlier returns false unconditionally. Phase 3's `authFlow.start(mainWindow, store)` runs from inside `app.whenReady().then(...)` so this is satisfied by the call site.
2. **`safeStorage` calls require a BrowserWindow to have been created at least once** in some Electron versions ([electron #34614](https://github.com/electron/electron/issues/34614)). Phase 3 runs after `createMainWindow()` and `createMagiclineView()` so this is also satisfied.
3. **The base64 wrap is necessary** because `electron-store` serializes via `JSON.stringify` which cannot represent a raw Buffer. Without base64, the Buffer becomes `{"type":"Buffer","data":[...]}` which is decryptable but ugly. Base64 is shorter and round-trips cleanly.

## scrypt Parameters (D-10, blocker question 6)

**[CITED: Node.js crypto.scryptSync docs](https://nodejs.org/api/crypto.html)** **[ASSUMED — kiosk CPU specs unknown, parameters chosen conservatively]**

The actual kiosk CPU is unspecified ("Chinese OEM POS terminal"), almost certainly an Atom-class or Celeron N-series chip. We cannot run a benchmark from the dev MacBook and have it predict kiosk timing.

### Recommended starting parameters

```javascript
const SCRYPT_PARAMS = {
  N: 16384,      // 2^14 — cost factor
  r: 8,          // block size (default)
  p: 1,          // parallelization
  keylen: 32,    // 256-bit derived key
  maxmem: 64 * 1024 * 1024,  // 64 MB ceiling — N=16384,r=8,p=1 needs ~16MB; 64MB is comfortable headroom
};
```

**Rationale:**
- **N=16384 (2^14)** is the **minimum recommended by OWASP for interactive logins** as of 2025. It gives ~50–80 ms on a modern x86 server CPU (Xeon, M1) and **~150–300 ms on an Atom-class POS CPU** — comfortably above the 100 ms target without crossing the user-perception threshold of "feels slow" (~500 ms).
- **r=8, p=1** are the canonical defaults from the original scrypt paper and Node's `crypto.scrypt` defaults.
- **keylen=32** matches PBKDF2/scrypt convention for AES-256-class derived keys (we don't actually use AES — `timingSafeEqual` compares the 32-byte output directly — but 32 is the standard).
- **maxmem=64MB** prevents the "too small maxmem" Node error (Node default is 32 MB which is too tight for N=16384,r=8 — see [nodejs/node #28755](https://github.com/nodejs/node/issues/28755)). 64 MB is well within any kiosk's available RAM.

### Methodology for measuring on the real kiosk

Phase 3 plan should include a **one-time tuning task** in Wave 0:

```javascript
// Run once on the actual kiosk hardware via the admin menu (Phase 5) or
// during install (Phase 3 first-run). Measures verify time at the chosen N
// and bumps N up/down to land in the 100–250 ms band.
function measureScryptCost(params) {
  const salt = crypto.randomBytes(16);
  const t0 = process.hrtime.bigint();
  crypto.scryptSync('test-pin-1234', salt, params.keylen, params);
  const t1 = process.hrtime.bigint();
  return Number(t1 - t0) / 1e6;  // ms
}
```

If the measured time on the real kiosk is below 80 ms, bump N to 32768. If above 400 ms, drop to 8192. **Persist the chosen `N` alongside the hash** as part of the `adminPinHash` record so future verifies use the same parameters even if the default constant changes:

```javascript
{
  adminPin: {
    hash: '<hex>',      // 32 bytes hex
    salt: '<hex>',      // 16 bytes hex
    params: { N: 16384, r: 8, p: 1, keylen: 32 }
  }
}
```

This is the "single object" option from D-10 discretion — **recommended over sibling keys** because it future-proofs parameter migration.

### Verify path

```javascript
function verifyPin(input) {
  const rec = store.get('adminPin');
  if (!rec || !rec.hash || !rec.salt) return false;
  const salt = Buffer.from(rec.salt, 'hex');
  const expected = Buffer.from(rec.hash, 'hex');
  const actual = crypto.scryptSync(input, salt, rec.params.keylen, rec.params);
  // Constant-time comparison to defeat timing side-channels
  if (actual.length !== expected.length) return false;
  return crypto.timingSafeEqual(actual, expected);
}
```

**Use `crypto.timingSafeEqual`, never `===` or `Buffer.equals`.** Both of the latter short-circuit on the first mismatched byte and leak timing information.

## State Machine Reducer Shape (D-19/D-20 specifics, blocker question 11)

**Recommendation: a switch on `state` with nested switch on `event.type`, returning `{nextState, sideEffects[]}`.** Plain JS, no library, no XState. Concrete shape:

```javascript
// src/main/authFlow.js
// ----------------------------------------------------------
// Pure reducer + thin executor. The reducer NEVER touches
// global state, the filesystem, or webContents. The executor
// is the ONLY place that calls webContents.executeJavaScript,
// store.set, electron-log, or sets timers.
// ----------------------------------------------------------

const STATES = Object.freeze({
  BOOTING:                'BOOTING',
  NEEDS_CREDENTIALS:      'NEEDS_CREDENTIALS',
  LOGIN_DETECTED:         'LOGIN_DETECTED',
  LOGIN_SUBMITTED:        'LOGIN_SUBMITTED',
  CASH_REGISTER_READY:    'CASH_REGISTER_READY',
  LOGIN_FAILED:           'LOGIN_FAILED',
  CREDENTIALS_UNAVAILABLE:'CREDENTIALS_UNAVAILABLE',
});

// ---- Pure reducer ----
function reduce(state, event, ctx) {
  // ctx is read-only: { hasCreds, attempts, maxAttempts }
  switch (state) {
    case STATES.BOOTING: {
      if (event.type === 'creds-loaded')        return { next: ctx.hasCreds ? STATES.BOOTING : STATES.NEEDS_CREDENTIALS, sideEffects: [{ kind: 'log', reason: 'creds-loaded' }] };
      if (event.type === 'safestorage-unavailable') return { next: STATES.CREDENTIALS_UNAVAILABLE, sideEffects: [{ kind: 'log', reason: 'safestorage-unavailable' }, { kind: 'show-error', variant: 'credentials-unavailable' }] };
      if (event.type === 'decrypt-failed')       return { next: STATES.CREDENTIALS_UNAVAILABLE, sideEffects: [{ kind: 'log', reason: 'decrypt-failed' }, { kind: 'show-error', variant: 'credentials-unavailable' }] };
      if (event.type === 'login-detected')       return { next: STATES.LOGIN_DETECTED, sideEffects: [{ kind: 'log', reason: 'login-detected' }, { kind: 'fill-and-submit' }, { kind: 'start-timer', name: 'post-submit', ms: 8000 }] };
      // 'cash-register-ready' arriving in BOOTING means user was already logged in (cookie session valid)
      if (event.type === 'cash-register-ready')  return { next: STATES.CASH_REGISTER_READY, sideEffects: [{ kind: 'log', reason: 'cash-register-ready-cookie' }] };
      return { next: state, sideEffects: [] };
    }
    case STATES.LOGIN_DETECTED: {
      if (event.type === 'login-submitted')      return { next: STATES.LOGIN_SUBMITTED, sideEffects: [{ kind: 'log', reason: 'submit-fired' }] };
      if (event.type === 'timer-expired' && event.name === 'post-submit') return retryOrFail(ctx, 'watchdog-expired');
      return { next: state, sideEffects: [] };
    }
    case STATES.LOGIN_SUBMITTED: {
      if (event.type === 'cash-register-ready')  return { next: STATES.CASH_REGISTER_READY, sideEffects: [{ kind: 'log', reason: 'cash-register-ready' }, { kind: 'reset-attempts' }] };
      if (event.type === 'login-detected')       return retryOrFail(ctx, 'login-redetected');
      if (event.type === 'timer-expired' && event.name === 'post-submit') return retryOrFail(ctx, 'watchdog-expired');
      return { next: state, sideEffects: [] };
    }
    case STATES.NEEDS_CREDENTIALS: {
      if (event.type === 'credentials-submitted')return { next: STATES.BOOTING, sideEffects: [{ kind: 'log', reason: 'creds-saved' }, { kind: 'rerun-boot' }] };
      return { next: state, sideEffects: [] };
    }
    case STATES.LOGIN_FAILED:
    case STATES.CREDENTIALS_UNAVAILABLE: {
      if (event.type === 'pin-ok')               return { next: STATES.NEEDS_CREDENTIALS, sideEffects: [{ kind: 'log', reason: 'pin-ok' }, { kind: 'show-credentials-overlay', firstRun: false }] };
      if (event.type === 'pin-bad')              return { next: state, sideEffects: [{ kind: 'log', reason: 'pin-bad' }] };
      return { next: state, sideEffects: [] };
    }
    case STATES.CASH_REGISTER_READY:
    default:
      return { next: state, sideEffects: [] };
  }
}

function retryOrFail(ctx, reason) {
  if (ctx.attempts + 1 >= ctx.maxAttempts) {
    return { next: STATES.LOGIN_FAILED, sideEffects: [
      { kind: 'log', reason: 'max-retries' },
      { kind: 'show-error', variant: 'login-failed' },
      { kind: 'set-failed-active' },
    ] };
  }
  return { next: STATES.LOGIN_DETECTED, sideEffects: [
    { kind: 'log', reason: 'retry' },
    { kind: 'increment-attempts' },
    { kind: 'start-timer', name: 'retry-backoff', ms: 2000 },
    // The retry-backoff timer-expired handler in the executor calls
    // fill-and-submit again and starts the post-submit watchdog.
  ] };
}

// ---- Executor ----
let currentState = STATES.BOOTING;
let creds = null;
let attempts = 0;
const MAX_ATTEMPTS = 3;
let webContents = null;
let mainWindow = null;
let store = null;
let timers = {};

function notify(event) {
  const ctx = { hasCreds: !!creds, attempts, maxAttempts: MAX_ATTEMPTS };
  const { next, sideEffects } = reduce(currentState, event, ctx);
  if (next !== currentState) {
    log.info('auth.state: ' + currentState + ' -> ' + next + ' reason=' + (event.type || '?'));
    currentState = next;
  }
  for (const sx of sideEffects) {
    runSideEffect(sx);
  }
}

function runSideEffect(sx) {
  switch (sx.kind) {
    case 'log':                       log.info('auth.reason=' + sx.reason); return;
    case 'show-error':                mainWindow.webContents.send('show-magicline-error', { variant: sx.variant }); return;
    case 'show-credentials-overlay':  mainWindow.webContents.send('show-credentials-overlay', { firstRun: !!sx.firstRun }); return;
    case 'fill-and-submit':           webContents.executeJavaScript('window.__bskiosk_fillAndSubmitLogin(' + JSON.stringify(creds.username) + ',' + JSON.stringify(creds.password) + ')'); return;
    case 'increment-attempts':        attempts += 1; return;
    case 'reset-attempts':            attempts = 0; return;
    case 'set-failed-active':         /* set authFailedActive guard */ return;
    case 'start-timer':               clearTimeout(timers[sx.name]); timers[sx.name] = setTimeout(() => notify({ type: 'timer-expired', name: sx.name }), sx.ms); return;
    case 'rerun-boot':                /* clear creds, restart boot sequence */ return;
  }
}

module.exports = { start, notify, _reduce: reduce, _STATES: STATES };
```

**Why this shape:**

1. **`reduce` is a pure function** — testable in isolation with no Electron, no FS, no timers. Unit tests are trivial: feed `(state, event, ctx)`, assert `(next, sideEffects)`.
2. **All side effects are structured data** — the executor walks them in order, so test failures point at exactly which side effect didn't fire.
3. **Single-threaded via Node's event loop** — `notify()` is synchronous, no race conditions, no need for a mutex. Even though the drain poll is async, every event ends up in `notify()` on the main-process JS thread one at a time.
4. **No XState, no observables, no library** — fits CLAUDE.md's "plain JS, no bundler, no TS" pin and matches the Phase 2 style of single-file modules with module-scoped state + exported guards.
5. **Re-injection idempotency** — the reducer doesn't care about page loads. `notify()` accepts the same event N times in a row and the reducer either acts on it (if state allows) or returns the current state unchanged.

## electron-store Atomicity (D-11, blocker question 7)

**[VERIFIED: electron-store README + npm package description](https://github.com/sindresorhus/electron-store)** **[CITED: web search confirmation 2026-04-09]**

**Verdict: a single `store.set({...multiple keys...})` call IS atomic.** Reasoning:

1. `electron-store` reads and writes the **entire JSON file on every change**. There is no "incremental write" — every `set` rewrites `config.json` end-to-end.
2. The package uses **atomic file writes** internally (write to temp file, then rename): if the process crashes mid-write, the existing file is preserved unchanged. This is a documented core feature of `electron-store`.
3. Calling `store.set({a: 1, b: 2, c: 3})` produces **exactly one rewrite of the file**. All three keys land in the same write or none of them do.
4. Calling `store.set('a', 1); store.set('b', 2); store.set('c', 3)` produces **three separate rewrites** — between any two of them, a crash leaves the file in an intermediate state with `a` set but not `b` or `c`.

**Mandatory pattern for Phase 3 first-run persistence:**

```javascript
// CORRECT — single atomic write
store.set({
  credentialsCiphertext: cipherB64,
  adminPin: { hash, salt, params },
});

// WRONG — three separate writes, crash window between them
store.set('credentialsCiphertext', cipherB64);
store.set('adminPinHash', hashHex);
store.set('adminPinSalt', saltHex);
```

**Recovery if a partial write somehow lands** (e.g. file corruption, disk full mid-write): on `BOOTING`, `authFlow` checks consistency:

```javascript
const hasCreds = store.has('credentialsCiphertext');
const hasPin   = !!store.get('adminPin');
if (hasCreds !== hasPin) {
  // Inconsistent state — should be impossible after the atomic-write fix,
  // but defend in depth. Treat as first-run and force re-entry.
  log.warn('auth.store.inconsistent: hasCreds=' + hasCreds + ' hasPin=' + hasPin);
  store.delete('credentialsCiphertext');
  store.delete('adminPin');
  // Falls through to NEEDS_CREDENTIALS
}
```

## Idempotency on Re-Injection (D-20, blocker question 12)

**[VERIFIED: code review of `inject.js:36-41` and `:140-141`]**

The Phase 2 idempotency guard works like this:

```javascript
if (window.__bskiosk_injected__) {
  try { if (window.__bskiosk_hideDynamic) window.__bskiosk_hideDynamic(); } catch (e) {}
  try { if (window.__bskiosk_detectReady) window.__bskiosk_detectReady(); } catch (e) {}
  return;
}
window.__bskiosk_injected__ = true;
```

**Critical observation:** `__bskiosk_injected__` is a property on `window`. `window` is **per-page**, not per-execution. When the user navigates to a NEW page (full navigation, not hash navigation), the old `window` is discarded and a fresh one is created — `__bskiosk_injected__` is `undefined` again, the IIFE runs end-to-end, and `readyEmitted` (a closure variable inside the IIFE) is freshly initialized to `false`.

When `did-navigate-in-page` fires (hash navigation, e.g. `/#/login` → `/#/cash-register`), `window` is the SAME — `__bskiosk_injected__` is still `true`, so the IIFE early-returns and only re-runs `hideDynamic` + `detectReady`. The closure variables `readyEmitted` and (Phase 3's new) `loginEmitted` are **preserved** across the re-injection.

**This is the correct semantics for Phase 3:**

| Scenario | What happens to `loginEmitted` | Is it correct? |
|----------|--------------------------------|----------------|
| Cold boot, fresh page load | Initialized to `false`, IIFE runs, `detectLogin` fires once → `loginEmitted = true` | ✅ |
| Hash navigation `/#/login` → `/#/cash-register` (after successful login) | Stays `true` (closure preserved), but `detectLogin` early-returns on the new hash anyway | ✅ |
| Hash navigation `/#/cash-register` → `/#/login` (e.g. session expired mid-session) | Stays `true`, **so detectLogin will NOT fire again** ❌ | **Needs fix** |
| Full page reload (e.g. `wc.reload()` after Phase 4 idle reset) | `window` is new, `__bskiosk_injected__` undefined, IIFE re-runs, `loginEmitted` reinitialized to `false` | ✅ |

**The hash-route-from-cash-register-back-to-login case is the trap.** Phase 4's idle reset uses a full reload (`session.clearStorageData() + reload()`), so this case is covered for Phase 4 — but if Magicline ever silently routes back to `/#/login` without a full reload (server-side 401, soft logout), the `loginEmitted` flag stays `true` and `detectLogin` never fires.

**Recommended fix in `detectLogin`:** make the dedupe a `lastEmittedHash` instead of a boolean.

```javascript
var lastLoginEmitForHash = null;
function detectLogin() {
  try {
    if (!location.hash) return;
    // Negative gate: do NOT fire if we are on a cash-register hash
    if (/^#\/cash-register(\/|$|\?)/i.test(location.hash)) return;
    // Positive gate: username field must be present
    var u = document.querySelector('[data-role="username"]');
    if (!u) return;
    // Dedupe by hash, not by a sticky boolean — re-emit on a fresh hash
    if (lastLoginEmitForHash === location.hash) return;
    lastLoginEmitForHash = location.hash;
    emit('login-detected', { url: location.hash });
  } catch (e) { /* swallow */ }
}
window.__bskiosk_detectLogin = detectLogin;
```

This is **structurally identical** to `detectReady` but with the dedupe key being the hash string rather than a boolean. The same fix should arguably be applied to `detectReady` for symmetry — but that is a Phase 2 concern, not Phase 3, and the planner should NOT touch `detectReady` unless they can show a Phase 4 reset breaks it. Phase 3 should ONLY introduce the `lastLoginEmitForHash` pattern in its new `detectLogin` function.

## Plaintext Audit Methodology (D-13, blocker question 9)

**Test approach (runnable on dev machine, not the real kiosk):**

1. **Use a known fake credential pair** that is unlikely to occur naturally in any code or log line:
   - Username: `bsk-audit-USER-9f3c2a1d@example.invalid`
   - Password: `bsk-audit-PASS-9f3c2a1d-aB%cD!eF`
2. **Drive a full first-run cycle programmatically** via a Node test script that:
   - Spawns the Electron app under `NODE_ENV=test`
   - Calls the IPC `submit-credentials` with `{firstRun: true, pin: '1234', username: <fake>, password: <fake>}`
   - Waits for `auth.state: NEEDS_CREDENTIALS -> BOOTING` to appear in the log
   - Sends SIGTERM to the Electron process
3. **Read the artifacts directly with Node `fs`:**
   ```javascript
   const config = fs.readFileSync(path.join(app.getPath('userData'), 'config.json'), 'utf8');
   const log    = fs.readFileSync(path.join(app.getPath('userData'), 'logs', 'main.log'), 'utf8');
   assert(!config.includes('bsk-audit-USER'), 'plaintext username in config.json');
   assert(!config.includes('bsk-audit-PASS'), 'plaintext password in config.json');
   assert(!log.includes('bsk-audit-USER'), 'plaintext username in main.log');
   assert(!log.includes('bsk-audit-PASS'), 'plaintext password in main.log');
   ```
4. **Assert no env var leakage:**
   ```javascript
   for (const k of Object.keys(process.env)) {
     assert(!/^MAGICLINE_/i.test(k), 'MAGICLINE_* env var detected: ' + k);
     assert(k !== 'BSF_CREDENTIALS', 'BSF_CREDENTIALS env var detected');
   }
   ```
5. **Run on the dev machine** — `app.getPath('userData')` resolves to whatever the dev OS uses (`%AppData%/Bee Strong POS/` on Windows, `~/Library/Application Support/Bee Strong POS/` on macOS). The audit is platform-agnostic because it just reads files via `fs`. The Windows-specific DPAPI behavior is what makes the encryption real, but the audit only checks "is the plaintext absent" which works identically on any platform.

**Caveat:** if the dev machine is macOS, `safeStorage` uses Keychain (not DPAPI) and the encrypted blob looks different — but the audit assertion ("plaintext is absent") is what matters and that holds on any backend. The DPAPI-vs-Keychain choice is a runtime check, not a test gap.

## Pitfalls (blocker question 14)

### 1. DPAPI master-key rotation on Windows password change

**[CITED: Microsoft Docs on DPAPI](https://learn.microsoft.com/en-us/windows/win32/api/dpapi/), Electron #33640](https://github.com/electron/electron/issues/33640)**

When the Windows user account's password changes via the Windows password reset flow (NOT a normal "change password" — that re-encrypts DPAPI keys with the new password), the DPAPI master key for that user is **invalidated**. Any data previously encrypted by `safeStorage.encryptString` becomes undecryptable. `safeStorage.decryptString` will **throw** (not return null, not return empty string).

**Phase 3 handling:** the `decrypt-failed` branch in `BOOTING` already covers this — transition to `CREDENTIALS_UNAVAILABLE`, surface the branded overlay, require admin PIN + re-entry of credentials. **The admin PIN hash itself is NOT DPAPI-encrypted (it's an scrypt hash, not DPAPI ciphertext), so the PIN gate still works after a Windows password reset.** Re-entering credentials writes a fresh DPAPI ciphertext under the new master key. This is the AUTH-05 happy path.

### 2. `safeStorage.isEncryptionAvailable()` returns false transiently before BrowserWindow exists

**[CITED: Electron #34614](https://github.com/electron/electron/issues/34614)**

In some Electron versions on Windows, `safeStorage.isEncryptionAvailable()` returns `false` if called before the first `BrowserWindow` has been created. Phase 3 must call it from `authFlow.start(mainWindow, ...)` which runs **after** `createMainWindow()` and `createMagiclineView()` — so this is satisfied by call ordering. **Plan must enforce: `authFlow.start` is called only inside `app.whenReady().then(...)` after both window-creation calls.**

### 3. `decryptString` "Error while decrypting the ciphertext"

**[CITED: Electron #32598](https://github.com/electron/electron/issues/32598)**

A reported bug where `decryptString` throws even when the ciphertext was just encrypted in the same session. Root cause is usually base64 round-trip corruption or storing the Buffer as a JS object (`{type: 'Buffer', data: [...]}`) instead of base64. **Phase 3 mitigation:** always serialize via `cipherBuf.toString('base64')` and deserialize via `Buffer.from(b64, 'base64')`. The §safeStorage Round-Trip Pattern above codifies this.

### 4. macOS password prompt regression (NOT relevant for Windows production but matters for dev on macOS)

**[CITED: Electron #43233](https://github.com/electron/electron/issues/43233)**

After certain Electron upgrades, `safeStorage` on macOS prompts the user for their login password the first time it's used. This does NOT affect Windows DPAPI (which uses the existing logon credential silently). It WILL affect dev work on a macOS dev machine — the dev will see a Keychain prompt the first time. **Documented expected behavior**, no Phase 3 work needed beyond a comment in the dev README.

### 5. `electron-store` schema validation pitfall

`electron-store` accepts a `schema` option that uses ajv. If a future Phase adds a schema and the existing on-disk `config.json` doesn't match (e.g. missing `adminPin` after a partial migration), `new Store({...})` **throws on construction**. Phase 3 should NOT add a schema in this phase — keep the store schema-less so `authFlow` can defensively handle missing keys. Schema can be added in Phase 5 once the shape is stable.

### 6. `webContents.executeJavaScript` JSON-injection risk for credentials

`authFlow` calls `wc.executeJavaScript('window.__bskiosk_fillAndSubmitLogin(' + JSON.stringify(user) + ',' + JSON.stringify(pass) + ')')`. **This is safe IFF `JSON.stringify` is used on every interpolated value.** `JSON.stringify` escapes quotes, backslashes, and control characters — a username containing `");window.evil(("` becomes a safely-quoted JS string literal. Do NOT use template literals or string concatenation without `JSON.stringify`.

### 7. Drain queue ordering between `login-submitted` and `cash-register-ready`

Both events go through the same 250 ms drain poll. If a single drain returns `[login-submitted, cash-register-ready]`, the executor processes them in array order. The reducer must handle the second event regardless of which came first — and it does, because the `LOGIN_SUBMITTED` state explicitly handles `cash-register-ready`. **No fix needed**, but the planner should add a unit test for "both events arrive in the same drain batch" explicitly.

### 8. `crypto.scryptSync` blocks the main process

`scryptSync` is **synchronous** and at N=16384 will block the main process for 100–300 ms on a kiosk CPU. This blocks the drain poll, the IPC, and any UI rendering. **Acceptable** for the PIN-verify path because (a) the user is staring at the PIN modal expecting "checking…", and (b) it happens only on PIN verify (rare). Do NOT call `scryptSync` on every boot for any other purpose. **Do NOT use the async `crypto.scrypt` instead** — the sync version is simpler and the latency is bounded. Document this with a comment.

### 9. PIN brute-force outside Phase 3 scope

D-10 explicitly defers rate-limiting to Phase 5. Phase 3's `verifyPin` is a single bcrypt-style scrypt comparison with no attempt counter. **This is correct per CONTEXT.md** but the planner should add a one-line comment in `adminPin.js` saying "rate-limit lockout is Phase 5 (ADMIN-03)" so it doesn't look like an oversight in code review.

### 10. Magicline cookie session persistence creates a "skip login" path

`persist:magicline` (Phase 2 D-14) persists cookies across reboots. If Magicline's session cookie is still valid on the next boot, Magicline serves `/#/cash-register` directly without ever showing the login page — `login-detected` never fires and `cash-register-ready` arrives directly. The reducer covers this in the `BOOTING` state via the `cash-register-ready` → `CASH_REGISTER_READY` direct transition. **No bug, but planner should add a unit test for this path.**

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Credential encryption | Custom AES + key derivation | `safeStorage` | DPAPI does it, audited, no key management for us |
| Password hashing | MD5/SHA-256/PBKDF2 by hand | `crypto.scryptSync` | Built-in, memory-hard, OWASP-recommended |
| Constant-time string compare | `===` or `Buffer.compare` | `crypto.timingSafeEqual` | Side-channel resistant, built-in |
| Atomic file write | `fs.writeFile` + temp + rename | `electron-store.set({...})` | Already atomic |
| State machine | Custom event emitter / observable | Plain switch reducer | XState is overkill for 7 states; CLAUDE.md bans extra deps |
| Soft keyboard | Full alpha-numeric on-screen keyboard | TabTip + manual launch button + 3×4 numeric keypad for PIN | Custom alpha softkeyboard is a phase of its own; punt to deferred phase if needed |
| Login form automation | Synthetic mousedown/mouseup/keyup sequences | Plain `el.click()` after `setMuiValue` | Prototype works with single CLICK action; React's synthetic event delegation handles plain `.click()` |
| Drain queue / event bus | New IPC channel for auth events | Reuse Phase 2's `__bskiosk_events` queue | Already proven, single source of truth, drift-isolated |
| Login failure detection | Read Magicline error banner DOM | `login-detected` re-firing + watchdog timeout | Banned by D-03 (selector drift); negative DOM signals are stable |

## Architecture Patterns

### Recommended Module Structure

```
src/
├── main/
│   ├── authFlow.js         # NEW — pure reducer + executor + module-scoped state
│   ├── adminPin.js         # NEW — verifyPin / setPin, scryptSync wrapping
│   ├── magiclineView.js    # MODIFIED — KNOWN_EVENT_TYPES + handleInjectEvent delegation to authFlow.notify
│   ├── main.js             # MODIFIED — call authFlow.start(mainWindow, store) after createMagiclineView
│   ├── preload.js          # MODIFIED — new contextBridge methods (see §Existing Patterns)
│   └── logger.js           # UNCHANGED — used by authFlow + adminPin
├── inject/
│   ├── inject.js           # MODIFIED — add detectLogin + __bskiosk_fillAndSubmitLogin
│   ├── fragile-selectors.js# MODIFIED — add 3 STABLE entries
│   └── inject.css          # UNCHANGED
└── host/
    ├── host.html           # MODIFIED — add #credentials-overlay + #pin-modal sibling divs on layer 400
    ├── host.css            # MODIFIED — add styles for credentials overlay + PIN keypad
    └── host.js             # MODIFIED — add IPC handlers for show/hide credentials, show PIN modal, submit
```

**Eight files modified, two files created.** Every other Phase 1/2 file is untouched.

### Pattern: Reducer + Executor Split

Already shown in §State Machine Reducer Shape. Key invariant: **the reducer is `(state, event, ctx) → (state, [side effects])` with NO side effects of its own.** Tests for the reducer don't import Electron, don't touch the filesystem, don't start timers — they just feed events and assert outputs. The executor is the only place that interacts with the outside world.

### Pattern: Variant-Tagged Overlay Reuse

Phase 2 added `#magicline-error` for drift. Phase 3 reuses it for two more variants instead of adding new layers:

```javascript
// Phase 3 IPC payloads
{ variant: 'drift',                   message: 'Kasse vorübergehend nicht verfügbar...' }
{ variant: 'credentials-unavailable', message: 'Anmeldedaten nicht verfügbar — Admin-PIN erforderlich' }
{ variant: 'login-failed',            message: 'Anmeldung fehlgeschlagen — Bitte Studio-Personal verständigen' }
```

`host.js` `showMagiclineError(payload)` switches on `payload.variant` to show/hide the "PIN eingeben" button (visible for `credentials-unavailable` and `login-failed`, hidden for `drift`).

### Anti-Patterns to Avoid

- **Stuffing PIN-modal logic into the credentials overlay.** They are sibling divs because they have different lifecycles: PIN modal → unlock → hide → credentials overlay → submit → hide. Two surfaces, two states, two divs.
- **Persisting `currentState` across reboots.** D-19 explicitly forbids this. The reducer is stateless across process restarts; cookie session is the only thing that persists.
- **Calling `safeStorage.encryptString` outside `app.whenReady()`.** Will return false / throw on Windows. All `authFlow` work happens inside the `whenReady` callback chain.
- **Reading Magicline DOM error banners.** D-03 banned this. Stick to negative signals (selectors absent or re-appeared).
- **Adding `Ctrl+Shift+F12` registration in Phase 3.** That's Phase 5. The PIN modal is invoked by the "PIN eingeben" button on the error overlay, not by a hotkey, in Phase 3.

## Code Examples

### Adding the new event types to the whitelist

```javascript
// src/main/magiclineView.js — MODIFIED
const KNOWN_EVENT_TYPES = new Set([
  'drift',
  'cash-register-ready',
  'observer-scope-fallback',
  'observer-attach-failed',
  'login-detected',     // NEW — Phase 3
  'login-submitted',    // NEW — Phase 3
]);

// In handleInjectEvent — append after the existing cash-register-ready block:
if (type === 'login-detected' || type === 'login-submitted') {
  try {
    require('./authFlow').notify({ type: type, payload: payload });
  } catch (e) {
    log.error('magicline.authFlow.notify failed: ' + (e && e.message));
  }
  return;
}
```

### Adding `detectLogin` to inject.js

```javascript
// src/inject/inject.js — INSIDE the main IIFE, mirroring detectReady at :140-161
var lastLoginEmitForHash = null;
function detectLogin() {
  try {
    if (!location.hash) return;
    if (/^#\/cash-register(\/|$|\?)/i.test(location.hash)) return;
    var u = document.querySelector('[data-role="username"]');
    if (!u) return;
    if (lastLoginEmitForHash === location.hash) return;
    lastLoginEmitForHash = location.hash;
    emit('login-detected', { url: location.hash });
  } catch (e) { /* swallow */ }
}
window.__bskiosk_detectLogin = detectLogin;

// At the end of the IIFE, alongside the existing initial pass:
detectLogin();

// And in the idempotency-guard re-entry block at the top, alongside detectReady:
if (window.__bskiosk_injected__) {
  try { if (window.__bskiosk_hideDynamic) window.__bskiosk_hideDynamic(); } catch (e) {}
  try { if (window.__bskiosk_detectReady) window.__bskiosk_detectReady(); } catch (e) {}
  try { if (window.__bskiosk_detectLogin) window.__bskiosk_detectLogin(); } catch (e) {}  // NEW
  return;
}
```

### Adding the three stable selectors to fragile-selectors.js

```javascript
// src/inject/fragile-selectors.js — APPEND to STABLE_SELECTORS
var STABLE_SELECTORS = [
  // ... existing entries ...
  { category: 'stable', selector: '[data-role="toolbar"] [data-role="icon-button"]', purpose: 'Toolbar three-dot icon button' },
  // NEW Phase 3 entries:
  { category: 'stable', selector: '[data-role="username"]',     purpose: 'Login: username field' },
  { category: 'stable', selector: '[data-role="password"]',     purpose: 'Login: password field' },
  { category: 'stable', selector: '[data-role="login-button"]', purpose: 'Login: submit button' },
];
```

**Note:** the EMBED-05 self-check at `inject.js:106-124` runs from `detectReady` (cash-register-page only). Phase 3 needs the selfCheck to ALSO run on the login page so the new STABLE entries report drift if Magicline renames them. **Recommendation:** call `selfCheck()` from inside `detectLogin()` after a successful emit, mirroring how `detectReady` calls it after its emit. The selectors not relevant on the login page (e.g. `[data-role="customer-search"]`) will report zero matches and emit drift events — **so the selfCheck logic must filter by which page is active**, OR the planner must split the selector lists by page applicability. Simplest approach: tag each entry with `appliesOn: 'login' | 'cash-register' | 'both'` and have selfCheck filter by current page.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|-------------|-----------|---------|----------|
| `electron` (with `safeStorage` API) | All credential encryption | ✓ | `^41.1.1` (CLAUDE.md pin) | None — required |
| `electron-store` | Persisted config | ✓ | `^10.1.x` (CJS, CLAUDE.md pin) | None — required |
| `electron-log` | Auth state logging | ✓ | `^5.2.x` (logger.js already imports) | None — required |
| Node.js `crypto` (built-in) | scrypt + timingSafeEqual + randomBytes | ✓ | bundled with Electron 41 | None |
| `tabtip.exe` (Windows touch keyboard) | Credential overlay text input | ⚠ Unreliable under Assigned Access | Windows 10/11 built-in | **3×4 numeric keypad for PIN** + manual "Tastatur" launch button for credentials. If both fail → deferred custom-softkeyboard phase |
| Real kiosk hardware for scrypt benchmark | Tuning N parameter | ⚠ Not available at planning time | — | Use conservative N=16384 and tune in Wave 0 on the actual device |

**Missing dependencies with no fallback:** none — every required runtime dependency is already in Phase 1/2 stack.

**Missing dependencies with fallback:** TabTip (covered above).

## Open Questions

All 15 blocker questions from the additional_context section are addressed in the body of this research. Two notes:

1. **The exact kiosk CPU is still unknown** — scrypt parameters are conservatively chosen at N=16384 with a measure-and-tune protocol baked into the plan. If the planner can get a CPU spec from the operator before Wave 0, that lets us pre-tune; otherwise the Wave 0 task does it on the device.
2. **The Magicline login page failure UX is unverified** — we know Magicline does NOT serve a hard 401, we know it stays at `/#/login` on a bad credential, but the exact DOM behavior on a failed login is not documented. The Phase 3 plan should include a one-time observation task ("submit deliberately wrong credentials, observe what Magicline does in the DOM") in Wave 0 alongside the TabTip test, and the watchdog-vs-redetect failure detection is robust to either case (form re-renders OR form stays put).

**No blockers remain** — the architecture is buildable as described.

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | Plain `el.click()` works for `[data-role="login-button"]` (no synthetic mousedown/up needed) | §Login Click Semantics | LOW — prototype's Fully Kiosk single-CLICK action confirms it works in production. If wrong, fall back to `dispatchEvent(new MouseEvent('click', {bubbles: true}))` or full mousedown→mouseup→click sequence |
| A2 | 8 s post-submit watchdog is enough for kiosk Wi-Fi RTT | §Watchdog Timing | LOW — 3× headroom over typical 2.5s flow. If wrong, bump to 12 s. Reset cycles will reveal it during Wave 0 testing |
| A3 | scrypt N=16384 gives ~100–300 ms on the kiosk CPU | §scrypt Parameters | LOW — built-in measure-and-tune protocol catches it. Persisted params field future-proofs adjustments |
| A4 | Magicline's login failure DOM is detectable as either (a) `login-detected` re-firing or (b) watchdog timeout | §Login Failure Detection | MEDIUM — neither has been observed against Magicline's actual failed-login UI. Both paths handle both failure modes, so the worst case is we always rely on the watchdog (slow but reliable) |
| A5 | The German login-failed copy "Anmeldung fehlgeschlagen — Bitte Studio-Personal verständigen" matches Bee Strong brand voice | §User Constraints / D-08 | NONE — operator confirms during plan-check or post-deploy edit |
| A6 | TabTip auto-invoke under Assigned Access can be made to work with `EnableDesktopModeAutoInvoke=1` | §Windows TabTip Verdict | HIGH — Microsoft Q&A and Electron #8037 explicitly say it is unreliable. **Mitigation: 3×4 numeric keypad for PIN modal removes this assumption entirely for the AUTH-05 critical path. Credentials overlay uses manual "Tastatur" button as fallback.** |
| A7 | The kiosk has a Windows account with DPAPI master key intact at install time | §safeStorage Round-Trip | LOW — Phase 1 OS hardening runbook creates the kiosk user; first-run captures credentials under that user. Documented in admin runbook |
| A8 | `wc.executeJavaScript('window.__bskiosk_fillAndSubmitLogin(' + JSON.stringify(u) + ',' + JSON.stringify(p) + ')')` is safe against credentials containing single/double quotes/backslashes | §Pitfalls #6 | NONE — `JSON.stringify` handles all JS string escaping correctly by spec |
| A9 | First-run-only PIN-setup fields (`Admin-PIN`, `PIN wiederholen`) on the credentials overlay are not confusing for the operator | §User Constraints / D-11 | NONE — clear field labels in German + first-run is one-time per device |
| A10 | The Magicline login page's `[data-role]` contracts (`username`, `password`, `login-button`) are stable across Magicline updates | §Existing Patterns | LOW — these are documented in the prototype as stable per `BeeStrong_POS_Kiosk_Project.md:55-58`. Drift mitigation: `selfCheck` reports drift via `fragile-selectors.js` STABLE entries → operator notified via overlay |

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `keytar` for credentials | Electron `safeStorage` | Dec 2022 (keytar archived) | CLAUDE.md pin already enforces this — no native compilation, no per-Electron rebuild |
| `bcrypt` native module for password hashing | Built-in `crypto.scryptSync` | Node ≥10 has scrypt; OWASP recommends scrypt over bcrypt as of 2024 | Zero native deps for Phase 3 |
| Persisted state machine across reboots | Stateless reducer, fresh `BOOTING` every cold start | This phase | Simpler, idempotent, no migration headaches |

**Deprecated/outdated:**
- `keytar` — archived; never use
- `bcrypt` (native) — fine but adds compilation; scrypt is built-in and at least as strong
- `node-machine-id` for fingerprinting (not relevant here, just noting we don't need it)

## Sources

### Primary (HIGH confidence)

- [Electron safeStorage docs](https://www.electronjs.org/docs/latest/api/safe-storage) — DPAPI on Windows, encryptString returns Buffer, isEncryptionAvailable semantics
- [electron-store on GitHub](https://github.com/sindresorhus/electron-store) — atomic file write, single `set({...})` is atomic
- [Node.js crypto.scryptSync docs](https://nodejs.org/api/crypto.html) — N/r/p/maxmem semantics, timingSafeEqual
- [Codebase: src/inject/inject.js, src/main/magiclineView.js, src/main/main.js, src/main/preload.js, src/host/host.html, src/host/host.css, src/host/host.js, src/main/logger.js, src/inject/fragile-selectors.js] — read in this session, all line refs verified

### Secondary (MEDIUM confidence)

- [Microsoft Q&A — Single-app Kiosk on Windows 11, on-screen keyboard does not appear](https://learn.microsoft.com/en-us/answers/questions/5606954/single-app-kiosk-mode-on-windows-11-on-screen-keyb) — TabTip auto-invoke unreliable for non-UWP apps under Assigned Access; documents `EnableDesktopModeAutoInvoke` registry knob and its limitations
- [Electron #8037 — Cannot open Windows 10 Touch Keyboard from Electron](https://github.com/electron/electron/issues/8037) — long-standing TabTip integration issues
- [Electron #21816 — child_process.exec start tabtip.exe is not shown](https://github.com/electron/electron/issues/21816) — manual TabTip launch fails in some Windows versions
- [Electron #34614 — safeStorage use is invalid prior use of a BrowserWindow](https://github.com/electron/electron/issues/34614) — must call after first BrowserWindow creation
- [Electron #33640 — safeStorage.isEncryptionAvailable() returns false in Windows](https://github.com/electron/electron/issues/33640) — DPAPI master key edge cases
- [Electron #32598 — safeStorage.decryptString error while decrypting the ciphertext](https://github.com/electron/electron/issues/32598) — base64 round-trip pitfall
- [Electron #43233 — macOS password prompt when using safeStorage after upgrade](https://github.com/electron/electron/issues/43233) — dev-machine-only, not Windows
- [Freek Van der Herten — Replacing Keytar with Electron's safeStorage in Ray](https://freek.dev/2103-replacing-keytar-with-electrons-safestorage-in-ray) — migration pattern + base64 wrap pattern

### Tertiary (LOW confidence — context only)

- [nodejs/node #28755 — maxmem maximum reconsideration](https://github.com/nodejs/node/issues/28755) — context for the 64MB maxmem ceiling choice
- General OWASP scrypt recommendations (knowledge cutoff May 2025) — N=2^15 for server, N=2^14 acceptable for interactive

## Project Constraints (from CLAUDE.md)

These directives constrain the plan and override any conflicting recommendation:

- **Stack pins:** Electron `^41.1.1` (already installed), Node `>=20.18 LTS`, `electron-store@^10.1.x` CJS line (do NOT bump to 11.x ESM), `electron-log@^5.2.x`, plain HTML/CSS/JS for overlays
- **Forbidden:** plaintext credentials on disk, `keytar`, `node-hid`, `robotjs`, React/Vue/Svelte for kiosk overlays, Webpack/Vite/esbuild for main process, TypeScript, Sentry/Bugsnag, `electron-reload`, `auto-launch` package, custom Chromium "disable shortcuts" flags, hand-built native input simulation
- **Required:** `safeStorage` for credential encryption, `crypto.scryptSync` (built-in) for PIN hashing, `crypto.timingSafeEqual` for PIN comparison, `electron-store.set({...})` for atomic multi-key writes, all logs through the shared `electron-log` instance in `src/main/logger.js`
- **Testing:** plain JS test approach for the reducer (no Jest/Vitest dependency unless already in `devDependencies` — check `package.json` at plan time)
- **No bundler for inject:** `src/inject/*.js` are read with `fs.readFileSync` at require time and concatenated as raw strings — keep this pattern
- **GSD workflow:** all file edits go through GSD commands (handled by the orchestrator)

## Metadata

**Confidence breakdown:**
- Standard stack: HIGH — all pins are CLAUDE.md-locked and verified in package.json/lockfile (per Phase 1 work)
- Architecture / reducer shape: HIGH — single-source code review of Phase 2 patterns shows the slot exists exactly as CONTEXT.md describes
- safeStorage round-trip pattern: HIGH — Electron docs + Freek Van der Herten + multiple GitHub issues converge
- electron-store atomicity: HIGH — README explicit, search-confirmed
- TabTip under Assigned Access: MEDIUM (verdict: unreliable; mitigation defined). Risk fully transferred to deferred phase if mitigation fails on real hardware
- scrypt parameters: MEDIUM (conservative starting point + measure-and-tune protocol)
- Login click semantics: MEDIUM (assumed from prototype behavior, no live observation)
- Magicline failure DOM: MEDIUM (two-path failure detection covers both possibilities)

**Research date:** 2026-04-09
**Valid until:** 2026-05-09 (30 days — Electron 41 is the current stable line; safeStorage API is stable; the only fast-moving piece is Magicline DOM which is monitored continuously by `selfCheck`)
