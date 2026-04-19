# IDL Execution Plan

## Goal

Define and operationalize the cross-language contract for the rebuilt architecture using:

- Protobuf as the control-plane schema source of truth
- Connect as the browser-facing RPC transport
- Buf as the only code generation entrypoint

## Scope

Included:

- `/idl` layout
- Buf configuration
- first service boundaries
- generated Go and TypeScript outputs
- field naming and evolution rules

Excluded:

- terminal byte-stream protocols
- relay protocols
- generic public API versioning guarantees beyond the current rebuild phase

## Repository targets

```text
/idl
  /buf.yaml
  /buf.gen.yaml
  /hopter/v1/*.proto
```

Generated outputs should be checked into predictable generated-code locations chosen by the implementation, but generation itself must be driven only through Buf.

The current chosen output layout is:

- Go protobuf + Connect code -> `internal/gen/proto`
- TypeScript protobuf/Connect-Web code -> `ui/src/gen/proto`

## Contract principles

### 1. IDL is the control-plane truth source

Once the new stack lands, browser/server control-plane payloads should not be hand-maintained in parallel TypeScript and Go model files.

### 2. Keep the first protocol narrow

Only define what the new workspace needs immediately.

### 3. Separate control-plane RPC from file transport

Use Connect for structured control-plane RPCs.
Use plain HTTP for static assets and any future heavy downloads.

### 4. Prefer stable nouns and explicit methods

Use `Project`, not `Binding`.
Keep method names concrete and unsurprising.

## First-pass package layout

```text
hopter/v1/common.proto
hopter/v1/host.proto
hopter/v1/project.proto
hopter/v1/session.proto
hopter/v1/events.proto
```

This does not require five generated service surfaces if some messages remain shared-only; it simply keeps the domain boundaries clear from the start.

## First service boundaries

### HostService

Responsibilities:

- get host status
- get backend availability summary if needed
- expose environment readiness summaries needed by the UI

### ProjectService

Responsibilities:

- list projects
- create project
- get project details if required by the shell
- update/delete only if truly needed in the early phase

### SessionService

Responsibilities:

- list sessions
- get session detail
- create session
- submit follow-up input
- request approval response submission if that path remains relevant
- list summary/artifact metadata needed by the shell

## Event model

SSE is the transport, but the event payloads should still be defined intentionally.

Suggested first event envelope:

- event id
- event type
- occurred at
- optional session id
- optional project id
- compact payload for refresh or patch cues

The event model should optimize for browser refresh behavior, not full state mirroring.

## Message design rules

### Required rules

- use explicit response envelopes where helpful for future extension
- avoid UI-only wording in proto messages
- avoid transport-specific field names in domain messages
- reserve field numbers when removing fields
- keep message names stable and noun-based

### Avoid

- giant catch-all `WorkspaceState` messages
- generic `DoAction` or `MutateState` RPC methods
- deep nesting that mirrors frontend component trees

## Generated-code workflow

### Tooling

Use only Buf entrypoints from the repo root.

Expected top-level command shape:

- `buf lint`
- `buf generate`

### Go output

Generate:

- protobuf messages
- Connect handlers/clients for Go

Chosen output directory:

- `internal/gen/proto/hopter/v1/...`

### TypeScript output

Generate:

- protobuf/Connect-Web client artifacts used under `ui/src/lib/connect`

Chosen output directory:

- `ui/src/gen/proto/hopter/v1/...`

## Evolution strategy

The first protocol version should be `hopter.v1`.

Within the rebuild phase:

- breaking changes are allowed before the new stack is declared stable
- even so, use compatible message hygiene from day one

Once the rebuilt stack becomes the active implementation baseline:

- breaking changes must be intentional and reviewed
- event and RPC names should not casually churn

## Execution slices

### Slice 1: Buf scaffold

Deliverables:

- `idl/buf.yaml`
- `idl/buf.gen.yaml`
- generation targets wired into the repo workflow

Acceptance criteria:

- one command runs lint/generation deterministically

### Slice 2: core domain protos

Deliverables:

- `common.proto`
- `host.proto`
- `project.proto`
- `session.proto`
- `events.proto`

Acceptance criteria:

- the first UI surfaces can be expressed without ad hoc JSON-only contracts

### Slice 3: service generation integration

Deliverables:

- generated Go and TypeScript client/server artifacts
- backend/frontend imports wired to generated code

Acceptance criteria:

- frontend can call at least one generated Connect service
- backend can mount at least one generated Connect handler

## Risks and mitigations

### Risk: IDL models current frontend shapes too literally

Mitigation:

- model product/domain contracts, not component props

### Risk: overusing proto for non-RPC data paths

Mitigation:

- keep static assets and future heavy downloads on plain HTTP

### Risk: generated code paths become inconsistent

Mitigation:

- Buf is the only generation entrypoint
- document output paths once chosen and keep them stable

## Verification

- `buf lint`
- `buf generate`
- Go build using generated handlers/types
- UI build using generated Connect-Web client/types
