package userconfig

import (
	"encoding/json"
	"os"
	"path/filepath"
	"testing"

	"github.com/sorcererxw/hopter/internal/core"
)

type captureSink struct {
	events []core.Event
}

func (s *captureSink) Publish(event core.Event) {
	s.events = append(s.events, event)
}

func TestServiceDefaultsWhenConfigMissing(t *testing.T) {
	service, err := NewService(filepath.Join(t.TempDir(), "config.json"), nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	cfg := service.Get()
	if cfg.Appearance.Theme != ThemeSystem {
		t.Fatalf("theme = %q, want %q", cfg.Appearance.Theme, ThemeSystem)
	}
	if cfg.Agent.DefaultBackend != "codex" {
		t.Fatalf("default backend = %q, want codex", cfg.Agent.DefaultBackend)
	}
	if cfg.Revision == 0 {
		t.Fatal("revision should be initialized")
	}
}

func TestServiceUpdateWritesConfigAndPublishesEvent(t *testing.T) {
	path := filepath.Join(t.TempDir(), ".hopter", "config.json")
	sink := &captureSink{}
	service, err := NewService(path, sink)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	cfg, err := service.Update(Patch{
		Appearance: &AppearanceConfig{Theme: ThemeDark},
	})
	if err != nil {
		t.Fatalf("Update() error = %v", err)
	}

	if cfg.Appearance.Theme != ThemeDark {
		t.Fatalf("theme = %q, want %q", cfg.Appearance.Theme, ThemeDark)
	}
	if len(sink.events) != 1 || sink.events[0].Kind != core.EventConfigChanged {
		t.Fatalf("events = %#v, want one config changed event", sink.events)
	}

	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("ReadFile() error = %v", err)
	}
	var stored map[string]any
	if err := json.Unmarshal(data, &stored); err != nil {
		t.Fatalf("stored config is not JSON: %v", err)
	}
	if _, ok := stored["revision"]; ok {
		t.Fatal("revision should not be persisted in user-editable config")
	}
	appearance := stored["appearance"].(map[string]any)
	if appearance["theme"] != string(ThemeDark) {
		t.Fatalf("stored theme = %v, want %q", appearance["theme"], ThemeDark)
	}
}

func TestServiceRejectsRevisionConflict(t *testing.T) {
	service, err := NewService(filepath.Join(t.TempDir(), "config.json"), nil)
	if err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	_, err = service.Update(Patch{
		Appearance:       &AppearanceConfig{Theme: ThemeLight},
		ExpectedRevision: service.Get().Revision + 1,
	})
	if err != ErrRevisionConflict {
		t.Fatalf("Update() error = %v, want ErrRevisionConflict", err)
	}
}
