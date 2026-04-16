import { useEffect, useMemo, useState, type ReactNode } from "react"
import {
  ArrowUpDown,
  ChevronDown,
  ChevronRight,
  Filter,
  Folder,
  FolderOpen,
  Grid2x2,
  Plus,
  Search,
  Settings,
  SquarePen,
} from "lucide-react"
import { Link, NavLink } from "react-router-dom"

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

function groupWeight(updatedAt?: Date) {
  if (!updatedAt) {
    return 0
  }

  return updatedAt.getTime()
}

function syntheticProjectPath(projectID: string) {
  if (!projectID.startsWith("cwd:")) {
    return ""
  }

  return projectID.slice(4)
}

function disambiguateProjectLabel(projectID: string, projectName: string, duplicateNames: Set<string>) {
  if (!duplicateNames.has(projectName)) {
    return projectName
  }

  const rawPath = syntheticProjectPath(projectID)
  if (!rawPath) {
    return projectName
  }

  const parts = rawPath.split(/[\\/]/).filter(Boolean)
  if (parts.length === 0) {
    return projectName
  }

  const genericNames = new Set(["repo", "app", "ui", "src", "project", "workspace", "tmp"])
  let segmentCount = 2
  if (parts.length >= 3 && genericNames.has(parts[parts.length - 2])) {
    segmentCount = 3
  }

  return parts.slice(-Math.min(segmentCount, parts.length)).join("/")
}

