# Codex Turn Pagination Transcript Plan

## Status

Proposed implementation plan.

## Problem

Long Codex sessions load slowly in the Hopter session pane.

The user-facing symptom is simple: opening a session can feel blocked before the
latest conversation content appears. The current implementation has two causes:

- Hopter asks Codex for `thread/read` with `includeTurns: true` even when the UI
  only needs the latest page.
- The browser then eagerly walks Hopter transcript cursors and loads all older
  pages in a loop.

That means a request that looks like "show the latest 50 transcript items" can
still force Codex to return the full stored thread history first.

## Official App Server Capability

Codex app-server has a purpose-built paginated turn API.

Official docs: https://developers.openai.com/codex/app-server#threads

Relevant behavior:

- `thread/read` reads stored thread metadata. With `includeTurns: true`, it
  returns the thread's turns. It is not the paginated transcript path.
- `thread/turns/list` pages through a stored thread's turn history without
  resuming the thread.
- `thread/turns/list` defaults to newest-first results, returns `nextCursor`
  for older turns, and returns `backwardsCursor` for newer turns from an earlier
  page.

Example app-server request:

```json
{
  "method": "thread/turns/list",
  "id": 20,
  "params": {
    "threadId": "thr_123",
    "limit": 50,
    "sortDirection": "desc"
  }
}
```

Example response shape:

```json
{
  "id": 20,
  "result": {
    "data": [],
    "nextCursor": "older-turns-cursor-or-null",
    "backwardsCursor": "newer-turns-cursor-or-null"
  }
}
```

## Current Repository Gap

The local `codex-sdk-go` version currently used by Hopter does not expose a
generated `thread/turns/list` helper.

Evidence:

- `internal/agents/codex/client.go` currently has `ReadThread` and
  `ReadThreadMeta`, both backed by `thread/read`.
- The generated SDK type for `ThreadReadParams` has only `threadId` and
  `includeTurns`.
- No generated `ThreadTurnsList` method or params type is present in the
  current local SDK module.

This is not a Codex app-server limitation. It is an integration gap in Hopter's
current client wrapper.

## Goals

- Opening a session should render the latest transcript page without requiring
  a full `thread/read(includeTurns=true)`.
- The browser should never pull all historical transcript content in one
  foreground loop.
- Background hydration should improve cache readiness without blocking user
  requests.
- Hopter should keep Codex as the transcript source of truth and avoid a second
  durable mirror of Codex session history.

## Non-Goals

- Do not persist a full normalized transcript database.
- Do not replace Codex app-server as the source of truth.
- Do not expose raw Codex cursors as public Hopter API details.
- Do not make the frontend responsible for Codex-specific turn pagination.

## Target Architecture

```text
Browser
  |
  | Connect: ListSessionTranscript(sessionId, beforeCursor, limit)
  v
Go SessionService
  |
  | Hopter transcript cursor + per-session read cache
  v
SessionReadModel
  |
  | thread/turns/list(threadId, cursor, limit, sortDirection)
  v
Codex app-server
```

The browser continues to consume Hopter transcript pages. The Go backend owns
the translation from Codex turns to Hopter transcript items.

## Request Flow

### Initial Session Open

1. Browser calls `GetSessionMeta`.
2. Browser calls `ListSessionTranscript` with no `beforeCursor` and a page size
   such as 50.
3. Backend calls `thread/turns/list` with `sortDirection: "desc"`.
4. Backend normalizes returned turns into Hopter transcript items.
5. Backend returns only the latest page plus an opaque Hopter cursor for older
   history.
6. Backend may start a low-priority hydration job.

### Older History Page

1. Browser calls `ListSessionTranscript` with Hopter `beforeCursor`.
2. Backend decodes that cursor to find the relevant Codex `nextCursor` or cache
   page.
3. Backend returns the next older Hopter transcript page.
4. Browser prepends the page without pulling the full history.

### Background Hydration

1. Backend starts or resumes a per-session hydration job after initial open or
   prewarm.
