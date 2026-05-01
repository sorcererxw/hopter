import {
  useCallback,
  useEffect,
  useState,
  type ReactNode,
  type RefObject,
  type UIEvent,
} from "react"
import { useTranslation } from "react-i18next"
import { ScrollShadow } from "@heroui/react"
import { ArrowDown } from "@/components/icons/hugeicons"

import {
  hiddenScrollbarClassName,
  workspaceContentWidthClassName,
} from "@/components/app/shared"
import {
  SessionAttentionBlock,
  SessionConnectionBlock,
  type SessionEventStreamState,
} from "@/components/app/sessions/detail"
import type {
  Session,
  SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

import { SessionArtifactWorkspace } from "./artifact-workspace"
import type { ActivityItem } from "./activity"
import { InitialTranscriptLoader, TranscriptTimeline } from "./timeline"

type SessionTranscriptSurfaceProps = {
  activityItems: ActivityItem[]
  eventStreamState: SessionEventStreamState
  hasUnloadedTranscriptHistory: boolean
  isFetchingPreviousPage: boolean
  isLoadingInitialTranscript: boolean
  onEditUserMessage?: (item: SessionTranscriptItem) => void
  onApprove: () => void
  onReject: () => void
  onScrollToBottom: () => void
  onTranscriptScroll: () => void
  respondingToApproval: boolean
  session: Session
  sessionId: string
  transcriptAwayFromBottom: boolean
  transcriptContentRef: RefObject<HTMLDivElement | null>
  transcriptScrollRef: RefObject<HTMLDivElement | null>
  transcriptVisible: boolean
  stickyFooter?: ReactNode
}

type OverlayScrollbarState = {
  height: number
  top: number
  visible: boolean
}

const OVERLAY_SCROLLBAR_TRACK_INSET = 8
const OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT = 32

// The transcript surface owns only rendering and local transcript affordances.
// Data loading, pagination, and scroll state live in the feed hook.
export function SessionTranscriptSurface({
  activityItems,
  eventStreamState,
  hasUnloadedTranscriptHistory,
  isFetchingPreviousPage,
  isLoadingInitialTranscript,
  onEditUserMessage,
  onApprove,
  onReject,
  onScrollToBottom,
  onTranscriptScroll,
  respondingToApproval,
  session,
  sessionId,
  transcriptAwayFromBottom,
  transcriptContentRef,
  transcriptScrollRef,
  transcriptVisible,
  stickyFooter,
}: SessionTranscriptSurfaceProps) {
  const { t } = useTranslation()
  const [overlayScrollbar, setOverlayScrollbar] =
    useState<OverlayScrollbarState>({
      height: 0,
      top: OVERLAY_SCROLLBAR_TRACK_INSET,
      visible: false,
    })

  const updateOverlayScrollbar = useCallback(
    (scrollContainer: HTMLDivElement | null) => {
      if (!scrollContainer || !transcriptVisible) {
        setOverlayScrollbar((current) =>
          current.visible ? { ...current, visible: false } : current
        )
        return
      }

      const { clientHeight, scrollHeight, scrollTop } = scrollContainer
      const scrollableDistance = scrollHeight - clientHeight
      if (scrollableDistance <= 1) {
        setOverlayScrollbar((current) =>
          current.visible ? { ...current, visible: false } : current
        )
        return
      }

      const trackHeight = Math.max(
        0,
        clientHeight - OVERLAY_SCROLLBAR_TRACK_INSET * 2
      )
      const thumbHeight = Math.max(
        OVERLAY_SCROLLBAR_MIN_THUMB_HEIGHT,
        (clientHeight / scrollHeight) * trackHeight
      )
      const thumbTravel = Math.max(0, trackHeight - thumbHeight)
      const thumbTop =
        OVERLAY_SCROLLBAR_TRACK_INSET +
        (scrollTop / scrollableDistance) * thumbTravel

      setOverlayScrollbar((current) => {
        const next = {
          height: thumbHeight,
          top: thumbTop,
          visible: true,
        }
        if (
          current.visible === next.visible &&
          Math.abs(current.height - next.height) < 0.5 &&
          Math.abs(current.top - next.top) < 0.5
        ) {
          return current
        }
        return next
      })
    },
    [transcriptVisible]
  )

  const handleTranscriptScroll = useCallback(
    (event: UIEvent<HTMLDivElement>) => {
      onTranscriptScroll()
      updateOverlayScrollbar(event.currentTarget)
    },
    [onTranscriptScroll, updateOverlayScrollbar]
  )

  useEffect(() => {
    const scrollContainer = transcriptScrollRef.current
    const transcriptContent = transcriptContentRef.current

    function measureOverlayScrollbar() {
      updateOverlayScrollbar(scrollContainer)
    }

    measureOverlayScrollbar()
    const firstFrame = window.requestAnimationFrame(measureOverlayScrollbar)
    const secondFrame = window.requestAnimationFrame(measureOverlayScrollbar)

    const observer = new ResizeObserver(measureOverlayScrollbar)
    if (scrollContainer) {
      observer.observe(scrollContainer)
    }
    if (transcriptContent) {
      observer.observe(transcriptContent)
    }
    window.addEventListener("resize", measureOverlayScrollbar)

    return () => {
      window.cancelAnimationFrame(firstFrame)
      window.cancelAnimationFrame(secondFrame)
      observer.disconnect()
      window.removeEventListener("resize", measureOverlayScrollbar)
    }
  }, [
    activityItems.length,
    transcriptContentRef,
    transcriptScrollRef,
    transcriptVisible,
    updateOverlayScrollbar,
  ])

  return (
    <div className="flex min-h-0 flex-1 flex-col bg-background">
      <div className="relative min-h-0 flex-1">
        <ScrollShadow
          ref={transcriptScrollRef}
          onScroll={handleTranscriptScroll}
          className={cn("h-full py-0", hiddenScrollbarClassName)}
          orientation="vertical"
          size={64}
        >
          <div
            className={cn(
              "px-4 transition-opacity duration-200 ease-out sm:px-6",
              transcriptVisible ? "opacity-100" : "opacity-0"
            )}
          >
            <div
              ref={transcriptContentRef}
              className={cn(
                workspaceContentWidthClassName,
                "space-y-4 py-4 sm:py-6"
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
                showTopLoadingIndicator={
                  hasUnloadedTranscriptHistory || isFetchingPreviousPage
                }
                isLoadingInitialTranscript={isLoadingInitialTranscript}
                onEditUserMessage={onEditUserMessage}
                onSelectPath={ignoreLocalPathClick}
                projectRootPath={session.project?.rootPath}
              />
              {/* Artifacts stay below the conversational timeline because the product
              prioritizes status/summary/input over file output browsing. */}
              <SessionArtifactWorkspace
                artifacts={session.artifacts}
                sessionId={sessionId}
              />
            </div>
          </div>
        </ScrollShadow>
        {!transcriptVisible ? (
          <div className="pointer-events-none absolute inset-x-0 top-0 flex min-h-full items-center justify-center">
            <InitialTranscriptLoader />
          </div>
        ) : null}
        <div
          aria-hidden="true"
          className={cn(
            "pointer-events-none absolute inset-y-2 right-2 z-20 w-1 transition-opacity duration-150",
            overlayScrollbar.visible ? "opacity-100" : "opacity-0"
          )}
        >
          <div
            className="absolute w-full rounded-full [background:var(--scrollbar)]"
            style={{
              height: overlayScrollbar.height,
              transform: `translateY(${overlayScrollbar.top - OVERLAY_SCROLLBAR_TRACK_INSET}px)`,
            }}
          />
        </div>
        <button
          type="button"
          aria-label={t("transcript.scrollLatest")}
          aria-hidden={!transcriptVisible || !transcriptAwayFromBottom}
          tabIndex={transcriptVisible && transcriptAwayFromBottom ? 0 : -1}
          className={cn(
            "absolute bottom-4 left-1/2 z-30 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-surface text-foreground shadow-sm shadow-black/5 transition-[opacity,background-color] duration-200 ease-out hover:bg-surface-tertiary",
            transcriptVisible && transcriptAwayFromBottom
              ? "opacity-100"
              : "pointer-events-none opacity-0"
          )}
          onClick={onScrollToBottom}
        >
          <ArrowDown className="size-4" />
        </button>
      </div>
      {stickyFooter ? (
        <div className="px-4 pb-3 sm:px-6 md:pb-4">{stickyFooter}</div>
      ) : null}
    </div>
  )
}

function ignoreLocalPathClick() {
  // File preview sidebar support is intentionally disabled for now.
}
