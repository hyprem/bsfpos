---
phase: 10-post-sale-flow-with-print-interception
plan: 05
type: execute
wave: 2
depends_on: [01, 02]
files_modified:
  - src/main/main.js
autonomous: true
requirements: [SALE-01]
tags: [main, ipc-handlers, idle-timer, dedupe-flag, audit, phase-10]
must_haves:
  truths:
    - "post-sale:trigger with postSaleShown=false calls idleTimer.stop(), sends post-sale:show to host, audits post-sale.shown"
    - "post-sale:trigger with postSaleShown=true is a no-op (dedupe per D-12)"
    - "post-sale:next-customer resets postSaleShown=false, calls idleTimer.start(), audits post-sale.dismissed via=next-customer"
    - "post-sale:auto-logout calls sessionReset.hardReset({reason:'sale-completed', mode:'welcome'}), audits post-sale.dismissed via=auto-logout"
    - "onPreReset clears postSaleShown alongside existing welcomeTapPending clear"
  artifacts:
    - path: "src/main/main.js"
      provides: "postSaleShown module-scoped flag, startPostSaleFlow helper, three new ipcMain.on handlers"
      contains: "startPostSaleFlow"
  key_links:
    - from: "src/main/main.js ipcMain.on('post-sale:trigger')"
      to: "startPostSaleFlow({trigger})"
      via: "dedupe-gated helper call"
      pattern: "startPostSaleFlow"
    - from: "src/main/main.js ipcMain.on('post-sale:auto-logout')"
      to: "sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})"
      via: "require('./sessionReset').hardReset"
      pattern: "reason: 'sale-completed'"
---

<objective>
Wire the post-sale orchestration surface in `src/main/main.js`:

1. Add module-scoped `postSaleShown` dedupe flag (D-12) alongside existing `welcomeTapPending`
2. Add `startPostSaleFlow({trigger})` helper that encapsulates idle-timer stop + IPC send + dedupe flag set + audit event
3. Register three new IPC handlers: `post-sale:trigger`, `post-sale:next-customer`, `post-sale:auto-logout`
4. Extend the existing `onPreReset` callback to clear `postSaleShown` alongside `welcomeTapPending`

Purpose: This is the orchestration hub that (a) receives Plan 04's magiclineView console-message relays, (b) drives the host overlay via `post-sale:show` (handled by Plan 07), (c) routes dismiss outcomes to `idleTimer.start()` or `sessionReset.hardReset()`. SALE-01 end-to-end flow pivots on these handlers.

RESEARCH REFERENCE: The audit event signatures `log.audit('post-sale.shown', {trigger})` and `log.audit('post-sale.dismissed', {via})` are canonical per RESEARCH §5. The `trigger` value comes verbatim from Plan 04's magiclineView payload.

Output: 3 new IPC handlers + 1 new helper function + 1 new module-scoped flag + 1-line extension to the existing onPreReset callback. No existing handler is modified beyond that single line.
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
@.planning/phases/10-post-sale-flow-with-print-interception/10-01-SUMMARY.md
@.planning/phases/10-post-sale-flow-with-print-interception/10-02-SUMMARY.md
@./CLAUDE.md

<interfaces>
Module-scoped flag precedent (main.js line 42):
```
// Phase 07 SPLASH-01: true between welcome:tap and splash:hide-final ...
let welcomeTapPending = false;
```

onPreReset callback precedent (main.js lines 464-473) — where postSaleShown clear is appended:
```
sessionResetMod.onPreReset(() => {
  // Phase 07 SPLASH-01: clear welcomeTapPending on any hard reset ...
  welcomeTapPending = false;
  if (healthWatchdogTimer || authPollTimer) { ... }
});
```

IPC handler registration precedent (main.js lines 378-408 — audit-sale-completed + register-selected):
```
try { ipcMain.removeAllListeners('audit-sale-completed'); } catch (_) {}
ipcMain.on('audit-sale-completed', () => {
  try { log.audit('sale.completed', {}); } catch (_) {}
});
```

Audit signature (src/main/logger.js lines 103-112):
```
log.audit = function audit(event, fields) {
  const parts = ['event=' + event];
  if (fields && typeof fields === 'object') {
    for (const k of Object.keys(fields)) parts.push(k + '=' + redactValue(k, fields[k]));
  }
  parts.push('at=' + new Date().toISOString());
  log.info(parts.join(' '));
};
```