2. Hydration repeatedly calls `thread/turns/list` with `nextCursor`.
3. Hydration appends normalized pages into a process-local cache.
4. Hydration is low priority, cancellable, and globally limited.
5. When hydration reaches the end, backend marks the cache complete and emits an
   SSE hint so the browser can refetch if needed.

## Cursor Design

Hopter should keep its public cursor opaque. Do not pass Codex cursor strings
through directly as a stable API contract.

Proposed encoded cursor payload:

```json
{
  "kind": "codex-turns-page",
  "snapshotUnixMilli": 1777592026000,
  "codexNextCursor": "opaque-codex-cursor",
  "oldestOrderKey": "000000000012:000000000003:item-id",
  "cacheGeneration": 1
}
```

Rules:

- If `snapshotUnixMilli` no longer matches session metadata, restart at the
  latest page.
- If `codexNextCursor` is present and the cache misses, call
  `thread/turns/list`.
- If the cache has the requested page, return cache immediately.
- If cache hydration is in progress but the requested page is not present, do
  not block indefinitely on full hydration.

## Cache Design

Use a process-local read-through cache, not durable storage.

Cache key:

```text
sessionID + backendThreadID + snapshotUpdatedAt + pageSize
```

Cache state:

- `cold` - no transcript page cached.
- `partial` - latest page or some older pages cached.
- `hydrating` - background hydration is running.
- `complete` - all currently known historical pages are cached.
- `failed` - last hydration failed; page requests can still retry on demand.

Cache entry data:

- normalized Hopter transcript items
- page boundaries
- Codex `nextCursor` and `backwardsCursor`
- session snapshot timestamp
- generation number
- hydration status and error reason

Eviction:

- Keep bounded LRU behavior.
- Prefer evicting complete old sessions before active sessions.
- Do not cache pages whose estimated memory footprint exceeds the existing
  cache safety threshold unless the threshold is deliberately revised.

## Live Updates

Live app-server events should update the cache when possible.

Rules:

- `item/agentMessage/delta` patches the latest draft item.
- `item/completed` replaces the draft or appends the finalized item.
- `turn/completed` may trigger a targeted page refresh or cache reconciliation.
- `thread/rollback` invalidates or truncates affected cached pages.
- Reconcile-required events mark the cache stale and schedule hydration.

This keeps recent visible content hot without waiting for a full history scan.

## Backend Implementation Plan

### Phase 1: Add Raw Client Support

Add a raw app-server wrapper for `thread/turns/list` in
`internal/agents/codex/client.go`.

Define local types in Hopter until `codex-sdk-go` exposes generated ones:

```go
type ThreadTurnsListParams struct {
    ThreadID       string  `json:"threadId"`
    Cursor         *string `json:"cursor,omitempty"`
    Limit          *int    `json:"limit,omitempty"`
    SortDirection  string  `json:"sortDirection,omitempty"`
}

type ThreadTurnsListResult struct {
    Data            []ReadThreadTurn `json:"data"`
    NextCursor      *string          `json:"nextCursor,omitempty"`
    BackwardsCursor *string          `json:"backwardsCursor,omitempty"`
}
```

Use the existing low-level `c.call(...)` helper with method
`"thread/turns/list"`.

### Phase 2: Replace Latest Transcript Read Path

Change `SessionReadModel.loadLatestTranscriptPage` so Codex sessions use
`thread/turns/list` instead of `thread/read(includeTurns=true)`.

Important detail: Codex paginates turns, while Hopter paginates transcript
items. One turn can contain multiple displayable items. The backend may need to
fetch more than one turn page to produce 50 displayable Hopter items.

Rules:

- Fetch newest turns with `sortDirection: "desc"`.
- Normalize each returned turn with existing transcript item normalization.
- Reverse as needed so Hopter transcript items remain oldest-to-newest within a
  page.
- Stop once enough displayable Hopter items exist or Codex has no older cursor.
- Return `hasMoreBefore` based on Codex `nextCursor` or cached older pages.

Keep `thread/read` as a fallback only when `thread/turns/list` fails because the
installed Codex app-server is too old.

### Phase 3: Replace Older Page Path

Change `ListSessionTranscript(beforeCursor=...)` so Codex sessions use the
cursor-backed turn list path.

