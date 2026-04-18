package copilot

import (
	"context"
	"encoding/json"
	"fmt"
	"strings"
	"sync"
	"time"

	githubcopilot "github.com/github/copilot-sdk/go"

	"orchd/internal/backend"
	"orchd/internal/core"
)

type Manager struct {
	workspace core.WorkspaceService
	client    *githubcopilot.Client

	mu   sync.Mutex
	live map[string]*liveSession
}

type liveSession struct {
	project          core.Project
	session          *githubcopilot.Session
	backendSessionID string
}

func NewManager(workspace core.WorkspaceService) *Manager {
	return &Manager{
		workspace: workspace,
		client: githubcopilot.NewClient(&githubcopilot.ClientOptions{
			LogLevel: "error",
		}),
		live: make(map[string]*liveSession),
	}
}

func (m *Manager) ListSessions(projectID string, limit uint32) ([]backend.ResolvedSession, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	var filter *githubcopilot.SessionListFilter
	if strings.TrimSpace(projectID) != "" {
		project, ok := m.workspace.GetProject(projectID)
		if !ok {
			return nil, fmt.Errorf("project %q not found", projectID)
		}
		filter = &githubcopilot.SessionListFilter{
			Cwd: project.RootPath,
		}
	}

	metadata, err := m.client.ListSessions(ctx, filter)
	if err != nil {
		return nil, err
	}

	projects := m.workspace.ListProjects()
	result := make([]backend.ResolvedSession, 0, len(metadata))
	for _, item := range metadata {
		project := projectForMetadata(projects, item)
		if strings.TrimSpace(projectID) != "" && project.ID != projectID {
			continue
		}
		session := sessionFromMetadata(item, project)
		if local, ok := m.sessionByBackendID(item.SessionID); ok {
			session.ID = local.ID
			session.AttentionRequired = local.AttentionRequired
			session.AttentionReason = local.AttentionReason
			session.LastInputHint = local.LastInputHint
			session.Artifacts = append([]core.Artifact(nil), local.Artifacts...)
			if strings.TrimSpace(local.Title) != "" {
				session.Title = local.Title
			}
			if strings.TrimSpace(local.Summary) != "" {
				session.Summary = local.Summary
			}
			if local.Status != "" && local.Status != core.SessionStatePending {
				session.Status = local.Status
			}
		}
		result = append(result, backend.ResolvedSession{
			Project: project,
			Session: session,
		})
		if limit > 0 && len(result) >= int(limit) {
			break
		}
	}

	return result, nil
}

func (m *Manager) GetSession(sessionID string) (core.Session, core.Project, error) {
	if local, ok := m.workspace.GetSession(sessionID); ok {
		project, ok := m.workspace.GetProject(local.ProjectID)
		if !ok {
			return core.Session{}, core.Project{}, fmt.Errorf("project %q not found for session", local.ProjectID)
		}
		backendSessionID := strings.TrimSpace(local.BackendThreadID)
		if backendSessionID == "" {
			return local, project, nil
		}
		session, resolvedProject, err := m.fetchSession(project, local, backendSessionID)
		if err != nil {
			return local, project, nil
		}
		return session, resolvedProject, nil
	}

	m.mu.Lock()
	for _, live := range m.live {
		if live.backendSessionID == sessionID {
			project := live.project
			m.mu.Unlock()
			session, resolvedProject, err := m.fetchSession(project, core.Session{}, sessionID)
			if err != nil {
				return core.Session{}, core.Project{}, err
			}
			return session, resolvedProject, nil
		}
	}
	m.mu.Unlock()

	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	meta, err := m.client.GetSessionMetadata(ctx, sessionID)
	if err != nil || meta == nil {
		return core.Session{}, core.Project{}, fmt.Errorf("session %q not found", sessionID)
	}
	project := projectForMetadata(m.workspace.ListProjects(), *meta)
	session := sessionFromMetadata(*meta, project)
	session.BackendThreadID = sessionID
	session, project, err = m.fetchSession(project, session, sessionID)
	if err != nil {
		return session, project, nil
	}
	return session, project, nil
}

