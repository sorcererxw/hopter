package rpcserver

import (
	"fmt"
	"strconv"
	"strings"
	"time"

	"google.golang.org/protobuf/types/known/timestamppb"

	"orchd/internal/core"
	orchdv1 "orchd/internal/gen/proto/orchd/v1"
)

func mapHostState(state core.HostState) orchdv1.HostStatusKind {
	switch state {
	case core.HostStateHealthy:
		return orchdv1.HostStatusKind_HOST_STATUS_KIND_HEALTHY
	case core.HostStateDegraded:
		return orchdv1.HostStatusKind_HOST_STATUS_KIND_DEGRADED
	case core.HostStateUnavailable:
		return orchdv1.HostStatusKind_HOST_STATUS_KIND_UNAVAILABLE
	default:
		return orchdv1.HostStatusKind_HOST_STATUS_KIND_UNSPECIFIED
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

func mapArtifactKind(kind core.ArtifactKind) orchdv1.ArtifactKind {
	switch kind {
	case core.ArtifactKindSummary:
		return orchdv1.ArtifactKind_ARTIFACT_KIND_SUMMARY
	case core.ArtifactKindChangedFiles:
		return orchdv1.ArtifactKind_ARTIFACT_KIND_CHANGED_FILES
	case core.ArtifactKindTestResult:
		return orchdv1.ArtifactKind_ARTIFACT_KIND_TEST_RESULT
	case core.ArtifactKindScreenshot:
		return orchdv1.ArtifactKind_ARTIFACT_KIND_SCREENSHOT
	case core.ArtifactKindLog:
		return orchdv1.ArtifactKind_ARTIFACT_KIND_LOG
	case core.ArtifactKindOther:
		return orchdv1.ArtifactKind_ARTIFACT_KIND_OTHER
	default:
		return orchdv1.ArtifactKind_ARTIFACT_KIND_UNSPECIFIED
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

func timestamp(t time.Time) *timestamppb.Timestamp {
	if t.IsZero() {
		return nil
	}
	return timestamppb.New(t)
}

func projectToProto(project core.Project) *orchdv1.Project {
	return &orchdv1.Project{
		Id:             project.ID,
		Name:           validUTF8(project.Name),
		RootPath:       validUTF8(project.RootPath),
		DefaultBackend: validUTF8(project.DefaultBackend),
		CreatedAt:      timestamp(project.CreatedAt),
		UpdatedAt:      timestamp(project.UpdatedAt),
	}
}

func projectRef(project core.Project) *orchdv1.ProjectRef {
	return &orchdv1.ProjectRef{
		Id:       project.ID,
		Name:     validUTF8(project.Name),
		RootPath: validUTF8(project.RootPath),
	}
}

func directoryRootToProto(root core.DirectoryRoot) *orchdv1.DirectoryRoot {
	return &orchdv1.DirectoryRoot{
		Label: root.Label,
		Path:  root.Path,
		Kind:  root.Kind,
	}
}

func directoryEntryToProto(entry core.DirectoryEntry) *orchdv1.DirectoryEntry {
	return &orchdv1.DirectoryEntry{
		Name:        entry.Name,
		Path:        entry.Path,
		IsDirectory: entry.IsDirectory,
		IsRepo:      entry.IsRepo,
		HasChildren: entry.HasChildren,
		IsAllowed:   entry.IsAllowed,
	}
}

func directoryListingToProto(listing core.DirectoryListing) *orchdv1.DirectoryListing {
	entries := make([]*orchdv1.DirectoryEntry, 0, len(listing.Entries))
	for _, entry := range listing.Entries {
		entries = append(entries, directoryEntryToProto(entry))
	}
	return &orchdv1.DirectoryListing{
		CurrentPath: listing.CurrentPath,
		ParentPath:  listing.ParentPath,
		Entries:     entries,
	}
}

func pathMetadataToProto(metadata core.PathMetadata) *orchdv1.PathMetadata {
	return &orchdv1.PathMetadata{
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

func sessionToProto(project core.Project, session core.Session) *orchdv1.Session {
	artifacts := make([]*orchdv1.ArtifactRef, 0, len(session.Artifacts))
	for _, artifact := range session.Artifacts {
		artifacts = append(artifacts, &orchdv1.ArtifactRef{
			Id:          artifact.ID,
			Kind:        mapArtifactKind(artifact.Kind),
			Label:       validUTF8(artifact.Label),
			CreatedAt:   timestamp(artifact.CreatedAt),
			DownloadUrl: validUTF8(artifact.DownloadURL),
			ContentType: validUTF8(artifact.ContentType),
		})
	}
	transcriptItems := make([]*orchdv1.SessionTranscriptItem, 0, len(session.TranscriptItems))
	for _, item := range session.TranscriptItems {
		transcriptItems = append(transcriptItems, &orchdv1.SessionTranscriptItem{
			Id:     item.ID,
			Kind:   mapTranscriptItemKind(item.Kind),
			Title:  validUTF8(item.Title),
			Body:   validUTF8(item.Body),
			Status: validUTF8(item.Status),
		})
	}
	return &orchdv1.Session{
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

func sessionMetaToProto(meta core.SessionMeta) *orchdv1.SessionMeta {
	artifacts := make([]*orchdv1.ArtifactRef, 0, len(meta.Session.Artifacts))
	for _, artifact := range meta.Session.Artifacts {
		artifacts = append(artifacts, &orchdv1.ArtifactRef{
			Id:          artifact.ID,
			Kind:        mapArtifactKind(artifact.Kind),
			Label:       validUTF8(artifact.Label),
			CreatedAt:   timestamp(artifact.CreatedAt),
			DownloadUrl: validUTF8(artifact.DownloadURL),
			ContentType: validUTF8(artifact.ContentType),
		})
	}
	return &orchdv1.SessionMeta{
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

func sessionReviewToProto(review core.SessionReview) *orchdv1.SessionReview {
	files := make([]*orchdv1.SessionReviewFile, 0, len(review.Files))
	for _, file := range review.Files {
		files = append(files, &orchdv1.SessionReviewFile{
			Path:         validUTF8(file.Path),
			Kind:         validUTF8(file.Kind),
			MovePath:     optionalString(file.MovePath),
			Additions:    uint32(file.Additions),
			Deletions:    uint32(file.Deletions),
			Diff:         validUTF8(file.Diff),
			DisplayLabel: validUTF8(file.DisplayLabel),
		})
	}

	return &orchdv1.SessionReview{
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

func sessionFileToProto(file core.SessionFile) *orchdv1.SessionFile {
	return &orchdv1.SessionFile{
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

func sessionTranscriptPageToProto(page core.SessionTranscriptPage) *orchdv1.SessionTranscriptPage {
	items := make([]*orchdv1.SessionTranscriptItem, 0, len(page.Items))
	for _, item := range page.Items {
		items = append(items, &orchdv1.SessionTranscriptItem{
			Id:     item.ID,
			Kind:   mapTranscriptItemKind(item.Kind),
			Title:  validUTF8(item.Title),
			Body:   validUTF8(item.Body),
			Status: validUTF8(item.Status),
		})
	}
	return &orchdv1.SessionTranscriptPage{
		Items:             items,
		NextBeforeCursor:  optionalString(page.NextBeforeCursor),
		HasMoreBefore:     page.HasMoreBefore,
		SnapshotUpdatedAt: timestamp(page.SnapshotUpdatedAt),
	}
}

func sessionListItemToProto(project core.Project, session core.Session) *orchdv1.SessionListItem {
	return &orchdv1.SessionListItem{
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
