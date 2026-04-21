package events

import (
	"context"
	"testing"
	"time"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
)

func TestHubPublishesConfigChangedRefreshHint(t *testing.T) {
	hub := NewHub()
	ctx, cancel := context.WithCancel(context.Background())
	defer cancel()
	stream := hub.Subscribe(ctx)

	hub.Publish(core.Event{Kind: core.EventConfigChanged})

	select {
	case event := <-stream:
		if event.GetType() != hopterv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_CONFIG_CHANGED {
			t.Fatalf("event type = %v, want config changed", event.GetType())
		}
		if event.GetPayload().GetRefreshHint() != hopterv1.RefreshHint_REFRESH_HINT_REFETCH_CONFIG {
			t.Fatalf("refresh hint = %v, want refetch config", event.GetPayload().GetRefreshHint())
		}
	case <-time.After(time.Second):
		t.Fatal("timed out waiting for config event")
	}
}
