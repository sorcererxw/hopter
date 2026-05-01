package codex

import (
	"context"
	"sync"
)

const (
	defaultPrewarmRecentSessions = 3
	defaultPrewarmWorkers        = 1
)

func (m *SessionReadModel) PrewarmRecent(ctx context.Context, count int, _ uint32) {
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

	sem := make(chan struct{}, defaultPrewarmWorkers)
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
		go func(sessionID string) {
			defer wg.Done()

			select {
			case sem <- struct{}{}:
			case <-ctx.Done():
				return
			}
			defer func() { <-sem }()

			_, _ = m.GetSessionMeta(sessionID)
		}(sessionID)
	}

	wg.Wait()
}
