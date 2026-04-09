# Phase 3: Credentials & Auto-Login State Machine - Context

**Gathered:** 2026-04-09
**Status:** Ready for research → planning

<domain>
## Phase Boundary

On every boot and after every session reset, the kiosk (a) stores its Magicline credentials at rest as a DPAPI-encrypted blob via Electron `safeStorage`, and (b) drives itself through a deterministic state machine — BOOTING → LOGIN_DETECTED → LOGIN_SUBMITTED → CASH_REGISTER_READY — so the member sees splash → cash register with no flash of login wall, no staff intervention, and no plaintext secrets on disk. First-run credential entry, failed-login handling, and the `safeStorage`-unavailable recovery path are all in-scope.

Scope ends at: cash-register-ready fires (Phase 2 already owns that detection). Idle reset, NFC input, session-expiry detection, and the full admin menu UI are out of scope — Phase 3 ships **only** the minimal PIN gate needed for AUTH-05 recovery, which Phase 5 will reuse and extend.

</domain>

<decisions>
## Implementation Decisions

### State Machine Ownership & Location

- **D-01:** The auth state machine lives in a new main-process module `src/main/authFlow.js`. States: `BOOTING` → `NEEDS_CREDENTIALS` (first-run only) → `LOGIN_DETECTED` → `LOGIN_SUBMITTED` → `CASH_REGISTER_READY` | `LOGIN_FAILED` | `CREDENTIALS_UNAVAILABLE`. `authFlow` is the single source of truth — inject.js only emits signals, never holds state. This preserves Phase 2's drift-patch blast radius (D-11): inject.js stays thin, state lives in main where it is testable and loggable.

- **D-02:** `authFlow` subscribes to the **same 250 ms drain-queue poll** that Phase 2's `magiclineView.js` already runs. No new polling loop. Phase 3 extends the existing drain by adding new event types Phase 2 emits (see D-03) and new handlers in `handleInjectEvent`. Implementation question for the planner: either (a) extend `magiclineView.handleInjectEvent` to `require('./authFlow').notify(evt)` for auth-related types, or (b) refactor the drain into a tiny event-bus module both consume. Either is acceptable — pick the smaller diff.

- **D-03:** Two new event types join Phase 2's `KNOWN_EVENT_TYPES` whitelist in `magiclineView.js`:
  - `login-detected` — emitted once per page load when `[data-role="username"]` is live AND `location.hash` is NOT on the cash-register path. Payload: `{ url }`.
  - `login-submitted` — emitted immediately after the login button click in inject.js, so the main process knows "the submit actually fired" independently of whatever Magicline does next. Payload: `{ url }`.
  - A `cash-register-ready` event (already emitted by Phase 2) is the SUCCESS terminal for `LOGIN_SUBMITTED`.
  - No `login-failed` event from inject.js — failure is detected by `authFlow` as "still seeing login-detected after T ms post-submit", not by DOM-reading Magicline error banners (selectors would drift).

### Login Detection (inject.js side, minimal diff)

- **D-04:** `src/inject/inject.js` adds a `detectLogin()` helper that mirrors `detectReady()`: gated on `[data-role="username"]` being present AND `location.hash` not matching the cash-register regex. Emits `login-detected` exactly once per page load (deduped by a module-level flag, reset on idempotent re-injection guard unlike `readyEmitted`). Also exposes `window.__bskiosk_fillAndSubmitLogin(user, pass)` — a main-world helper that:
  1. queries `[data-role="username"]`, `[data-role="password"]`, `[data-role="login-button"]`,
  2. calls the existing `window.__bskiosk_setMuiValue` on each input (already exposed by Phase 2 for this exact reuse),
  3. waits one `requestAnimationFrame` so MUI state settles,
  4. clicks the login button,
  5. emits `login-submitted`.

  The helper is invoked by `authFlow` via `webContents.executeJavaScript('window.__bskiosk_fillAndSubmitLogin(...)')` with the credentials interpolated at call-time. Credentials are **never** persisted in inject.js scope.

