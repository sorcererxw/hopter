# Validation Program v1

## Goal

Define how the agent must verify that the product actually satisfies the PRD before claiming completion.

This is not just a test plan.
It is a release gate and execution loop.

The core rule is:

**The agent may not conclude "done" based only on implementation status.**

It must prove:

1. the implemented behavior matches PRD intent
2. the critical user journeys work
3. degraded and failure states are honest
4. evidence exists for that claim

Companion file:

- `docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md` is the initial requirement-to-evidence matrix for v1

## Why this is necessary

For this product, a naive "tests passed" signal is not enough.

The product can still fail the PRD even if code compiles:

- approval flow can be confusing
- reconnect can silently lie
- session state can look healthy when live attachment is gone
- mobile UX can be technically present but operationally useless
- artifacts can exist in storage but not be inspectable enough for decisions

So the validation program must connect:

```text
PRD intent -> acceptance criteria -> automated checks -> manual evidence -> release decision
```

## Source of Truth Hierarchy

When deciding whether a feature is complete, the agent should evaluate in this order:

1. product intent and wedge from `docs/product/DESIGN_DOC.md`
2. communication and interaction rules from `docs/specs/COMMUNICATION_AND_UX_SPEC.md`
3. engineering contract from `docs/specs/ENGINEERING_SPEC_V1.md`
4. milestone and ticket acceptance from `docs/planning/TASK_BREAKDOWN_V1.md`
5. local code and tests

This avoids a common failure mode where code matches a ticket but misses the product.

## Validation Levels

The agent should validate at four levels.

## Level 1: Contract validation

Question:

- did we implement the declared API, event, and schema contracts?

Examples:

- API route exists and shape matches spec
- session status enum is respected
- artifact fetch routes exist
- websocket event types are emitted as documented

Evidence:

- unit and integration tests
- contract fixtures
- schema checks

For platform-sensitive subsystems, validation should target the gateway-owned contract rather than the underlying library directly.

Example:

- validate `TerminalDriver` behavior
- do not treat "library claims cross-platform support" as sufficient evidence

## Level 2: Workflow validation

Question:

- can a user actually complete the PRD-critical flows?

Critical flows:

1. install gateway and detect Codex
2. add a repo as project
3. create a session
4. inspect session remotely
5. approve or reply from another device context
6. reconnect after disconnect
7. recover after gateway restart

Evidence:

- E2E runs
- browser screenshots
- recorded state transitions
- artifact outputs

## Level 3: UX validation

Question:

- does the interface support the intended remote jobs without forcing IDE-like behavior?

Checks:

- session page emphasizes status, summary, attention, artifacts
- terminal does not dominate layout
- mobile session page keeps approve/reject/reply/interrupt reachable
- artifact-first UX is preserved
- degraded state language is explicit

Evidence:

- desktop and mobile screenshots
- viewport-specific checks
- DOM assertions

## Level 4: Truthfulness validation

Question:

- when the system is uncertain or broken, does it remain honest?

Checks:

- lost live attachment becomes `degraded`
- stale browser view cannot submit invalid actions silently
- missing artifacts show partial failure, not fake success
- missing/incompatible Codex is explained clearly

Evidence:

- failure-mode integration tests
- forced degraded-state simulations
- screenshots of failure UI

## PRD Acceptance Matrix

Every milestone should map to a small PRD acceptance matrix.

Each row should include:

- requirement id
- source doc
- statement of expected behavior
- validation method
- evidence location
- pass/fail

Suggested format:

| Req ID | Source | Requirement | Validation | Evidence | Status |
|---|---|---|---|---|---|
| PRD-01 | DESIGN_DOC | User can remotely inspect a running session from phone | E2E + mobile screenshot | `artifacts/validation/prd-01/` | Pass |

## Validation Artifacts

The agent should produce a structured validation bundle, not just console output.

Suggested storage layout:

```text
/storage/artifacts/validation/
  /run_{timestamp}/
    report.json
    summary.md
    screenshots/
    logs/
    traces/
```

Minimum contents:

- machine-readable result summary
- human-readable validation summary
- screenshots for key pages
- logs for failed checks
- links or references to generated artifacts

## Validation artifact retention

Retention should be guided by one principle:

- keep enough historical validation evidence for the harness to evolve reliably

