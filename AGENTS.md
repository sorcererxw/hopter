# AGENTS

This is the handoff and entry document for any agent working on this repo.

If you are starting fresh, read this file first.

## Project

- Name: `hopter`
- License target: `Apache-2.0`
- Product type: self-hosted remote control plane for local coding agents
- Primary backend in v1: `Codex`
- Active runtime direction: **Go-first**

## What hopter is

`hopter` is a browser-first remote control plane that runs on the user's own machine and lets them continue using the same local coding environment from phone, laptop, or another browser.

The wedge is:

- same machine
- same repo/project context
- same agent context
- same workflow
- continuous iteration across devices

## What hopter is not

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

- `hopter` owns only:
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
- main work object name: **session**
- main UI shape:
  - left session rail
  - right workspace pane
- routes:
  - `/`
  - `/sessions/:sessionId`
  - `/projects/new`
  - `/settings`

## Product language

Use these concepts consistently:

- **Session** is the product object users create, select, resume, steer,
  approve, and review. User-facing UI, routes, docs, and Connect APIs should
  say session.
- **Thread** is a Codex app-server protocol and storage concept. Use thread
  only when naming or describing raw `thread/*` methods, app-server payloads,
  backend thread ids, or adapter internals that directly mirror Codex.
- **Chat** is an interaction style, not a product object. Avoid naming product
  surfaces, actions, routes, persisted data, or UI labels chat.

If a value crosses the Codex boundary, map it explicitly: Hopter session ↔
Codex thread. Do not leak Codex thread terminology into product-facing copy.

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

## UI token rules

**Do not use Tailwind arbitrary values for colors or spacing when a standard token exists.**

### Allowed color sources (in order of preference)

1. **HeroUI semantic tokens** — `bg-background`, `text-foreground`, `bg-surface`, `bg-overlay`, `text-muted`, `bg-accent`, `bg-surface-secondary`, `border-border`, etc.
2. **Tailwind palette utilities** — `text-zinc-400`, `text-sky-400`, `text-amber-400`, etc. for specific semantic tones (e.g. syntax highlighting, status indicators)
3. **Arbitrary values as last resort** — only for values that have no token equivalent (e.g. `shadow-[...]`, complex `calc()`, `min(...)` expressions)

### Spacing / size rules

