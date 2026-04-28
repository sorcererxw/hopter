package rpcserver

import (
	"context"
	"fmt"
	"slices"
	"strings"

	"connectrpc.com/connect"

	"github.com/sorcererxw/hopter/internal/agents"
	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
)

type SessionService struct {
	workspace core.WorkspaceService
	agents    sessionRuntime
	reader    sessionDetailReader
}

type sessionRuntime interface {
	ListSessions(projectID string, limit uint32) ([]agents.ResolvedSession, error)
	GetSession(sessionID string) (core.Session, core.Project, error)
	CreateSession(input core.CreateSessionInput) (core.Session, error)
	SendSessionInput(sessionID, input string, options ...core.SessionTurnOptions) (core.Session, error)
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
	agentRuntime sessionRuntime,
	readers ...sessionDetailReader,
) *SessionService {
	var reader sessionDetailReader
	if len(readers) > 0 {
		reader = readers[0]
	} else if runtimeReader, ok := agentRuntime.(sessionDetailReader); ok {
		reader = runtimeReader
	}
	return &SessionService{workspace: workspace, agents: agentRuntime, reader: reader}
}

func (s *SessionService) ListSessions(_ context.Context, req *connect.Request[hopterv1.ListSessionsRequest]) (*connect.Response[hopterv1.ListSessionsResponse], error) {
	resolvedSessions, err := s.agents.ListSessions(req.Msg.GetProjectId(), req.Msg.GetLimit())
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
	response := &hopterv1.ListSessionsResponse{
		Sessions: make([]*hopterv1.SessionListItem, 0, len(resolvedSessions)),
	}
	for _, resolved := range resolvedSessions {
		response.Sessions = append(response.Sessions, sessionListItemToProto(resolved.Project, resolved.Session))
	}
	return connect.NewResponse(response), nil
}

func mergeResolvedSessions(
	remote []agents.ResolvedSession,
	local []core.Session,
	workspace core.WorkspaceService,
	limit uint32,
) []agents.ResolvedSession {
	merged := make([]agents.ResolvedSession, 0, len(remote)+len(local))
	seen := make(map[string]struct{}, len(remote)+len(local))

	for _, resolved := range remote {
		merged = append(merged, resolved)
		markSessionSeen(seen, resolved.Session)
	}

	for _, session := range local {
		if sessionSeen(seen, session) {
			continue
		}
		project, ok := workspace.GetProject(session.ProjectID)
		if !ok {
			continue
		}
		merged = append(merged, agents.ResolvedSession{
			Project: project,
			Session: session,
		})
		markSessionSeen(seen, session)
	}

	slices.SortFunc(merged, func(left, right agents.ResolvedSession) int {
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

func markSessionSeen(seen map[string]struct{}, session core.Session) {
	if id := strings.TrimSpace(session.ID); id != "" {
		seen[id] = struct{}{}
	}
	if threadID := strings.TrimSpace(session.BackendThreadID); threadID != "" {
		seen[threadID] = struct{}{}
	}
}

func sessionSeen(seen map[string]struct{}, session core.Session) bool {
	if id := strings.TrimSpace(session.ID); id != "" {
		if _, ok := seen[id]; ok {
			return true
		}
	}
	if threadID := strings.TrimSpace(session.BackendThreadID); threadID != "" {
		if _, ok := seen[threadID]; ok {
			return true
		}
	}
	return false
}

func (s *SessionService) GetSession(_ context.Context, req *connect.Request[hopterv1.GetSessionRequest]) (*connect.Response[hopterv1.GetSessionResponse], error) {
	session, project, err := s.agents.GetSession(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&hopterv1.GetSessionResponse{
		Session: sessionToProto(project, session),
	}), nil
}

func (s *SessionService) GetSessionMeta(_ context.Context, req *connect.Request[hopterv1.GetSessionMetaRequest]) (*connect.Response[hopterv1.GetSessionMetaResponse], error) {
	if s.reader == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("session reader unavailable"))
	}
	meta, err := s.reader.GetSessionMeta(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&hopterv1.GetSessionMetaResponse{
		Session: sessionMetaToProto(meta),
	}), nil
}

func (s *SessionService) GetSessionReview(_ context.Context, req *connect.Request[hopterv1.GetSessionReviewRequest]) (*connect.Response[hopterv1.GetSessionReviewResponse], error) {
	if s.reader == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("session reader unavailable"))
	}
	review, err := s.reader.GetSessionReview(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q review not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&hopterv1.GetSessionReviewResponse{
		Review: sessionReviewToProto(review),
	}), nil
}

