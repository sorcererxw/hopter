<!-- /autoplan restore point: local gstack project artifact -->
# Tasks Execution Plan

## Status

Proposed. Revised after user clarification.

The visible product shape is a Wunderlist-style task surface with three layers:

```text
Project
  -> Task
      -> Subtask
```

The user-facing concept is **Tasks**, not a hidden background queue. The scheduler
is the execution engine behind tasks.

## User Request

Introduce a task mechanism where:

- hopter has a top-left `Tasks` entry in the existing app chrome
- `Tasks` is the unified place to create, view, and manage tasks
- creating a task requires selecting a project
- one task corresponds to one Codex session
- creating a task immediately starts planning, not file-writing
- each task progresses through `plan -> code -> review -> commit`
- completion of planning interrupts and notifies the user for confirmation
- completion of development interrupts and notifies the user for confirmation
- when the whole task completes, the task is checked done
- subtasks live under a task
- adding a subtask sends that work into the task's existing Codex session as
  follow-up input
- execution continues until all task and subtask work is complete

## Product Premise

This is a remote control-plane feature, not a new coding agent and not a generic
workflow orchestrator.

The task system should make hopter better at the user's actual job: writing down
work items, letting Codex execute locally, and returning only when a human
decision is needed.

The task layer owns only:

- task records
- subtask records
- stage state
- scheduling leases
- one Codex session reference per task
- human-gate decisions
- validation and commit evidence references

Codex remains the source of truth for:

- session content
- transcript history
- approval semantics
- artifact semantics

The task system must not persist a second copy of Codex transcript history,
artifact content, or approval protocol state.

## Current State

### What Already Exists

- `SessionService` can create sessions, send follow-up input, interrupt sessions,
  respond to session approvals, fetch session detail, fetch review diffs, inspect
  files, and list transcript pages.
- `internal/agents/codex/manager.go` already drives Codex through `codex
  app-server`, tracks small live session state, publishes draft deltas, and
  reconciles final transcript through `thread/read`.
- `internal/events` and `GET /events` already provide the global SSE stream used
  for session and workspace updates.
- The UI already uses TanStack Query plus SSE invalidation in
  `ui/src/lib/sse/use-workspace-events.ts`.
- `SessionReview` already exposes reviewable changed-file data for the latest
  completed turn, but it is read-only review evidence, not commit selection.
- `docs/planning/COMMIT_AND_PUSH_CAPABILITY_PLAN.md` defines a separate project
  GitService plan. That work is a dependency for the task commit stage.

### Missing Pieces

- No top-level `Tasks` route or navigation entry.
- No `Project -> Task -> Subtask` domain model.
- No Tasks IDL, backend service, store, scheduler, or UI surface.
- No first-class task-stage state separate from session status.
- No scheduler lease or project writer lock for autonomous task execution.
- No human gate model for "plan complete" and "development complete".
- No task/subtask notification event type.
- No evidence model tying task completion to validation and commit results.
- No validation harness for task/subtask execution.

## Scope

### In Scope

- Top-left `Tasks` entry in the existing app chrome.
- `/tasks` unified task list.
- `/tasks/:taskId` task detail view.
- Project-scoped tasks.
- Task creation with required project selection.
- Task creation immediately starts planning.
- One backing Codex session per task.
- Subtask creation under an existing task.
- Sending newly-created subtasks into the existing task Codex session as
  follow-up input.
- Task list, task detail, pause/resume/cancel, retry failed stage.
- Machine-readable stage completion contract for plan, code, review, and subtask
  completion.
- A single scheduler loop inside the Go server.
- One active writer per project at a time.
- Codex-backed execution through normal session creation and follow-up inputs.
- Stage state machine for plan, code, review, and commit.
- User-confirmation gates after plan generation and after development.
- SSE events that surface task attention in the existing workspace shell.
- Browser notification hooks for task attention when permission is granted.
- Durable task and subtask metadata from v1. This does not include transcript or
  artifact mirroring.
- Validation evidence references per task.
- Commit-stage integration with the project GitService once that plan lands.

### Not In Scope

- Replacing Codex reasoning with a hopter-native planner.
- Mirroring Codex transcript history into task storage.
- Running multiple concurrent writers in the same project repository.
- Cloud relay or multi-host scheduling.
- Terminal-first task management.
- Arbitrary shell commands from the browser.
- Force push, branch management, PR creation, or remote merge automation.
- Running task work while unresolved app-server approval requests exist for the
  same task.
- Generic list-app features unrelated to agent execution.
- Changes to the Projects surface beyond using project selection in task creation.

## Core Design

### Objects

`Task`

- `id`
- `project_id`
- `title`
- `prompt`
- `priority`
- `status`
- `current_stage`
- `session_id`
- `created_at`
- `updated_at`
- `blocked_reason`
- `commit_id`
- `validation_evidence_path`
- `completed_at`

`Subtask`

- `id`
- `task_id`
- `title`
- `prompt`
- `status`
- `session_turn_id`
- `created_at`
- `updated_at`
- `completed_at`

`TaskStageRun`

- `id`
- `task_id`
- `subtask_id` *(optional)*
- `stage`
- `status`
- `session_id`
- `session_turn_id`
- `backend_thread_id`
- `nonce`
- `gate_revision`
- `base_head_sha`
- `base_status_token`
- `expected_diff_fingerprint`
- `started_at`
- `completed_at`
- `summary`
- `evidence_path`

`TaskHumanGate`

- `id`
- `task_id`
- `stage`
- `status`
- `question`
- `recommended_decision`
- `decision`
- `decided_at`
- `comment`

`StageCompletionSignal`

- `task_id`
- `task_stage_run_id`
- `subtask_id` *(optional)*
- `stage`
- `session_id`
- `session_turn_id`
- `nonce`
- `gate_revision`
- `status`
- `summary`
- `evidence_path`
- `ready_for_gate`
- `detected_at`

### Task State Machine

```text
task created
  -> planning
  -> awaiting_plan_approval
  -> coding
  -> awaiting_dev_approval
  -> reviewing
  -> committing
  -> done
```

Terminal states:

```text
canceled
failed
```

Recoverable states:

```text
paused
blocked
```

The task begins planning immediately after creation. No file-writing stage starts
before plan approval. The scheduler may move between machine stages
automatically, but it must stop at both human gates:

1. `awaiting_plan_approval`
2. `awaiting_dev_approval`

### Subtask State Machine

```text
task exists
  -> user adds subtask
  -> subtask open
  -> scheduler sends subtask prompt to task.session_id
  -> subtask running
  -> task returns to coding / awaiting_dev_approval
  -> subtask done
  -> task done only when all subtasks are done and task gates pass
```

## Scheduling Model

### Scheduler

Add an internal scheduler package:

```text
internal/tasks
  service.go
  scheduler.go
  store.go
  prompts.go
  evidence.go
```

The scheduler loop:

1. loads the next runnable task or subtask by priority and creation time
2. checks the project writer lease
3. starts the task's Codex session if it does not exist
4. sends task or subtask input to the task's Codex session
5. writes lightweight task/subtask stage state
6. publishes SSE events on task changes
7. stops immediately at human gates

The scheduler must use a task-aware runtime handoff. Current `CreateSession`
returns before the backend thread/turn id is known, so implementation needs an
internal observer or runtime API that persists:

- `backend_thread_id`
- `session_turn_id`
- `task_stage_run_id`
- stage completion/reconcile events

Scheduler state may not advance until the task stage is correlated to the exact
Codex turn.

### Project Writer Lease

Only one task may run a writing stage for a project at a time.

This prevents task/subtask execution from corrupting another task's diffs or
commits. It also fits the existing commit plan, which treats commit as
project-scoped and commits repository state, not a session-local file subset.

Lease shape:

- key: `project_id`
- owner: `task_id + task_stage_run_id`
- stage scope: held for code/commit and any write-capable subtask turn, not
  read-only planning/review
- fencing token
- heartbeat/TTL
- acquired before dispatching write-capable turns
- released only on terminal, blocked, failed, canceled, or explicit recovery

Task scheduler, GitService, and manual session mutations must consult the same
project work coordinator before making repository writes.

### Resume Rules

On server restart:

- tasks in `paused`, `done`, and human-gate states remain as-is
- tasks or subtasks not yet sent to Codex remain runnable
- tasks in active machine states reconcile by stored `session_turn_id`
- if the stored turn has a terminal valid marker, the task advances
- if the stored turn is still running or cannot be read, the task becomes blocked
- retry creates a new stage run with a new nonce; it does not blindly replay the
  original prompt
- Tasks does not infer completion from partial Codex transcript state

This is boring. Boring survives restarts.

Subtask sequencing:

- subtasks get a monotonic sequence per task
- only one subtask follow-up may be active in a task session at a time
- no subtask is dispatched while the session has an active turn or unresolved
  app-server approval
- scope-changing subtasks create a revised plan gate before coding continues

## Codex Integration

Each task is backed by exactly one Codex session.

- creating a task creates the Codex session and starts the plan stage
- code stage continues the same session after plan approval
- adding a subtask sends follow-up input to the same session
- review stage asks Codex in the same task context to inspect the diff and
  produce a review artifact
- commit stage calls hopter's project GitService after user approval and review

Tasks stores session ids, subtask ids, gate state, and short summaries only. Full
transcript, tool events, approvals, and artifacts remain Codex-owned and exposed
through the existing session APIs.

### Prompt Contract

Task planning prompt must require:

- concrete requirements
- subtask checklist if the task text implies multiple work items
- file and subsystem impact map
- test plan
- validation evidence plan
- explicit "ready for user plan approval" final answer
- a structured completion marker that the scheduler can parse

Coding prompt must require:

- implementation of the approved task plan only
- tests and validation
- evidence path recording
- explicit "ready for user development approval" final answer
- a structured completion marker that the scheduler can parse

Subtask prompt must require:

- treat the subtask as additional work inside the existing task context
- preserve the approved task plan unless the subtask contradicts it
- report whether the subtask is complete
- return the task to the development approval gate when code changes are done
- a structured completion marker that the scheduler can parse

Review prompt must require:

- inspect actual diff
- list blocking issues first
- run or cite validation
- produce a final pass/fail recommendation
- a structured completion marker that the scheduler can parse

### Stage Completion Contract

Prompt text alone is not enough. Each stage must produce a parseable terminal
block in the final assistant message:

```text
HOPTER_TASK_STAGE_RESULT
task_id: <task id>
task_stage_run_id: <stage run id>
subtask_id: <subtask id or empty>
stage: plan | code | review | commit | subtask
session_turn_id: <expected turn id>
nonce: <scheduler-generated nonce>
gate_revision: <current gate revision>
status: ready_for_gate | done | blocked | failed
summary: <one-line user-facing summary>
evidence_path: <path or empty>
next_gate: plan_approval | development_approval | none
END_HOPTER_TASK_STAGE_RESULT
```

The scheduler only advances stages when both are true:

1. the backing session reaches a terminal non-running state
2. the latest assistant message for the expected turn contains exactly one valid
   `HOPTER_TASK_STAGE_RESULT`
3. the marker matches the active `task_stage_run_id`, `session_turn_id`, `nonce`,
   optional `subtask_id`, and `gate_revision`

If either condition is missing, the task becomes `blocked` with a retry action.
Evidence paths are canonicalized by hopter; the model may cite a path, but the
server records the final accepted evidence path.

### Transition Rules

