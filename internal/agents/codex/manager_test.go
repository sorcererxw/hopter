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

	"github.com/pmenglund/codex-sdk-go/protocol"
	"github.com/sorcererxw/hopter/internal/core"
)

type fakeCodexClient struct {
	listThreadsCalls   int
	readCalls          int
	listTurnCalls      int
	resumeCalls        int
	rollbackCalls      []int
	startThreadCalls   int
	startTurnCalls     int
	steerTurnCalls     int
	interruptTurnCalls []string

	listResult           *ThreadListResult
	turnListResults      []*ThreadTurnsListResult
	turnListErr          error
	turnListParams       []ThreadTurnsListParams
	readResult           *ReadThreadResult
	readResults          []*ReadThreadResult
	listModelsResult     *ModelListResult
	resumeResult         *ResumeThreadResult
	readErr              error
	respondApprovalCalls []string
	startThreadOptions   []core.SessionTurnOptions
	startTurnOptions     []core.SessionTurnOptions
	startTurnInputs      []string
	resumeOptions        []core.SessionTurnOptions
	steerTurnOptions     []core.SessionTurnOptions
}

type fakeEventSink struct {
	events []core.Event
}

func readThreadResultWithTurns(turns ...ReadThreadTurn) *ReadThreadResult {
	result := &ReadThreadResult{}
	result.Thread.Turns = turns
	return result
}

func agentMessageTurn(id string, text string) ReadThreadTurn {
	return ReadThreadTurn{
		ID:     id,
		Status: "completed",
		Items: []ReadThreadItem{
			{
				Type:  "agentMessage",
				ID:    id + "-agent",
				Text:  text,
				Phase: "final_answer",
			},
		},
	}
}

func (f *fakeCodexClient) Close() error { return nil }

func (f *fakeCodexClient) ReadAccountRateLimits() (string, error) {
	return "", nil
}

func (f *fakeCodexClient) ListThreads(_ string, _ uint32) (*ThreadListResult, error) {
	f.listThreadsCalls++
	if f.listResult != nil {
		return f.listResult, nil
	}
	return &ThreadListResult{}, nil
}

func (f *fakeCodexClient) ReadThread(_ string) (*ReadThreadResult, error) {
	f.readCalls++
	if f.readErr != nil {
		return nil, f.readErr
	}
	if len(f.readResults) > 0 {
		index := f.readCalls - 1
		if index >= len(f.readResults) {
			index = len(f.readResults) - 1
		}
		return f.readResults[index], nil
	}
	if f.readResult == nil {
		return &ReadThreadResult{}, nil
	}
	return f.readResult, nil
}

func (f *fakeCodexClient) ReadThreadMeta(_ string) (*ReadThreadResult, error) {
	return f.ReadThread("")
}

func (f *fakeCodexClient) ListThreadTurns(params ThreadTurnsListParams) (*ThreadTurnsListResult, error) {
	f.listTurnCalls++
	f.turnListParams = append(f.turnListParams, params)
	if f.turnListErr != nil {
		return nil, f.turnListErr
	}
	if len(f.turnListResults) > 0 {
		index := f.listTurnCalls - 1
		if index >= len(f.turnListResults) {
			index = len(f.turnListResults) - 1
		}
		return f.turnListResults[index], nil
	}
	return &ThreadTurnsListResult{}, nil
}

func (f *fakeCodexClient) ResumeThread(threadID, cwd string, options core.SessionTurnOptions) (*ResumeThreadResult, error) {
	f.resumeCalls++
	f.resumeOptions = append(f.resumeOptions, options)
	if f.resumeResult != nil {
		return f.resumeResult, nil
	}
	out := &ResumeThreadResult{}
	out.Thread.ID = threadID
	out.Thread.Cwd = cwd
	return out, nil
}

func (f *fakeCodexClient) RollbackThread(threadID string, numTurns int) (*RollbackThreadResult, error) {
	f.rollbackCalls = append(f.rollbackCalls, numTurns)
	out := &RollbackThreadResult{}
	out.Thread.ID = threadID
	return out, nil
}

func (f *fakeCodexClient) RespondToApproval(rawID json.RawMessage, result any) error {
	encoded, err := json.Marshal(result)
	if err != nil {
		return err
	}
	f.respondApprovalCalls = append(f.respondApprovalCalls, string(rawID)+":"+string(encoded))
	return nil
}

func (f *fakeCodexClient) StartThread(cwd string, options core.SessionTurnOptions) (*StartThreadResult, error) {
	f.startThreadCalls++
	f.startThreadOptions = append(f.startThreadOptions, options)
	out := &StartThreadResult{}
	out.Thread.ID = "thread-started"
	out.Thread.Cwd = cwd
	return out, nil
}

func (f *fakeCodexClient) StartTurn(_ string, text string, options core.SessionTurnOptions) (*StartTurnResult, error) {
	f.startTurnCalls++
	f.startTurnOptions = append(f.startTurnOptions, options)
	f.startTurnInputs = append(f.startTurnInputs, text)
	out := &StartTurnResult{}
	out.Turn.ID = "turn-started"
	return out, nil
}

func (f *fakeCodexClient) SteerTurn(_, _, _ string, options core.SessionTurnOptions) (*StartTurnResult, error) {
	f.steerTurnCalls++
	f.steerTurnOptions = append(f.steerTurnOptions, options)
	out := &StartTurnResult{}
	out.Turn.ID = "turn-steered"
	return out, nil
}

func (f *fakeCodexClient) InterruptTurn(threadID, turnID string) error {
	f.interruptTurnCalls = append(f.interruptTurnCalls, threadID+":"+turnID)
	return nil
}

