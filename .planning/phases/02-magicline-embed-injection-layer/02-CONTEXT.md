# Phase 2: Magicline Embed & Injection Layer - Context

**Gathered:** 2026-04-08
**Status:** Ready for research → planning

<domain>
## Phase Boundary

A child view embedded in the existing Phase 1 host window loads Magicline's cash register URL. A permanent CSS hide layer + JS injection strips it to only the elements needed for self-checkout, ports the existing prototype logic verbatim, and isolates fragile MUI `css-xxxxx` selectors so one operator edit can patch a Magicline drift incident. Scope ends at: member sees a clean Magicline cash register page with the sidebar/topbar/categories/customer-search visual/toolbar/Rabatt group/discount icon invisible and staying invisible across React re-renders, with an IPC signal to Phase 1's splash cover that only fires once a post-login cash-register element is actually visible. Auto-login, idle reset, NFC input, and credentials are NOT in this phase — Phase 3 handles credentials, Phase 4 handles NFC + idle.

</domain>

<decisions>
## Implementation Decisions

### Child View Architecture
- **D-01:** Attach a child view (`BrowserView` or `WebContentsView` — class name resolved at research start) to the existing Phase 1 `mainWindow`. The view fills the host viewport underneath the permanent `host.html` splash/error overlay. The host window is NEVER replaced or navigated — Magicline lives in the child view only. Phase 1's `host.html` layer stays on top at all times and is the only place branded overlays render.
- **D-02:** `attachLockdown(childView.webContents)` is called immediately after the child view is created, reusing the reusable `attachLockdown` export from `src/main/keyboardLockdown.js` that Phase 1 left specifically for this purpose. This ensures `before-input-event` suppression fires regardless of which webContents has focus.

### Splash Lift Timing (Phase 2 ↔ Phase 3 seam)
- **D-03:** The injected JS fires the `cash-register-ready` IPC **only after a post-login cash-register-specific element is visible**, not as soon as `insertCSS` returns. The detection selector is a stable Magicline `[data-role=...]` that only exists on the checkout page (e.g. `[data-role="product-search"] input` — final choice at Claude's Discretion, must be cash-register-only and present in the existing prototype's selector list). Effect: Phase 3's auto-login runs **under** the splash; member sees splash → cash register, never splash → login wall → cash register. Decouples Phase 2's "is Magicline showing checkout?" from Phase 3's "how did we get there?" — Phase 3 just needs to eventually land on the cash register URL and Phase 2 will notice.
- **D-04:** On every Magicline navigation (`did-navigate`, `did-navigate-in-page`), Phase 2 re-applies the injection pipeline and re-evaluates the cash-register-ready check. If Magicline session-expires and bounces the user back to login, the splash DOES NOT re-cover — splash lift is a one-shot state transition owned by the main process. Recovery flow is Phase 4's job (idle reset) and Phase 5's job (session expiry). Phase 2 just keeps re-injecting on navigation so the hide rules don't flash.

