package serverhttp

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"os"
	"path/filepath"
	"strings"
	"time"
)

type RelayOptions struct {
	TokenPath    string
	ExchangeURL  string
	HostID       string
	BrokerSecret string
}

type RelayCredential struct {
	AuthUserID            string    `json:"auth_user_id"`
	HostID                string    `json:"host_id"`
	WorkspaceSlug         string    `json:"workspace_slug"`
	WorkspaceURL          string    `json:"workspace_url"`
	BrokerBaseURL         string    `json:"broker_base_url"`
	TunnelTarget          string    `json:"tunnel_target,omitempty"`
	RelayToken            string    `json:"relay_token"`
	BrokerSecret          string    `json:"broker_secret,omitempty"`
	CloudflareTunnelToken string    `json:"cloudflare_tunnel_token,omitempty"`
	ExpiresAt             time.Time `json:"expires_at"`
	UpdatedAt             time.Time `json:"updated_at"`
}

type relayExchangeResponse struct {
	OK                    bool            `json:"ok"`
	Reason                string          `json:"reason,omitempty"`
	Credential            RelayCredential `json:"credential,omitempty"`
	AuthUserID            string          `json:"authUserId,omitempty"`
	HostID                string          `json:"hostId,omitempty"`
	WorkspaceSlug         string          `json:"workspaceSlug,omitempty"`
	WorkspaceURL          string          `json:"workspaceURL,omitempty"`
	BrokerBaseURL         string          `json:"brokerBaseURL,omitempty"`
	TunnelTarget          string          `json:"tunnelTarget,omitempty"`
	RelayToken            string          `json:"relayToken,omitempty"`
	BrokerSecret          string          `json:"brokerSecret,omitempty"`
	CloudflareTunnelToken string          `json:"cloudflareTunnelToken,omitempty"`
	ExpiresAt             time.Time       `json:"expiresAt,omitempty"`
}

func NewRelayCallbackHandler(opts RelayOptions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if strings.TrimSpace(opts.TokenPath) == "" {
			http.Error(w, "relay token path is not configured", http.StatusServiceUnavailable)
			return
		}

		credential, err := relayCredentialFromCallback(r)
		if err != nil {
			code := strings.TrimSpace(r.URL.Query().Get("code"))
			if code == "" {
				http.Error(w, "relay callback requires code or relayToken", http.StatusBadRequest)
				return
			}

			credential, err = exchangeRelayCode(r.Context(), opts, code)
			if err != nil {
				http.Error(w, "relay exchange failed", http.StatusBadGateway)
				return
			}
		}
		credential = normalizeRelayCredential(opts, credential)
		credential.UpdatedAt = time.Now().UTC()

		if err := WriteRelayCredentialFile(opts.TokenPath, credential); err != nil {
			http.Error(w, "store relay token failed", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(relayCallbackHTML(opts.TokenPath, credential.WorkspaceURL)))
	})
}

func exchangeRelayCode(ctx context.Context, opts RelayOptions, code string) (RelayCredential, error) {
	exchangeURL := strings.TrimSpace(opts.ExchangeURL)
	if exchangeURL == "" {
		return RelayCredential{}, fmt.Errorf("relay exchange URL is not configured")
	}
	body, err := json.Marshal(map[string]string{
		"code":   code,
		"hostId": opts.HostID,
	})
	if err != nil {
		return RelayCredential{}, err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, exchangeURL, bytes.NewReader(body))
	if err != nil {
		return RelayCredential{}, err
	}
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return RelayCredential{}, err
	}
	defer response.Body.Close()

	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return RelayCredential{}, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return RelayCredential{}, fmt.Errorf("relay exchange returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}

	var decoded relayExchangeResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return RelayCredential{}, err
	}
	if decoded.Credential.RelayToken != "" {
		return normalizeRelayCredential(opts, decoded.Credential), nil
	}
	if decoded.RelayToken != "" {
		return normalizeRelayCredential(opts, RelayCredential{
			AuthUserID:            decoded.AuthUserID,
			HostID:                decoded.HostID,
			WorkspaceSlug:         decoded.WorkspaceSlug,
			WorkspaceURL:          decoded.WorkspaceURL,
			BrokerBaseURL:         decoded.BrokerBaseURL,
			TunnelTarget:          decoded.TunnelTarget,
			RelayToken:            decoded.RelayToken,
			BrokerSecret:          decoded.BrokerSecret,
			CloudflareTunnelToken: decoded.CloudflareTunnelToken,
			ExpiresAt:             decoded.ExpiresAt,
		}), nil
	}
	if !decoded.OK {
		return RelayCredential{}, fmt.Errorf("relay exchange rejected code: %s", decoded.Reason)
	}

	return RelayCredential{}, fmt.Errorf("relay exchange response missing relay token")
}

