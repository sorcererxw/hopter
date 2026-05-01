import { useCallback, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import {
  ChevronRight,
  Copy,
  FileImage,
  FileText,
  Lightbulb,
  LoaderCircle,
  Edit02Icon,
  X,
} from "@/components/icons/hugeicons"
import { Modal } from "@heroui/react"
import { Tooltip } from "@heroui/react/tooltip"

import {
  CodeContainer,
  SessionImage,
  workspaceSoftCardClassName,
  workspaceTintedCardClassName,
} from "@/components/app/shared"
import { useWorkspaceShell } from "@/components/app/workspace"
import {
  SessionTranscriptCommandActionKind,
  SessionTranscriptAttachmentKind,
  SessionTranscriptItemKind,
  type SessionTranscriptAttachment,
  type SessionTranscriptCommandAction,
  type SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"
import { cn, resolveImageSource } from "@/lib/utils"

import { isReasoningPlaceholderText } from "./activity"
import { SessionRichText } from "./rich-text"
import {
  TranscriptDisclosureBody,
  TranscriptDisclosureButton,
  TranscriptDisclosureItem,
} from "./timeline-disclosure"
import {
  useActivitySyncedDisclosure,
  useTranscriptDisclosure,
} from "./timeline-disclosure-state"
import { FileChangeGroupEntry } from "./timeline-file-changes"
import { buildThoughtProcessDisplayItems } from "./timeline-model"
import {
  formatUserMessageForDisplay,
  parseCommandExecutionDetail,
  summarizeThoughtProcess,
} from "./timeline-formatters"

type LocalPathHandler = (path: string) => void

const thoughtProcessCodeClassName =
  "rounded-none border-0 bg-transparent px-0 py-0 shadow-none"
const userMessageCollapseCharacterThreshold = 900
const userMessageCollapseLineThreshold = 12

// TranscriptEntry maps a single transcript protocol item onto a concrete UI
// renderer. The default branch intentionally falls back to AgentMessageEntry so
// newly added server item kinds degrade into readable text instead of breaking
// the transcript outright.
export function TranscriptEntry({
  item,
  onEditUserMessage,
  onSelectPath,
  projectRootPath,
}: {
  item: SessionTranscriptItem
  onEditUserMessage?: (item: SessionTranscriptItem) => void
  onSelectPath: LocalPathHandler
  projectRootPath?: string
}) {
  switch (item.kind) {
    case SessionTranscriptItemKind.USER_MESSAGE:
      return (
        <UserMessageEntry
          item={item}
          onEdit={onEditUserMessage}
          onSelectPath={onSelectPath}
        />
      )
    case SessionTranscriptItemKind.AGENT_MESSAGE:
      return <AgentMessageEntry item={item} onSelectPath={onSelectPath} />
    case SessionTranscriptItemKind.REASONING:
      return <ReasoningEntry item={item} onSelectPath={onSelectPath} />
    case SessionTranscriptItemKind.TOOL_CALL:
      return <ToolCallEntry item={item} />
    case SessionTranscriptItemKind.COMMAND_EXECUTION:
      return <CommandEntry item={item} projectRootPath={projectRootPath} />
    case SessionTranscriptItemKind.FILE_CHANGE:
      return (
        <FileChangeGroupEntry
          items={[item]}
          projectRootPath={projectRootPath}
        />
      )
    default:
      return <AgentMessageEntry item={item} onSelectPath={onSelectPath} />
  }
}

// ThoughtProcessGroupEntry renders a collapsible summary row for grouped reasoning/tool activity.
export function ThoughtProcessGroupEntry({
  items,
  onSelectPath,
  projectRootPath,
  suppressFileChanges = false,
}: {
  items: SessionTranscriptItem[]
  onSelectPath: LocalPathHandler
  projectRootPath?: string
  suppressFileChanges?: boolean
}) {
  const { t } = useTranslation()
  // When file changes are attached to the following completed answer, the
  // thought-group still exists structurally but should not render those file
  // change rows again inside the collapsible body.
  const visibleItems = suppressFileChanges
    ? items.filter(
        (item) => item.kind !== SessionTranscriptItemKind.FILE_CHANGE
      )
    : items
  const [expanded, toggleExpanded] = useTranscriptDisclosure(
    false,
    `thought-group:${visibleItems[0]?.id ?? items[0]?.id ?? "empty"}`
  )
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
        className="flex w-full items-center gap-2 text-base font-medium text-muted transition hover:text-foreground"
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
      <TranscriptDisclosureBody expanded={expanded}>
        <div
          className="mt-2 space-y-2"
          data-testid="session-transcript-thought-group-body"
        >
          {renderThoughtProcessItems(
            visibleItems,
            onSelectPath,
            projectRootPath
          )}
        </div>
      </TranscriptDisclosureBody>
    </div>
  )
}

// CommandExecutionGroupEntry collapses multiple completed command executions into one expandable block.
export function CommandExecutionGroupEntry({
  items,
  projectRootPath,
}: {
  items: SessionTranscriptItem[]
  projectRootPath?: string
}) {
  const { t } = useTranslation()
  const [expanded, toggleExpanded] = useTranscriptDisclosure(
    false,
    `command-group:${items[0]?.id ?? "empty"}`
  )
  const label = t("transcript.executedCommands", { count: items.length })

  return (
    <div className="min-w-0" data-testid="session-transcript-command-group">
      <TranscriptDisclosureButton
        onClick={toggleExpanded}
        expanded={expanded}
        iconClassName="size-3 shrink-0"
        className="max-w-full gap-2 text-base font-medium text-muted hover:text-foreground"
      >
        <span>{label}</span>
      </TranscriptDisclosureButton>
      <TranscriptDisclosureBody expanded={expanded}>
        <div className="mt-2 flex flex-col gap-2">
          {items.map((item) => (
            <CommandEntry
              key={item.id}
              item={item}
              projectRootPath={projectRootPath}
            />
          ))}
        </div>
      </TranscriptDisclosureBody>
    </div>
  )
}

// ExplorationGroupEntry collapses multiple Codex commandActions into one exploration row.
export function ExplorationGroupEntry({
  items,
  projectRootPath,
}: {
  items: SessionTranscriptItem[]
  projectRootPath?: string
}) {
  const { t } = useTranslation()
  const [expanded, toggleExpanded] = useTranscriptDisclosure(
    false,
    `exploration-group:${items[0]?.id ?? "empty"}`
  )
  const label = t("transcript.exploredFileActions", { count: items.length })

  return (
    <div className="min-w-0" data-testid="session-transcript-exploration-group">
      <TranscriptDisclosureButton
        onClick={toggleExpanded}
        expanded={expanded}
        iconClassName="size-3 shrink-0"
        className="max-w-full gap-2 text-base font-medium text-muted hover:text-foreground"
      >
        <span>{label}</span>
      </TranscriptDisclosureButton>
      <TranscriptDisclosureBody expanded={expanded}>
        <div className="mt-2 flex flex-col gap-2">
          {items.map((item) => (
            <CommandEntry
              key={item.id}
              item={item}
              projectRootPath={projectRootPath}
            />
          ))}
        </div>
      </TranscriptDisclosureBody>
    </div>
  )
}

// ToolCallGroupEntry collapses multiple completed tool calls into one expandable block.
export function ToolCallGroupEntry({
  items,
}: {
  items: SessionTranscriptItem[]
}) {
  const { t } = useTranslation()
  const [expanded, toggleExpanded] = useTranscriptDisclosure(
    false,
    `tool-group:${items[0]?.id ?? "empty"}`
  )
  const label = t("transcript.executedTools", { count: items.length })

  return (
    <div className="min-w-0" data-testid="session-transcript-tool-group">
      <TranscriptDisclosureButton
        onClick={toggleExpanded}
        expanded={expanded}
        iconClassName="size-3 shrink-0"
        className="max-w-full gap-2 text-base text-muted hover:text-foreground"
      >
        <span>{label}</span>
      </TranscriptDisclosureButton>
      <TranscriptDisclosureBody expanded={expanded}>
        <div className="mt-2 flex flex-col gap-2">
          {items.map((item) => (
            <ToolCallEntry key={item.id} item={item} />
          ))}
        </div>
      </TranscriptDisclosureBody>
    </div>
  )
}

// UserMessageEntry renders the user's prompt bubble plus any attached files or images.
function UserMessageEntry({
  item,
  onEdit,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onEdit?: (item: SessionTranscriptItem) => void
  onSelectPath: LocalPathHandler
}) {
  const { t } = useTranslation()
  // User prompts can arrive wrapped in diff-review or in-app-browser metadata.
  // formatUserMessageForDisplay peels that framing away so reviewers see the
  // human-authored request instead of transport scaffolding.
  const displayText =
    item.displayBody.trim() || formatUserMessageForDisplay(item.body)
  const imageAttachments = item.attachments.filter(
    (attachment) => attachment.kind === SessionTranscriptAttachmentKind.IMAGE
  )
  const nonImageAttachments = item.attachments.filter(
    (attachment) => attachment.kind !== SessionTranscriptAttachmentKind.IMAGE
  )
  const collapsible =
    displayText.length > userMessageCollapseCharacterThreshold ||
    displayText.split("\n").length > userMessageCollapseLineThreshold
  const [expanded, toggleExpanded] = useTranscriptDisclosure(
    false,
    `user-message:${item.id}`
  )
  const showFullMessage = !collapsible || expanded

  return (
    <div className="flex justify-end" data-testid="session-transcript-user">
      <div className="group/user-message flex max-w-[85%] flex-col items-end">
        <div
          className={cn(
            "overflow-hidden px-4 py-3 leading-6 text-foreground",
            workspaceTintedCardClassName
          )}
        >
          <div
            className={cn(
              "relative min-w-0",
              !showFullMessage && "max-h-80 overflow-hidden"
            )}
          >
            <SessionRichText
              text={displayText}
              className="leading-6 text-foreground"
              markdown={false}
              onLocalPathClick={onSelectPath}
            />
            {!showFullMessage ? (
              <div className="pointer-events-none absolute inset-x-0 bottom-0 h-16 bg-gradient-to-b from-transparent to-background-secondary" />
            ) : null}
          </div>
          {collapsible ? (
            <button
              type="button"
              className="mt-2 text-sm text-muted transition hover:text-foreground"
              onClick={toggleExpanded}
            >
              {expanded
                ? t("transcript.collapseUserMessage")
                : t("transcript.expandUserMessage")}
            </button>
          ) : null}
          <TranscriptImageAttachmentGrid
            attachments={imageAttachments}
            flushBottom={nonImageAttachments.length === 0}
          />
          <TranscriptAttachments
            attachments={nonImageAttachments}
            onSelectPath={onSelectPath}
          />
        </div>
        {onEdit ? (
          <div className="mt-1 flex h-7 justify-end opacity-0 transition-opacity duration-150 group-hover/user-message:opacity-100 group-focus-within/user-message:opacity-100">
            <Tooltip>
              <Tooltip.Trigger>
                <span className="inline-flex rounded-full">
                  <button
                    type="button"
                    className="inline-flex size-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-tertiary hover:text-foreground"
                    aria-label={t("transcript.editMessage")}
                    onClick={() => onEdit(item)}
                  >
                    <Edit02Icon className="size-4" />
                  </button>
                </span>
              </Tooltip.Trigger>
              <Tooltip.Content>{t("transcript.editMessage")}</Tooltip.Content>
            </Tooltip>
          </div>
        ) : null}
      </div>
    </div>
  )
}

// TranscriptAttachments lays out non-image attachment pills inside a user message bubble.
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
    <div className="mt-3 flex flex-wrap justify-end gap-2">
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

// TranscriptImageAttachmentGrid adapts image attachments into a compact media grid.
function TranscriptImageAttachmentGrid({
  attachments,
  flushBottom,
}: {
  attachments: SessionTranscriptAttachment[]
  flushBottom: boolean
}) {
  const { t } = useTranslation()

  if (attachments.length === 0) {
    return null
  }

  const columns = imageGridColumnCount(attachments.length)

  return (
    <div
      className={cn(
        "-mx-4 mt-3 grid w-[calc(100%+2rem)] gap-0 overflow-hidden",
        flushBottom && "-mb-3"
      )}
      style={{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }}
    >
      {attachments.map((attachment) => {
        const label =
          attachment.label ||
          attachment.path ||
          attachment.url ||
          t("transcript.image")
        return (
          <TranscriptImageAttachment
            attachment={attachment}
            icon={<FileImage className="size-5 text-muted" />}
            key={attachment.id || `${attachment.kind}-${label}`}
            label={label}
            tileClassName={cn(
              "w-full rounded-none border-0",
              attachments.length === 1 ? "aspect-video" : "aspect-square"
            )}
          />
        )
      })}
    </div>
  )
}

function imageGridColumnCount(count: number) {
  if (count <= 1) {
    return 1
  }
  if (count <= 4) {
    return 2
  }
  return 3
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
        icon={<Icon className="size-5 text-muted" />}
        label={label}
      />
    )
  }

  const content = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted" />
      <span className="truncate">{label}</span>
    </>
  )
  const className =
    "inline-flex max-w-72 items-center gap-2 rounded-xl border border-border bg-surface px-2.5 py-1.5 text-sm text-muted transition hover:bg-surface-tertiary hover:text-foreground"

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
  tileClassName,
}: {
  attachment: SessionTranscriptAttachment
  icon: React.ReactNode
  label: string
  tileClassName?: string
}) {
  const { t } = useTranslation()
  const [previewOpen, setPreviewOpen] = useState(false)
  const thumbnail = attachment.url
  const thumbnailImage = resolveImageSource(thumbnail)
  const hasUsableThumbnail = thumbnailImage.isUsable
  const content = thumbnail ? (
    <SessionImage
      src={thumbnailImage.src}
      alt={label}
      className="h-full w-full object-cover"
      loading="lazy"
      fallback={
        <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-background-secondary px-2 text-center">
          {icon}
          <span className="max-w-full truncate text-xs text-muted">
            {label}
          </span>
          <span className="max-w-full truncate text-[11px] text-muted/70">
            {t("artifact.previewUnavailable")}
          </span>
        </div>
      }
    />
  ) : (
    <div className="flex h-full w-full flex-col items-center justify-center gap-1 bg-background-secondary px-2 text-center">
      {icon}
      <span className="max-w-full truncate text-xs text-muted">
        {label}
      </span>
      <span className="max-w-full truncate text-[11px] text-muted/70">
        {t("artifact.previewUnavailable")}
      </span>
    </div>
  )

  const className = cn(
    "block overflow-hidden rounded-2xl border border-border bg-surface transition hover:border-border-tertiary",
    tileClassName ?? "size-20"
  )

  if (attachment.url) {
    if (!hasUsableThumbnail) {
      return <div className={className}>{content}</div>
    }

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
  const [previewError, setPreviewError] = useState(false)
  // Phone posture gets a fully immersive preview because the standard dialog
  // chrome wastes too much vertical space on small screens.
  const fullscreen = posture === "phone"
  const resolvedImage = resolveImageSource(src)

  return (
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop variant="opaque">
        <Modal.Container size={fullscreen ? "cover" : undefined}>
          <Modal.Dialog
            className={cn(
              "relative grid text-sm text-overlay-foreground outline-none",
              fullscreen
                ? "h-[100dvh] max-h-none w-screen max-w-none rounded-none bg-black p-0 text-white sm:max-w-none"
                : "h-auto min-h-0 w-auto max-w-[calc(100vw-2rem)] overflow-hidden rounded-3xl bg-overlay p-0 ring-1 ring-foreground/5"
            )}
          >
            <Modal.Heading className="sr-only">{label}</Modal.Heading>
            {!fullscreen ? (
              <Modal.CloseTrigger
                aria-label="Close"
                className="absolute top-4 right-4 z-10 flex size-8 items-center justify-center rounded-lg bg-overlay/80 text-muted transition hover:bg-surface-tertiary hover:text-foreground"
              >
                <X className="size-4" />
              </Modal.CloseTrigger>
            ) : null}
            {fullscreen ? (
              <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-black/70 px-4 pt-[calc(env(safe-area-inset-top)+0.75rem)] pb-3">
                <div className="min-w-0 truncate text-sm text-white">
                  {label}
                </div>
                <Modal.CloseTrigger
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-white transition hover:bg-white/10"
                  aria-label={t("transcript.closeImagePreview")}
                >
                  <X className="size-4" />
                </Modal.CloseTrigger>
              </div>
            ) : null}
            <SessionImage
              src={resolvedImage.src}
              alt={label}
              className={cn(
                fullscreen
                  ? "h-full w-full object-contain px-2 pt-[calc(env(safe-area-inset-top)+4rem)] pb-[env(safe-area-inset-bottom)]"
                  : "block h-auto max-h-[calc(100dvh-2rem)] w-auto max-w-[calc(100vw-2rem)] rounded-3xl object-contain"
              )}
              onError={() => setPreviewError(true)}
              loading="eager"
              draggable={false}
              onClick={(event) => event.stopPropagation()}
              fallback={
                previewError || !resolvedImage.isUsable ? (
                  <span className="px-4 text-sm text-white">
                    {t("artifact.previewUnavailable")}
                  </span>
                ) : null
              }
            />
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
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
      <div
        className={cn(
          "group/agent-card min-w-0 px-4 py-3",
          workspaceSoftCardClassName
        )}
      >
        <SessionRichText text={item.body} onLocalPathClick={onSelectPath} />
        <AgentMessageSourceRow item={item} />
      </div>
    </div>
  )
}

// AgentMessageSourceRow renders lightweight source actions for completed assistant output.
function AgentMessageSourceRow({ item }: { item: SessionTranscriptItem }) {
  const { t } = useTranslation()
  const [copied, setCopied] = useState(false)
  const timestampLabel = useMemo(() => formatTranscriptItemTime(item), [item])
  const handleCopy = useCallback(() => {
    if (!navigator.clipboard) {
      return
    }

    navigator.clipboard.writeText(item.body).then(
      () => {
        setCopied(true)
        window.setTimeout(() => setCopied(false), 1500)
      },
      () => {
        // Clipboard write failed; silently ignore.
      }
    )
  }, [item.body])

  if (
    isActiveAgentMessageStatus(item.status) ||
    item.orderKey.startsWith("live:")
  ) {
    return null
  }

  return (
    <div className="mt-3 flex min-h-7 items-center gap-2 text-sm text-muted">
      <Tooltip>
        <Tooltip.Trigger>
          <span className="inline-flex rounded-full">
            <button
              type="button"
              className="inline-flex size-7 items-center justify-center rounded-full text-muted transition hover:bg-surface-tertiary hover:text-foreground"
              aria-label={
                copied ? t("transcript.copied") : t("transcript.copy")
              }
              onClick={handleCopy}
            >
              <Copy className="size-4" />
            </button>
          </span>
        </Tooltip.Trigger>
        <Tooltip.Content placement="top" showArrow>
          {copied ? t("transcript.copied") : t("transcript.copy")}
        </Tooltip.Content>
      </Tooltip>
      {timestampLabel ? (
        <span className="opacity-0 transition-opacity duration-150 group-hover/agent-card:opacity-100">
          {timestampLabel}
        </span>
      ) : null}
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
  const [expanded, toggleExpanded] = useActivitySyncedDisclosure(
    isStreaming,
    `reasoning:${item.id}`
  )
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
        <div className="text-muted">
          <SessionRichText text={text} onLocalPathClick={onSelectPath} />
        </div>
      </div>
    )
  }

  return (
    <div className="flex gap-3" data-testid="session-transcript-reasoning">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-secondary text-muted">
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
          className="w-full gap-2 text-muted hover:text-foreground"
        >
          <span className="text-sm text-foreground">{label}</span>
          {!showContent && preview ? (
            <span className="truncate text-muted">— {preview}</span>
          ) : null}
        </TranscriptDisclosureButton>
        <TranscriptDisclosureBody expanded={showContent}>
          <div
            className="mt-1 flex flex-col gap-2"
            data-testid="session-transcript-reasoning-body"
          >
            {summaryText ? (
              <SessionRichText
                text={summaryText}
                className="text-muted"
                onLocalPathClick={onSelectPath}
              />
            ) : null}
            {hasRawText ? <RawReasoningBlock text={rawText} /> : null}
          </div>
        </TranscriptDisclosureBody>
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
    <div className="min-w-0" data-testid="session-transcript-tool">
      <TranscriptDisclosureItem
        active={active}
        buttonClassName="w-full gap-1.5 text-muted hover:text-foreground"
        disclosureKey={`tool:${item.id}`}
        iconClassName="size-3"
        label={
          <span className="min-w-0 truncate text-foreground">
            <span className="text-muted transition group-hover:text-foreground">
              {t("transcript.toolCall")}
            </span>{" "}
            <span className="font-mono">{label}</span>
          </span>
        }
      >
        <ToolCallDetail className="mt-2" body={item.body} />
      </TranscriptDisclosureItem>
    </div>
  )
}

