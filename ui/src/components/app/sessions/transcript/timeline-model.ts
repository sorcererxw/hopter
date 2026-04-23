import {
  SessionTranscriptItemKind,
  type SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"

import type { ActivityItem } from "./activity"

export type TimelineItem =
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
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "command-group"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "thought-group"
    }

type ThoughtProcessDisplayItem =
  | {
      item: SessionTranscriptItem
      key: string
      kind: "transcript"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "command-group"
    }

// isTranscriptActivityItem narrows generic feed items to transcript-backed activity rows.
function isTranscriptActivityItem(
  item: ActivityItem | undefined
): item is Extract<ActivityItem, { kind: "transcript" }> {
  return item?.kind === "transcript"
}

// The feed hook emits low-level activity items. The timeline condenses them
// into grouped visual rows so command bursts and reasoning runs read as one turn.
export function buildTimelineItems(items: ActivityItem[]): TimelineItem[] {
  return groupTimelineItems(orderCompletedReasoningBeforeAgentAnswers(items))
}

// buildThoughtProcessDisplayItems exposes grouped thought items in the same display shape used by the timeline.
export function buildThoughtProcessDisplayItems(
  items: SessionTranscriptItem[]
) {
  return buildThoughtProcessItems(items)
}

// isAssistantReplyAfterUserMessage detects turn boundaries that deserve extra vertical spacing.
export function isAssistantReplyAfterUserMessage(
  previous: TimelineItem | undefined,
  current: TimelineItem
) {
  if (
    previous?.kind !== "transcript" ||
    previous.item.kind !== SessionTranscriptItemKind.USER_MESSAGE
  ) {
    return false
  }

  if (current.kind === "thought-group") {
    return true
  }
  return (
    current.kind === "transcript" &&
    current.item.kind === SessionTranscriptItemKind.AGENT_MESSAGE
  )
}

// shouldAttachFileChangesToCompletedMessage decides whether a file-change row should collapse into the next answer.
export function shouldAttachFileChangesToCompletedMessage(
  item: TimelineItem,
  next: TimelineItem | undefined
) {
  // File-change entries often belong semantically to the following completed
  // assistant message, so render them together when possible.
  return (
    isCompletedAgentTimelineItem(next) &&
    fileChangeItemsFromTimelineItem(item).length > 0
  )
}

// completedMessageFileChanges pulls file-change items that should render under a completed assistant message.
export function completedMessageFileChanges(
  item: TimelineItem,
  previous: TimelineItem | undefined
) {
  if (!isCompletedAgentTimelineItem(item)) {
    return []
  }

  return fileChangeItemsFromTimelineItem(previous)
}

// isCompletedAgentTimelineItem recognizes assistant messages that have finished streaming.
function isCompletedAgentTimelineItem(item: TimelineItem | undefined) {
  return (
    item?.kind === "transcript" &&
    item.item.kind === SessionTranscriptItemKind.AGENT_MESSAGE &&
    !isActiveAgentMessageStatus(item.item.status)
  )
}

// fileChangeItemsFromTimelineItem extracts file-change transcript items from supported timeline row kinds.
function fileChangeItemsFromTimelineItem(item: TimelineItem | undefined) {
  if (!item) {
    return []
  }

  if (
    item.kind === "transcript" &&
    item.item.kind === SessionTranscriptItemKind.FILE_CHANGE
  ) {
    return [item.item]
  }

  if (item.kind === "thought-group") {
    return item.items.filter(
      (entry) => entry.kind === SessionTranscriptItemKind.FILE_CHANGE
    )
  }

  return []
}

// groupTimelineItems folds raw feed rows into higher-level timeline rows such as thought groups.
function groupTimelineItems(items: ActivityItem[]): TimelineItem[] {
  const timelineItems: TimelineItem[] = []
  let cursor = 0

  while (cursor < items.length) {
    const current = items[cursor]
    if (!current) {
      cursor += 1
      continue
    }

    if (
      isTranscriptActivityItem(current) &&
      isThoughtProcessItem(current.item)
    ) {
      const thoughtItems: SessionTranscriptItem[] = []

      while (cursor < items.length) {
        const next = items[cursor]
        if (
          !isTranscriptActivityItem(next) ||
          !isThoughtProcessItem(next.item)
        ) {
          break
        }

        thoughtItems.push(next.item)
        cursor += 1
      }

      const nextItem = items[cursor]
      const shouldCollapseThoughts =
        !thoughtItems.some(isActiveThoughtProcessItem) &&
        (isFinalAgentActivityItem(nextItem) ||
          thoughtRunBelongsToCompletedAnswer(items, cursor))
      if (shouldCollapseThoughts) {
        timelineItems.push({
          items: thoughtItems,
          key: thoughtProcessGroupKey(thoughtItems),
          kind: "thought-group",
        })
      } else {
        timelineItems.push(...buildThoughtProcessItems(thoughtItems))
      }
      continue
    }

    if (!isTranscriptActivityItem(current)) {
      timelineItems.push(current)
      cursor += 1
      continue
    }

    timelineItems.push(current)
    cursor += 1
  }

  return timelineItems
}

