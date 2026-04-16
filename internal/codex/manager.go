package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"strings"
	"sync"
	"time"

	codexsdk "orchd/internal/codex/sdk"
	"orchd/internal/core"
)

type Manager struct {
	mu        sync.Mutex
	workspace core.WorkspaceService
	live      map[string]*liveSession
	start     clientStarter
	execTurns turnExecutor
}

type liveSession struct {
	project             core.Project
	client              codexClient
	thread              string
	active              string
	record              ThreadRecord
	optimisticSummary   string
	optimisticLastInput string
	optimisticStatus    core.SessionState
	optimisticUpdatedAt time.Time
}

type codexClient interface {
	Close() error
	ListThreads(cwd string, limit uint32) (*ThreadListResult, error)
	ReadThread(threadID string) (*ReadThreadResult, error)
	ResumeThread(threadID, cwd string) (*ResumeThreadResult, error)
	StartThread(cwd string) (*StartThreadResult, error)
	StartTurn(threadID string, text string) (*StartTurnResult, error)
	SteerTurn(threadID, expectedTurnID, text string) (*StartTurnResult, error)
}

type clientStarter func(
	ctx context.Context,
	cwd string,
	onNotification func(Notification),
	onExit func(),
) (codexClient, error)

type turnExecutor interface {
	Run(ctx context.Context, project core.Project, threadID string, input string, onEvent func(codexsdk.Event)) (string, error)
}

type sdkTurnExecutor struct{}

func (sdkTurnExecutor) Run(
	ctx context.Context,
	project core.Project,
	threadID string,
	input string,
	onEvent func(codexsdk.Event),
) (string, error) {
	client, err := codexsdk.New(codexsdk.ClientOptions{})
	if err != nil {
		return "", err
	}

	threadOptions := codexsdk.ThreadOptions{
		WorkingDirectory: project.RootPath,
		SandboxMode:      codexsdk.SandboxModeDangerFullAccess,
		ApprovalPolicy:   codexsdk.ApprovalPolicyNever,
	}

	var thread *codexsdk.Thread
	if strings.TrimSpace(threadID) == "" {
		thread = client.StartThread(threadOptions)
	} else {
		thread = client.ResumeThread(threadID, threadOptions)
	}

	stream, err := thread.RunStreamed(ctx, codexsdk.TextInput(input), codexsdk.RunOptions{})
	if err != nil {
		return "", err
	}

	for event := range stream.Events {
		if onEvent != nil {
			onEvent(event)
		}
	}
	for err := range stream.Err {
		if err != nil {
			return thread.ID(), err
		}
	}
	return thread.ID(), nil
}

type ResolvedSession struct {
	Project core.Project
	Session core.Session
}

func NewManager(workspace core.WorkspaceService) *Manager {
	return &Manager{
		workspace: workspace,
		live:      make(map[string]*liveSession),
		execTurns: sdkTurnExecutor{},
		start: func(
			ctx context.Context,
			cwd string,
			onNotification func(Notification),
			onExit func(),
		) (codexClient, error) {
			return Start(ctx, cwd, onNotification, onExit)
		},
	}
}

func (m *Manager) ListSessions(projectID string, limit uint32) ([]ResolvedSession, error) {
	projects := m.workspace.ListProjects()

	client, _, err := m.startEphemeralClient()
	if err != nil {
		return nil, err
	}
	defer client.Close()

	list, err := client.ListThreads("", max(limit, 100))
	if err != nil {
		return nil, err
	}

	result := make([]ResolvedSession, 0, len(list.Data))
	for _, thread := range list.Data {
		project := projectForThreadOrSynthetic(projects, thread)
		if projectID != "" && project.ID != projectID {
			continue
		}

		local, hasLocal := m.sessionByThreadID(thread.ID)
		session := sessionFromThread(thread, project, local, hasLocal)
		result = append(result, ResolvedSession{
			Project: project,
			Session: session,
		})
		if limit > 0 && len(result) >= int(limit) {
			break
		}
	}

	return result, nil
}

