---
phase: 10-post-sale-flow-with-print-interception
plan: 04
type: execute
wave: 2
depends_on: [03]
files_modified:
  - src/main/magiclineView.js
autonomous: true
requirements: [SALE-01]
tags: [magicline-view, console-message, sentinel, ipc-relay, phase-10]
must_haves:
  truths:
    - "BSK_PRINT_INTERCEPTED on Magicline console emits ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' })"
    - "BSK_POST_SALE_FALLBACK on Magicline console emits ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' })"
    - "Existing BSK_AUDIT_SALE_COMPLETED + BSK_REGISTER_SELECTED* relays preserved byte-for-byte"
  artifacts:
    - path: "src/main/magiclineView.js"
      provides: "Two new console-message sentinel branches relaying to ipcMain.emit('post-sale:trigger', ...)"
      contains: "BSK_PRINT_INTERCEPTED"
  key_links:
    - from: "src/main/magiclineView.js console-message handler"
      to: "ipcMain.emit('post-sale:trigger', null, {trigger: ...})"
      via: "plain if(message && message.indexOf('BSK_...') !== -1) branch"
      pattern: "BSK_PRINT_INTERCEPTED|BSK_POST_SALE_FALLBACK"
---

<objective>
Extend the existing `console-message` handler in `src/main/magiclineView.js` to relay Plan 03's two new sentinels to `ipcMain.emit('post-sale:trigger', ...)`. Main.js (Plan 05) will register the matching listener.

Purpose: `inject.js` runs in Magicline's main world without IPC access, so all signals must route through the existing console → magiclineView → ipcMain pattern (proven on 4 existing sentinels).

RESEARCH OVERRIDE: The D-10 `webContents.on('-print', ...)` path is replaced by the `BSK_PRINT_INTERCEPTED` sentinel relay per RESEARCH §1. No `-print` event listener is installed — the relay branch below is the canonical primary-trigger path.

Output: Two new console-message branches alongside the existing `BSK_AUDIT_SALE_COMPLETED` and `BSK_REGISTER_SELECTED*` branches. No other changes to magiclineView.js.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-03-SUMMARY.md
@./CLAUDE.md

<interfaces>
Existing console-message handler in magiclineView.js (lines 293-339):
Multi-signature handling for (event, level, message, ...) vs (event) with event.message.
All sentinel branches use indexOf match + ipcMain.emit.
DEGRADED is checked first (else-if) because BSK_REGISTER_SELECTED is a substring of BSK_REGISTER_SELECTED_DEGRADED.

Existing template (magiclineView.js lines 307-331):
```
if (message && message.indexOf('BSK_AUDIT_SALE_COMPLETED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('audit-sale-completed');
  } catch (_) { /* swallow */ }
}

if (message && message.indexOf('BSK_REGISTER_SELECTED_DEGRADED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('register-selected', null, { degraded: true });
  } catch (_) { /* swallow */ }
} else if (message && message.indexOf('BSK_REGISTER_SELECTED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('register-selected', null, { degraded: false });
  } catch (_) { /* swallow */ }
}
```

Substring collision check for Phase 10 sentinels:
- BSK_PRINT_INTERCEPTED — unique prefix, no substring collision with existing sentinels
- BSK_POST_SALE_FALLBACK — unique prefix, no substring collision
- Neither is a substring of the other → plain `if` (not `else if`) is safe for both

Canonical IPC channel for Phase 10: `post-sale:trigger` (INTERNAL, main-process-only). Main.js (Plan 05) listens here and fans out to `post-sale:show` (to host) via a dedicated handler.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add BSK_PRINT_INTERCEPTED + BSK_POST_SALE_FALLBACK sentinel branches</name>
  <read_first>
    - src/main/magiclineView.js (current console-message handler at lines 293-339 — exact branch structure, require pattern, error swallow convention)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §magiclineView.js (exact new branch code blocks)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-10/D-11 (sentinel names and trigger payloads)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §1 (override rationale — no -print event listener installed)
  </read_first>
  <files>src/main/magiclineView.js</files>
  <action>