- **D-05:** `fragile-selectors.js` gains three new STABLE entries: `[data-role="username"]`, `[data-role="password"]`, `[data-role="login-button"]`. These are Magicline's own stable data-role contracts, identical in spirit to the Phase 2 `product-search` selector. They participate in the EMBED-05 self-check on the login page (selfCheck must run in both "login visible" and "cash register ready" states — Phase 3 extends the self-check trigger, not the selector list format).

### State Machine Behavior (main-process side)

- **D-06:** On `BOOTING`, `authFlow` checks `safeStorage.isEncryptionAvailable()`:
  - `false` → transition directly to `CREDENTIALS_UNAVAILABLE`, show branded error overlay (see D-09). No further Magicline interaction until admin recovery.
  - `true` → attempt to load + decrypt the blob from `electron-store` key `credentialsCiphertext`.
    - Missing key → transition to `NEEDS_CREDENTIALS` (first run). Raise IPC `show-credentials-overlay` with `{ firstRun: true }`. Host renders the overlay on layer 400.
    - Decrypt throws → transition to `CREDENTIALS_UNAVAILABLE`. Same outcome as `isEncryptionAvailable === false`. Log the error class but not the blob.
    - Decrypt succeeds → hold creds in a module-scoped variable (`let creds = null` cleared on every state reset), wait for `login-detected` from the drain.

- **D-07:** On `login-detected` while holding decrypted creds, `authFlow`:
  1. Transitions `LOGIN_DETECTED`.
  2. Calls `wc.executeJavaScript('window.__bskiosk_fillAndSubmitLogin(' + JSON.stringify(user) + ',' + JSON.stringify(pass) + ')')`.
  3. Starts an 8-second watchdog timer. On `login-submitted` from the drain, restarts the watchdog for another 8 s looking for `cash-register-ready`.
  4. On `cash-register-ready` → `CASH_REGISTER_READY` terminal. Phase 2 already handles splash lift; `authFlow` just logs the transition.
  5. On watchdog expiry OR `login-detected` firing a second time after a submit → increment retry counter.

- **D-08:** Retry policy: **up to 3 total submit attempts** with a 2-second backoff between attempts. On the 3rd failure, transition to `LOGIN_FAILED`, raise IPC `show-magicline-error` with a `LOGIN_FAILED` variant message (German: "Anmeldung fehlgeschlagen — Bitte Studio-Personal verständigen"), and suppress any subsequent `cash-register-ready` by reusing Phase 2's `driftActive`-style one-shot guard (`authFailedActive`). Recovery = admin PIN → re-enter credentials (same path as AUTH-05). Retry counter resets only on a successful `cash-register-ready` OR on a fresh admin recovery.

- **D-09:** `CREDENTIALS_UNAVAILABLE` and `LOGIN_FAILED` both render via the **same `#magicline-error` sibling div Phase 2 already added to `host.html`**. Phase 3 does not add a new z-index layer for the error surface; it extends the existing layer with a message-variant parameter on the `show-magicline-error` IPC. The error screen gets a new "PIN eingeben" touch button that IPCs back to `authFlow` to start the admin-recovery flow (D-10). Phase 2's drift error keeps the same overlay with no PIN button — differentiated by the IPC payload (`{ variant: 'drift' | 'credentials-unavailable' | 'login-failed' }`).

### Minimal Admin PIN Gate (AUTH-05 dependency)

