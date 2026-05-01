# Documentation Map

This repo uses the **Go rebuild** as the active execution path. Start with the
smallest document that answers your question, then drill down only when needed.

## Start Here

- New to the product: [`product/README.md`](product/README.md)
- Implementing active rebuild work: [`planning/README.md`](planning/README.md)
- Running or debugging locally: [`operations/README.md`](operations/README.md)
- Validating changes: [`VALIDATION_HARNESS.md`](VALIDATION_HARNESS.md)

## Fast Path For Active Work

1. Read the repository `README.md` and `AGENTS.md`.
2. Read [`product/PRODUCT_MEMO.md`](product/PRODUCT_MEMO.md) for product boundaries.
3. Read [`planning/GO_REBUILD_TASK_LIST.md`](planning/GO_REBUILD_TASK_LIST.md) for current execution state.
4. Read [`planning/GO_REBUILD_MASTER_PLAN.md`](planning/GO_REBUILD_MASTER_PLAN.md) only when you need the full rebuild context.
5. Read [`planning/IDL_SURFACE_V1_DRAFT.md`](planning/IDL_SURFACE_V1_DRAFT.md) only when changing Connect or protobuf surfaces.
6. Pick the relevant implementation plan from [`planning/README.md`](planning/README.md).
7. Use [`operations/README.md`](operations/README.md) only for workflow, dev-loop, and validation details.

## Boundaries

- Product decisions live under [`product/`](product/README.md).
- Active execution plans and scoped proposals live under [`planning/`](planning/README.md).
- Runtime, contribution, and validation workflows live under [`operations/`](operations/README.md).

## Physical Layout

```text
docs/
  README.md
  VALIDATION_HARNESS.md
  operations/
  planning/
  product/
```
