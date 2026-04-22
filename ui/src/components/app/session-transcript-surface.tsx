import type { RefObject } from "react"
import { ArrowDown } from "lucide-react"

import { SessionArtifactWorkspace } from "@/components/app/session-artifact-workspace"
import { ScrollbarIndicator } from "@/components/app/scrollbar-indicator"
import type { Session } from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

import type { SessionEventStreamState } from "./session-detail-model"
import {
  SessionAttentionBlock,
  SessionConnectionBlock,
} from "./session-detail-status"
import type { ActivityItem } from "./session-transcript-activity"
import {
  InitialTranscriptLoader,
  TranscriptTimeline,
} from "./session-transcript-timeline"

type SessionTranscriptSurfaceProps = {
  activityItems: ActivityItem[]
  eventStreamState: SessionEventStreamState
  hasUnloadedTranscriptHistory: boolean
  isFetchingPreviousPage: boolean
  isLoadingInitialTranscript: boolean
  onApprove: () => void
  onReject: () => void
  onScrollToBottom: () => void
  onTranscriptScroll: () => void
  respondingToApproval: boolean
  scrollbarScrollable: boolean
  scrollbarVisible: boolean
  session: Session
  sessionId: string
  thumbHeight: number
  thumbOffset: number
  transcriptAwayFromBottom: boolean
  transcriptContentRef: RefObject<HTMLDivElement | null>
  transcriptScrollRef: RefObject<HTMLDivElement | null>
  transcriptVisible: boolean
}

export function SessionTranscriptSurface({
  activityItems,
  eventStreamState,
  hasUnloadedTranscriptHistory,
  isFetchingPreviousPage,
  isLoadingInitialTranscript,
  onApprove,
  onReject,
  onScrollToBottom,
  onTranscriptScroll,
  respondingToApproval,
  scrollbarScrollable,
  scrollbarVisible,
  session,
  sessionId,
  thumbHeight,
  thumbOffset,
  transcriptAwayFromBottom,
  transcriptContentRef,
  transcriptScrollRef,
  transcriptVisible,
}: SessionTranscriptSurfaceProps) {
  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={transcriptScrollRef}
        onScroll={onTranscriptScroll}
        className="scrollbar-native-hidden relative h-full overflow-y-auto px-6 py-0"
      >
        <div
          ref={transcriptContentRef}
          className={cn(
            "mx-auto max-w-[720px] space-y-3 py-4 transition-opacity duration-200 ease-out md:py-6",
            transcriptVisible ? "opacity-100" : "opacity-0"
          )}
        >
          <SessionConnectionBlock state={eventStreamState} />

          <SessionAttentionBlock
            onApprove={onApprove}
            onReject={onReject}
            responding={respondingToApproval}
            session={session}
          />

          <TranscriptTimeline
            items={activityItems}
            isFetchingPreviousPage={
              isFetchingPreviousPage && hasUnloadedTranscriptHistory
            }
            isLoadingInitialTranscript={isLoadingInitialTranscript}
            onSelectPath={ignoreLocalPathClick}
          />
          <SessionArtifactWorkspace
            artifacts={session.artifacts}
            sessionId={sessionId}
          />
        </div>
        {!transcriptVisible ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex min-h-full items-center justify-center">
            <InitialTranscriptLoader />
          </div>
        ) : null}
      </div>
      <ScrollbarIndicator
        scrollable={scrollbarScrollable}
        thumbHeight={thumbHeight}
        thumbOffset={thumbOffset}
        visible={scrollbarVisible}
      />
      <button
        type="button"
        aria-label="Scroll to latest message"
        aria-hidden={!transcriptVisible || !transcriptAwayFromBottom}
        tabIndex={transcriptVisible && transcriptAwayFromBottom ? 0 : -1}
        className={cn(
          "absolute bottom-4 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-lg transition-[opacity,background-color] duration-200 ease-out hover:bg-card",
          transcriptVisible && transcriptAwayFromBottom
            ? "opacity-100"
            : "pointer-events-none opacity-0"
        )}
        onClick={onScrollToBottom}
      >
        <ArrowDown className="size-4" />
      </button>
    </div>
  )
}

function ignoreLocalPathClick() {
  // File preview sidebar support is intentionally disabled for now.
}
