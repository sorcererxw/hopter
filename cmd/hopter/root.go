package main

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/url"
	"os"
	"os/exec"
	"os/signal"
	"runtime"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/urfave/cli/v2"

	"github.com/sorcererxw/hopter/internal/app"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
	"github.com/sorcererxw/hopter/internal/relayconnector/cloudflaredrunner"
)

type serveOptions struct {
	host        string
	port        int
	devProxyURL string
	relay       bool
	resetAuth   bool
}

func newRootApp(version string, installSource string) *cli.App {
	app := cli.NewApp()
	app.Name = "hopter"
	app.Usage = "Local control plane for coding agents"
	app.HideVersion = true
	app.Flags = serveFlags()
	app.Action = func(c *cli.Context) error {
		return runServe(version, installSource, serveOptionsFromContext(c), c.App.Writer)
	}
	app.Commands = []*cli.Command{
		newServeCmd(version, installSource),
		newDoctorCmd(version, installSource),
		newVersionCmd(version),
	}
	return app
}

func newServeCmd(version string, installSource string) *cli.Command {
	return &cli.Command{
		Name:  "serve",
		Usage: "Start the hopter HTTP server",
		Flags: serveFlags(),
		Action: func(c *cli.Context) error {
			return runServe(version, installSource, serveOptionsFromContext(c), c.App.Writer)
		},
	}
}

func serveFlags() []cli.Flag {
	return []cli.Flag{
		&cli.StringFlag{Name: "host", Usage: "HTTP bind host"},
		&cli.IntFlag{Name: "port", Usage: "HTTP bind port"},
		&cli.StringFlag{Name: "dev-proxy-url", Usage: "Vite dev server URL to reverse proxy"},
		&cli.BoolFlag{Name: "relay", Usage: "Start relay mode and connect this host through the hosted relay"},
		&cli.BoolFlag{Name: "reset-auth", Usage: "Reset stored relay auth before starting; valid only with --relay"},
	}
}

func serveOptionsFromContext(c *cli.Context) serveOptions {
	return serveOptions{
		host:        c.String("host"),
		port:        c.Int("port"),
		devProxyURL: c.String("dev-proxy-url"),
		relay:       c.Bool("relay"),
		resetAuth:   c.Bool("reset-auth"),
	}
}

func runServe(version string, installSource string, opts serveOptions, out io.Writer) error {
	if opts.resetAuth && !opts.relay {
		return fmt.Errorf("--reset-auth requires --relay")
	}

	cfg, err := app.LoadConfigWithOptions(version, installSource, app.LoadOptions{
		Host:        opts.host,
		Port:        opts.port,
		DevProxyURL: opts.devProxyURL,
		Relay:       opts.relay,
		ResetAuth:   opts.resetAuth,
	})
	if err != nil {
		slog.Error("load config", "error", err)
		return err
	}

	if cfg.Relay.ResetAuth {
		store := newRelayAuthStore(cfg)
		if err := store.Reset(); err != nil {
			return fmt.Errorf("reset relay auth: %w", err)
		}
		if out != nil {
			fmt.Fprintf(out, "relay auth reset\n\n")
		}
	}

	runtime, err := app.NewRuntime(cfg)
	if err != nil {
		slog.Error("bootstrap runtime", "error", err)
		return err
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := runtime.Server.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown server", "error", err)
		}
	}()

	slog.Info("hopter listening", "addr", cfg.HTTP.Addr(), "ui_mode", cfg.UI.Mode())
	if err := maybeStartRelay(ctx, cfg, out); err != nil {
		slog.Warn("relay startup incomplete", "error", err)
	}
	printServeReady(out, cfg)
	if err := runtime.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve", "error", err)
		return err
	}
	return nil
}

var openBrowser = openBrowserURL
var lookPath = exec.LookPath
var startCommand = func(ctx context.Context, name string, args ...string) error {
	return exec.CommandContext(ctx, name, args...).Start()
}
var newRelayAuthStore = func(cfg app.Config) serverhttp.RelayAuthStore {
	return serverhttp.NewConfiguredRelayAuthStore(cfg.Relay.AuthStore, cfg.Relay.AuthPath)
}
var relayConnector = relayConnectorRunner(managedRelayConnectorRunner{})

type relayConnectorRunner interface {
	Start(context.Context, app.Config, serverhttp.RelayCredential) error
	CommandPreview(app.Config, serverhttp.RelayCredential) string
}

type externalRelayConnectorRunner struct{}

