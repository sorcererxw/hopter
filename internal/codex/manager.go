package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"strings"
	"sync"
	"time"

	"orchd/internal/core"
)

type Manager struct {
	mu        sync.Mutex
	workspace core.WorkspaceService
	live      map[string]*liveSession
}

type liveSession struct {
	project core.Project
	client  *Client
	thread  string
	active  string
}

func NewManager(workspace core.WorkspaceService) *Manager {
	return &Manager{
		workspace: workspace,
		live:      make(map[string]*liveSession),
	}
}

func (m *Manager) CreateSession(input core.CreateSessionInput) (core.Session, error) {
	if _, err := exec.LookPath("codex"); err != nil {
		return core.Session{}, fmt.Errorf("codex CLI not found on PATH: %w", err)
	}
	project, ok := m.workspace.GetProject(input.ProjectID)
	if !ok {
		return core.Session{}, fmt.Errorf("project %q not found", input.ProjectID)
	}
	session, err := m.workspace.CreateSession(input)
	if err != nil {
		return core.Session{}, err
	}
	go m.runSession(project, session.ID, input.Prompt)
	return session, nil
}

func (m *Manager) SendSessionInput(sessionID, input string) (core.Session, error) {
	session, err := m.workspace.SendSessionInput(sessionID, input)
	if err != nil {
		return core.Session{}, err
	}

	m.mu.Lock()
	live := m.live[sessionID]
	m.mu.Unlock()
	if live == nil {
		return session, fmt.Errorf("session %q is not attached to a live Codex runtime", sessionID)
	}

	go m.dispatchInput(sessionID, input)
	return session, nil
}

func (m *Manager) runSession(project core.Project, sessionID, prompt string) {
	client, err := Start(context.Background(), project.RootPath, func(n Notification) {
		m.handleNotification(sessionID, n)
	}, func() {
		summary := "Codex runtime exited unexpectedly."
		degraded := true
		active := ""
		_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
			Status:            ptrSessionState(core.SessionStateDegraded),
			Summary:           &summary,
			AttentionReason:   &summary,
			AttentionRequired: &degraded,
			ActiveTurnID:      &active,
		})
		m.mu.Lock()
		delete(m.live, sessionID)
		m.mu.Unlock()
	})
	if err != nil {
		m.failSession(sessionID, fmt.Errorf("start codex app-server: %w", err))
		return
	}

	threadResult, err := client.StartThread(project.RootPath)
	if err != nil {
		_ = client.Close()
		m.failSession(sessionID, fmt.Errorf("start codex thread: %w", err))
		return
	}

	threadID := threadResult.Thread.ID
	active := ""
	running := core.SessionStateRunning
	summary := "Codex thread started. Running the first turn…"
	_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
		BackendThreadID: &threadID,
		ActiveTurnID:    &active,
		Status:          &running,
		Summary:         &summary,
	})

	m.mu.Lock()
	m.live[sessionID] = &liveSession{
		project: project,
		client:  client,
		thread:  threadID,
	}
	m.mu.Unlock()

	turnResult, err := client.StartTurn(threadID, prompt)
	if err != nil {
		_ = client.Close()
		m.failSession(sessionID, fmt.Errorf("start codex turn: %w", err))
		return
	}

	active = turnResult.Turn.ID
	summary = "Codex is working…"
	_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
		ActiveTurnID: &active,
		Status:       &running,
		Summary:      &summary,
	})

	m.mu.Lock()
	if live := m.live[sessionID]; live != nil {
		live.active = active
	}
	m.mu.Unlock()

	go m.watchTurn(sessionID, threadID, active)
}

func (m *Manager) dispatchInput(sessionID, input string) {
	m.mu.Lock()
	live := m.live[sessionID]
	m.mu.Unlock()
	if live == nil {
		return
	}

	var (
		turn *StartTurnResult
		err  error
	)
	if strings.TrimSpace(live.active) != "" {
		turn, err = live.client.SteerTurn(live.thread, live.active, input)
	} else {
		turn, err = live.client.StartTurn(live.thread, input)
	}
	if err != nil {
		m.failSession(sessionID, fmt.Errorf("dispatch session input: %w", err))
		return
	}

	active := turn.Turn.ID
	running := core.SessionStateRunning
	summary := "Codex is processing the latest input…"
	_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
		ActiveTurnID: &active,
		Status:       &running,
		Summary:      &summary,
	})

	m.mu.Lock()
	if current := m.live[sessionID]; current != nil {
		current.active = active
	}
	m.mu.Unlock()

	go m.watchTurn(sessionID, live.thread, active)
}

