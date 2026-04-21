import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query"

import type { TerminalHandle } from "@wterm/react"

import {
  getBrowserInstanceId,
  getTabId,
} from "@/features/terminal/browser-identity"
import type { TerminalSession } from "@/gen/proto/hopter/v1/terminal_pb"
import { TerminalStatus } from "@/gen/proto/hopter/v1/terminal_pb"
import { terminalClient } from "@/lib/connect/clients"
import { queryKeys } from "@/lib/query/keys"

type StreamStatus =
  | "closed"
  | "starting"
  | "live"
  | "reconnecting"
  | "exited"
  | "terminated"
  | "error"

type ServerEvent =
  | { type: "ready"; terminalId?: string }
  | { type: "output"; data?: string }
  | { type: "exit"; exitCode?: number }
  | { type: "terminated" }
  | { type: "error"; message?: string }
  | { type: "pong" }

export function useTerminalSession(sessionId: string, enabled: boolean) {
  const queryClient = useQueryClient()
  const browserInstanceId = useMemo(() => getBrowserInstanceId(), [])
  const tabId = useMemo(() => getTabId(), [])
  const terminalRef = useRef<TerminalHandle | null>(null)
  const socketRef = useRef<WebSocket | null>(null)
  const pendingOutputRef = useRef<string[]>([])
  const reconnectTimerRef = useRef<number | null>(null)
  const disposedRef = useRef(false)
  const manualCloseRef = useRef(false)
  const [streamStatus, setStreamStatus] = useState<StreamStatus>("closed")
  const [errorMessage, setErrorMessage] = useState("")
  const [lastExitCode, setLastExitCode] = useState<number | null>(null)

  const terminalQuery = useQuery({
    enabled,
    queryKey: queryKeys.terminalSession(sessionId, browserInstanceId, tabId),
    queryFn: async () => {
      try {
        const response = await terminalClient.getTerminalSession({
          sessionId,
          browserInstanceId,
          tabId,
        })
        return response.terminal ?? null
      } catch {
        return null
      }
    },
    refetchInterval: false,
  })

  const createTerminal = useMutation({
    onMutate: () => {
      setErrorMessage("")
      setLastExitCode(null)
      setStreamStatus("starting")
    },
    mutationFn: async () => {
      const response = await terminalClient.createTerminalSession({
        sessionId,
        browserInstanceId,
        tabId,
        cols: 120,
        rows: 24,
      })
      return response.terminal!
    },
    onSuccess: async (terminal) => {
      setErrorMessage("")
      setLastExitCode(null)
      queryClient.setQueryData(
        queryKeys.terminalSession(sessionId, browserInstanceId, tabId),
        terminal
      )
    },
    onError: (error) => {
      setStreamStatus("error")
      setErrorMessage(formatTerminalError(error))
    },
  })

  const terminateTerminal = useMutation({
    mutationFn: async (terminalId: string) => {
      const response = await terminalClient.terminateTerminalSession({
        terminalId,
      })
      return response.terminal!
    },
    onSuccess: async (terminal) => {
      queryClient.setQueryData(
        queryKeys.terminalSession(sessionId, browserInstanceId, tabId),
        terminal
      )
      manualCloseRef.current = true
      socketRef.current?.close()
      socketRef.current = null
      setStreamStatus("terminated")
    },
  })

  const terminal = terminalQuery.data

  useEffect(() => {
    return () => {
      disposedRef.current = true
      manualCloseRef.current = true
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current)
      }
      socketRef.current?.close()
      socketRef.current = null
    }
  }, [])

  const connect = useCallback(
    (target: TerminalSession) => {
      if (reconnectTimerRef.current != null) {
        window.clearTimeout(reconnectTimerRef.current)
        reconnectTimerRef.current = null
      }
      const previousSocket = socketRef.current
      if (previousSocket) {
        manualCloseRef.current = true
        previousSocket.close()
      }
      manualCloseRef.current = false
      const url = new URL(
        `/terminals/${target.id}/stream`,
        window.location.origin
      )
      url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:"
      url.searchParams.set("session_id", sessionId)
      url.searchParams.set("browser_instance_id", browserInstanceId)
      url.searchParams.set("tab_id", tabId)
      let ws: WebSocket
      try {
        ws = new WebSocket(url)
      } catch (error) {
        setStreamStatus("error")
        setErrorMessage(formatTerminalError(error))
        return
      }
      socketRef.current = ws
      setStreamStatus((current) =>
        current === "live" ? "reconnecting" : "starting"
      )

      ws.onmessage = (event) => {
        const parsed = JSON.parse(event.data) as ServerEvent
        switch (parsed.type) {
          case "ready":
            setStreamStatus("live")
            setErrorMessage("")
            break
          case "output":
            if (parsed.data) {
              if (terminalRef.current) {
                terminalRef.current.write(parsed.data)
              } else {
                pendingOutputRef.current.push(parsed.data)
              }
            }
            break
          case "exit":
            manualCloseRef.current = true
            setStreamStatus("exited")
            setLastExitCode(parsed.exitCode ?? null)
            break
          case "terminated":
            manualCloseRef.current = true
            setStreamStatus("terminated")
            break
          case "error":
            setStreamStatus("error")
            setErrorMessage(parsed.message ?? "Terminal error")
            break
        }
      }

      ws.onerror = () => {
        setStreamStatus("error")
        setErrorMessage("Reconnection failed. Try again.")
      }

      ws.onclose = () => {
        if (socketRef.current !== ws) {
          return
        }
        if (manualCloseRef.current) {
          return
        }
        setStreamStatus("reconnecting")
        if (!disposedRef.current) {
          reconnectTimerRef.current = window.setTimeout(() => {
            connect(target)
          }, 1000)
        }
      }
    },
    [browserInstanceId, sessionId, tabId]
  )

  const setTerminalHandle = useCallback((handle: TerminalHandle | null) => {
    terminalRef.current = handle
    if (handle && pendingOutputRef.current.length > 0) {
      for (const chunk of pendingOutputRef.current) {
        handle.write(chunk)
      }
      pendingOutputRef.current = []
    }
  }, [])

  const ensureTerminal = useCallback(async () => {
    const existing = await terminalQuery
      .refetch()
      .then((response) => response.data ?? null)
    if (existing) {
      if (
        existing.status === TerminalStatus.EXITED ||
        existing.status === TerminalStatus.TERMINATED
      ) {
        const created = await createTerminal.mutateAsync()
        connect(created)
        return created
      }
      connect(existing)
      return existing
    }
    const created = await createTerminal.mutateAsync()
    connect(created)
    return created
  }, [connect, createTerminal, terminalQuery])

  const reconnect = useCallback(() => {
    if (terminal) {
      connect(terminal)
    }
  }, [connect, terminal])

  const disconnect = useCallback(() => {
    if (reconnectTimerRef.current != null) {
      window.clearTimeout(reconnectTimerRef.current)
      reconnectTimerRef.current = null
    }
    manualCloseRef.current = true
    socketRef.current?.close()
    socketRef.current = null
    setStreamStatus((current) =>
      current === "terminated" || current === "exited" ? current : "closed"
    )
  }, [])

  const sendInput = useCallback((data: string) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "input", data }))
    }
  }, [])

  const resize = useCallback((cols: number, rows: number) => {
    if (socketRef.current?.readyState === WebSocket.OPEN) {
      socketRef.current.send(JSON.stringify({ type: "resize", cols, rows }))
    }
  }, [])

  return useMemo(
    () => ({
      browserInstanceId,
      createTerminal,
      errorMessage,
      lastExitCode,
      setTerminalHandle,
      streamStatus,
      terminal,
      terminateTerminal,
      ensureTerminal,
      reconnect,
      disconnect,
      sendInput,
      resize,
    }),
    [
      browserInstanceId,
      createTerminal,
      disconnect,
      ensureTerminal,
      errorMessage,
      lastExitCode,
      reconnect,
      resize,
      sendInput,
      setTerminalHandle,
      streamStatus,
      terminal,
      terminateTerminal,
    ]
  )
}

function formatTerminalError(error: unknown) {
  if (error instanceof Error && error.message.trim()) {
    return error.message
  }
  return "Terminal could not be started."
}
