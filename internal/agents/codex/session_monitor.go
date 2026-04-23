package codex

import (
	"context"
	"strings"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

const (
	defaultSessionListMonitorInterval = 10 * time.Second
	defaultSessionListMonitorLimit    = 100
)

type sessionListMonitorState map[string]sessionListMonitorEntry

type sessionListMonitorEntry struct {
	ActiveTurnID      string
	AttentionRequired bool
	BackendThreadID   string
	PendingApprovalID string
	ProjectID         string
	Status            core.SessionState
	Summary           string
	UpdatedAtUnixMs   int64
}

func (m *Manager) StartSessionListMonitor(ctx context.Context, interval time.Duration, limit uint32) {
	if m == nil || m.eventSink == nil {
		return
	}
	if interval <= 0 {
		interval = defaultSessionListMonitorInterval
	}
	if limit == 0 {
		limit = defaultSessionListMonitorLimit
	}

	go func() {
		var previous sessionListMonitorState
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			previous = m.pollSessionListMonitor(ctx, previous, limit)

			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
			}
		}
	}()
}

func (m *Manager) pollSessionListMonitor(
	ctx context.Context,
	previous sessionListMonitorState,
	limit uint32,
) sessionListMonitorState {
	select {
	case <-ctx.Done():
		return previous
	default:
	}

	resolved, err := m.ListSessions("", limit)
	if err != nil {
		return previous
	}

	current := sessionListMonitorStateFromResolved(resolved)
	if previous == nil {
		return current
	}

	changed := changedSessionListMonitorEntries(previous, current)
	if len(changed) == 0 {
		return current
	}

	m.eventSink.Publish(core.Event{
		Kind:    core.EventSessionsChanged,
		Summary: "Codex sessions changed.",
	})
	for _, item := range changed {
		m.eventSink.Publish(core.Event{
			Kind:      core.EventSessionChanged,
			ProjectID: item.Project.ID,
			SessionID: item.Session.ID,
			Summary:   "Codex session status changed.",
		})
	}
	return current
}

func sessionListMonitorStateFromResolved(resolved []ResolvedSession) sessionListMonitorState {
	state := make(sessionListMonitorState, len(resolved))
	for _, item := range resolved {
		sessionID := strings.TrimSpace(item.Session.ID)
		if sessionID == "" {
			continue
		}
		state[sessionID] = sessionListMonitorEntry{
			ActiveTurnID:      strings.TrimSpace(item.Session.ActiveTurnID),
			AttentionRequired: item.Session.AttentionRequired,
			BackendThreadID:   strings.TrimSpace(item.Session.BackendThreadID),
			PendingApprovalID: strings.TrimSpace(item.Session.PendingApprovalID),
			ProjectID:         strings.TrimSpace(item.Project.ID),
			Status:            item.Session.Status,
			Summary:           strings.TrimSpace(item.Session.Summary),
			UpdatedAtUnixMs:   item.Session.UpdatedAt.UTC().UnixMilli(),
		}
	}
	return state
}

func changedSessionListMonitorEntries(
	previous sessionListMonitorState,
	current sessionListMonitorState,
) []ResolvedSession {
	changed := make([]ResolvedSession, 0)
	for sessionID, entry := range current {
		if previousEntry, ok := previous[sessionID]; !ok || previousEntry != entry {
			changed = append(changed, ResolvedSession{
				Project: core.Project{ID: entry.ProjectID},
				Session: core.Session{ID: sessionID},
			})
		}
	}
	for sessionID, entry := range previous {
		if _, ok := current[sessionID]; !ok {
			changed = append(changed, ResolvedSession{
				Project: core.Project{ID: entry.ProjectID},
				Session: core.Session{ID: sessionID},
			})
		}
	}
	return changed
}
