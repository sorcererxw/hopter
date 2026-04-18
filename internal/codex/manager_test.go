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

	"orchd/internal/core"
)

type fakeCodexClient struct {
	listThreadsCalls int
	readCalls        int
	resumeCalls      int
	startThreadCalls int
	startTurnCalls   int
	steerTurnCalls   int
	interruptTurnCalls []string

	readResult   *ReadThreadResult
	resumeResult *ResumeThreadResult
	readErr      error
	respondApprovalCalls []string
}

type fakeEventSink struct {
	events []core.Event
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

func (f *fakeCodexClient) RespondToApproval(rawID json.RawMessage, decision string) error {
	f.respondApprovalCalls = append(f.respondApprovalCalls, string(rawID)+":"+decision)
	return nil
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

func (f *fakeCodexClient) InterruptTurn(threadID, turnID string) error {
	f.interruptTurnCalls = append(f.interruptTurnCalls, threadID+":"+turnID)
	return nil
}

func (f *fakeEventSink) Publish(event core.Event) {
	f.events = append(f.events, event)
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

func TestCreateSessionRunsThroughAppServerAndUpdatesSession(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)

	client := &fakeCodexClient{
		readResult: readThreadResultWithTurns(
			ReadThreadTurn{
				ID:     "turn-started",
				Status: "completed",
				Items: []ReadThreadItem{
					{
						Type:    "userMessage",
						ID:      "user-1",
						Content: json.RawMessage(`[{"type":"text","text":"build something"}]`),
					},
					{
						Type:  "agentMessage",
						ID:    "agent-1",
						Text:  "Implemented from app-server path.",
						Phase: "completed",
					},
				},
			},
		),
	}

	manager := NewManager(workspace)
	manager.start = func(
		_ context.Context,
		_ string,
		_ func(Notification),
		_ func(ServerRequest),
		_ func(TraceEntry),
		_ func(),
	) (codexClient, error) {
		return client, nil
	}

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
			current.BackendThreadID == "thread-started" &&
			current.Status == core.SessionStateCompleted &&
			current.Summary == "Implemented from app-server path." &&
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
	if current.TranscriptItems[1].Body != "Implemented from app-server path." {
		t.Fatalf("second transcript body = %q", current.TranscriptItems[1].Body)
	}

	if client.startThreadCalls != 1 {
		t.Fatalf("StartThread calls = %d, want 1", client.startThreadCalls)
	}
	if client.startTurnCalls != 1 {
		t.Fatalf("StartTurn calls = %d, want 1", client.startTurnCalls)
	}
}

func TestSendSessionInputRunsThroughAppServerWithExistingThread(t *testing.T) {
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

	client := &fakeCodexClient{
		readResult: readThreadResultWithTurns(
			ReadThreadTurn{
				ID:     "turn-started",
				Status: "completed",
				Items: []ReadThreadItem{
					{
						Type:    "userMessage",
						ID:      "user-1",
						Content: json.RawMessage(`[{"type":"text","text":"follow up"}]`),
					},
					{
						Type:  "agentMessage",
						ID:    "msg-2",
						Text:  "Follow-up handled.",
						Phase: "completed",
					},
					{
						Type:             "commandExecution",
						ID:               "cmd-1",
						Command:          "git status",
						AggregatedOutput: "On branch master",
						Status:           "completed",
					},
				},
			},
		),
	}

	manager := NewManager(workspace)
	manager.start = func(
		_ context.Context,
		_ string,
		_ func(Notification),
		_ func(ServerRequest),
		_ func(TraceEntry),
		_ func(),
	) (codexClient, error) {
		return client, nil
	}

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

	if client.resumeCalls != 1 {
		t.Fatalf("ResumeThread calls = %d, want 1", client.resumeCalls)
	}
	if client.startTurnCalls != 1 {
		t.Fatalf("StartTurn calls = %d, want 1", client.startTurnCalls)
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

func TestHandleNotificationPublishesDraftDeltaPatch(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	sink := &fakeEventSink{}
	manager := NewManager(workspace, sink)
	manager.live["session-1"] = &liveSession{
		project: project,
		thread:  "thread-1",
		active:  "turn-1",
	}

	manager.handleNotification("session-1", Notification{
		Method: "item/agentMessage/delta",
		Params: json.RawMessage(`{"threadId":"thread-1","turnId":"turn-1","itemId":"msg-1","delta":"Hello"}`),
	})

	if len(sink.events) != 1 {
		t.Fatalf("published events = %d, want 1", len(sink.events))
	}
	patch := sink.events[0].LivePatch
	if patch == nil {
		t.Fatalf("live patch = nil")
	}
	if patch.Kind != core.SessionLivePatchKindDraftDelta {
		t.Fatalf("patch kind = %q", patch.Kind)
	}
	if patch.DraftItemID != "msg-1" {
		t.Fatalf("draft item id = %q", patch.DraftItemID)
	}
	if patch.DraftDelta != "Hello" {
		t.Fatalf("draft delta = %q", patch.DraftDelta)
	}

	live := manager.live["session-1"]
	if live.draftText != "Hello" {
		t.Fatalf("live draft text = %q", live.draftText)
	}
}

func TestSessionFromLiveRawAppendsDraftTranscriptItem(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	manager := NewManager(workspace)
	live := &liveSession{
		project:     project,
		thread:      "thread-raw",
		record:      ThreadRecord{ID: "thread-raw", Preview: "preview", Cwd: project.RootPath},
		draftItemID: "msg-draft",
		draftText:   "streaming draft",
	}

	session := manager.sessionFromLiveRaw("thread-raw", live, readThreadResultWithTurns())
	if len(session.TranscriptItems) != 1 {
		t.Fatalf("transcript items = %d, want 1", len(session.TranscriptItems))
	}
	if session.TranscriptItems[0].ID != "msg-draft" {
		t.Fatalf("draft item id = %q", session.TranscriptItems[0].ID)
	}
	if session.TranscriptItems[0].Body != "streaming draft" {
		t.Fatalf("draft body = %q", session.TranscriptItems[0].Body)
	}
	if session.TranscriptItems[0].Status != "streaming" {
		t.Fatalf("draft status = %q", session.TranscriptItems[0].Status)
	}
}

func TestRespondToSessionApprovalUsesOriginalRequestIdentity(t *testing.T) {
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

	client := &fakeCodexClient{}
	client.readResult = readThreadResultWithTurns(
		ReadThreadTurn{ID: "turn-1", Status: "inProgress"},
	)
	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client:  client,
		thread:  "thread-1",
		active:  "turn-1",
		pendingApproval: &pendingApproval{
			ID:      "12",
			RawID:   json.RawMessage(`12`),
			Method:  "item/commandExecution/requestApproval",
			Message: "Codex needs approval to run a command.",
		},
	}

	approvalID := "12"
	waiting := core.SessionStateWaitingApproval
	attention := true
	reason := "Codex needs approval to run a command."
	if _, err := workspace.UpdateSession(session.ID, core.SessionPatch{
		PendingApprovalID: &approvalID,
		Status:            &waiting,
		AttentionRequired: &attention,
		AttentionReason:   &reason,
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	updated, err := manager.RespondToSessionApproval(session.ID, "12", core.ApprovalDecisionApprove)
	if err != nil {
		t.Fatalf("RespondToSessionApproval: %v", err)
	}
	if len(client.respondApprovalCalls) != 1 {
		t.Fatalf("respond approval calls = %d, want 1", len(client.respondApprovalCalls))
	}
	if client.respondApprovalCalls[0] != `12:approve` {
		t.Fatalf("respond approval call = %q", client.respondApprovalCalls[0])
	}
	if updated.PendingApprovalID != "" {
		t.Fatalf("pending approval id = %q, want empty", updated.PendingApprovalID)
	}
	if updated.Status != core.SessionStateRunning {
		t.Fatalf("status = %q, want %q", updated.Status, core.SessionStateRunning)
	}
}

func TestInterruptSessionUsesActiveTurnAndClearsState(t *testing.T) {
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

	threadID := "thread-1"
	turnID := "turn-1"
	running := core.SessionStateRunning
	summary := "Codex is working…"
	if _, err := workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		ActiveTurnID:    &turnID,
		Status:          &running,
		Summary:         &summary,
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	client := &fakeCodexClient{}
	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client:  client,
		thread:  threadID,
		active:  turnID,
	}

	updated, err := manager.InterruptSession(session.ID)
	if err != nil {
		t.Fatalf("InterruptSession: %v", err)
	}
	if len(client.interruptTurnCalls) != 1 {
		t.Fatalf("interrupt turn calls = %d, want 1", len(client.interruptTurnCalls))
	}
	if client.interruptTurnCalls[0] != "thread-1:turn-1" {
		t.Fatalf("interrupt turn call = %q", client.interruptTurnCalls[0])
	}
	if updated.Status != core.SessionStateWaitingInput {
		t.Fatalf("status = %q, want %q", updated.Status, core.SessionStateWaitingInput)
	}
	if updated.ActiveTurnID != "" {
		t.Fatalf("active turn id = %q, want empty", updated.ActiveTurnID)
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
