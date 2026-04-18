package codex

import (
	"context"
	"encoding/json"
	"os"
	"os/exec"
	"path/filepath"
	"strings"
	"testing"
	"time"

	codexsdk "orchd/internal/codex/sdk"
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

type fakeTurnExecutor struct {
	runCalls []fakeTurnCall
	runFn    func(ctx context.Context, project core.Project, threadID string, input string, onEvent func(codexsdk.Event)) (string, error)
}

type fakeTurnCall struct {
	Project  core.Project
	ThreadID string
	Input    string
}

func readThreadResultWithTurns(turns ...ReadThreadTurn) *ReadThreadResult {
	result := &ReadThreadResult{}
	result.Thread.Turns = turns
	return result
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

func (f *fakeCodexClient) ReadThreadMeta(_ string) (*ReadThreadResult, error) {
	return f.ReadThread("")
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

func (f *fakeTurnExecutor) Run(ctx context.Context, project core.Project, threadID string, input string, onEvent func(codexsdk.Event)) (string, error) {
	f.runCalls = append(f.runCalls, fakeTurnCall{
		Project:  project,
		ThreadID: threadID,
		Input:    input,
	})
	if f.runFn != nil {
		return f.runFn(ctx, project, threadID, input, onEvent)
	}
	return threadID, nil
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
		readResult: readThreadResultWithTurns(
			ReadThreadTurn{ID: "old-turn", Status: "completed"},
		),
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

func TestCreateSessionRunsThroughTurnExecutorAndUpdatesSession(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)

	executor := &fakeTurnExecutor{
		runFn: func(_ context.Context, _ core.Project, _ string, _ string, onEvent func(codexsdk.Event)) (string, error) {
			onEvent(&codexsdk.ThreadStartedEvent{ThreadID: "thread-sdk"})
			onEvent(&codexsdk.ItemCompletedEvent{
				Item: &codexsdk.AgentMessageItem{ID: "msg-1", Text: "Implemented from SDK path."},
			})
			onEvent(&codexsdk.TurnCompletedEvent{
				Usage: codexsdk.Usage{InputTokens: 1, CachedInputTokens: 0, OutputTokens: 1},
			})
			return "thread-sdk", nil
		},
	}

	manager := NewManager(workspace)
	manager.execTurns = executor

	session, err := manager.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "build something",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	waitFor(t, func() bool {
		current, ok := workspace.GetSession(session.ID)
		return ok &&
			current.BackendThreadID == "thread-sdk" &&
			current.Status == core.SessionStateCompleted &&
			current.Summary == "Implemented from SDK path." &&
			len(current.TranscriptItems) == 2
	})

	current, _ := workspace.GetSession(session.ID)
	if current.TranscriptItems[0].Kind != core.SessionTranscriptItemKindUserMessage {
		t.Fatalf("first transcript kind = %q", current.TranscriptItems[0].Kind)
	}
	if current.TranscriptItems[0].Body != "build something" {
		t.Fatalf("first transcript body = %q", current.TranscriptItems[0].Body)
	}
	if current.TranscriptItems[1].Kind != core.SessionTranscriptItemKindAgentMessage {
		t.Fatalf("second transcript kind = %q", current.TranscriptItems[1].Kind)
	}
	if current.TranscriptItems[1].Body != "Implemented from SDK path." {
		t.Fatalf("second transcript body = %q", current.TranscriptItems[1].Body)
	}

	if len(executor.runCalls) != 1 {
		t.Fatalf("runCalls = %d, want 1", len(executor.runCalls))
	}
	if executor.runCalls[0].ThreadID != "" {
		t.Fatalf("thread id = %q, want empty for new session", executor.runCalls[0].ThreadID)
	}
	if executor.runCalls[0].Input != "build something" {
		t.Fatalf("input = %q", executor.runCalls[0].Input)
	}
}

func TestSendSessionInputRunsThroughTurnExecutorWithExistingThread(t *testing.T) {
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

	threadID := "thread-existing"
	completed := core.SessionStateCompleted
	summary := "ready"
	session, err = workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		Status:          &completed,
		Summary:         &summary,
	})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	executor := &fakeTurnExecutor{
		runFn: func(_ context.Context, _ core.Project, threadID string, input string, onEvent func(codexsdk.Event)) (string, error) {
			if threadID != "thread-existing" {
				t.Fatalf("threadID = %q, want thread-existing", threadID)
			}
			if input != "follow up" {
				t.Fatalf("input = %q, want follow up", input)
			}
			onEvent(&codexsdk.ItemCompletedEvent{
				Item: &codexsdk.AgentMessageItem{ID: "msg-2", Text: "Follow-up handled."},
			})
			onEvent(&codexsdk.ItemCompletedEvent{
				Item: &codexsdk.CommandExecutionItem{
					ID:               "cmd-1",
					Command:          "git status",
					AggregatedOutput: "On branch master",
					Status:           "completed",
				},
			})
			onEvent(&codexsdk.TurnCompletedEvent{
				Usage: codexsdk.Usage{InputTokens: 1, CachedInputTokens: 0, OutputTokens: 1},
			})
			return threadID, nil
		},
	}

	manager := NewManager(workspace)
	manager.execTurns = executor

	updated, err := manager.SendSessionInput(session.ID, "follow up")
	if err != nil {
		t.Fatalf("SendSessionInput: %v", err)
	}
	if updated.LastInputHint != "follow up" {
		t.Fatalf("updated last input = %q", updated.LastInputHint)
	}

	waitFor(t, func() bool {
		current, ok := workspace.GetSession(session.ID)
		return ok &&
			current.Status == core.SessionStateCompleted &&
			current.Summary == "Follow-up handled." &&
			current.LastInputHint == "follow up" &&
			len(current.TranscriptItems) == 3
	})

	current, _ := workspace.GetSession(session.ID)
	if current.TranscriptItems[0].Kind != core.SessionTranscriptItemKindUserMessage {
		t.Fatalf("first transcript kind = %q", current.TranscriptItems[0].Kind)
	}
	if current.TranscriptItems[1].Kind != core.SessionTranscriptItemKindAgentMessage {
		t.Fatalf("second transcript kind = %q", current.TranscriptItems[1].Kind)
	}
	if current.TranscriptItems[2].Kind != core.SessionTranscriptItemKindCommandExecution {
		t.Fatalf("third transcript kind = %q", current.TranscriptItems[2].Kind)
	}
	if !strings.Contains(current.TranscriptItems[2].Body, "git status") {
		t.Fatalf("command transcript body = %q", current.TranscriptItems[2].Body)
	}

	if len(executor.runCalls) != 1 {
		t.Fatalf("runCalls = %d, want 1", len(executor.runCalls))
	}
}

func TestGetSessionIncludesTranscriptItems(t *testing.T) {
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
	completed := core.SessionStateCompleted
	session, err = workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		Status:          &completed,
	})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client: &fakeCodexClient{
			readResult: readThreadResultWithTurns(
				ReadThreadTurn{
					ID:     "turn-1",
					Status: "completed",
					Items: []ReadThreadItem{
						{
							Type:    "userMessage",
							ID:      "user-1",
							Content: json.RawMessage(`[{"type":"text","text":"Build a snake game"}]`),
						},
						{
							Type:    "reasoning",
							ID:      "reasoning-1",
							Summary: json.RawMessage(`[{"text":"Inspecting existing files"}]`),
						},
						{
							Type:      "mcpToolCall",
							ID:        "tool-1",
							Server:    "functions",
							Tool:      "exec_command",
							Status:    "completed",
							Arguments: json.RawMessage(`{"cmd":"rg --files"}`),
							Result:    json.RawMessage(`{"exit_code":0}`),
						},
						{
							Type:             "agentMessage",
							ID:               "agent-1",
							Text:             "Implemented the first pass.",
							Phase:            "completed",
							AggregatedOutput: "ignored",
						},
					},
				},
			),
		},
		thread: threadID,
	}

	got, _, err := manager.GetSession(session.ID)
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}

	if len(got.TranscriptItems) != 4 {
		t.Fatalf("transcript items = %d, want 4", len(got.TranscriptItems))
	}
	if got.TranscriptItems[0].Kind != core.SessionTranscriptItemKindUserMessage {
		t.Fatalf("first transcript kind = %q", got.TranscriptItems[0].Kind)
	}
	if got.TranscriptItems[1].Kind != core.SessionTranscriptItemKindReasoning {
		t.Fatalf("second transcript kind = %q", got.TranscriptItems[1].Kind)
	}
	if got.TranscriptItems[2].Kind != core.SessionTranscriptItemKindToolCall {
		t.Fatalf("third transcript kind = %q", got.TranscriptItems[2].Kind)
	}
	if got.TranscriptItems[3].Kind != core.SessionTranscriptItemKindAgentMessage {
		t.Fatalf("fourth transcript kind = %q", got.TranscriptItems[3].Kind)
	}
	if got.TranscriptItems[2].Title != "Tool functions.exec_command" {
		t.Fatalf("tool call title = %q", got.TranscriptItems[2].Title)
	}
	if got.Summary != "Implemented the first pass." {
		t.Fatalf("summary = %q", got.Summary)
	}
}

