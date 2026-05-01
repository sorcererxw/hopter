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
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"syscall"
	"time"

	"github.com/spf13/cobra"
	"golang.org/x/term"

	"github.com/sorcererxw/hopter/internal/app"
	"github.com/sorcererxw/hopter/internal/hoststate"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
	relayruntime "github.com/sorcererxw/hopter/internal/relay"
)

const backgroundChildEnv = "HOPTER_BACKGROUND_CHILD"

type serverOptions struct {
	port        int
	background  bool
	local       bool
	devProxyURL string
	relay       bool
	verbose     bool
}

type serverMode string

const (
	serverModeForeground serverMode = "foreground"
	serverModeBackground serverMode = "background"
)

func newRootCommand(version string, installSource string) *cobra.Command {
	opts := serverOptions{local: true}
	root := &cobra.Command{
		Use:           "hopter",
		Short:         "Run Hopter, the local browser control plane for coding agents",
		SilenceUsage:  true,
		SilenceErrors: true,
		Args:          cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runServer(version, installSource, opts, cmd.OutOrStdout(), cmd.ErrOrStderr())
		},
	}
	root.Example = strings.TrimSpace(`
  hopter
  hopter --relay
  hopter --relay --local=false
  hopter --background
  hopter doctor
`)
	root.CompletionOptions.DisableDefaultCmd = true
	addServerFlags(root, &opts)
	root.AddCommand(newServerCmd(version, installSource), newServeAliasCmd(version, installSource), newStopCmd(), newDoctorCmd(version, installSource), newVersionCmd(version))
	return root
}

func newServerCmd(version string, installSource string) *cobra.Command {
	opts := serverOptions{local: true}
	cmd := &cobra.Command{
		Use:           "server",
		Short:         "Run the Hopter server",
		SilenceUsage:  true,
		SilenceErrors: true,
		Args:          cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return runServer(version, installSource, opts, cmd.OutOrStdout(), cmd.ErrOrStderr())
		},
	}
	cmd.Example = strings.TrimSpace(`
  hopter server
  hopter server --background
  hopter server --relay
  hopter server --relay --local=false
  hopter server --port 18788
`)
	addServerFlags(cmd, &opts)
	return cmd
}

func newServeAliasCmd(version string, installSource string) *cobra.Command {
	cmd := newServerCmd(version, installSource)
	cmd.Use = "serve"
	cmd.Hidden = true
	return cmd
}

func addServerFlags(cmd *cobra.Command, opts *serverOptions) {
	cmd.Flags().IntVar(&opts.port, "port", 0, "HTTP port")
	cmd.Flags().BoolVar(&opts.background, "background", false, "Run the server in the background")
	cmd.Flags().BoolVar(&opts.local, "local", true, "Expose the local browser UI on localhost")
	cmd.Flags().BoolVar(&opts.relay, "relay", false, "Connect this host through the hosted relay")
	cmd.Flags().BoolVar(&opts.verbose, "verbose", false, "Show internal diagnostic logs")
	cmd.Flags().StringVar(&opts.devProxyURL, "dev-proxy-url", "", "Vite dev server URL to reverse proxy")
	_ = cmd.Flags().MarkHidden("dev-proxy-url")
}

func newStopCmd() *cobra.Command {
	var timeout time.Duration
	cmd := &cobra.Command{
		Use:           "stop",
		Short:         "Stop the background Hopter server",
		SilenceUsage:  true,
		SilenceErrors: true,
		Args:          cobra.NoArgs,
		RunE: func(cmd *cobra.Command, _ []string) error {
			return stopBackgroundServer(timeout, cmd.OutOrStdout())
		},
	}
	cmd.Flags().DurationVar(&timeout, "timeout", 5*time.Second, "Time to wait for shutdown")
	return cmd
}

