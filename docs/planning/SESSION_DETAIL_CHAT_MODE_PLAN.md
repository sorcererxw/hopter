# Session Detail Chat Mode Plan

## Status

Proposed. Planning-only alignment for the selected session pane before implementation.

## User request

Refactor session detail into a chat-first surface:

- top/middle area becomes the conversation between the user and the agent
- user messages render on the right
- agent messages render on the left
- bottom area is a sticky input box
- composer supports model switching
- composer supports reasoning-effort switching
- composer supports pasted images

## Why this matters

The current selected-session pane still reads like a control-plane status card.

That is fine for proving the Go rebuild skeleton, but it is the wrong shape for the core job. The real job is continuing a live coding conversation from another device, fast, with context, and without digging through summary cards.

A chat-first session pane moves the product closer to the actual wedge:

- same machine
- same repo
- same agent context
- same conversation

## Current state

### What exists now

The selected-session route is wired and usable, but it is still summary-card driven.

Relevant files today:

- `ui/src/components/app/session-detail-pane.tsx`
- `ui/src/components/app/session-composer.tsx`
- `ui/src/features/sessions/use-sessions.ts`
- `idl/hopter/v1/session.proto`
- `internal/codex/client.go`
- `internal/codex/manager.go`
- `internal/rpc/session_service.go`
- `internal/core/models.go`

Current detail pane order:

1. header/status
2. summary paragraph
3. optional attention card
4. follow-up composer card
5. summary card
6. artifacts card

### Gaps against the requested outcome

1. No transcript. `GetSession` returns summary state only, not user/agent messages.
2. No model selection. The Go bridge always uses default Codex model settings.
3. No reasoning-effort selection. The UI cannot override turn effort.
4. No image input path. `CreateSessionRequest` and `SendSessionInputRequest` only carry plain text.
5. No live chat streaming. The manager updates summary text, not a message stream.
6. Conversation source-of-truth is available in Codex, but we are not surfacing it yet.

## Product premise

The selected session pane should feel like re-entering a live coding thread, not opening a dashboard detail card.

That means:

- status, summary, and attention still stay visible
- but the dominant body becomes the actual conversation
- artifacts and timeline become supporting surfaces, not the main read path

This keeps us inside AGENTS guidance. We are not making timeline the default focus. We are making the session conversation the default focus.

## Target UX

## Layout

Selected session pane becomes:

1. compact session header/status row
2. compact summary strip
3. attention strip, only when needed
4. transcript body
5. sticky composer at the bottom
6. artifacts as a secondary rail/card below transcript on desktop, collapsed section on narrow screens

## Transcript rules

- only user and agent messages are rendered in the primary chat transcript
- user messages align right
- agent messages align left
- pasted images render inline inside the user bubble
- tool noise, approval plumbing, and low-level protocol items do not enter the primary transcript
- transcript auto-scrolls only when the user is already near the bottom
- if the user scrolls upward, new messages do not yank the viewport

## Composer rules

The composer becomes a persistent bottom bar with:

- multiline text input
- pasted-image preview tray
- model picker
- reasoning-effort picker
- send button

Behavior:

- `⌘/Ctrl + Enter` sends
- plain Enter inserts newline only if we already use modifier-to-send, otherwise keep current app convention explicit in implementation
- image paste from clipboard creates preview chips immediately
- removing an image is one tap/click
- picker state is visible before send, not hidden in a modal

## Model controls

For follow-up turns, changing model or reasoning effort should apply to the next turn and subsequent turns for that session.

For new sessions, the same control surface should be reusable so the first turn can also honor the chosen model/effort. That is the cleaner complete path and avoids two composer systems.

## Empty/failed/waiting states

- loading: shell stable, transcript skeleton visible
- empty transcript: show “no messages yet” helper inside transcript body, not as a separate hero card
- waiting for agent: show pending user bubble plus typing/working placeholder on the left
- waiting for approval: attention strip stays above transcript, transcript remains readable, and approve/reject controls remain first-class in the same pane
- failed/degraded: error state appears as attention strip plus latest agent/system explanation

## Existing code leverage

## What we already have

### Frontend

- Workspace shell and route model already match the desired product shape.
- `SessionWorkspacePane` already owns selected-session rendering.
- `SessionComposer` already exists and can be evolved rather than replaced from scratch.
- SSE invalidation is already global and simple.

### Backend

