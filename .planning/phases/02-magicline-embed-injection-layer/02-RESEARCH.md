# Phase 2: Magicline Embed & Injection Layer — Research

**Researched:** 2026-04-08
**Domain:** Electron 41 child-view embedding of third-party React+MUI SaaS with persistent CSS/JS injection, drift isolation, and SPA-navigation-resilient hide rules
**Confidence:** HIGH (core Electron APIs verified against official docs; prototype source verified in repo; BrowserView→WebContentsView deprecation resolved)

## Summary

Phase 2 attaches Magicline's cash register as a **`WebContentsView`** child of the existing Phase 1 `mainWindow`, with persistent `insertCSS`/`executeJavaScript` injection that survives React re-renders and MUI `css-xxxxx` hash drift. The prototype source in `BeeStrong_POS_Kiosk_Project.md` (lines 346–455) is load-bearing and ports verbatim into `src/inject/inject.css` and `src/inject/inject.js`; this phase adds four things on top: (1) a boot-time selector self-check, (2) a `magicline-drift-detected` IPC → branded error overlay, (3) a cash-register-ready IPC that fires only after a post-login `[data-role]` element is visible, (4) extraction of MUI `css-xxxxx` selectors into `src/inject/fragile-selectors.js` as the "one file to patch" drift surface.

