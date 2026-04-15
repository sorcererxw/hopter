# AGENTS

This is the handoff and entry document for any agent working on this repo.

If you are starting fresh, read this file first.

## Project

- Name: `orchd`
- License target: `Apache-2.0`
- Product type: self-hosted remote control plane for local coding agents
- Primary backend in v1: `Codex`
- Active runtime direction: **Go-first**

## What orchd is

`orchd` is a browser-first remote control plane that runs on the user's own machine and lets them continue using the same local coding environment from phone, laptop, or another browser.

The wedge is:

- same machine
- same repo/project context
- same agent context
- same workflow
- continuous iteration across devices

## What orchd is not

Do **not** turn this into:

- a new coding agent
- a planner/orchestrator that replaces backend reasoning
- a browser IDE
- a terminal-first shell
- a generic AI chat wrapper

## Core architectural truth

### Source of truth

- `Codex` is the source of truth for:
  - session content
  - session history
  - approval semantics
  - artifact semantics

- `orchd` owns only:
  - projects
  - lightweight session references
  - auth state
  - validation evidence
  - UI-facing control-plane state

Do **not** build a heavy persistent mirror of Codex session history in the backend.

### Communication model

- browser never talks to Codex directly
- the Go server is the only Codex client
- primary integration target: `codex app-server`
- primary transport: `stdio`
- primary browser API transport: **Connect**
- primary browser notification transport: **SSE**

### Platform model

- primary supported host: `macOS`
- Linux: best-effort compatible
- Windows: out of scope for v1

## Product decisions already made

- dev auth: localhost-only, no password
- relay: deferred
- terminal: deferred
- main concept name: **project**, not binding
- main UI shape:
  - left session rail
  - right workspace pane
- routes:
  - `/`
  - `/sessions/:sessionId`
  - `/projects/new`
  - `/settings`

## UI / UX rules

The product is a workspace shell, not a card-heavy dashboard.

Priority order inside the selected session pane:

1. status
2. summary
3. attention
4. input/composer
5. artifacts
6. timeline/history

Do not make timeline the default focus.

## Active repository shape

```text
/cmd
/internal
/idl
/ui
```

## Validation rule

The agent must not conclude \"done\" based only on implementation.

Completion requires:

- requirement mapped
- validation executed
- evidence produced
- evidence path recorded

No evidence, no pass.

## Read these docs

Start here, in this order:

0. [docs/README.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
1. [docs/planning/GO_REBUILD_MASTER_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_MASTER_PLAN.md)
2. [docs/planning/GO_REBUILD_TASK_LIST.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_TASK_LIST.md)
3. [docs/planning/BACKEND_EXECUTION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/BACKEND_EXECUTION_PLAN.md)
4. [docs/planning/FRONTEND_EXECUTION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/FRONTEND_EXECUTION_PLAN.md)
5. [docs/planning/IDL_EXECUTION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_EXECUTION_PLAN.md)
6. [docs/planning/IDL_SURFACE_V1_DRAFT.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_SURFACE_V1_DRAFT.md)
7. [docs/product/UI_REBUILD_DESIGN_DOC.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/UI_REBUILD_DESIGN_DOC.md)
8. [docs/VALIDATION_HARNESS.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
9. [docs/planning/GO_REBUILD_VALIDATION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_VALIDATION_PLAN.md)

## Immediate next step

If you are the next implementation agent, do not reopen planning unless a new contradiction appears.

Work from:

- the active Go rebuild task list
- the backend/frontend/IDL execution plans
- the validation plan

## Guardrails

Do not:

- introduce a second session truth store
- invent a new agent protocol on top of Codex
- make the UI depend on raw Codex protocol details
- reintroduce the old Bun-first runtime as an active architecture
- claim milestone completion without validation evidence

## One-sentence implementation brief

Build `orchd` as a Go-first, Codex-first, thin remote control plane with a React/Vite workspace UI, Connect control-plane APIs, SSE status updates, and evidence-backed validation.
