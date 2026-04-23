package codex

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"os/exec"
	"path/filepath"
	"sort"
	"strings"
	"sync"
	"time"

	"golang.org/x/sync/singleflight"

	"github.com/pmenglund/codex-sdk-go/protocol"
	"github.com/sorcererxw/hopter/internal/core"
)

type Manager struct {
	mu              sync.Mutex
	workspace       core.WorkspaceService
	eventSink       core.EventSink
	live            map[string]*liveSession
	start           clientStarter
	threadListMu    sync.Mutex
	threadListCache map[string]threadListCacheEntry
	threadListGroup singleflight.Group
}

type threadListCacheEntry struct {
	expiresAt time.Time
	list      *ThreadListResult
}

type pendingApproval struct {
	ID      string
	RawID   json.RawMessage
	Method  string
	Params  json.RawMessage
	Message string
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
	draftItemID         string
	draftText           string
	reasoningDrafts     map[string]*reasoningDraft
	pendingApproval     *pendingApproval
}

type reasoningDraft struct {
	summary             string
	raw                 string
	pendingSummaryBreak bool
	turnID              string
}

type liveSessionKey struct {
	mu    sync.RWMutex
	value string
}

const watchTurnPollAttempts = 180

var (
	watchTurnPollInterval = 2 * time.Second
	threadListCacheTTL    = 750 * time.Millisecond
)

const (
	threadListHydrateReadLimit     = 20
	threadListHydrateRecentWindow  = 24 * time.Hour
	threadListHydrateRunningWindow = 7 * 24 * time.Hour
)

type codexClient interface {
	Close() error
	InterruptTurn(threadID, turnID string) error
	ListModels(includeHidden bool) (*ModelListResult, error)
	ListThreads(cwd string, limit uint32) (*ThreadListResult, error)
	ReadThread(threadID string) (*ReadThreadResult, error)
	ReadThreadMeta(threadID string) (*ReadThreadResult, error)
	ResumeThread(threadID, cwd string, options core.SessionTurnOptions) (*ResumeThreadResult, error)
	RespondToApproval(rawID json.RawMessage, result any) error
	StartThread(cwd string, options core.SessionTurnOptions) (*StartThreadResult, error)
	StartTurn(threadID string, text string, options core.SessionTurnOptions) (*StartTurnResult, error)
	SteerTurn(threadID, expectedTurnID, text string) (*StartTurnResult, error)
}

type clientStarter func(
	ctx context.Context,
	cwd string,
	onNotification func(Notification),
	onServerRequest func(ServerRequest),
	onTrace func(TraceEntry),
	onExit func(),
) (codexClient, error)

type ResolvedSession struct {
	Project core.Project
	Session core.Session
}

func NewManager(workspace core.WorkspaceService, eventSink ...core.EventSink) *Manager {
	var sink core.EventSink
	if len(eventSink) > 0 {
		sink = eventSink[0]
	}
	return &Manager{
		workspace:       workspace,
		eventSink:       sink,
		live:            make(map[string]*liveSession),
		threadListCache: make(map[string]threadListCacheEntry),
		start: func(
			ctx context.Context,
			cwd string,
			onNotification func(Notification),
			onServerRequest func(ServerRequest),
			onTrace func(TraceEntry),
			onExit func(),
		) (codexClient, error) {
			return Start(ctx, cwd, onNotification, onServerRequest, onTrace, onExit)
		},
	}
}

func (m *Manager) ListModels(includeHidden bool) ([]core.AgentModel, error) {
	client, _, err := m.startEphemeralClient()
	if err != nil {
		return nil, err
	}
	defer client.Close()

	result, err := client.ListModels(includeHidden)
	if err != nil {
		return nil, err
	}

	models := make([]core.AgentModel, 0, len(result.Data))
	for _, item := range result.Data {
		models = append(models, modelRecordToCore(item))
	}
	return models, nil
}

func modelRecordToCore(item ModelRecord) core.AgentModel {
	efforts := make([]core.ModelReasoningEffort, 0, len(item.SupportedReasoningEfforts))
	for _, effort := range item.SupportedReasoningEfforts {
		efforts = append(efforts, core.ModelReasoningEffort{
			ReasoningEffort: effort.ReasoningEffort,
			Description:     effort.Description,
		})
	}

	return core.AgentModel{
		ID:                        item.ID,
		Model:                     item.Model,
		DisplayName:               item.DisplayName,
		Description:               item.Description,
		IsDefault:                 item.IsDefault,
		DefaultReasoningEffort:    item.DefaultReasoningEffort,
		SupportedReasoningEfforts: efforts,
		InputModalities:           append([]string(nil), item.InputModalities...),
	}
}

