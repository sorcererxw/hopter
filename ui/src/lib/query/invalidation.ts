import type { QueryClient } from "@tanstack/react-query"

import { WorkspaceEventType } from "@/gen/proto/orchd/v1/events_pb"
import { queryKeys } from "@/lib/query/keys"

export type WorkspaceEventEnvelope = {
  payload?: {
    refreshHint?: string | number
  }
  type?: string | number
  sessionId?: string
  session_id?: string
  projectId?: string
  project_id?: string
}

export function applyWorkspaceEventInvalidation(
  client: QueryClient,
  event: WorkspaceEventEnvelope
) {
  const sessionId = event.sessionId || event.session_id
  const eventType = normalizeWorkspaceEventType(event.type)

  switch (eventType) {
    case WorkspaceEventType.HOST_STATUS_CHANGED:
      client.invalidateQueries({ queryKey: queryKeys.host() })
      return
    case WorkspaceEventType.PROJECTS_CHANGED:
      client.invalidateQueries({ queryKey: queryKeys.projects() })
      return
    case WorkspaceEventType.SESSIONS_CHANGED:
      client.invalidateQueries({ queryKey: queryKeys.sessions() })
      return
    case WorkspaceEventType.SESSION_CHANGED:
    case WorkspaceEventType.SESSION_ARTIFACTS_CHANGED:
      client.invalidateQueries({ queryKey: queryKeys.sessions() })
      if (sessionId) {
        client.invalidateQueries({ queryKey: queryKeys.sessionMeta(sessionId) })
        client.invalidateQueries({ queryKey: queryKeys.sessionTranscript(sessionId) })
      }
      return
    default:
      client.invalidateQueries({ queryKey: queryKeys.host() })
      client.invalidateQueries({ queryKey: queryKeys.projects() })
      client.invalidateQueries({ queryKey: queryKeys.sessions() })
      if (sessionId) {
        client.invalidateQueries({ queryKey: queryKeys.sessionMeta(sessionId) })
        client.invalidateQueries({ queryKey: queryKeys.sessionTranscript(sessionId) })
      }
      return
  }
}

function normalizeWorkspaceEventType(value: string | number | undefined) {
  switch (value) {
    case WorkspaceEventType.HOST_STATUS_CHANGED:
    case "WORKSPACE_EVENT_TYPE_HOST_STATUS_CHANGED":
      return WorkspaceEventType.HOST_STATUS_CHANGED
    case WorkspaceEventType.PROJECTS_CHANGED:
    case "WORKSPACE_EVENT_TYPE_PROJECTS_CHANGED":
      return WorkspaceEventType.PROJECTS_CHANGED
    case WorkspaceEventType.SESSIONS_CHANGED:
    case "WORKSPACE_EVENT_TYPE_SESSIONS_CHANGED":
      return WorkspaceEventType.SESSIONS_CHANGED
    case WorkspaceEventType.SESSION_CHANGED:
    case "WORKSPACE_EVENT_TYPE_SESSION_CHANGED":
      return WorkspaceEventType.SESSION_CHANGED
    case WorkspaceEventType.SESSION_ARTIFACTS_CHANGED:
    case "WORKSPACE_EVENT_TYPE_SESSION_ARTIFACTS_CHANGED":
      return WorkspaceEventType.SESSION_ARTIFACTS_CHANGED
    default:
      return WorkspaceEventType.UNSPECIFIED
  }
}
