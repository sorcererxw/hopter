package gitops

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

type FileStatus string

const (
	FileStatusAdded      FileStatus = "added"
	FileStatusModified   FileStatus = "modified"
	FileStatusDeleted    FileStatus = "deleted"
	FileStatusRenamed    FileStatus = "renamed"
	FileStatusUntracked  FileStatus = "untracked"
	FileStatusConflicted FileStatus = "conflicted"
)

type Outcome string

const (
	OutcomeCommitted           Outcome = "committed"
	OutcomeCommittedAndPushed  Outcome = "committed_and_pushed"
	OutcomeCommittedPushFailed Outcome = "committed_push_failed"
	OutcomePushed              Outcome = "pushed"
	OutcomeNoChanges           Outcome = "no_changes"
	OutcomeRejectedStale       Outcome = "rejected_stale"
	OutcomeRejectedBlocked     Outcome = "rejected_blocked"
	OutcomeFailed              Outcome = "failed"
)

type CommitMode string

const (
	CommitOnly    CommitMode = "commit_only"
	CommitAndPush CommitMode = "commit_and_push"
)

type Diagnostic struct {
	Code          string
	Step          string
	Message       string
	StderrExcerpt string
	ExitCode      int
}

type FileChange struct {
	Path            string
	Status          FileStatus
	IndexStatus     string
	WorktreeStatus  string
	OldPath         string
	PartiallyStaged bool
	Additions       int
	Deletions       int
}

type ProjectStatus struct {
	ProjectID              string
	RootPath               string
	Branch                 string
	HeadSHA                string
	HeadShortSHA           string
	Upstream               string
	PushRemote             string
	PushBranch             string
	Ahead                  int
	Behind                 int
	Dirty                  bool
	HasConflicts           bool
	ProjectHasActiveWriter bool
	CanCommit              bool
	CanPush                bool
	IsGitRepository        bool
	DetachedHead           bool
	UnbornBranch           bool
	StatusToken            string
	DefaultCommitMessage   string
	Files                  []FileChange
	Blockers               []Diagnostic
	Warnings               []Diagnostic
}

type CommitResult struct {
	Outcome        Outcome
	CommitSHA      string
	CommitShortSHA string
	Branch         string
	Upstream       string
	Summary        string
	CommittedPaths []string
	Diagnostics    []Diagnostic
	StatusAfter    ProjectStatus
}

type PushResult struct {
	Outcome     Outcome
	Branch      string
	Upstream    string
	Diagnostics []Diagnostic
	StatusAfter ProjectStatus
}

type Service struct {
	workspace core.WorkspaceService
	eventSink core.EventSink
	runner    *runner

	mu    sync.Mutex
	locks map[string]*sync.Mutex
}

func NewService(workspace core.WorkspaceService, eventSink core.EventSink) *Service {
	return &Service{
		workspace: workspace,
		eventSink: eventSink,
		runner:    newRunner(),
		locks:     make(map[string]*sync.Mutex),
	}
}

func (s *Service) GetProjectGitStatus(ctx context.Context, projectID string) (ProjectStatus, error) {
	project, err := s.resolveProject(projectID)
	if err != nil {
		return ProjectStatus{}, err
	}
	return s.readStatus(ctx, project)
}

