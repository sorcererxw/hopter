package rpcserver

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	orchdv1 "orchd/internal/gen/proto/orchd/v1"
	"orchd/internal/gen/proto/orchd/v1/orchdv1connect"
	"orchd/internal/terminal"
)

type TerminalService struct {
	terminals terminalManager
}

type terminalManager interface {
	CreateTerminalSession(context.Context, terminal.CreateInput) (terminal.Session, error)
	GetTerminalSession(sessionID, browserInstanceID, tabID string) (terminal.Session, error)
	TerminateTerminalSession(terminalID string) (terminal.Session, error)
	TerminateBrowserTab(browserInstanceID, tabID string) int
}

var _ orchdv1connect.TerminalServiceHandler = (*TerminalService)(nil)

func NewTerminalService(terminals terminalManager) *TerminalService {
	return &TerminalService{terminals: terminals}
}

func (s *TerminalService) CreateTerminalSession(
	ctx context.Context,
	req *connect.Request[orchdv1.CreateTerminalSessionRequest],
) (*connect.Response[orchdv1.CreateTerminalSessionResponse], error) {
	session, err := s.terminals.CreateTerminalSession(ctx, terminal.CreateInput{
		SessionID:         req.Msg.GetSessionId(),
		BrowserInstanceID: req.Msg.GetBrowserInstanceId(),
		TabID:             req.Msg.GetTabId(),
		Cols:              req.Msg.GetCols(),
		Rows:              req.Msg.GetRows(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&orchdv1.CreateTerminalSessionResponse{
		Terminal: terminalSessionToProto(session),
	}), nil
}

func (s *TerminalService) GetTerminalSession(
	_ context.Context,
	req *connect.Request[orchdv1.GetTerminalSessionRequest],
) (*connect.Response[orchdv1.GetTerminalSessionResponse], error) {
	session, err := s.terminals.GetTerminalSession(
		req.Msg.GetSessionId(),
		req.Msg.GetBrowserInstanceId(),
		req.Msg.GetTabId(),
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&orchdv1.GetTerminalSessionResponse{
		Terminal: terminalSessionToProto(session),
	}), nil
}

func (s *TerminalService) TerminateTerminalSession(
	_ context.Context,
	req *connect.Request[orchdv1.TerminateTerminalSessionRequest],
) (*connect.Response[orchdv1.TerminateTerminalSessionResponse], error) {
	session, err := s.terminals.TerminateTerminalSession(req.Msg.GetTerminalId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, err)
	}
	return connect.NewResponse(&orchdv1.TerminateTerminalSessionResponse{
		Terminal: terminalSessionToProto(session),
	}), nil
}

func (s *TerminalService) TerminateTerminalTab(
	_ context.Context,
	req *connect.Request[orchdv1.TerminateTerminalTabRequest],
) (*connect.Response[orchdv1.TerminateTerminalTabResponse], error) {
	browserInstanceID := req.Msg.GetBrowserInstanceId()
	tabID := req.Msg.GetTabId()
	if browserInstanceID == "" || tabID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("browser instance id and tab id are required"))
	}
	terminatedCount := s.terminals.TerminateBrowserTab(browserInstanceID, tabID)
	return connect.NewResponse(&orchdv1.TerminateTerminalTabResponse{
		TerminatedCount: uint32(terminatedCount),
	}), nil
}

func terminalSessionToProto(session terminal.Session) *orchdv1.TerminalSession {
	msg := &orchdv1.TerminalSession{
		Id:                           session.ID,
		ProjectId:                    session.ProjectID,
		SessionId:                    session.SessionID,
		BrowserInstanceId:            session.BrowserInstanceID,
		TabId:                        session.TabID,
		Cwd:                          session.CWD,
		Shell:                        session.Shell,
		Status:                       mapTerminalStatus(session.Status),
		CreatedAt:                    timestamp(session.CreatedAt),
		LastActivityAt:               timestamp(session.LastActivityAt),
		LastOutputAt:                 timestamp(session.LastOutputAt),
		Detached:                     session.Detached,
		LastForegroundCommandSummary: session.LastForegroundCommandSummary,
		LastForegroundCommandExited:  session.LastForegroundCommandExited,
	}
	if session.ExitCode != nil {
		exitCode := int32(*session.ExitCode)
		msg.ExitCode = &exitCode
	}
	return msg
}

func mapTerminalStatus(status terminal.Status) orchdv1.TerminalStatus {
	switch status {
	case terminal.StatusStarting:
		return orchdv1.TerminalStatus_TERMINAL_STATUS_STARTING
	case terminal.StatusLive:
		return orchdv1.TerminalStatus_TERMINAL_STATUS_LIVE
	case terminal.StatusExited:
		return orchdv1.TerminalStatus_TERMINAL_STATUS_EXITED
	case terminal.StatusTerminated:
		return orchdv1.TerminalStatus_TERMINAL_STATUS_TERMINATED
	case terminal.StatusDegraded:
		return orchdv1.TerminalStatus_TERMINAL_STATUS_DEGRADED
	case terminal.StatusFailed:
		return orchdv1.TerminalStatus_TERMINAL_STATUS_FAILED
	default:
		return orchdv1.TerminalStatus_TERMINAL_STATUS_UNSPECIFIED
	}
}

func validateTerminalManager(terminals terminalManager) error {
	if terminals == nil {
		return fmt.Errorf("terminal manager is required")
	}
	return nil
}