func relayCredentialFromCallback(r *http.Request) (RelayCredential, error) {
	query := r.URL.Query()
	relayToken := strings.TrimSpace(firstNonEmpty(query.Get("relayToken"), query.Get("relay_token"), query.Get("token")))
	if relayToken == "" {
		return RelayCredential{}, fmt.Errorf("relay callback missing relay token")
	}

	expiresAt, err := parseOptionalTime(query.Get("expiresAt"), query.Get("expires_at"))
	if err != nil {
		return RelayCredential{}, err
	}

	return RelayCredential{
		AuthUserID:            strings.TrimSpace(firstNonEmpty(query.Get("authUserId"), query.Get("auth_user_id"))),
		HostID:                strings.TrimSpace(firstNonEmpty(query.Get("hostId"), query.Get("host_id"))),
		WorkspaceSlug:         strings.TrimSpace(firstNonEmpty(query.Get("workspaceSlug"), query.Get("workspace_slug"))),
		WorkspaceURL:          strings.TrimSpace(firstNonEmpty(query.Get("workspaceURL"), query.Get("workspace_url"))),
		BrokerBaseURL:         strings.TrimSpace(firstNonEmpty(query.Get("brokerBaseURL"), query.Get("broker_base_url"))),
		TunnelTarget:          strings.TrimSpace(firstNonEmpty(query.Get("tunnelTarget"), query.Get("tunnel_target"))),
		RelayToken:            relayToken,
		BrokerSecret:          strings.TrimSpace(firstNonEmpty(query.Get("brokerSecret"), query.Get("broker_secret"))),
		CloudflareTunnelToken: strings.TrimSpace(firstNonEmpty(query.Get("cloudflareTunnelToken"), query.Get("cloudflare_tunnel_token"))),
		ExpiresAt:             expiresAt,
	}, nil
}

func normalizeRelayCredential(opts RelayOptions, credential RelayCredential) RelayCredential {
	if credential.HostID == "" {
		credential.HostID = opts.HostID
	}
	if credential.BrokerSecret == "" {
		credential.BrokerSecret = opts.BrokerSecret
	}
	if credential.BrokerBaseURL == "" {
		credential.BrokerBaseURL = credential.WorkspaceURL
	}
	return credential
}

func parseOptionalTime(values ...string) (time.Time, error) {
	for _, value := range values {
		trimmed := strings.TrimSpace(value)
		if trimmed == "" {
			continue
		}
		parsed, err := time.Parse(time.RFC3339, trimmed)
		if err != nil {
			return time.Time{}, err
		}
		return parsed, nil
	}
	return time.Time{}, nil
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}

func WriteRelayCredentialFile(path string, payload RelayCredential) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	data, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return err
	}
	data = append(data, '\n')

	return os.WriteFile(path, data, 0o600)
}

func ReadRelayCredentialFile(path string) (RelayCredential, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return RelayCredential{}, err
	}
	var credential RelayCredential
	if err := json.Unmarshal(data, &credential); err != nil {
		return RelayCredential{}, err
	}
	if strings.TrimSpace(credential.RelayToken) == "" {
		return RelayCredential{}, fmt.Errorf("relay credential missing relay token")
	}
	if !credential.ExpiresAt.IsZero() && time.Now().After(credential.ExpiresAt) {
		return RelayCredential{}, fmt.Errorf("relay credential expired")
	}
	return credential, nil
}

func relayCallbackHTML(tokenPath string, workspaceURL string) string {
	return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Hopter relay connected</title>
  <style>
    body{margin:0;min-height:100vh;display:grid;place-items:center;background:#080b11;color:#f4f7fb;font:16px/1.5 system-ui,sans-serif}
    main{width:min(560px,calc(100vw - 32px));padding:28px;border:1px solid rgba(255,255,255,.14);border-radius:16px;background:rgba(255,255,255,.06)}
    p{color:#aab6c7} code{color:#ddecff}
  </style>
</head>
<body>
  <main>
    <h1>Relay login received</h1>
    <p>Hopter stored the local relay credential. Return to the terminal and run <code>hopter --relay</code> again to establish the tunnel.</p>
    <p>Workspace: <code>` + html.EscapeString(workspaceURL) + `</code></p>
    <p>Credential path: <code>` + html.EscapeString(tokenPath) + `</code></p>
  </main>
</body>
</html>`
}
