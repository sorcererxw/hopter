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

## UI token rules

**Do not use Tailwind arbitrary values for colors or spacing when a standard token exists.**

### Allowed color sources (in order of preference)

1. **shadcn semantic tokens** — `bg-background`, `text-foreground`, `bg-card`, `bg-popover`, `bg-sidebar`, `text-muted-foreground`, `bg-accent`, `bg-secondary`, `border-border`, etc.
2. **Workspace design tokens** — `bg-ws-*`, `text-ws-*`, `border-ws-*` (defined in `@theme inline` in `index.css`)
3. **Tailwind palette utilities** — `text-zinc-400`, `text-sky-400`, `text-amber-400`, etc. for specific semantic tones (e.g. syntax highlighting, status indicators)
4. **Arbitrary values as last resort** — only for values that have no token equivalent (e.g. `shadow-[...]`, complex `calc()`, `min(...)` expressions)

### Workspace token reference (`ws-*`)

| Token | Resolves to |
|---|---|
| `bg-ws-page` | `--workspace-page-bg` (#0f0f0f) |
| `bg-ws-sidebar` | `--workspace-sidebar-bg` (#141414) |
| `bg-ws-panel` | `--workspace-panel-bg` (#1e1e1e) |
| `bg-ws-surface` | `--workspace-surface-bg` (#1a1a1a) |
| `bg-ws-elevated` | `--workspace-elevated-bg` (#242424) |
| `bg-ws-hover` | `--workspace-hover-bg` (rgba white/7%) |
| `bg-ws-hover-soft` | `--workspace-hover-bg-soft` (rgba white/4%) |
| `bg-ws-active` | `--workspace-active-bg` (rgba white/10%) |
| `bg-ws-tag` | `--workspace-tag-bg` (rgba white/6%) |
| `bg-ws-tool` | `--workspace-tool-bg` (rgba white/4%) |
| `text-ws-text` | `--workspace-text-primary` (#e0e0e0) |
| `text-ws-text-sub` | `--workspace-text-secondary` (#888) |
| `text-ws-text-muted` | `--workspace-text-muted` (#555) |
| `text-ws-text-off` | `--workspace-text-disabled` (#3a3a3a) |
| `border-ws-border` | `--workspace-border` (rgba white/7%) |
| `border-ws-border-strong` | `--workspace-border-strong` (rgba white/12%) |
| `border-ws-tag-border` | `--workspace-tag-border` (rgba white/8%) |
| `border-ws-tool-border` | `--workspace-tool-border` (rgba white/7%) |
| `border-ws-thread` | `--workspace-thread-guide` (rgba white/8%) |
| `border-ws-code` | `--workspace-inline-code-text` (#63b7ff) |
| `bg-picker` | `--picker-selection` (#2a5cb8) |
| `bg-picker-hover` | `--picker-selection-hover` (#1e4fa0) |

### Spacing / size rules

- Use standard Tailwind spacing scale: `size-3.5` (14px), `min-w-40` (160px), `w-80` (320px), `gap-2` (8px), `gap-0.5` (2px), etc.
- Use standard radius tokens: `rounded-lg` (10px), `rounded-xl` (12px), `rounded-2xl` (1rem/16px)
- Use standard font size tokens where they exist: `text-xs` (12px), `text-sm` (14px), `text-base` (16px), `text-lg` (18px)
- Use standard opacity modifiers in multiples of 5: `/5`, `/10`, `/15`, `/20`, etc.
- Arbitrary values are acceptable **only** when there is no standard equivalent (e.g. `text-[13px]`, `w-[248px]`, complex grid templates)

### Prohibited patterns

- ❌ Hard-coded hex colors in className: `text-[#888]`, `bg-[#1e1e1e]`
- ❌ CSS var arbitrary syntax when a ws-token exists: `text-[var(--workspace-text-primary)]`
- ❌ Non-standard opacity fractions: `white/7`, `white/8`, `white/12`
- ❌ Redundant custom tokens when shadcn already has an equivalent (`bg-popover` = `#1e1e1e`, `bg-card` = `#1a1a1a`, `bg-sidebar` = `#141414`)

## Active repository shape

```text
/cmd
/internal
/idl
/ui
```

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
[`docs/operations/AGENT_TEAM_WORKFLOW.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/AGENT_TEAM_WORKFLOW.md).

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

AI agents should read machine state from:

- [~/.hopter/devlogs/codeshell/state.json](/Users/sorcererxw/.hopter/devlogs/codeshell/state.json)

and logs from:

- [~/.hopter/devlogs/codeshell/timeline.jsonl](/Users/sorcererxw/.hopter/devlogs/codeshell/timeline.jsonl)

Deeper reference:

- [docs/operations/DEV_LOOP.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEV_LOOP.md)

## Read these docs

Start here, in this order:

0. [docs/README.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
1. [docs/operations/DEV_LOOP.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/DEV_LOOP.md)
2. [docs/planning/GO_REBUILD_MASTER_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_MASTER_PLAN.md)
3. [docs/planning/GO_REBUILD_TASK_LIST.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_TASK_LIST.md)
4. [docs/planning/BACKEND_EXECUTION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/BACKEND_EXECUTION_PLAN.md)
5. [docs/planning/FRONTEND_EXECUTION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/FRONTEND_EXECUTION_PLAN.md)
6. [docs/planning/IDL_EXECUTION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_EXECUTION_PLAN.md)
7. [docs/planning/IDL_SURFACE_V1_DRAFT.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/IDL_SURFACE_V1_DRAFT.md)
8. [docs/product/UI_REBUILD_DESIGN_DOC.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/UI_REBUILD_DESIGN_DOC.md)
9. [docs/VALIDATION_HARNESS.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
10. [docs/planning/GO_REBUILD_VALIDATION_PLAN.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/GO_REBUILD_VALIDATION_PLAN.md)

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
[`docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md`](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md)
and run the local guard before claiming completion:

```bash
HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs
```

## One-sentence implementation brief

Build `hopter` as a Go-first, Codex-first, thin remote control plane with a React/Vite workspace UI, Connect control-plane APIs, SSE status updates, and evidence-backed validation.
