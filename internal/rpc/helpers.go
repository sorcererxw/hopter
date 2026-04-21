package rpcserver

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"github.com/sorcererxw/hopter/internal/core"
	hopterv1 "github.com/sorcererxw/hopter/internal/gen/proto/hopter/v1"
)

func mapHostState(state core.HostState) hopterv1.HostStatusKind {
	switch state {
	case core.HostStateHealthy:
		return hopterv1.HostStatusKind_HOST_STATUS_KIND_HEALTHY
	case core.HostStateDegraded:
		return hopterv1.HostStatusKind_HOST_STATUS_KIND_DEGRADED
	case core.HostStateUnavailable:
		return hopterv1.HostStatusKind_HOST_STATUS_KIND_UNAVAILABLE
	default:
		return hopterv1.HostStatusKind_HOST_STATUS_KIND_UNSPECIFIED
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

func mapArtifactKind(kind core.ArtifactKind) hopterv1.ArtifactKind {
	switch kind {
	case core.ArtifactKindSummary:
		return hopterv1.ArtifactKind_ARTIFACT_KIND_SUMMARY
	case core.ArtifactKindChangedFiles:
		return hopterv1.ArtifactKind_ARTIFACT_KIND_CHANGED_FILES
	case core.ArtifactKindTestResult:
		return hopterv1.ArtifactKind_ARTIFACT_KIND_TEST_RESULT
	case core.ArtifactKindScreenshot:
		return hopterv1.ArtifactKind_ARTIFACT_KIND_SCREENSHOT
	case core.ArtifactKindLog:
		return hopterv1.ArtifactKind_ARTIFACT_KIND_LOG
	case core.ArtifactKindOther:
		return hopterv1.ArtifactKind_ARTIFACT_KIND_OTHER
	default:
		return hopterv1.ArtifactKind_ARTIFACT_KIND_UNSPECIFIED
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

func timestamp(t time.Time) *timestamppb.Timestamp {
	if t.IsZero() {
		return nil
	}
	return timestamppb.New(t)
}

func projectToProto(project core.Project) *hopterv1.Project {
	return &hopterv1.Project{
		Id:             project.ID,
		Name:           validUTF8(project.Name),
		RootPath:       validUTF8(project.RootPath),
		DefaultBackend: validUTF8(project.DefaultBackend),
		CreatedAt:      timestamp(project.CreatedAt),
		UpdatedAt:      timestamp(project.UpdatedAt),
	}
}

func projectRef(project core.Project) *hopterv1.ProjectRef {
	return &hopterv1.ProjectRef{
		Id:       project.ID,
		Name:     validUTF8(project.Name),
		RootPath: validUTF8(project.RootPath),
	}
}

func directoryRootToProto(root core.DirectoryRoot) *hopterv1.DirectoryRoot {
	return &hopterv1.DirectoryRoot{
		Label: root.Label,
		Path:  root.Path,
		Kind:  root.Kind,
	}
}

func directoryEntryToProto(entry core.DirectoryEntry) *hopterv1.DirectoryEntry {
	return &hopterv1.DirectoryEntry{
		Name:        entry.Name,
		Path:        entry.Path,
		IsDirectory: entry.IsDirectory,
		IsRepo:      entry.IsRepo,
		HasChildren: entry.HasChildren,
		IsAllowed:   entry.IsAllowed,
	}
}

func directoryListingToProto(listing core.DirectoryListing) *hopterv1.DirectoryListing {
	entries := make([]*hopterv1.DirectoryEntry, 0, len(listing.Entries))
	for _, entry := range listing.Entries {
		entries = append(entries, directoryEntryToProto(entry))
	}
	return &hopterv1.DirectoryListing{
		CurrentPath: listing.CurrentPath,
		ParentPath:  listing.ParentPath,
		Entries:     entries,
	}
}

func pathMetadataToProto(metadata core.PathMetadata) *hopterv1.PathMetadata {
	return &hopterv1.PathMetadata{
		Path:                metadata.Path,
		CanonicalPath:       metadata.CanonicalPath,
		Basename:            metadata.Basename,
		IsDirectory:         metadata.IsDirectory,
		IsRepo:              metadata.IsRepo,
		IsAllowed:           metadata.IsAllowed,
		ChildDirectoryCount: uint32(metadata.ChildDirectoryCount),
		ChildFileCount:      uint32(metadata.ChildFileCount),
		ModifiedAt:          timestamp(metadata.ModifiedAt),
	}
}

func sessionToProto(project core.Project, session core.Session) *hopterv1.Session {
	artifacts := make([]*hopterv1.ArtifactRef, 0, len(session.Artifacts))
	for _, artifact := range session.Artifacts {
		artifacts = append(artifacts, &hopterv1.ArtifactRef{
			Id:          artifact.ID,
			Kind:        mapArtifactKind(artifact.Kind),
			Label:       validUTF8(artifact.Label),
			CreatedAt:   timestamp(artifact.CreatedAt),
			DownloadUrl: validUTF8(artifact.DownloadURL),
			ContentType: validUTF8(artifact.ContentType),
		})
	}
	transcriptItems := make([]*hopterv1.SessionTranscriptItem, 0, len(session.TranscriptItems))
	for _, item := range session.TranscriptItems {
		transcriptItems = append(transcriptItems, sessionTranscriptItemToProto(item))
	}
	return &hopterv1.Session{
		Id:                session.ID,
		Title:             validUTF8(session.Title),
		BackendKey:        validUTF8(session.BackendKey),
		Project:           projectRef(project),
		Status:            mapSessionState(session.Status),
		Summary:           validUTF8(session.Summary),
		AttentionRequired: session.AttentionRequired,
		AttentionReason:   validUTF8(session.AttentionReason),
		LastInputHint:     validUTF8(session.LastInputHint),
		UpdatedAt:         timestamp(session.UpdatedAt),
		Artifacts:         artifacts,
		TranscriptItems:   transcriptItems,
		PendingApprovalId: optionalString(session.PendingApprovalID),
	}
}

func sessionMetaToProto(meta core.SessionMeta) *hopterv1.SessionMeta {
	artifacts := make([]*hopterv1.ArtifactRef, 0, len(meta.Session.Artifacts))
	for _, artifact := range meta.Session.Artifacts {
		artifacts = append(artifacts, &hopterv1.ArtifactRef{
			Id:          artifact.ID,
			Kind:        mapArtifactKind(artifact.Kind),
			Label:       validUTF8(artifact.Label),
			CreatedAt:   timestamp(artifact.CreatedAt),
			DownloadUrl: validUTF8(artifact.DownloadURL),
			ContentType: validUTF8(artifact.ContentType),
		})
	}
	return &hopterv1.SessionMeta{
		Id:                 meta.Session.ID,
		Title:              validUTF8(meta.Session.Title),
		BackendKey:         validUTF8(meta.Session.BackendKey),
		Project:            projectRef(meta.Project),
		Status:             mapSessionState(meta.Session.Status),
		Summary:            validUTF8(meta.Session.Summary),
		AttentionRequired:  meta.Session.AttentionRequired,
		AttentionReason:    validUTF8(meta.Session.AttentionReason),
		LastInputHint:      validUTF8(meta.Session.LastInputHint),
		UpdatedAt:          timestamp(meta.Session.UpdatedAt),
		Artifacts:          artifacts,
		HasMoreBefore:      meta.HasMoreBefore,
		LatestPageSizeHint: meta.LatestPageSizeHint,
		ResumeCommand:      buildCodexResumeCommand(meta.Project.RootPath, meta.Session),
		PendingApprovalId:  optionalString(meta.Session.PendingApprovalID),
	}
}

func sessionReviewToProto(review core.SessionReview) *hopterv1.SessionReview {
	files := make([]*hopterv1.SessionReviewFile, 0, len(review.Files))
	for _, file := range review.Files {
		files = append(files, &hopterv1.SessionReviewFile{
			Path:         validUTF8(file.Path),
			Kind:         validUTF8(file.Kind),
			MovePath:     optionalString(file.MovePath),
			Additions:    uint32(file.Additions),
			Deletions:    uint32(file.Deletions),
			Diff:         validUTF8(file.Diff),
			DisplayLabel: validUTF8(file.DisplayLabel),
		})
	}

	return &hopterv1.SessionReview{
		SessionId:             validUTF8(review.SessionID),
		ProjectId:             validUTF8(review.ProjectID),
		Available:             review.Available,
		TurnId:                validUTF8(review.TurnID),
		Reason:                validUTF8(review.Reason),
		FullPatch:             validUTF8(review.FullPatch),
		Files:                 files,
		GeneratedAt:           timestamp(review.GeneratedAt),
		PendingTurnInProgress: review.PendingTurnInProgress,
	}
}

func sessionFileToProto(file core.SessionFile) *hopterv1.SessionFile {
	return &hopterv1.SessionFile{
		SessionId:     validUTF8(file.SessionID),
		ProjectId:     validUTF8(file.ProjectID),
		Available:     file.Available,
		RequestedPath: validUTF8(file.RequestedPath),
		CanonicalPath: validUTF8(file.CanonicalPath),
		DisplayPath:   validUTF8(file.DisplayPath),
		Content:       validUTF8(file.Content),
		Reason:        validUTF8(file.Reason),
		Truncated:     file.Truncated,
		IsBinary:      file.IsBinary,
		LineCount:     uint32(file.LineCount),
		InitialLine:   uint32(file.InitialLine),
		InitialColumn: uint32(file.InitialColumn),
	}
}

func buildCodexResumeCommand(rootPath string, session core.Session) string {
	if strings.TrimSpace(session.BackendKey) != "codex" {
		return ""
	}

	threadID := strings.TrimSpace(session.BackendThreadID)
	cwd := strings.TrimSpace(rootPath)
	if threadID == "" || cwd == "" {
		return ""
	}

	return fmt.Sprintf(
		"codex -C %s resume %s",
		strconv.Quote(cwd),
		strconv.Quote(threadID),
	)
}

func sessionTranscriptPageToProto(page core.SessionTranscriptPage) *hopterv1.SessionTranscriptPage {
	items := make([]*hopterv1.SessionTranscriptItem, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, sessionTranscriptItemToProto(item))
	}
	return &hopterv1.SessionTranscriptPage{
		Items:             items,
		NextBeforeCursor:  optionalString(page.NextBeforeCursor),
		HasMoreBefore:     page.HasMoreBefore,
		SnapshotUpdatedAt: timestamp(page.SnapshotUpdatedAt),
	}
}

func sessionTranscriptItemToProto(item core.SessionTranscriptItem) *hopterv1.SessionTranscriptItem {
	attachments := make([]*hopterv1.SessionTranscriptAttachment, 0, len(item.Attachments))
	for _, attachment := range item.Attachments {
		attachments = append(attachments, &hopterv1.SessionTranscriptAttachment{
			Id:          validUTF8(attachment.ID),
			Kind:        mapTranscriptAttachmentKind(attachment.Kind),
			Label:       validUTF8(attachment.Label),
			Path:        validUTF8(attachment.Path),
			Url:         validUTF8(attachment.URL),
			ContentType: validUTF8(attachment.ContentType),
		})
	}

	return &hopterv1.SessionTranscriptItem{
		Id:          validUTF8(item.ID),
		Kind:        mapTranscriptItemKind(item.Kind),
		Title:       validUTF8(item.Title),
		Body:        validUTF8(item.Body),
		Status:      validUTF8(item.Status),
		DisplayBody: validUTF8(item.DisplayBody),
		Attachments: attachments,
	}
}

func sessionListItemToProto(project core.Project, session core.Session) *hopterv1.SessionListItem {
	return &hopterv1.SessionListItem{
		Id:                session.ID,
		Title:             validUTF8(session.Title),
		BackendKey:        validUTF8(session.BackendKey),
		Project:           projectRef(project),
		Status:            mapSessionState(session.Status),
		UpdatedAt:         timestamp(session.UpdatedAt),
		AttentionRequired: session.AttentionRequired,
	}
}

func validUTF8(value string) string {
	return strings.ToValidUTF8(value, "")
}

func optionalString(value string) *string {
	normalized := validUTF8(value)
	if normalized == "" {
		return nil
	}
	return &normalized
}