- **D-10:** Phase 3 ships the **minimum PIN surface** needed to unblock AUTH-05 recovery — NOT the full Phase 5 admin menu. Surface:
  - A scrypt hash stored in `electron-store` under `adminPinHash`. Phase 3 uses Node's built-in `crypto.scryptSync` — no native deps, no new packages. Salt is a random 16-byte buffer stored alongside the hash.
  - A main-process helper `src/main/adminPin.js` exporting `verifyPin(input)` and `setPin(newPin)`. Both are sync, deterministic, and the ONLY entry points to PIN state.
  - A "PIN eingeben" modal on host layer 400 (sibling div in `host.html`, handled by `host.js`). Numeric-only input, 4–6 digits, 44×44 touch buttons.
  - On successful PIN verify from `CREDENTIALS_UNAVAILABLE` or `LOGIN_FAILED` state, transition to `NEEDS_CREDENTIALS` and raise the credentials overlay with `{ firstRun: false }` (same overlay, no PIN-setup fields).
  - **Phase 5 contract:** Phase 5's admin menu module will `require('./adminPin')` and reuse `verifyPin` / `setPin` as-is. Phase 5 adds the admin *menu UI* (Exit, Reload, View logs, Check for updates) — the gate itself does not change.

- **D-11:** First-run credential capture ALSO captures the initial admin PIN on the same overlay. Fields: `Admin-PIN (4–6 Ziffern)`, `PIN wiederholen`, `Magicline Benutzername`, `Magicline Passwort`. Single "Speichern & Anmelden" submit persists the PIN hash + credentials ciphertext atomically (both writes succeed or the state rolls back — research should confirm `electron-store` write atomicity; if not atomic, wrap in a single `store.set({...})` object write). `NEEDS_CREDENTIALS` is the only state that shows the PIN-setup fields; all subsequent re-entries from AUTH-05 recovery show credentials-only (PIN already set).

### Credentials Storage (AUTH-01, AUTH-02)

- **D-12:** `safeStorage.encryptString(JSON.stringify({ username, password }))` → base64 → persisted in `electron-store` under key `credentialsCiphertext`. The JSON wrapper lets the decrypt side recover both fields atomically without a second key. Store file lives at `%AppData%/Bee Strong POS/config.json` (same store instance Phase 2 already opens with `new Store({ name: 'config' })` in `main.js`). No second store file — one `config.json` holds `magiclineZoomFactor`, `credentialsCiphertext`, `adminPinHash`, and `adminPinSalt`.

- **D-13:** **Audit requirement (AUTH-01):** Phase 3's verification step must grep `%AppData%/Bee Strong POS/config.json` AND `%AppData%/Bee Strong POS/logs/main.log` for the test username and password after a full boot cycle, asserting zero plaintext matches. This is an explicit test task in the plan, not a "trust the API" assumption. Also assert no `process.env` variable named `MAGICLINE_*` or `BSF_CREDENTIALS` exists at runtime.

### Credentials Overlay UI (owned by host, not Magicline)

- **D-14:** The credentials overlay is a **sibling `<div id="credentials-overlay">` inside `host.html`** on z-index layer 400 (already reserved by Phase 2 in the host.html ladder comment: *"400 — Phase 3/5 credentials + admin PIN modal"*). It is rendered by `host.js` in response to the new IPC `show-credentials-overlay` / `hide-credentials-overlay`. No separate BrowserWindow, no iframe, no React — plain HTML + CSS consistent with Phase 1's splash and Phase 2's error overlay.

- **D-15:** Overlay fields (re-entry mode — AUTH-05 recovery):
  - `Magicline Benutzername` (text input, required, trim)
  - `Magicline Passwort` (password input, required, with a show/hide toggle icon button, 44×44)
  - `Speichern & Anmelden` primary button (disabled until both fields non-empty)
  - Inline error text slot below the fields for Magicline rejection messages from the `LOGIN_FAILED` state

  First-run mode adds two leading fields:
  - `Admin-PIN (4–6 Ziffern)` (numeric input, minlength 4, maxlength 6)
  - `PIN wiederholen` (numeric input, must equal the above — inline mismatch error)

