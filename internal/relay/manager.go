package relay

import (
	"bytes"
	"context"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net/http"
	"net/url"
	"strings"
	"sync"
	"time"

	"github.com/gorilla/websocket"

	"github.com/sorcererxw/hopter/internal/app"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
	"github.com/sorcererxw/hopter/internal/relaycontract"
)

type SessionManager struct {
	cfg          app.Config
	store        serverhttp.RelayAuthStore
	verifier     *serverhttp.RelayRequestVerifier
	localBaseURL string

	readyOnce sync.Once
	readyCh   chan struct{}
}

type relayAllocationResponse struct {
	AuthUserID             string   `json:"authUserId"`
	LeaseID                string   `json:"leaseId"`
	LeaseVersion           int      `json:"leaseVersion"`
	WorkspaceSlug          string   `json:"workspaceSlug"`
	WorkspaceURL           string   `json:"workspaceURL"`
	BrokerBaseURL          string   `json:"brokerBaseURL"`
	RelayBaseURL           string   `json:"relayBaseURL"`
	RelayBaseURLSnake      string   `json:"relay_base_url"`
	APIRelayBaseURL        string   `json:"apiRelayBaseURL"`
	APIRelayBaseURLSnake   string   `json:"api_relay_base_url"`
	SessionStartPath       string   `json:"sessionStartPath"`
	SessionRefreshPath     string   `json:"sessionRefreshPath"`
	ConnectorWebSocketPath string   `json:"connectorWebSocketPath"`
	State                  string   `json:"state"`
	ProtocolVersion        int      `json:"protocolVersion"`
	Capabilities           []string `json:"capabilities"`
}

type relaySessionResponse struct {
	SessionToken      string `json:"sessionToken"`
	RequestSigningKey string `json:"requestSigningKey"`
	RouteGeneration   int    `json:"routeGeneration"`
	SessionID         string `json:"sessionId"`
	ExpiresAt         int64  `json:"expiresAt"`
}

type relayEnvelope struct {
	Type string `json:"type"`
}

type activeControlConnection struct {
	ctx           context.Context
	cancel        context.CancelFunc
	conn          *websocket.Conn
	localBaseURL  string
	sendMu        sync.Mutex
	httpBodiesMu  sync.Mutex
	httpBodies    map[string]*io.PipeWriter
	socketMu      sync.Mutex
	socketStreams map[string]*websocket.Conn
	httpClient    *http.Client
}

func NewSessionManager(cfg app.Config, store serverhttp.RelayAuthStore, verifier *serverhttp.RelayRequestVerifier) *SessionManager {
	return &SessionManager{
		cfg:          cfg,
		store:        store,
		verifier:     verifier,
		localBaseURL: localOriginBaseURL(cfg.HTTP),
		readyCh:      make(chan struct{}),
	}
}

func (m *SessionManager) Ready() <-chan struct{} {
	return m.readyCh
}

func (m *SessionManager) Run(ctx context.Context, credential serverhttp.RelayCredential) error {
	current := credential
	backoff := time.Second

	defer m.verifier.Clear()
	defer func() {
		releaseCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := m.releaseLease(releaseCtx, current); err != nil && !errors.Is(err, context.Canceled) {
			slog.Warn("relay release failed", "error", err)
		}
	}()

	for {
		if ctx.Err() != nil {
			return ctx.Err()
		}

		updated, err := m.ensureOAuthAccessToken(ctx, current)
		if err != nil {
			slog.Warn("relay oauth refresh failed", "error", err)
			if err := sleepBackoff(ctx, backoff); err != nil {
				return err
			}
			backoff = nextBackoff(backoff)
			continue
		}
		current = updated

		updated, err = m.ensureAllocatedLease(ctx, current)
		if err != nil {
			slog.Warn("relay lease allocation failed", "error", err)
			if err := sleepBackoff(ctx, backoff); err != nil {
				return err
			}
			backoff = nextBackoff(backoff)
			continue
		}
		current = updated

		session, err := m.startSession(ctx, current)
		if err != nil {
			slog.Warn("relay session start failed", "error", err)
			current = clearLeaseIfStale(current, err)
			if err := sleepBackoff(ctx, backoff); err != nil {
				return err
			}
			backoff = nextBackoff(backoff)
			continue
		}

		current.SessionToken = session.SessionToken
		current.RequestSigningKey = session.RequestSigningKey
		current.RelayRouteGeneration = session.RouteGeneration
		current.RelaySessionID = session.SessionID
		current.UpdatedAt = time.Now().UTC()
		if err := m.store.Store(current); err != nil {
			slog.Warn("relay auth store update failed", "error", err)
		}
		m.verifier.Update(serverhttp.RelayVerificationSession{
			AuthUserID:        current.AuthUserID,
			WorkspaceSlug:     current.WorkspaceSlug,
			LeaseID:           current.RelayLeaseID,
			LeaseVersion:      current.RelayLeaseVersion,
			RouteGeneration:   current.RelayRouteGeneration,
			RequestSigningKey: current.RequestSigningKey,
		})

		if err := m.serveControlConnection(ctx, &current); err != nil {
			slog.Warn("relay control connection ended", "error", err)
			if ctx.Err() != nil {
				return ctx.Err()
			}
			if err := sleepBackoff(ctx, backoff); err != nil {
				return err
			}
			backoff = nextBackoff(backoff)
			continue
		}

		backoff = time.Second
	}
}

