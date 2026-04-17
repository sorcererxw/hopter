import { Fragment, useMemo, useState, type ReactNode } from "react"
import {
  ChevronDown,
  FolderOpen,
  FolderPlus,
  Grid2x2,
  LoaderCircle,
  Search,
  Settings,
  SquarePen,
} from "lucide-react"
import { Link, NavLink, useNavigate } from "react-router-dom"

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
    return "now"
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
  const { eventStreamState, openProjectPicker } = useWorkspaceShell()
  const navigate = useNavigate()
  const { data: sessions, isError, isLoading } = useSessions(
    undefined,
    eventStreamState === "connected" ? 10_000 : 3_000
  )
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<
    Record<string, boolean>
  >({})
  const [projectsCollapsed, setProjectsCollapsed] = useState(false)

  const groupedSessions = useMemo(() => {
    const sorted = [...(sessions ?? [])]
      .sort((left, right) => {
        const leftDate = timestampToDate(left.updatedAt)
        const rightDate = timestampToDate(right.updatedAt)
        return sessionWeight(rightDate) - sessionWeight(leftDate)
      })
      .slice(0, 30)

    const groups: {
      projectId: string
      projectName: string
      projectRootPath: string
      sessions: typeof sorted
    }[] = []
    const groupMap = new Map<string, (typeof groups)[number]>()

    for (const session of sorted) {
      const pid = session.project?.id || ""
      const pname = session.project?.name || "Unassigned"
      const rootPath = session.project?.rootPath || ""
      let group = groupMap.get(pid)
      if (!group) {
        group = {
          projectId: pid,
          projectName: pname,
          projectRootPath: rootPath,
          sessions: [],
        }
        groupMap.set(pid, group)
        groups.push(group)
      }
      if (!group.projectRootPath && rootPath) {
        group.projectRootPath = rootPath
      }
      group.sessions.push(session)
    }

    return groups
  }, [sessions])

  return (
    <div
      className="flex h-full flex-col bg-sidebar text-base text-foreground"
      data-testid="session-rail"
    >
      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-2 py-1.5">
        <ul data-rail-list="true" className="flex min-h-full flex-col gap-1">
          <li>
            <RailRow
              icon={<SquarePen className="size-3.5" />}
              label="New chat"
              onClick={onNavigate}
              to="/"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
            />
          </li>
          <li>
            <RailRow
              icon={<Search className="size-3.5" />}
              label="Search"
              onClick={onOpenSearch}
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
              right={
                <span className="workspace-kbd text-base opacity-0 transition-opacity duration-150 group-focus-within:opacity-100 group-hover:opacity-100">
                  ⌘K
                </span>
              }
            />
          </li>
          <li>
            <RailRow
              icon={<Grid2x2 className="size-3.5" />}
              label="Skills & Apps"
              interactive
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
            />
          </li>
          <li>
            <RailRow
              icon={<FolderPlus className="size-3.5" />}
              label="New project"
              onClick={() => {
                onNavigate?.()
                openProjectPicker()
              }}
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
            />
          </li>
          <li>
            <RailRow
              icon={<Settings className="size-3.5" />}
              label="Settings"
              onClick={onNavigate}
              to="/settings"
              className="text-muted-foreground hover:bg-accent hover:text-foreground"
            />
          </li>

          <li className="h-3" aria-hidden="true" />

          <li>
            <RailRow
              icon={null}
              label="Projects"
              onClick={() => setProjectsCollapsed((current) => !current)}
              asDivInteractive
              reserveIconSpace={false}
              labelFill={false}
              labelClassName="select-none text-sm font-medium tracking-tight text-muted-foreground/80 uppercase"
              className="text-sm text-muted-foreground"
              right={
                <ChevronDown
                  className={cn(
                    "size-3 transition-transform",
                    projectsCollapsed ? "-rotate-90" : "rotate-0"
                  )}
                />
              }
            />
          </li>

          {isLoading ? (
            <li>
              <RailRow
                icon={null}
                label="Loading threads..."
                labelClassName="text-sm text-muted-foreground"
              />
            </li>
          ) : null}

          {isError ? (
            <li>
              <RailRow
                icon={null}
                label="The shell is ready. Session data will appear when the backend responds."
                labelClassName="text-sm text-muted-foreground"
              />
            </li>
          ) : null}

          {!isLoading && !isError && groupedSessions.length === 0 ? (
            <li>
              <RailRow
                icon={null}
                label="No threads yet. Open a repo and continue from the same workspace."
                labelClassName="text-sm text-muted-foreground"
              />
            </li>
          ) : null}

          {projectsCollapsed
            ? null
            : groupedSessions.map((group) => (
                <Fragment key={group.projectId || group.projectName}>
                  <li>
                    <RailRow
                      asDivInteractive
                      icon={<FolderOpen className="size-3.5" />}
                      label={group.projectName}
                      title={group.projectRootPath || group.projectName}
                      onClick={() =>
                        setCollapsedProjectIds((current) => ({
                          ...current,
                          [group.projectId || group.projectName]:
                            !current[group.projectId || group.projectName],
                        }))
                      }
                      right={
                        <button
                          type="button"
                          title={`New thread in ${group.projectName}`}
                          className="flex size-5 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-foreground"
                          onClick={(event) => {
                            event.stopPropagation()
                            onNavigate?.()
                            navigate({
                              pathname: "/",
                              search: group.projectId
                                ? `?projectId=${encodeURIComponent(group.projectId)}`
                                : "",
                            })
                          }}
                        >
                          <SquarePen className="size-3" />
                        </button>
                      }
                      rightClassName="opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100"
                      labelClassName="truncate whitespace-nowrap text-sm font-medium tracking-tight text-foreground/80 uppercase"
                      className="text-sm hover:bg-accent/60 hover:text-foreground"
                      ariaExpanded={
                        !collapsedProjectIds[
                          group.projectId || group.projectName
                        ]
                      }
                    />
                  </li>
                  {collapsedProjectIds[group.projectId || group.projectName]
                    ? null
                    : group.sessions.map((session) => {
                        const updatedAt = timestampToDate(session.updatedAt)
                        const status = formatSessionStatus(
                          session.status
                        ).toLowerCase()

                        return (
                          <li key={session.id}>
                            <RailRow
                              icon={
                                status === "running" ? (
                                  <LoaderCircle className="size-3.5 animate-spin text-muted-foreground" />
                                ) : (
                                  <span
                                    className={cn(
                                      "size-1.5 rounded-full",
                                      sessionDot(status)
                                    )}
                                  />
                                )
                              }
                              label={session.title || "Untitled thread"}
                              onClick={onNavigate}
                              to={`/sessions/${session.id}`}
                              labelClassName="truncate"
                              right={
                                <span className="text-sm text-muted-foreground">
                                  {formatRelativeTime(updatedAt)}
                                </span>
                              }
                              className="text-sm text-foreground/80 hover:bg-muted hover:text-foreground"
                              activeClassName="bg-accent text-foreground"
                              nav
                            />
                          </li>
                        )
                      })}
                </Fragment>
              ))}
        </ul>
      </div>
    </div>
  )
}

