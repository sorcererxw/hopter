import { useTranslation } from "react-i18next"
import {
  workspaceSoftCardClassName,
  workspaceTintedCardClassName,
} from "@/components/app/shared"
import { LoaderCircle } from "@/components/icons/hugeicons"
import { cn } from "@/lib/utils"

import type { ActivityItem } from "./activity"
import type { SessionTranscriptItem } from "@/gen/proto/hopter/v1/session_pb"
import {
  CommandExecutionGroupEntry,
  ExplorationGroupEntry,
  ThoughtProcessGroupEntry,
  ToolCallGroupEntry,
  TranscriptEntry,
} from "./timeline-entries"
import { CompletedMessageChangedFiles } from "./timeline-file-changes"
import {
  buildTimelineItems,
  completedMessageFileChanges,
  shouldAttachFileChangesToCompletedMessage,
  type TimelineItem,
} from "./timeline-model"
import { SessionRichText } from "./rich-text"

// TranscriptTimeline is intentionally thin now: it takes already-normalized feed
// items, decides row-level layout concerns, and delegates almost all item
// rendering to specialized submodules. That separation matters for review
// because most behavior changes should happen in timeline-model.ts or
// timeline-entries.tsx rather than here.
export function TranscriptTimeline({
  items,
  isLoadingInitialTranscript,
  onEditUserMessage,
  onSelectPath,
  projectRootPath,
  showTopLoadingIndicator,
}: {
  items: ActivityItem[]
  isLoadingInitialTranscript: boolean
  onEditUserMessage?: (item: SessionTranscriptItem) => void
  onSelectPath: (path: string) => void
  projectRootPath?: string
  showTopLoadingIndicator: boolean
}) {
  const { t } = useTranslation()
  const timelineItems = buildTimelineItems(items)

  if (timelineItems.length === 0 && !isLoadingInitialTranscript) {
    return (
      <div
        className={cn(
          "px-4 py-6 text-sm text-muted",
          workspaceSoftCardClassName
        )}
        data-testid="session-transcript-empty"
      >
        {t("transcript.empty")}
      </div>
    )
  }

  return (
    <div
      className="relative flex flex-col gap-3"
      data-testid="session-transcript"
    >
      {showTopLoadingIndicator ? <TranscriptLoadingRow /> : null}
      {timelineItems.map((item, index) => {
        const previousItem = timelineItems[index - 1]
        const nextItem = timelineItems[index + 1]
        // Some file-change activity items are visually attached to the
        // following completed assistant reply so the turn reads like a single
        // "answer + changed files" unit instead of two disjoint rows.
        const renderedItem = renderTimelineItem(item, {
          onEditUserMessage,
          onSelectPath,
          projectRootPath,
          suppressStandaloneFileChanges:
            shouldAttachFileChangesToCompletedMessage(item, nextItem),
        })
        // The inverse half of the rule above: when the current row is a
        // completed assistant message, pull file changes from the immediately
        // preceding timeline item and render them underneath the message body.
        const attachedFileChanges = completedMessageFileChanges(
          item,
          previousItem
        )

        if (!renderedItem && attachedFileChanges.length === 0) {
          return null
        }

        return (
          <div key={item.key} data-index={index} className="min-w-0">
            {renderedItem}
            {attachedFileChanges.length > 0 ? (
              <CompletedMessageChangedFiles
                items={attachedFileChanges}
                projectRootPath={projectRootPath}
              />
            ) : null}
          </div>
        )
      })}
    </div>
  )
}

function renderTimelineItem(
  item: TimelineItem,
  handlers: {
    onSelectPath: (path: string) => void
    onEditUserMessage?: (item: SessionTranscriptItem) => void
    projectRootPath?: string
    suppressStandaloneFileChanges?: boolean
  }
) {
  // This switch is the only place in the top-level timeline that knows about
  // the coarse row taxonomy. Fine-grained transcript item rendering lives in
  // TranscriptEntry so reviewers can reason about "row kind" separately from
  // "message kind".
  switch (item.kind) {
    case "transcript":
      return (
        <TranscriptEntry
          item={item.item}
          onEditUserMessage={handlers.onEditUserMessage}
          onSelectPath={handlers.onSelectPath}
          projectRootPath={handlers.projectRootPath}
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
      return (
        <CommandExecutionGroupEntry
          items={item.items}
          projectRootPath={handlers.projectRootPath}
        />
      )
    case "exploration-group":
      return (
        <ExplorationGroupEntry
          items={item.items}
          projectRootPath={handlers.projectRootPath}
        />
      )
    case "tool-group":
      return <ToolCallGroupEntry items={item.items} />
    case "thought-group":
      return (
        <ThoughtProcessGroupEntry
          items={item.items}
          onSelectPath={handlers.onSelectPath}
          projectRootPath={handlers.projectRootPath}
          suppressFileChanges={handlers.suppressStandaloneFileChanges === true}
        />
      )
  }
}

// TranscriptLoadingRow renders the inline spinner shown while older transcript history loads.
function TranscriptLoadingRow() {
  // This row appears only while fetching older transcript pages. It is kept
  // visually neutral so it does not compete with actual session content.
  return (
    <div
      className="pointer-events-none flex items-center justify-center"
      data-testid="session-transcript-loading"
    >
      <LoaderCircle className="size-4 animate-spin text-muted" />
    </div>
  )
}

// InitialTranscriptLoader renders the standalone spinner used before transcript content becomes visible.
export function InitialTranscriptLoader() {
  return (
    <div
      className="inline-flex items-center justify-center text-muted"
      data-testid="session-transcript-loading-initial"
    >
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  )
}

// CenteredTranscriptLoader centers the initial transcript loader inside the available pane.
export function CenteredTranscriptLoader() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <InitialTranscriptLoader />
    </div>
  )
}

// PendingInputEntry renders the optimistic user bubble before the server echoes the real transcript item.
function PendingInputEntry({
  onSelectPath,
  text,
}: {
  onSelectPath: (path: string) => void
  text: string
}) {
  // Optimistic pending input is rendered as a user bubble before the backend
  // echoes the canonical user message.
  return (
    <div className="flex justify-end" data-testid="session-transcript-pending">
      <div className="max-w-[85%]">
        <SessionRichText
          text={text}
          className={cn(
            "px-4 py-3 leading-6 text-foreground",
            workspaceTintedCardClassName
          )}
          markdown={false}
          onLocalPathClick={onSelectPath}
        />
      </div>
    </div>
  )
}

// ThinkingEntry renders the lightweight "assistant is thinking" placeholder row.
function ThinkingEntry() {
  const { t } = useTranslation()

  return (
    <div className="min-w-0" data-testid="session-transcript-thinking">
      <div className="inline-flex items-center gap-2 text-muted">
        <LoaderCircle className="size-3.5 animate-spin" />
        <span>{t("transcript.thinking")}</span>
      </div>
    </div>
  )
}

// RoundStatusEntry renders feed-level summary rows such as completion or attention states.
function RoundStatusEntry({
  state,
  summary,
}: {
  state: "finished" | "attention"
  summary: string
}) {
  // Round status rows come from feed-level activity, not transcript items. They
  // summarize workflow state such as approvals or round completion without
  // pretending to be agent/user messages.
  return (
    <div className="min-w-0" data-testid="session-transcript-round-status">
      <div
        className={cn(
          "min-w-0 px-4 py-3 text-muted",
          workspaceSoftCardClassName
        )}
      >
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
