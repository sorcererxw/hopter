package backend

import (
	"fmt"
	"strings"

	"orchd/internal/core"
)

const DefaultBackendKey = "codex"

type ResolvedSession struct {
	Project core.Project
	Session core.Session
}

type Runtime interface {
	ListSessions(projectID string, limit uint32) ([]ResolvedSession, error)
	GetSession(sessionID string) (core.Session, core.Project, error)
	CreateSession(input core.CreateSessionInput) (core.Session, error)
	SendSessionInput(sessionID, input string) (core.Session, error)
}

type Manager struct {
	workspace core.WorkspaceService
	runtimes  map[string]Runtime
}

func NewManager(workspace core.WorkspaceService, runtimes map[string]Runtime) *Manager {
	copied := make(map[string]Runtime, len(runtimes))
	for key, runtime := range runtimes {
		copied[normalizeBackendKey(key)] = runtime
	}
	return &Manager{
		workspace: workspace,
		runtimes:  copied,
	}
}

func (m *Manager) ListSessions(projectID string, limit uint32) ([]ResolvedSession, error) {
	var result []ResolvedSession
	for key, runtime := range m.runtimes {
		resolved, err := runtime.ListSessions(projectID, limit)
		if err != nil {
			continue
		}
		resolved = m.normalizeResolvedSessionsWithKey(resolved, key)
		result = append(result, resolved...)
		if limit > 0 && len(result) >= int(limit) {
			return result[:limit], nil
		}
	}
	if len(result) == 0 {
		return nil, fmt.Errorf("no backend runtime returned sessions")
	}
	return result, nil
}

func (m *Manager) GetSession(sessionID string) (core.Session, core.Project, error) {
	if session, ok := m.workspace.GetSession(sessionID); ok {
		project, ok := m.workspace.GetProject(session.ProjectID)
		if !ok {
			return core.Session{}, core.Project{}, fmt.Errorf("project %q not found for session", session.ProjectID)
		}
		backendKey := normalizeBackendKey(session.BackendKey, project.DefaultBackend)
		runtime, ok := m.runtimes[backendKey]
		if !ok {
			return core.Session{}, core.Project{}, fmt.Errorf("backend runtime %q not registered", backendKey)
		}
		resolvedSession, resolvedProject, err := runtime.GetSession(sessionID)
		if err != nil {
			return core.Session{}, core.Project{}, err
		}
		session, project := m.normalizeSession(resolvedSession, resolvedProject, backendKey)
		return session, project, nil
	}

	for key, runtime := range m.runtimes {
		session, project, err := runtime.GetSession(sessionID)
		if err == nil {
			session, project := m.normalizeSession(session, project, key)
			return session, project, nil
		}
	}

	return core.Session{}, core.Project{}, fmt.Errorf("session %q not found", sessionID)
}

func (m *Manager) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	project, ok := m.workspace.GetProject(input.ProjectID)
	if !ok {
		return core.Session{}, fmt.Errorf("project %q not found", input.ProjectID)
	}
	backendKey := normalizeBackendKey(input.BackendKey, project.DefaultBackend)
	runtime, ok := m.runtimes[backendKey]
	if !ok {
		return core.Session{}, fmt.Errorf("backend runtime %q not registered", backendKey)
	}
	session, err := runtime.CreateSession(input)
	if err != nil {
		return core.Session{}, err
	}
	session, _ = m.normalizeSession(session, project, backendKey)
	return session, nil
}

func (m *Manager) SendSessionInput(sessionID, input string) (core.Session, error) {
	session, ok := m.workspace.GetSession(sessionID)
	if !ok {
		resolved, project, err := m.GetSession(sessionID)
		if err != nil {
			return core.Session{}, err
		}
		session = resolved
		if strings.TrimSpace(session.ProjectID) == "" {
			session.ProjectID = project.ID
		}
	}
	project, ok := m.workspace.GetProject(session.ProjectID)
	if !ok {
		return core.Session{}, fmt.Errorf("project %q not found", session.ProjectID)
	}
	backendKey := normalizeBackendKey(session.BackendKey, project.DefaultBackend)
	runtime, ok := m.runtimes[backendKey]
	if !ok {
		return core.Session{}, fmt.Errorf("backend runtime %q not registered", backendKey)
	}
	updated, err := runtime.SendSessionInput(sessionID, input)
	if err != nil {
		return core.Session{}, err
	}
	updated, _ = m.normalizeSession(updated, project, backendKey)
	return updated, nil
}

func (m *Manager) normalizeResolvedSessions(resolved []ResolvedSession) []ResolvedSession {
	normalized := make([]ResolvedSession, 0, len(resolved))
	for _, item := range resolved {
		session, project := m.normalizeSession(item.Session, item.Project, item.Session.BackendKey)
		normalized = append(normalized, ResolvedSession{
			Project: project,
			Session: session,
		})
	}
	return normalized
}

func (m *Manager) normalizeResolvedSessionsWithKey(resolved []ResolvedSession, backendKey string) []ResolvedSession {
	normalized := make([]ResolvedSession, 0, len(resolved))
	for _, item := range resolved {
		session, project := m.normalizeSession(item.Session, item.Project, backendKey)
		normalized = append(normalized, ResolvedSession{
			Project: project,
			Session: session,
		})
	}
	return normalized
}

func (m *Manager) normalizeSession(session core.Session, project core.Project, fallbackBackendKey string) (core.Session, core.Project) {
	session.BackendKey = normalizeBackendKey(session.BackendKey, fallbackBackendKey, project.DefaultBackend)
	if strings.TrimSpace(session.ProjectID) == "" {
		session.ProjectID = project.ID
	}
	return session, project
}

func normalizeBackendKey(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return strings.TrimSpace(strings.ToLower(value))
		}
	}
	return DefaultBackendKey
}
