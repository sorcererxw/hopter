# Engineering Spec v1

## Goal

Turn the current product and architecture decisions into a buildable engineering spec for the first Bun-first gateway release.

This document fixes:

- repository layout
- runtime module boundaries
- HTTP API contract
- WebSocket event contract
- control-plane state model
- artifact storage layout
- page/component boundaries
- main request and event flows

It is intentionally opinionated.
It is written to support ticket breakdown and early implementation.

Companion documents:

- `docs/specs/COMMUNICATION_AND_UX_SPEC.md` for Codex communication policy and UI hierarchy
- `docs/planning/TASK_BREAKDOWN_V1.md` for milestone and ticket sequencing
- `docs/validation/VALIDATION_PROGRAM_V1.md` for PRD-driven self-verification and release gates

Working name:

- `orchd`

## Scope

This spec covers v1 only:

- single-user
- self-hosted
- Codex-first
- one Bun process
- one browser web app
- installable PWA baseline
- no managed relay
- no deep in-browser file editing
- no team collaboration

Session boundary:

- Codex is the source of truth for session content, history, and artifact semantics
- gateway stores only the minimal control-plane references it needs
- gateway should not build a heavy persistent mirror of Codex session content

Platform stance:

- macOS is the primary supported host for v1
- Linux should stay best-effort compatible where third-party libraries or runtime primitives make that cheap
- the product should avoid platform-specific core logic when a wrapped dependency can carry the variance

## Runtime Topology

```text
Browser
  |
  | HTTP + WebSocket
  v
Bun Gateway Process
  |
  +--> Hono HTTP router
  +--> WebSocket hub
  +--> Auth/session service
  +--> Project service
  +--> Session service
  +--> Artifact service
  +--> Host health service
  +--> Terminal service
  +--> Codex adapter
  +--> in-memory repositories
  +--> local filesystem storage
```

Operationally, v1 is one service.
The frontend is built separately by Vite, but shipped as static assets from the same gateway process.

## Repository Layout

The repo should stay flat and product-oriented, not split into fake packages too early.

```text
/src
  /server
    /bootstrap
    /config
    /http
      /routes
      /middleware
      /validators
    /ws
    /services
    /repositories
    /adapters
      /codex
    /terminal
    /artifacts
    /host
    /auth
    /types
  /web
    /app
      /routes
      /layouts
      /providers
    /features
      /auth
      /dashboard
      /projects
      /sessions
      /settings
      /terminal
      /artifacts
    /components
    /lib
    /styles
  /shared
    /contracts
    /domain
    /utils
/storage
  /artifacts
  /logs
/scripts
/docs
```

## Module Boundaries

### `/src/server/bootstrap`

Owns process startup:

- load config
- initialize in-memory repositories
- initialize services
- mount HTTP routes
- mount WebSocket handler
- serve frontend assets

### `/src/server/config`

Owns:

- env parsing
- default values
- reverse-proxy-related trust config
- artifact storage path config
- auth config

### `/src/server/repositories`

Owns raw state operations:

- projects
- sessions
- auth sessions
- terminal sessions
- validation runs or evidence metadata if needed

Repositories return data models.
They do not talk to Codex or WebSocket clients.

### `/src/server/services`

Owns business logic:

- create project
- create session
- attach session
- derive latest summary
- mark session degraded
- list attention items
- approve or reject pending request
- send follow-up input

Services are the main orchestration layer inside the gateway.

### `/src/server/adapters/codex`

Owns Bun-side Codex integration:

- Codex detection
- version checks
- launch or attach
- stream decode
- normalize events into gateway contract
- action submission

This module is allowed to know Codex specifics.
Other modules should not.

### `/src/server/terminal`

Owns:

- shell launch using Bun terminal/process primitives
- terminal session registry
- terminal stream bridge
- resize / input / close operations

This terminal is for user shell access, not for Codex's internal transport.

The terminal implementation must sit behind a gateway-owned `TerminalDriver` contract.
No page or service should depend directly on a PTY or terminal library API.

