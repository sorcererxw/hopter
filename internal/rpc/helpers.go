package rpcserver

import (
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
		Id:   project.ID,
		Name: validUTF8(project.Name),
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
	return &orchdv1.Session{
		Id:                session.ID,
		Title:             validUTF8(session.Title),
		Project:           projectRef(project),
		Status:            mapSessionState(session.Status),
		Summary:           validUTF8(session.Summary),
		AttentionRequired: session.AttentionRequired,
		AttentionReason:   validUTF8(session.AttentionReason),
		LastInputHint:     validUTF8(session.LastInputHint),
		UpdatedAt:         timestamp(session.UpdatedAt),
		Artifacts:         artifacts,
	}
}

func sessionListItemToProto(project core.Project, session core.Session) *orchdv1.SessionListItem {
	return &orchdv1.SessionListItem{
		Id:                session.ID,
		Title:             validUTF8(session.Title),
		Project:           projectRef(project),
		Status:            mapSessionState(session.Status),
		UpdatedAt:         timestamp(session.UpdatedAt),
		AttentionRequired: session.AttentionRequired,
	}
}

func validUTF8(value string) string {
	return strings.ToValidUTF8(value, "")
}
