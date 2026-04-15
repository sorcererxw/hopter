# Backend Execution Plan

## Goal

Build the new Go backend that becomes the single runtime entrypoint for:

- Connect APIs
- SSE notifications
- dev-mode reverse proxy to Vite
- prod-mode embedded UI serving
- project/session control-plane orchestration

## Scope

Included:

- Go module bootstrap
- `cmd/orchd`
- `internal` package layout
- `http.ServeMux` routing
- Connect handler registration
- SSE event fanout
- localhost-only dev auth bypass
- dev UI reverse proxy
- prod embedded UI file serving

Excluded in this plan:

- relay
- terminal
- production auth
- database hardening beyond what the first loop requires

## Repository targets

```text
/cmd/orchd
/internal/app
/internal/http
/internal/rpc
/internal/core
/internal/store
/internal/events
/internal/static
```

## Workstreams

### A. Bootstrap and configuration

Create:

- `cmd/orchd/main.go`
- `internal/app/config.go`
- `internal/app/bootstrap.go`

Requirements:

- one process starts with explicit config
- config supports:
  - bind host/port
  - dev UI proxy URL
  - dev mode flag
  - localhost-only guard
- dev mode must default to localhost-safe assumptions

Acceptance criteria:

- `go run ./cmd/orchd` starts a server
- `/healthz` and `/version` respond
- config errors fail fast with actionable output

### B. Route tree and HTTP entrypoint

Use Go 1.22+ `http.ServeMux`.

Required route groups:

- `GET /healthz`
- `GET /readyz`
- `GET /version`
- `GET /events`
- `POST /rpc/...` via Connect handlers
- UI paths served through a single UI handler abstraction

Acceptance criteria:

- route namespace is explicit and conflict-free
- app routes and machine routes do not collide
- `/sessions/:sessionId` ultimately resolves through SPA fallback in prod and Vite in dev

### C. UI source abstraction

Create an explicit abstraction for UI requests.

Implementations:

1. **Dev UI source**
   - reverse-proxies browser UI requests to the Vite dev server
2. **Embedded UI source**
   - serves `ui/dist` from `embed.FS`
   - serves hashed assets directly
   - falls back to `index.html` for app routes

Acceptance criteria:

- dev/prod divergence is isolated to this layer
- Connect/SSE/auth behavior does not fork between dev and prod

### D. Connect service registration

Mount Connect-generated handlers directly onto `http.ServeMux`.

First service families:

- HostService
- ProjectService
- SessionService

Acceptance criteria:

- handlers register without a third-party web framework
- Go origin serves all browser-facing Connect routes
- middleware can wrap Connect uniformly

### E. SSE event system

Create a single global SSE endpoint.

Initial event classes should support:

- host status updates
- project list or project health updates as needed
- session list updates
- session state changes
- artifact metadata refresh signals

Design constraints:

- server owns canonical event emission
- frontend treats SSE primarily as refresh/patch signals, not as the sole state source

Acceptance criteria:

- `/events` supports reconnectable event streaming
- one browser client can receive state updates after a mutation

### F. Local development auth rule

Because development auth is intentionally weak, enforce these conditions:

- localhost binding only by default
- no password prompt in dev mode
- any non-local bind must require explicit opt-in later

Acceptance criteria:

- local development is frictionless
- the weak-auth path cannot silently expose a network-accessible dev server by default

### G. Project/session service backbone

Build the minimum core services needed by the UI.

Minimum capabilities:

- list projects
- create project
- list sessions
- get session
- create session
- submit follow-up input
- request summary/artifact metadata

Implementation rule:

- service interfaces live in `internal/core`
- transport-specific code lives in `internal/rpc` and `internal/http`
- stores should not know about Connect or SSE

Acceptance criteria:

- backend service layer is transport-agnostic
- session and project flows are executable from the new UI

## Suggested implementation order

1. bootstrap/config
2. route tree and health/version endpoints
3. dev UI reverse proxy
4. embedded UI handler
5. Connect registration scaffold
6. SSE hub
7. project/session service backbone
8. codex adapter bridge after the transport shell is ready

## Risks and mitigations

### Risk: too much runtime logic in `main`

Mitigation:

- keep `main` as thin composition only
- all setup belongs in `internal/app`

### Risk: proxy logic leaks into unrelated handlers

Mitigation:

- all dev/prod UI source logic goes behind one handler factory

### Risk: Connect handlers dominate domain design

Mitigation:

- define domain services first
- generated Connect glue should stay thin

## Verification

- `go test ./...`
- local browser access through Go origin while Vite runs separately
- direct check of Connect endpoint responses
- direct check of SSE stream reconnection
- production-mode run serving embedded `ui/dist`