| From | Action/Event | To | Notes |
|---|---|---|---|
| new task | create accepted | active/planning | session start scheduled unless scheduler disabled |
| active/planning | valid plan marker | waiting/plan gate | create gate revision |
| waiting/plan gate | approve current gate | active/code | requires gate id/revision/idempotency |
| waiting/plan gate | request revision | active/planning | new stage run + nonce |
| active/code | valid code marker | waiting/development gate | changed files/evidence attached |
| waiting/development gate | add subtask | waiting/development gate | subtask open; runs after current gate resolved |
| waiting/development gate | approve current gate | active/review | requires gate id/revision/idempotency |
| active/review | valid review marker | waiting/ready_to_commit | or blocked if review fails |
| ready_to_commit | commit succeeds | done | checkbox becomes checked |
| ready_to_commit | GitService unavailable | blocked_commit | not done |
| any active stage | pause requested | pausing | interrupt/wait for terminal or block |
| pausing | turn stopped | paused | lease released |
| any nonterminal | cancel requested | canceling | interrupt if active |
| canceling | cleanup complete | canceled | lease released |
| blocked | retry | active/<stage> | new stage run + nonce after reconciliation |

## User Gates

### Plan Approval Gate

When planning completes, the scheduler:

1. marks the task `awaiting_plan_approval`
2. publishes a task attention SSE event
3. optionally triggers browser notification
4. shows the plan summary and linked session transcript in the task detail pane

User actions:

- approve plan
- request plan revision
- cancel task

### Development Approval Gate

When coding completes, the scheduler:

1. marks the task `awaiting_dev_approval`
2. publishes a task attention SSE event
3. optionally triggers browser notification
4. shows changed files, validation evidence, subtask completion state, and linked
   session review

User actions:

- approve review/commit stage
- request code revision
- add subtask
- cancel task

## Completion Semantics

Blocked is not done.

Task checkbox behavior:

- checked only for `done`
- unchecked for active, paused, blocked, failed, canceled, and human-gate states
- `blocked_commit` is not equivalent to done
- `ready_to_commit` is a distinct state from `done`

The first shippable version may stop at validated diff/review evidence if
GitService is not ready. It must not pretend that commit succeeded.

## API / IDL Plan

Add `idl/hopter/v1/tasks.proto`.

Recommended service:

```proto
service TaskService {
  rpc ListTasks(ListTasksRequest) returns (ListTasksResponse);
  rpc GetTask(GetTaskRequest) returns (GetTaskResponse);
  rpc CreateTask(CreateTaskRequest) returns (CreateTaskResponse);
  rpc CreateSubtask(CreateSubtaskRequest) returns (CreateSubtaskResponse);
  rpc UpdateSubtask(UpdateSubtaskRequest) returns (UpdateSubtaskResponse);
  rpc PauseTask(PauseTaskRequest) returns (PauseTaskResponse);
  rpc ResumeTask(ResumeTaskRequest) returns (ResumeTaskResponse);
  rpc CancelTask(CancelTaskRequest) returns (CancelTaskResponse);
  rpc ApproveTaskGate(ApproveTaskGateRequest) returns (ApproveTaskGateResponse);
  rpc RequestTaskRevision(RequestTaskRevisionRequest) returns (RequestTaskRevisionResponse);
  rpc RetryTaskStage(RetryTaskStageRequest) returns (RetryTaskStageResponse);
}
```

Gate and retry mutations must include optimistic-concurrency fields:

```proto
message ApproveTaskGateRequest {
  string task_id = 1;
  string gate_id = 2;
  uint64 observed_gate_revision = 3;
  string stage_run_id = 4;
  string idempotency_key = 5;
  string comment = 6;
}

message RequestTaskRevisionRequest {
  string task_id = 1;
  string gate_id = 2;
  uint64 observed_gate_revision = 3;
  string stage_run_id = 4;
  string idempotency_key = 5;
  string instructions = 6;
}

message RetryTaskStageRequest {
  string task_id = 1;
  string stage_run_id = 2;
  string idempotency_key = 3;
}
```

If `observed_gate_revision` is stale, the server rejects the mutation and returns
the current gate.

Recommended enums:

```proto
enum TaskLifecycleStatus {
  TASK_LIFECYCLE_STATUS_UNSPECIFIED = 0;
  TASK_LIFECYCLE_STATUS_ACTIVE = 1;
  TASK_LIFECYCLE_STATUS_WAITING = 2;
  TASK_LIFECYCLE_STATUS_PAUSED = 3;
  TASK_LIFECYCLE_STATUS_BLOCKED = 4;
  TASK_LIFECYCLE_STATUS_FAILED = 5;
  TASK_LIFECYCLE_STATUS_CANCELED = 6;
  TASK_LIFECYCLE_STATUS_DONE = 7;
}

enum StageRunStatus {
  STAGE_RUN_STATUS_UNSPECIFIED = 0;
  STAGE_RUN_STATUS_PENDING = 1;
  STAGE_RUN_STATUS_RUNNING = 2;
  STAGE_RUN_STATUS_WAITING_FOR_GATE = 3;
  STAGE_RUN_STATUS_BLOCKED = 4;
  STAGE_RUN_STATUS_FAILED = 5;
  STAGE_RUN_STATUS_COMPLETED = 6;
}

enum GateStatus {
  GATE_STATUS_UNSPECIFIED = 0;
  GATE_STATUS_OPEN = 1;
  GATE_STATUS_APPROVED = 2;
  GATE_STATUS_REVISION_REQUESTED = 3;
  GATE_STATUS_CANCELED = 4;
  GATE_STATUS_STALE = 5;
}

enum CommitStatus {
  COMMIT_STATUS_UNSPECIFIED = 0;
  COMMIT_STATUS_NOT_READY = 1;
  COMMIT_STATUS_READY_TO_COMMIT = 2;
  COMMIT_STATUS_BLOCKED = 3;
  COMMIT_STATUS_COMMITTED = 4;
}

enum AttentionKind {
  ATTENTION_KIND_UNSPECIFIED = 0;
  ATTENTION_KIND_PLAN_APPROVAL = 1;
  ATTENTION_KIND_DEVELOPMENT_APPROVAL = 2;
  ATTENTION_KIND_BLOCKED = 3;
  ATTENTION_KIND_COMMIT_BLOCKED = 4;
  ATTENTION_KIND_STALE_GATE = 5;
}

enum SubtaskStatus {
  SUBTASK_STATUS_UNSPECIFIED = 0;
  SUBTASK_STATUS_OPEN = 1;
  SUBTASK_STATUS_RUNNING = 2;
  SUBTASK_STATUS_DONE = 3;
  SUBTASK_STATUS_BLOCKED = 4;
  SUBTASK_STATUS_CANCELED = 5;
}

enum TaskStage {
  TASK_STAGE_UNSPECIFIED = 0;
  TASK_STAGE_PLAN = 1;
  TASK_STAGE_CODE = 2;
  TASK_STAGE_REVIEW = 3;
  TASK_STAGE_COMMIT = 4;
  TASK_STAGE_SUBTASK = 5;
}
```

Canonical UI badge mapping:

| Source Fields | Badge |
|---|---|
| lifecycle `ACTIVE` + current stage `PLAN` | Planning |
| lifecycle `WAITING` + attention `PLAN_APPROVAL` | Needs attention |
| lifecycle `ACTIVE` + current stage `CODE` | Running |
| lifecycle `WAITING` + attention `DEVELOPMENT_APPROVAL` | Needs attention |
| commit `READY_TO_COMMIT` | Ready |
| commit `BLOCKED` | Blocked |
| lifecycle `DONE` | Done |
| lifecycle `BLOCKED` | Blocked |
| lifecycle `PAUSED` | Paused |

### Slice 1 Contract

The first slice must be independently buildable.

Proto messages to define in `tasks.proto`:

```proto
message Task {
  string id = 1;
  string project_id = 2;
  string title = 3;
  string prompt = 4;
  string session_id = 5;
  TaskLifecycleStatus lifecycle_status = 6;
  TaskStage current_stage = 7;
  AttentionKind attention_kind = 8;
  CommitStatus commit_status = 9;
  uint32 subtask_count = 10;
  uint32 completed_subtask_count = 11;
  repeated TaskDiagnostic diagnostics = 12;
}

message TaskDiagnostic {
  string code = 1;
  string severity = 2;
  string source = 3;
  string message = 4;
  string cause = 5;
  string user_action = 6;
  bool retriable = 7;
  string evidence_path = 8;
  string session_id = 9;
  string stage_run_id = 10;
  string docs_url = 11;
}
```

Store interface shape:

```go
type Store interface {
  CreateTask(ctx context.Context, input CreateTaskInput) (Task, error)
  GetTask(ctx context.Context, id string) (TaskSnapshot, error)
  ListTasks(ctx context.Context, filter ListTasksFilter) (TaskListPage, error)
  CreateSubtask(ctx context.Context, input CreateSubtaskInput) (Subtask, error)
  CreateStageRun(ctx context.Context, input CreateStageRunInput) (TaskStageRun, error)
  UpdateStageRun(ctx context.Context, patch StageRunPatch) (TaskStageRun, error)
  CreateGate(ctx context.Context, input CreateGateInput) (TaskHumanGate, error)
  ResolveGate(ctx context.Context, input ResolveGateInput) (TaskHumanGate, error)
  AppendDiagnostic(ctx context.Context, input TaskDiagnosticInput) error
  AcquireProjectLease(ctx context.Context, input LeaseInput) (ProjectLease, error)
  ReleaseProjectLease(ctx context.Context, input ReleaseLeaseInput) error
}
```

Slice validation commands:

- `make validate-tasks-idl`
- `make validate-tasks-store`
- `make validate-tasks-marker-parser`
- `make validate-tasks-gates`
- `make validate-tasks-scheduler-fake`
- `make validate-tasks-ui`

Scheduler behavior:

```text
Task creation defaults to execution. There is no environment-variable mode switch
for disabling task scheduling in normal runtime.
```

Mutation response rule:

Every mutation returns:

- updated `Task`
- current gate if one exists
- `accepted`
- structured `TaskDiagnostic[]`

Repeatable mutations include an `idempotency_key`.

Extend `events.proto` with task events:

```proto
WORKSPACE_EVENT_TYPE_TASKS_CHANGED
WORKSPACE_EVENT_TYPE_TASK_CHANGED
WORKSPACE_EVENT_TYPE_TASK_ATTENTION_REQUIRED
REFRESH_HINT_REFETCH_TASKS
REFRESH_HINT_REFETCH_TASK
```

SSE stays the only browser notification transport from Go. Browser Notification
API is an optional UI layer on top of SSE events.

## Backend Plan

### Store

Use a durable embedded KV database from v1, behind `internal/tasks.Store`.

Recommended implementation: BadgerDB (`github.com/dgraph-io/badger/v4`).

This store persists only task/subtask/stage/gate/evidence metadata. It does not
persist Codex transcript history, artifact bodies, raw approval protocol, or raw
tool events.

Storage location:

```text
~/.hopter/tasks/badger/
```

The database lives outside the repo, under the user's local hopter state root.
Badger owns atomic key/value updates and recovery. Values should be canonical JSON
first for easier debugging; protobuf binary can be introduced later only if the
metadata volume justifies it.

Suggested key layout:

