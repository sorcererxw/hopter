package app

import (
	"context"
	"net/http"
	"time"

	"orchd/internal/backend"
	copilotbackend "orchd/internal/backend/copilot"
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
	backendManager := backend.NewManager(workspace, map[string]backend.Runtime{
		backend.DefaultBackendKey: backend.NewCodexRuntime(codexManager),
		"copilot":                 copilotbackend.NewManager(workspace),
	})
	sessionReadModel := codex.NewSessionReadModel(workspace, codexManager, backendManager)

	router, err := serverhttp.NewRouter(serverhttp.RouterOptions{
		Version:               cfg.Version,
		UI:                    serverhttp.UIHandlerOptions{DevProxyURL: cfg.UI.DevProxyURL},
		EventHub:              eventHub,
		HostServiceHandler:    rpcserver.NewHostService(workspace),
		ProjectServiceHandler: rpcserver.NewProjectService(workspace, backendManager),
		SessionServiceHandler: rpcserver.NewSessionService(workspace, backendManager, sessionReadModel),
	})
	if err != nil {
		return nil, err
	}

	server := &http.Server{
		Addr:              cfg.HTTP.Addr(),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}

	go sessionReadModel.PrewarmRecent(context.Background(), 10, 50)

	return &Runtime{
		Config:    cfg,
		EventHub:  eventHub,
		Workspace: workspace,
		Server:    server,
	}, nil
}