// ToolCallDetail uses the same card treatment as command output for raw tool payloads.
function ToolCallDetail({
  body,
  className,
}: {
  body: string
  className?: string
}) {
  return (
    <CodeContainer
      as="div"
      className={cn("max-h-96 px-0 py-0 text-muted", className)}
    >
      <pre className="min-w-max px-4 py-3 whitespace-pre">{body}</pre>
    </CodeContainer>
  )
}

// renderThoughtProcessItems expands grouped thought-process items into displayable child rows.
function renderThoughtProcessItems(
  items: SessionTranscriptItem[],
  onSelectPath: LocalPathHandler,
  projectRootPath?: string
) {
  // Thought groups reuse the same display-item grouping logic as the top-level
  // timeline so repeated completed command executions still collapse together
  // inside the expanded body.
  return buildThoughtProcessDisplayItems(items).map((item) => {
    switch (item.kind) {
      case "command-group":
        return (
          <CommandExecutionGroupEntry
            items={item.items}
            key={item.key}
            projectRootPath={projectRootPath}
          />
        )
      case "exploration-group":
        return (
          <ExplorationGroupEntry
            items={item.items}
            key={item.key}
            projectRootPath={projectRootPath}
          />
        )
      case "tool-group":
        return <ToolCallGroupEntry items={item.items} key={item.key} />
      case "transcript":
        return (
          <ThoughtProcessText
            item={item.item}
            key={item.key}
            onSelectPath={onSelectPath}
            projectRootPath={projectRootPath}
          />
        )
    }
  })
}

