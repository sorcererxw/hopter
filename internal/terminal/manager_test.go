package terminal

import (
	"context"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

type fakeSessionResolver struct {
	session core.Session
	project core.Project
	err     error
	calls   int
}

func (f *fakeSessionResolver) GetSession(_ string) (core.Session, core.Project, error) {
	f.calls++
	if f.err != nil {
		return core.Session{}, core.Project{}, f.err
	}
	return f.session, f.project, nil
}

func TestUpdateCleanupTimerLockedStartsOnlyForDetachedPromptState(t *testing.T) {
	manager := NewManager(core.NewInMemoryWorkspace("host", nil))
	manager.cleanupDelay = 10 * time.Millisecond

	record := Session{
		ID:                          "term_1",
		Detached:                    true,
		LastForegroundCommandExited: true,
		Status:                      StatusLive,
	}

	manager.mu.Lock()
	manager.updateCleanupTimerLocked(record.ID, record)
	_, ok := manager.timers[record.ID]
	manager.mu.Unlock()

	if !ok {
		t.Fatalf("expected cleanup timer to be scheduled")
	}
}

func TestUpdateCleanupTimerLockedSkipsRunningForegroundCommand(t *testing.T) {
	manager := NewManager(core.NewInMemoryWorkspace("host", nil))
	record := Session{
		ID:                          "term_1",
		Detached:                    true,
		LastForegroundCommandExited: false,
		Status:                      StatusLive,
	}

	manager.mu.Lock()
	manager.updateCleanupTimerLocked(record.ID, record)
	_, ok := manager.timers[record.ID]
	manager.mu.Unlock()

	if ok {
		t.Fatalf("expected no cleanup timer for running foreground command")
	}
}

func TestTerminateBrowserTabKillsAllMatchingSessions(t *testing.T) {
	manager := NewManager(core.NewInMemoryWorkspace("host", nil))
	manager.store.Upsert(Session{
		ID:                "term_1",
		BrowserInstanceID: "browser_1",
		TabID:             "tab_1",
		Status:            StatusLive,
	})
	manager.store.Upsert(Session{
		ID:                "term_2",
		BrowserInstanceID: "browser_1",
		TabID:             "tab_1",
		Status:            StatusLive,
	})
	manager.store.Upsert(Session{
		ID:                "term_3",
		BrowserInstanceID: "browser_2",
		TabID:             "tab_2",
		Status:            StatusLive,
	})

	manager.TerminateBrowserTab("browser_1", "tab_1")

	first, _ := manager.store.GetByID("term_1")
	second, _ := manager.store.GetByID("term_2")
	third, _ := manager.store.GetByID("term_3")

	if first.Status != StatusTerminated || second.Status != StatusTerminated {
		t.Fatalf("expected matching tab terminals to terminate")
	}
	if third.Status != StatusLive {
		t.Fatalf("expected non-matching terminal to remain live, got %q", third.Status)
	}
}

func TestCreateTerminalSessionResolvesExternalSession(t *testing.T) {
	root := t.TempDir()
	resolver := &fakeSessionResolver{
		session: core.Session{
			ID:        "thread_1",
			ProjectID: "cwd:" + root,
		},
		project: core.Project{
			ID:             "cwd:" + root,
			Name:           "repo",
			RootPath:       root,
			DefaultBackend: "codex",
			CreatedAt:      time.Now().UTC(),
			UpdatedAt:      time.Now().UTC(),
		},
	}
	manager := NewManagerWithResolver(core.NewInMemoryWorkspace("host", nil), resolver)

	session, err := manager.CreateTerminalSession(context.Background(), CreateInput{
		SessionID:         "thread_1",
		BrowserInstanceID: "browser_1",
		TabID:             "tab_1",
		Cols:              80,
		Rows:              24,
	})
	if err != nil {
		t.Fatalf("CreateTerminalSession: %v", err)
	}
	defer func() {
		if _, err := manager.TerminateTerminalSession(session.ID); err != nil {
			t.Fatalf("TerminateTerminalSession: %v", err)
		}
	}()

	if resolver.calls != 1 {
		t.Fatalf("resolver calls = %d, want 1", resolver.calls)
	}
	if session.SessionID != "thread_1" {
		t.Fatalf("session id = %q, want thread_1", session.SessionID)
	}
	if session.CWD != root {
		t.Fatalf("cwd = %q, want %q", session.CWD, root)
	}
	if session.Status != StatusLive {
		t.Fatalf("status = %q, want live", session.Status)
	}
}
