# Documentation Map

This repo uses progressive disclosure.

Start with the thinnest document that answers your question, then drill down only when you need more detail or need to change the contract.

## Fast paths

- I want to understand what `orchd` is: [`docs/product/PRODUCT_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/PRODUCT_MEMO.md)
- I want the product and UX shape: [`docs/product/DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/DESIGN_DOC.md)
- I want backend and protocol boundaries: [`docs/specs/ARCHITECTURE_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ARCHITECTURE_MEMO.md), [`docs/specs/COMMUNICATION_AND_UX_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/COMMUNICATION_AND_UX_SPEC.md)
- I want implementation and milestone detail: [`docs/specs/ENGINEERING_SPEC_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ENGINEERING_SPEC_V1.md), [`docs/planning/TASK_BREAKDOWN_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/TASK_BREAKDOWN_V1.md)
- I want to understand validation and evidence: [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
- I want to run or ship the repo: [`docs/operations/CONTRIBUTING.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CONTRIBUTING.md), [`docs/operations/DEPLOYMENT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEPLOYMENT.md), [`docs/operations/RELEASE_CHECKLIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RELEASE_CHECKLIST.md)

## Physical layout

```text
docs/
  README.md
  VALIDATION_HARNESS.md
  product/
  specs/
  planning/
  validation/
  operations/
```

The top-level `docs/` directory now keeps only cross-cutting entry documents.
Everything else lives under a domain-specific folder.

## Layers

### Layer 0: Repo entry

- [`README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/README.md): quick start, storage layout, shortest doc links
- [`AGENTS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/AGENTS.md): agent handoff, reading order, non-negotiable guardrails

### Layer 1: Product shape

- [`docs/product/PRODUCT_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/PRODUCT_MEMO.md): wedge, user problem, what this product is and is not
- [`docs/product/DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/DESIGN_DOC.md): user journeys, UI priorities, v1 promise

Read this layer when deciding whether a feature belongs in the product at all.

### Layer 2: Contracts

- [`docs/specs/ARCHITECTURE_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ARCHITECTURE_MEMO.md): source-of-truth split and system boundaries
- [`docs/specs/COMMUNICATION_AND_UX_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/COMMUNICATION_AND_UX_SPEC.md): transport, event, and UX truthfulness rules
- [`docs/specs/ENGINEERING_SPEC_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ENGINEERING_SPEC_V1.md): concrete contracts, runtime-state boundaries, API, and implementation requirements

Read this layer when changing protocols, schemas, or ownership boundaries.

### Layer 3: Delivery plan

- [`docs/planning/IMPLEMENTATION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IMPLEMENTATION_PLAN.md): build-ready execution framing
- [`docs/planning/TASK_BREAKDOWN_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/TASK_BREAKDOWN_V1.md): milestone and task-level acceptance
- [`docs/planning/ENG_REVIEW_TEST_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/ENG_REVIEW_TEST_PLAN.md): engineering review notes and test expectations
- [`docs/planning/FRONTEND_STACK_REPORT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/FRONTEND_STACK_REPORT.md): prior stack analysis and tradeoffs

Read this layer when planning execution or understanding why the current implementation sequence exists.

### Layer 4: Validation harness

- [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md): progressive-disclosure guide to the evidence system
- [`docs/validation/VALIDATION_PROGRAM_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/VALIDATION_PROGRAM_V1.md): validation policy and release-gate logic
- [`docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md): requirement-to-evidence matrix
- [`docs/validation/M0_SPIKE_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/M0_SPIKE_SPEC.md), [`docs/validation/M0_SPIKE_FINDINGS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/M0_SPIKE_FINDINGS.md): early harness constraints and findings
- [`docs/operations/ALPHA_READINESS_SUMMARY.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/ALPHA_READINESS_SUMMARY.md): current evidence snapshot

Read this layer when deciding whether something is actually done, or when changing how evidence is produced.

### Layer 5: Operations and handoff

- [`docs/operations/CONTRIBUTING.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CONTRIBUTING.md): local workflow and definition of done
- [`docs/operations/DEPLOYMENT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEPLOYMENT.md): local-only and self-managed remote deployment notes
- [`docs/operations/RELEASE_CHECKLIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RELEASE_CHECKLIST.md): release checklist
- [`docs/operations/HANDOFF_2026-04-14.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/HANDOFF_2026-04-14.md): latest detailed handoff snapshot

Read this layer when you are operating, releasing, or resuming work.

## Suggested reading paths

### New contributor

1. [`README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/README.md)
2. [`docs/product/PRODUCT_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/PRODUCT_MEMO.md)
3. [`docs/product/DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/DESIGN_DOC.md)
4. [`docs/operations/CONTRIBUTING.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CONTRIBUTING.md)

### Agent or engineer changing behavior

1. [`AGENTS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/AGENTS.md)
2. [`docs/specs/ARCHITECTURE_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ARCHITECTURE_MEMO.md)
3. [`docs/specs/COMMUNICATION_AND_UX_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/COMMUNICATION_AND_UX_SPEC.md)
4. [`docs/specs/ENGINEERING_SPEC_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ENGINEERING_SPEC_V1.md)
5. [`docs/planning/TASK_BREAKDOWN_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/TASK_BREAKDOWN_V1.md)

### Validation or release owner

1. [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
2. [`docs/validation/VALIDATION_PROGRAM_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/VALIDATION_PROGRAM_V1.md)
3. [`docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md)
4. [`docs/operations/ALPHA_READINESS_SUMMARY.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/ALPHA_READINESS_SUMMARY.md)
5. [`docs/operations/RELEASE_CHECKLIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RELEASE_CHECKLIST.md)
