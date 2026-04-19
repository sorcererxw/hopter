import { useEffect, useMemo, useRef } from "react"
import { MoreHorizontal, X } from "lucide-react"
import { Terminal, useTerminal } from "@wterm/react"
import "@wterm/react/css"

import { Button } from "@/components/ui/button"
import type { useTerminalSession } from "@/features/terminal/use-terminal-session"
import type { useTerminalUIState } from "@/features/terminal/use-terminal-ui-state"
import { TerminalStatus } from "@/gen/proto/hopter/v1/terminal_pb"

export function SessionTerminalDrawer({
  enabled,
  terminal,
  uiState,
}: {
  enabled: boolean
  terminal: ReturnType<typeof useTerminalSession>
  uiState: ReturnType<typeof useTerminalUIState>
}) {
  const { ref, focus } = useTerminal()
  const resizeStateRef = useRef<{
    originY: number
    startHeight: number
  } | null>(null)
  const previousOpenRef = useRef(uiState.open)

  useEffect(() => {
    terminal.setTerminalHandle(ref.current)
  }, [ref, terminal.setTerminalHandle])

  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = uiState.open

    if (!enabled) {
      return
    }

    if (!wasOpen && uiState.open) {
      void terminal.ensureTerminal().then(() => {
        focus()
      })
      return
    }

    if (wasOpen && !uiState.open) {
      terminal.disconnect()
    }
  }, [
    enabled,
    focus,
    terminal.disconnect,
    terminal.ensureTerminal,
    uiState.open,
  ])

  useEffect(() => {
    if (!terminal.terminal) {
      return
    }
    uiState.setHeader({
      shell: terminal.terminal.shell,
      cwd: shortPath(terminal.terminal.cwd),
      status: statusLabel(terminal.streamStatus, terminal.terminal.status),
      commandSummary:
        terminal.streamStatus === "starting" ||
        terminal.streamStatus === "reconnecting"
          ? ""
          : terminal.terminal.lastForegroundCommandSummary,
    })
  }, [terminal.streamStatus, terminal.terminal, uiState])

  useEffect(() => {
    if (!uiState.open) {
      return
    }
    const handleMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) {
        return
      }
      const delta = state.originY - event.clientY
      uiState.setHeight(state.startHeight + delta)
    }
    const handleUp = () => {
      resizeStateRef.current = null
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
    window.addEventListener("mousemove", handleMove)
    window.addEventListener("mouseup", handleUp)
    return () => {
      window.removeEventListener("mousemove", handleMove)
      window.removeEventListener("mouseup", handleUp)
    }
  }, [uiState, uiState.open])

  const isLive = Boolean(
    terminal.terminal &&
    terminal.terminal.status !== TerminalStatus.EXITED &&
    terminal.terminal.status !== TerminalStatus.TERMINATED
  )

  const showRunningSummary = useMemo(() => {
    if (!uiState.header?.commandSummary) {
      return false
    }
    return terminal.streamStatus === "live"
  }, [terminal.streamStatus, uiState.header?.commandSummary])

  if (!enabled) {
    return null
  }

  return uiState.open ? (
    <div
      className="border-t border-border bg-card"
      style={{ height: uiState.height }}
      data-testid="session-terminal-drawer"
    >
      <div
        role="presentation"
        className="flex h-2 cursor-row-resize items-center justify-center"
        data-testid="session-terminal-resize-handle"
        onMouseDown={(event) => {
          resizeStateRef.current = {
            originY: event.clientY,
            startHeight: uiState.height,
          }
        }}
      >
        <div className="h-1 w-14 rounded-full bg-border" />
      </div>
      <div className="flex h-[calc(100%-0.5rem)] min-h-0 flex-col text-sm font-medium text-foreground">
        <div
          className="flex items-center justify-between gap-3 border-b border-border px-4 py-2"
          data-testid="session-terminal-header"
        >
          <div className="min-w-0">
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <span className="font-mono text-foreground">
                {uiState.header?.shell || "shell"}
              </span>
              <span className="truncate">{uiState.header?.cwd || ""}</span>
              <span>{uiState.header?.status || "Starting terminal..."}</span>
            </div>
            {showRunningSummary ? (
              <div className="truncate pt-1 text-xs text-muted-foreground">
                Running: {uiState.header?.commandSummary}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Terminate terminal"
              className="text-muted-foreground"
              onClick={() => {
                const shouldConfirm =
                  isLive && !terminal.terminal?.lastForegroundCommandExited
                if (
                  shouldConfirm &&
                  !window.confirm("Terminate running terminal?")
                ) {
                  return
                }
                if (terminal.terminal) {
                  void terminal.terminateTerminal.mutateAsync(
                    terminal.terminal.id
                  )
                }
              }}
            >
              <MoreHorizontal className="size-4" />
            </Button>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Hide terminal"
              className="text-muted-foreground"
              onClick={() => uiState.setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            {terminal.streamStatus === "terminated" ? (
              <InlineBanner
                actionLabel="Reopen terminal"
                label="Terminal terminated."
                onAction={() => {
                  void terminal.ensureTerminal()
                }}
              />
            ) : terminal.streamStatus === "exited" ? (
              <InlineBanner
                actionLabel="Reopen terminal"
                description={
                  terminal.lastExitCode != null
                    ? `Exit code ${terminal.lastExitCode}`
                    : undefined
                }
                label="Exited"
                onAction={() => {
                  void terminal.ensureTerminal()
                }}
              />
            ) : null}
            <div className="relative h-full min-h-0">
              <div
                className="h-full min-h-0 [&_.wt-term]:h-full [&_.wt-term]:min-h-0 [&_.wt-term]:overflow-auto [&_.wt-term]:bg-transparent [&_.wt-term]:px-4 [&_.wt-term]:py-3 [&_.wt-term]:font-mono [&_.wt-term]:text-sm"
                data-testid="session-terminal-surface"
              >
                <Terminal
                  ref={ref}
                  className="h-full min-h-0 bg-transparent text-foreground"
                  autoResize
                  cursorBlink
                  onData={(data) => terminal.sendInput(data)}
                  onError={() => {
                    // handled by stream state
                  }}
                  onReady={() => {
                    terminal.setTerminalHandle(ref.current)
                    focus()
                  }}
                  onResize={(cols, rows) => terminal.resize(cols, rows)}
                />
              </div>

              {terminal.streamStatus === "starting" &&
              !terminal.errorMessage ? (
                <div className="absolute inset-0 bg-card/90">
                  <StatePanel label="Starting terminal..." />
                </div>
              ) : null}

              {terminal.streamStatus === "error" ? (
                <div className="absolute inset-0 bg-card/90">
                  <StatePanel
                    actionLabel="Retry"
                    description={terminal.errorMessage}
                    label="Reconnection failed"
                    onAction={() => terminal.reconnect()}
                  />
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  ) : null
}

function StatePanel({
  actionLabel,
  description,
  label,
  onAction,
}: {
  actionLabel?: string
  description?: string
  label: string
  onAction?: () => void
}) {
  return (
    <div className="flex h-full items-center justify-center px-6">
      <div className="rounded-lg border border-border bg-card px-6 py-4 text-center">
        <div className="text-foreground">{label}</div>
        {description ? (
          <div className="pt-1 font-normal text-muted-foreground">
            {description}
          </div>
        ) : null}
        {actionLabel && onAction ? (
          <Button
            type="button"
            variant="secondary"
            size="sm"
            className="mt-3 text-foreground"
            onClick={onAction}
          >
            {actionLabel}
          </Button>
        ) : null}
      </div>
    </div>
  )
}

function InlineBanner({
  actionLabel,
  description,
  label,
  onAction,
}: {
  actionLabel?: string
  description?: string
  label: string
  onAction?: () => void
}) {
  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-muted px-4 py-2 text-foreground">
      <div className="min-w-0">
        <div className="text-foreground">{label}</div>
        {description ? (
          <div className="truncate text-xs font-normal text-muted-foreground">
            {description}
          </div>
        ) : null}
      </div>
      {actionLabel && onAction ? (
        <Button
          type="button"
          variant="secondary"
          size="sm"
          className="text-foreground"
          onClick={onAction}
        >
          {actionLabel}
        </Button>
      ) : null}
    </div>
  )
}

function statusLabel(streamStatus: string, terminalStatus?: TerminalStatus) {
  switch (streamStatus) {
    case "starting":
      return "Starting terminal..."
    case "reconnecting":
      return "Reconnecting..."
    case "error":
      return "Reconnection failed"
  }

  switch (terminalStatus) {
    case TerminalStatus.LIVE:
      return "Live"
    case TerminalStatus.EXITED:
      return "Exited"
    case TerminalStatus.TERMINATED:
      return "Terminated"
    case TerminalStatus.DEGRADED:
      return "Unavailable after restart"
    default:
      return "Live"
  }
}

function shortPath(path: string) {
  const home = "/Users/"
  if (path.startsWith(home)) {
    const parts = path.split("/")
    if (parts.length > 3) {
      return `~/${parts.slice(3).join("/")}`
    }
  }
  return path
}
