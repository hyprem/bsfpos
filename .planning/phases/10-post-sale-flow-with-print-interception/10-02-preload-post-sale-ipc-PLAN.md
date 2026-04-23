---
phase: 10-post-sale-flow-with-print-interception
plan: 02
type: execute
wave: 1
depends_on: []
files_modified:
  - src/main/preload.js
autonomous: true
requirements: [SALE-01]
tags: [preload, ipc, context-bridge, phase-10]
must_haves:
  truths:
    - "window.kiosk.onShowPostSale(cb) subscribes to the 'post-sale:show' IPC"
    - "window.kiosk.onHidePostSale(cb) subscribes to the 'post-sale:hide' IPC"
    - "window.kiosk.notifyPostSaleNextCustomer() sends on 'post-sale:next-customer'"
    - "window.kiosk.notifyPostSaleAutoLogout() sends on 'post-sale:auto-logout'"
  artifacts:
    - path: "src/main/preload.js"
      provides: "Four new post-sale IPC surface methods on the kiosk context-bridge object"
      contains: "onShowPostSale"
  key_links:
    - from: "src/main/preload.js"
      to: "ipcRenderer"
      via: "contextBridge.exposeInMainWorld('kiosk', {...})"
      pattern: "ipcRenderer\\.on\\('post-sale:"
---

<objective>
Expose the four new post-sale IPC channels (D-19) on the `window.kiosk` context-bridge object. This is a tiny, zero-dependency plan that unblocks host.js (which subscribes to `onShowPostSale`/`onHidePostSale`) and main.js (which sends on `post-sale:show`/`post-sale:hide` and receives `post-sale:next-customer`/`post-sale:auto-logout`).

Purpose: Without the preload surface, host.js cannot wire listeners and main.js handlers cannot receive fire-and-forget messages from the renderer.

Output: Four new methods appended to the existing `kiosk` object — follows the EXACT Phase 4 idle-overlay template (PATTERNS §preload.js).
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@./CLAUDE.md

<interfaces>
<!-- The established IPC naming convention: main→renderer uses `on*` with
     ipcRenderer.on; renderer→main uses `notify*` with ipcRenderer.send (NOT invoke).
     This matches Phase 4 idle-overlay (lines 40-47) and Phase 6 welcome (line 77). -->

Existing pattern (Phase 4 idle overlay — verbatim template):
```javascript
// Phase 4 D-12 — idle overlay (main → renderer)
onShowIdleOverlay: (cb) => { ipcRenderer.on('show-idle-overlay', (_e) => cb()); },
onHideIdleOverlay: (cb) => { ipcRenderer.on('hide-idle-overlay', (_e) => cb()); },
// Phase 4 D-12 — idle overlay (renderer → main, fire-and-forget)
notifyIdleDismissed: () => { ipcRenderer.send('idle-dismissed'); },
notifyIdleExpired:   () => { ipcRenderer.send('idle-expired');   },
```

Existing Phase 6 welcome pattern (colon-separated channel name — same convention Phase 10 uses):
```javascript
onShowWelcome:   (cb) => ipcRenderer.on('welcome:show', () => cb()),
notifyWelcomeTap: () => { ipcRenderer.send('welcome:tap'); },
```

IPC channel names for Phase 10 (D-19, canonical):
- main → renderer: `post-sale:show`, `post-sale:hide`
- renderer → main: `post-sale:next-customer`, `post-sale:auto-logout`
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Append post-sale IPC surface to the kiosk context-bridge object</name>
  <read_first>
    - src/main/preload.js (full current file — insertion point is BEFORE the closing `});` of the `exposeInMainWorld` call)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-19 (canonical IPC channel names and preload method names)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §preload.js (exact code block to insert)
  </read_first>
  <files>src/main/preload.js</files>
  <action>
Append FOUR new entries to the `kiosk` object in `src/main/preload.js`. Insert immediately AFTER the existing `// --- Phase 09 — POS open/close state -----------------------------------` block and BEFORE the closing `});` of `contextBridge.exposeInMainWorld('kiosk', { ... })`.

**Exact code to insert (copy verbatim):**
```javascript

  // --- Phase 10 — Post-sale overlay (D-19) ---------------------------------
  // Main → renderer: show / hide the branded "Vielen Dank" overlay.
  onShowPostSale: (cb) => ipcRenderer.on('post-sale:show', (_e) => cb()),
  onHidePostSale: (cb) => ipcRenderer.on('post-sale:hide', (_e) => cb()),
  // Renderer → main (fire-and-forget): button tap vs countdown-expiry
  // outcomes. D-20: auto-logout triggers sessionReset.hardReset with
  // reason:'sale-completed', mode:'welcome'. next-customer keeps the
  // Magicline session alive and rearms the 60s idle timer (D-06).
  notifyPostSaleNextCustomer: () => { ipcRenderer.send('post-sale:next-customer'); },
  notifyPostSaleAutoLogout:   () => { ipcRenderer.send('post-sale:auto-logout');   },
```

