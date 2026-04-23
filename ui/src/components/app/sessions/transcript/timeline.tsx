import { useEffect, useState, type ReactNode } from "react"
import {
  ChevronRight,
  FileImage,
  FileText,
  Lightbulb,
  LoaderCircle,
  Wrench,
  X,
} from "lucide-react"

import { CodeContainer } from "@/components/app/shared"
import { useWorkspaceShell } from "@/components/app/workspace"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  SessionTranscriptAttachmentKind,
  SessionTranscriptItemKind,
  type SessionTranscriptAttachment,
  type SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

import type { ActivityItem } from "./activity"
import { isReasoningPlaceholderText } from "./activity"
import { SessionRichText } from "./rich-text"

type TimelineItem =
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

function isTranscriptActivityItem(
  item: ActivityItem | undefined
): item is Extract<ActivityItem, { kind: "transcript" }> {
  return item?.kind === "transcript"
}

function buildTimelineItems(items: ActivityItem[]): TimelineItem[] {
  return groupTimelineItems(orderCompletedReasoningBeforeAgentAnswers(items))
}

export function TranscriptTimeline({
  items,
  isFetchingPreviousPage,
  isLoadingInitialTranscript,
  onSelectPath,
}: {
  items: ActivityItem[]
  isFetchingPreviousPage: boolean
  isLoadingInitialTranscript: boolean
  onSelectPath: (path: string) => void
}) {
  const timelineItems = buildTimelineItems(items)

  if (timelineItems.length === 0 && !isLoadingInitialTranscript) {
    return (
      <div
        className="rounded-lg border border-border bg-card px-4 py-6 text-sm text-muted-foreground"
        data-testid="session-transcript-empty"
      >
        No timeline events yet. Messages, tool calls, commands, and file changes
        will appear here as Codex works.
      </div>
    )
  }

  return (
    <div
      className="relative flex flex-col gap-2"
      data-testid="session-transcript"
    >
      {isFetchingPreviousPage ? <TranscriptLoadingRow /> : null}
      {timelineItems.map((item, index) => (
        <div
          key={item.key}
          data-index={index}
          className={cn(
            "min-w-0",
            index > 0 &&
              isAssistantReplyAfterUserMessage(
                timelineItems[index - 1],
                item
              ) &&
              "mt-4"
          )}
        >
          {renderTimelineItem(item, { onSelectPath })}
        </div>
      ))}
    </div>
  )
}