Phase 10 canonical event names and field values (RESEARCH §5):
- log.audit('post-sale.shown', { trigger: 'print-intercept' | 'cart-empty-fallback' })
- log.audit('post-sale.dismissed', { via: 'next-customer' | 'auto-logout' })
`trigger` and `via` fields are NOT in the redaction allowlist — they pass through as plain strings.

idleTimer API (src/main/idleTimer.js — verified):
- `idleTimer.stop()` — clears current 60s window (idempotent)
- `idleTimer.start()` — arms fresh 60s window
- Lazy-required inside handlers to avoid circular deps

sessionReset.hardReset API (src/main/sessionReset.js):
- `hardReset({reason, mode})` returns Promise<void>
- `reason:'sale-completed'` is now excluded from loop counter (Plan 01)
- `mode:'welcome'` performs full-wipe + welcome:show (Phase 06 D-07)
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Add postSaleShown flag, startPostSaleFlow helper, and extend onPreReset</name>
  <read_first>
    - src/main/main.js (current — verify line numbers: welcomeTapPending at 42, onPreReset at 464-473, IPC handlers block around 378-408, module-scoped let declarations around lines 37-58)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-PATTERNS.md §main.js (exact analog code blocks for flag, helper, handlers, onPreReset extension)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-CONTEXT.md §D-05/D-06/D-07/D-12/D-20 (canonical semantics)
    - .planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md §5 (canonical audit signatures)
    - src/main/sessionReset.js lines 104-106 (confirm Plan 01's filter extension has landed — this plan depends on it)
    - src/main/preload.js (confirm Plan 02's four post-sale methods exist — this plan depends on them)
  </read_first>
  <files>src/main/main.js</files>
  <action>
Make THREE additive changes in `src/main/main.js`.

**Change A — add postSaleShown module-scoped flag IMMEDIATELY AFTER the existing `welcomeTapPending` declaration (line 42):**

Find this exact block near line 42:
```
// Phase 07 SPLASH-01: true between welcome:tap and splash:hide-final ...
let welcomeTapPending = false;
```

Insert immediately AFTER:
```
// Phase 10 D-12: dedupe flag that gates both post-sale triggers (print-intercept
// primary + cart-empty-fallback). Set true when startPostSaleFlow runs; cleared
// on post-sale:next-customer and on every hard reset (onPreReset callback).
// Prevents double-show when both triggers fire within the same sale cycle.
let postSaleShown = false;
```

**Change B — extend the existing onPreReset callback at lines 464-473 to clear postSaleShown:**

Find this exact block (near line 464-473):
```
sessionResetMod.onPreReset(() => {
  // Phase 07 SPLASH-01: clear welcomeTapPending on any hard reset so a
  // stale flag from a mid-flow reset does not gate the next welcome path.
  welcomeTapPending = false;
  if (healthWatchdogTimer || authPollTimer) {
    log.info('phase5.healthWatchdog.cleared-before-reset');
    if (healthWatchdogTimer) { clearTimeout(healthWatchdogTimer); healthWatchdogTimer = null; }
    if (authPollTimer) { clearInterval(authPollTimer); authPollTimer = null; }
  }
});
```

Immediately AFTER the `welcomeTapPending = false;` line, insert:
```
  // Phase 10 D-12: same rationale as welcomeTapPending — clear stale dedupe
  // flag on any hard reset so the next sale cycle can re-trigger the overlay.
  postSaleShown = false;
```

Do NOT touch the `healthWatchdogTimer`/`authPollTimer` block or the other onPreReset callback below it.

**Change C — add startPostSaleFlow helper + three IPC handlers.**

Insertion point: immediately AFTER the existing `ipcMain.on('register-selected', ...)` block (ends around line 408 with `});`) and BEFORE the existing `// --- Phase 2: Magicline child view + injection pipeline` comment (around line 410).

**Exact code to insert (copy verbatim):**
```

  // --- Phase 10 SALE-01: post-sale flow orchestration ----------------------
  // The complete post-sale flow:
  //   1. Magicline calls window.print (or cart-empties after payment)
  //   2. inject.js emits BSK_PRINT_INTERCEPTED (or BSK_POST_SALE_FALLBACK)
  //   3. magiclineView.js console-message listener relays via
  //      ipcMain.emit('post-sale:trigger', null, {trigger})
  //   4. THIS handler gates via postSaleShown dedupe, calls startPostSaleFlow
  //   5. startPostSaleFlow stops idle timer, sends post-sale:show to host,
  //      emits post-sale.shown audit
  //   6. Host shows overlay with 10s countdown (host.js Plan 07)
  //   7. On button tap (next-customer): clears flag, restarts idle timer
  //   8. On auto-expiry (auto-logout): hardReset({reason:'sale-completed',
  //      mode:'welcome'}) which internally triggers onPostReset for updateGate
  //
  // The helper encapsulates steps 4-5 to keep the trigger handler trivial
  // and to ensure BOTH primary and fallback trigger paths share the exact
  // same idle-timer stop + audit + IPC-send sequence.

  // Phase 10 D-05/D-12: helper encapsulates idle-timer stop + IPC send +
  // flag set + audit. Called from the post-sale:trigger handler after the
  // dedupe gate passes.
  function startPostSaleFlow(opts) {
    var trigger = (opts && opts.trigger) || 'unknown';
    postSaleShown = true;
    try { require('./idleTimer').stop(); } catch (_) { /* idleTimer lazy-required — safe to swallow */ }
    try {
      if (mainWindow && mainWindow.webContents && !mainWindow.webContents.isDestroyed()) {
        mainWindow.webContents.send('post-sale:show');
      }
    } catch (e) {
      log.error('phase10.startPostSaleFlow.send failed: ' + (e && e.message));
    }
    try { log.audit('post-sale.shown', { trigger: trigger }); } catch (_) { /* swallow */ }
  }

  // Phase 10 D-12: post-sale:trigger relay from magiclineView.js console-message.
  // Payload: { trigger: 'print-intercept' | 'cart-empty-fallback' }.
  // Dedupe: if postSaleShown is already true (another trigger already fired),
  // silently no-op and log at info level (not warn — dual-fire is expected
  // when both print and cart-empty happen in the same sale).
  try { ipcMain.removeAllListeners('post-sale:trigger'); } catch (_) {}
  ipcMain.on('post-sale:trigger', function (_ev, payload) {
    try {
      if (postSaleShown) {
        log.info('phase10.post-sale:trigger.ignored reason=already-shown');
        return;
      }
      var trigger = (payload && payload.trigger) || 'unknown';
      startPostSaleFlow({ trigger: trigger });
    } catch (err) {
      log.error('phase10.post-sale:trigger failed: ' + (err && err.message));
    }
  });

  // Phase 10 D-06: next-customer button — keep Magicline session alive, rearm
  // the 60s idle timer. The Magicline view stays visible; the cart stays as-is
  // (member may want to buy a second item). No sessionReset here — that is
  // the auto-logout path only.
  try { ipcMain.removeAllListeners('post-sale:next-customer'); } catch (_) {}
  ipcMain.on('post-sale:next-customer', function () {
    try {
      postSaleShown = false;
      try { require('./idleTimer').start(); } catch (_) {}
      try { log.audit('post-sale.dismissed', { via: 'next-customer' }); } catch (_) {}
    } catch (err) {
      log.error('phase10.post-sale:next-customer failed: ' + (err && err.message));
    }
  });

  // Phase 10 D-20: countdown auto-expiry — hard reset to welcome. The reason
  // 'sale-completed' is excluded from the 3-in-60s loop counter (Plan 01)
  // and still fires onPostReset for updateGate install composition (D-18).
  // postSaleShown is implicitly cleared by onPreReset in the hardReset path.
  try { ipcMain.removeAllListeners('post-sale:auto-logout'); } catch (_) {}
  ipcMain.on('post-sale:auto-logout', function () {
    try {
      try { log.audit('post-sale.dismissed', { via: 'auto-logout' }); } catch (_) {}
      require('./sessionReset').hardReset({ reason: 'sale-completed', mode: 'welcome' });
    } catch (err) {
      log.error('phase10.post-sale:auto-logout failed: ' + (err && err.message));
    }
  });
```

**Critical:**
- The three IPC handler registrations use `ipcMain.removeAllListeners(...)` first — this matches the existing Phase 07 `register-selected` + Phase 5 `audit-sale-completed` patterns, safeguarding against double-registration if the whenReady block re-enters (e.g. during hot reload in dev mode).
- `startPostSaleFlow` uses `var` (not `const/let`) ONLY for the local `trigger` variable to match existing function-declaration style in main.js handlers. The outer `function startPostSaleFlow(opts)` is a function declaration — allowed at any scope, hoisted.
- The `require('./idleTimer')` and `require('./sessionReset')` calls are LAZY (inside the handler body) — matches the pattern already established in sessionReset.js and prevents circular-dep load-time crashes.
- Audit events emit EXACTLY the strings `post-sale.shown` and `post-sale.dismissed` (lowercase, hyphen-separated, dot for verb) — this matches the canonical Phase 5 D-27 taxonomy (sale.completed, admin.action, idle.reset, etc.) documented in RESEARCH §5.
- `trigger` values are EXACTLY `'print-intercept'` or `'cart-empty-fallback'` — must match the strings emitted by Plan 04's magiclineView branches.
- `via` values are EXACTLY `'next-customer'` or `'auto-logout'` — no other variants.
- Do NOT modify the existing `audit-sale-completed` handler at lines 378-383 — that fires on sale START (Jetzt verkaufen click) and is orthogonal to Phase 10's post-sale overlay which fires AFTER payment confirmation.
- Do NOT modify the existing `register-selected` handler.
- Do NOT touch any other IPC handler.
  </action>
  <verify>
    <automated>grep -q "let postSaleShown = false" src/main/main.js &amp;&amp; grep -q "function startPostSaleFlow" src/main/main.js &amp;&amp; grep -q "ipcMain.on('post-sale:trigger'" src/main/main.js &amp;&amp; grep -q "ipcMain.on('post-sale:next-customer'" src/main/main.js &amp;&amp; grep -q "ipcMain.on('post-sale:auto-logout'" src/main/main.js &amp;&amp; grep -q "reason: 'sale-completed', mode: 'welcome'" src/main/main.js &amp;&amp; grep -q "log.audit('post-sale.shown'" src/main/main.js &amp;&amp; grep -q "log.audit('post-sale.dismissed'" src/main/main.js &amp;&amp; node --check src/main/main.js</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `let postSaleShown = false`
    - File contains exact substring `function startPostSaleFlow(opts)`
    - File contains exact substring `ipcMain.on('post-sale:trigger'`
    - File contains exact substring `ipcMain.on('post-sale:next-customer'`
    - File contains exact substring `ipcMain.on('post-sale:auto-logout'`
    - File contains exact substring `require('./idleTimer').stop()`
    - File contains exact substring `require('./idleTimer').start()`
    - File contains exact substring `require('./sessionReset').hardReset({ reason: 'sale-completed', mode: 'welcome' })`
    - File contains exact substring `log.audit('post-sale.shown', { trigger: trigger })`
    - File contains exact substring `log.audit('post-sale.dismissed', { via: 'next-customer' })`
    - File contains exact substring `log.audit('post-sale.dismissed', { via: 'auto-logout' })`
    - `grep -c "postSaleShown = false" src/main/main.js` returns >= 3 (declaration + onPreReset clear + next-customer clear)
    - `grep -c "postSaleShown = true" src/main/main.js` returns exactly 1 (inside startPostSaleFlow)
    - `grep -c "ipcMain.removeAllListeners('post-sale:" src/main/main.js` returns exactly 3
    - The three new `ipcMain.on` registrations each have a matching `ipcMain.removeAllListeners` preceding them
    - `node --check src/main/main.js` exits 0
    - Existing `audit-sale-completed` handler is unchanged
    - Existing `register-selected` handler is unchanged
  </acceptance_criteria>
  <done>
    postSaleShown flag declared + cleared in onPreReset + cleared in next-customer handler + set inside startPostSaleFlow. Three new IPC handlers registered with removeAllListeners guards. startPostSaleFlow helper defined. All three audit events emitted with canonical field values. File syntactically valid.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| renderer → ipcMain.on('post-sale:next-customer') | Host can fire this at any time via window.kiosk.notifyPostSaleNextCustomer(). |
| renderer → ipcMain.on('post-sale:auto-logout') | Host can fire this at any time via window.kiosk.notifyPostSaleAutoLogout() — triggers a full session reset. |
| magiclineView relay → ipcMain.on('post-sale:trigger') | Internal main-process bus; attacker-controlled only insofar as Magicline console is attacker-controllable. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| T-10-05-01 | Spoofing | Malicious renderer code fires `post-sale:auto-logout` arbitrarily, forcing session resets | accept | Kiosk has no untrusted renderer code (locked-down Electron shell, strict CSP on host.html, no remote loads). The ONLY way a renderer can hit this IPC is via the legitimate preload surface; no spoofing vector exists in practice. Worst case: a bug causes spurious resets, mitigated by the loop-counter guard (though sale-completed is excluded, the in-flight mutex still prevents reset storms). |
| T-10-05-02 | Spoofing | Malicious renderer code fires `post-sale:next-customer` to keep session alive past idle-expiry | accept | Same rationale — no untrusted renderer code exists. The member-facing risk is null (no session data leak possible from keeping the session alive). |
| T-10-05-03 | Tampering | The `trigger` payload string is reflected directly into log.audit | accept | RESEARCH §5 confirmed `trigger` and `via` are NOT in the logger's redaction allowlist. Attacker-controlled strings from Magicline console could inject noise into audit log. Impact: log pollution only — no log injection because logger.js escapes each field value via string concat (no structured log parsing downstream that could be fooled). |
| T-10-05-04 | Repudiation | postSaleShown dedupe could silently drop a legitimate trigger | mitigate | Handler logs `log.info('phase10.post-sale:trigger.ignored reason=already-shown')` on every rejection. Audit trail shows every trigger attempt, even deduped ones. |
| T-10-05-05 | Information disclosure | log.audit('post-sale.shown', {trigger}) + log.audit('post-sale.dismissed', {via}) leak sale timing | accept | Sale timing is already audited via existing `sale.completed` event. Adding `post-sale.shown`/`post-sale.dismissed` is additive observability, not a new disclosure vector. No PII, no credentials, no cart contents leaked. |
| T-10-05-06 | DoS | Missing removeAllListeners could double-register handler if whenReady re-enters (hot reload) | mitigate | Each of the three new `ipcMain.on` registrations is preceded by `ipcMain.removeAllListeners('post-sale:...')` — matches Phase 5 convention. Acceptance criteria verify count. |
| T-10-05-07 | Denial of Service | Flood of `post-sale:trigger` from Magicline console storms the audit log | mitigate | postSaleShown dedupe short-circuits subsequent triggers. Flood produces at most one `phase10.post-sale:trigger.ignored` log line per flood event plus the throttle is implicit via the flag. |

**Threat level:** LOW. Plan operates inside the trust-boundary of a kiosk with no untrusted renderer code. Primary residual risk is audit log pollution, accepted.
</threat_model>

<verification>
- All 9 greps in the Task 1 verify block match
- `node --check src/main/main.js` exits 0
- `node --test test/sessionReset.test.js` still passes (Plan 01 regression check)
- Three new IPC handlers each have a preceding `removeAllListeners`
- postSaleShown is declared once, cleared in 2 distinct places (onPreReset + next-customer), set in 1 place (startPostSaleFlow)
</verification>

<success_criteria>
- Post-sale orchestration helper and three IPC handlers in main.js
- postSaleShown dedupe flag fully wired (declared, set, cleared in two paths)
- Audit events emitted with canonical taxonomy per RESEARCH §5
- No existing handler modified beyond the single-line onPreReset extension
- Lazy require pattern preserved for idleTimer and sessionReset
</success_criteria>

<output>
After completion, create `.planning/phases/10-post-sale-flow-with-print-interception/10-05-SUMMARY.md` documenting:
- Exact before/after of the three changes (flag declaration, onPreReset extension, helper + handlers block)
- Line count delta
- Confirmation no existing handler modified
- Confirmation all IPC channel names match Plan 02's preload surface (post-sale:show, post-sale:next-customer, post-sale:auto-logout) and Plan 04's magiclineView relay (post-sale:trigger)
</output>
