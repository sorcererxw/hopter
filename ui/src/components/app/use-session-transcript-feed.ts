import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react"

import { useAutoHideScrollbar } from "@/components/app/use-auto-hide-scrollbar"
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
  type SessionEventStreamState,
} from "./session-detail-model"
import {
  type ActivityItem,
  activityItemSignature,
  isUserMessageTranscriptItem,
  normalizeTranscriptText,
} from "./session-transcript-activity"

type UseSessionTranscriptFeedInput = {
  eventStreamState: SessionEventStreamState
  optimisticPendingInput: string
  onOptimisticPendingInputSettled: () => void
  sessionId: string
  sessionMeta: SessionMeta | undefined
}

export function useSessionTranscriptFeed({
  eventStreamState,
  optimisticPendingInput,
  onOptimisticPendingInputSettled,
  sessionId,
  sessionMeta,
}: UseSessionTranscriptFeedInput) {
  const transcriptPollInterval = useMemo(
    () =>
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
  const historyFetchEnabledRef = useRef(false)
  const historyBackfillRunningRef = useRef(false)
  const historyRetryTimerRef = useRef<number | null>(null)
  const historyRetryAttemptRef = useRef(0)
  const prependSnapshotRef = useRef<{
    scrollHeight: number
  } | null>(null)
  const [historyFetchRequested, setHistoryFetchRequested] = useState(false)
  const [transcriptPages, setTranscriptPages] = useState<
    SessionTranscriptPage[]
  >([])
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false)
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
    () => buildSessionDetail(sessionMeta, transcriptPages),
    [sessionMeta, transcriptPages]
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
        isUserMessageTranscriptItem(item) &&
        normalizeTranscriptText(item.body).startsWith(normalizedHint)
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
      onOptimisticPendingInputSettled()
    }
  }, [
    optimisticPendingInput,
    onOptimisticPendingInputSettled,
    session?.lastInputHint,
    transcriptItems,
  ])

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

    return items
  }, [optimisticPendingInput, session, showPendingInputHint, transcriptItems])
  const transcriptPageCount = transcriptPages.length
  const lastActivityKey = activityItems.at(-1)?.key ?? ""
  const lastActivitySignature = activityItemSignature(activityItems.at(-1))
  const hasUnloadedTranscriptHistory =
    transcriptPages[0]?.hasMoreBefore ?? sessionMeta?.hasMoreBefore ?? false
  const isLoadingInitialTranscript =
    latestTranscriptQuery.isLoading && activityItems.length === 0

  useEffect(() => {
    const latestPage = latestTranscriptQuery.data
    if (!latestPage) {
      setTranscriptPages([])
      return
    }
    const latestSnapshotKey = transcriptPageSnapshotKey(latestPage)
    if (latestTranscriptSnapshotRef.current !== latestSnapshotKey) {
      latestTranscriptSnapshotRef.current = latestSnapshotKey
      setHistoryFetchRequested(false)
    }
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
    setTranscriptAwayFromBottom(false)
    setHistoryFetchRequested(false)
    latestTranscriptSnapshotRef.current = ""
    historyFetchEnabledRef.current = false
    loadedTranscriptSessionRef.current = sessionId
    historyBackfillRunningRef.current = false
    historyRetryAttemptRef.current = 0
    if (historyRetryTimerRef.current !== null) {
      window.clearTimeout(historyRetryTimerRef.current)
      historyRetryTimerRef.current = null
    }
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

    historyFetchEnabledRef.current = false
    scheduleTranscriptStickToBottom("instant", true)
    lastSessionIdRef.current = sessionId
    lastActivityCountRef.current = activityItems.length
    lastActivitySignatureRef.current = lastActivitySignature
  }, [
    activityItems.length,
    lastActivitySignature,
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
      lastActivitySignature !== "" &&
      lastActivitySignature !== lastActivitySignatureRef.current

    if (sessionChanged) {
      historyFetchEnabledRef.current = false
      scheduleTranscriptStickToBottom("instant", true)
      lastSessionIdRef.current = sessionId
      lastActivityCountRef.current = nextCount
      lastActivitySignatureRef.current = lastActivitySignature
      return
    } else if (activityChanged && shouldStickToBottomRef.current) {
      scheduleTranscriptStickToBottom(
        historyFetchEnabledRef.current ? "animated" : "instant",
        !historyFetchEnabledRef.current
      )
    }

    lastSessionIdRef.current = sessionId
    lastActivityCountRef.current = nextCount
    lastActivitySignatureRef.current = lastActivitySignature
  }, [activityItems.length, lastActivityKey, lastActivitySignature, sessionId])

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

      if (!grew || prependSnapshotRef.current || !wasPinnedBeforeGrowth) {
        updateTranscriptBottomState(container)
        return
      }

      scheduleTranscriptStickToBottom("animated")
    })

    observer.observe(content)

    return () => observer.disconnect()
  }, [sessionId])

  useEffect(() => {
    return () => {
      cancelScheduledTranscriptStick()
    }
  }, [])

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
    lastTranscriptScrollTopRef.current = container.scrollTop
    lastScrollHeightRef.current = container.scrollHeight
    updateTranscriptBottomState(container)
    prependSnapshotRef.current = null
    if (
      transcriptPages[0]?.hasMoreBefore &&
      transcriptPages[0]?.nextBeforeCursor &&
      container.scrollTop < historyFetchThreshold(container)
    ) {
      setHistoryFetchRequested(true)
    }
  }, [transcriptPageCount, transcriptPages])

  useEffect(() => {
    const firstPage = transcriptPages[0]
    if (
      !historyFetchRequested ||
      !firstPage?.hasMoreBefore ||
      !firstPage.nextBeforeCursor ||
      historyBackfillRunningRef.current
    ) {
      if (!historyBackfillRunningRef.current) {
        setIsFetchingPreviousPage(false)
      }
      return
    }

    let cancelled = false
    historyBackfillRunningRef.current = true
    setIsFetchingPreviousPage(true)

    async function loadHistory() {
      try {
        const page = await fetchSessionTranscriptPage(
          sessionId,
          firstPage!.nextBeforeCursor
        )
        if (cancelled || !page) {
          return
        }
        if (!sameTranscriptSnapshot(firstPage!, page)) {
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
        historyRetryAttemptRef.current = 0
      } catch {
        if (!cancelled && shouldRetryHistoryFetch()) {
          const retryDelayMs = Math.min(
            2_000,
            350 * 2 ** Math.min(historyRetryAttemptRef.current, 3)
          )
          historyRetryAttemptRef.current += 1
          setHistoryFetchRequested(false)
          historyRetryTimerRef.current = window.setTimeout(() => {
            historyRetryTimerRef.current = null
            if (shouldRetryHistoryFetch()) {
              setHistoryFetchRequested(true)
            }
          }, retryDelayMs)
        }
      } finally {
        historyBackfillRunningRef.current = false
        if (!cancelled) {
          setIsFetchingPreviousPage(false)
          if (historyRetryTimerRef.current === null) {
            setHistoryFetchRequested(false)
          }
        }
      }
    }

    void loadHistory()

    return () => {
      cancelled = true
    }
  }, [
    historyFetchRequested,
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
    if (
      !suppressHistoryFetchRef.current &&
      historyFetchEnabledRef.current &&
      container.scrollHeight > container.clientHeight + 120 &&
      container.scrollTop < historyFetchThreshold(container) &&
      hasUnloadedTranscriptHistory
    ) {
      setHistoryFetchRequested(true)
    }
    lastTranscriptScrollTopRef.current = container.scrollTop
  }

  function scrollTranscriptToBottom() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    shouldStickToBottomRef.current = true
    setTranscriptAwayFromBottom(false)
    container.scrollTo({
      top: transcriptBottomScrollTop(container),
      behavior: "smooth",
    })
  }

  function cancelScheduledTranscriptStick() {
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
    if (historyRetryTimerRef.current !== null) {
      window.clearTimeout(historyRetryTimerRef.current)
      historyRetryTimerRef.current = null
    }
    suppressHistoryFetchRef.current = false
  }

  function scheduleTranscriptStickToBottom(
    mode: "instant" | "animated",
    force = false
  ) {
    cancelScheduledTranscriptStick()

    if (mode === "instant") {
      let remainingTicks = 14
      const step = () => {
        const container = transcriptScrollRef.current
        if (!container || (!force && !shouldStickToBottomRef.current)) {
          pendingStickFrameRef.current = []
          pendingStickTimerRef.current = null
          suppressHistoryFetchRef.current = false
          return
        }

        stickTranscriptToBottom(container, "instant")
        remainingTicks -= 1

        if (remainingTicks > 0) {
          pendingStickTimerRef.current = window.setTimeout(step, 40)
          return
        }

        suppressHistoryFetchRef.current = false
        historyFetchEnabledRef.current = true
        pendingStickFrameRef.current = []
        pendingStickTimerRef.current = null
      }

      const frame = window.requestAnimationFrame(step)
      pendingStickFrameRef.current = [frame]
      return
    }

    const firstFrame = window.requestAnimationFrame(() => {
      const container = transcriptScrollRef.current
      if (!container || (!force && !shouldStickToBottomRef.current)) {
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
      suppressHistoryFetchRef.current = false
      historyFetchEnabledRef.current = true
      stickAnimationFrameRef.current = null
    }

    stickAnimationFrameRef.current = window.requestAnimationFrame(step)
  }

  function transcriptBottomScrollTop(container: HTMLDivElement) {
    return Math.max(0, container.scrollHeight - container.clientHeight)
  }

  function historyFetchThreshold(container: HTMLDivElement) {
    return Math.max(240, Math.min(900, container.clientHeight * 1.5))
  }

  function shouldRetryHistoryFetch() {
    const container = transcriptScrollRef.current
    if (!container) {
      return false
    }
    return (
      historyFetchEnabledRef.current &&
      container.scrollHeight > container.clientHeight + 120 &&
      container.scrollTop < historyFetchThreshold(container)
    )
  }

  return {
    activityItems,
    hasUnloadedTranscriptHistory,
    isFetchingPreviousPage,
    isLoadingInitialTranscript,
    scrollbarScrollable,
    scrollbarVisible,
    scrollTranscriptToBottom,
    session,
    thumbHeight,
    thumbOffset,
    transcriptAwayFromBottom,
    transcriptContentRef,
    transcriptScrollRef,
    transcriptVisible,
    handleTranscriptScroll,
  }
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

  return String(snapshot.seconds ?? "") + ":" + String(snapshot.nanos ?? "")
}