function isAssistantReplyAfterUserMessage(
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

function renderTimelineItem(
  item: TimelineItem,
  handlers: {
    onSelectPath: (path: string) => void
  }
) {
  switch (item.kind) {
    case "transcript":
      return (
        <TranscriptEntry
          item={item.item}
          onSelectPath={handlers.onSelectPath}
        />
      )
    case "round-status":
      return <RoundStatusEntry state={item.state} summary={item.summary} />
    case "pending-input":
      return (
        <PendingInputEntry
          onSelectPath={handlers.onSelectPath}
          text={item.text}
        />
      )
    case "thinking":
      return <ThinkingEntry />
    case "command-group":
      return <CommandExecutionGroupEntry items={item.items} />
    case "thought-group":
      return (
        <ThoughtProcessGroupEntry
          items={item.items}
          onSelectPath={handlers.onSelectPath}
        />
      )
  }
}

function TranscriptLoadingRow() {
  return (
    <div
      className="pointer-events-none absolute inset-x-0 -top-10 z-10 flex items-center justify-center"
      data-testid="session-transcript-loading"
    >
      <div className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm">
        <LoaderCircle className="size-4 animate-spin" />
      </div>
    </div>
  )
}

export function InitialTranscriptLoader() {
  return (
    <div
      className="inline-flex size-12 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm"
      data-testid="session-transcript-loading-initial"
    >
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  )
}

export function CenteredTranscriptLoader() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <InitialTranscriptLoader />
    </div>
  )
}

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
      shouldFoldCommandExecution(current.item)
    ) {
      const commandItems: SessionTranscriptItem[] = []

      while (cursor < items.length) {
        const next = items[cursor]
        if (
          !isTranscriptActivityItem(next) ||
          !shouldFoldCommandExecution(next.item)
        ) {
          break
        }

        commandItems.push(next.item)
        cursor += 1
      }

      if (commandItems.length > 1) {
        timelineItems.push({
          items: commandItems,
          key: commandExecutionGroupKey(commandItems),
          kind: "command-group",
        })
      } else if (commandItems[0]) {
        timelineItems.push({
          item: commandItems[0],
          key: commandItems[0].id,
          kind: "transcript",
        })
      }
      continue
    }

    if (
      isTranscriptActivityItem(current) &&
      shouldFoldThoughtItem(current.item)
    ) {
      const thoughtItems: SessionTranscriptItem[] = []

      while (cursor < items.length) {
        const next = items[cursor]
        if (
          !isTranscriptActivityItem(next) ||
          !shouldFoldThoughtItem(next.item)
        ) {
          break
        }

        thoughtItems.push(next.item)
        cursor += 1
      }

      const nextItem = items[cursor]
      const shouldCollapseThoughts =
        isFinalAgentActivityItem(nextItem) ||
        thoughtRunBelongsToCompletedAnswer(items, cursor)
      if (shouldCollapseThoughts) {
        timelineItems.push({
          items: thoughtItems,
          key: thoughtProcessGroupKey(thoughtItems),
          kind: "thought-group",
        })
      } else {
        for (const item of thoughtItems) {
          timelineItems.push({
            item,
            key: item.id,
            kind: "transcript",
          })
        }
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

function isFinalAgentActivityItem(item: ActivityItem | undefined) {
  return (
    item?.kind === "transcript" &&
    item.item.kind === SessionTranscriptItemKind.AGENT_MESSAGE &&
    !isActiveAgentMessageStatus(item.item.status)
  )
}

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

function isCompletedReasoningActivityItem(item: ActivityItem | undefined) {
  return (
    item?.kind === "transcript" &&
    item.item.kind === SessionTranscriptItemKind.REASONING &&
    !isActiveReasoningStatus(item.item.status)
  )
}

function shouldFoldThoughtItem(item: SessionTranscriptItem) {
  if (item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION) {
    return !isActiveCommandExecutionStatus(commandExecutionStatus(item))
  }
  if (isPlainProgressReasoningItem(item)) {
    return false
  }

  return (
    item.kind === SessionTranscriptItemKind.REASONING ||
    item.kind === SessionTranscriptItemKind.TOOL_CALL ||
    item.kind === SessionTranscriptItemKind.FILE_CHANGE
  )
}

function isActiveThoughtProcessItem(item: SessionTranscriptItem) {
  if (item.kind === SessionTranscriptItemKind.REASONING) {
    return isActiveReasoningStatus(item.status)
  }
  if (item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION) {
    return isActiveCommandExecutionStatus(commandExecutionStatus(item))
  }
  return false
}

function PendingInputEntry({
  onSelectPath,
  text,
}: {
  onSelectPath: (path: string) => void
  text: string
}) {
  return (
    <div className="flex justify-end" data-testid="session-transcript-pending">
      <div className="max-w-[85%]">
        <SessionRichText
          text={text}
          className="rounded-lg bg-muted px-3 py-2.5 leading-6"
          markdown={false}
          onLocalPathClick={onSelectPath}
        />
      </div>
    </div>
  )
}

function ThinkingEntry() {
  return (
    <div className="min-w-0" data-testid="session-transcript-thinking">
      <div className="inline-flex items-center gap-2 text-muted-foreground">
        <LoaderCircle className="size-3.5 animate-spin" />
        <span>Thinking...</span>
      </div>
    </div>
  )
}

function RoundStatusEntry({
  state,
  summary,
}: {
  state: "finished" | "attention"
  summary: string
}) {
  return (
    <div className="min-w-0" data-testid="session-transcript-round-status">
      <div className="min-w-0 rounded-lg border border-border bg-card px-4 py-3 text-muted-foreground">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "attention" ? "bg-amber-400" : "bg-sky-400"
            )}
          />
          <span>{summary}</span>
        </div>
      </div>
    </div>
  )
}

function TranscriptEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: (path: string) => void
}) {
  switch (item.kind) {
    case SessionTranscriptItemKind.USER_MESSAGE:
      return <UserMessageEntry item={item} onSelectPath={onSelectPath} />
    case SessionTranscriptItemKind.AGENT_MESSAGE:
      return <AgentMessageEntry item={item} onSelectPath={onSelectPath} />
    case SessionTranscriptItemKind.REASONING:
      return <ReasoningEntry item={item} onSelectPath={onSelectPath} />
    case SessionTranscriptItemKind.TOOL_CALL:
      return <ToolCallEntry item={item} />
    case SessionTranscriptItemKind.COMMAND_EXECUTION:
      return <CommandEntry item={item} />
    case SessionTranscriptItemKind.FILE_CHANGE:
      return <FileChangeGroupEntry items={[item]} />
    default:
      return <AgentMessageEntry item={item} onSelectPath={onSelectPath} />
  }
}

function UserMessageEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: (path: string) => void
}) {
  const displayText =
    item.displayBody.trim() || formatUserMessageForDisplay(item.body)

  return (
    <div
      className="my-4 flex justify-end"
      data-testid="session-transcript-user"
    >
      <div className="max-w-[85%]">
        <SessionRichText
          text={displayText}
          className="rounded-lg bg-muted px-3 py-2.5 leading-6"
          markdown={false}
          onLocalPathClick={onSelectPath}
        />
        <TranscriptAttachments
          attachments={item.attachments}
          onSelectPath={onSelectPath}
        />
      </div>
    </div>
  )
}

function TranscriptAttachments({
  attachments,
  onSelectPath,
}: {
  attachments: SessionTranscriptAttachment[]
  onSelectPath: (path: string) => void
}) {
  if (attachments.length === 0) {
    return null
  }

  return (
    <div className="mt-2 flex flex-wrap justify-end gap-2">
      {attachments.map((attachment) => (
        <TranscriptAttachmentPill
          attachment={attachment}
          key={attachment.id || `${attachment.kind}-${attachment.label}`}
          onSelectPath={onSelectPath}
        />
      ))}
    </div>
  )
}

function TranscriptAttachmentPill({
  attachment,
  onSelectPath,
}: {
  attachment: SessionTranscriptAttachment
  onSelectPath: (path: string) => void
}) {
  const label =
    attachment.label ||
    attachment.path ||
    attachment.url ||
    (attachment.kind === SessionTranscriptAttachmentKind.IMAGE
      ? "Image"
      : "File")
  const Icon =
    attachment.kind === SessionTranscriptAttachmentKind.IMAGE
      ? FileImage
      : FileText

  if (attachment.kind === SessionTranscriptAttachmentKind.IMAGE) {
    return (
      <TranscriptImageAttachment
        attachment={attachment}
        icon={<Icon className="size-5 text-muted-foreground" />}
        label={label}
      />
    )
  }

  const content = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
      <span className="truncate">{label}</span>
    </>
  )
  const className =
    "inline-flex max-w-72 items-center gap-2 rounded-md bg-card px-2.5 py-1.5 text-sm text-muted-foreground transition hover:bg-accent hover:text-foreground"

  if (attachment.url) {
    return (
      <a
        href={attachment.url}
        target="_blank"
        rel="noreferrer"
        className={className}
      >
        {content}
      </a>
    )
  }

  if (
    attachment.path &&
    attachment.kind === SessionTranscriptAttachmentKind.FILE
  ) {
    return (
      <button
        type="button"
        className={className}
        onClick={() => onSelectPath(attachment.path)}
      >
        {content}
      </button>
    )
  }

  return <span className={className}>{content}</span>
}

function TranscriptImageAttachment({
  attachment,
  icon,
  label,
}: {
  attachment: SessionTranscriptAttachment
  icon: React.ReactNode
  label: string
}) {
  const [previewOpen, setPreviewOpen] = useState(false)
  const thumbnail = attachment.url
  const content = thumbnail ? (
    <img
      src={thumbnail}
      alt={label}
      className="h-full w-full object-cover"
      loading="lazy"
    />
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-muted px-2 text-center">
      {icon}
      <span className="max-w-full truncate text-xs text-muted-foreground">
        {label}
      </span>
      <span className="max-w-full truncate text-[11px] text-muted-foreground/70">
        Preview unavailable
      </span>
    </div>
  )

  const className =
    "block size-20 overflow-hidden rounded-lg border border-border bg-card transition hover:border-border-strong"

  if (attachment.url) {
    return (
      <>
        <button
          type="button"
          className={className}
          title={label}
          onClick={() => setPreviewOpen(true)}
        >
          {content}
        </button>
        {previewOpen ? (
          <ImagePreviewDialog
            label={label}
            open={previewOpen}
            onOpenChange={setPreviewOpen}
            src={attachment.url}
          />
        ) : null}
      </>
    )
  }

  return (
    <div className={className} title={attachment.path || label}>
      {content}
    </div>
  )
}

