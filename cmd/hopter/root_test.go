package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/app"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
)

func TestLocalBrowserURLUsesLoopbackForWildcardBind(t *testing.T) {
	got := localBrowserURL(app.HTTPConfig{Host: "0.0.0.0", Port: 18787})
	want := "http://127.0.0.1:18787"
	if got != want {
		t.Fatalf("localBrowserURL = %q, want %q", got, want)
	}
}

func TestLocalBrowserURLFormatsIPv6(t *testing.T) {
	got := localBrowserURL(app.HTTPConfig{Host: "::1", Port: 18787})
	want := "http://[::1]:18787"
	if got != want {
		t.Fatalf("localBrowserURL = %q, want %q", got, want)
	}
}

func TestPrintServeReadyGuidesUserToOpenURL(t *testing.T) {
	var buf bytes.Buffer
	printServeReady(&buf, app.Config{
		HTTP: app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
	})

	output := buf.String()
	for _, want := range []string{
		"hopter is running",
		"Open: http://127.0.0.1:18787",
		"Stop: Ctrl+C",
	} {
		if !strings.Contains(output, want) {
			t.Fatalf("startup output missing %q:\n%s", want, output)
		}
	}
}

func TestRelayLoginURLIncludesCallbackAndHost(t *testing.T) {
	cfg := app.Config{
		HostID: "host_local",
		HTTP:   app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
		Relay: app.RelayConfig{
			AuthURL: "https://auth.hopter.dev/login",
		},
	}

	got := relayLoginURL(cfg)
	for _, want := range []string{
		"https://auth.hopter.dev/login?",
		"mode=cli-relay",
		"hostId=host_local",
		"callbackURL=http%3A%2F%2F127.0.0.1%3A18787%2Fapi%2Frelay%2Fcallback",
		"exchangeURL=",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("relayLoginURL missing %q:\n%s", want, got)
		}
	}
}

func TestMaybeStartRelayOpensLoginWhenTokenMissing(t *testing.T) {
	originalOpenBrowser := openBrowser
	t.Cleanup(func() {
		openBrowser = originalOpenBrowser
	})

	var opened string
	openBrowser = func(rawURL string) error {
		opened = rawURL
		return nil
	}

	var buf bytes.Buffer
	err := maybeStartRelay(context.Background(), app.Config{
		HostID: "host_local",
		HTTP:   app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
		Relay: app.RelayConfig{
			Enabled:   true,
			AuthURL:   "https://auth.hopter.dev/login",
			TokenPath: filepath.Join(t.TempDir(), "missing-token"),
		},
	}, &buf)
	if err != nil {
		t.Fatalf("maybeStartRelay returned error: %v", err)
	}
	if opened == "" {
		t.Fatal("expected relay login URL to open")
	}
	if !strings.Contains(buf.String(), "Login required") {
		t.Fatalf("expected login guidance, got:\n%s", buf.String())
	}
}

func TestMaybeStartRelayWaitsForTunnelTokenBeforeEnrollment(t *testing.T) {
	originalLookPath := lookPath
	originalStartCommand := startCommand
	t.Cleanup(func() {
		lookPath = originalLookPath
		startCommand = originalStartCommand
	})
	lookPath = func(file string) (string, error) {
		return "/usr/local/bin/" + file, nil
	}
	startCommand = func(ctx context.Context, name string, args ...string) error {
		t.Fatalf("startCommand should not run without a cloudflare tunnel token")
		return nil
	}

	broker := httptestServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("broker enrollment should not run without a cloudflare tunnel token")
	})
	defer broker.Close()

	tokenPath := filepath.Join(t.TempDir(), "relay", "credential")
	if err := serverhttp.WriteRelayCredentialFile(tokenPath, serverhttp.RelayCredential{
		AuthUserID:    "user-1",
		HostID:        "host_local",
		WorkspaceSlug: "alice",
		WorkspaceURL:  "https://alice.hopter.dev",
		BrokerBaseURL: broker.URL,
		TunnelTarget:  "https://host_local.hosts.hopter.run",
		RelayToken:    "relay-token",
		ExpiresAt:     time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("write credential: %v", err)
	}

	var buf bytes.Buffer
	err := maybeStartRelay(context.Background(), app.Config{
		HostID: "host_local",
		HTTP:   app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
		Relay: app.RelayConfig{
			Enabled:     true,
			TokenPath:   tokenPath,
			Cloudflared: "cloudflared",
		},
	}, &buf)
	if err != nil {
		t.Fatalf("maybeStartRelay returned error: %v", err)
	}
	output := buf.String()
	want := "Command to run when configured: cloudflared tunnel --no-autoupdate run --token <cloudflare-tunnel-token>"
	if !strings.Contains(output, want) {
		t.Fatalf("output missing %q:\n%s", want, output)
	}
	if strings.Contains(output, "Relay ready") {
		t.Fatalf("relay should not be ready without a tunnel token:\n%s", output)
	}
}