func (f *fakeCodexClient) ListModels(bool) (*ModelListResult, error) {
	if f.listModelsResult != nil {
		return f.listModelsResult, nil
	}
	return &ModelListResult{}, nil
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
	if session.ID != "thread-started" {
		t.Fatalf("created session id = %q, want real thread id", session.ID)
	}
	if session.BackendThreadID != "thread-started" {
		t.Fatalf("created backend thread id = %q, want thread-started", session.BackendThreadID)
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

func TestListModelsReturnsAppServerModels(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	_ = mustCreateProject(t, workspace)
	client := &fakeCodexClient{
		listModelsResult: &ModelListResult{
			Data: []ModelRecord{
				{
					ID:                     "gpt-5.4",
					Model:                  "gpt-5.4",
					DisplayName:            "gpt-5.4",
					Description:            "Latest frontier agentic coding model.",
					IsDefault:              true,
					DefaultReasoningEffort: "medium",
					SupportedReasoningEfforts: []ModelReasoningEffortRecord{
						{ReasoningEffort: "medium", Description: "Balanced"},
						{ReasoningEffort: "xhigh", Description: "Extra high"},
					},
					InputModalities: []string{"text", "image"},
				},
			},
		},
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

	models, err := manager.ListModels(false)
	if err != nil {
		t.Fatalf("ListModels: %v", err)
	}
	if len(models) != 1 {
		t.Fatalf("model count = %d, want 1", len(models))
	}
	if models[0].Model != "gpt-5.4" {
		t.Fatalf("model = %q, want gpt-5.4", models[0].Model)
	}
	if models[0].DefaultReasoningEffort != "medium" {
		t.Fatalf("default reasoning effort = %q, want medium", models[0].DefaultReasoningEffort)
	}
	if len(models[0].SupportedReasoningEfforts) != 2 {
		t.Fatalf("reasoning effort count = %d, want 2", len(models[0].SupportedReasoningEfforts))
	}
	if models[0].SupportedReasoningEfforts[1].ReasoningEffort != "xhigh" {
		t.Fatalf("second reasoning effort = %q, want xhigh", models[0].SupportedReasoningEfforts[1].ReasoningEffort)
	}
}

func TestCreateSessionPassesModelAndReasoningToAppServer(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	client := &fakeCodexClient{
		readResult: readThreadResultWithTurns(ReadThreadTurn{
			ID:     "turn-started",
			Status: "completed",
		}),
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
		ProjectID:       project.ID,
		Title:           "probe",
		Prompt:          "build something",
		Model:           "gpt-5.4",
		ReasoningEffort: "xhigh",
		CodexFastMode:   true,
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	waitFor(t, func() bool {
		current, ok := workspace.GetSession(session.ID)
		return ok && current.Status == core.SessionStateCompleted
	})
	if len(client.startThreadOptions) != 1 {
		t.Fatalf("start thread options count = %d, want 1", len(client.startThreadOptions))
	}
	if client.startThreadOptions[0].Model != "gpt-5.4" {
		t.Fatalf("start thread model = %q, want gpt-5.4", client.startThreadOptions[0].Model)
	}
	if !client.startThreadOptions[0].CodexFastMode {
		t.Fatal("start thread fast mode = false, want true")
	}
	if len(client.startTurnOptions) != 1 {
		t.Fatalf("start turn options count = %d, want 1", len(client.startTurnOptions))
	}
	if client.startTurnOptions[0].Model != "gpt-5.4" {
		t.Fatalf("start turn model = %q, want gpt-5.4", client.startTurnOptions[0].Model)
	}
	if client.startTurnOptions[0].ReasoningEffort != "xhigh" {
		t.Fatalf("start turn reasoning effort = %q, want xhigh", client.startTurnOptions[0].ReasoningEffort)
	}
	if !client.startTurnOptions[0].CodexFastMode {
		t.Fatal("start turn fast mode = false, want true")
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

	updated, err := manager.SendSessionInput(session.ID, "follow up", core.SessionTurnOptions{
		Attachments: []core.SessionInputAttachment{
			{
				Label:       "screen.png",
				URL:         "data:image/png;base64,abc123",
				ContentType: "image/png",
			},
		},
	})
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
	if len(client.startTurnOptions) != 1 {
		t.Fatalf("start turn options = %d, want 1", len(client.startTurnOptions))
	}
	if len(client.startTurnOptions[0].Attachments) != 1 {
		t.Fatalf("start turn attachments = %d, want 1", len(client.startTurnOptions[0].Attachments))
	}
	if client.startTurnOptions[0].Attachments[0].URL != "data:image/png;base64,abc123" {
		t.Fatalf("start turn attachment url = %q", client.startTurnOptions[0].Attachments[0].URL)
	}
}

func TestSendSessionInputQueueModeWaitsForActiveTurn(t *testing.T) {
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
	activeTurnID := "turn-active"
	running := core.SessionStateRunning
	session, err = workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		ActiveTurnID:    &activeTurnID,
		Status:          &running,
	})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	client := &fakeCodexClient{
		readResult: readThreadResultWithTurns(ReadThreadTurn{
			ID:     "turn-started",
			Status: "completed",
		}),
	}
	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client:  client,
		thread:  threadID,
		active:  activeTurnID,
	}

	if _, err := manager.SendSessionInput(session.ID, "queued follow-up", core.SessionTurnOptions{
		InputMode:       core.SessionInputModeQueue,
		Model:           "gpt-5.4",
		ReasoningEffort: "high",
	}); err != nil {
		t.Fatalf("SendSessionInput: %v", err)
	}
	if client.startTurnCalls != 0 {
		t.Fatalf("StartTurn calls after enqueue = %d, want 0", client.startTurnCalls)
	}
	if client.steerTurnCalls != 0 {
		t.Fatalf("SteerTurn calls after enqueue = %d, want 0", client.steerTurnCalls)
	}

	queued, err := manager.ListSessionQueue(session.ID)
	if err != nil {
		t.Fatalf("ListSessionQueue: %v", err)
	}
	if len(queued) != 1 {
		t.Fatalf("queued items = %d, want 1", len(queued))
	}
	if queued[0].Preview != "queued follow-up" {
		t.Fatalf("queued preview = %q", queued[0].Preview)
	}
	if queued[0].Model != "gpt-5.4" {
		t.Fatalf("queued model = %q", queued[0].Model)
	}

	manager.handleNotification(session.ID, Notification{
		Method: "turn/completed",
		Params: json.RawMessage(`{"turn":{"id":"turn-active","status":"completed"}}`),
	})

	waitFor(t, func() bool {
		return client.startTurnCalls == 1 && len(client.startTurnInputs) == 1
	})
	if client.startTurnInputs[0] != "queued follow-up" {
		t.Fatalf("started queued input = %q", client.startTurnInputs[0])
	}

	queued, err = manager.ListSessionQueue(session.ID)
	if err != nil {
		t.Fatalf("ListSessionQueue after dispatch: %v", err)
	}
	if len(queued) != 0 {
		t.Fatalf("queued items after dispatch = %d, want 0", len(queued))
	}
}

func TestRollbackSessionInputDropsTargetTurnAndStartsEditedTurn(t *testing.T) {
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
	session, err = workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		Status:          &completed,
	})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	beforeRollback := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "completed",
			Items: []ReadThreadItem{{
				Type:    "userMessage",
				ID:      "user-1",
				Content: json.RawMessage(`[{"type":"text","text":"first"}]`),
			}},
		},
		ReadThreadTurn{
			ID:     "turn-2",
			Status: "completed",
			Items: []ReadThreadItem{{
				Type:    "userMessage",
				ID:      "user-2",
				Content: json.RawMessage(`[{"type":"text","text":"original"}]`),
			}},
		},
		ReadThreadTurn{
			ID:     "turn-3",
			Status: "completed",
			Items: []ReadThreadItem{{
				Type: "agentMessage",
				ID:   "agent-3",
				Text: "old answer",
			}},
		},
	)
	afterEditedTurn := readThreadResultWithTurns(
		beforeRollback.Thread.Turns[0],
		ReadThreadTurn{
			ID:     "turn-started",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:    "userMessage",
					ID:      "user-edited",
					Content: json.RawMessage(`[{"type":"text","text":"edited"}]`),
				},
				{
					Type: "agentMessage",
					ID:   "agent-edited",
					Text: "edited answer",
				},
			},
		},
	)
	client := &fakeCodexClient{
		readResults: []*ReadThreadResult{beforeRollback, beforeRollback, afterEditedTurn},
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

	result, err := manager.RollbackSessionInput(
		session.ID,
		core.SessionRollbackTarget{TranscriptItemID: "user-2"},
		"edited",
		core.SessionTurnOptions{Model: "gpt-5.4"},
	)
	if err != nil {
		t.Fatalf("RollbackSessionInput: %v", err)
	}
	if result.DroppedTurnCount != 2 {
		t.Fatalf("dropped turn count = %d, want 2", result.DroppedTurnCount)
	}
	if len(client.rollbackCalls) != 1 || client.rollbackCalls[0] != 2 {
		t.Fatalf("rollback calls = %#v, want [2]", client.rollbackCalls)
	}

	waitFor(t, func() bool {
		return client.startTurnCalls == 1 && client.readCalls >= 2
	})
	if client.startTurnInputs[0] != "edited" {
		t.Fatalf("start turn input = %q", client.startTurnInputs[0])
	}
	if client.startTurnOptions[0].Model != "gpt-5.4" {
		t.Fatalf("start turn model = %q", client.startTurnOptions[0].Model)
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

func TestHandleReasoningItemCompletedPreservesCodexSourcedProgress(t *testing.T) {
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

	sink := &fakeEventSink{}
	manager := NewManager(workspace, sink)
	manager.live[session.ID] = &liveSession{
		project: project,
		thread:  "thread-1",
		active:  "turn-1",
	}

	manager.handleNotification(session.ID, Notification{
		Method: "item/completed",
		Params: json.RawMessage(`{
			"item": {
				"id": "reasoning-1",
				"type": "reasoning",
				"summary": [],
				"content": []
			}
		}`),
	})

	current, ok := workspace.GetSession(session.ID)
	if !ok {
		t.Fatalf("session %q not found", session.ID)
	}
	if len(current.TranscriptItems) != 1 {
		t.Fatalf("stored transcript items = %d, want 1", len(current.TranscriptItems))
	}
	if current.TranscriptItems[0].Kind != core.SessionTranscriptItemKindReasoning {
		t.Fatalf("stored item kind = %q", current.TranscriptItems[0].Kind)
	}
	if current.TranscriptItems[0].Body != reasoningProgressBody {
		t.Fatalf("stored reasoning body = %q, want %q", current.TranscriptItems[0].Body, reasoningProgressBody)
	}
	if current.TranscriptItems[0].DisplayBody != "" {
		t.Fatalf("stored raw reasoning = %q, want empty", current.TranscriptItems[0].DisplayBody)
	}

	if len(sink.events) < 1 {
		t.Fatalf("published events = %d, want at least 1", len(sink.events))
	}
	patch := sink.events[len(sink.events)-1].LivePatch
	if patch == nil || patch.FinalItem == nil {
		t.Fatalf("reasoning final patch missing: %#v", patch)
	}
	if patch.FinalItem.Kind != core.SessionTranscriptItemKindReasoning {
		t.Fatalf("final patch item kind = %q", patch.FinalItem.Kind)
	}
}

func TestSessionReadModelPreservesEmittedReasoningWhenThreadReadOmitsIt(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	threadID := "thread-1"
	session, err := workspace.CreateSession(core.CreateSessionInput{
		SessionID: threadID,
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if _, err := workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		TranscriptItems: &[]core.SessionTranscriptItem{
			{
				ID:       "reasoning-1",
				OrderKey: "live:00000000000000000001:reasoning-1",
				Kind:     core.SessionTranscriptItemKindReasoning,
				Title:    "Thinking",
				Body:     reasoningProgressBody,
				Status:   "completed",
			},
		},
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	read := readThreadResultWithTurns(ReadThreadTurn{
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
				Text:  "done",
				Phase: "final_answer",
			},
		},
	})
	read.Thread.ID = threadID
	read.Thread.Cwd = project.RootPath
	read.Thread.UpdatedAt = time.Now().UTC().Unix()
	read.Thread.Status = ThreadStatus{Type: "idle"}

	client := &fakeCodexClient{
		readResult: read,
		turnListResults: []*ThreadTurnsListResult{
			{Data: read.Thread.Turns},
		},
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
	readModel := NewSessionReadModel(workspace, manager, manager)

	page, err := readModel.ListSessionTranscript(core.ListSessionTranscriptInput{
		SessionID: threadID,
		Limit:     50,
	})
	if err != nil {
		t.Fatalf("ListSessionTranscript: %v", err)
	}
	if len(page.Items) != 3 {
		t.Fatalf("page items = %d, want 3", len(page.Items))
	}
	if page.Items[2].ID != "reasoning-1" {
		t.Fatalf("preserved item id = %q, want reasoning-1", page.Items[2].ID)
	}
	if page.Items[2].DisplayBody != "" {
		t.Fatalf("preserved raw reasoning = %q, want empty", page.Items[2].DisplayBody)
	}
}

func TestSessionReadModelListsLatestTranscriptPageFromCodexTurns(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	threadID := "thread-turns-latest"
	session, err := workspace.CreateSession(core.CreateSessionInput{
		SessionID: threadID,
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if _, err := workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	metaRead := readThreadResultWithTurns()
	metaRead.Thread.ID = threadID
	metaRead.Thread.Cwd = project.RootPath
	metaRead.Thread.UpdatedAt = time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC).Unix()
	metaRead.Thread.Status = ThreadStatus{Type: "idle"}
	olderCursor := "older-turn-page"
	client := &fakeCodexClient{
		readResult: metaRead,
		turnListResults: []*ThreadTurnsListResult{
			{
				Data: []ReadThreadTurn{
					agentMessageTurn("turn-2", "newest"),
					agentMessageTurn("turn-1", "oldest"),
				},
				NextCursor: &olderCursor,
			},
		},
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
	reader := NewSessionReadModel(workspace, manager, manager)

	page, err := reader.ListSessionTranscript(core.ListSessionTranscriptInput{
		SessionID: threadID,
		Limit:     50,
	})
	if err != nil {
		t.Fatalf("ListSessionTranscript: %v", err)
	}
	if client.listTurnCalls != 1 {
		t.Fatalf("ListThreadTurns calls = %d, want 1", client.listTurnCalls)
	}
	if got := client.turnListParams[0].ThreadID; got != threadID {
		t.Fatalf("ThreadID = %q, want %q", got, threadID)
	}
	if client.turnListParams[0].Cursor != nil {
		t.Fatalf("Cursor = %q, want nil", *client.turnListParams[0].Cursor)
	}
	if client.turnListParams[0].Limit == nil || *client.turnListParams[0].Limit != 50 {
		t.Fatalf("Limit = %#v, want 50", client.turnListParams[0].Limit)
	}
	if client.turnListParams[0].SortDirection != "desc" {
		t.Fatalf("SortDirection = %q, want desc", client.turnListParams[0].SortDirection)
	}
	if len(page.Items) != 2 {
		t.Fatalf("page items = %d, want 2", len(page.Items))
	}
	if page.Items[0].Body != "oldest" || page.Items[1].Body != "newest" {
		t.Fatalf("page item bodies = %#v, want chronological latest page", []string{page.Items[0].Body, page.Items[1].Body})
	}
	if !page.HasMoreBefore || page.NextBeforeCursor == "" {
		t.Fatalf("older cursor missing: hasMore=%v cursor=%q", page.HasMoreBefore, page.NextBeforeCursor)
	}
}

func TestSessionReadModelUsesCodexTurnsCursorForOlderTranscriptPage(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	threadID := "thread-turns-older"
	session, err := workspace.CreateSession(core.CreateSessionInput{
		SessionID: threadID,
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if _, err := workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	metaRead := readThreadResultWithTurns()
	metaRead.Thread.ID = threadID
	metaRead.Thread.Cwd = project.RootPath
	metaRead.Thread.UpdatedAt = time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC).Unix()
	metaRead.Thread.Status = ThreadStatus{Type: "idle"}
	olderCursor := "older-turn-page"
	client := &fakeCodexClient{
		readResult: metaRead,
		turnListResults: []*ThreadTurnsListResult{
			{
				Data: []ReadThreadTurn{
					agentMessageTurn("turn-3", "third"),
					agentMessageTurn("turn-2", "second"),
				},
				NextCursor: &olderCursor,
			},
			{
				Data: []ReadThreadTurn{
					agentMessageTurn("turn-1", "first"),
				},
			},
		},
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
	reader := NewSessionReadModel(workspace, manager, manager)

	latest, err := reader.ListSessionTranscript(core.ListSessionTranscriptInput{
		SessionID: threadID,
		Limit:     50,
	})
	if err != nil {
		t.Fatalf("ListSessionTranscript latest: %v", err)
	}
	older, err := reader.ListSessionTranscript(core.ListSessionTranscriptInput{
		SessionID:    threadID,
		Limit:        50,
		BeforeCursor: latest.NextBeforeCursor,
	})
	if err != nil {
		t.Fatalf("ListSessionTranscript older: %v", err)
	}
	if client.listTurnCalls != 2 {
		t.Fatalf("ListThreadTurns calls = %d, want 2", client.listTurnCalls)
	}
	if client.turnListParams[1].Cursor == nil || *client.turnListParams[1].Cursor != olderCursor {
		t.Fatalf("older Cursor = %#v, want %q", client.turnListParams[1].Cursor, olderCursor)
	}
	if len(older.Items) != 1 || older.Items[0].Body != "first" {
		t.Fatalf("older page items = %#v, want first message", older.Items)
	}
	if older.HasMoreBefore || older.NextBeforeCursor != "" {
		t.Fatalf("older page should terminate history: hasMore=%v cursor=%q", older.HasMoreBefore, older.NextBeforeCursor)
	}
}

func TestSessionReadModelFallsBackToThreadReadWhenCodexTurnsListFails(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	threadID := "thread-turns-fallback"
	session, err := workspace.CreateSession(core.CreateSessionInput{
		SessionID: threadID,
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	if _, err := workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	read := readThreadResultWithTurns(agentMessageTurn("turn-1", "fallback"))
	read.Thread.ID = threadID
	read.Thread.Cwd = project.RootPath
	read.Thread.UpdatedAt = time.Date(2026, 4, 30, 12, 0, 0, 0, time.UTC).Unix()
	read.Thread.Status = ThreadStatus{Type: "idle"}
	client := &fakeCodexClient{
		readResult:  read,
		turnListErr: os.ErrNotExist,
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
	reader := NewSessionReadModel(workspace, manager, manager)

	page, err := reader.ListSessionTranscript(core.ListSessionTranscriptInput{
		SessionID: threadID,
		Limit:     50,
	})
	if err != nil {
		t.Fatalf("ListSessionTranscript: %v", err)
	}
	if client.listTurnCalls != 1 {
		t.Fatalf("ListThreadTurns calls = %d, want 1", client.listTurnCalls)
	}
	if len(page.Items) != 1 || page.Items[0].Body != "fallback" {
		t.Fatalf("page items = %#v, want fallback transcript", page.Items)
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

func TestLatestAgentSummaryIgnoresCommentary(t *testing.T) {
	read := readThreadResultWithTurns(
		ReadThreadTurn{
			ID:     "turn-1",
			Status: "completed",
			Items: []ReadThreadItem{
				{
					Type:  "agentMessage",
					ID:    "agent-final",
					Text:  "Implemented the change.",
					Phase: "final_answer",
				},
			},
		},
		ReadThreadTurn{
			ID:     "turn-2",
			Status: "inProgress",
			Items: []ReadThreadItem{
				{
					Type:  "agentMessage",
					ID:    "agent-progress",
					Text:  "I will make this implementation change next.",
					Phase: "commentary",
				},
			},
		},
	)

	if got := latestAgentSummary(read); got != "Implemented the change." {
		t.Fatalf("latestAgentSummary = %q, want %q", got, "Implemented the change.")
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

func TestHandleNotificationStoresContextWindowUsage(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	session, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "continue",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		thread:  "thread-1",
	}

	manager.handleNotification(session.ID, Notification{
		Method: "thread/tokenUsage/updated",
		Params: mustJSON(t, protocol.ThreadTokenUsageUpdatedNotification{
			ThreadID: "thread-1",
			TurnID:   "turn-1",
			TokenUsage: protocol.ThreadTokenUsage{
				ModelContextWindow: intPtr(950_000),
				Total: protocol.TokenUsageBreakdown{
					TotalTokens: 130_000,
				},
				Last: protocol.TokenUsageBreakdown{
					TotalTokens: 8_192,
				},
			},
		}),
	})

	updated, ok := workspace.GetSession(session.ID)
	if !ok {
		t.Fatalf("session %q not found", session.ID)
	}
	if updated.ContextWindowUsage == nil {
		t.Fatalf("context window usage = nil")
	}
	if updated.ContextWindowUsage.UsedTokens != 8_192 {
		t.Fatalf("used tokens = %d, want 8192", updated.ContextWindowUsage.UsedTokens)
	}
	if updated.ContextWindowUsage.TotalTokens != 950_000 {
		t.Fatalf("total tokens = %d, want 950000", updated.ContextWindowUsage.TotalTokens)
	}
	if updated.ContextWindowUsage.LastTokens != 8_192 {
		t.Fatalf("last tokens = %d, want 8192", updated.ContextWindowUsage.LastTokens)
	}
}

func TestHandleNotificationDoesNotFinalizeCommentaryIntoTranscript(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	session, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "probe",
		Prompt:    "continue",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	summary := "Stable summary"
	session, err = workspace.UpdateSession(session.ID, core.SessionPatch{
		Summary: &summary,
	})
	if err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	sink := &fakeEventSink{}
	manager := NewManager(workspace, sink)
	manager.live[session.ID] = &liveSession{
		project:     project,
		thread:      "thread-1",
		active:      "turn-1",
		draftItemID: "msg-commentary",
		draftText:   "I will make this implementation change next.",
	}

	manager.handleNotification(session.ID, Notification{
		Method: "item/completed",
		Params: json.RawMessage(`{"item":{"id":"msg-commentary","type":"agentMessage","text":"I will make this implementation change next.","phase":"commentary"}}`),
	})

	current, ok := workspace.GetSession(session.ID)
	if !ok {
		t.Fatalf("session %q not found", session.ID)
	}
	if current.Summary != "Stable summary" {
		t.Fatalf("summary = %q, want stable summary", current.Summary)
	}
	live := manager.live[session.ID]
	if live.draftText != "" {
		t.Fatalf("live draft text = %q, want empty", live.draftText)
	}
	if live.draftItemID != "" {
		t.Fatalf("live draft item id = %q, want empty", live.draftItemID)
	}
	if len(sink.events) != 1 {
		t.Fatalf("published events = %d, want 1", len(sink.events))
	}
	patch := sink.events[0].LivePatch
	if patch == nil {
		t.Fatalf("live patch = nil")
	}
	if patch.Kind != core.SessionLivePatchKindMessageFinalized {
		t.Fatalf("patch kind = %q", patch.Kind)
	}
	if patch.FinalItem == nil {
		t.Fatalf("final item = nil")
	}
	if patch.FinalItem.ID != "msg-commentary" {
		t.Fatalf("final item id = %q", patch.FinalItem.ID)
	}
	if patch.FinalItem.Body != "" {
		t.Fatalf("final item body = %q, want empty", patch.FinalItem.Body)
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

func TestWatchTurnPollsAtIntervalUntilCompletion(t *testing.T) {
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
	client := &fakeCodexClient{
		readResults: []*ReadThreadResult{
			readThreadResultWithTurns(ReadThreadTurn{ID: turnID, Status: "inProgress"}),
			readThreadResultWithTurns(ReadThreadTurn{ID: turnID, Status: "inProgress"}),
			readThreadResultWithTurns(ReadThreadTurn{ID: turnID, Status: "inProgress"}),
			readThreadResultWithTurns(ReadThreadTurn{
				ID:     turnID,
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
						Text:  "done",
						Phase: "final_answer",
					},
				},
			}),
		},
	}
	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client:  client,
		thread:  threadID,
		active:  turnID,
	}

	oldPollInterval := watchTurnPollInterval
	watchTurnPollInterval = 20 * time.Millisecond
	defer func() {
		watchTurnPollInterval = oldPollInterval
	}()

	started := time.Now()
	manager.watchTurn(session.ID, threadID, turnID)
	elapsed := time.Since(started)

	if client.readCalls != 4 {
		t.Fatalf("ReadThread calls = %d, want 4", client.readCalls)
	}
	if elapsed < 3*watchTurnPollInterval {
		t.Fatalf("watchTurn elapsed = %s, want at least %s", elapsed, 3*watchTurnPollInterval)
	}

	updated, ok := workspace.GetSession(session.ID)
	if !ok {
		t.Fatalf("session %q not found", session.ID)
	}
	if updated.Status != core.SessionStateCompleted {
		t.Fatalf("session status = %q, want %q", updated.Status, core.SessionStateCompleted)
	}
	if updated.Summary != "done" {
		t.Fatalf("summary = %q, want done", updated.Summary)
	}
	if len(updated.TranscriptItems) != 2 {
		t.Fatalf("transcript items = %d, want 2", len(updated.TranscriptItems))
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
	if client.respondApprovalCalls[0] != `12:{"decision":"accept"}` {
		t.Fatalf("respond approval call = %q", client.respondApprovalCalls[0])
	}
	if updated.PendingApprovalID != "" {
		t.Fatalf("pending approval id = %q, want empty", updated.PendingApprovalID)
	}
	if updated.Status != core.SessionStateRunning {
		t.Fatalf("status = %q, want %q", updated.Status, core.SessionStateRunning)
	}
}

func TestRespondToSessionApprovalRejectsWithDecline(t *testing.T) {
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
	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client:  client,
		thread:  "thread-1",
		active:  "turn-1",
		pendingApproval: &pendingApproval{
			ID:      "13",
			RawID:   json.RawMessage(`13`),
			Method:  "item/fileChange/requestApproval",
			Message: "Codex needs approval to change files.",
		},
	}

	_, err = manager.RespondToSessionApproval(session.ID, "13", core.ApprovalDecisionReject)
	if err != nil {
		t.Fatalf("RespondToSessionApproval: %v", err)
	}
	if len(client.respondApprovalCalls) != 1 {
		t.Fatalf("respond approval calls = %d, want 1", len(client.respondApprovalCalls))
	}
	if client.respondApprovalCalls[0] != `13:{"decision":"decline"}` {
		t.Fatalf("respond approval call = %q", client.respondApprovalCalls[0])
	}
}

func TestRespondToSessionApprovalGrantsRequestedPermissions(t *testing.T) {
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
	manager := NewManager(workspace)
	manager.live[session.ID] = &liveSession{
		project: project,
		client:  client,
		thread:  "thread-1",
		active:  "turn-1",
		pendingApproval: &pendingApproval{
			ID:     "14",
			RawID:  json.RawMessage(`14`),
			Method: "item/permissions/requestApproval",
			Params: json.RawMessage(`{
				"permissions": {
					"fileSystem": { "write": ["/tmp/hopter-permission-probe"] },
					"network": { "enabled": true }
				}
			}`),
			Message: "Codex needs approval for additional permissions.",
		},
	}

	_, err = manager.RespondToSessionApproval(session.ID, "14", core.ApprovalDecisionApprove)
	if err != nil {
		t.Fatalf("RespondToSessionApproval: %v", err)
	}
	if len(client.respondApprovalCalls) != 1 {
		t.Fatalf("respond approval calls = %d, want 1", len(client.respondApprovalCalls))
	}
	want := `14:{"permissions":{"fileSystem":{"write":["/tmp/hopter-permission-probe"]},"network":{"enabled":true}},"scope":"turn"}`
	if client.respondApprovalCalls[0] != want {
		t.Fatalf("respond approval call = %q, want %q", client.respondApprovalCalls[0], want)
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

func TestInterruptSessionSignalsExternalCodexExec(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	startedAt := time.Now().UTC().Add(-10 * time.Second)
	client := &fakeCodexClient{
		readResult: readThreadResultWithTurns(
			ReadThreadTurn{ID: "turn-interrupted", Status: "interrupted"},
		),
	}
	client.readResult.Thread.ID = "thread-exec-interrupt"
	client.readResult.Thread.Cwd = project.RootPath
	client.readResult.Thread.UpdatedAt = startedAt.Unix()
	client.readResult.Thread.Status = ThreadStatus{Type: "idle"}

	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "23")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-23T11-43-00-thread-exec-interrupt.jsonl")
	sessionJSON := `{"type":"session_meta","payload":{"id":"thread-exec-interrupt","timestamp":"` +
		startedAt.Format(time.RFC3339Nano) +
		`","cwd":"` + project.RootPath + `","source":"exec"}}` + "\n" +
		`{"type":"response_item","payload":{"type":"function_call_output","output":"Process running with session ID 42"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(sessionJSON), 0o644); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}

	originalListProcesses := listLocalCodexExecProcesses
	originalSignalProcess := signalLocalCodexExecProcess
	signaledPID := 0
	listLocalCodexExecProcesses = func() ([]localCodexExecProcess, error) {
		return []localCodexExecProcess{
			{
				PID:     1234,
				Command: "/opt/homebrew/bin/codex exec -C " + project.RootPath + " --full-auto prompt",
			},
		}, nil
	}
	signalLocalCodexExecProcess = func(pid int) error {
		signaledPID = pid
		return nil
	}
	t.Cleanup(func() {
		listLocalCodexExecProcesses = originalListProcesses
		signalLocalCodexExecProcess = originalSignalProcess
	})

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

	updated, err := manager.InterruptSession("thread-exec-interrupt")
	if err != nil {
		t.Fatalf("InterruptSession: %v", err)
	}
	if signaledPID != 1234 {
		t.Fatalf("signaled pid = %d, want 1234", signaledPID)
	}
	if updated.Status != core.SessionStateWaitingInput {
		t.Fatalf("status = %q, want %q", updated.Status, core.SessionStateWaitingInput)
	}
	if updated.ActiveTurnID != "" {
		t.Fatalf("active turn id = %q, want empty", updated.ActiveTurnID)
	}
}

func TestListSessionsCachesThreadListCalls(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	client := &fakeCodexClient{
		listResult: &ThreadListResult{
			Data: []ThreadRecord{
				{
					ID:        "thread-1",
					Cwd:       project.RootPath,
					Preview:   "cached list",
					UpdatedAt: time.Now().UTC().Unix(),
					Status:    ThreadStatus{Type: "idle"},
				},
			},
		},
	}
	manager := NewManager(workspace)
	startCalls := 0
	manager.start = func(
		_ context.Context,
		_ string,
		_ func(Notification),
		_ func(ServerRequest),
		_ func(TraceEntry),
		_ func(),
	) (codexClient, error) {
		startCalls++
		return client, nil
	}

	first, err := manager.ListSessions("", 10)
	if err != nil {
		t.Fatalf("ListSessions first: %v", err)
	}
	second, err := manager.ListSessions("", 10)
	if err != nil {
		t.Fatalf("ListSessions second: %v", err)
	}

	if len(first) != 1 || len(second) != 1 {
		t.Fatalf("session counts = %d, %d; want 1, 1", len(first), len(second))
	}
	if startCalls != 1 {
		t.Fatalf("start calls = %d, want 1", startCalls)
	}
	if client.listThreadsCalls != 1 {
		t.Fatalf("ListThreads calls = %d, want 1", client.listThreadsCalls)
	}
}

func TestSessionListMonitorPublishesExternalThreadStatusChanges(t *testing.T) {
	originalTTL := threadListCacheTTL
	threadListCacheTTL = 0
	t.Cleanup(func() {
		threadListCacheTTL = originalTTL
	})

	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	sink := &fakeEventSink{}
	client := &fakeCodexClient{
		listResult: &ThreadListResult{
			Data: []ThreadRecord{
				{
					ID:        "thread-external",
					Cwd:       project.RootPath,
					Preview:   "external turn",
					UpdatedAt: 100,
					Status:    ThreadStatus{Type: "idle"},
				},
			},
		},
	}
	manager := NewManager(workspace, sink)
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

	state := manager.pollSessionListMonitor(context.Background(), nil, 10)
	if len(sink.events) != 0 {
		t.Fatalf("initial monitor poll published %d events, want 0", len(sink.events))
	}

	client.listResult = &ThreadListResult{
		Data: []ThreadRecord{
			{
				ID:        "thread-external",
				Cwd:       project.RootPath,
				Preview:   "external turn",
				UpdatedAt: 101,
				Status:    ThreadStatus{Type: "active"},
			},
		},
	}

	state = manager.pollSessionListMonitor(context.Background(), state, 10)
	if len(sink.events) != 2 {
		t.Fatalf("status change published %d events, want 2", len(sink.events))
	}
	if sink.events[0].Kind != core.EventSessionsChanged {
		t.Fatalf("first event kind = %q, want %q", sink.events[0].Kind, core.EventSessionsChanged)
	}
	if sink.events[1].Kind != core.EventSessionChanged {
		t.Fatalf("second event kind = %q, want %q", sink.events[1].Kind, core.EventSessionChanged)
	}
	if sink.events[1].SessionID != "thread-external" {
		t.Fatalf("session event id = %q, want thread-external", sink.events[1].SessionID)
	}
	if sink.events[1].ProjectID != project.ID {
		t.Fatalf("session event project = %q, want %q", sink.events[1].ProjectID, project.ID)
	}

	manager.pollSessionListMonitor(context.Background(), state, 10)
	if len(sink.events) != 2 {
		t.Fatalf("unchanged poll published %d events, want 2", len(sink.events))
	}
}

func TestListSessionsHydratesRecentExternalRunningTurn(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	client := &fakeCodexClient{
		listResult: &ThreadListResult{
			Data: []ThreadRecord{
				{
					ID:        "thread-external-running",
					Cwd:       project.RootPath,
					Preview:   "external running",
					UpdatedAt: time.Now().UTC().Unix(),
					Status:    ThreadStatus{Type: "idle"},
				},
			},
		},
		readResult: readThreadResultWithTurns(
			ReadThreadTurn{ID: "turn-running", Status: "inProgress"},
		),
	}
	client.readResult.Thread.ID = "thread-external-running"
	client.readResult.Thread.UpdatedAt = time.Now().UTC().Unix()

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

	sessions, err := manager.ListSessions("", 10)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("session count = %d, want 1", len(sessions))
	}
	if sessions[0].Session.Status != core.SessionStateRunning {
		t.Fatalf("session status = %q, want %q", sessions[0].Session.Status, core.SessionStateRunning)
	}
	if client.readCalls != 1 {
		t.Fatalf("ReadThread calls = %d, want 1", client.readCalls)
	}
}

func TestListSessionsHydratesRunningStatusFromLocalCodexJsonl(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	client := &fakeCodexClient{
		listResult: &ThreadListResult{
			Data: []ThreadRecord{
				{
					ID:        "thread-local-running",
					Cwd:       project.RootPath,
					Preview:   "local running",
					UpdatedAt: time.Now().UTC().Unix(),
					Status:    ThreadStatus{Type: "idle"},
				},
			},
		},
		readResult: readThreadResultWithTurns(
			ReadThreadTurn{ID: "turn-interrupted", Status: "interrupted"},
		),
	}
	client.readResult.Thread.ID = "thread-local-running"
	client.readResult.Thread.UpdatedAt = time.Now().UTC().Unix()

	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "23")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-23T11-43-00-thread-local-running.jsonl")
	if err := os.WriteFile(
		sessionPath,
		[]byte(`{"type":"response_item","payload":{"type":"function_call_output","output":"Process running with session ID 36741"}}`+"\n"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile: %v", err)
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

	sessions, err := manager.ListSessions("", 10)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("session count = %d, want 1", len(sessions))
	}
	if sessions[0].Session.Status != core.SessionStateRunning {
		t.Fatalf("session status = %q, want %q", sessions[0].Session.Status, core.SessionStateRunning)
	}
	if client.readCalls != 0 {
		t.Fatalf("ReadThread calls = %d, want 0 when local running marker is present", client.readCalls)
	}
}

func TestGetSessionMetaHydratesRunningStatusFromLocalCodexJsonl(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	client := &fakeCodexClient{
		readResult: readThreadResultWithTurns(
			ReadThreadTurn{ID: "turn-interrupted", Status: "interrupted"},
		),
	}
	client.readResult.Thread.ID = "thread-meta-local-running"
	client.readResult.Thread.Cwd = project.RootPath
	client.readResult.Thread.UpdatedAt = time.Now().UTC().Unix()
	client.readResult.Thread.Status = ThreadStatus{Type: "idle"}

	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "23")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-23T11-43-00-thread-meta-local-running.jsonl")
	if err := os.WriteFile(
		sessionPath,
		[]byte(`{"type":"item.started","item":{"type":"command_execution","status":"in_progress"}}`+"\n"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile: %v", err)
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
	reader := NewSessionReadModel(workspace, manager, manager)

	meta, err := reader.GetSessionMeta("thread-meta-local-running")
	if err != nil {
		t.Fatalf("GetSessionMeta: %v", err)
	}
	if meta.Session.Status != core.SessionStateRunning {
		t.Fatalf("session status = %q, want %q", meta.Session.Status, core.SessionStateRunning)
	}
}

func TestLocalCodexSessionRunningTracksOpenFunctionCall(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "23")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-23T11-43-00-thread-open-call.jsonl")

	openCall := `{"type":"response_item","payload":{"type":"function_call","name":"exec_command","call_id":"call_1"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(openCall), 0o644); err != nil {
		t.Fatalf("WriteFile open call: %v", err)
	}
	if !localCodexSessionRunning("thread-open-call") {
		t.Fatal("localCodexSessionRunning = false, want true for open exec_command call")
	}

	closedCall := openCall + `{"type":"response_item","payload":{"type":"function_call_output","call_id":"call_1","output":"succeeded in 1ms"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(closedCall), 0o644); err != nil {
		t.Fatalf("WriteFile closed call: %v", err)
	}
	if localCodexSessionRunning("thread-open-call") {
		t.Fatal("localCodexSessionRunning = true, want false after function_call_output")
	}
}

func TestLocalCodexSessionRunningTracksCommandExecutionItems(t *testing.T) {
	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "23")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-23T11-43-00-thread-command-item.jsonl")

	runningItem := `{"type":"item.started","item":{"type":"command_execution","status":"in_progress"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(runningItem), 0o644); err != nil {
		t.Fatalf("WriteFile running item: %v", err)
	}
	if !localCodexSessionRunning("thread-command-item") {
		t.Fatal("localCodexSessionRunning = false, want true for in-progress command_execution")
	}

	completedItem := runningItem + `{"type":"item.completed","item":{"type":"command_execution","status":"completed"}}` + "\n"
	if err := os.WriteFile(sessionPath, []byte(completedItem), 0o644); err != nil {
		t.Fatalf("WriteFile completed item: %v", err)
	}
	if localCodexSessionRunning("thread-command-item") {
		t.Fatal("localCodexSessionRunning = true, want false after completed command_execution")
	}
}

func TestLocalCodexSessionRunningIgnoresStaleRunningMarkers(t *testing.T) {
	originalTTL := localCodexRunningMarkerTTL
	localCodexRunningMarkerTTL = time.Minute
	t.Cleanup(func() {
		localCodexRunningMarkerTTL = originalTTL
	})

	codexHome := t.TempDir()
	t.Setenv("CODEX_HOME", codexHome)
	sessionDir := filepath.Join(codexHome, "sessions", "2026", "04", "23")
	if err := os.MkdirAll(sessionDir, 0o755); err != nil {
		t.Fatalf("MkdirAll: %v", err)
	}
	sessionPath := filepath.Join(sessionDir, "rollout-2026-04-23T11-43-00-thread-stale-running.jsonl")
	if err := os.WriteFile(
		sessionPath,
		[]byte(`{"type":"response_item","payload":{"type":"function_call_output","output":"Process running with session ID 36741"}}`+"\n"),
		0o644,
	); err != nil {
		t.Fatalf("WriteFile: %v", err)
	}
	staleTime := time.Now().Add(-2 * time.Minute)
	if err := os.Chtimes(sessionPath, staleTime, staleTime); err != nil {
		t.Fatalf("Chtimes: %v", err)
	}

	if localCodexSessionRunning("thread-stale-running") {
		t.Fatal("localCodexSessionRunning = true, want false for stale running marker")
	}
}

func TestListSessionsMapsActiveFlagsToWaitingStates(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	client := &fakeCodexClient{
		listResult: &ThreadListResult{
			Data: []ThreadRecord{
				{
					ID:        "thread-running",
					Cwd:       project.RootPath,
					Preview:   "running",
					UpdatedAt: time.Now().UTC().Unix(),
					Status:    ThreadStatus{Type: "active"},
				},
				{
					ID:        "thread-approval",
					Cwd:       project.RootPath,
					Preview:   "approval",
					UpdatedAt: time.Now().UTC().Add(-time.Second).Unix(),
					Status: ThreadStatus{
						Type:        "active",
						ActiveFlags: []string{"waitingOnApproval"},
					},
				},
				{
					ID:        "thread-input",
					Cwd:       project.RootPath,
					Preview:   "input",
					UpdatedAt: time.Now().UTC().Add(-2 * time.Second).Unix(),
					Status: ThreadStatus{
						Type:        "active",
						ActiveFlags: []string{"waitingOnUserInput"},
					},
				},
			},
		},
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

	sessions, err := manager.ListSessions(project.ID, 10)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}

	got := make(map[string]core.SessionState)
	for _, resolved := range sessions {
		got[resolved.Session.BackendThreadID] = resolved.Session.Status
	}
	if got["thread-running"] != core.SessionStateRunning {
		t.Fatalf("running status = %q, want %q", got["thread-running"], core.SessionStateRunning)
	}
	if got["thread-approval"] != core.SessionStateWaitingApproval {
		t.Fatalf("approval status = %q, want %q", got["thread-approval"], core.SessionStateWaitingApproval)
	}
	if got["thread-input"] != core.SessionStateWaitingInput {
		t.Fatalf("input status = %q, want %q", got["thread-input"], core.SessionStateWaitingInput)
	}
}

func TestListSessionsKeepsThreadIDForAppServerBackedLocalReferences(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := mustCreateProject(t, workspace)
	local, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "local alias",
		Prompt:    "first",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}
	threadID := "thread-1"
	if _, err := workspace.UpdateSession(local.ID, core.SessionPatch{
		BackendThreadID: &threadID,
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	client := &fakeCodexClient{
		listResult: &ThreadListResult{
			Data: []ThreadRecord{
				{
					ID:        threadID,
					Cwd:       project.RootPath,
					Preview:   "remote thread",
					UpdatedAt: time.Now().UTC().Unix(),
					Status:    ThreadStatus{Type: "idle"},
				},
			},
		},
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

	sessions, err := manager.ListSessions(project.ID, 10)
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}
	if len(sessions) != 1 {
		t.Fatalf("session count = %d, want 1", len(sessions))
	}
	if sessions[0].Session.ID != threadID {
		t.Fatalf("listed session id = %q, want real thread id", sessions[0].Session.ID)
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

func mustJSON(t *testing.T, value any) json.RawMessage {
	t.Helper()

	raw, err := json.Marshal(value)
	if err != nil {
		t.Fatalf("json.Marshal: %v", err)
	}
	return raw
}

func intPtr(value int) *int {
	return &value
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
