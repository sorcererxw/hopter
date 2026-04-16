import type { ReactNode } from "react"
import {
  ChevronDown,
  FolderOpen,
  Menu,
  MoreHorizontal,
  PanelRight,
  Play,
  Rocket,
} from "lucide-react"

import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { cn } from "@/lib/utils"

type WorkspaceTopbarProps = {
  inspectorOpen?: boolean
  onOpenProject?: () => void
  onOpenReview?: () => void
  onToggleInspector?: () => void
  showInspectorToggle?: boolean
  showReview?: boolean
  tag?: string
  title: string
}

export function WorkspaceTopbar({
  inspectorOpen = false,
  onOpenProject,
  onOpenReview,
  onToggleInspector,
  showInspectorToggle = false,
  showReview = false,
  tag,
  title,
}: WorkspaceTopbarProps) {
  const { openSidebar } = useWorkspaceShell()

  return (
    <div className="flex items-center justify-between gap-3 border-b border-[color:var(--workspace-border)] bg-[var(--workspace-page-bg)] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={openSidebar}
          className="flex size-9 items-center justify-center rounded-lg text-[var(--workspace-text-muted)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)] md:hidden"
        >
          <Menu className="size-[18px]" />
        </button>
        <h1 className="truncate text-[13.5px] font-medium text-[var(--workspace-text-primary)]">
          {title}
        </h1>
        {tag ? (
          <button
            type="button"
            className="workspace-chip hidden max-w-44 truncate rounded-md px-2.5 py-1 text-[11.5px] text-[var(--workspace-text-secondary)] transition hover:bg-[var(--workspace-hover-bg)] sm:inline-flex"
          >
            {tag}
          </button>
        ) : null}
        <button
          type="button"
          className="hidden size-6 items-center justify-center rounded transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)] sm:inline-flex text-[var(--workspace-text-muted)]"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <TopbarIconButton label="Run">
          <Play className="size-[13px]" />
        </TopbarIconButton>

        <button
          type="button"
          onClick={onOpenProject}
          className="inline-flex items-center gap-2 rounded-md border border-[color:var(--workspace-tag-border)] bg-[var(--workspace-tag-bg)] px-3 py-1.5 text-[12px] text-[var(--workspace-text-secondary)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-primary)]"
        >
          <FolderOpen className="size-[13px] text-[var(--workspace-text-muted)]" />
          <span>Open</span>
        </button>

        {showReview ? (
          <button
            type="button"
            onClick={onOpenReview}
            className="inline-flex items-center gap-1.5 rounded-md border border-[color:var(--workspace-tag-border)] bg-[var(--workspace-tag-bg)] px-3 py-1.5 text-[12px] text-[var(--workspace-text-secondary)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-primary)]"
          >
            <Rocket className="size-[12px] text-[var(--workspace-text-muted)]" />
            <span>Commit</span>
            <ChevronDown className="size-[11px] text-[var(--workspace-text-muted)]" />
          </button>
        ) : null}

        {showInspectorToggle ? (
          <button
            type="button"
            onClick={onToggleInspector}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md border transition",
              inspectorOpen
                ? "border-[color:var(--workspace-tag-border)] bg-[var(--workspace-active-bg)] text-[var(--workspace-text-primary)]"
                : "border-[color:var(--workspace-border)] bg-transparent text-[var(--workspace-text-muted)] hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)]"
            )}
          >
            <PanelRight className="size-[13px]" />
          </button>
        ) : null}
      </div>
    </div>
  )
}

function TopbarIconButton({
  children,
  label,
}: {
  children: ReactNode
  label: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="inline-flex size-8 items-center justify-center rounded-md text-[var(--workspace-text-muted)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)]"
    >
      {children}
    </button>
  )
}