type managedRelayConnectorRunner struct {
	embedded cloudflaredrunner.Runner
	external externalRelayConnectorRunner
}

func (runner managedRelayConnectorRunner) Start(ctx context.Context, cfg app.Config, credential serverhttp.RelayCredential) error {
	if useExternalRelayConnector(cfg) {
		return runner.external.Start(ctx, cfg, credential)
	}
	return runner.embedded.Start(ctx, credential.ConnectorToken)
}

func (runner managedRelayConnectorRunner) CommandPreview(cfg app.Config, credential serverhttp.RelayCredential) string {
	if useExternalRelayConnector(cfg) {
		return runner.external.CommandPreview(cfg, credential)
	}
	return "embedded relay connector"
}

func useExternalRelayConnector(cfg app.Config) bool {
	connectorBin := strings.TrimSpace(cfg.Relay.ConnectorBin)
	if connectorBin == "" {
		return false
	}
	return connectorBin != "cloudflared"
}

func (externalRelayConnectorRunner) Start(ctx context.Context, cfg app.Config, credential serverhttp.RelayCredential) error {
	command, args := relayConnectorCommand(cfg, credential)
	if _, err := lookPath(command); err != nil {
		slog.Debug("relay connector binary not found", "command", command, "error", err)
		return fmt.Errorf("relay connector not found")
	}
	if err := startCommand(ctx, command, args...); err != nil {
		slog.Debug("relay connector start failed", "command", command, "error", err)
		return fmt.Errorf("start relay connector")
	}
	return nil
}

func (externalRelayConnectorRunner) CommandPreview(cfg app.Config, credential serverhttp.RelayCredential) string {
	command, args := relayConnectorCommand(cfg, credential)
	return strings.TrimSpace(command + " " + strings.Join(args, " "))
}

func maybeStartRelay(ctx context.Context, cfg app.Config, out io.Writer) error {
	if !cfg.Relay.Enabled {
		return nil
	}

	if out != nil {
		fmt.Fprintf(out, "relay requested\n\n")
	}

	store := newRelayAuthStore(cfg)
	if !store.Exists() {
		loginURL := relayLoginURL(cfg)
		if out != nil {
			fmt.Fprintf(out, "  Login required: %s\n", loginURL)
			fmt.Fprintf(out, "  Waiting for browser login to complete, then relay will continue automatically.\n\n")
		}
		go waitForRelayAuthAndStart(ctx, cfg, store, out)
		go openRelayLoginAfterServerStarts(ctx, loginURL)
		return nil
	}

	return startRelayWithStoredAuth(ctx, cfg, store, out)
}

func openRelayLoginAfterServerStarts(ctx context.Context, loginURL string) {
	timer := time.NewTimer(500 * time.Millisecond)
	defer timer.Stop()

	select {
	case <-ctx.Done():
		return
	case <-timer.C:
		if err := openBrowser(loginURL); err != nil {
			slog.Warn("open relay login URL failed", "error", err)
		}
	}
}

func waitForRelayAuthAndStart(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, out io.Writer) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !store.Exists() {
				continue
			}
			if err := startRelayWithStoredAuth(ctx, cfg, store, out); err != nil {
				slog.Warn("relay startup after login failed", "error", err)
				if out != nil {
					fmt.Fprintf(out, "  Relay startup after login failed: %v\n\n", err)
				}
			}
			return
		}
	}
}

func startRelayWithStoredAuth(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, out io.Writer) error {
	credential, err := store.Load()
	if err != nil {
		return fmt.Errorf("read relay auth: %w", err)
	}

	if strings.TrimSpace(credential.ConnectorToken) == "" {
		credential, err = prepareRelayConnectorCredential(ctx, cfg, store, credential)
		if err != nil {
			return err
		}
	}

	domain := strings.TrimSpace(cfg.Relay.Domain)
	if domain == "" {
		domain = strings.TrimPrefix(credential.WorkspaceURL, "https://")
	}

	if strings.TrimSpace(credential.ConnectorToken) == "" {
		if out != nil {
			fmt.Fprintf(out, "  Relay connector is not ready yet; sign-in completed, but the hosted relay has not issued a connector token.\n")
			if preview := relayConnector.CommandPreview(cfg, credential); preview != "" {
				fmt.Fprintf(out, "  Connector command will be prepared automatically once auth is ready.\n")
			}
			fmt.Fprintf(out, "\n")
		}
		return nil
	}

	if err := relayConnector.Start(ctx, cfg, credential); err != nil {
		if out != nil && strings.Contains(err.Error(), "not found") {
			fmt.Fprintf(out, "  Relay connector is not installed yet. Set HOPTER_RELAY_CONNECTOR_BIN to a connector binary.\n\n")
		}
		return err
	}

	if err := markRelayReady(ctx, cfg, store, credential); err != nil {
		if out != nil {
			fmt.Fprintf(out, "  Relay readiness check failed: %v\n\n", err)
		}
		return err
	}

	startRelayHeartbeat(ctx, cfg, store, credential)
	startRelayReleaseOnShutdown(ctx, cfg, store, credential)

	if out != nil {
		fmt.Fprintf(out, "  Relay ready: https://%s\n\n", domain)
	}
	return nil
}

