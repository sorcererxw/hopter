import { useEffect, useSyncExternalStore } from "react"

import { SessionStatus } from "@/gen/proto/hopter/v1/common_pb"
import {
  SessionLivePatchKind,
  WorkspaceEventType,
} from "@/gen/proto/hopter/v1/events_pb"
import type { WorkspaceEventEnvelope } from "@/lib/query/invalidation"

let unreadSessionIds = new Set<string>()
let activeSessionId = ""
let activeSessionReadable = false
let snapshot = unreadSessionIds

const subscribers = new Set<() => void>()

export function useUnreadSessionIds() {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot)
}

export function useSessionReadTarget(sessionId: string, readable: boolean) {
  useEffect(() => {
    function syncReadTarget() {
      const pageVisible =
        typeof document === "undefined" ||
        document.visibilityState === "visible"
      setSessionReadTarget(sessionId, readable && pageVisible)
    }

    syncReadTarget()
    if (typeof document === "undefined") {
      return () => clearSessionReadTarget(sessionId)
    }
    document.addEventListener("visibilitychange", syncReadTarget)

    return () => {
      document.removeEventListener("visibilitychange", syncReadTarget)
      clearSessionReadTarget(sessionId)
    }
  }, [readable, sessionId])
}

export function applySessionUnreadEvent(event: WorkspaceEventEnvelope) {
  const sessionId = event.sessionId || event.session_id
  if (!sessionId || !eventCanMakeSessionUnread(event)) {
    return
  }

  if (sessionId === activeSessionId && activeSessionReadable) {
    clearSessionUnread(sessionId)
    return
  }

  markSessionUnread(sessionId)
}

export function clearSessionUnread(sessionId: string) {
  if (!unreadSessionIds.has(sessionId)) {
    return
  }
  const next = new Set(unreadSessionIds)
  next.delete(sessionId)
  setUnreadSessionIds(next)
}

function setSessionReadTarget(sessionId: string, readable: boolean) {
  const changed =
    activeSessionId !== sessionId || activeSessionReadable !== readable
  activeSessionId = sessionId
  activeSessionReadable = readable

  if (readable) {
    clearSessionUnread(sessionId)
  } else if (changed) {
    notifySubscribers()
  }
}

function clearSessionReadTarget(sessionId: string) {
  if (activeSessionId !== sessionId) {
    return
  }
  activeSessionId = ""
  activeSessionReadable = false
  notifySubscribers()
}

function markSessionUnread(sessionId: string) {
  if (unreadSessionIds.has(sessionId)) {
    return
  }
  const next = new Set(unreadSessionIds)
  next.add(sessionId)
  setUnreadSessionIds(next)
}

function setUnreadSessionIds(next: Set<string>) {
  unreadSessionIds = next
  snapshot = unreadSessionIds
  notifySubscribers()
}

function subscribe(callback: () => void) {
  subscribers.add(callback)
  return () => subscribers.delete(callback)
}

function getSnapshot() {
  return snapshot
}

function notifySubscribers() {
  for (const subscriber of subscribers) {
    subscriber()
  }
}

function eventCanMakeSessionUnread(event: WorkspaceEventEnvelope) {
  const livePatch =
    event.payload?.sessionLivePatch || event.payload?.session_live_patch
  if (livePatch) {
    const patchKind = normalizeSessionLivePatchKind(livePatch.kind)
    if (
      patchKind === SessionLivePatchKind.DRAFT_DELTA ||
      patchKind === SessionLivePatchKind.MESSAGE_FINALIZED ||
      patchKind === SessionLivePatchKind.RECONCILE_REQUIRED
    ) {
      return true
    }

    const status = normalizeSessionStatus(livePatch.status)
    return (
      status === SessionStatus.WAITING_APPROVAL ||
      status === SessionStatus.WAITING_INPUT
    )
  }

  const eventType = normalizeWorkspaceEventType(event.type)
  return (
    eventType === WorkspaceEventType.SESSION_CHANGED ||
    eventType === WorkspaceEventType.SESSION_ARTIFACTS_CHANGED
  )
}

function normalizeSessionLivePatchKind(value: string | number | undefined) {
  switch (value) {
    case SessionLivePatchKind.DRAFT_DELTA:
    case "SESSION_LIVE_PATCH_KIND_DRAFT_DELTA":
      return SessionLivePatchKind.DRAFT_DELTA
    case SessionLivePatchKind.MESSAGE_FINALIZED:
    case "SESSION_LIVE_PATCH_KIND_MESSAGE_FINALIZED":
      return SessionLivePatchKind.MESSAGE_FINALIZED
    case SessionLivePatchKind.RECONCILE_REQUIRED:
    case "SESSION_LIVE_PATCH_KIND_RECONCILE_REQUIRED":
      return SessionLivePatchKind.RECONCILE_REQUIRED
    case SessionLivePatchKind.STATUS:
    case "SESSION_LIVE_PATCH_KIND_STATUS":
      return SessionLivePatchKind.STATUS
    default:
      return SessionLivePatchKind.UNSPECIFIED
  }
}

function normalizeSessionStatus(value: string | number | undefined) {
  switch (value) {
    case SessionStatus.WAITING_APPROVAL:
    case "SESSION_STATUS_WAITING_APPROVAL":
      return SessionStatus.WAITING_APPROVAL
    case SessionStatus.WAITING_INPUT:
    case "SESSION_STATUS_WAITING_INPUT":
      return SessionStatus.WAITING_INPUT
    default:
      return undefined
  }
}

function normalizeWorkspaceEventType(value: string | number | undefined) {
  switch (value) {
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
