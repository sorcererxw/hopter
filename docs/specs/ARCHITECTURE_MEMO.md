# Architecture Memo

## Goal

Define the v1 technical architecture for a self-hosted gateway server and browser control plane for existing coding agents.

This memo is intentionally narrow.

It answers:

- what the gateway owns
- what Codex owns
- what the web client owns
- what the minimum shared contract is
- what must exist in v1 for the product to be real

It does not attempt to define a general agent platform.

## Architecture Principles

1. **Codex remains the execution and reasoning engine.**
2. **The gateway owns remote access, organization, ephemeral control-plane state, and UI-facing state.**
3. **The browser is never the source of truth for session state.**
4. **The first backend is Codex.** Future backends are allowed, but they do not drive v1 complexity.
5. **The adapter seam should be real but narrow.** We extract only what the Codex loop proves we need.
6. **The v1 runtime is Bun-first.** We do not design the core around Node-only infrastructure unless Bun forces it.
7. **The v1 product ships as a single-process monolith.** One Bun process owns API, WebSocket, in-memory control-plane state, PTY/process control, and static asset serving.
8. **Platform variance should be pushed downward.** Use third-party libraries for cross-platform behavior where reasonable, but keep gateway core logic behind stable local interfaces.
9. **Codex remains the source of truth for session content.** The gateway may store lightweight control-plane references and validation evidence, but it should not build a heavy shadow copy of session history, plans, or artifacts.

## System Overview

```text
Browser / PWA
   |
   | HTTPS / WebSocket
   v
Gateway Server
   |
   +--> Project Store
   |
   +--> Session Store
   |
   +--> Artifact Store / Cache
   |
   +--> Terminal / Process Layer
   |
   +--> Codex Adapter
            |
            v
       Codex app-server / Codex session runtime
            |
            v
       User machine filesystem, repo, worktree, MCP, credentials
```

## Runtime Shape

The gateway is a **single Bun process** with these responsibilities:

- serve HTTP API
- serve WebSocket updates
- serve built frontend assets
- keep minimal control-plane state in memory
- manage external Codex processes
- manage terminal sessions

This is intentionally not a split frontend/backend deployment in v1.
The browser remains a separate client, but the product is operationally one server process.

## Core Boundaries

### Codex owns

- model reasoning
- planning
- tool use
- command execution
- backend-native approvals and turn semantics
- backend-native session behavior

### Gateway owns

- project definitions
- mapping projects to repos and hosts
- remote browser access
- lightweight session references and UI-visible metadata
- live event translation
- auth and access control
- degraded-state handling
- reconnect and rehydration behavior

### Web client owns

- dashboard rendering
- project/session navigation
- approval and steer UI
- artifact inspection UI
- reconnect behavior as a client

## V1 Deployment Topology

### Supported host modes

1. **Mac host**
   - primary path for the wedge user
   - likely best shipped later as a desktop host app or a launch agent-backed process

2. **Linux host**
   - supported if Codex runtime and repo environment work

3. **Docker**
   - supported, but not the first-run optimized path

### Access modes

1. **Local-only**
   - gateway binds to localhost by default

2. **Self-managed remote**
   - user places gateway behind their own reverse proxy or tunnel

3. **Managed relay, later**
   - out of scope for v1 implementation, but v1 architecture should not block it

## Runtime and Infrastructure Choices

### Runtime

- Bun
- TypeScript
- Hono on Bun

### State retention

- in-memory repositories for project/session/auth/terminal state
- filesystem-backed artifact storage

### Process and terminal control

- Bun process primitives for spawning and supervising Codex
- Bun terminal/PTY primitives for interactive shell sessions
- no default dependency on `node-pty` in v1

### Frontend serving

- React app built with Vite
- static assets served by the gateway process

## Runtime-sensitive abstractions

The Bun constraint should stay below a few narrow interfaces.

Minimum interfaces worth isolating:

- `ProcessRunner`
- `TerminalDriver`
- `ArtifactStore`
- `StateStore`
- `SessionTransport`

This gives us one escape hatch if Bun runtime behavior differs from what a specific dependency expects.

## Cross-platform strategy

We should not try to hand-roll platform compatibility where a mature library or runtime primitive already solves it.

But we also should not let core product behavior depend directly on a third-party library's public API.

The rule is:

- prefer third-party libraries or Bun primitives for platform-sensitive behavior
- wrap them behind gateway-owned contracts
- validate the gateway contract, not the library brand

This applies most strongly to:

- terminal / PTY behavior
- process lifecycle control
- shell detection
- filesystem behavior
- long-running service integration

This keeps v1 realistic:

- macOS can be the primary supported platform
- Linux can remain a best-effort compatible target
- core product logic stays insulated from runtime or library churn