func (s *Service) CommitProjectChanges(
	ctx context.Context,
	projectID string,
	mode CommitMode,
	message string,
	expectedToken string,
) (CommitResult, error) {
	if mode != CommitOnly && mode != CommitAndPush {
		return CommitResult{}, errors.New("commit mode is required")
	}
	message = strings.TrimSpace(message)
	if message == "" {
		return CommitResult{}, errors.New("commit message is required")
	}

	project, err := s.resolveProject(projectID)
	if err != nil {
		return CommitResult{}, err
	}

	lock := s.projectLock(project.ID)
	lock.Lock()
	defer lock.Unlock()

	status, err := s.readStatus(ctx, project)
	if err != nil {
		return CommitResult{}, err
	}
	if status.StatusToken != strings.TrimSpace(expectedToken) {
		return CommitResult{
			Outcome:     OutcomeRejectedStale,
			Summary:     "Repository changed since the preview was loaded.",
			StatusAfter: status,
			Diagnostics: []Diagnostic{{
				Code:    "stale_status",
				Step:    "preflight",
				Message: "Repository changed since the preview was loaded. Refresh and try again.",
			}},
		}, nil
	}
	if block := firstCommitBlocker(status, mode); block != nil {
		return CommitResult{
			Outcome:     block.outcome,
			Summary:     block.diagnostic.Message,
			StatusAfter: status,
			Diagnostics: []Diagnostic{block.diagnostic},
		}, nil
	}

	if _, err := s.runner.run(ctx, status.RootPath, gitCommand{
		args:    []string{"add", "-A"},
		timeout: 30 * time.Second,
		step:    "git add",
	}); err != nil {
		return s.failedCommit(status, "git add", err), nil
	}

	stagedStatus, err := s.readStatus(ctx, project)
	if err != nil {
		return CommitResult{}, err
	}
	committedPaths := make([]string, 0, len(stagedStatus.Files))
	for _, file := range stagedStatus.Files {
		committedPaths = append(committedPaths, file.Path)
	}

	if _, err := s.runner.run(ctx, status.RootPath, gitCommand{
		args:    []string{"commit", "-m", message},
		timeout: 60 * time.Second,
		step:    "git commit",
	}); err != nil {
		after, _ := s.readStatus(ctx, project)
		if after.ProjectID == "" {
			after = status
		}
		return s.failedCommit(after, "git commit", err), nil
	}

	afterCommit, err := s.readStatus(ctx, project)
	if err != nil {
		return CommitResult{}, err
	}
	s.publish(project.ID)

	result := CommitResult{
		Outcome:        OutcomeCommitted,
		CommitSHA:      afterCommit.HeadSHA,
		CommitShortSHA: afterCommit.HeadShortSHA,
		Branch:         afterCommit.Branch,
		Upstream:       afterCommit.Upstream,
		Summary:        "Committed all repository changes.",
		CommittedPaths: committedPaths,
		StatusAfter:    afterCommit,
	}

	if mode == CommitOnly {
		return result, nil
	}

	pushResult, err := s.pushLocked(ctx, project, afterCommit)
	if err != nil {
		return CommitResult{}, err
	}
	result.StatusAfter = pushResult.StatusAfter
	result.Diagnostics = append(result.Diagnostics, pushResult.Diagnostics...)
	if pushResult.Outcome == OutcomePushed {
		result.Outcome = OutcomeCommittedAndPushed
		result.Summary = "Committed and pushed all repository changes."
	} else {
		result.Outcome = OutcomeCommittedPushFailed
		result.Summary = "Committed locally, but push did not complete."
	}
	return result, nil
}

func (s *Service) PushProjectBranch(
	ctx context.Context,
	projectID string,
	expectedHeadSHA string,
	expectedToken string,
) (PushResult, error) {
	project, err := s.resolveProject(projectID)
	if err != nil {
		return PushResult{}, err
	}

	lock := s.projectLock(project.ID)
	lock.Lock()
	defer lock.Unlock()

	status, err := s.readStatus(ctx, project)
	if err != nil {
		return PushResult{}, err
	}
	if strings.TrimSpace(expectedHeadSHA) != "" && status.HeadSHA != strings.TrimSpace(expectedHeadSHA) {
		return PushResult{
			Outcome:     OutcomeRejectedStale,
			Branch:      status.Branch,
			Upstream:    status.Upstream,
			StatusAfter: status,
			Diagnostics: []Diagnostic{{Code: "stale_head", Step: "preflight", Message: "HEAD changed since the push failed. Refresh before pushing."}},
		}, nil
	}
	if strings.TrimSpace(expectedToken) != "" && status.StatusToken != strings.TrimSpace(expectedToken) {
		return PushResult{
			Outcome:     OutcomeRejectedStale,
			Branch:      status.Branch,
			Upstream:    status.Upstream,
			StatusAfter: status,
			Diagnostics: []Diagnostic{{Code: "stale_status", Step: "preflight", Message: "Repository changed since the preview was loaded. Refresh before pushing."}},
		}, nil
	}
	return s.pushLocked(ctx, project, status)
}