- `codex app-server` is already the only backend integration path.
- `internal/codex/client.go` already starts threads, starts turns, steers turns, and reads threads.
- Local probe verified that `thread/start` accepts explicit model and reasoning effort.
- Local probe verified that `model/list` returns supported reasoning efforts and input modalities.
- Generated app-server schema shows `turn/start` and `turn/steer` accept:
  - `model`
  - `effort`
  - user inputs of type `text`, `image`, and `localImage`

### Constraint we must preserve

We must not build a heavy persistent mirror of Codex history in the Go backend.

So the conversation plan is:

- Codex thread history remains canonical
- hopter stores only lightweight session refs plus UI-facing session metadata
- transcript is normalized from `thread/read` on demand and from live turn notifications during active work
- only small ephemeral draft state is kept in memory for live streaming

## Architecture plan

## 1. IDL changes

Primary target:

- `idl/hopter/v1/common.proto`
- `idl/hopter/v1/session.proto`

### Add a normalized reasoning-effort enum

In `common.proto`:

- `REASONING_EFFORT_UNSPECIFIED`
- `REASONING_EFFORT_LOW`
- `REASONING_EFFORT_MEDIUM`
- `REASONING_EFFORT_HIGH`
- `REASONING_EFFORT_XHIGH`

This keeps raw Codex strings out of the UI.

### Add session transcript types

In `session.proto`, add normalized conversation messages.

Recommended surface:

- `SessionMessage`
- `SessionMessageRole`
- `SessionMessagePart`
- `SessionImageAttachment`
- `SessionComposerCapabilities`
- `SessionModelOption`
- `ListModelsRequest/Response` on `HostService` for pre-session composer options

Recommended shape:

- `Session.messages[]` for primary transcript items only
- `Session.composer` for current session-selected model, current reasoning effort, and image capability flags
- `HostService.ListModels` returns backend-global picker options for both `/` and `/sessions/:sessionId`
- `Session.transcript_truncated` if we cap message count in response

### Extend create/follow-up input requests

Replace text-only input with structured input items.

Recommended request shape:

- `CreateSessionRequest.input_items[]`
- `CreateSessionRequest.model`
- `CreateSessionRequest.reasoning_effort`
- `SendSessionInputRequest.input_items[]`
- `SendSessionInputRequest.model`
- `SendSessionInputRequest.reasoning_effort`

For image paste, each image item should carry:

- filename
- mime type
- raw bytes

Why bytes, not a pre-upload endpoint:

- the product requirement is pasted images, not general asset management
- pasted screenshots are small enough for unary control-plane RPC with a size cap
- it avoids inventing a second upload protocol too early

Guardrail:

- enforce a backend image-size cap, recommended first pass `10 MiB` per image and `3` images per turn

### Keep artifact metadata separate

Artifacts stay on `Session.artifacts[]` and `ListSessionArtifacts`, unchanged in spirit.

Transcript is for chat. Artifacts remain secondary outputs.

## 2. Backend model changes

Primary files:

- `internal/core/models.go`
- `internal/core/inmemory.go`
- `internal/rpc/helpers.go`
- `internal/rpc/session_service.go`

Add UI-facing session fields:

- configured model
- configured reasoning effort
- optional ephemeral “streaming assistant draft” support in live session memory only

Important boundary:

- normalized transcript should be built on read in the codex/rpc path, not stored as a durable field in `core.Session`

Persistence rule:

- lightweight session record may store current model/effort and backend thread id
- full transcript does not persist in hopter storage

## 3. Codex client and manager changes

Primary files:

- `internal/codex/client.go`
- `internal/codex/manager.go`

### Client additions

Add support for:

- `model/list`
- `thread/resume`
- `turn/start` with `model`, `effort`, and structured input items
- `turn/steer` with `model`, `effort`, and structured input items

Add request helpers for converting hopter input items into Codex app-server items:

- text -> `type: "text"`
- pasted image bytes -> backend writes temp file -> `type: "localImage"`, `path: ...`

### Manager additions

Add a small live-session state object that tracks:

- thread id
- current model
- current reasoning effort
- active turn id
- partial assistant message buffer keyed by item id during streaming

### Transcript source strategy

For `GetSession`:

1. if thread is live, call `thread/read`
2. if thread is not live but session has `BackendThreadID`, lazily `thread/resume`
3. normalize returned thread items into UI transcript items
4. merge any in-memory streaming assistant draft if a turn is active

This is the key move that keeps Codex as the source of truth.

### Live streaming strategy