func (m *Manager) ListSessions(projectID string, limit uint32) ([]ResolvedSession, error) {
	projects := m.workspace.ListProjects()

	list, err := m.listThreadsCached(max(limit, 100))
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

func (m *Manager) listThreadsCached(limit uint32) (*ThreadListResult, error) {
	key := fmt.Sprintf("thread-list:%d", limit)
	if list, ok := m.getCachedThreadList(key); ok {
		return cloneThreadListResult(list), nil
	}

	value, err, _ := m.threadListGroup.Do(key, func() (any, error) {
		if list, ok := m.getCachedThreadList(key); ok {
			return cloneThreadListResult(list), nil
		}

		client, _, err := m.startEphemeralClient()
		if err != nil {
			return nil, err
		}
		defer client.Close()

		list, err := client.ListThreads("", limit)
		if err != nil {
			return nil, err
		}
		m.hydrateRecentThreadListStatuses(client, list)
		m.setCachedThreadList(key, list)
		return cloneThreadListResult(list), nil
	})
	if err != nil {
		return nil, err
	}

	list, ok := value.(*ThreadListResult)
	if !ok {
		return nil, fmt.Errorf("thread list cache returned %T", value)
	}
	return cloneThreadListResult(list), nil
}

func (m *Manager) hydrateRecentThreadListStatuses(client codexClient, list *ThreadListResult) {
	if client == nil || list == nil || len(list.Data) == 0 {
		return
	}

	now := time.Now().UTC()
	hydrated := 0
	for index := range list.Data {
		thread := &list.Data[index]
		if strings.TrimSpace(thread.ID) == "" {
			continue
		}
		if strings.EqualFold(thread.Status.Type, "active") {
			continue
		}

		threadAge := time.Duration(0)
		if thread.UpdatedAt > 0 {
			threadAge = now.Sub(time.Unix(thread.UpdatedAt, 0).UTC())
		}
		if threadAge <= threadListHydrateRunningWindow && localCodexSessionRunning(thread.ID) {
			thread.Status = ThreadStatus{Type: "active"}
			thread.UpdatedAt = max(thread.UpdatedAt, now.Unix())
			continue
		}

		if hydrated >= threadListHydrateReadLimit {
			continue
		}
		if threadAge > threadListHydrateRecentWindow {
			continue
		}

		read, err := client.ReadThread(thread.ID)
		if err != nil {
			continue
		}
		hydrated++
		if latestActiveTurnID(read) != "" {
			thread.Status = ThreadStatus{Type: "active"}
			thread.UpdatedAt = max(thread.UpdatedAt, read.Thread.UpdatedAt)
			continue
		}
		if latestTerminalTurnStatus(read) == "failed" {
			thread.Status = ThreadStatus{Type: "systemError"}
			thread.UpdatedAt = max(thread.UpdatedAt, read.Thread.UpdatedAt)
		}
	}
}

func (m *Manager) getCachedThreadList(key string) (*ThreadListResult, bool) {
	m.threadListMu.Lock()
	defer m.threadListMu.Unlock()

	entry, ok := m.threadListCache[key]
	if !ok || time.Now().After(entry.expiresAt) {
		if ok {
			delete(m.threadListCache, key)
		}
		return nil, false
	}
	return entry.list, true
}

func (m *Manager) setCachedThreadList(key string, list *ThreadListResult) {
	m.threadListMu.Lock()
	defer m.threadListMu.Unlock()

	m.threadListCache[key] = threadListCacheEntry{
		expiresAt: time.Now().Add(threadListCacheTTL),
		list:      cloneThreadListResult(list),
	}
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

	options := core.SessionTurnOptions{
		Model:           input.Model,
		ReasoningEffort: input.ReasoningEffort,
		CodexFastMode:   input.CodexFastMode,
	}
	live, err := m.startNewLiveSession(project, options)
	if err != nil {
		return core.Session{}, fmt.Errorf("start codex thread: %w", err)
	}

	threadID := strings.TrimSpace(live.thread)
	input.ProjectID = project.ID
	input.SessionID = threadID
	session, err := m.workspace.CreateSession(input)
	if err != nil {
		_ = live.client.Close()
		m.mu.Lock()
		delete(m.live, threadID)
		m.mu.Unlock()
		return core.Session{}, err
	}

	summary := "Codex thread started. Running the first turn…"
	running := core.SessionStateRunning
	session, err = m.workspace.UpdateSession(session.ID, core.SessionPatch{
		BackendThreadID: &threadID,
		Status:          &running,
		Summary:         &summary,
	})
	if err != nil {
		_ = live.client.Close()
		m.mu.Lock()
		delete(m.live, threadID)
		m.mu.Unlock()
		return core.Session{}, err
	}

	now := time.Now().UTC()
	m.mu.Lock()
	if current := m.live[session.ID]; current != nil {
		current.optimisticSummary = summary
		current.optimisticLastInput = truncate(strings.TrimSpace(input.Prompt), 120)
		current.optimisticStatus = running
		current.optimisticUpdatedAt = now
	}
	m.mu.Unlock()

	go m.dispatchInput(project, session.ID, threadID, input.Prompt, options)
	return session, nil
}

func (m *Manager) SendSessionInput(sessionID, input string, options ...core.SessionTurnOptions) (core.Session, error) {
	turnOptions := firstTurnOptions(options...)
	if session, ok := m.workspace.GetSession(sessionID); ok {
		updated, err := m.workspace.SendSessionInput(sessionID, input)
		if err != nil {
			return core.Session{}, err
		}
		project, ok := m.workspace.GetProject(session.ProjectID)
		if !ok {
			return core.Session{}, fmt.Errorf("project %q not found", session.ProjectID)
		}
		go m.dispatchInput(project, sessionID, session.BackendThreadID, input, turnOptions)
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
	go m.dispatchInput(project, sessionID, session.BackendThreadID, input, turnOptions)
	return session, nil
}

func (m *Manager) InterruptSession(sessionID string) (core.Session, error) {
	session, project, err := m.GetSession(sessionID)
	if err != nil {
		return core.Session{}, err
	}
	if local, ok := m.workspace.GetSession(sessionID); ok {
		if strings.TrimSpace(local.BackendThreadID) != "" {
			session.BackendThreadID = local.BackendThreadID
		}
		if strings.TrimSpace(local.ActiveTurnID) != "" {
			session.ActiveTurnID = local.ActiveTurnID
		}
	}

	threadID := strings.TrimSpace(session.BackendThreadID)
	turnID := strings.TrimSpace(session.ActiveTurnID)
	if threadID == "" || turnID == "" {
		if interrupted, err := m.interruptExternalLocalSession(sessionID, session, project); err == nil {
			return interrupted, nil
		}
		return core.Session{}, fmt.Errorf("session %q has no active turn to interrupt", sessionID)
	}

	live, err := m.ensureLiveSession(sessionID, project, threadID, core.SessionTurnOptions{})
	if err != nil {
		return core.Session{}, err
	}
	if err := live.client.InterruptTurn(threadID, turnID); err != nil {
		return core.Session{}, err
	}

	active := ""
	pendingApprovalID := ""
	waiting := core.SessionStateWaitingInput
	attention := false
	reason := ""
	summary := "Codex stopped before completing the turn."
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		PendingApprovalID: &pendingApprovalID,
		ActiveTurnID:      &active,
		Status:            &waiting,
		AttentionRequired: &attention,
		AttentionReason:   &reason,
		Summary:           &summary,
	})

	m.mu.Lock()
	if current := m.live[sessionID]; current != nil {
		current.active = ""
		current.optimisticSummary = summary
		current.optimisticStatus = waiting
		current.optimisticUpdatedAt = time.Now().UTC()
		current.pendingApproval = nil
		current.draftItemID = ""
		current.draftText = ""
		current.reasoningDrafts = nil
	}
	m.mu.Unlock()

	m.publishLivePatch(sessionID, project.ID, core.SessionLivePatch{
		Kind:            core.SessionLivePatchKindStatus,
		Status:          waiting,
		Summary:         summary,
		RequiresRefetch: true,
	})

	updated, ok := m.workspace.GetSession(sessionID)
	if !ok {
		return core.Session{}, fmt.Errorf("session %q not found", sessionID)
	}
	return updated, nil
}

