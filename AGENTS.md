# AGENTS

This is the handoff and entry document for any agent working on this repo.

If you are starting fresh, read this file first.

## Project

- Name: `orchd`
- License target: `Apache-2.0`
- Product type: self-hosted remote control plane for local coding agents
- Primary backend in v1: `Codex`
- Runtime: `Bun-first`

## What orchd is

`orchd` is a browser-first remote control plane that runs on the user's own machine and lets them continue using the same local coding environment from phone, laptop, or another browser.

The wedge is:

- same machine
- same repo
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
  - project bindings
  - lightweight session references
  - auth state
  - terminal session state
  - validation evidence
  - UI-facing control-plane state

Do **not** build a heavy persistent mirror of Codex session history in the gateway.

### Communication model

- browser never talks to Codex directly
- gateway is the only Codex client
- primary integration target: `codex app-server`
- primary transport: `stdio`
- `codex exec --json` is for spikes/fallbacks, not the main control-plane protocol

### Platform model

- primary supported host: `macOS`
- Linux: best-effort compatible
- Windows: out of scope for v1

Platform-sensitive behavior should be pushed down into Bun primitives or mature third-party libraries, but always wrapped behind local gateway contracts.

## Product decisions already made

- Auth: single-user password login, then cookie-backed browser session
- PWA: supported in v1
- Reverse proxy: document support, do not build managed relay in v1
- Terminal: each session may have its own terminal surface
- External session adoption: do not promise arbitrary external session takeover
- Validation retention: keep enough historical evidence for harness reliability; do not hardcode a fixed retention count in the spec

## UI / UX rules

The main product surface is the session detail page.

The hierarchy is:

1. status
2. summary
3. attention
4. artifacts
5. timeline
6. terminal drawer

Mobile is optimized for:

- checking status
- approving/rejecting
- replying
- interrupting
- inspecting artifacts

Do not make timeline or terminal the default focus.

## Validation rule

The agent must not conclude "done" based only on implementation.

Completion requires:

- PRD requirement mapped
- validation executed
- evidence produced
- evidence path recorded

No evidence, no pass.

## Read these docs

Start here, in this order:

0. [docs/README.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/README.md)
1. [docs/product/PRODUCT_MEMO.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/PRODUCT_MEMO.md)
2. [docs/product/DESIGN_DOC.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/product/DESIGN_DOC.md)
3. [docs/specs/ARCHITECTURE_MEMO.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ARCHITECTURE_MEMO.md)
4. [docs/specs/COMMUNICATION_AND_UX_SPEC.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/COMMUNICATION_AND_UX_SPEC.md)
5. [docs/specs/ENGINEERING_SPEC_V1.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/specs/ENGINEERING_SPEC_V1.md)
6. [docs/planning/TASK_BREAKDOWN_V1.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/planning/TASK_BREAKDOWN_V1.md)
7. [docs/validation/VALIDATION_PROGRAM_V1.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/VALIDATION_PROGRAM_V1.md)
8. [docs/VALIDATION_HARNESS.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/VALIDATION_HARNESS.md)
9. [docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md](/Users/sorcererxw/repo/sorcererxw/codeshell/docs/validation/PRD_ACCEPTANCE_MATRIX_V1.md)

## Immediate next step

If you are the next implementation agent, do not reopen planning unless a new contradiction appears.

Start with `M0`.

Recommended first tasks:

- `T001` Bun runtime bootstrap spike
- `T002` Codex detection and version spike
- `T003` Codex create-session spike
- `T005` Bun terminal viability spike
- `T006` spike findings memo
- `T101` repository skeleton
- `T102` config system
- `T103` database bootstrap and migrations
- `T104` base schema
- `T111` validation harness foundation
- `T112` license and naming baseline

## Suggested first deliverable

Create `docs/validation/M0_SPIKE_SPEC.md` and then implement the first spike.

That spec should define:

- how to spawn `codex app-server`
- how to speak over `stdio`
- what lightweight session reference is stored
- how approval requests are detected and responded to
- how Bun terminal viability is evaluated
- how validation evidence is captured

## Guardrails

Do not:

- introduce a second session truth store
- invent a new agent protocol on top of Codex
- make the UI depend on raw Codex protocol details
- center the product on file tree or terminal
- claim milestone completion without validation evidence

## One-sentence implementation brief

Build `orchd` as a Bun-first, Codex-first, thin remote control plane with PRD-driven validation and a browser UI optimized for status, approval, artifacts, and honest degraded-state handling.
