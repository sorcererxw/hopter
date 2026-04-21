# Commit And Push Capability Plan

## Status

Proposed. Planning artifact for adding first-class `Commit` and `Commit & Push`
actions to the selected session workspace.

## User Request

Implement the ability to commit, and to commit then push, from hopter.

This should serve the remote control-plane job: after Codex finishes work, the
user can review the changed files from another browser and land the local repo
state without opening a terminal.

## Product Premise

This is a control-plane action, not a new agent workflow.

The browser should not send raw git commands. Codex should not be asked to run
`git commit` through chat. The Go server should own a narrow git action API with
strict arguments, clear preflight checks, and evidence that tells the user what
happened.

## Current State

### What Already Exists

- `WorkspaceTopbar` already renders a `Commit` dropdown on session routes.
- `SessionWorkspacePane` passes `onCommit`, `onCommitAndReview`, and `onOpenReview`
  into the topbar, but `onCommit` is currently a TODO.
- `GetSessionReview` already exposes the latest completed Codex turn's reviewable
  file changes and full patch.
- `Project` already has a canonical `root_path` and project creation rejects
  non-git directories.
- The Go server already owns all browser-facing Connect APIs and SSE events.
- TanStack Query invalidation already refreshes session/project state after
  Connect mutations and SSE events.

### Missing Pieces

- No IDL surface for git state or git actions.
- No backend git executor.
- No confirmation modal that shows files, commit message, branch, and push target.
- No stale-state guard between preview and action execution.
- No validation harness for commit-only or commit-and-push behavior.

## Scope

### In Scope

- Session-scoped commit preview.
- Commit selected files for the selected session's project.
- Commit selected files without including unrelated pre-staged index entries.
- Commit then push to an explicit resolved remote/ref.
- Retry push after a commit succeeds but the push fails.
- Confirmation UI with editable commit message.
- Stale git status rejection.
- Conflict, staged-index, active-writer, and running-session guards.
- Clear partial success state when commit succeeds but push fails.
- Unit, RPC, and browser validation evidence.

### Not In Scope

- Arbitrary shell commands.
- Full branch management UI.
- PR creation.
- Force push.
- Rebase, merge conflict resolution, cherry-pick, amend, stash, reset.
- Credential management for remotes.
- Multi-user coordination semantics.
- A persistent mirror of git history in hopter storage.

## UX Plan

### Entry Point

Replace the selected-session topbar dropdown with:

1. `Review`
2. `Commit`
3. `Commit & Push`

`Review` stays a read-only inspector action. `Commit` and `Commit & Push` open the
same confirmation modal with different default mode.

### Confirmation Modal

The modal loads a fresh git preview for the session:

- branch name
- current commit short SHA
- upstream / push target
- ahead / behind counts when available
- dirty file list
- staged vs unstaged status for each file
- which files came from the latest completed Codex turn
- default commit message derived from session title or summary
- warning if unselected dirty files exist
- warning if any pre-existing staged state exists

Primary actions:

- `Commit`
- `Commit & Push`
- `Cancel`

The modal should disable commit actions when:

- session has a running turn
- project git root cannot be resolved
- there are no selected files
- merge conflicts are present
- commit message is blank
- preview is stale and must be refreshed
- selected files are partially staged
- unrelated staged files exist
- `Commit & Push` targets a detached HEAD or unknown remote
- branch is behind/diverged from its upstream

### File Selection Rule

Default selection should be conservative:

- select files present in the latest completed Codex turn review
- leave unrelated dirty files unchecked
- if no review is available, show all dirty files unchecked and require an
  explicit "include non-turn changes" confirmation before enabling commit

This prevents a remote click from accidentally committing unrelated local work.

## IDL Plan

Add a new `idl/hopter/v1/git.proto` and generated Go/TS clients.

Recommended service:

