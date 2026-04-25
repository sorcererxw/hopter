package serverhttp

import (
	"bytes"
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"html"
	"io"
	"net/http"
	"net/url"
	"os"
	"path/filepath"
	"strings"
	"sync"
	"time"

	"github.com/zalando/go-keyring"
)

type RelayOptions struct {
	AuthPath          string
	AuthStoreName     string
	AuthStore         RelayAuthStore
	TokenPath         string
	ExchangeURL       string
	OAuthAuthorizeURL string
	OAuthTokenURL     string
	OAuthClientID     string
	OAuthAudience     string
	HostID            string
	BrokerSecret      string
}

type RelayCredential struct {
	AuthUserID                string    `json:"auth_user_id"`
	HostID                    string    `json:"host_id"`
	WorkspaceSlug             string    `json:"workspace_slug"`
	WorkspaceURL              string    `json:"workspace_url"`
	BrokerBaseURL             string    `json:"broker_base_url"`
	TunnelTarget              string    `json:"tunnel_target,omitempty"`
	PrivateHostname           string    `json:"private_hostname,omitempty"`
	RelayLeaseID              string    `json:"relay_lease_id,omitempty"`
	RelayLeaseVersion         int       `json:"relay_lease_version,omitempty"`
	RelayToken                string    `json:"relay_token,omitempty"`
	BrokerSecret              string    `json:"broker_secret,omitempty"`
	ConnectorProvider         string    `json:"connector_provider,omitempty"`
	ConnectorToken            string    `json:"connector_token,omitempty"`
	OAuthAccessToken          string    `json:"oauth_access_token,omitempty"`
	OAuthRefreshToken         string    `json:"oauth_refresh_token,omitempty"`
	OAuthTokenType            string    `json:"oauth_token_type,omitempty"`
	OAuthScope                string    `json:"oauth_scope,omitempty"`
	OAuthAccessTokenExpiresAt time.Time `json:"oauth_access_token_expires_at,omitempty"`
	ExpiresAt                 time.Time `json:"expires_at,omitempty"`
	UpdatedAt                 time.Time `json:"updated_at"`
}

type relayExchangeResponse struct {
	OK                    bool             `json:"ok"`
	Reason                string           `json:"reason,omitempty"`
	Credential            relayAuthPayload `json:"credential,omitempty"`
	AuthUserID            string           `json:"authUserId,omitempty"`
	HostID                string           `json:"hostId,omitempty"`
	WorkspaceSlug         string           `json:"workspaceSlug,omitempty"`
	WorkspaceURL          string           `json:"workspaceURL,omitempty"`
	BrokerBaseURL         string           `json:"brokerBaseURL,omitempty"`
	TunnelTarget          string           `json:"tunnelTarget,omitempty"`
	RelayToken            string           `json:"relayToken,omitempty"`
	BrokerSecret          string           `json:"brokerSecret,omitempty"`
	ConnectorProvider     string           `json:"connectorProvider,omitempty"`
	ConnectorToken        string           `json:"connectorToken,omitempty"`
	CloudflareTunnelToken string           `json:"cloudflareTunnelToken,omitempty"`
	ExpiresAt             time.Time        `json:"expiresAt,omitempty"`
}

type relayOAuthLogin struct {
	State        string
	CodeVerifier string
	RedirectURI  string
	TokenURL     string
	ClientID     string
	Audience     string
	Scope        string
	CreatedAt    time.Time
}

type relayOAuthTokenResponse struct {
	AccessToken  string `json:"access_token"`
	RefreshToken string `json:"refresh_token"`
	TokenType    string `json:"token_type"`
	Scope        string `json:"scope"`
	ExpiresIn    int    `json:"expires_in"`
	ExpiresAt    int64  `json:"expires_at"`
	IDToken      string `json:"id_token"`
}

type relayAuthPayload struct {
	RelayCredential
	CloudflareTunnelToken string `json:"cloudflare_tunnel_token,omitempty"`
}

func (p relayAuthPayload) credential() RelayCredential {
	credential := p.RelayCredential
	if credential.ConnectorToken == "" {
		credential.ConnectorToken = p.CloudflareTunnelToken
	}
	return credential
}

