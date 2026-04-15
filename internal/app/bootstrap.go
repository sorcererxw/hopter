package app

import (
	"net/http"
	"time"

	"orchd/internal/codex"
	"orchd/internal/core"
	"orchd/internal/events"
	serverhttp "orchd/internal/http"
	rpcserver "orchd/internal/rpc"
)

type Runtime struct {
	Config    Config
	EventHub  *events.Hub
	Workspace core.WorkspaceService
	Server    *http.Server
}

func NewRuntime(cfg Config) (*Runtime, error) {
	eventHub := events.NewHub()
	workspace := core.NewInMemoryWorkspace(cfg.HostID, eventHub)
	codexManager := codex.NewManager(workspace)

	router, err := serverhttp.NewRouter(serverhttp.RouterOptions{
		Version:               cfg.Version,
		UI:                    serverhttp.UIHandlerOptions{DevProxyURL: cfg.UI.DevProxyURL},
		EventHub:              eventHub,
		HostServiceHandler:    rpcserver.NewHostService(workspace),
		ProjectServiceHandler: rpcserver.NewProjectService(workspace),
		SessionServiceHandler: rpcserver.NewSessionService(workspace, codexManager),
	})
	if err != nil {
		return nil, err
	}

	server := &http.Server{
		Addr:              cfg.HTTP.Addr(),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	return &Runtime{
		Config:    cfg,
		EventHub:  eventHub,
		Workspace: workspace,
		Server:    server,
	}, nil
}
