import { useMemo, type ReactNode } from "react"
import { ArrowUpDown, ChevronDown, FolderOpen, FolderPlus, Grid2x2, Search, Settings, SquarePen } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router-dom"

import { useProjects } from "@/features/projects/use-projects"
import { useSessions } from "@/features/sessions/use-sessions"
import { formatSessionStatus, timestampToDate } from "@/lib/format/proto"
import { cn } from "@/lib/utils"

function formatRelativeTime(date?: Date) {
  if (!date) {
    return ""
  }

  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)

  if (diffMinutes < 1) {
    return "just now"
  }

  if (diffMinutes < 60) {
    return `${diffMinutes}m`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours}h`
  }

  const diffDays = Math.floor(diffHours / 24)
  return `${diffDays}d`
}

function sessionWeight(updatedAt?: Date) {
  if (!updatedAt) {
    return 0
  }

  return updatedAt.getTime()
}

function sessionDot(status: string) {
  switch (status.toLowerCase()) {
    case "running":
      return "bg-emerald-400/75"
    case "completed":
      return "bg-sky-400/75"
    case "waiting":
      return "bg-amber-300/70"
    default:
      return "bg-[var(--workspace-text-muted)]/70"
  }
}

function projectFolderName(rootPath?: string, fallbackName?: string) {
  const normalized = rootPath?.trim()
  if (normalized) {
    const segments = normalized.split(/[/\\]+/).filter(Boolean)
    const lastSegment = segments.at(-1)
    if (lastSegment) {
      return lastSegment
    }
  }

  return fallbackName || "Unassigned project"
}

function projectFolderPath(rootPath?: string, fallbackName?: string) {
  return rootPath?.trim() || fallbackName || "Unassigned project"
}

type SessionRailProps = {
  onNavigate?: () => void
  onOpenSearch: () => void
}

export function SessionRail({ onNavigate, onOpenSearch }: SessionRailProps) {
  const location = useLocation()
  const { data: projects } = useProjects()
  const { data: sessions, isError, isLoading } = useSessions()

  const activeSession = useMemo(() => {
    const sessionId = location.pathname.startsWith("/sessions/")
      ? location.pathname.slice("/sessions/".length)
      : ""
    return (sessions ?? []).find((session) => session.id === sessionId)
  }, [location.pathname, sessions])

  const workspaceName =
    activeSession?.project?.name ||
    projects?.[0]?.name ||
    sessions?.[0]?.project?.name ||
    "workspace"

  const visibleSessions = useMemo(() => {
    const projectId = activeSession?.project?.id || projects?.[0]?.id
    const filtered = (sessions ?? []).filter((session) =>
      projectId ? session.project?.id === projectId : true
    )

    return [...filtered]
      .sort((left, right) => {
        const leftDate = timestampToDate(left.updatedAt)
        const rightDate = timestampToDate(right.updatedAt)
        return sessionWeight(rightDate) - sessionWeight(leftDate)
      })
      .slice(0, 14)
  }, [activeSession?.project?.id, projects, sessions])

  return (
    <div className="flex h-full flex-col bg-[var(--workspace-sidebar-bg)] text-[var(--workspace-text-primary)]">
      <div className="px-3 pb-2 pt-3">
        <button
          type="button"
          className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition hover:bg-[var(--workspace-hover-bg)]"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-5 shrink-0 items-center justify-center rounded bg-emerald-900/50 text-[10px]">
              🌿
            </div>
            <span className="truncate text-[13px] font-semibold text-[var(--workspace-text-primary)]">
              {workspaceName}
            </span>
          </div>
          <ChevronDown className="size-[13px] text-[var(--workspace-text-muted)]" />
        </button>
      </div>

      <div className="space-y-1 px-3 pb-3">
        <RailAction
          active={location.pathname === "/"}
          icon={SquarePen}
          label="New chat"
          onClick={onNavigate}
          to="/"
        />
        <button
          type="button"
          onClick={onOpenSearch}
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] text-[var(--workspace-text-muted)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)]"
        >
          <Search className="size-[14px] shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <span className="workspace-kbd">⌘K</span>
        </button>
        <RailAction icon={Grid2x2} label="Skills & Apps" />
      </div>

      <div className="mx-3 mb-1 h-px bg-[var(--workspace-border)]" />

      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded text-[11px] font-semibold uppercase tracking-[0.05em] text-[var(--workspace-text-muted)] transition hover:text-[var(--workspace-text-secondary)]"
        >
          <FolderOpen className="size-[11px]" />
          <span>Threads</span>
        </button>
        <div className="flex items-center gap-0.5">
          <ThreadHeaderButton onClick={onNavigate} title="New thread" to="/">
            <SquarePen className="size-[11px]" />
          </ThreadHeaderButton>
          <ThreadHeaderButton title="Sort">
            <ArrowUpDown className="size-[11px]" />
          </ThreadHeaderButton>
          <ThreadHeaderButton title="Add new project" to="/projects/new">
            <FolderPlus className="size-[11px]" />
          </ThreadHeaderButton>
        </div>
      </div>

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="px-3 py-3 text-[12px] text-[var(--workspace-text-muted)]">
            Loading threads...
          </div>
        ) : null}

        {isError ? (
          <div className="px-3 py-3 text-[12px] leading-5 text-[var(--workspace-text-muted)]">
            The shell is ready. Session data will appear when the backend responds.
          </div>
        ) : null}

        {!isLoading && !isError && visibleSessions.length === 0 ? (
          <div className="px-3 py-3 text-[12px] leading-5 text-[var(--workspace-text-muted)]">
            No threads yet. Open a repo and continue from the same workspace.
          </div>
        ) : null}

        {visibleSessions.length > 0 ? (
          <div className="mt-1 border-l border-[color:var(--workspace-thread-guide)] pl-3">
            {visibleSessions.map((session) => {
              const updatedAt = timestampToDate(session.updatedAt)
              const status = formatSessionStatus(session.status).toLowerCase()
              const folderName = projectFolderName(session.project?.rootPath, session.project?.name)
              const folderPath = projectFolderPath(session.project?.rootPath, session.project?.name)

              return (
                <NavLink
                  key={session.id}
                  to={`/sessions/${session.id}`}
                  onClick={onNavigate}
                  className={({ isActive }) =>
                    cn(
                      "mb-1 flex items-start gap-2 rounded-lg border px-3 py-2 text-left transition",
                      isActive
                        ? "border-[color:var(--workspace-border-strong)] bg-[var(--workspace-hover-bg)]"
                        : "border-transparent hover:bg-[var(--workspace-hover-bg-soft)]"
                    )
                  }
                >
                  {({ isActive }) => (
                    <>
                      <span
                        className={cn("mt-[0.35rem] size-1.5 shrink-0 rounded-full", sessionDot(status))}
                      />
                      <div className="min-w-0 flex-1">
                        <div
                          className={cn(
                            "flex items-center gap-1.5 truncate text-[11px] font-medium",
                            isActive
                              ? "text-[var(--workspace-text-primary)]"
                              : "text-[var(--workspace-text-secondary)]"
                          )}
                          title={folderPath}
                        >
                          <FolderOpen className="size-3 shrink-0" />
                          <span className="truncate">{folderName}</span>
                        </div>
                        <p
                          className={cn(
                            "mt-1 truncate text-[13px]",
                            isActive
                              ? "text-[var(--workspace-text-primary)]"
                              : "text-[var(--workspace-text-secondary)]"
                          )}
                        >
                          {session.title || "Untitled thread"}
                        </p>
                        <p
                          className={cn(
                            "mt-1 truncate font-mono text-[10px]",
                            isActive
                              ? "text-[var(--workspace-text-secondary)]"
                              : "text-[var(--workspace-text-muted)]"
                          )}
                          title={folderPath}
                        >
                          {folderPath}
                        </p>
                        <div
                          className={cn(
                            "mt-1 flex items-center gap-2 text-[11px]",
                            isActive
                              ? "text-[var(--workspace-text-secondary)]"
                              : "text-[var(--workspace-text-muted)]"
                          )}
                        >
                          <span className="truncate">{status}</span>
                          <span>•</span>
                          <span className="shrink-0">{formatRelativeTime(updatedAt)}</span>
                        </div>
                      </div>
                    </>
                  )}
                </NavLink>
              )
            })}
          </div>
        ) : null}
      </div>

      <div className="border-t border-[color:var(--workspace-border)] px-3 py-2">
        <Link
          to="/settings"
          onClick={onNavigate}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-[13px] text-[var(--workspace-text-muted)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)]"
        >
          <Settings className="size-[14px]" />
          <span>Settings</span>
        </Link>
      </div>
    </div>
  )
}

function RailAction({
  active = false,
  icon: Icon,
  label,
  onClick,
  to,
}: {
  active?: boolean
  icon: typeof Search
  label: string
  onClick?: () => void
  to?: string
}) {
  const className = cn(
    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-[13px] transition",
    active
      ? "border border-[color:var(--workspace-border-strong)] bg-[var(--workspace-tag-bg)] text-[var(--workspace-text-primary)]"
      : "text-[var(--workspace-text-secondary)] hover:bg-[var(--workspace-hover-bg)]"
  )

  const content = (
    <>
      <Icon className="size-[14px] shrink-0 text-[var(--workspace-text-muted)]" />
      <span>{label}</span>
    </>
  )

  if (to) {
    return (
      <Link to={to} onClick={onClick} className={className}>
        {content}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={className}>
      {content}
    </button>
  )
}

function ThreadHeaderButton({
  children,
  onClick,
  title,
  to,
}: {
  children: ReactNode
  onClick?: () => void
  title: string
  to?: string
}) {
  const className =
    "flex size-6 items-center justify-center rounded text-[var(--workspace-text-muted)] transition hover:bg-[var(--workspace-hover-bg)] hover:text-[var(--workspace-text-secondary)]"

  if (to) {
    return (
      <Link to={to} onClick={onClick} className={className} title={title}>
        {children}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={className} title={title}>
      {children}
    </button>
  )
}
