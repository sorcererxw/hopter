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

func TestLoadConfigUsesKeyringRelayAuthStoreByDefault(t *testing.T) {
	clearConfigEnv(t)

	cfg, err := LoadConfig("dev", "direct")
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.Relay.AuthStore != "keyring" {
		t.Fatalf("Relay.AuthStore = %q, want keyring", cfg.Relay.AuthStore)
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

	for _, key := range []string{
		"HOPTER_RELAY_AUTH_STORE",
		"HOPTER_RELAY_AUTH_PATH",
		"HOPTER_RELAY_TOKEN_PATH",
		"HOPTER_RELAY_AUTH_URL",
		"HOPTER_RELAY_EXCHANGE_URL",
		"HOPTER_RELAY_ALLOCATE_URL",
		"HOPTER_RELAY_OAUTH_AUTHORIZE_URL",
		"HOPTER_RELAY_OAUTH_TOKEN_URL",
		"HOPTER_RELAY_OAUTH_CLIENT_ID",
		"HOPTER_RELAY_OAUTH_AUDIENCE",
		"HOPTER_RELAY_DOMAIN",
		"HOPTER_RELAY_CONNECTOR_BIN",
		"HOPTER_CLOUDFLARED_BIN",
		"HOPTER_RELAY_BROKER_SECRET",
	} {
		t.Setenv(key, "")
	}
}
