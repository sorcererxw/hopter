package app

import (
	"context"
	"net/http"
	"time"

	"github.com/sorcererxw/hopter/internal/backend"
	copilotbackend "github.com/sorcererxw/hopter/internal/backend/copilot"
	"github.com/sorcererxw/hopter/internal/codex"
	"github.com/sorcererxw/hopter/internal/core"
	"github.com/sorcererxw/hopter/internal/events"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
	rpcserver "github.com/sorcererxw/hopter/internal/rpc"
	"github.com/sorcererxw/hopter/internal/terminal"
	"github.com/sorcererxw/hopter/internal/update"
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
	updateService := update.NewService(cfg.Version, cfg.InstallSource)
	codexManager := codex.NewManager(workspace, eventHub)
	terminalManager := terminal.NewManager(workspace)
	backendManager := backend.NewManager(workspace, map[string]backend.Runtime{
		backend.DefaultBackendKey: backend.NewCodexRuntime(codexManager),
		"copilot":                 copilotbackend.NewManager(workspace),
	})
	sessionReadModel := codex.NewSessionReadModel(workspace, codexManager, backendManager)

	router, err := serverhttp.NewRouter(serverhttp.RouterOptions{
		Version:                cfg.Version,
		UI:                     serverhttp.UIHandlerOptions{DevProxyURL: cfg.UI.DevProxyURL},
		EventHub:               eventHub,
		HostServiceHandler:     rpcserver.NewHostService(workspace, updateService),
		ProjectServiceHandler:  rpcserver.NewProjectService(workspace, backendManager),
		SessionServiceHandler:  rpcserver.NewSessionService(workspace, backendManager, sessionReadModel),
		TerminalServiceHandler: rpcserver.NewTerminalService(terminalManager),
		TerminalStreamHandler:  terminalManager,
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
