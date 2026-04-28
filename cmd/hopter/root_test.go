package main

import (
	"bytes"
	"context"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/app"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
)

func TestRunServeRequiresRelayForResetAuth(t *testing.T) {
	err := runServe("dev", "direct", serveOptions{resetAuth: true}, ioDiscard{})
	if err == nil || err.Error() != "--reset-auth requires --relay" {
		t.Fatalf("err = %v, want reset-auth validation", err)
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

type ioDiscard struct{}

func (ioDiscard) Write(p []byte) (int, error) {
	return len(p), nil
}
