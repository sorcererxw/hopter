<!-- /autoplan restore point: /Users/sorcererxw/.gstack/projects/unknown/master-autoplan-restore-20260422-123919.md -->

# Session List Real State Plan

Status: draft reviewed by `/autoplan`
Date: 2026-04-22
Branch: master

## Problem

The session rail currently exposes only coarse `SessionStatus` values from Codex
thread metadata and Hopter local session state. Users need three higher-signal list
states:

1. a session is actively working, ideally "reasoning" when that is proven
2. a session has finished since the user last saw it
3. a session has finished and the user has already seen that completion

The design must be truthful. Hopter must not pretend it knows Codex internals that
Codex did not expose, must not use generic `updated_at` as a proxy for "new result",
and must not build a persistent mirror of Codex transcript history.

## Current Evidence

- `ListSessions` returns `SessionListItem`, currently `id`, `title`, `project`,
  `status`, `updated_at`, `attention_required`, and `backend_key`.
- Codex app-server list integration currently decodes `ThreadRecord.status.type`
  only.
- `mapThreadStatus` maps `active` to `running`, `idle` and `notLoaded` to
  `completed`, `systemError` to `failed`.
- Live selected-session updates already flow through `SessionLivePatch` over SSE.
- The UI rail currently shows a spinner for `running` and a dot for completed.

## Design Principles

1. Keep Codex as source of truth for execution and transcript state.
2. Let Hopter own only UI-facing control-plane state and read markers.
3. Separate execution truth from user visibility state.
4. Surface confidence. "Reasoning" requires evidence; otherwise say "running".
5. Preserve backward compatibility by adding fields instead of changing
   `SessionStatus` semantics.

## Proposed Contract

Add factual list signals alongside the existing coarse `SessionStatus`. The server
owns cross-device read truth for the current single-user install. The frontend owns
only final visual styling.

```proto
enum SessionActivityPhase {
  SESSION_ACTIVITY_PHASE_UNSPECIFIED = 0;
  SESSION_ACTIVITY_PHASE_RUNNING = 1;
  SESSION_ACTIVITY_PHASE_REASONING = 2;
  SESSION_ACTIVITY_PHASE_STREAMING_RESPONSE = 3;
  SESSION_ACTIVITY_PHASE_TOOL_CALL = 4;
  SESSION_ACTIVITY_PHASE_WAITING_APPROVAL = 5;
}

enum SessionMeaningfulEventKind {
  SESSION_MEANINGFUL_EVENT_KIND_UNSPECIFIED = 0;
  SESSION_MEANINGFUL_EVENT_KIND_FINAL_AGENT_MESSAGE = 1;
  SESSION_MEANINGFUL_EVENT_KIND_TERMINAL_TURN = 2;
  SESSION_MEANINGFUL_EVENT_KIND_APPROVAL_REQUEST = 3;
  SESSION_MEANINGFUL_EVENT_KIND_FAILURE = 4;
}

message SessionListItem {
  string id = 1;
  string title = 2;
  ProjectRef project = 3;
  SessionStatus status = 4;
  google.protobuf.Timestamp updated_at = 5;
  bool attention_required = 6;
  string backend_key = 7;
  SessionActivityPhase activity_phase = 8;
  SessionMeaningfulEventKind latest_meaningful_event_kind = 9;
  string latest_meaningful_event_id = 10;
  google.protobuf.Timestamp latest_meaningful_event_at = 11;
  bool has_unseen_meaningful_event = 12;
  google.protobuf.Timestamp seen_meaningful_event_at = 13;
  string status_source = 14;
  SessionVerificationState verification_state = 15;
  google.protobuf.Timestamp verified_at = 16;
}

message SessionMeta {
  // existing fields...
  SessionActivityPhase activity_phase = 16;
  SessionMeaningfulEventKind latest_meaningful_event_kind = 17;
  string latest_meaningful_event_id = 18;
  string latest_meaningful_event_order_key = 19;
  google.protobuf.Timestamp latest_meaningful_event_at = 20;
}

enum SessionVerificationState {
  SESSION_VERIFICATION_STATE_UNSPECIFIED = 0;
  SESSION_VERIFICATION_STATE_VERIFIED = 1;
  SESSION_VERIFICATION_STATE_UNVERIFIED = 2;
  SESSION_VERIFICATION_STATE_STALE = 3;
  SESSION_VERIFICATION_STATE_BACKEND_UNAVAILABLE = 4;
}
```