// ThoughtProcessText renders a single item inside an expanded thought-process group.
function ThoughtProcessText({
  item,
  onSelectPath,
  projectRootPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: LocalPathHandler
  projectRootPath?: string
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
      {renderThoughtProcessItem(item, text, onSelectPath, projectRootPath)}
    </div>
  )
}

// renderThoughtProcessItem dispatches a thought-process child item to its specific renderer.
function renderThoughtProcessItem(
  item: SessionTranscriptItem,
  text: string,
  onSelectPath: LocalPathHandler,
  projectRootPath?: string
) {
  switch (item.kind) {
    case SessionTranscriptItemKind.TOOL_CALL:
      return <ToolCallEntry item={item} />
    case SessionTranscriptItemKind.COMMAND_EXECUTION:
      return <CommandEntry item={item} projectRootPath={projectRootPath} />
    case SessionTranscriptItemKind.FILE_CHANGE:
      return (
        <FileChangeGroupEntry
          items={[item]}
          projectRootPath={projectRootPath}
        />
      )
    default:
      return <SessionRichText text={text} onLocalPathClick={onSelectPath} />
  }
}

// CommandEntry renders one command execution row with normalized status and expandable output.
function CommandEntry({
  item,
  projectRootPath,
}: {
  item: SessionTranscriptItem
  projectRootPath?: string
}) {
  const { t } = useTranslation()
  // Command status may be duplicated between the structured status field and
  // the freeform body payload. commandExecutionStatus/parseCommandExecutionDetail
  // normalize that inconsistency in one place.
  const active = isActiveCommandExecutionStatus(commandExecutionStatus(item))
  const detail = parseCommandExecutionDetail(item.body)
  const commandLabel = detail.command || item.title || t("transcript.command")
  const actionSummary = summarizeCommandActions(
    item.commandActions,
    projectRootPath
  )
  const statusPrefix = commandExecutionLabelPrefix(item, t)

  if (actionSummary) {
    return (
      <div className="min-w-0" data-testid="session-transcript-command">
        <span className="block min-w-0 truncate text-muted">
          {t(actionSummary.key, { target: actionSummary.target })}
        </span>
      </div>
    )
  }

  return (
    <div className="min-w-0" data-testid="session-transcript-command">
      <TranscriptDisclosureItem
        active={active}
        buttonClassName="w-full min-w-0 gap-1.5 text-muted hover:text-foreground"
        disclosureKey={`command:${item.id}`}
        iconClassName="size-3"
        label={
          <span className="block min-w-0 flex-1 truncate text-foreground">
            <span className="text-muted transition group-hover:text-foreground">
              {statusPrefix}
            </span>{" "}
            <span className="font-mono">{commandLabel}</span>
          </span>
        }
      >
        <CommandExecutionDetail className="mt-2" body={item.body} />
      </TranscriptDisclosureItem>
    </div>
  )
}

