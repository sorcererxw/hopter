# Agent Team Workflow

## Purpose

This document defines the project-local agent execution protocol for complex implementation requests.

Use it when a request is large enough that one agent should coordinate requirement confirmation, planning, delegated implementation, independent QA, browser/computer-use verification, repair loops, final user acceptance, and post-acceptance documentation.

This is an operating standard for agents working on `hopter`. It is not a product feature and must not turn `hopter` into a planner/orchestrator that replaces Codex.

## Scope

Use this workflow for:

- new product behavior
- multi-file UI/backend/IDL changes
- changes that need browser verification
- changes that need independent QA beyond the implementer
- PRD-style work with multiple acceptance criteria

Do not use this workflow for:

- one-line fixes
- read-only questions
- mechanical formatting
- work where the user explicitly asks for no delegation or no code changes

## Non-negotiables

- Codex remains the source of truth for session content, history, approvals, and artifacts.
- `hopter` owns only projects, lightweight session references, auth state, validation evidence, and UI-facing control-plane state.
- Browser clients never talk to Codex directly.
- The lead agent owns the requirement map and final evidence. Subagents can produce evidence, but the lead must verify and consolidate it.
- No work is complete without requirement-to-evidence mapping.
- No final progress documentation is written until the user accepts the finished work.
- Existing user edits must not be reverted or overwritten.

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
8. personally verify the changed feature through browser or computer-use tooling
9. run repair loops until acceptance criteria pass or escalation is required
10. ask the user for final acceptance
11. write progress docs only after user acceptance

### Dev subagent

A dev subagent owns a bounded implementation slice with an explicit write scope.

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

- `AGENTS.md`
- `docs/README.md`
- `docs/operations/DEV_LOOP.md`
- active planning docs relevant to the request
- current git status
- current dev-loop state from `~/.hopter/devlogs/codeshell/state.json` when live validation is needed
- current timeline logs from `~/.hopter/devlogs/codeshell/timeline.jsonl` when live validation is needed

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

Use browser automation or Computer Use MCP when the current UI state must be inspected. Use it to confirm what the user will see, not as a substitute for reading code and docs.

If acceptance criteria are ambiguous, ask the user before code changes.

### Phase 2: Plan Confirmation

For material work, present a plan and wait for confirmation.

The plan must include:

- task breakdown
- subagent ownership plan
- expected file scopes
- validation commands
- browser/computer-use verification path
- evidence output path
- risks and rollback notes

Small unambiguous fixes may skip the confirmation gate, but the lead still needs an internal requirement map and validation plan.

### Phase 3: Task Decomposition

Split tasks by ownership, not by wishful parallelism.

Good task boundaries:

- backend service change
- IDL/codegen change
- focused UI component change
- focused validation script change
- docs update after acceptance

Bad task boundaries:

- two agents editing the same component
- one agent changes IDL while another guesses generated types
- QA starts before implementation stabilizes
- repair work without a repro

### Phase 4: Dev Delegation

When the active tool environment supports subagents, the lead may delegate implementation slices in parallel.

Use this prompt shape:

```text
You are a dev subagent for hopter.

Task:
[one bounded requirement slice]

Write scope:
[allowed files/directories]

Do not touch:
[files/directories to avoid]

Context:
- Read AGENTS.md first.
- Follow docs/operations/AGENT_TEAM_WORKFLOW.md.
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
You are a QA subagent for hopter.

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

QA must include both command-based checks and a test-gap review. For UI changes, QA must include a browser-facing check or clearly explain why it was not possible.

### Phase 6: Lead Browser And Computer-Use Verification

The lead agent must personally verify user-facing behavior after QA.

Preferred live loop:

```bash
make reset
make dev
make verify-live
```

Then inspect:

```bash
cat ~/.hopter/devlogs/codeshell/state.json
tail -n 80 ~/.hopter/devlogs/codeshell/timeline.jsonl
```

For UI work, use browser automation or Computer Use MCP to exercise the actual feature. Capture screenshots, state files, timeline excerpts, or validation bundle paths under `storage/artifacts/validation/`.

Do not claim completion from unit tests alone when the user-facing workflow changed.

### Phase 7: Repair Loop

If QA or lead verification finds a defect:

1. classify the defect against the acceptance criteria
2. create a targeted repair task
3. assign a repair subagent or fix locally if delegation would add risk
4. re-run the smallest failing check
5. re-run the relevant broader check
6. repeat browser/computer-use verification

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
- any deferred items

Do not write final progress docs yet unless the user approves the result.

### Phase 10: Post-Acceptance Documentation

After user acceptance, update the smallest relevant docs:

- `docs/README.md` if navigation changes
- `docs/operations/*.md` if workflow changes
- `docs/planning/*.md` if plan/task state changes
- `TODOS.md` for accepted deferrals
- release or handoff notes when the work is milestone-level

Docs should record:

- accepted requirement
- implementation summary
- validation evidence path
- remaining follow-ups

## Evidence Contract

Use `storage/artifacts/validation/<run-id>/` for validation bundles.

Each meaningful run should record:

- requirement map
- commands run
- stdout/stderr summaries
- browser screenshots when relevant
- dev-loop state when relevant
- timeline excerpts when relevant
- pass/fail summary

For live-stack work, the file-based dev loop is authoritative. Terminal memory is not enough.

## Subagent Safety Rules

- Give every subagent a bounded write scope.
- Prefer disjoint write scopes for parallel work.
- Tell every subagent it is not alone in the codebase.
- Do not ask two subagents to fix the same file at the same time.
- Do not let QA mutate code without a new bounded repair assignment.
- Do not delegate the immediate blocking task if the lead is waiting on it to proceed.
- Consolidate all subagent evidence before reporting status.

## Self-Loop Limits

The loop is autonomous, not infinite.

Allowed loop:

```text
dev -> QA -> lead browser verification -> repair -> QA -> lead browser verification
```

Escalate instead of looping when:

- the same failure repeats
- root cause is unknown after investigation
- external service behavior is unstable
- validation tooling itself is broken
- the approved plan no longer matches the necessary fix

## Done Definition

A complex implementation request is done only when:

- acceptance criteria are explicit
- implementation is complete
- QA has run
- lead browser/computer-use verification has run when user-facing behavior changed
- every acceptance criterion maps to evidence
- evidence paths are recorded
- user has been asked for final acceptance
- progress docs are updated after acceptance when required
