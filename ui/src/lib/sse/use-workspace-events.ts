import { useEffect } from "react"
import { useQueryClient } from "@tanstack/react-query"

import {
  applyWorkspaceEventInvalidation,
  type WorkspaceEventEnvelope,
} from "@/lib/query/invalidation"

export function useWorkspaceEvents() {
  const queryClient = useQueryClient()

  useEffect(() => {
    const source = new EventSource("/events", { withCredentials: true })

    const handleMessage = (event: MessageEvent<string>) => {
      let parsed: WorkspaceEventEnvelope = {}

      try {
        parsed = JSON.parse(event.data) as WorkspaceEventEnvelope
      } catch {
        parsed = {}
      }

      applyWorkspaceEventInvalidation(queryClient, parsed)
    }

    source.addEventListener("workspace", handleMessage as EventListener)

    return () => {
      source.removeEventListener("workspace", handleMessage as EventListener)
      source.close()
    }
  }, [queryClient])
}
