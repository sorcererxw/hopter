import { useCallback, useMemo, useState } from "react"

type SessionDrawerState = {
  header: {
    shell: string
    cwd: string
    status: string
    commandSummary: string
  } | null
  height: number
  open: boolean
}

const defaultHeight = 360
const bySession = new Map<string, SessionDrawerState>()

// Drawer state is keyed per session and kept outside React Query because it is
// local presentation state with no backend source of truth.
function getOrInit(sessionId: string): SessionDrawerState {
  const existing = bySession.get(sessionId)
  if (existing) {
    return existing
  }
  const next: SessionDrawerState = {
    header: null,
    height: defaultHeight,
    open: false,
  }
  bySession.set(sessionId, next)
  return next
}

export function useTerminalUIState(sessionId: string) {
  const [version, setVersion] = useState(0)
  const state = useMemo(() => getOrInit(sessionId), [sessionId, version])

  const update = useCallback(
    (mutate: (current: SessionDrawerState) => void) => {
      const current = getOrInit(sessionId)
      mutate(current)
      bySession.set(sessionId, current)
      // Bump a local version so hooks subscribed to this session re-read the
      // latest mutable state snapshot.
      setVersion((value) => value + 1)
    },
    [sessionId]
  )

  const setHeader = useCallback(
    (header: SessionDrawerState["header"]) => {
      update((current) => {
        current.header = header
      })
    },
    [update]
  )

  const setHeight = useCallback(
    (height: number) => {
      update((current) => {
        current.height = Math.max(220, height)
      })
    },
    [update]
  )

  const setOpen = useCallback(
    (open: boolean) => {
      update((current) => {
        current.open = open
      })
    },
    [update]
  )

  return useMemo(
    () => ({
      header: state.header,
      height: state.height,
      open: state.open,
      setHeader,
      setHeight,
      setOpen,
    }),
    [setHeader, setHeight, setOpen, state.header, state.height, state.open]
  )
}
