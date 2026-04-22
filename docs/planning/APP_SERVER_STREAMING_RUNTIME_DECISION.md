# App Server Streaming Runtime Decision

## Status

Accepted for the Go-first rebuild.

## Decision

`hopter` v1 will use `codex app-server` as the only session runtime protocol.

That means:

- the live session path is `app-server` only
- browser updates are driven by server push, not polling
- browser transport remains `Connect + SSE`
- approval flow stays modeled on the `app-server` request/response path, but is not yet runtime-proven
- `codex exec` / EEC is removed from the product runtime path

This is the v1 product decision even though OpenAI still documents `exec` / SDK as a good fit for CI and one-shot automation. `hopter` is a session-centric remote control plane. The product gets more clarity from one runtime protocol than from broad interface coverage.

## Why this document exists

The repo already had the right architectural instinct:

- `AGENTS.md` and `docs/product/PRODUCT_MEMO.md` declare `codex app-server`
  as the main integration target. The older Bun-first communication spec is
  archived under `docs/archive/bun-first-v1/specs/`.
- `docs/planning/CODEX_APP_SERVER_CONVERGENCE_PLAN.md` already moves toward an app-server-first runtime
- `internal/agents/codex/client.go` already speaks to `codex app-server`

But one question remained open in practice:

Can `app-server` provide a good enough streaming interface to avoid polling and still keep the UI feeling immediate?

The answer is yes.

OpenAI's public guidance says:

- App Server exists to power rich clients with streamed agent events
- one client request can yield many event updates
- the protocol is fully bidirectional and server notifications are first-class

Sources:

- https://developers.openai.com/codex/app-server
- https://openai.com/index/unlocking-the-codex-harness/

## Product-level interpretation

For `hopter`, the right model is:

- notifications for latency
- `thread/read` for correctness

Do not:

- poll to discover new text
- refetch the full session on every delta
- mirror raw Codex event history into a second durable truth store

## Runtime architecture

```text
Browser
  |  Connect mutations + global SSE
  v
Go server
  |  JSON-RPC-like messages over stdio
  v
codex app-server
  |
  v
Codex thread runtime
```

### Browser to Go

- writes go through Connect RPCs
- live updates come from one global SSE stream
- browser never talks to Codex directly

### Go to Codex

- Go starts `codex app-server`
- Go sends `initialize`
- Go uses `thread/start` or `thread/resume`
- Go uses `turn/start` for the first turn
- Go uses `turn/steer` for follow-up turns

### State ownership

- Codex owns transcript, approval semantics, artifacts, and thread history
- Go owns projects, session references, auth state, lightweight attention state, and validation evidence
- browser owns only page-local projection state

## Streaming model

### Primary goal

Make the selected session pane feel close to character-by-character output without turning the backend into a refetch storm.

### Chosen strategy

- ingest `item/agentMessage/delta` from `app-server`
- append into an in-memory draft buffer
- coalesce updates in a short window
- publish SSE live patches to the browser
- patch the selected-session cache directly in the browser

### Aggregation window

Default target:

- 50-100ms coalescing window

This is fast enough to feel live and slow enough to avoid absurd fan-out.

### Minimum event set to consume

- `thread/started`
- `thread/status/changed`
- `turn/started`
- `item/started`
- `item/agentMessage/delta`
- `item/completed`
- `thread/tokenUsage/updated`
- `turn/completed`
- approval requests
- error and degraded notifications

## Reconciliation model

### Hot path

Use push updates only.

No polling.

No periodic `thread/read`.

### Cold path

Run `thread/read(includeTurns=true)` only when:

- `turn/completed` fires
- SSE reconnect happens
- a patch revision gap is detected
- the browser explicitly refreshes the selected session

### Why

This keeps the UI current from notifications while still recovering from dropped patches, browser reconnects, and early materialization races.

## Approval model

Approval remains part of the intended protocol surface, but must be treated as **not yet runtime-proven**.

Current evidence status:

- SSE draft deltas are runtime-proven
- finalize + reconcile patches are runtime-proven
- approval request surfacing is **not** runtime-proven under the current `app-server` behavior and runtime configuration

Latest evidence:

- `storage/artifacts/validation/app_server_runtime_2026-04-18T04-20-19-045Z`
- `storage/artifacts/validation/app_server_approvals_2026-04-18T04-25-33-618Z`

Rules:

- Go records the exact `app-server` request id for each pending approval
- Go maps the request into session attention state
- browser submits approve or reject through Connect
- Go replies to the original `app-server` request id

Do not:

- auto-approve on the product path
- invent a fake approval abstraction disconnected from the protocol

Current product constraint:

- remote approval UI may exist
- validation must not claim approval-complete until raw `app-server` traces show real `server_request` approval events for the tested scenario

## SSE event contract

Keep the existing global SSE endpoint.

Do not add a browser WebSocket protocol for session chat.

Extend the event payload so SSE can carry small live patches in addition to refresh hints.

