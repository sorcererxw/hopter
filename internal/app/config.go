package app

import (
	"crypto/sha256"
	"encoding/hex"
	"fmt"
	"net"
	"net/url"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"time"
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
	StateHome string
}

func (c TaskConfig) StorePath() string {
	return filepath.Join(c.StateHome, "tasks", "badger")
}

type Config struct {
	Version       string
	InstallSource string
	HostID        string
	HTTP          HTTPConfig
	UI            UIConfig
	Tasks         TaskConfig
	Relay         RelayConfig
}

type LoadOptions struct {
	Host        string
	Port        int
	DevProxyURL string
	Relay       bool
}

type RelayConfig struct {
	Enabled        bool
	AuthURL        string
	ExchangeURL    string
	Domain         string
	TokenPath      string
	Cloudflared    string
	BrokerSecret   string
	HeartbeatEvery time.Duration
}

func LoadConfig(version string, installSource string) (Config, error) {
	return LoadConfigWithOptions(version, installSource, LoadOptions{})
}

func LoadConfigWithOptions(version string, installSource string, opts LoadOptions) (Config, error) {
	resolvedVersion := firstNonEmpty(strings.TrimSpace(version), "dev")
	devProxyURL := strings.TrimSpace(opts.DevProxyURL)
	cfg := Config{
		Version:       resolvedVersion,
		InstallSource: firstNonEmpty(strings.TrimSpace(installSource), "direct"),
		HostID:        defaultHostID,
		HTTP: HTTPConfig{
			Host: firstNonEmpty(strings.TrimSpace(opts.Host), defaultHTTPHost),
			Port: defaultHTTPPortForVersion(resolvedVersion),
		},
		UI: UIConfig{
			DevProxyURL: devProxyURL,
		},
		Tasks: TaskConfig{
			StateHome: defaultTaskStateHome(devProxyURL),
		},
	}
	cfg.Relay = RelayConfig{
		Enabled:        opts.Relay,
		AuthURL:        firstNonEmpty(strings.TrimSpace(os.Getenv("HOPTER_RELAY_AUTH_URL")), "https://auth.hopter.dev/login"),
		ExchangeURL:    firstNonEmpty(strings.TrimSpace(os.Getenv("HOPTER_RELAY_EXCHANGE_URL")), "https://api.hopter.dev/api/relay/exchange"),
		Domain:         strings.TrimSpace(os.Getenv("HOPTER_RELAY_DOMAIN")),
		TokenPath:      firstNonEmpty(strings.TrimSpace(os.Getenv("HOPTER_RELAY_TOKEN_PATH")), filepath.Join(defaultStateHome(), "relay", "token")),
		Cloudflared:    firstNonEmpty(strings.TrimSpace(os.Getenv("HOPTER_CLOUDFLARED_BIN")), "cloudflared"),
		BrokerSecret:   strings.TrimSpace(os.Getenv("HOPTER_RELAY_BROKER_SECRET")),
		HeartbeatEvery: 30 * time.Second,
	}

	if opts.Port != 0 {
		cfg.HTTP.Port = opts.Port
	}

	if cfg.HTTP.Port < 1 || cfg.HTTP.Port > 65535 {
		return Config{}, fmt.Errorf("port must be between 1 and 65535, got %d", cfg.HTTP.Port)
	}

	if cfg.UI.DevProxyURL != "" {
		if _, err := parseProxyURL(cfg.UI.DevProxyURL); err != nil {
			return Config{}, err
		}
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

func defaultTaskStateHome(devProxyURL string) string {
	if strings.TrimSpace(devProxyURL) == "" {
		return defaultStateHome()
	}
	return defaultDevStateHome()
}

func defaultDevStateHome() string {
	cwd, err := os.Getwd()
	if err != nil || strings.TrimSpace(cwd) == "" {
		return filepath.Join(defaultStateHome(), "devstate", "workspace")
	}
	cleanCWD := filepath.Clean(cwd)
	return filepath.Join(defaultStateHome(), "devstate", devWorkspaceSlug(cleanCWD))
}

func devWorkspaceSlug(path string) string {
	base := sanitizePathSegment(filepath.Base(path))
	sum := sha256.Sum256([]byte(filepath.Clean(path)))
	return fmt.Sprintf("%s-%s", base, hex.EncodeToString(sum[:])[:8])
}

func sanitizePathSegment(value string) string {
	var builder strings.Builder
	for _, r := range strings.TrimSpace(value) {
		switch {
		case r >= 'a' && r <= 'z':
			builder.WriteRune(r)
		case r >= 'A' && r <= 'Z':
			builder.WriteRune(r)
		case r >= '0' && r <= '9':
			builder.WriteRune(r)
		case r == '.', r == '_', r == '-':
			builder.WriteRune(r)
		default:
			builder.WriteRune('-')
		}
	}
	if builder.Len() == 0 {
		return "workspace"
	}
	return builder.String()
}

func parseProxyURL(raw string) (*url.URL, error) {
	target, err := url.Parse(raw)
	if err != nil {
		return nil, fmt.Errorf("parse dev proxy URL: %w", err)
	}
	if target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("dev proxy URL must include scheme and host")
	}
	return target, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