function ImagePreviewDialog({
  label,
  onOpenChange,
  open,
  src,
}: {
  label: string
  onOpenChange: (open: boolean) => void
  open: boolean
  src: string
}) {
  const { posture } = useWorkspaceShell()
  const fullscreen = posture === "phone"

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        className={cn(
          fullscreen
            ? "h-[100dvh] max-h-none w-screen max-w-none rounded-none bg-black p-0 text-white sm:max-w-none"
            : "max-h-[80vh] max-w-[80vw] p-2 sm:max-w-[80vw]"
        )}
        showCloseButton={!fullscreen}
      >
        <DialogTitle className="sr-only">{label}</DialogTitle>
        {fullscreen ? (
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-black/70 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
            <div className="min-w-0 truncate text-sm font-medium text-white">
              {label}
            </div>
            <DialogClose asChild>
              <button
                type="button"
                className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition hover:bg-white/10"
                aria-label="Close image preview"
              >
                <X className="size-4" />
              </button>
            </DialogClose>
          </div>
        ) : null}
        <img
          src={src}
          alt={label}
          className={cn(
            fullscreen
              ? "h-full w-full object-contain px-2 pt-[calc(env(safe-area-inset-top)+4rem)] pb-[env(safe-area-inset-bottom)]"
              : "max-h-[calc(80vh-2rem)] max-w-full rounded-lg object-contain"
          )}
          loading="eager"
          draggable={false}
          onClick={(event) => event.stopPropagation()}
        />
      </DialogContent>
    </Dialog>
  )
}
function AgentMessageEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: (path: string) => void
}) {
  return (
    <div className="min-w-0" data-testid="session-transcript-agent">
      <div className="min-w-0">
        <SessionRichText text={item.body} onLocalPathClick={onSelectPath} />
      </div>
    </div>
  )
}

function ReasoningEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: (path: string) => void
}) {
  const isStreaming = isActiveReasoningStatus(item.status)
  const [expanded, setExpanded] = useState(isStreaming)
  const label = item.title || (isStreaming ? "Thinking" : "Reasoning")
  const summaryText = isReasoningPlaceholderText(item.body)
    ? ""
    : item.body.trim()
  const rawText = isReasoningPlaceholderText(item.displayBody)
    ? ""
    : item.displayBody.trim()
  const hasRawText = rawText.length > 0 && rawText !== summaryText
  const preview = summaryText.split("\n")[0]?.slice(0, 120) || ""
  const showContent = expanded || isStreaming
  const disclosureLabel =
    !showContent && preview ? `${label}: ${preview}` : label

  if (isPlainProgressReasoning(label, isStreaming)) {
    const text = summaryText || rawText

    if (!text) {
      return null
    }

    return (
      <div className="min-w-0" data-testid="session-transcript-reasoning">
        <SessionRichText text={text} onLocalPathClick={onSelectPath} />
      </div>
    )
  }

  return (
    <div className="flex gap-3" data-testid="session-transcript-reasoning">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted text-muted-foreground">
        {isStreaming ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Lightbulb className="size-3.5" />
        )}
      </div>
      <div className="min-w-0 flex-1">
        <TranscriptDisclosureButton
          onClick={() => setExpanded((prev) => !prev)}
          expanded={showContent}
          iconClassName="size-3"
          aria-label={disclosureLabel}
          className="w-full gap-2 rounded-lg border border-border bg-card px-3 py-2 text-muted-foreground hover:text-foreground"
        >
          <span className="text-sm font-medium text-foreground">{label}</span>
          {!showContent && preview ? (
            <span className="truncate text-muted-foreground">— {preview}</span>
          ) : null}
        </TranscriptDisclosureButton>
        {showContent ? (
          <div
            className="mt-1 flex flex-col gap-2"
            data-testid="session-transcript-reasoning-body"
          >
            {summaryText ? (
              <SessionRichText
                text={summaryText}
                className="text-muted-foreground"
                onLocalPathClick={onSelectPath}
              />
            ) : null}
            {hasRawText ? <RawReasoningBlock text={rawText} /> : null}
          </div>
        ) : null}
      </div>
    </div>
  )
}

