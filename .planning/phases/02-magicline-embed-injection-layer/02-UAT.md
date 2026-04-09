---
status: partial
phase: 02-magicline-embed-injection-layer
source:
  - 02-01-SUMMARY.md
  - 02-02-SUMMARY.md
  - 02-03-SUMMARY.md
  - 02-04-SUMMARY.md
  - 02-05-SUMMARY.md
started: 2026-04-09T06:21:10Z
updated: 2026-04-09T09:30:00Z
---

## Current Test

number: —
name: UAT complete (partial, G-05)
expected: |
  Session closed with status `partial`. Tests 1, 2, 9 passed. Tests 3-8
  deferred to Phase 3 UAT per G-05 (authentication boundary). Four bugs
  found and fixed during session (G-01, G-02, G-03, G-04).
awaiting: nothing — routed to Phase 3 planning

## Tests

### 1. Cold Start Smoke Test
expected: Kill any running Electron instance. Run `npm start` from the project root. Electron 41 boots without errors in the terminal. A vertical-oriented kiosk window appears showing the Phase 1 branded splash overlay. No dev tools open, no staff chrome visible. Terminal logs show Phase 2 wiring succeeded (no "[phase2] magicline wiring failed" error line).
result: passed
notes: |
  Initial run failed with MODULE_NOT_FOUND for 'electron-store' — root cause: Plan
  02-01 ran `npm install` inside a worktree, and the worktree-local node_modules/
  was removed when the worktree was cleaned up, so the main tree never had the
  new dep installed. Fixed by running `npm install` in the main tree (postinstall
  rebuilt native deps via @electron/rebuild). See Gap G-01.
  Second run: app launches, Magicline login screen visible, DevTools open — but
  DevTools opening is expected in dev mode (`npm start` sets NODE_ENV=development;
  main.js:50 and magiclineView.js:133 call openDevTools({mode:'detach'}) only when
  isDev). This is per D-07 / D-08. To test real locked-down behavior, use
  `npm run start:prod`.

### 2. Magicline Loads in Locked Child View
expected: After splash appears, the kiosk loads bee-strong-fitness.web.magicline.com under the persist:magicline session partition. The Magicline login page (or cash register, if already authenticated) appears inside the kiosk frame. No browser chrome, no address bar, no right-click menu works.
result: passed
notes: |
  Initial run failed — Magicline login screen appeared immediately, no splash
  visible. Root cause: child view was full-bounds at creation, covering the
  Phase 1 splash. See Gap G-02 and fix commit acc06c4.
  After fix: splash visible on boot, Magicline detached-DevTools window opened
  and shows bee-strong-fitness.web.magicline.com login DOM tree — proving
  Magicline loads and runs at zero bounds in the background while the host
  splash remains on-screen.

### 3. Stable CSS Hide Layer Applied
expected: On the Magicline cash register page, these elements are NOT visible — sidebar nav, top header bar, logout button, account menu, customer-search container. Only the product search, scan area, product list and checkout column are visible. (From src/inject/inject.css STABLE section.)
result: deferred
notes: Requires authenticated cash register session. See G-05 — deferred to Phase 3 UAT after auto-login lands. Plumbing verified (inject.css loaded at require-time, insertCSS wired on three-event trigger mix), visual verification bounded by Phase 3 scope.

### 4. Dynamic Hide Layer Applied (Rabatt + Discount Icon)
expected: On the cash register page, the "Rabatt" (discount) button group is hidden and its discount-icon SVG is not visible. If Magicline re-renders the product list (e.g. after adding an item), the Rabatt group stays hidden — does not flash back on re-render. (Tests MutationObserver hide pass from inject.js.)
result: deferred
notes: Requires authenticated cash register session. See G-05. Code path verified — MutationObserver attaches and fires via rAF-debounced schedule() which calls hideDynamicElements(). Visual verification deferred to Phase 3 UAT.

### 5. Cash-Register-Ready Splash Lift
expected: Once the Magicline cash register page is fully loaded and the product-search input is present in the DOM, the branded splash overlay fades away, revealing the Magicline cash register UI. Splash should NOT lift on the login page — only after navigating to #/cash-register.
result: deferred
notes: |
  Entire ready-detection code path verified and fixed during this UAT session:
  - G-02 (child view z-order)
  - G-03 (hash regex case-insensitive + anchored)
  - G-04 (selfCheck deferred to post-ready)
  What cannot be verified in Phase 2 alone: the actual on-screen splash lift,
  because it requires the product-search input to exist in the DOM which only
  happens after authentication. See G-05. Will be re-run in Phase 3 UAT.