- **D-16:** Submit is synchronous from the UI's perspective: click → disable button → IPC `submit-credentials` with `{ firstRun, pin?, username, password }` → main encrypts + stores → main transitions `authFlow` to `BOOTING` which immediately re-reads the store and resumes the flow. If the very next login attempt fails (wrong credentials), the operator sees the same overlay re-raised with the inline error text — no double-modal, no toast, no separate "login in progress" screen (the splash stays up underneath, which is already the visual cue).

- **D-17:** **Windows TabTip / touch keyboard strategy:** rely on Windows' built-in on-screen keyboard (TabTip) to pop automatically when a form input gains focus under the kiosk user account. **No custom softkeyboard is built in Phase 3.** Research must verify TabTip actually fires under the Assigned Access kiosk profile — if it does not, the overlay is unusable on the real touchscreen and TabTip unavailability becomes a **blocker** that routes to a deferred "custom softkeyboard" phase. Treat this as a **phase-opening research task**, not a "discover at verification time" surprise.

### Logging (audit trail for AUTH-04)

- **D-18:** Every state transition logs one structured line through Phase 1's shared `electron-log` instance, format: `log.info('auth.state: ' + prev + ' -> ' + next + ' reason=' + reason)`. Never log credentials, never log the PIN, never log the ciphertext length. `reason` is a short enum (`boot`, `creds-loaded`, `login-detected`, `submit-fired`, `watchdog-expired`, `retry`, `max-retries`, `pin-ok`, `pin-bad`, `safestorage-unavailable`, `decrypt-failed`). This log stream is the AUTH-04 verification artifact — the phase acceptance test tails the log during a reset cycle and asserts the expected transition sequence.

### Session Reset Behavior (seam with Phase 4)

- **D-19:** Phase 3 does NOT clear Magicline's `persist:magicline` session — that is Phase 4's job on idle reset. Phase 3 only cares about auto-login running correctly WHEN Magicline happens to show a login page, regardless of how the login page got there. The state machine is therefore stateless across reboots: no persisted `currentState` key, no "resume where we left off" logic. On every `app.whenReady()`, `authFlow` starts at `BOOTING`. This is important: it means Phase 4's idle-reset-induced session wipe just causes Magicline to re-serve the login page, and Phase 3's normal `login-detected` flow handles it without a special branch.

- **D-20:** `authFlow` must be **idempotent under re-injection**. Phase 2 re-runs `executeJavaScript(INJECT_BUNDLE)` on every `dom-ready` and `did-navigate-in-page`; `detectLogin` emits `login-detected` once per page load guarded by a module-level flag reset on each page's initial execution (not on the idempotency guard re-entry). authFlow's own retry counter is scoped to a single login attempt cycle, not the lifetime of the process.

### Magicline reCAPTCHA constraint (discovered Wave 0)