// buildThoughtProcessItems groups consecutive completed commands inside a thought-process run.
function buildThoughtProcessItems(
  items: SessionTranscriptItem[]
): ThoughtProcessDisplayItem[] {
  const displayItems: ThoughtProcessDisplayItem[] = []
  let cursor = 0

  while (cursor < items.length) {
    const current = items[cursor]
    if (!current) {
      cursor += 1
      continue
    }

    if (shouldGroupCompletedCommandExecution(current)) {
      const commandItems: SessionTranscriptItem[] = []

      while (cursor < items.length) {
        const next = items[cursor]
        if (!next || !shouldGroupCompletedCommandExecution(next)) {
          break
        }

        commandItems.push(next)
        cursor += 1
      }

      if (commandItems.length > 1) {
        displayItems.push({
          items: commandItems,
          key: commandExecutionGroupKey(commandItems),
          kind: "command-group",
        })
      } else if (commandItems[0]) {
        displayItems.push({
          item: commandItems[0],
          key: commandItems[0].id,
          kind: "transcript",
        })
      }
      continue
    }

    displayItems.push({
      item: current,
      key: current.id,
      kind: "transcript",
    })
    cursor += 1
  }

  return displayItems
}

// thoughtRunBelongsToCompletedAnswer checks whether a reasoning/tool run should collapse into the next answer turn.
function thoughtRunBelongsToCompletedAnswer(
  items: ActivityItem[],
  from: number
) {
  for (let index = from; index < items.length; index += 1) {
    const item = items[index]
    if (!isTranscriptActivityItem(item)) {
      continue
    }
    if (isFinalAgentActivityItem(item)) {
      return true
    }
    if (
      item.item.kind === SessionTranscriptItemKind.USER_MESSAGE ||
      isActiveThoughtProcessItem(item.item)
    ) {
      return false
    }
  }

  return false
}

// orderCompletedReasoningBeforeAgentAnswers reorders terminal reasoning rows to appear before the final answer.
function orderCompletedReasoningBeforeAgentAnswers(
  items: ActivityItem[]
): ActivityItem[] {
  const ordered: ActivityItem[] = []
  let cursor = 0

  while (cursor < items.length) {
    const current = items[cursor]
    if (!current) {
      cursor += 1
      continue
    }

    if (isFinalAgentActivityItem(current)) {
      const reasoningItems: ActivityItem[] = []
      let nextCursor = cursor + 1

      while (
        nextCursor < items.length &&
        isCompletedReasoningActivityItem(items[nextCursor])
      ) {
        reasoningItems.push(items[nextCursor])
        nextCursor += 1
      }

      if (reasoningItems.length > 0) {
        ordered.push(...reasoningItems, current)
        cursor = nextCursor
        continue
      }
    }

    ordered.push(current)
    cursor += 1
  }

  return ordered
}

// isFinalAgentActivityItem identifies a non-streaming assistant message in the raw activity feed.
function isFinalAgentActivityItem(item: ActivityItem | undefined) {
  return (
    item?.kind === "transcript" &&
    item.item.kind === SessionTranscriptItemKind.AGENT_MESSAGE &&
    !isActiveAgentMessageStatus(item.item.status)
  )
}

// isActiveAgentMessageStatus normalizes assistant message status strings into an "active" predicate.
function isActiveAgentMessageStatus(status: string) {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  return (
    normalized === "streaming" ||
    normalized === "inprogress" ||
    normalized === "running"
  )
}