Recommended patch kinds:

- `SESSION_STATUS_PATCH`
- `SESSION_DRAFT_DELTA`
- `SESSION_MESSAGE_FINALIZED`
- `SESSION_APPROVAL_REQUIRED`
- `SESSION_USAGE_PATCH`
- `SESSION_RECONCILE_REQUIRED`
- `SESSION_RECONCILED`

Recommended patch fields:

- `session_id`
- `revision`
- `kind`
- `active_turn_id`
- `draft_item_id`
- `draft_delta`
- `final_message`
- `pending_approval`
- `status`
- `requires_refetch`

The browser should consume these as UI-facing patches, not raw Codex protocol envelopes.

## Live session state in Go

Each live session keeps only small in-memory state:

- `threadID`
- `activeTurnID`
- `status`
- `assistantDraftByItemID`
- `inFlightItems`
- `pendingApprovalRequest`
- `tokenUsage`
- `lastEventAt`
- `revision`
- `needsReconcile`

Do not persist this as a second durable session mirror.

## Browser behavior

### During an active turn

- apply SSE draft patches directly into cache
- update the selected session transcript immediately
- avoid query invalidation per delta

### On finalization

- when `SESSION_MESSAGE_FINALIZED` arrives, finalize the message locally
- when `SESSION_RECONCILE_REQUIRED` arrives, run one `GetSession`

### On reconnect

- reconnect SSE
- fetch the current selected session once
- resume patch consumption

## `exec` / EEC removal

For v1, the target is hard removal from the main implementation.

This means:

- `internal/agents/codex/manager.go` no longer depends on `execTurns.Run(...)`
- `internal/agents/codex/sdk/*` is not used for the product runtime path
- `transcript_sdk.go` is removed or isolated behind a dead migration gate and then deleted
- validation and live-stack checks should exercise the same app-server session path as the product

Implementation guardrail:

- replace first
- delete second

The final state is still removal. This guardrail only prevents deleting the floor before the new path carries weight.

## File-by-file migration checklist

### 1. `internal/agents/codex/client.go`

- complete request and notification typing for the minimum event set
- add structured input builders for text and `localImage`
- add explicit approval request dispatch and response helpers
- expose a stable callback surface for notification fan-out

### 2. `internal/agents/codex/manager.go`

- add an app-server live turn runner
- keep per-session live draft state in memory
- route `CreateSession` and `SendSessionInput` through `app-server`
- trigger reconciliation on `turn/completed`
- remove primary turn execution dependency on `exec`

### 3. `internal/agents/codex/transcript.go`

- make `thread/read` the only durable transcript source
- merge in-memory live draft into the selected-session read model only while a turn is active

### 4. `internal/http/sse.go` and event hub code

- support session live patch payloads
- rate-limit per-session event flushes
- keep one global SSE stream

### 5. `idl/hopter/v1/events.proto`

- add a live patch payload shape
- keep refresh hints for coarse invalidation
- do not expose raw Codex protocol details

### 6. `idl/hopter/v1/session.proto`

- ensure create/send input shapes can carry structured input, model, and reasoning effort
- add approval response RPCs if not already present

### 7. `ui/src/lib/sse/use-workspace-events.ts`

- decode live patch events
- patch TanStack Query cache for the selected session
- trigger `GetSession` only for reconciliation events

### 8. `ui/src/features/sessions/*`

- distinguish draft assistant text from finalized transcript items
- preserve transcript ordering
- handle approval-required state as first-class attention

### 9. Validation scripts

- update live validation so it proves:
  - session creation via `app-server`
  - follow-up turn via `app-server`
  - live draft updates without polling
  - approval round-trip on the protocol path
  - transcript correctness after reconciliation

## Acceptance criteria

The redesign is not done until all of these are true:

1. A new session starts through `app-server` only.
2. A follow-up turn is sent through `app-server` only.
3. The browser shows assistant draft updates during a turn without polling.
4. The browser receives approval-required state in real time.
5. The user can approve or reject and the decision reaches the original `app-server` request id.
6. `turn/completed` triggers reconciliation and the transcript matches `thread/read`.
7. Refreshing the browser restores the correct selected-session state.
8. The product runtime no longer depends on `codex exec` / EEC.

At the moment, items 4 and 5 remain open because approval-request emission has not yet been observed in runtime validation.

## Validation evidence to record

When this work ships, record evidence for:

- live app-server transcript stream
- approval request and response round-trip
- no-polling browser update path
- final `thread/read` transcript reconciliation

Suggested evidence location:

```text
storage/artifacts/validation/<run-id>/
```

## Deferred questions

These are explicitly deferred, not unresolved blockers:

- whether future non-interactive automation should be rebuilt on top of `app-server`
- whether browser-side patch payloads should stay on SSE forever or later move to a finer-grained session stream
- whether terminal support should share the same event hub or use a parallel realtime path

None of those change the v1 runtime decision.