- **D-21:** Magicline serves a Google reCAPTCHA v2 "I'm not a robot" checkbox after **the very first failed login attempt**. Discovered by Probe B in plan 03-01 — not anticipated by 03-RESEARCH. The exact error banner text is: *"Benutzername oder Passwort sind nicht korrekt oder es gab zuvor einen fehlerhaften Login-Versuch. Überprüfe bitte die Eingabe und bestätige zusätzlich die 'Ich bin kein Roboter'-Checkbox."* reCAPTCHA v2 is purpose-built to defeat scripted clicks — no injection workaround exists. This has three binding implications for Phase 3 design:

  1. **No auto-retry.** `authFlow` MUST NOT have any retry-on-failure branch, not even a single retry. D-20's phrase "retry counter scoped to a single login attempt cycle" is hereby reduced to: there is no retry at all. Any login failure transitions straight to `CREDENTIALS_UNAVAILABLE`, the cached ciphertext is cleared, and the branded error overlay asks for admin PIN. This is **Option A** selected on 2026-04-09.

  2. **Primary failure signal is text-match, not just watchdog.** Because the error banner includes a deterministic German substring, the fastest reliable failure signal is a MutationObserver on that substring. The watchdog (6-8 s) stays as a fallback in case Magicline rewords the banner during a future update.
     - Primary: observe for substring `'Benutzername oder Passwort sind nicht korrekt'` in the document text
     - Fallback: watchdog timer armed at `fillAndSubmitLogin`, disarmed on `CASH_REGISTER_READY`
     - Either signal emits `login-failed`, which the state machine handles identically
     - The substring lives in `src/inject/fragile-selectors.js` as `LOGIN_ERROR_SUBSTRING` so Magicline drift is easy to fix.

  3. **Admin-mediated recovery is the ONLY recovery path.** When the kiosk hits a login failure (DPAPI rotation, Magicline-side password change, injection-level drift), the child `WebContentsView` will already be showing the reCAPTCHA box from Magicline's response to our failed submit. The recovery UX is:
     - Clear `credentialsCiphertext`
     - Transition `authFlow` to `CREDENTIALS_UNAVAILABLE`
     - Host renders the `credentials-unavailable` variant of the error overlay with "PIN eingeben"
     - Admin enters PIN → credentials overlay opens
     - While the credentials overlay is up, the child Magicline view still has reCAPTCHA showing underneath; when the admin hits "Speichern & Anmelden", the credentials overlay TEMPORARILY hides (without clearing its form state) and passes focus to the child view so the admin can tap "I'm not a robot" → the overlay returns → the admin clicks submit again.
     - Alternative (simpler MVP): on first admin attempt after PIN unlock, authFlow issues the injected submit WITHOUT re-showing the overlay's "submitting..." state until the admin has physically tapped reCAPTCHA in the child view. Plan 03-06 picks the exact UX.

  Follow-ups this creates:
  - `src/inject/fragile-selectors.js` gains `LOGIN_ERROR_SUBSTRING` (plan 03-05)
  - `src/inject/inject.js` emits a new `login-failed` signal from a text-match MutationObserver (plan 03-05)
  - `authFlow.js` removes any retry logic (plan 03-04, below)
  - `host.js` credentials overlay gains a "yield to child view for reCAPTCHA" affordance (plan 03-06)
  - `03-08-ACCEPTANCE.md` Test 5 walks through the reCAPTCHA tap during PIN recovery

### Claude's Discretion

