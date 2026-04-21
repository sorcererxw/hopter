import {
  Suspense,
  lazy,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type RefObject,
  type MouseEvent as ReactMouseEvent,
} from "react"
import { useVirtualizer } from "@tanstack/react-virtual"
import {
  ArrowDown,
  ChevronRight,
  FileImage,
  FileText,
  Lightbulb,
  LoaderCircle,
  Wrench,
  X,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SessionArtifactWorkspace } from "@/components/app/session-artifact-workspace"
import { SessionComposer } from "@/components/app/session-composer"
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogTitle,
} from "@/components/ui/dialog"
import {
  buildClosedPanelParams,
  buildFilePanelParams,
  buildReviewPanelParams,
  buildReviewSelectionParams,
  parseSessionPathReference,
  readSessionPanelState,
} from "@/components/app/session-panel-state"
import { CodeContainer } from "@/components/app/code-container"
import { SessionRichText } from "@/components/app/session-rich-text"
import { ScrollbarIndicator } from "@/components/app/scrollbar-indicator"
import { useAutoHideScrollbar } from "@/components/app/use-auto-hide-scrollbar"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { WorkspaceTopbar } from "@/components/app/workspace-topbar"
import { SessionTerminalDrawer } from "@/features/terminal/terminal-drawer"
import { useTerminalSession } from "@/features/terminal/use-terminal-session"
import { useTerminalUIState } from "@/features/terminal/use-terminal-ui-state"
import {
  fetchSessionTranscriptPage,
  useInterruptSession,
  useRespondToSessionApproval,
  useSendSessionInput,
  useSessionFile,
  useSessionMeta,
  useSessionReview,
  useSessionTranscript,
} from "@/features/sessions/use-sessions"
import {
  ApprovalDecision,
  ArtifactKind,
  SessionStatus,
} from "@/gen/proto/hopter/v1/common_pb"
import {
  SessionTranscriptAttachmentKind,
  SessionTranscriptItemKind,
  type Session,
  type SessionMeta,
  type SessionTranscriptAttachment,
  type SessionTranscriptPage,
  type SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"
import {
  formatBackendKey,
  formatSessionStatus,
  formatUpdatedAt,
} from "@/lib/format/proto"
import { cn } from "@/lib/utils"

const SessionInspectorPane = lazy(() =>
  import("@/components/app/session-inspector-pane").then((module) => ({
    default: module.SessionInspectorPane,
  }))
)

const sessionSidebarWidthStorageKey = "hopter.sessionSidebarWidth"
const minSessionSidebarWidth = 440
const maxSessionSidebarWidth = 920
const defaultSessionSidebarWidth = 640

export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate()
  const [searchParams, setSearchParams] = useSearchParams()
  const { eventStreamState, posture, toggleRail, toolbarMode } =
    useWorkspaceShell()
  const sessionMetaQuery = useSessionMeta(sessionId)
  const panelState = useMemo(
    () => readSessionPanelState(searchParams),
    [searchParams]
  )
  const transcriptPollInterval = useMemo(
    () =>
      eventStreamState === "connected"
        ? sessionMetaQuery.data
          ? shouldPollSessionState(sessionMetaQuery.data.status)
            ? 5_000
            : 10_000
          : 5_000
        : sessionMetaQuery.data
          ? shouldPollSessionState(sessionMetaQuery.data.status)
            ? 1500
            : 5000
          : 1500,
    [eventStreamState, sessionMetaQuery.data]
  )
  const latestTranscriptQuery = useSessionTranscript(
    sessionId,
    Boolean(sessionMetaQuery.data),
    undefined,
    transcriptPollInterval
  )
  const sendInput = useSendSessionInput()
  const interruptSession = useInterruptSession()
  const respondToApproval = useRespondToSessionApproval()
  const [prompt, setPrompt] = useState("")
  const [optimisticPendingInput, setOptimisticPendingInput] = useState("")
  const [sidebarWidth, setSidebarWidth] = useState(() => {
    if (typeof window === "undefined") {
      return defaultSessionSidebarWidth
    }

    const stored = Number(
      window.localStorage.getItem(sessionSidebarWidthStorageKey)
    )
    if (!Number.isFinite(stored)) {
      return defaultSessionSidebarWidth
    }

    return Math.min(
      Math.max(stored, minSessionSidebarWidth),
      maxSessionSidebarWidth
    )
  })
  const sidebarDraggingRef = useRef(false)
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [transcriptAwayFromBottom, setTranscriptAwayFromBottom] =
    useState(false)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptContentRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const lastScrollHeightRef = useRef(0)
  const lastSessionIdRef = useRef(sessionId)
  const loadedTranscriptSessionRef = useRef(sessionId)
  const lastActivityCountRef = useRef(0)
  const historyBackfillRunningRef = useRef(false)
  const prependSnapshotRef = useRef<{
    scrollHeight: number
  } | null>(null)
  const [transcriptPages, setTranscriptPages] = useState<
    SessionTranscriptPage[]
  >([])
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false)
  const terminalEnabled = posture !== "phone"
  const terminalUIState = useTerminalUIState(sessionId)
  const terminalState = useTerminalSession(sessionId, terminalEnabled)
  const {
    handleScroll,
    scrollbarScrollable,
    scrollbarVisible,
    syncScrollbar,
    thumbHeight,
    thumbOffset,
  } = useAutoHideScrollbar(transcriptScrollRef, {
    contentRef: transcriptContentRef,
  })

  const session = useMemo(
    () => buildSessionDetail(sessionMetaQuery.data, transcriptPages),
    [sessionMetaQuery.data, transcriptPages]
  )
  const reviewQuery = useSessionReview(
    sessionId,
    Boolean(sessionMetaQuery.data) && panelState.panel === "review"
  )
  const fileQuery = useSessionFile(
    panelState.panel === "file" && panelState.path
      ? {
          sessionId,
          path: panelState.path,
          line: panelState.line,
          column: panelState.column,
        }
      : undefined,
    Boolean(sessionMetaQuery.data) && panelState.panel === "file"
  )
  const transcriptItems = useMemo(() => {
    return (session?.transcriptItems ?? []).filter(
      (item) => item.body.trim().length > 0
    )
  }, [session?.transcriptItems])
  const showPendingInputHint = useMemo(() => {
    if (!session) {
      return false
    }

    const normalizedHint = normalizeTranscriptText(session.lastInputHint)
    if (!normalizedHint) {
      return false
    }

    return !transcriptItems.some(
      (item) =>
        item.kind === SessionTranscriptItemKind.USER_MESSAGE &&
        normalizeTranscriptText(item.body).startsWith(normalizedHint)
    )
  }, [session, transcriptItems])
  const shouldShowWorkingStatus = Boolean(
    optimisticPendingInput ||
    sendInput.isPending ||
    (session && shouldShowThinkingState(session.status))
  )
  const shouldShowInterruptAction =
    Boolean(session) &&
    shouldShowThinkingState(session!.status) &&
    prompt.trim().length === 0 &&
    !sendInput.isPending
  useEffect(() => {
    if (!optimisticPendingInput) {
      return
    }

    const normalizedPending = normalizeTranscriptText(optimisticPendingInput)
    const transcriptHasPending = transcriptItems.some(
      (item) =>
        item.kind === SessionTranscriptItemKind.USER_MESSAGE &&
        normalizeTranscriptText(item.body).startsWith(normalizedPending)
    )
    const serverHasPending =
      session?.lastInputHint &&
      normalizeTranscriptText(session.lastInputHint).startsWith(
        normalizedPending
      )

    if (transcriptHasPending || serverHasPending) {
      setOptimisticPendingInput("")
    }
  }, [optimisticPendingInput, session?.lastInputHint, transcriptItems])
  const activityItems = useMemo(() => {
    const items: ActivityItem[] = transcriptItems.map((item) => ({
      item,
      kind: "transcript" as const,
      key: item.id,
    }))

    if (optimisticPendingInput) {
      items.push({
        kind: "pending-input" as const,
        key: "optimistic-pending-input",
        text: optimisticPendingInput,
      })
    } else if (session && showPendingInputHint) {
      items.push({
        kind: "pending-input" as const,
        key: "pending-input",
        text: session.lastInputHint,
      })
    }

    if (session && shouldShowWorkingStatus) {
      const localRoundInFlight =
        sendInput.isPending || Boolean(optimisticPendingInput)
      items.push({
        kind: "thinking" as const,
        key: "thinking",
        summary: localRoundInFlight
          ? "Codex is working on your latest message…"
          : session.summary?.trim() || "Codex is thinking…",
      })
    }

    return items
  }, [
    optimisticPendingInput,
    sendInput.isPending,
    session,
    shouldShowWorkingStatus,
    showPendingInputHint,
    transcriptItems,
  ])
  const transcriptPageCount = transcriptPages.length
  const lastActivityKey = activityItems.at(-1)?.key ?? ""
  const hasUnloadedTranscriptHistory =
    transcriptPages[0]?.hasMoreBefore ??
    sessionMetaQuery.data?.hasMoreBefore ??
    false
  const isLoadingInitialTranscript =
    latestTranscriptQuery.isLoading && activityItems.length === 0
  const panelVisible =
    panelState.panel === "file" || panelState.panel === "review"
  const panelAsPage = posture !== "wide" && panelVisible

  useEffect(() => {
    const latestPage = latestTranscriptQuery.data
    if (!latestPage) {
      setTranscriptPages([])
      return
    }
    const latestSnapshotKey = transcriptPageSnapshotKey(latestPage)
    setTranscriptPages((current) => {
      const sessionChanged = loadedTranscriptSessionRef.current !== sessionId
      loadedTranscriptSessionRef.current = sessionId

      if (sessionChanged || current.length === 0) {
        return [latestPage]
      }

      const currentSnapshotKey = transcriptPageSnapshotKey(current.at(-1))
      if (currentSnapshotKey !== latestSnapshotKey) {
        historyBackfillRunningRef.current = false
        prependSnapshotRef.current = null
        setIsFetchingPreviousPage(false)
        return [latestPage]
      }

      return [...current.slice(0, -1), latestPage]
    })
  }, [latestTranscriptQuery.data, sessionId])

  useEffect(() => {
    setOptimisticPendingInput("")
    setTranscriptAwayFromBottom(false)
    loadedTranscriptSessionRef.current = sessionId
    historyBackfillRunningRef.current = false
    prependSnapshotRef.current = null
  }, [sessionId])

  useEffect(() => {
    if (typeof window === "undefined") {
      return
    }
    window.localStorage.setItem(
      sessionSidebarWidthStorageKey,
      String(sidebarWidth)
    )
  }, [sidebarWidth])

  useEffect(() => {
    if (panelState.panel !== "review") {
      return
    }
    if (panelState.reviewFile || panelState.reviewView === "full") {
      return
    }
    const firstFile = reviewQuery.data?.files[0]?.path
    if (!firstFile) {
      return
    }
    setSearchParams((current) =>
      buildReviewSelectionParams(current, { reviewFile: firstFile })
    )
  }, [
    panelState.panel,
    panelState.reviewFile,
    panelState.reviewView,
    reviewQuery.data,
    setSearchParams,
  ])

  useEffect(() => {
    if (posture !== "wide") {
      return
    }

    function handlePointerMove(event: MouseEvent) {
      if (!sidebarDraggingRef.current) {
        return
      }
      const nextWidth = window.innerWidth - event.clientX
      setSidebarWidth(
        Math.min(
          Math.max(nextWidth, minSessionSidebarWidth),
          maxSessionSidebarWidth
        )
      )
    }

    function handlePointerUp() {
      sidebarDraggingRef.current = false
    }

    window.addEventListener("mousemove", handlePointerMove)
    window.addEventListener("mouseup", handlePointerUp)
    return () => {
      window.removeEventListener("mousemove", handlePointerMove)
      window.removeEventListener("mouseup", handlePointerUp)
    }
  }, [posture])

  useEffect(() => {
    if (isLoadingInitialTranscript) {
      setTranscriptVisible(false)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setTranscriptVisible(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activityItems.length, isLoadingInitialTranscript, sessionId])

  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    const nextCount = activityItems.length
    const sessionChanged = lastSessionIdRef.current !== sessionId
    const countChanged = nextCount !== lastActivityCountRef.current
    const lastKeyChanged =
      !sessionChanged && countChanged && lastActivityKey !== ""

    if (sessionChanged || (lastKeyChanged && shouldStickToBottomRef.current)) {
      stickTranscriptToBottom(container)
    }

    lastSessionIdRef.current = sessionId
    lastActivityCountRef.current = nextCount
  }, [activityItems.length, lastActivityKey, sessionId])

  useEffect(() => {
    const container = transcriptScrollRef.current
    const content = transcriptContentRef.current
    if (!container || !content || typeof ResizeObserver === "undefined") {
      return
    }

    lastScrollHeightRef.current = container.scrollHeight

    const observer = new ResizeObserver(() => {
      const previousScrollHeight = lastScrollHeightRef.current
      const previousDistanceFromBottom =
        previousScrollHeight - container.scrollTop - container.clientHeight
      const nextScrollHeight = container.scrollHeight
      const grew = nextScrollHeight > previousScrollHeight
      const wasPinnedBeforeGrowth =
        previousDistanceFromBottom < 120 || shouldStickToBottomRef.current
      lastScrollHeightRef.current = nextScrollHeight

      if (
        !grew ||
        prependSnapshotRef.current ||
        !wasPinnedBeforeGrowth
      ) {
        updateTranscriptBottomState(container)
        return
      }

      stickTranscriptToBottom(container)
    })

    observer.observe(content)

    return () => observer.disconnect()
  }, [sessionId])

  useEffect(() => {
    syncScrollbar()
  }, [syncScrollbar, transcriptPages, transcriptVisible])

  useLayoutEffect(() => {
    const container = transcriptScrollRef.current
    const snapshot = prependSnapshotRef.current
    if (!container || !snapshot) {
      return
    }
    if (transcriptPageCount < 2) {
      return
    }

    const delta = container.scrollHeight - snapshot.scrollHeight
    container.scrollTop += delta
    lastScrollHeightRef.current = container.scrollHeight
    updateTranscriptBottomState(container)
    prependSnapshotRef.current = null
  }, [transcriptPageCount])

  useEffect(() => {
    const firstPage = transcriptPages[0]
    if (
      !firstPage?.hasMoreBefore ||
      !firstPage.nextBeforeCursor ||
      historyBackfillRunningRef.current
    ) {
      historyBackfillRunningRef.current = false
      setIsFetchingPreviousPage(false)
      return
    }

    let cancelled = false
    historyBackfillRunningRef.current = true
    setIsFetchingPreviousPage(true)

    async function loadHistory() {
      let cursor = firstPage!.nextBeforeCursor
      const seenCursors = new Set<string>()

      try {
        while (!cancelled && cursor) {
          if (seenCursors.has(cursor)) {
            break
          }
          seenCursors.add(cursor)

          const page = await fetchSessionTranscriptPage(sessionId, cursor)
          if (cancelled || !page) {
            break
          }
          if (!sameTranscriptSnapshot(firstPage!, page)) {
            break
          }

          const container = transcriptScrollRef.current
          if (container) {
            prependSnapshotRef.current = {
              scrollHeight: container.scrollHeight,
            }
          }

          setTranscriptPages((current) => {
            const currentIds = new Set(
              current.flatMap((existing) =>
                (existing.items ?? []).map((item) => item.id)
              )
            )
            const nextItems = (page.items ?? []).filter(
              (item) => !currentIds.has(item.id)
            )

            if (nextItems.length === 0) {
              return current
            }

            return [
              {
                ...page,
                items: nextItems,
              } as SessionTranscriptPage,
              ...current,
            ]
          })

          await nextAnimationFrame()

          if (!page.hasMoreBefore || !page.nextBeforeCursor) {
            break
          }

          cursor = page.nextBeforeCursor
        }
      } finally {
        historyBackfillRunningRef.current = false
        if (!cancelled) {
          setIsFetchingPreviousPage(false)
        }
      }
    }

    void loadHistory()

    return () => {
      cancelled = true
    }
  }, [
    sessionId,
    transcriptPages[0]?.hasMoreBefore,
    transcriptPages[0]?.nextBeforeCursor,
  ])

  function handleTranscriptScroll() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }
    handleScroll()

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom < 120
    setTranscriptAwayFromBottom(distanceFromBottom > 160)
  }

  function scrollTranscriptToBottom() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    shouldStickToBottomRef.current = true
    setTranscriptAwayFromBottom(false)
    container.scrollTo({
      top: container.scrollHeight,
      behavior: "smooth",
    })
  }

  function updateTranscriptBottomState(container: HTMLDivElement) {
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    const shouldStick = distanceFromBottom < 120
    shouldStickToBottomRef.current = shouldStick
    setTranscriptAwayFromBottom(distanceFromBottom > 160)
  }

  function stickTranscriptToBottom(container: HTMLDivElement) {
    shouldStickToBottomRef.current = true
    container.scrollTop = container.scrollHeight
    setTranscriptAwayFromBottom(false)
  }

  function nextAnimationFrame() {
    return new Promise<void>((resolve) => {
      window.requestAnimationFrame(() => resolve())
    })
  }

  function sameTranscriptSnapshot(
    left: SessionTranscriptPage,
    right: SessionTranscriptPage
  ) {
    return transcriptPageSnapshotKey(left) === transcriptPageSnapshotKey(right)
  }

  function transcriptPageSnapshotKey(page: SessionTranscriptPage | undefined) {
    const snapshot = page?.snapshotUpdatedAt
    if (!snapshot) {
      return ""
    }

    return `${String(snapshot.seconds ?? "")}:${String(snapshot.nanos ?? "")}`
  }

  function openFilePanel(rawPath: string) {
    const reference = parseSessionPathReference(rawPath)
    if (!reference.path) {
      return
    }
    setSearchParams((current) => buildFilePanelParams(current, reference))
  }

  function openReviewPanel(input?: {
    reviewFile?: string | null
    reviewView?: "file" | "full"
  }) {
    setSearchParams((current) => buildReviewPanelParams(current, input))
  }

  function closePanel() {
    setSearchParams((current) => buildClosedPanelParams(current))
  }

  function togglePanel() {
    if (panelVisible) {
      closePanel()
      return
    }
    openReviewPanel({
      reviewFile:
        panelState.reviewFile || reviewQuery.data?.files[0]?.path || null,
      reviewView: panelState.reviewView,
    })
  }

  function startSidebarResize(event: ReactMouseEvent<HTMLDivElement>) {
    event.preventDefault()
    sidebarDraggingRef.current = true
  }

  const mobilePanelTitle =
    panelState.panel === "file"
      ? fileQuery.data?.displayPath || fileQuery.data?.requestedPath || "File"
      : "Review"

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        leadingAction={
          panelAsPage || posture === "phone" ? "back" : "toggle-rail"
        }
        onLeadingAction={() => {
          if (panelAsPage) {
            closePanel()
            return
          }

          if (posture === "phone") {
            navigate("/")
            return
          }

          toggleRail()
        }}
        title={panelAsPage ? mobilePanelTitle : session?.title || "Thread"}
        projectName={session?.project?.name || "Local"}
        resumeCommand={sessionMetaQuery.data?.resumeCommand}
        sessionId={sessionId}
        inspectorOpen={panelVisible}
        onCommit={() => {
          // TODO: wire commit action
        }}
        onCommitAndReview={() => {
          openReviewPanel({
            reviewFile:
              panelState.reviewFile || reviewQuery.data?.files[0]?.path || null,
            reviewView: panelState.reviewView,
          })
        }}
        onOpenReview={() => {
          openReviewPanel({
            reviewFile:
              panelState.reviewFile || reviewQuery.data?.files[0]?.path || null,
            reviewView: panelState.reviewView,
          })
        }}
        onOpenTerminal={() => {
          if (!terminalEnabled) {
            return
          }
          terminalUIState.setOpen(!terminalUIState.open)
        }}
        onToggleInspector={posture === "wide" ? togglePanel : undefined}
        showInspectorToggle={posture === "wide"}
        showReview
        showTerminal={terminalEnabled}
        terminalButtonTestId="workspace-topbar-terminal"
        terminalActive={Boolean(
          terminalState.terminal && !terminalUIState.open
        )}
        toolbarMode={toolbarMode}
      />

      {sessionMetaQuery.isLoading ? (
        <CenteredTranscriptLoader />
      ) : sessionMetaQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-lg border border-border bg-muted px-6 py-4 text-foreground">
            This thread is temporarily unavailable.
          </div>
        </div>
      ) : panelAsPage ? (
        <Suspense fallback={null}>
          <SessionInspectorPane
            file={fileQuery.data}
            fileLoading={fileQuery.isLoading}
            mobile
            mode={panelState.panel === "file" ? "file" : "review"}
            onClose={closePanel}
            onModeChange={(nextMode) => {
              if (nextMode === "file" && panelState.path) {
                setSearchParams((current) =>
                  buildFilePanelParams(current, {
                    path: panelState.path!,
                    line: panelState.line,
                    column: panelState.column,
                  })
                )
                return
              }
              openReviewPanel({
                reviewFile:
                  panelState.reviewFile ||
                  reviewQuery.data?.files[0]?.path ||
                  null,
                reviewView: panelState.reviewView,
              })
            }}
            onReviewFileSelect={(path) => {
              setSearchParams((current) =>
                buildReviewSelectionParams(current, {
                  reviewFile: path,
                  reviewView: "file",
                })
              )
            }}
            onReviewViewChange={(reviewView) => {
              setSearchParams((current) =>
                buildReviewSelectionParams(current, {
                  reviewFile: panelState.reviewFile,
                  reviewView,
                })
              )
            }}
            review={reviewQuery.data}
            reviewFile={panelState.reviewFile}
            reviewLoading={reviewQuery.isLoading}
            reviewView={panelState.reviewView}
          />
        </Suspense>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="relative min-h-0 flex-1">
              <div
                ref={transcriptScrollRef}
                onScroll={handleTranscriptScroll}
                className="scrollbar-native-hidden relative h-full overflow-y-auto px-6 py-0"
              >
                <div
                  ref={transcriptContentRef}
                  className={cn(
                    "mx-auto max-w-[720px] space-y-3 py-4 transition-opacity duration-200 ease-out md:py-6",
                    transcriptVisible ? "opacity-100" : "opacity-0"
                  )}
                >
                  <SessionStatusHeader session={session} />
                  <SessionConnectionBlock state={eventStreamState} />
                  <SessionSummaryBlock session={session} />
                  <SessionCompletedResultBlock session={session} />

                  <SessionAttentionBlock
                    onApprove={() => {
                      if (!session.pendingApprovalId) {
                        return
                      }
                      void respondToApproval.mutateAsync({
                        sessionId,
                        approvalId: session.pendingApprovalId,
                        decision: ApprovalDecision.APPROVE,
                      })
                    }}
                    onReject={() => {
                      if (!session.pendingApprovalId) {
                        return
                      }
                      void respondToApproval.mutateAsync({
                        sessionId,
                        approvalId: session.pendingApprovalId,
                        decision: ApprovalDecision.REJECT,
                      })
                    }}
                    responding={respondToApproval.isPending}
                    session={session}
                  />

                  <TranscriptTimeline
                    items={activityItems}
                    isFetchingPreviousPage={
                      isFetchingPreviousPage && hasUnloadedTranscriptHistory
                    }
                    isLoadingInitialTranscript={isLoadingInitialTranscript}
                    onSelectDiff={(diff) => {
                      openReviewPanel({
                        reviewFile: diff.path,
                        reviewView: "file",
                      })
                    }}
                    onSelectPath={(path) => {
                      openFilePanel(path)
                    }}
                    scrollElementRef={transcriptScrollRef}
                  />
                  <SessionArtifactWorkspace
                    artifacts={session.artifacts}
                    onOpenReview={() => {
                      openReviewPanel({
                        reviewFile:
                          panelState.reviewFile ||
                          reviewQuery.data?.files[0]?.path ||
                          null,
                        reviewView: panelState.reviewView,
                      })
                    }}
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
                tabIndex={
                  transcriptVisible && transcriptAwayFromBottom ? 0 : -1
                }
                className={cn(
                  "absolute bottom-4 left-1/2 z-10 flex size-9 -translate-x-1/2 items-center justify-center rounded-full border border-border bg-background text-foreground shadow-lg transition-[opacity,background-color] duration-200 ease-out hover:bg-card",
                  transcriptVisible && transcriptAwayFromBottom
                    ? "opacity-100"
                    : "pointer-events-none opacity-0"
                )}
                onClick={scrollTranscriptToBottom}
              >
                <ArrowDown className="size-4" />
              </button>
            </div>

            {session && shouldShowWorkingStatus ? (
              <div className="border-t border-border bg-background/95 px-6 py-2 backdrop-blur">
                <div className="mx-auto max-w-[720px] rounded-lg border border-border bg-card px-3 py-2">
                  <TypingIndicator
                    label={
                      sendInput.isPending || Boolean(optimisticPendingInput)
                        ? "Codex is starting this turn..."
                        : session.summary?.trim() ||
                          "Codex is still working on this turn..."
                    }
                  />
                </div>
              </div>
            ) : null}

            <SessionComposer
              busy={sendInput.isPending || interruptSession.isPending}
              composerTestId="session-composer"
              interruptMode={shouldShowInterruptAction}
              interruptTestId="session-interrupt-submit"
              inputTestId="session-prompt-input"
              onInterrupt={async () => {
                await interruptSession.mutateAsync({ sessionId })
              }}
              placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
              projectLabel={session.project?.name || "Local"}
              branchLabel="main"
              settingsLabel="Custom (config.toml)"
              onValueChange={setPrompt}
              onSubmit={async () => {
                if (!prompt.trim()) {
                  return
                }

                const normalizedPrompt = prompt.trim()
                setPrompt("")
                setOptimisticPendingInput(normalizedPrompt)
                try {
                  await sendInput.mutateAsync({
                    input: normalizedPrompt,
                    sessionId,
                  })
                } catch (error) {
                  setOptimisticPendingInput("")
                  setPrompt(normalizedPrompt)
                  throw error
                }
              }}
              submitTestId="session-followup-submit"
              value={prompt}
            />

            <SessionTerminalDrawer
              enabled={terminalEnabled}
              terminal={terminalState}
              uiState={terminalUIState}
            />
          </div>

          {posture === "wide" && panelVisible ? (
            <div
              className="relative flex h-full shrink-0 border-l border-border bg-card"
              style={{ width: sidebarWidth }}
            >
              <div
                role="presentation"
                className="absolute inset-y-0 left-0 w-1 cursor-col-resize bg-transparent"
                onMouseDown={startSidebarResize}
              />
              <div className="min-w-0 flex-1">
                <Suspense fallback={null}>
                  <SessionInspectorPane
                    file={fileQuery.data}
                    fileLoading={fileQuery.isLoading}
                    mode={panelState.panel === "file" ? "file" : "review"}
                    onClose={closePanel}
                    onModeChange={(nextMode) => {
                      if (nextMode === "file" && panelState.path) {
                        setSearchParams((current) =>
                          buildFilePanelParams(current, {
                            path: panelState.path!,
                            line: panelState.line,
                            column: panelState.column,
                          })
                        )
                        return
                      }
                      openReviewPanel({
                        reviewFile:
                          panelState.reviewFile ||
                          reviewQuery.data?.files[0]?.path ||
                          null,
                        reviewView: panelState.reviewView,
                      })
                    }}
                    onReviewFileSelect={(path) => {
                      setSearchParams((current) =>
                        buildReviewSelectionParams(current, {
                          reviewFile: path,
                          reviewView: "file",
                        })
                      )
                    }}
                    onReviewViewChange={(reviewView) => {
                      setSearchParams((current) =>
                        buildReviewSelectionParams(current, {
                          reviewFile: panelState.reviewFile,
                          reviewView,
                        })
                      )
                    }}
                    review={reviewQuery.data}
                    reviewFile={panelState.reviewFile}
                    reviewLoading={reviewQuery.isLoading}
                    reviewView={panelState.reviewView}
                  />
                </Suspense>
              </div>
            </div>
          ) : null}
        </div>
      )}
    </div>
  )
}

