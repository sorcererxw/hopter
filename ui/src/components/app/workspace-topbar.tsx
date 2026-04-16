import type { ReactNode } from "react"
import { ChevronDown, FolderOpen, MoreHorizontal, PanelRight, Play, Rocket } from "lucide-react"

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
  return (
    <div className="flex items-center justify-between gap-3 border-b border-white/7 bg-[#0f0f0f] px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate text-[13.5px] font-medium text-[#c8c8c8]">{title}</h1>
        {tag ? (
          <span className="workspace-chip hidden max-w-44 truncate rounded-md px-2.5 py-1 text-[12px] text-[#888] sm:inline-flex">
            {tag}
          </span>
        ) : null}
        <button
          type="button"
          className="hidden rounded-md p-1 text-[#555] transition hover:bg-white/7 hover:text-[#888] sm:inline-flex"
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
          className="inline-flex items-center gap-2 rounded-md border border-white/8 bg-white/6 px-3 py-1.5 text-[12px] text-[#888] transition hover:bg-white/10 hover:text-[#d6d6d6]"
        >
          <FolderOpen className="size-[13px] text-[#666]" />
          <span>Open</span>
        </button>

        {showReview ? (
          <button
            type="button"
            onClick={onOpenReview}
            className="inline-flex items-center gap-1.5 rounded-md border border-white/8 bg-white/6 px-3 py-1.5 text-[12px] text-[#888] transition hover:bg-white/10 hover:text-[#d6d6d6]"
          >
            <Rocket className="size-[12px] text-[#666]" />
            <span>Commit</span>
            <ChevronDown className="size-[11px] text-[#666]" />
          </button>
        ) : null}

        {showInspectorToggle ? (
          <button
            type="button"
            onClick={onToggleInspector}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md border border-white/8 transition",
              inspectorOpen
                ? "bg-white/10 text-[#e0e0e0]"
                : "bg-transparent text-[#666] hover:bg-white/7 hover:text-[#aaa]"
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
      className="inline-flex size-8 items-center justify-center rounded-md text-[#666] transition hover:bg-white/7 hover:text-[#aaa]"
    >
      {children}
    </button>
  )
}
