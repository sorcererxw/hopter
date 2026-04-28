package serverhttp

import (
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
)

func TestBeginRelayOAuthLoginBuildsPKCEAuthorizeURL(t *testing.T) {
	loginURL, err := BeginRelayOAuthLogin("http://127.0.0.1:18787/api/relay/callback", RelayOptions{
		OAuthAuthorizeURL: "https://auth.hopter.dev/api/auth/oauth2/authorize",
		OAuthTokenURL:     "https://auth.hopter.dev/api/auth/oauth2/token",
		OAuthClientID:     "hopter-cli",
		OAuthAudience:     "hopter",
	})
	if err != nil {
		t.Fatalf("begin login: %v", err)
	}

	parsed, err := url.Parse(loginURL)
	if err != nil {
		t.Fatalf("parse login URL: %v", err)
	}
	query := parsed.Query()
	if parsed.Scheme != "https" || parsed.Host != "auth.hopter.dev" || parsed.Path != "/api/auth/oauth2/authorize" {
		t.Fatalf("authorize URL = %s", loginURL)
	}
	for key, want := range map[string]string{
		"response_type":         "code",
		"client_id":             "hopter-cli",
		"redirect_uri":          "http://127.0.0.1:18787/api/relay/callback",
		"scope":                 "openid offline_access",
		"code_challenge_method": "S256",
		"resource":              "hopter",
	} {
		if got := query.Get(key); got != want {
			t.Fatalf("%s = %q, want %q in %s", key, got, want, loginURL)
		}
	}
	if query.Get("state") == "" {
		t.Fatalf("authorize URL missing state: %s", loginURL)
	}
	if query.Get("code_challenge") == "" {
		t.Fatalf("authorize URL missing code_challenge: %s", loginURL)
	}
}

func TestRelayCallbackExchangesOAuthCodeAndStoresRefreshToken(t *testing.T) {
	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		if err := r.ParseForm(); err != nil {
			t.Fatalf("parse form: %v", err)
		}
		for key, want := range map[string]string{
			"grant_type":            "authorization_code",
			"client_id":             "hopter-cli",
			"code":                  "oauth-code",
			"redirect_uri":          "http://127.0.0.1:18787/api/relay/callback",
			"resource":              "hopter",
			"code_challenge_method": "",
		} {
			if key == "code_challenge_method" {
				continue
			}
			if got := r.Form.Get(key); got != want {
				t.Fatalf("%s = %q, want %q", key, got, want)
			}
		}
		if r.Form.Get("code_verifier") == "" {
			t.Fatal("token exchange missing PKCE verifier")
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"access_token": "jwt-access-token",
			"refresh_token": "refresh-token",
			"token_type": "Bearer",
			"scope": "openid offline_access",
			"expires_in": 3600
		}`))
	}))
	t.Cleanup(tokenServer.Close)

	loginURL, err := BeginRelayOAuthLogin("http://127.0.0.1:18787/api/relay/callback", RelayOptions{
		OAuthAuthorizeURL: "https://auth.hopter.dev/api/auth/oauth2/authorize",
		OAuthTokenURL:     tokenServer.URL,
		OAuthClientID:     "hopter-cli",
		OAuthAudience:     "hopter",
	})
	if err != nil {
		t.Fatalf("begin login: %v", err)
	}
	parsed, err := url.Parse(loginURL)
	if err != nil {
		t.Fatalf("parse login URL: %v", err)
	}

	handler := NewRelayCallbackHandler(RelayOptions{
		AuthPath:      authPath,
		OAuthTokenURL: tokenServer.URL,
		OAuthClientID: "hopter-cli",
		OAuthAudience: "hopter",
		HostID:        "host_local",
	})
	request := httptest.NewRequest(http.MethodGet, "/api/relay/callback?code=oauth-code&state="+url.QueryEscape(parsed.Query().Get("state")), nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	assertRelayCallbackRedirect(t, recorder, "")
	stored, err := NewFileRelayAuthStore(authPath).Load()
	if err != nil {
		t.Fatalf("load auth: %v", err)
	}
	if stored.OAuthAccessToken != "jwt-access-token" {
		t.Fatalf("access token = %q", stored.OAuthAccessToken)
	}
	if stored.OAuthRefreshToken != "refresh-token" {
		t.Fatalf("refresh token = %q", stored.OAuthRefreshToken)
	}
	if stored.RelayToken != "" || stored.SessionToken != "" {
		t.Fatalf("oauth callback should not allocate relay token yet: %+v", stored)
	}
	if stored.OAuthAccessTokenExpiresAt.IsZero() {
		t.Fatal("missing access token expiry")
	}
}

func TestRefreshRelayOAuthTokenRetriesTransientTokenEndpointRestart(t *testing.T) {
	attempts := 0
	tokenServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		attempts++
		if attempts < 3 {
			http.Error(w, "Your worker restarted mid-request. Please try sending the request again.", http.StatusServiceUnavailable)
			return
		}

		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"access_token": "jwt-access-token",
			"refresh_token": "new-refresh-token",
			"token_type": "Bearer",
			"scope": "openid offline_access",
			"expires_in": 3600
		}`))
	}))
	t.Cleanup(tokenServer.Close)

	refreshed, err := RefreshRelayOAuthToken(context.Background(), RelayOptions{
		OAuthTokenURL: tokenServer.URL,
		OAuthClientID: "hopter-cli",
		OAuthAudience: "hopter",
	}, RelayCredential{
		OAuthRefreshToken: "old-refresh-token",
	})
	if err != nil {
		t.Fatalf("refresh token: %v", err)
	}
	if attempts != 3 {
		t.Fatalf("attempts = %d, want 3", attempts)
	}
	if refreshed.OAuthAccessToken != "jwt-access-token" {
		t.Fatalf("access token = %q", refreshed.OAuthAccessToken)
	}
	if refreshed.OAuthRefreshToken != "new-refresh-token" {
		t.Fatalf("refresh token = %q", refreshed.OAuthRefreshToken)
	}
}

