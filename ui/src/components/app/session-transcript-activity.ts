import { SessionTranscriptItemKind } from "@/gen/proto/hopter/v1/session_pb"
import type { SessionTranscriptItem } from "@/gen/proto/hopter/v1/session_pb"

export type ActivityItem =
  | {
      item: SessionTranscriptItem
      kind: "transcript"
      key: string
    }
  | {
      key: string
      kind: "round-status"
      state: "finished" | "attention"
      summary: string
    }
  | {
      key: string
      kind: "pending-input"
      text: string
    }

export function activityItemSignature(item: ActivityItem | undefined) {
  if (!item) {
    return ""
  }

  switch (item.kind) {
    case "transcript":
      return [
        item.key,
        item.item.orderKey,
        item.item.status,
        item.item.body.length,
        item.item.body.slice(-160),
      ].join(":")
    case "pending-input":
      return `${item.key}:${item.text.length}:${item.text.slice(-160)}`
    case "round-status":
      return `${item.key}:${item.state}:${item.summary.length}:${item.summary.slice(-160)}`
  }
}

export function isUserMessageTranscriptItem(item: SessionTranscriptItem) {
  return item.kind === SessionTranscriptItemKind.USER_MESSAGE
}

export function normalizeTranscriptText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}
