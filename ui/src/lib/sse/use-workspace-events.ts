import { useEffect, useState } from "react"
import { useQueryClient } from "@tanstack/react-query"

import {
  applyWorkspaceEventInvalidation,
  type WorkspaceEventEnvelope,
} from "@/lib/query/invalidation"
import { applySessionUnreadEvent } from "@/lib/session-unread"
import type { WorkspaceEventStreamState } from "@/components/app/workspace"

// Subscribe to the backend SSE stream once and translate events into query
// invalidations plus unread markers for the rest of the shell.
export function useWorkspaceEvents() {
  const queryClient = useQueryClient()
  const [lastEventAt, setLastEventAt] = useState<number | null>(null)
  const [status, setStatus] = useState<WorkspaceEventStreamState>("connecting")

  useEffect(() => {
    let disposed = false
    const source = new EventSource("/events", { withCredentials: true })

    const markConnected = () => {
      if (disposed) {
        return
      }
      setStatus("connected")
      setLastEventAt(Date.now())
    }

    const handleMessage = (event: MessageEvent<string>) => {
      let parsed: WorkspaceEventEnvelope = {}

      try {
        parsed = JSON.parse(event.data) as WorkspaceEventEnvelope
      } catch {
        // Ignore malformed payloads and fall back to broad invalidation logic.
        parsed = {}
      }

      markConnected()
      applySessionUnreadEvent(parsed)
      applyWorkspaceEventInvalidation(queryClient, parsed)
    }

    source.onopen = () => {
      markConnected()
    }

    source.onerror = () => {
      if (disposed) {
        return
      }
      // EventSource auto-retries on its own; the hook only exposes a status so
      // the shell can explain whether the problem is offline vs reconnecting.
      setStatus(navigator.onLine ? "reconnecting" : "offline")
    }

    const handleOnline = () => {
      if (disposed) {
        return
      }
      setStatus("reconnecting")
    }

    const handleOffline = () => {
      if (disposed) {
        return
      }
      setStatus("offline")
    }

    source.addEventListener("workspace", handleMessage as EventListener)
    source.addEventListener("ready", handleMessage as EventListener)
    window.addEventListener("online", handleOnline)
    window.addEventListener("offline", handleOffline)

    return () => {
      disposed = true
      source.removeEventListener("workspace", handleMessage as EventListener)
      source.removeEventListener("ready", handleMessage as EventListener)
      window.removeEventListener("online", handleOnline)
      window.removeEventListener("offline", handleOffline)
      source.close()
    }
  }, [queryClient])

  return {
    lastEventAt,
    status,
  }
}
