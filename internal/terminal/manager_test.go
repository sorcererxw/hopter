package terminal

import (
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
)

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