func (m *SessionManager) ensureOAuthAccessToken(ctx context.Context, credential serverhttp.RelayCredential) (serverhttp.RelayCredential, error) {
	if !serverhttp.RelayOAuthTokenNeedsRefresh(credential, time.Now()) {
		return credential, nil
	}
	refreshed, err := serverhttp.RefreshRelayOAuthToken(ctx, relayHTTPOptions(m.cfg), credential)
	if err != nil {
		return credential, err
	}
	if err := m.store.Store(refreshed); err != nil {
		return refreshed, err
	}
	return refreshed, nil
}

func (m *SessionManager) ensureAllocatedLease(ctx context.Context, credential serverhttp.RelayCredential) (serverhttp.RelayCredential, error) {
	if strings.TrimSpace(credential.RelayLeaseID) != "" && credential.RelayLeaseVersion > 0 {
		updated := backfillRelayAuthUserID(credential)
		if updated.AuthUserID != credential.AuthUserID {
			if err := m.store.Store(updated); err != nil {
				return updated, err
			}
		}
		return updated, nil
	}

	body, err := json.Marshal(map[string]string{
		"workspaceSlug": credential.WorkspaceSlug,
	})
	if err != nil {
		return credential, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, firstNonEmpty(strings.TrimSpace(m.cfg.Relay.AllocateURL), "https://api.hopter.dev/api/relay/allocate"), bytes.NewReader(body))
	if err != nil {
		return credential, err
	}
	request.Header.Set("Authorization", "Bearer "+credential.OAuthAccessToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return credential, err
	}
	defer response.Body.Close()
	data, err := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if err != nil {
		return credential, err
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return credential, fmt.Errorf("relay allocation returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}

	var decoded relayAllocationResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return credential, err
	}
	if decoded.LeaseID == "" || decoded.LeaseVersion <= 0 {
		return credential, fmt.Errorf("relay allocation response missing lease information")
	}

	credential.RelayLeaseID = decoded.LeaseID
	credential.RelayLeaseVersion = decoded.LeaseVersion
	credential.AuthUserID = firstNonEmpty(decoded.AuthUserID, credential.AuthUserID, decoded.WorkspaceSlug, credential.WorkspaceSlug)
	credential.WorkspaceSlug = firstNonEmpty(decoded.WorkspaceSlug, credential.WorkspaceSlug)
	credential.WorkspaceURL = firstNonEmpty(decoded.WorkspaceURL, credential.WorkspaceURL)
	credential.BrokerBaseURL = firstNonEmpty(decoded.BrokerBaseURL, credential.BrokerBaseURL)
	credential.RelayBaseURL = firstNonEmpty(decoded.RelayBaseURL, decoded.RelayBaseURLSnake, decoded.APIRelayBaseURL, decoded.APIRelayBaseURLSnake, credential.RelayBaseURL)
	credential.UpdatedAt = time.Now().UTC()
	if err := m.store.Store(credential); err != nil {
		return credential, err
	}
	return credential, nil
}

func backfillRelayAuthUserID(credential serverhttp.RelayCredential) serverhttp.RelayCredential {
	if strings.TrimSpace(credential.AuthUserID) == "" {
		credential.AuthUserID = strings.TrimSpace(credential.WorkspaceSlug)
	}
	return credential
}

func (m *SessionManager) startSession(ctx context.Context, credential serverhttp.RelayCredential) (relaySessionResponse, error) {
	requestBody, err := json.Marshal(map[string]any{
		"leaseId":      credential.RelayLeaseID,
		"leaseVersion": credential.RelayLeaseVersion,
	})
	if err != nil {
		return relaySessionResponse{}, err
	}

	request, err := http.NewRequestWithContext(ctx, http.MethodPost, relayControlURL(credential, "/api/relay/session/start"), bytes.NewReader(requestBody))
	if err != nil {
		return relaySessionResponse{}, err
	}
	request.Header.Set("Authorization", "Bearer "+credential.OAuthAccessToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	return decodeRelaySessionResponse(http.DefaultClient.Do(request))
}

func (m *SessionManager) refreshSession(ctx context.Context, credential serverhttp.RelayCredential) (relaySessionResponse, error) {
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, relayControlURL(credential, "/api/relay/session/refresh"), nil)
	if err != nil {
		return relaySessionResponse{}, err
	}
	request.Header.Set("Authorization", "Bearer "+credential.SessionToken)
	request.Header.Set("Accept", "application/json")

	return decodeRelaySessionResponse(http.DefaultClient.Do(request))
}

func (m *SessionManager) releaseLease(ctx context.Context, credential serverhttp.RelayCredential) error {
	if strings.TrimSpace(credential.RelayLeaseID) == "" || credential.RelayLeaseVersion <= 0 {
		return nil
	}

	updated, err := m.ensureOAuthAccessToken(ctx, credential)
	if err != nil {
		return err
	}
	credential = updated

	payload, err := json.Marshal(map[string]int{
		"leaseVersion": credential.RelayLeaseVersion,
	})
	if err != nil {
		return err
	}
	releaseURL, err := relayAPILeaseURL(m.cfg, credential.RelayLeaseID, "release")
	if err != nil {
		return err
	}
	request, err := http.NewRequestWithContext(ctx, http.MethodPost, releaseURL, bytes.NewReader(payload))
	if err != nil {
		return err
	}
	request.Header.Set("Authorization", "Bearer "+credential.OAuthAccessToken)
	request.Header.Set("Content-Type", "application/json")
	request.Header.Set("Accept", "application/json")

	response, err := http.DefaultClient.Do(request)
	if err != nil {
		return err
	}
	defer response.Body.Close()
	if response.StatusCode < 200 || response.StatusCode > 299 {
		data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
		return fmt.Errorf("relay release returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	return nil
}

func (m *SessionManager) serveControlConnection(ctx context.Context, credential *serverhttp.RelayCredential) error {
	header := http.Header{}
	header.Set("Authorization", "Bearer "+credential.SessionToken)
	wsURL := websocketURL(relayControlURL(*credential, "/api/relay/connect"))
	conn, response, err := websocket.DefaultDialer.DialContext(ctx, wsURL, header)
	if err != nil {
		if response != nil && response.Body != nil {
			data, _ := io.ReadAll(io.LimitReader(response.Body, 1<<20))
			_ = response.Body.Close()
			return fmt.Errorf("relay websocket connect returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
		}
		return err
	}
	defer conn.Close()

	relayReady, err := readRelayReady(conn)
	if err != nil {
		return err
	}
	if relayReady.ProtocolVersion != relaycontract.RelayProtocolVersion {
		return fmt.Errorf("unexpected relay protocol version %d", relayReady.ProtocolVersion)
	}

	if err := conn.WriteJSON(relaycontract.ClientReadyMessage{
		Type:            relaycontract.RelayMessageTypeClientReady,
		ProtocolVersion: relaycontract.RelayProtocolVersion,
		Capabilities:    relaycontract.RelayCapabilities,
	}); err != nil {
		return err
	}

	if _, err := readRelayAccepted(conn); err != nil {
		return err
	}

	m.readyOnce.Do(func() {
		close(m.readyCh)
	})

	connectionCtx, cancel := context.WithCancel(ctx)
	defer cancel()
	active := &activeControlConnection{
		ctx:           connectionCtx,
		cancel:        cancel,
		conn:          conn,
		localBaseURL:  m.localBaseURL,
		httpBodies:    make(map[string]*io.PipeWriter),
		socketStreams: make(map[string]*websocket.Conn),
		httpClient:    &http.Client{},
	}

	errCh := make(chan error, 1)
	go active.readLoop(errCh)
	go active.pingLoop(errCh)
	go active.refreshLoop(errCh, m, credential)

	select {
	case <-ctx.Done():
		return ctx.Err()
	case err := <-errCh:
		active.closeLocalStreams()
		return err
	}
}

func (c *activeControlConnection) readLoop(errCh chan<- error) {
	for {
		_, data, err := c.conn.ReadMessage()
		if err != nil {
			errCh <- err
			return
		}
		var envelope relayEnvelope
		if err := json.Unmarshal(data, &envelope); err != nil {
			errCh <- err
			return
		}
		if err := c.handleEnvelope(envelope.Type, data); err != nil {
			errCh <- err
			return
		}
	}
}

func (c *activeControlConnection) handleEnvelope(messageType string, data []byte) error {
	switch messageType {
	case string(relaycontract.RelayMessageTypeRequestStart):
		var message relaycontract.RequestStartMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return err
		}
		return c.handleRequestStart(message)
	case string(relaycontract.RelayMessageTypeRequestBody):
		var message relaycontract.RequestBodyMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return err
		}
		return c.handleRequestBody(message)
	case string(relaycontract.RelayMessageTypeRequestEnd):
		var message relaycontract.RequestEndMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return err
		}
		return c.handleRequestEnd(message)
	case string(relaycontract.RelayMessageTypeWebsocketConnect):
		var message relaycontract.WebSocketConnectMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return err
		}
		return c.handleWebSocketConnect(message)
	case string(relaycontract.RelayMessageTypeWebsocketFrame):
		var message relaycontract.WebSocketFrameMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return err
		}
		return c.handleWebSocketFrame(message)
	case string(relaycontract.RelayMessageTypeWebsocketClose):
		var message relaycontract.WebSocketCloseMessage
		if err := json.Unmarshal(data, &message); err != nil {
			return err
		}
		return c.handleWebSocketClose(message)
	case string(relaycontract.RelayMessageTypePong):
		var message relaycontract.PongMessage
		return json.Unmarshal(data, &message)
	default:
		return fmt.Errorf("unsupported relay message type %q", messageType)
	}
}