func NewRelayCallbackHandler(opts RelayOptions) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		store := opts.authStore()
		if store == nil {
			http.Error(w, "relay auth store is not configured", http.StatusServiceUnavailable)
			return
		}

		credential, err := relayCredentialFromCallback(r)
		if err != nil {
			code := strings.TrimSpace(r.URL.Query().Get("code"))
			if code == "" {
				http.Error(w, "relay callback requires code or relayToken", http.StatusBadRequest)
				return
			}

			state := strings.TrimSpace(r.URL.Query().Get("state"))
			if state != "" {
				credential, err = exchangeRelayOAuthCode(r.Context(), opts, state, code)
			} else {
				credential, err = exchangeRelayCode(r.Context(), opts, code)
			}
			if err != nil {
				http.Error(w, "relay exchange failed", http.StatusBadGateway)
				return
			}
		}
		credential = normalizeRelayCredential(opts, credential)
		credential.UpdatedAt = time.Now().UTC()

		if err := store.Store(credential); err != nil {
			http.Error(w, "store relay auth failed", http.StatusInternalServerError)
			return
		}

		w.Header().Set("Content-Type", "text/html; charset=utf-8")
		w.WriteHeader(http.StatusOK)
		_, _ = w.Write([]byte(relayCallbackHTML(store.Description(), credential.WorkspaceURL)))
	})
}

func BeginRelayOAuthLogin(callbackURL string, opts RelayOptions) (string, error) {
	target, err := urlWithFallback(firstNonEmpty(opts.OAuthAuthorizeURL, "https://auth.hopter.dev/api/auth/oauth2/authorize"))
	if err != nil {
		return "", err
	}
	state, err := randomBase64URL(32)
	if err != nil {
		return "", err
	}
	verifier, err := randomBase64URL(48)
	if err != nil {
		return "", err
	}
	scope := "openid offline_access"
	clientID := firstNonEmpty(opts.OAuthClientID, "hopter-cli")
	audience := firstNonEmpty(opts.OAuthAudience, "hopter")

	relayOAuthLogins.Store(state, relayOAuthLogin{
		State:        state,
		CodeVerifier: verifier,
		RedirectURI:  callbackURL,
		TokenURL:     firstNonEmpty(opts.OAuthTokenURL, "https://auth.hopter.dev/api/auth/oauth2/token"),
		ClientID:     clientID,
		Audience:     audience,
		Scope:        scope,
		CreatedAt:    time.Now().UTC(),
	})

	query := target.Query()
	query.Set("response_type", "code")
	query.Set("client_id", clientID)
	query.Set("redirect_uri", callbackURL)
	query.Set("scope", scope)
	query.Set("state", state)
	query.Set("code_challenge", pkceS256(verifier))
	query.Set("code_challenge_method", "S256")
	query.Set("resource", audience)
	target.RawQuery = query.Encode()

	return target.String(), nil
}

func exchangeRelayOAuthCode(ctx context.Context, opts RelayOptions, state string, code string) (RelayCredential, error) {
	login, err := takeRelayOAuthLogin(state)
	if err != nil {
		return RelayCredential{}, err
	}
	form := url.Values{}
	form.Set("grant_type", "authorization_code")
	form.Set("client_id", firstNonEmpty(login.ClientID, opts.OAuthClientID, "hopter-cli"))
	form.Set("code", code)
	form.Set("redirect_uri", login.RedirectURI)
	form.Set("code_verifier", login.CodeVerifier)
	form.Set("resource", firstNonEmpty(login.Audience, opts.OAuthAudience, "hopter"))

	token, err := requestRelayOAuthToken(ctx, firstNonEmpty(login.TokenURL, opts.OAuthTokenURL), form)
	if err != nil {
		return RelayCredential{}, err
	}

	return RelayCredential{
		HostID:                    opts.HostID,
		BrokerSecret:              opts.BrokerSecret,
		OAuthAccessToken:          token.AccessToken,
		OAuthRefreshToken:         token.RefreshToken,
		OAuthTokenType:            firstNonEmpty(token.TokenType, "Bearer"),
		OAuthScope:                token.Scope,
		OAuthAccessTokenExpiresAt: relayOAuthExpiry(token),
	}, nil
}