Rules:

- Prefer cached page hits.
- On cache miss, decode Hopter cursor and call `thread/turns/list`.
- Do not call `loadAndCacheTranscriptPages` as a synchronous full-history path
  for foreground page requests.

### Phase 4: Move Eager Full-History Loading Out Of The Browser

Update `ui/src/components/app/sessions/transcript/use-feed.ts`.

Remove the loop that fetches every older page in the foreground:

```ts
while (cursor && !cancelled) {
  const page = await fetchSessionTranscriptPage(sessionId, cursor)
  ...
}
```

Replace it with one of:

- fetch one older page when the user scrolls near the top, or
- fetch one older page when the user explicitly activates a load-more control.

The browser may still ask for older pages incrementally, but it should not own
full-history hydration.

### Phase 5: Add Backend Hydration

Add a low-priority background hydrator in `SessionReadModel`.

Rules:

- One global historical-hydration worker by default.
- Per-session duplicate hydration collapses through singleflight or a job map.
- Hydration writes pages into the process-local cache.
- Hydration never holds a foreground RPC open while it drains full history.
- Hydration emits an event when complete or failed.

### Phase 6: Wire Live Cache Updates

When live patches are generated from app-server notifications, update the
backend transcript cache for the active session.

This should be opportunistic. If the cache is absent, do not create a durable
mirror. If the cache is present, keep the newest page consistent.

## Frontend Behavior

Frontend API remains unchanged:

- `useSessionTranscript(sessionId, pageSize)` loads the newest page.
- `fetchSessionTranscriptPage(sessionId, beforeCursor)` loads one older page.

Frontend state rules:

- Render initial latest page as soon as it arrives.
- Keep `hasUnloadedTranscriptHistory` true while the backend reports older
  history.
- Never download every old page just because a session was opened.
- Preserve scroll position when prepending an older page.
- When an SSE hydrate-complete hint arrives, invalidate transcript queries only
  for the affected session.

## Compatibility Strategy

Some installed Codex versions or SDK wrappers may not support
`thread/turns/list`.

Fallback:

- Try `thread/turns/list`.
- If app-server returns method-not-found or unsupported-params, mark capability
  unavailable for that server process.
- Fall back to the current `thread/read(includeTurns=true)` implementation.
- Surface a degraded performance diagnostic in logs, not as user-facing noise.

This allows Hopter to ship the faster path while staying usable on older Codex
installations.

## Validation Plan

Backend tests:

- `ThreadTurnsList` raw client serializes `threadId`, `cursor`, `limit`, and
  `sortDirection`.
- Latest transcript page for Codex sessions calls `thread/turns/list`, not
  `thread/read(includeTurns=true)`.
- Older page request uses the encoded Codex cursor.
- One Codex turn with multiple items still produces correctly ordered Hopter
  transcript items.
- Fallback path still works when `thread/turns/list` is unavailable.
- Rollback or reconcile invalidates affected cache pages.

Frontend tests:

- Opening a session renders only the latest page.
- Older history appears only after top-scroll or load-more behavior.
- The browser does not loop through every cursor on initial open.
- Scroll position is preserved when older content is prepended.

Live validation:

- Create or select a long Codex session.
- Open the session route.
- Confirm raw app-server trace shows `thread/turns/list` for transcript pages.
- Confirm initial route load does not emit `thread/read` with
  `includeTurns: true`.
- Confirm old history can still be paged in.
- Confirm live new output appears and remains visible after a transcript refetch.

Recommended evidence paths:

- `storage/artifacts/validation/latest-app-server-docs.txt`
- `storage/artifacts/validation/latest-app-server-runtime.txt`
- a focused transcript pagination validation artifact under
  `storage/artifacts/validation/`

## Migration Notes

The older docs that say "`thread/read` for correctness" should be interpreted as
final reconciliation, not as the default paginated transcript read path.

After this migration:

- `thread/turns/list` is the normal historical transcript read path.
- `thread/read(includeTurns=true)` is a fallback or explicit reconciliation
  path.
- Live app-server notifications remain the low-latency path for active work.