func (c *activeControlConnection) pingLoop(errCh chan<- error) {
	ticker := time.NewTicker(15 * time.Second)
	defer ticker.Stop()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			if err := c.sendJSON(relaycontract.PingMessage{
				Type:   relaycontract.RelayMessageTypePing,
				SentAt: time.Now().UTC().Unix(),
			}); err != nil {
				errCh <- err
				return
			}
		}
	}
}

func (c *activeControlConnection) refreshLoop(errCh chan<- error, manager *SessionManager, credential *serverhttp.RelayCredential) {
	ticker := time.NewTicker(2 * time.Minute)
	defer ticker.Stop()

	for {
		select {
		case <-c.ctx.Done():
			return
		case <-ticker.C:
			refreshed, err := manager.refreshSession(c.ctx, *credential)
			if err != nil {
				errCh <- err
				return
			}
			credential.SessionToken = refreshed.SessionToken
			credential.RequestSigningKey = refreshed.RequestSigningKey
			credential.RelayRouteGeneration = refreshed.RouteGeneration
			credential.RelaySessionID = refreshed.SessionID
			manager.verifier.Update(serverhttp.RelayVerificationSession{
				AuthUserID:        credential.AuthUserID,
				WorkspaceSlug:     credential.WorkspaceSlug,
				LeaseID:           credential.RelayLeaseID,
				LeaseVersion:      credential.RelayLeaseVersion,
				RouteGeneration:   credential.RelayRouteGeneration,
				RequestSigningKey: credential.RequestSigningKey,
			})
		}
	}
}

