import { useState, type ReactNode } from "react"
import {
  ArrowLeft,
  ChevronDown,
  Copy,
  MoreHorizontal,
  PanelRight,
  Terminal,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { cn } from "@/lib/utils"

type WorkspaceTopbarProps = {
  inspectorOpen?: boolean
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
  onOpenReview,
  onToggleInspector,
  projectName,
  sessionId,
  showInspectorToggle = false,
  showReview = false,
  title,
}: WorkspaceTopbarProps) {
  const { openSidebar } = useWorkspaceShell()
  const navigate = useNavigate()
  const [commitOpen, setCommitOpen] = useState(false)
  const [overflowOpen, setOverflowOpen] = useState(false)
  const [copied, setCopied] = useState(false)

  function handleCopySessionId() {
    if (sessionId) {
      void navigator.clipboard.writeText(sessionId)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    }
    setOverflowOpen(false)
  }

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-2.5">
      {/* Phone topbar: back + stacked title + overflow */}
      <div className="flex min-w-0 items-center gap-2 md:hidden">
        <button
          type="button"
          onClick={() => {
            openSidebar()
            navigate("/")
          }}
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
              <button
                type="button"
                className="fixed inset-0 z-40"
                onClick={() => setOverflowOpen(false)}
              />
              <div className="absolute right-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-popover py-1 shadow-lg">
                <button
                  type="button"
                  onClick={handleCopySessionId}
                  className="flex w-full items-center gap-2.5 px-3 py-2.5 text-sm text-foreground transition hover:bg-accent"
                >
                  <Copy className="size-3.5" />
                  <span>{copied ? "Copied!" : "Copy session ID"}</span>
                </button>
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
              <button
                type="button"
                className="fixed inset-0 z-40"
                onClick={() => setOverflowOpen(false)}
              />
              <div className="absolute left-0 top-full z-50 mt-1 w-48 rounded-lg border border-border bg-popover py-1 shadow-lg">
                {sessionId ? (
                  <button
                    type="button"
                    onClick={handleCopySessionId}
                    className="flex w-full items-center gap-2.5 px-3 py-2 text-sm text-foreground transition hover:bg-accent"
                  >
                    <Copy className="size-3.5" />
                    <span>{copied ? "Copied!" : "Copy session ID"}</span>
                  </button>
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
                <button
                  type="button"
                  className="fixed inset-0 z-40"
                  onClick={() => setCommitOpen(false)}
                />
                <div className="absolute right-0 top-full z-50 mt-1 w-44 rounded-lg border border-border bg-popover py-1 shadow-lg">
                  <CommitMenuItem
                    onClick={() => {
                      setCommitOpen(false)
                      onOpenReview?.()
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
                      onOpenReview?.()
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
