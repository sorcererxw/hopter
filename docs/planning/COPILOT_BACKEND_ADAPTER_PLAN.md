# Copilot Backend Adapter Plan

## Status

Proposed implementation plan.

This document defines how `hopter` should add GitHub Copilot as a first-class backend beside Codex without breaking the current Go-first control-plane architecture.

## Decision

Add Copilot as a second backend.

Do it now, because the work is not really "add Copilot". The real work is cutting the backend runtime boundary that `hopter` already claims to have but does not yet fully enforce at runtime.

Copilot is the forcing function.

## What the user wants

The desired product behavior is:

- Copilot is a peer to Codex, not a hidden internal experiment
- projects remain directory-based, not backend-based
- each thread shows which backend it belongs to
- approval handling must align with the Codex path in the long run
- phase 1 may use yolo / auto-approve so a full vibe-coding loop can be proven quickly
- no GitHub login flow is added to `hopter`
- users authenticate Copilot CLI on their own machine before using `hopter`

That last point matters. `hopter` is not trying to own Copilot auth. It is trying to expose a browser control plane over an already-working local Copilot CLI environment.

## Official SDK facts

The official Go SDK is `github.com/github/copilot-sdk/go`.

Facts confirmed from the upstream repo and module metadata:

- latest module resolved during review: `v0.2.2`
- publish time resolved during review: `2026-04-08`
- README explicitly marks the SDK as **public preview**
- the SDK supports:
  - `CreateSession`
  - `ResumeSession`
  - `ListSessions`
  - `GetSessionMetadata`
  - `Session.Send`
  - `Session.GetMessages`
  - `Session.Abort`
  - typed session events
  - `OnPermissionRequest`
  - `OnUserInputRequest`
  - `OnElicitationRequest`
  - stdio transport
  - external server mode
  - logged-in-user auth by default

This clears the threshold question. Copilot is not a dead-end one-shot prompt API. It is a resumable session backend with event semantics and approval hooks.

## Fit with `hopter`

This fits the product direction in the repo:

- `hopter` is a control plane, not a new coding agent
- backend remains the source of execution truth
- browser never talks to backend runtime directly
- Go server is the only backend client

Relevant current constraints:

- runtime is Go-first
- transport is Connect + SSE
- session is the primary UX object
- project is directory-based metadata, not the execution identity

That means Copilot should be added as a backend adapter, not as a new app mode and not as a separate UI tree.

## Current repo reality

The repo is only halfway to multi-backend support.

What exists:

- `Project.DefaultBackend` exists
- host/backend status surfaces exist
- UI and protobuf shapes already acknowledge backend-aware state
- `SessionService` has already been narrowed to a runtime-facing interface

What does not yet exist:

- a real backend registry / runtime factory
- a backend-neutral session manager
- per-thread backend identity in the session model
- approval handling implemented through `RespondToSessionApproval`
- a unified runtime abstraction for both Codex and Copilot

Today, runtime wiring still hardcodes Codex.

So the Copilot project is not "plug in one package". It is:

1. make the backend seam real
2. implement the Copilot adapter behind it

## Recommendation

Proceed in two explicit phases.

### Phase 1

Get Copilot running in the same UI shell with yolo approval.

Goal:

- prove one complete vibe-coding loop from browser through `hopter` into Copilot and back

Approval policy in Phase 1:

- auto-approve everything in the Copilot permission handler
- preserve approval abstractions in the `hopter` runtime design
- do not ship Phase 1 as "approval-complete"

### Phase 2

Implement UI-mediated approval parity with Codex.

Goal:

- Copilot permission requests surface through the same attention / approval control plane used by Codex

This split is correct because the user's current need is real usage, not perfect governance on day one.

## Architecture

## 1. Introduce a true backend runtime boundary

Create a new package family:

```text
/internal/backend
  runtime.go
  registry.go
  types.go
/internal/backend/codex
/internal/backend/copilot
```

Do not let `internal/codex` become the global backend abstraction. It is already both an implementation and an accidental architecture center. That gets messy fast.

### Runtime interface

The runtime interface should be small and oriented around `hopter`'s real needs:

```go
type Runtime interface {
	Key() string
	ListSessions(ctx context.Context, project core.Project, filter SessionFilter) ([]ResolvedSession, error)
	GetSession(ctx context.Context, project core.Project, session SessionRef) (SessionSnapshot, error)
	CreateSession(ctx context.Context, project core.Project, input CreateSessionInput) (SessionSnapshot, error)
	SendInput(ctx context.Context, project core.Project, session SessionRef, input SendInput) (SessionSnapshot, error)
	Abort(ctx context.Context, project core.Project, session SessionRef) error
	RespondToApproval(ctx context.Context, project core.Project, session SessionRef, decision ApprovalDecisionInput) (SessionSnapshot, error)
}
```

The key point is not method names. The key point is that the runtime returns `hopter`-shaped state, not raw backend payloads.

## 2. Make backend identity explicit on thread/session

Projects remain directory-based.

Do **not** fork projects by backend.

But sessions must carry backend identity explicitly, for example:

```go
type Session struct {
  ...
  BackendKey string
  BackendSessionID string
}
```

That enables:

- Codex and Copilot threads side by side under one project
- clear badges in the left rail and detail pane
- backend-aware resume routing

This is required, not optional. Without it, multi-backend is fake.

## 3. Keep the browser API backend-neutral

The UI should not care whether a session came from Codex or Copilot, except for:

- backend badge
- backend availability display
- backend-specific capability affordances when truly necessary

Everything else should stay normalized:

- session list
- selected session detail
- summary
- attention
- transcript
- composer

This matches the product thesis.