func (s *Service) readStatus(ctx context.Context, project core.Project) (ProjectStatus, error) {
	status := ProjectStatus{
		ProjectID:            project.ID,
		RootPath:             project.RootPath,
		DefaultCommitMessage: defaultCommitMessage(project),
	}

	root, err := s.gitRoot(ctx, project.RootPath)
	if err != nil {
		status.Blockers = append(status.Blockers, Diagnostic{
			Code:    "not_git_repository",
			Step:    "git root",
			Message: "This project is not a git repository.",
		})
		return status, nil
	}
	status.RootPath = root
	status.IsGitRepository = true

	status.ProjectHasActiveWriter = s.projectHasActiveWriter(project.ID)
	status.Branch, status.DetachedHead = s.branch(ctx, root)
	status.HeadSHA, status.UnbornBranch = s.head(ctx, root)
	status.HeadShortSHA = shortSHA(status.HeadSHA)
	status.Upstream, status.PushRemote, status.PushBranch = s.upstream(ctx, root)
	status.Ahead, status.Behind = s.aheadBehind(ctx, root, status.Upstream, status.HeadSHA)

	files, err := s.statusFiles(ctx, root)
	if err != nil {
		return ProjectStatus{}, err
	}
	status.Files = files
	status.Dirty = len(files) > 0
	for _, file := range files {
		if file.Status == FileStatusConflicted {
			status.HasConflicts = true
		}
		if file.PartiallyStaged {
			status.Warnings = append(status.Warnings, Diagnostic{
				Code:    "partial_staging",
				Step:    "git status",
				Message: "Some files are partially staged. Commit All will commit the full current worktree state.",
			})
			break
		}
	}

	if !status.Dirty {
		status.Blockers = append(status.Blockers, Diagnostic{Code: "no_changes", Step: "git status", Message: "No changes to commit."})
	}
	if status.HasConflicts {
		status.Blockers = append(status.Blockers, Diagnostic{Code: "conflicts", Step: "git status", Message: "Resolve merge conflicts before committing."})
	}
	if status.ProjectHasActiveWriter {
		status.Blockers = append(status.Blockers, Diagnostic{Code: "active_writer", Step: "preflight", Message: "Wait for active Codex work in this project to finish."})
	}
	status.CanCommit = status.IsGitRepository && status.Dirty && !status.HasConflicts && !status.ProjectHasActiveWriter

	switch {
	case status.DetachedHead:
		status.Warnings = append(status.Warnings, Diagnostic{Code: "detached_head", Step: "git branch", Message: "Push is disabled on detached HEAD."})
	case status.UnbornBranch:
		status.Warnings = append(status.Warnings, Diagnostic{Code: "unborn_branch", Step: "git branch", Message: "Push is disabled until the first commit exists."})
	case status.Upstream == "":
		status.Warnings = append(status.Warnings, Diagnostic{Code: "no_upstream", Step: "git upstream", Message: "Push is disabled because this branch has no upstream."})
	case status.Behind > 0:
		status.Warnings = append(status.Warnings, Diagnostic{Code: "branch_behind", Step: "git upstream", Message: "Push is disabled because the branch is behind its upstream."})
	default:
		status.CanPush = true
	}

	status.StatusToken = statusToken(status)
	return status, nil
}