func (m *Manager) GetSession(sessionID string) (core.Session, core.Project, error) {
	if local, ok := m.workspace.GetSession(sessionID); ok {
		project, ok := m.workspace.GetProject(local.ProjectID)
		if !ok {
			return core.Session{}, core.Project{}, fmt.Errorf("project %q not found for session", local.ProjectID)
		}
		if strings.TrimSpace(local.BackendThreadID) == "" {
			return local, project, nil
		}
		session, resolvedProject, err := m.fetchThreadSession(sessionID, local.BackendThreadID, project, local, true)
		if err != nil {
			return local, project, nil
		}
		return session, resolvedProject, nil
	}

	if session, project, err := m.fetchRawThreadSession(sessionID); err == nil {
		return session, project, nil
	}

	return core.Session{}, core.Project{}, fmt.Errorf("session %q not found", sessionID)
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
	if session, ok := m.workspace.GetSession(sessionID); ok {
		updated, err := m.workspace.SendSessionInput(sessionID, input)
		if err != nil {
			return core.Session{}, err
		}
		project, ok := m.workspace.GetProject(session.ProjectID)
		if !ok {
			return core.Session{}, fmt.Errorf("project %q not found", session.ProjectID)
		}
		go m.dispatchInput(project, sessionID, session.BackendThreadID, input)
		return updated, nil
	}

	session, project, err := m.GetSession(sessionID)
	if err != nil {
		return core.Session{}, err
	}
	summary := "Codex is processing the latest input…"
	running := core.SessionStateRunning
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		Status:  &running,
		Summary: &summary,
	})
	session.LastInputHint = truncate(strings.TrimSpace(input), 120)
	session.Status = core.SessionStateRunning
	session.Summary = summary
	session.UpdatedAt = time.Now().UTC()
	go m.dispatchInput(project, sessionID, session.BackendThreadID, input)
	return session, nil
}

func (m *Manager) runSession(project core.Project, sessionID, prompt string) {
	summary := "Codex thread started. Running the first turn…"
	running := core.SessionStateRunning
	_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
		Status:  &running,
		Summary: &summary,
	})
	m.executeTurn(project, sessionID, "", prompt, "Codex is working…")
}

func (m *Manager) dispatchInput(project core.Project, sessionID, threadID, input string) {
	m.executeTurn(project, sessionID, threadID, input, "Codex is processing the latest input…")
}

func (m *Manager) executeTurn(project core.Project, sessionID, threadID, input, runningSummary string) {
	userItem := userTranscriptItem(input)
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		AppendTranscriptItems: &[]core.SessionTranscriptItem{userItem},
	})

	resolvedThreadID, err := m.execTurns.Run(context.Background(), project, threadID, input, func(event codexsdk.Event) {
		m.handleSDKEvent(sessionID, event)
	})
	if err != nil {
		m.failSession(sessionID, fmt.Errorf("execute codex turn: %w", err))
		return
	}
	if strings.TrimSpace(threadID) == "" && strings.TrimSpace(resolvedThreadID) != "" {
		m.updateWorkspaceSession(sessionID, core.SessionPatch{
			BackendThreadID: &resolvedThreadID,
		})
	}

	status := core.SessionStateCompleted
	summary := latestLocalSummary(m.workspace, sessionID)
	if strings.TrimSpace(summary) == "" {
		summary = "Codex completed the turn."
	}
	active := ""
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		ActiveTurnID: &active,
		Status:       &status,
		Summary:      &summary,
	})

	m.mu.Lock()
	if current := m.live[sessionID]; current != nil {
		current.active = ""
		current.optimisticSummary = ""
		current.optimisticStatus = ""
	}
	m.mu.Unlock()
	_ = runningSummary
}