func (m *Manager) interruptExternalLocalSession(
	sessionID string,
	session core.Session,
	project core.Project,
) (core.Session, error) {
	threadID := strings.TrimSpace(session.BackendThreadID)
	if threadID == "" {
		threadID = strings.TrimSpace(sessionID)
	}
	if threadID == "" {
		return core.Session{}, fmt.Errorf("session %q is missing backend thread id", sessionID)
	}
	if err := interruptLocalCodexExecSession(threadID); err != nil {
		return core.Session{}, err
	}

	active := ""
	pendingApprovalID := ""
	waiting := core.SessionStateWaitingInput
	attention := false
	reason := ""
	summary := "Codex stopped before completing the turn."
	patch := core.SessionPatch{
		PendingApprovalID: &pendingApprovalID,
		ActiveTurnID:      &active,
		Status:            &waiting,
		AttentionRequired: &attention,
		AttentionReason:   &reason,
		Summary:           &summary,
	}
	m.updateWorkspaceSession(sessionID, patch)

	session.ActiveTurnID = active
	session.PendingApprovalID = pendingApprovalID
	session.Status = waiting
	session.AttentionRequired = attention
	session.AttentionReason = reason
	session.Summary = summary
	session.UpdatedAt = time.Now().UTC()

	if m.eventSink != nil {
		m.eventSink.Publish(core.Event{
			Kind:      core.EventSessionChanged,
			ProjectID: project.ID,
			SessionID: sessionID,
			Summary:   summary,
			LivePatch: &core.SessionLivePatch{
				Kind:            core.SessionLivePatchKindStatus,
				Status:          waiting,
				Summary:         summary,
				RequiresRefetch: true,
			},
		})
	}
	return session, nil
}

func (m *Manager) runSession(project core.Project, sessionID, prompt string, options core.SessionTurnOptions) {
	summary := "Codex thread started. Running the first turn…"
	running := core.SessionStateRunning
	_, _ = m.workspace.UpdateSession(sessionID, core.SessionPatch{
		Status:  &running,
		Summary: &summary,
	})
	m.executeTurn(project, sessionID, "", prompt, "Codex is working…", options)
}

func (m *Manager) dispatchInput(project core.Project, sessionID, threadID, input string, options core.SessionTurnOptions) {
	m.executeTurn(project, sessionID, threadID, input, "Codex is processing the latest input…", options)
}

func firstTurnOptions(options ...core.SessionTurnOptions) core.SessionTurnOptions {
	if len(options) == 0 {
		return core.SessionTurnOptions{}
	}
	return options[0]
}

