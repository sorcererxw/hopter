package core

import (
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"
)

type InMemoryWorkspace struct {
	mu         sync.RWMutex
	hostID     string
	eventSink  EventSink
	projectSeq int
	sessionSeq int
	projects   map[string]Project
	projectIDs []string
	sessions   map[string]Session
	sessionIDs []string
}

func NewInMemoryWorkspace(hostID string, eventSink EventSink) *InMemoryWorkspace {
	return &InMemoryWorkspace{
		hostID:    hostID,
		eventSink: eventSink,
		projects:  make(map[string]Project),
		sessions:  make(map[string]Session),
	}
}

func (w *InMemoryWorkspace) GetHostStatus() HostSnapshot {
	w.mu.RLock()
	defer w.mu.RUnlock()

	return HostSnapshot{
		HostID:       w.hostID,
		Status:       HostStateHealthy,
		Backends:     w.ListBackends(),
		ProjectCount: len(w.projects),
		SessionCount: len(w.sessions),
		UpdatedAt:    time.Now().UTC(),
	}
}

func (w *InMemoryWorkspace) ListBackends() []Backend {
	return []Backend{
		detectBackend(BackendKeyCodex),
	}
}

func (w *InMemoryWorkspace) ListSkills() ([]Skill, error) {
	return discoverSkills()
}

func (w *InMemoryWorkspace) ListMCPServers() ([]MCPServer, error) {
	return discoverMCPServers()
}

func (w *InMemoryWorkspace) ListDirectoryRoots() ([]DirectoryRoot, error) {
	return discoverDirectoryRoots()
}

func (w *InMemoryWorkspace) ListDirectory(path string) (DirectoryListing, error) {
	return listDirectory(path)
}

func (w *InMemoryWorkspace) GetPathMetadata(path string) (PathMetadata, error) {
	return getPathMetadata(path)
}

func (w *InMemoryWorkspace) ListRecentRepos(limit uint32) ([]PathMetadata, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	projects := make([]Project, 0, len(w.projectIDs))
	for _, id := range w.projectIDs {
		projects = append(projects, w.projects[id])
	}
	return listRecentRepos(projects, limit)
}

func (w *InMemoryWorkspace) ListProjects() []Project {
	w.mu.RLock()
	defer w.mu.RUnlock()

	result := make([]Project, 0, len(w.projectIDs))
	for _, id := range w.projectIDs {
		result = append(result, w.projects[id])
	}
	return result
}

func (w *InMemoryWorkspace) CreateProject(input CreateProjectInput) (Project, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	w.projectSeq++
	now := time.Now().UTC()
	name := strings.TrimSpace(input.Name)
	rootPath, err := validateProjectRoot(input.RootPath)
	if err != nil {
		w.projectSeq--
		return Project{}, err
	}
	if name == "" {
		name = filepath.Base(rootPath)
	}
	defaultBackend := strings.TrimSpace(input.DefaultBackend)
	if defaultBackend == "" {
		defaultBackend = BackendKeyCodex
	}
	defaultBackend, err = normalizeSupportedBackendKey(defaultBackend)
	if err != nil {
		w.projectSeq--
		return Project{}, err
	}

	for _, existing := range w.projects {
		if existing.RootPath == rootPath {
			w.projectSeq--
			return Project{}, fmt.Errorf("project for %q already exists", rootPath)
		}
	}

	project := Project{
		ID:             fmt.Sprintf("proj_%04d", w.projectSeq),
		Name:           name,
		RootPath:       rootPath,
		DefaultBackend: defaultBackend,
		CreatedAt:      now,
		UpdatedAt:      now,
	}
	w.projects[project.ID] = project
	w.projectIDs = append(w.projectIDs, project.ID)
	w.publish(Event{Kind: EventProjectsChanged, ProjectID: project.ID})
	return project, nil
}

