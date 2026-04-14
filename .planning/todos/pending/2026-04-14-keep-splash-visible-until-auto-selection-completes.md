---
created: 2026-04-14T08:30:00.000Z
title: Keep splash visible until register auto-selection completes
area: general
files:
  - src/inject/inject.js
  - src/main/main.js
  - src/main/preload.js
  - src/host/host.js
  - src/host/host.html
---

## Problem

Observed during the 0.1.1 kiosk visit on 2026-04-14, after the §7 welcome-loop smoke passed 10/10 cycles cleanly. UX/race concern, not a functional bug:

When a member taps the welcome layer, the current flow is:

```
welcome:tap → splash loading cover → main creates Magicline view →
authFlow runs login → cash-register-ready fires → splash hides →
~1-2s of visible auto-selection click chain ("Kasse auswählen" →
"Self-Checkout" → "Speichern", hardware fix #7 from 2026-04-12) →
register actually ready for first scan
```

The 1-2 second window where the auto-selection is visible is also a window where the member's finger can land on the wrong Magicline button and derail the click chain. Once the chain is broken the kiosk is in a half-selected state — recoverable via the next idle/welcome cycle, but a degraded first-scan experience for that member and a real risk of cart confusion if it happens during a peak hour.

The window exists because `cash-register-ready` (which currently triggers `splash:hide`) fires when login completes, not when the register is fully selected and ready for input.

## Solution

Add a new IPC signal `register-selected` (or `auto-select-complete`) and gate the splash hide on it instead of (or in addition to) `cash-register-ready`. The auto-selection chain already has a known endpoint — it knows when it has clicked "Speichern" successfully — so the signal is a one-line emit from `inject.js`:

1. **`src/inject/inject.js`** — at the end of the auto-selection chain (after the click on "Speichern" resolves successfully, or after the post-click DOM settles into the cash-register state), call `console.log('[BSK] register-selected')` (the existing inject→main bridge pattern, same one used for sale-completed in plan 05-06) or expose a new `window.bskBridge.registerSelected()` if that bridge already exists.
2. **`src/main/main.js`** — listen for the bridge sentinel (or IPC from preload) and forward it as `splash:hide-final` to the host webContents. Keep the existing `cash-register-ready → splash:hide` path untouched as a fallback in case auto-selection is not needed (e.g. register already remembered) — see below.
3. **`src/host/host.js`** — split the existing `splash:hide` handler so:
   - On the welcome path (post-tap), splash stays up until `splash:hide-final` arrives, with a safety timeout (~5s) that falls back to the existing `cash-register-ready` path so the splash is never stuck forever.
   - On the cold-boot/idle-recovery paths, the existing behavior is preserved.
4. **Edge cases to handle:**
   - **Auto-selection not needed.** If Magicline lands directly on the cash register (e.g. register already remembered for this session), inject.js should still emit `register-selected` immediately so the splash hides. Probably best modeled as a single function `markRegisterReady()` called from both the auto-selection success branch and the "already on cash register" branch.
   - **Auto-selection fails.** If the click chain hits a missing button, inject.js should still emit `register-selected` (with a `degraded:true` flag, logged) after a bounded retry, so the splash always hides eventually. The user may see the manual register picker — that's better than being stuck on splash.
   - **Touch-event swallowing during the gap.** Even with the splash visible, the underlying Magicline view receives pointer events because the splash is `pointer-events: none` for the auto-selection clicks to work. Verify the splash actually blocks touches during this window — may need `pointer-events: auto` while the splash is in `auto-select-pending` state. Tradeoff: blocking touches blocks the auto-selection's own clicks if the click chain runs at the host layer (it doesn't — inject.js synthesizes them inside the Magicline DOM, so blocking host-level pointer events should be safe). Test on the kiosk before shipping.

**Practical impact for v1.0:** medium. The bug is reproducible (any member tapping during the 1-2s window can break it) but only mildly degrades the experience for that single transaction. Not worth a v1.0 patch unless field-testing surfaces actual broken transactions. Captured for v1.1.

**Related work:** This change is upstream-coupled with the locale fix (todo `2026-04-14-lock-magicline-ui-to-de-de...`). If both ship in v1.1, do the locale fix first because it removes the German-text fragility from the auto-selection chain that this todo touches.
