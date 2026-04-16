import { useMemo } from "react"
import { MessageSquarePlus, Search, Settings } from "lucide-react"
import { Link, NavLink, useLocation } from "react-router-dom"

import { useProjects } from "@/features/projects/use-projects"
import { useSessions } from "@/features/sessions/use-sessions"
import { formatSessionStatus, timestampToDate } from "@/lib/format/proto"
import { cn } from "@/lib/utils"

/* ------------------------------------------------------------------ */
/*  Helpers                                                            */
/* ------------------------------------------------------------------ */

function formatRelativeTime(date?: Date) {
  if (!date) return ""
  const diffMs = Date.now() - date.getTime()
  const diffMinutes = Math.floor(diffMs / 60_000)
  if (diffMinutes < 1) return "just now"
  if (diffMinutes < 60) return `${diffMinutes}m`
  const diffHours = Math.floor(diffMinutes / 60)
  if (diffHours < 24) return `${diffHours}h`
  return `${Math.floor(diffHours / 24)}d`
}

function sessionWeight(updatedAt?: Date) {
  return updatedAt?.getTime() ?? 0
}

function statusIndicator(status: string) {
  switch (status.toLowerCase()) {
    case "running":
      return "bg-emerald-400"
    case "completed":
      return "bg-[var(--workspace-text-muted)]"
    case "waiting for input":
    case "waiting for approval":
      return "bg-amber-400"
    case "failed":
      return "bg-red-400"
    default:
      return "bg-[var(--workspace-text-disabled)]"
  }
}

function projectLabel(rootPath?: string, fallbackName?: string) {
  const normalized = rootPath?.trim()
  if (normalized) {
    const segments = normalized.split(/[/\\]+/).filter(Boolean)
    const last = segments.at(-1)
    if (last) return last
  }
  return fallbackName || "Untitled"
}

/* ------------------------------------------------------------------ */
/*  SessionRail                                                        */
/* ------------------------------------------------------------------ */

type SessionRailProps = {
  onNavigate?: () => void
  onOpenSearch: () => void
}

