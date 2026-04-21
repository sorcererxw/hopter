import type { QueryClient } from "@tanstack/react-query"

import {
  SessionLivePatchKind,
  WorkspaceEventType,
} from "@/gen/proto/hopter/v1/events_pb"
import { SessionStatus } from "@/gen/proto/hopter/v1/common_pb"
import { queryKeys } from "@/lib/query/keys"

export type WorkspaceEventEnvelope = {
  payload?: {
    refreshHint?: string | number
    sessionLivePatch?: SessionLivePatchEnvelope
    session_live_patch?: SessionLivePatchEnvelope
  }
  type?: string | number
  sessionId?: string
  session_id?: string
  projectId?: string
  project_id?: string
}

type SessionLivePatchEnvelope = {
  kind?: string | number
  activeTurnId?: string
  active_turn_id?: string
  draftItemId?: string
  draft_item_id?: string
  draftDelta?: string
  draft_delta?: string
  finalItem?: SessionTranscriptItemEnvelope
  final_item?: SessionTranscriptItemEnvelope
  status?: string | number
  summary?: string
  requiresRefetch?: boolean
  requires_refetch?: boolean
}

type SessionTranscriptItemEnvelope = {
  attachments?: unknown[]
  id?: string
  kind?: string | number
  title?: string
  body?: string
  displayBody?: string
  display_body?: string
  status?: string
}

export function applyWorkspaceEventInvalidation(
  client: QueryClient,
  event: WorkspaceEventEnvelope
) {
  const sessionId = event.sessionId || event.session_id
  const livePatch =
    event.payload?.sessionLivePatch || event.payload?.session_live_patch

  if (sessionId && livePatch) {
    applySessionLivePatch(client, sessionId, livePatch)
    if (!shouldInvalidateForLivePatch(livePatch)) {
      return
    }
  }

  const eventType = normalizeWorkspaceEventType(event.type)

  switch (eventType) {
    case WorkspaceEventType.HOST_STATUS_CHANGED:
      client.invalidateQueries({ queryKey: queryKeys.host() })
      client.invalidateQueries({ queryKey: queryKeys.hostUpdates() })
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
        client.invalidateQueries({
          queryKey: queryKeys.sessionArtifacts(sessionId),
        })
        client.invalidateQueries({ queryKey: queryKeys.sessionTranscript(sessionId) })
      }
      return
    default:
      client.invalidateQueries({ queryKey: queryKeys.host() })
      client.invalidateQueries({ queryKey: queryKeys.hostUpdates() })
      client.invalidateQueries({ queryKey: queryKeys.projects() })
      client.invalidateQueries({ queryKey: queryKeys.sessions() })
      if (sessionId) {
        client.invalidateQueries({ queryKey: queryKeys.sessionMeta(sessionId) })
        client.invalidateQueries({
          queryKey: queryKeys.sessionArtifacts(sessionId),
        })
        client.invalidateQueries({ queryKey: queryKeys.sessionTranscript(sessionId) })
      }
      return
  }
}

function applySessionLivePatch(
  client: QueryClient,
  sessionId: string,
  patch: SessionLivePatchEnvelope
) {
  const patchKind = normalizeSessionLivePatchKind(patch.kind)
  const status = normalizeSessionStatus(patch.status)
  const summary = patch.summary
  const finalItem = patch.finalItem || patch.final_item

  if (
    patchKind === SessionLivePatchKind.STATUS ||
    patchKind === SessionLivePatchKind.MESSAGE_FINALIZED ||
    patchKind === SessionLivePatchKind.RECONCILE_REQUIRED
  ) {
    client.setQueriesData(
      { queryKey: queryKeys.sessionMeta(sessionId) },
      (current: any) => {
        if (!current) {
          return current
        }
        return {
          ...current,
          status: status ?? current.status,
          summary: summary ?? current.summary,
        }
      }
    )
  }

  if (patchKind === SessionLivePatchKind.DRAFT_DELTA) {
    const draftItemId = patch.draftItemId || patch.draft_item_id || "live-draft"
    const delta = patch.draftDelta || patch.draft_delta || ""
    if (!delta) {
      return
    }
    client.setQueriesData(
      { queryKey: queryKeys.sessionTranscript(sessionId) },
      (current: any) => {
        const page = ensureTranscriptPage(current)
        const items = [...page.items]
        const index = items.findIndex((item) => item.id === draftItemId)
        if (index >= 0) {
          items[index] = {
            ...items[index],
            body: `${items[index].body || ""}${delta}`,
            displayBody: `${items[index].displayBody || items[index].body || ""}${delta}`,
            status: "streaming",
          }
        } else {
          items.push({
            id: draftItemId,
            kind: 2,
            title: "Codex",
            body: delta,
            displayBody: delta,
            attachments: [],
            status: "streaming",
          })
        }
        return {
          ...page,
          items,
        }
      }
    )
    return
  }

  if (patchKind === SessionLivePatchKind.MESSAGE_FINALIZED && finalItem?.id) {
    client.setQueriesData(
      { queryKey: queryKeys.sessionTranscript(sessionId) },
      (current: any) => {
        const page = ensureTranscriptPage(current)
        const items = [...page.items]
        const normalizedItem = {
          id: finalItem.id,
          kind: normalizeTranscriptItemKind(finalItem.kind),
          title: finalItem.title || "Codex",
          body: finalItem.body || "",
          displayBody:
            finalItem.displayBody || finalItem.display_body || finalItem.body || "",
          attachments: finalItem.attachments || [],
          status: finalItem.status || "",
        }
        const index = items.findIndex((item) => item.id === finalItem.id)
        if (index >= 0) {
          items[index] = normalizedItem
        } else {
          items.push(normalizedItem)
        }
        return {
          ...page,
          items,
        }
      }
    )
  }
}

