package codex

import (
	"github.com/sorcererxw/hopter/internal/agents"
	"github.com/sorcererxw/hopter/internal/core"
)

type runtime struct {
	manager *Manager
}

func NewRuntime(manager *Manager) agents.Runtime {
	return &runtime{manager: manager}
}

func (r *runtime) ListSessions(projectID string, limit uint32) ([]agents.ResolvedSession, error) {
	resolved, err := r.manager.ListSessions(projectID, limit)
	if err != nil {
		return nil, err
	}
	result := make([]agents.ResolvedSession, 0, len(resolved))
	for _, item := range resolved {
		result = append(result, agents.ResolvedSession{
			Project: item.Project,
			Session: item.Session,
		})
	}
	return result, nil
}

func (r *runtime) GetSession(sessionID string) (core.Session, core.Project, error) {
	return r.manager.GetSession(sessionID)
}

func (r *runtime) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	return r.manager.CreateSession(input)
}

func (r *runtime) SendSessionInput(sessionID, input string, options ...core.SessionTurnOptions) (core.Session, error) {
	return r.manager.SendSessionInput(sessionID, input, options...)
}

func (r *runtime) InterruptSession(sessionID string) (core.Session, error) {
	return r.manager.InterruptSession(sessionID)
}

func (r *runtime) RespondToSessionApproval(
	sessionID, approvalID string,
	decision core.ApprovalDecision,
) (core.Session, error) {
	return r.manager.RespondToSessionApproval(sessionID, approvalID, decision)
}