func (w *InMemoryWorkspace) GetProject(projectID string) (Project, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	project, ok := w.projects[projectID]
	return project, ok
}

func (w *InMemoryWorkspace) ListSessions(input ListSessionsInput) []Session {
	w.mu.RLock()
	defer w.mu.RUnlock()

	result := make([]Session, 0, len(w.sessionIDs))
	for _, id := range w.sessionIDs {
		session := w.sessions[id]
		if input.ProjectID != "" && session.ProjectID != input.ProjectID {
			continue
		}
		result = append(result, session)
		if input.Limit > 0 && len(result) >= int(input.Limit) {
			break
		}
	}
	return result
}

func (w *InMemoryWorkspace) GetSession(sessionID string) (Session, bool) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	session, ok := w.sessions[sessionID]
	return session, ok
}

func (w *InMemoryWorkspace) CreateSession(input CreateSessionInput) (Session, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	project, ok := w.projects[input.ProjectID]
	if !ok {
		return Session{}, fmt.Errorf("project %q not found", input.ProjectID)
	}

	now := time.Now().UTC()
	title := strings.TrimSpace(input.Title)
	sessionID := strings.TrimSpace(input.SessionID)
	generatedSessionID := false
	if sessionID == "" {
		w.sessionSeq++
		generatedSessionID = true
		sessionID = fmt.Sprintf("sess_%04d", w.sessionSeq)
	} else if _, exists := w.sessions[sessionID]; exists {
		return Session{}, fmt.Errorf("session %q already exists", sessionID)
	}
	if title == "" {
		title = fmt.Sprintf("%s session %d", project.Name, len(w.sessionIDs)+1)
	}
	backendKey, err := normalizeSupportedBackendKey(firstNonEmpty(strings.TrimSpace(input.BackendKey), project.DefaultBackend))
	if err != nil {
		if generatedSessionID {
			w.sessionSeq--
		}
		return Session{}, err
	}
	session := Session{
		ID:                       sessionID,
		ProjectID:                project.ID,
		BackendKey:               backendKey,
		Title:                    title,
		BackendThreadID:          "",
		ActiveTurnID:             "",
		Status:                   SessionStatePending,
		Summary:                  "Starting Codex session…",
		LastInputHint:            truncate(strings.TrimSpace(input.Prompt), 120),
		PreferredModel:           strings.TrimSpace(input.Model),
		PreferredReasoningEffort: strings.TrimSpace(input.ReasoningEffort),
		PreferredCodexFastMode:   input.CodexFastMode,
		UpdatedAt:                now,
	}
	w.sessions[session.ID] = session
	w.sessionIDs = append([]string{session.ID}, w.sessionIDs...)
	w.publish(Event{Kind: EventSessionsChanged, ProjectID: project.ID, SessionID: session.ID})
	w.publish(Event{Kind: EventSessionChanged, ProjectID: project.ID, SessionID: session.ID})
	return session, nil
}

func normalizeSupportedBackendKey(value string) (string, error) {
	key := strings.ToLower(strings.TrimSpace(value))
	if key == "" || key == BackendKeyCodex {
		return BackendKeyCodex, nil
	}
	return "", fmt.Errorf("backend %q is not supported; only codex is supported", key)
}

func (w *InMemoryWorkspace) SendSessionInput(sessionID string, input string) (Session, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	session, ok := w.sessions[sessionID]
	if !ok {
		return Session{}, fmt.Errorf("session %q not found", sessionID)
	}
	session.LastInputHint = truncate(strings.TrimSpace(input), 120)
	session.Summary = "Sending follow-up input to Codex…"
	session.Status = SessionStateRunning
	session.UpdatedAt = time.Now().UTC()
	w.sessions[session.ID] = session
	w.publish(Event{Kind: EventSessionChanged, ProjectID: session.ProjectID, SessionID: session.ID})
	return session, nil
}