### `/src/server/artifacts`

Owns:

- validation artifact file naming
- optional temporary cache handling
- file reads for locally generated evidence

## Platform-sensitive implementation rule

When functionality is sensitive to OS/runtime differences, implementation should follow this order:

1. prefer Bun-native primitive if it is sufficient
2. otherwise prefer a mature third-party library
3. in either case, wrap usage behind a local gateway contract

This keeps product logic stable even if the underlying runtime or library choice changes later.

### `/src/server/ws`

Owns:

- websocket client registration
- auth gate for socket connections
- topic subscription rules
- fanout to dashboard/project/session scopes

### `/src/web/app`

Owns top-level app wiring:

- React Router tree
- Query provider
- auth bootstrap
- websocket connection provider
- app layout

### `/src/web/features/*`

Each feature owns:

- route-level screens
- feature-local hooks
- presentation components
- API query hooks
- feature-local state

No cross-feature imports except through shared primitives.

## Main Domain Types

These are gateway-owned domain types, not raw backend payloads.

### `Project`

```ts
type Project = {
  id: string
  name: string
  repoPath: string
  hostId: string
  defaultBackend: "codex"
  createdAt: string
  updatedAt: string
}
```

### `SessionRef`

```ts
type SessionRef = {
  id: string
  projectId: string
  backend: "codex"
  backendSessionId: string
  title: string | null
  status: "running" | "waiting_input" | "completed" | "failed" | "interrupted" | "degraded"
  lastSummary: string | null
  attentionReason: null | "approval_required" | "question_required" | "failed" | "completed" | "degraded"
  lastEventAt: string | null
  createdAt: string
  updatedAt: string
}
```

### `ArtifactRef`

```ts
type ArtifactRef = {
  id: string
  sessionId: string
  type: "summary" | "log_chunk" | "test_output" | "screenshot" | "changed_files" | "diff"
  title: string
  mimeType: string | null
  storageKey: string
  byteSize: number | null
  metadata: Record<string, unknown> | null
  createdAt: string
}
```

### `AttentionItem`

```ts
type AttentionItem = {
  sessionId: string
  projectId: string
  reason: "approval_required" | "question_required" | "failed" | "completed" | "degraded"
  headline: string
  createdAt: string
}
```

## HTTP API Contract

All API routes live under `/api`.
Responses use JSON only in v1.

### Envelope shape

Success:

```json
{
  "ok": true,
  "data": {}
}
```

Error:

```json
{
  "ok": false,
  "error": {
    "code": "BINDING_NOT_FOUND",
    "message": "Binding does not exist"
  }
}
```

## Auth APIs

### `POST /api/auth/login`

Request:

```json
{
  "password": "string"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "user": {
      "id": "local-user",
      "mode": "single-user"
    }
  }
}
```

Behavior:

- compares against host-configured single-user password
- sets HTTP-only auth cookie
- no JWT in v1

### `POST /api/auth/logout`

Response:

```json
{
  "ok": true,
  "data": {
    "loggedOut": true
  }
}
```

### `GET /api/auth/me`

Response:

```json
{
  "ok": true,
  "data": {
    "authenticated": true,
    "user": {
      "id": "local-user",
      "mode": "single-user"
    }
  }
}
```

## Host APIs

### `GET /api/host/status`

Response:

```json
{
  "ok": true,
  "data": {
    "hostId": "host_local",
    "status": "healthy",
    "codex": {
      "detected": true,
      "version": "x.y.z",
      "compatible": true
    },
    "storage": {
      "db": "healthy",
      "artifacts": "healthy"
    },
    "accessMode": "local_only"
  }
}
```

### `GET /api/backends`

Response:

```json
{
  "ok": true,
  "data": [
    {
      "id": "codex",
      "label": "Codex",
      "available": true,
      "capabilities": ["create_session", "attach_session", "approval", "interrupt", "artifacts"]
    }
  ]
}
```

## Project APIs

