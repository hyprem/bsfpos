---
created: 2026-04-14T11:32:00.000Z
title: GSD workflow note — gsd-new-milestone phases clear is destructive without prior complete-milestone
area: tooling
files: []
---

## Problem

Hit during the v1.1 milestone start on 2026-04-14: the `/gsd-new-milestone` workflow's Step 6 ("Cleanup and Commit") runs:

```bash
node "$HOME/.claude/get-shit-done/bin/gsd-tools.cjs" phases clear --confirm
```

This **deletes** all files in `.planning/phases/` from the working tree. The intent is to clear LEFTOVER phase directories from the previous milestone — the assumption being that the previous milestone has already been formally completed via `/gsd-complete-milestone`, which (presumably) archives the phase directories to a `milestones/` subdirectory before the new milestone starts.

**The bug:** if the previous milestone was archived MANUALLY (e.g., reconciliation commit + tag without running the full `/gsd-complete-milestone` workflow), the phase directories still live under `.planning/phases/` and `phases clear --confirm` deletes them outright. There is no warning, no diff preview, and no archive fallback. We lost ~100 files (all the v1.0 phase CONTEXT/PLAN/SUMMARY/RESEARCH/VERIFICATION/UAT/REVIEW docs across phases 1–6) before catching it via `git status` and restoring with `git restore .planning/phases/`.

The deleted files were CRUCIAL: the runbook (`docs/runbook/v1.0-KIOSK-VISIT.md`) explicitly references several of them (`01-VERIFICATION.md`, `04-VERIFICATION.md`), and the v1.0 archive cross-references many more. Their loss would have silently broken the next-kiosk-visit field guide.

## Solution

Three layers of fix, ordered by minimum-viable to ideal:

### Layer 1 — `phases clear` should refuse to delete unarchived phases (defensive)

The tool currently deletes any phase directories it finds. It should instead:

1. Check whether the previous milestone has a corresponding `.planning/milestones/v[X.Y]-ROADMAP.md` archive.
2. For each phase directory it's about to delete, check whether that phase's docs are referenced anywhere from the milestone archive (a simple grep is enough).
3. If references exist OR no milestone archive exists, **refuse to clear** with an error: *"Phase 01 (locked-down-shell-os-hardening) is referenced from milestones/v1.0-ROADMAP.md and was not archived. Run /gsd-complete-milestone v1.0 first, OR pass --force to ignore."*

### Layer 2 — `/gsd-new-milestone` should detect the unarchived state

Before running `phases clear`, the workflow should:

1. Read `MILESTONES.md` to find the latest shipped milestone version.
2. Check whether `.planning/milestones/v[X.Y]-ROADMAP.md` exists AND whether the phase directories' files are mentioned in any milestone-archive cross-references (heuristic: grep for the phase dir paths in `milestones/`).
3. If unarchived: STOP and tell the user *"Previous milestone v[X.Y] does not appear to be formally archived. Phase directories still contain unreplicated files. Run /gsd-complete-milestone v[X.Y] first, then re-run /gsd-new-milestone."*

### Layer 3 — `phases clear` should ARCHIVE rather than delete

The cleanest fix: make `phases clear` move the phase directories to `.planning/phases-archive/v[X.Y]/` rather than deleting them outright. Then references survive, the working tree is clean for the new milestone, and recovery is a `git mv` away. The opt-in `--reset-phase-numbers` flag could still allow real deletion if the user explicitly wants to reuse phase numbers from `01-`.

## Recovery from the incident

In the v1.1 start session, the deletions were not yet committed, so `git restore .planning/phases/` brought everything back. The c60d0be commit ("docs: start milestone v1.1 Field-Operations Polish") only contained PROJECT.md + STATE.md changes — it does NOT include the deletions. v1.0 phase docs are intact.

Going forward in this session: v1.1 phase numbering will CONTINUE from 7 (default behavior, no `--reset-phase-numbers`), so the new v1.1 phase directories (07-, 08-, ...) will coexist with the v1.0 phase directories (01- through 06-) in `.planning/phases/`. Mixed-milestone state in the directory is acceptable until a future cleanup.

## Practical impact

This is a **GSD workflow / tooling bug**, not a project bug. Captured here so it doesn't get lost — should be filed against the GSD framework upstream (or fixed locally in `~/.claude/get-shit-done/bin/gsd-tools.cjs` if the workflow tooling is editable). Not v1.1 scope; this is meta-tooling infrastructure.

**Severity:** medium-high. Silently destroys planning artifacts when the user uses an unconventional but reasonable archive path (manual reconciliation instead of full `/gsd-complete-milestone`).
