# IDL Surface v1 Draft

## Purpose

Turn the high-level IDL execution plan into a concrete first-pass control-plane contract draft for the rebuilt stack.

This document is intentionally narrow. It defines only the services and messages needed to make the first workspace loop real:

- list projects
- create a project
- list sessions
- select/open a session
- create a session
- submit follow-up input
- fetch summary and artifact metadata
- observe state changes through a single SSE stream

## Scope assumptions

- transport: Connect over HTTP
- notifications: SSE at `/events`
- no terminal protocol in this draft
- no relay protocol in this draft
- no production auth contract in this draft
- project replaces binding everywhere in the active contract design

## Package layout

```text
idl/
  orchd/v1/
    common.proto
    host.proto
    project.proto
    session.proto
    events.proto
```

Generated outputs currently land in:

- `internal/gen/proto/orchd/v1/...` for Go
- `ui/src/gen/proto/orchd/v1/...` for TypeScript

## Service overview

### HostService

Purpose:

- expose host health and environment readiness needed by the workspace header and shell bootstrap

Methods:

- `GetHostStatus`
- `ListBackends`

### ProjectService

Purpose:

- create and list local projects that back sessions

Methods:

- `ListProjects`
- `CreateProject`
- `GetProject` *(optional if the shell needs it immediately; otherwise can wait)*

### SessionService

Purpose:

- drive the main workspace loop

Methods:

- `ListSessions`
- `GetSession`
- `CreateSession`
- `SendSessionInput`
- `RespondToSessionApproval` *(keep only if approval survives the new first loop)*
- `ListSessionArtifacts`

## Route shape

Connect will generate the concrete RPC paths, but the namespace rule is:

- all control-plane RPCs live under `/rpc/...`
- all notifications live under `/events`
- all static assets live under `/assets/...`
- app routes like `/` and `/sessions/:sessionId` must never collide with machine routes

## Core domain messages

## `common.proto`

### `Timestamp` handling

Use protobuf timestamps for machine timestamps.

### `SessionStatus`

```text
SESSION_STATUS_UNSPECIFIED
SESSION_STATUS_PENDING
SESSION_STATUS_RUNNING
SESSION_STATUS_WAITING_INPUT
SESSION_STATUS_WAITING_APPROVAL
SESSION_STATUS_COMPLETED
SESSION_STATUS_FAILED
SESSION_STATUS_DEGRADED
```

### `ArtifactKind`

```text
ARTIFACT_KIND_UNSPECIFIED
ARTIFACT_KIND_SUMMARY
ARTIFACT_KIND_CHANGED_FILES
ARTIFACT_KIND_TEST_RESULT
ARTIFACT_KIND_SCREENSHOT
ARTIFACT_KIND_LOG
ARTIFACT_KIND_OTHER
```

### `ProjectRef`

Small reusable project reference:

- `id`
- `name`

### `SessionRef`

Small reusable session reference:

- `id`
- `title`
- `project` (`ProjectRef`)
- `status`
- `updated_at`
- `attention_required`

## `host.proto`

### `HostStatus`

Fields:

- `host_id`
- `status`
- `backend_status_summary`
- `project_count`
- `session_count`
- `updated_at`

`status` can stay simple at first:

```text
HOST_STATUS_UNSPECIFIED
HOST_STATUS_HEALTHY
HOST_STATUS_DEGRADED
HOST_STATUS_UNAVAILABLE
```

### `BackendStatus`

Fields:

- `backend_key` (for now likely `codex`)
- `available`
- `version`
- `reason`

### Requests / responses

#### `GetHostStatusRequest`

- empty

#### `GetHostStatusResponse`

- `host_status`

#### `ListBackendsRequest`

- empty

#### `ListBackendsResponse`

- `backends[]`

## `project.proto`

### `Project`

Fields:

- `id`
- `name`
- `root_path`
- `default_backend`
- `created_at`
- `updated_at`

### `ListProjectsRequest`

- empty at first

### `ListProjectsResponse`

- `projects[]`

### `CreateProjectRequest`

Fields:

- `name`
- `root_path`
- `default_backend`

### `CreateProjectResponse`

- `project`

### `GetProjectRequest`

Fields:

- `project_id`

### `GetProjectResponse`

- `project`

## `session.proto`

### `Session`

This is the full selected-session shape the right pane needs.

Fields:

- `id`
- `title`
- `project` (`ProjectRef`)
- `status`
- `summary`
- `attention_required`
- `attention_reason`
- `last_input_hint`
- `updated_at`
- `artifacts[]` (`ArtifactRef`)

### `SessionListItem`

This is the lighter left-rail item.

Fields:

- `id`
- `title`
- `project` (`ProjectRef`)
- `status`
- `updated_at`
- `attention_required`

### `ArtifactRef`

Metadata-only artifact description.

Fields:

- `id`
- `kind`
- `label`
- `created_at`
- `download_url`
- `content_type`

The browser uses this as metadata. Heavy/raw artifact bodies still stay on plain HTTP routes.

### Requests / responses

#### `ListSessionsRequest`

Optional fields:

- `project_id` *(optional filter)*
- `limit`

#### `ListSessionsResponse`

- `sessions[]` (`SessionListItem`)

#### `GetSessionRequest`

- `session_id`

#### `GetSessionResponse`

- `session`

#### `CreateSessionRequest`

Fields:

- `project_id`
- `title` *(optional)*
- `prompt`

#### `CreateSessionResponse`

- `session`

