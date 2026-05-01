# App Server Runtime Decision

## Status

Accepted for the Go-first rebuild.

## Decision

`hopter` v1 uses `codex app-server` as the only product session runtime
protocol.

That means:

- the live session path is app-server only
- browser writes go through Connect RPCs
- browser live updates come through the global SSE stream
- the Go server is the only Codex client
- `codex exec` / EEC is not the product runtime path

`exec` may still be useful for one-shot probes or validation tooling, but it must
not become the main remote-control session path.

## Runtime Shape

```text
Browser
  -> Connect mutations + SSE updates
  -> Go server
  -> codex app-server over stdio
  -> Codex thread runtime
```

State ownership:

- Codex owns transcript, thread history, approval semantics, and artifacts.
- Go owns projects, lightweight session references, auth state, attention state,
  and validation evidence.
- The browser owns page-local projection state only.

Do not persist a second durable mirror of Codex session history.

## Live Update Rule

Use app-server notifications for latency and targeted readback for correctness.

- Consume live deltas such as `item/agentMessage/delta`.
- Coalesce draft updates before publishing browser SSE patches.
- Reconcile with app-server readback after finalization, SSE reconnect, revision
  gaps, or explicit refresh.
- Do not poll to discover new text.
- Do not refetch full session state on every delta.

The browser should consume UI-facing Hopter events, not raw Codex protocol
envelopes.

## Approval Caveat

Approval remains part of the intended app-server protocol surface, but must not
be claimed complete until runtime evidence shows real `server_request` approval
events for the tested scenario.

Current validation stance:

- live draft deltas are runtime-proven
- finalization and reconciliation are runtime-proven
- approval request surfacing remains an explicit open release item

Relevant validation lanes:

- `make validate-app-server-runtime`
- `make validate-app-server-approvals`
- `HOPTER_APP_SERVER_DOCS_REVIEWED=1 make validate-app-server-docs`

## Related Docs

- [`CODEX_APP_SERVER_CONVERGENCE_PLAN.md`](CODEX_APP_SERVER_CONVERGENCE_PLAN.md)
  tracks remaining implementation work.
- [`CODEX_TURN_PAGINATION_TRANSCRIPT_PLAN.md`](CODEX_TURN_PAGINATION_TRANSCRIPT_PLAN.md)
  tracks transcript pagination and readback improvements.
- [`GO_REBUILD_VALIDATION_PLAN.md`](GO_REBUILD_VALIDATION_PLAN.md) tracks the
  validation lanes.
