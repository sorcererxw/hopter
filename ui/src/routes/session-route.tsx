import { Navigate, useParams } from "react-router-dom"

import { SessionWorkspacePane } from "@/components/app/session-detail-pane"

export function SessionRoute() {
  const { sessionId } = useParams<{ sessionId: string }>()

  if (!sessionId) {
    return <Navigate to="/" replace />
  }

  return <SessionWorkspacePane sessionId={sessionId} />
}