function summarizeCommandActions(
  actions: SessionTranscriptCommandAction[] | undefined,
  projectRootPath?: string
): { key: string; target: string } | null {
  const action = actions?.find(
    (candidate) => {
      const kind = normalizeCommandActionKind(candidate.kind)
      return (
        kind !== SessionTranscriptCommandActionKind.UNSPECIFIED &&
        kind !== SessionTranscriptCommandActionKind.UNKNOWN
      )
    }
  )
  if (!action) {
    return null
  }

  switch (normalizeCommandActionKind(action.kind)) {
    case SessionTranscriptCommandActionKind.READ:
      return {
        key: "transcript.exploredFile",
        target: commandActionFileTarget(action, projectRootPath),
      }
    case SessionTranscriptCommandActionKind.LIST_FILES:
      return {
        key: "transcript.exploredDirectory",
        target: commandActionPathTarget(action.path, projectRootPath) || ".",
      }
    case SessionTranscriptCommandActionKind.SEARCH:
      return {
        key: "transcript.searchedPath",
        target:
          commandActionPathTarget(action.path, projectRootPath) ||
          action.query.trim() ||
          action.command.trim(),
      }
    default:
      return null
  }
}

function normalizeCommandActionKind(value: string | number | undefined) {
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

function commandActionFileTarget(
  action: SessionTranscriptCommandAction,
  projectRootPath?: string
) {
  return (
    action.name.trim() ||
    basename(commandActionPathTarget(action.path, projectRootPath)) ||
    action.path.trim() ||
    action.command.trim()
  )
}

function commandActionPathTarget(path: string, projectRootPath?: string) {
  const normalized = path.trim().replaceAll("\\", "/")
  if (!normalized) {
    return ""
  }

  const projectRelativePath = relativeToProjectRoot(normalized, projectRootPath)
  return projectRelativePath || normalized
}

function basename(path: string) {
  const normalized = path.trim().replaceAll("\\", "/").replace(/\/+$/, "")
  const segments = normalized.split("/")
  return segments.at(-1) || normalized
}

function relativeToProjectRoot(path: string, projectRootPath?: string) {
  const root = projectRootPath?.trim().replaceAll("\\", "/").replace(/\/+$/, "")
  if (!root) {
    return undefined
  }

  const roots = new Set([
    root,
    root.replace(/^\/+/, ""),
    root.startsWith("/") ? root : `/${root}`,
  ])

  for (const candidate of roots) {
    if (!candidate) {
      continue
    }
    if (path === candidate) {
      return "."
    }
    if (path.startsWith(`${candidate}/`)) {
      return path.slice(candidate.length + 1)
    }
  }

  return undefined
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
    <CodeContainer
      as="div"
      className={cn("max-h-96 px-0 py-0 text-muted", className)}
    >
      <pre className="min-w-max px-4 py-3 whitespace-pre">
        <span className="text-foreground">{detail.command}</span>
        {detail.output.length > 0 ? (
          <>
            {"\n\n"}
            <span className="text-muted">
              {detail.output.join("\n")}
            </span>
          </>
        ) : null}
      </pre>
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
    <div className="inline-flex min-w-0 items-center gap-2 text-sm text-muted">
      <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-surface-secondary">
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
      <div className="text-xs text-muted">
        {t("transcript.rawReasoning")}
      </div>
      <CodeContainer
        className={cn(thoughtProcessCodeClassName, "text-muted")}
      >
        <pre className="whitespace-pre-wrap">{text}</pre>
      </CodeContainer>
    </div>
  )
}

