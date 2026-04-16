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
    <div className="flex items-center justify-between gap-3 border-b border-white/7 px-4 py-3">
      <div className="flex min-w-0 items-center gap-2.5">
        <h1 className="truncate text-[15px] font-semibold text-[#efefef]">{title}</h1>
        {tag ? (
          <span className="workspace-chip hidden max-w-44 truncate rounded-full px-3 py-1 text-[12px] text-[#8f8f8f] sm:inline-flex">
            {tag}
          </span>
        ) : null}
        <button
          type="button"
          className="hidden rounded-md p-1 text-[#676767] transition hover:bg-white/6 hover:text-[#bfbfbf] sm:inline-flex"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <TopbarIconButton label="Run">
          <Play className="size-4" />
        </TopbarIconButton>

        <button
          type="button"
          onClick={onOpenProject}
          className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/3 px-3 py-2 text-[13px] text-[#d4d4d4] transition hover:bg-white/8"
        >
          <FolderOpen className="size-4 text-[#9f9f9f]" />
          <span>打开</span>
        </button>

        {showReview ? (
          <button
            type="button"
            onClick={onOpenReview}
            className="inline-flex items-center gap-2 rounded-2xl border border-white/10 bg-white/3 px-3 py-2 text-[13px] text-[#d4d4d4] transition hover:bg-white/8"
          >
            <Rocket className="size-4 text-[#9f9f9f]" />
            <span>提交</span>
            <ChevronDown className="size-3.5 text-[#7f7f7f]" />
          </button>
        ) : null}

        {showInspectorToggle ? (
          <button
            type="button"
            onClick={onToggleInspector}
            className={cn(
              "inline-flex size-10 items-center justify-center rounded-2xl border border-white/10 transition",
              inspectorOpen
                ? "bg-white/10 text-[#ececec]"
                : "bg-transparent text-[#7b7b7b] hover:bg-white/6 hover:text-[#d4d4d4]"
            )}
          >
            <PanelRight className="size-4" />
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
      className="inline-flex size-10 items-center justify-center rounded-2xl text-[#6d6d6d] transition hover:bg-white/6 hover:text-[#d4d4d4]"
    >
      {children}
    </button>
  )
}