`status` remains the execution state. `activity_phase` is optional detail for active
sessions. `latest_meaningful_event_*` is a small result watermark, not a transcript
mirror. `has_unseen_meaningful_event` is computed by the server from the current
browser/device marker. The same watermark fields must exist on `SessionMeta`, because
the detail page cannot mark a result seen unless it can name the exact rendered
watermark.

`SessionListDisplayState` is a frontend-only TypeScript view model, not a protobuf
contract. That prevents a split brain between server facts and rail presentation.

## Truth Rules

### Active / Reasoning

Use `activity_phase = REASONING` only if one of these is true:

- a live app-server notification or readback item explicitly identifies reasoning
- the latest transcript item kind is `reasoning` and the active turn is still
  in progress

Use `activity_phase = RUNNING` when:

- Codex thread list says `status.type == active`
- `thread/read` has a latest turn with `status == inProgress`
- Hopter has an optimistic active turn after `turn/start`

Do not infer "reasoning" from silence. Silence means running with unknown phase.
The primary rail label remains "working" unless reasoning is explicitly proven.

### Finished Unread

Display `FINISHED_UNREAD` when:

- execution status is terminal-success (`completed`), and
- `has_unseen_meaningful_event` is true

Display `FAILED_UNREAD` by the same rule for `failed` or degraded terminal states.
Waiting approval remains `ATTENTION`, not finished unread.

### Finished Read

Display `FINISHED_READ` when:

- execution status is terminal-success (`completed`), and
- `has_unseen_meaningful_event` is false

Display `FAILED_READ` for failed/degraded terminal states after the user has seen
them.

## Read Marker Scope

Use a server-side, device-scoped marker first:

- browser local storage key: `hopter.deviceId.v1`
- server state: `device_id -> canonical_session_key -> seen_meaningful_event_order_key`
- canonical key: `(backend_key, backend_thread_id)` when a backend thread exists,
  otherwise local `session_id` before materialization
- migrate markers from local `session_id` to backend thread key when the thread id
  becomes known
- update after a selected session receives a terminal completion patch and the
  reconciled meaningful event is visible
- update on explicit detail load, not on passive rail rendering
- reject stale marker writes by comparing event order keys monotonically

No user auth identity is required for v1. Hopter is a single-user local control
plane today, so the install can safely store device-scoped read markers without
claiming multi-user semantics. If real auth appears later, migrate the key from
`device_id` to `user_id + device_id`.

This marker is lightweight control-plane state. It does not mirror session history.
Store it in a tiny versioned durable Hopter control-plane store, not in Codex and not
in the transcript read model. Validate and cap `device_id` and event key lengths, do
not log device ids, and garbage-collect markers for sessions that no longer resolve.

## Priority Order

The rail derives display state in this order:

1. `attention_required` or waiting approval -> `ATTENTION`
2. failed/degraded with actionable latest event -> `FAILED_UNREAD` or `FAILED_READ`
3. running/active turn -> `RUNNING` with optional phase detail
4. terminal success with unseen meaningful event -> `FINISHED_UNREAD`
5. terminal success without unseen meaningful event -> `FINISHED_READ`
6. fallback pending/unknown -> current coarse status

Session rail ordering must use this same priority before recency. Current recency-first
sorting is not enough because the session the user needs can be buried below recent
but already-read rows.

Ordering:

1. attention
2. failed or degraded with unseen meaningful event
3. finished with unseen meaningful event
4. running
5. failed/degraded seen
6. finished seen, sorted by recency

