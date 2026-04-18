package rpcserver

import (
	"context"
	"os"
	"path/filepath"
	"testing"
	"time"

	"connectrpc.com/connect"

	"orchd/internal/backend"
	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type fakeSessionRuntime struct {
	listSessionsResult []backend.ResolvedSession
	getSession         core.Session
	getProject         core.Project
	approvalSession    core.Session
	approvalCall       struct {
		sessionID  string
		approvalID string
		decision   core.ApprovalDecision
	}
}

type fakeSessionDetailReader struct {
	meta core.SessionMeta
	page core.SessionTranscriptPage
}

func (f *fakeSessionRuntime) ListSessions(projectID string, limit uint32) ([]backend.ResolvedSession, error) {
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

func (f *fakeSessionRuntime) RespondToSessionApproval(
	sessionID, approvalID string,
	decision core.ApprovalDecision,
) (core.Session, error) {
	f.approvalCall.sessionID = sessionID
	f.approvalCall.approvalID = approvalID
	f.approvalCall.decision = decision
	return f.approvalSession, nil
}

func (f *fakeSessionDetailReader) GetSessionMeta(sessionID string) (core.SessionMeta, error) {
	return f.meta, nil
}

func (f *fakeSessionDetailReader) ListSessionTranscript(input core.ListSessionTranscriptInput) (core.SessionTranscriptPage, error) {
	return f.page, nil
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
	}, &fakeSessionDetailReader{})

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

func TestGetSessionMetaAndTranscriptPage(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := core.Project{
		ID:             "proj_1",
		Name:           "probe",
		RootPath:       "/tmp/probe",
		DefaultBackend: "codex",
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	meta := core.SessionMeta{
		Session: core.Session{
			ID:              "sess_1",
			ProjectID:       project.ID,
			Title:           "probe",
			Status:          core.SessionStateCompleted,
			Summary:         "done",
			UpdatedAt:       time.Now().UTC(),
			BackendKey:      "codex",
			BackendThreadID: "thread_123",
		},
		Project:            project,
		HasMoreBefore:      true,
		LatestPageSizeHint: 50,
	}
	page := core.SessionTranscriptPage{
		SessionID:         meta.Session.ID,
		ProjectID:         project.ID,
		HasMoreBefore:     true,
		NextBeforeCursor:  "cursor-1",
		SnapshotUpdatedAt: time.Now().UTC(),
		Items: []core.SessionTranscriptItem{
			{ID: "u1", Kind: core.SessionTranscriptItemKindUserMessage, Title: "You", Body: "hello"},
		},
	}

	service := NewSessionService(workspace, &fakeSessionRuntime{}, &fakeSessionDetailReader{
		meta: meta,
		page: page,
	})

	metaResp, err := service.GetSessionMeta(context.Background(), connect.NewRequest(&orchdv1.GetSessionMetaRequest{
		SessionId: meta.Session.ID,
	}))
	if err != nil {
		t.Fatalf("GetSessionMeta: %v", err)
	}
	if metaResp.Msg.GetSession().GetId() != meta.Session.ID {
		t.Fatalf("meta session id = %q", metaResp.Msg.GetSession().GetId())
	}
	if !metaResp.Msg.GetSession().GetHasMoreBefore() {
		t.Fatalf("meta has_more_before = false, want true")
	}
	wantResume := `codex -C "/tmp/probe" resume "thread_123"`
	if metaResp.Msg.GetSession().GetResumeCommand() != wantResume {
		t.Fatalf("resume command = %q, want %q", metaResp.Msg.GetSession().GetResumeCommand(), wantResume)
	}

	pageResp, err := service.ListSessionTranscript(context.Background(), connect.NewRequest(&orchdv1.ListSessionTranscriptRequest{
		SessionId: meta.Session.ID,
	}))
	if err != nil {
		t.Fatalf("ListSessionTranscript: %v", err)
	}
	if len(pageResp.Msg.GetPage().GetItems()) != 1 {
		t.Fatalf("page item count = %d, want 1", len(pageResp.Msg.GetPage().GetItems()))
	}
	if pageResp.Msg.GetPage().GetNextBeforeCursor() != "cursor-1" {
		t.Fatalf("next cursor = %q", pageResp.Msg.GetPage().GetNextBeforeCursor())
	}
}

func TestGetSessionMetaOmitsResumeCommandWithoutCodexThread(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	project := core.Project{
		ID:             "proj_1",
		Name:           "probe",
		RootPath:       "/tmp/probe",
		DefaultBackend: "codex",
		CreatedAt:      time.Now().UTC(),
		UpdatedAt:      time.Now().UTC(),
	}
	meta := core.SessionMeta{
		Session: core.Session{
			ID:         "sess_1",
			ProjectID:  project.ID,
			Title:      "probe",
			Status:     core.SessionStateCompleted,
			Summary:    "done",
			UpdatedAt:  time.Now().UTC(),
			BackendKey: "copilot",
		},
		Project: project,
	}

	service := NewSessionService(workspace, &fakeSessionRuntime{}, &fakeSessionDetailReader{
		meta: meta,
	})

	metaResp, err := service.GetSessionMeta(context.Background(), connect.NewRequest(&orchdv1.GetSessionMetaRequest{
		SessionId: meta.Session.ID,
	}))
	if err != nil {
		t.Fatalf("GetSessionMeta: %v", err)
	}
	if metaResp.Msg.GetSession().GetResumeCommand() != "" {
		t.Fatalf("resume command = %q, want empty", metaResp.Msg.GetSession().GetResumeCommand())
	}
}

func TestListSessionsMergesLocalSessionsMissingFromRuntime(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	root := t.TempDir()
	if err := os.MkdirAll(filepath.Join(root, ".git"), 0o755); err != nil {
		t.Fatalf("mkdir repo .git: %v", err)
	}
	project, err := workspace.CreateProject(core.CreateProjectInput{
		Name:           "probe",
		RootPath:       root,
		DefaultBackend: "codex",
	})
	if err != nil {
		t.Fatalf("CreateProject: %v", err)
	}
	session, err := workspace.CreateSession(core.CreateSessionInput{
		ProjectID: project.ID,
		Title:     "local pending",
		Prompt:    "hello",
	})
	if err != nil {
		t.Fatalf("CreateSession: %v", err)
	}

	service := NewSessionService(workspace, &fakeSessionRuntime{
		listSessionsResult: nil,
	}, &fakeSessionDetailReader{})

	resp, err := service.ListSessions(context.Background(), connect.NewRequest(&orchdv1.ListSessionsRequest{}))
	if err != nil {
		t.Fatalf("ListSessions: %v", err)
	}

	if len(resp.Msg.GetSessions()) != 1 {
		t.Fatalf("session count = %d, want 1", len(resp.Msg.GetSessions()))
	}
	if resp.Msg.GetSessions()[0].GetId() != session.ID {
		t.Fatalf("first session id = %q, want %q", resp.Msg.GetSessions()[0].GetId(), session.ID)
	}
}

func TestRespondToSessionApprovalPassesDecisionToRuntime(t *testing.T) {
	workspace := core.NewInMemoryWorkspace("host", nil)
	runtime := &fakeSessionRuntime{
		approvalSession: core.Session{
			ID:        "sess_1",
			UpdatedAt: time.Now().UTC(),
		},
	}
	service := NewSessionService(workspace, runtime, &fakeSessionDetailReader{})

	resp, err := service.RespondToSessionApproval(context.Background(), connect.NewRequest(&orchdv1.RespondToSessionApprovalRequest{
		SessionId:  "sess_1",
		ApprovalId: "12",
		Decision:   orchdv1.ApprovalDecision_APPROVAL_DECISION_APPROVE,
	}))
	if err != nil {
		t.Fatalf("RespondToSessionApproval: %v", err)
	}
	if !resp.Msg.GetAccepted() {
		t.Fatalf("accepted = false, want true")
	}
	if runtime.approvalCall.sessionID != "sess_1" {
		t.Fatalf("sessionID = %q", runtime.approvalCall.sessionID)
	}
	if runtime.approvalCall.approvalID != "12" {
		t.Fatalf("approvalID = %q", runtime.approvalCall.approvalID)
	}
	if runtime.approvalCall.decision != core.ApprovalDecisionApprove {
		t.Fatalf("decision = %q", runtime.approvalCall.decision)
	}
}