### 6. Selector Drift Detection Shows Error Overlay
expected: This test needs simulation. Temporarily break a fragile selector by editing src/inject/fragile-selectors.js (e.g. change one MUI css-xxxxx hash by one character), save, restart Electron. On boot, the #magicline-error overlay appears with a branded error message (NOT the splash, and NOT raw Magicline content). Restoring the selector + restarting returns to normal behavior.
result: deferred
notes: After the G-04 fix, selfCheck only runs AFTER cash-register-ready emits, so a broken fragile selector only flags drift on an authenticated cash register page. Cannot simulate without reaching that state. Deferred to Phase 3 UAT.

### 7. Drift Precedes Ready (Locked-Down Failure Mode)
expected: When test 6's drift overlay is showing, it remains visible even if the cash-register-ready signal would fire — i.e. the splash does NOT lift and reveal unhidden Magicline content underneath. The kiosk fails safe: operator sees the error, not a half-broken cash register.
result: deferred
notes: |
  Code invariant to re-verify in Phase 3: with G-04 fix, drift can now fire
  AFTER ready rather than before. The D-06 "drift precedes reveal" invariant
  therefore also needs to be re-examined — if drift happens post-reveal, the
  overlay must still cover the cash register UI. Current magiclineView.js
  handleInjectEvent honors this (show-magicline-error is sent regardless of
  revealed state, and the host overlay has higher z-index than the child view).
  Verify in Phase 3 UAT.

### 8. Zoom Factor Override Persists
expected: The Magicline view renders at the default zoom computed for the kiosk's display size (vertical/tablet orientation). If you set a custom zoom via electron-store ("zoomFactor" key) in the userData config file and restart, the new zoom factor is applied on next boot and persists across restarts.
result: deferred
notes: Log line `magicline.zoom: factor=1.25 source=default` confirmed at boot (Plan 04 `computeDefaultZoom`). Cannot visually verify zoom level without a rendered cash register. Deferred to Phase 3 UAT.

### 9. Host Window Close Cleans Up Child View
expected: Closing the main kiosk window (Alt+F4 if allowed, or from admin exit flow) cleanly destroys the Magicline WebContentsView without errors in the terminal. No "resize of destroyed view" or "cannot read properties of undefined" errors. (Tests WR-03 destroyMagiclineView fix.)
result: passed
notes: User closed the kiosk window; Electron exited cleanly with no destroyed-view errors. destroyMagiclineView() correctly cleared drain timer, unhooked resize listener, and reset module-scoped state. Validates the WR-03 code-review fix from commit 0233fc4.

## Summary

total: 9
passed: 3
deferred: 6
pending: 0
issues: 0
skipped: 0
status_note: |
  Tests 3-8 deferred to Phase 3 UAT (G-05). Every plumbing-level invariant that
  can be verified in Phase 2 in isolation has been verified; the remaining six
  require an authenticated cash register session which Phase 3's auto-login
  closes. Four real bugs (G-01 through G-04) were discovered and fixed during
  this session — all fixes committed.

## Gaps

### G-01: electron-store not installed in main working tree after phase execution
severity: warning
status: resolved
discovered_in: Test 1 (Cold Start Smoke Test)
root_cause: |
  Plan 02-01's executor ran `npm install electron-store@10.1.0` inside its isolated
  worktree. The worktree's package.json, package-lock.json, and commit history were
  merged back to the main tree, but the worktree's node_modules/electron-store/
  was deleted when the worktree was cleaned up. The main tree was never re-installed
  after the merge, so `require('electron-store')` threw MODULE_NOT_FOUND on first
  `npm start`.
fix: |
  Ran `npm install` in the main tree — postinstall triggered electron-builder's
  install-app-deps which rebuilt native deps for Electron 41. 22 packages added,
  0 vulnerabilities. Verified `require('electron-store').default` is a function.
process_lesson: |
  The gsd-executor worktree-merge protocol should either (a) run `npm install`
  automatically after merging any plan that changed package.json / package-lock.json,
  or (b) warn at merge time that manual `npm install` is required. Consider adding
  a post-merge hook to the wave-completion step in execute-phase.md.

