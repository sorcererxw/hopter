import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

const DEFAULT_HIDE_DELAY_MS = 900
const MIN_THUMB_HEIGHT_PX = 24
const METRIC_EPSILON = 0.5

type UseAutoHideScrollbarOptions = {
  contentRef?: RefObject<HTMLElement | null>
  hideDelayMs?: number
}

type ScrollbarMetrics = {
  scrollable: boolean
  thumbHeight: number
  thumbOffset: number
  visible: boolean
}

// Lightweight custom scrollbar state for app-level panes that need a subtle
// indicator without relying on the platform scrollbar remaining visible.
export function useAutoHideScrollbar(
  containerRef: RefObject<HTMLElement | null>,
  options: UseAutoHideScrollbarOptions = {}
) {
  const { contentRef, hideDelayMs = DEFAULT_HIDE_DELAY_MS } = options
  const [metrics, setMetrics] = useState<ScrollbarMetrics>({
    scrollable: false,
    thumbHeight: 0,
    thumbOffset: 0,
    visible: false,
  })
  const hideTimerRef = useRef<number | null>(null)
  const syncFrameRef = useRef<number | null>(null)

  const syncScrollbarNow = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const { clientHeight, scrollHeight, scrollTop } = container
    const isScrollable = scrollHeight - clientHeight > 1

    if (!isScrollable || clientHeight <= 0) {
      setMetrics((current) =>
        sameMetrics(current, {
          scrollable: false,
          thumbHeight: 0,
          thumbOffset: 0,
          visible: false,
        })
          ? current
          : {
              scrollable: false,
              thumbHeight: 0,
              thumbOffset: 0,
              visible: false,
            }
      )
      return
    }

    const nextThumbHeight = Math.max(
      MIN_THUMB_HEIGHT_PX,
      (clientHeight / scrollHeight) * clientHeight
    )
    const maxOffset = Math.max(0, clientHeight - nextThumbHeight)
    const progress =
      scrollHeight <= clientHeight
        ? 0
        : scrollTop / (scrollHeight - clientHeight)

    setMetrics((current) => {
      const next = {
        ...current,
        scrollable: true,
        thumbHeight: nextThumbHeight,
        thumbOffset: progress * maxOffset,
      }
      return sameMetrics(current, next) ? current : next
    })
  }, [containerRef])

  const syncScrollbar = useCallback(() => {
    if (syncFrameRef.current !== null) {
      return
    }

    // Batch repeated layout work into one frame while scrolling or resizing.
    syncFrameRef.current = window.requestAnimationFrame(() => {
      syncFrameRef.current = null
      syncScrollbarNow()
    })
  }, [syncScrollbarNow])

  const revealScrollbar = useCallback(() => {
    syncScrollbar()

    if (!containerRef.current) {
      return
    }

    setMetrics((current) =>
      current.visible ? current : { ...current, visible: true }
    )

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }

    hideTimerRef.current = window.setTimeout(() => {
      setMetrics((current) =>
        current.visible ? { ...current, visible: false } : current
      )
      hideTimerRef.current = null
    }, hideDelayMs)
  }, [containerRef, hideDelayMs, syncScrollbar])

  const handleScroll = useCallback(() => {
    revealScrollbar()
  }, [revealScrollbar])

  useEffect(() => {
    syncScrollbarNow()

    if (typeof ResizeObserver === "undefined") {
      return
    }

    const observer = new ResizeObserver(() => {
      syncScrollbar()
    })

    if (containerRef.current) {
      observer.observe(containerRef.current)
    }

    if (contentRef?.current) {
      observer.observe(contentRef.current)
    }

    return () => observer.disconnect()
  }, [containerRef, contentRef, syncScrollbar, syncScrollbarNow])

  useEffect(() => {
    const handleResize = () => syncScrollbarNow()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [syncScrollbarNow])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
      }
      if (syncFrameRef.current !== null) {
        window.cancelAnimationFrame(syncFrameRef.current)
      }
    }
  }, [])

  return {
    handleScroll,
    scrollbarScrollable: metrics.scrollable,
    scrollbarVisible: metrics.visible,
    syncScrollbar,
    thumbHeight: metrics.thumbHeight,
    thumbOffset: metrics.thumbOffset,
  }
}

function sameMetrics(left: ScrollbarMetrics, right: ScrollbarMetrics) {
  return (
    left.scrollable === right.scrollable &&
    left.visible === right.visible &&
    Math.abs(left.thumbHeight - right.thumbHeight) < METRIC_EPSILON &&
    Math.abs(left.thumbOffset - right.thumbOffset) < METRIC_EPSILON
  )
}