func (m *Manager) RespondToSessionApproval(
	sessionID, approvalID string,
	decision core.ApprovalDecision,
) (core.Session, error) {
	return core.Session{}, fmt.Errorf("copilot backend does not support approvals for session %q", sessionID)
}

func (m *Manager) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	project, ok := m.workspace.GetProject(input.ProjectID)
	if !ok {
		return core.Session{}, fmt.Errorf("project %q not found", input.ProjectID)
	}
	local, err := m.workspace.CreateSession(input)
	if err != nil {
		return core.Session{}, err
	}
	go m.runSession(project, local.ID, input.Prompt)
	return local, nil
}

func (m *Manager) SendSessionInput(sessionID, input string) (core.Session, error) {
	local, ok := m.workspace.GetSession(sessionID)
	if !ok {
		return core.Session{}, fmt.Errorf("session %q not found", sessionID)
	}
	project, ok := m.workspace.GetProject(local.ProjectID)
	if !ok {
		return core.Session{}, fmt.Errorf("project %q not found", local.ProjectID)
	}
	updated, err := m.workspace.SendSessionInput(sessionID, input)
	if err != nil {
		return core.Session{}, err
	}
	go m.dispatchInput(project, sessionID, local.BackendThreadID, input)
	return updated, nil
}

func (m *Manager) runSession(project core.Project, sessionID, prompt string) {
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()

	session, err := m.client.CreateSession(ctx, &githubcopilot.SessionConfig{
		OnPermissionRequest: githubcopilot.PermissionHandler.ApproveAll,
		OnEvent: func(event githubcopilot.SessionEvent) {
			m.handleEvent(sessionID, event)
		},
		Streaming:        true,
		WorkingDirectory: project.RootPath,
	})
	if err != nil {
		m.failSession(sessionID, fmt.Errorf("create copilot session: %w", err))
		return
	}

	backendSessionID := session.SessionID
	running := core.SessionStateRunning
	summary := "Copilot session started. Running the first turn…"
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		BackendKey:      ptrString("copilot"),
		BackendThreadID: &backendSessionID,
		Status:          &running,
		Summary:         &summary,
	})

	m.mu.Lock()
	m.live[sessionID] = &liveSession{
		project:          project,
		session:          session,
		backendSessionID: backendSessionID,
	}
	m.mu.Unlock()

	if _, err := session.Send(ctx, githubcopilot.MessageOptions{
		Prompt: prompt,
	}); err != nil {
		m.releaseLiveSession(sessionID)
		m.failSession(sessionID, fmt.Errorf("send initial copilot prompt: %w", err))
	}
}

func (m *Manager) dispatchInput(project core.Project, sessionID, backendSessionID, input string) {
	if strings.TrimSpace(backendSessionID) == "" {
		m.failSession(sessionID, fmt.Errorf("copilot session %q is missing backend session id", sessionID))
		return
	}

	live, err := m.ensureLiveSession(project, sessionID, backendSessionID)
	if err != nil {
		m.failSession(sessionID, fmt.Errorf("resume copilot session: %w", err))
		return
	}
	if _, err := live.session.Send(context.Background(), githubcopilot.MessageOptions{
		Prompt: input,
	}); err != nil {
		m.releaseLiveSession(sessionID)
		m.failSession(sessionID, fmt.Errorf("send copilot follow-up: %w", err))
		return
	}
}

func (m *Manager) ensureLiveSession(project core.Project, sessionID, backendSessionID string) (*liveSession, error) {
	m.mu.Lock()
	if live := m.live[sessionID]; live != nil {
		m.mu.Unlock()
		return live, nil
	}
	m.mu.Unlock()

	session, err := m.client.ResumeSession(context.Background(), backendSessionID, &githubcopilot.ResumeSessionConfig{
		OnPermissionRequest: githubcopilot.PermissionHandler.ApproveAll,
		OnEvent: func(event githubcopilot.SessionEvent) {
			m.handleEvent(sessionID, event)
		},
		Streaming:        true,
		WorkingDirectory: project.RootPath,
		DisableResume:    true,
	})
	if err != nil {
		return nil, err
	}

	live := &liveSession{
		project:          project,
		session:          session,
		backendSessionID: backendSessionID,
	}
	m.mu.Lock()
	m.live[sessionID] = live
	m.mu.Unlock()
	return live, nil
}