## 4. Codex and Copilot adapters should converge on the same normalized state

Normalized state needed by the UI:

- session id
- project id
- backend key
- backend session id
- title
- status
- summary
- attention required
- attention reason
- transcript items
- artifacts
- updated at

### Copilot mapping

Map these Copilot concepts:

- `SessionMetadata.SessionID` -> backend session id
- `AssistantMessageData.Content` -> agent message transcript
- `AssistantReasoningData` / `AssistantReasoningDeltaData` -> reasoning transcript
- `ToolExecutionStartData` + `ToolExecutionCompleteData` -> tool / command transcript
- `SessionIdleData` -> terminal turn state
- `SessionErrorData` -> failed / degraded session state
- `GetMessages()` -> hydration and refresh source

### Codex mapping

Keep using the existing normalized transcript and summary mapping already built in the repo.

## Approval strategy

## Long-term rule

Approval UX should align across Codex and Copilot.

That means the UI contract should remain:

- session enters waiting-for-approval
- attention strip becomes visible
- `RespondToSessionApproval` is the control-plane mutation surface
- user can approve or reject from the selected session pane

This is already implied in the repo's product and IDL docs, even though the Go skeleton has not implemented it yet.

## Phase 1 rule

Use yolo mode for Copilot only.

Implementation:

- `OnPermissionRequest: copilot.PermissionHandler.ApproveAll`
- runtime marks the session as running, not waiting-for-approval
- approval bridge interface still exists in code, but Copilot adapter does not emit requests yet

This keeps the design seam honest while reducing first-loop delivery cost.

## Phase 2 rule

Replace `ApproveAll` with a bridge:

- runtime receives `PermissionRequest`
- runtime stores pending approval state in session attention fields
- runtime emits SSE update
- UI shows approval strip
- `RespondToSessionApproval` resumes the Copilot permission flow

If this bridge cannot be implemented without a second truth store or a fragile local state machine, stop and reassess. That is the main architectural risk in the whole plan.

## Authentication

Do not add GitHub auth to `hopter`.

Use the user's existing Copilot CLI login on the host machine.

Required product behavior:

- detect that Copilot CLI is available
- detect whether it is usable enough to create a session
- surface backend availability honestly in host status

Do not pretend `hopter` can fix auth. If Copilot CLI is not logged in, show degraded / unavailable with a concrete message.

## Concrete implementation phases

## Phase A: backend seam extraction

Deliver:

- backend runtime interface
- backend registry / factory
- Codex runtime moved behind the interface
- session model extended with backend identity

Validation:

- existing Codex flow still passes
- no UI regression
- existing validations remain green

## Phase B: Copilot spike, yolo mode

Deliver:

- `internal/backend/copilot`
- create session
- resume session
- list sessions
- send input
- abort
- `GetMessages()` hydration into summary + transcript
- backend availability surfaced in host status

Validation:

- browser can create a Copilot-backed thread
- browser can send a follow-up
- refresh resumes the same Copilot session
- transcript renders in the existing pane

This is the first true product proof.

## Phase C: thread/backend UX

Deliver:

- thread badge in left rail
- backend badge in selected session pane
- backend-aware session list and session detail hydration

Validation:

- Codex and Copilot sessions can coexist under the same project
- UI clearly distinguishes them without splitting the project model

## Phase D: approval parity

Deliver:

- approval request persistence shape
- `RespondToSessionApproval` implementation
- Copilot permission bridge
- UI approval controls

Validation:

- browser receives a real Copilot permission pause
- UI can approve and resume
- rejection path is visible and honest

## Risks

### 1. SDK churn

The SDK is in preview. Breaking changes are likely.

Mitigation:

- isolate Copilot behind `internal/backend/copilot`
- do not leak SDK types across package boundaries

### 2. Approval bridge complexity

This is the main risk. If the SDK expects synchronous permission decisions in a way that cannot be safely paused across browser/UI round-trips, the parity plan gets harder.

Mitigation:

- Phase 1 yolo
- Phase 2 spike approval before committing to full productization

### 3. Multi-backend is still under-modeled

If backend identity is not made explicit on sessions, the UI and stores will become ambiguous fast.

Mitigation:

- add `BackendKey` now, before Copilot adapter work deepens

### 4. Artifact parity

Copilot may not expose artifacts in the same natural way as Codex.

Mitigation:

- make transcript + summary the first-class proof path
- treat artifacts as a second-pass concern for Copilot

## What not to do

- do not fork projects by backend
- do not let the UI branch into a Copilot-specific shell
- do not add GitHub login UX
- do not directly expose Copilot SDK event types to the UI
- do not attempt full approval parity before proving the browser vibe-coding loop

## Acceptance criteria

This project is successful when all of the following are true:

1. a user with local Copilot CLI already logged in can create a Copilot thread from the browser
2. the same project can contain both Codex and Copilot threads
3. each thread visibly shows which backend it belongs to
4. the user can send a follow-up prompt in the browser and see transcript updates
5. refresh and resume work for Copilot threads
6. the runtime seam is real enough that Codex and Copilot are both implementations, not special cases hidden in the same manager
7. approval API seams remain present, even if Phase 1 runs Copilot in yolo mode

## Recommendation

Proceed.

But do it in this order:

1. extract backend runtime seam
2. add backend identity to session state
3. ship Copilot spike in yolo mode
4. prove one full vibe-coding browser loop
5. only then build approval parity

That gets the product moving without lying to yourself about the hard part.

## Immediate next step

Create `internal/backend` and move the current Codex session runtime behind it before writing any Copilot integration code.

If you skip that and wire Copilot straight into today's Codex-centered manager, you will get a demo fast and a mess right after.
