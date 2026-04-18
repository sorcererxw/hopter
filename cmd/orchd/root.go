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

	"github.com/spf13/cobra"

	"orchd/internal/app"
)

func newRootCmd(version string, installSource string) *cobra.Command {
	cmd := &cobra.Command{
		Use:           "orchd",
		Short:         "Local control plane for coding agents",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(version, installSource)
		},
	}

	cmd.AddCommand(newServeCmd(version, installSource))
	cmd.AddCommand(newDoctorCmd(version, installSource))
	cmd.AddCommand(newVersionCmd(version))

	return cmd
}

func newServeCmd(version string, installSource string) *cobra.Command {
	return &cobra.Command{
		Use:           "serve",
		Short:         "Start the orchd HTTP server",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(version, installSource)
		},
	}
}

func runServe(version string, installSource string) error {
	cfg, err := app.LoadConfig(version, installSource)
	if err != nil {
		slog.Error("load config", "error", err)
		return err
	}

	runtime, err := app.NewRuntime(cfg)
	if err != nil {
		slog.Error("bootstrap runtime", "error", err)
		return err
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
		return err
	}
	return nil
}
