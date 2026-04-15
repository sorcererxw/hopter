import type { QueryClient } from "@tanstack/react-query"

import { queryKeys } from "@/lib/query/keys"

export type WorkspaceEventEnvelope = {
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
  client.invalidateQueries({ queryKey: queryKeys.host() })
  client.invalidateQueries({ queryKey: queryKeys.projects() })
  client.invalidateQueries({ queryKey: queryKeys.sessions() })

  const sessionId = event.sessionId || event.session_id
  if (sessionId) {
    client.invalidateQueries({ queryKey: queryKeys.session(sessionId) })
  }
}