#### `SendSessionInputRequest`

Fields:

- `session_id`
- `input`

#### `SendSessionInputResponse`

Minimal first pass:

- `accepted`
- `session_id`
- `updated_at`

#### `RespondToSessionApprovalRequest`

Fields:

- `session_id`
- `approval_id`
- `decision`
- `comment` *(optional)*

`decision` enum:

```text
APPROVAL_DECISION_UNSPECIFIED
APPROVAL_DECISION_APPROVE
APPROVAL_DECISION_REJECT
```

#### `RespondToSessionApprovalResponse`

- `accepted`
- `session_id`
- `updated_at`

#### `ListSessionArtifactsRequest`

- `session_id`

#### `ListSessionArtifactsResponse`

- `artifacts[]`

## `events.proto`

SSE remains the wire transport, but we still define the payload shape here to keep event semantics stable.

### `WorkspaceEvent`

Fields:

- `id`
- `type`
- `occurred_at`
- `project_id` *(optional)*
- `session_id` *(optional)*
- `payload` (`WorkspaceEventPayload`)

### `WorkspaceEventType`

```text
WORKSPACE_EVENT_TYPE_UNSPECIFIED
WORKSPACE_EVENT_TYPE_HOST_STATUS_CHANGED
WORKSPACE_EVENT_TYPE_PROJECTS_CHANGED
WORKSPACE_EVENT_TYPE_SESSIONS_CHANGED
WORKSPACE_EVENT_TYPE_SESSION_CHANGED
WORKSPACE_EVENT_TYPE_SESSION_ARTIFACTS_CHANGED
```

### `WorkspaceEventPayload`

Keep this small and refresh-oriented.

Fields:

- `refresh_hint`
- `summary`

Where `refresh_hint` is an enum like:

```text
REFRESH_HINT_UNSPECIFIED
REFRESH_HINT_REFETCH_HOST
REFRESH_HINT_REFETCH_PROJECTS
REFRESH_HINT_REFETCH_SESSIONS
REFRESH_HINT_REFETCH_SESSION
REFRESH_HINT_REFETCH_ARTIFACTS
```

The point is not to mirror all state over SSE. The point is to let the browser refresh the right cache entry with confidence.

## Recommended generated service shape

These are the first service definitions I recommend.

### `host.proto`

```text
service HostService {
  rpc GetHostStatus(GetHostStatusRequest) returns (GetHostStatusResponse);
  rpc ListBackends(ListBackendsRequest) returns (ListBackendsResponse);
}
```

### `project.proto`

```text
service ProjectService {
  rpc ListProjects(ListProjectsRequest) returns (ListProjectsResponse);
  rpc CreateProject(CreateProjectRequest) returns (CreateProjectResponse);
  rpc GetProject(GetProjectRequest) returns (GetProjectResponse);
}
```

### `session.proto`

```text
service SessionService {
  rpc ListSessions(ListSessionsRequest) returns (ListSessionsResponse);
  rpc GetSession(GetSessionRequest) returns (GetSessionResponse);
  rpc CreateSession(CreateSessionRequest) returns (CreateSessionResponse);
  rpc SendSessionInput(SendSessionInputRequest) returns (SendSessionInputResponse);
  rpc RespondToSessionApproval(RespondToSessionApprovalRequest) returns (RespondToSessionApprovalResponse);
  rpc ListSessionArtifacts(ListSessionArtifactsRequest) returns (ListSessionArtifactsResponse);
}
```

## Browser usage model

### On first shell load

The browser will likely need:

1. `GetHostStatus`
2. `ListProjects`
3. `ListSessions`

### On selected session route

The browser will additionally call:

4. `GetSession`
5. `ListSessionArtifacts` *(or artifacts already folded into `GetSession` if that ends up simpler in v1)*

### On mutation

The browser will call:

- `CreateProject`
- `CreateSession`
- `SendSessionInput`
- optionally `RespondToSessionApproval`

Then rely on:

- direct mutation result
- SSE refresh hints
- TanStack Query invalidation

## Open decisions intentionally left open

### 1. Should `GetSession` already include artifacts?

Two valid options:

- include compact artifact metadata in `GetSession` for fewer requests
- keep `ListSessionArtifacts` separate for cleaner surface boundaries

Recommendation:

- start with `GetSession` including compact artifact metadata
- keep `ListSessionArtifacts` only if separate refresh cadence becomes valuable

### 2. Do we need `GetProject` immediately?

Recommendation:

- optional in the first slice
- keep it in the draft so the namespace remains clean if it becomes useful quickly

### 3. Do we need approval RPCs in slice one?

Recommendation:

- include the message shape now only if approval is still central in the earliest session loop
- otherwise defer it until the Codex flow actually needs it

## Verification checklist

- the full shell boot flow can be expressed through the listed RPCs
- selected session route can be expressed through `GetSession`
- SSE events only carry refresh/patch cues, not a second full state model
- no heavy file transfer is forced into Connect
- generated TypeScript clients map cleanly into TanStack Query hooks
- generated Go handlers map cleanly into `http.ServeMux`

## Immediate next implementation follow-up

1. create actual proto files under `idl/orchd/v1`
2. create `buf.yaml` and `buf.gen.yaml`
3. choose generated output paths for Go and TypeScript
4. wire one `HostService` RPC end to end through Go + UI
5. wire one `SessionService` RPC end to end through Go + UI
6. wire the global `/events` SSE endpoint to the `WorkspaceEvent` envelope