func (s *SessionService) GetSessionFile(_ context.Context, req *connect.Request[hopterv1.GetSessionFileRequest]) (*connect.Response[hopterv1.GetSessionFileResponse], error) {
	if s.reader == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("session reader unavailable"))
	}
	file, err := s.reader.GetSessionFile(core.GetSessionFileInput{
		SessionID: req.Msg.GetSessionId(),
		Path:      req.Msg.GetPath(),
		Line:      req.Msg.GetLine(),
		Column:    req.Msg.GetColumn(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q file not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&hopterv1.GetSessionFileResponse{
		File: sessionFileToProto(file),
	}), nil
}

func (s *SessionService) ListSessionTranscript(_ context.Context, req *connect.Request[hopterv1.ListSessionTranscriptRequest]) (*connect.Response[hopterv1.ListSessionTranscriptResponse], error) {
	if s.reader == nil {
		return nil, connect.NewError(connect.CodeUnimplemented, fmt.Errorf("session reader unavailable"))
	}
	page, err := s.reader.ListSessionTranscript(core.ListSessionTranscriptInput{
		SessionID:    req.Msg.GetSessionId(),
		BeforeCursor: req.Msg.GetBeforeCursor(),
		Limit:        req.Msg.GetLimit(),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeNotFound, fmt.Errorf("session %q transcript not found", req.Msg.GetSessionId()))
	}
	return connect.NewResponse(&hopterv1.ListSessionTranscriptResponse{
		Page: sessionTranscriptPageToProto(page),
	}), nil
}

func (s *SessionService) CreateSession(_ context.Context, req *connect.Request[hopterv1.CreateSessionRequest]) (*connect.Response[hopterv1.CreateSessionResponse], error) {
	session, err := s.agents.CreateSession(core.CreateSessionInput{
		ProjectID:       req.Msg.GetProjectId(),
		BackendKey:      req.Msg.GetBackendKey(),
		Title:           req.Msg.GetTitle(),
		Prompt:          req.Msg.GetPrompt(),
		Model:           req.Msg.GetModel(),
		ReasoningEffort: req.Msg.GetReasoningEffort(),
		CodexFastMode:   req.Msg.GetCodexFastMode(),
		Attachments:     sessionInputAttachmentsFromProto(req.Msg.GetAttachments()),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	project, _ := s.workspace.GetProject(session.ProjectID)
	return connect.NewResponse(&hopterv1.CreateSessionResponse{
		Session: sessionToProto(project, session),
	}), nil
}

func (s *SessionService) SendSessionInput(_ context.Context, req *connect.Request[hopterv1.SendSessionInputRequest]) (*connect.Response[hopterv1.SendSessionInputResponse], error) {
	session, err := s.agents.SendSessionInput(req.Msg.GetSessionId(), req.Msg.GetInput(), core.SessionTurnOptions{
		Model:           req.Msg.GetModel(),
		ReasoningEffort: req.Msg.GetReasoningEffort(),
		CodexFastMode:   req.Msg.GetCodexFastMode(),
		Attachments:     sessionInputAttachmentsFromProto(req.Msg.GetAttachments()),
	})
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&hopterv1.SendSessionInputResponse{
		Accepted:  true,
		SessionId: session.ID,
		UpdatedAt: timestamp(session.UpdatedAt),
	}), nil
}

func sessionInputAttachmentsFromProto(attachments []*hopterv1.SessionInputAttachment) []core.SessionInputAttachment {
	if len(attachments) == 0 {
		return nil
	}
	result := make([]core.SessionInputAttachment, 0, len(attachments))
	for _, attachment := range attachments {
		if attachment == nil || strings.TrimSpace(attachment.GetUrl()) == "" {
			continue
		}
		result = append(result, core.SessionInputAttachment{
			Label:       strings.TrimSpace(attachment.GetLabel()),
			URL:         strings.TrimSpace(attachment.GetUrl()),
			ContentType: strings.TrimSpace(attachment.GetContentType()),
		})
	}
	return result
}

func (s *SessionService) InterruptSession(_ context.Context, req *connect.Request[hopterv1.InterruptSessionRequest]) (*connect.Response[hopterv1.InterruptSessionResponse], error) {
	session, err := s.agents.InterruptSession(req.Msg.GetSessionId())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&hopterv1.InterruptSessionResponse{
		Accepted:  true,
		SessionId: session.ID,
		UpdatedAt: timestamp(session.UpdatedAt),
	}), nil
}

func (s *SessionService) RespondToSessionApproval(_ context.Context, req *connect.Request[hopterv1.RespondToSessionApprovalRequest]) (*connect.Response[hopterv1.RespondToSessionApprovalResponse], error) {
	decision, err := mapApprovalDecision(req.Msg.GetDecision())
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	session, err := s.agents.RespondToSessionApproval(
		req.Msg.GetSessionId(),
		req.Msg.GetApprovalId(),
		decision,
	)
	if err != nil {
		return nil, connect.NewError(connect.CodeInvalidArgument, err)
	}
	return connect.NewResponse(&hopterv1.RespondToSessionApprovalResponse{
		Accepted:  true,
		SessionId: session.ID,
		UpdatedAt: timestamp(session.UpdatedAt),
	}), nil
}

func (s *SessionService) ListSessionArtifacts(_ context.Context, req *connect.Request[hopterv1.ListSessionArtifactsRequest]) (*connect.Response[hopterv1.ListSessionArtifactsResponse], error) {
	response := &hopterv1.ListSessionArtifactsResponse{}
	sessionID := strings.TrimSpace(req.Msg.GetSessionId())
	if sessionID == "" {
		return nil, connect.NewError(connect.CodeInvalidArgument, fmt.Errorf("session id is required"))
	}

	artifacts, err := s.workspace.ListSessionArtifacts(sessionID)
	if err != nil {
		return connect.NewResponse(response), nil
	}
	response.Artifacts = make([]*hopterv1.ArtifactRef, 0, len(artifacts))
	for _, artifact := range artifacts {
		response.Artifacts = append(response.Artifacts, &hopterv1.ArtifactRef{
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

func mapApprovalDecision(decision hopterv1.ApprovalDecision) (core.ApprovalDecision, error) {
	switch decision {
	case hopterv1.ApprovalDecision_APPROVAL_DECISION_APPROVE:
		return core.ApprovalDecisionApprove, nil
	case hopterv1.ApprovalDecision_APPROVAL_DECISION_REJECT:
		return core.ApprovalDecisionReject, nil
	default:
		return "", fmt.Errorf("approval decision is required")
	}
}
