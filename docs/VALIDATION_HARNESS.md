# Validation Harness Guide

This is the progressive-disclosure entry point for validation in `hopter`.

Use it when you need to answer one of three questions:

1. what counts as done here
2. which validation script covers a change
3. where the current evidence lives

## Current Harness Shape

The active validation path is:

```text
Go rebuild requirement
  -> docs/planning/GO_REBUILD_TASK_LIST.md
  -> docs/planning/GO_REBUILD_VALIDATION_PLAN.md
  -> scripts/validate-*.ts
  -> storage/artifacts/validation/<run-id>/
```

Execution lives in scripts. Evidence lives in structured bundles. A change is not
complete until the relevant script has produced a reviewable evidence path.

## Start With The Smallest Useful Document

- Need the active requirement map: [`docs/planning/GO_REBUILD_TASK_LIST.md`](planning/GO_REBUILD_TASK_LIST.md)
- Need the validation strategy: [`docs/planning/GO_REBUILD_VALIDATION_PLAN.md`](planning/GO_REBUILD_VALIDATION_PLAN.md)
- Need runtime artifact conventions: [`docs/operations/RUNTIME_ARTIFACTS_AND_VALIDATION.md`](operations/RUNTIME_ARTIFACTS_AND_VALIDATION.md)
- Need local dev-loop verification: [`docs/operations/DEV_LOOP.md`](operations/DEV_LOOP.md)
- Need old Bun-first validation history: [`docs/archive/bun-first-v1/validation/`](archive/bun-first-v1/validation/)

## Active Validation Scripts

Use `make docs` for documentation-map checks.

Core rebuild validations:

- `make validate-go-idl`
- `make validate-go-server`
- `make validate-go-ui`
- `make validate-go-tetris`
- `make validate-all`

Focused runtime and UI validations:

- `make validate-app-server-docs`
- `make validate-app-server-runtime`
- `make validate-app-server-approvals`
- `make validate-app-server-reasoning`
- `make validate-git-actions`
- `make validate-tasks-idl`
- `make validate-tasks-store`
- `make validate-interrupt-ui`
- `make validate-update-ui`
- `make validate-session-roundtrip`
- `make validate-transcript-ui`

The corresponding TypeScript scripts live under [`scripts/`](../scripts/).

## Evidence Storage

Current bundle root:

```text
storage/artifacts/validation/
  latest-docs.txt
  latest-go-idl.txt
  latest-go-server.txt
  latest-go-ui.txt
  latest-go-tetris.txt
  latest-app-server-docs.txt
  <run-id>/
```

Not every script writes a `latest-*` pointer with the same name. When in doubt,
use the path printed by the script and record that path in your final handoff.

Each `<run-id>/` directory should contain machine-readable outputs plus a concise
human-readable summary where the script supports one.

## App-server Gate

For changes that affect the `codex app-server` connection path, follow
[`docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md`](operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md)
and run:

```bash
HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs
```

## How To Extend The Harness

When changing behavior or adding a feature:

1. identify the affected task or acceptance rule in [`docs/planning/GO_REBUILD_TASK_LIST.md`](planning/GO_REBUILD_TASK_LIST.md)
2. update [`docs/planning/GO_REBUILD_VALIDATION_PLAN.md`](planning/GO_REBUILD_VALIDATION_PLAN.md) if the validation shape changes
3. extend the smallest relevant validation script under `scripts/`
4. make sure the script writes structured evidence under `storage/artifacts/validation/<run-id>/`
5. record the evidence path in the handoff or final response

## Historical Validation

The old Bun-first validation program, PRD acceptance matrix, M0 spike spec, and
M0 findings are archived under
[`docs/archive/bun-first-v1/validation/`](archive/bun-first-v1/validation/).
They are useful historical evidence, but they are not active Go rebuild release
gates.
