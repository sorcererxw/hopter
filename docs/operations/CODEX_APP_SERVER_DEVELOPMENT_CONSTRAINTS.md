# Codex App Server Development Constraints

## Purpose

This is the local development gate for work that changes how `hopter` connects to
`codex app-server`.

The rule is simple: do not infer app-server protocol behavior from memory or from
nearby code. Before changing this path, read the current official documentation.
If the documentation is ambiguous or the implementation detail is not covered,
inspect the upstream Codex app-server source before deciding.

Required sources:

- official docs: https://developers.openai.com/codex/app-server
- upstream source for uncertain details: https://github.com/openai/codex/tree/main/codex-rs/app-server

## What Counts As App-Server Connection Work

Run the gate for changes that touch any of these areas:

- `internal/agents/codex/`
- app-server runtime validation scripts
- app-server planning, runtime, approval, transcript, or streaming docs
- request/response shapes for `initialize`, `thread/*`, `turn/*`, `item/*`, `model/*`, approval requests, or app-server filesystem/command helpers
- notification handling, tracing, reconciliation, or SSE projection sourced from app-server events

## Required Practice

1. Read the official app-server docs before implementation.
2. Use `github.com/pmenglund/codex-sdk-go` for Codex app-server lifecycle,
   JSON-RPC transport, request/response types, notifications, and server
   request handling.
3. Do not maintain a parallel local Codex SDK or checked-in protocol generator
   unless there is a documented blocker in the upstream package.
4. When docs or the SDK do not answer the question, inspect the upstream implementation
   under `codex-rs/app-server`.
5. Record validation evidence for the behavior being claimed. For runtime claims,
   use raw app-server traces where possible.
6. Keep Codex as the source of truth for sessions, approvals, artifacts, and
   transcript history. Do not add a second durable mirror of app-server state.

## Current Source Facts To Preserve

Treat these as prompts to re-check the docs when editing the connection path:

- App Server is the Codex integration intended for rich clients with
  authentication, conversation history, approvals, and streamed agent events.
- The default transport is `stdio` using newline-delimited JSON.
- A connection must send `initialize` and then the `initialized` notification
  before normal requests.
- Request, response, and notification shapes are version-sensitive. Regenerate
  or inspect schema artifacts from the Codex CLI when changing protocol fields.
- WebSocket transport is documented as experimental and unsupported; do not
  make it the v1 product dependency without new validation evidence.

## Local Harness

Use:

```bash
HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs
```

Only set `HOPTER_APP_SERVER_DOCS_REVIEWED=1` after reading the official docs for
the app-server work in progress.

If the change depends on behavior not described by the official docs, also read
the upstream source and set:

```bash
HOPTER_APP_SERVER_UPSTREAM_REVIEWED=1
```

The harness scans local changed files for app-server connection work. If it finds
that work without the docs acknowledgement, it reports a blocked validation run
and writes evidence under `storage/artifacts/validation/`.

Runtime Codex calls in this repo should go through the app-server client exposed
by `github.com/pmenglund/codex-sdk-go`. Do not add a second live-session path
based on `codex exec`, and do not check in a parallel locally generated Codex SDK
unless there is a documented upstream package blocker.

For branch-level checks, compare against a base ref:

```bash
HOPTER_APP_SERVER_DOCS_REVIEWED=1 bun scripts/validate-app-server-docs.ts --base origin/main
```
