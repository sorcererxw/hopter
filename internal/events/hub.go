package events

import (
	"context"
	"fmt"
	"sync"
	"sync/atomic"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
)

type Hub struct {
	mu          sync.RWMutex
	nextSubID   uint64
	nextEventID uint64
	subscribers map[uint64]chan *hopterv1.WorkspaceEvent
}

func NewHub() *Hub {
	return &Hub{
		subscribers: make(map[uint64]chan *hopterv1.WorkspaceEvent),
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

func (h *Hub) Subscribe(ctx context.Context) <-chan *hopterv1.WorkspaceEvent {
	id := atomic.AddUint64(&h.nextSubID, 1)
	ch := make(chan *hopterv1.WorkspaceEvent, 16)

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

func (h *Hub) toProto(event core.Event) *hopterv1.WorkspaceEvent {
	var (
		eventType   hopterv1.WorkspaceEventType
		refreshHint hopterv1.RefreshHint
	)

	switch event.Kind {
	case core.EventHostChanged:
		eventType = hopterv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_HOST_STATUS_CHANGED
		refreshHint = hopterv1.RefreshHint_REFRESH_HINT_REFETCH_HOST
	case core.EventConfigChanged:
		eventType = hopterv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_CONFIG_CHANGED
		refreshHint = hopterv1.RefreshHint_REFRESH_HINT_REFETCH_CONFIG
	case core.EventProjectsChanged:
		eventType = hopterv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_PROJECTS_CHANGED
		refreshHint = hopterv1.RefreshHint_REFRESH_HINT_REFETCH_PROJECTS
	case core.EventSessionsChanged:
		eventType = hopterv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_SESSIONS_CHANGED
		refreshHint = hopterv1.RefreshHint_REFRESH_HINT_REFETCH_SESSIONS
	case core.EventSessionChanged:
		eventType = hopterv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_SESSION_CHANGED
		refreshHint = hopterv1.RefreshHint_REFRESH_HINT_REFETCH_SESSION
	case core.EventSessionArtifactsChanged:
		eventType = hopterv1.WorkspaceEventType_WORKSPACE_EVENT_TYPE_SESSION_ARTIFACTS_CHANGED
		refreshHint = hopterv1.RefreshHint_REFRESH_HINT_REFETCH_ARTIFACTS
	default:
		return nil
	}

	id := atomic.AddUint64(&h.nextEventID, 1)
	evt := &hopterv1.WorkspaceEvent{
		Id:         fmt.Sprintf("evt_%06d", id),
		Type:       eventType,
		OccurredAt: timestamppb.New(time.Now().UTC()),
		Payload: &hopterv1.WorkspaceEventPayload{
			RefreshHint:      refreshHint,
			Summary:          event.Summary,
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

func sessionLivePatchToProto(patch *core.SessionLivePatch) *hopterv1.SessionLivePatch {
	if patch == nil {
		return nil
	}

	out := &hopterv1.SessionLivePatch{
		Kind:            mapSessionLivePatchKind(patch.Kind),
		ActiveTurnId:    patch.ActiveTurnID,
		DraftItemId:     patch.DraftItemID,
		DraftDelta:      patch.DraftDelta,
		Status:          mapSessionState(patch.Status),
		Summary:         patch.Summary,
		RequiresRefetch: patch.RequiresRefetch,
	}
	if patch.FinalItem != nil {
		out.FinalItem = sessionTranscriptItemToProto(*patch.FinalItem)
	}
	return out
}

func sessionTranscriptItemToProto(item core.SessionTranscriptItem) *hopterv1.SessionTranscriptItem {
	attachments := make([]*hopterv1.SessionTranscriptAttachment, 0, len(item.Attachments))
	for _, attachment := range item.Attachments {
		attachments = append(attachments, &hopterv1.SessionTranscriptAttachment{
			Id:          attachment.ID,
			Kind:        mapTranscriptAttachmentKind(attachment.Kind),
			Label:       attachment.Label,
			Path:        attachment.Path,
			Url:         attachment.URL,
			ContentType: attachment.ContentType,
		})
	}

	return &hopterv1.SessionTranscriptItem{
		Id:          item.ID,
		Kind:        mapTranscriptItemKind(item.Kind),
		Title:       item.Title,
		Body:        item.Body,
		Status:      item.Status,
		DisplayBody: item.DisplayBody,
		Attachments: attachments,
	}
}

func mapTranscriptAttachmentKind(kind core.SessionTranscriptAttachmentKind) hopterv1.SessionTranscriptAttachmentKind {
	switch kind {
	case core.SessionTranscriptAttachmentKindImage:
		return hopterv1.SessionTranscriptAttachmentKind_SESSION_TRANSCRIPT_ATTACHMENT_KIND_IMAGE
	case core.SessionTranscriptAttachmentKindFile:
		return hopterv1.SessionTranscriptAttachmentKind_SESSION_TRANSCRIPT_ATTACHMENT_KIND_FILE
	default:
		return hopterv1.SessionTranscriptAttachmentKind_SESSION_TRANSCRIPT_ATTACHMENT_KIND_UNSPECIFIED
	}
}

func mapSessionLivePatchKind(kind core.SessionLivePatchKind) hopterv1.SessionLivePatchKind {
	switch kind {
	case core.SessionLivePatchKindStatus:
		return hopterv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_STATUS
	case core.SessionLivePatchKindDraftDelta:
		return hopterv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_DRAFT_DELTA
	case core.SessionLivePatchKindMessageFinalized:
		return hopterv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_MESSAGE_FINALIZED
	case core.SessionLivePatchKindReconcileRequired:
		return hopterv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_RECONCILE_REQUIRED
	default:
		return hopterv1.SessionLivePatchKind_SESSION_LIVE_PATCH_KIND_UNSPECIFIED
	}
}

func mapSessionState(state core.SessionState) hopterv1.SessionStatus {
	switch state {
	case core.SessionStatePending:
		return hopterv1.SessionStatus_SESSION_STATUS_PENDING
	case core.SessionStateRunning:
		return hopterv1.SessionStatus_SESSION_STATUS_RUNNING
	case core.SessionStateWaitingInput:
		return hopterv1.SessionStatus_SESSION_STATUS_WAITING_INPUT
	case core.SessionStateWaitingApproval:
		return hopterv1.SessionStatus_SESSION_STATUS_WAITING_APPROVAL
	case core.SessionStateCompleted:
		return hopterv1.SessionStatus_SESSION_STATUS_COMPLETED
	case core.SessionStateFailed:
		return hopterv1.SessionStatus_SESSION_STATUS_FAILED
	case core.SessionStateDegraded:
		return hopterv1.SessionStatus_SESSION_STATUS_DEGRADED
	default:
		return hopterv1.SessionStatus_SESSION_STATUS_UNSPECIFIED
	}
}

func mapTranscriptItemKind(kind core.SessionTranscriptItemKind) hopterv1.SessionTranscriptItemKind {
	switch kind {
	case core.SessionTranscriptItemKindUserMessage:
		return hopterv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE
	case core.SessionTranscriptItemKindAgentMessage:
		return hopterv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE
	case core.SessionTranscriptItemKindReasoning:
		return hopterv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_REASONING
	case core.SessionTranscriptItemKindToolCall:
		return hopterv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_TOOL_CALL
	case core.SessionTranscriptItemKindCommandExecution:
		return hopterv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION
	case core.SessionTranscriptItemKindFileChange:
		return hopterv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE
	default:
		return hopterv1.SessionTranscriptItemKind_SESSION_TRANSCRIPT_ITEM_KIND_UNSPECIFIED
	}
}