func (m *Manager) fetchSession(project core.Project, local core.Session, backendSessionID string) (core.Session, core.Project, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()

	meta, err := m.client.GetSessionMetadata(ctx, backendSessionID)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}

	resumed, err := m.client.ResumeSession(ctx, backendSessionID, &githubcopilot.ResumeSessionConfig{
		OnPermissionRequest: githubcopilot.PermissionHandler.ApproveAll,
		WorkingDirectory:    project.RootPath,
		DisableResume:       true,
	})
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	defer resumed.Disconnect()

	events, err := resumed.GetMessages(ctx)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}

	session := local
	if session.ID == "" {
		if meta != nil {
			session = sessionFromMetadata(*meta, project)
		} else {
			session = core.Session{
				ID:        backendSessionID,
				ProjectID: project.ID,
				Title:     backendSessionID,
				Status:    core.SessionStateCompleted,
				UpdatedAt: time.Now().UTC(),
			}
		}
	}
	session.ProjectID = project.ID
	session.BackendKey = "copilot"
	session.BackendThreadID = backendSessionID
	session.TranscriptItems = normalizeSessionEvents(events)
	if summary := latestAssistantSummary(events); strings.TrimSpace(summary) != "" {
		session.Summary = summary
	}
	if session.Summary == "" && meta != nil && meta.Summary != nil {
		session.Summary = strings.TrimSpace(*meta.Summary)
	}
	if session.Title == "" {
		session.Title = fallbackTitle(meta, backendSessionID)
	}
	if meta != nil {
		if updatedAt, err := time.Parse(time.RFC3339, meta.ModifiedTime); err == nil {
			session.UpdatedAt = updatedAt.UTC()
		}
	}
	if live := m.liveSession(session.ID); live != nil {
		session.Status = core.SessionStateRunning
	} else if local.Status == core.SessionStateRunning || local.Status == core.SessionStateWaitingApproval {
		session.Status = local.Status
	} else {
		session.Status = finalSessionState(events, local.Status)
	}
	return session, project, nil
}

func (m *Manager) handleEvent(sessionID string, event githubcopilot.SessionEvent) {
	switch data := event.Data.(type) {
	case *githubcopilot.UserMessageData:
		if item, ok := normalizeUserMessageEvent(event, data); ok {
			m.appendTranscriptItem(sessionID, item)
		}
	case *githubcopilot.AssistantMessageData:
		if item, ok := normalizeAssistantMessageEvent(event, data); ok {
			m.appendTranscriptItem(sessionID, item)
			summary := item.Body
			m.updateWorkspaceSession(sessionID, core.SessionPatch{
				Summary: &summary,
			})
		}
	case *githubcopilot.AssistantReasoningData:
		if item, ok := normalizeReasoningEvent(event, data); ok {
			m.appendTranscriptItem(sessionID, item)
		}
	case *githubcopilot.ToolExecutionCompleteData:
		if item, ok := normalizeToolExecutionEvent(event, data); ok {
			m.appendTranscriptItem(sessionID, item)
		}
	case *githubcopilot.SessionIdleData:
		status := core.SessionStateCompleted
		if data.Aborted != nil && *data.Aborted {
			status = core.SessionStateWaitingInput
		}
		summary := latestLocalSummary(m.workspace, sessionID)
		if strings.TrimSpace(summary) == "" {
			summary = "Copilot completed the turn."
		}
		m.updateWorkspaceSession(sessionID, core.SessionPatch{
			Status:  &status,
			Summary: &summary,
		})
		m.releaseLiveSession(sessionID)
	case *githubcopilot.SessionErrorData:
		m.releaseLiveSession(sessionID)
		m.failSession(sessionID, fmt.Errorf("copilot session error: %s", data.Message))
	}
}

func (m *Manager) appendTranscriptItem(sessionID string, item core.SessionTranscriptItem) {
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		AppendTranscriptItems: &[]core.SessionTranscriptItem{item},
	})
}

