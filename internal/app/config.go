package app

import (
	"fmt"
	"net"
	"net/url"
	"os"
	"strconv"
	"strings"
)

const (
	defaultHTTPHost = "127.0.0.1"
	defaultHTTPPort = 8787
	defaultHostID   = "host_local"
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

type Config struct {
	Version             string
	InstallSource       string
	HostID              string
	HTTP                HTTPConfig
	UI                  UIConfig
	LocalhostOnlyNoAuth bool
}

func LoadConfig(version string, installSource string) (Config, error) {
	cfg := Config{
		Version:             firstNonEmpty(strings.TrimSpace(version), "dev"),
		InstallSource:       firstNonEmpty(strings.TrimSpace(installSource), "direct"),
		HostID:              envOrDefault("ORCHD_HOST_ID", defaultHostID),
		LocalhostOnlyNoAuth: envBool("ORCHD_LOCALHOST_ONLY_NO_AUTH", true),
		HTTP: HTTPConfig{
			Host: envOrDefault("ORCHD_HOST", defaultHTTPHost),
			Port: defaultHTTPPort,
		},
		UI: UIConfig{
			DevProxyURL: strings.TrimSpace(os.Getenv("ORCHD_UI_DEV_PROXY_URL")),
		},
	}

	if rawPort := strings.TrimSpace(os.Getenv("ORCHD_PORT")); rawPort != "" {
		port, err := strconv.Atoi(rawPort)
		if err != nil {
			return Config{}, fmt.Errorf("parse ORCHD_PORT: %w", err)
		}
		cfg.HTTP.Port = port
	}

	if cfg.HTTP.Port < 1 || cfg.HTTP.Port > 65535 {
		return Config{}, fmt.Errorf("ORCHD_PORT must be between 1 and 65535, got %d", cfg.HTTP.Port)
	}

	if cfg.UI.DevProxyURL != "" {
		if _, err := parseProxyURL(cfg.UI.DevProxyURL); err != nil {
			return Config{}, err
		}
	}

	if cfg.LocalhostOnlyNoAuth && !isLoopbackHost(cfg.HTTP.Host) {
		return Config{}, fmt.Errorf(
			"refusing to bind non-local host %q while dev auth is disabled; set ORCHD_LOCALHOST_ONLY_NO_AUTH=false to override",
			cfg.HTTP.Host,
		)
	}

	return cfg, nil
}

func parseProxyURL(raw string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse ORCHD_UI_DEV_PROXY_URL: %w", err)
	}
	if target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("ORCHD_UI_DEV_PROXY_URL must include scheme and host")
	}
	return target, nil
}

func envOrDefault(key, fallback string) string {
	if value := strings.TrimSpace(os.Getenv(key)); value != "" {
		return value
	}
	return fallback
}

func envBool(key string, fallback bool) bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv(key))) {
	case "1", "true", "yes", "on":
		return true
	case "0", "false", "no", "off":
		return false
	default:
		return fallback
	}
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
