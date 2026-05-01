import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { FolderGit2, Grid2x2, Search, Settings, SquarePen } from "@/components/icons/hugeicons"
import { useNavigate } from "react-router-dom"
import { Input, Modal } from "@heroui/react"

import { useProjects } from "@/features/projects/use-projects"
import { useSessions } from "@/features/sessions/use-sessions"
import { formatSessionStatus } from "@/lib/format/proto"

import { useWorkspaceShell } from "./shell-context"

type SearchDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
}

export function SearchDialog({ open, onOpenChange }: SearchDialogProps) {
  const { t } = useTranslation()
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
    <Modal isOpen={open} onOpenChange={onOpenChange}>
      <Modal.Backdrop variant="opaque">
        <Modal.Container size="cover">
          <Modal.Dialog className="max-w-[680px] gap-0 overflow-hidden rounded-2xl border border-border bg-overlay p-0 text-foreground ring-0">
            <div className="flex items-center gap-3 border-b border-border px-4 py-3">
              <Search className="size-4 text-muted" />
              <Input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t("search.placeholder")}
                className="h-auto border-0 bg-transparent px-0 py-0 text-base text-foreground shadow-none focus-visible:ring-0"
                fullWidth
                variant="secondary"
              />
              <span className="rounded-md border border-border bg-surface-secondary px-1.5 py-px text-[10px] leading-snug text-muted">
                <kbd>{"esc"}</kbd>
              </span>
            </div>

            <div className="max-h-[560px] overflow-y-auto p-3 text-sm text-foreground">
              {!normalized ? (
                <div className="space-y-2">
                  <SectionLabel>{t("search.quickActions")}</SectionLabel>
                  <ActionRow
                    icon={SquarePen}
                    label={t("search.newSession")}
                    detail={t("search.newSessionDetail")}
                    onClick={() => closeAndNavigate("/")}
                  />
                  <ActionRow
                    icon={FolderGit2}
                    label={t("search.addRepo")}
                    detail={t("search.addRepoDetail")}
                    onClick={closeAndOpenProjectPicker}
                  />
                  <ActionRow
                    icon={Settings}
                    label={t("search.settings")}
                    detail={t("search.openSettings")}
                    onClick={() => closeAndNavigate("/settings")}
                  />
                  <ActionRow
                    icon={Grid2x2}
                    label={t("search.skillsApps")}
                    detail={t("search.openPlugins")}
                    onClick={() => closeAndNavigate("/plugins")}
                  />
                </div>
              ) : null}

              {filtered.sessions.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <SectionLabel>{t("search.sessions")}</SectionLabel>
                  {filtered.sessions.map((session) => (
                    <button
                      key={session.id}
                      type="button"
                      onClick={() =>
                        closeAndNavigate(`/sessions/${session.id}`)
                      }
                      className="flex w-full items-start justify-between rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-border hover:bg-surface-tertiary"
                    >
                      <div className="min-w-0">
                        <div className="truncate">
                          {session.title}
                        </div>
                        <div className="mt-1 text-muted">
                          {session.project?.name || t("home.localProject")} ·{" "}
                          {formatSessionStatus(session.status)}
                        </div>
                      </div>
                    </button>
                  ))}
                </div>
              ) : null}

              {filtered.projects.length > 0 ? (
                <div className="mt-3 space-y-2">
                  <SectionLabel>{t("search.projects")}</SectionLabel>
                  {filtered.projects.map((project) => (
                    <button
                      key={project.id}
                      type="button"
                      onClick={() => closeAndNavigate("/")}
                      className="flex w-full items-start justify-between rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-border hover:bg-surface-tertiary"
                    >
                      <div className="min-w-0">
                        <div className="truncate">
                          {project.name}
                        </div>
                        <div className="mt-1 truncate text-muted">
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
                <div className="px-3 py-6 text-muted">
                  {t("search.noMatches")}
                </div>
              ) : null}
            </div>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  )
}

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="px-3 tracking-wider text-muted uppercase">{children}</div>
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
      className="flex w-full items-start gap-3 rounded-lg border border-transparent px-3 py-2.5 text-left transition hover:border-border hover:bg-surface-tertiary"
    >
      <Icon className="mt-0.5 size-4 text-muted" />
      <div>
        <div className="text-foreground">{label}</div>
        <div className="mt-1 text-muted">{detail}</div>
      </div>
    </button>
  )
}
