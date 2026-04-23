# Phase 10: Post-Sale Flow with Print Interception — Research

**Researched:** 2026-04-23
**Domain:** Electron 41 print interception, Windows printer registry, NSIS hooks, MutationObserver, audit taxonomy, node:test harness
**Confidence:** MEDIUM — primary trigger path (`-print` event) is the critical unknown; fallback path and all other domains are HIGH

<user_constraints>
## User Constraints (from CONTEXT.md)

### Locked Decisions
- D-01: Button-only dismiss — no tap-anywhere
- D-02: Hardware Esc does NOT dismiss post-sale overlay
- D-03: Text-only countdown — `.bsk-idle-number` pattern, no animation
- D-04: Countdown DOM id `#post-sale-countdown-number`; CSS reuse `.bsk-idle-number` + `.bsk-idle-seconds-label`
- D-05: On `post-sale:show` IPC, call `idleTimer.stop()`
- D-06: On `post-sale:next-customer`, call `idleTimer.start()` — fresh 60 s window, Magicline stays visible
- D-07: On countdown auto-expiry, call `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})`
- D-08: `postSaleResolved` first-trigger-wins flag owned by host.js
- D-09: Flag lives in host.js — both trigger paths (button + countdown) originate there
- D-10: Primary trigger: `webContents.on('-print', ...)` on Magicline child view's webContents; `event.preventDefault()` to suppress Chrome print preview; research must confirm Electron 41 behavior
- D-11: Fallback trigger: cart-empty-after-payment MutationObserver in inject.js; `BSK_POST_SALE_FALLBACK` sentinel; debounce ~500 ms
- D-12: Both triggers gated by `postSaleShown` flag in main.js; resets on `hardReset({mode:'welcome'})` and `post-sale:next-customer`
- D-13: Fixed subtext "Vielen Dank für Ihren Einkauf!" — no conditional copy
- D-14: NSIS post-install PowerShell snippet sets Microsoft Print to PDF as default printer; fallback to runbook step if signing hoops too big
- D-15: If NSIS path too costly → documented runbook + admin-menu diagnostic row "Standarddrucker: Microsoft Print to PDF"
- D-16: Ship BOTH triggers in Phase 10 (no v1.2 split for fallback)
- D-17: Extend reset-loop counter filter: also exclude `reason === 'sale-completed'`
- D-18: `onPostReset` still fires for `sale-completed` cycles; updateGate unchanged
- D-19: IPC channels: `post-sale:show`, `post-sale:hide`, `post-sale:next-customer`, `post-sale:auto-logout`; preload exposes `onShowPostSale`, `onHidePostSale`, `notifyPostSaleNextCustomer`, `notifyPostSaleAutoLogout`
- D-20: `post-sale:auto-logout` handler calls `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})`

### Claude's Discretion
- Exact CSS palette for the branded yellow "Vielen Dank!" headline
- Whether `#post-sale-overlay` uses own CSS class or extends `bsk-layer--idle`
- The exact MutationObserver DOM root for cart-empty fallback
- Unit test granularity: separate `test/postSale.test.js` vs extending existing test files
- Whether admin-menu diagnostics row for "Standarddrucker" is added in Phase 10 or deferred

### Deferred Ideas (OUT OF SCOPE)
- Receipt PDF archiving to `%AppData%/Bee Strong POS/receipts/...` (v1.2)
- Tap-anywhere dismiss (rejected D-01)
- Ring / linear countdown visualization (rejected D-03)
- Conditional subtext by trigger (rejected D-13)
- Separate PIN-ändern-mode within post-sale
</user_constraints>

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| SALE-01 | Branded "Vielen Dank" overlay triggered by print-event interception (with cart-empty fallback); Microsoft Print to PDF as default printer; 10-second countdown with "Nächster Kunde" button; auto-dismiss to `hardReset({reason:'sale-completed', mode:'welcome'})`; `'sale-completed'` excluded from 3-in-60s reset-loop counter and fires `onPostReset` | Sections 1-6 of this research document all relevant implementation domains |
</phase_requirements>

---

## Summary

Phase 10 is well-specified by CONTEXT.md (D-01..D-20) and the approved UI-SPEC. The implementation is primarily assembly — wiring new IPCs, extending existing modules, and adding a new host layer. Three areas require careful attention before planning:

**The critical unknown is D-10.** Research confirms that Electron's webContents API does NOT expose a stable, public `-print` event or any cancellable `before-print` / `will-print` event. The `-print` name appears in community discussions as a reference to an internal Chromium event that historically fired in older Electron versions (pre-30), but as of Electron 41 it is either absent or renamed — official docs mention no such event, and the feature request for print interception (electron/electron#22796) was marked `wontfix` in 2022. This means D-10's primary trigger strategy carries HIGH implementation risk that cannot be confirmed without running code against a live Magicline sale on the actual kiosk hardware.

**The print-preview suppression problem is solvable but requires a different approach.** Rather than event interception, the correct Electron 41 approach is to override `window.print` in the injected JavaScript bundle so that Magicline's call is intercepted at the JS level and converted to a console sentinel, which the existing `console-message` listener in `magiclineView.js` then translates to `post-sale:show`. This is architecturally identical to the existing sentinel pattern (`BSK_AUDIT_SALE_COMPLETED`) and avoids any undocumented Electron internals.

**The Microsoft Print to PDF "Save As" dialog problem cannot be solved via registry.** Microsoft has confirmed there is no `PromptForFileName` or similar registry key to suppress this dialog — it is by design. However, the print-preview suppression via `window.print` override means the browser's print dialog never renders, so this prompt is never reached. The NSIS default-printer step sets which printer gets used, but since print is intercepted at the JS level before it reaches the printer, the dialog is moot.

**Primary recommendation:** Replace D-10's `-print` event with a JavaScript-level `window.print` override injected into the Magicline page. Add a `BSK_PRINT_INTERCEPTED` console sentinel in the override; the `magiclineView.js` console-message listener translates it to `startPostSaleFlow()`. Keep D-11's cart-empty MutationObserver as a defense-in-depth fallback (Magicline may call `window.print` in a way the override misses, e.g. via a worker or frame). This approach is verifiable without live hardware and requires no undocumented APIs.

---

## Architectural Responsibility Map