### Drift Response Policy (EMBED-05 behavior)
- **D-05:** Boot-time selector self-check runs after `insertCSS` and after the first `executeJavaScript` pass. It iterates both the stable `[data-role=...]` list AND the `fragile-selectors.js` entries, calling `document.querySelectorAll(sel).length` for each. Any zero-match selector produces a structured log line with severity `warn`, the selector string, the selector category (`stable` / `fragile`), and a `drift: true` tag.
- **D-06:** On ANY zero-match finding, Phase 2 sends a new IPC `magicline-drift-detected` to the main process with the list of missed selectors. The main process logs it to `main.log` AND tells the host renderer to show a branded error overlay (`host.html` already structured for sibling layers per Phase 1 D-01). The error overlay says something like "Kasse vorübergehend nicht verfügbar — Bitte wenden Sie sich an das Studio-Personal" (exact copy at Claude's Discretion, German, match BSF brand tone). The `cash-register-ready` IPC is NOT fired even if the cash-register element is present — the error overlay takes precedence over the splash lift because members must not see leaked Magicline UI. Admin exit (Phase 5) is the only recovery path.
- **D-07:** The error-overlay IPC channel is `show-magicline-error` / `hide-magicline-error`. Phase 2 defines the channel and wires the main-process handler. Phase 1's `host.html` gets a new sibling `<div id="magicline-error">` as a higher z-index layer (below admin-exit-modal which is Phase 5, above splash). This is a Phase 1 → Phase 2 addition to `host.html` and `host.css`.

### Viewport Fit
- **D-08:** Magicline renders at its native responsive breakpoints inside the child view. The main process calls `childView.webContents.setZoomFactor(N)` where `N` is a device-specific constant derived from the actual kiosk screen pixel size ÷ Magicline's desktop minimum-useful width. This is the cleanest Electron-native approach: zero DOM manipulation, honors Magicline's own CSS at the zoomed resolution, survives React re-renders without a fight, no `transform: scale` layout math breakage.
- **D-09:** The zoom factor value is a RESEARCH OUTPUT, not a locked constant. Research must measure the actual gym POS terminal's screen resolution (physical pixels + scale factor) and choose a zoom factor that makes the checkout flow usable — touch targets large enough for fingers, no critical text below ~16px, checkout button comfortably tappable. Default starting point for planning: derive from `screen.getPrimaryDisplay().workAreaSize` at runtime with a config override in `electron-store` so it's tunable without a rebuild. This follows the PROJECT.md pattern of using `electron-store` for non-secret tunables.

### Injection File Layout (EMBED-04 "one file to patch" contract)
- **D-10:** Four injection-related source files under `src/inject/`:
  - `src/inject/inject.css` — **stable** `[data-role=...]` hide rules. Passed to `webContents.insertCSS`. Rarely edited.
  - `src/inject/inject.js` — dynamic element hiding (Rabatt button by text, discount icon by SVG path), MUI React-native value setter helper, boot-time selector self-check, MutationObserver for dynamic elements, cash-register-ready detection + IPC send. Passed to `webContents.executeJavaScript`.
  - `src/inject/fragile-selectors.js` — isolated drift layer. Exports a single array of `{category, selector, fallback}` objects. `inject.js` imports this (via a simple concat at `executeJavaScript` time or inline bundling) and iterates the list during self-check and dynamic hiding. **When Magicline ships a class rename, the operator edits EXACTLY this file** and ships a patch release via GitHub Releases + electron-updater.
  - `src/main/magiclineView.js` — main-process module that creates the child view, attaches lockdown, wires `did-navigate*` listeners, calls `insertCSS` + `executeJavaScript`, handles `show-magicline-error` IPC. NEVER edited during drift response.
- **D-11:** `src/inject/` is the "drift-patch blast radius". `src/main/` is off-limits to drift patches. README (or a `src/inject/README.md`) must explicitly say: *"When Magicline breaks after an update, edit ONLY files in this directory. Never edit src/main/ in response to a Magicline drift incident."* This makes the contract enforceable by git-diff review on a drift-patch PR.

### Prototype Porting
- **D-12:** The inject.css and inject.js source for this phase is the prototype embedded in `BeeStrong_POS_Kiosk_Project.md` at approximately lines 346–460 (verified during discuss scout). Research/planning should port that source verbatim into `src/inject/inject.css` and `src/inject/inject.js`, then add: (a) the boot-time self-check from EMBED-05, (b) the drift-IPC from D-06, (c) the cash-register-ready detection + IPC from D-03, (d) the fragile-selectors.js extraction from D-10. No re-architecture — the prototype is load-bearing.

### Dev Mode DevTools
- **D-13:** In dev mode, open DevTools on BOTH the host webContents (Phase 1 already does this) AND the child view's webContents, each in detached mode, so the developer can inspect host overlays and Magicline DOM independently. Prod mode: no DevTools on either, matching Phase 1 D-08 exactly.

### Session, Isolation, Security
- **D-14:** The child view's session is partition-separated from the host: `session.fromPartition('persist:magicline')`. This isolates Magicline's cookies, localStorage, and cache from the host window's (trivial) storage and allows Phase 3 to clear exactly this partition on idle reset without touching the host. The partition name is STABLE across phases — Phases 3 and 4 will reuse `'persist:magicline'`.
- **D-15:** Child view `webPreferences`: `contextIsolation: true`, `sandbox: true`, `nodeIntegration: false`, NO preload. Magicline is untrusted third-party content and we never need to expose Node to it — all privileged operations go through the main process via IPC from the host preload, never from inside the child view. `executeJavaScript` runs in the page's isolated world and does not need a preload bridge.

### Claude's Discretion
- Exact cash-register-ready detection selector (must be cash-register-only, stable `[data-role=...]`, and present in the prototype's working selector list — likely `[data-role="product-search"] input` or the "Jetzt verkaufen" button).
- Exact German wording on the drift error overlay (match Bee Strong brand tone, consider "Kasse vorübergehend nicht verfügbar").
- Re-injection trigger mix: prototype uses MutationObserver heavily; `insertCSS` is engine-level so CSS survives re-renders by itself. Planner chooses the minimal combination of `did-navigate` / `did-navigate-in-page` / `did-frame-finish-load` + a small MutationObserver for JS-side dynamic hiding. Over-applying wastes CPU; the research step should confirm which trigger mix actually fires on Magicline's SPA navigation.
- How `src/inject/fragile-selectors.js` gets pulled into `executeJavaScript` — simple concat string, `fs.readFile` + prepend, or inline `require` via a CommonJS glue file. Any of the three works; pick the simplest.
- Whether to also call `attachLockdown(childView.webContents)` via a helper that takes the same `reservedShortcuts` Set so Phase 5's admin hotkey works on BOTH webContents. Prefer: yes, by default, because `before-input-event` only fires on focused webContents and focus can move.
- Initial `setZoomFactor` default value for the dev 420x800 window and the runtime derivation formula for the real kiosk. Research output.

</decisions>

<canonical_refs>
## Canonical References

**Downstream agents MUST read these before researching or planning.**

### Project Context
- `.planning/PROJECT.md` — full project vision, "wrap don't rebuild" thesis, prescriptive stack, what NOT to use
- `.planning/REQUIREMENTS.md` §Magicline Embed & Injection — EMBED-01 through EMBED-06 requirement text
- `.planning/ROADMAP.md` §Phase 2 — goal, success criteria, phase dependencies
- `CLAUDE.md` — project instructions, stack pins (Electron ~41.1.1, plain JS, no TS, no bundler)
- `BeeStrong_POS_Kiosk_Project.md` — **contains the prototype inject.css and inject.js source** at ~lines 346–460; selector table at ~lines 490–510; IPC / flow notes throughout

### Phase 1 Interface (must read — Phase 2 builds directly on these)
- `.planning/phases/01-locked-down-shell-os-hardening/01-CONTEXT.md` — D-01 (host.html as permanent overlay), D-02 (child view attachment point), D-03 (cash-register-ready IPC contract), D-10 (reservedShortcuts reuse)
- `src/main/main.js:20-66` — existing `createMainWindow`, `ipcMain.on('cash-register-ready')` stub at line 61 that Phase 2 will fire into
- `src/main/keyboardLockdown.js` — exported `attachLockdown(webContents)` and `reservedShortcuts` Set, both designed for Phase 2 reuse on the child view
- `src/host/host.html` — permanent overlay shell with splash layer; Phase 2 adds a `#magicline-error` sibling div
- `src/host/host.css` — z-index ladder; Phase 2 adds a layer between splash and admin-exit-modal
- `src/host/host.js` — IPC subscription layer; Phase 2 adds `show-magicline-error` / `hide-magicline-error` handlers
- `src/main/preload.js` — contextBridge `window.kiosk` surface; Phase 2 adds error overlay IPC callbacks

### Research
- `.planning/research/SUMMARY.md` §Phase 2 ("Child BrowserView; re-injection on every nav; stable vs fragile selector split")
- `.planning/research/ARCHITECTURE.md` — host window + BrowserView layering, InjectionService pattern
- `.planning/research/PITFALLS.md` — `insertCSS` flash-of-unhidden-UI, MUI `css-xxxxx` drift cadence, MutationObserver CPU loop, HID first-character-drop, Magicline server-side logout invisible state
- `.planning/research/STACK.md` — Electron 41 `BrowserView` vs `WebContentsView` note (class-name verification required at Phase 2 start)
- `.planning/research/FEATURES.md` — F2 Magicline embed + injection, F3 selector-health boot check

### External Docs (consult during research)
- Electron docs: `BrowserView`, `WebContentsView`, `webContents.insertCSS`, `webContents.executeJavaScript`, `session.fromPartition`, `webContents.setZoomFactor`, `did-navigate`, `did-navigate-in-page`
- MUI docs: React-native value setter pattern for controlled inputs (`Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set`)
- MDN: MutationObserver best practices (throttling, targeted subtree vs document.body)

</canonical_refs>

<code_context>
## Existing Code Insights

### Reusable Assets (from Phase 1)
- **`ipcMain.on('cash-register-ready', ...)`** — `src/main/main.js:61-66`. Phase 2 fires the IPC from the injected JS; handler is already wired and sends `splash:hide` to the host renderer.
- **`attachLockdown(webContents)`** — `src/main/keyboardLockdown.js:63-91`. Exported as a reusable function specifically so Phase 2 can attach the same `before-input-event` suppression to the child view's webContents. Dev-mode no-op gating is already inside the function.
- **`reservedShortcuts` Set** — `src/main/keyboardLockdown.js:24`. Currently empty, but lives in the same module and is consulted before suppression so Phase 5's admin hotkey will pass through both webContents once registered.
- **`host.html` layered structure** — `src/host/host.html`. Sibling-div z-index ladder was built specifically so Phase 2, 4, 5 can add new overlay layers without touching the splash. Phase 2 adds `#magicline-error`.
- **`host.css` z-index tokens** — brand palette + z-index ladder already defined. Phase 2 adds one more token between splash and admin-modal.
- **`window.kiosk` contextBridge surface** — `src/main/preload.js`. Already exposes `onHideSplash` / `onShowSplash`. Phase 2 adds `onShowMagiclineError` / `onHideMagiclineError`.
- **`logger.js`** — `src/main/logger.js` with electron-log 5, rotating file at `%AppData%/Bee Strong POS/logs/main.log`. Phase 2 logs drift detections, injection self-check results, and IPC events through this same logger.
- **`host.html` CSP meta** — strict CSP is already in place. If Phase 2 needs inline style/script for the magicline-error overlay, the CSP must be audited during planning to avoid breaking it.

### Established Patterns (from Phase 1)
- **CommonJS main process** — `require`/`module.exports`, no ESM. `src/inject/*` files are consumed as raw strings by `insertCSS`/`executeJavaScript` so they're not constrained to CJS vs ESM.
- **`if (!isDev)` gating** — production-only side effects are consistently gated behind `process.env.NODE_ENV === 'development'`. Phase 2 follows the same pattern for DevTools on the child view.
- **Structured log lines** — `log.info('<event>: <detail>')` with keyed fields for future grep. Phase 2 drift warnings follow: `log.warn('magicline.drift: selector=<sel> category=<stable|fragile>')`.
- **IPC channel naming** — kebab-case event names, verbs: `cash-register-ready`, `splash:hide`. Phase 2 uses `show-magicline-error`, `hide-magicline-error`, `magicline-drift-detected` matching this convention.
- **No preload on untrusted content** — Phase 2's child view has no preload; Magicline is untrusted.

### Integration Points
- **Phase 2 → Phase 1**: Adds `#magicline-error` sibling div to `host.html`, one z-index token to `host.css`, one IPC channel pair (`show-magicline-error` / `hide-magicline-error`) to preload + host.js. These are additive, not destructive.
- **Phase 2 → Phase 3**: Phase 3's auto-login state machine drives Magicline navigation while the splash is still up. Phase 2's `did-navigate` re-injection handles every intermediate page Phase 3 bounces through. Phase 2's cash-register-ready IPC is the signal Phase 3 indirectly drives by getting the user to the cash register.
- **Phase 2 → Phase 4**: Idle reset needs to clear only `persist:magicline` session partition, not the host partition. D-14 locks this partition name.
- **Phase 2 → Phase 5**: Session expiry detection reuses Phase 2's injection layer — Phase 5 will add an 'on-login-page' detection that mirrors the cash-register-ready logic and fires a different IPC for the admin flow.
- **Phase 2 → all future**: `src/inject/*` is the "drift patch" blast radius. Future Magicline updates change ONLY files in this directory.

</code_context>

<specifics>
## Specific Ideas

- **The prototype is load-bearing.** The inject.css and inject.js in `BeeStrong_POS_Kiosk_Project.md` (~lines 346–460) already work against the live Magicline UI. Do not redesign — port verbatim, then layer on self-check, drift IPC, cash-register-ready detection, and fragile-selector extraction. Any rewrite is scope creep.
- **"One file to patch" is the EMBED-04 contract.** `src/inject/fragile-selectors.js` is the only file a drift-incident PR should touch. Research/planning should structure the self-check and dynamic-hiding code so that adding a new fragile selector is a one-line edit in that array.
- **Splash stays up during auto-login.** The member's first visual after boot is splash → (invisible Phase 3 auto-login happening underneath) → cash register. Any flash of the login wall is a Phase 2 bug.
- **Drift = branded overlay, not member-facing leak.** If any selector misses, the error overlay hides Magicline entirely. This is the guardrail against members ever seeing a topbar / sidebar / global search box because Magicline shipped a rename.
- **Dev mode 420×800 is a simulation, not the kiosk.** The real kiosk screen resolution is unknown as of 2026-04-08 and must be measured at Phase 2 research start. `setZoomFactor` value is derived from the real number, not from 420×800.

</specifics>

<deferred>
## Deferred Ideas (NOT Phase 2 scope)

- **Magicline auto-login via safeStorage DPAPI credentials** — Phase 3.
- **NFC badge scan capture and injection into customer-search input** — Phase 4 (the prototype's NFC code in `BeeStrong_POS_Kiosk_Project.md` is Phase 4's porting target, NOT Phase 2's).
- **Idle reset + session partition clear** — Phase 4.
- **Session-expiry detection + silent re-login** — Phase 5.
- **Admin PIN exit hotkey + modal** — Phase 5 (adds `'Ctrl+Shift+F12'` to the Phase 1 `reservedShortcuts` Set).
- **Updating / auto-update cover** — Phase 5 / separate update-manager phase.
- **Telemetry on drift-incident frequency** — v2, OPS layer.
- **Admin panel showing current selector-match health** — v2, D9 from project brief.

</deferred>

---

*Phase: 02-magicline-embed-injection-layer*
*Context gathered: 2026-04-08*