func (m *Manager) handleNotification(sessionID string, notification Notification) {
	switch notification.Method {
	case "turn/started":
		var payload struct {
			Turn struct {
				ID string `json:"id"`
			} `json:"turn"`
		}
		if json.Unmarshal(notification.Params, &payload) == nil && payload.Turn.ID != "" {
			active := payload.Turn.ID
			running := core.SessionStateRunning
			summary := "Codex is working…"
			_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
				ActiveTurnID: &active,
				Status:       &running,
				Summary:      &summary,
			})
			m.mu.Lock()
			if live := m.live[sessionID]; live != nil {
				live.active = active
			}
			m.mu.Unlock()
		}
	case "turn/completed":
		var payload struct {
			Turn struct {
				Status string `json:"status"`
			} `json:"turn"`
		}
		_ = json.Unmarshal(notification.Params, &payload)
		m.mu.Lock()
		live := m.live[sessionID]
		if live != nil {
			live.active = ""
		}
		m.mu.Unlock()

		active := ""
		status := core.SessionStateCompleted
		if payload.Turn.Status == "failed" {
			status = core.SessionStateFailed
		}
		summary := "Codex completed the turn."

		if live != nil {
			if read, err := live.client.ReadThread(live.thread); err == nil {
				if extracted := latestAgentSummary(read); extracted != "" {
					summary = extracted
				}
			}
		}

		_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
			ActiveTurnID: &active,
			Status:       &status,
			Summary:      &summary,
		})
	case "error":
		m.failSession(sessionID, errors.New("codex emitted an error notification"))
	case "item/completed":
		var payload struct {
			Item struct {
				Type  string `json:"type"`
				Text  string `json:"text"`
				Phase string `json:"phase"`
			} `json:"item"`
		}
		if json.Unmarshal(notification.Params, &payload) == nil {
			text := strings.TrimSpace(payload.Item.Text)
			if payload.Item.Type == "agentMessage" && text != "" {
				summary := text
				_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
					Summary: &summary,
				})
			}
		}
	}
}

func latestAgentSummary(read *ReadThreadResult) string {
	if read == nil {
		return ""
	}
	for i := len(read.Thread.Turns) - 1; i >= 0; i-- {
		turn := read.Thread.Turns[i]
		for j := len(turn.Items) - 1; j >= 0; j-- {
			item := turn.Items[j]
			if item.Type == "agentMessage" && strings.TrimSpace(item.Text) != "" {
				return strings.TrimSpace(item.Text)
			}
		}
	}
	return ""
}

func latestTurnStatus(read *ReadThreadResult, turnID string) string {
	if read == nil {
		return ""
	}
	for i := len(read.Thread.Turns) - 1; i >= 0; i-- {
		turn := read.Thread.Turns[i]
		if turn.ID == turnID {
			return turn.Status
		}
	}
	return ""
}

func (m *Manager) watchTurn(sessionID, threadID, turnID string) {
	for range 180 {
		time.Sleep(2 * time.Second)

		m.mu.Lock()
		live := m.live[sessionID]
		m.mu.Unlock()
		if live == nil {
			return
		}

		read, err := live.client.ReadThread(threadID)
		if err != nil {
			continue
		}
		statusText := latestTurnStatus(read, turnID)
		if statusText == "" || statusText == "inProgress" {
			continue
		}

		active := ""
		status := core.SessionStateCompleted
		if statusText == "failed" {
			status = core.SessionStateFailed
		}
		summary := latestAgentSummary(read)
		if summary == "" {
			summary = "Codex completed the turn."
		}
		_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
			ActiveTurnID: &active,
			Status:       &status,
			Summary:      &summary,
		})
		m.mu.Lock()
		if current := m.live[sessionID]; current != nil {
			current.active = ""
		}
		m.mu.Unlock()
		return
	}

	active := ""
	status := core.SessionStateDegraded
	summary := "Timed out waiting for Codex turn completion."
	_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
		ActiveTurnID: &active,
		Status:       &status,
		Summary:      &summary,
	})
}

func (m *Manager) failSession(sessionID string, err error) {
	active := ""
	status := core.SessionStateFailed
	attention := true
	summary := err.Error()
	_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
		ActiveTurnID:      &active,
		Status:            &status,
		Summary:           &summary,
		AttentionRequired: &attention,
		AttentionReason:   &summary,
	})
}

func ptrSessionState(value core.SessionState) *core.SessionState {
	return &value
}