func TestRelayCallbackExchangesCodeAndStoresCredential(t *testing.T) {
	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	exchangeServer := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if r.Method != http.MethodPost {
			t.Fatalf("method = %s, want POST", r.Method)
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{
			"authUserId": "user-1",
			"hostId": "host_local",
			"workspaceSlug": "alice",
			"workspaceURL": "https://alice.hopter.dev",
			"brokerBaseURL": "https://alice.hopter.dev",
			"relayBaseURL": "https://api.hopter.dev",
			"tunnelTarget": "https://host_local.hosts.hopter.run",
			"relayToken": "relay-token",
			"brokerSecret": "broker-secret",
			"connectorProvider": "managed",
			"connectorToken": "connector-token",
			"expiresAt": "2026-05-01T00:00:00Z"
		}`))
	}))
	t.Cleanup(exchangeServer.Close)
	handler := NewRelayCallbackHandler(RelayOptions{
		AuthPath:    authPath,
		ExchangeURL: exchangeServer.URL,
		HostID:      "host_local",
	})
	request := httptest.NewRequest(http.MethodGet, "/api/relay/callback?code=abc123", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	assertRelayCallbackRedirect(t, recorder, "https://alice.hopter.dev")

	store := NewFileRelayAuthStore(authPath)
	stored, err := store.Load()
	if err != nil {
		t.Fatalf("load auth: %v", err)
	}
	if stored.RelayToken != "relay-token" {
		t.Fatalf("stored relay token = %q, want relay-token", stored.RelayToken)
	}
	if stored.SessionToken != "connector-token" {
		t.Fatalf("stored session token = %q, want connector-token", stored.SessionToken)
	}
	if stored.TunnelTarget != "https://host_local.hosts.hopter.run" {
		t.Fatalf("stored tunnel target = %q", stored.TunnelTarget)
	}
	if stored.RelayBaseURL != "https://api.hopter.dev" {
		t.Fatalf("stored relay base URL = %q", stored.RelayBaseURL)
	}
	if stored.UpdatedAt.IsZero() {
		t.Fatal("stored token missing UpdatedAt")
	}
	data, err := os.ReadFile(authPath)
	if err != nil {
		t.Fatalf("read auth: %v", err)
	}
	if strings.Contains(string(data), "cloudflare") {
		t.Fatalf("stored auth should not use provider-specific token fields:\n%s", string(data))
	}
	if strings.Contains(string(data), "connector-token") {
		t.Fatalf("connector token should only be kept in process memory:\n%s", string(data))
	}
	info, err := os.Stat(authPath)
	if err != nil {
		t.Fatalf("stat token: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("token permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestRelayCallbackStoresCredentialFromQuery(t *testing.T) {
	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	handler := NewRelayCallbackHandler(RelayOptions{
		AuthPath:          authPath,
		HostID:            "host_local",
		RequestSigningKey: "configured-secret",
	})
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/relay/callback?relayToken=relay-token&hostId=host_local&workspaceSlug=alice&workspaceURL=https%3A%2F%2Falice.hopter.dev&relay_base_url=https%3A%2F%2Fapi.hopter.dev&expiresAt=2026-05-01T00%3A00%3A00Z",
		nil,
	)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	assertRelayCallbackRedirect(t, recorder, "https://alice.hopter.dev")
	stored, err := NewFileRelayAuthStore(authPath).Load()
	if err != nil {
		t.Fatalf("load auth: %v", err)
	}
	if stored.RelayToken != "relay-token" {
		t.Fatalf("stored relay token = %q, want relay-token", stored.RelayToken)
	}
	if stored.RequestSigningKey != "configured-secret" {
		t.Fatalf("stored request signing key = %q, want configured-secret", stored.RequestSigningKey)
	}
	if stored.RelayBaseURL != "https://api.hopter.dev" {
		t.Fatalf("stored relay base URL = %q", stored.RelayBaseURL)
	}
}

func TestRelayCallbackRejectsMissingCredential(t *testing.T) {
	handler := NewRelayCallbackHandler(RelayOptions{AuthPath: filepath.Join(t.TempDir(), "auth.json")})
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/relay/callback", nil))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
	}
}

func TestRelayCallbackAcceptsLegacyProviderTokenNameWithoutPersistingIt(t *testing.T) {
	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	handler := NewRelayCallbackHandler(RelayOptions{
		AuthPath: authPath,
		HostID:   "host_local",
	})
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/relay/callback?relayToken=relay-token&workspaceURL=https%3A%2F%2Falice.hopter.dev&cloudflareTunnelToken=legacy-token",
		nil,
	)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	assertRelayCallbackRedirect(t, recorder, "https://alice.hopter.dev")
	stored, err := NewFileRelayAuthStore(authPath).Load()
	if err != nil {
		t.Fatalf("load auth: %v", err)
	}
	if stored.SessionToken != "legacy-token" {
		t.Fatalf("stored session token = %q, want legacy-token", stored.SessionToken)
	}
	data, err := os.ReadFile(authPath)
	if err != nil {
		t.Fatalf("read auth: %v", err)
	}
	if strings.Contains(string(data), "cloudflare") {
		t.Fatalf("stored auth should not include legacy field:\n%s", string(data))
	}
	if strings.Contains(string(data), "legacy-token") {
		t.Fatalf("connector token should only be kept in process memory:\n%s", string(data))
	}
}

func assertRelayCallbackRedirect(t *testing.T, recorder *httptest.ResponseRecorder, workspaceURL string) {
	t.Helper()
	if recorder.Code != http.StatusSeeOther {
		t.Fatalf("status = %d, want %d: %s", recorder.Code, http.StatusSeeOther, recorder.Body.String())
	}
	location := recorder.Header().Get("Location")
	parsed, err := url.Parse(location)
	if err != nil {
		t.Fatalf("parse redirect location %q: %v", location, err)
	}
	if parsed.Path != "/relay/callback" {
		t.Fatalf("redirect path = %q, want /relay/callback", parsed.Path)
	}
	if parsed.Query().Get("status") != "connected" {
		t.Fatalf("redirect status = %q, want connected", parsed.Query().Get("status"))
	}
	if got := parsed.Query().Get("workspaceURL"); got != workspaceURL {
		t.Fatalf("redirect workspaceURL = %q, want %q", got, workspaceURL)
	}
}

func TestConfiguredRelayAuthStoreDefaultsToKeyring(t *testing.T) {
	store := NewConfiguredRelayAuthStore("", "")

	if _, ok := store.(KeyringRelayAuthStore); !ok {
		t.Fatalf("store type = %T, want KeyringRelayAuthStore", store)
	}
}

func TestRelayOptionsWithOnlyAuthPathUsesFileStoreCompatibility(t *testing.T) {
	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	store := (RelayOptions{AuthPath: authPath}).authStore()

	fileStore, ok := store.(FileRelayAuthStore)
	if !ok {
		t.Fatalf("store type = %T, want FileRelayAuthStore", store)
	}
	if fileStore.Path != authPath {
		t.Fatalf("file store path = %q, want %q", fileStore.Path, authPath)
	}
}

func TestFileRelayAuthStoreDoesNotCacheOnWriteFailure(t *testing.T) {
	path := t.TempDir()
	store := NewFileRelayAuthStore(path)

	err := store.Store(RelayCredential{
		RelayToken:   "relay-token",
		SessionToken: "connector-token",
		ExpiresAt:    time.Now().Add(time.Hour),
	})
	if err == nil {
		t.Fatal("expected store to fail when path is a directory")
	}
	if _, loadErr := store.Load(); loadErr == nil {
		t.Fatal("expected failed store not to populate process memory")
	}
}

func TestFileRelayAuthStoreResetClearsPersistedAndInMemoryCredential(t *testing.T) {
	authPath := filepath.Join(t.TempDir(), "relay", "auth.json")
	store := NewFileRelayAuthStore(authPath)

	if err := store.Store(RelayCredential{
		RelayToken:   "relay-token",
		SessionToken: "connector-token",
		ExpiresAt:    time.Now().Add(time.Hour),
	}); err != nil {
		t.Fatalf("store auth: %v", err)
	}
	if _, err := store.Load(); err != nil {
		t.Fatalf("load auth before reset: %v", err)
	}
	if err := store.Reset(); err != nil {
		t.Fatalf("reset auth: %v", err)
	}
	if _, err := os.Stat(authPath); !os.IsNotExist(err) {
		t.Fatalf("auth file still exists after reset: %v", err)
	}
	if _, err := store.Load(); err == nil {
		t.Fatal("expected reset to clear process memory credential")
	}
}

func readJSONFile(t *testing.T, path string, target any) {
	t.Helper()
	data, err := os.ReadFile(path)
	if err != nil {
		t.Fatalf("read %s: %v", path, err)
	}
	if err := json.Unmarshal(data, target); err != nil {
		t.Fatalf("decode %s: %v", path, err)
	}
}