## Data Model

## Session source of truth

For v1, session truth is split intentionally:

- **Codex owns:** session content, session history, approval semantics, artifact semantics
- **Gateway owns:** project bindings, lightweight session references, connection state, UI attention state, auth state, validation evidence

The gateway should not try to become a second durable session store.
Its project/session/auth/terminal indexes should remain discardable runtime state.

The data model is project-first, but the UI should foreground active sessions.

### Project

Represents a gateway-known container for:

- repo path
- host identity
- default backend
- allowed access rules
- allowed repo/worktree scope

Minimum fields:

```text
Project
- id
- name
- repo_path
- host_id
- default_backend
- created_at
- updated_at
```

### SessionRef

Represents a session visible to the gateway and UI.

It is not the backend itself. It is the gateway's index record for a backend session.

Minimum fields:

```text
SessionRef
- id
- project_id
- backend
- backend_session_id
- title
- created_at
- updated_at
- last_event_at
- last_summary
- needs_attention
- attention_reason
- degraded
```

### ArtifactRef

Represents a UI-addressable artifact produced by a session.

Minimum fields:

```text
ArtifactRef
- id
- session_id
- type
- title
- storage_key
- created_at
- metadata
```

Artifact types needed in v1:

- summary
- log_chunk
- test_output
- screenshot
- changed_files

### AttentionItem

This is a derived view, not a canonical store.

Minimum fields:

```text
AttentionItem
- session_id
- project_id
- reason
- headline
- created_at
```

Reasons needed in v1:

- approval_required
- question_required
- failed
- completed
- degraded

## Codex Adapter

The Codex adapter is the only first-class backend in v1.

### Why Codex first

- best current fit with the intended workflow
- strong official protocol support
- explicit session and approval concepts
- best chance of building a real control plane, not a fake chat wrapper

### Adapter responsibilities

1. create a session
2. resume or attach to a session
3. subscribe to streamed events
4. translate backend events into the gateway event contract
5. submit approval responses
6. submit steer / follow-up input
7. interrupt or stop when supported
8. extract artifacts useful to the UI

### Adapter non-goals

- normalize every Codex-specific feature into generic abstractions
- expose arbitrary shell access
- invent a second plan/turn model on top of Codex

## Minimum Adapter Contract

This is the narrow seam we keep from day one.

```text
interface BackendAdapter {
  metadata(): BackendMetadata
  createSession(input): SessionCreateResult
  attachSession(input): SessionAttachResult
  sendInput(input): Ack
  respondToAttention(input): Ack
  interrupt(input): Ack
  streamEvents(input): AsyncEventStream
}
```

### BackendMetadata

```text
BackendMetadata
- id
- display_name
- capabilities
```

Capabilities needed in v1:

- create_session
- attach_session
- stream_events
- send_input
- approvals
- interrupt

### Event contract

The event contract should be UI-oriented, not agent-theory-oriented.

```text
GatewayEvent
- id
- session_id
- ts
- type
- payload
```

Types required in v1:

- `session.started`
- `session.updated`
- `plan.available`
- `attention.required`
- `checkpoint`
- `artifact.created`
- `session.completed`
- `session.failed`
- `session.degraded`

Important:

This is not a universal agent ontology.
It is only the minimum UI contract the gateway needs.

## Source of Truth and Rehydration

### Source of truth

- Codex backend session identity is the execution identity.
- Gateway runtime state is the current UI index while the process is alive.
- Browser holds no authoritative state.

### Reconnect model

If the browser disconnects:

- session continues if backend continues
- browser resubscribes and reloads from gateway HTTP state

If the gateway restarts:

- gateway starts with an empty in-memory control-plane index
- it must not fabricate restored project/session/auth state from stale local mirrors
- validation artifacts remain available from filesystem storage

## State retention

V1 runtime state should be local and discardable.

Recommended:

- in-memory stores for project/session/auth/terminal state
- filesystem-backed artifact storage

Why:

- keeps Codex as the only durable session truth
- avoids building a second history mirror
- makes restart semantics honest instead of speculative

### Logical stores

- projects
- sessions
- artifacts
- auth sessions

## Auth and Access Control

Security is a product requirement, not a later infra task.

### V1 requirements

1. local auth for browser access
2. explicit login session for remote access
3. per-project repo allowlist
4. no generic machine shell in the browser
5. actions are limited to:
   - session create
   - session attach
   - session approve/respond
   - session interrupt/stop
   - artifact read

### Local-only mode

- gateway binds localhost by default
- user can optionally expose it themselves

### Self-managed remote mode

- gateway supports trusted proxy configuration
- gateway requires auth even when behind proxy
- documentation must define the trust boundary clearly

### Managed relay readiness

V1 should not implement relay, but should keep room for:

