package codex

import (
	"context"
	"sync"

	"orchd/internal/core"
)

const (
	defaultPrewarmRecentSessions    = 10
	defaultPrewarmTranscriptWorkers = 2
)

func (m *SessionReadModel) PrewarmRecent(ctx context.Context, count int, pageSize uint32) {
	if m == nil || m.manager == nil {
		return
	}
	if count <= 0 {
		count = defaultPrewarmRecentSessions
	}

	resolved, err := m.manager.ListSessions("", uint32(count))
	if err != nil || len(resolved) == 0 {
		return
	}

	sem := make(chan struct{}, defaultPrewarmTranscriptWorkers)
	var wg sync.WaitGroup

	for _, resolvedSession := range resolved {
		select {
		case <-ctx.Done():
			return
		default:
		}

		sessionID := resolvedSession.Session.ID
		if sessionID == "" {
			continue
		}

		wg.Add(1)
		go func(sessionID string, status core.SessionState) {
			defer wg.Done()

			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()

			meta, err := m.GetSessionMeta(sessionID)
			if err != nil {
				return
			}
			if status == core.SessionStateRunning || status == core.SessionStatePending {
				_ = meta
				return
			}
			_, _ = m.ListSessionTranscript(core.ListSessionTranscriptInput{
				SessionID: sessionID,
				Limit:     pageSize,
			})
		}(sessionID, resolvedSession.Session.Status)
	}

	wg.Wait()
}