### `GET /api/bindings`

Response:

```json
{
  "ok": true,
  "data": {
    "items": []
  }
}
```

### `POST /api/bindings`

Request:

```json
{
  "name": "orchd",
  "repoPath": "/Users/me/src/orchd",
  "defaultBackend": "codex"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "binding": {}
  }
}
```

Validation:

- path must exist
- path must be inside allowlist rules if allowlist is enabled
- duplicate `repoPath` rejected

### `GET /api/bindings/:bindingId`

Response:

```json
{
  "ok": true,
  "data": {
    "binding": {},
    "health": {
      "status": "healthy"
    }
  }
}
```

### `PATCH /api/bindings/:bindingId`

Request:

```json
{
  "name": "new-name"
}
```

## Session APIs

### `GET /api/bindings/:bindingId/backend-sessions`

Response:

```json
{
  "ok": true,
  "data": {
    "items": []
  }
}
```

### `POST /api/bindings/:bindingId/backend-sessions`

Request:

```json
{
  "title": "Investigate reconnect behavior",
  "prompt": "trace the reconnect path and harden degraded-state handling"
}
```

Response:

```json
{
  "ok": true,
  "data": {
    "handle": {}
  }
}
```

Behavior:

- creates gateway session handle first
- launches backend session second
- marks session `degraded` if launch succeeds partially but gateway cannot maintain live attachment

### `GET /api/backend-sessions/:handleId`

Response:

```json
{
  "ok": true,
  "data": {
    "handle": {},
    "attention": null,
    "latestSummary": null,
    "artifacts": [],
    "terminal": {
      "available": true
    }
  }
}
```

### `POST /api/backend-sessions/:handleId/input`

Request:

```json
{
  "text": "Do not refactor unrelated files. Focus on reconnect handling."
}
```

### `POST /api/backend-sessions/:handleId/approve`

Request:

```json
{
  "decision": "approve",
  "note": null
}
```

Allowed `decision` values:

- `approve`
- `reject`

### `POST /api/backend-sessions/:handleId/interrupt`

Request:

```json
{
  "mode": "interrupt"
}
```

Allowed `mode` values:

- `interrupt`
- `stop`

### `POST /api/backend-sessions/:handleId/attach`

Purpose:

- re-attach gateway to an existing backend session already known by the gateway

Response:

```json
{
  "ok": true,
  "data": {
    "attached": true
  }
}
```

## Artifact APIs

### `GET /api/backend-sessions/:handleId/artifacts`

Response:

```json
{
  "ok": true,
  "data": {
    "items": []
  }
}
```

### `GET /api/artifacts/:artifactId`

Response shape depends on artifact type.

Examples:

For text-like artifacts:

```json
{
  "ok": true,
  "data": {
    "artifact": {},
    "content": "..."
  }
}
```

For binary image-like artifacts:

```json
{
  "ok": true,
  "data": {
    "artifact": {},
    "downloadUrl": "/api/artifacts/art_123/file"
  }
}
```

### `GET /api/artifacts/:artifactId/file`

Purpose:

- stream artifact file bytes directly

## Terminal APIs

Terminal is explicitly a secondary surface.
It should feel like a drawer, not like the product becomes a browser IDE.

### `POST /api/terminal/sessions`

Request:

```json
{
  "projectId": "proj_123",
  "cwd": "/Users/me/src/orchd"
}
```

Behavior:

- uses the user's default shell when possible
- shells into the project cwd by default

### `POST /api/terminal/sessions/:terminalSessionId/input`

Request:

```json
{
  "data": "ls -la\n"
}
```

### `POST /api/terminal/sessions/:terminalSessionId/resize`

Request:

```json
{
  "cols": 120,
  "rows": 36
}
```

### `DELETE /api/terminal/sessions/:terminalSessionId`

Purpose:

- close terminal session

## WebSocket Event Contract

The gateway should emit one normalized event format to the browser.
The browser should not need Codex-specific protocol awareness.

### Envelope