The rail visibility cap must not hide `attention`, `failed unread`, or `finished
unread` rows. If the visual cap remains 30, pinned actionable/unread rows are included
first, then the remaining slots are filled by recency.

## Stale And Unavailable State

Codex `notLoaded` currently maps to `completed`. For rail UX this can be misleading,
because "completed" implies the thread is done and readable. Add a display fallback
for stale or unverifiable sessions:

- `UNKNOWN` when the server cannot verify a remote thread's current lifecycle
- `STALE` when the latest list entry is older than the last successful validation
  window and no readback has succeeded
- `UNAVAILABLE` when app-server or backend startup fails

These are frontend display states derived from server facts and error paths. They do
not change `SessionStatus` until the backend has stronger evidence. To support this,
`ListSessionsResponse` must expose response-level verification state and sanitized
backend availability, and each row must expose `verification_state`, `verified_at`,
and `status_source`.

## Backend Implementation Plan

1. Extend IDL with `SessionActivityPhase` and new factual meaningful-event fields
   on `SessionListItem`.
2. Regenerate Go and TypeScript protobuf bindings.
3. Add core fields only where needed for list projection:
   - `ActivityPhase core.SessionActivityPhase`
   - `LatestMeaningfulEventID`
   - `LatestMeaningfulEventAt`
   - `LatestMeaningfulEventKind`
   - `LatestMeaningfulEventOrderKey`
   - `VerificationState`
   - `VerifiedAt`
   - no transcript mirror, no message counters
4. Derive activity phase in `internal/agents/codex`:
   - `active` thread status -> `running`
   - active turn id -> `running`
   - reasoning transcript item while turn active -> `reasoning`
   - agent delta -> `streaming_response`
   - approval request -> `waiting_approval`
5. Derive latest meaningful event:
   - completed turn with final agent message -> final item id/order key
   - failed/interrupted terminal turn -> turn id
   - approval request -> approval id
   - only terminal turn final assistant responses, failures, and approval requests
     are eligible
   - exclude streaming/commentary/intermediate finalized messages
6. Add a bounded list projection cache:
   - hydrated from live events for Hopter-owned sessions
   - hydrated from selective `thread/read` only for recent/visible sessions
   - returns `UNVERIFIED` when the latest meaningful event cannot be proven from
     `thread/list`
   - never invents `latest_meaningful_event_at` if Codex does not expose an item
     timestamp
7. Add a tiny read-marker service:
   - `MarkSessionSeen(canonical_session_key, device_id, latest_meaningful_event_order_key)`
   - `ListSessions` accepts optional `device_id`
   - `ListSessions` computes `has_unseen_meaningful_event`
   - updates are monotonic max-order writes, so stale tabs cannot regress markers
8. Keep `device_id` only at the Connect/RPC boundary:
   - agent managers return device-agnostic session facts
   - RPC joins those facts with read markers
9. Keep display-state derivation in the frontend from factual fields.

## Frontend Implementation Plan

1. Add a small `deviceId` helper under `ui/src/features/sessions/`.
2. Include `device_id` in `ListSessionsRequest` and mark-seen calls.
3. Add a `MarkSessionSeen` mutation or equivalent session service RPC.
4. Include the same latest meaningful watermark fields in `SessionMeta`.
5. On session detail load, mark the loaded latest meaningful event as seen only
   after the latest meaningful result, failure block, or attention block has rendered.
   Do not mark seen merely because `SessionMeta` resolved.
6. In `SessionRail`, derive the visible state:
   - server active states win
   - attention wins over completed read/unread
   - terminal state uses `has_unseen_meaningful_event`
7. Replace the current recency-only sorting with priority-first sorting:
   - pinned actionable/unread rows first
   - running rows next
   - read rows by recency
   - visual caps cannot hide pinned rows
8. Patch or invalidate `queryKeys.sessions(...)` from live patches that affect row
   status, activity phase, or meaningful event watermarks. Do not make the rail wait
   for 10s polling to show completion or attention.
