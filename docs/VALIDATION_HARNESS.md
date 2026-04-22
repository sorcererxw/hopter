# Validation Harness Guide

This is the progressive-disclosure entry point for validation in `hopter`.

Use it when you need to answer one of three questions:

1. what counts as done here
2. where the current evidence lives
3. how to extend the harness without breaking the evidence chain

## The harness in one screen

The validation path is:

```text
PRD intent
  -> docs/validation/VALIDATION_PROGRAM_V1.md
  -> docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md
  -> scripts/validate-*.ts
  -> storage/artifacts/validation/<run-id>/
  -> docs/operations/ALPHA_READINESS_SUMMARY.md
  -> docs/operations/RELEASE_CHECKLIST.md
```

That path is intentional:

- policy lives in docs and specs
- execution lives in scripts
- evidence lives in structured bundles
- ship/no-ship decisions live in summaries and checklists

## Start with the smallest useful document

- Need the rule for "done": [`docs/validation/VALIDATION_PROGRAM_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/VALIDATION_PROGRAM_V1.md)
- Need the current pass/fail mapping: [`docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md)
- Need the latest readiness snapshot: [`docs/operations/ALPHA_READINESS_SUMMARY.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/ALPHA_READINESS_SUMMARY.md)
- Need the release gate: [`docs/operations/RELEASE_CHECKLIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RELEASE_CHECKLIST.md)
- Need the original feasibility constraints: [`docs/validation/M0_SPIKE_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/M0_SPIKE_SPEC.md), [`docs/validation/M0_SPIKE_FINDINGS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/M0_SPIKE_FINDINGS.md)

Only drop into the scripts when you are changing how evidence is gathered.

## Harness components

### 1. Policy

- [`docs/validation/VALIDATION_PROGRAM_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/VALIDATION_PROGRAM_V1.md) defines the levels, release-gate logic, and truthfulness requirements.

### 2. Requirement mapping

- [`docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md) ties each requirement to a validation method and evidence path.

### 3. Execution

- `scripts/validate-m0.ts`
- `scripts/validate-m1.ts`
- `scripts/validate-m2.ts`
- `scripts/validate-m3.ts`
- `scripts/validate-m4.ts`
- `scripts/validate-m5.ts`
- `scripts/validate-app-server-docs.ts`
- `scripts/validate-template-snake.ts`
- `scripts/validate-docs.ts`

These scripts are the executable harness. They are responsible for producing reviewable artifacts, not just console output.

`scripts/validate-app-server-docs.ts` is the local development guard for Codex
app-server connection work. It scans local changed files, requires an explicit
official-docs acknowledgement for app-server-scoped changes, and writes evidence
under `storage/artifacts/validation/app_server_docs_<timestamp>/`.

`scripts/validate-template-snake.ts` is the product-template smoke test for the primary UX promise: browser project creation, browser session launch, browser approval handling, and Codex producing a working browser Snake game from chat input alone.

### 4. Evidence storage

Current bundle root:

```text
storage/artifacts/validation/
  latest-docs.txt
  latest-m0.txt
  latest-m1.txt
  latest-m2.txt
  latest-m3.txt
  latest-m4.txt
  latest-m5.txt
  latest-app-server-docs.txt
  latest-template-snake.txt
  <run-id>/
```

Each `<run-id>/` directory should contain machine-readable outputs plus a concise human-readable summary.

### 5. Operational summaries

- [`docs/operations/ALPHA_READINESS_SUMMARY.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/ALPHA_READINESS_SUMMARY.md) is the shortest current-state read.
- [`docs/operations/HANDOFF_2026-04-14.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/HANDOFF_2026-04-14.md) is the longer resumption snapshot.

## How to extend the harness

When changing behavior or adding a new feature:

1. identify the affected requirement or add a new requirement row
2. update the relevant acceptance mapping in [`docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md)
3. extend the smallest relevant validation script under `scripts/`
4. make sure the script writes structured evidence under `storage/artifacts/validation/<run-id>/`
5. update the operational summary docs if the release picture changed

## Progressive disclosure rules

Do not force every reader to start from the deepest spec.

Use this ladder instead:

- quick orientation: [`docs/operations/ALPHA_READINESS_SUMMARY.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/ALPHA_READINESS_SUMMARY.md)
- release decision: [`docs/operations/RELEASE_CHECKLIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RELEASE_CHECKLIST.md)
- validation policy: [`docs/validation/VALIDATION_PROGRAM_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/VALIDATION_PROGRAM_V1.md)
- evidence mechanics: `scripts/validate-*.ts`

That keeps casual readers out of the weeds while still making the harness fully inspectable.