func runServer(version string, installSource string, opts serverOptions, out io.Writer, errOut io.Writer) error {
	configureLogging(opts.verbose, errOut)
	if opts.background && os.Getenv(backgroundChildEnv) != "1" {
		return startBackgroundServer(opts, out)
	}

	mode := serverModeForeground
	if os.Getenv(backgroundChildEnv) == "1" || opts.background {
		mode = serverModeBackground
	}

	cfg, err := app.LoadConfigWithOptions(version, installSource, app.LoadOptions{
		Port:        opts.port,
		Local:       &opts.local,
		DevProxyURL: opts.devProxyURL,
		Relay:       opts.relay,
	})
	if err != nil {
		return err
	}
	if !cfg.HTTP.Local && cfg.Relay.Enabled {
		store := newRelayAuthStore(cfg)
		if !store.Exists() {
			return fmt.Errorf("--local=false requires existing relay auth; run `hopter --relay` once with local enabled to complete browser login")
		}
	}

	runtimeState, err := app.NewRuntime(cfg)
	if err != nil {
		return fmt.Errorf("start Hopter runtime: %w", err)
	}

	listener, err := listenForServer(cfg.HTTP)
	if err != nil {
		return err
	}
	defer listener.Close()
	if !cfg.HTTP.Local {
		defer os.Remove(cfg.HTTP.SocketPath)
	}

	ctx, stopSignals := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stopSignals()

	shutdownDone := make(chan struct{})
	go func() {
		<-ctx.Done()
		shutdownServer(runtimeState.Server)
		close(shutdownDone)
	}()

	go func() {
		if err := runtimeState.Server.Serve(listener); err != nil && !errors.Is(err, http.ErrServerClosed) {
			slog.Error("serve", "error", err)
		}
	}()

	state := serverState(cfg, mode)
	if mode == serverModeBackground {
		logPath, errLogPath := hoststate.LogPaths()
		state.LogPath = logPath
		state.ErrorLogPath = errLogPath
	}
	if err := hoststate.Write(state); err != nil {
		slog.Warn("write host state", "error", err)
	}
	defer func() {
		if err := hoststate.RemoveForPID(os.Getpid()); err != nil {
			slog.Warn("remove host state", "error", err)
		}
	}()

	if err := maybeStartRelay(ctx, runtimeState, out); err != nil {
		slog.Warn("relay startup incomplete", "error", err)
	}
	if mode == serverModeForeground {
		printServerReady(out, cfg)
		if isInteractive() {
			if cfg.HTTP.Local {
				if err := openBrowser(localBrowserURL(cfg.HTTP)); err != nil && out != nil {
					fmt.Fprintf(out, "Browser open failed. Open manually: %s\n\n", localBrowserURL(cfg.HTTP))
				}
			}
			go runHostControlLoop(ctx, stopSignals, runtimeState.Server, out)
		}
	}

	<-ctx.Done()
	<-shutdownDone
	return nil
}

func configureLogging(verbose bool, errOut io.Writer) {
	if verbose {
		if errOut == nil {
			errOut = os.Stderr
		}
		slog.SetDefault(slog.New(slog.NewTextHandler(errOut, &slog.HandlerOptions{Level: slog.LevelDebug})))
		return
	}
	slog.SetDefault(slog.New(slog.NewTextHandler(io.Discard, nil)))
}

func serverState(cfg app.Config, mode serverMode) hoststate.State {
	return hoststate.State{
		PID:           os.Getpid(),
		URL:           localBrowserURL(cfg.HTTP),
		BindAddr:      cfg.HTTP.Addr(),
		Local:         cfg.HTTP.Local,
		SocketPath:    cfg.HTTP.SocketPath,
		Mode:          string(mode),
		InstallSource: cfg.InstallSource,
		StartedAt:     time.Now().UTC(),
	}
}

