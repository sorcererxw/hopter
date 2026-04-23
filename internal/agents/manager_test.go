package agents

import (
	"os"
	"path/filepath"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

type fakeRuntime struct {
	listResult            []ResolvedSession
	getSession            core.Session
	getProject            core.Project
	createResult          core.Session
	sendResult            core.Session
	lastCreate            core.CreateSessionInput
	lastSendID            string
	lastSendText          string
	lastSendOptions       []core.SessionTurnOptions
	lastInterruptID       string
	lastApprovalID        string
	lastApprovalSessionID string
	lastApprovalDecision  core.ApprovalDecision
}

func (f *fakeRuntime) ListSessions(projectID string, limit uint32) ([]ResolvedSession, error) {
	return f.listResult, nil
}

func (f *fakeRuntime) GetSession(sessionID string) (core.Session, core.Project, error) {
	return f.getSession, f.getProject, nil
}

func (f *fakeRuntime) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	f.lastCreate = input
	return f.createResult, nil
}

func (f *fakeRuntime) SendSessionInput(sessionID, input string, options ...core.SessionTurnOptions) (core.Session, error) {
	f.lastSendID = sessionID
	f.lastSendText = input
	f.lastSendOptions = append([]core.SessionTurnOptions(nil), options...)
	return f.sendResult, nil
}

func (f *fakeRuntime) InterruptSession(sessionID string) (core.Session, error) {
	f.lastInterruptID = sessionID
	return f.sendResult, nil
}

func (f *fakeRuntime) RespondToSessionApproval(sessionID, approvalID string, decision core.ApprovalDecision) (core.Session, error) {
	f.lastApprovalSessionID = sessionID
	f.lastApprovalID = approvalID
	f.lastApprovalDecision = decision
	return f.sendResult, nil
}