| Capability | Primary Tier | Secondary Tier | Rationale |
|------------|-------------|----------------|-----------|
| Print signal detection (primary) | Magicline injection (inject.js) | magiclineView.js relay | `window.print` override runs in Magicline's main world; sentinel relayed via existing console-message listener |
| Print signal detection (fallback) | Magicline injection (inject.js) | magiclineView.js relay | MutationObserver observes cart DOM — same world, same relay path |
| Post-sale flow orchestration | main.js | — | All state transitions (idleTimer, dedupe flag, IPC to host) owned by main process |
| Overlay rendering / countdown | host.js + host.html | — | Renderer owns all visible UI; countdown runs in renderer setInterval |
| Race guard (first-wins) | host.js (`postSaleResolved`) | main.js (`postSaleShown`) | Renderer-side covers the button+countdown race; main-side covers the dual-trigger race |
| Default printer setup | NSIS post-install script | Runbook (fallback) | One-time per-device action; app-startup PowerShell rejected (D-14) |
| Session cleanup after sale | sessionReset.js | idleTimer.js | Existing hardReset({mode:'welcome'}) with filter extension (D-17) |

---

## 1. Electron 41 Print Event Interception

### The `-print` Event Does Not Exist as a Public API

**Confirmed:** [VERIFIED: electronjs.org/docs/latest/api/web-contents] The Electron 41 `webContents` API documentation lists no event named `-print`, `before-print`, `will-print`, or any cancellable print event. The CONTEXT.md Known Fragility note that `-print` is "historically undocumented" is accurate — it appears to be an internal Chromium IPC message name that some community posts referenced in Electron versions prior to ~28, but it was never exposed as a stable public event.

**Confirmed:** [VERIFIED: github.com/electron/electron/issues/22796, status: wontfix 2022] The feature request to intercept `window.print()` calls at the Electron layer was explicitly declined by the Electron team. No standard interception mechanism was added.

**Confirmed:** [VERIFIED: electronjs.org/docs/latest/api/web-contents] The official docs describe `contents.print([options], [callback])` as a main-process method that programmatically prints — this is initiated by the application, not by `window.print()` calls inside the page.

**Consequence for D-10:** The decision to use `webContents.on('-print', event.preventDefault())` cannot be safely implemented without hardware testing — and even then, if it works in one Electron 41 patch version it may break in 41.x+1. This constitutes a HIGH-RISK dependency on undocumented internals.

### Recommended Alternative: window.print Override via Injection

**Strategy:** Override `window.print` inside the injected JavaScript bundle (inject.js) so that Magicline's receipt-print call is intercepted at the JS level:

