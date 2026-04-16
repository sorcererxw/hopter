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
    <div className="flex items-center justify-between gap-3 border-b border-ws-border bg-ws-page px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={openSidebar}
          className="flex size-9 items-center justify-center rounded-lg text-ws-text-muted transition hover:bg-ws-hover hover:text-ws-text-sub md:hidden"
        >
          <Menu className="size-[18px]" />
        </button>
        <h1 className="truncate text-[13.5px] font-medium text-ws-text">
          {title}
        </h1>
        {tag ? (
          <button
            type="button"
            className="workspace-chip hidden max-w-44 truncate rounded-md px-2.5 py-1 text-[11.5px] text-ws-text-sub transition hover:bg-ws-hover sm:inline-flex"
          >
            {tag}
          </button>
        ) : null}
        <button
          type="button"
          className="hidden size-6 items-center justify-center rounded transition hover:bg-ws-hover hover:text-ws-text-sub sm:inline-flex text-ws-text-muted"
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
          className="inline-flex items-center gap-2 rounded-md border border-ws-tag-border bg-ws-tag px-3 py-1.5 text-xs text-ws-text-sub transition hover:bg-ws-hover hover:text-ws-text"
        >
          <FolderOpen className="size-[13px] text-ws-text-muted" />
          <span>Open</span>
        </button>

        {showReview ? (
          <button
            type="button"
            onClick={onOpenReview}
            className="inline-flex items-center gap-1.5 rounded-md border border-ws-tag-border bg-ws-tag px-3 py-1.5 text-xs text-ws-text-sub transition hover:bg-ws-hover hover:text-ws-text"
          >
            <Rocket className="size-[12px] text-ws-text-muted" />
            <span>Commit</span>
            <ChevronDown className="size-[11px] text-ws-text-muted" />
          </button>
        ) : null}

        {showInspectorToggle ? (
          <button
            type="button"
            onClick={onToggleInspector}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md border transition",
              inspectorOpen
                ? "border-ws-tag-border bg-ws-active text-ws-text"
                : "border-ws-border bg-transparent text-ws-text-muted hover:bg-ws-hover hover:text-ws-text-sub"
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
      className="inline-flex size-8 items-center justify-center rounded-md text-ws-text-muted transition hover:bg-ws-hover hover:text-ws-text-sub"
    >
      {children}
    </button>
  )
}
