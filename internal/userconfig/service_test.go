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
	path := filepath.Join(t.TempDir(), "config.json")
	service, err := NewService(path, nil)
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

	schemaData, err := os.ReadFile(filepath.Join(filepath.Dir(path), schemaFileName))
	if err != nil {
		t.Fatalf("ReadFile(config schema) error = %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(schemaData, &schema); err != nil {
		t.Fatalf("stored schema is not JSON: %v", err)
	}
	if schema["title"] != "hopter config" {
		t.Fatalf("schema title = %v, want hopter config", schema["title"])
	}
}

func TestServiceRejectsUnsupportedDefaultBackend(t *testing.T) {
	path := filepath.Join(t.TempDir(), "config.json")
	if err := os.WriteFile(path, []byte(`{"appearance":{"theme":"system"},"agent":{"defaultBackend":"unsupported"}}`), 0o600); err != nil {
		t.Fatalf("WriteFile(config) error = %v", err)
	}

	if _, err := NewService(path, nil); err == nil {
		t.Fatalf("expected unsupported default backend to be rejected")
	}
}

func TestServiceStartupRefreshesExistingSchema(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "config.json")
	schemaPath := filepath.Join(dir, schemaFileName)
	if err := os.WriteFile(path, []byte(`{"appearance":{"theme":"light"},"agent":{"defaultBackend":"codex"}}`), 0o600); err != nil {
		t.Fatalf("WriteFile(config) error = %v", err)
	}
	if err := os.WriteFile(schemaPath, []byte(`{"title":"stale schema"}`), 0o644); err != nil {
		t.Fatalf("WriteFile(schema) error = %v", err)
	}

	if _, err := NewService(path, nil); err != nil {
		t.Fatalf("NewService() error = %v", err)
	}

	data, err := os.ReadFile(schemaPath)
	if err != nil {
		t.Fatalf("ReadFile(config schema) error = %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(data, &schema); err != nil {
		t.Fatalf("stored schema is not JSON: %v", err)
	}
	if schema["title"] != "hopter config" {
		t.Fatalf("schema title = %v, want refreshed hopter config", schema["title"])
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
	if stored["$schema"] != schemaReference {
		t.Fatalf("$schema = %v, want %q", stored["$schema"], schemaReference)
	}
	appearance := stored["appearance"].(map[string]any)
	if appearance["theme"] != string(ThemeDark) {
		t.Fatalf("stored theme = %v, want %q", appearance["theme"], ThemeDark)
	}

	schemaData, err := os.ReadFile(filepath.Join(filepath.Dir(path), schemaFileName))
	if err != nil {
		t.Fatalf("ReadFile(config schema) error = %v", err)
	}
	var schema map[string]any
	if err := json.Unmarshal(schemaData, &schema); err != nil {
		t.Fatalf("stored schema is not JSON: %v", err)
	}
	if schema["title"] != "hopter config" {
		t.Fatalf("schema title = %v, want hopter config", schema["title"])
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
