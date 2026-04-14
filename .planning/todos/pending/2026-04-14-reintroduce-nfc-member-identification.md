---
created: 2026-04-14T18:00:00.000Z
title: Re-introduce NFC member identification in a future milestone
area: general
files:
  - src/main/main.js
  - src/main/magiclineView.js
  - src/inject/inject.js
  - src/inject/fragile-selectors.js
---

## Problem

As of quick task `260414-eu9` (2026-04-14), the Bee Strong POS Kiosk no longer identifies gym members at the point of sale. The HID badge reader still emits keystrokes, but they land in the Magicline product-search input (focused on `cash-register-ready`) — there is no badge arbiter, no member lookup, no membership-based pricing or benefit application at checkout. The card terminal next to the kiosk handles all payment via Magicline's "Jetzt verkaufen" → "Kartenzahlung" flow.

The descope was a policy decision, not a technical one: Magicline's customer-search (the field we previously populated from a scanned badge ID) requires a Magicline staff account with **member-lookup permissions**, and the gym owner does not want to grant that permission level to the headless kiosk staff account. Without member-lookup, the kiosk can accept payment but cannot:

- Apply membership-based discounts or benefits automatically
- Attribute sales to a specific member's account/history
- Gate membership-only products (if any) by identity
- Show the member's name / expiry / flags as a quick identity confirmation

These capabilities may matter in a future milestone. This todo captures the options and the constraints so whoever picks it up later doesn't have to re-derive the context.

## Options

Two broad paths:

**Option A — Grant member-lookup permissions to the kiosk staff account.**

- Revisit the permission policy with the gym owner. Determine whether a scoped role (read-only member directory, no edit rights, no financial visibility beyond what's already on the cash-register page) is acceptable.
- If yes: recreate the deleted badge arbiter (`src/main/badgeInput.js`) — the last known-good version lives at the v1.0 tag (commit `403f860`) and in the quick 260414-eu9 "refactor" commit's parent tree. Re-wire it on both the host and Magicline webContents (two-attach pattern from the original Phase 4 research). Restore the `[data-role="customer-search"]` inject path in `inject.js` and the customer-search entry in `fragile-selectors.js`.
- Expected effort: 1 plan (~1 day) to revert the descope, plus re-running the NFC-01..06 physical verification rows on the Deka reader.

**Option B — Use a non-Magicline identification mechanism.**

- Manual entry: a branded "Mitgliedsnummer eingeben" touch keypad overlay in the kiosk itself that writes the entered number into customer-search. Works without the permission concern (uses the same customer-search field but triggered by human input, not a bulk badge database). Friction: every transaction requires the member to type their ID.
- QR code: if Bee Strong member cards ever gain a QR, a webcam or camera-over-HID reader could feed the same customer-search path. Same permission constraint as badge lookup — still requires member-lookup perms on the staff account, so this is really a hardware change on top of Option A.
- External identity service: stand up a tiny members-directory service the kiosk calls outside of Magicline (e.g. Airtable / Google Sheet with a read-only API key stored in `safeStorage`). Kiosk reads badge → looks up membership → displays member info in a branded overlay → optionally writes the member's name into customer-search for the sales record. Decouples identification from Magicline's permission system at the cost of a new moving part. Likely overkill unless Bee Strong already has a members database it controls.

## Related

- Descope decision: `.planning/MILESTONES.md` → "Post-ship scope adjustment (2026-04-14)" under the v1.0 entry.
- Historical spec: `.planning/phases/04-nfc-input-idle-session-lifecycle/04-CONTEXT.md`, `04-RESEARCH.md`, `04-VERIFICATION.md` (the latter has a DESCOPED banner at the top pointing back to MILESTONES.md).
- Last known-good implementation: `v1.0` git tag (commit `403f860`) — `src/main/badgeInput.js`, `test/badgeInput.test.js`, the customer-search clear in `src/inject/inject.js`, the fragile-selectors customer-search entry, and the attachBadgeInput wiring in `src/main/main.js` + `src/main/magiclineView.js`.
- Quick task that removed it: `260414-eu9` (see `.planning/quick/260414-eu9-descope-nfc-member-badge-identification-/`).

## Not urgent

The kiosk is functional without member identification — members tap, scan or pick products, pay at the card terminal, walk away. Revisit when a concrete use case (membership discount, member-only products, staff wanting per-member sales history at the kiosk level) makes the permission conversation worth having.
