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
      setVersion((value) => value + 1)
    },
    [sessionId]
  )

  return {
    header: state.header,
    height: state.height,
    open: state.open,
    setHeader(header: SessionDrawerState["header"]) {
      update((current) => {
        current.header = header
      })
    },
    setHeight(height: number) {
      update((current) => {
        current.height = Math.max(220, height)
      })
    },
    setOpen(open: boolean) {
      update((current) => {
        current.open = open
      })
    },
  }
}
