package main

import (
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"net"
	"net/http"
	"os"
	"os/signal"
	"strconv"
	"strings"
	"syscall"
	"time"

	"github.com/spf13/cobra"

	"github.com/sorcererxw/hopter/internal/app"
)

func newRootCmd(version string, installSource string) *cobra.Command {
	cmd := &cobra.Command{
		Use:           "hopter",
		Short:         "Local control plane for coding agents",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(version, installSource, cmd.OutOrStdout())
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
		Short:         "Start the hopter HTTP server",
		SilenceUsage:  true,
		SilenceErrors: true,
		RunE: func(cmd *cobra.Command, args []string) error {
			return runServe(version, installSource, cmd.OutOrStdout())
		},
	}
}

func runServe(version string, installSource string, out io.Writer) error {
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

	slog.Info("hopter listening", "addr", cfg.HTTP.Addr(), "ui_mode", cfg.UI.Mode())
	printServeReady(out, cfg)
	if err := runtime.Server.ListenAndServe(); err != nil && !errors.Is(err, http.ErrServerClosed) {
		slog.Error("serve", "error", err)
		return err
	}
	return nil
}

func printServeReady(out io.Writer, cfg app.Config) {
	if out == nil {
		return
	}

	browserURL := localBrowserURL(cfg.HTTP)
	bindURL := "http://" + cfg.HTTP.Addr()
	fmt.Fprintf(out, "hopter is running\n\n")
	fmt.Fprintf(out, "  Open: %s\n", browserURL)
	if bindURL != browserURL {
		fmt.Fprintf(out, "  Bind: %s\n", bindURL)
	}
	fmt.Fprintf(out, "  Stop: Ctrl+C\n\n")
}

func localBrowserURL(cfg app.HTTPConfig) string {
	host := strings.TrimSpace(cfg.Host)
	switch strings.ToLower(host) {
	case "", "0.0.0.0", "::", "[::]":
		host = "127.0.0.1"
	}
	host = strings.TrimPrefix(strings.TrimSuffix(host, "]"), "[")
	return "http://" + net.JoinHostPort(host, strconv.Itoa(cfg.Port))
}
