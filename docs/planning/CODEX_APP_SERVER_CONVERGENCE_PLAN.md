# Codex App Server Convergence Plan

## Status

Proposed implementation plan.

## Decision

`hopter` should converge its `server <-> codex` runtime to an **app-server-first** architecture.

That means:

- `codex app-server` becomes the single long-running session protocol for thread start, turn start, turn steering, approvals, live notifications, thread readback, and thread resume.
- `codex exec --experimental-json` is demoted to:
  - validation and probe tooling
  - one-shot automation where a session runtime is not needed
  - emergency fallback while migration is incomplete

This is the best-practice-aligned end state for `hopter` because the product is a session-centric remote control plane, not a one-shot CLI wrapper.

## Best-practice basis

OpenAI's public Codex guidance now positions **App Server** as the primary integration method for client and UI integrations, with `exec` positioned for one-shot automation and CI. The closest public statement is the OpenAI article "Unlocking the Codex Harness", which describes App Server as a client-friendly bidirectional JSON-RPC API with a stable UI-friendly event stream and states that customers are recommended to integrate through App Server by default.

Practical interpretation for `hopter`:

- use `app-server` for long-lived session runtime
- use notifications for low-latency live UI updates
- use `thread/read` for reconciliation and recovery
- do not treat `exec` as the main session protocol

## Problem statement

The current Go implementation is split across two runtime surfaces:

1. `internal/agents/codex/client.go`
   - starts `codex app-server`
   - speaks JSON-RPC-like requests over stdio
   - supports `initialize`, `thread/start`, `thread/list`, `thread/resume`, `thread/read`, `turn/start`, and `turn/steer`
2. `internal/agents/codex/sdk/*`
   - wraps `codex exec --experimental-json`
   - provides streamed turn execution and typed event decoding
3. `internal/agents/codex/manager.go`
   - still executes turns through `execTurns.Run(...)`
   - uses the app-server client mainly for listing, reading, and resuming threads

That split is serviceable as a transition, but it creates structural problems:

- two event models for the same product concept
- lifecycle differences between thread control and turn execution
- more transcript normalization paths than necessary
- harder recovery semantics
- drift risk between "officially preferred" and "actually used" transport

## Current factual baseline

### Repository evidence

- `internal/agents/codex/client.go` already contains the low-level app-server client.
- `internal/agents/codex/manager.go` still routes turn execution through the Go SDK `exec` wrapper.
- `internal/agents/codex/transcript.go` and `internal/agents/codex/transcript_sdk.go` already normalize two different item/event shapes.
- `AGENTS.md` and `docs/product/PRODUCT_MEMO.md` declare `codex app-server`
  the primary integration target. The older Bun-first communication spec is
  archived under `docs/archive/bun-first-v1/specs/`.
- `docs/planning/SESSION_DETAIL_CHAT_MODE_PLAN.md` already assumes `model/list`, `turn/start`, `turn/steer`, structured input, and live notifications on the app-server path.

### Live probe results on this machine

Validated on 2026-04-18 against `codex-cli 0.120.0`:

- `model/list` succeeds and returns:
  - model ids
  - supported reasoning efforts
  - default reasoning effort
  - input modalities
- `thread/start` accepts:
  - `model`
  - `effort`
- `turn/start` accepts:
  - `model`
  - `effort`
  - structured `input`
  - `localImage`
- live notifications observed during turns:
  - `thread/started`
  - `thread/status/changed`
  - `turn/started`
  - `item/started`
  - `item/completed`
  - `item/agentMessage/delta`
  - `thread/tokenUsage/updated`
  - `turn/completed`
- after a turn completes:
  - `thread/read(includeTurns=true)` succeeds
  - `thread/resume(...)` succeeds
- before first turn materialization:
  - `thread/read` may fail with "not materialized yet"
  - `thread/resume` may fail with "no rollout found"

This means the migration is **not blocked by missing app-server capability**. The real work is lifecycle handling and state reconciliation.

## Scope

This plan covers only the `server <-> codex` convergence.

In scope:

- app-server runtime transport
- thread and turn lifecycle
- notification handling
- approval and user-input protocol handling
- transcript normalization from app-server readback
- model and reasoning-effort discovery
- structured input mapping, including pasted images to `localImage`
- server-side validation and evidence

Out of scope for this document:

- broad workspace UI redesign
- dashboard IA changes
- new artifact viewer UX
- transport changes between browser and server beyond what is minimally required to expose new server-side capabilities

## Constraints

- Codex remains the source of truth for session content, history, approvals, and artifact semantics.
- `hopter` must not build a heavy persistent mirror of Codex history.
- Browser never talks to Codex directly.
- Go server remains the only Codex client.
- Validation evidence is required for completion.

