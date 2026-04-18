import { useCallback, useEffect, useRef, useState, type RefObject } from "react"

const DEFAULT_HIDE_DELAY_MS = 900
const MIN_THUMB_HEIGHT_PX = 24

type UseAutoHideScrollbarOptions = {
  contentRef?: RefObject<HTMLElement | null>
  hideDelayMs?: number
}

export function useAutoHideScrollbar(
  containerRef: RefObject<HTMLElement | null>,
  options: UseAutoHideScrollbarOptions = {}
) {
  const { contentRef, hideDelayMs = DEFAULT_HIDE_DELAY_MS } = options
  const [scrollbarVisible, setScrollbarVisible] = useState(false)
  const [scrollbarScrollable, setScrollbarScrollable] = useState(false)
  const [thumbHeight, setThumbHeight] = useState(0)
  const [thumbOffset, setThumbOffset] = useState(0)
  const hideTimerRef = useRef<number | null>(null)

  const syncScrollbar = useCallback(() => {
    const container = containerRef.current
    if (!container) {
      return
    }

    const { clientHeight, scrollHeight, scrollTop } = container
    const isScrollable = scrollHeight - clientHeight > 1

    setScrollbarScrollable(isScrollable)

    if (!isScrollable || clientHeight <= 0) {
      setScrollbarVisible(false)
      setThumbHeight(0)
      setThumbOffset(0)
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

    setThumbHeight(nextThumbHeight)
    setThumbOffset(progress * maxOffset)
  }, [containerRef])

  const revealScrollbar = useCallback(() => {
    syncScrollbar()

    if (!containerRef.current) {
      return
    }

    setScrollbarVisible(true)

    if (hideTimerRef.current !== null) {
      window.clearTimeout(hideTimerRef.current)
    }

    hideTimerRef.current = window.setTimeout(() => {
      setScrollbarVisible(false)
      hideTimerRef.current = null
    }, hideDelayMs)
  }, [containerRef, hideDelayMs, syncScrollbar])

  const handleScroll = useCallback(() => {
    revealScrollbar()
  }, [revealScrollbar])

  useEffect(() => {
    syncScrollbar()

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
  }, [containerRef, contentRef, syncScrollbar])

  useEffect(() => {
    const handleResize = () => syncScrollbar()
    window.addEventListener("resize", handleResize)
    return () => window.removeEventListener("resize", handleResize)
  }, [syncScrollbar])

  useEffect(() => {
    return () => {
      if (hideTimerRef.current !== null) {
        window.clearTimeout(hideTimerRef.current)
      }
    }
  }, [])

  return {
    handleScroll,
    scrollbarScrollable,
    scrollbarVisible,
    syncScrollbar,
    thumbHeight,
    thumbOffset,
  }
}