9. Replace the current `sessionDot(status)` with display-state styles:
   - reasoning: optional spinner tooltip/detail with `text-sky-400`
   - running: spinner with `text-emerald-400`
   - finished unread: filled `bg-sky-400`
   - finished read: muted `bg-muted-foreground/50`
   - attention: `bg-amber-300`
   - failed unread: `bg-destructive`
10. Keep desktop row text dense. Rail rows show icon, title, and relative time; project
   remains in grouping/header/tooltip, not the row body.
11. Add a visible non-color cue for compact and phone views:
   - attention: small inline "Needs review" text
   - finished unread: small inline "New result" text
   - failed unread: small inline "Failed" text
12. Add accessible names so state is not communicated by color alone:
   - `aria-label="Thread <title>, new result, updated 3 minutes ago"`
   - `title` for desktop hover is supplemental, not the only state channel.
13. First run baseline:
   - run an explicit server-atomic baseline operation on first successful list sync
     for a new `device_id`
   - capture a baseline snapshot cursor/order key so events after the snapshot are
     still unseen
   - do not baseline attention, failures, or sessions opened from a notification
   - this avoids turning a user's whole history into unread noise

## Data Flow

```text
Codex app-server
  -> thread/list or live notification
  -> internal/agents/codex Manager
  -> core.Session status + activity phase
  -> latest meaningful event watermark
  -> device-agnostic session fact projection
  -> RPC join with read marker service keyed by device id + canonical session key
  -> SessionService.ListSessions(device_id)
  -> SessionListItem status/activity/unseen facts
  -> React Query sessions cache
  -> SessionRail visible state
```

## Edge Cases

| Case | Expected Behavior |
|---|---|
| Thread from Codex history, no live process | `completed` read/unread only, never reasoning |
| Thread is active but not opened in Hopter | `running`, not reasoning unless readback proves active reasoning |
| Completion SSE arrives while detail visible | mark latest meaningful event seen after the relevant result block renders |
| Completion SSE arrives while only rail visible | show finished unread via server-computed unseen marker |
| User opens completed session | mark finished read after result block renders |
| Browser local storage cleared | new device id gets an explicit first-list baseline for non-actionable existing events |
| Different browser/device | read state is per device in v1, server-side and consistent for that device |
| Approval request | attention state wins over unread |
| Failed turn | failed unread/read, not completed unread/read |
| App-server unavailable | show unavailable/stale treatment, do not lie as completed |
| More than 30 sessions | pinned attention/unread rows remain visible before cap |
| Raw Codex thread later becomes local `sess_*` | read marker follows canonical backend thread key |
| Stale tab marks older event seen | server rejects regression by event order key |
| Direct `/sessions/:id` without list cache | detail gets watermark from `SessionMeta` before marking seen |

## Tests

Backend:

- `mapThreadStatus` still maps Codex thread status correctly.
- activity phase derivation returns `reasoning` only with explicit reasoning
  evidence.
- `SessionListItem` includes new fields without breaking old status.
- list merge preserves local attention fields and new phase fields.
- meaningful event derivation ignores title/preview-only `updated_at` changes.
- read marker comparison uses event id/order key, not wall-clock `updated_at`.
- `MarkSessionSeen` rejects empty device id and unknown session id.
- read markers are keyed by canonical backend session key and migrate from local
  session id after materialization.
- marker writes are monotonic and reject stale order keys.
- list projection returns unverified when only `thread/list` facts are available.
- `SessionMeta` includes the same meaningful watermark used by mark-seen.
- `ListSessions` does priority/cap behavior after read-marker join or overfetches
  enough candidates to preserve pinned rows.
- first-run baseline is atomic and excludes attention/failure/newer-than-snapshot rows.

Frontend:

- rail displays running for `RUNNING`.
- rail displays reasoning only for `REASONING`.
- completed session with unseen meaningful event shows unread.
- completed session after mark-seen mutation shows read.
- active and attention states override local read markers.
- local storage parse failures create a new device id without crashing.
- rail state has accessible labels, not just color.
- priority sorting keeps unread/attention rows visible above read recency rows.
- first-run baseline does not mark attention or failure states as read.
- phone rail rows show visible state text for special states.
- app-server unavailable/notLoaded cases do not present as confident completion.
- session-list cache updates immediately on live status/activity/watermark patches.

