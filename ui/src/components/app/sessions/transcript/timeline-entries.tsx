import { useState } from "react"
import { useTranslation } from "react-i18next"
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

import { isReasoningPlaceholderText } from "./activity"
import { SessionRichText } from "./rich-text"
import {
  TranscriptDisclosureButton,
  TranscriptDisclosureItem,
  useActivitySyncedDisclosure,
  useTranscriptDisclosure,
} from "./timeline-disclosure"
import { FileChangeGroupEntry } from "./timeline-file-changes"
import { buildThoughtProcessDisplayItems } from "./timeline-model"
import {
  formatUserMessageForDisplay,
  parseCommandExecutionDetail,
  summarizeThoughtProcess,
} from "./timeline-formatters"

type LocalPathHandler = (path: string) => void

// TranscriptEntry maps a single transcript protocol item onto a concrete UI
// renderer. The default branch intentionally falls back to AgentMessageEntry so
// newly added server item kinds degrade into readable text instead of breaking
// the transcript outright.
export function TranscriptEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: LocalPathHandler
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

// ThoughtProcessGroupEntry renders a collapsible summary row for grouped reasoning/tool activity.
export function ThoughtProcessGroupEntry({
  items,
  onSelectPath,
  suppressFileChanges = false,
}: {
  items: SessionTranscriptItem[]
  onSelectPath: LocalPathHandler
  suppressFileChanges?: boolean
}) {
  const { t } = useTranslation()
  const [expanded, toggleExpanded] = useTranscriptDisclosure()
  // When file changes are attached to the following completed answer, the
  // thought-group still exists structurally but should not render those file
  // change rows again inside the collapsible body.
  const visibleItems = suppressFileChanges
    ? items.filter(
        (item) => item.kind !== SessionTranscriptItemKind.FILE_CHANGE
      )
    : items
  const label = summarizeThoughtProcess(visibleItems, t)

  if (visibleItems.length === 0) {
    return null
  }

  return (
    <div
      className="min-w-0 text-foreground"
      data-testid="session-transcript-thought-group"
    >
      <button
        type="button"
        aria-expanded={expanded}
        className="flex w-full items-center gap-1 border-b border-border pb-1 text-base font-medium text-muted-foreground transition hover:text-foreground"
        onClick={toggleExpanded}
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
          {renderThoughtProcessItems(visibleItems, onSelectPath)}
        </div>
      ) : null}
    </div>
  )
}

// CommandExecutionGroupEntry collapses multiple completed command executions into one expandable block.
export function CommandExecutionGroupEntry({
  items,
}: {
  items: SessionTranscriptItem[]
}) {
  const { t } = useTranslation()
  const [expanded, toggleExpanded] = useTranscriptDisclosure()
  const label = t("transcript.executedCommands", { count: items.length })

  return (
    <div className="min-w-0" data-testid="session-transcript-command-group">
      <TranscriptDisclosureButton
        onClick={toggleExpanded}
        expanded={expanded}
        iconClassName="size-3 shrink-0"
        className="max-w-full gap-2 text-base font-medium text-muted-foreground hover:text-foreground"
      >
        <span>{label}</span>
      </TranscriptDisclosureButton>
      {expanded ? (
        <div className="mt-1 flex flex-col gap-2 border-l border-border pl-4">
          {items.map((item) => (
            <CommandEntry key={item.id} item={item} />
          ))}
        </div>
      ) : null}
    </div>
  )
}