function isPlainProgressReasoning(label: string, isStreaming: boolean) {
  return !isStreaming && label.trim().toLowerCase() === "progress"
}

function isPlainProgressReasoningItem(item: SessionTranscriptItem) {
  return (
    item.kind === SessionTranscriptItemKind.REASONING &&
    isPlainProgressReasoning(item.title, isActiveReasoningStatus(item.status))
  )
}

function RawReasoningBlock({ text }: { text: string }) {
  return (
    <div
      className="flex flex-col gap-1"
      data-testid="session-transcript-reasoning-raw"
    >
      <div className="text-xs text-muted-foreground">Raw reasoning</div>
      <CodeContainer as="pre" className="whitespace-pre-wrap">
        {text}
      </CodeContainer>
    </div>
  )
}

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

function ToolCallEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const label = item.title || "Tool call"

  return (
    <div className="flex gap-3" data-testid="session-transcript-tool">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Wrench className="size-3.5 text-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <TranscriptDisclosureButton
          onClick={() => setExpanded((prev) => !prev)}
          expanded={expanded}
          iconClassName="size-3"
          className="gap-1.5 text-foreground/70 hover:text-foreground"
        >
          <span className="text-sm">{label}</span>
        </TranscriptDisclosureButton>
        {expanded ? (
          <CodeContainer
            as="pre"
            className="mt-1 break-words whitespace-pre-wrap text-foreground/70"
          >
            {item.body}
          </CodeContainer>
        ) : null}
      </div>
    </div>
  )
}

function ThoughtProcessGroupEntry({
  items,
  onSelectPath,
}: {
  items: SessionTranscriptItem[]
  onSelectPath: (path: string) => void
}) {
  const hasActiveThought = items.some((item) =>
    isActiveReasoningStatus(item.status)
  )
  const [expanded, setExpanded] = useState(hasActiveThought)
  const label = summarizeThoughtProcess(items)

  useEffect(() => {
    setExpanded(hasActiveThought)
  }, [hasActiveThought])

  return (
    <div
      className="min-w-0 text-foreground"
      data-testid="session-transcript-thought-group"
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-center gap-1 border-b border-border pb-1 text-base font-medium text-muted-foreground transition hover:text-foreground"
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="min-w-0 truncate">{label}</span>
        <ChevronRight
          aria-hidden="true"
          className={cn(
            "size-4 shrink-0 transition",
            expanded ? "rotate-90" : "opacity-70"
          )}
        />
      </button>
      {expanded ? (
        <div
          className="mt-4 space-y-4"
          data-testid="session-transcript-thought-group-body"
        >
          {items.map((item) => (
            <ThoughtProcessText
              item={item}
              key={item.id}
              onSelectPath={onSelectPath}
            />
          ))}
        </div>
      ) : null}
    </div>
  )
}

function ThoughtProcessText({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: (path: string) => void
}) {
  const body = isReasoningPlaceholderText(item.body) ? "" : item.body.trim()
  const raw = isReasoningPlaceholderText(item.displayBody)
    ? ""
    : item.displayBody.trim()
  const text = body || raw

  if (!text) {
    return null
  }

  return (
    <div
      className="min-w-0 text-foreground"
      data-testid="session-transcript-thought-item"
    >
      {renderThoughtProcessItem(item, text, onSelectPath)}
    </div>
  )
}

function renderThoughtProcessItem(
  item: SessionTranscriptItem,
  text: string,
  onSelectPath: (path: string) => void
) {
  switch (item.kind) {
    case SessionTranscriptItemKind.TOOL_CALL:
      return <ToolCallEntry item={item} />
    case SessionTranscriptItemKind.COMMAND_EXECUTION:
      return <CommandEntry item={item} />
    case SessionTranscriptItemKind.FILE_CHANGE:
      return <FileChangeGroupEntry items={[item]} />
    default:
      return <SessionRichText text={text} onLocalPathClick={onSelectPath} />
  }
}

function CommandExecutionGroupEntry({
  items,
}: {
  items: SessionTranscriptItem[]
}) {
  const [expanded, setExpanded] = useState(false)
  const label = `Executed ${items.length} command${items.length === 1 ? "" : "s"}`

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={label}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-command-group"
    >
      <div className="flex flex-col gap-2 border-l border-border pl-4">
        {items.map((item) => (
          <CommandEntry key={item.id} item={item} />
        ))}
      </div>
    </TranscriptBatchEntry>
  )
}

function CommandEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const detail = parseCommandExecutionDetail(item.body)
  const commandLabel = detail.command || item.title || "Command"
  const statusPrefix = commandExecutionLabelPrefix(item)

  return (
    <div className="min-w-0" data-testid="session-transcript-command">
      <div className="min-w-0">
        <TranscriptDisclosureButton
          onClick={() => setExpanded((prev) => !prev)}
          expanded={expanded}
          iconClassName="size-3"
          className="gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <span className="min-w-0 truncate text-foreground">
            <span className="text-muted-foreground">{statusPrefix}</span>{" "}
            <span className="font-mono">{commandLabel}</span>
          </span>
        </TranscriptDisclosureButton>
        {expanded ? (
          <CommandExecutionDetail className="mt-1" body={item.body} />
        ) : null}
      </div>
    </div>
  )
}

function CommandExecutionDetail({
  body,
  className,
}: {
  body: string
  className?: string
}) {
  const detail = parseCommandExecutionDetail(body)

  return (
    <CodeContainer as="pre" className={cn("whitespace-pre", className)}>
      <span className="text-foreground">{detail.command}</span>
      {detail.output.length > 0 ? (
        <>
          {"\n\n"}
          <span className="text-muted-foreground">
            {detail.output.join("\n")}
          </span>
        </>
      ) : null}
    </CodeContainer>
  )
}

function shouldFoldCommandExecution(item: SessionTranscriptItem) {
  if (item.kind !== SessionTranscriptItemKind.COMMAND_EXECUTION) {
    return false
  }

  const status = commandExecutionStatus(item)
  return !isActiveCommandExecutionStatus(status)
}

function commandExecutionStatus(item: SessionTranscriptItem) {
  return (
    item.status.trim() || parseCommandExecutionDetail(item.body).status
  ).toLowerCase()
}

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

function commandExecutionLabelPrefix(item: SessionTranscriptItem) {
  return isActiveCommandExecutionStatus(commandExecutionStatus(item))
    ? "Running"
    : "Ran"
}

function commandExecutionGroupKey(items: SessionTranscriptItem[]) {
  const first = items[0]?.id ?? "start"
  const last = items.at(-1)?.id ?? "end"
  return `command-group:${first}:${last}:${items.length}`
}

function thoughtProcessGroupKey(items: SessionTranscriptItem[]) {
  const first = items[0]?.id ?? "start"
  const last = items.at(-1)?.id ?? "end"
  return `thought-group:${first}:${last}:${items.length}`
}

function FileChangeGroupEntry({ items }: { items: SessionTranscriptItem[] }) {
  const changes = items.flatMap((item) => parseFileChangeBody(item.body))

  return (
    <div className="min-w-0" data-testid="session-transcript-file-change">
      <div className="space-y-1">
        {changes.map((change) => (
          <FileChangeRow
            change={change}
            key={`${change.path}-${change.kindLabel}`}
          />
        ))}
      </div>
    </div>
  )
}

function FileChangeRow({ change }: { change: ParsedFileChange }) {
  const [expanded, setExpanded] = useState(false)

  return (
    <div className="min-w-0">
      <TranscriptDisclosureButton
        expanded={expanded}
        iconClassName="ml-auto size-3"
        className="w-full gap-2 py-0.5 text-base text-muted-foreground hover:text-foreground"
        onClick={() => {
          setExpanded((prev) => !prev)
        }}
        title={change.path}
      >
        <span className="shrink-0 text-muted-foreground">
          {change.kindLabel}
        </span>
        <span className="min-w-0 truncate font-mono text-foreground underline decoration-border underline-offset-4">
          {formatFileChangePath(change.path)}
        </span>
        {change.additions || change.deletions ? (
          <span className="flex shrink-0 items-center gap-1 font-mono text-sm">
            <span className="text-emerald-600">+{change.additions}</span>
            <span className="text-destructive">-{change.deletions}</span>
          </span>
        ) : null}
      </TranscriptDisclosureButton>
      {expanded ? (
        <CodeContainer
          as="pre"
          className="mt-1 max-h-96 break-words whitespace-pre-wrap"
        >
          {change.diff?.trim() || "No diff content available."}
        </CodeContainer>
      ) : null}
    </div>
  )
}