Validation:

- `go test ./internal/agents/... ./internal/rpc/...`
- `pnpm --dir ui typecheck`
- `pnpm --dir ui lint`
- `pnpm --dir ui build`
- `make verify-live` for the running loop
- evidence path recorded under `storage/artifacts/validation/`

## Not In Scope

- multi-user read receipts
- persistent transcript mirroring
- exact Codex chain-of-thought visibility
- cross-device read sync between different device ids before real auth identity exists
- changing `SessionStatus` meaning

## Architecture Diagram

```text
Codex app-server
  |
  | thread/list, live notifications, selective thread/read
  v
internal/agents/codex
  - maps execution status
  - derives activity phase when evidence exists
  - maintains bounded meaningful-event projection cache
  |
  v
SessionService.ListSessions(device_id)
  - asks runtime for device-agnostic session facts
  - joins read-marker store by canonical backend session key
  - computes has_unseen_meaningful_event
  - exposes verification state
  |
  v
React Query sessions cache
  |
  v
SessionRail
  - derives frontend-only display state
  - priority-sorts actionable rows before recency
  - renders visible and accessible state cues

Session detail route
  |
  | GetSessionMeta includes same meaningful watermark
  v
Render result/failure/attention block
  |
  | after content is visible
  v
MarkSessionSeen(device_id, canonical_session_key, order_key)
```

## Test Diagram

| Flow | Codepath | Coverage |
|---|---|---|
| Codex list has active thread | `Manager.ListSessions -> sessionFromThread` | Go unit test for running phase |
| Codex readback has final turn | `thread/read -> meaningful event projection` | Go unit test with synthetic turns |
| Local session materializes backend thread | marker migration from `sess_*` to backend thread key | Go unit test |
| User opens unread completed session | `GetSessionMeta -> render result -> MarkSessionSeen` | UI helper test plus live smoke |
| Two tabs mark different events | read-marker monotonic update | Go unit test |
| First device baseline | baseline RPC / first list sync | Go unit test |
| Rail list has more than 30 rows | priority sort before cap | UI helper test |
| App-server unavailable | verification state returned | RPC unit test |
| Live completion arrives | SSE invalidates or patches sessions cache | UI query invalidation test |

## Failure Modes Registry

| Failure Mode | Risk | Prevention |
|---|---|---|
| False unread from metadata `updated_at` | User stops trusting rail | Use meaningful event order key only |
| Read marker split between `sess_*` and raw thread id | Same thread appears unread forever | Canonical backend session key with migration |
| Stale tab clears newer unread result | Lost notification signal | Monotonic max-order writes |
| `notLoaded` appears as completed | User opens dead session expecting result | Verification state and stale treatment |
| Cap hides unread/attention rows | User misses action | Priority sort before cap or overfetch |
| Detail marks seen before content visible | Unread clears without user seeing result | Mark after rendered content only |
| Device id leaks into runtime | Codex adapter owns UI state | Keep device id at RPC/read-marker boundary |
| New device sees whole history as unread | Noise on first mobile open | Atomic first-run baseline excluding actionable rows |

## Review Report

### CEO Review

CEO review found the original local-only read state and `updated_at` comparison were
not truthful enough for Hopter's cross-device premise. The plan now uses
server-side device markers and meaningful event watermarks.

### Design Review

Design review found state dots are not enough. The plan now requires priority-first
rail sorting, visible non-color cues on compact/phone, accessible names, and caps
that cannot hide actionable rows.

### Engineering Review

Engineering review found meaningful events cannot come from `thread/list` alone.
The plan now adds a bounded projection cache, canonical backend session keys,
monotonic mark-seen writes, verification state, and matching `SessionMeta`
watermarks.

### DX Review

DX subagent timed out and was closed. The plan still includes implementation-facing
contract details, validation commands, and a separate test-plan artifact:
`/Users/sorcererxw/.gstack/projects/unknown/master-session-list-real-state-test-plan-20260422-1254.md`.