```proto
service GitService {
  rpc GetSessionGitStatus(GetSessionGitStatusRequest) returns (GetSessionGitStatusResponse);
  rpc CommitSessionChanges(CommitSessionChangesRequest) returns (CommitSessionChangesResponse);
  rpc PushSessionBranch(PushSessionBranchRequest) returns (PushSessionBranchResponse);
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
  bool selected_by_default = 6;
  bool from_latest_turn = 7;
  bool partially_staged = 8;
  uint32 additions = 9;
  uint32 deletions = 10;
}

message SessionGitStatus {
  string session_id = 1;
  string project_id = 2;
  string root_path = 3;
  string branch = 4;
  string head_sha = 5;
  string head_short_sha = 6;
  string upstream = 7;
  string push_remote = 8;
  string push_branch = 9;
  int32 ahead = 10;
  int32 behind = 11;
  bool dirty = 12;
  bool has_conflicts = 13;
  bool session_turn_running = 14;
  bool project_has_active_writer = 15;
  bool can_commit = 16;
  bool can_push = 17;
  bool detached_head = 18;
  bool unborn_branch = 19;
  bool needs_upstream_confirmation = 20;
  string status_token = 21;
  string default_commit_message = 22;
  repeated GitFileChange files = 23;
  repeated GitDiagnostic blockers = 24;
  repeated GitDiagnostic warnings = 25;
}

message GetSessionGitStatusRequest {
  string session_id = 1;
}

message GetSessionGitStatusResponse {
  SessionGitStatus status = 1;
}

message CommitSessionChangesRequest {
  string session_id = 1;
  GitCommitMode mode = 2;
  string message = 3;
  repeated string paths = 4;
  string expected_status_token = 5;
  bool allow_create_upstream = 6;
}

message CommitSessionChangesResponse {
  GitActionOutcome outcome = 1;
  string commit_sha = 2;
  string commit_short_sha = 3;
  string branch = 4;
  string upstream = 5;
  string summary = 6;
  repeated string committed_paths = 7;
  repeated GitDiagnostic diagnostics = 8;
  SessionGitStatus status_after = 9;
}

message PushSessionBranchRequest {
  string session_id = 1;
  string expected_head_sha = 2;
  string expected_status_token = 3;
  bool allow_create_upstream = 4;
}

message PushSessionBranchResponse {
  GitActionOutcome outcome = 1;
  string branch = 2;
  string upstream = 3;
  repeated GitDiagnostic diagnostics = 4;
  SessionGitStatus status_after = 5;
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
- `diff --numstat -- <paths>`
- `add -A -- <paths>`
- `commit -m <message>`
- `push --porcelain <remote> HEAD:<remote-ref>`
- `push --porcelain -u origin HEAD:<branch>` only when no upstream exists,
  `origin` exists, and the request explicitly sets `allow_create_upstream`

Do not expose arbitrary git args through the API.

### Selected-File Commit Safety

Do not run plain `git commit -m` against an index that may contain unrelated
user-staged files.

The v1 strategy is:

1. Parse porcelain `XY` status into index and worktree state.
2. Reject any staged file outside the selected path set.
3. Reject any selected file that is partially staged, meaning both index and
   worktree columns are non-clean for the same path.
4. For renames, include both `old_path` and `path` in the selected pathspec set.
5. For deletions, validate by exact membership in the status snapshot, not by
   file existence on disk.
6. Run `git add -A -- <selected pathspecs>` under the project lock.
7. Run `git commit -m <message>` only after the re-read status proves the index
   cannot contain unselected entries.

This preserves the user promise: only selected files enter the commit.

### Preflight Checks

`GetSessionGitStatus`:

1. Resolve session to project.
2. Resolve and verify project git root.
3. Read latest completed turn review.
4. Read git status.
5. Mark latest-turn files as selected by default.
6. Build a `status_token` from HEAD SHA, branch, upstream/push target, and the
   full porcelain status. Do not include UI-selected paths in the token.

`CommitSessionChanges`:

1. Re-read session, project, latest review, and git status.
2. Acquire a project-level git operation lock.
3. Re-read status inside the lock.
4. Reject if any active Codex writer exists in the same project:
   - any session status is `pending`, `running`, or `waiting_approval`
   - any session has non-empty `ActiveTurnID`
   - latest review reports `pending_turn_in_progress`
   Terminal drawer edits and outside editor writes cannot be perfectly known;
   the status token and project lock are the guard for those.
5. Reject if conflicts exist.
6. Reject if message is blank.
7. Reject if selected paths are empty.
8. Reject if any requested path is absent from the current git status snapshot.
9. Reject if any requested path is lexically unsafe or escapes the repository root.
10. Reject if `expected_status_token` does not match current status.
11. Reject unrelated staged files and partially staged selected files.
12. Run selected-file-safe staging.
13. Run commit.
14. If mode is `COMMIT_AND_PUSH`, run explicit refspec push.
15. Publish a git refresh event.
16. Return exact outcome.

Do not publish `SESSION_CHANGED` for a git action unless session data actually
changes. Git state is not Codex session truth.

If commit succeeds but push fails, return a non-OK Connect error only if the API
cannot return the partial success body. Prefer returning
`GIT_ACTION_OUTCOME_COMMITTED_PUSH_FAILED` with the commit SHA and an actionable
diagnostic. Users need to know their local commit exists. This is the important
edge case.

After `COMMITTED_PUSH_FAILED`, keep the dialog in a push-retry state using
`PushSessionBranch` with the expected HEAD SHA. A user who clicked `Commit & Push`
should not have to leave hopter just because credentials or the network failed.

### Commit Message

Default message:

1. If session title is meaningful: `feat: <normalized session title>`
2. Else if summary exists: normalize first sentence.
3. Else: `chore: update from hopter session`

The modal always lets the user edit it.

## Frontend Plan

### Data Hooks

Add:

- `queryKeys.sessionGitStatus(sessionId)`
- `useSessionGitStatus(sessionId, enabled)`
- `useCommitSessionChanges()`
- `usePushSessionBranch()`

On success:

- invalidate sessions
- invalidate session meta
- invalidate session review
- invalidate session git status

SSE invalidation must add an explicit `WORKSPACE_EVENT_TYPE_GIT_CHANGED` branch
in `ui/src/lib/query/invalidation.ts`; do not rely on the broad default refetch
path.

### UI Components

Create:

- `ui/src/components/app/session-git-action-dialog.tsx`

Responsibilities:

- load status on open
- show selected file checklist
- show branch and push target
- edit commit message
- switch between commit-only and commit-and-push modes
- require explicit upstream-creation confirmation when no upstream exists
- show stale-state refresh CTA
- show partial success warning when push fails
- offer push retry after partial success

Update:

- `workspace-topbar.tsx` to expose `Review`, `Commit`, `Commit & Push`
- `session-detail-pane.tsx` to open the dialog and call mutations

Use shadcn semantic tokens and existing workspace tokens. No hard-coded hex.

## State And Event Flow

```text
User clicks Commit / Commit & Push
  -> React opens SessionGitActionDialog
  -> GitService.GetSessionGitStatus(session_id)
  -> user confirms files + message
  -> GitService.CommitSessionChanges(session_id, mode, paths, message, token)
  -> git executor rejects unrelated staged files / partial selected staging
  -> git executor stages selected paths under project lock
  -> git commit
  -> optional explicit-refspec git push
  -> GitService returns result
  -> EventHub publishes git refresh hint
  -> TanStack Query invalidates git status, session meta, session review