The research cleanly resolves every unresolved question raised in CONTEXT.md/SUMMARY.md. `BrowserView` is deprecated in Electron ≥29 — use `WebContentsView` + `mainWindow.contentView.addChildView()`. `executeJavaScript` runs in the **main world**, not the isolated world — which is exactly what we need (the prototype's React-native value setter depends on real `HTMLInputElement.prototype` access). `insertCSS` returns a key for clean removal, and `did-navigate-in-page` is the correct event for Magicline's hash-routed SPA. `session.fromPartition('persist:magicline')` gives us exactly the isolated-but-persistent storage the Phase 4 idle-reset contract requires.

**Primary recommendation:** Port the prototype verbatim into `src/inject/`, wrap it in a single `src/main/magiclineView.js` module that owns the `WebContentsView` lifecycle + injection re-application on `dom-ready` + `did-navigate-in-page`, and add `electron-store@^10.1` as a new dependency for the Phase 2 zoom-factor config override (D-09). Every decision in CONTEXT.md D-01..D-15 has a concrete implementation path below.

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions

- **D-01:** Child view attached to Phase 1 `mainWindow`; host window never navigates away. Branded overlays always render in `host.html`, never inside Magicline.
- **D-02:** `attachLockdown(childView.webContents)` called immediately after child view creation, reusing `src/main/keyboardLockdown.js`.
- **D-03:** `cash-register-ready` IPC fires ONLY after a post-login cash-register-specific `[data-role=...]` element is actually visible. Research must pick the exact selector.
- **D-04:** Every navigation (`did-navigate` + `did-navigate-in-page`) re-applies injection and re-evaluates cash-register-ready. Splash lift is a one-shot main-process state transition; session expiry does NOT re-cover.
- **D-05:** Boot-time selector self-check runs after `insertCSS` + first `executeJavaScript` pass. Iterates stable `[data-role]` list AND `fragile-selectors.js`. Zero matches → `log.warn` with `drift:true`.
- **D-06:** On any zero-match, send `magicline-drift-detected` IPC → main logs + shows branded error overlay. `cash-register-ready` does NOT fire while drift overlay is up. Only admin exit (Phase 5) recovers.
- **D-07:** Error overlay IPC channels: `show-magicline-error` / `hide-magicline-error`. Phase 2 adds `<div id="magicline-error">` to `host.html`, one z-index token to `host.css` (between splash=100 and admin-modal=400), and `onShowMagiclineError`/`onHideMagiclineError` to preload.
- **D-08:** Viewport fit via `childView.webContents.setZoomFactor(N)` — zero DOM math, Electron-native.
- **D-09:** Zoom factor `N` derived from real kiosk screen resolution (UNKNOWN as of 2026-04-08 — MUST flag for measurement). Default at runtime: derive from `screen.getPrimaryDisplay().workAreaSize`, overridable via `electron-store` config key. `electron-store@^10.1` must be added to `dependencies`.
- **D-10:** File layout (exact):
  - `src/inject/inject.css` — stable `[data-role]` hide rules, passed to `insertCSS`
  - `src/inject/inject.js` — dynamic hiding, MUI setter, self-check, MutationObserver, cash-register-ready detection
  - `src/inject/fragile-selectors.js` — isolated drift layer; single array of `{category, selector, fallback}`
  - `src/main/magiclineView.js` — child view owner, never edited during drift response
- **D-11:** `src/inject/` is the drift-patch blast radius. `src/main/` is off-limits to drift patches. Must be enforced by README and PR review.
- **D-12:** Port prototype inject.css/inject.js from `BeeStrong_POS_Kiosk_Project.md` lines 346–455 verbatim; layer on self-check, drift IPC, cash-register-ready detection, fragile-selector extraction. No re-architecture.
- **D-13:** Dev mode opens DevTools on BOTH host webContents (already done Phase 1) AND child view webContents, both detached. Prod: no DevTools anywhere.
- **D-14:** Child view session = `session.fromPartition('persist:magicline')`. Stable across phases; Phases 3/4 will reuse the partition name.
- **D-15:** Child view `webPreferences`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, **NO preload**. Magicline is untrusted; all privileged ops go through host preload → ipcMain.

### Claude's Discretion

- Exact cash-register-ready detection selector (must be cash-register-only stable `[data-role]`).
- Exact German wording on drift error overlay (Bee Strong brand tone).
- Re-injection trigger mix (prototype uses MutationObserver heavily; `insertCSS` is engine-level).
- How `src/inject/fragile-selectors.js` gets pulled into `executeJavaScript`.
- Whether `attachLockdown(childView.webContents)` is default (recommend: yes, always).
- Initial `setZoomFactor` default for dev 420×800 + runtime derivation formula.

### Deferred Ideas (OUT OF SCOPE)

- Magicline auto-login via safeStorage DPAPI (Phase 3)
- NFC badge scan capture + customer-search injection (Phase 4)
- Idle reset + session partition clear (Phase 4)
- Session-expiry detection + silent re-login (Phase 5)
- Admin PIN exit hotkey (Phase 5)
- Auto-update cover (Phase 5)
- Telemetry on drift-incident frequency (v2)
- Admin panel selector-health view (v2)
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| **EMBED-01** | Magicline loaded inside a child `BrowserView`/`WebContentsView` of the host window at the cash-register URL | Verified: use `WebContentsView` (BrowserView deprecated ≥29). Attach via `mainWindow.contentView.addChildView(view)`. Load via `view.webContents.loadURL(MAGICLINE_URL)`. See §"Standard Stack" and §"What the planner must do". |
| **EMBED-02** | Permanent CSS hide layer via `webContents.insertCSS`, covering all stable `[data-role=...]` selectors, re-applied on every navigation | Verified: `insertCSS` returns a promise for a key that can be passed to `removeInsertedCSS`. Prototype source has 10 stable hide rules in `BeeStrong_POS_Kiosk_Project.md` lines 349–358. Re-apply on `dom-ready` + `did-navigate-in-page` (see §Architecture Patterns → Pattern 1). |
| **EMBED-03** | JavaScript injection via `executeJavaScript` on every nav: MUI React-native value setter, dynamic hiding (Rabatt by text, discount icon by SVG path), MutationObserver | Verified: `executeJavaScript` runs in the **main world**, which is exactly what the `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set` pattern requires. Prototype source in `BeeStrong_POS_Kiosk_Project.md` lines 361–454 ports verbatim. |
| **EMBED-04** | Fragile MUI `css-xxxxx` selectors isolated in a single `fragile-selectors.js` drift layer with text/structure fallbacks, separated from stable logic | Three prototype fragile selectors identified: `.MuiBox-root.css-p8umht`, `.css-qo4f3u`, `.MuiTypography-h5.css-1b1c5ke` (plus text-based `Rabatt` and SVG-path `m21.41 11.41`). Extract into `src/inject/fragile-selectors.js` as a single exported array. See §"fragile-selectors.js delivery" below. |
| **EMBED-05** | Boot-time selector self-check logs a warning when any stable or fragile selector matches zero elements on the cash-register page | Implemented inside inject.js after first injection pass. Iterates merged list (stable `[data-role]`s from inject.css + fragile-selectors.js entries). Each zero-match: structured `bridge.drift({selector, category})` IPC. See §"Boot-time selector self-check" in "What the planner must do". |
| **EMBED-06** | CSS hide rule for the customer search box must leave the inner `<input>` query-selectable from JS | Prototype already satisfies this: `[data-role="customer-search"] { display: none !important }` hides the container but `document.querySelector('[data-role="customer-search"] input')` still returns the live element (the DOM is present, only painting is suppressed). `display:none` does NOT remove elements from the DOM — confirmed standard CSS behavior. Phase 4 NFC injection depends on this. |
</phase_requirements>

## Project Constraints (from CLAUDE.md)

- **Electron pinned to `~41.1.1`** — no major drift between builds.
- **Plain JS, CommonJS main process, no bundler, no TypeScript, no `"type":"module"`** — `src/inject/` files are consumed as raw strings by `insertCSS`/`executeJavaScript` so they're free of the CJS vs ESM constraint, but must not `require()` anything from node_modules (main world of the page has no Node).
- **No native modules** — no `keytar`, no `node-hid`, no `@electron/rebuild` needed.
- **Security: no preload on untrusted content** — Magicline is untrusted. The child view has no preload; inject.js communicates back to main via a main-process-registered mechanism (see §"executeJavaScript isolation & IPC back-channel" for the exact pattern).
- **GSD workflow enforcement** — all file edits go through `/gsd-execute-phase`.
- **Structured logging** — `log.info/warn/error` with keyed fields; phase 2 drift warnings use `log.warn('magicline.drift: selector=<sel> category=<stable|fragile>')` per existing convention.

## Standard Stack

### Core (verified 2026-04-08 against official Electron docs)

| Library | Version | Purpose | Verified |
|---------|---------|---------|----------|
| `electron` | `~41.1.1` (already pinned) | `WebContentsView`, `session.fromPartition`, `webContents.insertCSS/executeJavaScript/setZoomFactor` | [CITED: electronjs.org/docs/latest/api/web-contents-view, /api/browser-view (deprecation notice), /api/web-contents, /api/session] |
| `electron-log` | `~5.2.0` (already installed) | Structured logs for drift events, self-check results, IPC trace | [VERIFIED: package.json] |

### New Dependencies to Add in Phase 2

| Library | Version | Purpose | Why |
|---------|---------|---------|-----|
| `electron-store` | `^10.1.0` | Non-secret runtime config: zoom-factor override (D-09), `__bskiosk_injected__` guard persistence if needed | D-09 requires an overridable zoom factor without rebuild. CLAUDE.md already prescribes `electron-store` 10.x (CJS line). Not yet in package.json — Phase 2 is the first consumer. [ASSUMED: electron-store 10.1.x still current; planner should verify with `npm view electron-store@10 version`] |

**Installation (add to Phase 2 task list):**
```bash
npm install electron-store@^10.1.0
```

### Alternatives Considered (and rejected)

| Instead of | Could Use | Why rejected |
|------------|-----------|--------------|
| `WebContentsView` | `BrowserView` | **Deprecated in Electron ≥29.** Official docs: *"The `BrowserView` class is deprecated, and replaced by the new `WebContentsView` class."* [CITED: electronjs.org/docs/latest/api/browser-view] |
| `electron-store` for zoom config | Plain JSON file via `fs` | `electron-store` gives us atomic writes + schema validation + the `userData` path resolution for free. Already in the prescribed stack. |
| `executeJavaScriptInIsolatedWorld` | `executeJavaScript` (main world) | **We need the main world** — the React-native value setter (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set`) must access the real prototype that React has mutated. Isolated world has a separate copy. [CITED: electronjs.org/docs/latest/api/web-contents — "Evaluates `code` in page"] |
| Concat-on-disk of `inject.js` + `fragile-selectors.js` | Single IIFE with inlined selectors | Concat is cleaner: main-process reads both files on boot, concatenates as a single string, passes to `executeJavaScript`. fragile-selectors.js can be a plain `var FRAGILE_SELECTORS = [...]` file (not a module). See §"fragile-selectors.js delivery". |

### Version Verification (MANDATORY for planner)

Before writing Phase 2 installation tasks, run:
```bash
npm view electron-store@10 version
```
The planner should document the confirmed version and publish date in the plan. Training data for electron-store may be stale.

## Architecture Patterns

### Recommended File Layout (from D-10)

```
src/
├── main/
│   ├── main.js              # Phase 1 — adds magiclineView import + createMagiclineView() call after createMainWindow()
│   ├── magiclineView.js     # NEW — owns WebContentsView lifecycle, injection, drift IPC
│   ├── keyboardLockdown.js  # Phase 1 — attachLockdown reused on child view
│   ├── preload.js           # Phase 1 — extended with onShowMagiclineError/onHideMagiclineError
│   └── logger.js            # Phase 1
├── inject/                  # NEW — drift-patch blast radius
│   ├── inject.css           # STABLE [data-role] hide rules (passed to insertCSS)
│   ├── inject.js            # Dynamic hides + MUI setter + self-check + observer + ready-detect
│   ├── fragile-selectors.js # Single exported array (concatenated into inject.js at runtime)
│   └── README.md            # "Edit ONLY files in this directory during drift response. Never edit src/main/."
└── host/
    ├── host.html            # Phase 1 — adds <div id="magicline-error"> sibling
    ├── host.css             # Phase 1 — adds .bsk-layer--magicline-error z-index token (value 300)
    └── host.js              # Phase 1 — adds onShowMagiclineError/onHideMagiclineError handlers
```

### Pattern 1: Persistent injection on every navigation

**What:** Register handlers for `dom-ready` and `did-navigate-in-page` on the child view's `webContents`. On each event: (a) call `insertCSS(inject.css)` and discard the returned key (belt+braces — a full-document navigation re-parses and we want to re-apply), (b) call `executeJavaScript(concat(fragile-selectors.js, inject.js))`. Use an in-page idempotency guard `window.__bskiosk_injected__` inside inject.js so re-runs during a MutationObserver storm don't re-bind listeners.

**When:** Every navigation, including hash-route changes inside Magicline's SPA.

**Why:** [CITED: electronjs.org/docs/latest/api/web-contents]
- `did-navigate` fires only on main-frame (full-document) navigations — **won't fire on hash-only routes** like `/#/cash-register` → `/#/login` in a React SPA.
- `did-navigate-in-page` fires on hash changes — *"examples of this occurring are when anchor links are clicked or when the DOM `hashchange` event is triggered."*
- `dom-ready` fires once per document load — covers full reloads (idle reset in Phase 4, auto-update in Phase 5).
- `did-frame-finish-load` is less useful for hash-route SPAs and adds noise — skip it.
- `did-start-navigation` fires BEFORE the page starts loading — useful for `insertCSS` pre-paint (see Pitfall: flash-of-unhidden-UI below) but firing executeJavaScript here will hit a partially-parsed DOM. Recommend: use `did-start-navigation` for the CSS cover (belt) + `dom-ready` for both CSS + JS (braces).

**Minimal effective trigger mix (prescriptive):**
| Event | What fires there | Why |
|-------|------------------|-----|
| `did-start-navigation` | `insertCSS(inject.css)` only | Earliest hook to beat first-paint on a full reload. No executeJavaScript — DOM not ready. |
| `dom-ready` | `insertCSS(inject.css)` + `executeJavaScript(injectBundle)` | The primary injection point. DOM is parsed; first paint may already have happened but `insertCSS` is engine-level and hides synchronously. |
| `did-navigate-in-page` | `insertCSS(inject.css)` + `executeJavaScript(injectBundle)` | Catches React hash-route changes (e.g. `/#/login` → `/#/cash-register`). |

`did-navigate` and `did-frame-finish-load` are intentionally NOT wired — they either duplicate (did-navigate is a subset of dom-ready for our case) or add noise.

### Pattern 2: MUI React-native value setter (main world only)

**What:** The prototype's `setMuiValue` helper uses `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, value)` + `dispatchEvent('input', {bubbles:true})` + `dispatchEvent('change', {bubbles:true})`. This is the canonical "bypass React's controlled-input state" pattern. It works because React caches the native setter when it first sees an input, then overrides it with its own tracked setter; calling the cached native setter bypasses React's tracking, then dispatching `input` makes React re-read the value from the DOM.

**Must run in the main world.** `executeJavaScript` (without `executeJavaScriptInIsolatedWorld`) executes in the page's main world [CITED: electronjs.org/docs/latest/api/web-contents]. The isolated world would have its own copy of `HTMLInputElement.prototype` without React's modifications, and the setter call would not trigger React's internal value-tracker update.

**Verification:** This exact pattern is already proven on the live Magicline UI in the prototype at `BeeStrong_POS_Kiosk_Project.md` lines 371–378. No re-derivation needed.

### Pattern 3: Scoped, throttled MutationObserver (avoid CPU loop)

**What:** The prototype observes `document.body, {childList:true, subtree:true}` and runs `hideDynamicElements()` on every mutation. Phase 2 must scope and throttle to avoid the "CPU loop on React re-renders" pitfall (PITFALLS.md Pitfall 1, SUMMARY.md note).

**Prescriptive:**
1. **Scope the observer** to the cart-area root where Rabatt + discount icon live, not `document.body`. The safest target is the first `[data-role="toolbar"]`'s parent, or the closest `main`/`[role="main"]` element — planner picks based on the selector table at `BeeStrong_POS_Kiosk_Project.md` lines 492–507. Fall back to `document.body` only if no stable parent is queryable (log a warning in that case).
2. **Debounce** `hideDynamicElements` via `requestAnimationFrame` coalescing: on each mutation set `pending = true`; schedule `rAF(() => { if (pending) { pending = false; hideDynamicElements(); } })` only if no frame is pending. This collapses a 50-mutation React re-render into one hide-pass per frame.
3. **Keep the observer config minimal**: `{childList: true, subtree: true}` only. No `attributes: true` (explodes on any MUI focus/hover class update), no `characterData: true`.
4. **Idempotency guard**: track `window.__bskiosk_injected__ === true` at inject.js top. If true, skip re-attaching observers and listeners — only re-run `hideDynamicElements()` and the self-check. This prevents observer/listener stacking on repeat injection.

### Pattern 4: Fragile-selectors delivery mechanism

**What:** `src/inject/fragile-selectors.js` is NOT a CommonJS module — it's a **plain JS fragment** that the main process reads as a string and prepends to `inject.js` before passing to `executeJavaScript`. Its contents:

```javascript
// src/inject/fragile-selectors.js
// EDIT THIS FILE when Magicline ships an MUI class rename.
// Never edit files outside src/inject/ in response to a Magicline drift incident.
var FRAGILE_SELECTORS = [
  {
    category: 'fragile',
    selector: '.MuiBox-root.css-p8umht',
    fallback: null,  // no structural fallback known
    purpose: 'Product grid tablet'
  },
  {
    category: 'fragile',
    selector: '.css-qo4f3u',
    fallback: null,
    purpose: 'Kategorien button'
  },
  {
    category: 'fragile',
    selector: '.MuiTypography-h5.css-1b1c5ke',
    fallback: null,
    purpose: 'Category h5 heading'
  }
];
var STABLE_SELECTORS = [
  { category: 'stable', selector: 'nav.SidebarWrapper-sc-bb205641-0',         purpose: 'Left sidebar' },
  { category: 'stable', selector: '[data-role="topbar"]',                     purpose: 'Topbar' },
  { category: 'stable', selector: '[data-role="global-search-button"]',       purpose: 'Global search' },
  { category: 'stable', selector: '[data-role="categories"]',                 purpose: 'Category tree' },
  { category: 'stable', selector: '[data-role="customer-search"]',            purpose: 'Customer search container' },
  { category: 'stable', selector: '[data-role="toolbar"] [data-role="icon-button"]', purpose: 'Three-dot menu' },
];
```

**In `magiclineView.js`:**
```javascript
const fs = require('fs');
const path = require('path');
const INJECT_CSS = fs.readFileSync(path.join(__dirname, '..', 'inject', 'inject.css'), 'utf8');
const FRAGILE_JS  = fs.readFileSync(path.join(__dirname, '..', 'inject', 'fragile-selectors.js'), 'utf8');
const INJECT_JS   = fs.readFileSync(path.join(__dirname, '..', 'inject', 'inject.js'), 'utf8');
// Concat fragile first so inject.js can reference FRAGILE_SELECTORS / STABLE_SELECTORS by name
const INJECT_BUNDLE = FRAGILE_JS + '\n;\n' + INJECT_JS;
```

`inject.js` then references `FRAGILE_SELECTORS` and `STABLE_SELECTORS` as if they were declared at the top of its own IIFE — because they are, after concatenation. This is the simplest of the three options (concat vs fs.readFile+prepend vs CJS glue) and has zero build step.

### Pattern 5: executeJavaScript isolation & IPC back-channel

**Problem:** Per D-15 the child view has NO preload. The main world cannot access `ipcRenderer`. But inject.js needs to send `cash-register-ready` and `magicline-drift-detected` to the main process.

**Solution:** The main process polls `executeJavaScript(...)`'s **return value** on a short interval, OR inject.js stashes events on a page-global queue that main reads back via `executeJavaScript('window.__bskiosk_drain()')`. The cleanest, simplest pattern:

```javascript
// inject.js (main world)
window.__bskiosk_events = window.__bskiosk_events || [];
function emit(type, payload) { window.__bskiosk_events.push({type, payload, t: Date.now()}); }
// ... inside self-check:
if (matchCount === 0) emit('drift', {selector, category});
// ... inside ready detection:
emit('cash-register-ready', {url: location.hash});
```

```javascript
// magiclineView.js (main process)
async function drainEvents() {
  const events = await view.webContents.executeJavaScript(
    '(() => { const q = window.__bskiosk_events || []; window.__bskiosk_events = []; return q; })()',
    true // userGesture
  );
  for (const e of events) handleInjectEvent(e);
}
// Poll every 250ms while the view is alive; also drain immediately after each injection.
```

**Why this works:** `executeJavaScript` returns a Promise that resolves with the evaluated expression's value (serializable via structured clone). The 250 ms poll is cheap, has no third-party dependency, and doesn't require a preload on untrusted Magicline content. Cadence is fast enough for cash-register-ready to feel instant to the member (splash lifts within ≤250 ms of the element appearing).

**Alternative considered and rejected:** Using a dedicated preload file that exposes `window.bridge.emit(...)` via `contextBridge`. This would require trusting Magicline's main world with a postMessage bridge — acceptable, but D-15 explicitly rules it out. The drain-poll pattern keeps Magicline fully isolated.

**Alternative considered:** `webContents.send(...)` from main → page and `window.postMessage` back. Same isolation problem: no preload means no ipcRenderer to listen with.

### Pattern 6: Stable vs fragile selector boundary

Two clearly labelled sections inside `inject.css`:

```css
/* ========== STABLE data-role selectors (rarely edited) ========== */
[data-role="topbar"]                           { display: none !important; }
[data-role="global-search-button"]             { display: none !important; }
[data-role="categories"]                       { display: none !important; }
[data-role="customer-search"]                  { display: none !important; }
[data-role="toolbar"] [data-role="icon-button"]{ display: none !important; }
nav.SidebarWrapper-sc-bb205641-0               { display: none !important; }
.LayoutContainer-sc-5eddc1f5-0                 { margin-left: 0 !important; }

/* ========== FRAGILE (DUPLICATES src/inject/fragile-selectors.js) ========== */
/* Keep in sync with fragile-selectors.js. Edit BOTH when Magicline renames. */
.MuiBox-root.css-p8umht                        { display: none !important; }
.css-qo4f3u                                    { display: none !important; }
.MuiTypography-h5.css-1b1c5ke                  { display: none !important; }
```

Note: fragile selectors appear in BOTH files — inject.css for the CSS hide pass, fragile-selectors.js for the self-check. This is intentional duplication (the hide rule must be in CSS because `insertCSS` doesn't accept JS; the self-check must be in JS because it calls `querySelectorAll`). The "one file to patch" contract of D-11 becomes "one **directory** to patch" — drift patches touch `inject.css` AND `fragile-selectors.js`, both under `src/inject/`. README.md in that directory must make this explicit.

### Anti-Patterns to Avoid

- **Observing `document.body` with `subtree:true` and no throttle** — the prototype does this; the port must add rAF debouncing and scope to cart area. PITFALLS.md Pitfall 1 cites "MutationObserver CPU loop" as a real risk on React+MUI rapid re-renders.
- **Firing `cash-register-ready` on first `dom-ready`** — login page fires `dom-ready` too. Must wait for a post-login `[data-role]` element that doesn't exist on login. See §"Cash-register-ready detection selector".
- **Calling `insertCSS` without awaiting / without tracking the key** — not required for correctness but planner should either (a) not await and accept that a tiny race exists, or (b) await and serialize injection steps. Prototype does not await; recommended for Phase 2 is **await both injection calls inside each event handler** so the drain-poll immediately after sees consistent state.
- **Using `BrowserView`** — deprecated. Use `WebContentsView`.
- **Putting fragile selectors in `src/main/magiclineView.js`** — breaks the D-11 contract. Drift patches must not require editing the main process.
- **Relying solely on `did-finish-load`** — SUMMARY.md mentions this as the prototype's original approach; hash-route SPAs require `did-navigate-in-page` as well.

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| Viewport fit on arbitrary kiosk resolution | CSS `transform: scale` layout math | `webContents.setZoomFactor(N)` | D-08. Zero DOM manipulation, honors Magicline's own responsive CSS, survives re-renders. |
| Isolated cookie storage for Magicline | Custom cookie jar | `session.fromPartition('persist:magicline')` | D-14. Built-in persistence + isolation. [CITED: electronjs.org/docs/latest/api/session] |
| Flash-of-unhidden-UI mitigation | Custom paint-hold logic | Phase 1's existing splash overlay (`#splash` stays up until `cash-register-ready`) + `did-start-navigation` insertCSS | Splash cover is already built and proven. Adding `did-start-navigation` + `dom-ready` double-insertCSS closes the remaining window. |
| React controlled-input value bypass | Input simulation via robotjs | `Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input, value)` + dispatch `input`/`change` | CLAUDE.md explicitly rejects robotjs. Pattern is proven in the prototype. |
| Config that survives uninstall | Plain JSON write | `electron-store@10` | CJS-compatible, atomic writes, userData path auto-resolved. |
| IPC from untrusted page → main | Custom postMessage bridge with preload | `executeJavaScript`-returned drain queue (Pattern 5) | Keeps child view preload-free per D-15. Cheap (250 ms poll). |

**Key insight:** Every "don't hand-roll" item above is rejected because the prototype or existing stack already solves it with less code. The only net-new module in Phase 2 is `src/main/magiclineView.js`, and it's a thin glue layer (<200 lines).

## Runtime State Inventory

Phase 2 is a new-file phase with a small additive surface on existing files. Still worth enumerating:

| Category | Items found | Action Required |
|----------|-------------|------------------|
| Stored data | None — child view has no data on first Phase 2 boot. After Phase 2, `persist:magicline` partition will hold Magicline cookies/localStorage/IndexedDB in `%AppData%/Bee Strong POS/Partitions/magicline/`. | None in Phase 2; Phase 4 will clear via `session.fromPartition('persist:magicline').clearStorageData()`. |
| Live service config | None — zero server-side config. | None. |
| OS-registered state | None — Phase 1's `setLoginItemSettings` stays as-is. No new scheduled tasks. | None. |
| Secrets/env vars | None — credentials are Phase 3. | None. |
| Build artifacts / installed packages | `electron-store@^10.1.0` will be added to `node_modules` and must appear in `package-lock.json`. | `npm install electron-store@^10.1.0` as a task step. |

## Common Pitfalls

### Pitfall 1: Flash-of-unhidden-UI before insertCSS applies

**What goes wrong:** Magicline paints its full UI for 200–800 ms before `insertCSS` runs on `dom-ready`. The sidebar + topbar + Rabatt button are briefly visible and tappable.

**Why it happens:** `dom-ready` fires AFTER the document is parsed, which is after first paint on a fast device. `insertCSS` applied here is late by one frame.

**How to avoid (belt+braces):**
1. **Splash cover stays up** until `cash-register-ready` IPC — Phase 1 already delivers this; Phase 2 just wires the IPC trigger. The member never sees first-paint during cold boot.
2. **`did-start-navigation` pre-injection** — on every navigation, `insertCSS` is called as early as possible. The CSS is already in the render tree when the new document starts painting.
3. **`dom-ready` re-injection** — belt to (2)'s braces. Redundant but cheap.
4. **executeJavaScript on dom-ready** — runs `hideDynamicElements()` once on first pass to catch anything the CSS doesn't cover (Rabatt, discount icon).

**Warning signs:** Sidebar/topbar briefly visible after auto-update quitAndInstall restart, or after idle reset. Log line `did-start-navigation` without corresponding `insertCSS-applied` within 100 ms.

### Pitfall 2: MutationObserver CPU loop on React re-renders

**What goes wrong:** Prototype's `new MutationObserver(hideDynamicElements).observe(document.body, {childList:true, subtree:true})` fires on every tiny React mutation. `hideDynamicElements` walks every `[data-role="button"]` and every `path` on each call. On a busy page this is 100+ calls/second.

**Why it happens:** Overly broad scope + unthrottled callback.

**How to avoid:** See Pattern 3 above. Scope to the smallest stable parent of Rabatt+discount-icon, debounce to `requestAnimationFrame`, and guard with `window.__bskiosk_injected__` to prevent observer stacking on repeat injection.

**Warning signs:** High CPU when member is just standing at the kiosk. `hideDynamicElements` log events firing faster than 10/sec.

### Pitfall 3: MUI `css-xxxxx` drift

**What goes wrong:** First Magicline deploy after launch re-hashes emotion class names. `.css-p8umht` disappears. Product grid suddenly reappears on the kiosk.

**How to avoid:** D-05 boot-time self-check catches this on the next cold boot. D-06 drift IPC → branded error overlay prevents members from seeing leaked UI. D-10/D-11 isolation into `src/inject/fragile-selectors.js` + `inject.css` FRAGILE section means the fix is a one-PR-one-directory edit, shippable as a patch release via electron-updater within one reboot cycle.

**Fallback for fragile selectors:** Where structural/text fallbacks exist (the prototype only has them for Rabatt and the discount icon, both by text/SVG — not by class), they must live in `hideDynamicElements()` so they keep working even if the fragile class is gone. For the three fragile CSS selectors (product grid tablet, Kategorien button, h5 heading), no structural fallback is currently known — the self-check is the only detection path.

### Pitfall 4: Hash-route navigation bypassing `did-navigate`

**What goes wrong:** Magicline navigates from `/#/login` → `/#/cash-register` as a hash change. `did-navigate` does not fire. Injection is not re-applied. CSS is already in place (engine-level) but the cash-register-ready detection never runs.

**How to avoid:** Use `did-navigate-in-page` as the primary re-injection trigger — it fires specifically for hash-route changes. Confirmed: [CITED: electronjs.org/docs/latest/api/web-contents].

### Pitfall 5: `session.fromPartition('persist:magicline')` cookie persistence gotchas

**What goes wrong:** Developer expects cookies to persist but forgets `flushStore()` after programmatic writes; or expects them to NOT persist and is surprised they do.

**How to avoid:** 
- Confirmed: `'persist:'` prefix creates persistent storage across app restarts. [CITED: electronjs.org/docs/latest/api/session]
- In Phase 2 we only READ from the partition (Magicline sets its own cookies via HTTP responses). No `flushStore()` needed here — that's a Phase 4 concern when idle reset clears storage.
- The partition name `'persist:magicline'` is stable and documented in D-14; Phases 3/4 MUST reuse this exact string.

### Pitfall 6: Electron API drift between BrowserView and WebContentsView

**What goes wrong:** Tutorials and StackOverflow answers still reference `BrowserView`. Developer copies deprecated `mainWindow.setBrowserView(view)` pattern instead of `mainWindow.contentView.addChildView(view)`.

**How to avoid:** Use ONLY the `WebContentsView` API. Resize on window resize via `view.setBounds({x, y, width, height})` computed from `mainWindow.getContentBounds()`. Remove with `mainWindow.contentView.removeChildView(view)`. [CITED: electronjs.org/docs/latest/api/web-contents-view]

## Code Examples

### Creating the Magicline child view (magiclineView.js skeleton)

```javascript
// src/main/magiclineView.js
// Source: Electron docs — electronjs.org/docs/latest/api/web-contents-view
//         electronjs.org/docs/latest/api/session
const { WebContentsView, session, screen } = require('electron');
const fs = require('fs');
const path = require('path');
const log = require('./logger');
const { attachLockdown } = require('./keyboardLockdown');

const MAGICLINE_URL = 'https://bee-strong-fitness.web.magicline.com/#/cash-register';
const PARTITION = 'persist:magicline';  // D-14 — STABLE across phases
const DRAIN_INTERVAL_MS = 250;

const INJECT_CSS   = fs.readFileSync(path.join(__dirname, '..', 'inject', 'inject.css'), 'utf8');
const FRAGILE_JS   = fs.readFileSync(path.join(__dirname, '..', 'inject', 'fragile-selectors.js'), 'utf8');
const INJECT_JS    = fs.readFileSync(path.join(__dirname, '..', 'inject', 'inject.js'), 'utf8');
const INJECT_BUNDLE = FRAGILE_JS + '\n;\n' + INJECT_JS;

let magiclineView = null;
let drainTimer = null;
let readyFired = false;
let driftActive = false;

function createMagiclineView(mainWindow, store /* electron-store instance */) {
  magiclineView = new WebContentsView({
    webPreferences: {
      partition: PARTITION,                 // D-14
      contextIsolation: true,                // D-15
      sandbox: true,                          // D-15
      nodeIntegration: false,                 // D-15
      // NO preload (D-15)
      devTools: process.env.NODE_ENV === 'development',  // D-13
    },
  });

  mainWindow.contentView.addChildView(magiclineView);
  sizeChildView(mainWindow);
  mainWindow.on('resize', () => sizeChildView(mainWindow));

  // D-02 — reuse Phase 1 lockdown on child view's webContents
  attachLockdown(magiclineView.webContents);

  // D-09 — zoom factor from config override or runtime default
  const zoom = store.get('magiclineZoomFactor', computeDefaultZoom());
  magiclineView.webContents.setZoomFactor(zoom);
  log.info('magicline.zoom: factor=' + zoom);

  // D-13 — dev DevTools on child view
  if (process.env.NODE_ENV === 'development') {
    magiclineView.webContents.openDevTools({ mode: 'detach' });
  }

  wireInjection(magiclineView.webContents, mainWindow);
  startEventDrain(magiclineView.webContents, mainWindow);

  magiclineView.webContents.loadURL(MAGICLINE_URL);
  log.info('magicline.view.created: partition=' + PARTITION);

  return magiclineView;
}

function sizeChildView(mainWindow) {
  const { width, height } = mainWindow.getContentBounds();
  magiclineView.setBounds({ x: 0, y: 0, width, height });
}

function computeDefaultZoom() {
  // D-09: derive from primary display. Planner must flag for measurement
  // on the actual kiosk device and override via electron-store config.
  const { width } = screen.getPrimaryDisplay().workAreaSize;
  // Magicline desktop minimum useful width ≈ 1280 px (ASSUMED, verify in UAT).
  // For a 768-wide tablet screen: 768/1280 = 0.6 → too small. For a 1080-wide
  // vertical screen: 1080/1280 = 0.84. Clamp to [0.7, 1.25].
  return Math.max(0.7, Math.min(1.25, width / 1280));
}

function wireInjection(wc, mainWindow) {
  wc.on('did-start-navigation', async (_e, url, isInPlace, isMainFrame) => {
    if (!isMainFrame) return;
    try { await wc.insertCSS(INJECT_CSS); } catch (err) { log.warn('insertCSS failed on did-start-navigation: ' + err.message); }
  });

  wc.on('dom-ready', async () => {
    try {
      await wc.insertCSS(INJECT_CSS);
      await wc.executeJavaScript(INJECT_BUNDLE, true);
      log.info('magicline.injected: dom-ready');
    } catch (err) {
      log.error('magicline.inject.failed (dom-ready): ' + err.message);
    }
  });

  wc.on('did-navigate-in-page', async (_e, url) => {
    try {
      await wc.insertCSS(INJECT_CSS);
      await wc.executeJavaScript(INJECT_BUNDLE, true);
      log.info('magicline.injected: did-navigate-in-page url=' + url);
    } catch (err) {
      log.error('magicline.inject.failed (did-navigate-in-page): ' + err.message);
    }
  });

  wc.on('render-process-gone', (_e, details) => {
    log.error('magicline.render-process-gone: ' + JSON.stringify(details));
    // Phase 4 will handle reload + recovery; Phase 2 just logs.
  });
}

function startEventDrain(wc, mainWindow) {
  drainTimer = setInterval(async () => {
    if (wc.isDestroyed()) { clearInterval(drainTimer); return; }
    try {
      const events = await wc.executeJavaScript(
        '(() => { const q = window.__bskiosk_events || []; window.__bskiosk_events = []; return q; })()',
        true
      );
      if (!Array.isArray(events)) return;
      for (const e of events) handleInjectEvent(e, mainWindow);
    } catch (err) {
      // Page not ready yet / navigating — swallow
    }
  }, DRAIN_INTERVAL_MS);
}

function handleInjectEvent(e, mainWindow) {
  if (e.type === 'drift') {
    log.warn('magicline.drift: selector=' + e.payload.selector + ' category=' + e.payload.category);
    if (!driftActive) {
      driftActive = true;
      mainWindow.webContents.send('show-magicline-error', {
        message: 'Kasse vorübergehend nicht verfügbar — Bitte wenden Sie sich an das Studio-Personal'
      });
    }
    return;
  }
  if (e.type === 'cash-register-ready') {
    if (driftActive) return;   // D-06: drift overlay takes precedence over splash lift
    if (readyFired) return;    // D-04: one-shot
    readyFired = true;
    log.info('magicline.cash-register-ready: url=' + e.payload.url);
    // Reuse Phase 1 IPC
    const { ipcMain } = require('electron');
    // Fire the Phase 1 handler directly — it is wired on ipcMain in main.js.
    // Cleanest path: dispatch via webContents.send from main to main is not
    // a thing, so just call the host-side hide directly:
    mainWindow.webContents.send('splash:hide');
    return;
  }
}

module.exports = { createMagiclineView };
```

### Hook-up in `src/main/main.js`

Insert inside `app.whenReady().then(...)` after `createMainWindow()` and the `attachLockdown(mainWindow.webContents)` call:

```javascript
const Store = require('electron-store');
const { createMagiclineView } = require('./magiclineView');

const store = new Store({ name: 'config' });
createMagiclineView(mainWindow, store);
```

### Inject.js skeleton (ported from prototype + Phase 2 additions)

```javascript
// src/inject/inject.js
// Consumed as a string by webContents.executeJavaScript in the MAIN WORLD.
// Runs AFTER fragile-selectors.js, so FRAGILE_SELECTORS and STABLE_SELECTORS
// are in scope.
(function () {
  'use strict';

  // Idempotency guard — survives re-injection on did-navigate-in-page.
  if (window.__bskiosk_injected__) {
    // Already installed listeners/observer. Just re-run the dynamic hide pass
    // and the self-check (cheap, no stacking).
    try { window.__bskiosk_hideDynamic && window.__bskiosk_hideDynamic(); } catch (e) {}
    try { window.__bskiosk_selfCheck && window.__bskiosk_selfCheck(); } catch (e) {}
    try { window.__bskiosk_detectReady && window.__bskiosk_detectReady(); } catch (e) {}
    return;
  }
  window.__bskiosk_injected__ = true;
  window.__bskiosk_events = window.__bskiosk_events || [];

  function emit(type, payload) {
    window.__bskiosk_events.push({ type: type, payload: payload || {}, t: Date.now() });
  }

  // --- setMuiValue (ported from prototype, lines 371-378) ---
  // MUST run in main world (executeJavaScript default) to access the cached
  // React-patched HTMLInputElement prototype.
  function setMuiValue(input, value) {
    var setter = Object.getOwnPropertyDescriptor(
      window.HTMLInputElement.prototype, 'value'
    ).set;
    setter.call(input, value);
    input.dispatchEvent(new Event('input',  { bubbles: true }));
    input.dispatchEvent(new Event('change', { bubbles: true }));
  }

  // --- hideDynamicElements (ported from prototype, lines 380-400) ---
  function hideDynamicElements() {
    // Rabatt button group by text (stable even if MUI classes rename)
    document.querySelectorAll('[data-role="button"]').forEach(function (btn) {
      if (btn.textContent && btn.textContent.trim() === 'Rabatt') {
        var group = btn.closest('.MuiButtonGroup-root');
        if (group) group.style.setProperty('display', 'none', 'important');
      }
    });
    // Discount icon by SVG path prefix
    document.querySelectorAll('path').forEach(function (p) {
      var d = p.getAttribute('d');
      if (d && d.indexOf('m21.41 11.41') === 0) {
        var svg = p.closest('svg');
        if (svg) {
          var btn = svg.closest('button');
          if (btn) btn.style.setProperty('display', 'none', 'important');
          else svg.style.setProperty('display', 'none', 'important');
        }
      }
    });
  }
  window.__bskiosk_hideDynamic = hideDynamicElements;

  // --- Boot-time self-check (EMBED-05, D-05) ---
  function selfCheck() {
    var all = (typeof STABLE_SELECTORS !== 'undefined' ? STABLE_SELECTORS : [])
      .concat(typeof FRAGILE_SELECTORS !== 'undefined' ? FRAGILE_SELECTORS : []);
    for (var i = 0; i < all.length; i++) {
      var entry = all[i];
      var count = 0;
      try { count = document.querySelectorAll(entry.selector).length; } catch (e) { count = -1; }
      if (count === 0) {
        emit('drift', {
          selector: entry.selector,
          category: entry.category,
          purpose: entry.purpose
        });
      }
    }
  }
  window.__bskiosk_selfCheck = selfCheck;

  // --- Cash-register-ready detection (D-03) ---
  // RECOMMENDED SELECTOR: '[data-role="product-search"] input'
  // Rationale: product-search exists only on the cash register page (not login,
  // not dashboard). The inner <input> must be queryable, which is also a
  // prerequisite for EMBED-06 / Phase 4 (NFC still targets the customer-search
  // input, but product-search presence is a cash-register-page proxy).
  // Alternative considered: [data-role="customer-search"] input — also works
  // and is needed by NFC anyway, BUT customer-search is in the CSS hide list
  // so the container has display:none. The inner <input> is still in the DOM
  // but planner should confirm on live Magicline that querySelector still
  // finds it under a display:none ancestor (it does — display:none does not
  // remove elements from the DOM tree, only from layout/painting).
  // RECOMMENDATION: use '[data-role="product-search"] input' as the primary
  // signal, with a fallback to checking location.hash matches /#\/cash-register/.
  var READY_SELECTOR = '[data-role="product-search"] input';
  function detectReady() {
    if (location.hash && /#\/cash-register/.test(location.hash)) {
      var el = document.querySelector(READY_SELECTOR);
      if (el) emit('cash-register-ready', { url: location.hash });
    }
  }
  window.__bskiosk_detectReady = detectReady;

  // --- MutationObserver (scoped + rAF-debounced, Pattern 3) ---
  var pending = false;
  function schedule() {
    if (pending) return;
    pending = true;
    window.requestAnimationFrame(function () {
      pending = false;
      hideDynamicElements();
      detectReady();
    });
  }
  // Scope: prefer the closest stable parent of cart area. Fall back to body.
  var observeTarget = document.querySelector('main') || document.body;
  new MutationObserver(schedule).observe(observeTarget, {
    childList: true,
    subtree: true
  });

  // Initial pass
  hideDynamicElements();
  selfCheck();
  detectReady();
})();
```

### host.html addition (per D-07)

```html
<!-- Insert as sibling of #splash, BEFORE the closing </body> -->
<div id="magicline-error" class="bsk-layer bsk-layer--magicline-error" style="display:none;">
  <img src="assets/logo-dark.png" class="bsk-logo" alt="Bee Strong Fitness" width="220">
  <h1 class="bsk-error-title">Kasse vorübergehend nicht verfügbar</h1>
  <p class="bsk-error-subtext">Bitte wenden Sie sich an das Studio-Personal</p>
</div>
```

### host.css z-index ladder update

```css
/* Insert between .bsk-layer--splash and whatever Phase 4/5 adds. */
.bsk-layer--magicline-error {
  z-index: 300;
  background: #1A1A1A;
  pointer-events: auto;  /* blocks touches to Magicline underneath */
}
.bsk-error-title {
  font-size: 28px;
  font-weight: 600;
  color: #F5C518;
  margin: 24px 0 8px 0;
  text-align: center;
  padding: 0 32px;
}
.bsk-error-subtext {
  font-size: 16px;
  color: #9CA3AF;
  text-align: center;
  padding: 0 32px;
}
```

### preload.js extension

```javascript
// Add inside contextBridge.exposeInMainWorld('kiosk', { ... }):
onShowMagiclineError: (cb) => ipcRenderer.on('show-magicline-error', (_e, payload) => cb(payload)),
onHideMagiclineError: (cb) => ipcRenderer.on('hide-magicline-error', () => cb()),
```

### host.js extension

```javascript
// Append inside the IIFE:
function showMagiclineError(payload) {
  var el = document.getElementById('magicline-error');
  if (!el) return;
  if (payload && payload.message) {
    var sub = el.querySelector('.bsk-error-subtext');
    if (sub) sub.textContent = payload.message;
  }
  el.style.display = 'flex';
}
function hideMagiclineError() {
  var el = document.getElementById('magicline-error');
  if (el) el.style.display = 'none';
}
if (window.kiosk && window.kiosk.onShowMagiclineError) window.kiosk.onShowMagiclineError(showMagiclineError);
if (window.kiosk && window.kiosk.onHideMagiclineError) window.kiosk.onHideMagiclineError(hideMagiclineError);
```

## What the Planner Must Do

This is the prescriptive work breakdown. Every decision in D-01..D-15 maps to a concrete action.

### Wave 0 — Dependency add + scaffolding
1. `npm install electron-store@^10.1.0` → updates `package.json` + `package-lock.json`. Verify CJS-compat (10.x line).
2. Create `src/inject/` directory with `README.md` stating the drift-patch contract from D-11.
3. Create empty files: `src/inject/inject.css`, `src/inject/inject.js`, `src/inject/fragile-selectors.js`, `src/main/magiclineView.js`.

### Wave 1 — Port prototype verbatim (D-12)
4. Port `inject.css` from `BeeStrong_POS_Kiosk_Project.md` lines 349–358 into `src/inject/inject.css`, split into STABLE section and FRAGILE section (Pattern 6).
5. Port `inject.js` prototype body from lines 361–454, wrapping it in the idempotency guard + rAF debounce + emit() backchannel + selfCheck + detectReady (see code example above). **Remove** the prototype's NFC badge-capture path (lines 414–438) — NFC is Phase 4 scope. **Remove** the post-sale `setTimeout(resetSession, 3000)` click handler (lines 440–446) — that's Phase 4 scope too (IDLE-06).
6. Extract three fragile selectors (`.MuiBox-root.css-p8umht`, `.css-qo4f3u`, `.MuiTypography-h5.css-1b1c5ke`) + stable-selector metadata into `src/inject/fragile-selectors.js` as plain `var FRAGILE_SELECTORS = [...]` / `var STABLE_SELECTORS = [...]`. See Pattern 4.

### Wave 2 — Main-process child view module (D-01, D-02, D-08, D-09, D-13, D-14, D-15)
7. Implement `src/main/magiclineView.js` per the skeleton above. Key points:
   - `WebContentsView` (not deprecated `BrowserView`).
   - `mainWindow.contentView.addChildView(view)` + `view.setBounds(...)` computed from `mainWindow.getContentBounds()`.
   - `webPreferences: { partition: 'persist:magicline', contextIsolation: true, sandbox: true, nodeIntegration: false, devTools: isDev }` — no preload.
   - Call `attachLockdown(view.webContents)` immediately after creation (D-02).
   - `setZoomFactor(store.get('magiclineZoomFactor', computeDefaultZoom()))`.
   - Resize handler on `mainWindow.on('resize', ...)`.
   - `render-process-gone` logging (full recovery is Phase 4).
8. Implement injection wiring (`wireInjection`) on `did-start-navigation` (insertCSS only), `dom-ready` (insertCSS + executeJavaScript), `did-navigate-in-page` (both).
9. Implement `startEventDrain` — `setInterval` every 250 ms, `executeJavaScript('(() => { const q = window.__bskiosk_events || []; window.__bskiosk_events = []; return q; })()', true)`, dispatch events to `handleInjectEvent`.

### Wave 3 — IPC channels + host overlay (D-06, D-07)
10. Add `<div id="magicline-error">` to `src/host/host.html` as sibling of `#splash`.
11. Add `.bsk-layer--magicline-error` at `z-index: 300` to `src/host/host.css`.
12. Extend `src/main/preload.js` with `onShowMagiclineError` / `onHideMagiclineError` callbacks on `window.kiosk`.
13. Extend `src/host/host.js` with `showMagiclineError(payload)` / `hideMagiclineError()` functions subscribed to the preload callbacks.
14. In `handleInjectEvent`, on `drift`: set `driftActive = true`, `mainWindow.webContents.send('show-magicline-error', {message})`, log warning. On `cash-register-ready`: guard with `driftActive === false && !readyFired`, then `mainWindow.webContents.send('splash:hide')` (Phase 1 handler already wired).

### Wave 4 — main.js integration
15. In `src/main/main.js`, after `createMainWindow()` + `attachLockdown(mainWindow.webContents)`, add:
    ```javascript
    const Store = require('electron-store');
    const { createMagiclineView } = require('./magiclineView');
    const store = new Store({ name: 'config' });
    createMagiclineView(mainWindow, store);
    ```
16. **Do NOT** remove the existing `ipcMain.on('cash-register-ready', ...)` handler in main.js — keep it as a fallback IPC path in case future phases want to send cash-register-ready explicitly. Phase 2's primary path is the `handleInjectEvent` drain-poll, which calls `mainWindow.webContents.send('splash:hide')` directly.

### Wave 5 — Verification (EMBED-05 + success criteria)
17. Dev-mode verification: `NODE_ENV=development npm start` → (a) Phase 1 host window opens with splash, (b) Magicline loads in child view underneath splash, (c) hide rules applied, (d) after login (manual in dev), `[data-role="product-search"] input` appears → splash lifts → member sees clean cash register.
18. Drift-simulation verification: edit `inject.css` to reference a non-existent class `.css-deadbeef` in the FRAGILE section AND add the same entry to `fragile-selectors.js`. Boot. Expected: `magicline-drift-detected` IPC fires → error overlay visible → splash does NOT lift → log.warn line present.
19. Hash-navigation verification: in DevTools on child view, run `location.hash = '#/not-cash-register'` → injection re-applies via `did-navigate-in-page` → self-check re-runs → (if anything missing on that page) drift fires.
20. Resize verification: in dev mode, drag window corner → child view resizes to match (`setBounds` from resize handler).

### Wave 6 — Zoom factor measurement (D-09 deferred to first real-device test)
21. On first deployment to the actual kiosk terminal, SSH/RDP in and run:
    ```javascript
    // Via DevTools on the host window in an admin-exit session:
    // screen.getPrimaryDisplay() returns { size: {width, height}, scaleFactor, ... }
    ```
    Record physical resolution + scaleFactor. Compute zoom factor: target is "touch targets ≥44×44 px, body text ≥16 px, Jetzt verkaufen button comfortably tappable at vertical tablet orientation".
22. Set the override via electron-store config file at `%AppData%/Bee Strong POS/config.json`: `{"magiclineZoomFactor": <measured_value>}`. Restart kiosk. Verify.
23. Document the measured value in an admin runbook entry. Current state as of 2026-04-08: **kiosk screen resolution is UNKNOWN; `computeDefaultZoom()` clamp of [0.7, 1.25] is a starting guess only**.

## State of the Art

| Old approach | Current approach | When changed | Impact |
|--------------|------------------|--------------|--------|
| `BrowserView` + `mainWindow.setBrowserView(view)` | `WebContentsView` + `mainWindow.contentView.addChildView(view)` | Electron 29 (BrowserView deprecated) | All Phase 2 code must use the new API. Old tutorials will mislead. |
| Injection via single `did-finish-load` handler | `did-start-navigation` + `dom-ready` + `did-navigate-in-page` trio | Incremental best practice for React SPAs with hash routing | Prevents FOUUI on full reloads and missed re-injection on hash navigation. |
| Single global MutationObserver on `document.body` unthrottled | Scoped observer + rAF debouncing + idempotency guard | Emerged from PITFALLS.md MutationObserver CPU-loop analysis | Prevents high CPU on React re-renders; prototype's naive observer must be updated in the port. |
| preload + `ipcRenderer` from page script | `executeJavaScript`-returned drain queue (no preload) for untrusted content | Security hardening pattern for third-party content | D-15 compliance; Magicline never gets access to any bridge, even a read-only one. |

**Deprecated / outdated:**
- `BrowserView` class — use `WebContentsView`.
- `mainWindow.setBrowserView(view)` / `addBrowserView(view)` — use `mainWindow.contentView.addChildView(view)`.

## Assumptions Log

| # | Claim | Section | Risk if wrong |
|---|-------|---------|---------------|
| A1 | Kiosk screen resolution is UNKNOWN as of 2026-04-08; `computeDefaultZoom()` clamp `[0.7, 1.25]` with 1280 px reference width is a guess | D-09 / computeDefaultZoom() | Default may render unusably small or cropped on first boot. Mitigation: `electron-store` override is one config-file edit away; admin runbook documents the fix. FLAG for measurement on first real-device install. |
| A2 | `[data-role="product-search"] input` exists on the cash-register page and NOT on the login page | Cash-register-ready detection selector | Wrong selector → splash lifts too early (login wall visible) or never (member stares at splash). Mitigation: combined with `location.hash` check for `#/cash-register`; drift self-check will also catch a missing `[data-role="product-search"]`. Planner should confirm against live Magicline before committing the selector. |
| A3 | `electron-store@10.1.x` is still current and CJS-compatible | Standard Stack | Wrong version → ESM import error in main.js. Mitigation: planner runs `npm view electron-store@10 version` before writing the install step. |
| A4 | `executeJavaScript` without `executeJavaScriptInIsolatedWorld` runs in the main world | Pattern 2, Pattern 5 | If actually isolated world, the MUI setter fails silently and NFC injection (Phase 4) breaks. **VERIFIED** via Electron docs for web-contents.md — [CITED: electronjs.org/docs/latest/api/web-contents]. Low risk. |
| A5 | Three fragile selectors from the prototype (`.MuiBox-root.css-p8umht`, `.css-qo4f3u`, `.MuiTypography-h5.css-1b1c5ke`) are still valid on live Magicline as of 2026-04-08 | Pattern 6, fragile-selectors.js | If already drifted, Wave 5 verification fires drift warnings on first boot. Mitigation: that is exactly the signal the self-check is designed to catch — drift warnings at first run tell the planner to re-inspect live Magicline via DevTools and update `fragile-selectors.js` + `inject.css`. |
| A6 | The prototype's React-native value setter pattern still works against current Magicline MUI | Pattern 2 | If MUI has changed its controlled-input mechanism, the setter call is a no-op and Phase 4 NFC + Phase 3 auto-login break. Mitigation: prototype was verified working against live Magicline during original project scout; pattern is stable React idiom documented in React discussions since 2017. LOW risk. |
| A7 | `document.body` in Magicline always has a `main` element as child (for scoped MutationObserver target) | Pattern 3 | If not, falls back to `document.body` which brings back the CPU-loop risk (but mitigated by rAF debouncing). LOW risk. |
| A8 | `display:none` on `[data-role="customer-search"]` container leaves the inner `<input>` queryable via `document.querySelector('[data-role="customer-search"] input')` | EMBED-06 | If wrong, Phase 4 NFC injection cannot find the target. **VERIFIED** — `display:none` removes elements from layout/paint but NOT from the DOM tree; `querySelector` traverses the DOM tree regardless of CSS. Standard HTML/CSS behavior. NEGLIGIBLE risk. |

**User-facing assumption that needs confirmation before execution:** A1 (screen resolution) and A2 (cash-register-ready selector). Neither blocks Wave 0-4; A1 is a Wave 6 activity, and A2 can be verified during Wave 5 dev-mode verification by manually logging into Magicline and watching for the ready event.

## Open Questions

1. **Kiosk screen physical resolution and scale factor**
   - What we know: Vertical touchscreen tablet orientation. Dev simulation at 420×800.
   - What's unclear: Real pixel count, Windows DPI scaling setting, physical dimensions.
   - Recommendation: Flag for operator to measure on first RDP session with the device. `magiclineZoomFactor` in `electron-store` config file is the single tuning knob. Wave 6.

2. **Exact `[data-role="product-search"] input` availability on cash-register page**
   - What we know: Prototype uses this selector in the NFC passthrough logic (`if (focused === productInput) return`) — implying it exists on the cash-register page.
   - What's unclear: Whether it appears immediately on page load or only after React hydration. The MutationObserver + repeat self-check covers the hydration delay case.
   - Recommendation: Wave 5 dev-mode manual verification; if selector is too slow to appear, fall back to `[data-role="customer-search"] input` (guaranteed present per the prototype's own use of it for NFC injection).

3. **Rate of Magicline drift in practice**
   - What we know: MUI `css-xxxxx` classes are known-fragile (PITFALLS.md Pitfall 1).
   - What's unclear: Actual cadence — weekly? monthly? per-Magicline-major-release?
   - Recommendation: Accept and monitor. Self-check log lines + admin review give the data. v2 telemetry (deferred) would formalize this. Not a Phase 2 blocker.

4. **Should the 250 ms drain interval be configurable?**
   - What we know: 250 ms is fast enough that splash-lift feels instant to members.
   - What's unclear: Whether high-load situations (Magicline spinning, slow network) produce enough queue backlog to matter.
   - Recommendation: Hardcode `DRAIN_INTERVAL_MS = 250` for v1. Add `electron-store` override in v2 if measurement shows it matters.

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Electron 41 | Core runtime | ✓ (already installed Phase 1) | ~41.1.1 | — |
| electron-log 5 | Drift / injection logging | ✓ (already installed Phase 1) | ~5.2.0 | — |
| electron-store 10 | D-09 zoom config override | ✗ (NOT YET INSTALLED) | — | MUST `npm install electron-store@^10.1.0` as Wave 0 step |
| Magicline reachability | Live-view verification | ✗ (uncontrolled third-party) | — | Dev mode can test with `file://`-loaded stub page; full verification requires real network |
| Real kiosk terminal screen | D-09 zoom measurement | ✗ (unknown resolution as of 2026-04-08) | — | Wave 6 deferred task; dev default is clamped heuristic |

**Missing dependencies with no fallback:** None — everything blocking Phase 2 can be `npm install`ed.

**Missing dependencies with fallback:** Magicline reachability (dev stub acceptable for Wave 5 verification); real kiosk screen (Wave 6 measurement acceptable).

## Validation Architecture

### Test Framework

| Property | Value |
|----------|-------|
| Framework | **None — no test framework currently configured** |
| Config file | — (no jest.config, no vitest.config, no mocha config) |
| Quick run command | — |
| Full suite command | — |
| Phase 1 precedent | Phase 1 used **manual dev-mode verification** + human visual checkpoint (plan 01-06). No automated tests were added. |

### Phase Requirements → Test Map

Because there is no test infrastructure and Phase 1 deliberately did not add one, Phase 2 follows the Phase 1 convention of **manual dev-mode verification** for EMBED-01..06. This matches CLAUDE.md's "plain JS, no bundler, no TS" minimalism.

| Req ID | Behavior | Test Type | Procedure | Automated? |
|--------|----------|-----------|-----------|-----------|
| EMBED-01 | Magicline loads in WebContentsView child of host window | manual | `NODE_ENV=development npm start` → visually confirm Magicline content visible under splash in dev (splash is translucent in dev? check host.css — NO, splash is opaque; in dev workflow, splash is dismissed on first cash-register-ready) | no |
| EMBED-02 | Stable CSS hide rules applied + re-applied on hash nav | manual | Dev start → log in manually → verify sidebar/topbar/global-search/categories hidden → in DevTools run `location.hash = '#/something-else'` then back to `/#/cash-register` → verify hides persist | no |
| EMBED-03 | Dynamic JS hiding (Rabatt + discount icon) + MUI setter callable | manual | After login, visually verify no Rabatt button group visible. In DevTools console: `window.__bskiosk_injected__` === true. | no |
| EMBED-04 | Fragile selectors isolated in `src/inject/fragile-selectors.js` only | automated | `grep -r 'css-p8umht\|css-qo4f3u\|css-1b1c5ke' src/` → only hits in `src/inject/inject.css` and `src/inject/fragile-selectors.js`, NO hits in `src/main/` | yes (grep) |
| EMBED-05 | Boot-time self-check logs warning on missing selector | manual + log inspection | Edit `fragile-selectors.js` to add a bogus `.css-deadbeef` entry → boot → check `%AppData%/Bee Strong POS/logs/main.log` for `magicline.drift: selector=.css-deadbeef` line → verify branded error overlay visible → verify splash did NOT lift | no (log file inspection) |
| EMBED-06 | `document.querySelector('[data-role="customer-search"] input')` returns live element even though container is `display:none` | manual | After Magicline is loaded, in DevTools console on child view: `document.querySelector('[data-role="customer-search"] input')` → must return an HTMLInputElement, not null | no |

### Sampling Rate

- **Per task commit:** grep-based EMBED-04 check (one shell command).
- **Per wave merge:** `npm start` in dev mode, walk through the 6-step verification in Wave 5.
- **Phase gate:** All 6 manual verifications pass + grep check clean + log file shows zero drift warnings on a clean boot.

### Wave 0 Gaps

- [ ] No automated test framework exists. Recommendation: **DO NOT** add one in Phase 2 — matches Phase 1 precedent and CLAUDE.md minimalism. If Phase 5 (auto-update) needs automated tests for the safe-window state machine, add then.
- [ ] No grep check in CI — add as a manual step in the plan's Wave 5 checklist.

*(If the planner disagrees and wants to add a Vitest/Jest harness in Phase 2, they should escalate first — it expands scope significantly and Phase 1 already set the "no test framework" precedent.)*

## Security Domain

Magicline is untrusted third-party content loaded in a sandboxed partition. ASVS coverage for Phase 2:

| ASVS category | Applies | Standard control |
|---------------|---------|------------------|
| V2 Authentication | no (Phase 3) | — |
| V3 Session Management | partial | Partition isolation via `session.fromPartition('persist:magicline')`; host session untouched by Magicline. Full clear is Phase 4. |
| V4 Access Control | yes | `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, no preload on child view → Magicline cannot touch Node, fs, child_process, or any Bee Strong state. Keyboard lockdown re-applied on child view via `attachLockdown`. |
| V5 Input Validation | partial | Drain-queue events from inject.js must be validated in `handleInjectEvent` — check `e.type` against a whitelist, coerce `e.payload.selector` to a string before logging. Never interpolate Magicline-sourced data into `executeJavaScript` or shell commands. |
| V6 Cryptography | no (Phase 3) | — |

### Known threat patterns for Phase 2

| Pattern | STRIDE | Standard mitigation |
|---------|--------|---------------------|
| Malicious JS in Magicline attempts to access Node APIs | Elevation of Privilege | `contextIsolation: true` + `sandbox: true` + `nodeIntegration: false` + no preload (D-15) — Node is fundamentally unreachable from the child view's main world. |
| Magicline iframes pointing at arbitrary URLs | Spoofing | Child view is locked to `bee-strong-fitness.web.magicline.com`; `will-navigate` handler should `event.preventDefault()` any navigation to a different host (Phase 2 nice-to-have; Phase 5 formalizes). |
| Drain queue injection — a compromised Magicline planting fake `{type: 'cash-register-ready'}` events | Tampering | `handleInjectEvent` whitelist on `e.type`; cash-register-ready is one-shot (`readyFired` guard) so repeat spoofing has no effect; drift events only ever LOG + show overlay, never execute data. Worst case: attacker causes a false splash-lift or a false error-overlay, neither of which escalates beyond the existing Phase 1 trust boundary. Acceptable risk given D-15's explicit trade-off. |
| Keyboard breakout from focused child view | Elevation of Privilege | `attachLockdown(childView.webContents)` — D-02. The same `before-input-event` suppression Phase 1 attaches to the host is re-attached to the child. |
| `insertCSS` / `executeJavaScript` string injection from config | Code Injection | inject.css / inject.js / fragile-selectors.js are read-only disk files from the app bundle, never constructed from user input. electron-store config only stores numeric `magiclineZoomFactor`. Safe. |

## Sources

### Primary (HIGH confidence — verified 2026-04-08 via WebFetch)
- [Electron WebContentsView API](https://www.electronjs.org/docs/latest/api/web-contents-view) — constructor, `contentView.addChildView`, `setBounds`, webPreferences, attachment pattern
- [Electron BrowserView API (deprecation notice)](https://www.electronjs.org/docs/latest/api/browser-view) — *"The `BrowserView` class is deprecated, and replaced by the new `WebContentsView` class."* Deprecated since Electron 29.
- [Electron WebContents API](https://www.electronjs.org/docs/latest/api/web-contents) — `insertCSS` returns a key usable with `removeInsertedCSS`; `executeJavaScript` runs in the **main world** (not isolated); `did-navigate-in-page` for hash routes; `did-navigate` only on full-document navigations; `dom-ready` once per document; `setZoomFactor`
- [Electron Session API](https://www.electronjs.org/docs/latest/api/session) — `'persist:'` prefix creates persistent cross-restart storage; per-partition isolation for `clearStorageData`
- `BeeStrong_POS_Kiosk_Project.md` lines 346–455 — prototype inject.css and inject.js source (load-bearing, verbatim port target)
- `BeeStrong_POS_Kiosk_Project.md` lines 492–507 — selector table (stable vs fragile)
- `src/main/main.js`, `src/main/keyboardLockdown.js`, `src/host/host.html`, `src/host/host.css`, `src/host/host.js`, `src/main/preload.js`, `src/main/logger.js`, `package.json` — verified Phase 1 interface points

### Secondary (MEDIUM confidence)
- `.planning/research/ARCHITECTURE.md` — pattern direction (host window + child view, one preload per webContents)
- `.planning/research/PITFALLS.md` Pitfall 1–2 — MUI drift, FOUUI, MutationObserver CPU loop
- `.planning/research/STACK.md` — Electron 41 + electron-store 10.x CJS line prescription
- CLAUDE.md — plain JS / CJS / no bundler / no TS constraints

### Tertiary (background)
- `.planning/phases/01-locked-down-shell-os-hardening/01-CONTEXT.md` — referenced via CONTEXT.md canonical_refs (D-01, D-02, D-03, D-10 Phase 1 decisions)

## Metadata

**Confidence breakdown:**
- Standard stack (WebContentsView, session, insertCSS/executeJavaScript APIs): **HIGH** — verified against official Electron docs 2026-04-08
- Prototype port surface (inject.css/inject.js): **HIGH** — source is already embedded in repo, proven against live Magicline during original project scout
- Fragile selectors currently on Magicline: **MEDIUM** — prototype selectors were valid at time of original scout; may have drifted (exactly what the self-check is designed to catch)
- Cash-register-ready selector choice: **MEDIUM** — `[data-role="product-search"] input` is the best educated guess from the prototype's selector table; Wave 5 manual verification will confirm
- Zoom factor derivation (D-09): **LOW** — real kiosk resolution is unknown; formula is a clamp heuristic; Wave 6 measurement task is the true answer
- MutationObserver scoping target (`main` vs body fallback): **MEDIUM** — assumed based on React SPA conventions; planner should verify `document.querySelector('main')` returns something on Magicline during Wave 5
- Drain-poll pattern at 250 ms: **HIGH** — cheap, simple, well within Electron's IPC/executeJS overhead budget
- electron-store 10.1.x version: **MEDIUM** — CLAUDE.md pins the line but exact current patch version needs `npm view` verification

**Research date:** 2026-04-08
**Valid until:** 2026-05-08 (30 days — Electron 41 line is stable; MUI selectors may drift sooner and are caught by the self-check)

---
*Phase 2 research complete. Planner can proceed to `/gsd-plan-phase` for wave breakdown.*
