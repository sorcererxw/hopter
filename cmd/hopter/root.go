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

	"github.com/spf13/cobra"

	"github.com/sorcererxw/hopter/internal/app"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
)

type serveOptions struct {
	host        string
	port        int
	devProxyURL string
	relay       bool
}

func newRootCmd(version string, installSource string) *cobra.Command {
	opts := serveOptions{}
	cmd := &cobra.Command{
		Use:           "hopter",
		Short:         "Local control plane for coding agents",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(version, installSource, opts, cmd.OutOrStdout())
		},
	}
	addServeFlags(cmd, &opts)

	cmd.AddCommand(newServeCmd(version, installSource))
	cmd.AddCommand(newDoctorCmd(version, installSource))
	cmd.AddCommand(newVersionCmd(version))

	return cmd
}

func newServeCmd(version string, installSource string) *cobra.Command {
	opts := serveOptions{}
	cmd := &cobra.Command{
		Use:           "serve",
		Short:         "Start the hopter HTTP server",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(version, installSource, opts, cmd.OutOrStdout())
		},
	}
	addServeFlags(cmd, &opts)
	return cmd
}

func addServeFlags(cmd *cobra.Command, opts *serveOptions) {
	cmd.Flags().StringVar(&opts.host, "host", "", "HTTP bind host")
	cmd.Flags().IntVar(&opts.port, "port", 0, "HTTP bind port")
	cmd.Flags().StringVar(&opts.devProxyURL, "dev-proxy-url", "", "Vite dev server URL to reverse proxy")
	cmd.Flags().BoolVar(&opts.relay, "relay", false, "Start relay mode and connect this host through Cloudflare Tunnel")
}

func runServe(version string, installSource string, opts serveOptions, out io.Writer) error {
	cfg, err := app.LoadConfigWithOptions(version, installSource, app.LoadOptions{
		Host:        opts.host,
		Port:        opts.port,
		DevProxyURL: opts.devProxyURL,
		Relay:       opts.relay,
	})
	if err != nil {
		slog.Error("load config", "error", err)
		return err
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

func maybeStartRelay(ctx context.Context, cfg app.Config, out io.Writer) error {
	if !cfg.Relay.Enabled {
		return nil
	}

	if out != nil {
		fmt.Fprintf(out, "relay requested\n\n")
	}

	if !relayTokenExists(cfg.Relay.TokenPath) {
		loginURL := relayLoginURL(cfg)
		if out != nil {
			fmt.Fprintf(out, "  Login required: %s\n", loginURL)
			fmt.Fprintf(out, "  Waiting for browser login to complete, then relay will continue automatically.\n\n")
		}
		go waitForRelayCredentialAndStart(ctx, cfg, out)
		if err := openBrowser(loginURL); err != nil {
			return fmt.Errorf("open relay login URL: %w", err)
		}
		return nil
	}

	return startRelayWithStoredCredential(ctx, cfg, out)
}

func waitForRelayCredentialAndStart(ctx context.Context, cfg app.Config, out io.Writer) {
	ticker := time.NewTicker(500 * time.Millisecond)
	defer ticker.Stop()

	for {
		select {
		case <-ctx.Done():
			return
		case <-ticker.C:
			if !relayTokenExists(cfg.Relay.TokenPath) {
				continue
			}
			if err := startRelayWithStoredCredential(ctx, cfg, out); err != nil {
				slog.Warn("relay startup after login failed", "error", err)
				if out != nil {
					fmt.Fprintf(out, "  Relay startup after login failed: %v\n\n", err)
				}
			}
			return
		}
	}
}

func startRelayWithStoredCredential(ctx context.Context, cfg app.Config, out io.Writer) error {
	credential, err := serverhttp.ReadRelayCredentialFile(cfg.Relay.TokenPath)
	if err != nil {
		return fmt.Errorf("read relay credential: %w", err)
	}

	if _, err := lookPath(cfg.Relay.Cloudflared); err != nil {
		if out != nil {
			fmt.Fprintf(out, "  Cloudflare Tunnel is not ready: install cloudflared or set HOPTER_CLOUDFLARED_BIN.\n\n")
		}
		return fmt.Errorf("cloudflared not found: %w", err)
	}

	domain := strings.TrimSpace(cfg.Relay.Domain)
	if domain == "" {
		domain = strings.TrimPrefix(credential.WorkspaceURL, "https://")
	}

	command, args := cloudflaredCommand(cfg, credential)
	if strings.TrimSpace(credential.CloudflareTunnelToken) == "" {
		if out != nil {
			fmt.Fprintf(out, "  Cloudflare Tunnel token is not configured by the hosted platform yet.\n")
			fmt.Fprintf(out, "  Command to run when configured: %s %s\n\n", command, strings.Join(args, " "))
		}
		return nil
	}
	if err := startCommand(ctx, command, args...); err != nil {
		return fmt.Errorf("start cloudflared: %w", err)
	}

	if err := enrollRelayHost(ctx, cfg, credential); err != nil {
		if out != nil {
			fmt.Fprintf(out, "  Host enrollment failed: %v\n\n", err)
		}
		return err
	}
	startRelayHeartbeat(ctx, cfg, credential)

	if out != nil {
		fmt.Fprintf(out, "  Relay ready: https://%s\n\n", domain)
	}
	return nil
}

func relayTokenExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}

func cloudflaredCommand(cfg app.Config, credential serverhttp.RelayCredential) (string, []string) {
	token := credential.CloudflareTunnelToken
	if token == "" {
		token = "<cloudflare-tunnel-token>"
	}
	return cfg.Relay.Cloudflared, []string{"tunnel", "--no-autoupdate", "run", "--token", token}
}

func enrollRelayHost(ctx context.Context, cfg app.Config, credential serverhttp.RelayCredential) error {
	endpoint, err := relayBrokerURL(credential, "/api/relay/hosts/"+url.PathEscape(cfg.HostID))
	if err != nil {
		return err
	}
	tunnelTarget := strings.TrimSpace(credential.TunnelTarget)
	if tunnelTarget == "" {
		tunnelTarget = cfg.HostID + ".hopter.internal"
	}

	body, err := json.Marshal(map[string]string{
		"displayName":  cfg.HostID,
		"status":       "online",
		"tunnelTarget": tunnelTarget,
	})
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPut, endpoint, bytes.NewReader(body))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+credential.RelayToken)
	request.Header.Set("Content-Type", "application/json")
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("broker enrollment returned %d", response.StatusCode)
	}
	return nil
}

