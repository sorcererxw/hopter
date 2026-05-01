package agents

import (
	"fmt"
	"path/filepath"
	"slices"
	"strings"

	"github.com/sorcererxw/hopter/internal/core"
)

type AgentKey string

const (
	AgentKeyCodex     AgentKey = core.BackendKeyCodex
	DefaultAgentKey            = string(AgentKeyCodex)
	DefaultBackendKey          = DefaultAgentKey
)

type AgentCapabilities struct {
	SupportsResume         bool
	SupportsInterrupt      bool
	SupportsApprovals      bool
	SupportsRateLimits     bool
	SupportsModels         bool
	SupportsContextUsage   bool
	SupportsReasoningTrace bool
	SupportsLivePatches    bool
	SupportsArtifacts      bool
	SupportsSessionReview  bool
	SupportsSessionFiles   bool
	SupportsTranscript     bool
}

type ResolvedSession struct {
	Project core.Project
	Session core.Session
}

type AgentRuntime interface {
	Key() string
	Capabilities() AgentCapabilities
	ListSessions(projectID string, limit uint32) ([]ResolvedSession, error)
	GetSession(sessionID string) (core.Session, core.Project, error)
	CreateSession(input core.CreateSessionInput) (core.Session, error)
	SendSessionInput(sessionID, input string, options ...core.SessionTurnOptions) (core.Session, error)
	RollbackSessionInput(sessionID string, target core.SessionRollbackTarget, input string, options ...core.SessionTurnOptions) (core.SessionRollbackResult, error)
	InterruptSession(sessionID string) (core.Session, error)
	RespondToSessionApproval(sessionID, approvalID string, decision core.ApprovalDecision) (core.Session, error)
	ListModels(includeHidden bool) ([]core.AgentModel, error)
	ReadAccountRateLimits() (string, error)
	GetSessionMeta(sessionID string) (core.SessionMeta, error)
	GetSessionReview(sessionID string) (core.SessionReview, error)
	GetSessionFile(input core.GetSessionFileInput) (core.SessionFile, error)
	ListSessionTranscript(input core.ListSessionTranscriptInput) (core.SessionTranscriptPage, error)
}

type Runtime = AgentRuntime

type SessionReader interface {
	GetSessionMeta(sessionID string) (core.SessionMeta, error)
	GetSessionReview(sessionID string) (core.SessionReview, error)
	GetSessionFile(input core.GetSessionFileInput) (core.SessionFile, error)
	ListSessionTranscript(input core.ListSessionTranscriptInput) (core.SessionTranscriptPage, error)
}

type SessionQueueReader interface {
	ListSessionQueue(sessionID string) ([]core.SessionQueueItem, error)
}

type Manager struct {
	workspace core.WorkspaceService
	runtimes  map[string]AgentRuntime
}

func NewManager(workspace core.WorkspaceService, runtimes map[string]AgentRuntime) *Manager {
	copied := make(map[string]AgentRuntime, len(runtimes))
	for key, runtime := range runtimes {
		if runtime == nil {
			continue
		}
		runtimeKey := normalizeBackendKey(runtime.Key(), key)
		copied[runtimeKey] = runtime
	}
	return &Manager{
		workspace: workspace,
		runtimes:  copied,
	}
}

func (m *Manager) Default() (AgentRuntime, bool) {
	return m.Get(DefaultAgentKey)
}

func (m *Manager) Get(key string) (AgentRuntime, bool) {
	runtime, ok := m.runtimes[normalizeBackendKey(key)]
	return runtime, ok
}

func (m *Manager) List() []AgentRuntime {
	keys := make([]string, 0, len(m.runtimes))
	for key := range m.runtimes {
		keys = append(keys, key)
	}
	slices.Sort(keys)

	result := make([]AgentRuntime, 0, len(keys))
	for _, key := range keys {
		result = append(result, m.runtimes[key])
	}
	return result
}

func (m *Manager) Capabilities(backendKey string) (AgentCapabilities, bool) {
	runtime, ok := m.Get(backendKey)
	if !ok {
		return AgentCapabilities{}, false
	}
	return runtime.Capabilities(), true
}

func (m *Manager) ListModels(includeHidden bool) ([]core.AgentModel, error) {
	return m.ListAgentModels(DefaultAgentKey, includeHidden)
}

func (m *Manager) ListAgentModels(backendKey string, includeHidden bool) ([]core.AgentModel, error) {
	runtime, ok := m.Get(backendKey)
	if !ok {
		return nil, fmt.Errorf("agent runtime %q not registered", normalizeBackendKey(backendKey))
	}
	return runtime.ListModels(includeHidden)
}