function shouldInvalidateForLivePatch(patch: SessionLivePatchEnvelope) {
  const patchKind = normalizeSessionLivePatchKind(patch.kind)
  if (patch.requiresRefetch || patch.requires_refetch) {
    return true
  }
  switch (patchKind) {
    case SessionLivePatchKind.DRAFT_DELTA:
    case SessionLivePatchKind.MESSAGE_FINALIZED:
    case SessionLivePatchKind.STATUS:
      return false
    default:
      return true
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

function normalizeSessionLivePatchKind(value: string | number | undefined) {
  switch (value) {
    case SessionLivePatchKind.STATUS:
    case "SESSION_LIVE_PATCH_KIND_STATUS":
      return SessionLivePatchKind.STATUS
    case SessionLivePatchKind.DRAFT_DELTA:
    case "SESSION_LIVE_PATCH_KIND_DRAFT_DELTA":
      return SessionLivePatchKind.DRAFT_DELTA
    case SessionLivePatchKind.MESSAGE_FINALIZED:
    case "SESSION_LIVE_PATCH_KIND_MESSAGE_FINALIZED":
      return SessionLivePatchKind.MESSAGE_FINALIZED
    case SessionLivePatchKind.RECONCILE_REQUIRED:
    case "SESSION_LIVE_PATCH_KIND_RECONCILE_REQUIRED":
      return SessionLivePatchKind.RECONCILE_REQUIRED
    default:
      return SessionLivePatchKind.UNSPECIFIED
  }
}

function normalizeSessionStatus(value: string | number | undefined) {
  switch (value) {
    case SessionStatus.PENDING:
    case "SESSION_STATUS_PENDING":
      return SessionStatus.PENDING
    case SessionStatus.RUNNING:
    case "SESSION_STATUS_RUNNING":
      return SessionStatus.RUNNING
    case SessionStatus.WAITING_INPUT:
    case "SESSION_STATUS_WAITING_INPUT":
      return SessionStatus.WAITING_INPUT
    case SessionStatus.WAITING_APPROVAL:
    case "SESSION_STATUS_WAITING_APPROVAL":
      return SessionStatus.WAITING_APPROVAL
    case SessionStatus.COMPLETED:
    case "SESSION_STATUS_COMPLETED":
      return SessionStatus.COMPLETED
    case SessionStatus.FAILED:
    case "SESSION_STATUS_FAILED":
      return SessionStatus.FAILED
    case SessionStatus.DEGRADED:
    case "SESSION_STATUS_DEGRADED":
      return SessionStatus.DEGRADED
    default:
      return undefined
  }
}

function normalizeTranscriptItemKind(value: string | number | undefined) {
  if (typeof value === "number") {
    return value
  }
  switch (value) {
    case "SESSION_TRANSCRIPT_ITEM_KIND_USER_MESSAGE":
      return 1
    case "SESSION_TRANSCRIPT_ITEM_KIND_AGENT_MESSAGE":
      return 2
    case "SESSION_TRANSCRIPT_ITEM_KIND_REASONING":
      return 3
    case "SESSION_TRANSCRIPT_ITEM_KIND_TOOL_CALL":
      return 4
    case "SESSION_TRANSCRIPT_ITEM_KIND_COMMAND_EXECUTION":
      return 5
    case "SESSION_TRANSCRIPT_ITEM_KIND_FILE_CHANGE":
      return 6
    default:
      return 0
  }
}

function ensureTranscriptPage(current: any) {
  if (current && Array.isArray(current.items)) {
    return current
  }
  return {
    items: [],
    nextBeforeCursor: "",
    hasMoreBefore: false,
    snapshotUpdatedAt: undefined,
  }
}
