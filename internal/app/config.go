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
		HostID:              envOrDefault(defaultHostID, "HOPTER_HOST_ID"),
		LocalhostOnlyNoAuth: envBool(true, "HOPTER_LOCALHOST_ONLY_NO_AUTH"),
		HTTP: HTTPConfig{
			Host: envOrDefault(defaultHTTPHost, "HOPTER_HOST"),
			Port: defaultHTTPPort,
		},
		UI: UIConfig{
			DevProxyURL: envValue("HOPTER_UI_DEV_PROXY_URL"),
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
