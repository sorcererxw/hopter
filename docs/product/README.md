# Product Docs

Use this directory to understand what Hopter is, what it is not, and how the
workspace UI should behave. These docs are product guidance, not implementation
task lists.

## Read By Question

- What is the product and wedge? Read [`PRODUCT_MEMO.md`](PRODUCT_MEMO.md).
- What is the intended workspace shape? Read [`UI_REBUILD_DESIGN_DOC.md`](UI_REBUILD_DESIGN_DOC.md).
- What are the current UI refinement rules? Read [`WORKSPACE_UI_REFINEMENT_SPEC.md`](WORKSPACE_UI_REFINEMENT_SPEC.md).

## Product Boundary

Product-facing language should use **session**. Use **thread** only for Codex
protocol or adapter internals, and avoid naming user-facing surfaces **chat**.