func prepareRelayConnectorCredential(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) (serverhttp.RelayCredential, error) {
	if strings.TrimSpace(credential.OAuthAccessToken) == "" && strings.TrimSpace(credential.OAuthRefreshToken) == "" {
		return credential, nil
	}
	if serverhttp.RelayOAuthTokenNeedsRefresh(credential, time.Now()) {
		refreshed, err := serverhttp.RefreshRelayOAuthToken(ctx, relayHTTPOptions(cfg), credential)
		if err != nil {
			return credential, fmt.Errorf("refresh relay auth: %w", err)
		}
		credential = refreshed
		if err := store.Store(credential); err != nil {
			return credential, fmt.Errorf("store refreshed relay auth: %w", err)
		}
	}
	allocated, err := allocateRelayTunnel(ctx, cfg, credential)
	if err != nil {
		return credential, err
	}
	if err := store.Store(allocated); err != nil {
		return allocated, fmt.Errorf("store relay allocation: %w", err)
	}
	return allocated, nil
}

type relayAllocateResponse struct {
	AuthUserID            string `json:"authUserId,omitempty"`
	LeaseID               string `json:"leaseId,omitempty"`
	LeaseVersion          int    `json:"leaseVersion,omitempty"`
	WorkspaceSlug         string `json:"workspaceSlug,omitempty"`
	WorkspaceURL          string `json:"workspaceURL,omitempty"`
	BrokerBaseURL         string `json:"brokerBaseURL,omitempty"`
	PrivateHostname       string `json:"privateHostname,omitempty"`
	TunnelTarget          string `json:"tunnelTarget,omitempty"`
	RelayToken            string `json:"relayToken,omitempty"`
	BrokerSecret          string `json:"brokerSecret,omitempty"`
	ConnectorProvider     string `json:"connectorProvider,omitempty"`
	ConnectorToken        string `json:"connectorToken,omitempty"`
	CloudflareTunnelToken string `json:"cloudflareTunnelToken,omitempty"`
	TunnelToken           string `json:"tunnelToken,omitempty"`
}