**Critical:**
- Do NOT add a trailing comma after `notifyPostSaleAutoLogout: () => {...}` if it becomes the last entry. Inspect the last line before `});` — if the Phase 09 entry has a trailing comma, the new block should follow with a leading empty line and its own commas; the last of the four new entries must NOT have a trailing comma ONLY IF it is literally the last property before `});`. Follow existing style of the file (most existing entries DO end with trailing commas; keep consistency).
- Actually — looking at existing style, entries use trailing commas. Keep trailing commas on all four (safe — ES2017+, already used throughout file).
- Use `ipcRenderer.on` (NOT `invoke`) for the main→renderer subscribers — fire-and-forget pattern matches Phase 4 / Phase 6.
- Use `ipcRenderer.send` (NOT `invoke`) for the renderer→main notifications — no return value needed, matches Phase 4 / Phase 6.
- Channel names are EXACTLY `post-sale:show`, `post-sale:hide`, `post-sale:next-customer`, `post-sale:auto-logout` — colon-separated, not hyphenated. This is canonical per D-19 and matches welcome:show / welcome:tap convention.
- Do NOT modify any other existing entry in the file.
  </action>
  <verify>
    <automated>grep -q "onShowPostSale" src/main/preload.js &amp;&amp; grep -q "onHidePostSale" src/main/preload.js &amp;&amp; grep -q "notifyPostSaleNextCustomer" src/main/preload.js &amp;&amp; grep -q "notifyPostSaleAutoLogout" src/main/preload.js &amp;&amp; grep -q "post-sale:show" src/main/preload.js &amp;&amp; grep -q "post-sale:hide" src/main/preload.js &amp;&amp; grep -q "post-sale:next-customer" src/main/preload.js &amp;&amp; grep -q "post-sale:auto-logout" src/main/preload.js &amp;&amp; node -e "require('./src/main/preload.js')" 2>&amp;1 | grep -v "contextBridge" || true</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `onShowPostSale: (cb) => ipcRenderer.on('post-sale:show'`
    - File contains exact substring `onHidePostSale: (cb) => ipcRenderer.on('post-sale:hide'`
    - File contains exact substring `notifyPostSaleNextCustomer: () => { ipcRenderer.send('post-sale:next-customer'`
    - File contains exact substring `notifyPostSaleAutoLogout:   () => { ipcRenderer.send('post-sale:auto-logout'`
    - File contains the comment `Phase 10 — Post-sale overlay (D-19)` or similar phase marker
    - `grep -c "post-sale:" src/main/preload.js` returns exactly 4
    - `grep -c "PostSale" src/main/preload.js` returns exactly 4
    - No use of `ipcRenderer.invoke` for any of the four new channels
    - File remains syntactically valid: the closing `});` of `exposeInMainWorld` is still present and followed by no extra content
    - No other existing method (e.g. `onShowIdleOverlay`, `notifyWelcomeTap`) is modified
  </acceptance_criteria>
  <done>
    Four new post-sale methods on `window.kiosk`. All four use the colon-separated channel names. File structurally valid. No other entries touched.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → main (ipcRenderer.send) | Renderer can fire `post-sale:next-customer` or `post-sale:auto-logout` at any time. Main process must NOT blindly trust: both handlers should validate state (e.g. `postSaleShown === true` before honoring dismissal) — that validation is Plan 05's responsibility, NOT this plan's. |
| main → renderer (ipcRenderer.on) | Main sends `post-sale:show`/`post-sale:hide`. No untrusted data crosses. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-02-01 | Spoofing | Any renderer-origin code could call `window.kiosk.notifyPostSaleAutoLogout()` at any time | accept | Preload only exposes the method; state validation lives in main.js (Plan 05). The `postSaleShown` dedupe flag in main.js rejects dismiss IPCs when the overlay is not active. Kiosk has no third-party renderer code; CSP in host.html blocks inline scripts. |
| T-10-02-02 | Tampering | Method name collision with existing entries | accept | Verified no existing entry uses `onShow*PostSale*` / `notify*PostSale*` naming. New entries are additive. |
| T-10-02-03 | Information disclosure | Preload leaks internal state via IPC | accept | All four methods pass empty payloads (or no args). No credentials, no PII, no sale data crosses this surface — the overlay is purely visual; the sale data was already handled by Magicline before the print intercept. |

**Threat level:** LOW. No HIGH-level threats — this plan is a pure capability exposure.
</threat_model>

<verification>
- `grep -c "post-sale:" src/main/preload.js` returns 4
- `grep -c "PostSale" src/main/preload.js` returns 4
- File syntactically valid (parsed by node without SyntaxError)
- No other files modified
</verification>

<success_criteria>
- Four new entries added to `kiosk` context-bridge object
- Channel names are canonical per D-19
- Pattern matches Phase 4 idle-overlay (main→renderer: `ipcRenderer.on`; renderer→main: `ipcRenderer.send`)
- No use of `ipcRenderer.invoke` for these channels (fire-and-forget, no return values)
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-02-SUMMARY.md` documenting:
- The exact block of four new entries inserted
- Line count delta (should be ~10 new lines including comment)
- Confirmation channel names match D-19 canonical naming
- Confirmation the closing `});` is still syntactically intact
</output>
