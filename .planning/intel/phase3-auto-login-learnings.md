---
source: Phase 2 UAT session (2026-04-09)
audience: Phase 3 planning (auto-login + session recovery)
verified_against: bee-strong-fitness.web.magicline.com live session
---

# Phase 3 Auto-Login Intel (From Phase 2 UAT)

Hard-won findings from the Phase 2 UAT session that touched the real live
Magicline deployment. Read this BEFORE drafting Phase 3 research or plans —
every item below is verified against the live DOM, not research-time assumption.

## 1. Login Page Has Stable `data-role` Selectors

Verified in the Magicline DevTools Console on the live login page:

```js
[...document.querySelectorAll('[data-role]')].map(e => e.getAttribute('data-role'))
// => ['login-form', 'username', 'password', 'login-button']
```

Phase 3's auto-login MUST target these, not the fragile MUI `css-xxxxx` classes.
These 4 data-roles are currently stable selectors we can treat like the STABLE
category in `src/inject/fragile-selectors.js`. Add them to the login-page
equivalent of STABLE_SELECTORS so the boot-time self-check flags any drift
during login just as it does on the cash register page.

## 2. `data-role` Is on the WRAPPER, Not the Input Element

CRITICAL finding that blew up the UAT DevTools workaround:

- `document.querySelector('[data-role="username"] input')` → **null**
- `document.querySelector('[data-role="username"]')` → returns some wrapper
  element, and passing it to `setMuiValue` throws `TypeError: Illegal invocation`
  because it's not an `HTMLInputElement`.

This means `[data-role="username"]` and `[data-role="password"]` are NOT
descendants-of or ancestors-of the actual inputs in the way a naive descendant
combinator expects. Phase 3 must discover the real relationship — probably
siblings-within-a-container, or the data-role is a sibling label node.

**Phase 3 auto-login should:**
1. First inspect the DOM structure of the login page in detail (enumerate
   `[data-role="username"]` siblings and cousins until it finds the real input)
2. Prefer direct `document.querySelectorAll('input')` + type-based disambiguation
   as a fallback (`type==='password'` for the pw field, the other for username)
3. Add a defensive guard inside `setMuiValue`:
   ```js
   function setMuiValue(input, value) {
     if (!(input instanceof HTMLInputElement)) return false;
     // ... existing implementation
   }
   ```
   Return `false` instead of throwing so auto-login can detect the miss and
   retry with a different selector.

## 3. `persist:magicline` Session Partition Persists Cookies Across Restarts

Confirmed: the first UAT session was auto-logged-in because cookies from an
earlier browser session were still in the Electron user-data partition. A
later restart (after several code fixes) lost the session and dropped back to
the login page.

**Implication for Phase 3:**
- Auto-login must be IDEMPOTENT. Many boots will skip login entirely because
  the session is already alive. The auto-login flow must:
  1. Detect if already authenticated (presence of `[data-role="product-search"]`
     or absence of `[data-role="login-form"]` after dom-ready)
  2. Only run the login script if the login form is present
  3. Not retry if login has already completed in this session
- Session expiry behavior needs to be explicitly tested in Phase 3. How long
  does Magicline keep the session? What happens when it expires mid-use?

## 4. Magicline Keeps `#/cash-register` Hash While Showing Login

Counter-intuitive SPA guard pattern:

- `location.hash === '#/cash-register'` is TRUE even when the login form is
  rendered
- Magicline's route guard shows the login overlay "in place" without changing
  the URL
- This means `detectReady`'s hash check passes but the `product-search`
  element check fails — correctly gating but not giving Phase 3 any signal
  about login state

**Implication for Phase 3:**
- Don't use `location.hash` to detect login vs authenticated state
- Use element presence: `[data-role="login-form"]` for login state,
  `[data-role="product-search"]` for cash register state
- Auto-login's "login needed" trigger is `[data-role="login-form"]` being
  present, NOT the URL

## 5. Login Page Text Is German

Observed body text on login page:
```
Anmelden
PASSWORT VERGESSEN?
```

Phase 3 error messages and any user-facing strings that reference login state
should match Magicline's German localization for consistency. Options:
- Hard-code German (matches `DRIFT_MESSAGE` in `magiclineView.js` which is
  already German: "Kasse vorübergehend nicht verfügbar…")
- Extract to a simple `strings.js` module for i18n consistency

## 6. MutationObserver on `document.body` Catches SPA Route Transitions

Verified: inject.js's MutationObserver attached to `document.body` (because
`<main>` doesn't exist at dom-ready — see G-04 resolution) fires reliably
when Magicline swaps login form → cash register via React router.

