package app

import (
	"path/filepath"
	"testing"
)

func TestLoadConfigUsesDevDefaultPort(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := LoadConfig("dev", "direct")
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.HTTP.Port != defaultDevHTTPPort {
		t.Fatalf("HTTP.Port = %d, want %d", cfg.HTTP.Port, defaultDevHTTPPort)
	}
}

func TestLoadConfigUsesWildcardDefaultHost(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := LoadConfig("dev", "direct")
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.HTTP.Host != "0.0.0.0" {
		t.Fatalf("HTTP.Host = %q, want 0.0.0.0", cfg.HTTP.Host)
	}
}

func TestLoadConfigUsesReleaseDefaultPort(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := LoadConfig("0.4.2", "direct")
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.HTTP.Port != defaultReleaseHTTPPort {
		t.Fatalf("HTTP.Port = %d, want %d", cfg.HTTP.Port, defaultReleaseHTTPPort)
	}
}

func TestLoadConfigPortOverrideWinsForReleaseBuild(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := LoadConfigWithOptions("0.4.2", "direct", LoadOptions{Port: 20000})
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.HTTP.Port != 20000 {
		t.Fatalf("HTTP.Port = %d, want 20000", cfg.HTTP.Port)
	}
}

func TestLoadConfigUsesDefaultTaskStateHomeOutsideDevProxy(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := LoadConfig("dev", "direct")
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.Tasks.StateHome != defaultStateHome() {
		t.Fatalf("Tasks.StateHome = %q, want %q", cfg.Tasks.StateHome, defaultStateHome())
	}
}

func TestLoadConfigUsesIsolatedTaskStateHomeForDevProxy(t *testing.T) {
	clearConfigEnv(t)
	t.Chdir(t.TempDir())

	cfg, err := LoadConfigWithOptions("dev", "direct", LoadOptions{DevProxyURL: "http://127.0.0.1:5173"})
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	wantStateHome := defaultDevStateHome()
	if cfg.Tasks.StateHome != wantStateHome {
		t.Fatalf("Tasks.StateHome = %q, want %q", cfg.Tasks.StateHome, wantStateHome)
	}
	if cfg.Tasks.StateHome == defaultStateHome() {
		t.Fatalf("Tasks.StateHome = %q, want dev-specific state home", cfg.Tasks.StateHome)
	}
	if got, want := cfg.Tasks.StorePath(), filepath.Join(wantStateHome, "tasks", "badger"); got != want {
		t.Fatalf("Tasks.StorePath() = %q, want %q", got, want)
	}
}

func clearConfigEnv(t *testing.T) {
	t.Helper()
}