Insert TWO new console-message branches in `src/main/magiclineView.js`, inside the existing `magiclineView.webContents.on('console-message', (...args) => { ... });` handler.

**Insertion point:** AFTER the existing `BSK_REGISTER_SELECTED` else-if block (currently ends with its closing `}`) and BEFORE the `if (message && message.indexOf(PHASE07_SENTINEL_PREFIX) !== -1) {` block.

**Exact code to insert (copy verbatim — note the leading blank line for readability):**

```
      // Phase 10 D-10 (revised per RESEARCH §1): window.print override primary
      // trigger. inject.js overrides window.print to emit this sentinel instead
      // of opening Chrome's print preview. The -print webContents event does
      // NOT exist in Electron 41's public API (electron/electron#22796 wontfix);
      // the JS-level override is the approved replacement.
      if (message && message.indexOf('BSK_PRINT_INTERCEPTED') !== -1) {
        try {
          const { ipcMain } = require('electron');
          ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
        } catch (_) { /* swallow */ }
      }

      // Phase 10 D-11: cart-empty-after-payment MutationObserver fallback.
      // Fires when inject.js observer detects cart non-zero->zero within 120s
      // of a 'Jetzt verkaufen' click (debounced 500ms inside inject.js).
      // Defense-in-depth if Magicline's print call bypasses window.print.
      if (message && message.indexOf('BSK_POST_SALE_FALLBACK') !== -1) {
        try {
          const { ipcMain } = require('electron');
          ipcMain.emit('post-sale:trigger', null, { trigger: 'cart-empty-fallback' });
        } catch (_) { /* swallow */ }
      }
```

**Critical:**
- Both branches use plain `if` (not `else if`) — verified in PATTERNS §magiclineView.js: neither sentinel is a substring of the other, so no ordering guard is needed.
- The `trigger` payload string values are `'print-intercept'` and `'cart-empty-fallback'` — these exact strings will be read by main.js (Plan 05) to route into `startPostSaleFlow({trigger})` and into the `log.audit('post-sale.shown', {trigger: ...})` call.
- The channel name is `post-sale:trigger` (INTERNAL main-process relay channel) — NOT `post-sale:show` (which is main→renderer). Plan 05's main.js listener on `post-sale:trigger` is responsible for gating via `postSaleShown` and then calling `startPostSaleFlow` which sends `post-sale:show` to the host.
- Use the SAME `try { const { ipcMain } = require('electron'); ipcMain.emit(...); } catch (_) { /* swallow */ }` pattern as the existing branches. Do NOT hoist ipcMain to module scope — the existing pattern requires it inside each branch.
- Do NOT install any `webContents.on('-print', ...)` or `webContents.on('before-print', ...)` listener — these events do not exist in Electron 41 (RESEARCH §1) and attempting to register them is either a no-op or a pollution of a different internal event.
- Do NOT modify the existing `console-message` handler signature, multi-signature defensive parsing, the `[BSK]` log forwarding, or the PHASE07_SENTINEL_PREFIX parser.
- Do NOT modify `render-process-gone` listener.
  </action>
  <verify>
    <automated>grep -q "BSK_PRINT_INTERCEPTED" src/main/magiclineView.js &amp;&amp; grep -q "BSK_POST_SALE_FALLBACK" src/main/magiclineView.js &amp;&amp; grep -q "post-sale:trigger" src/main/magiclineView.js &amp;&amp; grep -q "print-intercept" src/main/magiclineView.js &amp;&amp; grep -q "cart-empty-fallback" src/main/magiclineView.js &amp;&amp; node --check src/main/magiclineView.js</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `BSK_PRINT_INTERCEPTED`
    - File contains exact substring `BSK_POST_SALE_FALLBACK`
    - File contains exact substring `post-sale:trigger`
    - File contains exact substring `trigger: 'print-intercept'`
    - File contains exact substring `trigger: 'cart-empty-fallback'`
    - `grep -c "post-sale:trigger" src/main/magiclineView.js` returns exactly 2 (one per new branch)
    - File does NOT contain any `webContents.on('-print'` listener registration: `grep -c "'-print'" src/main/magiclineView.js` returns 0
    - File does NOT contain any `webContents.on('before-print'` listener registration: `grep -c "'before-print'" src/main/magiclineView.js` returns 0
    - `node --check src/main/magiclineView.js` exits 0
    - Existing `BSK_AUDIT_SALE_COMPLETED` branch is still present and unchanged
    - Existing `BSK_REGISTER_SELECTED_DEGRADED` else-if ordering is preserved
    - Existing `render-process-gone` handler is still present and unchanged
    - Both new branches use plain `if` (not `else if`)
  </acceptance_criteria>
  <done>
    Two new console-message branches installed. Each emits ipcMain.emit('post-sale:trigger', ...) with the correct trigger string payload. No -print event listener added. All existing branches preserved. File syntactically valid.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| Magicline webContents console → magiclineView.js listener | Any JS running in Magicline's main world can emit arbitrary console.log strings, including spoofed BSK_* sentinels. |