function buildSessionDetail(
  meta: SessionMeta | undefined,
  pages:
    | Array<
        | {
            items?: SessionTranscriptItem[]
          }
        | undefined
      >
    | undefined
): Session | undefined {
  if (!meta) {
    return undefined
  }

  const transcriptItems = (pages ?? []).flatMap((page) => page?.items ?? [])

  return {
    id: meta.id,
    title: meta.title,
    project: meta.project,
    status: meta.status,
    summary: meta.summary,
    attentionRequired: meta.attentionRequired,
    attentionReason: meta.attentionReason,
    lastInputHint: meta.lastInputHint,
    updatedAt: meta.updatedAt,
    artifacts: meta.artifacts,
    transcriptItems,
    backendKey: meta.backendKey,
    pendingApprovalId: meta.pendingApprovalId,
  } as Session
}

function SessionStatusHeader({ session }: { session: Session }) {
  const status = getSessionStatusDisplay(session)
  const backend = formatBackendKey(session.backendKey)
  const updatedAt = formatUpdatedAt(session.updatedAt)
  const projectName = session.project?.name || "Local"

  return (
    <section
      className="rounded-lg border border-border bg-card px-4 py-3"
      data-testid="session-status-header"
      aria-label="Session status"
    >
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span
              className={cn(
                "size-2 rounded-full",
                status.dotClassName
              )}
              aria-hidden="true"
            />
            <span
              className={cn(
                "rounded-md px-2 py-1 text-sm font-medium",
                status.badgeClassName
              )}
            >
              {status.label}
            </span>
            {session.pendingApprovalId ? (
              <span className="rounded-md bg-amber-400/10 px-2 py-1 text-sm font-medium text-amber-700 dark:text-amber-200">
                Approval pending
              </span>
            ) : null}
          </div>
          <p className="mt-2 text-base leading-6 font-medium text-foreground">
            {status.description}
          </p>
        </div>

        <div className="min-w-40 text-right text-sm text-muted-foreground">
          <div className="truncate">{projectName}</div>
          <div className="mt-1 truncate">{backend}</div>
          <div className="mt-1 truncate">{updatedAt}</div>
        </div>
      </div>
    </section>
  )
}

