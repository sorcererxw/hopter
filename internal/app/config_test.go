package app

import "testing"

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

func TestLoadConfigRejectsWildcardHostWhenLocalhostOnlyNoAuthIsExplicit(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("HOPTER_LOCALHOST_ONLY_NO_AUTH", "true")

	_, err := LoadConfig("dev", "direct")
	if err == nil {
		t.Fatal("LoadConfig returned nil error, want localhost-only guard error")
	}
}

func TestLoadConfigPortOverrideWinsForReleaseBuild(t *testing.T) {
	clearConfigEnv(t)
	t.Setenv("HOPTER_PORT", "20000")

	cfg, err := LoadConfig("0.4.2", "direct")
	if err != nil {
		t.Fatalf("LoadConfig returned error: %v", err)
	}

	if cfg.HTTP.Port != 20000 {
		t.Fatalf("HTTP.Port = %d, want 20000", cfg.HTTP.Port)
	}
}

func clearConfigEnv(t *testing.T) {
	t.Helper()
	t.Setenv("HOPTER_HOST", "")
	t.Setenv("HOPTER_PORT", "")
	t.Setenv("HOPTER_UI_DEV_PROXY_URL", "")
	t.Setenv("HOPTER_LOCALHOST_ONLY_NO_AUTH", "")
}