function TranscriptBatchEntry({
  children,
  contentClassName,
  expanded,
  label,
  onToggle,
  testId,
}: {
  children: ReactNode
  contentClassName?: string
  expanded: boolean
  label: string
  onToggle: () => void
  testId: string
}) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="min-w-0">
        <TranscriptDisclosureButton
          onClick={onToggle}
          expanded={expanded}
          iconClassName="size-3 shrink-0"
          className="max-w-full gap-2 text-base font-medium text-muted-foreground hover:text-foreground"
        >
          <span>{label}</span>
        </TranscriptDisclosureButton>
        {expanded ? (
          <div className={cn("mt-1", contentClassName)}>{children}</div>
        ) : null}
      </div>
    </div>
  )
}

function TranscriptDisclosureButton({
  children,
  className,
  expanded,
  iconClassName,
  ...props
}: React.ComponentProps<"button"> & {
  expanded: boolean
  iconClassName?: string
}) {
  return (
    <button
      type="button"
      aria-expanded={expanded}
      className={cn(
        "group inline-flex max-w-full items-center text-left transition",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight
        aria-hidden="true"
        className={cn(
          "shrink-0 transition",
          expanded
            ? "rotate-90 opacity-100"
            : "opacity-60 group-hover:opacity-100",
          iconClassName
        )}
      />
    </button>
  )
}

type ParsedFileChange = {
  additions: number
  deletions: number
  diff?: string
  kindLabel: string
  path: string
  movePath?: string
}

function parseFileChangeBody(body: string): ParsedFileChange[] {
  const trimmed = body.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      changes?: Array<{
        additions?: number
        deletions?: number
        diff?: string
        kind?: string
        movePath?: string
        path?: string
      }>
    }

    return (parsed.changes ?? [])
      .filter(
        (change) =>
          typeof change.path === "string" && change.path.trim().length > 0
      )
      .map((change) => ({
        additions: change.additions ?? 0,
        deletions: change.deletions ?? 0,
        diff: change.diff,
        kindLabel: describeFileChangeKind(change.kind),
        movePath: change.movePath,
        path: change.path!.trim(),
      }))
  } catch {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.*?)(?:\s+\(([^)]+)\))?$/)
        const path = match?.[1]?.trim() || line
        const kind = match?.[2]?.trim() || ""
        return {
          additions: 0,
          deletions: 0,
          kindLabel: describeFileChangeKind(kind),
          path,
        }
      })
  }
}

function describeFileChangeKind(kind: string | undefined) {
  switch ((kind || "").toLowerCase()) {
    case "add":
    case "added":
    case "create":
    case "created":
      return "Added"
    case "delete":
    case "deleted":
      return "Deleted"
    case "move":
    case "rename":
    case "renamed":
      return "Moved"
    case "update":
    case "updated":
    case "edit":
    case "edited":
    case "modify":
    case "modified":
      return "Edited"
    default:
      return "Edited"
  }
}

function formatFileChangePath(path: string) {
  const normalized = path.trim()
  if (!normalized) {
    return path
  }

  const segments = normalized.split(/[\\/]/)
  return segments.at(-1) || normalized
}

function formatUserMessageForDisplay(value: string) {
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

function cleanUserMessageFragment(value: string) {
  return value
    .replace(/\n\s*The next image shows the browser page[\s\S]*$/m, "")
    .replace(/\n\s*\[image\]\s*$/g, "")
    .trim()
}

function parseCommandExecutionDetail(body: string) {
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

function summarizeThoughtProcess(items: SessionTranscriptItem[]) {
  let reasoningCount = 0
  let toolCount = 0
  let commandCount = 0
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
        commandCount += 1
        break
      case SessionTranscriptItemKind.FILE_CHANGE:
        fileChangeCount += 1
        break
    }
  }

  const parts = [
    reasoningCount > 0
      ? `${reasoningCount} thought${reasoningCount === 1 ? "" : "s"}`
      : null,
    toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
    commandCount > 0
      ? `${commandCount} command${commandCount === 1 ? "" : "s"}`
      : null,
    fileChangeCount > 0
      ? `${fileChangeCount} file change${fileChangeCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean)

  if (parts.length === 0) {
    return "Thought process"
  }

  return `Thought process: ${parts.join(", ")}`
}