func RefreshRelayOAuthToken(ctx context.Context, opts RelayOptions, credential RelayCredential) (RelayCredential, error) {
	refreshToken := strings.TrimSpace(credential.OAuthRefreshToken)
	if refreshToken == "" {
		return RelayCredential{}, fmt.Errorf("relay auth missing refresh token")
	}
	form := url.Values{}
	form.Set("grant_type", "refresh_token")
	form.Set("client_id", firstNonEmpty(opts.OAuthClientID, "hopter-cli"))
	form.Set("refresh_token", refreshToken)
	form.Set("scope", "openid offline_access")
	form.Set("resource", firstNonEmpty(opts.OAuthAudience, "hopter"))

	token, err := requestRelayOAuthToken(ctx, opts.OAuthTokenURL, form)
	if err != nil {
		return RelayCredential{}, err
	}

	updated := credential
	updated.OAuthAccessToken = token.AccessToken
	if strings.TrimSpace(token.RefreshToken) != "" {
		updated.OAuthRefreshToken = token.RefreshToken
	}
	updated.OAuthTokenType = firstNonEmpty(token.TokenType, "Bearer")
	updated.OAuthScope = token.Scope
	updated.OAuthAccessTokenExpiresAt = relayOAuthExpiry(token)
	updated.UpdatedAt = time.Now().UTC()
	return updated, nil
}

func RelayOAuthTokenNeedsRefresh(credential RelayCredential, now time.Time) bool {
	if strings.TrimSpace(credential.OAuthAccessToken) == "" {
		return true
	}
	if credential.OAuthAccessTokenExpiresAt.IsZero() {
		return false
	}
	return !now.Add(5 * time.Minute).Before(credential.OAuthAccessTokenExpiresAt)
}

