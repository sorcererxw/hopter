package rpcserver

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	"orchd/internal/codex"
	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type fakeSessionRuntime struct {
	listSessionsResult []codex.ResolvedSession
	getSession         core.Session
	getProject         core.Project
}

func (f *fakeSessionRuntime) ListSessions(projectID string, limit uint32) ([]codex.ResolvedSession, error) {
	return f.listSessionsResult, nil
}

func (f *fakeSessionRuntime) GetSession(sessionID string) (core.Session, core.Project, error) {
	return f.getSession, f.getProject, nil
}

func (f *fakeSessionRuntime) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	return core.Session{}, nil
}

func (f *fakeSessionRuntime) SendSessionInput(sessionID, input string) (core.Session, error) {
	return core.Session{}, nil
}

func TestGetSessionIncludesTranscriptItemsInRPCResponse(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := core.Project{
		ID:             "proj_1",
		Name:           "probe",
		RootPath:       "/tmp/probe",
		DefaultBackend: "codex",
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	session := core.Session{
		ID:            "sess_1",
		ProjectID:     project.ID,
		Title:         "probe",
		Status:        core.SessionStateCompleted,
		Summary:       "done",
		UpdatedAt:     time.Now().UTC(),
		LastInputHint: "follow up",
		TranscriptItems: []core.SessionTranscriptItem{
			{
				ID:    "u1",
				Kind:  core.SessionTranscriptItemKindUserMessage,
				Title: "You",
				Body:  "build something",
			},
			{
				ID:     "cmd1",
				Kind:   core.SessionTranscriptItemKindCommandExecution,
				Title:  "Command",
				Body:   "git status\n\nstatus: completed",
				Status: "completed",
			},
		},
	}

	service := NewSessionService(workspace, &fakeSessionRuntime{
		getSession: session,
		getProject: project,
	})

	resp, err := service.GetSession(context.Background(), connect.NewRequest(&orchdv1.GetSessionRequest{
		SessionId: session.ID,
	}))
	if err != nil {
		t.Fatalf("GetSession: %v", err)
	}

	got := resp.Msg.GetSession()
	if got == nil {
		t.Fatalf("session response is nil")
	}
	if len(got.GetTranscriptItems()) != 2 {
		t.Fatalf("transcript item count = %d, want 2", len(got.GetTranscriptItems()))
	}
	if got.GetTranscriptItems()[0].GetKind() != orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE {
		t.Fatalf("first transcript kind = %v", got.GetTranscriptItems()[0].GetKind())
	}
	if got.GetTranscriptItems()[1].GetKind() != orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION {
		t.Fatalf("second transcript kind = %v", got.GetTranscriptItems()[1].GetKind())
	}
	if got.GetTranscriptItems()[1].GetStatus() != "completed" {
		t.Fatalf("second transcript status = %q", got.GetTranscriptItems()[1].GetStatus())
	}
}