// isCompletedReasoningActivityItem identifies reasoning rows that have finished streaming.
function isCompletedReasoningActivityItem(item: ActivityItem | undefined) {
  return (
    item?.kind === "transcript" &&
    item.item.kind === SessionTranscriptItemKind.REASONING &&
    !isActiveReasoningStatus(item.item.status)
  )
}

// isThoughtProcessItem marks transcript kinds that belong inside collapsible thought-process runs.
function isThoughtProcessItem(item: SessionTranscriptItem) {
  return (
    item.kind === SessionTranscriptItemKind.REASONING ||
    item.kind === SessionTranscriptItemKind.TOOL_CALL ||
    item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION ||
    item.kind === SessionTranscriptItemKind.FILE_CHANGE
  )
}

// isActiveThoughtProcessItem detects thought-process items that are still live and should not collapse yet.
function isActiveThoughtProcessItem(item: SessionTranscriptItem) {
  if (item.kind === SessionTranscriptItemKind.REASONING) {
    return isActiveReasoningStatus(item.status)
  }
  if (item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION) {
    return isActiveCommandExecutionStatus(commandExecutionStatus(item))
  }
  if (item.kind === SessionTranscriptItemKind.TOOL_CALL) {
    return isActiveToolCallStatus(item.status)
  }
  return false
}

// isActiveReasoningStatus normalizes reasoning status strings into an "active" predicate.
function isActiveReasoningStatus(status: string) {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  return (
    normalized === "streaming" ||
    normalized === "inprogress" ||
    normalized === "running"
  )
}

// shouldGroupCompletedCommandExecution decides whether a command can join a collapsed completed-command group.
function shouldGroupCompletedCommandExecution(item: SessionTranscriptItem) {
  return (
    item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION &&
    !isActiveCommandExecutionStatus(commandExecutionStatus(item))
  )
}

// commandExecutionStatus derives a normalized command status from structured fields or parsed body text.
function commandExecutionStatus(item: SessionTranscriptItem) {
  return (
    item.status.trim() || parseCommandExecutionDetail(item.body).status
  ).toLowerCase()
}

// isActiveCommandExecutionStatus normalizes command lifecycle labels into an "active" predicate.
function isActiveCommandExecutionStatus(status: string) {
  const normalized = status.replace(/[\s_-]+/g, "")
  return (
    normalized === "inprogress" ||
    normalized === "running" ||
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "starting"
  )
}

// isActiveToolCallStatus normalizes tool-call lifecycle labels into an "active" predicate.
function isActiveToolCallStatus(status: string) {
  const normalized = status
    .trim()
    .toLowerCase()
    .replace(/[\s_-]+/g, "")
  return (
    normalized === "inprogress" ||
    normalized === "running" ||
    normalized === "pending" ||
    normalized === "queued" ||
    normalized === "starting" ||
    normalized === "streaming"
  )
}

// commandExecutionGroupKey builds a stable key for a grouped block of completed commands.
function commandExecutionGroupKey(items: SessionTranscriptItem[]) {
  const first = items[0]?.id ?? "start"
  const last = items.at(-1)?.id ?? "end"
  return `command-group:${first}:${last}:${items.length}`
}

// thoughtProcessGroupKey builds a stable key for a collapsed thought-process run.
function thoughtProcessGroupKey(items: SessionTranscriptItem[]) {
  const first = items[0]?.id ?? "start"
  const last = items.at(-1)?.id ?? "end"
  return `thought-group:${first}:${last}:${items.length}`
}

// parseCommandExecutionDetail extracts command, status, and output sections from the semi-structured body text.
function parseCommandExecutionDetail(body: string) {
  const lines = body.split("\n")
  const command =
    lines
      .map((line) => line.trimEnd())
      .find((line) => line.trim().length > 0) ||
    body.trim() ||
    "command"

  let status = ""
  let inOutput = false
  const outputLines: string[] = []

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trimEnd()
    const trimmed = line.trim()

    if (!trimmed && !inOutput) {
      continue
    }

    if (trimmed.toLowerCase().startsWith("status:")) {
      status = trimmed.slice("status:".length).trim()
      inOutput = false
      continue
    }

    if (trimmed.toLowerCase().startsWith("exit code:")) {
      inOutput = false
      continue
    }

    if (trimmed.toLowerCase() === "output:") {
      inOutput = true
      continue
    }

    if (inOutput) {
      outputLines.push(line)
    }
  }

  return {
    command,
    output: outputLines,
    status,
  }
}
