package codex

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

func TestAppServerTraceReasoningItemsPreservesEmptyReasoningMarker(t *testing.T) {
	root := t.TempDir()
	writer := newAppServerTraceWriter(root, "session-1")
	writer.Write(TraceEntry{
		Direction: "incoming",
		Kind:      "notification",
		Method:    "item/completed",
		Payload: json.RawMessage(`{
			"method": "item/completed",
			"params": {
				"item": {
					"id": "reasoning-1",
					"type": "reasoning",
					"summary": [],
					"content": []
				}
			}
		}`),
	})

	items := appServerTraceReasoningItems(root, "session-1")
	if len(items) != 1 {
		t.Fatalf("items = %d, want 1", len(items))
	}
	if items[0].ID != "reasoning-1" {
		t.Fatalf("item id = %q, want reasoning-1", items[0].ID)
	}
	if items[0].Body != reasoningProgressBody {
		t.Fatalf("body = %q, want %q", items[0].Body, reasoningProgressBody)
	}
	if items[0].DisplayBody != "" {
		t.Fatalf("display body = %q, want empty raw body", items[0].DisplayBody)
	}
	if items[0].Status != "completed" {
		t.Fatalf("status = %q, want completed", items[0].Status)
	}
}

func TestSessionReadModelRecoversReasoningMarkerFromAppServerTrace(t *testing.T) {
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
	}); err != nil {
		t.Fatalf("UpdateSession: %v", err)
	}

	writer := newAppServerTraceWriter(project.RootPath, threadID)
	writer.Write(TraceEntry{
		Direction: "incoming",
		Kind:      "notification",
		Method:    "item/completed",
		Payload: json.RawMessage(`{
			"method": "item/completed",
			"params": {
				"item": {
					"id": "reasoning-1",
					"type": "reasoning",
					"summary": [],
					"content": []
				}
			}
		}`),
	})

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
	if page.Items[2].Kind != core.SessionTranscriptItemKindReasoning {
		t.Fatalf("third item kind = %q, want reasoning", page.Items[2].Kind)
	}
	if page.Items[2].DisplayBody != "" {
		t.Fatalf("raw reasoning = %q, want empty", page.Items[2].DisplayBody)
	}
}
