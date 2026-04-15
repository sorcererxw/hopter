package rpcserver

import (
	"context"
	"fmt"

	"connectrpc.com/connect"

	"orchd/internal/codex"
	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type SessionService struct {
	workspace core.WorkspaceService
	codex     *codex.Manager
}

func NewSessionService(workspace core.WorkspaceService, codexManager *codex.Manager) *SessionService {
	return &SessionService{workspace: workspace, codex: codexManager}
}

func (s *SessionService) ListSessions(_ context.Context, req *connect.Request[orchdv1.ListSessionsRequest]) (*connect.Response[orchdv1.ListSessionsResponse], error) {
	sessions := s.workspace.ListSessions(core.ListSessionsInput{
		ProjectID: req.Msg.GetProjectId(),
		Limit:     req.Msg.GetLimit(),
	})
	response := &orchdv1.ListSessionsResponse{
		Sessions: make([]*orchdv1.SessionListItem, 0, len(sessions)),
	}
	for _, session := range sessions {
		project, ok := s.workspace.GetProject(session.ProjectID)
		if !ok {
			continue
		}
		response.Sessions = append(response.Sessions, sessionListItemToProto(project, session))
	}
	return connect.NewResponse(response), nil
}

func (s *SessionService) GetSession(_ context.Context, req *connect.Request[orchdv1.GetSessionRequest]) (*connect.Response[orchdv1.GetSessionResponse], error) {
	session, ok := s.workspace.GetSession(req.Msg.GetSessionId())
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q not found", req.Msg.GetSessionId()))
	}
	project, ok := s.workspace.GetProject(session.ProjectID)
	if !ok {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("project %q not found for session", session.ProjectID))
	}
	return connect.NewResponse(&orchdv1.GetSessionResponse{
		Session: sessionToProto(project, session),
	}), nil
}

func (s *SessionService) CreateSession(_ context.Context, req *connect.Request[orchdv1.CreateSessionRequest]) (*connect.Response[orchdv1.CreateSessionResponse], error) {
	session, err := s.codex.CreateSession(core.CreateSessionInput{
		ProjectID: req.Msg.GetProjectId(),
		Title:     req.Msg.GetTitle(),
		Prompt:    req.Msg.GetPrompt(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	project, _ := s.workspace.GetProject(session.ProjectID)
	return connect.NewResponse(&orchdv1.CreateSessionResponse{
		Session: sessionToProto(project, session),
	}), nil
}

func (s *SessionService) SendSessionInput(_ context.Context, req *connect.Request[orchdv1.SendSessionInputRequest]) (*connect.Response[orchdv1.SendSessionInputResponse], error) {
	session, err := s.codex.SendSessionInput(req.Msg.GetSessionId(), req.Msg.GetInput())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&orchdv1.SendSessionInputResponse{
		Accepted:  true,
		SessionId: session.ID,
		UpdatedAt: timestamp(session.UpdatedAt),
	}), nil
}

func (s *SessionService) RespondToSessionApproval(_ context.Context, req *connect.Request[orchdv1.RespondToSessionApprovalRequest]) (*connect.Response[orchdv1.RespondToSessionApprovalResponse], error) {
	return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("approval handling for session %q is not implemented in the Go skeleton", req.Msg.GetSessionId()))
}

func (s *SessionService) ListSessionArtifacts(_ context.Context, req *connect.Request[orchdv1.ListSessionArtifactsRequest]) (*connect.Response[orchdv1.ListSessionArtifactsResponse], error) {
	artifacts, err := s.workspace.ListSessionArtifacts(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	response := &orchdv1.ListSessionArtifactsResponse{
		Artifacts: make([]*orchdv1.ArtifactRef, 0, len(artifacts)),
	}
	for _, artifact := range artifacts {
		response.Artifacts = append(response.Artifacts, &orchdv1.ArtifactRef{
			Id:          artifact.ID,
			Kind:        mapArtifactKind(artifact.Kind),
			Label:       artifact.Label,
			CreatedAt:   timestamp(artifact.CreatedAt),
			DownloadUrl: artifact.DownloadURL,
			ContentType: artifact.ContentType,
		})
	}
	return connect.NewResponse(response), nil
}
