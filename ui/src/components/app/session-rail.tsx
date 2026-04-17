import { useMemo, type ReactNode } from "react"
import { ArrowUpDown, ChevronDown, FolderOpen, FolderPlus, Grid2x2, Search, Settings, SquarePen } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router-dom"

import { useProjects } from "@/features/projects/use-projects"
import { useSessions } from "@/features/sessions/use-sessions"
import { formatSessionStatus, timestampToDate } from "@/lib/format/proto"
import { cn } from "@/lib/utils"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"

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
      return "bg-primary-muted/70"
  }
}

type SessionRailProps = {
  onNavigate?: () => void
  onOpenSearch: () => void
}

export function SessionRail({ onNavigate, onOpenSearch }: SessionRailProps) {
  const { openProjectPicker } = useWorkspaceShell()
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

  const groupedSessions = useMemo(() => {
    const sorted = [...(sessions ?? [])]
      .sort((left, right) => {
        const leftDate = timestampToDate(left.updatedAt)
        const rightDate = timestampToDate(right.updatedAt)
        return sessionWeight(rightDate) - sessionWeight(leftDate)
      })
      .slice(0, 30)

    const groups: { projectId: string; projectName: string; sessions: typeof sorted }[] = []
    const groupMap = new Map<string, typeof groups[number]>()

    for (const session of sorted) {
      const pid = session.project?.id || ""
      const pname = session.project?.name || "Unassigned"
      let group = groupMap.get(pid)
      if (!group) {
        group = { projectId: pid, projectName: pname, sessions: [] }
        groupMap.set(pid, group)
        groups.push(group)
      }
      group.sessions.push(session)
    }

    return groups
  }, [sessions])

  return (
    <div className="flex h-full flex-col bg-sidebar text-foreground">
      <div className="px-3 pb-2 pt-3">
        <button
          type="button"
          className="group flex w-full items-center justify-between rounded-md px-2 py-1.5 text-left transition hover:bg-accent"
        >
          <div className="flex min-w-0 items-center gap-2">
            <div className="flex size-5 shrink-0 items-center justify-center rounded bg-emerald-900/50 text-xs">
              🌿
            </div>
            <span className="truncate text-sm font-semibold text-foreground">
              {workspaceName}
            </span>
          </div>
          <ChevronDown className="size-3.5 text-muted-foreground" />
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
          className="flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-muted-foreground"
        >
          <Search className="size-3.5 shrink-0" />
          <span className="flex-1 text-left">Search</span>
          <span className="workspace-kbd">⌘K</span>
        </button>
        <RailAction icon={Grid2x2} label="Skills & Apps" />
      </div>

      <div className="mx-3 mb-1 h-px bg-border" />

      <div className="flex items-center justify-between px-3 pb-1 pt-2">
        <button
          type="button"
          className="flex items-center gap-1.5 rounded text-xs font-semibold uppercase tracking-wider text-muted-foreground transition hover:text-muted-foreground"
        >
          <FolderOpen className="size-3" />
          <span>Threads</span>
        </button>
        <div className="flex items-center gap-0.5">
          <ThreadHeaderButton onClick={onNavigate} title="New thread" to="/">
            <SquarePen className="size-3" />
          </ThreadHeaderButton>
          <ThreadHeaderButton title="Sort">
            <ArrowUpDown className="size-3" />
          </ThreadHeaderButton>
          <ThreadHeaderButton
            title="Add new project"
            onClick={() => {
              onNavigate?.()
              openProjectPicker()
            }}
          >
            <FolderPlus className="size-3" />
          </ThreadHeaderButton>
        </div>
      </div>

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-2 pb-3">
        {isLoading ? (
          <div className="px-3 py-3 text-xs text-muted-foreground">
            Loading threads...
          </div>
        ) : null}

        {isError ? (
          <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
            The shell is ready. Session data will appear when the backend responds.
          </div>
        ) : null}

        {!isLoading && !isError && groupedSessions.length === 0 ? (
          <div className="px-3 py-3 text-xs leading-5 text-muted-foreground">
            No threads yet. Open a repo and continue from the same workspace.
          </div>
        ) : null}

        {groupedSessions.map((group) => (
          <div key={group.projectId} className="mt-2 first:mt-1">
            <div className="mb-0.5 px-3 text-[11px] font-medium uppercase tracking-wider text-muted-foreground/70">
              {group.projectName}
            </div>
            <div className="border-l border-border pl-3">
              {group.sessions.map((session) => {
                const updatedAt = timestampToDate(session.updatedAt)
                const status = formatSessionStatus(session.status).toLowerCase()

                return (
                  <NavLink
                    key={session.id}
                    to={`/sessions/${session.id}`}
                    onClick={onNavigate}
                    className={({ isActive }) =>
                      cn(
                        "mb-0.5 flex items-center gap-2.5 rounded-lg px-3 py-2 text-left transition",
                        isActive
                          ? "bg-accent text-foreground"
                          : "text-foreground/80 hover:bg-muted"
                      )
                    }
                  >
                    {({ isActive }) => (
                      <>
                        <span
                          className={cn("size-1.5 shrink-0 rounded-full", sessionDot(status))}
                        />
                        <span
                          className={cn(
                            "min-w-0 flex-1 truncate text-sm",
                            isActive ? "font-medium" : ""
                          )}
                        >
                          {session.title || "Untitled thread"}
                        </span>
                        <span className="shrink-0 text-xs text-muted-foreground">
                          {formatRelativeTime(updatedAt)}
                        </span>
                      </>
                    )}
                  </NavLink>
                )
              })}
            </div>
          </div>
        ))}
      </div>

      <div className="border-t border-border px-3 py-2">
        <Link
          to="/settings"
          onClick={onNavigate}
          className="flex w-full items-center gap-2.5 rounded-md px-2.5 py-2 text-sm text-muted-foreground transition hover:bg-accent hover:text-muted-foreground"
        >
          <Settings className="size-3.5" />
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
    "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-sm transition",
    active
      ? "border border-ws-border-strong bg-secondary text-foreground"
      : "text-muted-foreground hover:bg-accent"
  )

  const content = (
    <>
      <Icon className="size-3.5 shrink-0 text-muted-foreground" />
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
    "flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-muted-foreground"

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