func (c *activeControlConnection) handleRequestStart(message relaycontract.RequestStartMessage) error {
	reader, writer := io.Pipe()
	c.httpBodiesMu.Lock()
	c.httpBodies[message.StreamID] = writer
	c.httpBodiesMu.Unlock()

	go c.serveHTTPStream(message, reader)
	return nil
}

func (c *activeControlConnection) handleRequestBody(message relaycontract.RequestBodyMessage) error {
	c.httpBodiesMu.Lock()
	writer := c.httpBodies[message.StreamID]
	c.httpBodiesMu.Unlock()
	if writer == nil {
		return nil
	}
	data, err := base64.RawURLEncoding.DecodeString(message.DataBase64)
	if err != nil {
		return err
	}
	_, err = writer.Write(data)
	return err
}

func (c *activeControlConnection) handleRequestEnd(message relaycontract.RequestEndMessage) error {
	c.httpBodiesMu.Lock()
	writer := c.httpBodies[message.StreamID]
	delete(c.httpBodies, message.StreamID)
	c.httpBodiesMu.Unlock()
	if writer != nil {
		return writer.Close()
	}
	return nil
}

func (c *activeControlConnection) serveHTTPStream(message relaycontract.RequestStartMessage, body io.Reader) {
	target := localTargetURL(c.localBaseURL, message.Path, message.Query)
	request, err := http.NewRequestWithContext(c.ctx, message.Method, target, body)
	if err != nil {
		_ = c.sendError(message.StreamID, "http_request_build_failed", err.Error())
		return
	}
	for key, value := range message.Headers {
		request.Header.Set(key, value)
	}

	response, err := c.httpClient.Do(request)
	if err != nil {
		_ = c.sendError(message.StreamID, "http_request_failed", err.Error())
		return
	}
	defer response.Body.Close()

	if err := c.sendJSON(relaycontract.ResponseStartMessage{
		Type:     relaycontract.RelayMessageTypeResponseStart,
		StreamID: message.StreamID,
		Status:   response.StatusCode,
		Headers:  copyHeaders(response.Header),
	}); err != nil {
		return
	}

	buffer := make([]byte, 32*1024)
	for {
		readBytes, readErr := response.Body.Read(buffer)
		if readBytes > 0 {
			if err := c.sendJSON(relaycontract.ResponseBodyMessage{
				Type:       relaycontract.RelayMessageTypeResponseBody,
				StreamID:   message.StreamID,
				DataBase64: base64.RawURLEncoding.EncodeToString(buffer[:readBytes]),
			}); err != nil {
				return
			}
		}
		if readErr != nil {
			if readErr != io.EOF {
				_ = c.sendError(message.StreamID, "http_response_read_failed", readErr.Error())
			}
			break
		}
	}

	_ = c.sendJSON(relaycontract.ResponseEndMessage{
		Type:     relaycontract.RelayMessageTypeResponseEnd,
		StreamID: message.StreamID,
	})
}

