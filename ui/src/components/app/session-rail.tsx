import { useMemo } from "react"
import {
  Cloud,
  Folder,
  FolderOpen,
  Grid2x2,
  Search,
  Settings,
  Sparkles,
  SquarePen,
  Workflow,
} from "lucide-react"
import { Link, NavLink } from "react-router-dom"

import { useHostStatus } from "@/features/host/use-host-status"
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
    return "刚刚"
  }

  if (diffMinutes < 60) {
    return `${diffMinutes} 分钟`
  }

  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) {
    return `${diffHours} 小时`
  }

  const diffDays = Math.floor(diffHours / 24)
  if (diffDays < 30) {
    return `${diffDays} 天`
  }

  const diffMonths = Math.floor(diffDays / 30)
  return `${diffMonths} 月`
}

function groupWeight(updatedAt?: Date) {
  if (!updatedAt) {
    return 0
  }

  return updatedAt.getTime()
}

export function SessionRail() {
  const { data: hostStatus } = useHostStatus()
  const { data: projects } = useProjects()
  const { data: sessions, isError, isLoading } = useSessions()

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
      const projectName = session.project?.name || "未分配项目"
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

  return (
    <div className="flex h-full flex-col text-sidebar-foreground">
      <div className="space-y-0.5 px-3 pt-4 pb-2">
        <RailAction icon={SquarePen} label="Quick chat" to="/" />
        <RailAction icon={Search} label="Search" />
        <RailAction icon={Grid2x2} label="技能和应用" />
        <RailAction icon={Workflow} label="自动化" />
      </div>

      <div className="mx-3 my-1 h-px bg-white/6" />

      <div className="flex items-center justify-between px-4 py-3">
        <span className="text-[11px] uppercase tracking-[0.16em] text-[#6e6e6e]">
          线程
        </span>
        <Link
          to="/"
          className="rounded-md px-2 py-1 text-[12px] text-[#949494] transition hover:bg-white/6 hover:text-white"
        >
          新建
        </Link>
      </div>

      <div className="flex min-h-0 flex-1 flex-col overflow-hidden px-2 pb-3">
        <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto pr-1" data-testid="session-list">
          {isLoading ? (
            <div className="space-y-3 px-2 py-4 text-sm text-[#747474]">
              <div className="rounded-lg border border-white/6 bg-white/4 px-3 py-2">
                正在加载线程…
              </div>
            </div>
          ) : null}

          {isError ? (
            <div className="px-2 py-4 text-sm text-[#8a8a8a]">
              后端还没有返回会话列表，外壳已经就绪。
            </div>
          ) : null}

          {!isLoading && !isError && groups.length === 0 ? (
            <div className="px-2 py-4 text-sm text-[#8a8a8a]">
              还没有线程。打开一个项目后，就可以从这里继续会话。
            </div>
          ) : null}

          <div className="space-y-3">
            {groups.map((group) => (
              <div key={group.id} className="space-y-1">
                <div className="flex items-center gap-2 px-3 py-1 text-[12px] text-[#828282]">
                  {group.sessions.length > 0 ? (
                    <FolderOpen className="size-3.5" />
                  ) : (
                    <Folder className="size-3.5" />
                  )}
                  <span className="truncate">{group.name}</span>
                </div>

                {group.sessions.length > 0 ? (
                  <div className="ml-4 border-l border-white/8 pl-3">
                    {group.sessions.map((session) => {
                      const updatedAt = timestampToDate(session.updatedAt)

                      return (
                        <NavLink
                          key={session.id}
                          to={`/sessions/${session.id}`}
                          className={({ isActive }) =>
                            cn(
                              "mb-1 flex items-center justify-between gap-3 rounded-xl px-3 py-2 text-left transition",
                              isActive
                                ? "bg-white/8 text-white"
                                : "text-[#d0d0d0] hover:bg-white/6 hover:text-white"
                            )
                          }
                        >
                          {({ isActive }) => (
                            <>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[13px] font-medium leading-5">
                                  {session.title || "Untitled session"}
                                </p>
                                <p
                                  className={cn(
                                    "truncate text-[11px] leading-4",
                                    isActive ? "text-[#c0c0c0]" : "text-[#808080]"
                                  )}
                                >
                                  {formatSessionStatus(session.status)}
                                </p>
                              </div>

                              <div className="flex shrink-0 items-center gap-2 text-[12px]">
                                <Cloud
                                  className={cn(
                                    "size-3.5",
                                    session.attentionRequired
                                      ? "text-amber-300"
                                      : isActive
                                        ? "text-[#d8d8d8]"
                                        : "text-[#777]"
                                  )}
                                />
                                <span className={isActive ? "text-[#d2d2d2]" : "text-[#8a8a8a]"}>
                                  {formatRelativeTime(updatedAt)}
                                </span>
                              </div>
                            </>
                          )}
                        </NavLink>
                      )
                    })}
                  </div>
                ) : (
                  <div className="ml-4 border-l border-white/8 px-3 py-2 text-[12px] text-[#6f6f6f]">
                    暂无线程
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="border-t border-white/6 px-3 py-3">
        <div className="flex items-center justify-between gap-3">
          <Link
            to="/settings"
            className="inline-flex items-center gap-2 rounded-md px-2.5 py-2 text-[13px] text-[#9a9a9a] transition hover:bg-white/6 hover:text-white"
          >
            <Settings className="size-4" />
            设置
          </Link>

          <div className="inline-flex items-center gap-2 rounded-full border border-white/8 bg-white/5 px-3 py-1.5 text-[11px] text-[#8c8c8c]">
            <Sparkles className="size-3.5 text-[#bcbcbc]" />
            {hostStatus ? `${hostStatus.projectCount} 项目` : "本地工作区"}
          </div>
        </div>
      </div>
    </div>
  )
}

function RailAction({
  icon: Icon,
  label,
  to,
}: {
  icon: typeof Search
  label: string
  to?: string
}) {
  const classes =
    "flex w-full items-center gap-3 rounded-md px-2.5 py-2.5 text-[15px] text-[#d0d0d0] transition hover:bg-white/6 hover:text-white"

  if (to) {
    return (
      <NavLink to={to} end className={({ isActive }) => cn(classes, isActive && "bg-white/6 text-white")}>
        <Icon className="size-4 text-[#8a8a8a]" />
        <span>{label}</span>
      </NavLink>
    )
  }

  return (
    <button type="button" className={classes}>
      <Icon className="size-4 text-[#8a8a8a]" />
      <span>{label}</span>
    </button>
  )
}
