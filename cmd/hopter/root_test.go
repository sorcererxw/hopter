package main

import (
	"bytes"
	"context"
	"io"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/app"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
)

func TestRootHelpShowsPublicCommandSurface(t *testing.T) {
	output := commandOutput(t, newRootCommand("dev", "direct"), "--help")

	for _, want := range []string{"server", "stop", "doctor", "--background", "--local", "--relay", "--port"} {
		if !strings.Contains(output, want) {
			t.Fatalf("help output missing %q:\n%s", want, output)
		}
	}
	for _, notWant := range []string{"completion", "status", "--host", "--no-open", "--service", "--reset-auth", "--dev-proxy-url"} {
		if strings.Contains(output, notWant) {
			t.Fatalf("help output unexpectedly contains %q:\n%s", notWant, output)
		}
	}
}

func TestServerHelpHidesDeveloperOnlyFlags(t *testing.T) {
	output := commandOutput(t, newRootCommand("dev", "direct"), "server", "--help")

	if !strings.Contains(output, "--background") || !strings.Contains(output, "--relay") {
		t.Fatalf("server help missing expected public flags:\n%s", output)
	}
	if strings.Contains(output, "--dev-proxy-url") {
		t.Fatalf("server help exposes hidden dev proxy flag:\n%s", output)
	}
}

func TestRelayLoginURLUsesOAuthAuthorizeRedirect(t *testing.T) {
	cfg, err := app.LoadConfigWithOptions("dev", "direct", app.LoadOptions{Relay: true})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	cfg.Relay.OAuthAuthorizeURL = "https://auth.example.test/authorize"
	cfg.Relay.OAuthTokenURL = "https://auth.example.test/token"
	cfg.Relay.AuthURL = "https://hopter.example.test/login"

	loginURL := relayLoginURL(cfg)
	if !strings.Contains(loginURL, "mode=cli-relay") {
		t.Fatalf("loginURL = %q, missing mode=cli-relay", loginURL)
	}
	if !strings.Contains(loginURL, "callbackURL=") {
		t.Fatalf("loginURL = %q, missing callbackURL", loginURL)
	}
	if !strings.Contains(loginURL, "exchangeURL=") {
		t.Fatalf("loginURL = %q, missing exchangeURL", loginURL)
	}
}

func commandOutput(t *testing.T, cmd interface {
	SetArgs([]string)
	SetOut(io.Writer)
	SetErr(io.Writer)
	Execute() error
}, args ...string) string {
	t.Helper()
	var output bytes.Buffer
	cmd.SetArgs(args)
	cmd.SetOut(&output)
	cmd.SetErr(&output)
	if err := cmd.Execute(); err != nil {
		t.Fatalf("Execute(%v): %v\n%s", args, err, output.String())
	}
	return output.String()
}

func TestStartRelayWithStoredAuthStartsSessionManager(t *testing.T) {
	cfg, err := app.LoadConfigWithOptions("dev", "direct", app.LoadOptions{Relay: true})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}

	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	cfg.Relay.AuthStore = "file"
	cfg.Relay.AuthPath = authPath
	cfg.Relay.TokenPath = authPath
	store := serverhttp.NewFileRelayAuthStore(authPath)
	if err := store.Store(serverhttp.RelayCredential{
		AuthUserID:                "user-1",
		HostID:                    "host_local",
		WorkspaceSlug:             "alice",
		WorkspaceURL:              "https://my.hopter.dev",
		BrokerBaseURL:             "https://my.hopter.dev",
		OAuthAccessToken:          "oauth-access-token",
		OAuthRefreshToken:         "oauth-refresh-token",
		OAuthAccessTokenExpiresAt: time.Now().Add(time.Hour),
		UpdatedAt:                 time.Now().UTC(),
	}); err != nil {
		t.Fatalf("store auth: %v", err)
	}

	previousStoreFactory := newRelayAuthStore
	newRelayAuthStore = func(app.Config) serverhttp.RelayAuthStore { return store }
	defer func() { newRelayAuthStore = previousStoreFactory }()

	readyCh := make(chan struct{})
	started := make(chan serverhttp.RelayCredential, 1)
	previousManagerFactory := newRelaySessionManager
	newRelaySessionManager = func(
		_ app.Config,
		_ serverhttp.RelayAuthStore,
		_ *serverhttp.RelayRequestVerifier,
	) relaySessionManager {
		return &fakeRelaySessionManager{
			readyCh: readyCh,
			runFn: func(_ context.Context, credential serverhttp.RelayCredential) error {
				started <- credential
				return nil
			},
		}
	}
	defer func() { newRelaySessionManager = previousManagerFactory }()

	runtimeState := &app.Runtime{
		Config:        cfg,
		RelayVerifier: serverhttp.NewRelayRequestVerifier(),
	}

	var output bytes.Buffer
	close(readyCh)
	if err := startRelayWithStoredAuth(context.Background(), runtimeState, store, &output); err != nil {
		t.Fatalf("start relay: %v", err)
	}

	select {
	case credential := <-started:
		if credential.AuthUserID != "user-1" {
			t.Fatalf("credential.AuthUserID = %q, want user-1", credential.AuthUserID)
		}
	case <-time.After(2 * time.Second):
		t.Fatal("session manager did not start")
	}

	if !strings.Contains(output.String(), "Relay ready:") {
		t.Fatalf("output = %q, want relay ready line", output.String())
	}
}

type fakeRelaySessionManager struct {
	readyCh <-chan struct{}
	runFn   func(context.Context, serverhttp.RelayCredential) error
}

func (m *fakeRelaySessionManager) Run(ctx context.Context, credential serverhttp.RelayCredential) error {
	if m.runFn != nil {
		return m.runFn(ctx, credential)
	}
	return nil
}

func (m *fakeRelaySessionManager) Ready() <-chan struct{} {
	return m.readyCh
}
