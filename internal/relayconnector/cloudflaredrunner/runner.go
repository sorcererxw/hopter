package cloudflaredrunner

import (
	"context"
	"fmt"
	"log/slog"
	"strings"
	"time"

	"github.com/cloudflare/cloudflared/cmd/cloudflared/cliutil"
	cfdflags "github.com/cloudflare/cloudflared/cmd/cloudflared/flags"
	"github.com/cloudflare/cloudflared/cmd/cloudflared/tunnel"
	"github.com/urfave/cli/v2"
)

type Runner struct{}

func (Runner) Start(ctx context.Context, token string) error {
	token = strings.TrimSpace(token)
	if token == "" {
		return fmt.Errorf("missing connector token")
	}

	shutdown := make(chan struct{})
	tunnel.Init(cliutil.GetBuildInfo("hopter", "embedded"), shutdown)

	app := cli.NewApp()
	app.Name = "hopter-relay-connector"
	app.Usage = "Hopter relay connector"
	app.Flags = tunnel.Flags()
	app.Commands = tunnel.Commands()

	errCh := make(chan error, 1)
	go func() {
		errCh <- app.RunContext(ctx, []string{
			"hopter-relay-connector",
			"--" + cfdflags.NoAutoUpdate,
			"--" + cfdflags.LogLevel,
			"fatal",
			"tunnel",
			"run",
			"--" + tunnel.TunnelTokenFlag,
			token,
		})
	}()

	go func() {
		<-ctx.Done()
		close(shutdown)
	}()

	select {
	case err := <-errCh:
		if err != nil {
			return err
		}
		return fmt.Errorf("relay connector exited before establishing a long-running process")
	case <-time.After(250 * time.Millisecond):
		go func() {
			if err := <-errCh; err != nil && ctx.Err() == nil {
				slog.Warn("relay connector exited", "error", err)
			}
		}()
		return nil
	}
}
