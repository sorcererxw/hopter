package relay

import (
	"context"
	"encoding/base64"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"net/url"
	"strconv"
	"sync/atomic"
	"testing"
	"time"

	"github.com/gorilla/websocket"

	"github.com/sorcererxw/hopter/internal/app"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
	"github.com/sorcererxw/hopter/internal/relaycontract"
)

func TestSessionManagerBridgesHTTPAndTerminalWebSocketAndReconnects(t *testing.T) {
	upgrader := websocket.Upgrader{}
	originSawSignedHTTP := make(chan struct{}, 1)
	originSawSignedWS := make(chan struct{}, 1)
	origin := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/hello":
			if r.Header.Get(relaycontract.RelayRequestContextPayloadHeader) == "" ||
				r.Header.Get(relaycontract.RelayRequestContextSignatureHeader) == "" {
				t.Fatalf("missing signed provenance headers on HTTP request")
			}
			select {
			case originSawSignedHTTP <- struct{}{}:
			default:
			}
			_, _ = w.Write([]byte("hello over relay"))
		case "/terminals/term-1/stream":
			if r.Header.Get(relaycontract.RelayRequestContextPayloadHeader) == "" ||
				r.Header.Get(relaycontract.RelayRequestContextSignatureHeader) == "" {
				t.Fatalf("missing signed provenance headers on websocket request")
			}
			select {
			case originSawSignedWS <- struct{}{}:
			default:
			}
			conn, err := upgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("upgrade websocket: %v", err)
			}
			defer conn.Close()
			_, data, err := conn.ReadMessage()
			if err != nil {
				t.Fatalf("read websocket payload: %v", err)
			}
			if string(data) != "ping" {
				t.Fatalf("websocket payload = %q, want ping", string(data))
			}
			if err := conn.WriteMessage(websocket.TextMessage, []byte("pong")); err != nil {
				t.Fatalf("write websocket payload: %v", err)
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer origin.Close()

	originURL, err := url.Parse(origin.URL)
	if err != nil {
		t.Fatalf("parse origin URL: %v", err)
	}
	originPort, err := strconv.Atoi(originURL.Port())
	if err != nil {
		t.Fatalf("parse origin port: %v", err)
	}

	var sessionStarts atomic.Int32
	secondSessionStarted := make(chan struct{}, 1)
	responseValidated := make(chan struct{}, 1)
	websocketValidated := make(chan struct{}, 1)
	brokerUpgrader := websocket.Upgrader{}
	broker := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/api/relay/session/start":
			count := sessionStarts.Add(1)
			if count == 2 {
				select {
				case secondSessionStarted <- struct{}{}:
				default:
				}
			}
			_ = json.NewEncoder(w).Encode(map[string]any{
				"sessionToken":      "session-token-" + strconv.Itoa(int(count)),
				"requestSigningKey": "request-signing-key",
				"routeGeneration":   count,
				"sessionId":         "session-" + strconv.Itoa(int(count)),
				"expiresAt":         time.Now().Add(5 * time.Minute).Unix(),
			})
		case "/api/relay/leases/lease-1/release":
			w.WriteHeader(http.StatusOK)
			_, _ = w.Write([]byte(`{"ok":true}`))
		case "/api/relay/connect":
			conn, err := brokerUpgrader.Upgrade(w, r, nil)
			if err != nil {
				t.Fatalf("upgrade broker websocket: %v", err)
			}
			defer conn.Close()

			if err := conn.WriteJSON(relaycontract.RelayReadyMessage{
				Type:            relaycontract.RelayMessageTypeRelayReady,
				ProtocolVersion: relaycontract.RelayProtocolVersion,
				Capabilities:    relaycontract.RelayCapabilities,
			}); err != nil {
				t.Fatalf("write relay-ready: %v", err)
			}

			var clientReady relaycontract.ClientReadyMessage
			if err := conn.ReadJSON(&clientReady); err != nil {
				t.Fatalf("read client-ready: %v", err)
			}
			if clientReady.Type != relaycontract.RelayMessageTypeClientReady {
				t.Fatalf("client ready type = %q", clientReady.Type)
			}

			if err := conn.WriteJSON(relaycontract.RelayAcceptedMessage{
				Type:             relaycontract.RelayMessageTypeRelayAccepted,
				ProtocolVersion:  relaycontract.RelayProtocolVersion,
				Capabilities:     relaycontract.RelayCapabilities,
				SessionExpiresAt: time.Now().Add(5 * time.Minute).Unix(),
			}); err != nil {
				t.Fatalf("write relay-accepted: %v", err)
			}

			if err := conn.WriteJSON(relaycontract.RequestStartMessage{
				Type:     relaycontract.RelayMessageTypeRequestStart,
				StreamID: "stream-http",
				Method:   http.MethodGet,
				Path:     "/hello",
				Query:    "",
				Headers: map[string]string{
					relaycontract.RelayRequestContextPayloadHeader:   signedPayload(t),
					relaycontract.RelayRequestContextSignatureHeader: signedSignature(t),
				},
				Provenance: relaycontract.RelayRequestContext{},
			}); err != nil {
				t.Fatalf("write request-start: %v", err)
			}
			if err := conn.WriteJSON(relaycontract.RequestEndMessage{
				Type:     relaycontract.RelayMessageTypeRequestEnd,
				StreamID: "stream-http",
			}); err != nil {
				t.Fatalf("write request-end: %v", err)
			}

			var responseStart relaycontract.ResponseStartMessage
			if err := conn.ReadJSON(&responseStart); err != nil {
				t.Fatalf("read response-start: %v", err)
			}
			if responseStart.Status != http.StatusOK {
				t.Fatalf("response status = %d, want 200", responseStart.Status)
			}
			var responseBody relaycontract.ResponseBodyMessage
			if err := conn.ReadJSON(&responseBody); err != nil {
				t.Fatalf("read response-body: %v", err)
			}
			data, err := base64.RawURLEncoding.DecodeString(responseBody.DataBase64)
			if err != nil {
				t.Fatalf("decode response body: %v", err)
			}
			if string(data) != "hello over relay" {
				t.Fatalf("response body = %q, want hello over relay", string(data))
			}
			var responseEnd relaycontract.ResponseEndMessage
			if err := conn.ReadJSON(&responseEnd); err != nil {
				t.Fatalf("read response-end: %v", err)
			}
			select {
			case responseValidated <- struct{}{}:
			default:
			}

			if err := conn.WriteJSON(relaycontract.WebSocketConnectMessage{
				Type:     relaycontract.RelayMessageTypeWebsocketConnect,
				StreamID: "stream-ws",
				Path:     "/terminals/term-1/stream",
				Query:    "",
				Headers: map[string]string{
					relaycontract.RelayRequestContextPayloadHeader:   signedPayload(t),
					relaycontract.RelayRequestContextSignatureHeader: signedSignature(t),
				},
				Provenance: relaycontract.RelayRequestContext{},
			}); err != nil {
				t.Fatalf("write websocket-connect: %v", err)
			}
			var wsAccept relaycontract.WebSocketAcceptMessage
			if err := conn.ReadJSON(&wsAccept); err != nil {
				t.Fatalf("read websocket-accept: %v", err)
			}
			if err := conn.WriteJSON(relaycontract.WebSocketFrameMessage{
				Type:       relaycontract.RelayMessageTypeWebsocketFrame,
				StreamID:   "stream-ws",
				Opcode:     relaycontract.RelayWebSocketOpcodeText,
				DataBase64: base64.RawURLEncoding.EncodeToString([]byte("ping")),
			}); err != nil {
				t.Fatalf("write websocket-frame: %v", err)
			}
			var wsFrame relaycontract.WebSocketFrameMessage
			if err := conn.ReadJSON(&wsFrame); err != nil {
				t.Fatalf("read websocket-frame: %v", err)
			}
			wsData, err := base64.RawURLEncoding.DecodeString(wsFrame.DataBase64)
			if err != nil {
				t.Fatalf("decode websocket frame: %v", err)
			}
			if string(wsData) != "pong" {
				t.Fatalf("websocket payload = %q, want pong", string(wsData))
			}
			select {
			case websocketValidated <- struct{}{}:
			default:
			}
		default:
			http.NotFound(w, r)
		}
	}))
	defer broker.Close()

	brokerURL, err := url.Parse(broker.URL)
	if err != nil {
		t.Fatalf("parse broker URL: %v", err)
	}

	cfg, err := app.LoadConfigWithOptions("dev", "direct", app.LoadOptions{Relay: true})
	if err != nil {
		t.Fatalf("load config: %v", err)
	}
	cfg.HTTP.Host = originURL.Hostname()
	cfg.HTTP.Port = originPort
	cfg.Relay.HeartbeatEvery = 100 * time.Millisecond
	cfg.Relay.AllocateURL = broker.URL + "/api/relay/allocate"

	authPath := t.TempDir() + "/relay-auth.json"
	store := serverhttp.NewFileRelayAuthStore(authPath)
	if err := store.Store(serverhttp.RelayCredential{
		AuthUserID:                "user-1",
		HostID:                    "host_local",
		WorkspaceSlug:             "alice",
		WorkspaceURL:              broker.URL,
		BrokerBaseURL:             broker.URL,
		RelayLeaseID:              "lease-1",
		RelayLeaseVersion:         1,
		OAuthAccessToken:          "oauth-access-token",
		OAuthRefreshToken:         "oauth-refresh-token",
		OAuthAccessTokenExpiresAt: time.Now().Add(time.Hour),
		UpdatedAt:                 time.Now().UTC(),
	}); err != nil {
		t.Fatalf("store auth: %v", err)
	}

	verifier := serverhttp.NewRelayRequestVerifier()
	manager := NewSessionManager(cfg, store, verifier)
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	runErrCh := make(chan error, 1)
	go func() {
		credential, loadErr := store.Load()
		if loadErr != nil {
			runErrCh <- loadErr
			return
		}
		runErrCh <- manager.Run(ctx, credential)
	}()

	select {
	case <-manager.Ready():
	case err := <-runErrCh:
		t.Fatalf("manager exited before ready: %v", err)
	case <-time.After(5 * time.Second):
		t.Fatal("manager did not become ready")
	}

	select {
	case <-originSawSignedHTTP:
	case <-time.After(5 * time.Second):
		t.Fatal("origin did not receive signed HTTP provenance")
	}
	select {
	case <-responseValidated:
	case <-time.After(5 * time.Second):
		t.Fatal("broker did not validate HTTP response flow")
	}
	select {
	case <-originSawSignedWS:
	case <-time.After(5 * time.Second):
		t.Fatal("origin did not receive signed websocket provenance")
	}
	select {
	case <-websocketValidated:
	case <-time.After(5 * time.Second):
		t.Fatal("broker did not validate websocket frame flow")
	}

	select {
	case <-secondSessionStarted:
		cancel()
	case <-time.After(5 * time.Second):
		t.Fatal("manager did not start a second relay session after disconnect")
	}

	select {
	case err := <-runErrCh:
		if err != nil && err != context.Canceled {
			t.Fatalf("manager exited with unexpected error: %v", err)
		}
	case <-time.After(5 * time.Second):
		t.Fatal("manager did not stop after cancellation")
	}

			if host := brokerURL.Host; host == "" {
		t.Fatal("expected broker host to be non-empty")
	}
}

func signedPayload(t *testing.T) string {
	t.Helper()
	context := relaycontract.RelayRequestContext{
		AuthUserId:      "user-1",
		WorkspaceSlug:   "alice",
		LeaseId:         "lease-1",
		LeaseVersion:    1,
		RouteGeneration: 1,
		Exp:             time.Now().Add(time.Minute).Unix(),
		Nonce:           "nonce-" + strconv.FormatInt(time.Now().UnixNano(), 10),
	}
	data, err := json.Marshal(context)
	if err != nil {
		t.Fatalf("marshal relay context: %v", err)
	}
	return base64.RawURLEncoding.EncodeToString(data)
}

func signedSignature(t *testing.T) string {
	t.Helper()
	payload := signedPayload(t)
	return payload
}