func (c *activeControlConnection) handleWebSocketConnect(message relaycontract.WebSocketConnectMessage) error {
	headers := http.Header{}
	for key, value := range message.Headers {
		headers.Set(key, value)
	}
	target := websocketURL(localTargetURL(c.localBaseURL, message.Path, message.Query))
	conn, _, err := websocket.DefaultDialer.DialContext(c.ctx, target, headers)
	if err != nil {
		return c.sendJSON(relaycontract.WebSocketRejectMessage{
			Type:     relaycontract.RelayMessageTypeWebsocketReject,
			StreamID: message.StreamID,
			Status:   http.StatusBadGateway,
			Message:  err.Error(),
		})
	}

	c.socketMu.Lock()
	c.socketStreams[message.StreamID] = conn
	c.socketMu.Unlock()

	if err := c.sendJSON(relaycontract.WebSocketAcceptMessage{
		Type:     relaycontract.RelayMessageTypeWebsocketAccept,
		StreamID: message.StreamID,
		Headers:  map[string]string{},
	}); err != nil {
		conn.Close()
		return err
	}

	go c.forwardLocalWebSocket(message.StreamID, conn)
	return nil
}

func (c *activeControlConnection) handleWebSocketFrame(message relaycontract.WebSocketFrameMessage) error {
	c.socketMu.Lock()
	conn := c.socketStreams[message.StreamID]
	c.socketMu.Unlock()
	if conn == nil {
		return nil
	}

	data, err := base64.RawURLEncoding.DecodeString(message.DataBase64)
	if err != nil {
		return err
	}
	messageType := websocket.BinaryMessage
	if message.Opcode == relaycontract.RelayWebSocketOpcodeText {
		messageType = websocket.TextMessage
	}
	return conn.WriteMessage(messageType, data)
}

