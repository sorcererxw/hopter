# Go Rebuild Master Plan

## Status

Proposed active plan for the next architecture phase.

This document supersedes the Bun-first implementation direction in the older v1 planning set for any work that touches runtime, protocol, routing, frontend integration, or delivery workflow.

## Goal

Rebuild `hopter` as:

- a Go-native local control-plane service
- a React + Vite browser UI served through the Go server
- a Connect-based control-plane API with SSE for status notifications
- a production artifact where `ui/dist` is embedded into the Go binary and distributed from the same process

## Confirmed decisions

### Product model

- the primary product object remains the **session**
- the repo container concept is renamed from **binding** to **project**
- the main surface is a two-pane workspace:
  - left: session list
  - right: input + current session surface
- `/` is the default workspace shell
- `/sessions/:sessionId` is the selected-session route under the same shell

### Runtime and architecture

- backend runtime: **Go**
- HTTP router: **Go 1.22+ `http.ServeMux`**
- no third-party web framework in the default server path
- API contract: **Protobuf + Connect**
- realtime notification path: **single global SSE stream**
- terminal: out of scope for the current phase
- relay: deferred to a later phase
- development auth: **no password**, localhost-only
- development frontend serving: **Go reverse-proxies Vite**
- production frontend serving: **Go serves embedded `ui/dist`**

### Frontend stack

- React
- Vite
- pnpm
- TanStack Query for server state
- React state/context/reducer for UI state
- Tailwind CSS + HeroUI v3
- do not restore the old shadcn registry or generated primitive tree

### Repository shape

```text
/ui
/idl
/cmd
/internal
```

## Why this plan exists

The older Bun-first architecture optimized for fast shared-TypeScript delivery. The confirmed direction now optimizes for:

- a stable local daemon-like backend process
- a single Go distribution artifact
- a thin static web client with preserved React app capabilities
- an explicit cross-language protocol boundary
- a development model that still preserves good HMR and same-origin behavior

## Non-goals for this phase

- relay/tunnel delivery
- terminal streaming
- production-grade auth
- multi-user collaboration
- deep browser file editing
- preserving backward compatibility with the current Bun server implementation

## Delivery definition

The rebuild is ready for the next execution phase when a user can:

1. start the Go server locally
2. open the browser workspace through the Go entrypoint
3. see a session list on the left and a usable workspace pane on the right
4. create or select a project
5. create or resume a session
6. fetch and submit session data through Connect
7. receive status updates over the global SSE stream
8. refresh the browser and re-enter the selected session route without losing shell coherence
9. run the same product from a single Go binary with embedded `ui/dist`

## Execution strategy

Use a staged rebuild, not an in-place mixed runtime.

### Phase 0: decision lock and documentation

Deliverables:

- this master plan
- backend plan
- frontend plan
- IDL plan
- rebuilt UI design document

Exit criteria:

- active architecture decisions are recorded
- runtime/protocol/UI ambiguities are removed

### Phase 1: skeleton and runtime pivot

Deliverables:

- Go module root
- `/cmd/hopter` bootstrap
- `/internal` service skeleton
- `/ui` Vite app shell
- `/idl` Buf configuration
- localhost-only dev boot path

Exit criteria:

- Go process serves health endpoints
- Go can reverse-proxy the Vite dev server
- Vite UI is reachable through the Go port

### Phase 2: protocol and server backbone

Deliverables:

- first protobuf packages under `/idl/hopter/v1`
- Connect handlers mounted on `http.ServeMux`
- SSE event hub and global event stream
- auth bypass middleware for local dev
- project/session in-memory or file-backed repositories as needed for early boot

Exit criteria:

- browser workspace can list projects and sessions through Connect
- browser receives status events through `/events`

### Phase 3: workspace-first frontend rebuild

Deliverables:

- app shell route structure
- left rail session list
- right pane empty state/new session composer
- selected session route under `/sessions/:sessionId`
- TanStack Query cache integration
- SSE-driven cache invalidation/update path

Exit criteria:

- workspace flow is usable without legacy Bun UI dependencies
- selected session survives refresh via route state

### Phase 4: project/session product loop

Deliverables:

- project creation flow (`/projects/new` UI surface, whether route or modal launched from shell)
- session creation and resume
- session status/summary/attention/artifact metadata surfaces
- codex adapter contract boundary in Go

Exit criteria:

- one end-to-end local session loop is possible through the rebuilt stack

### Phase 5: production packaging

Deliverables:

- `ui/dist` production build
- Go `embed` integration
- static asset cache policy
- production UI handler with SPA fallback
- release/test docs updated for the new runtime

Exit criteria:

- one Go binary serves the full app in production mode

## Cross-cutting architecture rules

### 1. Keep the protocol boundary narrow

Use Connect for:

- host status
- project CRUD/listing
- session CRUD/listing
- session action submission
- artifact metadata

Do not use Connect for:

- static files
- large downloads
- future terminal byte streams

### 2. Keep dev/prod divergence isolated to UI sourcing

The only meaningful dev/prod split should be:

- dev: reverse-proxy UI requests to Vite
- prod: serve embedded UI files

Everything else should remain identical:

- route namespace
- Connect endpoints
- SSE endpoint
- middleware shape
- auth/dev-localhost rule

### 3. Treat the browser as a React app shell, not server-rendered HTML pages

The Go server serves the entry HTML, but the UI remains an app-like React control plane. This preserves:

- client routing
- cross-view UI state
- query cache reuse
- complex interaction patterns

### 4. Keep one global notification channel first

Use one SSE endpoint at first. Avoid early fragmentation into many channels.

### 5. Keep route namespace explicit

Reserve:

- `/rpc/*`
- `/auth/*`
- `/events`
- `/healthz`
- `/readyz`
- `/version`
- `/assets/*`

All other app routes should resolve to the SPA shell.

## Proposed repository transition map

### Existing areas that become legacy

- `src/server/*`
- `src/shared/*`
- `src/web/*`
- Bun-first bootstrap/build assumptions in the older docs

### New active areas

- `cmd/hopter`
- `internal/...`
- `ui/...`
- `idl/...`

## Risks

### Risk 1: mixed-runtime limbo

If the repo keeps both Bun-first and Go-first runtime assumptions alive for too long, execution will fragment.

Mitigation:

- treat the Go rebuild as the active path
- mark Bun runtime code and docs as legacy once the new skeleton lands

### Risk 2: over-designing proto before flow clarity

Mitigation:

- keep the first IDL surface narrow and session-first
- model only the control-plane contract actually needed by the workspace

### Risk 3: overbuilding frontend state complexity

Mitigation:

- use TanStack Query for server state only
- use React local state/context for UI state
- do not introduce a global client-state library by default

### Risk 4: dev/prod inconsistency from proxy shortcuts

Mitigation:

- Go remains the only browser entrypoint in dev
- proxy behavior lives in a dedicated UI source abstraction

## Verification plan

### Documentation and planning verification

- all new docs exist and reference the agreed runtime/protocol/UI shape
- docs index links to the new planning/design documents

### Early implementation verification

- Go can start on localhost and serve health checks
- Go can reverse-proxy the Vite app
- browser app can call a Connect endpoint through the Go origin
- browser app can receive SSE events through the Go origin

### Production verification

- `pnpm build` emits `ui/dist`
- Go binary embeds and serves `ui/dist`
- direct navigation to `/sessions/:sessionId` works with SPA fallback

## Immediate next artifacts

1. backend execution plan
2. frontend execution plan
3. IDL execution plan
4. rebuilt UI design doc
5. first-pass IDL service list and route namespace spec
