# Documentation Map

This repo now uses the **Go rebuild** as the active execution path.

Start with the thinnest document that answers your question, then drill down only when needed.

## Fast paths

- what `orchd` is: [`docs/product/PRODUCT_MEMO.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/PRODUCT_MEMO.md)
- rebuilt workspace UI direction: [`docs/product/UI_REBUILD_DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/UI_REBUILD_DESIGN_DOC.md)
- workspace UI refinement rules for touch, typography, rail, topbar, and composer: [`docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/WORKSPACE_UI_REFINEMENT_SPEC.md)
- settings information architecture and routed surface plan: [`docs/planning/SETTINGS_SURFACE_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/SETTINGS_SURFACE_PLAN.md)
- active master plan: [`docs/planning/GO_REBUILD_MASTER_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_MASTER_PLAN.md)
- detailed task list: [`docs/planning/GO_REBUILD_TASK_LIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_TASK_LIST.md)
- Codex TS-SDK parity design for Go client: [`docs/planning/CODEX_GO_CLIENT_PARITY_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/CODEX_GO_CLIENT_PARITY_PLAN.md)
- App Server-first convergence plan for the live Codex runtime: [`docs/planning/CODEX_APP_SERVER_CONVERGENCE_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/CODEX_APP_SERVER_CONVERGENCE_PLAN.md)
- accepted streaming runtime decision for app-server-only live sessions: [`docs/planning/APP_SERVER_STREAMING_RUNTIME_DECISION.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/APP_SERVER_STREAMING_RUNTIME_DECISION.md)
- Copilot backend adapter design: [`docs/planning/COPILOT_BACKEND_ADAPTER_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/COPILOT_BACKEND_ADAPTER_PLAN.md)
- terminal capability plan: [`docs/planning/TERMINAL_CAPABILITY_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/TERMINAL_CAPABILITY_PLAN.md)
- terminal implementation task list: [`docs/planning/TERMINAL_IMPLEMENTATION_TASK_LIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/TERMINAL_IMPLEMENTATION_TASK_LIST.md)
- backend plan: [`docs/planning/BACKEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/BACKEND_EXECUTION_PLAN.md)
- frontend plan: [`docs/planning/FRONTEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/FRONTEND_EXECUTION_PLAN.md)
- IDL plan: [`docs/planning/IDL_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_EXECUTION_PLAN.md)
- concrete first-pass protobuf surface: [`docs/planning/IDL_SURFACE_V1_DRAFT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_SURFACE_V1_DRAFT.md)
- validation guide: [`docs/VALIDATION_HARNESS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
- Go rebuild validation plan: [`docs/planning/GO_REBUILD_VALIDATION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_VALIDATION_PLAN.md)
- contributor workflow: [`docs/operations/CONTRIBUTING.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CONTRIBUTING.md)
- local dev loop, watch behavior, and file-based logs: [`docs/operations/DEV_LOOP.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEV_LOOP.md)
- runtime artifact paths and validation contract: [`docs/operations/RUNTIME_ARTIFACTS_AND_VALIDATION.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/RUNTIME_ARTIFACTS_AND_VALIDATION.md)
- UI system rules: [`docs/operations/UI_SYSTEM_RULES.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/UI_SYSTEM_RULES.md)

## Physical layout

```text
docs/
  README.md
  VALIDATION_HARNESS.md
  product/
  planning/
  operations/
  validation/
```

## Recommended reading order for active work

1. [`README.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/README.md)
2. [`AGENTS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/AGENTS.md)
3. [`docs/planning/GO_REBUILD_MASTER_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_MASTER_PLAN.md)
4. [`docs/planning/GO_REBUILD_TASK_LIST.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_TASK_LIST.md)
5. [`docs/planning/BACKEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/BACKEND_EXECUTION_PLAN.md)
6. [`docs/planning/FRONTEND_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/FRONTEND_EXECUTION_PLAN.md)
7. [`docs/planning/IDL_EXECUTION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_EXECUTION_PLAN.md)
8. [`docs/planning/IDL_SURFACE_V1_DRAFT.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_SURFACE_V1_DRAFT.md)
9. [`docs/product/UI_REBUILD_DESIGN_DOC.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/UI_REBUILD_DESIGN_DOC.md)
10. [`docs/planning/GO_REBUILD_VALIDATION_PLAN.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_VALIDATION_PLAN.md)

## Historical note

Older Bun-first planning/spec files may remain in the repo for historical context, but they are not the active implementation path unless a new document explicitly says otherwise.
