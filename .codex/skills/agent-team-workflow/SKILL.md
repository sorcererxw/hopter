---
name: agent-team-workflow
description: "Run a lead-agent execution workflow for complex coding requests: requirement intake, PRD/acceptance criteria, plan confirmation, dev subagent delegation, fresh QA subagent checks, browser or Computer Use verification, repair loops, final user acceptance, and post-acceptance documentation. Use when the user mentions agent team, subagents, QA agent, repair loop, self-loop, PRD then plan, Computer Use verification, final acceptance, 自循环, 验收, or explicitly invokes $agent-team-workflow."
---

# Agent Team Workflow

## Start

Use this skill to turn a complex coding request into a controlled execution loop:

```text
intake -> plan confirmation -> dev work -> fresh QA -> lead verification -> repair loop -> final acceptance -> docs
```

This skill is an operating protocol for this repo. It does not replace `hopter`'s architecture, task system, or Codex source-of-truth boundary.

## Load The Protocol

1. Read `AGENTS.md`.
2. Read `docs/operations/AGENT_TEAM_WORKFLOW.md` and follow it as the project-specific authority.
3. If the project-specific doc is missing, read `references/workflow.md` from this skill and follow the fallback protocol.
4. Read any deeper `AGENTS.md` before editing files under that scope.

Project instructions override this skill when they are more specific. System and developer instructions override both.

## Required Lead Behavior

Act as the lead agent.

Before code changes:

1. restore repo context
2. inspect current git status
3. identify unrelated user edits and avoid them
4. turn the user request into acceptance criteria
5. define out-of-scope items
6. produce a validation plan
7. present a plan for confirmation when the work is material or ambiguous

After implementation:

1. run fresh QA
2. personally verify user-facing behavior with browser automation or Computer Use when relevant
3. run targeted repair loops for defects
4. produce a requirement-to-evidence matrix
5. ask the user for final acceptance
6. update progress docs only after acceptance

## Delegation Rule

Use subagents only when the active environment permits it and the request or this skill invocation clearly authorizes an agent-team workflow.

Each subagent must get:

- one bounded task
- explicit write scope
- files or directories to avoid
- required validation commands
- evidence expectations
- instruction not to revert unrelated edits

Do not delegate the immediate blocking task if the lead needs it before taking the next step.

## QA Rule

QA must be fresh relative to implementation when possible.

QA owns:

- unit tests
- type checks
- lint checks
- build checks
- browser checks for UI work
- requirement-to-test gap review

QA should not mutate code unless the lead creates a new bounded repair assignment.

## Evidence Rule

Do not claim completion from implementation alone.

Every acceptance criterion needs concrete evidence:

- command output summary
- test or validation bundle path
- screenshot path
- browser verification note
- runtime log excerpt
- state file evidence

For `hopter`, prefer evidence under `storage/artifacts/validation/<run-id>/`.

## Repair Rule

If QA or browser verification fails:

1. classify the defect against acceptance criteria
2. assign a targeted repair or fix locally
3. rerun the smallest failing check
4. rerun the broader relevant check
5. repeat lead browser verification when user-facing behavior changed

Escalate instead of looping forever if the same failure repeats, root cause remains unknown, validation tooling is broken, or the approved plan no longer matches the necessary fix.

## Final Response Shape

Use this shape when the workflow reaches user acceptance:

```text
Status:
What changed:
How to try it:
Requirement evidence:
Known limits:
Deferred items:
Needs your acceptance:
```

After the user accepts, write the smallest relevant progress documentation and record the evidence path.