export function SessionRail({ onOpenSearch }: { onOpenSearch: () => void }) {
  const { data: projects } = useProjects()
  const { data: sessions, isError, isLoading } = useSessions()
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({})

  const groups = useMemo(() => {
    const map = new Map<
      string,
      { id: string; name: string; sessions: NonNullable<typeof sessions>[number][] }
    >()

    for (const project of projects ?? []) {
      map.set(project.id, { id: project.id, name: project.name, sessions: [] })
    }

    for (const session of sessions ?? []) {
      const projectId = session.project?.id || "unassigned"
      const projectName = session.project?.name || "Unassigned"
      const group = map.get(projectId) ?? {
        id: projectId,
        name: projectName,
        sessions: [],
      }

      group.sessions.push(session)
      map.set(projectId, group)
    }

    return [...map.values()]
      .map((group) => ({
        ...group,
        sessions: [...group.sessions].sort((left, right) => {
          const leftDate = timestampToDate(left.updatedAt)
          const rightDate = timestampToDate(right.updatedAt)
          return groupWeight(rightDate) - groupWeight(leftDate)
        }),
      }))
      .sort((left, right) => {
        const leftLatest = left.sessions[0]
          ? groupWeight(timestampToDate(left.sessions[0].updatedAt))
          : 0
        const rightLatest = right.sessions[0]
          ? groupWeight(timestampToDate(right.sessions[0].updatedAt))
          : 0
        return rightLatest - leftLatest
      })
  }, [projects, sessions])

  useEffect(() => {
    setCollapsedGroups((current) => {
      const next = { ...current }
      for (const group of groups) {
        if (!(group.id in next)) {
          next[group.id] = false
        }
      }
      for (const groupID of Object.keys(next)) {
        if (!groups.some((group) => group.id === groupID)) {
          delete next[groupID]
        }
      }
      return next
    })
  }, [groups])

  const duplicateProjectNames = useMemo(() => {
    const counts = new Map<string, number>()
    for (const group of groups) {
      counts.set(group.name, (counts.get(group.name) ?? 0) + 1)
    }

    return new Set(
      [...counts.entries()]
        .filter(([, count]) => count > 1)
        .map(([name]) => name)
    )
  }, [groups])

  function toggleGroup(groupID: string) {
    setCollapsedGroups((current) => ({
      ...current,
      [groupID]: !current[groupID],
    }))
  }

  return (
    <div className="flex h-full flex-col bg-[#141414] text-[#c8c8c8]">
      <div className="space-y-0.5 px-3 pt-4 pb-2">
        <RailAction icon={SquarePen} label="Quick chat" to="/" />
        <RailAction icon={Search} label="Search" onClick={onOpenSearch} />
        <RailAction icon={Grid2x2} label="Skills & Apps" />
      </div>

      <div className="mx-3 my-1 h-px bg-white/6" />

      <div className="flex items-center justify-between px-3 py-2.5">
        <span className="text-[11px] uppercase tracking-[0.06em] text-[#555]">Threads</span>
        <div className="flex items-center gap-1">
          <ThreadHeaderButton to="/" title="New thread">
            <Plus className="size-[13px]" />
          </ThreadHeaderButton>
          <ThreadHeaderButton title="Sort">
            <ArrowUpDown className="size-3" />
          </ThreadHeaderButton>
          <ThreadHeaderButton title="Filter">
            <Filter className="size-3" />
          </ThreadHeaderButton>
        </div>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-1.5 pb-2">
        <div className="thin-scrollbar h-0 min-h-0 flex-1 overflow-y-auto overscroll-y-contain pr-1">
          {isLoading ? (
            <div className="px-3 py-3 text-[12px] text-[#555]">Loading threads…</div>
          ) : null}

          {isError ? (
            <div className="px-3 py-3 text-[12px] text-[#666]">
              The shell is ready. Session data will appear when the backend responds.
            </div>
          ) : null}

          {!isLoading && !isError && groups.length === 0 ? (
            <div className="px-3 py-3 text-[12px] leading-5 text-[#666]">
              No threads yet. Open a repo and continue from the same workspace.
            </div>
          ) : null}

          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.id}>
                <div className="flex items-center px-2.5 pb-1">
                  {(() => {
                    const displayName = disambiguateProjectLabel(
                      group.id,
                      group.name,
                      duplicateProjectNames
                    )
                    const rawPath = syntheticProjectPath(group.id)

                    return (
                  <button
                    type="button"
                    onClick={() => toggleGroup(group.id)}
                    title={rawPath || group.name}
                    className="flex flex-1 items-center gap-1.5 rounded-md px-2 py-1 text-left text-[12px] text-[#777] transition hover:bg-white/5"
                  >
                    {collapsedGroups[group.id] ? (
                      <ChevronRight className="size-3 shrink-0" />
                    ) : (
                      <ChevronDown className="size-3 shrink-0" />
                    )}
                    {group.sessions.length > 0 && !collapsedGroups[group.id] ? (
                      <FolderOpen className="size-3 shrink-0" />
                    ) : (
                      <Folder className="size-3 shrink-0" />
                    )}
                    <span className="truncate">{displayName}</span>
                  </button>
                    )
                  })()}
                </div>

                {group.sessions.length > 0 && !collapsedGroups[group.id] ? (
                  <div className="ml-4 border-l border-white/8 pl-3">
                    {group.sessions.map((session) => {
                      const updatedAt = timestampToDate(session.updatedAt)

                      return (
                        <NavLink
                          key={session.id}
                          to={`/sessions/${session.id}`}
                          className={({ isActive }) =>
                            cn(
                              "mb-1 flex items-start justify-between gap-2 rounded-md border px-3 py-2 transition",
                              isActive
                                ? "border-white/10 bg-white/10 text-[#f0f0f0]"
                                : "border-transparent text-[#aaa] hover:border-white/8 hover:bg-white/6"
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] leading-5">
                                  {session.title || "Untitled thread"}
                                </p>
                                <p
                                  className={cn(
                                    "truncate text-[11px] leading-4",
                                    isActive ? "text-[#888]" : "text-[#666]"
                                  )}
                                >
                                  {formatSessionStatus(session.status).toLowerCase()}
                                </p>
                              </div>

                              <span
                                className={cn(
                                  "mt-0.5 shrink-0 text-[11px]",
                                  isActive ? "text-[#777]" : "text-[#555]"
                                )}
                              >
                                {formatRelativeTime(updatedAt)}
                              </span>
                            </>
                          )}
                        </NavLink>
                      )
                    })}
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/6 px-3 py-3.5">
        <Link
          to="/settings"
          className="flex w-full items-center gap-2 rounded-md px-2.5 py-2 text-[13.5px] text-[#888] transition hover:bg-white/7 hover:text-[#bbb]"
        >
          <Settings className="size-[15px]" />
          <span>Settings</span>
        </Link>
      </div>
    </div>
  )
}

function RailAction({
  icon: Icon,
  label,
  onClick,
  to,
}: {
  icon: typeof Search
  label: string
  onClick?: () => void
  to?: string
}) {
  const classes =
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-2.5 text-[13.5px] text-[#c8c8c8] transition hover:bg-white/7"

  if (to) {
    return (
      <Link to={to} className={classes}>
        <Icon className="size-[15px] text-[#888]" />
        <span>{label}</span>
      </Link>
    )
  }

  return (
    <button type="button" className={classes} onClick={onClick}>
      <Icon className="size-[15px] text-[#888]" />
      <span>{label}</span>
    </button>
  )
}

function ThreadHeaderButton({
  children,
  title,
  to,
}: {
  children: ReactNode
  title: string
  to?: string
}) {
  const className =
    "flex size-6 items-center justify-center rounded-md text-[#555] transition hover:bg-white/7 hover:text-[#888]"

  if (to) {
    return (
      <Link to={to} className={className} title={title}>
        {children}
      </Link>
    )
  }

  return (
    <button type="button" className={className} title={title}>
      {children}
    </button>
  )
}