```text
task/<task-id>
subtask/<task-id>/<seq>/<subtask-id>
stage-run/<task-id>/<stage-run-id>
gate/<task-id>/<gate-id>
lease/project/<project-id>
index/project/<project-id>/<updated-at>/<task-id>
index/attention/<kind>/<updated-at>/<task-id>
idempotency/<key>
diagnostic/<task-id>/<ts>/<id>
```

Human-readable exports are generated views, not the source of truth:

```text
hopter tasks export --format json
hopter tasks export --format markdown
```

Validation evidence still stays under `storage/artifacts/validation/` unless a
specific validation plan says otherwise.

### Service

`TaskService` validates task and subtask requests, writes records, and delegates
machine execution to the scheduler.

### Scheduler

The scheduler runs inside the Go process and is deliberately simple:

- no distributed workers
- no external queue dependency
- one project writer lease at a time
- bounded retries per stage
- explicit blocked state after restart or repeated failures

### Evidence

Each task should record evidence paths, not inline evidence blobs:

- task session id
- validation evidence path under `storage/artifacts/validation/`
- commit SHA after commit

## Frontend Plan

### Information Architecture

Add a top-level `Tasks` entry without turning `/` into a dashboard.

Recommended surfaces:

- app chrome, top-left: `Tasks`
- `/tasks`: attention-first task list
- `/tasks/:taskId`: task detail with subtasks and embedded session workbench
- task creation: requires project selection, then immediately starts planning
- selected session pane: show linked task badge when a session belongs to a task
- no Projects surface changes in the first slice; Tasks only uses project
  selection during task creation and project filtering inside `/tasks`

`/tasks` default order:

1. Needs attention
2. Blocked
3. Running
4. Queued / planning
5. Ready to commit
6. Done

Project filtering is secondary. Each row shows:

- task title
- project name
- stage/status badge
- gate/action needed, if any
- linked session freshness
- subtask completion count
- completion checkbox state

### Task Detail Priority

Task detail should follow this order:

1. status
2. current gate / required action
3. active session summary/composer/transcript entry
4. subtask checklist
5. plan or development summary
6. evidence
7. stage timeline

Timeline remains supporting detail, not the primary focus.

The task is the wrapper. The session remains the workbench.

Task detail layout:

```text
Task Header
  - title, project, status, stage, updated time

Gate / Required Action Panel
  - visible only when action is required
  - summary
  - what happens next
  - evidence or changed files when relevant
  - primary: Approve plan / Approve development
  - secondary: Request revision
  - destructive: Cancel task

Embedded Session Workbench
  - current session status
  - latest summary
  - compact composer for task-scoped steering
  - Open full session
  - transcript preview collapsed by default

Subtasks
  - checklist with status badges
  - add subtask form
  - scope-change warning when needed

Evidence
  - validation path
  - changed files
  - review result

Timeline
  - collapsed by default
```

Task creation copy:

- primary button: `Create and start planning`
- helper copy: `No code changes until you approve the plan.`
- required fields: project, task prompt
- optional fields: initial subtasks, priority

Gate card content:

| Gate | Must Show | Primary Action | Secondary Actions |
|---|---|---|---|
| Plan approval | plan summary, risks, files/subsystems, validation plan, next step | Approve plan and start coding | Request revision, Cancel task |
| Development approval | changed files, validation evidence, subtask completion, known risks, next step | Approve review/commit | Request revision, Add subtask, Cancel task |
| Plan revision required | why scope changed, subtask that triggered it, revised plan summary | Approve revised plan | Request revision, Cancel task |
| Commit blocked | git status reason, evidence path, what remains | Open commit action / Retry when ready | Leave ready_to_commit, Cancel task |

UI state matrix:

| State | User Sees | Primary Action | Secondary Action | Row Badge | Detail Banner |
|---|---|---|---|---|---|
| loading | skeleton rows/detail | none | none | none | loading |
| empty | create-task CTA + project picker | Create and start planning | none | none | n/a |
| offline/SSE disconnected | stale data indicator | Retry connection | continue browsing cached state | Offline | Connection degraded |
| Codex unavailable | task blocked reason | Retry | open settings | Blocked | Codex unavailable |
| queued by lease | waiting for project writer | none | pause/cancel | Waiting | Another task owns project writer lease |
| planning | linked session planning | none | pause/cancel | Planning | No code changes yet |
| awaiting_plan_approval | gate card | Approve plan and start coding | request revision/cancel | Needs attention | Plan approval required |
| coding | active session workbench | none | pause/cancel | Running | Codex is changing files |
| awaiting_dev_approval | dev gate card | Approve review/commit | add subtask/request revision/cancel | Needs attention | Development approval required |
| stale gate | stale warning | Refresh gate | cancel | Stale | Gate changed since opened |
| malformed marker | blocked parser error | Retry stage | open session | Blocked | Stage completion marker missing |
| notification denied | in-app attention only | Enable in browser settings | dismiss | Attention | Notifications disabled |
| linked session missing | degraded state | Reconnect/refetch | cancel task | Degraded | Linked session unavailable |
| ready_to_commit | reviewed evidence | Open commit action | leave ready | Ready | Ready to commit |
| blocked_commit | blocked reason | Retry commit | leave ready/cancel | Blocked | Commit blocked |
| done | checked task | none | reopen/add subtask | Done | Completed |

Responsive rules:

- `phone`: `/tasks` is the entry list. `/tasks/:taskId` is a second-level detail
  page. Gate action panel is sticky above the composer. Transcript preview stays
  collapsed by default.
- `compact`: task list can collapse inline like the existing session rail. Detail
  keeps gate/action panel above session workbench.
- `wide`: task list and detail may sit in the workspace shell, but no nested card
  stacks. Keep dense operational layout.

Accessibility rules:

- gate arrival moves focus to the gate panel heading only when it appears in the
  active route
- task attention events use an ARIA live region
- status badges have text labels, not color alone
- form errors are associated with inputs
- all gate actions are reachable by keyboard
- touch targets are at least 44px on phone
- browser notification denial never hides the in-app attention state

### Notifications

Use existing SSE connection to detect task attention.

If browser notification permission is granted, show:

- task title
- gate type
- short required action

The app must still work when browser notifications are blocked.

## Commit Stage

Commit is intentionally downstream of the separate project GitService plan.

For the first integrated Tasks version:

- before code stage begins, require a clean worktree or explicit adoption of
  existing dirty state
- record `base_head_sha`, `base_status_token`, and expected diff fingerprint for
  each write-capable stage
- if GitService is unavailable, stop after review with `blocked: commit service
  unavailable`
- if GitService is available, load fresh project git status
- reject commit when the project has dirty changes not attributable to the active
  task run unless the user explicitly approves the repository-wide commit policy
- call the project commit API with fresh status token
- record commit SHA and git evidence path

Tasks must not call raw `git` through Codex chat.

If GitService is not ready, the task completion target is `ready_to_commit` with
validated diff/review evidence, not `done`.

## Validation Plan

Add `scripts/validate-tasks.ts`.

Required checks:

1. create a task through Connect with a selected project
2. observe task SSE events
3. scheduler creates the task's Codex session
4. task stops at `awaiting_plan_approval`
5. approve plan
6. scheduler runs code stage
7. task stops at `awaiting_dev_approval`
8. add a subtask and verify it sends follow-up input to the same task session
9. verify the subtask reaches done or blocked state
10. request revision and verify it re-enters code stage
11. approve development
12. run review stage
13. verify stage marker injection in task/subtask prompt is rejected
14. restart during plan/code/subtask/review and verify turn reconciliation before retry
15. verify stale gate mutation rejection
16. verify same-project concurrent tasks serialize on project writer lease
17. verify `blocked_commit` is not rendered as done when GitService is unavailable
18. commit stage blocks or succeeds with honest evidence depending on GitService
19. evidence bundle is written under `storage/artifacts/validation/tasks_<timestamp>/`

Required evidence files:

- `task-events.jsonl`
- `task-state-transitions.json`
- `subtask-followup.json`
- `plan-gate.json`
- `development-gate.json`
- `review-summary.md`
- `commit-result.json` or `commit-blocked.json`
- `summary.md`

## Implementation Slices

### Slice 1: IDL and state model

- Add `tasks.proto`.
- Generate Go and TypeScript clients.
- Add task, subtask, and stage domain models.
- Add gate revision, stage run nonce, expected turn id, and idempotency fields.
- Add durable Badger-backed task metadata store behind `internal/tasks.Store`,
  persisted under `~/.hopter/tasks/badger/` for normal runtime and under
  Hopter's hardcoded dev-state root for the local dev loop.
- Add task events to `events.proto`.

### Slice 2: backend service and scheduler skeleton

- Add `internal/tasks`.
- Register `TaskService`.
- Implement create/list/get/pause/resume/cancel.
- Implement create subtask and subtask state updates.
- Add task-aware Codex turn ownership or observer API.
- Add shared project work coordinator for writer leases.
- Implement scheduler loop with project writer lease.
- Publish task SSE events.

### Slice 3: plan gate

- Scheduler creates one task session with a task-owned prompt.
- Detect plan completion through session state plus fenced `HOPTER_TASK_STAGE_RESULT`.
- Stop at `awaiting_plan_approval`.
- Add approve/revision actions with gate id/revision and idempotency keys.

### Slice 4: code gate and subtasks

- Scheduler runs code stage after plan approval.
- Scheduler sends subtasks as follow-up input to the existing task session.
- Detect development completion through session state plus fenced `HOPTER_TASK_STAGE_RESULT`.
- Stop at `awaiting_dev_approval`.
- Add approve/revision/add-subtask actions.
- Add subtask sequencing and can-send-input predicate.

### Slice 5: review and commit

- Run review stage from actual diff and validation evidence.
- Integrate with project GitService when available.
- Record commit evidence.
- Leave honest blocked state when commit dependency is unavailable.

### Slice 6: workspace UI

- Add top-level `Tasks` entry.
- Add task list and task detail surface.
- Add task creation with required project picker.
- Add subtask checklist and subtask creation.
- Add gate approval UI.
- Add task attention indicators.
- Add browser notification affordance.
- Preserve workspace shell hierarchy and token rules.

### Slice 7: validation

- Add task validation script.
- Add unit tests for stage completion parsing, state transitions, scheduler
  leases, subtask follow-ups, and gate actions.
- Add browser validation for task attention and gate approval flow.

## Risks

### Risk 1: Tasks becomes an agent orchestrator

Mitigation:

- keep task prompts and stage state simple
- Codex remains the only reasoning backend
- no hopter-native planning engine

### Risk 2: Task storage becomes a transcript mirror

Mitigation:

- store session ids and evidence references only
- render transcript through existing session APIs

### Risk 3: Concurrent tasks corrupt repo state

Mitigation:

- one writer lease per project
- fresh git status before commit
- block on stale or unexpected repository state

### Risk 4: Notifications are missed

Mitigation:

- SSE updates task state
- browser notification is only a convenience
- gate state remains visible in Tasks until resolved

### Risk 5: Commit stage conflicts with project-wide commit policy

Mitigation:

- depend on GitService for commit execution
- show fresh repository status
- require explicit user confirmation before committing project-wide state

### Risk 6: Subtasks blur plan approval

Mitigation:

- subtask prompts must preserve the approved task plan unless the user explicitly
  changes scope
- subtask execution returns to development approval before review/commit
- task done is false until all subtasks are done or canceled

### Risk 7: Tasks hides the session

Mitigation:

- task detail foregrounds the active session summary/composer/transcript entry
- task records link to exactly one session
- transcript and artifacts are still rendered through existing session APIs
- every Tasks feature must make local agent work safer, clearer, or easier to
  resume

