import { type TFunction } from "i18next"

import {
  SessionTranscriptCommandActionKind,
  SessionTranscriptItemKind,
  type SessionTranscriptCommandAction,
  type SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"

// These helpers are intentionally pure and UI-free. They sit outside the React
// rendering modules so reviewers can validate the string/summary normalization
// rules without paging through JSX.
// formatUserMessageForDisplay removes transport wrappers and keeps the user-visible request text readable.
export function formatUserMessageForDisplay(value: string) {
  // Diff-review flows can bundle multiple comments into a single synthetic user
  // message. When that happens, expand them into a numbered plain-text list
  // rather than leaking the raw transport envelope into the message bubble.
  const diffComments = extractDiffCommentBodies(value)
  if (diffComments.length === 1) {
    return diffComments[0]
  }
  if (diffComments.length > 1) {
    return diffComments
      .map((comment, index) => `${index + 1}. ${comment}`)
      .join("\n")
  }

  const marker = "## My request for Codex:"
  const markerIndex = value.indexOf(marker)
  if (markerIndex < 0) {
    return value
  }

  const requestStart = markerIndex + marker.length
  const afterMarker = value.slice(requestStart)
  const imageNarrativeIndex = afterMarker.search(
    /\n\s*The next image shows the browser page\b/
  )
  const selectedText =
    imageNarrativeIndex >= 0
      ? afterMarker.slice(0, imageNarrativeIndex)
      : afterMarker
  const cleaned = selectedText
    .replace(/^\s*[:：]?\s*/, "")
    .replace(/\n\s*\[image\]\s*$/g, "")
    .trim()

  return cleaned || value
}

// parseCommandExecutionDetail extracts structured command sections from a semi-structured transcript body.
export function parseCommandExecutionDetail(body: string) {
  // Command execution bodies are semi-structured plain text rather than a fully
  // typed payload. Parse defensively so partial/malformed bodies still produce
  // something readable in the UI.
  const lines = body.split("\n")
  const command =
    lines
      .map((line) => line.trimEnd())
      .find((line) => line.trim().length > 0) ||
    body.trim() ||
    "command"

  let status = ""
  let exitCode = ""
  const outputLines: string[] = []
  let inOutput = false

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
      exitCode = trimmed.slice("exit code:".length).trim()
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
    exitCode,
    output: outputLines,
    status,
  }
}

// summarizeThoughtProcess builds the compact localized summary shown for collapsed thought-process groups.
export function summarizeThoughtProcess(
  items: SessionTranscriptItem[],
  t: TFunction
) {
  // This summary powers the collapsed thought-process header, so it favors
  // fast scannability over exact chronology. We only count major activity
  // classes that help a reviewer understand "what happened in this turn".
  let reasoningCount = 0
  let toolCount = 0
  let commandCount = 0
  let explorationCount = 0
  let fileChangeCount = 0

  for (const item of items) {
    switch (item.kind) {
      case SessionTranscriptItemKind.REASONING:
        reasoningCount += 1
        break
      case SessionTranscriptItemKind.TOOL_CALL:
        toolCount += 1
        break
      case SessionTranscriptItemKind.COMMAND_EXECUTION:
        if (hasExplorationCommandAction(item)) {
          explorationCount += 1
        } else {
          commandCount += 1
        }
        break
      case SessionTranscriptItemKind.FILE_CHANGE:
        fileChangeCount += 1
        break
    }
  }

  const parts = [
    reasoningCount > 0
      ? t("transcript.thoughtCount", { count: reasoningCount })
      : null,
    toolCount > 0 ? t("transcript.toolCount", { count: toolCount }) : null,
    commandCount > 0
      ? t("transcript.commandCount", { count: commandCount })
      : null,
    explorationCount > 0
      ? t("transcript.exploredActions", { count: explorationCount })
      : null,
    fileChangeCount > 0
      ? t("transcript.fileChangeCount", { count: fileChangeCount })
      : null,
  ].filter(Boolean)

  if (parts.length === 0) {
    return t("transcript.thoughtProcess")
  }

  return t("transcript.thoughtProcessSummary", { summary: parts.join(", ") })
}

function hasExplorationCommandAction(item: SessionTranscriptItem) {
  return item.commandActions?.some((action) => {
    const kind = normalizeCommandActionKind(action.kind)
    return (
      kind !== SessionTranscriptCommandActionKind.UNSPECIFIED &&
      kind !== SessionTranscriptCommandActionKind.UNKNOWN
    )
  })
}

function normalizeCommandActionKind(
  value: SessionTranscriptCommandAction["kind"] | string | number | undefined
) {
  switch (value) {
    case SessionTranscriptCommandActionKind.READ:
    case "SESSION_TRANSCRIPT_COMMAND_ACTION_KIND_READ":
    case "READ":
    case "read":
      return SessionTranscriptCommandActionKind.READ
    case SessionTranscriptCommandActionKind.LIST_FILES:
    case "SESSION_TRANSCRIPT_COMMAND_ACTION_KIND_LIST_FILES":
    case "LIST_FILES":
    case "listFiles":
    case "list_files":
      return SessionTranscriptCommandActionKind.LIST_FILES
    case SessionTranscriptCommandActionKind.SEARCH:
    case "SESSION_TRANSCRIPT_COMMAND_ACTION_KIND_SEARCH":
    case "SEARCH":
    case "search":
      return SessionTranscriptCommandActionKind.SEARCH
    case SessionTranscriptCommandActionKind.UNKNOWN:
    case "SESSION_TRANSCRIPT_COMMAND_ACTION_KIND_UNKNOWN":
    case "UNKNOWN":
    case "unknown":
      return SessionTranscriptCommandActionKind.UNKNOWN
    default:
      return SessionTranscriptCommandActionKind.UNSPECIFIED
  }
}

// extractDiffCommentBodies pulls individual diff comments out of a synthetic review-wrapper prompt.
function extractDiffCommentBodies(value: string) {
  if (!/^# Diff comments:/m.test(value)) {
    return []
  }

  const comments: string[] = []
  const lines = value.split("\n")
  let collecting = false
  let buffer: string[] = []

  function flush() {
    if (buffer.length === 0) {
      return
    }

    // The extractor intentionally strips screenshot narration and other
    // browser-run artifacts so only the actionable comment text survives.
    const body = cleanUserMessageFragment(buffer.join("\n"))
    if (body) {
      comments.push(body)
    }
    buffer = []
  }

  for (const line of lines) {
    const trimmed = line.trim()

    if (collecting) {
      if (
        /^## Comment \d+/.test(trimmed) ||
        /^# In app browser \(IAB\):/.test(trimmed) ||
        /^## My request for Codex:/.test(trimmed)
      ) {
        collecting = false
        flush()
      } else {
        buffer.push(line)
        continue
      }
    }

    if (trimmed === "Comment:") {
      collecting = true
      buffer = []
    }
  }

  if (collecting) {
    flush()
  }

  return comments
}

// cleanUserMessageFragment strips screenshot narration and trailing image markers from extracted prompt text.
function cleanUserMessageFragment(value: string) {
  return value
    .replace(/\n\s*The next image shows the browser page[\s\S]*$/m, "")
    .replace(/\n\s*\[image\]\s*$/g, "")
    .trim()
}