func startRelayHeartbeat(ctx context.Context, cfg app.Config, credential serverhttp.RelayCredential) {
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
				if err := sendRelayHeartbeat(ctx, cfg, credential); err != nil {
					slog.Warn("relay heartbeat failed", "error", err)
				}
			}
		}
	}()
}

func sendRelayHeartbeat(ctx context.Context, cfg app.Config, credential serverhttp.RelayCredential) error {
	endpoint, err := relayBrokerURL(credential, "/api/relay/hosts/"+url.PathEscape(cfg.HostID)+"/heartbeat")
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint, nil)
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+credential.RelayToken)
	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return fmt.Errorf("broker heartbeat returned %d", response.StatusCode)
	}
	return nil
}

func relayBrokerURL(credential serverhttp.RelayCredential, path string) (string, error) {
	base := strings.TrimSpace(credential.BrokerBaseURL)
	if base == "" {
		base = credential.WorkspaceURL
	}
	target, err := url.Parse(base)
	if err != nil {
		return "", err
	}
	if target.Scheme == "" || target.Host == "" {
		return "", fmt.Errorf("relay broker URL must include scheme and host")
	}
	target.Path = path
	target.RawQuery = ""
	return target.String(), nil
}

func relayLoginURL(cfg app.Config) string {
	target, err := urlWithFallback(cfg.Relay.AuthURL)
	if err != nil {
		target, _ = urlWithFallback("https://auth.hopter.dev/login")
	}

	query := target.Query()
	query.Set("mode", "cli-relay")
	query.Set("hostId", cfg.HostID)
	query.Set("callbackURL", localBrowserURL(cfg.HTTP)+"/api/relay/callback")
	query.Set("exchangeURL", cfg.Relay.ExchangeURL)
	target.RawQuery = query.Encode()

	return target.String()
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