### Risk 8: Stage marker injection advances the wrong run

Mitigation:

- every stage run gets a scheduler-generated nonce and expected turn id
- parser accepts exactly one marker from the expected terminal turn
- marker must match task id, stage run id, optional subtask id, nonce, and gate
  revision
- user task/subtask text cannot supply or override these fields

### Risk 9: Restart retry duplicates repository writes

Mitigation:

- reconcile by stored `session_turn_id` before retry
- if the turn completed with a valid marker, advance instead of retrying
- retry creates a fresh stage run and nonce
- write-capable stages compare base git status/diff fingerprint before continuing

## Acceptance Criteria

- User can open top-level `Tasks`.
- User can create a task by selecting a project and entering task text.
- Creating a task immediately starts one linked Codex session in planning mode.
- Creating a task starts planning only; no file-writing stage starts before plan
  approval.
- User can add subtasks under a task.
- Adding a subtask sends follow-up input into the task's existing Codex session.
- Task is checked done only when all required task/subtask work completes and
  review/commit gates pass.
- Commit-blocked tasks are not rendered as done.
- Scheduler processes runnable tasks while respecting one writer per project.
- Plan stage in the task session stops for user approval.
- Plan and development gates are detected through a machine-readable stage
  completion contract, not prompt vibes.
- Code stage produces implementation evidence and stops for user approval.
- Review stage inspects the actual diff and validation evidence.
- Commit stage either commits through GitService with evidence or blocks honestly.
- Task attention is delivered through SSE and visible in the workspace UI.
- Browser notifications work when permission is granted but are not required.
- Validation evidence path is recorded for the full task/subtask flow.

## NOT in Scope

- cloud-hosted workers
- multi-machine scheduling
- task execution outside the local project repository
- replacing Codex sessions
- PR creation or deployment
- terminal-first task control
- generic list app features unrelated to agent execution

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|-------|----------|----------------|-----------|-----------|----------|
| 1 | Phase 0 | Created `docs/planning/AUTONOMOUS_TASK_QUEUE_PLAN.md` from the user request because no existing task/task-queue plan was present. | Mechanical | Bias toward action | `/autoplan` needs a concrete plan artifact to review and improve. | Waiting for a separate planning prompt. |
| 2 | Phase 0 | Proceeded with standard review despite no branch-specific `/office-hours` design doc. | Mechanical | Bias toward action | The user explicitly invoked `/autoplan`; stopping for a prerequisite workshop would delay the requested review. | Blocking on `/office-hours`. |
| 3 | Phase 0 | Detected UI scope and DX scope. | Mechanical | Completeness | The feature adds user-facing task/gate UI plus developer/agent workflow APIs and scheduler behavior. | Backend-only review. |
| 4 | Phase 1 | Reframed the visible product from "task queue" to top-level `Tasks` with Project -> Task -> Subtask hierarchy. | User correction | User sovereignty | The user clarified the desired product shape: a task manager where queue behavior is implementation detail. | Keeping a hidden queue-only surface. |
| 5 | Phase 1 | Set one task equal to one Codex session; subtasks become follow-up turns in that session. | User correction | Explicit over clever | This preserves the user's mental model and avoids proliferating sessions per subtask. | Separate plan/code/review sessions per task or subtask. |
| 6 | Phase 1 | Changed immediate execution copy to "starts planning" and blocked file-writing before plan approval. | Mechanical | Explicit over clever | Both outside CEO voices flagged that raw "immediate execution" makes task creation feel dangerous. | Letting task creation imply immediate repo mutation. |
| 7 | Phase 1 | Added machine-readable `HOPTER_TASK_STAGE_RESULT` contract. | Mechanical | Completeness | Stage detection is the core product loop and cannot depend on prompt vibes alone. | Detecting completion from natural language summaries only. |
| 8 | Phase 1 | Made durable task metadata v1 scope. | Taste | Completeness | A top-level task product cannot lose task/subtask/gate state on restart, while still avoiding transcript mirroring. | In-memory-only task store. |
| 9 | Phase 1 | Separated `ready_to_commit`, `blocked_commit`, and `done`. | Mechanical | Design for trust | A blocked commit is not complete work, and the checkbox must not lie. | Treating honest commit block as task done. |
| 10 | Phase 1 | Foregrounded the active session in task detail. | Mechanical | User sovereignty | Both outside CEO voices agreed that Tasks must wrap session work without hiding the session workbench. | Putting linked session low in task detail. |
| 11 | Phase 1 | Made stage-completion parser tests and browser gate validation mandatory. | Mechanical | Completeness | The task loop is only trustworthy if gates are detected reliably and proven with evidence. | Relying on manual testing. |
| 12 | Phase 1 | Deferred OS-native/push notifications while keeping browser notifications in scope. | Taste | Pragmatic | Browser notifications are in blast radius; native/push requires relay/host integration outside the first task slice. | Building notification infrastructure before the gate loop works. |
| 13 | Phase 1 | Deferred branch/worktree parallelism but kept future compatibility as a design constraint. | Taste | Bias toward action | Same-project parallel writers are valuable later, but v1 must first serialize safely and not corrupt repos. | Building multi-worktree scheduling first. |
| 14 | Phase 2 | Made `/tasks` attention-first instead of project-first. | Mechanical | Hierarchy as service | Users open Tasks to see what needs action, not browse project buckets. | Default project-grouped todo list. |
| 15 | Phase 2 | Added concrete gate-card content and actions. | Mechanical | Design for trust | Approving a plan or development stage requires summary, evidence, next action, and explicit choices. | Generic approve buttons. |
| 16 | Phase 2 | Added responsive and accessibility requirements. | Mechanical | Completeness | A remote control plane must work on phone and keyboard/screen-reader flows. | Leaving layout/a11y to implementation taste. |
| 17 | Phase 3 | Added task-aware Codex turn ownership requirement. | Mechanical | Explicit over clever | Current session creation returns before thread/turn ids are reliably available for task stage ownership. | Assuming `session_turn_id` is available from current APIs. |
| 18 | Phase 3 | Fenced stage markers with nonce, stage run id, turn id, and gate revision. | Mechanical | Security | Plain marker parsing is prompt-injection prone and can advance the wrong run. | Trusting latest assistant text alone. |
| 19 | Phase 3 | Added gate optimistic concurrency/idempotency. | Mechanical | Safety | Stale approval must be rejected at the API boundary, not only shown in UI. | Gate approval by task id only. |
| 20 | Phase 3 | Added shared project work coordinator. | Mechanical | Pragmatic | Task scheduler, GitService, and manual session writes need one writer truth. | Separate ad hoc active-writer checks. |
| 21 | Phase 3 | Added restart reconciliation before retry. | Mechanical | Completeness | Blind retry can duplicate file writes after a completed-but-unpersisted turn. | Replaying original prompt after restart. |
| 22 | Phase 3.5 | Split task status into lifecycle, stage, gate, attention, and commit status. | Mechanical | Explicit over clever | One overloaded enum would make implementers guess which state drives UI and transitions. | Single `TaskStatus` enum for everything. |
| 23 | Phase 3.5 | Added `TaskDiagnostic` structured error contract. | Mechanical | Fight uncertainty | Developers and users need problem, cause, fix, retryability, and evidence for blocked states. | Freeform `blocked_reason` strings only. |
| 24 | Phase 3.5 | Added scheduler disabled/manual/auto modes. | Mechanical | Developer experience | Contributors need API/UI/store validation without accidentally launching Codex or mutating repos. | Always-auto scheduler in dev/tests. |
| 25 | Phase 3.5 | Added per-slice validation commands. | Mechanical | Completeness | Full E2E validation is too late; each implementation slice needs proof. | Waiting for one final browser harness. |
| 26 | Final Gate | Limited the first UI entry to a top-left `Tasks` entry and removed Projects surface changes. | User override | User sovereignty | User clarified that Tasks should not affect Projects beyond project selection. | Adding task counts/attention to Projects. |
| 27 | Final Gate | Set durable task metadata storage under `~/.hopter`. | User override | User sovereignty | User clarified local persistent storage can live under the hopter state root. | Repo-local task metadata. |
| 28 | Final Gate | Changed durable task storage from SQLite to sqless files under `~/.hopter/tasks/`. | Superseded | User sovereignty | User initially asked for sqless storage. Superseded by decision 29 to use embedded DB. | SQLite database. |
| 29 | Final Gate | Use embedded KV database for task metadata, with BadgerDB as recommended implementation. | User approved | Explicit over clever | Task/gate/stage/lease updates need transactional local metadata storage; Badger avoids SQL while giving atomic KV persistence. | Structured text as source of truth. |

## /autoplan Phase 0 Intake

### Plan Summary

The plan introduces a top-level `Tasks` surface for hopter. Users create
project-scoped tasks, each task starts one Codex session immediately, and
subtasks are sent into that same session as follow-up input. Hopter schedules the
task through `plan -> code -> review -> commit`, stopping at plan-complete and
development-complete gates for human confirmation.

### Context Read

- Active branch: `master`.
- Base branch: `master`.
- New plan file: `docs/planning/AUTONOMOUS_TASK_QUEUE_PLAN.md`.
- Restore point: local gstack project artifact.
- Existing uncommitted user change preserved: `docs/planning/COMMIT_AND_PUSH_CAPABILITY_PLAN.md`.
- Design doc check: no branch-specific `/office-hours` design doc found.
- UI scope: yes. The plan adds top-level `Tasks`, task detail, subtask checklist,
  gate approval, and notification affordances.
- DX scope: yes. The plan adds Connect APIs, scheduler behavior, AI-agent workflow
  surfaces, and validation/DX implications.

### System Audit Findings

- `README.md`, `docs/README.md`, Go rebuild plans, IDL plans, UI design docs, and
  validation docs all confirm the active architecture: Go + Connect + SSE +
  React/Vite, with `codex app-server` as the primary runtime.
- Existing runtime surfaces to reuse:
  - `internal/rpc/session_service.go`
  - `internal/agents/manager.go`
  - `internal/agents/codex/manager.go`
  - `internal/events/hub.go`
  - `internal/http/sse.go`
  - `ui/src/lib/sse/use-workspace-events.ts`
  - `ui/src/features/sessions/use-sessions.ts`
- Existing project/session models already carry lightweight state and session
  references, matching the repo rule that hopter should not mirror Codex history.
- Existing app-server docs in the repo say approval request surfacing remains not
  fully runtime-proven. Tasks must treat approval-dependent automation as a
  validation risk.
- `TODOS.md` currently contains relay follow-ups only. No existing task TODO
  blocks this plan.
- TODO/FIXME scan found one directly related UI TODO:
  `ui/src/components/app/session-detail-pane.tsx` still has a commit action TODO.
  That ties the task commit stage to the separate GitService plan.

### Landscape Check

- Tried-and-true external queue choices exist. Temporal provides durable workflow
  coordination and recovery, and Asynq provides Redis-backed task
  enqueue/schedule/retry semantics.
- For hopter v1, those are too much infrastructure. The product is local-first
  and single-process today; adding Redis or Temporal would spend an
  infrastructure token before the product needs distributed workers.
- First-principles read: the hard problem is not distributed execution. It is
  preserving Codex truth, stopping at human gates, representing task/subtask
  state clearly, and keeping repository writes serialized.
