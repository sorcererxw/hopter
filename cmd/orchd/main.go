package main

import (
	"context"
	"errors"
	"log/slog"
	"net/http"
	"os"
	"os/signal"
	"syscall"
	"time"

	"orchd/internal/app"
)

var version = "dev"

func main() {
	cfg, err := app.LoadConfig(version)
	if err != nil {
		slog.Error("load config", "error", err)
		os.Exit(1)
	}

	runtime, err := app.NewRuntime(cfg)
	if err != nil {
		slog.Error("bootstrap runtime", "error", err)
		os.Exit(1)
	}

	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	go func() {
		<-ctx.Done()
		shutdownCtx, cancel := context.WithTimeout(context.Background(), 5*time.Second)
		defer cancel()
		if err := runtime.Server.Shutdown(shutdownCtx); err != nil {
			slog.Error("shutdown server", "error", err)
		}
	}()

	slog.Info("orchd listening", "addr", cfg.HTTP.Addr(), "ui_mode", cfg.UI.Mode())
	if err := runtime.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve", "error", err)
		os.Exit(1)
	}
}