func (s *Service) pushLocked(ctx context.Context, project core.Project, status ProjectStatus) (PushResult, error) {
	if !status.CanPush {
		return PushResult{
			Outcome:     OutcomeRejectedBlocked,
			Branch:      status.Branch,
			Upstream:    status.Upstream,
			StatusAfter: status,
			Diagnostics: []Diagnostic{{Code: "push_disabled", Step: "preflight", Message: "Push is disabled for this branch."}},
		}, nil
	}
	remoteRef := "refs/heads/" + status.PushBranch
	if _, err := s.runner.run(ctx, status.RootPath, gitCommand{
		args:    []string{"push", "--porcelain", status.PushRemote, "HEAD:" + remoteRef},
		timeout: 90 * time.Second,
		step:    "git push",
	}); err != nil {
		after, _ := s.readStatus(ctx, project)
		if after.ProjectID == "" {
			after = status
		}
		return PushResult{
			Outcome:     OutcomeFailed,
			Branch:      status.Branch,
			Upstream:    status.Upstream,
			StatusAfter: after,
			Diagnostics: []Diagnostic{diagnosticFromError("push_failed", "git push", "Push failed.", err)},
		}, nil
	}
	after, err := s.readStatus(ctx, project)
	if err != nil {
		return PushResult{}, err
	}
	s.publish(project.ID)
	return PushResult{
		Outcome:     OutcomePushed,
		Branch:      after.Branch,
		Upstream:    after.Upstream,
		StatusAfter: after,
	}, nil
}

func (s *Service) failedCommit(status ProjectStatus, step string, err error) CommitResult {
	return CommitResult{
		Outcome:     OutcomeFailed,
		Summary:     "Commit failed.",
		StatusAfter: status,
		Diagnostics: []Diagnostic{diagnosticFromError("commit_failed", step, "Commit failed.", err)},
	}
}

func (s *Service) resolveProject(projectID string) (core.Project, error) {
	trimmed := strings.TrimSpace(projectID)
	if project, ok := s.workspace.GetProject(trimmed); ok {
		return project, nil
	}
	if !strings.HasPrefix(trimmed, "cwd:") {
		return core.Project{}, fmt.Errorf("project %q not found", projectID)
	}

	rootPath := filepath.Clean(strings.TrimSpace(strings.TrimPrefix(trimmed, "cwd:")))
	if rootPath == "." || rootPath == "" {
		return core.Project{}, fmt.Errorf("project %q not found", projectID)
	}
	for _, project := range s.workspace.ListProjects() {
		if filepath.Clean(strings.TrimSpace(project.RootPath)) == rootPath {
			return project, nil
		}
	}

	name := filepath.Base(rootPath)
	if name == "." || name == string(filepath.Separator) || name == "" {
		name = rootPath
	}
	project, err := s.workspace.CreateProject(core.CreateProjectInput{
		Name:           name,
		RootPath:       rootPath,
		DefaultBackend: core.BackendKeyCodex,
	})
	if err == nil {
		return project, nil
	}
	if synthetic, ok := s.syntheticProjectForVisibleNonGitRoot(trimmed, rootPath, name, err); ok {
		return synthetic, nil
	}
	for _, project := range s.workspace.ListProjects() {
		if filepath.Clean(strings.TrimSpace(project.RootPath)) == rootPath {
			return project, nil
		}
	}
	return core.Project{}, err
}

func (s *Service) syntheticProjectForVisibleNonGitRoot(projectID, rootPath, name string, createErr error) (core.Project, bool) {
	if createErr == nil || !strings.Contains(createErr.Error(), "is not a git repository") {
		return core.Project{}, false
	}

	metadata, err := s.workspace.GetPathMetadata(rootPath)
	if err != nil || !metadata.IsAllowed || !metadata.IsDirectory {
		return core.Project{}, false
	}

	return core.Project{
		ID:             projectID,
		Name:           name,
		RootPath:       metadata.CanonicalPath,
		DefaultBackend: core.BackendKeyCodex,
	}, true
}

func (s *Service) projectLock(projectID string) *sync.Mutex {
	s.mu.Lock()
	defer s.mu.Unlock()
	lock := s.locks[projectID]
	if lock == nil {
		lock = &sync.Mutex{}
		s.locks[projectID] = lock
	}
	return lock
}

