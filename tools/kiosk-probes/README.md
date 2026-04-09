# Phase 3 Kiosk Probes

Two-probe hardware verification for **Plan 03-09** (Phase 3 auto-login state
machine). Copy this folder onto a USB drive, plug it into the POS terminal,
run the probes, copy the results file back.

## What the probes measure

**Probe C — `crypto.scryptSync` median runtime at N=16384**
Decides whether `src/main/adminPin.js` `SCRYPT_PARAMS.N` stays at 16384 or
gets retuned:

| Median ms | Chosen N  | Reason                                       |
|-----------|-----------|----------------------------------------------|
| 50–250    | **16384** | Default, in the target window                |
| < 50      | **32768** | CPU is faster than expected — crank up cost  |
| > 250     | **8192**  | CPU is slower than expected — back off cost  |

**Probe A — TabTip touch keyboard**
Confirms the manual-launch fallback path (which powers the "Tastatur" buttons
next to text inputs in the credentials overlay). The script handles the
manual-launch half. The auto-invoke check is a human visual step.

## Prerequisites on the POS terminal

1. **Node.js LTS** must be installed on the POS terminal.
   Download from <https://nodejs.org> — default installer options are fine.
   It can be uninstalled after the probes are done.
2. Ideally boot into the **Phase 1 Assigned Access kiosk user**.
   If Assigned Access locks you to a single app, a regular user account is
   an acceptable first-pass proxy — note which one you tested under.

## How to run

1. Copy the entire `tools/kiosk-probes/` folder onto a USB drive.
2. Plug the USB drive into the POS terminal and open the folder.
3. **Double-click `run-probes.cmd`.**
4. A console window will open, check for Node.js, run both probes, and
   pause at the end.
5. A results file `phase3-kiosk-probes-results.txt` will be written next
   to the script.
6. **Do the two human-observation steps** the script prints at the end:
   - Did TabTip manually launch when the script triggered it?
   - Does TabTip auto-pop when you tap a text input with your finger?
7. Copy `phase3-kiosk-probes-results.txt` back to the dev machine
   (any way — USB, RDP clipboard, email to yourself).
8. Paste the results file contents into the dev chat, along with your
   two TabTip observations and which Windows user you tested under.

## Expected output

A `phase3-kiosk-probes-results.txt` file like:

```json
{
  "phase": "03",
  "plan": "03-09",
  "date": "2026-MM-DDTHH:MM:SS.000Z",
  "system": {
    "hostname": "POS-KIOSK",
    "os": "Windows_NT 10.0.22631 x64",
    "node": "v20.18.0",
    "cpu": "Intel(R) Celeron(R) N4020 CPU @ 1.10GHz",
    "ram_gb": 4,
    "current_user": "kiosk-user"
  },
  "probe_c_scrypt": {
    "samples_ms": [142.3, 138.7, 141.0, 139.8, 140.5],
    "sorted_ms": [138.7, 139.8, 140.5, 141.0, 142.3],
    "median_ms": 140.5,
    "chosen_N": 16384,
    "rationale": "median inside 50-250 ms target window — keep default"
  },
  "probe_a_tabtip": {
    "found_path": "C:\\Program Files\\Common Files\\microsoft shared\\ink\\TabTip.exe",
    "manual_launch_attempted": true,
    "manual_launch_observed": "(fill in manually — YES/NO)",
    "auto_invoke_observed": "(fill in manually — YES/NO)",
    "tested_under_user_kind": "(fill in manually — assigned-access / regular)"
  }
}
```

## Cleanup afterward

1. Delete `tools/kiosk-probes/` from the USB drive (or just leave it —
   nothing in it is sensitive).
2. If desired, uninstall Node.js from the POS terminal via "Add or remove
   programs".
3. Nothing else on the system has been modified.

## Notes

- The script is read-only with respect to the kiosk: it measures scrypt
  runtime and launches an OS-built-in executable. It does not install
  anything, write to any system directories, or require admin privileges.
- Output file is written beside the script in whatever folder you ran it
  from (your USB drive).
- Safe to run multiple times — the results file is overwritten each run.