func TestNormalizeTranscriptItemsPreservesChronologicalReadOrder(t *testing.T) {
	read := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:    "userMessage",
					ID:      "user-1",
					Content: json.RawMessage(`[{"type":"text","text":"first"}]`),
				},
				{
					Type:  "agentMessage",
					ID:    "agent-1",
					Text:  "earliest reply",
					Phase: "completed",
				},
			},
		},
		ReadThreadTurn{
			ID:     "turn-2",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:    "userMessage",
					ID:      "user-2",
					Content: json.RawMessage(`[{"type":"text","text":"second"}]`),
				},
				{
					Type:  "agentMessage",
					ID:    "agent-2",
					Text:  "latest reply",
					Phase: "completed",
				},
			},
		},
	)

	got := normalizeTranscriptItems(read)
	if len(got) != 4 {
		t.Fatalf("transcript items = %d, want 4", len(got))
	}

	wantBodies := []string{"first", "earliest reply", "second", "latest reply"}
	for i, want := range wantBodies {
		if got[i].Body != want {
			t.Fatalf("transcript item %d body = %q, want %q", i, got[i].Body, want)
		}
	}
}

func TestLatestDerivedValuesUseMostRecentChronologicalTurn(t *testing.T) {
	read := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "failed",
			Items: []ReadThreadItem{
				{
					Type:  "agentMessage",
					ID:    "agent-1",
					Text:  "earliest reply",
					Phase: "failed",
				},
			},
		},
		ReadThreadTurn{
			ID:     "turn-2",
			Status: "inProgress",
			Items: []ReadThreadItem{
				{
					Type:  "agentMessage",
					ID:    "agent-2",
					Text:  "latest reply",
					Phase: "in_progress",
				},
			},
		},
	)

	if got := latestAgentSummary(read); got != "latest reply" {
		t.Fatalf("latestAgentSummary = %q, want %q", got, "latest reply")
	}
	if got := latestActiveTurnID(read); got != "turn-2" {
		t.Fatalf("latestActiveTurnID = %q, want %q", got, "turn-2")
	}
	if got := latestTurnStatus(read, "turn-2"); got != "inProgress" {
		t.Fatalf("latestTurnStatus(turn-2) = %q, want %q", got, "inProgress")
	}
	if got := latestTerminalTurnStatus(read); got != "failed" {
		t.Fatalf("latestTerminalTurnStatus = %q, want %q", got, "failed")
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

func TestGetSessionUsesLiveRawThreadStateForRemoteThreadIDs(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)

	manager := NewManager(workspace)
	manager.live["thread-remote"] = &liveSession{
		project: project,
		client: &fakeCodexClient{
			readResult: readThreadResultWithTurns(
				ReadThreadTurn{ID: "old-turn", Status: "completed"},
			),
		},
		thread:              "thread-remote",
		active:              "turn-new",
		record:              ThreadRecord{ID: "thread-remote", Preview: "old preview", Cwd: project.RootPath},
		optimisticSummary:   "Codex is processing the latest input…",
		optimisticLastInput: "目前依旧无法顺利发送",
		optimisticStatus:    core.SessionStateRunning,
	}

	got, gotProject, err := manager.GetSession("thread-remote")
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}
	if gotProject.ID != project.ID {
		t.Fatalf("GetSession project = %q, want %q", gotProject.ID, project.ID)
	}
	if got.ID != "thread-remote" {
		t.Fatalf("session id = %q, want %q", got.ID, "thread-remote")
	}
	if got.Status != core.SessionStateRunning {
		t.Fatalf("session status = %q, want %q", got.Status, core.SessionStateRunning)
	}
	if got.Summary != "Codex is processing the latest input…" {
		t.Fatalf("session summary = %q", got.Summary)
	}
	if got.LastInputHint != "目前依旧无法顺利发送" {
		t.Fatalf("last input hint = %q", got.LastInputHint)
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

func waitFor(t *testing.T, condition func() bool) {
	t.Helper()
	deadline := time.Now().Add(2 * time.Second)
	for time.Now().Before(deadline) {
		if condition() {
			return
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("condition not met before timeout")
}
