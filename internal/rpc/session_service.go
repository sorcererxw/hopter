package rpcserver

import (
	"context"
	"fmt"
	"slices"

	"connectrpc.com/connect"

	"orchd/internal/backend"
	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type SessionService struct {
	workspace core.WorkspaceService
	codex     sessionRuntime
	reader    sessionDetailReader
}

type sessionRuntime interface {
	ListSessions(projectID string, limit uint32) ([]backend.ResolvedSession, error)
	GetSession(sessionID string) (core.Session, core.Project, error)
	CreateSession(input core.CreateSessionInput) (core.Session, error)
	SendSessionInput(sessionID, input string) (core.Session, error)
	InterruptSession(sessionID string) (core.Session, error)
	RespondToSessionApproval(sessionID, approvalID string, decision core.ApprovalDecision) (core.Session, error)
}

type sessionDetailReader interface {
	GetSessionMeta(sessionID string) (core.SessionMeta, error)
	GetSessionReview(sessionID string) (core.SessionReview, error)
	GetSessionFile(input core.GetSessionFileInput) (core.SessionFile, error)
	ListSessionTranscript(input core.ListSessionTranscriptInput) (core.SessionTranscriptPage, error)
}

func NewSessionService(
	workspace core.WorkspaceService,
	codexManager sessionRuntime,
	reader sessionDetailReader,
) *SessionService {
	return &SessionService{workspace: workspace, codex: codexManager, reader: reader}
}

func (s *SessionService) ListSessions(_ context.Context, req *connect.Request[orchdv1.ListSessionsRequest]) (*connect.Response[orchdv1.ListSessionsResponse], error) {
	resolvedSessions, err := s.codex.ListSessions(req.Msg.GetProjectId(), req.Msg.GetLimit())
	if err != nil {
		resolvedSessions = nil
	}
	resolvedSessions = mergeResolvedSessions(
		resolvedSessions,
		s.workspace.ListSessions(core.ListSessionsInput{
			ProjectID: req.Msg.GetProjectId(),
			Limit:     req.Msg.GetLimit(),
		}),
		s.workspace,
		req.Msg.GetLimit(),
	)
	response := &orchdv1.ListSessionsResponse{
		Sessions: make([]*orchdv1.SessionListItem, 0, len(resolvedSessions)),
	}
	for _, resolved := range resolvedSessions {
		response.Sessions = append(response.Sessions, sessionListItemToProto(resolved.Project, resolved.Session))
	}
	return connect.NewResponse(response), nil
}

func mergeResolvedSessions(
	remote []backend.ResolvedSession,
	local []core.Session,
	workspace core.WorkspaceService,
	limit uint32,
) []backend.ResolvedSession {
	merged := make([]backend.ResolvedSession, 0, len(remote)+len(local))
	seen := make(map[string]struct{}, len(remote)+len(local))

	for _, resolved := range remote {
		merged = append(merged, resolved)
		seen[resolved.Session.ID] = struct{}{}
	}

	for _, session := range local {
		if _, ok := seen[session.ID]; ok {
			continue
		}
		project, ok := workspace.GetProject(session.ProjectID)
		if !ok {
			continue
		}
		merged = append(merged, backend.ResolvedSession{
			Project: project,
			Session: session,
		})
		seen[session.ID] = struct{}{}
	}

	slices.SortFunc(merged, func(left, right backend.ResolvedSession) int {
		switch {
		case left.Session.UpdatedAt.After(right.Session.UpdatedAt):
			return -1
		case left.Session.UpdatedAt.Before(right.Session.UpdatedAt):
			return 1
		default:
			return 0
		}
	})

	if limit > 0 && len(merged) > int(limit) {
		return merged[:limit]
	}

	return merged
}

func (s *SessionService) GetSession(_ context.Context, req *connect.Request[orchdv1.GetSessionRequest]) (*connect.Response[orchdv1.GetSessionResponse], error) {
	session, project, err := s.codex.GetSession(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&orchdv1.GetSessionResponse{
		Session: sessionToProto(project, session),
	}), nil
}

func (s *SessionService) GetSessionMeta(_ context.Context, req *connect.Request[orchdv1.GetSessionMetaRequest]) (*connect.Response[orchdv1.GetSessionMetaResponse], error) {
	meta, err := s.reader.GetSessionMeta(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&orchdv1.GetSessionMetaResponse{
		Session: sessionMetaToProto(meta),
	}), nil
}

func (s *SessionService) GetSessionReview(_ context.Context, req *connect.Request[orchdv1.GetSessionReviewRequest]) (*connect.Response[orchdv1.GetSessionReviewResponse], error) {
	review, err := s.reader.GetSessionReview(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q review not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&orchdv1.GetSessionReviewResponse{
		Review: sessionReviewToProto(review),
	}), nil
}

func (s *SessionService) GetSessionFile(_ context.Context, req *connect.Request[orchdv1.GetSessionFileRequest]) (*connect.Response[orchdv1.GetSessionFileResponse], error) {
	file, err := s.reader.GetSessionFile(core.GetSessionFileInput{
		SessionID: req.Msg.GetSessionId(),
		Path:      req.Msg.GetPath(),
		Line:      req.Msg.GetLine(),
		Column:    req.Msg.GetColumn(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q file not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&orchdv1.GetSessionFileResponse{
		File: sessionFileToProto(file),
	}), nil
}

func (s *SessionService) ListSessionTranscript(_ context.Context, req *connect.Request[orchdv1.ListSessionTranscriptRequest]) (*connect.Response[orchdv1.ListSessionTranscriptResponse], error) {
	page, err := s.reader.ListSessionTranscript(core.ListSessionTranscriptInput{
		SessionID:    req.Msg.GetSessionId(),
		BeforeCursor: req.Msg.GetBeforeCursor(),
		Limit:        req.Msg.GetLimit(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q transcript not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&orchdv1.ListSessionTranscriptResponse{
		Page: sessionTranscriptPageToProto(page),
	}), nil
}

func (s *SessionService) CreateSession(_ context.Context, req *connect.Request[orchdv1.CreateSessionRequest]) (*connect.Response[orchdv1.CreateSessionResponse], error) {
	session, err := s.codex.CreateSession(core.CreateSessionInput{
		ProjectID:  req.Msg.GetProjectId(),
		BackendKey: req.Msg.GetBackendKey(),
		Title:      req.Msg.GetTitle(),
		Prompt:     req.Msg.GetPrompt(),
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

func (s *SessionService) InterruptSession(_ context.Context, req *connect.Request[orchdv1.InterruptSessionRequest]) (*connect.Response[orchdv1.InterruptSessionResponse], error) {
	session, err := s.codex.InterruptSession(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&orchdv1.InterruptSessionResponse{
		Accepted:  true,
		SessionId: session.ID,
		UpdatedAt: timestamp(session.UpdatedAt),
	}), nil
}

func (s *SessionService) RespondToSessionApproval(_ context.Context, req *connect.Request[orchdv1.RespondToSessionApprovalRequest]) (*connect.Response[orchdv1.RespondToSessionApprovalResponse], error) {
	decision, err := mapApprovalDecision(req.Msg.GetDecision())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	session, err := s.codex.RespondToSessionApproval(
		req.Msg.GetSessionId(),
		req.Msg.GetApprovalId(),
		decision,
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&orchdv1.RespondToSessionApprovalResponse{
		Accepted:  true,
		SessionId: session.ID,
		UpdatedAt: timestamp(session.UpdatedAt),
	}), nil
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

func mapApprovalDecision(decision orchdv1.ApprovalDecision) (core.ApprovalDecision, error) {
	switch decision {
	case orchdv1.ApprovalDecision_APPROVAL_DECISION_APPROVE:
		return core.ApprovalDecisionApprove, nil
	case orchdv1.ApprovalDecision_APPROVAL_DECISION_REJECT:
		return core.ApprovalDecisionReject, nil
	default:
		return "", fmt.Errorf("approval decision is required")
	}
}