func (m *Manager) handleSDKEvent(sessionID string, event codexsdk.Event) {
	switch typed := event.(type) {
	case *codexsdk.ThreadStartedEvent:
		threadID := typed.ThreadID
		running := core.SessionStateRunning
		summary := "Codex is working…"
		m.updateWorkspaceSession(sessionID, core.SessionPatch{
			BackendThreadID: &threadID,
			Status:          &running,
			Summary:         &summary,
		})
	case *codexsdk.ItemCompletedEvent:
		if transcriptItem, ok := normalizeSDKItem(typed.Item); ok {
			m.updateWorkspaceSession(sessionID, core.SessionPatch{
				AppendTranscriptItems: &[]core.SessionTranscriptItem{transcriptItem},
			})
		}
		switch item := typed.Item.(type) {
		case *codexsdk.AgentMessageItem:
			text := strings.TrimSpace(item.Text)
			if text != "" {
				m.updateWorkspaceSession(sessionID, core.SessionPatch{
					Summary: &text,
				})
			}
		case *codexsdk.ErrorItem:
			if strings.TrimSpace(item.Message) != "" {
				message := strings.TrimSpace(item.Message)
				m.updateWorkspaceSession(sessionID, core.SessionPatch{
					Summary: &message,
				})
			}
		}
	case *codexsdk.TurnFailedEvent:
		m.failSession(sessionID, fmt.Errorf("%w: %s", codexsdk.ErrTurnFailed, typed.Error.Message))
	case *codexsdk.StreamErrorEvent:
		m.failSession(sessionID, fmt.Errorf("%w: %s", codexsdk.ErrStreamFailed, typed.Message))
	}
}