## Target architecture

### Runtime contract

For a live session:

1. server starts or resumes a thread through `codex app-server`
2. server starts or steers turns through `turn/start` or `turn/steer`
3. server listens to app-server notifications for low-latency state changes
4. server maintains small ephemeral per-session live state only:
   - thread id
   - active turn id
   - assistant draft text
   - in-flight item map
   - last event timestamp
5. server reconciles final transcript through `thread/read`
6. server persists only lightweight session references and derived UI-facing fields

### Reconciliation model

Use:

- notifications for latency
- `thread/read` for correctness

Do not:

- trust deltas alone as durable truth
- require `thread/read` before first turn materialization
- assume `thread/resume` is always valid immediately after `thread/start`

### Approval model

All server-initiated approval and user-input requests must stay on the app-server path.

The server should map protocol requests into gateway approval state, but reply to the exact protocol request identity when the user acts.

The current auto-accept behavior in `internal/agents/codex/client.go` is acceptable for probes and temporary internal development, but not for the final control-plane product.

## Migration plan

### Phase 0: Lock the direction

Goal:

- align docs and implementation intent on app-server-first runtime

Changes:

- add this plan file
- update future execution docs only if needed after implementation slices prove out

Acceptance criteria:

- there is one unambiguous runtime target for long-lived Codex sessions

### Phase 1: Harden the low-level app-server client

Primary files:

- `internal/agents/codex/client.go`
- new focused tests under `internal/agents/codex/`

Work:

1. extend the request/response models to include the fields we have now probed:
   - `model/list`
   - `thread/start` result fields already returned by the server
   - `turn/start` and `turn/steer` result fields
2. add request builders for structured turn input:
   - text
   - image
   - localImage
3. replace ad hoc approval auto-replies with a typed request dispatch surface:
   - request id
   - method
   - params
   - response helper
4. formalize notification decoding for:
   - `turn/started`
   - `item/started`
   - `item/agentMessage/delta`
   - `item/completed`
   - `turn/completed`
   - error/degraded paths

Acceptance criteria:

- app-server client can represent all runtime inputs and notifications needed for migration
- tests cover decode/encode for the supported request and notification shapes

### Phase 2: Introduce an app-server live turn runner

Primary files:

- `internal/agents/codex/manager.go`
- new helper file under `internal/agents/codex/`

Work:

1. add an app-server-backed turn runner that:
   - starts or resumes a live client
   - chooses `turn/start` for first turn
   - chooses `turn/steer` for follow-up turn when the session already has an active turn contract
2. keep per-session live state in memory:
   - `threadID`
   - `activeTurnID`
   - `assistantDraft`
   - `itemDrafts`
   - `lastEventAt`
3. route live notifications into that state
4. on `turn/completed`, trigger `thread/read`
5. on process restart or cache miss, lazily `thread/resume` only when the thread is known to be materialized

Acceptance criteria:

- a session can complete a turn without going through `codex exec --experimental-json`
- the manager produces the same or better session state transitions as today

### Phase 3: Move transcript generation to one app-server path

Primary files:

- `internal/agents/codex/transcript.go`
- `internal/agents/codex/transcript_sdk.go`
- `internal/agents/codex/session_read_model.go`

Work:

1. make app-server `thread/read` the single source for historical transcript hydration
2. reduce `transcript_sdk.go` to a temporary compatibility layer only if still needed during migration
3. unify item normalization rules around app-server readback shapes:
   - `userMessage`
   - `agentMessage`
   - `reasoning`
   - `mcpToolCall`
   - `commandExecution`
   - `fileChange`
4. preserve the current product rule:
   - low-level protocol noise does not dominate the main transcript view

Acceptance criteria:

- one normalization path is used for durable transcript reads
- SDK-specific transcript normalization is removed or clearly isolated behind a temporary fallback gate

### Phase 4: Add model, effort, and structured input to the server API

Primary files:

- `idl/hopter/v1/common.proto`
- `idl/hopter/v1/session.proto`
- `idl/hopter/v1/host.proto`
- `internal/rpc/session_service.go`
- `internal/rpc/host_service.go`
- `internal/rpc/helpers.go`
- `internal/core/models.go`

Work:

1. add host-level model discovery RPC:
   - `HostService.ListModels`
2. extend create/follow-up session input to structured input items
3. add normalized reasoning-effort enums
4. surface per-session configured model and effort
5. support pasted images by writing temp files under a controlled runtime scratch root and passing `localImage` into app-server

Acceptance criteria:

- server API can express the full app-server turn contract needed by the product
- UI does not need to know raw Codex protocol field names

