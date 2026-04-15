package events

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

type Hub struct {
	mu          sync.RWMutex
	nextSubID   uint64
	nextEventID uint64
	subscribers map[uint64]chan *orchdv1.WorkspaceEvent
}

func NewHub() *Hub {
	return &Hub{
		subscribers: make(map[uint64]chan *orchdv1.WorkspaceEvent),
	}
}

func (h *Hub) Publish(event core.Event) {
	evt := h.toProto(event)
	if evt == nil {
		return
	}

	h.mu.RLock()
	defer h.mu.RUnlock()
	for _, subscriber := range h.subscribers {
		select {
		case subscriber <- evt:
		default:
		}
	}
}

func (h *Hub) Subscribe(ctx context.Context) <-chan *orchdv1.WorkspaceEvent {
	id := atomic.AddUint64(&h.nextSubID, 1)
	ch := make(chan *orchdv1.WorkspaceEvent, 16)

	h.mu.Lock()
	h.subscribers[id] = ch
	h.mu.Unlock()

	go func() {
		<-ctx.Done()
		h.mu.Lock()
		delete(h.subscribers, id)
		close(ch)
		h.mu.Unlock()
	}()

	return ch
}

func (h *Hub) toProto(event core.Event) *orchdv1.WorkspaceEvent {
	var (
		eventType   orchdv1.WorkspaceEventType
		refreshHint orchdv1.RefreshHint
	)

	switch event.Kind {
	case core.EventHostChanged:
		eventType = orchdv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_HOST_STATUS_CHANGED
		refreshHint = orchdv1.RefreshHint_REFRESH_HINT_REFETCH_HOST
	case core.EventProjectsChanged:
		eventType = orchdv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_PROJECTS_CHANGED
		refreshHint = orchdv1.RefreshHint_REFRESH_HINT_REFETCH_PROJECTS
	case core.EventSessionsChanged:
		eventType = orchdv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_SESSIONS_CHANGED
		refreshHint = orchdv1.RefreshHint_REFRESH_HINT_REFETCH_SESSIONS
	case core.EventSessionChanged:
		eventType = orchdv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_SESSION_CHANGED
		refreshHint = orchdv1.RefreshHint_REFRESH_HINT_REFETCH_SESSION
	case core.EventSessionArtifactsChanged:
		eventType = orchdv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_SESSION_ARTIFACTS_CHANGED
		refreshHint = orchdv1.RefreshHint_REFRESH_HINT_REFETCH_ARTIFACTS
	default:
		return nil
	}

	id := atomic.AddUint64(&h.nextEventID, 1)
	evt := &orchdv1.WorkspaceEvent{
		Id:         fmt.Sprintf("evt_%06d", id),
		Type:       eventType,
		OccurredAt: timestamppb.New(time.Now().UTC()),
		Payload: &orchdv1.WorkspaceEventPayload{
			RefreshHint: refreshHint,
			Summary:     event.Summary,
		},
	}
	if event.ProjectID != "" {
		evt.ProjectId = &event.ProjectID
	}
	if event.SessionID != "" {
		evt.SessionId = &event.SessionID
	}
	return evt
}