func startBackgroundServer(opts serverOptions, out io.Writer) error {
	executable, err := os.Executable()
	if err != nil {
		return err
	}
	logPath, errLogPath := hoststate.LogPaths()
	if err := os.MkdirAll(filepath.Dir(logPath), 0o755); err != nil {
		return err
	}
	stdout, err := os.OpenFile(logPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer stdout.Close()
	stderr, err := os.OpenFile(errLogPath, os.O_CREATE|os.O_APPEND|os.O_WRONLY, 0o644)
	if err != nil {
		return err
	}
	defer stderr.Close()

	args := []string{"server"}
	if opts.port != 0 {
		args = append(args, "--port", strconv.Itoa(opts.port))
	}
	if opts.relay {
		args = append(args, "--relay")
	}
	if !opts.local {
		args = append(args, "--local=false")
	}
	if opts.verbose {
		args = append(args, "--verbose")
	}
	if strings.TrimSpace(opts.devProxyURL) != "" {
		args = append(args, "--dev-proxy-url", opts.devProxyURL)
	}
	cmd := exec.Command(executable, args...)
	cmd.Env = append(os.Environ(), backgroundChildEnv+"=1")
	cmd.Stdout = stdout
	cmd.Stderr = stderr
	cmd.SysProcAttr = &syscall.SysProcAttr{Setsid: true}
	if err := cmd.Start(); err != nil {
		return err
	}
	pid := cmd.Process.Pid
	_ = cmd.Process.Release()

	state, err := waitForState(pid, 10*time.Second)
	if err != nil {
		return err
	}
	if out != nil {
		fmt.Fprintf(out, "Hopter is running in the background\n\n")
		if state.Local {
			fmt.Fprintf(out, "  Local: %s\n", state.URL)
		} else {
			fmt.Fprintf(out, "  Local: disabled\n")
			fmt.Fprintf(out, "  Socket: %s\n", state.SocketPath)
		}
		fmt.Fprintf(out, "  PID:   %d\n", state.PID)
		fmt.Fprintf(out, "  Log:   %s\n", state.LogPath)
		fmt.Fprintf(out, "  Error: %s\n\n", state.ErrorLogPath)
	}
	return nil
}

func waitForState(pid int, timeout time.Duration) (hoststate.State, error) {
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		state, err := hoststate.Read()
		if err == nil && state.PID == pid && serverStateReady(state, 150*time.Millisecond) {
			return state, nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return hoststate.State{}, fmt.Errorf("background server did not become ready; check logs in %s", filepath.Dir(hoststate.Path()))
}

func stopBackgroundServer(timeout time.Duration, out io.Writer) error {
	state, err := hoststate.Read()
	if err != nil {
		return fmt.Errorf("no saved Hopter server state found; nothing to stop")
	}
	process, err := os.FindProcess(state.PID)
	if err != nil {
		return err
	}
	if err := process.Signal(syscall.SIGTERM); err != nil {
		if !serverStateReady(state, 150*time.Millisecond) {
			_ = hoststate.RemoveForPID(state.PID)
			if out != nil {
				fmt.Fprintf(out, "Removed stale Hopter server state for process %d\n", state.PID)
			}
			return nil
		}
		return fmt.Errorf("stop Hopter process %d: %w", state.PID, err)
	}
	deadline := time.Now().Add(timeout)
	for time.Now().Before(deadline) {
		if !serverStateReady(state, 150*time.Millisecond) {
			_ = hoststate.RemoveForPID(state.PID)
			if out != nil {
				fmt.Fprintf(out, "Stopped Hopter server %d\n", state.PID)
			}
			return nil
		}
		time.Sleep(100 * time.Millisecond)
	}
	return fmt.Errorf("Hopter process %d did not stop within %s", state.PID, timeout)
}

func listenForServer(cfg app.HTTPConfig) (net.Listener, error) {
	if cfg.Local {
		listener, err := net.Listen("tcp", cfg.Addr())
		if err != nil {
			return nil, fmt.Errorf("listen on %s: %w", cfg.Addr(), err)
		}
		return listener, nil
	}

	socketPath := strings.TrimSpace(cfg.SocketPath)
	if socketPath == "" {
		return nil, fmt.Errorf("listen on local socket: socket path is empty")
	}
	if unixReady(socketPath, 150*time.Millisecond) {
		return nil, fmt.Errorf("Hopter is already running on %s; run `hopter stop` first", socketPath)
	}
	if err := os.MkdirAll(filepath.Dir(socketPath), 0o755); err != nil {
		return nil, fmt.Errorf("create socket directory: %w", err)
	}
	if err := os.Remove(socketPath); err != nil && !errors.Is(err, os.ErrNotExist) {
		return nil, fmt.Errorf("remove stale socket %s: %w", socketPath, err)
	}
	listener, err := net.Listen("unix", socketPath)
	if err != nil {
		return nil, fmt.Errorf("listen on %s: %w", socketPath, err)
	}
	if err := os.Chmod(socketPath, 0o600); err != nil {
		_ = listener.Close()
		return nil, fmt.Errorf("secure socket %s: %w", socketPath, err)
	}
	return listener, nil
}

func tcpReady(addr string, timeout time.Duration) bool {
	conn, err := net.DialTimeout("tcp", addr, timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func unixReady(path string, timeout time.Duration) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	conn, err := net.DialTimeout("unix", path, timeout)
	if err != nil {
		return false
	}
	_ = conn.Close()
	return true
}

func serverStateReady(state hoststate.State, timeout time.Duration) bool {
	if state.Local || strings.TrimSpace(state.SocketPath) == "" {
		return tcpReady(state.BindAddr, timeout)
	}
	return unixReady(state.SocketPath, timeout)
}

func shutdownServer(server *http.Server) {
	shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
	defer cancel()
	if err := server.Shutdown(shutdownCtx); err != nil {
		slog.Error("shutdown server", "error", err)
	}
}

func isInteractive() bool {
	return term.IsTerminal(int(os.Stdin.Fd())) && term.IsTerminal(int(os.Stdout.Fd()))
}

func runHostControlLoop(ctx context.Context, stop context.CancelFunc, server *http.Server, out io.Writer) {
	if out == nil {
		return
	}
	oldState, err := term.MakeRaw(int(os.Stdin.Fd()))
	if err != nil {
		return
	}
	var restoreOnce sync.Once
	restore := func() {
		restoreOnce.Do(func() {
			_ = term.Restore(int(os.Stdin.Fd()), oldState)
		})
	}
	defer restore()
	go func() {
		<-ctx.Done()
		restore()
	}()
	buffer := make([]byte, 1)
	for {
		select {
		case <-ctx.Done():
			return
		default:
		}
		n, readErr := os.Stdin.Read(buffer)
		if readErr != nil || n == 0 {
			return
		}
		switch strings.ToLower(string(buffer[0])) {
		case "h", "?":
			printShortcuts(out)
		case "r":
			fmt.Fprintf(out, "\r\nRelay status is available when Hopter is running with --relay.\r\n")
		case "d":
			fmt.Fprintf(out, "\r\nRun `hopter doctor` in another terminal for static checks and recovery suggestions.\r\n")
		case "q":
			fmt.Fprintf(out, "\r\nStopping Hopter...\r\n")
			stop()
			shutdownServer(server)
			return
		case "\x03":
			stop()
			shutdownServer(server)
			return
		}
	}
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
		fmt.Fprintf(out, "Relay requested\n\n")
	}
	store := newRelayAuthStore(runtimeState.Config)
	if !store.Exists() {
		if !runtimeState.Config.HTTP.Local {
			return fmt.Errorf("--local=false requires existing relay auth; run `hopter --relay` once with local enabled to complete browser login")
		}
		startRelayLoginFlow(ctx, runtimeState, store, out)
		return nil
	}
	if err := startRelayWithStoredAuth(ctx, runtimeState, store, out); err != nil {
		if resetErr := store.Reset(); resetErr != nil {
			return fmt.Errorf("%w; reset relay auth: %v", err, resetErr)
		}
		if !runtimeState.Config.HTTP.Local {
			return fmt.Errorf("%w; stored relay auth was not usable and --local=false cannot complete browser login; run `hopter --relay` once with local enabled", err)
		}
		if out != nil {
			fmt.Fprintf(out, "  Stored relay auth was not usable; starting login again.\n")
		}
		startRelayLoginFlow(ctx, runtimeState, store, out)
	}
	return nil
}

func startRelayLoginFlow(ctx context.Context, runtimeState *app.Runtime, store serverhttp.RelayAuthStore, out io.Writer) {
	loginURL := relayLoginURL(runtimeState.Config)
	if out != nil {
		fmt.Fprintf(out, "  Login required: %s\n", loginURL)
		fmt.Fprintf(out, "  Waiting for browser login to complete, then relay will continue automatically.\n\n")
	}
	go waitForRelayAuthAndStart(ctx, runtimeState, store, out)
	go openRelayLoginAfterServerStarts(ctx, loginURL)
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

func printServerReady(out io.Writer, cfg app.Config) {
	if out == nil {
		return
	}
	fmt.Fprintf(out, "Hopter is running\n\n")
	if cfg.HTTP.Local {
		fmt.Fprintf(out, "  Local: %s\n", localBrowserURL(cfg.HTTP))
	} else {
		fmt.Fprintf(out, "  Local: disabled\n")
		fmt.Fprintf(out, "  Socket: %s\n", cfg.HTTP.SocketPath)
	}
	fmt.Fprintf(out, "  Mode:  %s\n\n", cfg.UI.Mode())
	printShortcuts(out)
}

func printShortcuts(out io.Writer) {
	fmt.Fprintf(out, "Shortcuts:\n")
	fmt.Fprintf(out, "  r  print relay status\n")
	fmt.Fprintf(out, "  d  print doctor suggestions\n")
	fmt.Fprintf(out, "  h  show shortcuts\n")
	fmt.Fprintf(out, "  q  stop Hopter\n\n")
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
