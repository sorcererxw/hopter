import type { Timestamp } from "@bufbuild/protobuf/wkt"

import { ArtifactKind, SessionStatus } from "@/gen/proto/orchd/v1/common_pb"

export function formatSessionStatus(status: SessionStatus) {
  switch (status) {
    case SessionStatus.PENDING:
      return "pending"
    case SessionStatus.RUNNING:
      return "running"
    case SessionStatus.WAITING_INPUT:
      return "waiting for input"
    case SessionStatus.WAITING_APPROVAL:
      return "waiting for approval"
    case SessionStatus.COMPLETED:
      return "completed"
    case SessionStatus.FAILED:
      return "failed"
    case SessionStatus.DEGRADED:
      return "degraded"
    case SessionStatus.UNSPECIFIED:
    default:
      return "unspecified"
  }
}

export function formatArtifactKind(kind: ArtifactKind) {
  switch (kind) {
    case ArtifactKind.SUMMARY:
      return "summary"
    case ArtifactKind.CHANGED_FILES:
      return "changed files"
    case ArtifactKind.TEST_RESULT:
      return "test result"
    case ArtifactKind.SCREENSHOT:
      return "screenshot"
    case ArtifactKind.LOG:
      return "log"
    case ArtifactKind.OTHER:
      return "other"
    case ArtifactKind.UNSPECIFIED:
    default:
      return "artifact"
  }
}

export function timestampToDate(timestamp?: Timestamp) {
  if (!timestamp) {
    return undefined
  }

  const seconds = Number(timestamp.seconds ?? 0)
  const nanos = timestamp.nanos ?? 0

  return new Date(seconds * 1000 + Math.floor(nanos / 1_000_000))
}

export function formatUpdatedAt(timestamp?: Timestamp) {
  const date = timestampToDate(timestamp)
  if (!date) {
    return "Waiting for activity"
  }

  return new Intl.DateTimeFormat(undefined, {
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}