- OpenAI's Codex App Server guidance supports using App Server for rich UI
  integrations and session semantics; that aligns with this plan's "task drives
  normal sessions" approach.

Sources used for the landscape check:

- OpenAI, "Unlocking the Codex harness: how we built the App Server": https://openai.com/index/unlocking-the-codex-harness/
- Asynq GitHub README: https://github.com/hibiken/asynq
- Temporal Go SDK samples: https://github.com/temporalio/samples-go
- Temporal Go workflow package docs: https://pkg.go.dev/go.temporal.io/sdk/workflow

## Phase 1 CEO Review

### 0A. Premise Challenge

| Premise | Evaluation | Risk If Wrong | Current Recommendation |
|---|---|---|---|
| Product shape should be Project -> Task -> Subtask, with top-level `Tasks`. | Strong. This is the user's clarified mental model and is more concrete than an abstract queue. | If ignored, the product becomes an implementation demo, not a task-management workflow. | Accept as product foundation. |
| One task should equal one Codex session. | Strong. It preserves continuity, keeps transcript truth in one place, and makes subtasks natural follow-up turns. | If each stage/subtask gets a new session, context fragments and users lose the thread. | Accept. |
| Task creation should start execution immediately. | Strong but needs visible state. | If execution starts silently, users will distrust it; if it waits for a second click, the workflow feels fake. | Accept, with immediate visible `planning` state. |
| Subtasks should continue execution in the same task session. | Strong. It matches "add to this task" semantics. | If subtask prompts bypass the approved plan, they can mutate scope unpredictably. | Accept, with subtask prompts constrained by approved task plan. |
| The task system should keep plan/code/review/commit gates. | Still right. This preserves the original safety model. | Removing gates turns Tasks into unchecked autonomous repo writes. | Accept. |
| Commit can be automated after review. | Directionally right, but depends on project GitService and clean repo-state checks. | Queue commit could capture unrelated dirty files. | Accept only through GitService and fresh status evidence. |

### 0B. Existing Code Leverage

| Sub-problem | Existing Code / Document | Reuse Plan |
|---|---|---|
| Create and steer Codex work | `internal/rpc/session_service.go`, `internal/agents/manager.go`, `internal/agents/codex/manager.go` | TaskService should call normal session runtime methods, not a parallel Codex client. |
| Live notifications | `internal/events/hub.go`, `internal/http/sse.go`, `ui/src/lib/sse/use-workspace-events.ts` | Extend existing global SSE event envelope with task refresh and attention events. |
| Session status and transcript truth | `internal/core/models.go`, `ListSessionTranscript`, `GetSessionMeta` | Store only session ids and summaries on task records; render transcript through session APIs. |
| Approval model | `RespondToSessionApproval`, `handleServerRequest` in Codex manager | Keep Codex approval semantics separate from task gates; task gates are user workflow gates, not app-server approval replacements. |
| Review diff surface | `GetSessionReview` and `SessionReview` | Use as review evidence, not commit-set selection. |
| Commit stage | `docs/planning/COMMIT_AND_PUSH_CAPABILITY_PLAN.md` | Depend on planned project GitService; do not call raw git through Codex chat. |
| Validation evidence | `docs/VALIDATION_HARNESS.md`, `docs/planning/GO_REBUILD_VALIDATION_PLAN.md` | Add a task validation lane that writes evidence under `storage/artifacts/validation/`. |

### 0C. Dream State Mapping

```text
CURRENT STATE
  User manually starts Codex sessions, follows progress, reviews output, and
  decides when to continue.

      --->

THIS PLAN
  User opens Tasks, creates project-scoped tasks, adds subtasks, and lets each
  task's Codex session run until a human gate needs attention.

      --->

12-MONTH IDEAL
  Hopter is a local agent workbench: projects contain tasks, tasks contain
  subtasks, every task has a traceable session, gates are visible, validation is
  evidence-backed, commits are explicit, and Codex truth is never mirrored.
```

### 0C-bis. Implementation Alternatives

| Approach | Summary | Effort | Risk | Pros | Cons | Reuses |
|---|---|---:|---:|---|---|---|
| A. Tasks as Thin Session Layer | Add Task/Subtask domain, one session per task, in-process scheduler, task events, and UI. | M | Medium | Best fit for clarified product, small infrastructure footprint, preserves Codex truth. | Restart recovery for active stages is explicit blocked/retry, not durable workflow replay. | Existing SessionService, SSE, workspace patterns. |
| B. Queue-First Background Jobs | Keep queue as primary concept, with stages as jobs and sessions per stage. | M | High | Easier scheduler model. | Wrong product shape, fragments context, makes subtasks awkward. | Some SessionService reuse. |
| C. Durable Workflow Engine | Use Temporal-style workflow orchestration for tasks, subtasks, retries, gates, and recovery. | XL | High | Strong durable execution and observability. | Adds a service dependency that conflicts with simple self-hosted local v1. | Could wrap SessionService, but introduces new runtime. |

**Recommendation:** Choose Approach A. It matches the user's product model and
preserves hopter's architecture: Codex owns session truth, hopter owns task state
and gates, and one writer touches a project at a time.

### 0D. Mode-Specific Analysis

Mode selected by `/autoplan`: SELECTIVE EXPANSION.

Minimum complete scope:

- `Tasks` top-level entry
- `/tasks` and `/tasks/:taskId`
- `tasks.proto` and generated clients
- task/subtask store interface and first in-memory implementation
- scheduler loop with per-project writer lease
- one Codex session per task
- subtasks as follow-up input to task session
- plan and development human gates
- SSE task/attention events
- task detail UI and gate approval UI
- validation script with task/subtask evidence bundle
- commit-stage dependency on GitService with honest blocked state until available

Expansion candidates:

| Candidate | Decision | Rationale |
|---|---|---|
| Browser Notification API for attention gates | Accepted | In blast radius, low effort, directly matches the user's notification requirement. |
| Task list project grouping/filtering | Accepted | Required by the product shape because task creation requires project selection. |
| OS-native notifications when no browser tab is open | Deferred | Useful, but crosses into host integration and permissions beyond the first task slice. |
| Parallel execution across different projects | Deferred | Valuable later, but v1 should prove safe per-project serialization first. |
| Durable embedded KV task store in first slice | Accepted | More complete restart behavior without SQL; Badger-backed metadata lives under `~/.hopter/tasks/badger/`. |
| Task templates/reusable workflows | Deferred | Nice platform feature, not needed for the first user promise. |

### 0E. Temporal Interrogation

```text
HOUR 1
  User opens Tasks, creates a task, picks a project, and sees it immediately enter
  planning with a linked Codex session.

HOUR 2
  Task reaches plan gate. User approves from another browser. Scheduler continues
  code work in the same session.

HOUR 4
  User adds a subtask. Scheduler sends it as follow-up input to the same task
  session, then returns to development approval.

HOUR 6+
  If the server restarted mid-stage, the task is blocked with a retry action
  instead of silently claiming success. If commit dependency is unavailable,
  review can complete and commit blocks honestly.
```

### 0F. Mode Confirmation

SELECTIVE EXPANSION remains the right mode. The core plan is valid after the
user correction, and the review should now evaluate **Tasks as product surface**,
not "queue" as the product.

The durable task store choice was upgraded into v1 scope after dual-voice review:
top-level Tasks cannot be trustworthy if task metadata disappears on restart.

### 0.5 Dual Voices

#### CLAUDE SUBAGENT (CEO - Strategic Independence)

The independent reviewer recommended proceeding only if the feature is framed as
**session-backed work orders**, not "Wunderlist plus agents."

Key findings:

- Critical: the plan demoted the session too far. Task detail must foreground the
  live session because hopter's product truth is still session re-entry.
- Critical: stage completion detection was too hand-wavy. The first proof must be
  create task -> Codex plans -> hopter reliably detects plan completion -> task
  blocks at plan approval.
- High: immediate task creation must mean "start planning now", not "start
  mutating files now."
- High: subtasks need scope checks so they cannot silently mutate an approved plan.
- High: commit-blocked cannot mean done.
- Medium: v1 should reuse session records aggressively and avoid a second large
  lifecycle until the gate loop proves itself.

#### CODEX SAYS (CEO - Strategy Challenge)

Codex agreed on the same major risk: a generic task manager is not the wedge.

Key findings:

- Tasks is an IA pivot, not a small feature. It must not contradict the
  session-first product thesis.
- The plan is orchestration, so it must either own the trust/recovery problem or
  shrink to a thin session wrapper.
- Hopter cannot win by cloning background task UX against Codex, Copilot, and
  Claude Code cloud agents. It wins on local machine truth: local repos, local
  secrets, MCP servers, private infra, and cross-device control over the real
  environment.
- One task equals one Codex session is good for v1 but must leave room for
  future branch/worktree/backend portability.
- Notifications are not polish; the promise is returning only when attention is
  needed.
- Durable task metadata is required for a top-level Tasks product.
- Validated diff/review evidence may be a better v1 completion target than
  project-wide commit automation if GitService is not ready.

CEO DUAL VOICES - CONSENSUS TABLE:

```text
  Dimension                            Claude       Codex        Consensus
  -----------------------------------  -----------  -----------  ----------
  1. Premises valid?                   mostly       mixed        DISAGREE
  2. Right problem to solve?           yes, reframed yes, reframed CONFIRMED
  3. Scope calibration correct?        too broad    too broad    CONFIRMED
  4. Alternatives sufficiently explored? missing overlay missing overlay CONFIRMED
  5. Competitive/market risks covered? partial      weak         CONFIRMED GAP
  6. 6-month trajectory sound?         risky        risky        CONFIRMED GAP
```

Dual-voice decisions applied immediately because they preserve the user's stated
direction while making it safer:

- Task creation starts planning only.
- Task detail foregrounds the session.
- Stage completion requires machine-readable `HOPTER_TASK_STAGE_RESULT`.
- Top-level Tasks requires durable metadata.
- `blocked_commit` is not done.

User challenge carried to final gate:

- Both voices recommend treating Tasks as **session-backed work orders / attention
  control plane**, not as a generic Wunderlist clone. The user explicitly wants
  the Wunderlist-like Project -> Task -> Subtask shape. The current plan preserves
  that shape, but constrains every Tasks feature to local-agent execution trust.

### Section 1: Architecture Review

Architecture shape:

```text
Browser
  |
  | Connect: TaskService + existing SessionService
  | SSE: task/session attention events
  v
Go server
  |
  +--> internal/tasks
  |      - TaskService
  |      - Scheduler
  |      - durable task metadata store
  |      - project writer lease
  |
  +--> internal/agents
  |      - existing Codex runtime manager
  |      - one session per task
  |
  +--> internal/events
         - existing global SSE hub
```

Findings:

| Issue | Severity | Decision | Rationale |
|---|---|---|---|
| Task detail originally hid the session behind task metadata. | Critical | Fixed in plan. | Session remains the product truth and must be first-class inside task detail. |
| Stage completion relied on natural language. | Critical | Fixed in plan. | A scheduler needs a machine-readable contract or the product will hang/advance incorrectly. |
| Top-level Tasks needs durable metadata. | High | Fixed in plan. | A task manager cannot lose task/gate/subtask state on restart. |
| Same-project concurrency can corrupt work. | High | Keep one writer lease per project in v1. | This is the boring safe default until branch/worktree isolation exists. |

No new router/framework is introduced. Connect remains the API transport and SSE
remains the notification transport.

### Section 2: Error & Rescue Map