### G-02: Magicline child view covers splash — z-order design gap
severity: critical (UX-blocking)
status: resolved
discovered_in: Test 2 (Magicline Loads in Locked Child View)
commit: acc06c4
root_cause: |
  Electron 41 WebContentsView is GPU-composited on top of the host BrowserWindow's
  webContents. magiclineView.js:110-111 called sizeChildView(mainWindow) immediately
  at creation, expanding the child view to full window bounds. The Phase 1 splash
  overlay (which lives inside the host BrowserWindow's webContents) was therefore
  covered from boot. Symptom: Magicline login screen appeared directly, no splash
  visible, and the splash:hide IPC was effectively a no-op because the splash was
  never on-screen in the first place.

  Plan 02-04 never addressed the z-order. It assumed sizeChildView at creation
  was correct and left the reveal mechanism to the (unreachable) splash:hide IPC.
fix: |
  1. Keep child view at default {0,0,0,0} bounds at creation. Magicline still
     loads and runs in the background at zero bounds — it paints nothing.
  2. Module-scoped `revealed` flag. Resize handler early-returns while !revealed
     so window resizes do not accidentally expand the hidden view.
  3. In handleInjectEvent on cash-register-ready: set revealed=true, call
     sizeChildView() to full bounds, THEN send splash:hide. Sizing before hide
     prevents a black-flash gap.
  4. destroyMagiclineView() resets `revealed` so a crash-recreate path starts
     hidden again.
  5. Drift case unchanged: doesn't touch bounds, child view stays hidden, the
     #magicline-error host overlay paints over the splash. Honors D-06.
design_lesson: |
  Phase 3+ (auto-login, badge flow) must continue to respect the child-view
  lifecycle pattern established here: NO code path outside handleInjectEvent
  should call sizeChildView or mutate `revealed`. If auto-login needs to
  interact with Magicline while the splash is up, it must do so via
  executeJavaScript on the zero-bounds child view (runs normally, paints
  nothing). Document this as a Phase 2 invariant when drafting Phase 3's
  CONTEXT.md.

### G-03: cash-register-ready hash regex is case-sensitive, silently fails
severity: critical (UX-blocking)
status: resolved
discovered_in: Test 5 (Cash-Register-Ready Splash Lift)
commit: 82b9fd3
root_cause: |
  inject.js:143 used `/#\/cash-register/` (case-sensitive, unanchored) as the
  hash-gate for cash-register-ready. The real Magicline deployment at
  bee-strong-fitness.web.magicline.com routes the cash register page to hash
  `#/cash-Register` with a CAPITAL R. The regex never matched, so detectReady
  early-returned before even checking the [data-role="product-search"] input
  selector, cash-register-ready never emitted, and the splash stayed up forever
  on an otherwise-authenticated cash register page.

  Research RESEARCH.md A2 had documented the selector `[data-role="product-search"] input`
  correctly — the live DOM confirms `[data-role="product-search"]` exists and
  its descendant <input> is the product search. The selector was never the bug.

  This was masked by the fact that we never actually reached an authenticated
  cash register session during plan execution (no auto-login in Phase 2 scope),
  so the hash regex was never exercised against live Magicline routing until UAT.
fix: |
  Replaced /#\/cash-register/ with /^#\/cash-register(\/|$|\?)/i. The 'i' flag
  accepts any casing; the ^ anchor + trailing (\/|$|\?) clause prevents a false
  positive on hypothetical future routes like #/cash-register-settings (also
  covers code-review finding IN-01).
design_lesson: |
  RESEARCH assumptions about live selectors / routes must be verified against
  a live session BEFORE plan freeze, not deferred to execution-time UAT. The
  02-RESEARCH.md A2 note claimed verification was pending "Plan 06 live session"
  but Plans 2-5 were allowed to execute and merge before that verification
  happened, locking in the wrong regex. For Phase 3+, any assumption about
  live Magicline DOM / routing MUST be a PENDING-HUMAN checkpoint BEFORE the
  plan that depends on it can land — not after.

### G-04: selfCheck runs before React hydrates, false-positive drift storm suppresses ready
severity: critical (UX-blocking)
status: resolved
discovered_in: Test 5 (Cash-Register-Ready Splash Lift)
commit: 73092de + da9781d
root_cause: |
  inject.js ran selfCheck() in two places at boot time:
  (1) The initial-pass block at the bottom of the IIFE
  (2) The idempotency re-entry path (when did-navigate-in-page re-runs inject)
  Both ran BEFORE detectReady, and both ran BEFORE React had finished hydrating
  the Magicline cash register page. At that microsecond, NONE of the stable or
  fragile selectors match the DOM (topbar, global-search-button, categories,
  customer-search, toolbar, product-grid-tablet, kategorien-button, etc.).

  selfCheck faithfully emitted 9 drift events to the drain queue. The main
  process drained them in a batch, handleInjectEvent processed them in order,
  set driftActive=true on the first, and then suppressed the subsequent
  cash-register-ready emit per D-06 (drift precedes reveal).

  The SPA hydration race made "race" indistinguishable from "real drift".
  Net effect: splash stayed up forever, no error overlay either (show-magicline-error
  WAS fired but the host overlay state machine didn't flip because... actually
  it did fire, logged as "please wait" remaining visible — the error message
  layer rendered over the splash but only the drift message was visible, not
  the splash). On the third round the drift events disappeared from the terminal
  because selfCheck wasn't being called anymore — that's when we knew we had
  a hydration race not a real drift.
