import type { ReactNode } from "react"
import {
  ChevronDown,
  FolderOpen,
  Menu,
  MoonStar,
  MoreHorizontal,
  PanelRight,
  Play,
  Rocket,
  SunMedium,
} from "lucide-react"

import { useTheme } from "@/components/theme-provider"
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
  const { resolvedTheme, setTheme } = useTheme()
  const isDark = resolvedTheme === "dark"

  return (
    <div className="flex items-center justify-between gap-3 border-b border-border bg-background px-4 py-3">
      <div className="flex min-w-0 items-center gap-2">
        <button
          type="button"
          onClick={openSidebar}
          className="flex size-9 items-center justify-center rounded-lg text-muted-foreground transition hover:bg-accent hover:text-muted-foreground md:hidden"
        >
          <Menu className="size-4.5" />
        </button>
        <h1 className="truncate text-sm font-medium text-foreground">
          {title}
        </h1>
        {tag ? (
          <button
            type="button"
            className="workspace-chip hidden max-w-44 truncate rounded-md px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent sm:inline-flex"
          >
            {tag}
          </button>
        ) : null}
        <button
          type="button"
          className="hidden size-6 items-center justify-center rounded transition hover:bg-accent hover:text-muted-foreground sm:inline-flex text-muted-foreground"
        >
          <MoreHorizontal className="size-4" />
        </button>
      </div>

      <div className="flex items-center gap-1.5">
        <TopbarIconButton
          label={isDark ? "Switch to light mode" : "Switch to dark mode"}
          onClick={() => setTheme(isDark ? "light" : "dark")}
        >
          {isDark ? (
            <SunMedium className="size-3.5" />
          ) : (
            <MoonStar className="size-3.5" />
          )}
        </TopbarIconButton>

        <TopbarIconButton label="Run">
          <Play className="size-3.5" />
        </TopbarIconButton>

        <button
          type="button"
          onClick={onOpenProject}
          className="inline-flex items-center gap-2 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
        >
          <FolderOpen className="size-3.5 text-muted-foreground" />
          <span>Open</span>
        </button>

        {showReview ? (
          <button
            type="button"
            onClick={onOpenReview}
            className="inline-flex items-center gap-1.5 rounded-md border border-border bg-secondary px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
          >
            <Rocket className="size-3 text-muted-foreground" />
            <span>Commit</span>
            <ChevronDown className="size-3 text-muted-foreground" />
          </button>
        ) : null}

        {showInspectorToggle ? (
          <button
            type="button"
            onClick={onToggleInspector}
            className={cn(
              "inline-flex size-8 items-center justify-center rounded-md border transition",
              inspectorOpen
                ? "border-border bg-accent text-foreground"
                : "border-border bg-transparent text-muted-foreground hover:bg-accent hover:text-muted-foreground"
            )}
          >
            <PanelRight className="size-3.5" />
          </button>
        ) : null}
      </div>
    </div>
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
      className="inline-flex size-8 items-center justify-center rounded-md text-muted-foreground transition hover:bg-accent hover:text-muted-foreground"
    >
      {children}
    </button>
  )
}