**Implication for Phase 3:** Auto-login can hook the same MutationObserver
flow. When login is detected, fill credentials, click submit, and let the
existing observer → `detectReady` → reveal path handle the rest. No polling
needed.

## 7. Chrome DevTools Console Paste Is BROKEN for Long Single-Line Snippets

Discovered the hard way during UAT: Chrome DevTools Console's paste buffer
splits long single-line snippets mid-token. Witnessed splitting the literal
string `type` as `ty\npe` causing `ReferenceError: pe is not defined`.

**Implication:** If Phase 3 UAT ever needs manual Console interaction:
- Keep snippets under ~80 chars per line
- Or type `allow pasting` in the Console first
- Or use multi-line blocks with explicit newlines
- Or use `eval(` with the whole script as a base64 string

Phase 3 auto-login uses `webContents.executeJavaScript` from the main process,
NOT the DevTools Console, so this is only a testing/debugging concern.

## 8. `setMuiValue` Works — It's the Selector That's Fragile

`window.__bskiosk_setMuiValue` from inject.js (Phase 2) is the correct
mechanism for setting React-controlled MUI input values. The prototype port
is byte-identical to the proven prototype code (inject.js lines 56-66).

The UAT failures were ALWAYS selector-target errors, never setMuiValue bugs.
Phase 3 auto-login should call `window.__bskiosk_setMuiValue` from its
injected login script — don't re-implement the React setter descriptor dance.

## 9. Drain-Queue IPC Pattern Works End-to-End

Verified during UAT:
- `window.__bskiosk_events` is drained every 250ms by the main process
- Events flow cleanly: `drift`, `cash-register-ready`, `observer-scope-fallback`
- Main process's `handleInjectEvent` correctly dispatches by `type`
- The drain queue is empty when polled after Magicline is idle

Phase 3 auto-login events should use the same pattern:
- `login-needed` — emitted when inject.js detects `[data-role="login-form"]`
  on dom-ready
- `login-started` — emitted when auto-login begins filling credentials
- `login-failed` — emitted on auth failure (wrong creds, rate limit, etc.)
- `login-succeeded` — emitted when post-login DOM signals success
- Add these to `KNOWN_EVENT_TYPES` in `magiclineView.js:55`

## 10. Testing Gap: No Way to Test Phase 2 End-to-End Without Phase 3 Auto-Login

This is the meta-finding. Phase 2's entire value stack (stable CSS hide,
dynamic hide, cash-register-ready splash lift, zoom override, drift simulation)
can only be visually verified on an authenticated cash register session. Phase
2 UAT could only verify plumbing correctness, not visual behavior.

**Implication for Phase 3 acceptance plan:** Phase 3 must include a UAT pass
that explicitly re-verifies Phase 2's visual behaviors end-to-end:
- Test 3 (Stable CSS hide layer)
- Test 4 (Dynamic Rabatt + discount icon hide)
- Test 5 (Splash lift timing)
- Test 6 (Drift overlay)
- Test 7 (Drift precedes reveal)
- Test 8 (Zoom factor persistence)

These were deferred from Phase 2 UAT to Phase 3 UAT with status "deferred"
(not failed) because they are bounded by Phase 3's scope.

## 11. Credential Storage Considerations

Phase 2 introduced `electron-store@10.1.0` (via G-01 resolution). Its CJS
interop quirk:

```js
const Store = require('electron-store').default;  // NOT require('electron-store')
```

Phase 3 auto-login will store Magicline credentials encrypted via `safeStorage`
DPAPI and the ciphertext in `electron-store`. CLAUDE.md prescriptive stack
already mandates this pattern — don't reintroduce `keytar`.

`safeStorage.isEncryptionAvailable()` must be checked on first run. On first-
run failure under a different Windows user than where credentials were
originally encrypted, the admin runbook recovery path applies (see CLAUDE.md).

## Summary Checklist for Phase 3 CONTEXT.md

- [ ] Auto-login targets `[data-role="login-form"]`, `[data-role="username"]`,
      `[data-role="password"]`, `[data-role="login-button"]` — not MUI classes
- [ ] Discover actual input-to-data-role relationship via DOM inspection before
      assuming descendant combinator works
- [ ] `setMuiValue` gets a defensive instanceof guard
- [ ] Auto-login is idempotent — skips if already authenticated
- [ ] Login detection uses element presence, not URL hash
- [ ] German localization for user-facing strings
- [ ] New event types added to `KNOWN_EVENT_TYPES`
- [ ] Phase 3 UAT explicitly re-runs Phase 2's deferred visual tests
- [ ] `safeStorage` + `electron-store` ciphertext pattern for credentials
- [ ] Respect the child-view lifecycle invariant: only `handleInjectEvent`
      touches `sizeChildView`/`revealed` (G-02 design lesson)