| magiclineView.js → ipcMain.emit | Internal main-process event bus; all listeners trust the emitter because only main-process code can attach. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-04-01 | Spoofing | Magicline-side JS or a malicious injected script emits BSK_PRINT_INTERCEPTED to force overlay | accept | Magicline is first-party SaaS we trust by contract. CSP in host.html + lockdown on main window prevents arbitrary script injection. The `postSaleShown` dedupe flag in main.js (Plan 05) limits spoof impact to one spurious overlay per sale cycle. |
| T-10-04-02 | Tampering | The ipcMain.emit payload carries an attacker-controlled `trigger` string | mitigate | Main.js (Plan 05) uses the trigger value ONLY in log.audit (not in any control-flow branch besides dedupe). Audit log is append-only; a spoofed trigger string produces a noise log line, not a security event. |
| T-10-04-03 | DoS | Flooding Magicline console with BSK_PRINT_INTERCEPTED causes 1000× post-sale:trigger emits | mitigate | The postSaleShown dedupe flag in main.js short-circuits subsequent triggers within the same sale. Rate-limit is implicit: the flag clears only on `post-sale:next-customer` or `onPreReset`. |
| T-10-04-04 | Unintended listener pollution | Adding a `webContents.on('-print', ...)` listener touches an undocumented internal Electron event | accept | This plan explicitly does NOT add any -print listener. Acceptance criteria verify absence. |

**Threat level:** LOW. Largest residual risk is spoofing, accepted because Magicline is first-party and impact is bounded by the downstream dedupe flag.
</threat_model>

<verification>
- `grep -c "BSK_PRINT_INTERCEPTED" src/main/magiclineView.js` returns >= 1
- `grep -c "BSK_POST_SALE_FALLBACK" src/main/magiclineView.js` returns >= 1
- `grep -c "'-print'" src/main/magiclineView.js` returns 0
- `grep -c "'before-print'" src/main/magiclineView.js` returns 0
- `node --check src/main/magiclineView.js` exits 0
- No changes to any other file
</verification>

<success_criteria>
- Two new branches in console-message handler relay the BSK_PRINT_INTERCEPTED and BSK_POST_SALE_FALLBACK sentinels to ipcMain.emit('post-sale:trigger', ...)
- Trigger payload carries `trigger: 'print-intercept'` or `trigger: 'cart-empty-fallback'` accordingly
- No `-print` or `before-print` event listener registered
- Existing sentinel branches and render-process-gone handler unchanged
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-04-SUMMARY.md` documenting:
- The exact block of two new branches inserted
- Confirmation no `-print` / `before-print` listener was added
- Line count delta (~15 new lines including comments)
- Confirmation the existing BSK_REGISTER_SELECTED_DEGRADED else-if ordering guard is preserved
</output>