func (s *Service) publish(projectID string) {
	if s.eventSink != nil {
		s.eventSink.Publish(core.Event{Kind: core.EventGitChanged, ProjectID: projectID})
	}
}

func (s *Service) gitRoot(ctx context.Context, rootPath string) (string, error) {
	out, err := s.runner.run(ctx, rootPath, gitCommand{
		args:    []string{"rev-parse", "--show-toplevel"},
		timeout: 10 * time.Second,
		step:    "git root",
	})
	if err != nil {
		return "", err
	}
	return filepath.Clean(strings.TrimSpace(out.stdout)), nil
}

func (s *Service) branch(ctx context.Context, root string) (string, bool) {
	out, err := s.runner.run(ctx, root, gitCommand{
		args:    []string{"symbolic-ref", "--quiet", "--short", "HEAD"},
		timeout: 10 * time.Second,
		step:    "git branch",
	})
	if err != nil {
		return "", true
	}
	return strings.TrimSpace(out.stdout), false
}

func (s *Service) head(ctx context.Context, root string) (string, bool) {
	out, err := s.runner.run(ctx, root, gitCommand{
		args:    []string{"rev-parse", "--verify", "HEAD"},
		timeout: 10 * time.Second,
		step:    "git head",
	})
	if err != nil {
		return "", true
	}
	return strings.TrimSpace(out.stdout), false
}

func (s *Service) upstream(ctx context.Context, root string) (string, string, string) {
	out, err := s.runner.run(ctx, root, gitCommand{
		args:    []string{"rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"},
		timeout: 10 * time.Second,
		step:    "git upstream",
	})
	if err != nil {
		return "", "", ""
	}
	upstream := strings.TrimSpace(out.stdout)
	remote, branch, ok := strings.Cut(upstream, "/")
	if !ok || remote == "" || branch == "" {
		return upstream, "", ""
	}
	return upstream, remote, branch
}

func (s *Service) aheadBehind(ctx context.Context, root string, upstream string, head string) (int, int) {
	if upstream == "" || head == "" {
		return 0, 0
	}
	out, err := s.runner.run(ctx, root, gitCommand{
		args:    []string{"rev-list", "--left-right", "--count", "HEAD...@{u}"},
		timeout: 10 * time.Second,
		step:    "git ahead behind",
	})
	if err != nil {
		return 0, 0
	}
	parts := strings.Fields(out.stdout)
	if len(parts) != 2 {
		return 0, 0
	}
	ahead, _ := strconv.Atoi(parts[0])
	behind, _ := strconv.Atoi(parts[1])
	return ahead, behind
}

func (s *Service) statusFiles(ctx context.Context, root string) ([]FileChange, error) {
	out, err := s.runner.run(ctx, root, gitCommand{
		args:    []string{"status", "--porcelain=v1", "-z", "--branch"},
		timeout: 10 * time.Second,
		step:    "git status",
	})
	if err != nil {
		return nil, err
	}
	records := strings.Split(out.stdout, "\x00")
	files := make([]FileChange, 0)
	for i := 0; i < len(records); i++ {
		record := records[i]
		if record == "" || strings.HasPrefix(record, "## ") {
			continue
		}
		if len(record) < 4 {
			continue
		}
		indexStatus := record[0:1]
		worktreeStatus := record[1:2]
		path := strings.TrimSpace(record[3:])
		file := FileChange{
			Path:            path,
			IndexStatus:     indexStatus,
			WorktreeStatus:  worktreeStatus,
			Status:          classifyStatus(indexStatus, worktreeStatus),
			PartiallyStaged: isPartiallyStaged(indexStatus, worktreeStatus),
		}
		if (indexStatus == "R" || indexStatus == "C") && i+1 < len(records) {
			i++
			file.OldPath = strings.TrimSpace(records[i])
		}
		files = append(files, file)
	}
	sort.Slice(files, func(i, j int) bool {
		return files[i].Path < files[j].Path
	})
	return files, nil
}

