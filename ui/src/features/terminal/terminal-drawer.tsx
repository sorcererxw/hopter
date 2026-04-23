import type { CSSProperties } from "react"
import { useCallback, useEffect, useMemo, useRef } from "react"
import { useTranslation } from "react-i18next"
import { MoreHorizontal, X } from "lucide-react"
import { Terminal, useTerminal } from "@wterm/react"
import "@wterm/react/css"

import { Button } from "@/components/ui/button"
import type { useTerminalSession } from "@/features/terminal/use-terminal-session"
import type { useTerminalUIState } from "@/features/terminal/use-terminal-ui-state"
import { TerminalStatus } from "@/gen/proto/hopter/v1/terminal_pb"

const terminalStyle = {
  "--term-font-family": "var(--font-mono)",
  "--term-font-size": "0.875rem",
  "--term-line-height": "1.25rem",
  "--term-row-height": "20px",
  borderRadius: 0,
  boxShadow: "none",
  height: "100%",
} as CSSProperties

export function SessionTerminalDrawer({
  enabled,
  terminal,
  uiState,
}: {
  enabled: boolean
  terminal: ReturnType<typeof useTerminalSession>
  uiState: ReturnType<typeof useTerminalUIState>
}) {
  const { t } = useTranslation()
  const { ref, focus } = useTerminal()
  const surfaceRef = useRef<HTMLDivElement | null>(null)
  const fitFrameRef = useRef<number | null>(null)
  const fitSizeRef = useRef({ cols: 0, rows: 0 })
  const resizeStateRef = useRef<{
    originY: number
    startHeight: number
  } | null>(null)
  const previousOpenRef = useRef(uiState.open)
  const { header, height, open, setHeader, setHeight, setOpen } = uiState

  useEffect(() => {
    terminal.setTerminalHandle(ref.current)
  }, [ref, terminal.setTerminalHandle])

  const fitTerminalToSurface = useCallback(() => {
    const handle = ref.current
    const instance = handle?.instance
    const element = instance?.element
    const surface = surfaceRef.current
    if (!handle || !element || !surface) {
      return
    }
    element.style.height = "100%"

    const styles = window.getComputedStyle(element)
    const paddingX =
      parseFloat(styles.paddingLeft) + parseFloat(styles.paddingRight)
    const paddingY =
      parseFloat(styles.paddingTop) + parseFloat(styles.paddingBottom)
    const row = element.querySelector(".term-row")
    const rowHeight = row?.getBoundingClientRect().height || 20
    const probe = document.createElement("span")
    probe.textContent = "W"
    probe.style.position = "absolute"
    probe.style.visibility = "hidden"
    probe.style.whiteSpace = "pre"
    element.appendChild(probe)
    const charWidth = probe.getBoundingClientRect().width || 8
    probe.remove()

    const cols = Math.max(
      20,
      Math.floor((surface.clientWidth - paddingX) / charWidth)
    )
    const rows = Math.max(
      1,
      Math.floor((surface.clientHeight - paddingY) / rowHeight)
    )
    if (cols === fitSizeRef.current.cols && rows === fitSizeRef.current.rows) {
      return
    }
    fitSizeRef.current = { cols, rows }
    handle.resize(cols, rows)
  }, [ref])

  const requestTerminalFit = useCallback(() => {
    if (fitFrameRef.current != null) {
      return
    }
    fitFrameRef.current = window.requestAnimationFrame(() => {
      fitFrameRef.current = null
      fitTerminalToSurface()
    })
  }, [fitTerminalToSurface])

  useEffect(() => {
    return () => {
      if (fitFrameRef.current != null) {
        window.cancelAnimationFrame(fitFrameRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!open || !surfaceRef.current) {
      return
    }
    const observer = new ResizeObserver(() => requestTerminalFit())
    observer.observe(surfaceRef.current)
    requestTerminalFit()
    return () => observer.disconnect()
  }, [open, requestTerminalFit])

  useEffect(() => {
    if (terminal.streamStatus !== "live") {
      return
    }
    fitSizeRef.current = { cols: 0, rows: 0 }
    requestTerminalFit()
  }, [requestTerminalFit, terminal.streamStatus])

  useEffect(() => {
    const wasOpen = previousOpenRef.current
    previousOpenRef.current = open

    if (!enabled) {
      return
    }

    if (!wasOpen && open) {
      void terminal.ensureTerminal().then(() => {
        requestTerminalFit()
        focus()
      })
      return
    }

    if (wasOpen && !open) {
      terminal.disconnect()
    }
  }, [
    enabled,
    focus,
    open,
    requestTerminalFit,
    terminal.disconnect,
    terminal.ensureTerminal,
  ])

  useEffect(() => {
    if (!terminal.terminal) {
      return
    }
    setHeader({
      shell: terminal.terminal.shell,
      cwd: shortPath(terminal.terminal.cwd),
      status: statusLabel(terminal.streamStatus, terminal.terminal.status, t),
      commandSummary:
        terminal.streamStatus === "starting" ||
        terminal.streamStatus === "reconnecting"
          ? ""
          : terminal.terminal.lastForegroundCommandSummary,
    })
  }, [setHeader, t, terminal.streamStatus, terminal.terminal])

  useEffect(() => {
    if (!open) {
      return
    }
    const handleMove = (event: MouseEvent) => {
      const state = resizeStateRef.current
      if (!state) {
        return
      }
      const delta = state.originY - event.clientY
      setHeight(state.startHeight + delta)
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
  }, [open, setHeight])

  const isLive = Boolean(
    terminal.terminal &&
    terminal.terminal.status !== TerminalStatus.EXITED &&
    terminal.terminal.status !== TerminalStatus.TERMINATED
  )

  const showRunningSummary = useMemo(() => {
    if (!header?.commandSummary) {
      return false
    }
    return terminal.streamStatus === "live"
  }, [header?.commandSummary, terminal.streamStatus])

  if (!enabled) {
    return null
  }

  return open ? (
    <div
      className="border-t border-border bg-card"
      style={{ height }}
      data-testid="session-terminal-drawer"
    >
      <div
        role="presentation"
        className="flex h-2 cursor-row-resize items-center justify-center"
        data-testid="session-terminal-resize-handle"
        onMouseDown={(event) => {
          resizeStateRef.current = {
            originY: event.clientY,
            startHeight: height,
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
                {header?.shell || "shell"}
              </span>
              <span className="truncate">{header?.cwd || ""}</span>
              <span>{header?.status || t("terminal.starting")}</span>
            </div>
            {showRunningSummary ? (
              <div className="truncate pt-1 text-xs text-muted-foreground">
                {t("terminal.running", { command: header?.commandSummary })}
              </div>
            ) : null}
          </div>
          <div className="flex items-center gap-1.5">
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label={t("terminal.terminate")}
              className="text-muted-foreground"
              onClick={() => {
                const shouldConfirm =
                  isLive && !terminal.terminal?.lastForegroundCommandExited
                if (
                  shouldConfirm &&
                  !window.confirm(t("terminal.terminateConfirm"))
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
              aria-label={t("terminal.hide")}
              className="text-muted-foreground"
              onClick={() => setOpen(false)}
            >
              <X className="size-4" />
            </Button>
          </div>
        </div>
        <div className="min-h-0 flex-1 overflow-hidden">
          <div className="flex h-full min-h-0 flex-col">
            {terminal.streamStatus === "terminated" ? (
              <InlineBanner
                actionLabel={t("terminal.reopen")}
                label={t("terminal.terminatedBanner")}
                onAction={() => {
                  void terminal.ensureTerminal()
                }}
              />
            ) : terminal.streamStatus === "exited" ? (
              <InlineBanner
                actionLabel={t("terminal.reopen")}
                description={
                  terminal.lastExitCode != null
                    ? t("terminal.exitCode", { code: terminal.lastExitCode })
                    : undefined
                }
                label={t("terminal.exited")}
                onAction={() => {
                  void terminal.ensureTerminal()
                }}
              />
            ) : null}
            <div className="relative h-full min-h-0">
              <div
                ref={surfaceRef}
                className="h-full min-h-0"
                data-testid="session-terminal-surface"
              >
                <Terminal
                  autoResize={false}
                  cols={120}
                  rows={12}
                  ref={ref}
                  className="h-full min-h-0 overflow-hidden rounded-none px-4 py-3 font-mono text-sm leading-5 text-foreground shadow-none"
                  cursorBlink
                  onData={(data) => terminal.sendInput(data)}
                  onError={() => {
                    // handled by stream state
                  }}
                  onReady={() => {
                    terminal.setTerminalHandle(ref.current)
                    fitSizeRef.current = { cols: 0, rows: 0 }
                    requestTerminalFit()
                    focus()
                  }}
                  onResize={(cols, rows) => terminal.resize(cols, rows)}
                  style={terminalStyle}
                />
              </div>

              {terminal.streamStatus === "starting" &&
              !terminal.errorMessage ? (
                <div className="absolute inset-0 bg-card/90">
                  <StatePanel label={t("terminal.starting")} />
                </div>
              ) : null}

              {terminal.streamStatus === "error" ? (
                <div className="absolute inset-0 bg-card/90">
                  <StatePanel
                    actionLabel={t("terminal.retry")}
                    description={terminal.errorMessage}
                    label={t("terminal.unavailable")}
                    onAction={() => {
                      void terminal.ensureTerminal()
                    }}
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

function statusLabel(
  streamStatus: string,
  terminalStatus: TerminalStatus | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch (streamStatus) {
    case "starting":
      return t("terminal.starting")
    case "reconnecting":
      return t("terminal.reconnecting")
    case "error":
      return t("terminal.unavailable")
  }

  switch (terminalStatus) {
    case TerminalStatus.LIVE:
      return t("terminal.live")
    case TerminalStatus.EXITED:
      return t("terminal.exited")
    case TerminalStatus.TERMINATED:
      return t("terminal.terminated")
    case TerminalStatus.DEGRADED:
      return t("terminal.unavailableAfterRestart")
    default:
      return t("terminal.live")
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
