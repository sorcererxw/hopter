# AGENTS

This file governs the `hopter` repository. It is the open-source local product
repo, not the hosted platform repo.

## Scope

Use this repo for:

- local Hopter CLI and local host/server runtime
- Go-first backend under `cmd/` and `internal/`
- Connect/IDL surface under `idl/`
- React/Vite workspace UI under `ui/`
- Codex app-server integration
- local validation harnesses, docs, and release artifacts

Hosted auth, billing, Cloudflare Workers, D1, tenant gateway, and public website
work belongs in the sibling `platform/` repo unless the user explicitly changes
that boundary.

## Product Contract

- Product type: browser-first remote control plane for local coding agents.
- Active runtime direction: **Go-first**.
- Primary backend in v1: **Codex**.
- Codex is the source of truth for session content, history, approvals, and
  artifact semantics.
- Hopter owns only projects, lightweight session references, auth state,
  validation evidence, and UI-facing control-plane state.
- Do not build a second durable mirror of Codex session history.
- Browser clients never talk to Codex directly; the Go server is the only Codex
  client.
- Browser API transport is Connect; browser notification transport is SSE.

## Product Language

- Use **session** for the user-facing object.
- Use **thread** only for raw Codex app-server protocol, backend ids, or adapter
  internals.
- Avoid naming product surfaces, routes, APIs, or persisted data **chat**.

## Repository Shape

```text
cmd
internal
idl
ui
```

For `ui/**`, also follow [`ui/AGENTS.md`](ui/AGENTS.md).

## Path Policy

Use repo-relative paths for code, docs, scripts, and validation references.
Avoid hard-coded machine paths such as `/Users/...`, `/repo/...`, or
`/path/to/<repo>`.

## Validation Contract

Do not claim completion based only on implementation.

Completion requires:

- requirement mapped
- relevant validation executed
- evidence produced
- evidence path recorded

During active iteration, run the smallest relevant check. Use broader lanes such
as `make validate-all`, full `go test ./...`, full UI builds, or browser E2E
only for cross-cutting changes, release/PR readiness, or explicit user request.

Useful fast paths:

- `make docs`
- `make verify-live`
- `make ui-lint`
- `make ui-typecheck`
- `make go-test`

## Codex App-server Gate

For work that changes the `codex app-server` connection path, follow
[`docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md`](docs/operations/CODEX_APP_SERVER_DEVELOPMENT_CONSTRAINTS.md)
and run:

```bash
HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs
```

## Agent Entrypoints

Start with [`docs/README.md`](docs/README.md), then follow the smallest matching
entry:

- product or UX decisions: [`docs/product/README.md`](docs/product/README.md)
- active rebuild implementation: [`docs/planning/README.md`](docs/planning/README.md)
- dev loop, workflow, or evidence: [`docs/operations/README.md`](docs/operations/README.md)
- validation map: [`docs/VALIDATION_HARNESS.md`](docs/VALIDATION_HARNESS.md)

## Guardrails

Do not:

- introduce a second session truth store
- invent a new agent protocol on top of Codex
- make UI depend on raw Codex protocol details
- reintroduce the old Bun-first runtime as active architecture
- claim milestone completion without validation evidence
