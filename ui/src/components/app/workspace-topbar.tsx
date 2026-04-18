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

import type { WorkspaceToolbarMode } from "@/components/app/workspace-posture"
import type { WorkspaceEventStreamState } from "@/components/app/workspace-shell-context"
import { cn } from "@/lib/utils"

type WorkspaceTopbarProps = {
  leadingAction?: "back" | "toggle-rail"
  inspectorOpen?: boolean
  onCommit?: () => void
  onCommitAndReview?: () => void
  onLeadingAction?: () => void
  onOpenReview?: () => void
  onToggleInspector?: () => void
  projectName?: string
  resumeCommand?: string
  sessionId?: string
  showInspectorToggle?: boolean
  showReview?: boolean
  syncState?: WorkspaceEventStreamState
  title: string
  toolbarMode?: WorkspaceToolbarMode
}

export function WorkspaceTopbar({
  leadingAction,
  inspectorOpen = false,
  onCommit,
  onCommitAndReview,
  onLeadingAction,
  onOpenReview,
  onToggleInspector,
  projectName,
  resumeCommand,
  sessionId,
  showInspectorToggle = false,
  showReview = false,
  syncState,
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
        icon={<ArrowLeft className="size-4.5" />}
        label="Back"
        onClick={onLeadingAction}
        testId="workspace-topbar-back"
      />
    ) : leadingAction === "toggle-rail" ? (
      <TopbarLeadingButton
        icon={<PanelLeft className="size-4.5" />}
        label="Toggle navigation"
        onClick={onLeadingAction}
        testId="workspace-topbar-rail-toggle"
      />
    ) : null

  return (
    <div
      className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5"
      data-testid="workspace-topbar"
      data-toolbar-mode={toolbarMode}
    >
      {toolbarMode === "mobile" ? (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {leadingButton}
            <div className="min-w-0">
              <p className="truncate text-base font-medium text-foreground">
                {title}
              </p>
              {projectName ? (
                <p className="truncate text-sm text-muted-foreground">
                  {projectName}
                </p>
              ) : null}
              {syncState ? <SyncStatusBadge state={syncState} /> : null}
            </div>
          </div>
          <div className="flex items-center gap-1.5">
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
                    {showReview ? (
                      <>
                        <OverflowMenuItem
                          onClick={() => {
                            setOverflowOpen(false)
                            onCommit?.()
                          }}
                        >
                          Commit
                        </OverflowMenuItem>
                        <OverflowMenuItem
                          onClick={() => {
                            setOverflowOpen(false)
                            onOpenReview?.()
                          }}
                        >
                          Review
                        </OverflowMenuItem>
                        <OverflowMenuItem
                          onClick={() => {
                            setOverflowOpen(false)
                            onCommitAndReview?.()
                          }}
                        >
                          Commit &amp; Review
                        </OverflowMenuItem>
                        <OverflowMenuItem
                          icon={<Terminal className="size-3.5" />}
                          onClick={() => setOverflowOpen(false)}
                        >
                          Terminal
                        </OverflowMenuItem>
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
                        {inspectorOpen ? "Close inspector" : "Open inspector"}
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
          </div>
        </>
      ) : (
        <>
          <div className="flex min-w-0 items-center gap-2">
            {leadingButton}
            <h1 className="truncate text-sm font-medium text-foreground">
              {title}
            </h1>
            {projectName ? (
              <span className="truncate text-sm text-muted-foreground">
                {projectName}
              </span>
            ) : null}
            {syncState ? <SyncStatusBadge state={syncState} /> : null}
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
          </div>

          <div className="flex items-center gap-1.5">
            {showReview ? (
              <div className="relative">
                <button
                  type="button"
                  onClick={() => setCommitOpen((prev) => !prev)}
                  className="inline-flex items-center gap-1.5 rounded-md bg-secondary px-3 py-1.5 text-xs font-medium text-foreground transition hover:bg-accent"
                >
                  <span>Commit</span>
                  <ChevronDown className="size-3 text-muted-foreground" />
                </button>
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
                        Commit
                      </CommitMenuItem>
                      <CommitMenuItem
                        onClick={() => {
                          setCommitOpen(false)
                          onOpenReview?.()
                        }}
                      >
                        Review
                      </CommitMenuItem>
                      <CommitMenuItem
                        onClick={() => {
                          setCommitOpen(false)
                          onCommitAndReview?.()
                        }}
                      >
                        Commit &amp; Review
                      </CommitMenuItem>
                    </div>
                  </>
                ) : null}
              </div>
            ) : null}

            <TopbarIconButton label="Terminal">
              <Terminal className="size-3.5" />
            </TopbarIconButton>

            {showInspectorToggle ? (
              <button
                type="button"
                onClick={onToggleInspector}
                className={cn(
                  "inline-flex size-8 items-center justify-center rounded-md transition",
                  inspectorOpen
                    ? "bg-accent text-foreground"
                    : "text-muted-foreground hover:bg-accent hover:text-foreground"
                )}
              >
                <PanelRight className="size-3.5" />
              </button>
            ) : null}
          </div>
        </>
      )}
    </div>
  )
}

function SyncStatusBadge({ state }: { state: WorkspaceEventStreamState }) {
  const label =
    state === "connected"
      ? "Live"
      : state === "reconnecting"
        ? "Reconnecting"
        : state === "offline"
          ? "Offline"
          : "Connecting"
  const dotClassName =
    state === "connected"
      ? "bg-emerald-400"
      : state === "reconnecting"
        ? "bg-amber-400"
        : "bg-rose-400"

  return (
    <span className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-2 py-0.5 text-xs text-muted-foreground">
      <span className={cn("size-1.5 rounded-full", dotClassName)} />
      <span>{label}</span>
    </span>
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
    <button
      type="button"
      aria-label={label}
      title={label}
      data-testid={testId}
      onClick={onClick}
      className="flex size-9 items-center justify-center rounded-lg text-foreground transition hover:bg-accent"
    >
      {icon}
    </button>
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
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-foreground transition hover:bg-accent"
    >
      {icon ?? <span className="size-3.5" />}
      <span>{children}</span>
    </button>
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
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-center px-3 py-2 text-sm text-foreground transition hover:bg-accent"
    >
      {children}
    </button>
  )
}

function TopbarIconButton({
  children,
  label,
  onClick,
}: {
  children: ReactNode
  label: string
  onClick?: () => void
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      onClick={onClick}
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-foreground"
    >
      {children}
    </button>
  )
}
