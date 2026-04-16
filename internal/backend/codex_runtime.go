package backend

import (
	"orchd/internal/codex"
	"orchd/internal/core"
)

type codexRuntime struct {
	manager *codex.Manager
}

func NewCodexRuntime(manager *codex.Manager) Runtime {
	return &codexRuntime{manager: manager}
}

func (r *codexRuntime) ListSessions(projectID string, limit uint32) ([]ResolvedSession, error) {
	resolved, err := r.manager.ListSessions(projectID, limit)
	if err != nil {
		return nil, err
	}
	result := make([]ResolvedSession, 0, len(resolved))
	for _, item := range resolved {
		result = append(result, ResolvedSession{
			Project: item.Project,
			Session: item.Session,
		})
	}
	return result, nil
}

func (r *codexRuntime) GetSession(sessionID string) (core.Session, core.Project, error) {
	return r.manager.GetSession(sessionID)
}

func (r *codexRuntime) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	return r.manager.CreateSession(input)
}

func (r *codexRuntime) SendSessionInput(sessionID, input string) (core.Session, error) {
	return r.manager.SendSessionInput(sessionID, input)
}