func (m *Manager) executeTurn(project core.Project, sessionID, threadID, input, runningSummary string, options core.SessionTurnOptions) {
	userItem := userTranscriptItem(input)
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		AppendTranscriptItems: &[]core.SessionTranscriptItem{userItem},
	})

	var (
		live *liveSession
		err  error
	)
	if strings.TrimSpace(threadID) == "" {
		live, err = m.startLiveSession(sessionID, project, options)
	} else {
		live, err = m.ensureLiveSession(sessionID, project, threadID, options)
	}
	if err != nil {
		m.failSession(sessionID, fmt.Errorf("execute codex turn: %w", err))
		return
	}

	resolvedThreadID := strings.TrimSpace(live.thread)
	if strings.TrimSpace(threadID) == "" && resolvedThreadID != "" {
		m.updateWorkspaceSession(sessionID, core.SessionPatch{
			BackendThreadID: &resolvedThreadID,
		})
	}

	var turn *StartTurnResult
	expectedTurnID := strings.TrimSpace(live.active)
	if expectedTurnID == "" {
		turn, err = live.client.StartTurn(resolvedThreadID, input, options)
	} else {
		turn, err = live.client.SteerTurn(resolvedThreadID, expectedTurnID, input)
	}
	if err != nil {
		m.failSession(sessionID, fmt.Errorf("start app-server turn: %w", err))
		return
	}

	activeTurnID := strings.TrimSpace(turn.Turn.ID)
	now := time.Now().UTC()
	running := core.SessionStateRunning
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		ActiveTurnID: &activeTurnID,
		Status:       &running,
		Summary:      &runningSummary,
	})

	m.mu.Lock()
	if current := m.live[sessionID]; current != nil {
		current.active = activeTurnID
		current.optimisticSummary = runningSummary
		current.optimisticLastInput = truncate(strings.TrimSpace(input), 120)
		current.optimisticStatus = running
		current.optimisticUpdatedAt = now
	}
	m.mu.Unlock()

	go m.watchTurn(sessionID, resolvedThreadID, activeTurnID)
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
		var payload protocol.TurnStartedNotification
		if err := json.Unmarshal(notification.Params, &payload); err == nil && payload.Turn != nil && payload.Turn.ID != "" {
			active := payload.Turn.ID
			approvalID := ""
			running := core.SessionStateRunning
			summary := "Codex is working…"
			attention := false
			reason := ""
			m.updateWorkspaceSession(sessionID, core.SessionPatch{
				PendingApprovalID: &approvalID,
				ActiveTurnID:      &active,
				Status:            &running,
				Summary:           &summary,
				AttentionRequired: &attention,
				AttentionReason:   &reason,
			})
			m.mu.Lock()
			var projectID string
			if live := m.live[sessionID]; live != nil {
				live.active = active
				live.optimisticSummary = summary
				live.optimisticStatus = running
				live.optimisticUpdatedAt = time.Now().UTC()
				live.pendingApproval = nil
				projectID = live.project.ID
			}
			m.mu.Unlock()
			if projectID != "" {
				m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
					Kind:         core.SessionLivePatchKindStatus,
					ActiveTurnID: active,
					Status:       running,
					Summary:      summary,
				})
			}
		}
	case "turn/completed":
		var payload protocol.TurnCompletedNotification
		_ = json.Unmarshal(notification.Params, &payload)
		m.mu.Lock()
		live := m.live[sessionID]
		if live != nil {
			live.active = ""
			live.optimisticSummary = ""
			live.optimisticStatus = ""
			live.draftItemID = ""
			live.draftText = ""
			live.reasoningDrafts = nil
		}
		m.mu.Unlock()

		active := ""
		approvalID := ""
		turnStatus := ""
		if payload.Turn != nil {
			turnStatus = payload.Turn.Status
		}
		status := finalSessionState(turnStatus, core.SessionStateCompleted)
		summary := "Codex completed the turn."
		if turnStatus == "interrupted" {
			summary = "Codex stopped before completing the turn."
		}

		if live != nil {
			if read, err := live.client.ReadThread(live.thread); err == nil {
				transcriptItems := m.mergeSessionTranscriptItems(sessionID, normalizeTranscriptItems(read))
				if len(transcriptItems) > 0 {
					m.updateWorkspaceSession(sessionID, core.SessionPatch{
						TranscriptItems: &transcriptItems,
					})
				}
				if extracted := latestAgentSummary(read); extracted != "" {
					summary = extracted
				}
			}
		}

		m.updateWorkspaceSession(sessionID, core.SessionPatch{
			PendingApprovalID: &approvalID,
			ActiveTurnID:      &active,
			Status:            &status,
			Summary:           &summary,
		})
		if live != nil {
			m.publishLivePatch(sessionID, live.project.ID, core.SessionLivePatch{
				Kind:            core.SessionLivePatchKindReconcileRequired,
				Status:          status,
				Summary:         summary,
				RequiresRefetch: true,
			})
		}
	case "error":
		m.failSession(sessionID, errors.New("codex emitted an error notification"))
	case "item/agentMessage/delta":
		var payload protocol.AgentMessageDeltaNotification
		if err := json.Unmarshal(notification.Params, &payload); err == nil && strings.TrimSpace(payload.Delta) != "" {
			var (
				projectID string
				delta     = payload.Delta
			)
			m.mu.Lock()
			if live := m.live[sessionID]; live != nil {
				live.draftItemID = payload.ItemID
				live.draftText += delta
				projectID = live.project.ID
				if strings.TrimSpace(payload.TurnID) != "" {
					live.active = payload.TurnID
				}
			}
			m.mu.Unlock()
			if projectID != "" {
				m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
					Kind:         core.SessionLivePatchKindDraftDelta,
					ActiveTurnID: strings.TrimSpace(payload.TurnID),
					DraftItemID:  strings.TrimSpace(payload.ItemID),
					DraftDelta:   delta,
					Status:       core.SessionStateRunning,
				})
			}
		}
	case "item/started":
		m.handleReasoningItemStarted(sessionID, notification.Params)
	case "item/reasoning/summaryTextDelta":
		var payload protocol.ReasoningSummaryTextDeltaNotification
		if err := json.Unmarshal(notification.Params, &payload); err == nil && payload.Delta != "" {
			m.handleReasoningDelta(sessionID, payload.TurnID, payload.ItemID, payload.Delta, "")
		}
	case "item/reasoning/summaryPartAdded":
		var payload protocol.ReasoningSummaryPartAddedNotification
		if err := json.Unmarshal(notification.Params, &payload); err == nil {
			m.handleReasoningSummaryPartAdded(sessionID, payload.TurnID, payload.ItemID)
		}
	case "item/reasoning/textDelta":
		var payload protocol.ReasoningTextDeltaNotification
		if err := json.Unmarshal(notification.Params, &payload); err == nil && payload.Delta != "" {
			m.handleReasoningDelta(sessionID, payload.TurnID, payload.ItemID, "", payload.Delta)
		}
	case "item/completed":
		var payload protocol.ItemCompletedNotification
		if err := json.Unmarshal(notification.Params, &payload); err == nil {
			var item ReadThreadItem
			_ = json.Unmarshal(payload.Item, &item)
			text := strings.TrimSpace(item.Text)
			if item.Type == "agentMessage" && text != "" {
				phase := item.Phase
				if strings.EqualFold(strings.TrimSpace(phase), "commentary") {
					var projectID string
					m.mu.Lock()
					if live := m.live[sessionID]; live != nil {
						live.draftItemID = ""
						live.draftText = ""
						projectID = live.project.ID
					}
					m.mu.Unlock()
					if projectID != "" {
						m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
							Kind: core.SessionLivePatchKindMessageFinalized,
							FinalItem: &core.SessionTranscriptItem{
								ID:     strings.TrimSpace(item.ID),
								Kind:   core.SessionTranscriptItemKindAgentMessage,
								Title:  "Codex",
								Status: strings.TrimSpace(phase),
							},
							Status: core.SessionStateRunning,
						})
					}
					return
				}
				summary := text
				m.updateWorkspaceSession(sessionID, core.SessionPatch{
					Summary: &summary,
				})
				var projectID string
				m.mu.Lock()
				if live := m.live[sessionID]; live != nil {
					live.draftItemID = ""
					live.draftText = ""
					projectID = live.project.ID
				}
				m.mu.Unlock()
				if projectID != "" {
					m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
						Kind: core.SessionLivePatchKindMessageFinalized,
						FinalItem: &core.SessionTranscriptItem{
							ID: strings.TrimSpace(item.ID),
							OrderKey: fmt.Sprintf(
								"live:%020d:%s",
								time.Now().UTC().UnixNano(),
								strings.TrimSpace(item.ID),
							),
							Kind:   core.SessionTranscriptItemKindAgentMessage,
							Title:  "Codex",
							Body:   text,
							Status: strings.TrimSpace(phase),
						},
						Status:  core.SessionStateRunning,
						Summary: text,
					})
				}
			}
			if item.Type == "reasoning" {
				m.handleReasoningItemCompleted(sessionID, item)
			}
		}
	}
}

func (m *Manager) handleReasoningItemStarted(sessionID string, rawParams json.RawMessage) {
	var payload struct {
		ThreadID string         `json:"threadId"`
		TurnID   string         `json:"turnId"`
		Item     ReadThreadItem `json:"item"`
	}
	if err := json.Unmarshal(rawParams, &payload); err != nil || payload.Item.Type != "reasoning" {
		return
	}

	item, ok := normalizeThreadItemWithOptions(payload.Item, liveReasoningNormalizeOptions())
	if !ok {
		return
	}
	item.Status = "streaming"
	if strings.TrimSpace(item.OrderKey) == "" {
		item.OrderKey = liveTranscriptOrderKey(item.ID)
	}

	var projectID string
	m.mu.Lock()
	if live := m.live[sessionID]; live != nil {
		draft := live.ensureReasoningDraft(item.ID)
		draft.summary = item.Body
		draft.raw = item.DisplayBody
		draft.turnID = strings.TrimSpace(payload.TurnID)
		if strings.TrimSpace(payload.TurnID) != "" {
			live.active = payload.TurnID
		}
		projectID = live.project.ID
	}
	m.mu.Unlock()

	if projectID != "" {
		m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
			Kind:         core.SessionLivePatchKindDraftDelta,
			ActiveTurnID: strings.TrimSpace(payload.TurnID),
			DraftItemID:  strings.TrimSpace(item.ID),
			FinalItem:    &item,
			Status:       core.SessionStateRunning,
		})
	}
}

