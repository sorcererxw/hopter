package app

import (
	"context"
	"net/http"
	"time"

	"github.com/sorcererxw/hopter/internal/agents"
	"github.com/sorcererxw/hopter/internal/agents/codex"
	copilotagent "github.com/sorcererxw/hopter/internal/agents/copilot"
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
	agentManager := agents.NewManager(workspace, map[string]agents.Runtime{
		agents.DefaultBackendKey: codex.NewRuntime(codexManager),
		"copilot":                copilotagent.NewManager(workspace),
	})
	sessionReadModel := codex.NewSessionReadModel(workspace, codexManager, agentManager)

	router, err := serverhttp.NewRouter(serverhttp.RouterOptions{
		Version:                cfg.Version,
		UI:                     serverhttp.UIHandlerOptions{DevProxyURL: cfg.UI.DevProxyURL},
		EventHub:               eventHub,
		HostServiceHandler:     rpcserver.NewHostService(workspace, updateService),
		ProjectServiceHandler:  rpcserver.NewProjectService(workspace, agentManager),
		SessionServiceHandler:  rpcserver.NewSessionService(workspace, agentManager, sessionReadModel),
		TerminalServiceHandler: rpcserver.NewTerminalService(terminalManager),
		TerminalStreamHandler:  terminalManager,
		Workspace:              workspace,
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
