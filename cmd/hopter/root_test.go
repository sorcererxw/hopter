package main

import (
	"bytes"
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
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
			OAuthAuthorizeURL: "https://auth.hopter.dev/api/auth/oauth2/authorize",
			OAuthTokenURL:     "https://auth.hopter.dev/api/auth/oauth2/token",
			OAuthClientID:     "hopter-cli",
			OAuthAudience:     "hopter",
		},
	}

	got := relayLoginURL(cfg)
	parsed, err := url.Parse(got)
	if err != nil {
		t.Fatalf("relayLoginURL returned invalid URL %q: %v", got, err)
	}
	if parsed.Scheme != "https" || parsed.Host != "hopter.dev" || parsed.Path != "/login" {
		t.Fatalf("relayLoginURL should open the site login page, got %s", got)
	}
	authorizeURL := parsed.Query().Get("callbackURL")
	if authorizeURL == "" {
		t.Fatalf("relayLoginURL missing nested OAuth callbackURL:\n%s", got)
	}
	for _, want := range []string{
		"https://hopter.dev/login?",
		"callbackURL=",
		"mode=cli-relay",
		"hostId=host_local",
	} {
		if !strings.Contains(got, want) {
			t.Fatalf("relayLoginURL missing %q:\n%s", want, got)
		}
	}
	for _, want := range []string{
		"https://auth.hopter.dev/api/auth/oauth2/authorize?",
		"response_type=code",
		"client_id=hopter-cli",
		"redirect_uri=http%3A%2F%2F127.0.0.1%3A18787%2Fapi%2Frelay%2Fcallback",
		"scope=openid+offline_access",
		"code_challenge_method=S256",
		"resource=hopter",
	} {
		if !strings.Contains(authorizeURL, want) {
			t.Fatalf("relayLoginURL nested authorize URL missing %q:\n%s", want, authorizeURL)
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
			AuthURL:   "https://hopter.dev/login",
			AuthStore: "file",
			AuthPath:  filepath.Join(t.TempDir(), "missing-token"),
		},
	}, &buf)
	if err != nil {
		t.Fatalf("maybeStartRelay returned error: %v", err)
	}
	deadline := time.Now().Add(2 * time.Second)
	for opened == "" && time.Now().Before(deadline) {
		time.Sleep(10 * time.Millisecond)
	}
	if opened == "" {
		t.Fatal("expected relay login URL to open after server startup delay")
	}
	if !strings.Contains(buf.String(), "Login required") {
		t.Fatalf("expected login guidance, got:\n%s", buf.String())
	}
}

func TestMaybeStartRelayWaitsForConnectorTokenBeforeEnrollment(t *testing.T) {
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
		t.Fatalf("startCommand should not run without a connector token")
		return nil
	}

	broker := httptestServer(t, func(w http.ResponseWriter, r *http.Request) {
		t.Fatalf("broker control-plane request should not run without a connector token")
	})
	defer broker.Close()

	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	if err := serverhttp.WriteRelayAuthFile(authPath, serverhttp.RelayCredential{
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
			Enabled:      true,
			AuthStore:    "file",
			AuthPath:     authPath,
			ConnectorBin: "relay-connector",
		},
	}, &buf)
	if err != nil {
		t.Fatalf("maybeStartRelay returned error: %v", err)
	}
	output := buf.String()
	want := "Relay connector is not ready yet"
	if !strings.Contains(output, want) {
		t.Fatalf("output missing %q:\n%s", want, output)
	}
	if strings.Contains(output, "Cloudflare") || strings.Contains(output, "cloudflared") {
		t.Fatalf("relay output should not expose provider-specific names:\n%s", output)
	}
	if strings.Contains(output, "Relay ready") {
		t.Fatalf("relay should not be ready without a connector token:\n%s", output)
	}
}

func TestManagedRelayConnectorUsesEmbeddedPreviewByDefault(t *testing.T) {
	preview := managedRelayConnectorRunner{}.CommandPreview(app.Config{
		Relay: app.RelayConfig{
			ConnectorBin: "cloudflared",
		},
	}, serverhttp.RelayCredential{})

	if preview != "embedded relay connector" {
		t.Fatalf("preview = %q, want embedded relay connector", preview)
	}
}