func (m *Manager) ReadAccountRateLimits() (string, error) {
	return m.ReadAgentAccountRateLimits(DefaultAgentKey)
}

func (m *Manager) ReadAgentAccountRateLimits(backendKey string) (string, error) {
	runtime, ok := m.Get(backendKey)
	if !ok {
		return "", fmt.Errorf("agent runtime %q not registered", normalizeBackendKey(backendKey))
	}
	return runtime.ReadAccountRateLimits()
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

func (m *Manager) GetSessionMeta(sessionID string) (core.SessionMeta, error) {
	runtime, err := m.runtimeForSession(sessionID)
	if err != nil {
		return core.SessionMeta{}, err
	}
	return runtime.GetSessionMeta(sessionID)
}

func (m *Manager) GetSessionReview(sessionID string) (core.SessionReview, error) {
	runtime, err := m.runtimeForSession(sessionID)
	if err != nil {
		return core.SessionReview{}, err
	}
	return runtime.GetSessionReview(sessionID)
}

func (m *Manager) GetSessionFile(input core.GetSessionFileInput) (core.SessionFile, error) {
	runtime, err := m.runtimeForSession(input.SessionID)
	if err != nil {
		return core.SessionFile{}, err
	}
	return runtime.GetSessionFile(input)
}

func (m *Manager) ListSessionTranscript(input core.ListSessionTranscriptInput) (core.SessionTranscriptPage, error) {
	runtime, err := m.runtimeForSession(input.SessionID)
	if err != nil {
		return core.SessionTranscriptPage{}, err
	}
	return runtime.ListSessionTranscript(input)
}

func (m *Manager) ListSessionQueue(sessionID string) ([]core.SessionQueueItem, error) {
	runtime, err := m.runtimeForSession(sessionID)
	if err != nil {
		for _, runtime := range m.runtimes {
			reader, ok := runtime.(SessionQueueReader)
			if !ok {
				continue
			}
			items, queueErr := reader.ListSessionQueue(sessionID)
			if queueErr == nil {
				return items, nil
			}
		}
		return nil, err
	}
	reader, ok := runtime.(SessionQueueReader)
	if !ok {
		return nil, fmt.Errorf("runtime %q does not expose a session queue", runtime.Key())
	}
	return reader.ListSessionQueue(sessionID)
}

func (m *Manager) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	project, err := m.resolveProject(input.ProjectID, input.BackendKey)
	if err != nil {
		return core.Session{}, err
	}
	input.ProjectID = project.ID
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

func (m *Manager) SendSessionInput(sessionID, input string, options ...core.SessionTurnOptions) (core.Session, error) {
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
	project, err := m.resolveProject(session.ProjectID, session.BackendKey)
	if err != nil {
		return core.Session{}, err
	}
	backendKey := normalizeBackendKey(session.BackendKey, project.DefaultBackend)
	runtime, ok := m.runtimes[backendKey]
	if !ok {
		return core.Session{}, fmt.Errorf("backend runtime %q not registered", backendKey)
	}
	updated, err := runtime.SendSessionInput(sessionID, input, options...)
	if err != nil {
		return core.Session{}, err
	}
	updated, _ = m.normalizeSession(updated, project, backendKey)
	return updated, nil
}

func (m *Manager) RollbackSessionInput(
	sessionID string,
	target core.SessionRollbackTarget,
	input string,
	options ...core.SessionTurnOptions,
) (core.SessionRollbackResult, error) {
	session, ok := m.workspace.GetSession(sessionID)
	if !ok {
		resolved, project, err := m.GetSession(sessionID)
		if err != nil {
			return core.SessionRollbackResult{}, err
		}
		session = resolved
		if strings.TrimSpace(session.ProjectID) == "" {
			session.ProjectID = project.ID
		}
	}
	project, err := m.resolveProject(session.ProjectID, session.BackendKey)
	if err != nil {
		return core.SessionRollbackResult{}, err
	}
	backendKey := normalizeBackendKey(session.BackendKey, project.DefaultBackend)
	runtime, ok := m.runtimes[backendKey]
	if !ok {
		return core.SessionRollbackResult{}, fmt.Errorf("backend runtime %q not registered", backendKey)
	}
	result, err := runtime.RollbackSessionInput(sessionID, target, input, options...)
	if err != nil {
		return core.SessionRollbackResult{}, err
	}
	result.Session, _ = m.normalizeSession(result.Session, project, backendKey)
	return result, nil
}

func (m *Manager) InterruptSession(sessionID string) (core.Session, error) {
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
	project, err := m.resolveProject(session.ProjectID, session.BackendKey)
	if err != nil {
		return core.Session{}, err
	}
	backendKey := normalizeBackendKey(session.BackendKey, project.DefaultBackend)
	runtime, ok := m.runtimes[backendKey]
	if !ok {
		return core.Session{}, fmt.Errorf("backend runtime %q not registered", backendKey)
	}
	updated, err := runtime.InterruptSession(sessionID)
	if err != nil {
		return core.Session{}, err
	}
	updated, _ = m.normalizeSession(updated, project, backendKey)
	return updated, nil
}

func (m *Manager) RespondToSessionApproval(
	sessionID, approvalID string,
	decision core.ApprovalDecision,
) (core.Session, error) {
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
	project, err := m.resolveProject(session.ProjectID, session.BackendKey)
	if err != nil {
		return core.Session{}, err
	}
	backendKey := normalizeBackendKey(session.BackendKey, project.DefaultBackend)
	runtime, ok := m.runtimes[backendKey]
	if !ok {
		return core.Session{}, fmt.Errorf("backend runtime %q not registered", backendKey)
	}
	updated, err := runtime.RespondToSessionApproval(sessionID, approvalID, decision)
	if err != nil {
		return core.Session{}, err
	}
	updated, _ = m.normalizeSession(updated, project, backendKey)
	return updated, nil
}

func (m *Manager) runtimeForSession(sessionID string) (AgentRuntime, error) {
	if session, ok := m.workspace.GetSession(sessionID); ok {
		project, ok := m.workspace.GetProject(session.ProjectID)
		if !ok {
			return nil, fmt.Errorf("project %q not found for session", session.ProjectID)
		}
		backendKey := normalizeBackendKey(session.BackendKey, project.DefaultBackend)
		runtime, ok := m.runtimes[backendKey]
		if !ok {
			return nil, fmt.Errorf("agent runtime %q not registered", backendKey)
		}
		return runtime, nil
	}

	for _, runtime := range m.runtimes {
		if _, _, err := runtime.GetSession(sessionID); err == nil {
			return runtime, nil
		}
	}

	return nil, fmt.Errorf("session %q not found", sessionID)
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

func (m *Manager) resolveProject(projectID, backendKey string) (core.Project, error) {
	if project, ok := m.workspace.GetProject(projectID); ok {
		return project, nil
	}

	projectID = strings.TrimSpace(projectID)
	if !strings.HasPrefix(projectID, "cwd:") {
		return core.Project{}, fmt.Errorf("project %q not found", projectID)
	}

	rootPath := strings.TrimSpace(strings.TrimPrefix(projectID, "cwd:"))
	if rootPath == "" {
		return core.Project{}, fmt.Errorf("project %q not found", projectID)
	}

	if project, ok := projectByRootPath(m.workspace.ListProjects(), rootPath); ok {
		return project, nil
	}

	name := filepath.Base(rootPath)
	if name == "." || name == string(filepath.Separator) || name == "" {
		name = rootPath
	}

	project, err := m.workspace.CreateProject(core.CreateProjectInput{
		Name:           name,
		RootPath:       rootPath,
		DefaultBackend: normalizeBackendKey(backendKey),
	})
	if err == nil {
		return project, nil
	}
	if synthetic, ok := m.syntheticProjectForVisibleNonGitRoot(projectID, rootPath, name, backendKey, err); ok {
		return synthetic, nil
	}

	if project, ok := projectByRootPath(m.workspace.ListProjects(), rootPath); ok {
		return project, nil
	}

	return core.Project{}, err
}

func (m *Manager) syntheticProjectForVisibleNonGitRoot(projectID, rootPath, name, backendKey string, createErr error) (core.Project, bool) {
	if createErr == nil || !strings.Contains(createErr.Error(), "is not a git repository") {
		return core.Project{}, false
	}

	metadata, err := m.workspace.GetPathMetadata(rootPath)
	if err != nil || !metadata.IsAllowed || !metadata.IsDirectory {
		return core.Project{}, false
	}

	return core.Project{
		ID:             strings.TrimSpace(projectID),
		Name:           name,
		RootPath:       metadata.CanonicalPath,
		DefaultBackend: normalizeBackendKey(backendKey),
	}, true
}

func projectByRootPath(projects []core.Project, rootPath string) (core.Project, bool) {
	normalizedRoot := filepath.Clean(strings.TrimSpace(rootPath))
	for _, project := range projects {
		if filepath.Clean(strings.TrimSpace(project.RootPath)) == normalizedRoot {
			return project, true
		}
	}
	return core.Project{}, false
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
