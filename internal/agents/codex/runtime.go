package codex

import (
	"fmt"

	"github.com/sorcererxw/hopter/internal/agents"
	"github.com/sorcererxw/hopter/internal/core"
)

type Runtime struct {
	manager *Manager
	reader  agents.SessionReader
}

func NewRuntime(manager *Manager) *Runtime {
	return &Runtime{manager: manager}
}

func (r *Runtime) SetSessionReader(reader agents.SessionReader) {
	r.reader = reader
}

func (r *Runtime) Key() string {
	return string(agents.AgentKeyCodex)
}

func (r *Runtime) Capabilities() agents.AgentCapabilities {
	return agents.AgentCapabilities{
		SupportsResume:         true,
		SupportsInterrupt:      true,
		SupportsApprovals:      true,
		SupportsRateLimits:     true,
		SupportsModels:         true,
		SupportsContextUsage:   true,
		SupportsReasoningTrace: true,
		SupportsLivePatches:    true,
		SupportsArtifacts:      true,
		SupportsSessionReview:  true,
		SupportsSessionFiles:   true,
		SupportsTranscript:     true,
	}
}

func (r *Runtime) ListSessions(projectID string, limit uint32) ([]agents.ResolvedSession, error) {
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

func (r *Runtime) GetSession(sessionID string) (core.Session, core.Project, error) {
	return r.manager.GetSession(sessionID)
}

func (r *Runtime) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	return r.manager.CreateSession(input)
}

func (r *Runtime) SendSessionInput(sessionID, input string, options ...core.SessionTurnOptions) (core.Session, error) {
	return r.manager.SendSessionInput(sessionID, input, options...)
}

func (r *Runtime) RollbackSessionInput(
	sessionID string,
	target core.SessionRollbackTarget,
	input string,
	options ...core.SessionTurnOptions,
) (core.SessionRollbackResult, error) {
	return r.manager.RollbackSessionInput(sessionID, target, input, options...)
}

func (r *Runtime) ListSessionQueue(sessionID string) ([]core.SessionQueueItem, error) {
	return r.manager.ListSessionQueue(sessionID)
}

func (r *Runtime) InterruptSession(sessionID string) (core.Session, error) {
	return r.manager.InterruptSession(sessionID)
}

func (r *Runtime) RespondToSessionApproval(
	sessionID, approvalID string,
	decision core.ApprovalDecision,
) (core.Session, error) {
	return r.manager.RespondToSessionApproval(sessionID, approvalID, decision)
}

func (r *Runtime) ListModels(includeHidden bool) ([]core.AgentModel, error) {
	return r.manager.ListModels(includeHidden)
}

func (r *Runtime) ReadAccountRateLimits() (string, error) {
	return r.manager.ReadAccountRateLimits()
}

func (r *Runtime) GetSessionMeta(sessionID string) (core.SessionMeta, error) {
	if r.reader == nil {
		return core.SessionMeta{}, fmt.Errorf("codex session reader unavailable")
	}
	return r.reader.GetSessionMeta(sessionID)
}

func (r *Runtime) GetSessionReview(sessionID string) (core.SessionReview, error) {
	if r.reader == nil {
		return core.SessionReview{}, fmt.Errorf("codex session reader unavailable")
	}
	return r.reader.GetSessionReview(sessionID)
}

func (r *Runtime) GetSessionFile(input core.GetSessionFileInput) (core.SessionFile, error) {
	if r.reader == nil {
		return core.SessionFile{}, fmt.Errorf("codex session reader unavailable")
	}
	return r.reader.GetSessionFile(input)
}

func (r *Runtime) ListSessionTranscript(input core.ListSessionTranscriptInput) (core.SessionTranscriptPage, error) {
	if r.reader == nil {
		return core.SessionTranscriptPage{}, fmt.Errorf("codex session reader unavailable")
	}
	return r.reader.ListSessionTranscript(input)
}