func TestMaybeStartRelayStartsConnectorWhenConnectorTokenExists(t *testing.T) {
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

	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	if err := serverhttp.WriteRelayAuthFile(authPath, serverhttp.RelayCredential{
		HostID:         "host_local",
		WorkspaceSlug:  "alice",
		WorkspaceURL:   "https://alice.hopter.dev",
		TunnelTarget:   "https://host_local.hosts.hopter.run",
		ConnectorToken: "connector-token",
		ExpiresAt:      time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("write credential: %v", err)
	}

	err := maybeStartRelay(context.Background(), app.Config{
		HostID: "host_local",
		HTTP:   app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
		Relay: app.RelayConfig{
			Enabled:      true,
			AuthStore:    "file",
			AuthPath:     authPath,
			ConnectorBin: "relay-connector",
		},
	}, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("maybeStartRelay returned error: %v", err)
	}
	if command != "relay-connector" {
		t.Fatalf("command = %q, want relay-connector", command)
	}
	got := strings.Join(args, " ")
	if got != "tunnel --no-autoupdate run --token connector-token" {
		t.Fatalf("args = %q", got)
	}
}

func TestMaybeStartRelayAllocatesConnectorTokenWithOAuthCredential(t *testing.T) {
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

	var sawAllocate bool
	var sawReady bool
	api := httptestServer(t, func(w http.ResponseWriter, r *http.Request) {
		if r.Header.Get("Authorization") != "Bearer jwt-access-token" {
			t.Fatalf("authorization header = %q", r.Header.Get("Authorization"))
		}
		switch r.URL.Path {
		case "/api/relay/allocate":
			sawAllocate = true
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{
				"leaseId": "lease-1",
				"leaseVersion": 1,
				"workspaceSlug": "alice",
				"workspaceURL": "https://alice.hopter.dev",
				"brokerBaseURL": "https://alice.hopter.dev",
				"privateHostname": "r-abc.relay.hopter.dev",
				"tunnelTarget": "https://r-abc.relay.hopter.dev",
				"tunnelToken": "connector-token"
			}`))
		case "/api/relay/leases/lease-1/ready":
			sawReady = true
			var payload map[string]int
			if err := json.NewDecoder(r.Body).Decode(&payload); err != nil {
				t.Fatalf("decode ready body: %v", err)
			}
			if payload["leaseVersion"] != 1 {
				t.Fatalf("leaseVersion = %d, want 1", payload["leaseVersion"])
			}
			w.Header().Set("Content-Type", "application/json")
			_, _ = w.Write([]byte(`{"ready":true}`))
		default:
			t.Fatalf("unexpected API path %s", r.URL.Path)
		}
	})
	defer api.Close()

	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	if err := serverhttp.WriteRelayAuthFile(authPath, serverhttp.RelayCredential{
		HostID:                    "host_local",
		WorkspaceSlug:             "alice",
		OAuthAccessToken:          "jwt-access-token",
		OAuthRefreshToken:         "refresh-token",
		OAuthAccessTokenExpiresAt: time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("write credential: %v", err)
	}

	err := maybeStartRelay(context.Background(), app.Config{
		HostID: "host_local",
		HTTP:   app.HTTPConfig{Host: "127.0.0.1", Port: 18787},
		Relay: app.RelayConfig{
			Enabled:        true,
			AuthStore:      "file",
			AuthPath:       authPath,
			AllocateURL:    api.URL + "/api/relay/allocate",
			OAuthTokenURL:  api.URL + "/api/auth/oauth2/token",
			OAuthClientID:  "hopter-cli",
			OAuthAudience:  "hopter",
			ConnectorBin:   "relay-connector",
			HeartbeatEvery: time.Hour,
		},
	}, &bytes.Buffer{})
	if err != nil {
		t.Fatalf("maybeStartRelay returned error: %v", err)
	}
	if !sawAllocate || !sawReady {
		t.Fatalf("allocate=%v ready=%v", sawAllocate, sawReady)
	}
	if command != "relay-connector" {
		t.Fatalf("command = %q, want relay-connector", command)
	}
	if got := strings.Join(args, " "); got != "tunnel --no-autoupdate run --token connector-token" {
		t.Fatalf("args = %q", got)
	}
	stored, err := serverhttp.NewFileRelayAuthStore(authPath).Load()
	if err != nil {
		t.Fatalf("load stored credential: %v", err)
	}
	if stored.ConnectorToken != "connector-token" {
		t.Fatalf("connector token should remain in process memory after allocation, got %q", stored.ConnectorToken)
	}
	data, err := os.ReadFile(authPath)
	if err != nil {
		t.Fatalf("read auth: %v", err)
	}
	if strings.Contains(string(data), "connector-token") {
		t.Fatalf("connector token should not be persisted:\n%s", string(data))
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

func TestResetAuthRequiresRelay(t *testing.T) {
	err := newRootApp("dev", "test").Run([]string{"hopter", "--reset-auth"})
	if err == nil {
		t.Fatal("expected --reset-auth without --relay to fail")
	}
	if !strings.Contains(err.Error(), "--reset-auth requires --relay") {
		t.Fatalf("error = %v", err)
	}
}

func TestServeSubcommandResetAuthRequiresRelay(t *testing.T) {
	err := newRootApp("dev", "test").Run([]string{"hopter", "serve", "--reset-auth"})
	if err == nil {
		t.Fatal("expected serve --reset-auth without --relay to fail")
	}
	if !strings.Contains(err.Error(), "--reset-auth requires --relay") {
		t.Fatalf("error = %v", err)
	}
}

func TestVersionCommandPrintsVersion(t *testing.T) {
	cmd := newRootApp("1.2.3", "test")
	var out bytes.Buffer
	cmd.Writer = &out

	if err := cmd.Run([]string{"hopter", "version"}); err != nil {
		t.Fatalf("version command returned error: %v", err)
	}
	if got := out.String(); got != "1.2.3\n" {
		t.Fatalf("version output = %q", got)
	}
}

func httptestServer(t *testing.T, handler http.HandlerFunc) *httptest.Server {
	t.Helper()
	return httptest.NewServer(handler)
}
