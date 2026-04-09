# AUTH-06 — Dedicated Magicline Staff Account (Runbook)

**Requirement:** The kiosk uses a dedicated Magicline staff account with the minimum
permissions needed for cash-register operation.

**Why separate:** if the kiosk credentials are ever exfiltrated (RDP misuse, stolen
terminal, etc.), the blast radius is limited to cash-register operations only. A
personal staff account would grant access to member data, billing, reporting, and
configuration.

**Setup checklist (one-time, performed by gym management before first install):**

1. Log in to Magicline admin as an account with user-management permissions.
2. Create a new staff user named **"BSK Kiosk Terminal"** (or similar).
3. Assign a role with ONLY these permissions:
   - Cash register operation (read products, create sales, scan customer by NFC)
   - NO access to: member management, billing, reporting, settings, other staff users
4. Generate a strong random password (16+ chars).
5. Enter the credentials into the kiosk on first run via the Bee Strong POS credentials
   overlay.
6. Store the password separately in the gym's password manager (for admin-menu recovery).
7. Rotate the password annually or whenever a staff member with access to the kiosk
   leaves.

**Verification:**

- Log into Magicline as the BSK Kiosk Terminal account from a separate browser. Confirm
  the ONLY visible area is the cash register. If settings, reporting, or member management
  are visible, the role is too broad — fix in Magicline admin and re-verify.

**This requirement has no code to implement in Phase 3.** The kiosk does not know or care
which Magicline account it is using — it just stores whatever credentials the operator
enters. This file exists so the acceptance review can check AUTH-06 off as "documented
runbook item, operator-executed."