```ts
type GatewayEvent = {
  id: string
  scope: "dashboard" | "project" | "session" | "terminal"
  scopeId: string | null
  type: string
  ts: string
  payload: Record<string, unknown>
}
```

### Connection lifecycle

The socket should support:

- auth before subscription
- server-side subscription to project or session scopes
- reconnect with full query refetch on resume

The socket is for freshness, not for sole correctness.
HTTP remains the recovery path.

### Event types

#### Host events

- `host.status.updated`
- `backend.codex.updated`

#### Project events

- `project.created`
- `project.updated`
- `project.health.updated`

#### Session lifecycle events

- `session.created`
- `session.attached`
- `session.updated`
- `session.status.changed`
- `session.degraded`
- `session.completed`
- `session.failed`

#### Session content events

- `session.summary.updated`
- `session.attention.required`
- `session.attention.cleared`
- `session.event.appended`

#### Artifact events

- `artifact.created`
- `artifact.updated`

#### Terminal events

- `terminal.opened`
- `terminal.output`
- `terminal.closed`

### Minimal event payload examples

`session.status.changed`

```json
{
  "sessionId": "sess_123",
  "status": "waiting_input"
}
```

`session.attention.required`

```json
{
  "sessionId": "sess_123",
  "reason": "approval_required",
  "headline": "Codex needs approval to continue"
}
```

`artifact.created`

```json
{
  "sessionId": "sess_123",
  "artifactId": "art_123",
  "artifactType": "screenshot"
}
```

`terminal.output`

```json
{
  "terminalSessionId": "term_123",
  "chunk": "src\\nREADME.md\\n"
}
```

## In-Memory Control-Plane Stores

Important boundary:

- v1 should not persist full session content or full session event history as a gateway-owned store
- project/session/auth/terminal state is process-local and discardable
- validation artifacts remain durable on the filesystem

## Artifact Storage Layout

Store locally generated validation evidence outside the runtime stores.
Do not treat gateway-local files as the source of truth for Codex session content.

```text
/storage/artifacts/validation/
  /run_{runId}/
    /artifact_{artifactId}_{slug}
```

Examples:

- screenshot: `artifact_art_2_test-failure.png`
- validation summary: `artifact_art_3_validation-summary.md`

Rules:

- immutable once written
- text artifacts should be UTF-8

## Frontend Route Tree

```text
/
  /login
  /dashboard
  /bindings/new
  /bindings/:bindingId
  /backend-sessions/:handleId
  /settings
```

Suggested React Router shape:

```ts
createBrowserRouter([
  { path: "/login", element: <LoginPage /> },
  {
    path: "/",
    element: <AppLayout />,
    children: [
      { index: true, element: <Navigate to="/dashboard" /> },
      { path: "dashboard", element: <DashboardPage /> },
      { path: "bindings/new", element: <BindingCreatePage /> },
      { path: "bindings/:bindingId", element: <BindingDetailPage /> },
      { path: "backend-sessions/:handleId", element: <BackendSessionDetailPage /> },
      { path: "settings", element: <SettingsPage /> }
    ]
  }
])
```

## Page-level Component Boundaries

### `DashboardPage`

Owns:

- page query
- host status summary
- attention list
- running sessions list
- recent sessions list

Suggested breakdown:

- `DashboardShell`
- `HostStatusBanner`
- `AttentionList`
- `RunningSessionsList`
- `RecentSessionsList`
- `EmptyBindingsState`

### `ProjectCreatePage`

Owns:

- repo path input
- project name input
- backend selector
- validation errors

Suggested breakdown:

- `ProjectCreateForm`
- `RepoPathField`
- `BackendPicker`
- `ProjectCreateHelp`

### `ProjectDetailPage`

Owns:

- project header
- sessions list
- new-session CTA
- project health

Suggested breakdown:

- `ProjectHeader`
- `ProjectHealthBadge`
- `ProjectSessionList`
- `NewSessionInlineForm`

### `SessionDetailPage`