Handle these app-server notifications at minimum:

- `item/agentMessage/delta`
- `item/completed`
- `turn/started`
- `turn/completed`
- approval-related notifications already handled today

Behavior:

- `item/agentMessage/delta` appends into in-memory assistant draft
- `item/completed` finalizes the assistant message and clears its draft buffer
- session changed event is published so the UI refreshes during active turns

This gives the session pane a real chat feel without inventing a second websocket protocol.

## 4. Transcript normalization rules

Codex thread items should be normalized like this:

### Included in main transcript

- `userMessage`
- `agentMessage`

### Hidden from main transcript

- plan items
- hook prompts
- raw tool call plumbing
- reasoning deltas
- command output noise

### Exposed elsewhere if needed later

- plan/tool/timeline noise can feed a future “activity” drawer
- not part of this feature’s primary pane

### Message ordering

Preserve thread order exactly.

### Message cap

Return the last `200` transcript messages by default.

If older messages exist:

- set `transcript_truncated = true`
- keep the newest visible window intact

This protects payload size without losing the recent working context.

## 5. Frontend changes

Primary files:

- `ui/src/components/app/session-detail-pane.tsx`
- `ui/src/components/app/session-composer.tsx`
- `ui/src/features/sessions/use-sessions.ts`

New expected files:

- `ui/src/components/app/session-transcript.tsx`
- `ui/src/components/app/session-message-bubble.tsx`
- `ui/src/components/app/session-composer-toolbar.tsx`
- optional shadcn primitive additions if we need `select`, `tooltip`, or `dropdown-menu`

### Selected session pane refactor

`SessionWorkspacePane` should become a chat layout, not a card grid.

Recommended composition:

- `SessionHeaderStrip`
- `SessionSummaryStrip`
- `SessionAttentionStrip`
- `SessionTranscript`
- sticky `SessionComposer`
- `SessionArtifactsPanel`

### Composer refactor

`SessionComposer` becomes structured input, not a single textarea card.

New responsibilities:

- draft text
- pasted-image previews
- current model value
- current reasoning-effort value
- submit pending state
- reset attachments after successful send

### Query layer

`useSession()` remains the main selected-session query.

Mutations change to submit structured payloads:

- `createSession({ projectId, title, inputItems, model, reasoningEffort })`
- `sendSessionInput({ sessionId, inputItems, model, reasoningEffort })`

### SSE behavior

Keep the existing invalidation-first SSE model.

Do not introduce a second frontend event system for this feature. The current `EventSource -> invalidate query` path is still the right default.

Guardrail:

- if we publish transcript-refresh events on every agent delta, the backend must throttle them, recommended first pass `<= 4 updates/sec per session`, so `thread/read` does not become a refetch storm.

If throttled streaming still feels too expensive in practice, finalized-message chat correctness wins over token-by-token polish.

## 6. Image paste flow

### Browser

- user pastes an image into the composer
- browser captures clipboard image blob
- preview is rendered immediately
- blob is converted to bytes for RPC payload on send

### Go server

