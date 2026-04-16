package core

import (
	"fmt"
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
		{
			Key:       "codex",
			Available: false,
			Version:   "",
			Reason:    "Go rebuild skeleton: Codex bridge not wired yet",
		},
	}
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
		defaultBackend = "codex"
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

	w.sessionSeq++
	now := time.Now().UTC()
	title := strings.TrimSpace(input.Title)
	if title == "" {
		title = fmt.Sprintf("%s session %d", project.Name, w.sessionSeq)
	}
	session := Session{
		ID:              fmt.Sprintf("sess_%04d", w.sessionSeq),
		ProjectID:       project.ID,
		Title:           title,
		BackendThreadID: "",
		ActiveTurnID:    "",
		Status:          SessionStatePending,
		Summary:         "Starting Codex session…",
		LastInputHint:   truncate(strings.TrimSpace(input.Prompt), 120),
		UpdatedAt:       now,
	}
	w.sessions[session.ID] = session
	w.sessionIDs = append([]string{session.ID}, w.sessionIDs...)
	w.publish(Event{Kind: EventSessionsChanged, ProjectID: project.ID, SessionID: session.ID})
	w.publish(Event{Kind: EventSessionChanged, ProjectID: project.ID, SessionID: session.ID})
	return session, nil
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
