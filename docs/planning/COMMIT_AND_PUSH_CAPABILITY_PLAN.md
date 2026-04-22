# Commit And Push Capability Plan

## Status

Proposed. Revised after user correction: commit actions are project/repository
scoped and commit **all uncommitted files**, not files inferred from a session,
latest Codex turn, or local session content.

## User Request

Implement the ability to commit, and to commit then push, from hopter.

Clarification:

- do not base the commit set on session-local content
- do not default to latest-turn changed files
- commit all uncommitted files in the project repository

## Product Premise

This is a control-plane action, not a new agent workflow.

The browser should not send raw git commands. Codex should not be asked to run
`git commit` through chat. The Go server should own a narrow git action API with
strict arguments, fresh preflight checks, and evidence that tells the user what
happened.

The action is project-level:

- session routes can open it because they know the current project
- the backend API should receive `project_id`
- git state comes from the repository, not from Codex session history

## Current State

### What Already Exists

- `WorkspaceTopbar` already renders a `Commit` dropdown on session routes.
- `SessionWorkspacePane` passes commit/review actions into the topbar,
  into the topbar, but `onCommit` is currently a TODO.
- `Project` already has a canonical `root_path` and project creation rejects
  non-git directories.
- The Go server already owns all browser-facing Connect APIs and SSE events.
- TanStack Query invalidation already refreshes session/project state after
  Connect mutations and SSE events.
- `GetSessionReview` already exposes the latest completed Codex turn's diff,
  but this is only for review UI. It must not choose the commit set.

### Missing Pieces

- No IDL surface for project git state or git actions.
- No backend git executor.
- No confirmation modal that shows all dirty files, commit message, branch, and
  push target.
- No stale-state guard between preview and action execution.
- No validation harness for commit-only or commit-and-push behavior.

## Scope

### In Scope

- Project-scoped git status preview.
- Commit all uncommitted files in the selected project repository.
- Commit then push to an explicit resolved remote/ref.
- Disable push when the branch has no upstream.
- Retry push after a commit succeeds but the push fails.
- Confirmation UI with editable commit message.
- Stale git status rejection.
- Conflict, active-writer, and branch-state guards.
- Clear partial success state when commit succeeds but push fails.
- Unit, RPC, browser, and live git validation evidence.

### Not In Scope

- Arbitrary shell commands.
- Choosing a subset of files.
- Session-derived file selection.
- Creating or setting upstream branches.
- Full branch management UI.
- PR creation.
- Force push.
- Rebase, merge conflict resolution, cherry-pick, amend, stash, reset.
- Credential management for remotes.
- Multi-user coordination semantics.
- A persistent mirror of git history in hopter storage.

## UX Plan

### Entry Point

Show the commit dropdown only when the selected project resolves to a git
repository with a `.git` directory or file. If the project has no `.git`, do not
render the commit button at all.

Replace the selected-session topbar dropdown with:

1. `Review`
2. `Commit All`
3. `Commit All & Push`

`Review` stays a read-only inspector action. `Commit All` and `Commit All & Push`
open the same project git confirmation modal with different default mode.

### Confirmation Modal

The modal loads a fresh git preview for the project:

- repository root
- branch name
- current commit short SHA, or unborn branch state
- upstream / push target
- ahead / behind counts when available
- all dirty files
- staged vs unstaged status for each file
- warnings for partial staging, untracked files, deletions, and renames
- default commit message

Primary actions:

- `Commit All`
- `Commit All & Push`
- `Cancel`

The modal should disable commit actions when:

- no dirty files exist
- merge conflicts are present
- commit message is blank
- preview is stale and must be refreshed
- an active writer is changing the same project

The modal should disable push when:

- target is detached HEAD
- remote is unknown
- branch has no upstream
- branch is behind/diverged from upstream

### Explicit User Copy

The modal copy should be direct:

```text
This will stage and commit every uncommitted change in this repository.
```

If partial staging exists:

```text
Some files are partially staged. Hopter will commit the full current worktree
version because this action commits all uncommitted changes.
```

That is the whole game. No hidden file selection.

## IDL Plan

Add a new `idl/hopter/v1/git.proto` and generated Go/TS clients.

Recommended service:

```proto
service GitService {
  rpc GetProjectGitStatus(GetProjectGitStatusRequest) returns (GetProjectGitStatusResponse);
  rpc CommitProjectChanges(CommitProjectChangesRequest) returns (CommitProjectChangesResponse);
  rpc PushProjectBranch(PushProjectBranchRequest) returns (PushProjectBranchResponse);
}
```

Recommended messages:

```proto
enum GitFileStatus {
  GIT_FILE_STATUS_UNSPECIFIED = 0;
  GIT_FILE_STATUS_ADDED = 1;
  GIT_FILE_STATUS_MODIFIED = 2;
  GIT_FILE_STATUS_DELETED = 3;
  GIT_FILE_STATUS_RENAMED = 4;
  GIT_FILE_STATUS_UNTRACKED = 5;
  GIT_FILE_STATUS_CONFLICTED = 6;
}

enum GitActionOutcome {
  GIT_ACTION_OUTCOME_UNSPECIFIED = 0;
  GIT_ACTION_OUTCOME_COMMITTED = 1;
  GIT_ACTION_OUTCOME_COMMITTED_AND_PUSHED = 2;
  GIT_ACTION_OUTCOME_COMMITTED_PUSH_FAILED = 3;
  GIT_ACTION_OUTCOME_PUSHED = 4;
  GIT_ACTION_OUTCOME_NO_CHANGES = 5;
  GIT_ACTION_OUTCOME_REJECTED_STALE = 6;
  GIT_ACTION_OUTCOME_REJECTED_BLOCKED = 7;
  GIT_ACTION_OUTCOME_FAILED = 8;
}

enum GitCommitMode {
  GIT_COMMIT_MODE_UNSPECIFIED = 0;
  GIT_COMMIT_MODE_COMMIT_ONLY = 1;
  GIT_COMMIT_MODE_COMMIT_AND_PUSH = 2;
}

message GitDiagnostic {
  string code = 1;
  string step = 2;
  string message = 3;
  string stderr_excerpt = 4;
  int32 exit_code = 5;
}

message GitFileChange {
  string path = 1;
  GitFileStatus status = 2;
  string index_status = 3;
  string worktree_status = 4;
  string old_path = 5;
  bool partially_staged = 6;
  uint32 additions = 7;
  uint32 deletions = 8;
}

message ProjectGitStatus {
  string project_id = 1;
  string root_path = 2;
  string branch = 3;
  string head_sha = 4;
  string head_short_sha = 5;
  string upstream = 6;
  string push_remote = 7;
  string push_branch = 8;
  int32 ahead = 9;
  int32 behind = 10;
  bool dirty = 11;
  bool has_conflicts = 12;
  bool project_has_active_writer = 13;
  bool can_commit = 14;
  bool can_push = 15;
  bool detached_head = 16;
  bool unborn_branch = 17;
  string status_token = 18;
  string default_commit_message = 19;
  repeated GitFileChange files = 20;
  repeated GitDiagnostic blockers = 21;
  repeated GitDiagnostic warnings = 22;
}

message GetProjectGitStatusRequest {
  string project_id = 1;
}

message GetProjectGitStatusResponse {
  ProjectGitStatus status = 1;
}

message CommitProjectChangesRequest {
  string project_id = 1;
  GitCommitMode mode = 2;
  string message = 3;
  string expected_status_token = 4;
}

message CommitProjectChangesResponse {
  GitActionOutcome outcome = 1;
  string commit_sha = 2;
  string commit_short_sha = 3;
  string branch = 4;
  string upstream = 5;
  string summary = 6;
  repeated string committed_paths = 7;
  repeated GitDiagnostic diagnostics = 8;
  ProjectGitStatus status_after = 9;
}

message PushProjectBranchRequest {
  string project_id = 1;
  string expected_head_sha = 2;
  string expected_status_token = 3;
}

message PushProjectBranchResponse {
  GitActionOutcome outcome = 1;
  string branch = 2;
  string upstream = 3;
  repeated GitDiagnostic diagnostics = 4;
  ProjectGitStatus status_after = 5;
}
```

Add a git event to `events.proto`:

- `WORKSPACE_EVENT_TYPE_GIT_CHANGED`
- `REFRESH_HINT_REFETCH_GIT`

Keep SSE refresh-oriented. Do not stream git state as a second source of truth.

## Backend Plan

### Package Layout

Create:

- `internal/gitops/service.go`
- `internal/gitops/executor.go`
- `internal/gitops/status.go`
- `internal/gitops/lock.go`
- `internal/gitops/service_test.go`
- `internal/rpc/git_service.go`
- `internal/rpc/git_service_test.go`

Wire `GitService` in:

- `internal/app/bootstrap.go`
- `internal/http/router.go`
- `ui/src/lib/connect/clients.ts`

### Git Executor Rules

Use the native `git` binary through `exec.CommandContext`, never shell strings.

Every command runs as:

```text
git -C <canonical-project-root> <fixed-arg-list>
```

Every command must run with:

- no stdin
- `GIT_TERMINAL_PROMPT=0`
- `GIT_ASKPASS=`
- `SSH_ASKPASS=`
- `GIT_LITERAL_PATHSPECS=1`
- bounded stdout/stderr capture
- per-command deadlines

Allowed commands:

- `rev-parse --show-toplevel`
- `rev-parse --abbrev-ref HEAD`
- `rev-parse --verify HEAD` with explicit unborn-branch handling
- `config --get branch.<branch>.remote`
- `config --get branch.<branch>.merge`
- `status --porcelain=v1 -z --branch`
- `diff --numstat`
- `add -A`
- `commit -m <message>`
- `push --porcelain <remote> HEAD:<remote-ref>`

Do not expose arbitrary git args through the API.

### Commit-All Safety

This plan intentionally commits every uncommitted change in the project repo.

The v1 strategy is:

1. Parse porcelain `XY` status into index and worktree state.
2. Show every dirty path in the confirmation modal.
3. Warn when partial staging exists because `git add -A` will commit the full
   current worktree version.
4. Reject merge conflicts.
5. Acquire a project-level git operation lock.
6. Re-read status inside the lock and compare `status_token`.
7. Run `git add -A` from the repository root.
8. Re-read status after staging to record the final committed paths.
9. Run `git commit -m <message>`.

Pre-existing staged files are not treated as unrelated. They are part of the
project's uncommitted state and are intentionally committed.

### Preflight Checks

`GetProjectGitStatus`:

1. Resolve project.
2. Resolve and verify project git root.
3. Read git status.
4. Build a `status_token` from HEAD SHA, branch, upstream/push target, and the
   full porcelain status.
5. Compute blockers and warnings.

`CommitProjectChanges`:

1. Re-read project and git status.
2. Acquire a project-level git operation lock.
3. Re-read status inside the lock.
4. Reject if any active Codex writer exists in the same project:
   - any session status is `pending`, `running`, or `waiting_approval`
   - any session has non-empty `ActiveTurnID`
   Terminal drawer edits and outside editor writes cannot be perfectly known;
   the status token and project lock are the guard for those.
5. Reject if conflicts exist.
6. Reject if message is blank.
7. Reject if no dirty files exist.
8. Reject if `expected_status_token` does not match current status.
9. Run `git add -A`.
10. Run commit.
11. If mode is `COMMIT_AND_PUSH`, run explicit refspec push.
12. Publish a git refresh event.
13. Return exact outcome.

Do not publish `SESSION_CHANGED` for a git action unless session data actually
changes. Git state is not Codex session truth.

If commit succeeds but push fails, return a non-OK Connect error only if the API
cannot return the partial success body. Prefer returning
`GIT_ACTION_OUTCOME_COMMITTED_PUSH_FAILED` with the commit SHA and an actionable
diagnostic. Users need to know their local commit exists.

After `COMMITTED_PUSH_FAILED`, keep the dialog in a push-retry state using
`PushProjectBranch` with the expected HEAD SHA. A user who clicked
`Commit All & Push` should not have to leave hopter just because credentials or
the network failed.

### Commit Message

Default message:

1. If project name exists: `chore: update <project name>`
2. Else: `chore: update project`

The modal always lets the user edit it.

## Frontend Plan

### Data Hooks

Add:

- `queryKeys.projectGitStatus(projectId)`
- `useProjectGitStatus(projectId, enabled)`
- `useCommitProjectChanges()`
- `usePushProjectBranch()`

On success:

- invalidate projects
- invalidate sessions
- invalidate session meta for the current route if present
- invalidate project git status