- Exact wording on the `LOGIN_FAILED` message variant (match Bee Strong brand tone, German, match Phase 2's drift-message style).
- Scrypt cost parameters (`N`, `r`, `p`) — pick a pair that gives ~100 ms verify on the kiosk CPU, not the dev machine. Research output.
- Whether `fillAndSubmitLogin` should `await` a brief MutationObserver on the button to confirm it actually left the DOM (success signal) before emitting `login-submitted`, or whether a plain click + single rAF is enough. Prototype behavior probably answers this — planner checks `BeeStrong_POS_Kiosk_Project.md`.
- Whether the credentials overlay's show/hide password toggle uses an SVG eye icon vs text "Zeigen" / "Verbergen" — brand taste.
- Whether `adminPinHash` and `adminPinSalt` are stored as two sibling keys or a single `{hash, salt, params}` object. Single object is cleaner; pick one.
- The exact refactor shape of the drain-queue event handling when `authFlow` joins — tiny event-bus module vs direct `authFlow.notify` call from `magiclineView.handleInjectEvent`.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

### Project Context
- `.planning/PROJECT.md` — full project vision, prescriptive stack, "no plaintext credentials" non-negotiable
- `.planning/REQUIREMENTS.md` §Auth — AUTH-01 through AUTH-06 requirement text
- `.planning/ROADMAP.md` §Phase 3 — goal, success criteria, Phase 2/4 dependencies
- `CLAUDE.md` — stack pins (Electron ~41.1.1, `safeStorage` over `keytar`, `electron-store@^10.1.x` CJS, plain JS, no bundler)
- `BeeStrong_POS_Kiosk_Project.md` — contains any prototype login form automation the planner should port verbatim (same philosophy as Phase 2's verbatim port)

### Phase 1 Interface
- `.planning/phases/01-locked-down-shell-os-hardening/01-CONTEXT.md` — `host.html` layered structure, z-index ladder (layer 400 reserved for Phase 3 credentials + admin PIN), `reservedShortcuts` Set (Phase 3 does NOT add to it — admin hotkey is Phase 5)
- `src/main/main.js:89-166` — `app.whenReady` orchestration; Phase 3 must wire `authFlow.start(mainWindow)` after `createMagiclineView` returns, so the drain subscription is live from the start
- `src/main/logger.js` — shared `electron-log` instance for all auth transition logs
- `src/main/preload.js` — `contextBridge` surface `window.kiosk`; Phase 3 adds `onShowCredentialsOverlay`, `onHideCredentialsOverlay`, `submitCredentials`, `onShowPinModal`, `verifyPin`, plus a variant param on `onShowMagiclineError`

### Phase 2 Interface (must read — Phase 3 hooks into these exactly)
- `.planning/phases/02-magicline-embed-injection-layer/02-CONTEXT.md` — D-03/D-04 (splash lift one-shot semantics — Phase 3's auto-login runs UNDER the splash), D-06 (error overlay IPC), D-10 (inject file layout), D-11 (drift-patch blast radius — Phase 3 must justify any `src/inject/` edits), D-14 (`persist:magicline` partition — Phase 3 does NOT clear it)
- `.planning/phases/02-magicline-embed-injection-layer/02-RESEARCH.md` — Pattern 5 drain-queue pattern that Phase 3 reuses; re-injection cadence; whitelist of allowed event types
- `src/main/magiclineView.js` — `KNOWN_EVENT_TYPES`, `handleInjectEvent`, `startEventDrain`, `DRAIN_EXPR`. **Phase 3 extends this module or wraps its drain — do NOT build a second drain loop.**
- `src/inject/inject.js` — `window.__bskiosk_setMuiValue` (reuse directly), `emit()` helper (reuse for new event types), idempotency guard (`__bskiosk_injected__`), `detectReady` pattern (copy for `detectLogin`)
- `src/inject/fragile-selectors.js` — shape of STABLE / FRAGILE entries (Phase 3 adds three stable entries)
- `src/host/host.html` — z-index ladder comment, `#splash`, `#magicline-error`; Phase 3 adds `#credentials-overlay` and `#pin-modal` as layer-400 siblings
- `src/host/host.css` — brand tokens + z-index tokens; Phase 3 adds credential-overlay and pin-modal styles reusing existing tokens
- `src/host/host.js` — IPC subscription pattern; Phase 3 adds new channel handlers in the same style
- `src/main/preload.js` — `contextBridge` surface expansion points

### External Docs (consult during research)
- Electron docs: [`safeStorage`](https://www.electronjs.org/docs/latest/api/safe-storage), `safeStorage.isEncryptionAvailable`, `safeStorage.encryptString`, `safeStorage.decryptString`
- Node docs: `crypto.scryptSync`, `crypto.timingSafeEqual`, `crypto.randomBytes`
- `electron-store` docs: atomic write semantics, schema validation (optional)
- Freek Van der Herten — "Replacing Keytar with safeStorage" (migration pattern referenced in CLAUDE.md)
- Magicline: any public documentation on the `[data-role="username"]`, `[data-role="password"]`, `[data-role="login-button"]` contracts (likely none — rely on the prototype selectors and Magicline drift fallback)
- Windows Assigned Access + TabTip: documentation on whether the touch keyboard auto-invokes under a locked-down kiosk profile — **research blocker** per D-17

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phases 1 & 2)

- **`window.__bskiosk_setMuiValue(input, value)`** — `src/inject/inject.js:61-69`. Already exposed by Phase 2 **specifically for Phase 3 reuse** (see Phase 2 comment: *"Phase 3 auto-login and Phase 4 NFC injection BOTH reuse this helper"*). No new setter implementation needed.
- **Drain-queue infrastructure** — `src/main/magiclineView.js:42` (`DRAIN_EXPR`), `:216-236` (`startEventDrain`), `:238-299` (`handleInjectEvent`). Phase 3 plugs into this directly.
- **`KNOWN_EVENT_TYPES` whitelist** — `src/main/magiclineView.js:60-65`. Phase 3 adds `'login-detected'` and `'login-submitted'`. This is a tiny, auditable diff.
- **`emit(type, payload)`** in inject.js — `src/inject/inject.js:47-55`. Reused for new event types, no changes to the emit mechanism.
- **`detectReady` pattern** — `src/inject/inject.js:141-161`. Phase 3's `detectLogin` is structurally identical: gate on a stable `[data-role=...]` selector + URL match, emit once per page load, expose on `window.__bskiosk_detectLogin`.
- **`electron-store` instance** — `src/main/main.js:145` (`new Store({ name: 'config' })`). Reused directly for `credentialsCiphertext`, `adminPinHash`, `adminPinSalt`.
- **`#magicline-error` layer** — `src/host/host.html:34-38`. Phase 3 reuses this exact overlay for `CREDENTIALS_UNAVAILABLE` and `LOGIN_FAILED` with a variant parameter — one overlay, three messages.
- **`host.html` z-index ladder** — `src/host/host.html:12-24`. Layer 400 is already reserved for "Phase 3/5 credentials + admin PIN modal". Phase 3 fills that slot.
- **`logger.js`** — `src/main/logger.js`, rotating file transport. All `auth.state` lines go through it, satisfying AUTH-04 verifiability.

### Established Patterns (from Phase 2)

- **Main process owns state, page world emits signals.** `handleInjectEvent` never mutates Magicline DOM — it logs + IPCs. Phase 3 follows the same rule: `authFlow` owns state, issues commands to inject.js via `executeJavaScript`, never lets inject.js make decisions.
- **One-shot guards.** `readyFired`, `driftActive` — module-scoped booleans gate state transitions. Phase 3 adds `authFailedActive` following the exact same pattern.
- **Idempotent re-injection.** `__bskiosk_injected__` lets `dom-ready` and `did-navigate-in-page` re-run inject.js without double-attaching listeners. Phase 3's `detectLogin` must respect the same contract.
- **CommonJS main, raw strings for inject.** No bundler; `fs.readFileSync(...'utf8')` → `executeJavaScript`. Phase 3 follows the same path for any new inject files.
- **Kebab-case IPC channels, namespaced by concern.** `cash-register-ready`, `show-magicline-error`, `splash:hide`. Phase 3: `show-credentials-overlay`, `hide-credentials-overlay`, `submit-credentials`, `show-pin-modal`, `verify-pin`, `auth.state-changed` (optional, for dev-mode debugging).
- **Strict CSP in `host.html`** — already audited in Phase 2. Phase 3 overlays must not need inline script; all interaction lives in `host.js`, all styles in `host.css`.
- **Prototype porting.** When the `BeeStrong_POS_Kiosk_Project.md` prototype has a working login snippet, port verbatim, then layer in state-machine hooks. Do not redesign the form-fill logic from scratch.

### Integration Points

- **Phase 3 → Phase 1:** Adds `#credentials-overlay` and `#pin-modal` sibling divs to `host.html`, new styles in `host.css` reusing brand tokens, new IPC handlers in `host.js` + `preload.js`. All additive, no edits to splash logic.
- **Phase 3 → Phase 2:** Adds `detectLogin` + `fillAndSubmitLogin` to `src/inject/inject.js`, adds three STABLE entries to `fragile-selectors.js`, adds two event types to `magiclineView.js` `KNOWN_EVENT_TYPES`, adds a handler delegation (`authFlow.notify(evt)`) in `handleInjectEvent`. All additive.
- **Phase 3 → Phase 4:** Session reset (Phase 4) causes Magicline to serve the login page; Phase 3's existing `login-detected` flow handles it with no special branch. Phase 4 does not need to call into `authFlow` — it just wipes cookies and lets navigation do the rest. `authFlow` resets its own retry counter on any `cash-register-ready` event so a post-reset re-login starts from zero.
- **Phase 3 → Phase 5:** `src/main/adminPin.js` (`verifyPin`, `setPin`, scrypt hash in `electron-store`) is the contract Phase 5's admin menu consumes. Phase 5 adds the `Ctrl+Shift+F12` hotkey and the admin menu UI; the PIN storage and verification logic are already done here. Phase 3 MUST NOT register `Ctrl+Shift+F12` — that's Phase 5's hotkey.

</code_context>

<specifics>
## Specific Ideas

- **The splash stays up the entire time** Phase 3 is driving auto-login. The member's visual is splash → cash register, identical to Phase 2's one-shot splash lift. If Phase 3 ever causes a flash of login wall it is a Phase 3 bug, not a Phase 2 regression. Research must validate this end-to-end on the real kiosk.
- **One overlay, three variants.** `#magicline-error` is reused for drift (Phase 2), credentials-unavailable (Phase 3), and login-failed (Phase 3). This is deliberate: fewer branded surfaces to design, one set of styles, one "recovery is through the PIN" mental model.
- **Phase 3 ships the PIN gate, Phase 5 ships the admin menu.** The split is important: without the gate, Phase 3 has no way to verify AUTH-05; without the menu, Phase 5 has no useful operator surface. They share the same `adminPin.js` module and the same stored hash.
- **Windows TabTip is a load-bearing assumption** for touchscreen credential entry. If it does not invoke under Assigned Access, a custom softkeyboard becomes a blocker and scope-creep risk. This MUST be verified at the start of research, not at verification time.
- **No plaintext, ever.** The phase verification test greps the config file and log files for the test credentials. If the grep returns any hit, the phase fails.
- **The state machine is stateless across reboots.** No persisted current-state key. Every boot starts at `BOOTING`. Idle reset in Phase 4 is therefore "just another login page appearance", not a special branch.
- **`authFlow` is the only writer of auth state**, and it only writes in response to drain-queue events + IPC. Treat it as a single-threaded reducer — the planner should structure it so every transition is a pure function of `(state, event) → (state, sideEffects)`.

</specifics>

<deferred>
## Deferred Ideas (NOT Phase 3 scope)

- **Custom on-screen softkeyboard** — only if Windows TabTip proves unreliable under Assigned Access. Route to a new phase if D-17 research blocks.
- **Separate "Test login" button in the credentials overlay** — Save-and-immediately-attempt covers 95% of the value at zero extra UI complexity.
- **Password strength / complexity rules** — Magicline enforces its own at account creation; kiosk does not second-guess.
- **Credential rotation or expiry** — operator manually re-enters via admin menu when needed; no scheduled rotation.
- **Full admin menu (Exit to Windows, Reload, View logs, Check for updates)** — Phase 5.
- **`Ctrl+Shift+F12` admin hotkey registration** — Phase 5.
- **Session-expiry detection (silent re-login when Magicline 401s mid-session)** — Phase 5. Phase 3's auto-login will re-fire if Phase 5's detector triggers a navigation back to the login page, so no Phase 3 changes are needed.
- **Rate-limiting brute force on the PIN modal (five-tries-in-a-minute lockout from ROADMAP Phase 5 success criterion 1)** — Phase 5. Phase 3's PIN gate verifies and logs; lockout logic is layered on top in Phase 5.
- **Telemetry on login-retry frequency / auth-failure rate** — v2, OPS layer.
- **Biometric unlock / Windows Hello** — never (single shared kiosk account, no personalization).

</deferred>

---

*Phase: 03-credentials-auto-login-state-machine*
*Context gathered: 2026-04-09*
