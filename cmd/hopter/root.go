package main

import (
	"context"
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
	relayruntime "github.com/sorcererxw/hopter/internal/relay"
)

type serveOptions struct {
	host        string
	port        int
	devProxyURL string
	relay       bool
	resetAuth   bool
}

func newRootApp(version string, installSource string) *cli.App {
	application := cli.NewApp()
	application.Name = "hopter"
	application.Usage = "Local control plane for coding agents"
	application.HideVersion = true
	application.Flags = serveFlags()
	application.Action = func(c *cli.Context) error {
		return runServe(version, installSource, serveOptionsFromContext(c), c.App.Writer)
	}
	application.Commands = []*cli.Command{
		newServeCmd(version, installSource),
		newDoctorCmd(version, installSource),
		newVersionCmd(version),
	}
	return application
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

	runtimeState, err := app.NewRuntime(cfg)
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
		if err := runtimeState.Server.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown server", "error", err)
		}
	}()

	slog.Info("hopter listening", "addr", cfg.HTTP.Addr(), "ui_mode", cfg.UI.Mode())
	if err := maybeStartRelay(ctx, runtimeState, out); err != nil {
		slog.Warn("relay startup incomplete", "error", err)
	}
	printServeReady(out, cfg)
	if err := runtimeState.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve", "error", err)
		return err
	}
	return nil
}

var openBrowser = openBrowserURL
var newRelayAuthStore = func(cfg app.Config) serverhttp.RelayAuthStore {
	return serverhttp.NewConfiguredRelayAuthStore(cfg.Relay.AuthStore, cfg.Relay.AuthPath)
}
var newRelaySessionManager = func(
	cfg app.Config,
	store serverhttp.RelayAuthStore,
	verifier *serverhttp.RelayRequestVerifier,
) relaySessionManager {
	return relayruntime.NewSessionManager(cfg, store, verifier)
}

type relaySessionManager interface {
	Run(context.Context, serverhttp.RelayCredential) error
	Ready() <-chan struct{}
}

func maybeStartRelay(ctx context.Context, runtimeState *app.Runtime, out io.Writer) error {
	if !runtimeState.Config.Relay.Enabled {
		return nil
	}

	if out != nil {
		fmt.Fprintf(out, "relay requested\n\n")
	}

	store := newRelayAuthStore(runtimeState.Config)
	if !store.Exists() {
		loginURL := relayLoginURL(runtimeState.Config)
		if out != nil {
			fmt.Fprintf(out, "  Login required: %s\n", loginURL)
			fmt.Fprintf(out, "  Waiting for browser login to complete, then relay will continue automatically.\n\n")
		}
		go waitForRelayAuthAndStart(ctx, runtimeState, store, out)
		go openRelayLoginAfterServerStarts(ctx, loginURL)
		return nil
	}

	return startRelayWithStoredAuth(ctx, runtimeState, store, out)
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

func waitForRelayAuthAndStart(ctx context.Context, runtimeState *app.Runtime, store serverhttp.RelayAuthStore, out io.Writer) {
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
			if err := startRelayWithStoredAuth(ctx, runtimeState, store, out); err != nil {
				slog.Warn("relay startup after login failed", "error", err)
				if out != nil {
					fmt.Fprintf(out, "  Relay startup after login failed: %v\n\n", err)
				}
			}
			return
		}
	}
}

func startRelayWithStoredAuth(ctx context.Context, runtimeState *app.Runtime, store serverhttp.RelayAuthStore, out io.Writer) error {
	credential, err := store.Load()
	if err != nil {
		return fmt.Errorf("read relay auth: %w", err)
	}

	manager := newRelaySessionManager(runtimeState.Config, store, runtimeState.RelayVerifier)
	go func() {
		if runErr := manager.Run(ctx, credential); runErr != nil && !errors.Is(runErr, context.Canceled) {
			slog.Warn("relay session manager exited", "error", runErr)
		}
	}()

	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-manager.Ready():
		if out != nil {
			domain := strings.TrimSpace(runtimeState.Config.Relay.Domain)
			if domain == "" {
				domain = strings.TrimPrefix(firstNonEmpty(credential.WorkspaceURL, credential.BrokerBaseURL, "https://my.hopter.dev"), "https://")
			}
			fmt.Fprintf(out, "  Relay ready: https://%s\n\n", domain)
		}
		return nil
	case <-time.After(15 * time.Second):
		if out != nil {
			fmt.Fprintf(out, "  Relay is still negotiating with the broker; continuing in degraded mode.\n\n")
		}
		return nil
	}
}

func relayTokenExists(path string) bool {
	return serverhttp.NewFileRelayAuthStore(path).Exists()
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
	authorizeURL, authorizeErr := serverhttp.BeginRelayOAuthLogin(callbackURL, relayHTTPOptions(cfg))

	target, err := urlWithFallback(cfg.Relay.AuthURL)
	if err != nil {
		target, _ = urlWithFallback("https://hopter.dev/login")
	}
	if authorizeErr == nil {
		target.Path = "/login"
		query := target.Query()
		query.Set("mode", "cli-relay")
		query.Set("hostId", cfg.HostID)
		query.Set("callbackURL", authorizeURL)
		query.Set("exchangeURL", cfg.Relay.ExchangeURL)
		target.RawQuery = query.Encode()
		return target.String()
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
		RequestVerifier:   runtimeRequestVerifier(nil),
		RequestSigningKey: cfg.Relay.RequestSigningKey,
	}
}

func runtimeRequestVerifier(verifier *serverhttp.RelayRequestVerifier) *serverhttp.RelayRequestVerifier {
	return verifier
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
