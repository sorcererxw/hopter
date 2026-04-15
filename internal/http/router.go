package serverhttp

import (
	"encoding/json"
	"fmt"
	"net/http"
	"strings"

	"orchd/internal/events"
	"orchd/internal/gen/proto/orchd/v1/orchdv1connect"
)

type RouterOptions struct {
	Version               string
	UI                    UIHandlerOptions
	EventHub              *events.Hub
	HostServiceHandler    orchdv1connect.HostServiceHandler
	ProjectServiceHandler orchdv1connect.ProjectServiceHandler
	SessionServiceHandler orchdv1connect.SessionServiceHandler
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
	mux.Handle("GET /events", NewSSEHandler(opts.EventHub))

	connectMux := http.NewServeMux()
	registerConnectHandlers(connectMux,
		func() (string, http.Handler) { return orchdv1connect.NewHostServiceHandler(opts.HostServiceHandler) },
		func() (string, http.Handler) {
			return orchdv1connect.NewProjectServiceHandler(opts.ProjectServiceHandler)
		},
		func() (string, http.Handler) {
			return orchdv1connect.NewSessionServiceHandler(opts.SessionServiceHandler)
		},
	)
	mux.Handle("/rpc/", http.StripPrefix("/rpc", connectMux))
	mux.Handle("/", uiHandler)

	return mux, nil
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
	case path == "/projects/new":
		return true
	case path == "/settings":
		return true
	default:
		return false
	}
}
