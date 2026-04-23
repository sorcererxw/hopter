import type {
  SessionTranscriptItem,
  SessionTranscriptPage,
} from "@/gen/proto/hopter/v1/session_pb"

export function mergeLatestTranscriptPage(
  current: SessionTranscriptPage | undefined,
  next: SessionTranscriptPage
): SessionTranscriptPage {
  if (!current) {
    return next
  }

  const nextItems = next.items ?? []
  const preservedItems = (current.items ?? []).filter(
    (item) =>
      !nextItems.some((candidate) => candidate.id === item.id) &&
      shouldPreserveLiveTranscriptItem(item)
  )

  if (preservedItems.length === 0) {
    return next
  }

  return {
    ...next,
    items: [...nextItems, ...preservedItems].sort(compareTranscriptItemOrder),
  } as SessionTranscriptPage
}

export function shouldPreserveLiveTranscriptItem(item: SessionTranscriptItem) {
  return (
    item.orderKey.startsWith("live:") || isActiveTranscriptStatus(item.status)
  )
}

function compareTranscriptItemOrder(
  left: SessionTranscriptItem,
  right: SessionTranscriptItem
) {
  const leftOrder = left.orderKey || `zzzz:${left.id}`
  const rightOrder = right.orderKey || `zzzz:${right.id}`

  if (leftOrder < rightOrder) {
    return -1
  }
  if (leftOrder > rightOrder) {
    return 1
  }
  return 0
}

function isActiveTranscriptStatus(status: string) {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  return (
    normalized === "streaming" ||
    normalized === "inprogress" ||
    normalized === "running" ||
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "starting"
  )
}