SSE invalidation must add an explicit `WORKSPACE_EVENT_TYPE_GIT_CHANGED` branch
in `ui/src/lib/query/invalidation.ts`; do not rely on the broad default refetch
path.

### UI Components

Create:

- `ui/src/components/app/project-git-action-dialog.tsx`

Responsibilities:

- load project git status on open
- show all dirty files, not a selectable checklist
- show branch and push target
- edit commit message
- switch between commit-only and commit-and-push modes
- disable push when no upstream exists
- show stale-state refresh CTA
- show partial staging warning
- show partial success warning when push fails
- offer push retry after partial success

Update:

- `workspace-topbar.tsx` to expose `Review`, `Commit All`, `Commit All & Push`
- `session-detail-pane.tsx` to open the dialog using `session.project.id`

Use shadcn semantic tokens and existing workspace tokens. No hard-coded hex.

## State And Event Flow

```text
User clicks Commit All / Commit All & Push
  -> React opens ProjectGitActionDialog
  -> GitService.GetProjectGitStatus(project_id)
  -> user confirms all dirty files + message
  -> GitService.CommitProjectChanges(project_id, mode, message, token)
  -> git executor verifies stale token and blockers under project lock
  -> git add -A
  -> git commit
  -> optional explicit-refspec git push
  -> GitService returns result
  -> EventHub publishes git refresh hint
  -> TanStack Query invalidates git status and related visible project/session queries
```

## Failure Modes

| Failure | User-facing behavior |
|---|---|
| No dirty files | Disable commit, show "No changes to commit." |
| Active project writer | Disable commit, show "Wait for active Codex work in this project to finish." |
| Merge conflicts | Disable commit, show conflicted paths. |
| Stale preview | Reject action, ask user to refresh the dialog. |
| Partial staging | Warn that the full current worktree state will be committed. |
| Git identity missing | Show sanitized git diagnostic with the fix. |
| Hooks fail | Show sanitized, size-capped hook output, keep files uncommitted. |
| Commit succeeds, push fails | Show commit SHA, warning, and retry push action. |
| No upstream | Disable push. Commit-only remains available. |
| Remote credentials missing | Commit remains; push warning tells user to authenticate git outside hopter. |
| Detached HEAD | Allow commit-only with warning; disable push. |
| Unborn branch | Allow first commit; disable push until branch and remote target are clear. |
| Branch behind/diverged | Disable push and tell the user to reconcile in terminal or Codex first. |

## Validation Plan

### Unit Tests

Run through temporary git repos:

- status parser detects modified, deleted, untracked, renamed, and conflicted files
- parser preserves index and worktree `XY` status separately
- full dirty file list includes staged, unstaged, untracked, deleted, and renamed files
- stale status token rejects commit
- `git add -A` commits all dirty files
- partial staging is flattened into the committed worktree state with warning
- deleted files can be committed
- renamed files include both old and new path metadata
- detached HEAD allows commit-only and rejects push
- unborn branch supports first commit
- commit-and-push works against a local bare remote
- no-upstream state disables push
- missing `.git` hides the commit entrypoint
- non-fast-forward push fails safely
- hook failure output is sanitized and capped
- credential prompt prevention does not hang
- push failure returns committed-but-not-pushed state
- push retry succeeds against a local bare remote after partial failure

### RPC Tests

- `GetProjectGitStatus` maps core status to proto
- `CommitProjectChanges` rejects invalid mode/message/project
- `CommitProjectChanges` rejects active project writers
- `CommitProjectChanges` uses project status only, not session review
- git-unavailable projects do not expose commit actions
- commit success publishes git event
- partial push failure maps to a useful response
- `PushProjectBranch` requires expected HEAD SHA and refuses stale state

### UI Validation

Add `scripts/validate-git-actions-ui.ts`:

- mock Connect endpoints
- open `/sessions/:sessionId`
- open commit dialog
- verify all dirty files render without checkboxes
- verify default message
- click `Commit All`
- assert RPC payload contains project id, mode, message, and status token
- assert RPC payload does not contain file paths
- repeat `Commit All & Push`
- verify no-upstream disables push
- verify no-git projects hide the commit entrypoint
- verify partial staging warning renders
- verify partial push warning renders
- verify push retry action calls `PushProjectBranch`

### Live Git Validation

Add `scripts/validate-git-actions.ts`:

- create temp repo and bare remote
- start hopter or call Connect handlers against the temp repo
- prove all dirty files are committed
- prove session latest-turn review does not influence commit set
- prove commit-and-push updates the bare remote
- prove stale token rejection
- prove partial push failure and retry

### Full Validation Commands

Required before claiming implementation complete:

```bash
make proto
go test ./...
pnpm --dir ui build
bun scripts/validate-git-actions-ui.ts
bun scripts/validate-git-actions.ts
```

Evidence should be written under:

```text
storage/artifacts/validation/<run-id>/git-actions/
storage/artifacts/validation/latest-git-actions-ui.txt
```

## Implementation Order

1. Add `git.proto`, regenerate Go/TS.
2. Implement `internal/gitops` status parsing, project lock, and executor with unit tests.
3. Add `GitService` RPC and router wiring.
4. Add frontend clients/hooks/query keys.
5. Add `core.EventKind` / `events.proto` / `internal/events/hub.go` mappings.
6. Add frontend SSE invalidation for git status.
7. Add commit dialog and topbar menu changes.
8. Add UI and live git validation scripts.
9. Run full validation and record evidence path.

## Decision Audit Trail

| # | Phase | Decision | Classification | Principle | Rationale | Rejected |
|---|---|---|---|---|---|---|
| 1 | Product | Implement git as a first-class Connect service, not chat input | Mechanical | Explicit over clever | Git actions need preflight, stale-state checks, and structured results | Ask Codex to run git commands |
| 2 | Product | Commit all project dirty state, not session-derived files | User direction | User sovereignty | User explicitly corrected the product behavior | Latest-turn selection |
| 3 | Backend | Use native git binary with fixed argv | Mechanical | Pragmatic | Reuses the user's installed git behavior without exposing arbitrary shell | Shell command strings or a new git library |
| 4 | UX | Use one confirmation dialog for commit-only and commit-and-push | Mechanical | DRY | Same repo preview/message/preflight surface, different final mode | Two separate modals |
| 5 | Safety | Reject stale status tokens | Mechanical | Quality matters | User preview must match the repo state being committed | Best-effort commit against changed worktree |
| 6 | Scope | Defer PR creation and branch management | Mechanical | Bias toward action | Commit/push completes the requested local landing loop without turning hopter into GitHub Desktop | Full git hosting workflow |
| 7 | Safety | Treat staged and unstaged files as one commit-all set | Mechanical | Explicit over clever | This matches "all uncommitted files" and avoids hidden file-selection semantics | Partial file selection |
| 8 | Backend | Push explicit refspec only | Mechanical | Explicit over clever | Bare git push can obey repo config and push more than intended | `git push` |
| 9 | UX | Disable push when no upstream exists | User direction | User sovereignty | User explicitly said no upstream means push button is gray | Upstream creation flow |
| 10 | Backend | Add push retry RPC after partial success | Mechanical | Complete the job | Commit & Push is incomplete if push failure strands the user outside hopter | Terminal-only retry |

## Dual Voice Review Findings

| Reviewer | Initial Finding | Revised Response |
|---|---|---|
| Claude subagent | selected-file commits are unsafe with staged state | superseded by user direction: commit all dirty state, show all files, and use `git add -A` intentionally |
| Codex | selected-path-safe commit required if selecting files | superseded by user direction: no selected paths in request or UI |
| Codex | bare `git push` is unsafe | retained: push uses explicit refspec |
| Both | non-interactive timeouts and diagnostics needed | retained |

## Review Scores

- CEO: 8/10. This closes the remote control loop and is simpler now: one repo,
  one dirty state, one commit.
- Design: 8/10. The modal must be blunt that it commits everything. No checkbox
  theater.
- Eng: 8/10. Removing selected paths simplifies the dangerous index problem, but
  active-writer, stale-token, and push-target checks remain mandatory.
- DX: 8/10. Errors are clear if diagnostics are structured and validation uses
  real temp repos.

## Open Questions

None blocking. The recommended default is:

- all dirty files committed
- latest-turn/session review never selects commit contents
- `Commit All & Push` uses existing upstream by default
- if no upstream exists, push is disabled
- if no `.git` is configured, the commit button is hidden
- hooks run normally, but every git command is non-interactive, timeout-bound, and
  stderr-capped