func (m *Manager) handleReasoningSummaryPartAdded(sessionID, turnID, itemID string) {
	itemID = strings.TrimSpace(itemID)
	if itemID == "" {
		return
	}

	m.mu.Lock()
	if live := m.live[sessionID]; live != nil {
		draft := live.ensureReasoningDraft(itemID)
		draft.pendingSummaryBreak = strings.TrimSpace(draft.summary) != ""
		draft.turnID = strings.TrimSpace(turnID)
		if strings.TrimSpace(turnID) != "" {
			live.active = turnID
		}
	}
	m.mu.Unlock()
}

func (m *Manager) handleReasoningDelta(
	sessionID string,
	turnID string,
	itemID string,
	summaryDelta string,
	rawDelta string,
) {
	itemID = strings.TrimSpace(itemID)
	if itemID == "" || (summaryDelta == "" && rawDelta == "") {
		return
	}

	var projectID string
	m.mu.Lock()
	if live := m.live[sessionID]; live != nil {
		draft := live.ensureReasoningDraft(itemID)
		if summaryDelta != "" {
			if draft.pendingSummaryBreak && strings.TrimSpace(draft.summary) != "" {
				summaryDelta = "\n\n" + summaryDelta
			}
			draft.summary += summaryDelta
			draft.pendingSummaryBreak = false
		}
		if rawDelta != "" {
			draft.raw += rawDelta
		}
		draft.turnID = strings.TrimSpace(turnID)
		if strings.TrimSpace(turnID) != "" {
			live.active = turnID
		}
		projectID = live.project.ID
	}
	m.mu.Unlock()

	if projectID != "" {
		m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
			Kind:         core.SessionLivePatchKindDraftDelta,
			ActiveTurnID: strings.TrimSpace(turnID),
			DraftItemID:  itemID,
			DraftDelta:   summaryDelta + rawDelta,
			FinalItem: &core.SessionTranscriptItem{
				ID:          itemID,
				OrderKey:    liveTranscriptOrderKey(itemID),
				Kind:        core.SessionTranscriptItemKindReasoning,
				Title:       "Thinking",
				Body:        summaryDelta,
				DisplayBody: rawDelta,
				Status:      "streaming",
			},
			Status: core.SessionStateRunning,
		})
	}
}

func (m *Manager) handleReasoningItemCompleted(sessionID string, item ReadThreadItem) {
	normalized, ok := normalizeThreadItemWithOptions(item, liveReasoningNormalizeOptions())
	if !ok {
		return
	}
	if strings.TrimSpace(normalized.Status) == "" {
		normalized.Status = "completed"
	}
	if strings.TrimSpace(normalized.OrderKey) == "" {
		normalized.OrderKey = liveTranscriptOrderKey(normalized.ID)
	}
	m.rememberCodexEmittedTranscriptItem(sessionID, normalized)

	var projectID string
	m.mu.Lock()
	if live := m.live[sessionID]; live != nil {
		delete(live.reasoningDrafts, strings.TrimSpace(item.ID))
		projectID = live.project.ID
	}
	m.mu.Unlock()

	if projectID != "" {
		m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
			Kind:      core.SessionLivePatchKindMessageFinalized,
			FinalItem: &normalized,
			Status:    core.SessionStateRunning,
		})
	}
}

func (l *liveSession) ensureReasoningDraft(itemID string) *reasoningDraft {
	if l.reasoningDrafts == nil {
		l.reasoningDrafts = make(map[string]*reasoningDraft)
	}
	itemID = strings.TrimSpace(itemID)
	draft := l.reasoningDrafts[itemID]
	if draft == nil {
		draft = &reasoningDraft{}
		l.reasoningDrafts[itemID] = draft
	}
	return draft
}

func liveReasoningNormalizeOptions() transcriptNormalizeOptions {
	return transcriptNormalizeOptions{
		itemLimit:          0,
		reasoningLimit:     1200,
		commandOutputLimit: 1600,
		includeFileDiff:    true,
	}
}

func liveTranscriptOrderKey(itemID string) string {
	return fmt.Sprintf(
		"live:%020d:%s",
		time.Now().UTC().UnixNano(),
		strings.TrimSpace(itemID),
	)
}

func (m *Manager) handleServerRequest(sessionID string, req ServerRequest) {
	if !isApprovalRequest(req.Method) {
		return
	}

	message := approvalMessage(req.Method)
	approvalID := strings.TrimSpace(string(req.ID))
	if approvalID == "" {
		return
	}

	var projectID string
	m.mu.Lock()
	if live := m.live[sessionID]; live != nil {
		live.pendingApproval = &pendingApproval{
			ID:      approvalID,
			RawID:   append(json.RawMessage(nil), req.ID...),
			Method:  req.Method,
			Params:  append(json.RawMessage(nil), req.Params...),
			Message: message,
		}
		projectID = live.project.ID
	}
	m.mu.Unlock()

	waiting := core.SessionStateWaitingApproval
	attention := true
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		PendingApprovalID: &approvalID,
		Status:            &waiting,
		AttentionRequired: &attention,
		AttentionReason:   &message,
	})
	if projectID != "" {
		m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
			Kind:            core.SessionLivePatchKindStatus,
			Status:          waiting,
			Summary:         message,
			RequiresRefetch: true,
		})
	}
}

func isApprovalRequest(method string) bool {
	switch method {
	case "item/commandExecution/requestApproval",
		"item/fileChange/requestApproval",
		"execCommandApproval",
		"applyPatchApproval",
		"item/permissions/requestApproval":
		return true
	default:
		return false
	}
}

