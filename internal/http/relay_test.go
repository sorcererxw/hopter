package serverhttp

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"os"
	"path/filepath"
	"strings"
	"testing"
)

func TestRelayCallbackExchangesCodeAndStoresCredential(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "relay", "token")
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
			"tunnelTarget": "https://host_local.hosts.hopter.run",
			"relayToken": "relay-token",
			"brokerSecret": "broker-secret",
			"cloudflareTunnelToken": "cf-token",
			"expiresAt": "2026-05-01T00:00:00Z"
		}`))
	}))
	t.Cleanup(exchangeServer.Close)
	handler := NewRelayCallbackHandler(RelayOptions{
		TokenPath:   tokenPath,
		ExchangeURL: exchangeServer.URL,
		HostID:      "host_local",
	})
	request := httptest.NewRequest(http.MethodGet, "/api/relay/callback?code=abc123", nil)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	if !strings.Contains(recorder.Body.String(), "Relay login received") {
		t.Fatalf("response did not include success page:\n%s", recorder.Body.String())
	}

	var stored RelayCredential
	readJSONFile(t, tokenPath, &stored)
	if stored.RelayToken != "relay-token" {
		t.Fatalf("stored relay token = %q, want relay-token", stored.RelayToken)
	}
	if stored.TunnelTarget != "https://host_local.hosts.hopter.run" {
		t.Fatalf("stored tunnel target = %q", stored.TunnelTarget)
	}
	if stored.UpdatedAt.IsZero() {
		t.Fatal("stored token missing UpdatedAt")
	}
	info, err := os.Stat(tokenPath)
	if err != nil {
		t.Fatalf("stat token: %v", err)
	}
	if info.Mode().Perm() != 0o600 {
		t.Fatalf("token permissions = %o, want 600", info.Mode().Perm())
	}
}

func TestRelayCallbackStoresCredentialFromQuery(t *testing.T) {
	tokenPath := filepath.Join(t.TempDir(), "relay", "token")
	handler := NewRelayCallbackHandler(RelayOptions{
		TokenPath:    tokenPath,
		HostID:       "host_local",
		BrokerSecret: "configured-secret",
	})
	request := httptest.NewRequest(
		http.MethodGet,
		"/api/relay/callback?relayToken=relay-token&hostId=host_local&workspaceSlug=alice&workspaceURL=https%3A%2F%2Falice.hopter.dev&expiresAt=2026-05-01T00%3A00%3A00Z",
		nil,
	)
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, request)

	if recorder.Code != http.StatusOK {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusOK)
	}
	var stored RelayCredential
	readJSONFile(t, tokenPath, &stored)
	if stored.RelayToken != "relay-token" {
		t.Fatalf("stored relay token = %q, want relay-token", stored.RelayToken)
	}
	if stored.BrokerSecret != "configured-secret" {
		t.Fatalf("stored broker secret = %q, want configured-secret", stored.BrokerSecret)
	}
}

func TestRelayCallbackRejectsMissingCredential(t *testing.T) {
	handler := NewRelayCallbackHandler(RelayOptions{TokenPath: filepath.Join(t.TempDir(), "token")})
	recorder := httptest.NewRecorder()

	handler.ServeHTTP(recorder, httptest.NewRequest(http.MethodGet, "/api/relay/callback", nil))

	if recorder.Code != http.StatusBadRequest {
		t.Fatalf("status = %d, want %d", recorder.Code, http.StatusBadRequest)
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
