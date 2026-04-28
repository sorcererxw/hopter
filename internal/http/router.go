package serverhttp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"github.com/sorcererxw/hopter/internal/core"
	"github.com/sorcererxw/hopter/internal/events"
	"github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1/hopterv1connect"
)

type RouterOptions struct {
	Version                string
	UI                     UIHandlerOptions
	EventHub               *events.Hub
	ConfigServiceHandler   hopterv1connect.ConfigServiceHandler
	GitServiceHandler      hopterv1connect.GitServiceHandler
	HostServiceHandler     hopterv1connect.HostServiceHandler
	ProjectServiceHandler  hopterv1connect.ProjectServiceHandler
	SessionServiceHandler  hopterv1connect.SessionServiceHandler
	TaskServiceHandler     hopterv1connect.TaskServiceHandler
	TerminalServiceHandler hopterv1connect.TerminalServiceHandler
	TerminalStreamHandler  TerminalStreamHandler
	Workspace              core.WorkspaceService
	Relay                  RelayOptions
}

func NewRouter(opts RouterOptions) (http.Handler, error) {
	uiHandler, err := NewUIHandler(opts.UI)
	if err != nil {
		return nil, err
	}

	mux := http.NewServeMux()
	mux.HandleFunc("GET /healthz", handleHealth)
	mux.HandleFunc("GET /readyz", handleReady)
	mux.HandleFunc("GET /version", versionHandler(opts.Version, opts.UI.Mode()))
	mux.Handle("GET /events", authGate(NewSSEHandler(opts.EventHub)))
	mux.Handle("GET /api/image-proxy", authGate(NewImageProxyHandler(opts.Workspace)))
	mux.Handle("GET /api/relay/callback", NewRelayCallbackHandler(opts.Relay))
	mux.Handle("GET /terminals/{terminalId}/stream", authGate(NewTerminalWSHandler(opts.TerminalStreamHandler)))
	registerAuthHandlers(mux, opts.TerminalStreamHandler)

	connectMux := http.NewServeMux()
	registerConnectHandlers(connectMux,
		func() (string, http.Handler) {
			return hopterv1connect.NewConfigServiceHandler(opts.ConfigServiceHandler)
		},
		func() (string, http.Handler) {
			return hopterv1connect.NewGitServiceHandler(opts.GitServiceHandler)
		},
		func() (string, http.Handler) { return hopterv1connect.NewHostServiceHandler(opts.HostServiceHandler) },
		func() (string, http.Handler) {
			return hopterv1connect.NewProjectServiceHandler(opts.ProjectServiceHandler)
		},
		func() (string, http.Handler) {
			return hopterv1connect.NewSessionServiceHandler(opts.SessionServiceHandler)
		},
		func() (string, http.Handler) {
			return hopterv1connect.NewTaskServiceHandler(opts.TaskServiceHandler)
		},
		func() (string, http.Handler) {
			return hopterv1connect.NewTerminalServiceHandler(opts.TerminalServiceHandler)
		},
	)
	mux.Handle("/rpc/", authGate(http.StripPrefix("/rpc", connectMux)))
	mux.Handle("/", uiHandler)

	return relayBrokerGate(opts.Relay, mux), nil
}

func relayBrokerGate(opts RelayOptions, next http.Handler) http.Handler {
	return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		if opts.RequestVerifier == nil {
			next.ServeHTTP(w, r)
			return
		}

		if err := opts.RequestVerifier.VerifyRequest(r); err == nil {
			next.ServeHTTP(w, WithVerifiedRelayRequest(r))
			return
		} else if err != errRelayRequestContextMissing {
			http.Error(w, err.Error(), http.StatusForbidden)
			return
		}

		next.ServeHTTP(w, r)
	})
}

func registerConnectHandlers(mux *http.ServeMux, constructors ...func() (string, http.Handler)) {
	for _, constructor := range constructors {
		path, handler := constructor()
		mux.Handle(path, handler)
	}
}

func handleHealth(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ok",
	})
}

func handleReady(w http.ResponseWriter, _ *http.Request) {
	writeJSON(w, http.StatusOK, map[string]any{
		"status": "ready",
	})
}

func versionHandler(version string, uiMode string) http.HandlerFunc {
	return func(w http.ResponseWriter, _ *http.Request) {
		writeJSON(w, http.StatusOK, map[string]any{
			"version": version,
			"ui_mode": uiMode,
		})
	}
}

func writeJSON(w http.ResponseWriter, status int, payload any) {
	w.Header().Set("Content-Type", "application/json; charset=utf-8")
	w.WriteHeader(status)
	if err := json.NewEncoder(w).Encode(payload); err != nil {
		http.Error(w, fmt.Sprintf("encode response: %v", err), http.StatusInternalServerError)
	}
}

func isUIPath(path string) bool {
	switch {
	case path == "/":
		return true
	case strings.HasPrefix(path, "/sessions/"):
		return true
	case path == "/login":
		return true
	case path == "/relay/callback":
		return true
	case path == "/projects/new":
		return true
	case path == "/tasks":
		return true
	case strings.HasPrefix(path, "/tasks/"):
		return true
	case path == "/settings":
		return true
	case strings.HasPrefix(path, "/settings/"):
		return true
	default:
		return false
	}
}
