---
phase: 11-pos-close-immediate-welcome-reset
plan: 03
type: execute
wave: 1
depends_on: []
files_modified:
  - .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md
autonomous: true
requirements: [ADMIN-02]
tags: [docs, context, supersede, phase-09, phase-11]
must_haves:
  truths:
    - "Phase 09 D-06 entry contains an APPENDED supersede note pointing to Phase 11 (2026-04-26)"
    - "The original Phase 09 D-06 text is preserved verbatim (append-only, no rewrite)"
    - "The supersede note cross-references 11-CONTEXT.md and includes the UAT rationale"
  artifacts:
    - path: ".planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md"
      provides: "Phase 09 D-06 entry annotated with Phase 11 supersede note"
      contains: "SUPERSEDED by Phase 11"
  key_links:
    - from: "09-CONTEXT.md D-06 entry"
      to: "11-CONTEXT.md"
      via: "in-text reference at the end of the appended note"
      pattern: "11-CONTEXT.md"
---

<objective>
Append a one-line SUPERSEDED-BY-PHASE-11 annotation to the existing Phase 09 D-06 entry in `.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md`, per Phase 11 D-10. The original D-06 text is NOT modified — the supersede note is purely additive, preserving the audit trail of the original "no mid-checkout interruption" decision and capturing the 2026-04-26 UAT trigger that reversed it.

Purpose: Phase 11 success criterion 7 ("Phase 09 D-06 is updated in `.planning/phases/09-*/09-CONTEXT.md` with a SUPERSEDED-BY-PHASE-11 annotation, plus a one-line rationale"). This plan is the only plan that touches phase-09 docs, isolating the docs change from the code-bearing plans (11-01 + 11-02).

Output: One file edit. ~3 lines added (blank line + supersede note + closing paragraph break) to a single docs file. No code changes, no test changes.
</objective>

<execution_context>
@$HOME/.claude/get-shit-done/workflows/execute-plan.md
@$HOME/.claude/get-shit-done/templates/summary.md
</execution_context>

<context>
@.planning/STATE.md
@.planning/ROADMAP.md
@.planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md
@.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md
@./CLAUDE.md

<interfaces>
<!-- Current Phase 09 D-06 entry (verified 2026-04-26 via grep). Single
     bullet line at line 32 of 09-CONTEXT.md. -->

From .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md (line 32, current):
```
- **D-06:** The closed state takes effect after the current session ends. If a member session is active when admin closes POS, the active Magicline session continues undisturbed. When idle timeout fires and the welcome layer returns, it shows the closed message. No mid-checkout interruption.
```

The supersede note text is fully decision-locked in 11-CONTEXT.md D-10 — copy verbatim. Insertion strategy: APPEND (D-10 explicitly says "Original text is NOT modified"). The note becomes a continuation of the same bullet, separated by a blank line + blockquote marker so markdown rendering preserves both as part of the D-06 history.
</interfaces>
</context>

<tasks>

<task type="auto">
  <name>Task 1: Append SUPERSEDED-BY-PHASE-11 note to Phase 09 D-06 entry</name>
  <read_first>
    - .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md (FULL file — confirm D-06 is at line 32 and identify exactly where the note should be inserted; confirm the surrounding markdown structure: bullet list within `### Welcome Closed-State Design` heading)
    - .planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md §D-10 (canonical supersede-note text — copy verbatim)
    - .planning/phases/11-pos-close-immediate-welcome-reset/11-CONTEXT.md (full — to confirm the cross-reference target file path is correct)
  </read_first>
  <files>.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md</files>
  <action>
Edit `.planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` to APPEND the Phase 11 supersede annotation immediately after the existing D-06 bullet line.

**Locate this exact line (currently line 32):**
```
- **D-06:** The closed state takes effect after the current session ends. If a member session is active when admin closes POS, the active Magicline session continues undisturbed. When idle timeout fires and the welcome layer returns, it shows the closed message. No mid-checkout interruption.
```

**Replace it with the SAME line followed by a blank line and the supersede blockquote:**

```
- **D-06:** The closed state takes effect after the current session ends. If a member session is active when admin closes POS, the active Magicline session continues undisturbed. When idle timeout fires and the welcome layer returns, it shows the closed message. No mid-checkout interruption.

  > **SUPERSEDED by Phase 11 (2026-04-26):** D-06 reversed — closing POS now immediately triggers `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` regardless of the layer foregrounded when admin opens the menu. Rationale: UAT on 2026-04-26 surfaced that admins tapping the welcome layer to reach the menu (so they could close POS) land on the cash register after dismiss, contradicting the admin's mental model of "closing the POS = closing the kiosk." See `11-CONTEXT.md`.
```

