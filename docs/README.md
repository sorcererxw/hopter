# Documentation Map

This repo uses the **Go rebuild** as the active execution path. Start with the
smallest document that answers your question, then drill down only when needed.

## Active Fast Paths

- Product definition: [`docs/product/PRODUCT_MEMO.md`](product/PRODUCT_MEMO.md)
- Workspace UI direction: [`docs/product/UI_REBUILD_DESIGN_DOC.md`](product/UI_REBUILD_DESIGN_DOC.md)
- Workspace UI refinement rules: [`docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md`](product/WORKSPACE_UI_REFINEMENT_SPEC.md)
- Active master plan: [`docs/planning/GO_REBUILD_MASTER_PLAN.md`](planning/GO_REBUILD_MASTER_PLAN.md)
- Detailed task list: [`docs/planning/GO_REBUILD_TASK_LIST.md`](planning/GO_REBUILD_TASK_LIST.md)
- Backend plan: [`docs/planning/BACKEND_EXECUTION_PLAN.md`](planning/BACKEND_EXECUTION_PLAN.md)
- Frontend plan: [`docs/planning/FRONTEND_EXECUTION_PLAN.md`](planning/FRONTEND_EXECUTION_PLAN.md)
- IDL plan: [`docs/planning/IDL_EXECUTION_PLAN.md`](planning/IDL_EXECUTION_PLAN.md)
- Protobuf surface draft: [`docs/planning/IDL_SURFACE_V1_DRAFT.md`](planning/IDL_SURFACE_V1_DRAFT.md)
- Go rebuild validation plan: [`docs/planning/GO_REBUILD_VALIDATION_PLAN.md`](planning/GO_REBUILD_VALIDATION_PLAN.md)
- Validation harness guide: [`docs/VALIDATION_HARNESS.md`](VALIDATION_HARNESS.md)

## Runtime And Operations

- Local dev loop and logs: [`docs/operations/DEV_LOOP.md`](operations/DEV_LOOP.md)
- Contributor workflow: [`docs/operations/CONTRIBUTING.md`](operations/CONTRIBUTING.md)
- Agent team workflow: [`docs/operations/AGENT_TEAM_WORKFLOW.md`](operations/AGENT_TEAM_WORKFLOW.md)
- Codex app-server development constraints: [`docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md`](operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md)
- Runtime artifact paths and validation contract: [`docs/operations/RUNTIME_ARTIFACTS_AND_VALIDATION.md`](operations/RUNTIME_ARTIFACTS_AND_VALIDATION.md)
- UI system rules: [`docs/operations/UI_SYSTEM_RULES.md`](operations/UI_SYSTEM_RULES.md)

## Feature Plans

Feature plans under [`docs/planning/`](planning/) are scoped proposals unless the active Go rebuild task list says they are in the current milestone. Deferred plans, including terminal and relay-adjacent work, must not override the Go-first, Codex-first architecture in `AGENTS.md`.

## Historical Archive

Old Bun-first v1 planning, specs, validation matrices, and handoff notes are archived under [`docs/archive/bun-first-v1/`](archive/bun-first-v1/). They are historical evidence only and are not active implementation guidance.

## Physical Layout

```text
docs/
  README.md
  VALIDATION_HARNESS.md
  archive/
  product/
  planning/
  operations/
```

## Recommended Reading Order For Active Work

1. [`README.md`](../README.md)
2. [`AGENTS.md`](../AGENTS.md)
3. [`docs/product/PRODUCT_MEMO.md`](product/PRODUCT_MEMO.md)
4. [`docs/planning/GO_REBUILD_MASTER_PLAN.md`](planning/GO_REBUILD_MASTER_PLAN.md)
5. [`docs/planning/GO_REBUILD_TASK_LIST.md`](planning/GO_REBUILD_TASK_LIST.md)
6. [`docs/planning/BACKEND_EXECUTION_PLAN.md`](planning/BACKEND_EXECUTION_PLAN.md)
7. [`docs/planning/FRONTEND_EXECUTION_PLAN.md`](planning/FRONTEND_EXECUTION_PLAN.md)
8. [`docs/planning/IDL_EXECUTION_PLAN.md`](planning/IDL_EXECUTION_PLAN.md)
9. [`docs/planning/IDL_SURFACE_V1_DRAFT.md`](planning/IDL_SURFACE_V1_DRAFT.md)
10. [`docs/product/UI_REBUILD_DESIGN_DOC.md`](product/UI_REBUILD_DESIGN_DOC.md)
11. [`docs/planning/GO_REBUILD_VALIDATION_PLAN.md`](planning/GO_REBUILD_VALIDATION_PLAN.md)