function SessionSummaryBlock({ session }: { session: Session }) {
  const summary = session.summary.trim()
  const lastInputHint = session.lastInputHint.trim()

  return (
    <section
      className="rounded-lg border border-border bg-card px-4 py-3"
      data-testid="session-summary-block"
      aria-label="Session summary"
    >
      <div className="text-sm font-medium text-foreground">Summary</div>
      {summary ? (
        <SessionRichText
          text={summary}
          className="mt-2 text-base leading-6"
        />
      ) : (
        <div className="mt-2 text-base leading-6 text-muted-foreground">
          <p>
            No summary yet. Useful progress will appear here when this thread
            has a meaningful state to report.
          </p>
          {lastInputHint ? (
            <p className="mt-2">
              Latest input:{" "}
              <span className="text-foreground">{lastInputHint}</span>
            </p>
          ) : null}
        </div>
      )}
    </section>
  )
}

function SessionConnectionBlock({
  state,
}: {
  state: "connecting" | "connected" | "reconnecting" | "offline"
}) {
  if (state === "connected") {
    return null
  }

  const display = getConnectionDisplay(state)

  return (
    <section
      className={cn(
        "rounded-lg border px-4 py-3",
        display.containerClassName
      )}
      data-testid="session-connection-block"
      aria-label={display.title}
    >
      <div className={cn("text-sm font-medium", display.titleClassName)}>
        {display.title}
      </div>
      <p className={cn("mt-1 text-base leading-6 font-medium", display.bodyClassName)}>
        {display.body}
      </p>
      <p className="mt-2 text-sm leading-6 text-muted-foreground">
        {display.detail}
      </p>
    </section>
  )
}