func (s *Service) projectHasActiveWriter(projectID string) bool {
	for _, session := range s.workspace.ListSessions(core.ListSessionsInput{ProjectID: projectID}) {
		switch session.Status {
		case core.SessionStatePending, core.SessionStateRunning, core.SessionStateWaitingApproval:
			return true
		}
		if strings.TrimSpace(session.ActiveTurnID) != "" {
			return true
		}
	}
	return false
}

type commitBlocker struct {
	outcome    Outcome
	diagnostic Diagnostic
}

func firstCommitBlocker(status ProjectStatus, mode CommitMode) *commitBlocker {
	for _, blocker := range status.Blockers {
		outcome := OutcomeRejectedBlocked
		if blocker.Code == "no_changes" {
			outcome = OutcomeNoChanges
		}
		return &commitBlocker{outcome: outcome, diagnostic: blocker}
	}
	if mode == CommitAndPush && !status.CanPush {
		return &commitBlocker{
			outcome: OutcomeRejectedBlocked,
			diagnostic: Diagnostic{
				Code:    "push_disabled",
				Step:    "preflight",
				Message: "Push is disabled for this branch.",
			},
		}
	}
	return nil
}

func classifyStatus(indexStatus, worktreeStatus string) FileStatus {
	if isConflictStatus(indexStatus, worktreeStatus) {
		return FileStatusConflicted
	}
	for _, status := range []string{indexStatus, worktreeStatus} {
		switch status {
		case "R", "C":
			return FileStatusRenamed
		case "A":
			return FileStatusAdded
		case "D":
			return FileStatusDeleted
		case "M", "T":
			return FileStatusModified
		case "?":
			return FileStatusUntracked
		}
	}
	return FileStatusModified
}

func isConflictStatus(indexStatus, worktreeStatus string) bool {
	pair := indexStatus + worktreeStatus
	switch pair {
	case "DD", "AU", "UD", "UA", "DU", "AA", "UU":
		return true
	default:
		return indexStatus == "U" || worktreeStatus == "U"
	}
}

func isPartiallyStaged(indexStatus, worktreeStatus string) bool {
	if indexStatus == "?" || worktreeStatus == "?" {
		return false
	}
	return strings.TrimSpace(indexStatus) != "" && strings.TrimSpace(worktreeStatus) != ""
}

func defaultCommitMessage(project core.Project) string {
	name := strings.TrimSpace(project.Name)
	if name == "" {
		name = strings.TrimSpace(filepath.Base(project.RootPath))
	}
	if name == "" || name == "." || name == string(filepath.Separator) {
		return "chore: update project"
	}
	return "chore: update " + name
}

func shortSHA(sha string) string {
	if len(sha) <= 12 {
		return sha
	}
	return sha[:12]
}

func statusToken(status ProjectStatus) string {
	var b strings.Builder
	b.WriteString(status.HeadSHA)
	b.WriteByte('\n')
	b.WriteString(status.Branch)
	b.WriteByte('\n')
	b.WriteString(status.Upstream)
	b.WriteByte('\n')
	for _, file := range status.Files {
		b.WriteString(file.IndexStatus)
		b.WriteString(file.WorktreeStatus)
		b.WriteByte('\t')
		b.WriteString(file.Path)
		b.WriteByte('\t')
		b.WriteString(file.OldPath)
		b.WriteByte('\n')
	}
	sum := sha256.Sum256([]byte(b.String()))
	return hex.EncodeToString(sum[:])
}

func diagnosticFromError(code, step, message string, err error) Diagnostic {
	diag := Diagnostic{Code: code, Step: step, Message: message}
	var cmdErr *commandError
	if errors.As(err, &cmdErr) {
		diag.StderrExcerpt = cmdErr.Stderr
		diag.ExitCode = cmdErr.ExitCode
		if strings.TrimSpace(cmdErr.Stderr) != "" {
			diag.Message = message + " " + strings.TrimSpace(cmdErr.Stderr)
		}
		return diag
	}
	diag.StderrExcerpt = truncateDiagnostic(err.Error())
	return diag
}
