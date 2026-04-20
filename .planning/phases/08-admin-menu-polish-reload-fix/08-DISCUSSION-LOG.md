# Phase 08: Admin Menu Polish & Reload Fix - Discussion Log

> **Audit trail only.** Do not use as input to planning, research, or execution agents.
> Decisions are captured in CONTEXT.md — this log preserves the alternatives considered.

**Date:** 2026-04-20
**Phase:** 08-admin-menu-polish-reload-fix
**Areas discussed:** Close button behavior, Kasse nachladen fix, Credentials re-entry mode

---

## Close Button Behavior

### Placement

| Option | Description | Selected |
|--------|-------------|----------|
| Top-right X button | Discreet X above diagnostic header, >=44x44 px, standard dismiss pattern | ✓ |
| Bottom Zuruck button | Full-width button at bottom of stack, below Beenden | |

**User's choice:** Top-right X button
**Notes:** Universally understood on touchscreens, matches the todo's suggestion.

### Ctrl+Shift+F12 Toggle

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, toggle | Second press routes through admin:close | ✓ |
| No, open only | Hotkey always opens PIN modal, close only via X/Esc | |

**User's choice:** Yes, toggle
**Notes:** None

### Esc Key Handling

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, Esc closes root menu | Host-side keydown listener, only root menu, no cascade to nested screens | ✓ |
| No Esc handling | Only X button closes, Esc swallowed by lockdown | |

**User's choice:** Yes, Esc closes root menu
**Notes:** None

### Lockout Persistence on Close

| Option | Description | Selected |
|--------|-------------|----------|
| Persist + resume on reopen | Lockout countdown resumes where left off on admin reopen | ✓ |
| Persist but start fresh UI | Lockout persists but PIN keypad shown first, swaps to countdown if locked | |

**User's choice:** Persist + resume on reopen
**Notes:** None

---

## Kasse Nachladen Fix

### Welcome-State Behavior

| Option | Description | Selected |
|--------|-------------|----------|
| Start fresh session | Trigger welcome-tap flow — create view, authFlow, splash, auto-select | ✓ |
| Return to welcome silently | Close admin, show welcome layer, no session start | |

**User's choice:** Start fresh session (Layer 2)
**Notes:** Admin gets a working session, matches the todo's recommendation.

### Menu State During Fresh Session

| Option | Description | Selected |
|--------|-------------|----------|
| Close menu, show splash | Admin menu hides immediately, splash appears, normal flow | ✓ |
| Keep menu open over splash | Admin menu stays visible while session loads behind it | |

**User's choice:** Close menu, show splash
**Notes:** Clean state transition.

---

## Credentials Re-Entry Mode

### PIN Change Path

| Option | Description | Selected |
|--------|-------------|----------|
| Out of scope for v1.1 | Only fix re-entry mode, PIN change requires reinstall | |
| Add PIN andern button | New admin button with current-PIN re-verification | ✓ |

**User's choice:** Add PIN andern button
**Notes:** User chose to expand scope beyond REQUIREMENTS.md's explicit out-of-scope note.

### PIN Re-Verification

| Option | Description | Selected |
|--------|-------------|----------|
| Yes, require current PIN | Defense in depth, re-prove current PIN before allowing change | ✓ |
| No, skip re-verification | Admin already proved PIN to enter menu | |

**User's choice:** Yes, require current PIN
**Notes:** None

### Button Placement

| Option | Description | Selected |
|--------|-------------|----------|
| After Anmeldedaten | Between credentials and auto-update config, groups credential-adjacent actions | ✓ |
| Before Beenden | Second-to-last, with consequential actions | |

**User's choice:** After Anmeldedaten
**Notes:** Follows Phase 5 D-02 safe-to-destructive ordering.

---

## Claude's Discretion

- X button CSS styling (icon glyph, hover/pressed states)
- PIN change overlay implementation (reuse credentials overlay or new div)
- German error messages for PIN validation failures
- `magiclineView.exists()` export style

## Deferred Ideas

- POS open/close toggle (Phase 09 ADMIN-02) — user mentioned during area selection, redirected to existing roadmap scope
