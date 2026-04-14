---
created: 2026-04-14T10:30:00.000Z
title: Post-sale "Vielen Dank" overlay + print interception + auto-logout to welcome
area: general
files:
  - src/host/host.html
  - src/host/host.css
  - src/host/host.js
  - src/main/main.js
  - src/main/preload.js
  - src/inject/inject.js
  - src/main/sessionReset.js
---

## Problem

Found during the 0.1.2 kiosk visit on 2026-04-14, after completing the first end-to-end real sale through the kiosk:

After the member taps "Jetzt verkaufen" → "Kartenzahlung" → "Zahlung bestätigen" in Magicline's "Warenkorb verrechnen" modal, the card terminal next to the kiosk handles the charge, the modal closes, and the kiosk just sits on the cash register page with an empty cart. Three problems with the current state:

1. **No "thank you" feedback.** The member just paid 10 CHF and the only signal that the sale succeeded is "the cart is empty now." For a self-service kiosk, a branded post-sale acknowledgment is normal UX.
2. **Stays on register instead of returning to welcome.** Under the Phase 6 welcome-as-resting-state model, the natural post-sale destination is the welcome layer. The next member walking up should see "Zum Kassieren tippen", not the previous member's empty register.
3. **Magicline session stays alive between members.** If a second member walks up within 60 seconds (before the idle timer fires the welcome logout), they share session state with the previous member. Phase 6's "fresh session per member" guarantee depends on the welcome cycle firing between members — currently only triggered by idle expiry, not by sale completion.
4. **Receipt printing is unconfigured.** Magicline tries to open a print dialog after sale completion (browser print preview via Chrome's UI in Electron) but no real printer is configured. The print preview itself is also a UX dead-end for a touchscreen kiosk member.

## Solution

A new "Vielen Dank" host overlay layer + a print-interception hook that catches Magicline's print dialog, replaces it with the branded overlay, and gives the member two paths forward:

- **10-second auto-redirect to welcome** (default — clean fresh session for next member, matches Phase 6 model)
- **"Nächster Kunde" button** (escape hatch — return to cash register without logout, useful for multi-purchase scenarios)

### Print interception (the trigger)

**Fictional printer driver** — pre-configure **Microsoft Print to PDF** (built into Win 10/11, no install) as the default printer for the `bsfkiosk` user. Magicline submits the print job, the driver discards it (or saves a PDF — see "receipt archiving" below). No real paper, no real printer needed.

**Electron print event interception** — hook `webContents.on('-print', ...)` on the Magicline view OR override `window.print()` from inject.js. Suppress the Chrome print preview window entirely (member never sees it). Route the print job directly to the default printer (Print to PDF), which is silent.

**Optional: receipt archiving.** If the Print to PDF output goes to `%AppData%\Bee Strong POS\receipts\YYYY-MM-DD\receipt-HHMMSS.pdf`, you'd have an audit trail per day for accounting/staff lookup. This is essentially OPS-08 from the v2 requirements ("hashed audit log of transactions") in PDF form — capture it as a v1.1 stretch goal or separate todo.

### "Vielen Dank" overlay (new host layer)

New `#post-sale-overlay` layer in `src/host/host.html`, similar pattern to the existing welcome layer (`#welcome-screen` z-index 150) and idle overlay (`#idle-overlay` z-index 200):

- **z-index:** 180 (between cash register at 0 and idle overlay at 200)
- **Background:** branded `#1A1A1A` with bee logo centered
- **Headline:** "Vielen Dank!" in brand yellow `#F5C518`, large
- **Subtext:** "Ihr Beleg wurde gedruckt" if a print job fired, OR "Ihr Einkauf wurde bestätigt" if no print job
- **Countdown ring:** 10-second visual countdown (similar style to the "Noch da?" overlay's countdown text but optionally a ring/circle visualization)
- **Primary button:** "Nächster Kunde" — fires `post-sale:next-customer` IPC → main hides overlay → cash register stays as-is, idle timer rearms
- **Auto-dismiss:** countdown reaches 0 → fires `sessionReset.hardReset({reason:'sale-completed', mode:'welcome'})` → welcome layer appears
- **Tap-anywhere-else behavior:** treat as implicit "Nächster Kunde" (member is actively engaged, they want to keep going)

### State machine

```
sale completes (print event fires)
  ↓
post-sale:show IPC (main → host)
  ↓
host: hide cash register UI, show #post-sale-overlay, start 10s countdown
  ↓
  ├─ 10s expire → post-sale:auto-logout IPC → main → sessionReset.hardReset({reason:'sale-completed', mode:'welcome'}) → welcome layer
  └─ tap "Nächster Kunde" or anywhere → post-sale:next-customer IPC → main → host hides overlay → cash register visible, idle timer rearms
```

### updateGate / sessionReset interaction

- New reason for `sessionReset.hardReset`: `'sale-completed'` (alongside existing `'idle-expired'`, `'crash'`, etc.).
- This new reason should be **EXCLUDED from the 3-in-60s loop counter** (D-06 model from Phase 6) — same logic as welcome-mode idle expiry. A member doing 4 quick sales in a minute should not trip the reset-loop guard.
- The `onPostReset` hook still fires for sale-completed welcome cycles, so `updateGate` can install pending updates after a sale-driven welcome logout. Same auto-update trigger story as idle expiry.

### Idle timer interaction

- While `#post-sale-overlay` is visible, the 60-second idle timer is **paused** (the post-sale countdown supersedes it).
- After "Nächster Kunde" → idle timer rearms with a fresh 60-second window.
- After auto-logout → idle timer is irrelevant (welcome layer doesn't have one).

### Edge cases

- **Sale cancelled at the payment modal** ("Abbrechen" tap on "Warenkorb verrechnen"). No print event fires → no Vielen Dank overlay → cash register stays as-is. Member can retry the sale or wait for idle timer.
- **Magicline doesn't always auto-open print.** Need to verify during implementation whether the print dialog fires for every successful Kartenzahlung, or only when "Beleg drucken" is explicitly enabled. If sometimes-only, add a fallback trigger: cart goes from non-empty to empty AFTER a payment-modal-confirmed transition (DOM mutation observer in inject.js).
- **Multiple consecutive sales** ("Nächster Kunde" → sale 2 → Vielen Dank → "Nächster Kunde" → sale 3 → ...). Should work without state leakage between sales. Magicline's own per-sale handling is what we rely on. Test for state bleed during implementation.
- **Real receipt printer added later.** No code changes needed — the print-event hook is printer-driver-agnostic. Just swap the default printer in Windows.

### Tests

- `test/postSale.test.js` (new): unit tests for the post-sale state machine — countdown, auto-dismiss, "Nächster Kunde" path, edge cases
- Extend `test/sessionReset.test.js`: new `'sale-completed'` reason fires welcome mode + excluded from loop counter
- Manual: complete a real sale on the kiosk → Vielen Dank appears → either let it auto-dismiss to welcome OR tap "Nächster Kunde" → both paths succeed cleanly

### Doc updates (when this lands)

- `.planning/PROJECT.md` — add a Key Decision row for the post-sale flow design
- `docs/runbook/v1.0-KIOSK-VISIT.md` (or successor) — add a row exercising the post-sale Vielen Dank flow as part of the sale-completion verification
- `.planning/phases/05-admin-exit-logging-auto-update-branded-polish/05-VERIFICATION.md` — add the new `'sale-completed'` reason to the sessionReset+updateGate documentation

## Decision (locked in conversation 2026-04-14)

- **"Nächster Kunde" keeps Magicline session alive across multiple purchases.** Trade-off accepted: this slightly weakens the "fresh session per member" Phase 6 guarantee, but the 60-second idle timer catches any leftover state within a minute, and the UX win for multi-item shopping is worth it.
- **Receipt PDFs are NOT explicitly archived in v1.1.** The print-to-PDF driver discards by default. Capture receipt archiving (OPS-08 in PDF form) as a separate v1.2 todo if/when accounting needs an audit trail.
- **Print interception is the primary trigger,** with cart-empty-after-payment as a fallback if Magicline's print behavior turns out to be inconsistent.

**Practical impact:** medium-high. This is a significant UX improvement and closes the "fresh session per member" gap left by the welcome-only logout model. Also resolves the "no thank you feedback" UX hole.

**Related work:**
- `2026-04-14-keep-splash-visible-until-auto-selection-completes.md` — both touch the host overlay layer system; do that one first since it adds a new IPC pattern (`splash:hide-final`) that this one can mirror
- `2026-04-14-admin-pos-open-close-toggle-with-update-window-gating.md` — the post-sale welcome cycle is another `onPostReset` trigger for the updateGate; check that updateGate's first-trigger-wins logic still does the right thing when both `post-reset` and `sale-completed` fire in rapid sequence
- A future v1.2 todo: archive receipt PDFs to `%AppData%\Bee Strong POS\receipts\YYYY-MM-DD\` for staff/accounting lookup