function getConnectionDisplay(
  state: "connecting" | "connected" | "reconnecting" | "offline"
) {
  switch (state) {
    case "connecting":
      return {
        body: "Connecting to live session updates.",
        bodyClassName: "text-muted-foreground",
        containerClassName: "border-border bg-card",
        detail:
          "The cached session view is visible while the browser opens the event stream.",
        title: "Connecting",
        titleClassName: "text-foreground",
      }
    case "reconnecting":
      return {
        body: "Live updates are reconnecting.",
        bodyClassName: "text-amber-900 dark:text-amber-50",
        containerClassName: "border-amber-400/20 bg-amber-400/10",
        detail:
          "Inspect history and artifacts normally, but wait for reconnection before trusting live control state.",
        title: "Reconnecting",
        titleClassName: "text-amber-800 dark:text-amber-100",
      }
    case "offline":
      return {
        body: "The browser is offline.",
        bodyClassName: "text-destructive",
        containerClassName: "border-destructive/20 bg-destructive/10",
        detail:
          "This page is effectively read-only until network connectivity returns.",
        title: "Offline",
        titleClassName: "text-destructive",
      }
    case "connected":
    default:
      return {
        body: "",
        bodyClassName: "",
        containerClassName: "",
        detail: "",
        title: "",
        titleClassName: "",
      }
  }
}