function RailRow({
  activeClassName,
  ariaExpanded,
  asDivInteractive = false,
  className,
  fullWidth = true,
  icon,
  interactive = false,
  label,
  labelFill = true,
  labelClassName,
  nav = false,
  onClick,
  right,
  rightClassName,
  reserveIconSpace = true,
  title,
  to,
}: {
  activeClassName?: string
  ariaExpanded?: boolean
  asDivInteractive?: boolean
  className?: string
  fullWidth?: boolean
  icon: ReactNode
  interactive?: boolean
  label: ReactNode
  labelFill?: boolean
  labelClassName?: string
  nav?: boolean
  onClick?: () => void
  right?: ReactNode
  rightClassName?: string
  reserveIconSpace?: boolean
  title?: string
  to?: string
}) {
  const isInteractive =
    interactive || Boolean(to || onClick || ariaExpanded !== undefined)
  const rowClassName = cn(
    "group flex items-center gap-2.5 rounded-md px-3 py-1 text-left text-base leading-5 transition",
    fullWidth ? "w-full" : "w-fit",
    isInteractive ? "cursor-pointer" : undefined,
    className
  )

  const content = (currentIcon: ReactNode) => (
    <>
      {reserveIconSpace ? (
        <span className="flex size-5 shrink-0 items-center justify-center text-muted-foreground">
          {currentIcon}
        </span>
      ) : null}
      <span
        className={cn(
          "min-w-0",
          labelFill ? "flex-1" : "shrink-0",
          labelClassName
        )}
      >
        {label}
      </span>
      {right ? (
        <span className={cn("shrink-0", rightClassName)}>{right}</span>
      ) : null}
    </>
  )

  if (to && nav) {
    return (
      <NavLink
        to={to}
        onClick={onClick}
        title={title}
        data-rail-row="true"
        className={({ isActive }) =>
          cn(rowClassName, isActive ? activeClassName : undefined)
        }
      >
        {content(icon)}
      </NavLink>
    )
  }

  if (to) {
    return (
      <Link
        to={to}
        onClick={onClick}
        title={title}
        data-rail-row="true"
        className={rowClassName}
      >
        {content(icon)}
      </Link>
    )
  }

  if (asDivInteractive && onClick) {
    return (
      <div
        role="button"
        tabIndex={0}
        data-rail-row="true"
        className={rowClassName}
        onClick={onClick}
        onKeyDown={(event) => {
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault()
            onClick()
          }
        }}
      >
        {content(icon)}
      </div>
    )
  }

  if (onClick || ariaExpanded !== undefined) {
    return (
      <button
        type="button"
        onClick={onClick}
        title={title}
        aria-expanded={ariaExpanded}
        data-rail-row="true"
        className={rowClassName}
      >
        {content(icon)}
      </button>
    )
  }

  return (
    <div data-rail-row="true" className={rowClassName}>
      {content(icon)}
    </div>
  )
}