- validate mime type is image/*
- validate size cap
- write a temp file under a controlled session-input scratch root, recommended:
  - `storage/runtime/session-inputs/<session-id>/...`
- pass local file path to Codex app-server as `localImage`
- clean up temp image files after turn completes or after a retention window

Why temp local files:

Codex app-server supports `localImage` natively. Using that avoids inventing external URLs or permanent asset storage.

## 7. New session path alignment

The user asked for session detail first. Still, model and effort controls should be shared with the create-session flow.

Recommendation:

- build one reusable structured composer
- use it in both `/` new-session state and `/sessions/:sessionId`
- only the transcript is selected-session specific

This is the cleaner complete path and avoids a follow-up rewrite two days later.

To make that reusable path honest, model options must come from `HostService.ListModels`, while an existing session also returns its currently selected model/effort via `Session.composer`.

## Not in scope

The following stay out of this feature:

- terminal UI
- relay/mobile push work
- raw tool timeline viewer
- voice input
- drag-and-drop file uploads beyond pasted images
- arbitrary non-image attachments
- durable hopter-side transcript persistence
- multi-model comparison or per-message model badges unless already available from normalized data

## Failure modes and rescue plan

| Failure mode | Why it matters | Rescue |
| --- | --- | --- |
| Transcript payload gets too large | Session detail becomes slow on long threads | cap to last 200 messages, set `transcript_truncated` |
| Live session is not in memory after reload | Follow-up input breaks after refresh | lazily `thread/resume` using saved `BackendThreadID` |
| Image payload too large | request fails or backend memory spikes | enforce byte cap before send and on server |
| Unsupported model/effort chosen | turn start fails | only offer values from `model/list`; validate server-side too |
| Agent message delta stream stalls | left bubble looks broken | fall back to finalized transcript from `thread/read` on completion |
| Approval UI gets buried by the chat layout | remote control loop regresses | keep approve/reject actions in the attention strip and validate them on desktop + mobile |
| Artifact panel overwhelms chat layout | transcript loses focus | keep artifacts secondary and collapsible |

## Implementation slices

### Slice 1, protocol and backend plumbing

This slice also adds `HostService.ListModels`, because the create-session composer on `/` needs model metadata before a session exists.

Files:

- `idl/hopter/v1/common.proto`
- `idl/hopter/v1/session.proto`
- generated Go/TS outputs
- `internal/core/models.go`
- `internal/codex/client.go`
- `internal/codex/manager.go`
- `internal/rpc/helpers.go`
- `internal/rpc/session_service.go`

Acceptance:

- backend can list models
- backend can start/steer turns with explicit model and reasoning effort
- backend can accept text plus pasted images
- `GetSession` returns normalized transcript + composer capabilities

### Slice 2, selected session chat UI

Files:

- `ui/src/components/app/session-detail-pane.tsx`
- new transcript/message components
- refactored `ui/src/components/app/session-composer.tsx`
- `ui/src/features/sessions/use-sessions.ts`

Acceptance:

- selected session shows left/right chat bubbles
- sticky composer remains visible at bottom
- summary and attention stay above transcript
- artifacts remain visible but secondary

### Slice 3, home/new-session alignment

Files:

- `ui/src/components/app/session-detail-pane.tsx`
- `ui/src/components/app/session-composer.tsx`

Acceptance:

- same composer control surface is used for create and follow-up
- first turn can choose model and effort too
- pasted image flow works for create-session start as well

### Slice 4, validation and evidence

Targets:

- Go tests for codex input conversion and transcript normalization
- UI build validation stays green
- targeted browser validation for chat layout, model picker, effort picker, and pasted-image preview

Recommended evidence roots:

- `storage/artifacts/validation/<run-id>/session-chat/`

## Validation plan

Required proof before calling the feature done:

1. `go test ./...`
2. `pnpm --dir ui build`
3. transcript normalization test passes for:
   - plain text user turn
   - user turn with image
   - agent delta -> finalized message flow
4. browser validation captures:
   - user bubble on right
   - agent bubble on left
   - model picker visible and selectable
   - reasoning-effort picker visible and selectable
   - pasted image preview visible before send
   - approval controls still reachable in the chat layout
   - mobile viewport keeps reply + approval actions reachable
5. evidence path recorded under `storage/artifacts/validation/`

## Concrete first-pass test cases

### Backend

- `thread/read` with mixed item types normalizes to transcript containing only user/agent messages
- `SendSessionInput` with image bytes writes temp file and emits `localImage` input item
- `thread/resume` path restores follow-up ability after live-session cache miss
- model list maps supported reasoning efforts correctly into API response

### Frontend

- selected session pane renders transcript container with correct message alignment classes
- composer submit is disabled when no text and no images are present
- pasted image can be removed before send
- model and effort controls retain selected values across optimistic pending state
- approval attention strip still exposes approve/reject actions without opening a separate screen
- mobile viewport keeps composer and approval actions reachable

## Design choices locked by this plan

1. Chat transcript becomes the dominant selected-session body.
2. Summary and attention stay above the transcript, not removed.
3. Model and reasoning-effort selection are shared between create and follow-up flows.
4. Pasted images ship through structured RPC with a size cap, not a separate upload API.
5. Codex remains the transcript source-of-truth. hopter normalizes, it does not persist a heavy mirror.
6. Raw timeline/tool noise stays out of the main transcript.

## Open questions

These are small enough to resolve during implementation without reopening planning:

1. exact desktop artifact placement, right-side column vs collapsible block under transcript
2. exact keyboard send shortcut copy in the composer help text
3. exact image-size cap copy shown in the UI when validation fails

None of these block implementation.

## Recommended next step

If this plan is approved, implementation should start with Slice 1.

That is the whole game. The UI refactor is only honest once the protocol and backend can actually serve transcript, model options, effort options, and image input.