func latestLocalSummary(workspace core.WorkspaceService, sessionID string) string {
	session, ok := workspace.GetSession(sessionID)
	if !ok {
		return ""
	}
	return strings.TrimSpace(session.Summary)
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
			m.updateWorkspaceSession(sessionID, core.SessionPatch{
				ActiveTurnID: &active,
				Status:       &running,
				Summary:      &summary,
			})
			m.mu.Lock()
			if live := m.live[sessionID]; live != nil {
				live.active = active
				live.optimisticSummary = summary
				live.optimisticStatus = running
				live.optimisticUpdatedAt = time.Now().UTC()
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
			live.optimisticSummary = ""
			live.optimisticStatus = ""
		}
		m.mu.Unlock()

		active := ""
		status := finalSessionState(payload.Turn.Status, core.SessionStateCompleted)
		summary := "Codex completed the turn."
		if payload.Turn.Status == "interrupted" {
			summary = "Codex stopped before completing the turn."
		}

		if live != nil {
			if read, err := live.client.ReadThread(live.thread); err == nil {
				if extracted := latestAgentSummary(read); extracted != "" {
					summary = extracted
				}
			}
		}

		m.updateWorkspaceSession(sessionID, core.SessionPatch{
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
				m.updateWorkspaceSession(sessionID, core.SessionPatch{
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
		status := finalSessionState(statusText, core.SessionStateCompleted)
		summary := latestAgentSummary(read)
		if summary == "" {
			if statusText == "interrupted" {
				summary = "Codex stopped before completing the turn."
			} else {
				summary = "Codex completed the turn."
			}
		}
		m.updateWorkspaceSession(sessionID, core.SessionPatch{
			ActiveTurnID: &active,
			Status:       &status,
			Summary:      &summary,
		})
		m.mu.Lock()
		if current := m.live[sessionID]; current != nil {
			current.active = ""
			current.optimisticSummary = ""
			current.optimisticStatus = ""
		}
		m.mu.Unlock()
		return
	}

	active := ""
	status := core.SessionStateDegraded
	summary := "Timed out waiting for Codex turn completion."
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
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
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
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

func truncate(value string, limit int) string {
	if limit <= 0 {
		return ""
	}
	if len(value) <= limit {
		return value
	}
	return strings.TrimSpace(value[:limit])
}

func (m *Manager) startEphemeralClient() (codexClient, string, error) {
	cwd := "."
	projects := m.workspace.ListProjects()
	if len(projects) > 0 {
		cwd = projects[0].RootPath
	}

	client, err := m.start(context.Background(), cwd, nil, nil)
	if err != nil {
		return nil, "", err
	}
	return client, cwd, nil
}

func (m *Manager) fetchThreadSession(
	sessionID string,
	threadID string,
	project core.Project,
	local core.Session,
	hasLocal bool,
) (core.Session, core.Project, error) {
	if live := m.liveSession(sessionID); live != nil && live.thread == threadID {
		read, err := live.client.ReadThread(threadID)
		if err != nil {
			return core.Session{}, core.Project{}, err
		}

		session := local
		session.ProjectID = project.ID
		session.BackendThreadID = threadID
		hydrateSessionFromRead(&session, read)
		latestStatus := latestTerminalTurnStatus(read)
		optimisticPendingStart :=
			local.Status == core.SessionStateRunning &&
				strings.TrimSpace(local.ActiveTurnID) == "" &&
				session.ActiveTurnID == "" &&
				latestStatus != "failed"

		if session.Summary == "" || optimisticPendingStart {
			session.Summary = local.Summary
		}
		if session.Summary == "" {
			session.Summary = "Codex thread loaded."
		}
		if session.ActiveTurnID != "" {
			session.Status = core.SessionStateRunning
		} else if optimisticPendingStart {
			session.Status = local.Status
		} else {
			session.Status = finalSessionState(latestStatus, local.Status)
		}
		if hasLocal && strings.TrimSpace(local.LastInputHint) != "" {
			session.LastInputHint = local.LastInputHint
		}
		return session, project, nil
	}

	client, err := m.start(context.Background(), project.RootPath, nil, nil)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	defer client.Close()

	resumed, err := client.ResumeThread(threadID, project.RootPath)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}

	read, err := client.ReadThread(threadID)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}

	session := sessionFromThread(resumed.Thread, project, local, hasLocal)
	session.BackendThreadID = threadID
	hydrateSessionFromRead(&session, read)
	if session.Summary == "" {
		session.Summary = fallbackThreadPreview(resumed.Thread, local, hasLocal)
	}
	if hasLocal && strings.TrimSpace(local.LastInputHint) != "" {
		session.LastInputHint = local.LastInputHint
	}
	session.ActiveTurnID = latestActiveTurnID(read)
	if session.ActiveTurnID != "" {
		session.Status = core.SessionStateRunning
	}

	return session, project, nil
}

func (m *Manager) fetchRawThreadSession(threadID string) (core.Session, core.Project, error) {
	if live := m.liveSession(threadID); live != nil && live.thread == threadID {
		read, err := live.client.ReadThread(threadID)
		if err != nil {
			return m.sessionFromLiveRaw(threadID, live, nil), live.project, nil
		}
		return m.sessionFromLiveRaw(threadID, live, read), live.project, nil
	}

	client, _, err := m.startEphemeralClient()
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	defer client.Close()

	resumed, err := client.ResumeThread(threadID, "")
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	read, err := client.ReadThread(threadID)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}

	project := projectForThreadOrSynthetic(m.workspace.ListProjects(), resumed.Thread)
	session := sessionFromThread(resumed.Thread, project, core.Session{}, false)
	session.BackendThreadID = threadID
	hydrateSessionFromRead(&session, read)
	if session.Summary == "" {
		session.Summary = fallbackThreadPreview(resumed.Thread, core.Session{}, false)
	}
	if session.ActiveTurnID != "" {
		session.Status = core.SessionStateRunning
	}
	return session, project, nil
}

func (m *Manager) ensureLiveSession(sessionKey string, project core.Project, threadID string) (*liveSession, error) {
	live := m.liveSession(sessionKey)
	if live != nil {
		return live, nil
	}

	client, err := m.start(context.Background(), project.RootPath, func(n Notification) {
		m.handleNotification(sessionKey, n)
	}, func() {
		summary := "Codex runtime exited unexpectedly."
		degraded := true
		active := ""
		m.updateWorkspaceSession(sessionKey, core.SessionPatch{
			Status:            ptrSessionState(core.SessionStateDegraded),
			Summary:           &summary,
			AttentionReason:   &summary,
			AttentionRequired: &degraded,
			ActiveTurnID:      &active,
		})
		m.mu.Lock()
		delete(m.live, sessionKey)
		m.mu.Unlock()
	})
	if err != nil {
		return nil, err
	}

	resumed, err := client.ResumeThread(threadID, project.RootPath)
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	read, err := client.ReadThread(threadID)
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	live = &liveSession{
		project: project,
		client:  client,
		thread:  threadID,
		active:  latestActiveTurnID(read),
		record:  resumed.Thread,
	}
	m.mu.Lock()
	m.live[sessionKey] = live
	m.mu.Unlock()
	return live, nil
}

func (m *Manager) liveSession(sessionID string) *liveSession {
	m.mu.Lock()
	defer m.mu.Unlock()
	return m.live[sessionID]
}

func (m *Manager) sessionFromLiveRaw(threadID string, live *liveSession, read *ReadThreadResult) core.Session {
	record := live.record
	if strings.TrimSpace(record.ID) == "" {
		record.ID = threadID
		record.Cwd = live.project.RootPath
		record.UpdatedAt = time.Now().UTC().Unix()
	}

	session := sessionFromThread(record, live.project, core.Session{}, false)
	session.BackendThreadID = threadID
	hydrateSessionFromRead(&session, read)

	if session.Summary == "" && strings.TrimSpace(live.optimisticSummary) != "" {
		session.Summary = live.optimisticSummary
	}
	if session.Summary == "" {
		session.Summary = fallbackThreadPreview(record, core.Session{}, false)
	}

	if strings.TrimSpace(live.optimisticLastInput) != "" {
		session.LastInputHint = live.optimisticLastInput
	}

	if session.ActiveTurnID != "" || strings.TrimSpace(live.active) != "" {
		session.Status = core.SessionStateRunning
	} else if live.optimisticStatus != "" {
		session.Status = live.optimisticStatus
	} else {
		session.Status = finalSessionState(latestTerminalTurnStatus(read), session.Status)
	}

	if !live.optimisticUpdatedAt.IsZero() {
		session.UpdatedAt = live.optimisticUpdatedAt
	}

	return session
}

func hydrateSessionFromRead(session *core.Session, read *ReadThreadResult) {
	if session == nil || read == nil {
		return
	}

	session.TranscriptItems = normalizeTranscriptItems(read)
	session.Summary = latestAgentSummary(read)
	session.ActiveTurnID = latestActiveTurnID(read)
}

func (m *Manager) sessionByThreadID(threadID string) (core.Session, bool) {
	sessions := m.workspace.ListSessions(core.ListSessionsInput{})
	for _, session := range sessions {
		if session.BackendThreadID == threadID {
			return session, true
		}
	}
	return core.Session{}, false
}

func (m *Manager) updateWorkspaceSession(sessionID string, patch core.SessionPatch) {
	if _, ok := m.workspace.GetSession(sessionID); ok {
		_, _ = m.workspace.UpdateSession(sessionID, patch)
	}
}

func sessionFromThread(thread ThreadRecord, project core.Project, local core.Session, hasLocal bool) core.Session {
	session := core.Session{
		ID:              thread.ID,
		ProjectID:       project.ID,
		Title:           fallbackThreadTitle(thread, local, hasLocal),
		BackendThreadID: thread.ID,
		Status:          mapThreadStatus(thread.Status),
		Summary:         fallbackThreadPreview(thread, local, hasLocal),
		UpdatedAt:       time.Unix(thread.UpdatedAt, 0).UTC(),
	}
	if hasLocal {
		session.ID = local.ID
		session.AttentionRequired = local.AttentionRequired
		session.AttentionReason = local.AttentionReason
		session.LastInputHint = local.LastInputHint
		session.Artifacts = append([]core.Artifact(nil), local.Artifacts...)
		if strings.TrimSpace(local.Title) != "" && strings.TrimSpace(thread.NameValue()) == "" {
			session.Title = local.Title
		}
	}
	return session
}

func fallbackThreadTitle(thread ThreadRecord, local core.Session, hasLocal bool) string {
	if name := strings.TrimSpace(thread.NameValue()); name != "" {
		return name
	}
	if hasLocal && strings.TrimSpace(local.Title) != "" {
		return local.Title
	}
	if preview := strings.TrimSpace(thread.Preview); preview != "" {
		return truncate(preview, 72)
	}
	return thread.ID
}

func fallbackThreadPreview(thread ThreadRecord, local core.Session, hasLocal bool) string {
	if preview := strings.TrimSpace(thread.Preview); preview != "" {
		return preview
	}
	if hasLocal && strings.TrimSpace(local.Summary) != "" {
		return local.Summary
	}
	return "Codex thread loaded."
}

func mapThreadStatus(status ThreadStatus) core.SessionState {
	switch status.Type {
	case "active":
		return core.SessionStateRunning
	case "systemError":
		return core.SessionStateFailed
	case "idle", "notLoaded":
		return core.SessionStateCompleted
	default:
		return core.SessionStatePending
	}
}

func latestActiveTurnID(read *ReadThreadResult) string {
	if read == nil {
		return ""
	}
	for i := len(read.Thread.Turns) - 1; i >= 0; i-- {
		turn := read.Thread.Turns[i]
		if turn.Status == "inProgress" {
			return turn.ID
		}
	}
	return ""
}

func latestTerminalTurnStatus(read *ReadThreadResult) string {
	if read == nil {
		return ""
	}
	for i := len(read.Thread.Turns) - 1; i >= 0; i-- {
		turn := read.Thread.Turns[i]
		if turn.Status == "" || turn.Status == "inProgress" {
			continue
		}
		return turn.Status
	}
	return ""
}

func finalSessionState(turnStatus string, fallback core.SessionState) core.SessionState {
	switch turnStatus {
	case "failed":
		return core.SessionStateFailed
	case "interrupted":
		return core.SessionStateWaitingInput
	case "completed":
		return core.SessionStateCompleted
	default:
		if fallback == "" {
			return core.SessionStatePending
		}
		return fallback
	}
}

func projectForThread(projects []core.Project, cwd string) (core.Project, bool) {
	normalizedCwd := filepath.Clean(strings.TrimSpace(cwd))
	var (
		best    core.Project
		bestLen int
		found   bool
	)
	for _, project := range projects {
		root := filepath.Clean(strings.TrimSpace(project.RootPath))
		if root == "" {
			continue
		}
		if normalizedCwd == root || strings.HasPrefix(normalizedCwd, root+string(filepath.Separator)) {
			if len(root) > bestLen {
				best = project
				bestLen = len(root)
				found = true
			}
		}
	}
	return best, found
}

func projectForThreadOrSynthetic(projects []core.Project, thread ThreadRecord) core.Project {
	if project, ok := projectForThread(projects, thread.Cwd); ok {
		return project
	}

	rootPath := repoRootForPath(thread.Cwd)
	if project, ok := projectForThread(projects, rootPath); ok {
		return project
	}

	updatedAt := time.Unix(thread.UpdatedAt, 0).UTC()
	createdAt := time.Unix(thread.CreatedAt, 0).UTC()
	name := filepath.Base(rootPath)
	if name == "." || name == string(filepath.Separator) || name == "" {
		name = rootPath
	}

	return core.Project{
		ID:             "cwd:" + rootPath,
		Name:           name,
		RootPath:       rootPath,
		DefaultBackend: "codex",
		CreatedAt:      createdAt,
		UpdatedAt:      updatedAt,
	}
}

func (t ThreadRecord) NameValue() string {
	if t.Name == nil {
		return ""
	}
	return *t.Name
}

func repoRootForPath(cwd string) string {
	normalized := filepath.Clean(strings.TrimSpace(cwd))
	if normalized == "." || normalized == "" {
		return normalized
	}

	cmd := exec.Command("git", "-C", normalized, "rev-parse", "--show-toplevel")
	output, err := cmd.Output()
	if err != nil {
		return normalized
	}

	root := filepath.Clean(strings.TrimSpace(string(output)))
	if root == "" {
		return normalized
	}
	return root
}
