import { useMemo, useState } from "react"
import { FolderGit2, Grid2x2, Search, Settings, SquarePen } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { Dialog, DialogContent } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { useProjects } from "@/features/projects/use-projects"
import { useSessions } from "@/features/sessions/use-sessions"
import { formatSessionStatus } from "@/lib/format/proto"

import { useWorkspaceShell } from "./shell-context"

type SearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { openProjectPicker } = useWorkspaceShell()
  const navigate = useNavigate()
  const { data: projects } = useProjects()
  const { data: sessions } = useSessions()
  const [query, setQuery] = useState("")

  const normalized = query.trim().toLowerCase()

  const filtered = useMemo(() => {
    const filteredProjects = (projects ?? []).filter((project) =>
      !normalized ? true : project.name.toLowerCase().includes(normalized)
    )
    const filteredSessions = (sessions ?? []).filter((session) => {
      const projectName = session.project?.name?.toLowerCase() ?? ""
      const title = session.title.toLowerCase()
      return (
        !normalized ||
        title.includes(normalized) ||
        projectName.includes(normalized)
      )
    })

    return {
      projects: filteredProjects.slice(0, 6),
      sessions: filteredSessions.slice(0, 8),
    }
  }, [normalized, projects, sessions])

  function closeAndNavigate(path: string) {
    onOpenChange(false)
    setQuery("")
    navigate(path)
  }

  function closeAndOpenProjectPicker() {
    onOpenChange(false)
    setQuery("")
    openProjectPicker()
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent
        showCloseButton={false}
        className="max-w-[680px] gap-0 overflow-hidden rounded-2xl border border-border bg-popover p-0 text-foreground ring-0"
      >
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="size-4 text-muted-foreground" />
          <Input
            autoFocus
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search threads, projects, and actions"
            className="h-auto border-0 bg-transparent px-0 py-0 text-base font-medium text-foreground shadow-none focus-visible:ring-0"
          />
          <span className="rounded-md border border-border bg-secondary px-1.5 py-px text-[10px] leading-snug text-muted-foreground">
            esc
          </span>
        </div>

        <div className="max-h-[560px] overflow-y-auto p-3 text-sm text-foreground">
          {!normalized ? (
            <div className="space-y-2">
              <SectionLabel>Quick actions</SectionLabel>
              <ActionRow
                icon={SquarePen}
                label="New thread"
                detail="Return to the composer"
                onClick={() => closeAndNavigate("/")}
              />
              <ActionRow
                icon={FolderGit2}
                label="Add repo"
                detail="Open the host-backed repo picker"
                onClick={closeAndOpenProjectPicker}
              />
              <ActionRow
                icon={Settings}
                label="Settings"
                detail="Open workspace settings"
                onClick={() => closeAndNavigate("/settings")}
              />
              <ActionRow
                icon={Grid2x2}
                label="Skills & Apps"
                detail="Open plugins"
                onClick={() => closeAndNavigate("/plugins")}
              />
            </div>
          ) : null}

          {filtered.sessions.length > 0 ? (
            <div className="mt-3 space-y-2">
              <SectionLabel>Threads</SectionLabel>
              {filtered.sessions.map((session) => (
                <button
                  key={session.id}
                  type="button"
                  onClick={() => closeAndNavigate(`/sessions/${session.id}`)}
                  className="flex w-full items-start justify-between rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-border hover:bg-accent"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{session.title}</div>
                    <div className="mt-1 text-muted-foreground">
                      {session.project?.name || "Local"} ·{" "}
                      {formatSessionStatus(session.status)}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {filtered.projects.length > 0 ? (
            <div className="mt-3 space-y-2">
              <SectionLabel>Projects</SectionLabel>
              {filtered.projects.map((project) => (
                <button
                  key={project.id}
                  type="button"
                  onClick={() => closeAndNavigate("/")}
                  className="flex w-full items-start justify-between rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-border hover:bg-accent"
                >
                  <div className="min-w-0">
                    <div className="truncate font-medium">{project.name}</div>
                    <div className="mt-1 truncate text-muted-foreground">
                      {project.rootPath}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          ) : null}

          {normalized &&
          filtered.sessions.length === 0 &&
          filtered.projects.length === 0 ? (
            <div className="px-3 py-6 text-muted-foreground">
              No matches. Try a thread title, project name, or "settings".
            </div>
          ) : null}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-3 tracking-wider text-muted-foreground uppercase">
      {children}
    </div>
  )
}

function ActionRow({
  detail,
  icon: Icon,
  label,
  onClick,
}: {
  detail: string
  icon: typeof Search
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-border hover:bg-accent"
    >
      <Icon className="mt-0.5 size-4 text-muted-foreground" />
      <div>
        <div className="text-foreground">{label}</div>
        <div className="mt-1 text-muted-foreground">{detail}</div>
      </div>
    </button>
  )
}
