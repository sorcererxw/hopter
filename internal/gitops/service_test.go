package gitops

import (
	"context"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"

	"github.com/sorcererxw/hopter/internal/core"
)

func TestCommitProjectChangesCommitsAllDirtyFiles(t *testing.T) {
	workspace, project := testWorkspaceWithRepo(t)
	service := NewService(workspace, nil)

	writeFile(t, project.RootPath, "tracked.txt", "changed\n")
	writeFile(t, project.RootPath, "new.txt", "new\n")

	status, err := service.GetProjectGitStatus(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("GetProjectGitStatus: %v", err)
	}
	if !status.CanCommit {
		t.Fatalf("expected can commit, blockers=%+v", status.Blockers)
	}
	if len(status.Files) != 2 {
		t.Fatalf("dirty file count = %d, want 2: %+v", len(status.Files), status.Files)
	}

	result, err := service.CommitProjectChanges(
		context.Background(),
		project.ID,
		CommitOnly,
		"test: commit all changes",
		status.StatusToken,
	)
	if err != nil {
		t.Fatalf("CommitProjectChanges: %v", err)
	}
	if result.Outcome != OutcomeCommitted {
		t.Fatalf("outcome = %q, want committed diagnostics=%+v", result.Outcome, result.Diagnostics)
	}
	if got := strings.TrimSpace(git(t, project.RootPath, "status", "--porcelain")); got != "" {
		t.Fatalf("git status = %q, want clean", got)
	}
	if got := git(t, project.RootPath, "show", "--name-only", "--format=", "HEAD"); !strings.Contains(got, "tracked.txt") || !strings.Contains(got, "new.txt") {
		t.Fatalf("commit files = %q, want tracked.txt and new.txt", got)
	}
}

func TestCommitAndPushRejectsMissingUpstreamBeforeCommit(t *testing.T) {
	workspace, project := testWorkspaceWithRepo(t)
	service := NewService(workspace, nil)

	before := strings.TrimSpace(git(t, project.RootPath, "rev-parse", "HEAD"))
	writeFile(t, project.RootPath, "tracked.txt", "changed\n")

	status, err := service.GetProjectGitStatus(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("GetProjectGitStatus: %v", err)
	}
	if status.CanPush {
		t.Fatalf("expected canPush=false without upstream")
	}

	result, err := service.CommitProjectChanges(
		context.Background(),
		project.ID,
		CommitAndPush,
		"test: should not commit",
		status.StatusToken,
	)
	if err != nil {
		t.Fatalf("CommitProjectChanges: %v", err)
	}
	if result.Outcome != OutcomeRejectedBlocked {
		t.Fatalf("outcome = %q, want rejected_blocked", result.Outcome)
	}
	after := strings.TrimSpace(git(t, project.RootPath, "rev-parse", "HEAD"))
	if after != before {
		t.Fatalf("HEAD changed from %s to %s despite missing upstream", before, after)
	}
}

func TestActiveProjectWriterBlocksCommit(t *testing.T) {
	workspace, project := testWorkspaceWithRepo(t)
	service := NewService(workspace, nil)

	if _, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Prompt:    "keep running",
	}); err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	writeFile(t, project.RootPath, "tracked.txt", "changed\n")

	status, err := service.GetProjectGitStatus(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("GetProjectGitStatus: %v", err)
	}
	if status.CanCommit {
		t.Fatalf("expected canCommit=false with active writer")
	}
	result, err := service.CommitProjectChanges(
		context.Background(),
		project.ID,
		CommitOnly,
		"test: blocked",
		status.StatusToken,
	)
	if err != nil {
		t.Fatalf("CommitProjectChanges: %v", err)
	}
	if result.Outcome != OutcomeRejectedBlocked {
		t.Fatalf("outcome = %q, want rejected_blocked", result.Outcome)
	}
}

func TestMissingGitDirectoryDisablesCommitStatus(t *testing.T) {
	workspace, project := testWorkspaceWithRepo(t)
	service := NewService(workspace, nil)

	if err := os.RemoveAll(filepath.Join(project.RootPath, ".git")); err != nil {
		t.Fatalf("remove .git: %v", err)
	}

	status, err := service.GetProjectGitStatus(context.Background(), project.ID)
	if err != nil {
		t.Fatalf("GetProjectGitStatus: %v", err)
	}
	if status.IsGitRepository {
		t.Fatalf("expected isGitRepository=false")
	}
	if status.CanCommit {
		t.Fatalf("expected canCommit=false without .git")
	}
	if len(status.Blockers) == 0 || status.Blockers[0].Code != "not_git_repository" {
		t.Fatalf("unexpected blockers: %+v", status.Blockers)
	}
}

func testWorkspaceWithRepo(t *testing.T) (*core.InMemoryWorkspace, core.Project) {
	t.Helper()
	root := t.TempDir()
	repo := filepath.Join(root, "repo")
	if err := os.MkdirAll(repo, 0o755); err != nil {
		t.Fatalf("mkdir repo: %v", err)
	}
	git(t, repo, "init")
	git(t, repo, "config", "user.email", "test@example.com")
	git(t, repo, "config", "user.name", "Test User")
	writeFile(t, repo, "tracked.txt", "initial\n")
	git(t, repo, "add", ".")
	git(t, repo, "commit", "-m", "initial")

	workspace := core.NewInMemoryWorkspace("test-host", nil)
	project, err := workspace.CreateProject(core.CreateProjectInput{
		Name:     "repo",
		RootPath: repo,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	return workspace, project
}

func writeFile(t *testing.T, root string, name string, body string) {
	t.Helper()
	path := filepath.Join(root, name)
	if err := os.MkdirAll(filepath.Dir(path), 0o755); err != nil {
		t.Fatalf("mkdir file dir: %v", err)
	}
	if err := os.WriteFile(path, []byte(body), 0o644); err != nil {
		t.Fatalf("write %s: %v", name, err)
	}
}

func git(t *testing.T, root string, args ...string) string {
	t.Helper()
	cmd := exec.Command("git", append([]string{"-C", root}, args...)...)
	out, err := cmd.CombinedOutput()
	if err != nil {
		t.Fatalf("git %v: %v\n%s", args, err, string(out))
	}
	return string(out)
}