This is the main product surface.

Owns:

- session header and status
- summary
- pending attention block
- timeline
- artifact browser
- terminal drawer

Suggested breakdown:

- `SessionHeader`
- `SessionStatusBadge`
- `SessionSummaryPanel`
- `SessionAttentionCard`
- `SessionActionBar`
- `SessionTimeline`
- `ArtifactTabs`
- `ArtifactViewer`
- `TerminalDrawer`

### `SettingsPage`

Owns:

- host health
- Codex detection
- auth/session status
- local-only vs reverse-proxy mode description

Suggested breakdown:

- `HostHealthCard`
- `CodexStatusCard`
- `AccessModeCard`
- `SecurityNotesCard`

## Query Layer Boundaries

TanStack Query should own server state only.

Suggested query keys:

```ts
["auth", "me"]
["host", "status"]
["backends"]
["bindings"]
["binding", bindingId]
["binding", bindingId, "backendSessions"]
["backendSession", handleId]
["backendSession", handleId, "artifacts"]
["artifact", artifactId]
```

Mutation hooks:

- `useLoginMutation`
- `useCreateProjectMutation`
- `useCreateSessionMutation`
- `useSessionInputMutation`
- `useSessionApproveMutation`
- `useSessionInterruptMutation`
- `useCreateTerminalSessionMutation`

Socket events should usually do one of two things:

1. patch cached query data conservatively
2. invalidate specific query keys

Do not make the frontend depend on event ordering for correctness.

## Main Flows

### Flow 1: Create binding

1. user submits create-binding form
2. API validates repo path
3. service writes in-memory project entry
4. response returns created binding
5. frontend invalidates `["bindings"]`
6. frontend navigates to `/bindings/:bindingId`

### Flow 2: Create session

1. user submits prompt
2. gateway creates in-memory session entry with provisional status
3. Codex adapter launches backend session
4. gateway stores backend session id
5. gateway emits `session.created`
6. frontend navigates to session detail
7. live events stream in over WebSocket

### Flow 3: Approval required

1. Codex emits event that maps to approval-needed
2. gateway appends raw event transcript to artifact storage
3. gateway updates session status + attention reason
4. gateway emits `session.attention.required`
5. frontend surfaces action card
6. user clicks approve or reject
7. API posts decision
8. gateway forwards action to adapter
9. gateway clears attention on success

### Flow 4: Browser reconnect

1. browser loses socket
2. UI enters reconnecting state
3. query cache remains as stale visible state
4. browser reconnects socket
5. frontend refetches current page queries
6. UI returns to live state if host/session healthy

### Flow 5: Gateway restart truthfulness

1. gateway boots
2. starts with empty in-memory project/session/auth/terminal stores
3. serves validation artifacts that already exist on disk
4. requires new project/session creation or explicit future re-adoption flows

This avoids lying about restored live attachment.

## Error and Degraded State Policy

The UI should distinguish these clearly:

- `loading`: we do not know yet
- `empty`: there is simply no data
- `error`: request failed
- `degraded`: object exists, but live guarantees are broken
- `unavailable`: capability is absent on this host

This distinction matters more than visual polish in v1.

## Ticketing Recommendation

The first implementation tickets should be grouped in this order:

1. bootstrap + config + db
2. project repository + project routes
3. session repository + session routes
4. Codex adapter spike
5. websocket hub
6. dashboard and project pages
7. session detail page
8. approval / input / interrupt flow
9. artifact flow
10. terminal drawer
11. auth and reverse-proxy hardening

## Open Engineering Questions

These should be resolved in Milestone 0, not deferred forever:

1. What is the most reliable Bun primitive for interactive terminal sessions on macOS?
2. Which Codex events are stable enough to normalize directly, and which should stay raw?
3. What is the cleanest attach/resume behavior after gateway restart?
4. Should session summaries be derived eagerly on event ingestion or lazily on read?
5. Do screenshot and diff artifacts arrive directly from Codex, or do we need gateway-side extraction logic?
