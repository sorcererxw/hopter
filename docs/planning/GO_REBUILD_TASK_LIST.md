# Go Rebuild Task List

## Goal

Deliver a Go + Connect + React/Vite rebuild that proves the browser workspace can create a Codex-backed session and steer it to produce a working Tetris web game.

This task list is implementation-oriented and supersedes older Bun-first execution tickets for all runtime, frontend, and protocol work in the active rebuild lane.

## End-state acceptance

The rebuild is successful when all of the following are true:

1. A Go server starts locally and remains the only browser entrypoint.
2. In dev, the Go server reverse-proxies the Vite UI while serving Connect + SSE directly.
3. In prod, the Go binary serves embedded `ui/dist`.
4. The workspace shell shows:
   - left rail session list
   - right pane composer / selected session surface
5. The UI can create a **project** and create/select a session.
6. The UI can send follow-up input to Codex through Connect.
7. The UI receives state-change notifications through the single SSE stream.
8. A user can drive Codex from the frontend to generate a playable Tetris web game.
9. Validation evidence is recorded for the end-to-end Tetris flow.

## Workstream map

- **Backend**: Go server, routing, Connect services, SSE, Codex integration, dev/prod UI serving
- **Frontend**: Vite app shell, React routes/layout, Connect-Web client, TanStack Query, SSE-driven refresh, Tetris flow UX
- **IDL**: protobuf schemas, Buf config, generated Go + TS artifacts
- **Validation**: automated build/lint/tests + browser flow proving frontend-to-Codex Tetris completion

## Phase 0 — planning lock

### T000
Create and keep current the active planning docs:

- `docs/planning/GO_REBUILD_MASTER_PLAN.md`
- `docs/planning/BACKEND_EXECUTION_PLAN.md`
- `docs/planning/FRONTEND_EXECUTION_PLAN.md`
- `docs/planning/IDL_EXECUTION_PLAN.md`
- `docs/planning/IDL_SURFACE_V1_DRAFT.md`
- `docs/planning/GO_REBUILD_TASK_LIST.md`
- `docs/product/UI_REBUILD_DESIGN_DOC.md`

Acceptance:

- all active decisions are reflected in docs
- docs index points to the active rebuild set

## Phase 1 — repository/runtime skeleton

### T101 Backend skeleton

Create:

- `go.mod`
- `cmd/hopter/main.go`
- `internal/app/*`
- `internal/http/*`

Acceptance:

- `go run ./cmd/hopter` starts
- `/healthz` and `/version` respond

### T102 Frontend skeleton

Create:

- `ui/package.json`
- `ui/vite.config.ts`
- `ui/src/main.tsx`
- Tailwind + HeroUI baseline

Acceptance:

- `pnpm --dir ui dev` runs
- `pnpm --dir ui build` emits `ui/dist`

### T103 Buf/codegen skeleton

Create:

- `idl/buf.yaml`
- `idl/buf.gen.yaml`
- generated outputs in:
  - `internal/gen/proto`
  - `ui/src/gen/proto`

Acceptance:

- `cd idl && buf lint`
- `cd idl && buf generate`

## Phase 2 — transport shell

### T201 Go dev UI reverse proxy

Implement a single UI source abstraction:

- dev: reverse-proxy browser UI requests to Vite
- prod: serve embedded `ui/dist`

Acceptance:

- browser opens only through Go origin in dev
- dev/prod divergence is isolated to the UI source layer

### T202 Connect route registration

Mount Connect handlers on `http.ServeMux`.

Required services:

- `HostService`
- `ProjectService`
- `SessionService`

Acceptance:

- Connect RPCs are reachable through Go
- no third-party Go router is required

### T203 SSE event hub

Implement:

- one global `/events`
- event fanout for host/session/project changes

Acceptance:

- browser receives reconnectable event stream
- backend mutations can trigger refresh cues

## Phase 3 — domain services

### T301 Project service

Implement:

- list projects
- create project
- optional get project

Acceptance:

- project flow works end to end via Connect
- product terminology uses **project**, not binding

### T302 Session service

Implement:

- list sessions
- get session
- create session
- send session input
- session artifact metadata

Acceptance:

- selected session route can fetch and render a session
- follow-up input can be submitted from the UI

### T303 Codex adapter bridge

Implement the first Go-side Codex runtime boundary needed to:

- create a session
- stream/update session state
- accept follow-up input
- collect summary/artifact metadata sufficient for the workspace

Acceptance:

- backend can create and update a real Codex-backed session
- session state reaches the UI through Connect + SSE

## Phase 4 — workspace UI

### T401 Workspace shell

Implement:

- `/`
- `/sessions/:sessionId`
- persistent left rail
- persistent right pane

Acceptance:

- shell remains mounted while switching sessions
- route change selects the active session

### T402 Server-state integration

Implement:

- TanStack Query providers
- Connect-Web client wrappers
- query keys for host/projects/sessions/session detail

Acceptance:

- UI data comes from generated clients + Query
- no ad hoc fetch state duplication

### T403 SSE-driven refresh

Implement:

- app-level `EventSource`
- query invalidation/patch strategy

Acceptance:

- backend state change updates visible UI without manual refresh

### T404 Project and session workflows

Implement:

- `/projects/new`
- empty-state composer on `/`
- selected-session input surface on `/sessions/:sessionId`

Acceptance:

- project creation works from the frontend
- session creation works from the frontend
- session input works from the frontend

## Phase 5 — Tetris proving flow

### T501 Tetris prompt flow

Create a repeatable browser flow that:

1. creates/selects a project
2. creates a session
3. sends the Tetris-building prompt
4. follows up as needed until Codex completes the game

Acceptance:

- the flow is encoded in a validation script or harness, not only manual notes

### T502 Tetris artifact verification

Verify that the produced output is actually a playable Tetris artifact.

Acceptance:

- generated game can be opened in the browser
- screenshot and/or gameplay evidence is captured
- evidence path is written under `storage/artifacts/validation/`

## Phase 6 — production packaging

### T601 Embedded UI serving

Implement:

- `embed` for `ui/dist`
- SPA fallback for app routes
- immutable asset caching for hashed resources

Acceptance:

- one Go binary serves the app in production mode

### T602 Release-readiness evidence

Run and record:

- proto generation
- Go tests
- frontend build/tests
- docs validation
- end-to-end Tetris validation

Acceptance:

- there is a single evidence bundle proving the target loop
- the tree is in a state that can be committed

## Parallelization lanes

### Backend lane ownership

- `go.mod`
- `cmd/hopter/**`
- `internal/**`
- `idl/**`
- build/run integration

### Frontend lane ownership

- `ui/**`
- shell/layout/routes
- generated client consumption
- project/session UX

### Validation lane ownership

- validation scripts
- browser flow verification
- evidence capture

## Definition of ready-to-commit

Tell the user the tree is ready to commit only when:

1. backend + frontend + validation work is integrated
2. required commands pass or any remaining failure is explicitly documented and accepted
3. end-to-end Tetris flow from frontend to Codex is proven with evidence
4. no known blocker remains on the critical product loop
