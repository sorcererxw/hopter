package backend

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"orchd/internal/core"
)

type fakeRuntime struct {
	listResult   []ResolvedSession
	getSession   core.Session
	getProject   core.Project
	createResult core.Session
	sendResult   core.Session
}

func (f *fakeRuntime) ListSessions(projectID string, limit uint32) ([]ResolvedSession, error) {
	return f.listResult, nil
}

func (f *fakeRuntime) GetSession(sessionID string) (core.Session, core.Project, error) {
	return f.getSession, f.getProject, nil
}

func (f *fakeRuntime) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	return f.createResult, nil
}

func (f *fakeRuntime) SendSessionInput(sessionID, input string) (core.Session, error) {
	return f.sendResult, nil
}

func TestManagerCreateSessionRoutesByProjectDefaultBackend(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace, "copilot")
	runtime := &fakeRuntime{
		createResult: core.Session{
			ID:        "sess_1",
			ProjectID: project.ID,
			Title:     "probe",
			Status:    core.SessionStatePending,
			UpdatedAt: time.Now().UTC(),
		},
	}
	manager := NewManager(workspace, map[string]Runtime{
		"copilot": runtime,
	})

	session, err := manager.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "hello",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if session.BackendKey != "copilot" {
		t.Fatalf("backend key = %q, want copilot", session.BackendKey)
	}
}

func TestManagerGetSessionStampsFallbackBackendKey(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace, "codex")
	runtime := &fakeRuntime{
		getSession: core.Session{
			ID:        "sess_1",
			ProjectID: project.ID,
			Title:     "probe",
			Status:    core.SessionStateCompleted,
			UpdatedAt: time.Now().UTC(),
		},
		getProject: project,
	}
	manager := NewManager(workspace, map[string]Runtime{
		"codex": runtime,
	})

	session, _, err := manager.GetSession("sess_1")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if session.BackendKey != "codex" {
		t.Fatalf("backend key = %q, want codex", session.BackendKey)
	}
}

func mustCreateProject(t *testing.T, workspace core.WorkspaceService, defaultBackend string) core.Project {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir repo .git: %v", err)
	}
	project, err := workspace.CreateProject(core.CreateProjectInput{
		Name:           "probe",
		RootPath:       root,
		DefaultBackend: defaultBackend,
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	return project
}