This means v1 should avoid a hard-coded retention number in the product spec.
Retention policy can be implementation-defined as long as it preserves recent, comparable evidence for ongoing harness improvement.

## Required Validation Modes

## 1. Pre-merge self-check

Run after implementation of a ticket or milestone.

Should answer:

- did I break contracts?
- do the key flows still work?

Minimum:

- typecheck
- unit tests
- targeted integration tests

## 2. Milestone validation

Run when a milestone is believed complete.

Should answer:

- does this milestone satisfy its acceptance criteria?
- can the PRD-critical flows that depend on it actually run?

Minimum:

- contract tests
- milestone E2E flow
- screenshots for changed UX

## 3. Release-candidate validation

Run before declaring alpha-ready.

Should answer:

- does the product satisfy the v1 promise, not just the latest diff?

Minimum:

- full critical-flow suite
- mobile and desktop verification
- degraded-state verification
- validation bundle generated

## Required Check Categories

The final validation program should include these categories.

## A. Static checks

- typecheck
- lint
- schema validation
- route registration sanity

## B. Contract tests

- API response shapes
- websocket event shapes
- in-memory repository behavior checks
- status transition correctness

## C. Integration tests

- gateway boot with config
- Codex detection and compatibility
- session create / attach / interrupt
- artifact registration and fetch
- auth cookie lifecycle

## D. End-to-end flows

- login
- create project
- create session
- see summary
- handle approval
- inspect artifact
- recover from reconnect

## E. Failure-mode tests

- Codex missing
- Codex incompatible
- browser reconnect
- gateway restart
- artifact missing
- stale action conflict

## F. UX checks

- mobile session layout
- desktop session layout
- action priority ordering
- degraded-state messaging

## Agent Self-Verification Loop

The implementation agent should follow this loop:

1. implement a scoped change
2. run the smallest relevant validation set
3. collect evidence
4. compare evidence against PRD acceptance criteria
5. either:
   - mark requirement as proven
   - or reopen the task and continue iterating

The loop should not end at "tests green."
It ends at "requirement proven."

## Release Gate Rules

The agent must not mark a milestone complete if any of these are unresolved:

- PRD-critical flow has not been executed
- degraded-state behavior is unverified
- mobile session UX is unverified for interaction-critical paths
- evidence is missing for an asserted pass
- contract and UI behavior disagree

## Example Validation Decisions

Good completion claim:

- "Session approval flow is complete. Evidence: integration test for approval request/response, mobile screenshot of approval card, E2E run covering approve action, and degraded-state regression test."

Bad completion claim:

- "Approval flow implemented and page renders."

## Validation Ownership Split

The agent should split verification into two concerns.

### Product-facing validation

Validates:

- does this satisfy the PRD?
- is the UX usable?
- are failure states honest?

### Engineering-facing validation

Validates:

- does the code behave correctly?
- do contracts and runtime-state boundaries hold?
- are regressions caught?

Both are required.

## Suggested Validation Deliverables Per Milestone

## M0

- spike notes
- raw event transcripts
- terminal viability evidence

## M1

- repository behavior tests
- host status screenshots
- project CRUD verification

## M2

- session create/attach evidence
- raw-to-normalized event mapping evidence
- approval path integration proof

## M3

- dashboard screenshot set
- session page screenshot set
- mobile interaction proof
- artifact viewer proof

## M4

- degraded-state proof
- restart empty-state truthfulness proof
- auth and reverse-proxy verification

## M5

- consolidated validation bundle
- alpha readiness report

## Alpha Readiness Checklist

Before claiming alpha readiness, the agent must prove:

1. gateway installs and boots on target machine
2. Codex detection works and incompatible state is explicit
3. project creation works from UI
4. session creation works from UI
5. session detail shows status, summary, attention, and artifacts
6. approval/reject/reply/interrupt all work
7. reconnect does not silently fake liveness
8. gateway restart does not destroy truth
9. phone viewport can perform the core remote actions
10. evidence bundle exists and is reviewable

## Recommendation For Implementation

Do not wait until the end to build validation.

Instead:

- add contract tests as each API lands
- add integration tests as each service lands
- add milestone-specific E2E and screenshot capture as each major page lands
- keep a requirement-to-evidence matrix current throughout development

The right mental model is:

**validation is part of the product implementation, not a final cleanup step**