func (c *activeControlConnection) handleWebSocketClose(message relaycontract.WebSocketCloseMessage) error {
	c.socketMu.Lock()
	conn := c.socketStreams[message.StreamID]
	delete(c.socketStreams, message.StreamID)
	c.socketMu.Unlock()
	if conn != nil {
		_ = conn.WriteControl(websocket.CloseMessage, websocket.FormatCloseMessage(message.Code, message.Reason), time.Now().Add(time.Second))
		_ = conn.Close()
	}
	return nil
}

func (c *activeControlConnection) forwardLocalWebSocket(streamID string, conn *websocket.Conn) {
	defer func() {
		c.socketMu.Lock()
		delete(c.socketStreams, streamID)
		c.socketMu.Unlock()
		_ = conn.Close()
	}()

	for {
		messageType, data, err := conn.ReadMessage()
		if err != nil {
			code := websocket.CloseNormalClosure
			reason := ""
			if closeErr, ok := err.(*websocket.CloseError); ok {
				code = closeErr.Code
				reason = closeErr.Text
			}
			_ = c.sendJSON(relaycontract.WebSocketCloseMessage{
				Type:     relaycontract.RelayMessageTypeWebsocketClose,
				StreamID: streamID,
				Code:     code,
				Reason:   reason,
			})
			return
		}
		opcode := relaycontract.RelayWebSocketOpcodeBinary
		if messageType == websocket.TextMessage {
			opcode = relaycontract.RelayWebSocketOpcodeText
		}
		if err := c.sendJSON(relaycontract.WebSocketFrameMessage{
			Type:       relaycontract.RelayMessageTypeWebsocketFrame,
			StreamID:   streamID,
			Opcode:     opcode,
			DataBase64: base64.RawURLEncoding.EncodeToString(data),
		}); err != nil {
			return
		}
	}
}

func (c *activeControlConnection) sendError(streamID string, code string, message string) error {
	return c.sendJSON(relaycontract.RelayErrorMessage{
		Type:     relaycontract.RelayMessageTypeError,
		StreamID: streamID,
		Code:     code,
		Message:  message,
	})
}

func (c *activeControlConnection) sendJSON(message any) error {
	c.sendMu.Lock()
	defer c.sendMu.Unlock()
	return c.conn.WriteJSON(message)
}

func (c *activeControlConnection) closeLocalStreams() {
	c.httpBodiesMu.Lock()
	for streamID, writer := range c.httpBodies {
		delete(c.httpBodies, streamID)
		_ = writer.Close()
	}
	c.httpBodiesMu.Unlock()

	c.socketMu.Lock()
	for streamID, conn := range c.socketStreams {
		delete(c.socketStreams, streamID)
		_ = conn.Close()
	}
	c.socketMu.Unlock()
}

func readRelayReady(conn *websocket.Conn) (relaycontract.RelayReadyMessage, error) {
	var message relaycontract.RelayReadyMessage
	if err := conn.ReadJSON(&message); err != nil {
		return relaycontract.RelayReadyMessage{}, err
	}
	if message.Type != relaycontract.RelayMessageTypeRelayReady {
		return relaycontract.RelayReadyMessage{}, fmt.Errorf("expected relay-ready, got %s", message.Type)
	}
	return message, nil
}

func readRelayAccepted(conn *websocket.Conn) (relaycontract.RelayAcceptedMessage, error) {
	var message relaycontract.RelayAcceptedMessage
	if err := conn.ReadJSON(&message); err != nil {
		return relaycontract.RelayAcceptedMessage{}, err
	}
	if message.Type != relaycontract.RelayMessageTypeRelayAccepted {
		return relaycontract.RelayAcceptedMessage{}, fmt.Errorf("expected relay-accepted, got %s", message.Type)
	}
	return message, nil
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
		RequestSigningKey: cfg.Relay.RequestSigningKey,
	}
}