func approvalMessage(method string) string {
	switch method {
	case "item/commandExecution/requestApproval", "execCommandApproval":
		return "Codex needs approval to run a command."
	case "item/fileChange/requestApproval", "applyPatchApproval":
		return "Codex needs approval to change files."
	case "item/permissions/requestApproval":
		return "Codex needs approval for additional permissions."
	default:
		return "Codex needs approval to continue."
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
			if item.Type == "agentMessage" &&
				!isCommentaryAgentMessage(item) &&
				strings.TrimSpace(item.Text) != "" {
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
	for attempt := range watchTurnPollAttempts {
		m.mu.Lock()
		live := m.live[sessionID]
		m.mu.Unlock()
		if live == nil {
			return
		}

		read, err := live.client.ReadThread(threadID)
		if err == nil {
			statusText := latestTurnStatus(read, turnID)
			if statusText != "" && statusText != "inProgress" {
				active := ""
				status := finalSessionState(statusText, core.SessionStateCompleted)
				summary := latestAgentSummary(read)
				transcriptItems := m.mergeSessionTranscriptItems(sessionID, normalizeTranscriptItems(read))
				if summary == "" {
					if statusText == "interrupted" {
						summary = "Codex stopped before completing the turn."
					} else {
						summary = "Codex completed the turn."
					}
				}
				patch := core.SessionPatch{
					ActiveTurnID: &active,
					Status:       &status,
					Summary:      &summary,
				}
				if len(transcriptItems) > 0 {
					patch.TranscriptItems = &transcriptItems
				}
				m.updateWorkspaceSession(sessionID, patch)
				m.publishLivePatch(sessionID, live.project.ID, core.SessionLivePatch{
					Kind:            core.SessionLivePatchKindReconcileRequired,
					Status:          status,
					Summary:         summary,
					RequiresRefetch: true,
				})
				m.mu.Lock()
				if current := m.live[sessionID]; current != nil {
					current.active = ""
					current.optimisticSummary = ""
					current.optimisticStatus = ""
					current.draftItemID = ""
					current.draftText = ""
					current.reasoningDrafts = nil
				}
				m.mu.Unlock()
				return
			}

		}

		if attempt < watchTurnPollAttempts-1 {
			time.Sleep(watchTurnPollInterval)
		}
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

func (m *Manager) publishLivePatch(sessionID, projectID string, patch core.SessionLivePatch) {
	if m.eventSink == nil {
		return
	}
	summary := strings.TrimSpace(patch.Summary)
	m.eventSink.Publish(core.Event{
		Kind:      core.EventSessionChanged,
		ProjectID: projectID,
		SessionID: sessionID,
		Summary:   summary,
		LivePatch: &patch,
	})
}

func (m *Manager) rememberCodexEmittedTranscriptItem(
	sessionID string,
	item core.SessionTranscriptItem,
) {
	if !shouldRetainCodexEmittedTranscriptItem(item) {
		return
	}
	session, ok := m.workspace.GetSession(sessionID)
	if !ok {
		return
	}
	items := appendOrReplaceTranscriptItem(
		append([]core.SessionTranscriptItem(nil), session.TranscriptItems...),
		item,
	)
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		TranscriptItems: &items,
	})
}

func (m *Manager) mergeSessionTranscriptItems(
	sessionID string,
	canonical []core.SessionTranscriptItem,
) []core.SessionTranscriptItem {
	session, ok := m.workspace.GetSession(sessionID)
	if !ok {
		return canonical
	}
	return mergeCodexSourcedTranscriptItems(canonical, session.TranscriptItems)
}

func (k *liveSessionKey) Get() string {
	if k == nil {
		return ""
	}
	k.mu.RLock()
	defer k.mu.RUnlock()
	return k.value
}

func (k *liveSessionKey) Set(value string) {
	if k == nil {
		return
	}
	k.mu.Lock()
	k.value = value
	k.mu.Unlock()
}

func (m *Manager) startNewLiveSession(project core.Project, options core.SessionTurnOptions) (*liveSession, error) {
	sessionKey := &liveSessionKey{}
	traceWriter := newDeferredAppServerTraceWriter(project.RootPath)
	client, err := m.start(context.Background(), project.RootPath, func(n Notification) {
		if key := sessionKey.Get(); key != "" {
			m.handleNotification(key, n)
		}
	}, func(req ServerRequest) {
		if key := sessionKey.Get(); key != "" {
			m.handleServerRequest(key, req)
		}
	}, func(entry TraceEntry) {
		traceWriter.Write(entry)
	}, func() {
		key := sessionKey.Get()
		if key == "" {
			return
		}
		summary := "Codex runtime exited unexpectedly."
		degraded := true
		active := ""
		m.updateWorkspaceSession(key, core.SessionPatch{
			Status:            ptrSessionState(core.SessionStateDegraded),
			Summary:           &summary,
			AttentionReason:   &summary,
			AttentionRequired: &degraded,
			ActiveTurnID:      &active,
		})
		m.mu.Lock()
		delete(m.live, key)
		m.mu.Unlock()
	})
	if err != nil {
		return nil, err
	}

	started, err := client.StartThread(project.RootPath, options)
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	threadID := strings.TrimSpace(started.Thread.ID)
	if threadID == "" {
		_ = client.Close()
		return nil, errors.New("app-server returned empty thread id")
	}
	sessionKey.Set(threadID)
	traceWriter.SetSessionID(threadID)

	record := ThreadRecord{
		ID:        threadID,
		Path:      started.Thread.Path,
		Cwd:       started.Thread.Cwd,
		UpdatedAt: time.Now().UTC().Unix(),
		Status:    ThreadStatus{Type: "active"},
	}
	if strings.TrimSpace(record.Cwd) == "" {
		record.Cwd = project.RootPath
	}

	live := &liveSession{
		project: project,
		client:  client,
		thread:  threadID,
		record:  record,
	}
	m.mu.Lock()
	m.live[threadID] = live
	m.mu.Unlock()
	return live, nil
}

func (m *Manager) startLiveSession(sessionKey string, project core.Project, options core.SessionTurnOptions) (*liveSession, error) {
	traceWriter := newAppServerTraceWriter(project.RootPath, sessionKey)
	client, err := m.start(context.Background(), project.RootPath, func(n Notification) {
		m.handleNotification(sessionKey, n)
	}, func(req ServerRequest) {
		m.handleServerRequest(sessionKey, req)
	}, func(entry TraceEntry) {
		traceWriter.Write(entry)
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

	started, err := client.StartThread(project.RootPath, options)
	if err != nil {
		_ = client.Close()
		return nil, err
	}

	record := ThreadRecord{
		ID:        started.Thread.ID,
		Path:      started.Thread.Path,
		Cwd:       started.Thread.Cwd,
		UpdatedAt: time.Now().UTC().Unix(),
		Status:    ThreadStatus{Type: "active"},
	}

	live := &liveSession{
		project: project,
		client:  client,
		thread:  started.Thread.ID,
		record:  record,
	}
	m.mu.Lock()
	m.live[sessionKey] = live
	m.mu.Unlock()
	return live, nil
}

func (m *Manager) failSession(sessionID string, err error) {
	active := ""
	approvalID := ""
	status := core.SessionStateFailed
	attention := true
	summary := err.Error()
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		PendingApprovalID: &approvalID,
		ActiveTurnID:      &active,
		Status:            &status,
		Summary:           &summary,
		AttentionRequired: &attention,
		AttentionReason:   &summary,
	})
}

func (m *Manager) RespondToSessionApproval(
	sessionID string,
	approvalID string,
	decision core.ApprovalDecision,
) (core.Session, error) {
	m.mu.Lock()
	live := m.live[sessionID]
	if live == nil || live.pendingApproval == nil || live.pendingApproval.ID != approvalID {
		m.mu.Unlock()
		return core.Session{}, fmt.Errorf("approval %q not found for session %q", approvalID, sessionID)
	}
	pending := live.pendingApproval
	live.pendingApproval = nil
	activeTurnID := live.active
	projectID := live.project.ID
	m.mu.Unlock()

	response, err := approvalResponseForRequest(pending, decision)
	if err != nil {
		m.mu.Lock()
		if current := m.live[sessionID]; current != nil && current.pendingApproval == nil {
			current.pendingApproval = pending
		}
		m.mu.Unlock()
		return core.Session{}, err
	}
	if err := live.client.RespondToApproval(pending.RawID, response); err != nil {
		m.mu.Lock()
		if current := m.live[sessionID]; current != nil && current.pendingApproval == nil {
			current.pendingApproval = pending
		}
		m.mu.Unlock()
		return core.Session{}, fmt.Errorf("respond to app-server approval: %w", err)
	}

	running := core.SessionStateRunning
	attention := false
	reason := ""
	summary := "Approval submitted. Codex is resuming…"
	clearApprovalID := ""
	m.updateWorkspaceSession(sessionID, core.SessionPatch{
		PendingApprovalID: &clearApprovalID,
		Status:            &running,
		AttentionRequired: &attention,
		AttentionReason:   &reason,
		Summary:           &summary,
		ActiveTurnID:      &activeTurnID,
	})
	m.publishLivePatch(sessionID, projectID, core.SessionLivePatch{
		Kind:         core.SessionLivePatchKindStatus,
		ActiveTurnID: activeTurnID,
		Status:       running,
		Summary:      summary,
	})

	session, ok := m.workspace.GetSession(sessionID)
	if !ok {
		return core.Session{}, fmt.Errorf("session %q not found", sessionID)
	}
	return session, nil
}

func approvalResponseForRequest(pending *pendingApproval, decision core.ApprovalDecision) (any, error) {
	if pending == nil {
		return nil, errors.New("approval request is missing")
	}

	switch pending.Method {
	case "item/commandExecution/requestApproval":
		protocolDecision := "decline"
		if decision == core.ApprovalDecisionApprove {
			protocolDecision = "accept"
		}
		return protocol.CommandExecutionRequestApprovalResponse{Decision: protocolDecision}, nil
	case "item/fileChange/requestApproval":
		protocolDecision := "decline"
		if decision == core.ApprovalDecisionApprove {
			protocolDecision = "accept"
		}
		return protocol.FileChangeRequestApprovalResponse{Decision: protocolDecision}, nil
	case "execCommandApproval":
		protocolDecision := "denied"
		if decision == core.ApprovalDecisionApprove {
			protocolDecision = "approved"
		}
		return protocol.ExecCommandApprovalResponse{Decision: protocolDecision}, nil
	case "applyPatchApproval":
		protocolDecision := "denied"
		if decision == core.ApprovalDecisionApprove {
			protocolDecision = "approved"
		}
		return protocol.ApplyPatchApprovalResponse{Decision: protocolDecision}, nil
	case "item/permissions/requestApproval":
		if decision != core.ApprovalDecisionApprove {
			return protocol.PermissionsRequestApprovalResponse{
				Permissions: map[string]any{},
				Scope:       "turn",
			}, nil
		}
		permissions, err := requestedPermissions(pending.Params)
		if err != nil {
			return nil, err
		}
		return protocol.PermissionsRequestApprovalResponse{
			Permissions: permissions,
			Scope:       "turn",
		}, nil
	default:
		return nil, fmt.Errorf("unsupported approval method %q", pending.Method)
	}
}

func requestedPermissions(raw json.RawMessage) (any, error) {
	if len(raw) == 0 {
		return map[string]any{}, nil
	}
	var payload protocol.PermissionsRequestApprovalParams
	if err := json.Unmarshal(raw, &payload); err != nil {
		return nil, fmt.Errorf("decode permissions approval params: %w", err)
	}
	if payload.Permissions == nil {
		return map[string]any{}, nil
	}
	return payload.Permissions, nil
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

	client, err := m.start(context.Background(), cwd, nil, nil, nil, nil)
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
		session.TranscriptItems = mergeCodexSourcedTranscriptItems(
			session.TranscriptItems,
			local.TranscriptItems,
		)
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

	client, err := m.start(context.Background(), project.RootPath, nil, nil, nil, nil)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	defer client.Close()

	resumed, err := client.ResumeThread(threadID, project.RootPath, core.SessionTurnOptions{})
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
	if hasLocal {
		session.TranscriptItems = mergeCodexSourcedTranscriptItems(
			session.TranscriptItems,
			local.TranscriptItems,
		)
	}
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

	resumed, err := client.ResumeThread(threadID, "", core.SessionTurnOptions{})
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

func (m *Manager) ensureLiveSession(sessionKey string, project core.Project, threadID string, options core.SessionTurnOptions) (*liveSession, error) {
	live := m.liveSession(sessionKey)
	if live != nil {
		return live, nil
	}

	traceWriter := newAppServerTraceWriter(project.RootPath, sessionKey)
	client, err := m.start(context.Background(), project.RootPath, func(n Notification) {
		m.handleNotification(sessionKey, n)
	}, func(req ServerRequest) {
		m.handleServerRequest(sessionKey, req)
	}, func(entry TraceEntry) {
		traceWriter.Write(entry)
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

	resumed, err := client.ResumeThread(threadID, project.RootPath, options)
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
	if live.pendingApproval != nil {
		session.PendingApprovalID = live.pendingApproval.ID
		session.AttentionRequired = true
		session.AttentionReason = live.pendingApproval.Message
	}

	for _, item := range liveReasoningDraftTranscriptItems(read, live.reasoningDrafts) {
		session.TranscriptItems = appendOrReplaceTranscriptItem(session.TranscriptItems, item)
	}

	if strings.TrimSpace(live.draftText) != "" {
		draftID := strings.TrimSpace(live.draftItemID)
		if draftID == "" {
			draftID = "live-draft"
		}
		session.TranscriptItems = append(session.TranscriptItems, core.SessionTranscriptItem{
			ID:       draftID,
			OrderKey: draftTranscriptOrderKey(read, draftID),
			Kind:     core.SessionTranscriptItemKindAgentMessage,
			Title:    "Codex",
			Body:     live.draftText,
			Status:   "streaming",
		})
	}

	if session.ActiveTurnID != "" || strings.TrimSpace(live.active) != "" {
		session.Status = core.SessionStateRunning
	} else if live.optimisticStatus != "" {
		session.Status = live.optimisticStatus
	} else {
		session.Status = finalSessionState(latestTerminalTurnStatus(read), session.Status)
	}
	if live.pendingApproval != nil {
		session.Status = core.SessionStateWaitingApproval
	}

	if !live.optimisticUpdatedAt.IsZero() {
		session.UpdatedAt = live.optimisticUpdatedAt
	}

	return session
}

func draftTranscriptOrderKey(read *ReadThreadResult, itemID string) string {
	turnIndex := 0
	itemIndex := 0
	if read != nil && len(read.Thread.Turns) > 0 {
		turnIndex = len(read.Thread.Turns) - 1
		itemIndex = len(read.Thread.Turns[turnIndex].Items)
	}
	return transcriptOrderKey(turnIndex, itemIndex, itemID)
}

func liveReasoningDraftTranscriptItems(
	read *ReadThreadResult,
	drafts map[string]*reasoningDraft,
) []core.SessionTranscriptItem {
	if len(drafts) == 0 {
		return nil
	}

	ids := make([]string, 0, len(drafts))
	for id := range drafts {
		if strings.TrimSpace(id) != "" {
			ids = append(ids, id)
		}
	}
	sort.Strings(ids)

	items := make([]core.SessionTranscriptItem, 0, len(ids))
	for _, id := range ids {
		draft := drafts[id]
		if draft == nil || (draft.summary == "" && draft.raw == "") {
			continue
		}
		body := draft.summary
		if strings.TrimSpace(body) == "" && strings.TrimSpace(draft.raw) != "" {
			body = rawReasoningFallbackBody
		}
		items = append(items, core.SessionTranscriptItem{
			ID:          id,
			OrderKey:    draftTranscriptOrderKey(read, id),
			Kind:        core.SessionTranscriptItemKindReasoning,
			Title:       "Thinking",
			Body:        body,
			DisplayBody: draft.raw,
			Status:      "streaming",
		})
	}
	return items
}

func appendOrReplaceTranscriptItem(
	items []core.SessionTranscriptItem,
	item core.SessionTranscriptItem,
) []core.SessionTranscriptItem {
	for index := range items {
		if strings.TrimSpace(items[index].ID) == strings.TrimSpace(item.ID) {
			items[index] = item
			return items
		}
	}
	return append(items, item)
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
	status := mapThreadStatus(thread.Status)
	updatedAt := time.Unix(thread.UpdatedAt, 0).UTC()
	if status != core.SessionStateRunning && localCodexSessionRunning(thread.ID) {
		status = core.SessionStateRunning
		updatedAt = time.Now().UTC()
	}
	session := core.Session{
		ID:              thread.ID,
		ProjectID:       project.ID,
		BackendKey:      "codex",
		Title:           fallbackThreadTitle(thread, local, hasLocal),
		BackendThreadID: thread.ID,
		Status:          status,
		Summary:         fallbackThreadPreview(thread, local, hasLocal),
		UpdatedAt:       updatedAt,
	}
	if hasLocal {
		if strings.TrimSpace(local.BackendThreadID) == "" {
			session.ID = local.ID
		}
		session.AttentionRequired = local.AttentionRequired
		session.AttentionReason = local.AttentionReason
		session.PendingApprovalID = local.PendingApprovalID
		session.LastInputHint = local.LastInputHint
		session.Artifacts = append([]core.Artifact(nil), local.Artifacts...)
		if strings.TrimSpace(local.Title) != "" && strings.TrimSpace(thread.NameValue()) == "" {
			session.Title = local.Title
		}
		if local.UpdatedAt.After(session.UpdatedAt) {
			session.UpdatedAt = local.UpdatedAt
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
		if threadStatusHasActiveFlag(status, "waitingOnApproval") {
			return core.SessionStateWaitingApproval
		}
		if threadStatusHasActiveFlag(status, "waitingOnUserInput") {
			return core.SessionStateWaitingInput
		}
		return core.SessionStateRunning
	case "systemError":
		return core.SessionStateFailed
	case "idle", "notLoaded":
		return core.SessionStateCompleted
	default:
		return core.SessionStatePending
	}
}

func threadStatusHasActiveFlag(status ThreadStatus, flag string) bool {
	for _, activeFlag := range status.ActiveFlags {
		if activeFlag == flag {
			return true
		}
	}
	return false
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

func cloneThreadListResult(list *ThreadListResult) *ThreadListResult {
	if list == nil {
		return &ThreadListResult{}
	}
	cloned := &ThreadListResult{
		Data: make([]ThreadRecord, 0, len(list.Data)),
	}
	if list.NextCursor != nil {
		cloned.NextCursor = ptrString(*list.NextCursor)
	}
	for _, thread := range list.Data {
		cloned.Data = append(cloned.Data, cloneThreadRecord(thread))
	}
	return cloned
}

func cloneThreadRecord(thread ThreadRecord) ThreadRecord {
	thread.ForkedFromID = cloneOptionalString(thread.ForkedFromID)
	thread.Path = cloneOptionalString(thread.Path)
	thread.Name = cloneOptionalString(thread.Name)
	return thread
}

func cloneOptionalString(value *string) *string {
	if value == nil {
		return nil
	}
	return ptrString(*value)
}

func ptrString(value string) *string {
	return &value
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