func requestRelayOAuthToken(ctx context.Context, tokenURL string, form url.Values) (relayOAuthTokenResponse, error) {
	target := strings.TrimSpace(firstNonEmpty(tokenURL, "https://auth.hopter.dev/api/auth/oauth2/token"))
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, target, strings.NewReader(form.Encode()))
	if err != nil {
		return relayOAuthTokenResponse{}, err
	}
	request.Header.Set("Content-Type", "application/x-www-form-urlencoded")
	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return relayOAuthTokenResponse{}, err
	}
	defer response.Body.Close()

	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return relayOAuthTokenResponse{}, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return relayOAuthTokenResponse{}, fmt.Errorf("oauth token endpoint returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	var decoded relayOAuthTokenResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return relayOAuthTokenResponse{}, err
	}
	if strings.TrimSpace(decoded.AccessToken) == "" {
		return relayOAuthTokenResponse{}, fmt.Errorf("oauth token response missing access token")
	}
	return decoded, nil
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
		return normalizeRelayCredential(opts, decoded.Credential.credential()), nil
	}
	if decoded.RelayToken != "" {
		return normalizeRelayCredential(opts, RelayCredential{
			AuthUserID:        decoded.AuthUserID,
			HostID:            decoded.HostID,
			WorkspaceSlug:     decoded.WorkspaceSlug,
			WorkspaceURL:      decoded.WorkspaceURL,
			BrokerBaseURL:     decoded.BrokerBaseURL,
			TunnelTarget:      decoded.TunnelTarget,
			RelayToken:        decoded.RelayToken,
			BrokerSecret:      decoded.BrokerSecret,
			ConnectorProvider: decoded.ConnectorProvider,
			ConnectorToken:    firstNonEmpty(decoded.ConnectorToken, decoded.CloudflareTunnelToken),
			ExpiresAt:         decoded.ExpiresAt,
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
		AuthUserID:        strings.TrimSpace(firstNonEmpty(query.Get("authUserId"), query.Get("auth_user_id"))),
		HostID:            strings.TrimSpace(firstNonEmpty(query.Get("hostId"), query.Get("host_id"))),
		WorkspaceSlug:     strings.TrimSpace(firstNonEmpty(query.Get("workspaceSlug"), query.Get("workspace_slug"))),
		WorkspaceURL:      strings.TrimSpace(firstNonEmpty(query.Get("workspaceURL"), query.Get("workspace_url"))),
		BrokerBaseURL:     strings.TrimSpace(firstNonEmpty(query.Get("brokerBaseURL"), query.Get("broker_base_url"))),
		TunnelTarget:      strings.TrimSpace(firstNonEmpty(query.Get("tunnelTarget"), query.Get("tunnel_target"))),
		RelayToken:        relayToken,
		BrokerSecret:      strings.TrimSpace(firstNonEmpty(query.Get("brokerSecret"), query.Get("broker_secret"))),
		ConnectorProvider: strings.TrimSpace(firstNonEmpty(query.Get("connectorProvider"), query.Get("connector_provider"))),
		ConnectorToken:    strings.TrimSpace(firstNonEmpty(query.Get("connectorToken"), query.Get("connector_token"), query.Get("cloudflareTunnelToken"), query.Get("cloudflare_tunnel_token"))),
		ExpiresAt:         expiresAt,
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
	if credential.ConnectorToken != "" && credential.ConnectorProvider == "" {
		credential.ConnectorProvider = "managed"
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

type RelayAuthStore interface {
	Load() (RelayCredential, error)
	Store(RelayCredential) error
	Reset() error
	Exists() bool
	Description() string
}

type FileRelayAuthStore struct {
	Path string
}

type KeyringRelayAuthStore struct {
	Service string
	Account string
}

var relayAuthMemory sync.Map
var relayOAuthLogins sync.Map

func NewFileRelayAuthStore(path string) FileRelayAuthStore {
	return FileRelayAuthStore{Path: path}
}

func NewKeyringRelayAuthStore(account string) KeyringRelayAuthStore {
	return KeyringRelayAuthStore{
		Service: "hopter relay",
		Account: firstNonEmpty(strings.TrimSpace(account), "default"),
	}
}

func NewConfiguredRelayAuthStore(kind string, path string) RelayAuthStore {
	switch strings.ToLower(strings.TrimSpace(kind)) {
	case "", "keyring", "system":
		return NewKeyringRelayAuthStore("default")
	case "file":
		return NewFileRelayAuthStore(path)
	default:
		return NewKeyringRelayAuthStore("default")
	}
}

func (opts RelayOptions) authStore() RelayAuthStore {
	if opts.AuthStore != nil {
		return opts.AuthStore
	}
	path := strings.TrimSpace(firstNonEmpty(opts.AuthPath, opts.TokenPath))
	if strings.TrimSpace(opts.AuthStoreName) == "" && path != "" {
		return NewFileRelayAuthStore(path)
	}
	return NewConfiguredRelayAuthStore(opts.AuthStoreName, path)
}

func (s FileRelayAuthStore) Load() (RelayCredential, error) {
	if value, ok := relayAuthMemory.Load(s.Path); ok {
		credential, _ := value.(RelayCredential)
		if relayAuthUsable(credential, time.Now()) {
			return credential, nil
		}
		relayAuthMemory.Delete(s.Path)
	}
	return ReadRelayAuthFile(s.Path)
}

func (s FileRelayAuthStore) Store(payload RelayCredential) error {
	return WriteRelayAuthFile(s.Path, payload)
}

func (s FileRelayAuthStore) Reset() error {
	if strings.TrimSpace(s.Path) == "" {
		return nil
	}
	relayAuthMemory.Delete(s.Path)
	if err := os.Remove(s.Path); err != nil && !os.IsNotExist(err) {
		return err
	}
	return nil
}

func (s FileRelayAuthStore) Exists() bool {
	if _, ok := relayAuthMemory.Load(s.Path); ok {
		return true
	}
	return relayAuthFileExists(s.Path)
}

func (s FileRelayAuthStore) Description() string {
	return s.Path
}

func (s KeyringRelayAuthStore) Load() (RelayCredential, error) {
	key := s.memoryKey()
	if value, ok := relayAuthMemory.Load(key); ok {
		credential, _ := value.(RelayCredential)
		if relayAuthUsable(credential, time.Now()) {
			return credential, nil
		}
		relayAuthMemory.Delete(key)
	}

	data, err := keyring.Get(s.serviceName(), s.accountName())
	if err != nil {
		return RelayCredential{}, err
	}
	return decodeRelayAuth([]byte(data))
}

func (s KeyringRelayAuthStore) Store(payload RelayCredential) error {
	key := s.memoryKey()
	data, err := marshalPersistedRelayAuth(payload)
	if err != nil {
		return err
	}
	if err := keyring.Set(s.serviceName(), s.accountName(), string(data)); err != nil {
		return err
	}
	relayAuthMemory.Store(key, payload)
	return nil
}

func (s KeyringRelayAuthStore) Reset() error {
	relayAuthMemory.Delete(s.memoryKey())
	if err := keyring.Delete(s.serviceName(), s.accountName()); err != nil && err != keyring.ErrNotFound {
		return err
	}
	return nil
}

func (s KeyringRelayAuthStore) Exists() bool {
	if _, ok := relayAuthMemory.Load(s.memoryKey()); ok {
		return true
	}
	_, err := keyring.Get(s.serviceName(), s.accountName())
	return err == nil
}

func (s KeyringRelayAuthStore) Description() string {
	return "system credential store"
}

func (s KeyringRelayAuthStore) serviceName() string {
	return firstNonEmpty(strings.TrimSpace(s.Service), "hopter relay")
}

func (s KeyringRelayAuthStore) accountName() string {
	return firstNonEmpty(strings.TrimSpace(s.Account), "default")
}

func (s KeyringRelayAuthStore) memoryKey() string {
	return "keyring:" + s.serviceName() + ":" + s.accountName()
}

func WriteRelayAuthFile(path string, payload RelayCredential) error {
	if err := os.MkdirAll(filepath.Dir(path), 0o700); err != nil {
		return err
	}

	data, err := marshalPersistedRelayAuth(payload)
	if err != nil {
		return err
	}

	if err := os.WriteFile(path, data, 0o600); err != nil {
		return err
	}
	relayAuthMemory.Store(path, payload)
	return nil
}

func ReadRelayAuthFile(path string) (RelayCredential, error) {
	data, err := os.ReadFile(path)
	if err != nil {
		return RelayCredential{}, err
	}
	return decodeRelayAuth(data)
}

func decodeRelayAuth(data []byte) (RelayCredential, error) {
	var persisted relayAuthPayload
	if err := json.Unmarshal(data, &persisted); err != nil {
		return RelayCredential{}, err
	}
	credential := persisted.credential()
	if !relayAuthUsable(credential, time.Now()) {
		return RelayCredential{}, fmt.Errorf("relay auth missing usable token")
	}
	return credential, nil
}

func marshalPersistedRelayAuth(payload RelayCredential) ([]byte, error) {
	persisted := payload
	persisted.ConnectorToken = ""
	persisted.ConnectorProvider = ""
	data, err := json.MarshalIndent(persisted, "", "  ")
	if err != nil {
		return nil, err
	}
	return append(data, '\n'), nil
}

func WriteRelayCredentialFile(path string, payload RelayCredential) error {
	return WriteRelayAuthFile(path, payload)
}

func ReadRelayCredentialFile(path string) (RelayCredential, error) {
	return ReadRelayAuthFile(path)
}

func relayAuthFileExists(path string) bool {
	if strings.TrimSpace(path) == "" {
		return false
	}
	info, err := os.Stat(path)
	return err == nil && !info.IsDir() && info.Size() > 0
}

func relayAuthUsable(credential RelayCredential, now time.Time) bool {
	hasCredential := strings.TrimSpace(credential.RelayToken) != "" ||
		strings.TrimSpace(credential.ConnectorToken) != "" ||
		strings.TrimSpace(credential.OAuthAccessToken) != "" ||
		strings.TrimSpace(credential.OAuthRefreshToken) != ""
	if !hasCredential {
		return false
	}
	if strings.TrimSpace(credential.RelayToken) != "" && !credential.ExpiresAt.IsZero() && !now.Before(credential.ExpiresAt) {
		return false
	}
	return true
}

func relayOAuthExpiry(token relayOAuthTokenResponse) time.Time {
	if token.ExpiresAt > 0 {
		if token.ExpiresAt > 1_000_000_000_000 {
			return time.UnixMilli(token.ExpiresAt).UTC()
		}
		return time.Unix(token.ExpiresAt, 0).UTC()
	}
	if token.ExpiresIn > 0 {
		return time.Now().UTC().Add(time.Duration(token.ExpiresIn) * time.Second)
	}
	return time.Time{}
}

func takeRelayOAuthLogin(state string) (relayOAuthLogin, error) {
	value, ok := relayOAuthLogins.LoadAndDelete(state)
	if !ok {
		return relayOAuthLogin{}, fmt.Errorf("oauth state not found")
	}
	login, ok := value.(relayOAuthLogin)
	if !ok {
		return relayOAuthLogin{}, fmt.Errorf("oauth state invalid")
	}
	if time.Since(login.CreatedAt) > 10*time.Minute {
		return relayOAuthLogin{}, fmt.Errorf("oauth state expired")
	}
	return login, nil
}

func randomBase64URL(size int) (string, error) {
	value := make([]byte, size)
	if _, err := rand.Read(value); err != nil {
		return "", err
	}
	return base64.RawURLEncoding.EncodeToString(value), nil
}

func pkceS256(verifier string) string {
	sum := sha256.Sum256([]byte(verifier))
	return base64.RawURLEncoding.EncodeToString(sum[:])
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

func relayCallbackHTML(authDescription string, workspaceURL string) string {
	if strings.TrimSpace(workspaceURL) == "" {
		workspaceURL = "pending allocation"
	}
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
    <p>Hopter stored the local relay authorization. Return to the terminal; the relay will continue automatically.</p>
    <p>Workspace: <code>` + html.EscapeString(workspaceURL) + `</code></p>
    <p>Auth store: <code>` + html.EscapeString(authDescription) + `</code></p>
  </main>
</body>
</html>`
}
