import {
  Suspense,
  lazy,
  useEffect,
  useMemo,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
} from "react"
import {
  ChevronRight,
  Lightbulb,
  LoaderCircle,
  Wrench,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SessionArtifactWorkspace } from "@/components/app/session-artifact-workspace"
import { SessionComposer } from "@/components/app/session-composer"
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
import { ApprovalDecision } from "@/gen/proto/hopter/v1/common_pb"
import {
  SessionTranscriptItemKind,
  type Session,
  type SessionMeta,
  type SessionTranscriptPage,
  type SessionTranscriptItem,
} from "@/gen/proto/hopter/v1/session_pb"
import { formatSessionStatus } from "@/lib/format/proto"
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
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptContentRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const lastScrollHeightRef = useRef(0)
  const lastSessionIdRef = useRef(sessionId)
  const lastActivityCountRef = useRef(0)
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
  const hasMoreBefore =
    transcriptPages[0]?.hasMoreBefore ??
    sessionMetaQuery.data?.hasMoreBefore ??
    false
  const isLoadingInitialTranscript =
    latestTranscriptQuery.isLoading && activityItems.length === 0
  const panelVisible =
    panelState.panel === "file" || panelState.panel === "review"
  const panelAsPage = posture !== "wide" && panelVisible

  useEffect(() => {
    if (!latestTranscriptQuery.data) {
      setTranscriptPages([])
      return
    }
    setTranscriptPages([latestTranscriptQuery.data])
  }, [latestTranscriptQuery.data, sessionId])

  useEffect(() => {
    setOptimisticPendingInput("")
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
      container.scrollTop = container.scrollHeight
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
      const nextScrollHeight = container.scrollHeight
      const grew = nextScrollHeight > lastScrollHeightRef.current
      lastScrollHeightRef.current = nextScrollHeight

      if (
        !grew ||
        prependSnapshotRef.current ||
        !shouldStickToBottomRef.current
      ) {
        return
      }

      container.scrollTop = container.scrollHeight
    })

    observer.observe(content)

    return () => observer.disconnect()
  }, [sessionId])

  useEffect(() => {
    syncScrollbar()
  }, [syncScrollbar, transcriptPages, transcriptVisible])

  useEffect(() => {
    const container = transcriptScrollRef.current
    const snapshot = prependSnapshotRef.current
    if (!container || !snapshot) {
      return
    }
    if (isFetchingPreviousPage) {
      return
    }
    if (transcriptPageCount < 2) {
      return
    }

    const delta = container.scrollHeight - snapshot.scrollHeight
    container.scrollTop += delta
    prependSnapshotRef.current = null
  }, [transcriptPageCount, isFetchingPreviousPage])

  function handleTranscriptScroll() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }
    handleScroll()

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom < 120

    if (container.scrollTop <= 80 && hasMoreBefore && !isFetchingPreviousPage) {
      const beforeCursor = transcriptPages[0]?.nextBeforeCursor
      if (!beforeCursor) {
        return
      }
      prependSnapshotRef.current = {
        scrollHeight: container.scrollHeight,
      }
      setIsFetchingPreviousPage(true)
      void fetchSessionTranscriptPage(sessionId, beforeCursor)
        .then((page) => {
          if (!page) {
            return
          }
          setTranscriptPages((current) => [page, ...current])
        })
        .finally(() => {
          setIsFetchingPreviousPage(false)
        })
    }
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
                    "mx-auto max-w-[720px] space-y-0 transition-opacity duration-200 ease-out",
                    transcriptVisible ? "opacity-100" : "opacity-0"
                  )}
                >
                  {session.attentionRequired ? (
                    <div className="rounded-lg border border-amber-300/15 bg-amber-300/8 px-4 py-3">
                      <div className="mb-1 text-sm font-medium text-amber-100/80">
                        Attention
                      </div>
                      <p className="text-base leading-7 font-medium text-amber-50/85">
                        {session.attentionReason ||
                          "This session requires user input."}
                      </p>
                      {session.pendingApprovalId ? (
                        <div className="mt-3 flex gap-2">
                          <button
                            type="button"
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-emerald-300/20 bg-emerald-300/10 px-3 font-medium text-emerald-50 transition hover:bg-emerald-300/15 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={respondToApproval.isPending}
                            onClick={() => {
                              void respondToApproval.mutateAsync({
                                sessionId,
                                approvalId: session.pendingApprovalId!,
                                decision: ApprovalDecision.APPROVE,
                              })
                            }}
                          >
                            Approve
                          </button>
                          <button
                            type="button"
                            className="inline-flex h-8 items-center justify-center rounded-lg border border-amber-200/20 bg-transparent px-3 font-medium text-amber-50/85 transition hover:bg-white/5 disabled:cursor-not-allowed disabled:opacity-50"
                            disabled={respondToApproval.isPending}
                            onClick={() => {
                              void respondToApproval.mutateAsync({
                                sessionId,
                                approvalId: session.pendingApprovalId!,
                                decision: ApprovalDecision.REJECT,
                              })
                            }}
                          >
                            Reject
                          </button>
                        </div>
                      ) : null}
                    </div>
                  ) : null}

                  <TranscriptTimeline
                    items={activityItems}
                    isFetchingPreviousPage={isFetchingPreviousPage}
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
}: {
  items: ActivityItem[]
  isFetchingPreviousPage: boolean
  isLoadingInitialTranscript: boolean
  onSelectDiff: (diff: ParsedFileChange) => void
  onSelectPath: (path: string) => void
}) {
  const timelineItems = groupTimelineItems(items)

  if (timelineItems.length === 0 && !isLoadingInitialTranscript) {
    return null
  }

  return (
    <div className="space-y-2" data-testid="session-transcript">
      {isFetchingPreviousPage ? <TranscriptLoadingRow /> : null}
      {timelineItems.map((item) => {
        switch (item.kind) {
          case "transcript":
            return (
              <TranscriptEntry
                key={item.key}
                item={item.item}
                onSelectDiff={onSelectDiff}
                onSelectPath={onSelectPath}
              />
            )
          case "thinking":
            return <ThinkingEntry key={item.key} summary={item.summary} />
          case "round-status":
            return (
              <RoundStatusEntry
                key={item.key}
                state={item.state}
                summary={item.summary}
              />
            )
          case "pending-input":
            return (
              <PendingInputEntry
                key={item.key}
                onSelectPath={onSelectPath}
                text={item.text}
              />
            )
          case "command-group":
            return <CommandGroupEntry key={item.key} items={item.items} />
          case "file-change-group":
            return (
              <FileChangeGroupEntry
                key={item.key}
                items={item.items}
                onSelectDiff={onSelectDiff}
              />
            )
          case "tool-group":
            return <ToolGroupEntry key={item.key} items={item.items} />
          case "thought-group":
            return (
              <ThoughtProcessGroupEntry
                key={item.key}
                items={item.items}
                onSelectDiff={onSelectDiff}
                onSelectPath={onSelectPath}
              />
            )
        }
      })}
    </div>
  )
}

function TranscriptLoadingRow() {
  return (
    <div
      className="flex items-center justify-center py-2"
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
  return (
    <div className="flex justify-end" data-testid="session-transcript-user">
      <div className="max-w-[85%]">
        <SessionRichText
          text={item.body}
          className="rounded-lg bg-muted px-3 py-2.5 leading-6"
          markdown={false}
          onLocalPathClick={onSelectPath}
        />
      </div>
    </div>
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