func relayControlURL(credential serverhttp.RelayCredential, path string) string {
	base := firstNonEmpty(
		strings.TrimSpace(credential.RelayBaseURL),
		deprecatedConnectorControlBaseURL(credential.BrokerBaseURL),
		deprecatedConnectorControlBaseURL(credential.WorkspaceURL),
		"https://api.hopter.dev",
	)
	target, err := url.Parse(base)
	if err != nil {
		return base
	}
	target.Path = strings.TrimRight(target.Path, "/") + path
	target.RawQuery = ""
	return target.String()
}

func deprecatedConnectorControlBaseURL(raw string) string {
	trimmed := strings.TrimSpace(raw)
	if trimmed == "" {
		return ""
	}
	parsed, err := url.Parse(trimmed)
	if err != nil {
		return trimmed
	}
	if strings.EqualFold(parsed.Hostname(), "my.hopter.dev") {
		return ""
	}
	return trimmed
}

func websocketURL(raw string) string {
	if strings.HasPrefix(raw, "https://") {
		return "wss://" + strings.TrimPrefix(raw, "https://")
	}
	if strings.HasPrefix(raw, "http://") {
		return "ws://" + strings.TrimPrefix(raw, "http://")
	}
	return raw
}

func localOriginBaseURL(cfg app.HTTPConfig) string {
	host := strings.TrimSpace(cfg.Host)
	switch strings.ToLower(host) {
	case "", "0.0.0.0", "::", "[::]":
		host = "127.0.0.1"
	}
	host = strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
	return "http://" + host + ":" + fmt.Sprintf("%d", cfg.Port)
}

func localTargetURL(baseURL string, pathname string, rawQuery string) string {
	base, _ := url.Parse(baseURL)
	target := base.ResolveReference(&url.URL{
		Path:     pathname,
		RawQuery: strings.TrimPrefix(rawQuery, "?"),
	})
	return target.String()
}

func decodeRelaySessionResponse(response *http.Response, err error) (relaySessionResponse, error) {
	if err != nil {
		return relaySessionResponse{}, err
	}
	defer response.Body.Close()
	data, readErr := io.ReadAll(io.LimitReader(response.Body, 1<<20))
	if readErr != nil {
		return relaySessionResponse{}, readErr
	}
	if response.StatusCode < 200 || response.StatusCode > 299 {
		return relaySessionResponse{}, fmt.Errorf("relay session returned %d: %s", response.StatusCode, strings.TrimSpace(string(data)))
	}
	var decoded relaySessionResponse
	if err := json.Unmarshal(data, &decoded); err != nil {
		return relaySessionResponse{}, err
	}
	if decoded.SessionToken == "" || decoded.RequestSigningKey == "" {
		return relaySessionResponse{}, fmt.Errorf("relay session response missing required credentials")
	}
	return decoded, nil
}

func copyHeaders(headers http.Header) map[string]string {
	out := make(map[string]string, len(headers))
	for key, values := range headers {
		if len(values) == 0 {
			continue
		}
		out[key] = values[0]
	}
	return out
}

func clearLeaseIfStale(credential serverhttp.RelayCredential, err error) serverhttp.RelayCredential {
	if err == nil {
		return credential
	}
	if strings.Contains(err.Error(), "404") || strings.Contains(err.Error(), "409") {
		credential.RelayLeaseID = ""
		credential.RelayLeaseVersion = 0
		credential.RelayRouteGeneration = 0
		credential.RelaySessionID = ""
		credential.SessionToken = ""
		credential.RequestSigningKey = ""
	}
	return credential
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

func nextBackoff(current time.Duration) time.Duration {
	if current <= 0 {
		return time.Second
	}
	if current >= 30*time.Second {
		return 30 * time.Second
	}
	return current * 2
}

func sleepBackoff(ctx context.Context, duration time.Duration) error {
	timer := time.NewTimer(duration)
	defer timer.Stop()
	select {
	case <-ctx.Done():
		return ctx.Err()
	case <-timer.C:
		return nil
	}
}

func firstNonEmpty(values ...string) string {
	for _, value := range values {
		if strings.TrimSpace(value) != "" {
			return value
		}
	}
	return ""
}