## Final Recommended Shape

The three user-facing states should be implemented as:

1. **Working**: `status=running` with optional `activity_phase=reasoning` only when
   explicit evidence exists.
2. **Finished unread**: terminal success or failure has a latest meaningful event
   newer than the current device marker.
3. **Finished read**: terminal success or failure has no unseen meaningful event for
   the current device.

But the rail priority must put attention and failures above normal finished states:

```text
attention -> failed unread -> finished unread -> working -> failed read -> finished read
```

This is the version that stays closest to real state without building a second Codex
truth store.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | Intake | Create a dedicated plan file for this request | Mechanical | Bias toward action | User asked for a designed方案 with `/autoplan`; a plan artifact is reviewable and reusable | Oral-only answer |
| 2 | Intake | Keep `SessionStatus` as execution truth and add list display fields | Mechanical | Explicit over clever | Avoids breaking existing status semantics while solving the rail UX | Reusing `completed` to mean read state |
| 3 | Intake | Browser-scoped read markers for v1 | Taste | Pragmatic | No real auth identity exists, so server-side read state would imply more than Hopter can prove today | Server persistence in first pass |
| 4 | CEO | Replace browser-only read markers with server-side device markers | Mechanical | Choose completeness | Both review voices flagged browser-only read state as conflicting with Hopter cross-device continuity | Local-only `sessionSeenStore` |
| 5 | CEO | Replace `updated_at` comparison with meaningful event watermark | Mechanical | Explicit over clever | `updated_at` can change for metadata and would create fake unread state | `updated_at > last_seen_at` |
| 6 | CEO | Demote `reasoning` from primary state to optional activity phase | Mechanical | Pragmatic | The user need is re-entry truth; reasoning is valuable only when proven and should not dominate the rail | Primary `REASONING` display state |
| 7 | Design | Sort rail by action priority before recency | Mechanical | Choose completeness | Unread/attention state is useless if the rail can bury it below read sessions | Existing recency-first sorting only |
| 8 | Design | Keep display-state enum out of protobuf | Mechanical | Explicit over clever | Server returns facts; frontend derives presentation once | Proto `SessionListDisplayState` |
| 9 | Design | Require visible and accessible state cues beyond color | Mechanical | Choose completeness | Current rail icon/dot pattern is not enough for phone or assistive tech | Color-only dots and hover-only text |
| 10 | Design | Mark seen only after meaningful content renders | Mechanical | Explicit over clever | Loading metadata is not the same as the user seeing the result | Marking seen on `SessionMeta` load |
| 11 | Design | Add first-run baseline for new device ids | Taste | Pragmatic | Prevents a new phone/browser from turning all history into unread noise | Treating all existing history as unread |
| 12 | Eng | Add bounded watermark projection cache instead of deriving from `thread/list` alone | Mechanical | Explicit over clever | `thread/list` lacks turn/item ids, so latest meaningful output cannot be proven from it | Pure list-derived watermark |
| 13 | Eng | Add watermark fields to `SessionMeta` | Mechanical | Choose completeness | Detail pages need the exact rendered watermark to mark seen truthfully | List-only watermark fields |
| 14 | Eng | Key read markers by canonical backend session key | Mechanical | Explicit over clever | Local `sess_*` and raw thread ids can refer to the same Codex thread | `device_id -> session_id` |
| 15 | Eng | Make mark-seen writes monotonic by order key | Mechanical | Choose completeness | Stale tabs must not regress read markers | Last-write-wins event id |
| 16 | Eng | Keep device ids at RPC boundary and out of agent managers | Mechanical | Explicit over clever | Device read state is Hopter control-plane state, not Codex runtime truth | Passing device id into Codex manager |
| 17 | Eng | Replace nonexistent UI test command with actual UI validation lane | Mechanical | Pragmatic | `ui/package.json` has typecheck/lint/build, not a generic `bun test` lane | `cd ui && bun test` |