func (m *Manager) updateWorkspaceSession(sessionID string, patch core.SessionPatch) {
	if _, ok := m.workspace.GetSession(sessionID); ok {
		_, _ = m.workspace.UpdateSession(sessionID, patch)
	}
}

func (m *Manager) failSession(sessionID string, err error) {
	status := core.SessionStateFailed
	attention := true
	summary := err.Error()
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		Status:            &status,
		Summary:           &summary,
		AttentionRequired: &attention,
		AttentionReason:   &summary,
	})
}

func (m *Manager) liveSession(sessionID string) *liveSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.live[sessionID]
}

func (m *Manager) releaseLiveSession(sessionID string) {
	m.mu.Lock()
	live := m.live[sessionID]
	delete(m.live, sessionID)
	m.mu.Unlock()
	if live != nil && live.session != nil {
		_ = live.session.Disconnect()
	}
}

func (m *Manager) sessionByBackendID(backendSessionID string) (core.Session, bool) {
	sessions := m.workspace.ListSessions(core.ListSessionsInput{})
	for _, session := range sessions {
		if session.BackendKey == "copilot" && session.BackendThreadID == backendSessionID {
			return session, true
		}
	}
	return core.Session{}, false
}

func projectForMetadata(projects []core.Project, meta githubcopilot.SessionMetadata) core.Project {
	cwd := ""
	if meta.Context != nil {
		cwd = strings.TrimSpace(meta.Context.Cwd)
	}
	for _, project := range projects {
		if strings.TrimSpace(project.RootPath) == cwd {
			return project
		}
	}
	name := filepathBase(cwd)
	if name == "" {
		name = "copilot"
	}
	updatedAt, _ := time.Parse(time.RFC3339, meta.ModifiedTime)
	return core.Project{
		ID:             "cwd:" + cwd,
		Name:           name,
		RootPath:       cwd,
		DefaultBackend: "copilot",
		CreatedAt:      updatedAt.UTC(),
		UpdatedAt:      updatedAt.UTC(),
	}
}

func sessionFromMetadata(meta githubcopilot.SessionMetadata, project core.Project) core.Session {
	updatedAt, _ := time.Parse(time.RFC3339, meta.ModifiedTime)
	title := fallbackTitle(&meta, meta.SessionID)
	summary := "Copilot session loaded."
	if meta.Summary != nil && strings.TrimSpace(*meta.Summary) != "" {
		summary = strings.TrimSpace(*meta.Summary)
	}
	return core.Session{
		ID:              meta.SessionID,
		ProjectID:       project.ID,
		BackendKey:      "copilot",
		Title:           title,
		BackendThreadID: meta.SessionID,
		Status:          core.SessionStateCompleted,
		Summary:         summary,
		UpdatedAt:       updatedAt.UTC(),
	}
}

func fallbackTitle(meta *githubcopilot.SessionMetadata, fallback string) string {
	if meta != nil && meta.Summary != nil && strings.TrimSpace(*meta.Summary) != "" {
		return truncate(strings.TrimSpace(*meta.Summary), 72)
	}
	return fallback
}

func latestAssistantSummary(events []githubcopilot.SessionEvent) string {
	for i := len(events) - 1; i >= 0; i-- {
		if data, ok := events[i].Data.(*githubcopilot.AssistantMessageData); ok {
			if text := strings.TrimSpace(data.Content); text != "" {
				return text
			}
		}
	}
	return ""
}

func finalSessionState(events []githubcopilot.SessionEvent, fallback core.SessionState) core.SessionState {
	for i := len(events) - 1; i >= 0; i-- {
		switch data := events[i].Data.(type) {
		case *githubcopilot.SessionErrorData:
			return core.SessionStateFailed
		case *githubcopilot.SessionIdleData:
			if data.Aborted != nil && *data.Aborted {
				return core.SessionStateWaitingInput
			}
			return core.SessionStateCompleted
		}
	}
	if fallback == "" {
		return core.SessionStatePending
	}
	return fallback
}