func TestManagerCreateSessionRoutesByProjectDefaultBackend(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace, "codex")
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
		"codex": runtime,
	})

	session, err := manager.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "hello",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if session.BackendKey != "codex" {
		t.Fatalf("backend key = %q, want codex", session.BackendKey)
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

func TestManagerCreateSessionMaterializesSyntheticProject(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	root := makeRepoRoot(t)
	runtime := &fakeRuntime{
		createResult: core.Session{
			ID:        "sess_1",
			Title:     "probe",
			Status:    core.SessionStatePending,
			UpdatedAt: time.Now().UTC(),
		},
	}
	manager := NewManager(workspace, map[string]Runtime{
		"codex": runtime,
	})

	session, err := manager.CreateSession(core.CreateSessionInput{
		ProjectID:  "cwd:" + root,
		BackendKey: "codex",
		Prompt:     "hello",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	projects := workspace.ListProjects()
	if len(projects) != 1 {
		t.Fatalf("project count = %d, want 1", len(projects))
	}
	if runtime.lastCreate.ProjectID != projects[0].ID {
		t.Fatalf("runtime project id = %q, want %q", runtime.lastCreate.ProjectID, projects[0].ID)
	}
	if session.ProjectID != projects[0].ID {
		t.Fatalf("session project id = %q, want %q", session.ProjectID, projects[0].ID)
	}
}

func TestManagerSendSessionInputMaterializesSyntheticProject(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	root := makeRepoRoot(t)
	syntheticProject := core.Project{
		ID:             "cwd:" + root,
		Name:           filepath.Base(root),
		RootPath:       root,
		DefaultBackend: "codex",
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	runtime := &fakeRuntime{
		getSession: core.Session{
			ID:         "sess_remote",
			ProjectID:  syntheticProject.ID,
			BackendKey: "codex",
			Title:      "probe",
			Status:     core.SessionStateCompleted,
			UpdatedAt:  time.Now().UTC(),
		},
		getProject: syntheticProject,
		sendResult: core.Session{
			ID:        "sess_remote",
			ProjectID: syntheticProject.ID,
			Status:    core.SessionStateRunning,
			UpdatedAt: time.Now().UTC(),
		},
	}
	manager := NewManager(workspace, map[string]Runtime{
		"codex": runtime,
	})

	updated, err := manager.SendSessionInput("sess_remote", "follow up")
	if err != nil {
		t.Fatalf("SendSessionInput: %v", err)
	}

	projects := workspace.ListProjects()
	if len(projects) != 1 {
		t.Fatalf("project count = %d, want 1", len(projects))
	}
	if runtime.lastSendID != "sess_remote" {
		t.Fatalf("send session id = %q, want sess_remote", runtime.lastSendID)
	}
	if runtime.lastSendText != "follow up" {
		t.Fatalf("send text = %q, want follow up", runtime.lastSendText)
	}
	if updated.ID != "sess_remote" {
		t.Fatalf("updated session id = %q, want sess_remote", updated.ID)
	}
}

func TestManagerSendSessionInputAllowsVisibleNonGitSyntheticProject(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	root := t.TempDir()
	metadata, err := workspace.GetPathMetadata(root)
	if err != nil {
		t.Fatalf("GetPathMetadata: %v", err)
	}
	syntheticProject := core.Project{
		ID:             "cwd:" + root,
		Name:           filepath.Base(root),
		RootPath:       metadata.CanonicalPath,
		DefaultBackend: "codex",
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	runtime := &fakeRuntime{
		getSession: core.Session{
			ID:         "sess_non_git",
			ProjectID:  syntheticProject.ID,
			BackendKey: "codex",
			Title:      "probe",
			Status:     core.SessionStateCompleted,
			UpdatedAt:  time.Now().UTC(),
		},
		getProject: syntheticProject,
		sendResult: core.Session{
			ID:        "sess_non_git",
			ProjectID: syntheticProject.ID,
			Status:    core.SessionStateRunning,
			UpdatedAt: time.Now().UTC(),
		},
	}
	manager := NewManager(workspace, map[string]Runtime{
		"codex": runtime,
	})

	updated, err := manager.SendSessionInput("sess_non_git", "follow up")
	if err != nil {
		t.Fatalf("SendSessionInput: %v", err)
	}
	if runtime.lastSendID != "sess_non_git" {
		t.Fatalf("send session id = %q, want sess_non_git", runtime.lastSendID)
	}
	if runtime.lastSendText != "follow up" {
		t.Fatalf("send text = %q, want follow up", runtime.lastSendText)
	}
	if updated.ID != "sess_non_git" {
		t.Fatalf("updated session id = %q, want sess_non_git", updated.ID)
	}
}

func TestManagerRespondToSessionApprovalRoutesByBackend(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace, "codex")
	session, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "hello",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	runtime := &fakeRuntime{
		sendResult: core.Session{
			ID:        session.ID,
			ProjectID: project.ID,
			Status:    core.SessionStateRunning,
			UpdatedAt: time.Now().UTC(),
		},
	}
	manager := NewManager(workspace, map[string]Runtime{
		"codex": runtime,
	})

	updated, err := manager.RespondToSessionApproval(session.ID, "12", core.ApprovalDecisionApprove)
	if err != nil {
		t.Fatalf("RespondToSessionApproval: %v", err)
	}
	if runtime.lastApprovalSessionID != session.ID {
		t.Fatalf("approval session id = %q", runtime.lastApprovalSessionID)
	}
	if runtime.lastApprovalID != "12" {
		t.Fatalf("approval id = %q", runtime.lastApprovalID)
	}
	if runtime.lastApprovalDecision != core.ApprovalDecisionApprove {
		t.Fatalf("approval decision = %q", runtime.lastApprovalDecision)
	}
	if updated.ID != session.ID {
		t.Fatalf("updated session id = %q", updated.ID)
	}
}

func TestManagerInterruptSessionRoutesByBackend(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace, "codex")
	session, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "hello",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	runtime := &fakeRuntime{
		sendResult: core.Session{
			ID:        session.ID,
			ProjectID: project.ID,
			Status:    core.SessionStateWaitingInput,
			UpdatedAt: time.Now().UTC(),
		},
	}
	manager := NewManager(workspace, map[string]Runtime{
		"codex": runtime,
	})

	updated, err := manager.InterruptSession(session.ID)
	if err != nil {
		t.Fatalf("InterruptSession: %v", err)
	}
	if runtime.lastInterruptID != session.ID {
		t.Fatalf("interrupt session id = %q", runtime.lastInterruptID)
	}
	if updated.ID != session.ID {
		t.Fatalf("updated session id = %q", updated.ID)
	}
}

func makeRepoRoot(t *testing.T) string {
	t.Helper()
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir repo .git: %v", err)
	}
	return root
}

func mustCreateProject(t *testing.T, workspace core.WorkspaceService, defaultBackend string) core.Project {
	t.Helper()
	root := makeRepoRoot(t)
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
