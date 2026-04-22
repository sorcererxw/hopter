package rpcserver

import (
	"context"
	"testing"
	"time"

	"connectrpc.com/connect"

	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
	"github.com/sorcererxw/hopter/internal/terminal"
)

type fakeTerminalManager struct {
	created         terminal.Session
	fetched         terminal.Session
	terminated      terminal.Session
	terminatedCount int
	getErr          error
	createInput     terminal.CreateInput
	getCall         struct {
		sessionID         string
		browserInstanceID string
		tabID             string
	}
	terminateID      string
	tabTerminateCall struct {
		browserInstanceID string
		tabID             string
	}
}

func (f *fakeTerminalManager) CreateTerminalSession(_ context.Context, input terminal.CreateInput) (terminal.Session, error) {
	f.createInput = input
	return f.created, nil
}

func (f *fakeTerminalManager) GetTerminalSession(sessionID, browserInstanceID, tabID string) (terminal.Session, error) {
	f.getCall.sessionID = sessionID
	f.getCall.browserInstanceID = browserInstanceID
	f.getCall.tabID = tabID
	if f.getErr != nil {
		return terminal.Session{}, f.getErr
	}
	return f.fetched, nil
}

func (f *fakeTerminalManager) TerminateTerminalSession(terminalID string) (terminal.Session, error) {
	f.terminateID = terminalID
	return f.terminated, nil
}

func (f *fakeTerminalManager) TerminateBrowserTab(browserInstanceID, tabID string) int {
	f.tabTerminateCall.browserInstanceID = browserInstanceID
	f.tabTerminateCall.tabID = tabID
	return f.terminatedCount
}

func TestTerminalServiceCreateGetTerminate(t *testing.T) {
	now := time.Now().UTC()
	manager := &fakeTerminalManager{
		created: terminal.Session{
			ID:                "term_1",
			ProjectID:         "proj_1",
			SessionID:         "sess_1",
			BrowserInstanceID: "browser_1",
			TabID:             "tab_1",
			CWD:               "/tmp/repo",
			Shell:             "zsh",
			Status:            terminal.StatusLive,
			CreatedAt:         now,
			LastActivityAt:    now,
			LastOutputAt:      now,
		},
		fetched: terminal.Session{
			ID:                "term_1",
			ProjectID:         "proj_1",
			SessionID:         "sess_1",
			BrowserInstanceID: "browser_1",
			TabID:             "tab_1",
			CWD:               "/tmp/repo",
			Shell:             "zsh",
			Status:            terminal.StatusLive,
			CreatedAt:         now,
			LastActivityAt:    now,
			LastOutputAt:      now,
		},
		terminated: terminal.Session{
			ID:                "term_1",
			ProjectID:         "proj_1",
			SessionID:         "sess_1",
			BrowserInstanceID: "browser_1",
			TabID:             "tab_1",
			CWD:               "/tmp/repo",
			Shell:             "zsh",
			Status:            terminal.StatusTerminated,
			CreatedAt:         now,
			LastActivityAt:    now,
			LastOutputAt:      now,
		},
	}
	service := NewTerminalService(manager)

	createResp, err := service.CreateTerminalSession(context.Background(), connect.NewRequest(&hopterv1.CreateTerminalSessionRequest{
		SessionId:         "sess_1",
		BrowserInstanceId: "browser_1",
		TabId:             "tab_1",
		Cols:              func() *uint32 { v := uint32(120); return &v }(),
		Rows:              func() *uint32 { v := uint32(40); return &v }(),
	}))
	if err != nil {
		t.Fatalf("CreateTerminalSession: %v", err)
	}
	if createResp.Msg.GetTerminal().GetId() != "term_1" {
		t.Fatalf("create terminal id = %q", createResp.Msg.GetTerminal().GetId())
	}
	if manager.createInput.SessionID != "sess_1" || manager.createInput.BrowserInstanceID != "browser_1" || manager.createInput.TabID != "tab_1" {
		t.Fatalf("create input = %+v", manager.createInput)
	}

	getResp, err := service.GetTerminalSession(context.Background(), connect.NewRequest(&hopterv1.GetTerminalSessionRequest{
		SessionId:         "sess_1",
		BrowserInstanceId: "browser_1",
		TabId:             "tab_1",
	}))
	if err != nil {
		t.Fatalf("GetTerminalSession: %v", err)
	}
	if getResp.Msg.GetTerminal().GetSessionId() != "sess_1" {
		t.Fatalf("get terminal session id = %q", getResp.Msg.GetTerminal().GetSessionId())
	}

	terminateResp, err := service.TerminateTerminalSession(context.Background(), connect.NewRequest(&hopterv1.TerminateTerminalSessionRequest{
		TerminalId: "term_1",
	}))
	if err != nil {
		t.Fatalf("TerminateTerminalSession: %v", err)
	}
	if terminateResp.Msg.GetTerminal().GetStatus() != hopterv1.TerminalStatus_TERMINAL_STATUS_TERMINATED {
		t.Fatalf("terminate status = %v", terminateResp.Msg.GetTerminal().GetStatus())
	}

	tabResp, err := service.TerminateTerminalTab(context.Background(), connect.NewRequest(&hopterv1.TerminateTerminalTabRequest{
		BrowserInstanceId: "browser_1",
		TabId:             "tab_1",
	}))
	if err != nil {
		t.Fatalf("TerminateTerminalTab: %v", err)
	}
	if manager.tabTerminateCall.browserInstanceID != "browser_1" || manager.tabTerminateCall.tabID != "tab_1" {
		t.Fatalf("tab terminate call = %+v", manager.tabTerminateCall)
	}
	if tabResp.Msg.GetTerminatedCount() != 0 {
		t.Fatalf("terminated count = %d, want 0", tabResp.Msg.GetTerminatedCount())
	}
}

func TestTerminalServiceGetMissingTerminalReturnsEmptyLookup(t *testing.T) {
	manager := &fakeTerminalManager{
		getErr: terminal.ErrTerminalSessionNotFound,
	}
	service := NewTerminalService(manager)

	getResp, err := service.GetTerminalSession(context.Background(), connect.NewRequest(&hopterv1.GetTerminalSessionRequest{
		SessionId:         "sess_1",
		BrowserInstanceId: "browser_1",
		TabId:             "tab_1",
	}))
	if err != nil {
		t.Fatalf("GetTerminalSession missing terminal: %v", err)
	}
	if getResp.Msg.GetTerminal() != nil {
		t.Fatalf("missing terminal returned terminal = %+v", getResp.Msg.GetTerminal())
	}
}
