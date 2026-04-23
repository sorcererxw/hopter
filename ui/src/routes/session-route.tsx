import { Navigate, useParams } from "react-router-dom"

import { SessionWorkspacePane } from "@/components/app/sessions"

// Thin route adapter that validates the dynamic segment before handing control
// to the session workspace pane.
export function SessionRoute() {
  const { sessionId } = useParams<{ sessionId: string }>()

  if (!sessionId) {
    return <Navigate to="/" replace />
  }

  return <SessionWorkspacePane sessionId={sessionId} />
}