func normalizeSessionEvents(events []githubcopilot.SessionEvent) []core.SessionTranscriptItem {
	items := make([]core.SessionTranscriptItem, 0)
	for _, event := range events {
		switch data := event.Data.(type) {
		case *githubcopilot.UserMessageData:
			if item, ok := normalizeUserMessageEvent(event, data); ok {
				items = append(items, item)
			}
		case *githubcopilot.AssistantMessageData:
			if item, ok := normalizeAssistantMessageEvent(event, data); ok {
				items = append(items, item)
			}
		case *githubcopilot.AssistantReasoningData:
			if item, ok := normalizeReasoningEvent(event, data); ok {
				items = append(items, item)
			}
		case *githubcopilot.ToolExecutionCompleteData:
			if item, ok := normalizeToolExecutionEvent(event, data); ok {
				items = append(items, item)
			}
		}
	}
	if len(items) > 200 {
		items = items[len(items)-200:]
	}
	return items
}

func normalizeUserMessageEvent(event githubcopilot.SessionEvent, data *githubcopilot.UserMessageData) (core.SessionTranscriptItem, bool) {
	body := strings.TrimSpace(data.Content)
	if body == "" {
		return core.SessionTranscriptItem{}, false
	}
	return core.SessionTranscriptItem{
		ID:    event.ID,
		Kind:  core.SessionTranscriptItemKindUserMessage,
		Title: "You",
		Body:  body,
	}, true
}

func normalizeAssistantMessageEvent(event githubcopilot.SessionEvent, data *githubcopilot.AssistantMessageData) (core.SessionTranscriptItem, bool) {
	body := strings.TrimSpace(data.Content)
	if body == "" {
		return core.SessionTranscriptItem{}, false
	}
	return core.SessionTranscriptItem{
		ID:    data.MessageID,
		Kind:  core.SessionTranscriptItemKindAgentMessage,
		Title: "Copilot",
		Body:  body,
	}, true
}

func normalizeReasoningEvent(event githubcopilot.SessionEvent, data *githubcopilot.AssistantReasoningData) (core.SessionTranscriptItem, bool) {
	body := strings.TrimSpace(data.Content)
	if body == "" {
		return core.SessionTranscriptItem{}, false
	}
	return core.SessionTranscriptItem{
		ID:    data.ReasoningID,
		Kind:  core.SessionTranscriptItemKindReasoning,
		Title: "Thinking",
		Body:  body,
	}, true
}

func normalizeToolExecutionEvent(event githubcopilot.SessionEvent, data *githubcopilot.ToolExecutionCompleteData) (core.SessionTranscriptItem, bool) {
	title := "Tool"
	kind := core.SessionTranscriptItemKindToolCall
	body := ""
	if data.Result != nil {
		if detailed := strings.TrimSpace(ptrStringValue(data.Result.DetailedContent)); detailed != "" {
			body = detailed
		} else {
			body = strings.TrimSpace(data.Result.Content)
		}
	}
	if body == "" && data.Error != nil {
		body = strings.TrimSpace(data.Error.Message)
	}
	if body == "" {
		raw, _ := json.Marshal(data)
		body = string(raw)
	}
	status := "completed"
	if !data.Success {
		status = "failed"
	}
	if strings.Contains(strings.ToLower(body), "git ") || strings.Contains(strings.ToLower(body), "status:") {
		title = "Command"
		kind = core.SessionTranscriptItemKindCommandExecution
	}
	return core.SessionTranscriptItem{
		ID:     data.ToolCallID,
		Kind:   kind,
		Title:  title,
		Body:   body,
		Status: status,
	}, true
}

func latestLocalSummary(workspace core.WorkspaceService, sessionID string) string {
	session, ok := workspace.GetSession(sessionID)
	if !ok {
		return ""
	}
	return strings.TrimSpace(session.Summary)
}

func ptrString(value string) *string {
	return &value
}

func ptrStringValue(value *string) string {
	if value == nil {
		return ""
	}
	return *value
}

func truncate(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len(value) <= limit {
		return value
	}
	return strings.TrimSpace(value[:limit])
}

func filepathBase(value string) string {
	trimmed := strings.TrimSpace(value)
	if trimmed == "" {
		return ""
	}
	parts := strings.FieldsFunc(trimmed, func(r rune) bool {
		return r == '/' || r == '\\'
	})
	if len(parts) == 0 {
		return ""
	}
	return parts[len(parts)-1]
}
