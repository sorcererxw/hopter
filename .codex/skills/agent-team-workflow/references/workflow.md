# Agent Team Workflow Reference

## Purpose

Use this protocol for complex implementation requests that need planning, delegation, QA, browser or Computer Use verification, repair loops, final user acceptance, and post-acceptance documentation.

This is not a product feature. It is an execution standard for coding agents.

## Roles

### Lead agent

The lead agent owns the loop end to end:

1. restore repo context
2. inspect current app/runtime state
3. clarify the requirement into acceptance criteria
4. produce a plan and get user confirmation when the scope is material or ambiguous
5. decompose work into independently owned tasks
6. delegate implementation where the active tool environment allows it
7. launch fresh QA after implementation
8. personally verify changed user-facing behavior through browser or Computer Use tooling
9. run repair loops until acceptance criteria pass or escalation is required
10. ask the user for final acceptance
11. write progress docs only after user acceptance

### Dev subagent

A dev subagent owns one bounded implementation slice with an explicit write scope.

Each dev task must include:

- requirement slice
- allowed files or directories
- files it must avoid
- expected tests or local checks
- evidence it must produce
- instruction that it is not alone in the codebase and must not revert unrelated edits

### QA subagent

A QA subagent starts after dev work finishes. It must be fresh relative to the implementation when possible.

QA owns:

- unit tests
- type checks
- lint checks
- focused regression checks
- browser checks for UI work
- requirement-to-test gap review
- evidence summary

QA should not make code changes unless the lead explicitly turns it into a repair task with a bounded write scope.

### Repair subagent

A repair subagent fixes one confirmed defect or one small cluster of related defects.

Each repair task must include:

- exact failing evidence
- reproduction steps
- expected behavior
- allowed files
- required re-test command

## Workflow

### Phase 0: Restore Context

Before planning or editing, the lead agent reads:

- repo-level instructions such as `AGENTS.md`
- docs index or contributor docs
- active planning docs relevant to the request
- current git status
- current runtime state and logs when live validation is needed

If unrelated modified files exist, record them and avoid touching them unless required by the task.

### Phase 1: Requirement Intake

Turn the user's request into a compact PRD before implementation:

```text
User request:
Acceptance criteria:
Out of scope:
Affected surfaces:
Validation plan:
Open questions:
```

Use browser automation or Computer Use when the current UI state must be inspected. Use it to confirm what the user will see, not as a substitute for reading code and docs.

If acceptance criteria are ambiguous, ask the user before code changes.

### Phase 2: Plan Confirmation

For material work, present a plan and wait for confirmation.

The plan must include:

- task breakdown
- subagent ownership plan
- expected file scopes
- validation commands
- browser or Computer Use verification path
- evidence output path
- risks and rollback notes

Small unambiguous fixes may skip the confirmation gate, but the lead still needs an internal requirement map and validation plan.

### Phase 3: Task Decomposition

Split tasks by ownership, not by wishful parallelism.

Good task boundaries:

- backend service change
- IDL or codegen change
- focused UI component change
- focused validation script change
- docs update after acceptance

Bad task boundaries:

- two agents editing the same component
- one agent changes IDL while another guesses generated types
- QA starts before implementation stabilizes
- repair work without a repro

### Phase 4: Dev Delegation

When the active tool environment supports subagents, the lead may delegate implementation slices.

Use this prompt shape:

```text
You are a dev subagent.

Task:
[one bounded requirement slice]

Write scope:
[allowed files/directories]

Do not touch:
[files/directories to avoid]

Context:
- Read repo instructions first.
- You are not alone in the codebase. Do not revert unrelated edits.

Validation:
[commands to run]

Return:
- files changed
- commands run
- evidence paths
- remaining risks
```

The lead must review returned diffs before starting QA.

### Phase 5: Fresh QA

After dev work completes, start independent QA.

Use this prompt shape:

```text
You are a QA subagent.

Task:
Verify this implemented requirement against the acceptance criteria.

Scope:
[feature/surfaces to test]

Do not change code unless explicitly asked.

Run:
[unit/type/lint/build/runtime checks]

Inspect:
- requirement coverage
- missing tests
- regression risk
- evidence quality

Return:
- pass/fail by acceptance criterion
- commands run
- evidence paths
- defects with repro steps
```

QA must include command-based checks and a test-gap review. For UI changes, QA must include a browser-facing check or clearly explain why it was not possible.

### Phase 6: Lead Browser And Computer Use Verification

The lead agent must personally verify user-facing behavior after QA.

For UI work, use browser automation or Computer Use to exercise the actual feature. Capture screenshots, state files, timeline excerpts, or validation bundle paths.

Do not claim completion from unit tests alone when the user-facing workflow changed.

### Phase 7: Repair Loop

If QA or lead verification finds a defect:

1. classify the defect against the acceptance criteria
2. create a targeted repair task
3. assign a repair subagent or fix locally if delegation would add risk
4. re-run the smallest failing check
5. re-run the relevant broader check
6. repeat browser or Computer Use verification

Stop and escalate if:

- the same defect class fails twice
- three repair loops complete without a clean pass
- the fix needs a scope change not covered by the approved plan
- evidence cannot be produced

### Phase 8: Completion Gate

Before asking the user for final acceptance, produce a requirement-to-evidence matrix:

| Requirement | Status | Evidence |
|---|---|---|
| Criterion 1 | pass/fail | command, bundle path, screenshot, or log excerpt |
| Criterion 2 | pass/fail | command, bundle path, screenshot, or log excerpt |

Every row needs concrete evidence. "Implemented" is not evidence.

### Phase 9: User Acceptance

Notify the user that the PRD requirements are ready for final acceptance.

Include:

- what changed
- how to try it
- evidence paths
- known limitations
- deferred items

Do not write final progress docs yet unless the user approves the result.

### Phase 10: Post-Acceptance Documentation

After user acceptance, update the smallest relevant docs:

- docs index if navigation changes
- operations docs if workflow changes
- planning docs if plan or task state changes
- TODO files for accepted deferrals
- release or handoff notes when the work is milestone-level

Docs should record:

- accepted requirement
- implementation summary
- validation evidence path
- remaining follow-ups

## Done Definition

A complex implementation request is done only when:

- acceptance criteria are explicit
- implementation is complete
- QA has run
- lead browser or Computer Use verification has run when user-facing behavior changed
- every acceptance criterion maps to evidence
- evidence paths are recorded
- user has been asked for final acceptance
- progress docs are updated after acceptance when required
