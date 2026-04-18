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
			RefreshHint:     refreshHint,
			Summary:         event.Summary,
			SessionLivePatch: sessionLivePatchToProto(event.LivePatch),
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

func sessionLivePatchToProto(patch *core.SessionLivePatch) *orchdv1.SessionLivePatch {
	if patch == nil {
		return nil
	}

	out := &orchdv1.SessionLivePatch{
		Kind:            mapSessionLivePatchKind(patch.Kind),
		ActiveTurnId:    patch.ActiveTurnID,
		DraftItemId:     patch.DraftItemID,
		DraftDelta:      patch.DraftDelta,
		Status:          mapSessionState(patch.Status),
		Summary:         patch.Summary,
		RequiresRefetch: patch.RequiresRefetch,
	}
	if patch.FinalItem != nil {
		out.FinalItem = &orchdv1.SessionTranscriptItem{
			Id:     patch.FinalItem.ID,
			Kind:   mapTranscriptItemKind(patch.FinalItem.Kind),
			Title:  patch.FinalItem.Title,
			Body:   patch.FinalItem.Body,
			Status: patch.FinalItem.Status,
		}
	}
	return out
}

func mapSessionLivePatchKind(kind core.SessionLivePatchKind) orchdv1.SessionLivePatchKind {
	switch kind {
	case core.SessionLivePatchKindStatus:
		return orchdv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_STATUS
	case core.SessionLivePatchKindDraftDelta:
		return orchdv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_DRAFT_DELTA
	case core.SessionLivePatchKindMessageFinalized:
		return orchdv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_MESSAGE_FINALIZED
	case core.SessionLivePatchKindReconcileRequired:
		return orchdv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_RECONCILE_REQUIRED
	default:
		return orchdv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_UNSPECIFIED
	}
}

func mapSessionState(state core.SessionState) orchdv1.SessionStatus {
	switch state {
	case core.SessionStatePending:
		return orchdv1.SessionStatus_SESSION_STATUS_PENDING
	case core.SessionStateRunning:
		return orchdv1.SessionStatus_SESSION_STATUS_RUNNING
	case core.SessionStateWaitingInput:
		return orchdv1.SessionStatus_SESSION_STATUS_WAITING_INPUT
	case core.SessionStateWaitingApproval:
		return orchdv1.SessionStatus_SESSION_STATUS_WAITING_APPROVAL
	case core.SessionStateCompleted:
		return orchdv1.SessionStatus_SESSION_STATUS_COMPLETED
	case core.SessionStateFailed:
		return orchdv1.SessionStatus_SESSION_STATUS_FAILED
	case core.SessionStateDegraded:
		return orchdv1.SessionStatus_SESSION_STATUS_DEGRADED
	default:
		return orchdv1.SessionStatus_SESSION_STATUS_UNSPECIFIED
	}
}

func mapTranscriptItemKind(kind core.SessionTranscriptItemKind) orchdv1.SessionTranscriptItemKind {
	switch kind {
	case core.SessionTranscriptItemKindUserMessage:
		return orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE
	case core.SessionTranscriptItemKindAgentMessage:
		return orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE
	case core.SessionTranscriptItemKindReasoning:
		return orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_REASONING
	case core.SessionTranscriptItemKindToolCall:
		return orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_TOOL_CALL
	case core.SessionTranscriptItemKindCommandExecution:
		return orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION
	case core.SessionTranscriptItemKindFileChange:
		return orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE
	default:
		return orchdv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_UNSPECIFIED
	}
}
