import type {
  Session,
  SessionMeta,
  SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"
import { formatSessionStatus } from "@/lib/format/proto"

export function buildSessionDetail(
  meta: SessionMeta | undefined,
  pages:
    | Array<
        | {
            items?: SessionTranscriptItem[]
          }
        | undefined
      >
    | undefined
): Session | undefined {
  if (!meta) {
    return undefined
  }

  const transcriptItems = orderTranscriptItems(
    (pages ?? []).flatMap((page) => page?.items ?? [])
  )

  return {
    id: meta.id,
    title: meta.title,
    project: meta.project,
    status: meta.status,
    summary: meta.summary,
    attentionRequired: meta.attentionRequired,
    attentionReason: meta.attentionReason,
    lastInputHint: meta.lastInputHint,
    updatedAt: meta.updatedAt,
    artifacts: meta.artifacts,
    transcriptItems,
    backendKey: meta.backendKey,
    pendingApprovalId: meta.pendingApprovalId,
  } as Session
}

function orderTranscriptItems(items: SessionTranscriptItem[]) {
  return [...items].sort((left, right) => {
    const leftOrder = transcriptSortKey(left)
    const rightOrder = transcriptSortKey(right)

    if (leftOrder < rightOrder) {
      return -1
    }
    if (leftOrder > rightOrder) {
      return 1
    }
    return 0
  })
}

function transcriptSortKey(item: SessionTranscriptItem) {
  return item.orderKey || `zzzz:${item.id}`
}

export function shouldShowThinkingState(status: Session["status"]) {
  const normalized = formatSessionStatus(status).toLowerCase()
  return normalized === "pending" || normalized === "running"
}

export function shouldPollSessionState(status: Session["status"]) {
  const normalized = formatSessionStatus(status).toLowerCase()
  return (
    normalized === "pending" ||
    normalized === "running" ||
    normalized === "waiting approval"
  )
}

export type SessionEventStreamState =
  | "connecting"
  | "connected"
  | "reconnecting"
  | "offline"
