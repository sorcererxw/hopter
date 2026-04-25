package app

import (
	"context"
	"net/http"
	"time"

	"github.com/sorcererxw/hopter/internal/agents"
	"github.com/sorcererxw/hopter/internal/agents/codex"
	"github.com/sorcererxw/hopter/internal/core"
	"github.com/sorcererxw/hopter/internal/events"
	"github.com/sorcererxw/hopter/internal/gitops"
	serverhttp "github.com/sorcererxw/hopter/internal/http"
	rpcserver "github.com/sorcererxw/hopter/internal/rpc"
	"github.com/sorcererxw/hopter/internal/tasks"
	"github.com/sorcererxw/hopter/internal/terminal"
	"github.com/sorcererxw/hopter/internal/update"
	"github.com/sorcererxw/hopter/internal/userconfig"
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
	configService, err := userconfig.NewService("", eventHub)
	if err != nil {
		return nil, err
	}
	updateService := update.NewService(cfg.Version, cfg.InstallSource)
	gitService := gitops.NewService(workspace, eventHub)
	taskStore, err := tasks.NewBadgerStore(cfg.Tasks.StorePath())
	if err != nil {
		return nil, err
	}
	codexManager := codex.NewManager(workspace, eventHub)
	agentManager := agents.NewManager(workspace, map[string]agents.Runtime{
		agents.DefaultBackendKey: codex.NewRuntime(codexManager),
	})
	terminalManager := terminal.NewManagerWithResolver(workspace, agentManager)
	sessionReadModel := codex.NewSessionReadModel(workspace, codexManager, agentManager)

	router, err := serverhttp.NewRouter(serverhttp.RouterOptions{
		Version:                cfg.Version,
		UI:                     serverhttp.UIHandlerOptions{DevProxyURL: cfg.UI.DevProxyURL},
		EventHub:               eventHub,
		ConfigServiceHandler:   rpcserver.NewConfigService(configService),
		GitServiceHandler:      rpcserver.NewGitService(gitService),
		HostServiceHandler:     rpcserver.NewHostService(workspace, updateService, codexManager),
		ProjectServiceHandler:  rpcserver.NewProjectService(workspace, agentManager),
		SessionServiceHandler:  rpcserver.NewSessionService(workspace, agentManager, sessionReadModel),
		TaskServiceHandler:     rpcserver.NewTaskService(taskStore, workspace, eventHub),
		TerminalServiceHandler: rpcserver.NewTerminalService(terminalManager),
		TerminalStreamHandler:  terminalManager,
		Workspace:              workspace,
		Relay: serverhttp.RelayOptions{
			AuthPath:          cfg.Relay.AuthPath,
			AuthStoreName:     cfg.Relay.AuthStore,
			TokenPath:         cfg.Relay.TokenPath,
			ExchangeURL:       cfg.Relay.ExchangeURL,
			OAuthAuthorizeURL: cfg.Relay.OAuthAuthorizeURL,
			OAuthTokenURL:     cfg.Relay.OAuthTokenURL,
			OAuthClientID:     cfg.Relay.OAuthClientID,
			OAuthAudience:     cfg.Relay.OAuthAudience,
			HostID:            cfg.HostID,
			BrokerSecret:      cfg.Relay.BrokerSecret,
		},
	})
	if err != nil {
		_ = taskStore.Close()
		return nil, err
	}

	server := &http.Server{
		Addr:              cfg.HTTP.Addr(),
		Handler:           router,
		ReadHeaderTimeout: 5 * time.Second,
	}
	server.RegisterOnShutdown(func() {
		_ = taskStore.Close()
	})

	backgroundCtx, cancelBackground := context.WithCancel(context.Background())
	server.RegisterOnShutdown(cancelBackground)
	go sessionReadModel.PrewarmRecent(backgroundCtx, 10, 50)
	codexManager.StartSessionListMonitor(backgroundCtx, 0, 0)

	return &Runtime{
		Config:    cfg,
		EventHub:  eventHub,
		Workspace: workspace,
		Server:    server,
	}, nil
}