function SessionCompletedResultBlock({ session }: { session: Session }) {
  if (session.status !== SessionStatus.COMPLETED) {
    return null
  }

  const artifactSummary = summarizeArtifacts(session)

  return (
    <section
      className="rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-4 py-3"
      data-testid="session-completed-result"
      aria-label="Completed result"
    >
      <div className="text-sm font-medium text-emerald-700 dark:text-emerald-100">
        Completed result
      </div>
      <p className="mt-1 text-base leading-6 font-medium text-emerald-800 dark:text-emerald-50">
        {session.summary.trim() || "The latest turn completed."}
      </p>
      <div className="mt-3 flex flex-wrap gap-2 text-sm">
        <span className="rounded-md bg-background px-2 py-1 text-muted-foreground">
          {session.artifacts.length} artifact
          {session.artifacts.length === 1 ? "" : "s"}
        </span>
        {artifactSummary.map((item) => (
          <span
            key={item.label}
            className="rounded-md bg-background px-2 py-1 text-muted-foreground"
          >
            {item.count} {item.label}
          </span>
        ))}
      </div>
    </section>
  )
}

function summarizeArtifacts(session: Session) {
  const counts = new Map<ArtifactKind, number>()

  for (const artifact of session.artifacts) {
    counts.set(artifact.kind, (counts.get(artifact.kind) ?? 0) + 1)
  }

  return [
    { kind: ArtifactKind.SUMMARY, label: "summary" },
    { kind: ArtifactKind.CHANGED_FILES, label: "changed files" },
    { kind: ArtifactKind.TEST_RESULT, label: "test result" },
    { kind: ArtifactKind.SCREENSHOT, label: "screenshot" },
    { kind: ArtifactKind.LOG, label: "log" },
    { kind: ArtifactKind.OTHER, label: "other" },
  ]
    .map((item) => ({
      count: counts.get(item.kind) ?? 0,
      label: item.label,
    }))
    .filter((item) => item.count > 0)
}

