import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { CheckCircle2, Circle, ListChecks, LoaderCircle } from "lucide-react"
import { Button, TextArea } from "@heroui/react"

import { WorkspacePageToolbar } from "@/components/app/workspace"
import { useProjects } from "@/features/projects/use-projects"
import { useCreateTask, useTasks } from "@/features/tasks/use-tasks"
import { TaskLifecycleStatus } from "@/gen/proto/hopter/v1/tasks_pb"
import type { Timestamp } from "@bufbuild/protobuf/wkt"
import { timestampToDate } from "@/lib/format/proto"
import { useLocale } from "@/lib/i18n/provider"
import { cn } from "@/lib/utils"

type TFunction = ReturnType<typeof useTranslation>["t"]

function formatTaskStatus(status: TaskLifecycleStatus, t: TFunction) {
  switch (status) {
    case TaskLifecycleStatus.ACTIVE:
      return t("tasks.status.active")
    case TaskLifecycleStatus.WAITING:
      return t("tasks.status.waiting")
    case TaskLifecycleStatus.PAUSED:
      return t("tasks.status.paused")
    case TaskLifecycleStatus.BLOCKED:
      return t("tasks.status.blocked")
    case TaskLifecycleStatus.FAILED:
      return t("tasks.status.failed")
    case TaskLifecycleStatus.CANCELED:
      return t("tasks.status.canceled")
    case TaskLifecycleStatus.DONE:
      return t("tasks.status.done")
    default:
      return t("tasks.status.unknown")
  }
}

function formatUpdatedAt(value: Timestamp | undefined, locale: string) {
  const date = timestampToDate(value)
  if (!date) {
    return ""
  }
  return new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date)
}

// TasksRoute is intentionally lightweight: create task at the top, recent task
// list below, no secondary panels or nested route state.
export function TasksRoute() {
  const { t } = useTranslation()
  const { resolvedLocale } = useLocale()
  const { data: projects } = useProjects()
  const tasksQuery = useTasks()
  const createTask = useCreateTask()
  const [projectId, setProjectId] = useState("")
  const [prompt, setPrompt] = useState("")

  const defaultProjectId = useMemo(() => projects?.[0]?.id ?? "", [projects])
  const selectedProjectId = projectId || defaultProjectId

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const trimmedPrompt = prompt.trim()
    if (!selectedProjectId || !trimmedPrompt) {
      return
    }
    const created = await createTask.mutateAsync({
      projectId: selectedProjectId,
      prompt: trimmedPrompt,
    })
    if (created?.id) {
      setPrompt("")
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background text-foreground">
      <WorkspacePageToolbar
        title={t("tasks.pageTitle")}
        showOverflowMenu={false}
      />
      <div className="min-h-0 flex-1 overflow-hidden">
        <section className="min-h-0 max-w-3xl overflow-y-auto p-4">
          <form className="group mb-5" onSubmit={handleSubmit}>
            <div className="rounded-lg border border-field-border bg-field/30 transition-colors focus-within:border-focus focus-within:ring-[3px] focus-within:ring-focus/50">
              <TextArea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder={t("tasks.placeholder")}
                className="min-h-28 border-0 bg-transparent focus-visible:ring-0"
                fullWidth
                variant="secondary"
              />
              <div className="hidden items-center justify-between gap-2 border-t border-border px-3 py-2 group-focus-within:flex">
                {/* Keep project selection close to submit so the form stays
                focused on "create from prompt" rather than project management. */}
                <select
                  aria-label={t("tasks.project")}
                  className="h-8 min-w-40 rounded-full border border-field-border bg-field/30 px-3 text-sm text-foreground outline-none focus-visible:border-focus focus-visible:ring-3 focus-visible:ring-focus/50 disabled:cursor-not-allowed disabled:opacity-50"
                  value={selectedProjectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </select>
                <Button
                  type="submit"
                  size="sm"
                  isDisabled={
                    createTask.isPending || !selectedProjectId || !prompt.trim()
                  }
                >
                  {createTask.isPending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <ListChecks className="size-3.5" />
                  )}
                  {t("tasks.createAndStart")}
                </Button>
              </div>
            </div>
          </form>

          <div className="space-y-1">
            {tasksQuery.isLoading ? (
              <p className="px-2 py-3 text-sm text-muted">
                {t("tasks.loading")}
              </p>
            ) : null}
            {tasksQuery.isError ? (
              <p className="px-2 py-3 text-sm text-muted">
                {t("tasks.backendPending")}
              </p>
            ) : null}
            {!tasksQuery.isLoading &&
            !tasksQuery.isError &&
            (tasksQuery.data?.length ?? 0) === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-lg px-6 text-center">
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-surface-secondary text-muted">
                  <ListChecks className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  {t("tasks.emptyTitle")}
                </p>
                <p className="mt-1 max-w-60 text-sm text-muted">
                  {t("tasks.emptyBody")}
                </p>
              </div>
            ) : null}
            {(tasksQuery.data ?? []).map((task) => {
              const done = task.lifecycleStatus === TaskLifecycleStatus.DONE
              return (
                <article
                  key={task.id}
                  className="rounded-lg border border-border bg-surface p-3"
                >
                  <div className="flex items-start gap-3">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 size-4 text-emerald-400" />
                    ) : (
                      <Circle className="mt-0.5 size-4 text-muted" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-medium">
                          {task.title || t("tasks.untitled")}
                        </h2>
                        <span
                          className={cn(
                            "rounded-md border border-border px-1.5 py-0.5 text-xs text-muted",
                            task.lifecycleStatus ===
                              TaskLifecycleStatus.BLOCKED && "text-amber-400"
                          )}
                        >
                          {formatTaskStatus(task.lifecycleStatus, t)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted">
                        {task.project?.name || t("tasks.project")} ·{" "}
                        {formatUpdatedAt(task.updatedAt, resolvedLocale)}
                      </p>
                      {task.diagnostics.length > 0 ? (
                        <p className="mt-2 text-xs text-muted">
                          {task.diagnostics[0]?.message}
                        </p>
                      ) : null}
                    </div>
                  </div>
                </article>
              )
            })}
          </div>
        </section>
      </div>
    </div>
  )
}
