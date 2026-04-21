package terminal

import (
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"sync"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

type Manager struct {
	mu                 sync.Mutex
	workspace          core.WorkspaceService
	resolver           SessionResolver
	store              *InMemoryStore
	runtimes           map[string]*PTYRuntime
	buffers            map[string]*ReplayBuffer
	subs               map[string]map[uint64]chan []byte
	timers             map[string]*time.Timer
	subSeq             uint64
	idSeq              uint64
	cleanupDelay       time.Duration
	promptPollInterval time.Duration
}

type SessionResolver interface {
	GetSession(sessionID string) (core.Session, core.Project, error)
}

type CreateInput struct {
	SessionID         string
	BrowserInstanceID string
	TabID             string
	Cols              uint32
	Rows              uint32
}

func NewManager(workspace core.WorkspaceService) *Manager {
	return NewManagerWithResolver(workspace, nil)
}

func NewManagerWithResolver(workspace core.WorkspaceService, resolver SessionResolver) *Manager {
	cleanupDelay := durationFromEnv(5*time.Minute, "HOPTER_TERMINAL_DETACH_TTL_MS")
	promptPollInterval := durationFromEnv(time.Second, "HOPTER_TERMINAL_PROMPT_POLL_MS")
	return &Manager{
		workspace:          workspace,
		resolver:           resolver,
		store:              NewInMemoryStore(),
		runtimes:           make(map[string]*PTYRuntime),
		buffers:            make(map[string]*ReplayBuffer),
		subs:               make(map[string]map[uint64]chan []byte),
		timers:             make(map[string]*time.Timer),
		cleanupDelay:       cleanupDelay,
		promptPollInterval: promptPollInterval,
	}
}

func (m *Manager) CreateTerminalSession(_ context.Context, input CreateInput) (Session, error) {
	key := SessionKey{
		BrowserInstanceID: strings.TrimSpace(input.BrowserInstanceID),
		TabID:             strings.TrimSpace(input.TabID),
		SessionID:         strings.TrimSpace(input.SessionID),
	}
	if key.BrowserInstanceID == "" || key.TabID == "" || key.SessionID == "" {
		return Session{}, fmt.Errorf("browser instance id, tab id, and session id are required")
	}

	m.mu.Lock()
	if existing, ok := m.store.GetByKey(key); ok {
		if existing.Status != StatusExited &&
			existing.Status != StatusTerminated &&
			existing.Status != StatusFailed {
			m.mu.Unlock()
			return existing, nil
		}
	}
	m.mu.Unlock()

	session, project, err := m.resolveSessionProject(key.SessionID)
	if err != nil {
		return Session{}, err
	}

	shellPath := defaultShellPath()
	runtime, err := StartPTY(context.Background(), shellPath, project.RootPath, uint16(input.Cols), uint16(input.Rows))
	if err != nil {
		return Session{}, err
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	if existing, ok := m.store.GetByKey(key); ok {
		if existing.Status != StatusExited &&
			existing.Status != StatusTerminated &&
			existing.Status != StatusFailed {
			_ = runtime.Kill()
			_ = runtime.Close()
			return existing, nil
		}
	}

	now := time.Now().UTC()
	m.idSeq++
	record := Session{
		ID:                          fmt.Sprintf("term_%04d", m.idSeq),
		ProjectID:                   project.ID,
		SessionID:                   session.ID,
		BrowserInstanceID:           key.BrowserInstanceID,
		TabID:                       key.TabID,
		CWD:                         project.RootPath,
		Shell:                       runtime.ShellName(),
		Status:                      StatusLive,
		CreatedAt:                   now,
		LastActivityAt:              now,
		LastOutputAt:                now,
		Detached:                    false,
		LastForegroundCommandExited: true,
	}
	m.store.Upsert(record)
	m.runtimes[record.ID] = runtime
	m.buffers[record.ID] = NewReplayBuffer(128 * 1024)

	go m.consumeOutput(record.ID, runtime)
	go m.watchExit(record.ID, runtime)
	go m.watchForegroundState(record.ID, runtime)

	return record, nil
}

func (m *Manager) resolveSessionProject(sessionID string) (core.Session, core.Project, error) {
	sessionID = strings.TrimSpace(sessionID)
	if sessionID == "" {
		return core.Session{}, core.Project{}, fmt.Errorf("session id is required")
	}

	if session, ok := m.workspace.GetSession(sessionID); ok {
		project, ok := m.workspace.GetProject(session.ProjectID)
		if !ok {
			return core.Session{}, core.Project{}, fmt.Errorf("project %q not found", session.ProjectID)
		}
		return session, project, nil
	}

	if m.resolver == nil {
		return core.Session{}, core.Project{}, fmt.Errorf("session %q not found", sessionID)
	}

	session, project, err := m.resolver.GetSession(sessionID)
	if err != nil {
		return core.Session{}, core.Project{}, err
	}
	if strings.TrimSpace(session.ID) == "" {
		session.ID = sessionID
	}
	if strings.TrimSpace(project.RootPath) == "" {
		return core.Session{}, core.Project{}, fmt.Errorf("project root for session %q not found", sessionID)
	}
	return session, project, nil
}

func (m *Manager) GetTerminalSession(sessionID, browserInstanceID, tabID string) (Session, error) {
	key := SessionKey{
		BrowserInstanceID: strings.TrimSpace(browserInstanceID),
		TabID:             strings.TrimSpace(tabID),
		SessionID:         strings.TrimSpace(sessionID),
	}
	if key.BrowserInstanceID == "" || key.TabID == "" || key.SessionID == "" {
		return Session{}, fmt.Errorf("browser instance id, tab id, and session id are required")
	}
	record, ok := m.store.GetByKey(key)
	if !ok {
		return Session{}, fmt.Errorf("terminal for session %q not found", key.SessionID)
	}
	return record, nil
}

func (m *Manager) GetTerminalByID(terminalID string) (Session, error) {
	record, ok := m.store.GetByID(strings.TrimSpace(terminalID))
	if !ok {
		return Session{}, fmt.Errorf("terminal %q not found", terminalID)
	}
	return record, nil
}

func (m *Manager) AttachTerminal(
	terminalID string,
	sessionID string,
	browserInstanceID string,
	tabID string,
) (Session, []byte, uint64, <-chan []byte, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	record, ok := m.store.GetByID(strings.TrimSpace(terminalID))
	if !ok {
		return Session{}, nil, 0, nil, fmt.Errorf("terminal %q not found", terminalID)
	}
	if record.SessionID != strings.TrimSpace(sessionID) ||
		record.BrowserInstanceID != strings.TrimSpace(browserInstanceID) ||
		record.TabID != strings.TrimSpace(tabID) {
		return Session{}, nil, 0, nil, fmt.Errorf("terminal %q does not belong to this browser tab and session", terminalID)
	}

	record.Detached = false
	record.LastActivityAt = time.Now().UTC()
	m.store.Upsert(record)
	m.cancelCleanupTimerLocked(record.ID)

	m.subSeq++
	subID := m.subSeq
	ch := make(chan []byte, 128)
	if m.subs[record.ID] == nil {
		m.subs[record.ID] = make(map[uint64]chan []byte)
	}
	m.subs[record.ID][subID] = ch

	var replay []byte
	if buffer := m.buffers[record.ID]; buffer != nil {
		replay = buffer.Bytes()
	}
	return record, replay, subID, ch, nil
}

func (m *Manager) DetachTerminal(terminalID string, subscriptionID uint64) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	record, ok := m.store.GetByID(strings.TrimSpace(terminalID))
	if !ok {
		return fmt.Errorf("terminal %q not found", terminalID)
	}
	record.Detached = true
	record.LastActivityAt = time.Now().UTC()
	m.store.Upsert(record)
	m.updateCleanupTimerLocked(record.ID, record)

	if subs := m.subs[record.ID]; subs != nil {
		if ch, ok := subs[subscriptionID]; ok {
			delete(subs, subscriptionID)
			close(ch)
		}
		if len(subs) == 0 {
			delete(m.subs, record.ID)
		}
	}
	return nil
}

func (m *Manager) WriteInput(terminalID string, data []byte) error {
	m.mu.Lock()
	runtime := m.runtimes[strings.TrimSpace(terminalID)]
	record, ok := m.store.GetByID(strings.TrimSpace(terminalID))
	m.mu.Unlock()
	if !ok || runtime == nil {
		return fmt.Errorf("terminal %q not found", terminalID)
	}
	if len(data) == 0 {
		return nil
	}
	if _, err := runtime.Write(data); err != nil {
		return err
	}
	record.LastActivityAt = time.Now().UTC()
	record.LastForegroundCommandExited = false
	m.store.Upsert(record)
	m.mu.Lock()
	m.cancelCleanupTimerLocked(record.ID)
	m.mu.Unlock()
	return nil
}

func (m *Manager) TerminateBrowserTab(browserInstanceID, tabID string) int {
	sessions := m.store.ListByBrowserTab(strings.TrimSpace(browserInstanceID), strings.TrimSpace(tabID))
	terminated := 0
	for _, session := range sessions {
		if _, err := m.TerminateTerminalSession(session.ID); err == nil {
			terminated++
		}
	}
	return terminated
}

func (m *Manager) ResizeTerminal(terminalID string, cols, rows uint32) error {
	m.mu.Lock()
	runtime := m.runtimes[strings.TrimSpace(terminalID)]
	record, ok := m.store.GetByID(strings.TrimSpace(terminalID))
	m.mu.Unlock()
	if !ok || runtime == nil {
		return fmt.Errorf("terminal %q not found", terminalID)
	}
	if cols == 0 || rows == 0 {
		return nil
	}
	if err := runtime.Resize(uint16(cols), uint16(rows)); err != nil {
		return err
	}
	record.LastActivityAt = time.Now().UTC()
	m.store.Upsert(record)
	return nil
}

func (m *Manager) TerminateTerminalSession(terminalID string) (Session, error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	record, ok := m.store.GetByID(strings.TrimSpace(terminalID))
	if !ok {
		return Session{}, fmt.Errorf("terminal %q not found", terminalID)
	}
	if runtime := m.runtimes[record.ID]; runtime != nil {
		_ = runtime.Kill()
		_ = runtime.Close()
		delete(m.runtimes, record.ID)
	}
	delete(m.buffers, record.ID)
	m.cancelCleanupTimerLocked(record.ID)
	now := time.Now().UTC()
	record.Status = StatusTerminated
	record.LastActivityAt = now
	record.LastForegroundCommandExited = true
	m.store.Upsert(record)
	m.closeSubscribersLocked(record.ID)
	return record, nil
}

func (m *Manager) watchExit(terminalID string, runtime *PTYRuntime) {
	err, ok := <-runtime.ExitCh()
	if !ok {
		return
	}

	m.mu.Lock()
	defer m.mu.Unlock()

	record, exists := m.store.GetByID(terminalID)
	if !exists {
		return
	}
	now := time.Now().UTC()
	record.LastActivityAt = now
	record.LastOutputAt = now
	if record.Status != StatusTerminated {
		record.Status = StatusExited
		exitCode := exitCodeFromWait(err)
		record.ExitCode = &exitCode
	}
	record.LastForegroundCommandExited = true
	m.store.Upsert(record)
	delete(m.runtimes, terminalID)
	delete(m.buffers, terminalID)
	m.cancelCleanupTimerLocked(terminalID)
	m.closeSubscribersLocked(terminalID)
}

func (m *Manager) consumeOutput(terminalID string, runtime *PTYRuntime) {
	buf := make([]byte, 4096)
	for {
		n, err := runtime.Read(buf)
		if n > 0 {
			chunk := append([]byte(nil), buf[:n]...)
			m.mu.Lock()
			if replay := m.buffers[terminalID]; replay != nil {
				replay.Append(chunk)
			}
			record, ok := m.store.GetByID(terminalID)
			if ok {
				now := time.Now().UTC()
				record.LastActivityAt = now
				record.LastOutputAt = now
				record.Status = StatusLive
				if looksLikePrompt(chunk) {
					record.LastForegroundCommandExited = true
				}
				m.store.Upsert(record)
				if !record.Detached {
					m.cancelCleanupTimerLocked(terminalID)
				}
			}
			m.broadcastLocked(terminalID, chunk)
			m.mu.Unlock()
		}
		if err != nil {
			if !errors.Is(err, io.EOF) && !strings.Contains(err.Error(), "input/output error") {
				m.mu.Lock()
				record, ok := m.store.GetByID(terminalID)
				if ok && record.Status != StatusTerminated {
					record.Status = StatusFailed
					record.LastActivityAt = time.Now().UTC()
					record.LastForegroundCommandExited = true
					m.store.Upsert(record)
					m.cancelCleanupTimerLocked(terminalID)
					m.closeSubscribersLocked(terminalID)
				}
				m.mu.Unlock()
			}
			return
		}
	}
}

func (m *Manager) broadcastLocked(terminalID string, chunk []byte) {
	for _, ch := range m.subs[terminalID] {
		select {
		case ch <- append([]byte(nil), chunk...):
		default:
		}
	}
}

func (m *Manager) closeSubscribersLocked(terminalID string) {
	if subs := m.subs[terminalID]; subs != nil {
		for id, ch := range subs {
			delete(subs, id)
			close(ch)
		}
		delete(m.subs, terminalID)
	}
}

func (m *Manager) watchForegroundState(terminalID string, runtime *PTYRuntime) {
	ticker := time.NewTicker(m.promptPollInterval)
	defer ticker.Stop()

	for range ticker.C {
		m.mu.Lock()
		record, ok := m.store.GetByID(terminalID)
		activeRuntime := m.runtimes[terminalID]
		m.mu.Unlock()
		if !ok || activeRuntime != runtime {
			return
		}

		fg, err := runtime.ForegroundProcessGroup()
		if err != nil {
			continue
		}
		shellPID := runtime.ShellPID()
		shellPgrp := runtime.ShellProcessGroup()
		atPrompt := fg == shellPID || (shellPgrp != 0 && fg == shellPgrp)

		m.mu.Lock()
		record, ok = m.store.GetByID(terminalID)
		if !ok {
			m.mu.Unlock()
			return
		}
		if record.Status == StatusExited || record.Status == StatusTerminated || record.Status == StatusFailed {
			m.mu.Unlock()
			return
		}
		if record.LastForegroundCommandExited != atPrompt {
			record.LastForegroundCommandExited = atPrompt
			record.LastActivityAt = time.Now().UTC()
			m.store.Upsert(record)
		}
		m.updateCleanupTimerLocked(terminalID, record)
		m.mu.Unlock()
	}
}

func (m *Manager) updateCleanupTimerLocked(terminalID string, record Session) {
	if !record.Detached || !record.LastForegroundCommandExited ||
		record.Status == StatusExited || record.Status == StatusTerminated || record.Status == StatusFailed {
		m.cancelCleanupTimerLocked(terminalID)
		return
	}
	if _, ok := m.timers[terminalID]; ok {
		return
	}
	m.timers[terminalID] = time.AfterFunc(m.cleanupDelay, func() {
		m.expireDetachedTerminal(terminalID)
	})
}

func (m *Manager) cancelCleanupTimerLocked(terminalID string) {
	if timer, ok := m.timers[terminalID]; ok {
		timer.Stop()
		delete(m.timers, terminalID)
	}
}

func (m *Manager) expireDetachedTerminal(terminalID string) {
	m.mu.Lock()
	record, ok := m.store.GetByID(terminalID)
	if !ok {
		m.mu.Unlock()
		return
	}
	delete(m.timers, terminalID)
	if !record.Detached || !record.LastForegroundCommandExited {
		m.mu.Unlock()
		return
	}
	runtime := m.runtimes[terminalID]
	now := time.Now().UTC()
	record.Status = StatusExited
	record.LastActivityAt = now
	record.LastOutputAt = now
	m.store.Upsert(record)
	m.mu.Unlock()

	if runtime != nil {
		_ = runtime.Kill()
		_ = runtime.Close()
	}
}

func defaultShellPath() string {
	candidates := []string{
		strings.TrimSpace(os.Getenv("SHELL")),
		"/bin/zsh",
		"/bin/bash",
	}
	for _, candidate := range candidates {
		if candidate == "" {
			continue
		}
		if info, err := os.Stat(candidate); err == nil && !info.IsDir() {
			return candidate
		}
	}
	return filepath.Clean("/bin/sh")
}

func exitCodeFromWait(err error) int {
	if err == nil {
		return 0
	}
	var exitErr *exec.ExitError
	if errors.As(err, &exitErr) {
		return exitErr.ExitCode()
	}
	return 1
}

func looksLikePrompt(chunk []byte) bool {
	text := string(chunk)
	return strings.Contains(text, "\u001b]7;file://") ||
		strings.Contains(text, "\u001b]2;") ||
		strings.Contains(text, "➜  ") ||
		strings.Contains(text, "% ")
}

func durationFromEnv(fallback time.Duration, names ...string) time.Duration {
	raw := ""
	for _, name := range names {
		raw = strings.TrimSpace(os.Getenv(name))
		if raw != "" {
			break
		}
	}
	if raw == "" {
		return fallback
	}
	if millis, err := strconv.Atoi(raw); err == nil && millis > 0 {
		return time.Duration(millis) * time.Millisecond
	}
	if duration, err := time.ParseDuration(raw); err == nil && duration > 0 {
		return duration
	}
	return fallback
}
