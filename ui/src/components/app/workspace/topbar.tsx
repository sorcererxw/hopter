import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  MoreHorizontal,
  PanelLeft,
  PanelRight,
  Terminal,
} from "lucide-react"
import { toast } from "sonner"

import { Button } from "@/components/ui/button"
import { cn } from "@/lib/utils"

import type { WorkspaceToolbarMode } from "./posture"

export type WorkspaceTopbarProps = {
  leadingAction?: "back" | "toggle-rail"
  inspectorOpen?: boolean
  onCommit?: () => void
  onCommitAndPush?: () => void
  onLeadingAction?: () => void
  onOpenReview?: () => void
  onOpenTerminal?: () => void
  onToggleInspector?: () => void
  projectName?: string
  resumeCommand?: string
  sessionId?: string
  showInspectorToggle?: boolean
  showCommit?: boolean
  showReview?: boolean
  showOverflowMenu?: boolean
  showTerminal?: boolean
  terminalButtonTestId?: string
  terminalActive?: boolean
  title: string
  toolbarMode?: WorkspaceToolbarMode
}

export function WorkspaceTopbar({
  leadingAction,
  inspectorOpen = false,
  onCommit,
  onCommitAndPush,
  onLeadingAction,
  onOpenReview,
  onOpenTerminal,
  onToggleInspector,
  projectName,
  resumeCommand,
  sessionId,
  showInspectorToggle = false,
  showCommit = false,
  showOverflowMenu = true,
  showReview = false,
  showTerminal = false,
  terminalButtonTestId,
  terminalActive = false,
  title,
  toolbarMode = "desktop",
}: WorkspaceTopbarProps) {
  const [commitOpen, setCommitOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [copiedItem, setCopiedItem] = useState<
    "resume-command" | "session-id" | null
  >(null)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  useEffect(() => {
    if (!overflowOpen && !commitOpen) {
      return undefined
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") {
        setOverflowOpen(false)
        setCommitOpen(false)
      }
    }

    window.addEventListener("keydown", handleKeyDown)
    return () => window.removeEventListener("keydown", handleKeyDown)
  }, [overflowOpen, commitOpen])

  const handleCopy = useCallback(
    (text: string, item: "resume-command" | "session-id") => {
      if (!text) {
        return
      }

      navigator.clipboard.writeText(text).then(
        () => {
          setCopiedItem(item)
          toast.success(
            item === "resume-command"
              ? "Codex command copied"
              : "Session ID copied"
          )
          if (copiedTimerRef.current) {
            clearTimeout(copiedTimerRef.current)
          }
          copiedTimerRef.current = setTimeout(() => setCopiedItem(null), 1500)
        },
        () => {
          // Clipboard write failed; silently ignore
        }
      )
      setOverflowOpen(false)
    },
    []
  )

  const leadingButton =
    leadingAction === "back" ? (
      <TopbarLeadingButton
        icon={<ArrowLeft className="size-4" />}
        label="Back"
        onClick={onLeadingAction}
        testId="workspace-topbar-back"
      />
    ) : leadingAction === "toggle-rail" ? (
      <TopbarLeadingButton
        icon={<PanelLeft className="size-4" />}
        label="Toggle navigation"
        onClick={onLeadingAction}
        testId="workspace-topbar-rail-toggle"
      />
    ) : null

  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-1.5 font-medium text-foreground"
      data-testid="workspace-topbar"
      data-toolbar-mode={toolbarMode}
    >
      {toolbarMode === "mobile" ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {leadingButton}
            <div className="min-w-0">
              <p className="truncate text-base text-foreground">{title}</p>
              {projectName ? (
                <p className="truncate text-muted-foreground">{projectName}</p>
              ) : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {showOverflowMenu ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOverflowOpen((prev) => !prev)}
                  className="flex size-9 items-center justify-center rounded-lg text-foreground transition hover:bg-accent"
                >
                  <MoreHorizontal className="size-4.5" />
                </button>
                {overflowOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40"
                      onClick={() => setOverflowOpen(false)}
                    />
                    <div className="absolute top-full right-0 z-50 mt-1 w-52 rounded-lg border border-border bg-popover py-1 shadow-lg">
                      {showCommit || showReview ? (
                        <>
                          {showCommit ? (
                            <OverflowMenuItem
                              onClick={() => {
                                setOverflowOpen(false)
                                onCommit?.()
                              }}
                            >
                              Commit All
                            </OverflowMenuItem>
                          ) : null}
                          <OverflowMenuItem
                            onClick={() => {
                              setOverflowOpen(false)
                              onOpenReview?.()
                            }}
                          >
                            Review
                          </OverflowMenuItem>
                          {showCommit ? (
                            <OverflowMenuItem
                              onClick={() => {
                                setOverflowOpen(false)
                                onCommitAndPush?.()
                              }}
                            >
                              Commit All &amp; Push
                            </OverflowMenuItem>
                          ) : null}
                          {showTerminal ? (
                            <OverflowMenuItem
                              icon={<Terminal className="size-3.5" />}
                              onClick={() => {
                                setOverflowOpen(false)
                                onOpenTerminal?.()
                              }}
                            >
                              Terminal
                            </OverflowMenuItem>
                          ) : null}
                        </>
                      ) : null}
                      {showInspectorToggle ? (
                        <OverflowMenuItem
                          icon={<PanelRight className="size-3.5" />}
                          onClick={() => {
                            setOverflowOpen(false)
                            onToggleInspector?.()
                          }}
                        >
                          {inspectorOpen ? "Close sidebar" : "Open sidebar"}
                        </OverflowMenuItem>
                      ) : null}
                      {resumeCommand ? (
                        <OverflowMenuItem
                          icon={<Terminal className="size-3.5" />}
                          onClick={() =>
                            handleCopy(resumeCommand, "resume-command")
                          }
                        >
                          {copiedItem === "resume-command"
                            ? "Codex command copied"
                            : "Resume in Codex"}
                        </OverflowMenuItem>
                      ) : null}
                      {sessionId ? (
                        <OverflowMenuItem
                          icon={<Copy className="size-3.5" />}
                          onClick={() => handleCopy(sessionId, "session-id")}
                        >
                          {copiedItem === "session-id"
                            ? "Copied!"
                            : "Copy session ID"}
                        </OverflowMenuItem>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {leadingButton}
            <h1 className="truncate text-base text-foreground">{title}</h1>
            {projectName ? (
              <span className="truncate text-muted-foreground">
                {projectName}
              </span>
            ) : null}
            {showOverflowMenu ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setOverflowOpen((prev) => !prev)}
                  className="flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                >
                  <MoreHorizontal className="size-4" />
                </button>
                {overflowOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40"
                      onClick={() => setOverflowOpen(false)}
                    />
                    <div className="absolute top-full left-0 z-50 mt-1 w-48 rounded-lg border border-border bg-popover py-1 shadow-lg">
                      {resumeCommand ? (
                        <OverflowMenuItem
                          icon={<Terminal className="size-3.5" />}
                          onClick={() =>
                            handleCopy(resumeCommand, "resume-command")
                          }
                        >
                          {copiedItem === "resume-command"
                            ? "Codex command copied"
                            : "Resume in Codex"}
                        </OverflowMenuItem>
                      ) : null}
                      {sessionId ? (
                        <OverflowMenuItem
                          icon={<Copy className="size-3.5" />}
                          onClick={() => handleCopy(sessionId, "session-id")}
                        >
                          {copiedItem === "session-id"
                            ? "Copied!"
                            : "Copy session ID"}
                        </OverflowMenuItem>
                      ) : null}
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}
          </div>

          <div className="flex items-center gap-1.5">
            {showCommit ? (
              <div className="relative">
                <Button
                  type="button"
                  variant="secondary"
                  onClick={() => setCommitOpen((prev) => !prev)}
                  className="gap-1.5 text-foreground"
                >
                  <span>Commit</span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </Button>
                {commitOpen ? (
                  <>
                    <div
                      aria-hidden="true"
                      className="fixed inset-0 z-40"
                      onClick={() => setCommitOpen(false)}
                    />
                    <div className="absolute top-full right-0 z-50 mt-1 w-44 rounded-lg border border-border bg-popover py-1 shadow-lg">
                      <CommitMenuItem
                        onClick={() => {
                          setCommitOpen(false)
                          onCommit?.()
                        }}
                      >
                        Commit All
                      </CommitMenuItem>
                      <CommitMenuItem
                        onClick={() => {
                          setCommitOpen(false)
                          onCommitAndPush?.()
                        }}
                      >
                        Commit All &amp; Push
                      </CommitMenuItem>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            {showReview ? (
              <Button
                type="button"
                variant={showCommit ? "ghost" : "secondary"}
                onClick={onOpenReview}
                className={cn(
                  showCommit ? "text-muted-foreground" : "text-foreground"
                )}
              >
                Review
              </Button>
            ) : null}

            {showTerminal ? (
              <TopbarIconButton
                active={terminalActive}
                label="Terminal"
                onClick={onOpenTerminal}
                testId={terminalButtonTestId}
              >
                <Terminal className="size-3.5" />
              </TopbarIconButton>
            ) : null}

            {showInspectorToggle ? (
              <Button
                type="button"
                variant={inspectorOpen ? "secondary" : "ghost"}
                size="icon"
                onClick={onToggleInspector}
                aria-label={inspectorOpen ? "Close sidebar" : "Open sidebar"}
                title={inspectorOpen ? "Close sidebar" : "Open sidebar"}
                className={cn(
                  inspectorOpen ? "text-foreground" : "text-muted-foreground"
                )}
              >
                <PanelRight className="size-3.5" />
              </Button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function TopbarLeadingButton({
  icon,
  label,
  onClick,
  testId,
}: {
  icon: ReactNode
  label: string
  onClick?: () => void
  testId: string
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      variant="ghost"
      size="icon-sm"
      className="text-foreground"
    >
      {icon}
    </Button>
  )
}

function OverflowMenuItem({
  children,
  icon,
  onClick,
}: {
  children: ReactNode
  icon?: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="ghost"
      className="flex h-auto w-full items-center justify-start gap-2.5 rounded-none px-3 py-2.5 text-foreground"
    >
      {icon ?? <span className="size-3.5" />}
      <span>{children}</span>
    </Button>
  )
}

function CommitMenuItem({
  children,
  onClick,
}: {
  children: ReactNode
  onClick: () => void
}) {
  return (
    <Button
      type="button"
      onClick={onClick}
      variant="ghost"
      className="flex h-auto w-full items-center justify-start rounded-none px-3 py-2 text-foreground"
    >
      {children}
    </Button>
  )
}

function TopbarIconButton({
  active = false,
  children,
  label,
  onClick,
  testId,
}: {
  active?: boolean
  children: ReactNode
  label: string
  onClick?: () => void
  testId?: string
}) {
  return (
    <Button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      variant={active ? "secondary" : "ghost"}
      size="icon"
      className={cn(active ? "text-foreground" : "text-muted-foreground")}
    >
      {children}
    </Button>
  )
}