| Codepath | Failure | Rescue | User Impact | Evidence/Test |
|---|---|---|---|---|
| `CreateTask` | missing/invalid `project_id` | reject with typed Connect invalid argument | task is not created; form shows project selection error | unit + UI form test |
| `CreateTask` | project not found | reject with typed Connect not found | task is not created | unit |
| `CreateTask` | Codex unavailable | create task as `blocked` or reject before creation, depending on selected UX | user sees "Codex unavailable" and retry | RPC test |
| scheduler start | task session creation fails | task -> `blocked` with retry | visible blocked task, not silent failure | scheduler test |
| stage completion parse | missing/invalid `HOPTER_TASK_STAGE_RESULT` | task -> `blocked`, no stage advance | user sees malformed completion and can retry/revise | parser unit test |
| plan gate | user approves stale gate | reject stale gate token | no accidental execution of superseded plan | RPC test |
| subtask add | parent task canceled/done | reject or reopen only through explicit action | no hidden session mutation | unit + UI test |
| subtask run | contradicts approved plan | return task to `awaiting_plan_approval` | user reviews scope change | scheduler test |
| commit stage | GitService unavailable | task -> `blocked_commit` or `ready_to_commit`, not `done` | user sees commit dependency gap | validation evidence |
| SSE event | browser disconnected | state remains query-fetchable | user sees current state on reload | browser reconnect test |

Error and rescue status: acceptable after adding the stage completion contract and
durable metadata requirement. Remaining concern is GitService dependency; handled
by `blocked_commit`.

### Section 3: Security & Threat Model

| Threat | Likelihood | Impact | Mitigation |
|---|---:|---:|---|
| Task creation triggers unintended repo mutation | Medium | High | creation starts planning only; code cannot run before plan approval |
| Prompt injection through task/subtask text | Medium | Medium | prompt contract constrains scope, but implementation must treat task text as user input and never as system instruction |
| Cross-project IDOR through `task_id` | Low locally, high later | High | every TaskService method resolves task -> project and checks project scope |
| Subtask scope drift after plan approval | Medium | High | contradiction returns to plan approval |
| Commit captures unrelated worktree state | Medium | High | depend on GitService fresh status token; `blocked_commit` when unsafe |
| Browser notification leaks task title | Medium | Low/Medium | notification copy must be concise and avoid sensitive file diffs/secrets |

No production auth expansion is in scope. The plan remains local/dev-first, matching
current hopter constraints.

### Section 4: Data Flow & Interaction Edge Cases

Task creation flow:

```text
User input
  -> project selection required
  -> CreateTask RPC
  -> durable task metadata write
  -> scheduler creates Codex session
  -> task status = planning
  -> SSE TASK_CHANGED
  -> /tasks/:taskId updates
```

Shadow paths:

| Node | Nil/empty | Invalid | Upstream error | Stale/partial |
|---|---|---|---|---|
| task title/prompt | reject empty prompt | trim and length-limit | n/a | n/a |
| project selection | reject missing | not found if invalid | n/a | project deleted -> not found |
| task store | n/a | schema validation | write failure -> blocked/retry | partial write forbidden |
| Codex session | n/a | backend unavailable | task blocked | no stage advance |
| SSE | n/a | malformed event ignored | reconnect/query refetch | selected task refetches |

Interaction edge cases:

| Interaction | Edge Case | Handling |
|---|---|---|
| Create task | double submit | disable while pending + idempotency token in implementation |
| Create task | user navigates away | task still visible in `/tasks` after creation |
| Add subtask | parent task currently coding | append subtask as pending; scheduler runs after current gate |
| Add subtask | contradicts approved plan | return to plan approval |
| Approve gate | stale gate | reject with stale error |
| Complete task | commit blocked | do not check done |
| Browser notification | permission denied | task attention remains in UI |

### Section 5: Code Quality Review

Expected module ownership:

```text
idl/hopter/v1/tasks.proto           schema source
internal/tasks/*                    task service, store, scheduler
internal/rpc/task_service.go        Connect adapter only
internal/core/models.go             shared domain structs if needed
internal/events/hub.go              event mapping only
ui/src/features/tasks/*             task queries/mutations
ui/src/routes/tasks-route.tsx       task list/detail route owners
ui/src/components/app/*             shell entry/attention integration
```

Quality decisions:

- Keep transport glue thin. `internal/rpc/task_service.go` should not own
  scheduling logic.
- Do not put task scheduler code in `internal/agents/codex/manager.go`; that
  manager remains the Codex session runtime.
- Do not duplicate session transcript rendering. Task UI links into or embeds
  existing session components.
- Keep `Task` naming product-facing. Keep `scheduler` naming implementation-facing.

### Section 6: Test Review

Coverage diagram:

```text
NEW UX FLOWS
  [+] Open Tasks
      -> /tasks list renders grouped/filterable task list
      -> empty state offers Create Task

  [+] Create Task
      -> choose project
      -> enter prompt
      -> task created
      -> linked session enters planning
      -> TASK_CHANGED SSE arrives

  [+] Plan Gate
      -> stage result parsed
      -> task enters awaiting_plan_approval
      -> user approves / requests revision / cancels

  [+] Add Subtask
      -> create subtask under task
      -> scheduler sends follow-up to same session
      -> subtask becomes running/done/blocked

  [+] Development Gate
      -> code stage result parsed
      -> changed files/evidence shown
      -> user approves review/commit or requests revision

NEW DATA FLOWS
  CreateTaskRequest -> TaskService -> Store -> Scheduler -> SessionService/Codex
  CreateSubtaskRequest -> Store -> Scheduler -> SendSessionInput
  WorkspaceEvent -> SSE -> Query invalidation/patch
  Stage result text -> parser -> StageCompletionSignal -> task state transition

NEW CODEPATHS
  TaskService create/list/get/pause/resume/cancel
  TaskService create/update subtask
  scheduler lease acquire/release
  stage completion parser
  task event mapping
  browser task hooks and routes

NEW BACKGROUND JOBS / ASYNC WORK
  scheduler loop
  task session start
  subtask follow-up dispatch
```

Mandatory tests:

| Path | Test Type | Requirement |
|---|---|---|
| stage completion parser | unit | valid, missing marker, malformed marker, blocked status |
| task state machine | unit | every allowed transition and rejected transition |
| project writer lease | unit | same-project serialization, release on block/failure |
| CreateTask RPC | RPC integration | creates metadata and schedules planning |
| CreateSubtask RPC | RPC integration | same task session id is used |
| task SSE mapping | unit/integration | `TASKS_CHANGED`, `TASK_CHANGED`, attention events |
| `/tasks` empty/list/detail | UI unit/browser | empty, loading, error, active, blocked, done |
| plan gate browser flow | browser validation | create -> plan gate -> approve |
| blocked commit | browser validation | shows blocked, not checked done |

Test plan artifact must include the `/tasks` route, `/tasks/:taskId`, task create,
subtask add, plan gate, development gate, and blocked commit behavior.

### Section 7: Performance Review

Performance risks:

- Task list can grow. Add `project_id`, `status`, `updated_at`, and pagination/limit
  in the service shape before implementation hardcodes "load all."
- SSE task events should invalidate task list/detail, not refetch session transcript
  on every draft delta.
- Scheduler loop should be event-driven or sleep-backed with bounded polling.
- Stage completion parsing is cheap and should happen once per completed turn, not
  per streamed delta.

No high p99 risk if task list is paginated and transcript remains session-owned.

### Section 8: Observability & Debuggability Review

Required logs/events:

- task created
- task scheduled
- project lease acquired/released
- session linked
- stage started
- stage completion marker parsed
- task blocked with reason
- gate created/resolved
- subtask sent/done/blocked
- commit blocked/succeeded

Required validation evidence:

- `task-events.jsonl`
- `task-state-transitions.json`
- `subtask-followup.json`
- `plan-gate.json`
- `development-gate.json`
- `commit-blocked.json` or `commit-result.json`

Debug rule: a bug report saying "my task got stuck" must be answerable from task
metadata plus session id plus evidence path, without reading raw transcript history
from the task store.

### Section 9: Deployment & Rollout Review

Rollout sequence:

```text
1. Add tasks.proto + generated clients
2. Add durable metadata store + migration/storage format
3. Add backend TaskService behind route registration
4. Add scheduler disabled-by-default in config/test
5. Add /tasks UI read-only list/detail
6. Enable create-task -> planning gate only
7. Add subtask follow-up
8. Add development gate
9. Add review/commit integration
```

Rollback:

- disable scheduler
- keep TaskService read-only so existing task metadata remains inspectable
- leave linked sessions accessible through existing session routes

Feature flag recommendation:

- gate scheduler execution behind a config flag during early validation
- allow task capture/list/detail even if scheduler is disabled

### Section 10: Long-Term Trajectory Review

Reversibility: 3/5.

This is a meaningful IA expansion. It is reversible if Tasks remains a thin
session-backed layer and does not absorb session truth. It becomes hard to reverse
if task storage turns into transcript/artifact storage.

Future compatibility constraints:

- data model must leave room for multiple attempts/branches/worktrees later
- do not bake Codex-only protocol fields into public task IDL
- keep `session_id` as a backend session reference, not the task identity itself
- keep one writer per project for v1, but document that worktree isolation is the
  future path to same-project parallelism

### Section 11: Design & UX Review

UI scope exists.

Information hierarchy for task detail:

```text
Task Detail
  1. status + gate decision
  2. active session summary / composer / transcript entry
  3. subtask checklist
  4. evidence and changed files
  5. stage timeline
```

Interaction state coverage:

| Surface | Loading | Empty | Error | Success | Partial |
|---|---|---|---|---|---|
| `/tasks` | skeleton list | create-task CTA with project picker | retry + diagnostics | task list | some tasks unavailable |
| task detail | shell + metadata skeleton | n/a | task blocked/error banner | active task | linked session missing/degraded |
| plan gate | gate loading | no gate | stale gate/retry | approved/revision sent | session still reconciling |
| subtask list | inline spinner | "No subtasks yet" + add | failed subtask state | checked subtasks | mixed done/running |
| notifications | n/a | permission prompt optional | permission denied ignored | browser notification | UI attention remains source of truth |

Design risk: adding `Tasks` can turn hopter into a generic list app. The UI must
make the agent-work state obvious: current session, current gate, evidence, and
what exact user decision is needed.

### NOT in Scope

- Native/mobile push notifications in first slice.
- Same-project parallel work through branch/worktree isolation.
- Task templates and reusable workflows.
- PR creation or deployment.
- Generic todo-list collaboration features.
- Transcript or artifact persistence inside task storage.

### What Already Exists

- Session runtime, transcript, approvals, review diff, and file inspection already
  exist through SessionService and Codex manager surfaces.
- Global SSE already exists and should be extended, not replaced.
- Workspace shell and session detail components already own the interaction
  hierarchy Tasks should reuse.
- Commit is being planned separately as project GitService and should stay separate.

### Dream State Delta

This plan moves hopter toward a 12-month agent workbench only if Tasks stays thin:
task/subtask organization, gates, evidence, and session references. It moves away
from the ideal if it becomes a generic task manager or a second transcript store.

### Error & Rescue Registry

See Section 2. Critical gaps after review: none if the machine-readable stage
completion contract, durable metadata, stale gate rejection, and blocked commit
state are implemented.

### Failure Modes Registry