fix: |
  Two-part fix:
  1. Move selfCheck() OUT of the initial pass (commit 73092de)
  2. Move selfCheck() OUT of the idempotency re-entry path (commit da9781d)
  selfCheck is now invoked from INSIDE detectReady() immediately after
  readyEmitted becomes true. Rationale: if [data-role="product-search"] input
  exists in the DOM, the cash register page is proven-hydrated enough for
  every other selector on the STABLE + FRAGILE lists to be trustworthy. Any
  drift reported from THAT point forward is real drift, not a race.
design_lesson: |
  Phase 2 research assumed dom-ready was late enough to trust selectors. This
  is WRONG for client-rendered SPAs like Magicline where dom-ready fires on
  the initial HTML skeleton but React hasn't yet hydrated the route. The
  right trigger for "page is stable enough to check selectors" is presence
  of the page-specific anchor element (product-search input for cash register).

  For Phase 3 and beyond: treat dom-ready as "injection can start", NOT as
  "selectors are trustworthy". Use page-specific anchor detection as the
  stability gate for any self-checks.

### G-05: Phase 2 cannot bootstrap unauthenticated — auto-login required to verify visual behaviors
severity: blocking (UAT scope)
status: deferred-to-phase-3
discovered_in: Test 5 (Cash-Register-Ready Splash Lift) — structural, not a bug
root_cause: |
  Magicline uses a route-guard SPA pattern: when an unauthenticated session
  hits `#/cash-register`, it keeps the hash at `#/cash-register` but swaps the
  DOM to render a login form in-place. inject.js's detectReady gate passes on
  the hash check but the product-search element check fails (login form doesn't
  have product-search), so cash-register-ready never emits and the Magicline
  child view stays at zero bounds.

  Because the child view is hidden while the splash is up (G-02 design), the
  user ALSO cannot click into the Magicline login form through the kiosk UI.
  They would have to either:
  (a) Already be authenticated from a previous session (persist:magicline
      cookies from an earlier run)
  (b) Log in via the Magicline child view's detached DevTools Console
  (c) Add a dev-only "force reveal" keyboard shortcut (out of Phase 2 scope)

  Without one of those, Phase 2 UAT cannot visually verify Tests 3, 4, 5, 6,
  7, or 8 — all of which require an authenticated cash register to be on
  screen.
fix: |
  NOT a bug to fix in Phase 2. This is the phase-boundary artifact of shipping
  Phase 2 (locked shell + child view + injection plumbing) before Phase 3
  (auto-login). Phase 3 closes this gap by design.

  What WAS done during Phase 2 UAT:
  1. Logged G-05 and all learnings about the login page (data-role selectors,
     wrapper-not-input structure, setMuiValue illegal invocation on wrappers,
     German localization) into .planning/intel/phase3-auto-login-learnings.md.
     This gives Phase 3 planning concrete pre-research instead of speculation.
  2. Marked Tests 3-8 as `deferred` (not `skipped`, not `failed`) with status
     notes explaining the dependency on Phase 3.
  3. Verified every Phase 2 plumbing invariant that could be verified from a
     dry boot: inject.js runs, idempotency guard works, drain queue drains,
     detectReady code path correctly gates, hash regex works (after G-03),
     selfCheck timing works (after G-04), child view z-order works (after
     G-02). These are the pieces Phase 3 will BUILD ON.
phase_3_handoff: |
  Phase 3 plan-of-plan MUST include a UAT pass that explicitly re-runs Tests
  3-8 on an authenticated cash register session. The UAT template for that
  pass already exists — it's this file. Copy the 6 deferred tests forward and
  run them after Phase 3's auto-login is wired. Result: Phase 2's visual
  behaviors get validated end-to-end as part of Phase 3 acceptance, without
  Phase 2 having to hold up for a feature that isn't in its scope.