export function SessionRail({ onNavigate, onOpenSearch }: SessionRailProps) {
  const location = useLocation()
  const { data: projects } = useProjects()
  const { data: sessions, isError, isLoading } = useSessions()

  const activeSessionId = useMemo(() => {
    return location.pathname.startsWith("/sessions/")
      ? location.pathname.slice("/sessions/".length)
      : ""
  }, [location.pathname])

  const activeSession = useMemo(() => {
    return (sessions ?? []).find((s) => s.id === activeSessionId)
  }, [activeSessionId, sessions])

  const workspaceName =
    activeSession?.project?.name ||
    projects?.[0]?.name ||
    sessions?.[0]?.project?.name ||
    "orchd"

  const visibleSessions = useMemo(() => {
    const projectId = activeSession?.project?.id || projects?.[0]?.id
    const filtered = (sessions ?? []).filter((s) =>
      projectId ? s.project?.id === projectId : true
    )
    return [...filtered]
      .sort((a, b) => {
        return sessionWeight(timestampToDate(b.updatedAt)) - sessionWeight(timestampToDate(a.updatedAt))
      })
      .slice(0, 20)
  }, [activeSession?.project?.id, projects, sessions])

  return (
    <nav className="flex h-full flex-col font-mono text-[var(--workspace-text-primary)]">
      {/* ── Header ─────────────────────────────────────────────── */}
      <div className="flex items-center gap-2 px-4 pb-1 pt-4">
        <div className="flex size-6 shrink-0 items-center justify-center rounded bg-emerald-600/20 text-[11px] font-semibold text-emerald-400">
          o
        </div>
        <span className="truncate text-[13px] font-medium tracking-tight text-[var(--workspace-text-primary)]">
          {workspaceName}
        </span>
      </div>

      {/* ── Quick actions ──────────────────────────────────────── */}
      <div className="flex flex-col gap-0.5 px-2 pt-3">
        <SidebarButton
          active={location.pathname === "/"}
          icon={<MessageSquarePlus className="size-4" />}
          label="New thread"
          onClick={onNavigate}
          to="/"
        />
        <SidebarButton
          icon={<Search className="size-4" />}
          label="Search"
          kbd="⌘K"
          onClick={onOpenSearch}
        />
      </div>

      {/* ── Section label ──────────────────────────────────────── */}
      <div className="px-4 pb-1 pt-4">
        <span className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--workspace-text-muted)]">
          Recents
        </span>
      </div>

      {/* ── Thread list ────────────────────────────────────────── */}
      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto px-2">
        {isLoading ? (
          <p className="px-2 py-4 text-[12px] text-[var(--workspace-text-muted)]">
            Loading…
          </p>
        ) : null}

        {isError ? (
          <p className="px-2 py-4 text-[12px] leading-relaxed text-[var(--workspace-text-muted)]">
            Waiting for backend.
          </p>
        ) : null}

        {!isLoading && !isError && visibleSessions.length === 0 ? (
          <p className="px-2 py-4 text-[12px] leading-relaxed text-[var(--workspace-text-muted)]">
            No threads yet.
          </p>
        ) : null}

        {visibleSessions.map((session) => {
          const updatedAt = timestampToDate(session.updatedAt)
          const status = formatSessionStatus(session.status)
          const label = projectLabel(session.project?.rootPath, session.project?.name)

          return (
            <NavLink
              key={session.id}
              to={`/sessions/${session.id}`}
              onClick={onNavigate}
              className={({ isActive }) =>
                cn(
                  "group mb-px flex items-start gap-2.5 rounded-md px-2.5 py-2 text-left transition-colors",
                  isActive
                    ? "bg-[var(--workspace-hover-bg)] text-[var(--workspace-text-primary)]"
                    : "text-[var(--workspace-text-secondary)] hover:bg-[var(--workspace-hover-bg-soft)] hover:text-[var(--workspace-text-primary)]"
                )
              }
            >
              {({ isActive }) => (
                <>
                  <span
                    className={cn(
                      "mt-[5px] size-[6px] shrink-0 rounded-full",
                      statusIndicator(status)
                    )}
                  />
                  <div className="min-w-0 flex-1">
                    <p
                      className={cn(
                        "truncate text-[13px] leading-5",
                        isActive ? "font-medium" : "font-normal"
                      )}
                    >
                      {session.title || "Untitled"}
                    </p>
                    <div className="mt-0.5 flex items-center gap-1.5 text-[11px] text-[var(--workspace-text-muted)]">
                      <span className="truncate">{label}</span>
                      <span className="shrink-0">·</span>
                      <span className="shrink-0">{formatRelativeTime(updatedAt)}</span>
                    </div>
                  </div>
                </>
              )}
            </NavLink>
          )
        })}
      </div>

      {/* ── Footer ─────────────────────────────────────────────── */}
      <div className="border-t border-[color:var(--workspace-border)] px-2 py-2">
        <SidebarButton
          icon={<Settings className="size-4" />}
          label="Settings"
          onClick={onNavigate}
          to="/settings"
        />
      </div>
    </nav>
  )
}

/* ------------------------------------------------------------------ */
/*  SidebarButton                                                      */
/* ------------------------------------------------------------------ */

function SidebarButton({
  active = false,
  icon,
  kbd,
  label,
  onClick,
  to,
}: {
  active?: boolean
  icon: React.ReactNode
  kbd?: string
  label: string
  onClick?: () => void
  to?: string
}) {
  const cls = cn(
    "flex w-full items-center gap-2.5 rounded-md px-2.5 py-1.5 text-[13px] transition-colors",
    active
      ? "bg-[var(--workspace-hover-bg)] font-medium text-[var(--workspace-text-primary)]"
      : "text-[var(--workspace-text-secondary)] hover:bg-[var(--workspace-hover-bg-soft)] hover:text-[var(--workspace-text-primary)]"
  )

  const inner = (
    <>
      <span className="shrink-0 text-[var(--workspace-text-muted)]">{icon}</span>
      <span className="flex-1 text-left">{label}</span>
      {kbd ? <span className="workspace-kbd">{kbd}</span> : null}
    </>
  )

  if (to) {
    return (
      <Link to={to} onClick={onClick} className={cls}>
        {inner}
      </Link>
    )
  }

  return (
    <button type="button" onClick={onClick} className={cls}>
      {inner}
    </button>
  )
}