```

## Failure Modes

| Failure | User-facing behavior |
|---|---|
| No dirty files | Disable commit, show "No changes to commit." |
| Active project writer | Disable commit, show "Wait for active Codex work in this project to finish." |
| Merge conflicts | Disable commit, show conflicted paths. |
| Stale preview | Reject action, ask user to refresh the dialog. |
| Unrelated staged files | Disable commit, show the staged paths and ask user to unstage or include them. |
| Partially staged selected file | Disable commit, explain that hopter will not flatten partial staging remotely. |
| Git identity missing | Show git's actionable message from commit stderr. |
| Hooks fail | Show sanitized, size-capped hook output, keep files uncommitted. |
| Commit succeeds, push fails | Show commit SHA, warning, and retry push action. |
| No upstream | Require explicit "create origin/<branch> upstream" confirmation; otherwise disable push. |
| Remote credentials missing | Commit remains; push warning tells user to authenticate git outside hopter. |
| Detached HEAD | Allow commit-only with warning; disable push. |
| Unborn branch | Allow first commit; disable push until branch and remote target are clear. |
| Branch behind/diverged | Disable push and tell the user to reconcile in terminal or Codex first. |

## Validation Plan

### Unit Tests

Run through temporary git repos:

- status parser detects modified, deleted, untracked, renamed, and conflicted files
- parser preserves index and worktree `XY` status separately
- default selection uses latest-turn files and excludes unrelated dirty files
- path validation rejects escaping paths
- stale status token rejects commit
- commit selected paths leaves unselected dirty files uncommitted
- unrelated staged files reject commit
- partially staged selected files reject commit
- deleted files can be committed
- renamed files include both old and new paths
- pathspec-magic filenames are treated literally
- detached HEAD allows commit-only and rejects push
- unborn branch supports first commit
- commit-and-push works against a local bare remote
- no-origin and no-upstream states are surfaced correctly
- explicit upstream creation works only with `allow_create_upstream`
- non-fast-forward push fails safely
- hook failure output is sanitized and capped
- credential prompt prevention does not hang
- push failure returns committed-but-not-pushed state
- push retry succeeds against a local bare remote after partial failure

### RPC Tests

- `GetSessionGitStatus` maps core status to proto
- `CommitSessionChanges` rejects invalid mode/message/session
- `CommitSessionChanges` rejects unrelated staged files
- `CommitSessionChanges` rejects active project writers
- commit success publishes events
- partial push failure maps to a useful response
- `PushSessionBranch` requires expected HEAD SHA and refuses stale state

### UI Validation

Add `scripts/validate-git-actions-ui.ts`:

- mock Connect endpoints
- open `/sessions/:sessionId`
- open commit dialog
- verify selected files and default message
- click `Commit`
- assert RPC payload contains selected paths, mode, and status token
- repeat `Commit & Push`
- verify no-upstream confirmation UI
- verify partial push warning renders
- verify push retry action calls `PushSessionBranch`

### Live Git Validation

Add `scripts/validate-git-actions.ts`:

- create temp repo and bare remote
- start hopter or call Connect handlers against the temp repo
- prove selected-file commit does not include unrelated staged or dirty files
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
| 2 | Product | Default-select latest-turn files only | Mechanical | Choose completeness | Prevents committing unrelated local user changes from a remote device | Blind `git add -A` |
| 3 | Backend | Use native git binary with fixed argv | Mechanical | Pragmatic | Reuses the user's installed git behavior without exposing arbitrary shell | Shell command strings or a new git library |
| 4 | UX | Use one confirmation dialog for commit-only and commit-and-push | Mechanical | DRY | Same file/message/preflight surface, different final mode | Two separate modals |
| 5 | Safety | Reject stale status tokens | Mechanical | Quality matters | User preview must match the repo state being committed | Best-effort commit against changed worktree |
| 6 | Scope | Defer PR creation and branch management | Mechanical | Bias toward action | Commit/push completes the requested local landing loop without turning hopter into GitHub Desktop | Full git hosting workflow |
| 7 | Safety | Reject unrelated staged files and partially staged selected files | Mechanical | Quality matters | Plain git commit can include index state the UI left unchecked | Blind commit after git add |
| 8 | Backend | Push explicit refspec only | Mechanical | Explicit over clever | Bare git push can obey repo config and push more than intended | `git push` |
| 9 | UX | Require explicit upstream creation confirmation | Mechanical | User sovereignty | Publishing a new branch is not implied by local commit intent | Silent `push -u origin HEAD` |
| 10 | Backend | Add push retry RPC after partial success | Mechanical | Complete the job | Commit & Push is incomplete if push failure strands the user outside hopter | Terminal-only retry |

## Dual Voice Review Findings

| Reviewer | Verdict | Required Plan Changes |
|---|---|---|
| Claude subagent | Reject until revised | model index/worktree state, reject unrelated staged files, remove selected paths from status token, add diagnostics and real git validation |
| Codex | Required changes | selected-path-safe commit, explicit refspec push, detached/unborn handling, project lock, literal pathspecs, push retry, git-only event invalidation |

## Review Scores

- CEO: 8/10. This is a real wedge feature because it closes the remote loop after
  inspection. It should ship as a narrow control-plane action.
- Design: 8/10. Existing topbar has the right affordance, but the current
  `Commit & Review` label should become `Commit & Push` and the confirmation modal
  must carry the safety weight.
- Eng: 8/10. Architecture is straightforward if git is isolated behind `internal/gitops`
  and the API stays path/message/mode-only.
- DX: 7/10. Good if errors quote git's useful output and validation uses real temp
  repos. Weak if failures collapse into generic "commit failed" toasts.

## Open Questions

None blocking. The recommended default is:

- latest-turn files selected by default
- unrelated dirty files visible but unchecked
- `Commit & Push` uses existing upstream by default
- creating `origin/<current-branch>` upstream requires explicit confirmation
- hooks run normally, but every git command is non-interactive, timeout-bound, and
  stderr-capped
