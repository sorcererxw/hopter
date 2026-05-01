import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import {
  fetchSessionTranscriptPage,
  useSessionTranscript,
} from "@/features/sessions/use-sessions"
import type {
  SessionMeta,
  SessionTranscriptPage,
} from "@/gen/proto/hopter/v1/session_pb"

import {
  buildSessionDetail,
  shouldPollSessionState,
  shouldShowThinkingState,
  type SessionEventStreamState,
} from "@/components/app/sessions/detail"
import {
  type ActivityItem,
  activityItemSignature,
  insertPendingInputActivityItem,
  isActiveReasoningTranscriptItem,
  isDisplayableTranscriptItem,
  isUserMessageTranscriptItem,
  normalizeTranscriptText,
  transcriptTextMatchesPendingHint,
} from "./activity"
import { mergeLatestTranscriptPage } from "./page-merge"

type UseSessionTranscriptFeedInput = {
  eventStreamState: SessionEventStreamState
  optimisticPendingInput: string
  onOptimisticPendingInputSettled: () => void
  sessionId: string
  sessionMeta: SessionMeta | undefined
}

// useSessionTranscriptFeed is the coordination layer for transcript paging,
// optimistic pending input, and "stick to bottom unless the user opted out"
// scroll behavior.
export function useSessionTranscriptFeed({
  eventStreamState,
  optimisticPendingInput,
  onOptimisticPendingInputSettled,
  sessionId,
  sessionMeta,
}: UseSessionTranscriptFeedInput) {
  const transcriptPollInterval = useMemo(
    () =>
      // When SSE is healthy we can poll more conservatively. When disconnected,
      // tighten polling for active sessions so the shell still feels live.
      eventStreamState === "connected"
        ? sessionMeta
          ? shouldPollSessionState(sessionMeta.status)
            ? 5_000
            : 10_000
          : 5_000
        : sessionMeta
          ? shouldPollSessionState(sessionMeta.status)
            ? 1500
            : 5000
          : 1500,
    [eventStreamState, sessionMeta]
  )
  const latestTranscriptQuery = useSessionTranscript(
    sessionId,
    Boolean(sessionMeta),
    undefined,
    transcriptPollInterval
  )
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const [transcriptAwayFromBottom, setTranscriptAwayFromBottom] =
    useState(false)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptContentRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const autoStickInProgressRef = useRef(false)
  const lastScrollHeightRef = useRef(0)
  const lastSessionIdRef = useRef("")
  const loadedTranscriptSessionRef = useRef(sessionId)
  const latestTranscriptSnapshotRef = useRef("")
  const lastActivityCountRef = useRef(0)
  const lastActivitySignatureRef = useRef("")
  const lastTranscriptScrollTopRef = useRef(0)
  const pendingStickFrameRef = useRef<number[]>([])
  const pendingStickTimerRef = useRef<number | null>(null)
  const stickAnimationFrameRef = useRef<number | null>(null)
  const suppressHistoryFetchRef = useRef(false)
  const prependSnapshotRef = useRef<{
    scrollHeight: number
  } | null>(null)
  const [transcriptPages, setTranscriptPages] = useState<
    SessionTranscriptPage[]
  >([])
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false)

  const session = useMemo(
    () => buildSessionDetail(sessionMeta, transcriptPages),
    [sessionMeta, transcriptPages]
  )
  const sessionIsActive = Boolean(
    session && shouldShowThinkingState(session.status)
  )
  const transcriptItems = useMemo(() => {
    return (session?.transcriptItems ?? []).filter((item) =>
      isDisplayableTranscriptItem(item)
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
        isUserMessageTranscriptItem(item) &&
        transcriptTextMatchesPendingHint(item.body, normalizedHint)
    )
  }, [session, transcriptItems])

  useEffect(() => {
    if (!optimisticPendingInput) {
      return
    }

    const normalizedPending = normalizeTranscriptText(optimisticPendingInput)
    const transcriptHasPending = transcriptItems.some(
      (item) =>
        isUserMessageTranscriptItem(item) &&
        normalizeTranscriptText(item.body).startsWith(normalizedPending)
    )
    const serverHasPending =
      session?.lastInputHint &&
      normalizeTranscriptText(session.lastInputHint).startsWith(
        normalizedPending
      )

    if (transcriptHasPending || serverHasPending) {
      // Once either the transcript or session metadata reflects the optimistic
      // input, the local placeholder can be removed.
      onOptimisticPendingInputSettled()
    }
  }, [
    optimisticPendingInput,
    onOptimisticPendingInputSettled,
    session?.lastInputHint,
    transcriptItems,
  ])

  const activityItems = useMemo(() => {
    let items: ActivityItem[] = transcriptItems.map((item) => ({
      item,
      kind: "transcript" as const,
      key: item.id,
    }))

    if (optimisticPendingInput) {
      items = insertPendingInputActivityItem(items, {
        key: "optimistic-pending-input",
        text: optimisticPendingInput,
      })
    } else if (session && showPendingInputHint) {
      items = insertPendingInputActivityItem(items, {
        key: "pending-input",
        text: session.lastInputHint,
      })
    }

    const hasActiveReasoningTranscriptItem = transcriptItems.some(
      isActiveReasoningTranscriptItem
    )

    if (
      session &&
      shouldShowThinkingState(session.status) &&
      !hasActiveReasoningTranscriptItem
    ) {
      // Some backends report "thinking" only via status changes, so synthesize
      // a placeholder row when no explicit reasoning transcript item exists yet.
      items.push({
        kind: "thinking" as const,
        key: "thinking",
      })
    }

    return items
  }, [optimisticPendingInput, session, showPendingInputHint, transcriptItems])
  const transcriptPageCount = transcriptPages.length
  const scrollAnchorActivity = latestScrollAnchorActivity(activityItems)
  const scrollAnchorActivityKey = scrollAnchorActivity?.key ?? ""
  const scrollAnchorActivitySignature =
    activityItemSignature(scrollAnchorActivity)
  const hasUnloadedTranscriptHistory =
    transcriptPages[0]?.hasMoreBefore ?? sessionMeta?.hasMoreBefore ?? false
  const isLoadingInitialTranscript =
    latestTranscriptQuery.isLoading && activityItems.length === 0
  const latestTranscriptHasMoreBefore =
    latestTranscriptQuery.data?.hasMoreBefore ?? false
  const latestTranscriptBeforeCursor =
    latestTranscriptQuery.data?.nextBeforeCursor ?? ""

  useEffect(() => {
    const latestPage = latestTranscriptQuery.data
    if (!latestPage) {
      setTranscriptPages([])
      return
    }
    const latestSnapshotKey = transcriptPageSnapshotKey(latestPage)
    if (latestTranscriptSnapshotRef.current !== latestSnapshotKey) {
      latestTranscriptSnapshotRef.current = latestSnapshotKey
    }
    setTranscriptPages((current) => {
      const sessionChanged = loadedTranscriptSessionRef.current !== sessionId
      loadedTranscriptSessionRef.current = sessionId

      if (sessionChanged || current.length === 0) {
        return [latestPage]
      }

      const currentSnapshotKey = transcriptPageSnapshotKey(current.at(-1))
      if (currentSnapshotKey !== latestSnapshotKey) {
        // Snapshot drift is expected when new output lands. Replace only the
        // latest page so already loaded history and the reader's scroll context
        // remain stable while the newest snapshot reconciles.
        return [
          ...current.slice(0, -1),
          mergeLatestTranscriptPage(current.at(-1), latestPage),
        ]
      }

      return [
        ...current.slice(0, -1),
        mergeLatestTranscriptPage(current.at(-1), latestPage),
      ]
    })
  }, [latestTranscriptQuery.data, sessionId])

  useEffect(() => {
    setTranscriptAwayFromBottom(false)
    latestTranscriptSnapshotRef.current = ""
    loadedTranscriptSessionRef.current = sessionId
    prependSnapshotRef.current = null
  }, [sessionId])

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

  useLayoutEffect(() => {
    const container = transcriptScrollRef.current
    if (!container || !transcriptVisible || activityItems.length === 0) {
      return
    }
    if (lastSessionIdRef.current === sessionId) {
      return
    }

    // Entering a different session should always start at the newest content.
    scheduleTranscriptStickToBottom("instant", true)
    lastSessionIdRef.current = sessionId
    lastActivityCountRef.current = activityItems.length
    lastActivitySignatureRef.current = scrollAnchorActivitySignature
  }, [
    activityItems.length,
    scrollAnchorActivitySignature,
    sessionId,
    transcriptVisible,
  ])

  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    const nextCount = activityItems.length
    const sessionChanged = lastSessionIdRef.current !== sessionId
    const activityChanged =
      (scrollAnchorActivitySignature !== "" &&
        scrollAnchorActivitySignature !== lastActivitySignatureRef.current) ||
      nextCount !== lastActivityCountRef.current

    if (sessionChanged) {
      scheduleTranscriptStickToBottom("instant", true)
      lastSessionIdRef.current = sessionId
      lastActivityCountRef.current = nextCount
      lastActivitySignatureRef.current = scrollAnchorActivitySignature
      return
    } else if (
      activityChanged &&
      shouldStickToBottomRef.current &&
      isTranscriptPinnedToBottom(container)
    ) {
      // Only auto-follow new output while the user is still effectively pinned
      // to the bottom. Manual upward scroll disables this until they return.
      scheduleTranscriptStickToBottom("instant")
    } else if (activityChanged) {
      updateTranscriptBottomState(container)
    }

    lastSessionIdRef.current = sessionId
    lastActivityCountRef.current = nextCount
    lastActivitySignatureRef.current = scrollAnchorActivitySignature
  }, [
    activityItems.length,
    scrollAnchorActivityKey,
    scrollAnchorActivitySignature,
    sessionId,
  ])

  useEffect(() => {
    const container = transcriptScrollRef.current
    const content = transcriptContentRef.current
    if (
      !container ||
      !content ||
      !transcriptVisible ||
      typeof ResizeObserver === "undefined"
    ) {
      return
    }

    lastScrollHeightRef.current = container.scrollHeight

    const observer = new ResizeObserver(() => {
      const previousScrollHeight = lastScrollHeightRef.current
      const previousDistanceFromBottom =
        previousScrollHeight - container.scrollTop - container.clientHeight
      const nextScrollHeight = container.scrollHeight
      const grew = nextScrollHeight > previousScrollHeight
      const wasPinnedBeforeGrowth = previousDistanceFromBottom < 120
      lastScrollHeightRef.current = nextScrollHeight

      if (
        !grew ||
        prependSnapshotRef.current ||
        !wasPinnedBeforeGrowth ||
        !sessionIsActive
      ) {
        updateTranscriptBottomState(container)
        return
      }

      // Streaming output often changes height without a scroll event; force the
      // viewport to follow it while the user is still "attached" to the bottom.
      scheduleTranscriptStickToBottom("instant")
    })

    observer.observe(content)

    return () => observer.disconnect()
  }, [sessionId, sessionIsActive, transcriptVisible])

  useEffect(() => {
    return () => {
      cancelScheduledTranscriptStick()
    }
  }, [])

  useEffect(() => {
    const container = transcriptScrollRef.current
    if (container) {
      updateTranscriptBottomState(container)
    }
  }, [transcriptPages, transcriptVisible])

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
    lastTranscriptScrollTopRef.current = container.scrollTop
    lastScrollHeightRef.current = container.scrollHeight
    updateTranscriptBottomState(container)
    prependSnapshotRef.current = null
  }, [transcriptPageCount, transcriptPages])

  useEffect(() => {
    if (!latestTranscriptHasMoreBefore || !latestTranscriptBeforeCursor) {
      setIsFetchingPreviousPage(false)
    }
  }, [latestTranscriptBeforeCursor, latestTranscriptHasMoreBefore])

  async function fetchPreviousTranscriptPage() {
    const oldestPage = transcriptPages[0] ?? latestTranscriptQuery.data
    const cursor = oldestPage?.nextBeforeCursor ?? ""
    const snapshotKey = transcriptPageSnapshotKey(oldestPage)
    if (
      isFetchingPreviousPage ||
      !oldestPage?.hasMoreBefore ||
      !cursor ||
      !snapshotKey
    ) {
      return
    }

    setIsFetchingPreviousPage(true)
    try {
      const page = await fetchSessionTranscriptPage(sessionId, cursor)
      if (!page || transcriptPageSnapshotKey(page) !== snapshotKey) {
        return
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
        // Deduplicate against already loaded pages because history fetches can
        // overlap with the latest snapshot during server reconciliation.
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
    } finally {
      setIsFetchingPreviousPage(false)
    }
  }

  function handleTranscriptScroll() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }
    if (
      container.scrollTop < 160 &&
      !suppressHistoryFetchRef.current &&
      hasUnloadedTranscriptHistory &&
      !isFetchingPreviousPage
    ) {
      void fetchPreviousTranscriptPage()
    }

    const scrolledUp =
      container.scrollTop < lastTranscriptScrollTopRef.current - 24
    if (autoStickInProgressRef.current) {
      if (scrolledUp) {
        // Any intentional upward gesture cancels pending auto-stick work and
        // hands control back to the reader immediately.
        cancelPendingTranscriptStick()
        shouldStickToBottomRef.current = false
      } else {
        shouldStickToBottomRef.current = true
        setTranscriptAwayFromBottom(false)
        lastTranscriptScrollTopRef.current = container.scrollTop
        return
      }
    }

    if (scrolledUp) {
      cancelPendingTranscriptStick()
      shouldStickToBottomRef.current = false
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    if (!scrolledUp) {
      shouldStickToBottomRef.current = distanceFromBottom < 120
    }
    setTranscriptAwayFromBottom(distanceFromBottom > 160)
    lastTranscriptScrollTopRef.current = container.scrollTop
  }

  function scrollTranscriptToBottom() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    shouldStickToBottomRef.current = true
    setTranscriptAwayFromBottom(false)
    stickTranscriptToBottom(container)
  }

  function cancelScheduledTranscriptStick() {
    cancelPendingTranscriptStick()
  }

  function cancelPendingTranscriptStick() {
    autoStickInProgressRef.current = false
    for (const frame of pendingStickFrameRef.current) {
      window.cancelAnimationFrame(frame)
    }
    pendingStickFrameRef.current = []
    if (stickAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(stickAnimationFrameRef.current)
      stickAnimationFrameRef.current = null
    }
    if (pendingStickTimerRef.current !== null) {
      window.clearTimeout(pendingStickTimerRef.current)
      pendingStickTimerRef.current = null
    }
    suppressHistoryFetchRef.current = false
  }

  function scheduleTranscriptStickToBottom(
    mode: "instant" | "animated",
    force = false
  ) {
    cancelScheduledTranscriptStick()
    autoStickInProgressRef.current = true

    if (mode === "instant") {
      const frame = window.requestAnimationFrame(() => {
        const container = transcriptScrollRef.current
        if (!container || (!force && !shouldStickToBottomRef.current)) {
          autoStickInProgressRef.current = false
          pendingStickFrameRef.current = []
          pendingStickTimerRef.current = null
          suppressHistoryFetchRef.current = false
          return
        }

        stickTranscriptToBottom(container, "instant")
        suppressHistoryFetchRef.current = false
        autoStickInProgressRef.current = false
        pendingStickFrameRef.current = []
        pendingStickTimerRef.current = null
      })

      pendingStickFrameRef.current = [frame]
      return
    }

    const firstFrame = window.requestAnimationFrame(() => {
      const container = transcriptScrollRef.current
      if (!container || (!force && !shouldStickToBottomRef.current)) {
        autoStickInProgressRef.current = false
        pendingStickFrameRef.current = []
        return
      }

      stickTranscriptToBottom(container, mode)

      const secondFrame = window.requestAnimationFrame(() => {
        const nextContainer = transcriptScrollRef.current
        if (nextContainer && (force || shouldStickToBottomRef.current)) {
          stickTranscriptToBottom(nextContainer, mode)
        }
        pendingStickFrameRef.current = []
      })
      pendingStickFrameRef.current = [secondFrame]
    })

    pendingStickFrameRef.current = [firstFrame]
  }

  function updateTranscriptBottomState(container: HTMLDivElement) {
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    const shouldStick = distanceFromBottom < 120
    shouldStickToBottomRef.current = shouldStick
    setTranscriptAwayFromBottom(distanceFromBottom > 160)
  }

  function isTranscriptPinnedToBottom(container: HTMLDivElement) {
    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    return distanceFromBottom < 120
  }

  function stickTranscriptToBottom(
    container: HTMLDivElement,
    mode: "instant" | "animated" = "instant"
  ) {
    shouldStickToBottomRef.current = true
    suppressHistoryFetchRef.current = true
    const target = transcriptBottomScrollTop(container)
    if (
      mode === "animated" &&
      !window.matchMedia("(prefers-reduced-motion: reduce)").matches
    ) {
      animateTranscriptScrollTo(container, target)
    } else {
      if (stickAnimationFrameRef.current !== null) {
        window.cancelAnimationFrame(stickAnimationFrameRef.current)
        stickAnimationFrameRef.current = null
      }
      container.scrollTop = target
      lastTranscriptScrollTopRef.current = container.scrollTop
    }
    setTranscriptAwayFromBottom(false)
  }

  function animateTranscriptScrollTo(
    container: HTMLDivElement,
    target: number
  ) {
    if (stickAnimationFrameRef.current !== null) {
      window.cancelAnimationFrame(stickAnimationFrameRef.current)
      stickAnimationFrameRef.current = null
    }

    const start = container.scrollTop
    const delta = target - start
    if (Math.abs(delta) < 2) {
      container.scrollTop = target
      autoStickInProgressRef.current = false
      suppressHistoryFetchRef.current = false
      return
    }

    const startedAt = performance.now()
    const duration = 140

    function step(now: number) {
      const progress = Math.min(1, (now - startedAt) / duration)
      const eased = 1 - Math.pow(1 - progress, 3)
      container.scrollTop = start + delta * eased
      lastTranscriptScrollTopRef.current = container.scrollTop

      if (progress < 1 && shouldStickToBottomRef.current) {
        stickAnimationFrameRef.current = window.requestAnimationFrame(step)
        return
      }

      if (shouldStickToBottomRef.current) {
        container.scrollTop = transcriptBottomScrollTop(container)
        lastTranscriptScrollTopRef.current = container.scrollTop
      }
      autoStickInProgressRef.current = false
      suppressHistoryFetchRef.current = false
      stickAnimationFrameRef.current = null
    }

    stickAnimationFrameRef.current = window.requestAnimationFrame(step)
  }

  function transcriptBottomScrollTop(container: HTMLDivElement) {
    return Math.max(0, container.scrollHeight - container.clientHeight)
  }

  return {
    activityItems,
    hasUnloadedTranscriptHistory,
    isFetchingPreviousPage,
    isLoadingInitialTranscript,
    scrollTranscriptToBottom,
    session,
    transcriptAwayFromBottom,
    transcriptContentRef,
    transcriptScrollRef,
    transcriptVisible,
    handleTranscriptScroll,
  }
}

function transcriptPageSnapshotKey(page: SessionTranscriptPage | undefined) {
  const snapshot = page?.snapshotUpdatedAt
  if (!snapshot) {
    return ""
  }

  return String(snapshot.seconds ?? "") + ":" + String(snapshot.nanos ?? "")
}

function latestScrollAnchorActivity(items: ActivityItem[]) {
  for (let index = items.length - 1; index >= 0; index -= 1) {
    const item = items[index]
    if (item?.kind !== "thinking") {
      return item
    }
  }

  return items.at(-1)
}
