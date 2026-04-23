import { SessionTranscriptItemKind } from "@/gen/proto/hopter/v1/session_pb"
import type { SessionTranscriptItem } from "@/gen/proto/hopter/v1/session_pb"

const REASONING_PLACEHOLDER_TEXT = new Set([
  "Raw reasoning emitted by Codex.",
  "Reasoning progress emitted by Codex.",
])

// Activity items are the transcript feed's intermediate representation: richer
// than raw transcript items, but still generic enough for multiple renderers to
// group and decorate.
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
  | {
      key: string
      kind: "thinking"
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
        item.item.displayBody.length,
        item.item.displayBody.slice(-160),
      ].join(":")
    case "pending-input":
      return `${item.key}:${item.text.length}:${item.text.slice(-160)}`
    case "thinking":
      return item.key
    case "round-status":
      return `${item.key}:${item.state}:${item.summary.length}:${item.summary.slice(-160)}`
  }
}

export function insertPendingInputActivityItem(
  items: ActivityItem[],
  pendingInput: {
    key: string
    text: string
  }
) {
  const pendingItem: ActivityItem = {
    kind: "pending-input",
    key: pendingInput.key,
    text: pendingInput.text,
  }
  const liveDraftIndex = items.findIndex(isLiveDraftTranscriptItem)
  if (liveDraftIndex < 0) {
    return [...items, pendingItem]
  }

  // Keep optimistic user input immediately before the live assistant draft so
  // turn order stays readable while the backend is still streaming.
  return [
    ...items.slice(0, liveDraftIndex),
    pendingItem,
    ...items.slice(liveDraftIndex),
  ]
}

function isLiveDraftTranscriptItem(item: ActivityItem) {
  return (
    item.kind === "transcript" &&
    item.item.kind === SessionTranscriptItemKind.AGENT_MESSAGE &&
    (item.item.status === "streaming" || item.item.orderKey.startsWith("live:"))
  )
}

export function isUserMessageTranscriptItem(item: SessionTranscriptItem) {
  return item.kind === SessionTranscriptItemKind.USER_MESSAGE
}

export function isDisplayableTranscriptItem(item: SessionTranscriptItem) {
  if (item.kind !== SessionTranscriptItemKind.REASONING) {
    return item.body.trim().length > 0
  }

  // Reasoning items can arrive with placeholder body text while streaming.
  // Show them only when they contain real content or are still actively live.
  return (
    hasSubstantiveReasoningText(item.body) ||
    hasSubstantiveReasoningText(item.displayBody) ||
    isActiveReasoningTranscriptItem(item)
  )
}

export function isActiveReasoningTranscriptItem(item: SessionTranscriptItem) {
  if (item.kind !== SessionTranscriptItemKind.REASONING) {
    return false
  }

  const normalized = item.status
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  return (
    normalized === "streaming" ||
    normalized === "inprogress" ||
    normalized === "running"
  )
}

export function isReasoningPlaceholderText(value: string) {
  return REASONING_PLACEHOLDER_TEXT.has(normalizeTranscriptText(value))
}

function hasSubstantiveReasoningText(value: string) {
  const normalized = normalizeTranscriptText(value)
  return normalized.length > 0 && !REASONING_PLACEHOLDER_TEXT.has(normalized)
}

export function normalizeTranscriptText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

export function transcriptTextMatchesPendingHint(
  transcriptText: string,
  pendingHint: string
) {
  const normalizedTranscriptText = normalizeTranscriptText(transcriptText)
  if (!normalizedTranscriptText) {
    return false
  }

  return pendingHintMatchCandidates(pendingHint).some((candidate) =>
    normalizedTranscriptText.startsWith(candidate)
  )
}

function pendingHintMatchCandidates(value: string) {
  const normalized = normalizeTranscriptText(value)
  if (!normalized) {
    return []
  }

  const candidates = [normalized]
  // The server may abbreviate pending hints with an ellipsis while the full
  // user message appears in transcript history later.
  const prefixWithoutEllipsis = normalized.replace(/[…]+$/u, "").trim()
  if (prefixWithoutEllipsis && prefixWithoutEllipsis !== normalized) {
    candidates.push(prefixWithoutEllipsis)
  }

  return candidates
}