func allocateRelayTunnel(ctx context.Context, cfg app.Config, credential serverhttp.RelayCredential) (serverhttp.RelayCredential, error) {
	allocateURL := strings.TrimSpace(cfg.Relay.AllocateURL)
	if allocateURL == "" {
		allocateURL = "https://api.hopter.dev/api/relay/allocate"
	}
	payload := map[string]string{}
	if strings.TrimSpace(credential.WorkspaceSlug) != "" {
		payload["workspaceSlug"] = credential.WorkspaceSlug
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return credential, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, allocateURL, bytes.NewReader(body))
	if err != nil {
		return credential, err
	}
	request.Header.Set("Authorization", "Bearer "+credential.OAuthAccessToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return credential, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return credential, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return credential, fmt.Errorf("relay allocation returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}

	var decoded relayAllocateResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return credential, err
	}
	connectorToken := firstNonEmpty(decoded.ConnectorToken, decoded.TunnelToken, decoded.CloudflareTunnelToken)
	if strings.TrimSpace(connectorToken) == "" {
		return credential, fmt.Errorf("relay allocation response missing connector token")
	}

	allocated := credential
	allocated.AuthUserID = firstNonEmpty(decoded.AuthUserID, allocated.AuthUserID)
	allocated.HostID = firstNonEmpty(allocated.HostID, cfg.HostID)
	allocated.WorkspaceSlug = firstNonEmpty(decoded.WorkspaceSlug, allocated.WorkspaceSlug)
	allocated.WorkspaceURL = firstNonEmpty(decoded.WorkspaceURL, allocated.WorkspaceURL)
	allocated.BrokerBaseURL = firstNonEmpty(decoded.BrokerBaseURL, allocated.BrokerBaseURL)
	allocated.TunnelTarget = firstNonEmpty(decoded.TunnelTarget, allocated.TunnelTarget)
	allocated.PrivateHostname = firstNonEmpty(decoded.PrivateHostname, allocated.PrivateHostname)
	allocated.RelayLeaseID = firstNonEmpty(decoded.LeaseID, allocated.RelayLeaseID)
	if decoded.LeaseVersion > 0 {
		allocated.RelayLeaseVersion = decoded.LeaseVersion
	}
	allocated.RelayToken = firstNonEmpty(decoded.RelayToken, allocated.RelayToken)
	allocated.BrokerSecret = firstNonEmpty(decoded.BrokerSecret, allocated.BrokerSecret, cfg.Relay.BrokerSecret)
	allocated.ConnectorProvider = firstNonEmpty(decoded.ConnectorProvider, "managed")
	allocated.ConnectorToken = connectorToken
	allocated.UpdatedAt = time.Now().UTC()
	return allocated, nil
}

func relayTokenExists(path string) bool {
	return serverhttp.NewFileRelayAuthStore(path).Exists()
}

func relayConnectorCommand(cfg app.Config, credential serverhttp.RelayCredential) (string, []string) {
	command := firstNonEmpty(strings.TrimSpace(cfg.Relay.ConnectorBin), strings.TrimSpace(cfg.Relay.Cloudflared), "cloudflared")
	token := credential.ConnectorToken
	if token == "" {
		token = "<relay-connector-token>"
	}
	return command, []string{"tunnel", "--no-autoupdate", "run", "--token", token}
}

func markRelayReady(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) error {
	if strings.TrimSpace(credential.RelayLeaseID) == "" || credential.RelayLeaseVersion <= 0 {
		return nil
	}
	updated, err := ensureRelayOAuthAccessToken(ctx, cfg, store, credential)
	if err != nil {
		return err
	}
	credential = updated

	endpoint, err := relayAPILeaseURL(cfg, credential.RelayLeaseID, "ready")
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]int{
		"leaseVersion": credential.RelayLeaseVersion,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+credential.OAuthAccessToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return err
	}
	if response.StatusCode == http.StatusAccepted {
		return nil
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("relay ready returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	return nil
}

func startRelayHeartbeat(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) {
	interval := cfg.Relay.HeartbeatEvery
	if interval <= 0 {
		interval = 30 * time.Second
	}

	go func() {
		ticker := time.NewTicker(interval)
		defer ticker.Stop()

		for {
			select {
			case <-ctx.Done():
				return
			case <-ticker.C:
				if err := sendRelayHeartbeat(ctx, cfg, store, credential); err != nil {
					slog.Warn("relay heartbeat failed", "error", err)
				}
			}
		}
	}()
}

func sendRelayHeartbeat(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) error {
	if strings.TrimSpace(credential.RelayLeaseID) == "" || credential.RelayLeaseVersion <= 0 {
		return nil
	}

	return sendRelayAPIHeartbeat(ctx, cfg, store, credential)
}

func sendRelayAPIHeartbeat(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) error {
	updated, err := ensureRelayOAuthAccessToken(ctx, cfg, store, credential)
	if err != nil {
		return err
	}
	credential = updated

	endpoint, err := relayAPILeaseURL(cfg, credential.RelayLeaseID, "heartbeat")
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]int{
		"leaseVersion": credential.RelayLeaseVersion,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+credential.OAuthAccessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("relay heartbeat returned %d", response.StatusCode)
	}
	return nil
}

func startRelayReleaseOnShutdown(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) {
	if strings.TrimSpace(credential.RelayLeaseID) == "" || credential.RelayLeaseVersion <= 0 {
		return
	}

	go func() {
		<-ctx.Done()
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := sendRelayAPIRelease(releaseCtx, cfg, store, credential); err != nil {
			slog.Warn("relay release failed", "error", err)
		}
	}()
}

func sendRelayAPIRelease(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) error {
	updated, err := ensureRelayOAuthAccessToken(ctx, cfg, store, credential)
	if err != nil {
		return err
	}
	credential = updated

	endpoint, err := relayAPILeaseURL(cfg, credential.RelayLeaseID, "release")
	if err != nil {
		return err
	}
	payload, err := json.Marshal(map[string]int{
		"leaseVersion": credential.RelayLeaseVersion,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+credential.OAuthAccessToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("relay release returned %d", response.StatusCode)
	}
	return nil
}

func ensureRelayOAuthAccessToken(ctx context.Context, cfg app.Config, store serverhttp.RelayAuthStore, credential serverhttp.RelayCredential) (serverhttp.RelayCredential, error) {
	if !serverhttp.RelayOAuthTokenNeedsRefresh(credential, time.Now()) {
		return credential, nil
	}
	refreshed, err := serverhttp.RefreshRelayOAuthToken(ctx, relayHTTPOptions(cfg), credential)
	if err != nil {
		return credential, fmt.Errorf("refresh relay auth: %w", err)
	}
	if err := store.Store(refreshed); err != nil {
		return refreshed, fmt.Errorf("store refreshed relay auth: %w", err)
	}
	return refreshed, nil
}

func relayAPILeaseURL(cfg app.Config, leaseID string, action string) (string, error) {
	baseURL := strings.TrimSpace(cfg.Relay.AllocateURL)
	if baseURL == "" {
		baseURL = "https://api.hopter.dev/api/relay/allocate"
	}
	target, err := url.Parse(baseURL)
	if err != nil {
		return "", err
	}
	if target.Scheme == "" || target.Host == "" {
		return "", fmt.Errorf("relay API URL must include scheme and host")
	}
	target.Path = "/api/relay/leases/" + url.PathEscape(leaseID) + "/" + strings.TrimLeft(action, "/")
	target.RawQuery = ""
	return target.String(), nil
}

func relayLoginURL(cfg app.Config) string {
	callbackURL := localBrowserURL(cfg.HTTP) + "/api/relay/callback"
	loginURL, err := serverhttp.BeginRelayOAuthLogin(callbackURL, relayHTTPOptions(cfg))
	if err == nil {
		return loginURL
	}

	target, err := urlWithFallback(cfg.Relay.AuthURL)
	if err != nil {
		target, _ = urlWithFallback("https://auth.hopter.dev/login")
	}

	query := target.Query()
	query.Set("mode", "cli-relay")
	query.Set("hostId", cfg.HostID)
	query.Set("callbackURL", callbackURL)
	query.Set("exchangeURL", cfg.Relay.ExchangeURL)
	target.RawQuery = query.Encode()

	return target.String()
}

func relayHTTPOptions(cfg app.Config) serverhttp.RelayOptions {
	return serverhttp.RelayOptions{
		AuthPath:          cfg.Relay.AuthPath,
		AuthStoreName:     cfg.Relay.AuthStore,
		TokenPath:         cfg.Relay.TokenPath,
		ExchangeURL:       cfg.Relay.ExchangeURL,
		OAuthAuthorizeURL: firstNonEmpty(cfg.Relay.OAuthAuthorizeURL, cfg.Relay.AuthURL),
		OAuthTokenURL:     cfg.Relay.OAuthTokenURL,
		OAuthClientID:     cfg.Relay.OAuthClientID,
		OAuthAudience:     cfg.Relay.OAuthAudience,
		HostID:            cfg.HostID,
		BrokerSecret:      cfg.Relay.BrokerSecret,
	}
}

func urlWithFallback(raw string) (*url.URL, error) {
	target, err := url.Parse(strings.TrimSpace(raw))
	if err != nil {
		return nil, err
	}
	if target.Scheme == "" || target.Host == "" {
		return nil, fmt.Errorf("URL must include scheme and host")
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

func openBrowserURL(rawURL string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", rawURL).Start()
	case "windows":
		return exec.Command("rundll32", "url.dll,FileProtocolHandler", rawURL).Start()
	default:
		return exec.Command("xdg-open", rawURL).Start()
	}
}

func printServeReady(out io.Writer, cfg app.Config) {
	if out == nil {
		return
	}

	browserURL := localBrowserURL(cfg.HTTP)
	bindURL := "http://" + cfg.HTTP.Addr()
	fmt.Fprintf(out, "hopter is running\n\n")
	fmt.Fprintf(out, "  Open: %s\n", browserURL)
	if bindURL != browserURL {
		fmt.Fprintf(out, "  Bind: %s\n", bindURL)
	}
	fmt.Fprintf(out, "  Stop: Ctrl+C\n\n")
}

func localBrowserURL(cfg app.HTTPConfig) string {
	host := strings.TrimSpace(cfg.Host)
	switch strings.ToLower(host) {
	case "", "0.0.0.0", "::", "[::]":
		host = "127.0.0.1"
	}
	host = strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
	return "http://" + net.JoinHostPort(host, strconv.Itoa(cfg.Port))
}
