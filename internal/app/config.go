package app

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
)

const (
	defaultHTTPHost        = "0.0.0.0"
	defaultDevHTTPPort     = 8787
	defaultReleaseHTTPPort = 18787
	defaultHostID          = "host_local"
)

type HTTPConfig struct {
	Host string
	Port int
}

func (c HTTPConfig) Addr() string {
	return net.JoinHostPort(c.Host, strconv.Itoa(c.Port))
}

type UIConfig struct {
	DevProxyURL string
}

func (c UIConfig) Mode() string {
	if strings.TrimSpace(c.DevProxyURL) != "" {
		return "dev-proxy"
	}
	return "dist"
}

type TaskConfig struct {
	SchedulerMode string
	StateHome     string
}

func (c TaskConfig) StorePath() string {
	return filepath.Join(c.StateHome, "tasks", "badger")
}

type Config struct {
	Version             string
	InstallSource       string
	HostID              string
	HTTP                HTTPConfig
	UI                  UIConfig
	Tasks               TaskConfig
	LocalhostOnlyNoAuth bool
}

func LoadConfig(version string, installSource string) (Config, error) {
	resolvedVersion := firstNonEmpty(strings.TrimSpace(version), "dev")
	cfg := Config{
		Version:             resolvedVersion,
		InstallSource:       firstNonEmpty(strings.TrimSpace(installSource), "direct"),
		HostID:              envOrDefault(defaultHostID, "HOPTER_HOST_ID"),
		LocalhostOnlyNoAuth: envBool(false, "HOPTER_LOCALHOST_ONLY_NO_AUTH"),
		HTTP: HTTPConfig{
			Host: envOrDefault(defaultHTTPHost, "HOPTER_HOST"),
			Port: defaultHTTPPortForVersion(resolvedVersion),
		},
		UI: UIConfig{
			DevProxyURL: envValue("HOPTER_UI_DEV_PROXY_URL"),
		},
		Tasks: TaskConfig{
			SchedulerMode: envOrDefault("disabled", "HOPTER_TASK_SCHEDULER"),
			StateHome:     envOrDefault(defaultStateHome(), "HOPTER_STATE_HOME"),
		},
	}

	if rawPort := envValue("HOPTER_PORT"); rawPort != "" {
		port, err := strconv.Atoi(rawPort)
		if err != nil {
			return Config{}, fmt.Errorf("parse HOPTER_PORT: %w", err)
		}
		cfg.HTTP.Port = port
	}

	if cfg.HTTP.Port < 1 || cfg.HTTP.Port > 65535 {
		return Config{}, fmt.Errorf("HOPTER_PORT must be between 1 and 65535, got %d", cfg.HTTP.Port)
	}

	if cfg.UI.DevProxyURL != "" {
		if _, err := parseProxyURL(cfg.UI.DevProxyURL); err != nil {
			return Config{}, err
		}
	}

	if cfg.LocalhostOnlyNoAuth && !isLoopbackHost(cfg.HTTP.Host) {
		return Config{}, fmt.Errorf(
			"refusing to bind non-local host %q while dev auth is disabled; set HOPTER_LOCALHOST_ONLY_NO_AUTH=false to override",
			cfg.HTTP.Host,
		)
	}

	return cfg, nil
}

func defaultHTTPPortForVersion(version string) int {
	if isDevBuild(version) {
		return defaultDevHTTPPort
	}
	return defaultReleaseHTTPPort
}

func isDevBuild(version string) bool {
	normalized := strings.TrimSpace(strings.ToLower(version))
	return normalized == "" || normalized == "dev"
}

func defaultStateHome() string {
	home, err := os.UserHomeDir()
	if err != nil || strings.TrimSpace(home) == "" {
		return ".hopter"
	}
	return filepath.Join(home, ".hopter")
}

func parseProxyURL(raw string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse HOPTER_UI_DEV_PROXY_URL: %w", err)
	}
	if target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("HOPTER_UI_DEV_PROXY_URL must include scheme and host")
	}
	return target, nil
}

func envValue(keys ...string) string {
	for _, key := range keys {
		if value := strings.TrimSpace(os.Getenv(key)); value != "" {
			return value
		}
	}
	return ""
}

func envOrDefault(fallback string, keys ...string) string {
	if value := envValue(keys...); value != "" {
		return value
	}
	return fallback
}

func envBool(fallback bool, keys ...string) bool {
	if value := envValue(keys...); value != "" {
		switch strings.ToLower(value) {
		case "1", "true", "yes", "on":
			return true
		case "0", "false", "no", "off":
			return false
		}
	}
	return fallback
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func isLoopbackHost(host string) bool {
	switch strings.TrimSpace(strings.ToLower(host)) {
	case "", "localhost", "127.0.0.1", "::1", "[::1]":
		return true
	}
	ip := net.ParseIP(host)
	return ip != nil && ip.IsLoopback()
}