function SessionAttentionBlock({
  onApprove,
  onReject,
  responding,
  session,
}: {
  onApprove: () => void
  onReject: () => void
  responding: boolean
  session: Session
}) {
  const attention = getSessionAttentionDisplay(session)

  if (!attention) {
    return null
  }

  return (
    <section
      className={cn(
        "rounded-lg border px-4 py-3",
        attention.containerClassName
      )}
      data-testid="session-attention-block"
      aria-label={attention.title}
    >
      <div className={cn("mb-1 text-sm font-medium", attention.titleClassName)}>
        {attention.title}
      </div>
      <p className={cn("text-base leading-7 font-medium", attention.bodyClassName)}>
        {attention.body}
      </p>
      {attention.detail ? (
        <p className="mt-2 text-sm leading-6 text-muted-foreground">
          {attention.detail}
        </p>
      ) : null}
      {session.pendingApprovalId ? (
        <div className="mt-3 flex gap-2">
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-400/20 bg-emerald-400/10 px-3 font-medium text-emerald-700 transition hover:bg-emerald-400/15 disabled:cursor-not-allowed disabled:opacity-50 dark:text-emerald-100"
            disabled={responding}
            onClick={onApprove}
          >
            Approve
          </button>
          <button
            type="button"
            className="inline-flex h-8 items-center justify-center rounded-lg border border-border bg-transparent px-3 font-medium text-foreground transition hover:bg-accent disabled:cursor-not-allowed disabled:opacity-50"
            disabled={responding}
            onClick={onReject}
          >
            Reject
          </button>
        </div>
      ) : null}
    </section>
  )
}