func TestMaybeStartRelayStartsCloudflaredWhenTunnelTokenExists(t *testing.T) {
	originalLookPath := lookPath
	originalStartCommand := startCommand
	t.Cleanup(func() {
		lookPath = originalLookPath
		startCommand = originalStartCommand
	})
	lookPath = func(file string) (string, error) {
		return "/usr/local/bin/" + file, nil
	}

	var command string
	var args []string
	startCommand = func(ctx context.Context, name string, gotArgs ...string) error {
		command = name
		args = append([]string(nil), gotArgs...)
		return nil
	}

	var enrolled bool
	broker := httptestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.URL.Path != "/api/relay/hosts/host_local" {
			t.Fatalf("path = %s, want /api/relay/hosts/host_local", r.URL.Path)
		}
		if r.Header.Get("Authorization") != "Bearer relay-token" {
			t.Fatalf("authorization header = %q", r.Header.Get("Authorization"))
		}
		var payload map[string]string
		if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
			t.Fatalf("decode enrollment body: %v", err)
		}
		if payload["tunnelTarget"] != "https://host_local.hosts.hopter.run" {
			t.Fatalf("tunnel target = %q", payload["tunnelTarget"])
		}
		enrolled = true
		_, _ = w.Write([]byte(`{"host":{"id":"host_local","name":"host_local","status":"online"}}`))
	})
	defer broker.Close()

	tokenPath := filepath.Join(t.TempDir(), "relay", "credential")
	if err := serverhttp.WriteRelayCredentialFile(tokenPath, serverhttp.RelayCredential{
		HostID:                "host_local",
		WorkspaceSlug:         "alice",
		WorkspaceURL:          "https://alice.hopter.dev",
		BrokerBaseURL:         broker.URL,
		TunnelTarget:          "https://host_local.hosts.hopter.run",
		RelayToken:            "relay-token",
		CloudflareTunnelToken: "cf-token",
		ExpiresAt:             time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("write credential: %v", err)
	}

	err := maybeStartRelay(context.Background(), app.Config{
		HostID: "host_local",
		HTTP:   app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
		Relay: app.RelayConfig{
			Enabled:     true,
			TokenPath:   tokenPath,
			Cloudflared: "cloudflared",
		},
	}, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("maybeStartRelay returned error: %v", err)
	}
	if command != "cloudflared" {
		t.Fatalf("command = %q, want cloudflared", command)
	}
	got := strings.Join(args, " ")
	if got != "tunnel --no-autoupdate run --token cf-token" {
		t.Fatalf("args = %q", got)
	}
	if !enrolled {
		t.Fatal("expected host enrollment request")
	}
}

func TestRelayTokenExistsRequiresNonEmptyFile(t *testing.T) {
	dir := t.TempDir()
	path := filepath.Join(dir, "token")
	if relayTokenExists(path) {
		t.Fatal("missing token reported as present")
	}
	if err := os.WriteFile(path, []byte("token"), 0o600); err != nil {
		t.Fatalf("write token: %v", err)
	}
	if !relayTokenExists(path) {
		t.Fatal("non-empty token file reported as missing")
	}
}

func httptestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(handler)
}