| Codepath | Failure Mode | Rescued? | Test? | User Sees? | Logged? |
|---|---|---|---|---|---|
| CreateTask | project missing | yes | yes | form/RPC error | yes |
| CreateTask | Codex unavailable | yes | yes | blocked/retry | yes |
| Scheduler | lease unavailable | yes | yes | queued/waiting | yes |
| Scheduler | process restart mid-stage | yes | yes | blocked/retry | yes |
| Stage parser | marker missing | yes | yes | blocked/retry | yes |
| Gate approval | stale gate | yes | yes | stale gate error | yes |
| Subtask | contradicts plan | yes | yes | returns to plan gate | yes |
| Commit | GitService unavailable | yes | yes | blocked_commit | yes |
| SSE | disconnect | yes | yes | reconnect/refetch | yes |

### Stale Diagram Audit

No existing code diagrams are modified by this planning change. Implementation must
add or update diagrams near task state-machine tests and scheduler logic if the
code becomes non-obvious.

### CEO Completion Summary

```text
+====================================================================+
|            CEO PLAN REVIEW - COMPLETION SUMMARY                    |
+====================================================================+
| Mode selected        | SELECTIVE EXPANSION                          |
| System Audit         | Go + Connect + SSE + Codex app-server         |
| Step 0               | Tasks accepted as product surface, session     |
|                      | remains execution truth                        |
| Section 1  (Arch)    | 4 issues found, all plan-fixed or scoped       |
| Section 2  (Errors)  | 10 error paths mapped, 0 unresolved critical   |
| Section 3  (Security)| 6 threats mapped, 0 unresolved high gaps       |
| Section 4  (Data/UX) | edge cases mapped, stale gate + block handled  |
| Section 5  (Quality) | module boundaries defined                      |
| Section 6  (Tests)   | test diagram produced, parser/gate/browser req |
| Section 7  (Perf)    | pagination + SSE invalidation requirements     |
| Section 8  (Observ)  | task logs/evidence required                    |
| Section 9  (Deploy)  | rollout + rollback path defined                |
| Section 10 (Future)  | Reversibility: 3/5                             |
| Section 11 (Design)  | UI scope confirmed, hierarchy corrected        |
+--------------------------------------------------------------------+
| NOT in scope         | written                                      |
| What already exists  | written                                      |
| Dream state delta    | written                                      |
| Error/rescue registry| written                                      |
| Failure modes        | written                                      |
| Dual voices          | codex+subagent, 2 confirmed strategic gaps    |
| User challenges      | generic Wunderlist vs session-backed work     |
| Lake Score           | 5/5 complete options chosen where in radius   |
+====================================================================+
```

**PHASE 1 COMPLETE.** Codex: 12 concerns. Claude subagent: 6 issues. Consensus:
4/6 confirmed, 1 disagreement, 1 premise mixed. Passing to Phase 2.

## Phase 2 Design Review

### Design Scope Assessment

Initial design completeness: 5/10.

The plan had the right product framing, but `/tasks`, gate cards, degraded states,
responsive behavior, and accessibility were too underspecified for implementation.
After this phase, design completeness is 8/10. Remaining visual polish should happen
during implementation with browser screenshots.

Existing design leverage:

- workspace shell hierarchy from `docs/product/UI_REBUILD_DESIGN_DOC.md`
- `ui/AGENTS.md` posture model: `phone`, `compact`, `wide`
- existing session detail and session rail patterns
- existing HeroUI/Tailwind workspace token rules

### Design Dual Voices

#### CLAUDE SUBAGENT (design - independent review)

Findings:

- Critical: `/tasks` list hierarchy was under-specified and needed
  attention-first ordering.
- High: gate UI needed concrete decision cards with summary, evidence, next step,
  approve/revision/cancel actions.
- High: missing state matrix would lead to inconsistent loading/error/stale/blocked
  behavior.
- High: creation flow copy must say `Create and start planning` and explicitly
  reassure that no code changes happen before plan approval.
- Medium: task detail must embed a compact session workbench, not a giant transcript.
- Medium: subtask scope-change handling needs a visible "Plan revision required" gate.
- Medium: notification-denied fallback needs persistent in-app attention.

#### CODEX SAYS (design - UX challenge)

Codex design voice was attempted but the CLI output was dominated by transport and
analytics noise. No usable final critique was captured, so this phase is tagged
`subagent-only` for design voices.

DESIGN DUAL VOICES - LITMUS SCORECARD:

```text
  Check                                      Claude       Codex        Consensus
  -----------------------------------------  -----------  -----------  ----------
  1. Attention-first hierarchy?              no, fixed    N/A          N/A
  2. Session remains workbench?              partial, fixed N/A        N/A
  3. Gate states concrete?                   no, fixed    N/A          N/A
  4. Interaction states complete?            no, fixed    N/A          N/A
  5. Responsive rules specified?             no, fixed    N/A          N/A
  6. Accessibility specified?                no, fixed    N/A          N/A
  7. Generic task-app risk controlled?        partial, fixed N/A       N/A
```

### Pass 1: Information Architecture

Score: 5/10 -> 8/10.

Fixes added:

- `/tasks` is attention-first, not project-first.
- Project filtering is secondary.
- Task rows show title, project, stage, required action, session freshness, subtask
  count, and checkbox state.
- Task detail foregrounds gate/action and active session workbench.

### Pass 2: Interaction State Coverage

Score: 4/10 -> 8/10.

Fixes added:

- Full UI state matrix for loading, empty, offline/SSE disconnected, Codex
  unavailable, queued, planning, gates, stale gate, malformed marker,
  notification denied, linked session missing, ready_to_commit, blocked_commit,
  and done.

### Pass 3: User Journey & Emotional Arc

Score: 6/10 -> 8/10.

Journey:

```text
STEP | USER DOES                         | USER FEELS              | PLAN SUPPORT
-----|-----------------------------------|-------------------------|-------------------------------
1    | opens Tasks                       | wants to know what needs action | attention-first ordering
2    | creates task                      | cautious about repo changes | "No code changes until approval"
3    | reviews plan gate                 | needs confidence         | gate card with risks/evidence/next
4    | approves coding                   | wants progress visibility | embedded session workbench
5    | adds subtask                      | wants continuity         | same-session follow-up
6    | approves development              | wants proof              | changed files + validation evidence
7    | reaches commit/ready state         | wants truthful completion | blocked_commit is not done
```

### Pass 4: AI Slop Risk

Score: 7/10 -> 8/10.

Risk is controlled by forbidding card-heavy dashboard treatment and requiring
operational, dense, attention-first layouts. Remaining risk: visual implementation
must avoid generic task-app cards and keep session/gate/evidence visible.

### Pass 5: Design System Alignment

Score: 7/10 -> 8/10.

Implementation must reuse workspace tokens and existing shell posture rules:

- no arbitrary color/spacing values where tokens exist
- no nested cards
- no dashboard-card mosaic
- use existing `phone`, `compact`, `wide` posture model

### Pass 6: Responsive & Accessibility

Score: 3/10 -> 8/10.

Fixes added:

- phone, compact, wide behavior
- sticky phone gate action panel
- collapsed transcript preview on phone
- ARIA live region for task attention
- focus behavior on gate arrival
- keyboard reachable gate actions
- text-labelled status badges
- 44px phone touch targets

### Pass 7: Unresolved Design Decisions

| Decision | Status |
|---|---|
| Is `/tasks` attention-first or project-first? | Resolved: attention-first. |
| Is task detail session area a link or embedded workbench? | Resolved: compact embedded workbench with full-session affordance. |
| Are task/subtask checkboxes interactive? | Partially resolved: task checkbox is status display; subtask status should be controlled by scheduler unless user cancels/reopens. Implementation should not let users fake completion of agent work. |
| How does mobile approval work? | Resolved: phone detail with sticky gate panel, transcript preview collapsed. |
| What if notifications are denied? | Resolved: in-app attention remains source of truth. |

### Design Completion Summary

```text
+====================================================================+
|         DESIGN PLAN REVIEW - COMPLETION SUMMARY                    |
+====================================================================+
| System Audit         | UI scope yes; workspace shell rules apply     |
| Step 0               | 5/10 initial, missing concrete task UI states |
| Pass 1  (Info Arch)  | 5/10 -> 8/10                                 |
| Pass 2  (States)     | 4/10 -> 8/10                                 |
| Pass 3  (Journey)    | 6/10 -> 8/10                                 |
| Pass 4  (AI Slop)    | 7/10 -> 8/10                                 |
| Pass 5  (Design Sys) | 7/10 -> 8/10                                 |
| Pass 6  (Responsive) | 3/10 -> 8/10                                 |
| Pass 7  (Decisions)  | 5 resolved, 0 blocking                       |
+--------------------------------------------------------------------+
| NOT in scope         | native/push notifications, generic todo app   |
| What already exists  | workspace shell, session rail/detail patterns |
| Approved Mockups     | skipped, no design binary flow run            |
| Overall design score | 5/10 -> 8/10                                  |
+====================================================================+
```

**PHASE 2 COMPLETE.** Codex: unavailable/no usable output. Claude subagent: 7
issues. Consensus: N/A due single captured design voice. Passing to Phase 3.

## Phase 3 Engineering Review

### Scope Challenge

The engineering risk is not the React task list. The hard problem is a reliable
execution contract between task stages and Codex turns.

The first implementation slice must prove:

```text
CreateTask
  -> durable task row
  -> one linked Codex session
  -> task-aware stage run owns exact turn id
  -> final turn emits fenced HOPTER_TASK_STAGE_RESULT
  -> scheduler verifies marker
  -> task enters awaiting_plan_approval
```

Building the full `Tasks` UI before that loop is true would create a product that
looks reliable before it is reliable.

### Eng Dual Voices

#### CLAUDE SUBAGENT (eng - independent review)

Findings:

- Critical: current Codex session creation returns before backend thread/turn ids
  are reliably available to task stages.
- Critical: stage marker parsing is prompt-injection prone without nonce,
  stage-run id, expected turn id, and evidence canonicalization.
- High: restart retry can duplicate repo writes if a turn completed before task
  metadata persisted.
- High: project writer lease must be shared with GitService and manual session
  mutations.
- High: durable tasks can outlive current in-memory project/session refs.
- High: subtasks need sequence and stale-gate protection.
- Medium: gate APIs need anti-replay fields.
- Medium: SSE is not attention truth; durable task fetch is.
- Medium: commit attribution needs baseline status/diff fingerprint.
- Medium: tests need failure injection, not happy path only.

#### CODEX SAYS (eng - architecture challenge)

Findings:

- Critical: store scope contradicted itself; durable v1 store is required, not
  in-memory implementation.
- Critical: stage marker correlation needed `task_stage_run_id`, optional
  `subtask_id`, nonce, gate version, and expected terminal `session_turn_id`.
- Critical: gate APIs need optimistic concurrency.
- High: `TaskStage` needed `SUBTASK`.
- High: scheduler/session input serialization was underdefined.
- High: writer lease needed lifecycle details.
- High: pause/cancel needed live Codex run semantics.
- High: commit attribution requires a baseline.
- Medium: restart retry must reconcile by stored turn before retrying.
- Medium: UI state had waiting-by-lease but TaskStatus lacked waiting/scheduling
  state.

ENG DUAL VOICES - CONSENSUS TABLE:

```text
  Dimension                            Claude       Codex        Consensus
  -----------------------------------  -----------  -----------  ----------
  1. Architecture sound?               no           no           CONFIRMED GAP
  2. Test coverage sufficient?         no           no           CONFIRMED GAP
  3. Performance risks addressed?      partial      partial      CONFIRMED PARTIAL
  4. Security threats covered?         no           no           CONFIRMED GAP
  5. Error paths handled?              partial      partial      CONFIRMED PARTIAL
  6. Deployment risk manageable?       partial      partial      CONFIRMED PARTIAL
```

### Section 1: Architecture

Updated dependency graph:

```text
Task UI
  |
  v
TaskService (Connect adapter)
  |
  v
internal/tasks.Service
  |
  +--> durable metadata store
  |      - tasks
  |      - subtasks
  |      - stage_runs
  |      - gates
  |      - leases
  |
  +--> Scheduler
  |      - runnable selection
  |      - can-send-input predicate
  |      - stage marker parser
  |      - restart reconciliation
  |
  +--> ProjectWorkCoordinator
  |      - shared writer lease
  |      - fencing token
  |      - TTL/heartbeat
  |
  +--> agents.Manager / Codex runtime
         - task-aware turn observer
         - thread id / turn id correlation
```

Architecture fixes applied:

- task-aware Codex turn ownership requirement
- shared project work coordinator
- strict fenced marker contract
- durable task metadata store
- restart reconciliation before retry
- write-stage git baseline

### Section 2: Code Quality

Module boundaries:

- `internal/tasks` owns task state machine, scheduler, parser, store, and leases.
- `internal/rpc/task_service.go` only maps Connect requests and responses.
- `internal/agents/codex` exposes task-aware turn observation but does not know
  about task UI.
- `internal/gitops` consults shared project work coordinator before commit.
- UI features live under `ui/src/features/tasks` and route owners under
  `ui/src/routes/tasks-route.tsx`.

Anti-patterns to avoid:

- task state transitions hidden in RPC handlers
- scheduler reaching directly into generated proto types
- task store persisting transcript or artifact bodies
- UI marking subtasks complete independently of scheduler state
- separate writer-lock implementations in tasks and git

### Section 3: Test Review

Coverage diagram:

```text
CODE PATH COVERAGE REQUIREMENTS
================================
[+] TaskService.CreateTask
    ├── happy path with project
    ├── missing project
    ├── Codex unavailable
    └── idempotent double submit

[+] Scheduler stage run
    ├── acquire writer lease for write stages
    ├── create/observe Codex turn id
    ├── parse valid marker
    ├── reject wrong task/stage/run/turn/nonce marker
    ├── reject duplicate marker
    └── block on missing marker

[+] Restart reconciliation
    ├── completed turn with valid marker -> advance
    ├── completed turn without marker -> block
    ├── running turn -> block/wait
    └── retry creates new stage run + nonce

[+] Gates
    ├── approve current gate
    ├── reject stale gate revision
    ├── request revision idempotently
    └── cancel while active run exists

[+] Subtasks
    ├── add while idle
    ├── add while active turn exists -> queued/waiting
    ├── scope-preserving subtask -> code/dev gate
    └── scope-changing subtask -> plan revision gate

[+] Commit attribution
    ├── clean baseline -> ready
    ├── dirty unexpected files -> blocked_commit
    └── GitService unavailable -> ready_to_commit/block
```

Critical test gaps added to the plan:

- marker injection from user prompt
- malformed marker
- wrong nonce
- wrong stage run id
- stale gate submit
- restart during every stage
- concurrent same-project tasks
- unresolved app-server approval during planning/coding
- dirty worktree interference
- SSE disconnect and reconnect refetch
- commit blocked not done

Test plan artifact: local gstack engineering review artifact.

### Section 4: Performance

No high p99 risk if:

- task list is paginated or limited
- task events invalidate task list/detail only
- transcript remains session-owned
- scheduler uses bounded polling or event-driven wakeups
- lease heartbeat interval is conservative and not per-stream-delta

### Mandatory Engineering Outputs

**NOT in scope:**

- distributed workflow engine
- Redis/Temporal
- same-project parallel writes
- transcript persistence in task store
- native/push notification infrastructure

**What already exists:**

- Codex runtime and session readback
- SessionService create/input/review/file/transcript APIs
- SSE hub
- validation artifact convention
- commit plan/GitService direction

**Failure modes with critical gap assessment:**

| Codepath | Failure Mode | Rescued? | Test? | User Sees? | Logged? |
|---|---|---|---|---|---|
| stage marker | forged marker from prompt | yes | required | blocked | yes |
| stage marker | wrong nonce/run/turn | yes | required | blocked | yes |
| restart | duplicate write risk | yes | required | reconcile/block | yes |
| gate API | stale approval | yes | required | stale gate | yes |
| lease | task + GitService both write | yes | required | waiting/block | yes |
| subtask | active turn already running | yes | required | waiting | yes |
| commit | unexpected dirty files | yes | required | blocked_commit | yes |
| SSE | event dropped | yes | required | refetch on reconnect | yes |

### Eng Completion Summary

```text
+====================================================================+
|              ENG PLAN REVIEW - COMPLETION SUMMARY                  |
+====================================================================+
| Scope Challenge      | Full UI must wait for reliable plan-gate loop |
| Architecture         | 6 blockers found, plan fixed                  |
| Code Quality         | module boundaries clarified                   |
| Test Review          | failure-injection matrix added                |
| Performance          | no high p99 risk if pagination/events bounded |
+--------------------------------------------------------------------+
| Architecture diagram | written                                      |
| Test diagram         | written                                      |
| Test plan artifact   | written                                      |
| Failure modes        | 8 rows, 0 accepted silent failures            |
| Dual voices          | codex+subagent                                |
+====================================================================+
```

**PHASE 3 COMPLETE.** Codex: 10 concerns. Claude subagent: 10 issues. Consensus:
6/6 confirmed or partial. Passing to Phase 3.5.

## Phase 3.5 DX Review

### DX Scope Assessment

Product type: developer/agent control-plane feature.

Primary developer persona:

```text
Who:       contributor implementing hopter's Tasks feature
Context:   already understands Go/Connect/React basics, but needs exact task
           state contracts to avoid inventing behavior
Tolerance: low for ambiguous state machines; medium for multi-slice implementation
Expects:   generated proto, clear store interfaces, deterministic fake runtime,
           and validation commands per slice
```

Initial DX score: 6.5/10.
Target DX score after plan fixes: 8/10.

TTHW for contributor slice 1:

- current before fixes: unclear, likely > 1 day due contract ambiguity
- target after fixes: under 30 minutes to understand Slice 1 and run validation

### DX Dual Voices

#### CLAUDE SUBAGENT (DX - independent review)

Findings:

- High: Slice 1 was not independently buildable without exact proto/store/message
  contracts.
- High: task states mixed lifecycle, stage, queueing, gate, and commit concepts.
- High: backend errors needed structured problem/cause/fix diagnostics.
- Medium: mutation responses were underspecified.
- Medium: validation was too end-to-end and too late.
- Medium: pause/resume/cancel/retry needed explicit behavior.
- Medium: scheduler-disabled mode was missing.

#### CODEX SAYS (DX - developer experience challenge)

Findings:

- High: task state naming was overloaded.
- High: transition rules were underspecified.
- High: diagnostics were too stringly typed.
- High: scheduler-disabled test mode was missing.
- Medium: slice validation was back-loaded.
- Medium: mutation contracts needed idempotency and current-state responses.
- Medium: contributor docs were not called out.
- Medium: stage marker debugging needed fixtures.

DX DUAL VOICES - CONSENSUS TABLE:

```text
  Dimension                            Claude       Codex        Consensus
  -----------------------------------  -----------  -----------  ----------
  1. Getting started < 5 min?          no           no           CONFIRMED GAP
  2. API naming guessable?             partial      partial      CONFIRMED PARTIAL
  3. Error messages actionable?        no           no           CONFIRMED GAP
  4. Docs findable & complete?         no           no           CONFIRMED GAP
  5. Upgrade path safe?                N/A          N/A          N/A
  6. Dev env friction-free?            no           no           CONFIRMED GAP
```

### Developer Journey Map

| Stage | Developer Does | Friction | Fix |
|---|---|---|---|
| Discover | opens plan | too much prose before exact contracts | Slice 1 Contract section |
| Implement IDL | adds `tasks.proto` | state names overloaded | split lifecycle/stage/gate/attention/commit |
| Implement store | creates metadata persistence | store methods unspecified | Store interface shape |
| Implement parser | handles markers | fixtures missing | marker parser fixtures |
| Implement scheduler | wants deterministic test mode | Codex auto-launch risk | scheduler disabled/manual/auto |
| Implement UI | maps states to badges | canonical badge mapping missing | UI badge mapping |
| Debug failure | task blocked | string reason not enough | `TaskDiagnostic` |
| Validate | runs tests | only end-to-end harness listed | per-slice validation commands |

### Developer Empathy Narrative

I open the plan to implement Slice 1. The product direction is clear, but before
the DX pass I would have had to infer which state field drives the UI, what store
methods exist, how stale gates are rejected, and whether I can test CreateTask
without launching Codex. That means the first implementer would probably create
local conventions by accident. After the DX fixes, I can start with `tasks.proto`,
copy the Store interface, run `make validate-tasks-idl`, implement persistence,
then run `make validate-tasks-store` and `make validate-tasks-marker-parser`
without touching the live Codex runtime. That is the difference between a plan and
a usable engineering handoff.

### DX Scorecard

```text
+====================================================================+
|              DX PLAN REVIEW - SCORECARD                            |
+====================================================================+
| Dimension            | Score  | Prior  | Trend                    |
|----------------------|--------|--------|--------------------------|
| Getting Started      | 8/10   | 6/10   | up, Slice 1 contract     |
| API/State Design     | 8/10   | 6/10   | up, split state enums    |
| Error Messages       | 8/10   | 5/10   | up, TaskDiagnostic       |
| Documentation        | 7/10   | 5/10   | up, docs required        |
| Upgrade Path         | N/A    | N/A    | not relevant yet         |
| Dev Environment      | 8/10   | 5/10   | up, scheduler modes      |
| Community            | N/A    | N/A    | internal contributor flow |
| DX Measurement       | 8/10   | 6/10   | up, per-slice validation |
+--------------------------------------------------------------------+
| TTHW                 | <30 min for Slice 1 orientation              |
| Product Type         | agent control-plane feature                  |
| Overall DX           | 8/10                                        |
+====================================================================+
```

### DX Implementation Checklist

- [ ] `tasks.proto` defines split state enums and diagnostics.
- [ ] every mutation returns task, current gate, accepted, diagnostics.
- [ ] repeatable mutations accept idempotency keys.
- [ ] task creation defaults to execution without an environment-variable mode switch.
- [ ] fake Codex runtime fixtures cover marker parsing.
- [ ] `make validate-tasks-idl` exists.
- [ ] `make validate-tasks-store` exists.
- [ ] `make validate-tasks-marker-parser` exists.
- [ ] `make validate-tasks-gates` exists.
- [ ] `make validate-tasks-scheduler-fake` exists.
- [ ] `make validate-tasks-ui` exists.
- [ ] `docs/development/TASKS.md` explains architecture, scheduler modes,
  diagnostics, validation evidence, and failure codes.

**PHASE 3.5 COMPLETE.** DX overall: 8/10. TTHW: under 30 minutes for Slice 1
orientation. Codex: 8 concerns. Claude subagent: 7 issues. Consensus: 5/6
confirmed/partial. Passing to Phase 4.