function getSessionAttentionDisplay(session: Session) {
  const reason = session.attentionReason.trim()
  const summary = session.summary.trim()

  if (session.pendingApprovalId || session.status === SessionStatus.WAITING_APPROVAL) {
    return {
      body: reason || "Codex needs approval before it can continue.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: "Review the request before approving or rejecting the next step.",
      title: "Approval required",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.status === SessionStatus.FAILED) {
    return {
      body: reason || summary || "This thread failed before it could complete.",
      bodyClassName: "text-destructive",
      containerClassName: "border-destructive/20 bg-destructive/10",
      detail: "You can send a follow-up with more context or retry from the composer.",
      title: "Turn failed",
      titleClassName: "text-destructive",
    }
  }

  if (session.status === SessionStatus.DEGRADED) {
    return {
      body:
        reason ||
        summary ||
        "This thread is available, but live state may be incomplete.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail:
        "Inspect history and artifacts normally, but treat live control state as partially reliable.",
      title: "Degraded state",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.status === SessionStatus.WAITING_INPUT) {
    return {
      body: reason || "Codex is waiting for your next instruction.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: "Use the composer below to steer this thread.",
      title: "Input needed",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  if (session.attentionRequired) {
    return {
      body: reason || "This session requires user input.",
      bodyClassName: "text-amber-900 dark:text-amber-50",
      containerClassName: "border-amber-400/20 bg-amber-400/10",
      detail: "",
      title: "Attention",
      titleClassName: "text-amber-800 dark:text-amber-100",
    }
  }

  return null
}

function getSessionStatusDisplay(session: Session) {
  const formattedStatus = formatSessionStatus(session.status)
  const title = titleCaseStatus(formattedStatus)

  switch (session.status) {
    case SessionStatus.PENDING:
      return {
        badgeClassName:
          "bg-secondary text-secondary-foreground",
        description:
          session.lastInputHint.trim() ||
          "This thread is queued and waiting for Codex to start.",
        dotClassName: "bg-muted-foreground",
        label: title,
      }
    case SessionStatus.RUNNING:
      return {
        badgeClassName: "bg-sky-400/10 text-sky-700 dark:text-sky-200",
        description:
          session.summary.trim() || "Codex is actively working on this thread.",
        dotClassName: "bg-sky-400",
        label: title,
      }
    case SessionStatus.WAITING_INPUT:
      return {
        badgeClassName: "bg-amber-400/10 text-amber-700 dark:text-amber-200",
        description:
          session.attentionReason.trim() ||
          "Codex is waiting for your next instruction.",
        dotClassName: "bg-amber-400",
        label: title,
      }
    case SessionStatus.WAITING_APPROVAL:
      return {
        badgeClassName: "bg-amber-400/10 text-amber-700 dark:text-amber-200",
        description:
          session.attentionReason.trim() ||
          "Codex needs approval before it can continue.",
        dotClassName: "bg-amber-400",
        label: title,
      }
    case SessionStatus.COMPLETED:
      return {
        badgeClassName:
          "bg-emerald-400/10 text-emerald-700 dark:text-emerald-200",
        description:
          session.summary.trim() || "This thread has completed its latest turn.",
        dotClassName: "bg-emerald-500",
        label: title,
      }
    case SessionStatus.FAILED:
      return {
        badgeClassName: "bg-destructive/10 text-destructive",
        description:
          session.attentionReason.trim() ||
          session.summary.trim() ||
          "This thread failed before it could complete.",
        dotClassName: "bg-destructive",
        label: title,
      }
    case SessionStatus.DEGRADED:
      return {
        badgeClassName: "bg-amber-400/10 text-amber-700 dark:text-amber-200",
        description:
          session.attentionReason.trim() ||
          session.summary.trim() ||
          "This thread is available, but live state may be incomplete.",
        dotClassName: "bg-amber-400",
        label: title,
      }
    case SessionStatus.UNSPECIFIED:
    default:
      return {
        badgeClassName:
          "bg-secondary text-secondary-foreground",
        description:
          session.summary.trim() || "The current thread state is not specified.",
        dotClassName: "bg-muted-foreground",
        label: title,
      }
  }
}

function titleCaseStatus(value: string) {
  return value
    .split(" ")
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ")
}

type ActivityItem =
  | {
      item: SessionTranscriptItem
      kind: "transcript"
      key: string
    }
  | {
      key: string
      kind: "thinking"
      summary: string
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

type TimelineItem =
  | {
      item: SessionTranscriptItem
      kind: "transcript"
      key: string
    }
  | {
      key: string
      kind: "thinking"
      summary: string
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
      items: SessionTranscriptItem[]
      key: string
      kind: "command-group"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "file-change-group"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "tool-group"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "thought-group"
    }

function isTranscriptActivityItem(
  item: ActivityItem
): item is Extract<ActivityItem, { kind: "transcript" }> {
  return item.kind === "transcript"
}

function TranscriptTimeline({
  items,
  isFetchingPreviousPage,
  isLoadingInitialTranscript,
  onSelectDiff,
  onSelectPath,
  scrollElementRef,
}: {
  items: ActivityItem[]
  isFetchingPreviousPage: boolean
  isLoadingInitialTranscript: boolean
  onSelectDiff: (diff: ParsedFileChange) => void
  onSelectPath: (path: string) => void
  scrollElementRef: RefObject<HTMLDivElement | null>
}) {
  const timelineItems = groupTimelineItems(items)
  const timelineRef = useRef<HTMLDivElement | null>(null)
  const [scrollMargin, setScrollMargin] = useState(0)
  const virtualizer = useVirtualizer({
    count: timelineItems.length,
    estimateSize: () => 96,
    getItemKey: (index) => timelineItems[index]?.key ?? index,
    getScrollElement: () => scrollElementRef.current,
    measureElement: (element) => element.getBoundingClientRect().height,
    overscan: 8,
    scrollMargin,
  })

  useLayoutEffect(() => {
    const scrollElement = scrollElementRef.current
    const timelineElement = timelineRef.current
    if (!scrollElement || !timelineElement) {
      return
    }

    function updateScrollMargin() {
      const scrollRect = scrollElement!.getBoundingClientRect()
      const timelineRect = timelineElement!.getBoundingClientRect()
      setScrollMargin(timelineRect.top - scrollRect.top + scrollElement!.scrollTop)
    }

    updateScrollMargin()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(updateScrollMargin)
    if (timelineElement.parentElement) {
      observer.observe(timelineElement.parentElement)
    }
    observer.observe(scrollElement)

    return () => observer.disconnect()
  }, [scrollElementRef, timelineItems.length])

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
      ref={timelineRef}
      className="relative"
      data-testid="session-transcript"
    >
      {isFetchingPreviousPage ? <TranscriptLoadingRow /> : null}
      <div
        className="relative w-full"
        style={{ height: virtualizer.getTotalSize() }}
      >
        {virtualizer.getVirtualItems().map((virtualItem) => {
          const item = timelineItems[virtualItem.index]
          if (!item) {
            return null
          }

          return (
            <div
              key={virtualItem.key}
              ref={virtualizer.measureElement}
              data-index={virtualItem.index}
              className="absolute left-0 top-0 w-full pb-2"
              style={{
                transform: `translateY(${virtualItem.start - scrollMargin}px)`,
              }}
            >
              {renderTimelineItem(item, { onSelectDiff, onSelectPath })}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function renderTimelineItem(
  item: TimelineItem,
  handlers: {
    onSelectDiff: (diff: ParsedFileChange) => void
    onSelectPath: (path: string) => void
  }
) {
  switch (item.kind) {
    case "transcript":
      return (
        <TranscriptEntry
          item={item.item}
          onSelectDiff={handlers.onSelectDiff}
          onSelectPath={handlers.onSelectPath}
        />
      )
    case "thinking":
      return <ThinkingEntry summary={item.summary} />
    case "round-status":
      return <RoundStatusEntry state={item.state} summary={item.summary} />
    case "pending-input":
      return (
        <PendingInputEntry
          onSelectPath={handlers.onSelectPath}
          text={item.text}
        />
      )
    case "command-group":
      return <CommandGroupEntry items={item.items} />
    case "file-change-group":
      return (
        <FileChangeGroupEntry
          items={item.items}
          onSelectDiff={handlers.onSelectDiff}
        />
      )
    case "tool-group":
      return <ToolGroupEntry items={item.items} />
    case "thought-group":
      return (
        <ThoughtProcessGroupEntry
          items={item.items}
          onSelectDiff={handlers.onSelectDiff}
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

function InitialTranscriptLoader() {
  return (
    <div
      className="inline-flex size-12 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm"
      data-testid="session-transcript-loading-initial"
    >
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  )
}

function CenteredTranscriptLoader() {
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

    if (!isTranscriptActivityItem(current)) {
      timelineItems.push(current)
      cursor += 1
      continue
    }

    if (current.item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION) {
      const groupedItems: SessionTranscriptItem[] = [current.item]
      let next = cursor + 1
      while (next < items.length) {
        const candidate = items[next]
        if (
          !isTranscriptActivityItem(candidate) ||
          candidate.item.kind !== SessionTranscriptItemKind.COMMAND_EXECUTION
        ) {
          break
        }
        groupedItems.push(candidate.item)
        next += 1
      }
      timelineItems.push({
        items: groupedItems,
        key: groupedItems.map((item) => item.id).join(":"),
        kind: "command-group",
      })
      cursor = next
      continue
    }

    if (current.item.kind === SessionTranscriptItemKind.FILE_CHANGE) {
      const groupedItems: SessionTranscriptItem[] = [current.item]
      let next = cursor + 1
      while (next < items.length) {
        const candidate = items[next]
        if (
          !isTranscriptActivityItem(candidate) ||
          candidate.item.kind !== SessionTranscriptItemKind.FILE_CHANGE
        ) {
          break
        }
        groupedItems.push(candidate.item)
        next += 1
      }
      timelineItems.push({
        items: groupedItems,
        key: groupedItems.map((item) => item.id).join(":"),
        kind: "file-change-group",
      })
      cursor = next
      continue
    }

    if (current.item.kind === SessionTranscriptItemKind.TOOL_CALL) {
      const groupedItems: SessionTranscriptItem[] = [current.item]
      let next = cursor + 1
      while (next < items.length) {
        const candidate = items[next]
        if (
          !isTranscriptActivityItem(candidate) ||
          candidate.item.kind !== SessionTranscriptItemKind.TOOL_CALL
        ) {
          break
        }
        groupedItems.push(candidate.item)
        next += 1
      }
      timelineItems.push({
        items: groupedItems,
        key: groupedItems.map((item) => item.id).join(":"),
        kind: "tool-group",
      })
      cursor = next
      continue
    }

    timelineItems.push(current)
    cursor += 1
  }

  return timelineItems
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

function ThinkingEntry({ summary }: { summary: string }) {
  return (
    <div className="min-w-0" data-testid="session-transcript-thinking">
      <div className="min-w-0 rounded-lg border border-border bg-card px-4 py-3">
        <TypingIndicator label={summary} />
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
  onSelectDiff,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectDiff: (diff: ParsedFileChange) => void
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
      return <FileChangeGroupEntry items={[item]} onSelectDiff={onSelectDiff} />
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
    <div className="flex justify-end" data-testid="session-transcript-user">
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

  if (attachment.path && attachment.kind === SessionTranscriptAttachmentKind.FILE) {
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
          <div className="absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-3 bg-black/70 px-4 pb-3 pt-[calc(env(safe-area-inset-top)+0.75rem)]">
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
              ? "h-full w-full object-contain px-2 pb-[env(safe-area-inset-bottom)] pt-[calc(env(safe-area-inset-top)+4rem)]"
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
  const [expanded, setExpanded] = useState(false)
  const label = item.title || "Thinking"
  const preview = item.body.split("\n")[0]?.slice(0, 120) || ""

  return (
    <div className="flex gap-3" data-testid="session-transcript-reasoning">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Lightbulb className="size-3.5 text-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <TranscriptDisclosureButton
          onClick={() => setExpanded((prev) => !prev)}
          expanded={expanded}
          iconClassName="size-3"
          className="gap-1.5 text-foreground/70 hover:text-foreground"
        >
          <span className="text-sm">{label}</span>
          {!expanded && preview ? (
            <span className="truncate text-muted-foreground">— {preview}</span>
          ) : null}
        </TranscriptDisclosureButton>
        {expanded ? (
          <SessionRichText
            text={item.body}
            className="mt-1 text-foreground/70"
            onLocalPathClick={onSelectPath}
          />
        ) : null}
      </div>
    </div>
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

function ToolGroupEntry({ items }: { items: SessionTranscriptItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const count = items.length

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={`Used ${count} tools`}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-tool"
    >
      <div>
        {items.map((item) => (
          <CodeContainer
            key={item.id}
            as="pre"
            className="break-words whitespace-pre-wrap text-foreground/70"
          >
            {item.body}
          </CodeContainer>
        ))}
      </div>
    </TranscriptBatchEntry>
  )
}

function ThoughtProcessGroupEntry({
  items,
  onSelectDiff,
  onSelectPath,
}: {
  items: SessionTranscriptItem[]
  onSelectDiff: (diff: ParsedFileChange) => void
  onSelectPath: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = summarizeThoughtProcess(items)

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={summary}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-thought-group"
    >
      <div className="space-y-4 border-l border-border pl-4">
        {items.map((item) => (
          <TranscriptEntry
            key={item.id}
            item={item}
            onSelectDiff={onSelectDiff}
            onSelectPath={onSelectPath}
          />
        ))}
      </div>
    </TranscriptBatchEntry>
  )
}

function CommandEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const label = item.title || "Command"

  return (
    <div className="min-w-0" data-testid="session-transcript-command">
      <div className="min-w-0">
        <TranscriptDisclosureButton
          onClick={() => setExpanded((prev) => !prev)}
          expanded={expanded}
          iconClassName="ml-auto size-3"
          className="w-full gap-1.5 text-muted-foreground hover:text-foreground"
        >
          <span>{label}</span>
        </TranscriptDisclosureButton>
        {expanded ? (
          <CommandExecutionDetail className="mt-1" body={item.body} />
        ) : null}
      </div>
    </div>
  )
}

function CommandGroupEntry({ items }: { items: SessionTranscriptItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const count = items.length

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={`Ran ${count} commands`}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-command"
    >
      <TranscriptBatchList>
        {items.map((item) => (
          <CommandSummaryEntry key={item.id} item={item} />
        ))}
      </TranscriptBatchList>
    </TranscriptBatchEntry>
  )
}

function CommandSummaryEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const label = summarizeCommandExecution(item.body)

  return (
    <div className="min-w-0">
      <TranscriptBatchRowButton
        onClick={() => setExpanded((prev) => !prev)}
        className="gap-1.5"
      >
        <span className="truncate">Ran {label}</span>
        <ChevronRight
          className={cn(
            "size-3 shrink-0 transition",
            expanded
              ? "rotate-90 opacity-100"
              : "opacity-60 group-hover:opacity-100"
          )}
        />
      </TranscriptBatchRowButton>
      {expanded ? (
        <CommandExecutionDetail className="mt-2" body={item.body} />
      ) : null}
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

function FileChangeGroupEntry({
  items,
  onSelectDiff,
}: {
  items: SessionTranscriptItem[]
  onSelectDiff: (diff: ParsedFileChange) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const changes = items.flatMap((item) => parseFileChangeBody(item.body))
  const count = changes.length

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={`Changed ${count} files`}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-file-change"
    >
      <TranscriptBatchList>
        {changes.map((change) => (
          <TranscriptBatchRowButton
            key={`${change.path}-${change.kindLabel}`}
            onClick={() => onSelectDiff(change)}
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
          </TranscriptBatchRowButton>
        ))}
      </TranscriptBatchList>
    </TranscriptBatchEntry>
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
  children: React.ReactNode
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

function TranscriptBatchList({ children }: { children: React.ReactNode }) {
  return <div className="space-y-0.5">{children}</div>
}

function TranscriptBatchRowButton({
  children,
  className,
  ...props
}: React.ComponentProps<"button">) {
  return (
    <button
      type="button"
      className={cn(
        "group flex w-full items-center gap-2 py-0.5 text-left text-base text-muted-foreground transition hover:text-foreground",
        className
      )}
      {...props}
    >
      {children}
    </button>
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
      className={cn(
        "group inline-flex max-w-full items-center text-left transition",
        className
      )}
      {...props}
    >
      {children}
      <ChevronRight
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

function normalizeTranscriptText(value: string) {
  return value.trim().replace(/\s+/g, " ")
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

function summarizeCommandExecution(body: string) {
  const firstLine = body
    .split("\n")
    .map((line) => line.trim())
    .find((line) => line.length > 0)

  if (!firstLine) {
    return "command"
  }

  const strippedPrefix = firstLine.replace(/^Command output:\s*/, "")
  const shellWrapped = strippedPrefix.match(
    /^[^\s]+(?:\s+-lc)?\s+["'](.+)["']$/
  )
  if (shellWrapped?.[1]) {
    return shellWrapped[1]
  }

  return strippedPrefix.replace(/^\$\s*/, "")
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

function shouldShowThinkingState(status: Session["status"]) {
  const normalized = formatSessionStatus(status).toLowerCase()
  return normalized === "pending" || normalized === "running"
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

function TypingIndicator({ label = "Thinking..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-muted-foreground">
      <div className="flex items-center gap-1">
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full" />
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full [animation-delay:140ms]" />
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full [animation-delay:280ms]" />
      </div>
      <span>{label}</span>
    </div>
  )
}

function shouldPollSessionState(status: Session["status"]) {
  const normalized = formatSessionStatus(status).toLowerCase()
  return (
    normalized === "pending" ||
    normalized === "running" ||
    normalized === "waiting approval"
  )
}