**Critical constraints (D-10 verbatim):**
- The original D-06 bullet text is preserved BYTE-FOR-BYTE. Do NOT rewrite, paraphrase, shorten, or restructure the original sentence. Confirm by diff: only ADDED lines, zero MODIFIED lines.
- The blockquote MUST be indented with TWO SPACES (`  > **SUPERSEDED...`) so it renders as a continuation of the D-06 bullet in markdown (rather than as a top-level blockquote that breaks list structure).
- The blank line BETWEEN the existing bullet and the new blockquote is REQUIRED — without it, common markdown renderers (GitHub, VS Code preview) merge the blockquote into the bullet text.
- The cross-reference path `11-CONTEXT.md` is bare (no leading `./` and no leading `/.planning/...`). The reader is expected to be inside the phases directory tree; bare-name cross-refs match the existing 09-CONTEXT.md style (verify by grepping for any other phase-name file references in 09-CONTEXT.md before committing).
- The German quotation marks inside "closing the POS = closing the kiosk." are STRAIGHT ASCII double quotes (`"..."`), not curly Unicode quotes. Match the 11-CONTEXT.md D-10 text byte-for-byte.
- Do NOT modify D-01..D-05, D-07..D-15, or any other section of 09-CONTEXT.md. Surgical edit to the D-06 bullet only.
- Do NOT add a new "## Phase 11 Reversal" or similar section — D-10 is explicit that the supersede is a one-line append, NOT a new section.
- Do NOT modify `09-DECISION-LOG.md` (does not exist in this project's docs structure for phase 09 — verified by ls of 09-pos-open-close-toggle-with-update-window-gating/), `09-01-PLAN.md`, `09-02-PLAN.md`, or any other phase 09 artifact. The D-10 instruction targets 09-CONTEXT.md only.
  </action>
  <verify>
    <automated>grep -q "SUPERSEDED by Phase 11" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md &amp;&amp; grep -q "No mid-checkout interruption" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md &amp;&amp; grep -q "11-CONTEXT.md" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md</automated>
  </verify>
  <acceptance_criteria>
    - File contains exact substring `SUPERSEDED by Phase 11 (2026-04-26)`
    - File contains exact substring `No mid-checkout interruption.` (original D-06 text preserved verbatim)
    - File contains exact substring `sessionReset.hardReset({reason:'pos-closed', mode:'welcome'})` inside the supersede note
    - File contains exact substring `11-CONTEXT.md` (cross-reference)
    - File contains exact substring `closing the POS = closing the kiosk` (rationale phrase)
    - The supersede blockquote line is indented with TWO SPACES so it nests under the D-06 bullet (verify by reading the line with `grep -n "SUPERSEDED" 09-CONTEXT.md` and confirming column 3 is `>`)
    - `grep -c "D-06" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` returns the SAME count as before this task (we did NOT add a duplicate `**D-06:**` heading; the supersede note is a blockquote continuation, not a second decision)
    - `grep -c "**D-05:**" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` returns 1 (D-05 unchanged)
    - `grep -c "**D-07:**" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` returns 1 (D-07 unchanged)
    - File line count delta: +2 to +3 (one blank line + one blockquote line, possibly a trailing blank)
    - Diff shows ONLY additions in the D-06 region (D-01..D-05 and D-07..D-15 untouched)
    - `09-DECISION-LOG.md` does NOT exist in the phase 09 directory and is NOT created by this task
  </acceptance_criteria>
  <done>
    Phase 09 D-06 entry now carries a SUPERSEDED-BY-PHASE-11 blockquote note pointing to Phase 11 with the UAT rationale. Original D-06 text is preserved byte-for-byte. No other section of 09-CONTEXT.md is modified. No other phase 09 artifact is touched.
  </done>
</task>

</tasks>

<threat_model>
## Trust Boundaries

| Boundary | Description |
|----------|-------------|
| (none) | This plan is a docs-only edit to a planning artifact in `.planning/phases/`. No code, no IPC, no runtime surface. Markdown edits cannot introduce attack surface. |

## STRIDE Threat Register

| Threat ID | Category | Component | Disposition | Mitigation Plan |
|-----------|----------|-----------|-------------|-----------------|
| (none) | — | — | accept | Docs-only edit to planning context. No threat surface. |

Severity: LOW (none). The plan modifies only a markdown context file under `.planning/`, which has no runtime presence.
</threat_model>

<verification>
- `grep "SUPERSEDED by Phase 11" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` matches exactly 1 line
- `grep "No mid-checkout interruption" .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` matches exactly 1 line (original text preserved)
- `wc -l .planning/phases/09-pos-open-close-toggle-with-update-window-gating/09-CONTEXT.md` shows file grew by 2-3 lines vs pre-edit
- No other phase 09 file modified
</verification>

<success_criteria>
- Phase 11 success criterion 7 satisfied: Phase 09 D-06 carries a SUPERSEDED-BY-PHASE-11 annotation with a one-line UAT rationale
- D-10 honored: append-only edit; original D-06 text byte-for-byte preserved; cross-reference to 11-CONTEXT.md present
- Markdown rendering: the blockquote nests visually under the D-06 bullet (two-space indent) rather than breaking out of the list
- Audit trail: a future reader can see both the original "no mid-checkout interruption" decision AND the Phase 11 reversal without any rewrites of past context
</success_criteria>

<output>
After completion, create `.planning/phases/11-pos-close-immediate-welcome-reset/11-03-SUMMARY.md` documenting:
- The exact text appended (verbatim block)
- Confirmation that the original D-06 line is byte-identical pre/post-edit (paste both)
- Confirmation that no other section of 09-CONTEXT.md was modified
- Confirmation that no other phase 09 artifact was touched
</output>
</content>
</invoke>