- host-issued outbound connector
- browser-to-relay auth
- relay-to-host authenticated tunnel

## HTTP / WebSocket API Surface

The API should be small and boring.

### REST

```text
GET    /api/bindings
POST   /api/bindings
GET    /api/bindings/:bindingId

GET    /api/bindings/:bindingId/backend-sessions
POST   /api/bindings/:bindingId/backend-sessions

GET    /api/backend-sessions/:handleId
POST   /api/backend-sessions/:handleId/input
POST   /api/backend-sessions/:handleId/approve
POST   /api/backend-sessions/:handleId/interrupt

GET    /api/backend-sessions/:handleId/artifacts
GET    /api/artifacts/:artifactId

GET    /api/host/status
GET    /api/backends
```

### Streaming

Recommended:

- WebSocket for session live updates
- fallback path possible later if needed

Minimum subscription model:

```text
WS /ws
subscribe:
- dashboard
- project:<id>
- session:<id>
```

## UI Surfaces

### 1. Dashboard

Must answer:

- what needs my attention now
- what is currently running
- what just finished

### 2. Project detail

Must answer:

- what sessions belong to this repo
- how do I start or resume one
- what backend and host does this project use

### 3. Session detail

Must answer:

- what is happening right now
- what did the backend last say
- is action required from me
- what artifacts exist

The session page should be the deepest and most valuable v1 surface.

## Artifact Model

Remote usefulness depends on artifacts, not just raw event streams.

V1 should treat these as first-class:

1. latest human-readable summary
2. changed-files list
3. test output
4. screenshot references
5. recent log timeline

Nice-to-have later:

- patch previews
- file downloads
- richer diff inspection

## Reliability Model

These failure cases must be explicit in the implementation:

1. browser disconnect
2. gateway restart
3. host sleep/wake
4. Codex unavailable or incompatible
5. event stream interruption
6. artifact fetch failure

For v1, every one of these should degrade visibly instead of failing silently.

## Version Compatibility

The product is taking a dependency on upstream Codex interfaces.

So v1 needs:

- minimum supported Codex version
- startup compatibility check
- degraded or blocked behavior when version is unsupported
- explicit compatibility messaging in UI

Without this, upgrades will create random breakage.

## Project Setup Flow

The setup flow should be optimized for fast value, not admin ceremony.

### Proposed first-run flow

1. detect Codex
2. verify Codex compatibility
3. choose one repo
4. create project record
5. start first session

This means project-first in the model, but not heavy-project-first in the UX.

## Concurrency Rules

V1 does not need multi-user collaborative control.

But it does need clear single-user multi-device behavior.

Rules:

- multiple clients may observe the same session
- only one approval submission should win
- interrupt actions are idempotent
- stale browser views must revalidate before submitting actions

If there is conflicting control input:

- gateway uses backend state plus latest event time
- UI receives a conflict or stale-action error

## Observability

Even in v1, this product needs internal observability.

At minimum:

- gateway logs
- adapter logs
- backend compatibility checks
- session lifecycle audit log
- auth events

Useful counters:

- sessions_created
- sessions_resumed
- approvals_submitted
- reconnect_successes
- degraded_sessions
- backend_attach_failures

## Recommended Implementation Order

### Phase 1: Codex-only backbone

- local gateway process
- in-memory control-plane stores + filesystem artifacts
- Codex detection + compatibility check
- project create/list
- session create/list/detail
- live session event stream

### Phase 2: Remote control essentials

- approve/respond/interrupt actions
- artifact indexing
- degraded-state handling
- reconnect and clean restart semantics

### Phase 3: Access hardening

- local auth
- reverse-proxy-safe deployment guidance
- per-project repo allowlist
- compatibility messaging and diagnostics

### Phase 4: UX polish

- dashboard attention queue
- mobile-first refinements
- screenshots and richer session summaries

## Explicit Non-Goals

These are the things most likely to blow up v1 if allowed in early:

- generic backend abstraction for all current and future agents
- deep in-browser editing
- remote shell product
- team collaboration semantics
- managed relay service
- iOS native client
- multi-backend parity

## Open Questions

1. Can Codex sessions be adopted if they were started outside the gateway, or only if created by the gateway?
2. What exact Codex app-server fields should be kept in memory versus derived on demand?
3. Which artifacts are cheap enough to store eagerly, and which should be fetched lazily?
4. Should the host ship first as:
   - background server + web UI
   - desktop host app shell
   - both
5. What is the minimum secure auth flow for self-managed remote exposure?

## Recommendation

Implement the smallest real Codex loop first:

- one host
- one repo
- one project
- one remote session
- one browser attach
- one approval flow
- one reconnect flow

Then extract whatever abstractions survive contact with reality.

That is the whole game.
