import { useCallback, useEffect, useRef, useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  MoreHorizontal,
  PanelRight,
  Terminal,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { cn } from "@/lib/utils"

type WorkspaceTopbarProps = {
  inspectorOpen?: boolean
  onCommit?: () => void
  onCommitAndReview?: () => void
  onOpenReview?: () => void
  onToggleInspector?: () => void
  projectName?: string
  sessionId?: string
  showInspectorToggle?: boolean
  showReview?: boolean
  title: string
}

export function WorkspaceTopbar({
  inspectorOpen = false,
  onCommit,
  onCommitAndReview,
  onOpenReview,
  onToggleInspector,
  projectName,
  sessionId,
  showInspectorToggle = false,
  showReview = false,
  title,
}: WorkspaceTopbarProps) {
  const navigate = useNavigate()
  const [commitOpen, setCommitOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [copied, setCopied] = useState(false)
  const copiedTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    return () => {
      if (copiedTimerRef.current) {
        clearTimeout(copiedTimerRef.current)
      }
    }
  }, [])

  const handleCopySessionId = useCallback(() => {
    if (!sessionId) {
      return
    }

    navigator.clipboard.writeText(sessionId).then(
      () => {
        setCopied(true)
        if (copiedTimerRef.current) {
          clearTimeout(copiedTimerRef.current)
        }
        copiedTimerRef.current = setTimeout(() => setCopied(false), 1500)
      },
      () => {
        // Clipboard write failed; silently ignore
      }
    )
    setOverflowOpen(false)
  }, [sessionId])

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5">
      {/* Phone topbar: back + stacked title + overflow */}
      <div className="flex min-w-0 items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => navigate("/")}
          className="flex size-9 items-center justify-center rounded-lg text-foreground transition hover:bg-accent"
        >
          <ArrowLeft className="size-4.5" />
        </button>
        <div className="min-w-0">
          <p className="truncate text-sm font-medium text-foreground">{title}</p>
          {projectName ? (
            <p className="truncate text-xs text-muted-foreground">{projectName}</p>
          ) : null}
        </div>
      </div>
      <div className="flex items-center gap-1.5 md:hidden">
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
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setOverflowOpen(false)
                  }
                }}
              />
              <div className="absolute right-0 top-full z-50 mt-1 w-52 rounded-lg border border-border bg-popover py-1 shadow-lg">
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
                {sessionId ? (
                  <OverflowMenuItem
                    icon={<Copy className="size-3.5" />}
                    onClick={handleCopySessionId}
                  >
                    {copied ? "Copied!" : "Copy session ID"}
                  </OverflowMenuItem>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      {/* Large-screen topbar: inline title + project + overflow, right actions */}
      <div className="hidden min-w-0 items-center gap-2 md:flex">
        <h1 className="truncate text-sm font-medium text-foreground">
          {title}
        </h1>
        {projectName ? (
          <span className="truncate text-sm text-muted-foreground">
            {projectName}
          </span>
        ) : null}
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
                onKeyDown={(event) => {
                  if (event.key === "Escape") {
                    setOverflowOpen(false)
                  }
                }}
              />
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-popover py-1 shadow-lg">
                {sessionId ? (
                  <OverflowMenuItem
                    icon={<Copy className="size-3.5" />}
                    onClick={handleCopySessionId}
                  >
                    {copied ? "Copied!" : "Copy session ID"}
                  </OverflowMenuItem>
                ) : null}
              </div>
            </>
          ) : null}
        </div>
      </div>

      <div className="hidden items-center gap-1.5 md:flex">
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
                  onKeyDown={(event) => {
                    if (event.key === "Escape") {
                      setCommitOpen(false)
                    }
                  }}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-popover py-1 shadow-lg">
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
    </div>
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