### Phase 5: Replace approval stubs with real protocol-mediated approval flow

Primary files:

- `internal/agents/codex/client.go`
- `internal/agents/codex/manager.go`
- `internal/rpc/session_service.go`
- related model helpers

Work:

1. track pending app-server approval requests as session attention state
2. expose approval identity and decision actions through the gateway API
3. route user decision back to the exact server request id
4. remove unconditional auto-approve behavior from the production path

Acceptance criteria:

- approvals are first-class protocol actions, not background auto-accept behavior
- interrupt / reject / approve flows are visible and testable

### Phase 6: Cut over the manager and demote `exec`

Primary files:

- `internal/agents/codex/manager.go`
- `internal/agents/codex/sdk/*`
- validation scripts

Work:

1. switch the manager's primary turn-execution path from `execTurns.Run(...)` to the app-server runner
2. keep `exec` only where intentionally needed:
   - validation probes
   - CLI parity package
   - explicit fallback paths
3. update comments and docs so the runtime story is no longer ambiguous

Acceptance criteria:

- live session runtime does not depend on `codex exec --experimental-json`
- app-server is the only primary session transport

## Recommended implementation order

Follow this order exactly:

1. Phase 1
2. Phase 2
3. Phase 3
4. Phase 5
5. Phase 4
6. Phase 6

Reason:

- runtime convergence should be proven before widening the public server API
- approval semantics should move before UI feature expansion depends on them
- model/effort/image API exposure is safer once the server runtime already owns those concepts end to end

## Risks and mitigations

### Risk 1: early materialization race

Problem:

- `thread/read` and `thread/resume` are not always valid immediately after `thread/start`

Mitigation:

- keep live state in memory during the first turn
- do not call `thread/read` until either:
  - first meaningful notification sequence has arrived, or
  - `turn/completed` fires
- treat first-turn recovery separately from steady-state resume

### Risk 2: notification drift versus readback truth

Problem:

- deltas may be incomplete, duplicated, or not shaped exactly as final transcript items

Mitigation:

- never treat deltas as durable truth
- always reconcile from `thread/read` on completion and reconnect

### Risk 3: approval regression

Problem:

- removing auto-approve can stall current flows if the product path is not ready

Mitigation:

- gate real approval mode behind an explicit rollout flag until end-to-end path is wired
- keep development-only auto-approve behavior only in probe/test helpers

### Risk 4: hidden UI dependence on exec event shapes

Problem:

- session summary and transcript behavior may implicitly depend on current SDK event timing

Mitigation:

- add adapter-layer tests around session state transitions
- compare app-server-driven runs and current behavior before cutover

## Verification plan

### Unit and integration

- request/response codec tests for `model/list`, `thread/start`, `turn/start`, `turn/steer`, `thread/read`, `thread/resume`
- notification decode tests for:
  - `item/agentMessage/delta`
  - `turn/completed`
  - approval-related server requests
- manager tests for:
  - first turn
  - follow-up turn
  - turn completion reconciliation
  - resume after process restart
  - approval pending state

### Live validation

Create a dedicated validation bundle under:

```text
storage/artifacts/validation/app_server_convergence_<timestamp>/
```

Required evidence:

- `model-list.json`
- `thread-start.json`
- `turn-start-text.json`
- `turn-start-local-image.json`
- `notifications.jsonl`
- `thread-read-completed.json`
- `thread-resume-completed.json`
- `approval-roundtrip.json`
- `summary.md`

### Product-level acceptance

The migration is complete only when all of the following are true:

1. a new session can be started through app-server only
2. a follow-up turn can be sent through app-server only
3. model and reasoning effort can be chosen and observed end to end
4. pasted image input is preserved as `localImage` and completes a turn
5. the session receives low-latency assistant deltas during execution
6. `turn/completed` triggers a successful reconciliation read
7. session recovery after process restart uses `thread/resume` plus `thread/read`
8. approval requests are surfaced and answered through app-server, not auto-accepted silently
9. no mainline live-session path depends on `codex exec --experimental-json`

## Cutover checklist

- app-server turn runner enabled by default
- manager no longer calls `execTurns.Run(...)` in mainline live-session flow
- transcript hydration uses app-server readback only
- approval flow uses real protocol request/response handling
- docs no longer describe `exec` as the primary live-session runtime
- validation evidence bundle recorded and linked from the relevant milestone docs

## Non-negotiable success condition

`hopter` should be able to truthfully say:

> The Go server uses `codex app-server` as the single long-running Codex session protocol. Live updates come from app-server notifications, and final session truth is reconciled from `thread/read`. `codex exec --experimental-json` is no longer the main runtime path for remote control-plane sessions.
