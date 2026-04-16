package codex

import (
	"os"
	"os/exec"
	"path/filepath"
	"testing"

	"orchd/internal/core"
)

type fakeCodexClient struct {
	listThreadsCalls int
	readCalls        int
	resumeCalls      int
	startThreadCalls int
	startTurnCalls   int
	steerTurnCalls   int

	readResult   *ReadThreadResult
	resumeResult *ResumeThreadResult
	readErr      error
}

func (f *fakeCodexClient) Close() error { return nil }

func (f *fakeCodexClient) ListThreads(_ string, _ uint32) (*ThreadListResult, error) {
	f.listThreadsCalls++
	return &ThreadListResult{}, nil
}

func (f *fakeCodexClient) ReadThread(_ string) (*ReadThreadResult, error) {
	f.readCalls++
	if f.readErr != nil {
		return nil, f.readErr
	}
	if f.readResult == nil {
		return &ReadThreadResult{}, nil
	}
	return f.readResult, nil
}

func (f *fakeCodexClient) ResumeThread(threadID, cwd string) (*ResumeThreadResult, error) {
	f.resumeCalls++
	if f.resumeResult != nil {
		return f.resumeResult, nil
	}
	out := &ResumeThreadResult{}
	out.Thread.ID = threadID
	out.Thread.Cwd = cwd
	return out, nil
}

func (f *fakeCodexClient) StartThread(cwd string) (*StartThreadResult, error) {
	f.startThreadCalls++
	out := &StartThreadResult{}
	out.Thread.ID = "thread-started"
	out.Thread.Cwd = cwd
	return out, nil
}

func (f *fakeCodexClient) StartTurn(_ string, _ string) (*StartTurnResult, error) {
	f.startTurnCalls++
	out := &StartTurnResult{}
	out.Turn.ID = "turn-started"
	return out, nil
}

func (f *fakeCodexClient) SteerTurn(_, _, _ string) (*StartTurnResult, error) {
	f.steerTurnCalls++
	out := &StartTurnResult{}
	out.Turn.ID = "turn-steered"
	return out, nil
}

func TestGetSessionUsesLiveClientWithoutResume(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)

	session, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	threadID := "thread-123"
	running := core.SessionStateRunning
	summary := "Sending follow-up input to Codex..."
	lastInput := "Reply with exactly FOLLOWUP"
	session, err = workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		Status:          &running,
		Summary:         &summary,
		LastInputHint:   &lastInput,
	})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	liveClient := &fakeCodexClient{
		readResult: &ReadThreadResult{
			Thread: struct {
				Turns []struct {
					ID     string "json:\"id\""
					Status string "json:\"status\""
					Items  []struct {
						Type  string "json:\"type\""
						Text  string "json:\"text\""
						Phase string "json:\"phase\""
					} "json:\"items\""
				} "json:\"turns\""
			}{
				Turns: []struct {
					ID     string "json:\"id\""
					Status string "json:\"status\""
					Items  []struct {
						Type  string "json:\"type\""
						Text  string "json:\"text\""
						Phase string "json:\"phase\""
					} "json:\"items\""
				}{
					{ID: "old-turn", Status: "completed"},
				},
			},
		},
	}

	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client:  liveClient,
		thread:  threadID,
	}

	got, gotProject, err := manager.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}

	if gotProject.ID != project.ID {
		t.Fatalf("GetSession project = %q, want %q", gotProject.ID, project.ID)
	}
	if liveClient.resumeCalls != 0 {
		t.Fatalf("ResumeThread calls = %d, want 0 for live session reads", liveClient.resumeCalls)
	}
	if liveClient.readCalls != 1 {
		t.Fatalf("ReadThread calls = %d, want 1", liveClient.readCalls)
	}
	if got.Status != core.SessionStateRunning {
		t.Fatalf("session status = %q, want %q", got.Status, core.SessionStateRunning)
	}
	if got.Summary != summary {
		t.Fatalf("session summary = %q, want %q", got.Summary, summary)
	}
	if got.LastInputHint != lastInput {
		t.Fatalf("last input hint = %q, want %q", got.LastInputHint, lastInput)
	}
}

func TestFinalSessionStateTreatsInterruptedAsWaitingInput(t *testing.T) {
	if got := finalSessionState("interrupted", core.SessionStateCompleted); got != core.SessionStateWaitingInput {
		t.Fatalf("finalSessionState(interrupted) = %q, want %q", got, core.SessionStateWaitingInput)
	}
}

func TestGetSessionFallsBackToLocalSessionWhenLiveReadIsNotReady(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)

	session, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	threadID := "thread-123"
	pending := core.SessionStatePending
	summary := "Starting Codex session..."
	session, err = workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		Status:          &pending,
		Summary:         &summary,
	})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client: &fakeCodexClient{
			readErr: errThreadNotReady{},
		},
		thread: threadID,
	}

	got, gotProject, err := manager.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if gotProject.ID != project.ID {
		t.Fatalf("GetSession project = %q, want %q", gotProject.ID, project.ID)
	}
	if got.ID != session.ID {
		t.Fatalf("session id = %q, want %q", got.ID, session.ID)
	}
	if got.Status != pending {
		t.Fatalf("session status = %q, want %q", got.Status, pending)
	}
	if got.Summary != summary {
		t.Fatalf("session summary = %q, want %q", got.Summary, summary)
	}
}

func mustCreateProject(t *testing.T, workspace core.WorkspaceService) core.Project {
	t.Helper()

	root := t.TempDir()
	writePath := filepath.Join(root, "README.md")
	if err := os.WriteFile(writePath, []byte("# probe\n"), 0o644); err != nil {
		t.Fatalf("WriteFile(%s): %v", writePath, err)
	}

	cmd := exec.Command("git", "init", "-q")
	cmd.Dir = root
	if output, err := cmd.CombinedOutput(); err != nil {
		t.Fatalf("git init: %v\n%s", err, output)
	}

	project, err := workspace.CreateProject(core.CreateProjectInput{
		Name:           "probe",
		RootPath:       root,
		DefaultBackend: "codex",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	return project
}

type errThreadNotReady struct{}

func (errThreadNotReady) Error() string {
	return "thread is not materialized yet"
}