function formatTranscriptItemTime(item: SessionTranscriptItem) {
  const date = transcriptItemDate(item)
  if (!date) {
    return ""
  }

  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
  }).format(date)
}

function transcriptItemDate(item: SessionTranscriptItem) {
  const liveTimestamp = liveOrderKeyDate(item.orderKey)
  if (liveTimestamp) {
    return liveTimestamp
  }

  return uuidV7Date(item.id) ?? uuidV7Date(item.orderKey.split(":").at(-1))
}

function liveOrderKeyDate(orderKey: string) {
  const match = /^live:(\d{13,20})/.exec(orderKey)
  if (!match) {
    return undefined
  }

  const timestamp = Number(match[1].slice(0, 13))
  if (!Number.isFinite(timestamp)) {
    return undefined
  }

  return new Date(timestamp)
}

function uuidV7Date(value: string | undefined) {
  if (!value) {
    return undefined
  }

  const normalized = value.trim().replace(/^generated:/, "")
  const match =
    /^([0-9a-f]{8})-?([0-9a-f]{4})-?7[0-9a-f]{3}-?[89ab][0-9a-f]{3}-?[0-9a-f]{12}$/i.exec(
      normalized
    )
  if (!match) {
    return undefined
  }

  const timestamp = Number.parseInt(`${match[1]}${match[2]}`, 16)
  if (!Number.isFinite(timestamp)) {
    return undefined
  }

  return new Date(timestamp)
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
