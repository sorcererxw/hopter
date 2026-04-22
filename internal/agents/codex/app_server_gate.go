package codex

import (
	"context"
	"fmt"
)

const (
	maxConcurrentAppServerRequests = 4
	maxConcurrentAppServerStarts   = 2
)

var (
	appServerRequestQueue = make(chan struct{}, maxConcurrentAppServerRequests)
	appServerStartQueue   = make(chan struct{}, maxConcurrentAppServerStarts)
)

func enterAppServerRequestQueue(ctx context.Context) (func(), error) {
	return enterAppServerQueue(ctx, appServerRequestQueue, "app-server request")
}

func enterAppServerStartQueue(ctx context.Context) (func(), error) {
	return enterAppServerQueue(ctx, appServerStartQueue, "app-server start")
}

func enterAppServerQueue(
	ctx context.Context,
	queue chan struct{},
	label string,
) (func(), error) {
	if ctx == nil {
		ctx = context.Background()
	}

	select {
	case queue <- struct{}{}:
		return func() {
			<-queue
		}, nil
	case <-ctx.Done():
		return nil, fmt.Errorf("queue %s: %w", label, ctx.Err())
	}
}