// UserMessageEntry renders the user's prompt bubble plus any attached files or images.
function UserMessageEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: LocalPathHandler
}) {
  // User prompts can arrive wrapped in diff-review or in-app-browser metadata.
  // formatUserMessageForDisplay peels that framing away so reviewers see the
  // human-authored request instead of transport scaffolding.
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

// TranscriptAttachments lays out attachment pills beneath a user message bubble.
function TranscriptAttachments({
  attachments,
  onSelectPath,
}: {
  attachments: SessionTranscriptAttachment[]
  onSelectPath: LocalPathHandler
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

// TranscriptAttachmentPill renders a single attachment as either a link, local-file trigger, or image tile.
function TranscriptAttachmentPill({
  attachment,
  onSelectPath,
}: {
  attachment: SessionTranscriptAttachment
  onSelectPath: LocalPathHandler
}) {
  const { t } = useTranslation()
  const label =
    attachment.label ||
    attachment.path ||
    attachment.url ||
    (attachment.kind === SessionTranscriptAttachmentKind.IMAGE
      ? t("transcript.image")
      : t("transcript.file"))
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

// TranscriptImageAttachment renders an image thumbnail and opens the preview dialog when clicked.
function TranscriptImageAttachment({
  attachment,
  icon,
  label,
}: {
  attachment: SessionTranscriptAttachment
  icon: React.ReactNode
  label: string
}) {
  const { t } = useTranslation()
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
        {t("artifact.previewUnavailable")}
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

// ImagePreviewDialog shows a fullscreen-aware modal preview for image attachments.
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
  const { t } = useTranslation()
  const { posture } = useWorkspaceShell()
  // Phone posture gets a fully immersive preview because the standard dialog
  // chrome wastes too much vertical space on small screens.
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
                aria-label={t("transcript.closeImagePreview")}
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

// AgentMessageEntry renders a plain assistant message body without extra chrome.
function AgentMessageEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: LocalPathHandler
}) {
  return (
    <div className="min-w-0" data-testid="session-transcript-agent">
      <div className="min-w-0">
        <SessionRichText text={item.body} onLocalPathClick={onSelectPath} />
      </div>
    </div>
  )
}

// ReasoningEntry renders reasoning as either a marker, plain progress text, or an expandable detail block.
function ReasoningEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: LocalPathHandler
}) {
  const { t } = useTranslation()
  const isStreaming = isActiveReasoningStatus(item.status)
  const [expanded, toggleExpanded] = useActivitySyncedDisclosure(isStreaming)
  const label =
    item.title ||
    (isStreaming ? t("transcript.thinking") : t("transcript.reasoning"))
  const summaryText = isReasoningPlaceholderText(item.body)
    ? ""
    : item.body.trim()
  const rawText = isReasoningPlaceholderText(item.displayBody)
    ? ""
    : item.displayBody.trim()
  const hasRawText = rawText.length > 0 && rawText !== summaryText
  const preview = summaryText.split("\n")[0]?.slice(0, 120) || ""
  const showContent = expanded
  const disclosureLabel =
    !showContent && preview ? `${label}: ${preview}` : label

  // Some reasoning records are placeholders that exist only to signal
  // streaming/progress state. In that case we render a lightweight marker
  // instead of an empty disclosure block.
  if (!summaryText && !rawText) {
    return (
      <div className="min-w-0" data-testid="session-transcript-reasoning">
        <ReasoningMarker active={isStreaming} label={label} />
      </div>
    )
  }

  // "Progress" reasoning is effectively plain transcript text, so showing the
  // usual disclosure chrome would add noise without revealing hidden detail.
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
          onClick={toggleExpanded}
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

// ToolCallEntry renders a tool invocation with collapsible raw payload details.
function ToolCallEntry({ item }: { item: SessionTranscriptItem }) {
  const { t } = useTranslation()
  const active = isActiveToolCallStatus(item.status)
  const label = item.title || t("transcript.toolCall")

  return (
    <div className="flex gap-3" data-testid="session-transcript-tool">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Wrench className="size-3.5 text-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <TranscriptDisclosureItem
          active={active}
          buttonClassName="gap-1.5 text-foreground/70 hover:text-foreground"
          iconClassName="size-3"
          label={<span className="text-sm">{label}</span>}
        >
          <CodeContainer
            as="pre"
            className="mt-1 break-words whitespace-pre-wrap text-foreground/70"
          >
            {item.body}
          </CodeContainer>
        </TranscriptDisclosureItem>
      </div>
    </div>
  )
}

// renderThoughtProcessItems expands grouped thought-process items into displayable child rows.
function renderThoughtProcessItems(
  items: SessionTranscriptItem[],
  onSelectPath: LocalPathHandler
) {
  // Thought groups reuse the same display-item grouping logic as the top-level
  // timeline so repeated completed command executions still collapse together
  // inside the expanded body.
  return buildThoughtProcessDisplayItems(items).map((item) => {
    switch (item.kind) {
      case "command-group":
        return <CommandExecutionGroupEntry items={item.items} key={item.key} />
      case "transcript":
        return (
          <ThoughtProcessText
            item={item.item}
            key={item.key}
            onSelectPath={onSelectPath}
          />
        )
    }
  })
}

// ThoughtProcessText renders a single item inside an expanded thought-process group.
function ThoughtProcessText({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: LocalPathHandler
}) {
  const { t } = useTranslation()
  const body = isReasoningPlaceholderText(item.body) ? "" : item.body.trim()
  const raw = isReasoningPlaceholderText(item.displayBody)
    ? ""
    : item.displayBody.trim()
  const text = body || raw

  // Empty reasoning bodies can still carry status/title information that is
  // worth showing; other empty thought-process items are dropped entirely.
  if (!text) {
    if (item.kind === SessionTranscriptItemKind.REASONING) {
      const active = isActiveReasoningStatus(item.status)
      return (
        <div
          className="min-w-0 text-foreground"
          data-testid="session-transcript-thought-item"
        >
          <ReasoningMarker
            active={active}
            label={
              item.title ||
              (active ? t("transcript.thinking") : t("transcript.reasoning"))
            }
          />
        </div>
      )
    }
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

// renderThoughtProcessItem dispatches a thought-process child item to its specific renderer.
function renderThoughtProcessItem(
  item: SessionTranscriptItem,
  text: string,
  onSelectPath: LocalPathHandler
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

// CommandEntry renders one command execution row with normalized status and expandable output.
function CommandEntry({ item }: { item: SessionTranscriptItem }) {
  const { t } = useTranslation()
  // Command status may be duplicated between the structured status field and
  // the freeform body payload. commandExecutionStatus/parseCommandExecutionDetail
  // normalize that inconsistency in one place.
  const active = isActiveCommandExecutionStatus(commandExecutionStatus(item))
  const detail = parseCommandExecutionDetail(item.body)
  const commandLabel = detail.command || item.title || t("transcript.command")
  const statusPrefix = commandExecutionLabelPrefix(item, t)

  return (
    <div className="min-w-0" data-testid="session-transcript-command">
      <TranscriptDisclosureItem
        active={active}
        buttonClassName="gap-1.5 text-muted-foreground hover:text-foreground"
        iconClassName="size-3"
        label={
          <span className="min-w-0 truncate text-foreground">
            <span className="text-muted-foreground">{statusPrefix}</span>{" "}
            <span className="font-mono">{commandLabel}</span>
          </span>
        }
      >
        <CommandExecutionDetail className="mt-1" body={item.body} />
      </TranscriptDisclosureItem>
    </div>
  )
}

// CommandExecutionDetail formats the parsed command body into command plus output sections.
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

// isPlainProgressReasoning identifies reasoning items that should render like plain transcript text.
function isPlainProgressReasoning(label: string, isStreaming: boolean) {
  return !isStreaming && label.trim().toLowerCase() === "progress"
}

// ReasoningMarker renders the compact icon-and-label form for placeholder or collapsed reasoning.
function ReasoningMarker({
  active,
  label,
}: {
  active: boolean
  label: string
}) {
  return (
    <div className="inline-flex min-w-0 items-center gap-2 text-sm text-muted-foreground">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        {active ? (
          <LoaderCircle className="size-3.5 animate-spin" />
        ) : (
          <Lightbulb className="size-3.5" />
        )}
      </span>
      <span className="min-w-0 truncate">{label}</span>
    </div>
  )
}

// RawReasoningBlock shows the unprocessed reasoning payload beneath the summarized reasoning text.
function RawReasoningBlock({ text }: { text: string }) {
  const { t } = useTranslation()

  return (
    <div
      className="flex flex-col gap-1"
      data-testid="session-transcript-reasoning-raw"
    >
      <div className="text-xs text-muted-foreground">
        {t("transcript.rawReasoning")}
      </div>
      <CodeContainer as="pre" className="whitespace-pre-wrap">
        {text}
      </CodeContainer>
    </div>
  )
}

// isActiveReasoningStatus normalizes backend status variants into a single "active" check.
function isActiveReasoningStatus(status: string) {
  // The backend has emitted several status spellings over time; normalize here
  // so the UI logic does not depend on one exact wire-format variant.
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

// commandExecutionStatus chooses the best available command status from structured and parsed fields.
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

// commandExecutionLabelPrefix picks the localized verb that prefixes each command label.
function commandExecutionLabelPrefix(
  item: SessionTranscriptItem,
  t: ReturnType<typeof useTranslation>["t"]
) {
  return isActiveCommandExecutionStatus(commandExecutionStatus(item))
    ? t("transcript.running")
    : t("transcript.ran")
}