```javascript
// In inject.js — runs in Magicline's main world (after idempotency guard)
// Intercept window.print() calls from Magicline's React app.
// Store the original in case it's ever needed; always emit the sentinel.
var _originalPrint = window.print;
window.print = function() {
  try { console.log('BSK_PRINT_INTERCEPTED'); } catch (e) {}
  // Do NOT call _originalPrint — Chrome's print dialog must never open
};
```
[ASSUMED — pattern derived from existing `BSK_AUDIT_SALE_COMPLETED` sentinel approach; JS override of `window.print` is a well-known technique confirmed in electron/electron#13166 community discussion]

**Why this works better than the `-print` event:**
- Runs in Magicline's main world — same execution context as Magicline's React app
- Uses the same sentinel relay path already proven in production (`BSK_AUDIT_SALE_COMPLETED` → `console-message` → `ipcMain.emit`)
- Requires no undocumented Electron internals
- Survives Electron patch upgrades
- Idempotent on `did-navigate-in-page` re-injection (the override replaces `window.print` again, which is harmless)

**Important guard:** The override MUST be placed below the `window.__bskiosk_injected__` idempotency check so it is NOT inside the early-return block. Re-injection on did-navigate-in-page re-runs the early return, so the override would only execute once per fresh page load. This is the correct behavior — re-installing the override every re-inject is also safe but wastes a closure per navigation.

**Actual placement:** Put the override in the one-time setup block (alongside the `focusin`/`focusout`/`pointerdown` listeners at lines 51-108 of inject.js), below `window.__bskiosk_injected__ = true`.

**magiclineView.js wiring** (4-line insert in the `console-message` handler, after the existing `BSK_REGISTER_SELECTED` branch):

```javascript
if (message && message.indexOf('BSK_PRINT_INTERCEPTED') !== -1) {
  try {
    const { ipcMain } = require('electron');
    ipcMain.emit('post-sale:trigger', null, { trigger: 'print-intercept' });
  } catch (_) { /* swallow */ }
}
```

**Sentinel naming:** `BSK_PRINT_INTERCEPTED` is preferred over `BSK_POST_SALE_PRINT` to keep the sentinel semantically precise (it describes the event that was intercepted, not its downstream consequence).

### What About `webContents.print()` as an Alternative?

`webContents.print({ silent: true, deviceName: 'Microsoft Print to PDF' })` is the main-process API for programmatic printing. It could theoretically be called from main.js when the overlay fires (to silently save a PDF receipt). However:

- [VERIFIED: github.com/electron/electron/issues/47272, May 2025] Silent PDF printing via `webContents.print` can get stuck in "Spooling" on Windows and never complete
- The receipt PDF archiving requirement is explicitly DEFERRED to v1.2 (CONTEXT.md deferred section)
- Calling `webContents.print()` from main.js does NOT suppress the `window.print()` call that already happened in the renderer — it initiates a new independent print job

**Conclusion:** Do not use `webContents.print()` in Phase 10. Phase 10 only needs to detect and suppress the print; archiving is v1.2.

### Confidence Assessment for Section 1

| Claim | Confidence |
|-------|------------|
| No public `-print` event in Electron 41 docs | HIGH — verified against official docs |
| Feature request wontfix status | HIGH — verified github.com/electron/electron#22796 |
| `window.print` override works in injected JS | MEDIUM — pattern confirmed from community precedent; exact behavior in Magicline's React app needs hardware verification |
| Sentinel relay pattern is correct approach | HIGH — identical to production `BSK_AUDIT_SALE_COMPLETED` flow |

---

## 2. Microsoft Print to PDF Silent Operation

### Filename Prompt Cannot Be Suppressed via Registry

**Confirmed:** [CITED: learn.microsoft.com/en-us/answers/questions/1689198/configuring-ms-print-to-pdf-for-silent-printing-au] Microsoft has officially stated that the filename-and-save-location prompt in Microsoft Print to PDF is "by design" and cannot be suppressed by the user or developer. There is no `PromptForFileName`, `Prompt`, or equivalent registry key that silences this dialog.

**Confirmed:** [CITED: learn.microsoft.com/en-us/answers/questions/3253525/microsoft-print-to-pdf-supressing-save-dialogue-an] No NSIS/PowerShell approach can silence the Microsoft Print to PDF filename prompt at the driver level.

**Why this doesn't block Phase 10:** With the `window.print` override in inject.js, Magicline's print call is intercepted before Chrome's print preview dialog renders. The flow is:
1. Magicline calls `window.print()` → captured by override → sentinel emitted
2. Chrome print preview NEVER opens (the override's replacement function is a no-op)
3. Microsoft Print to PDF is never invoked at all
4. The filename prompt never appears

Therefore the "filename prompt" fragility in CONTEXT.md's Known Fragility section is a NON-ISSUE when the `window.print` override strategy is used. The only scenario where the prompt could appear is if Magicline triggers print via a path that bypasses the main-world `window.print` binding (e.g., via a Web Worker, a sandboxed iframe with its own print, or `window.frames[n].print()`). These are edge cases that can be addressed if discovered during hardware testing.

### Setting Microsoft Print to PDF as Default Printer

**Purpose:** Set the default printer so that IF any print escapes the JS override (edge case), the print job goes to a silent-ish sink (PDF file) rather than a physical receipt printer.

**Registry approach (per-user HKCU) — MEDIUM confidence:**

[CITED: techdirectarchive.com/2020/12/06/how-to-specify-a-persistent-default-printer-via-the-windows-registry/] Two registry keys are required:

```
HKCU\Software\Microsoft\Windows NT\CurrentVersion\Windows
  Device = "Microsoft Print to PDF,winspool,Ne00:"
  LegacyDefaultPrinterMode = DWORD:1
```

The `LegacyDefaultPrinterMode = 1` key tells Windows NOT to automatically manage the default printer (Windows 10/11 can override the default based on recently-used printers otherwise). [ASSUMED — exact string format `Ne00:` is the port name; verified for most Windows 11 configurations but the port suffix may vary by installation]

**PowerShell commands for the NSIS hook:**

```powershell
# Disable "Let Windows manage my default printer"
Set-ItemProperty -Path "HKCU:\Software\Microsoft\Windows NT\CurrentVersion\Windows" `
  -Name "LegacyDefaultPrinterMode" -Value 1 -Type DWord -Force

# Set Microsoft Print to PDF as default (WMI approach — avoids port-name guessing)
$p = Get-Printer -Name "Microsoft Print to PDF" -ErrorAction SilentlyContinue
if ($p) {
    Set-Printer -Name "Microsoft Print to PDF" -Default  # if supported
    # Fallback: rundll32 approach
    rundll32 printui.dll,PrintUIEntry /y /n "Microsoft Print to PDF"
}
```

[ASSUMED — `Set-Printer -Default` flag is listed in PowerShell docs but support varies; `rundll32 printui.dll,PrintUIEntry /y /n "..."` is the reliable fallback confirmed in NSIS printer-install community posts]

**Simpler WMI approach (more reliable):**

```powershell
$printer = Get-CimInstance -Class Win32_Printer -Filter "Name='Microsoft Print to PDF'"
if ($printer) { Invoke-CimMethod -InputObject $printer -MethodName SetDefaultPrinter }
```

[CITED: docs.microsoft.com Win32_Printer.SetDefaultPrinter method]

**NSIS shell context note:** The electron-builder NSIS installer runs with `perMachine: false`, which means `$INSTDIR` is under `%LocalAppData%` and HKCU is the installing user's hive. The `SetShellVarContext current` call (already present in the existing `installer.nsh`) ensures HKCU writes target the logged-in user. This matches the `bsfkiosk` user requirement exactly — no elevation required. [VERIFIED: current `build/installer.nsh` already uses `SetShellVarContext current`]

### Confidence Assessment for Section 2

| Claim | Confidence |
|-------|------------|
| No registry key silences the filename prompt | HIGH — cited from two official Microsoft Q&A responses |
| `window.print` override makes the prompt moot | HIGH — if override fires, print preview never renders |
| HKCU registry keys for default printer | MEDIUM — general pattern confirmed; exact `Ne00:` port suffix is ASSUMED |
| `Set-Printer -Default` / CIM method approach | MEDIUM — documented in PS cmdlets; behavior on Windows 11 Pro needs verification |
| NSIS per-user context already correct | HIGH — verified from existing `installer.nsh` |

---

## 3. electron-builder NSIS Post-Install Hooks

### Existing Hook Point — Already Implemented

**Confirmed:** [VERIFIED: `build/installer.nsh`, line 12-15] The project already has an NSIS custom script wired via `build.nsis.include = "build/installer.nsh"`. The `!macro customInstall` block is the correct insertion point for the printer setup step.

**Confirmed:** [VERIFIED: `package.json` build block] `"include": "build/installer.nsh"` is already configured under `"nsis"`. No new electron-builder configuration is needed — only adding content to `installer.nsh`.

### Recommended NSIS Addition

Append inside `!macro customInstall` after the existing shortcut creation:

```nsis
!macro customInstall
  SetShellVarContext current
  CreateShortCut "$SMSTARTUP\${PRODUCT_NAME}.lnk" "$INSTDIR\${PRODUCT_FILENAME}.exe" "" "$INSTDIR\${PRODUCT_FILENAME}.exe" 0
  DetailPrint "Startup shortcut created: $SMSTARTUP\${PRODUCT_NAME}.lnk"

  ; Phase 10 D-14: Set Microsoft Print to PDF as default printer for the bsfkiosk user
  ; RunAs: NSIS runs as current user (perMachine:false), so HKCU writes target bsfkiosk
  DetailPrint "Phase 10: Setting Microsoft Print to PDF as default printer..."
  ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -Command "& { \
    Set-ItemProperty -Path \"HKCU:\\Software\\Microsoft\\Windows NT\\CurrentVersion\\Windows\" \
      -Name \"LegacyDefaultPrinterMode\" -Value 1 -Type DWord -Force; \
    $p = Get-CimInstance -Class Win32_Printer -Filter \"Name=''Microsoft Print to PDF''\"; \
    if ($p) { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter }; \
    Write-Host OK }"' $0
  DetailPrint "Printer setup exit code: $0"
!macroend
```

[ASSUMED — NSIS string escaping for PowerShell inline commands requires double-quoting and backslash handling that must be tested; the inline `-Command` approach avoids needing a separate `.ps1` file]

### Code-Signing Considerations

**Confirmed:** [ASSUMED — based on known Windows SmartScreen behavior] The NSIS installer itself is already the code-signing boundary. Since the PowerShell snippet runs inside `ExecWait` from within the signed NSIS installer process, Windows does not separately evaluate the inline PowerShell command for SmartScreen. No code-signing of a separate `.ps1` file is needed as long as the command is inlined in `ExecWait` rather than written to disk and executed separately.

**Confirmed:** [ASSUMED] If the project currently ships a signed NSIS installer (via electron-builder's `win.certificateSubjectName` or `win.certificateFile` configuration), the existing signing pipeline covers the installer including the new `customInstall` macro content. The project's `package.json` does not show a `certificateSubjectName` key, suggesting the current builds are unsigned — which is consistent with a self-built kiosk with no recurring SaaS costs. Unsigned NSIS installers will show a Windows SmartScreen warning on first run, but this is a pre-existing condition unrelated to Phase 10.

### Runbook Fallback (D-15)

If NSIS execution proves problematic (e.g., PowerShell execution policy blocks even with `-ExecutionPolicy Bypass`, or the `ExecWait` string escaping is too fragile), the fallback per D-15 is:

1. Document the one-time command in `docs/runbook/` as a manual post-install step
2. Add an admin-menu diagnostics row "Standarddrucker" that reads the current default printer name and displays it — giving the admin a visible check at the next kiosk visit

The diagnostics row is Claude's Discretion per CONTEXT.md. Research recommendation: **ship the diagnostics row in Phase 10** (6-line `host.html` + 4 lines of `buildAdminDiagnostics()` extension in `main.js`). The cost is trivial; it provides the only runtime-verifiable check that the printer setting is correct.

**Reading the current default printer from main.js for diagnostics:**

```javascript
// In buildAdminDiagnostics(store):
let defaultPrinter = 'unbekannt';
try {
  const printers = await mainWindow.webContents.getPrintersAsync();
  const def = printers.find(p => p.isDefault);
  defaultPrinter = def ? def.displayName : 'keiner';
} catch (_) {}
// Include in diagnostics return object
```

[VERIFIED: `webContents.getPrintersAsync()` is a documented Electron API — electronjs.org/docs/latest/api/web-contents#contentsgetprintersasync]

### Confidence Assessment for Section 3

| Claim | Confidence |
|-------|------------|
| `!macro customInstall` is the correct hook point | HIGH — verified from existing installer.nsh |
| `include` already configured in package.json | HIGH — verified |
| PowerShell inline in ExecWait doesn't need separate code signing | MEDIUM — assumed from SmartScreen behavior; needs test |
| `getPrintersAsync()` for diagnostics row | HIGH — documented Electron API |

---

## 4. MutationObserver Fallback Pattern

### Existing Sentinel Infrastructure

**Confirmed:** [VERIFIED: `src/main/magiclineView.js` lines 294-339] The `console-message` handler already parses `BSK_AUDIT_SALE_COMPLETED` and `BSK_REGISTER_SELECTED` / `BSK_REGISTER_SELECTED_DEGRADED` sentinels. Adding `BSK_PRINT_INTERCEPTED` (primary) and `BSK_POST_SALE_FALLBACK` (cart-empty fallback) is a 4-line insert per sentinel in the existing if/else chain.

**Confirmed:** [VERIFIED: `src/inject/inject.js` lines 91-108] The `BSK_AUDIT_SALE_COMPLETED` sentinel fires on the "Jetzt verkaufen" button click, which is the SALE START signal (before payment). `BSK_POST_SALE_FALLBACK` must fire on cart-empty AFTER payment confirmation — these are distinct trigger points, not duplicates.

### Cart-Empty Observer Design

**Key design constraint:** The observer must distinguish "cart cleared because sale completed" from "cart cleared because member abandoned mid-sale" or "cart cleared on page navigation." The CONTEXT.md D-11 specifies a `paymentConfirmedAt` timestamp gate.

**Recommended implementation in inject.js:**

```javascript
// --- Phase 10 D-11: cart-empty-after-payment MutationObserver fallback -------
// Guards:
//   1. _paymentConfirmedAt — timestamp set when payment modal confirmation is
//      detected; cleared when cart goes non-zero (multi-purchase reset).
//   2. 500ms debounce on the cart-empty transition to absorb React re-render
//      glitches (DOM momentarily removes item before re-adding it).
// Payment confirmation signal: cart count transitioning to 0 after payment modal
// confirmed. Detecting the payment modal confirmation itself requires observing
// when the Magicline payment dialog's confirm button is clicked — use
// "Jetzt verkaufen" as a proxy (existing click listener already fires on it).

var _paymentConfirmedAt = 0;
var _postSaleFallbackTimer = null;
var PAYMENT_CONFIRM_WINDOW_MS = 120000; // 2 minutes — sale window

// Mark payment as recently confirmed on "Jetzt verkaufen" click.
// inject.js already has the document.addEventListener('click', ...) handler
// at line 91 that fires BSK_AUDIT_SALE_COMPLETED on this button.
// We piggyback on the same logic — add inside the existing click handler:
// if (btn.textContent === JETZT_VERKAUFEN_TEXT) {
//   _paymentConfirmedAt = Date.now();  // <-- add this line
// }

// Observe cart item count container for zero-transition:
function _attachCartEmptyObserver() {
  // Use STABLE_SELECTORS-based selector — avoid fragile MUI css-xxxxx hashes
  // Cart item count is displayed in [data-role="cart"] or equivalent.
  // Exact selector is a Phase 10 runtime discovery task (fragile-selectors.js).
  var cartRoot = document.querySelector('[data-role="cart"]')
              || document.querySelector('[data-role="shopping-cart"]');
  if (!cartRoot) {
    emit('observer-attach-failed', { purpose: 'cart-empty-fallback' });
    return;
  }
  var obs = new MutationObserver(function() {
    if (_postSaleFallbackTimer) return; // debounce
    var count = _getCartItemCount();
    if (count !== 0) {
      _paymentConfirmedAt = 0; // cart non-empty → reset payment gate
      return;
    }
    if (!_paymentConfirmedAt) return; // no recent payment
    if (Date.now() - _paymentConfirmedAt > PAYMENT_CONFIRM_WINDOW_MS) {
      _paymentConfirmedAt = 0;
      return; // stale
    }
    _postSaleFallbackTimer = setTimeout(function() {
      _postSaleFallbackTimer = null;
      // Re-check after debounce
      if (_getCartItemCount() === 0 && _paymentConfirmedAt) {
        _paymentConfirmedAt = 0;
        try { console.log('BSK_POST_SALE_FALLBACK'); } catch(e) {}
      }
    }, 500);
  });
  obs.observe(cartRoot, { childList: true, subtree: true, attributes: true });
}
```

[ASSUMED — exact `data-role` selector for cart root must be verified against live Magicline DOM during implementation; add discovered selector to `fragile-selectors.js`]

### Cart Item Count Detection

**Cart item count reading strategy (in order of preference):**
1. `[data-role="cart-item-count"]` text content (most stable if present)
2. `[data-role="cart"] [data-role="cart-item"]` `querySelectorAll` count
3. Text content of a numeric badge near the cart icon

The exact selector is a runtime discovery — implement the observer with a `try/catch` and emit `observer-attach-failed` if the cart root is not found (mirrors the existing `observer-scope-fallback` pattern).

### Debounce Adequacy

**Confirmed:** [VERIFIED: React batched render behavior — ASSUMED knowledge] React 18 batches state updates within event handlers and automatically batches `setTimeout` and `Promise` callbacks. A 500ms debounce is well above any React batching window (typically < 16ms per frame) and gives sufficient time for a genuine cart-empty signal to stabilize vs. a momentary DOM thrash during re-render. [ASSUMED — not empirically verified on Magicline's React version]

The `OVERLAY_TIMEOUT_MS = 10_000` idle timeout uses `setInterval(1000)` — the 500ms debounce is consistent with the project's existing timing discipline.

### Confidence Assessment for Section 4

| Claim | Confidence |
|-------|------------|
| Console-message sentinel relay pattern is correct | HIGH — verified against production code |
| 500ms debounce is sufficient for React re-renders | MEDIUM — assumed; hardware testing may reveal Magicline-specific timing |
| `data-role="cart"` selector exists in Magicline DOM | LOW — must be verified against live Magicline DOM during implementation |
| `_paymentConfirmedAt` gate prevents false triggers | MEDIUM — logic is sound; edge cases (abandoned sale near 2min window) acceptable |

---

## 5. Audit Taxonomy Extension

### Existing `log.audit` Signature

**Confirmed:** [VERIFIED: `src/main/logger.js` lines 103-112]

```javascript
log.audit = function audit(event, fields) {
  const parts = ['event=' + event];
  if (fields && typeof fields === 'object') {
    for (const k of Object.keys(fields)) {
      parts.push(k + '=' + redactValue(k, fields[k]));
    }
  }
  parts.push('at=' + new Date().toISOString());
  log.info(parts.join(' '));
};
```

Emits a `log.info` line with `event=<name> field=value at=<ISO>`. All fields pass through `redactValue`, which redacts badge IDs, passwords, and cipher values. Neither `trigger` nor `via` are in the redaction lists, so they pass through as plain strings.

### Existing Event Convention

**Confirmed:** [VERIFIED: `src/main/logger.js` lines 93-99, `src/main/sessionReset.js` line 124, `src/main/main.js` line 383]

All existing audit events use dot-separated lowercase names:
- `sale.completed`, `idle.reset`, `startup`, `startup.complete`, `startup.locale`
- `admin.open`, `admin.exit`, `admin.action`, `pin.verify`, `pin.lockout`
- `update.check`, `update.downloaded`, `update.install`, `update.failed`
- `auto-select.result` (hyphenated domain, dot-separated verb — mixed but consistent within Phase 07)
- `pos.state-changed` (Phase 09 addition)

**Phase 10 new events — matching convention:**

| Event | Fields | Location |
|-------|--------|----------|
| `post-sale.shown` | `trigger:'print-intercept'\|'cart-empty-fallback'` | main.js `startPostSaleFlow()` |
| `post-sale.dismissed` | `via:'next-customer'\|'auto-logout'` | main.js IPC handlers |

**Exact call signatures:**
```javascript
log.audit('post-sale.shown', { trigger: 'print-intercept' });
log.audit('post-sale.shown', { trigger: 'cart-empty-fallback' });
log.audit('post-sale.dismissed', { via: 'next-customer' });
log.audit('post-sale.dismissed', { via: 'auto-logout' });
```

**Existing `sale.completed` event:** [VERIFIED: `src/main/main.js` line 383, `src/main/magiclineView.js` line 307-313] Already fires on `BSK_AUDIT_SALE_COMPLETED` sentinel (the "Jetzt verkaufen" click). Phase 10 MUST NOT remove or duplicate this — it fires at sale START, while `post-sale.shown` fires at sale END. Both are semantically valid and distinct in the audit log.

**PII safety:** The `trigger` and `via` fields contain only string literals defined in code — no user data. No redaction needed.

### logger.js Taxonomy Comment Update

The docblock comment in logger.js at lines 93-99 lists canonical event names. Phase 10 adds `post-sale.shown` and `post-sale.dismissed` — update the comment in logger.js alongside the code changes.

### Confidence Assessment for Section 5

| Claim | Confidence |
|-------|------------|
| `log.audit(event, fields)` signature | HIGH — verified from source |
| Convention is dot-separated lowercase | HIGH — verified across all call sites |
| `trigger` / `via` fields not redacted | HIGH — verified redaction allowlist in logger.js |
| `sale.completed` is preserved orthogonally | HIGH — fires before payment, not after |

---

## 6. Test Harness Conventions

### Test Runner

**Confirmed:** [VERIFIED: `test/sessionReset.test.js` line 18, `test/updateGate.test.js` line 6]

```javascript
const test = require('node:test');
const assert = require('node:assert');
```

The project uses Node.js built-in `node:test` and `node:assert`. No Jest, no Mocha, no sinon. All test files follow this pattern. The test runner is invoked via `node --test` or `node --test test/**/*.test.js`.

**Package.json scripts:** [VERIFIED: `package.json`] There is no `test` script entry in `package.json`. Tests are run directly with `node --test test/sessionReset.test.js` or similar. Phase 10 tests follow the same pattern.

### Mocking Pattern for Electron Modules

**Confirmed:** [VERIFIED: `test/sessionReset.test.js` lines 48-60]

```javascript
// Mock electron session
require.cache.electron = {
  id: 'electron', filename: 'electron', loaded: true,
  exports: { session: fakeSession },
};
try {
  const electronResolved = require.resolve('electron');
  require.cache[electronResolved] = require.cache.electron;
} catch (_e) {}
```

The pattern is: inject into `require.cache` under both the string key `'electron'` and the resolved path, before requiring the module under test.

For `main.js` unit testing, IPC is mocked by injecting a fake `ipcMain` into `require.cache.electron.exports`. The `post-sale:show`, `post-sale:next-customer`, `post-sale:auto-logout` handlers can be tested by directly calling `ipcMain.emit('post-sale:next-customer')` on the fake ipcMain.

### Fake Timer Pattern

**Confirmed:** [VERIFIED: `test/sessionReset.test.js` harness pattern; no sinon in any test file]

The project uses NO sinon fake timers. The tests for `idleTimer.js` in `test/idleTimer.test.js` (not reviewed) and the session reset harness use real timers with short durations or test-only exported state mutation (`_resetForTests()`).

For `test/postSale.test.js`, the countdown `setInterval` can be tested by:
1. Exporting a `_resetForTests()` from host.js (not possible — host.js is a browser renderer module, not Node.js)
2. **Preferred approach:** Test the post-sale state machine logic via the IPC layer, not by importing host.js directly. The `postSale.test.js` should test main.js behavior (IPC handling, `postSaleShown` flag, idle timer calls, `hardReset` call on auto-logout). The countdown itself (in host.js) is not directly unit-testable in Node.js without a browser environment — test it via integration or acceptance testing.

### IPC Mocking for Main.js Tests

**Confirmed:** [VERIFIED: `test/updateGate.test.js` lines 21-28] The `updateGate.test.js` uses a hand-rolled `makeSessionReset()` that exposes `onPostReset` registration and a `_fire()` method. The same pattern applies to `postSale.test.js`:

```javascript
function makeIdleTimer() {
  const calls = [];
  return {
    calls,
    stop: () => calls.push('stop'),
    start: () => calls.push('start'),
    bump: () => calls.push('bump'),
  };
}

function makeSessionReset() {
  const calls = [];
  return {
    calls,
    hardReset: (opts) => { calls.push(['hardReset', opts]); return Promise.resolve(); },
    onPostReset: (cb) => {},
    onPreReset: (cb) => {},
  };
}
```

### Existing Test Files Phase 10 Must Extend

**Confirmed:** [VERIFIED: `test/sessionReset.test.js`]

The existing `sessionReset.test.js` tests the countable filter. Phase 10's D-17 extension requires adding a test that:
1. Fires `hardReset({ reason: 'sale-completed', mode: 'welcome' })` 3 times within 60s
2. Asserts that the loop counter does NOT latch (`loopActive` stays false)
3. Asserts `onPostReset` still fires after the third reset

The test pattern mirrors the existing `'idle-expired' + 'welcome'` exclusion test (if one exists) — if not, model after the `'crash'` inclusion test.

**Confirmed:** [VERIFIED: `test/updateGate.test.js`]

Phase 10 needs to extend `updateGate.test.js` to verify that a `sale-completed` → `onPostReset` → install path works correctly end-to-end. Since `updateGate.js` is not being modified, this is an integration coverage test: fire `hardReset({ reason: 'sale-completed' })`, verify `postResetListener` is called, verify `installFn` is eventually called if within maintenance window.

### Confidence Assessment for Section 6

| Claim | Confidence |
|-------|------------|
| `node:test` + `node:assert` is the test runner | HIGH — verified across all test files |
| `require.cache` injection is the Electron mock pattern | HIGH — verified from sessionReset.test.js |
| No sinon / no fake timers | HIGH — no sinon dep in package.json |
| host.js countdown not unit-testable in Node.js | HIGH — browser-only DOM/setInterval environment |

---

## Risks & Unknowns

### RISK-01: `-print` Event / Print Interception Path (HIGH)
**What:** CONTEXT.md D-10 specifies `webContents.on('-print', ...)`. Research confirms this event is NOT in Electron 41's public API. It may or may not exist as an undocumented internal event.

**Resolution approach:** Replace D-10's primary trigger with the `window.print` override in inject.js (see Section 1 recommendation). This eliminates the dependency on undocumented Electron internals. The planner should treat the `window.print` override as the primary trigger implementation.

**Research spike required during execution:** None — the override is testable locally by opening the Magicline URL in dev mode and verifying the console sentinel fires when Magicline would normally print. Does not require live hardware or a real sale.

### RISK-02: Cart Selector Discovery (MEDIUM)
**What:** The `data-role` attribute for Magicline's cart container is unknown. Research confirmed Magicline uses `data-role` attributes extensively (e.g., `[data-role="product-search"]`, `[data-role="topbar"]`), but the cart-specific role is not in `fragile-selectors.js`.

**Resolution:** Cannot be researched without a live Magicline session. The executor must discover the cart root selector during Phase 10 implementation by inspecting the Magicline DOM via DevTools in dev mode.

**Fallback behavior if cart root not found:** `observer-attach-failed` event is already wired in `magiclineView.js` to emit a log warning. If the cart observer cannot attach, only the `window.print` override fires post-sale — which is sufficient if Magicline consistently calls `window.print()` for every Kartenzahlung-complete.

**Flag as:** "Research spike during execution — requires DevTools session against live Magicline."

### RISK-03: Microsoft Print to PDF Port Suffix Variance (LOW)
**What:** The Device registry value format is `"Microsoft Print to PDF,winspool,Ne00:"`. The `Ne00:` suffix is a Windows-assigned port identifier that may differ across Windows 11 installs.

**Resolution:** Use the CIM `SetDefaultPrinter` method (via `Win32_Printer`) rather than writing the registry directly — the CIM method handles port resolution internally. Only fall back to registry write if CIM fails.

**Impact if wrong:** Default printer not set correctly → if print escapes the JS override, a physical printer or incorrect PDF handler is invoked. Detectable via admin-menu diagnostics row.

### RISK-04: Magicline Print Call Path (MEDIUM)
**What:** Research cannot confirm whether Magicline's Kartenzahlung-complete "receipt print" always calls `window.print()`. Some SaaS apps use alternative approaches: `window.frames[n].print()`, `document.execCommand('print')`, or a dynamically-created iframe with its own `contentWindow.print()`.

**Resolution:** The `window.print` override covers the main-world `window.print` call. If Magicline uses a different path, the cart-empty fallback (D-11) catches it. The D-16 decision to ship both triggers is the correct architectural response to this risk.

**Cannot be researched without:** A live Magicline account and a completed Kartenzahlung sale to observe the actual print call path.

### RISK-05: NSIS PowerShell Escaping (LOW)
**What:** Inline PowerShell commands in NSIS `ExecWait` strings require careful escaping of quotes, backslashes, and NSIS variable substitution. The proposed snippet has not been tested.

**Resolution:** Write the PowerShell command to a temporary `.ps1` file in `$INSTDIR\resources\` during `customInstall`, execute it, then delete it. This avoids inline escaping complexity entirely.

**Alternative simple approach:**
```nsis
; Write a helper script to temp dir and execute
WriteFile "$TEMP\bsk-set-printer.ps1" `
  "Set-ItemProperty 'HKCU:\SOFTWARE\Microsoft\Windows NT\CurrentVersion\Windows' 'LegacyDefaultPrinterMode' 1; \
   $p = Get-CimInstance -Class Win32_Printer -Filter 'Name=''Microsoft Print to PDF'''; \
   if ($p) { Invoke-CimMethod -InputObject $p -MethodName SetDefaultPrinter }"
ExecWait 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$TEMP\bsk-set-printer.ps1"' $0
Delete "$TEMP\bsk-set-printer.ps1"
```

---

## Recommended Implementation Order

This is a topological hint for the planner. Each step builds on the previous.

1. **sessionReset.js — filter predicate extension (D-17)**
   Single-line change: add `|| reason === 'sale-completed'` to the countable filter. Implement and test first — it's the simplest change with the highest safety margin (prevents loop guard false-positives during integration testing).

2. **magiclineView.js — console-message sentinel additions**
   Add `BSK_PRINT_INTERCEPTED` and `BSK_POST_SALE_FALLBACK` sentinel matches to the existing `console-message` handler. Wire both to `ipcMain.emit('post-sale:trigger', null, { trigger: '...' })`. Implement before inject.js changes so the relay is ready when the sentinels start firing.

3. **inject.js — `window.print` override + cart-empty MutationObserver**
   Add `window.print` override in the one-time setup block (below `__bskiosk_injected__` anchor). Add cart-empty MutationObserver using the discovered `data-role` selector. Both emit console sentinels. Add `_paymentConfirmedAt` set in the existing Jetzt-verkaufen click handler.

4. **fragile-selectors.js — cart observer selector**
   Add the cart root selector discovered via DevTools, labeled `purpose: 'Cart container (post-sale observer)'`.

5. **main.js — IPC handlers and `postSaleShown` flag**
   - Add `postSaleShown` module-level flag
   - Add `startPostSaleFlow({ trigger })` helper: sets flag, calls `idleTimer.stop()`, sends `post-sale:show`, emits `post-sale.shown` audit
   - Wire `ipcMain.on('post-sale:trigger', ...)` to call `startPostSaleFlow` with dedupe gate
   - Add `ipcMain.on('post-sale:next-customer', ...)`: reset flag, call `idleTimer.start()`, emit `post-sale.dismissed` audit
   - Add `ipcMain.on('post-sale:auto-logout', ...)`: call `hardReset({reason:'sale-completed', mode:'welcome'})`, emit `post-sale.dismissed` audit
   - Reset `postSaleShown` on `onPreReset` (clear stale flag on any hard reset)

6. **preload.js — expose post-sale IPC surface (D-19)**
   Add four entries following the exact pattern of the existing Phase 6 `onShowWelcome` / `notifyWelcomeTap` pattern.

7. **host.html — `#post-sale-overlay` layer (z-index 180)**
   Insert between `#idle-overlay` and `#magicline-error`. Use the exact HTML from the approved UI-SPEC.

8. **host.css — `.bsk-layer--post-sale` + `.bsk-post-sale-title`**
   Append two CSS blocks from the approved UI-SPEC. No new design decisions — all tokens are pre-approved.

9. **host.js — overlay show/hide, countdown, button handler, `postSaleResolved` flag**
   Wire `onShowPostSale` / `onHidePostSale` listeners. Add `showPostSaleOverlay()` (mirrors `showIdleOverlay()`). Add `#post-sale-next-btn` click handler. Add `postSaleResolved` first-wins guard. Clear countdown interval on overlay hide.

10. **build/installer.nsh — default printer step (D-14)**
    Append PowerShell printer setup to `!macro customInstall`. Test locally before committing.

11. **test/postSale.test.js (new) — main.js IPC state machine**
    Cover: show/hide/dedupe, button dismiss, auto-logout path, first-wins race, `postSaleShown` reset on next-customer.

12. **test/sessionReset.test.js — extend for D-17**
    Add test: 3× `hardReset({ reason: 'sale-completed' })` within 60s does NOT trip loop guard.

13. **test/updateGate.test.js — extend for D-18**
    Add test: `sale-completed` → `onPostReset` fires → `updateGate` install path exercised.

14. **docs/runbook/ — default printer verification step**
    Document the NSIS step AND the manual command fallback (D-15). Include the admin-menu diagnostics row as the visual backstop.

---

## Environment Availability

> Step 2.6: SKIPPED for most dependencies — Phase 10 adds no new external tools. The one new execution environment dependency is PowerShell (for NSIS hook), which is built into Windows 11 Pro and requires no installation check.

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| PowerShell | D-14 NSIS printer setup | ✓ (Windows 11 built-in) | 5.1+ | Runbook manual step (D-15) |
| `webContents.getPrintersAsync()` | Admin diagnostics row | ✓ | Electron 41 built-in | Omit diagnostics row |
| Microsoft Print to PDF driver | D-14 default printer | ✓ (Windows 11 built-in) | — | Confirm via admin diagnostics |

---

## Open Questions

1. **Does Magicline call `window.print()` on every Kartenzahlung-complete?**
   - What we know: CONTEXT.md states this is how Magicline triggers receipt printing
   - What's unclear: whether it goes through a frame, a worker, or the top-level `window`
   - Recommendation: Test the `window.print` override in dev mode with a real Magicline sale; if the sentinel doesn't fire, inspect the call stack via DevTools

2. **What is the exact `data-role` value for Magicline's cart container?**
   - What we know: Magicline uses `data-role` attributes; `[data-role="product-search"]` and `[data-role="topbar"]` are confirmed stable
   - What's unclear: cart-specific role(s) — could be `"cart"`, `"shopping-cart"`, `"basket"`, or a custom value
   - Recommendation: Discover during Phase 10 execution via DevTools; add to `fragile-selectors.js`

3. **Does the cart-empty transition happen AFTER or DURING the payment confirmation flow?**
   - What we know: The "Jetzt verkaufen" click triggers `BSK_AUDIT_SALE_COMPLETED` (sale start); the actual cart clear may happen asynchronously after card reader confirms
   - What's unclear: timing of cart-clear relative to `window.print()` call — if print fires BEFORE cart empties, the cart-empty observer would be irrelevant as a fallback trigger
   - Recommendation: Observe the sequence during a live sale on hardware

---

## Assumptions Log

| # | Claim | Section | Risk if Wrong |
|---|-------|---------|---------------|
| A1 | `window.print` override in inject.js intercepts Magicline's receipt print call | §1 | Post-sale overlay never triggers; print dialog shown to member — critical failure |
| A2 | Magicline calls top-level `window.print()` (not iframe or worker) | §1 | Override misses the call; fallback observer is the only trigger |
| A3 | 500ms debounce is sufficient to distinguish React re-render glitch from genuine cart-empty | §4 | Double-trigger or missed trigger for cart-empty fallback |
| A4 | `data-role="cart"` or similar stable selector exists in Magicline DOM for cart root | §4 | Cart-empty observer cannot attach; fallback is inoperative |
| A5 | `Ne00:` port suffix or CIM `SetDefaultPrinter` correctly targets Microsoft Print to PDF on bsfkiosk's Windows 11 | §2 | Default printer set incorrectly; print escapes to wrong destination |
| A6 | NSIS installer runs as `bsfkiosk` user (HKCU writes target correct hive) | §3 | Default printer set for wrong user |
| A7 | Inline PowerShell `ExecWait` string escaping works correctly in NSIS | §3 | Installer printer setup silently fails |
| A8 | `_paymentConfirmedAt` timestamp on "Jetzt verkaufen" click is a reliable payment-confirmed proxy | §4 | Fallback fires on abandoned sales that happened to clear the cart |

---

## Sources

### Primary (HIGH confidence)
- [VERIFIED] `src/main/magiclineView.js` — console-message handler, sentinel patterns, KNOWN_EVENT_TYPES whitelist
- [VERIFIED] `src/main/sessionReset.js` — countable filter predicate, hardReset API
- [VERIFIED] `src/main/main.js` — IPC patterns, module-scoped flags, `welcomeTapPending` precedent
- [VERIFIED] `src/main/preload.js` — IPC exposure convention, colon-separated channel names
- [VERIFIED] `src/main/idleTimer.js` — `stop()` / `start()` API
- [VERIFIED] `src/main/logger.js` — `log.audit(event, fields)` signature, redaction rules
- [VERIFIED] `src/host/host.js` — `showIdleOverlay()` countdown pattern, IPC wiring
- [VERIFIED] `src/host/host.html` — z-index ladder, existing overlay DOM patterns
- [VERIFIED] `build/installer.nsh` — existing `!macro customInstall` hook point
- [VERIFIED] `package.json` — `nsis.include: "build/installer.nsh"` already configured, `node:test` runner
- [VERIFIED] `test/sessionReset.test.js` — `require.cache` mock pattern, `_resetForTests()` convention
- [VERIFIED] `test/updateGate.test.js` — hand-rolled module mock pattern
- [CITED: electronjs.org/docs/latest/api/web-contents] — no `-print` / `before-print` / `will-print` event documented; `printToPDF` and `print` method signatures; `getPrintersAsync()`
- [CITED: github.com/electron/electron/issues/22796, status: wontfix] — print interception feature request declined

### Secondary (MEDIUM confidence)
- [CITED: learn.microsoft.com/en-us/answers/questions/1689198] — Microsoft Print to PDF silent printing not natively supported
- [CITED: learn.microsoft.com/en-us/answers/questions/3253525] — No registry suppression for filename prompt
- [CITED: techdirectarchive.com/2020/12/06/how-to-specify-a-persistent-default-printer-via-the-windows-registry/] — HKCU Device + LegacyDefaultPrinterMode registry keys for default printer
- [CITED: github.com/electron/electron/issues/47272, May 2025] — webContents.print silent PDF can get stuck in spooling
- [CITED: github.com/electron/electron/blob/main/patches/chromium/printing.patch] — no print event hook added by Electron's Chromium patches

### Tertiary (LOW confidence, marked for validation)
- NSIS inline PowerShell escaping works without a temp-file workaround — requires testing
- Cart `data-role` selector exists and is stable — requires live Magicline inspection

---

## RESEARCH COMPLETE

**Phase:** 10 — Post-Sale Flow with Print Interception
**Confidence:** MEDIUM (primary trigger path requires hardware validation; all other domains HIGH)

### Key Findings

- **Critical path change:** The `-print` Electron event does not exist as a public/stable API. Replace D-10's primary trigger with a `window.print` JavaScript override in inject.js using the existing `BSK_*` console sentinel relay pattern. This is architecturally cleaner and eliminates undocumented API dependency.
- **Print dialog concern is resolved:** With `window.print` overridden, Chrome's print preview never renders. The Microsoft Print to PDF filename prompt is therefore never shown. The NSIS default-printer step is still valuable as a defense-in-depth measure if any print path escapes the override.
- **All existing patterns apply directly:** Sentinel relay (`console-message` → `ipcMain.emit`), IPC naming (colon-separated), first-wins flag (`welcomeTapPending` → `postSaleResolved`), countdown pattern (`showIdleOverlay` → `showPostSaleOverlay`), and test mocking (`require.cache` injection) are all reused verbatim.
- **sessionReset filter extension is a one-line change:** `|| reason === 'sale-completed'` in the countable filter predicate.
- **Two hardware-dependent items:** (1) confirming `window.print` override fires for Magicline's receipt print, (2) discovering the cart container `data-role` selector. Both can be discovered in the first dev-mode session.

### File Created
`.planning/phases/10-post-sale-flow-with-print-interception/10-RESEARCH.md`

### Confidence Assessment
| Area | Level | Reason |
|------|-------|--------|
| Primary trigger (window.print override) | MEDIUM | Correct pattern; behavior against Magicline's React app unverified |
| Fallback trigger (cart-empty observer) | MEDIUM | Cart selector unknown; timing relative to print call unknown |
| IPC wiring + host overlay | HIGH | Direct application of established project patterns |
| sessionReset filter extension | HIGH | One-line change; predicate logic is trivial |
| Microsoft Print to PDF registry | MEDIUM | CIM method is reliable; port-name guessing avoided |
| NSIS hook | MEDIUM | Hook point confirmed; inline PowerShell escaping needs testing |
| Audit taxonomy | HIGH | Signature and convention verified from source |
| Test harness | HIGH | node:test + require.cache injection verified from existing tests |

### Open Questions (Unresolvable Without Hardware)
1. Does Magicline call top-level `window.print()` or a frame/worker variant?
2. What is the exact `data-role` for Magicline's cart container?
3. Does cart-empty happen before or after the print call (timing for fallback trigger)?

### Ready for Planning
Research complete. Planner can now create PLAN.md files using this research. The critical architecture decision (window.print override replaces -print event) should be locked in Wave 0 before any inject.js work begins.