func (w *InMemoryWorkspace) UpdateSession(sessionID string, patch SessionPatch) (Session, error) {
	w.mu.Lock()
	defer w.mu.Unlock()

	session, ok := w.sessions[sessionID]
	if !ok {
		return Session{}, fmt.Errorf("session %q not found", sessionID)
	}

	if patch.BackendThreadID != nil {
		session.BackendThreadID = *patch.BackendThreadID
	}
	if patch.BackendKey != nil {
		session.BackendKey = *patch.BackendKey
	}
	if patch.PendingApprovalID != nil {
		session.PendingApprovalID = *patch.PendingApprovalID
	}
	if patch.ActiveTurnID != nil {
		session.ActiveTurnID = *patch.ActiveTurnID
	}
	if patch.Status != nil {
		session.Status = *patch.Status
	}
	if patch.Summary != nil {
		session.Summary = *patch.Summary
	}
	if patch.AttentionRequired != nil {
		session.AttentionRequired = *patch.AttentionRequired
	}
	if patch.AttentionReason != nil {
		session.AttentionReason = *patch.AttentionReason
	}
	if patch.LastInputHint != nil {
		session.LastInputHint = *patch.LastInputHint
	}
	if patch.PreferredModel != nil {
		session.PreferredModel = strings.TrimSpace(*patch.PreferredModel)
	}
	if patch.PreferredReasoningEffort != nil {
		session.PreferredReasoningEffort = strings.TrimSpace(*patch.PreferredReasoningEffort)
	}
	if patch.PreferredCodexFastMode != nil {
		session.PreferredCodexFastMode = *patch.PreferredCodexFastMode
	}
	if patch.ContextWindowUsage != nil {
		session.ContextWindowUsage = cloneSessionContextWindowUsage(
			patch.ContextWindowUsage,
		)
	}
	if patch.Artifacts != nil {
		session.Artifacts = append([]Artifact(nil), (*patch.Artifacts)...)
	}
	if patch.TranscriptItems != nil {
		session.TranscriptItems = append([]SessionTranscriptItem(nil), (*patch.TranscriptItems)...)
	}
	if patch.AppendTranscriptItems != nil {
		session.TranscriptItems = append(session.TranscriptItems, (*patch.AppendTranscriptItems)...)
		if len(session.TranscriptItems) > 200 {
			session.TranscriptItems = append([]SessionTranscriptItem(nil), session.TranscriptItems[len(session.TranscriptItems)-200:]...)
		}
	}
	session.UpdatedAt = time.Now().UTC()
	w.sessions[session.ID] = session
	w.publish(Event{Kind: EventSessionChanged, ProjectID: session.ProjectID, SessionID: session.ID})
	return session, nil
}

func (w *InMemoryWorkspace) ListSessionArtifacts(sessionID string) ([]Artifact, error) {
	w.mu.RLock()
	defer w.mu.RUnlock()

	session, ok := w.sessions[sessionID]
	if !ok {
		return nil, fmt.Errorf("session %q not found", sessionID)
	}
	artifacts := make([]Artifact, len(session.Artifacts))
	copy(artifacts, session.Artifacts)
	return artifacts, nil
}

func (w *InMemoryWorkspace) publish(event Event) {
	if w.eventSink != nil {
		w.eventSink.Publish(event)
	}
}

func truncate(value string, limit int) string {
	if len(value) <= limit {
		return value
	}
	return value[:limit-1] + "…"
}

func cloneSessionContextWindowUsage(
	usage *SessionContextWindowUsage,
) *SessionContextWindowUsage {
	if usage == nil {
		return nil
	}

	cloned := *usage
	return &cloned
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func detectBackend(key string) Backend {
	if _, err := exec.LookPath(key); err == nil {
		return Backend{
			Key:       key,
			Available: true,
			Reason:    "",
		}
	}
	return Backend{
		Key:       key,
		Available: false,
		Reason:    fmt.Sprintf("%s CLI not found on PATH", key),
	}
}