- Use standard Tailwind spacing scale: `size-3.5` (14px), `min-w-40` (160px), `w-80` (320px), `gap-2` (8px), `gap-0.5` (2px), etc.
- Use standard radius tokens: `rounded-lg` (10px), `rounded-xl` (12px), `rounded-2xl` (1rem/16px)
- Use standard font size tokens where they exist: `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px)
- Use standard opacity modifiers in multiples of 5: `/5`, `/10`, `/15`, `/20`, etc.
- Arbitrary values are acceptable **only** when there is no standard equivalent (e.g. `text-[13px]`, `w-[248px]`, complex grid templates)

### Prohibited patterns

- ❌ Hard-coded hex colors in className: `text-[#888]`, `bg-[#1e1e1e]`
- ❌ Workspace-prefixed color utilities such as `bg-ws-*`, `text-ws-*`, or `border-ws-*`; use HeroUI semantic utilities instead.
- ❌ CSS var arbitrary syntax when a semantic utility exists: `text-[var(--foreground)]`
- ❌ Non-standard opacity fractions: `white/7`, `white/8`, `white/12`
- ❌ Legacy pre-HeroUI color utilities after the HeroUI migration; use the HeroUI surface, overlay, segment, danger, field, focus, and muted utility families instead.

## Active repository shape

```text
cmd
internal
idl
ui
```

## Path policy

Use repo-relative paths for code, docs, scripts, and validation references whenever possible. Avoid hard-coded absolute paths (for example, `/Users/...`, `/repo/...`, or `/path/to/<repo>`). For external locations outside the repository, prefer explicit variables or documented conventions over literal device-specific paths.

## Validation rule

The agent must not conclude \"done\" based only on implementation.

Validation should be proportional to the change. Do not run broad or slow suites
after every small edit. During active iteration, prefer the cheapest relevant
check: targeted unit test, typecheck for touched package, focused lint, grep,
or a live smoke check when the dev loop is already running.

Completion requires:

- requirement mapped
- validation executed
- evidence produced
- evidence path recorded

No evidence, no pass.

For ordinary implementation work, use this cadence:

1. While editing: no automatic full-suite reruns.
2. After a coherent slice: run the smallest command that can catch likely
   regressions for the touched surface.
3. Before claiming completion: run one focused validation lane and record its
   evidence path.
4. Reserve `make validate-all`, full `go test ./...`, full UI builds, and
   browser E2E runs for cross-cutting changes, release/PR readiness, or when the
   user explicitly asks for exhaustive validation.

## Agent team workflow

For complex implementation requests that need planning, delegation, QA, browser or
computer-use verification, repair loops, and final user acceptance, follow
[`docs/operations/AGENT_TEAM_WORKFLOW.md`](docs/operations/AGENT_TEAM_WORKFLOW.md).

The lead agent owns requirement confirmation, task decomposition, subagent scope,
fresh QA, final browser/computer-use verification, evidence consolidation, and
the user acceptance handoff. Do not write final progress docs before the user
accepts the finished work.

## Local dev loop

When working on the live stack, the authority is the file-based dev loop, not terminal memory.

Use:

- `make reset` to clear stale listeners on `5173` and `8787`
- `make dev` to start the supervisor, Vite, and Go hot reload
- `make verify-live` to validate the running loop without rebuilding everything

AI agents should read machine state from the current checkout's dev log slug:

- `~/.hopter/devlogs/<repo-slug>/state.json`
- the slug is derived from the checkout path, so it may differ between clones

and logs from:

- `~/.hopter/devlogs/<repo-slug>/timeline.jsonl`
- the same checkout-specific slug is used for timeline logs

Deeper reference:

- [docs/operations/DEV_LOOP.md](docs/operations/DEV_LOOP.md)

## Read these docs

Start here, in this order:

0. [docs/README.md](docs/README.md)
1. [docs/operations/DEV_LOOP.md](docs/operations/DEV_LOOP.md)
2. [docs/planning/GO_REBUILD_MASTER_PLAN.md](docs/planning/GO_REBUILD_MASTER_PLAN.md)
3. [docs/planning/GO_REBUILD_TASK_LIST.md](docs/planning/GO_REBUILD_TASK_LIST.md)
4. [docs/planning/BACKEND_EXECUTION_PLAN.md](docs/planning/BACKEND_EXECUTION_PLAN.md)
5. [docs/planning/FRONTEND_EXECUTION_PLAN.md](docs/planning/FRONTEND_EXECUTION_PLAN.md)
6. [docs/planning/IDL_EXECUTION_PLAN.md](docs/planning/IDL_EXECUTION_PLAN.md)
7. [docs/planning/IDL_SURFACE_V1_DRAFT.md](docs/planning/IDL_SURFACE_V1_DRAFT.md)
8. [docs/product/UI_REBUILD_DESIGN_DOC.md](docs/product/UI_REBUILD_DESIGN_DOC.md)
9. [docs/VALIDATION_HARNESS.md](docs/VALIDATION_HARNESS.md)
10. [docs/planning/GO_REBUILD_VALIDATION_PLAN.md](docs/planning/GO_REBUILD_VALIDATION_PLAN.md)

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

## Codex app-server development gate

For any work that changes the `codex app-server` connection path, follow
[`docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md`](docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md)
and run the local guard before claiming completion:

```bash
HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs
```

## One-sentence implementation brief

Build `hopter` as a Go-first, Codex-first, thin remote control plane with a React/Vite workspace UI, Connect control-plane APIs, SSE status updates, and evidence-backed validation.
