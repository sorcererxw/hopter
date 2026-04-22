import { useMemo, useState } from "react"
import { CheckCircle2, Circle, ListChecks, LoaderCircle } from "lucide-react"

import { WorkspacePageToolbar } from "@/components/app/workspace-page-toolbar"
import { Button } from "@/components/ui/button"
import { NativeSelect } from "@/components/ui/native-select"
import { Textarea } from "@/components/ui/textarea"
import { useProjects } from "@/features/projects/use-projects"
import { useCreateTask, useTasks } from "@/features/tasks/use-tasks"
import { TaskLifecycleStatus } from "@/gen/proto/hopter/v1/tasks_pb"
import type { Timestamp } from "@bufbuild/protobuf/wkt"
import { timestampToDate } from "@/lib/format/proto"
import { cn } from "@/lib/utils"

function formatTaskStatus(status: TaskLifecycleStatus) {
  switch (status) {
    case TaskLifecycleStatus.ACTIVE:
      return "Active"
    case TaskLifecycleStatus.WAITING:
      return "Waiting"
    case TaskLifecycleStatus.PAUSED:
      return "Paused"
    case TaskLifecycleStatus.BLOCKED:
      return "Blocked"
    case TaskLifecycleStatus.FAILED:
      return "Failed"
    case TaskLifecycleStatus.CANCELED:
      return "Canceled"
    case TaskLifecycleStatus.DONE:
      return "Done"
    default:
      return "Unknown"
  }
}

function formatUpdatedAt(value?: Timestamp) {
  const date = timestampToDate(value)
  if (!date) {
    return ""
  }
  return new Intl.DateTimeFormat(undefined, {
    hour: "numeric",
    minute: "2-digit",
    month: "short",
    day: "numeric",
  }).format(date)
}

export function TasksRoute() {
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
      <WorkspacePageToolbar title="Tasks" showOverflowMenu={false} />
      <div className="min-h-0 flex-1 overflow-hidden">
        <section className="min-h-0 max-w-3xl overflow-y-auto p-4">
          <form className="group mb-5" onSubmit={handleSubmit}>
            <div className="rounded-lg border border-input bg-input/30 transition-colors focus-within:border-ring focus-within:ring-[3px] focus-within:ring-ring/50">
              <Textarea
                value={prompt}
                onChange={(event) => setPrompt(event.target.value)}
                placeholder="Describe the work. Hopter will start planning, not changing files."
                className="min-h-28 border-0 bg-transparent focus-visible:ring-0"
              />
              <div className="hidden items-center justify-between gap-2 border-t border-border px-3 py-2 group-focus-within:flex">
                <NativeSelect
                  aria-label="Project"
                  className="min-w-40"
                  size="sm"
                  value={selectedProjectId}
                  onChange={(event) => setProjectId(event.target.value)}
                >
                  {(projects ?? []).map((project) => (
                    <option key={project.id} value={project.id}>
                      {project.name}
                    </option>
                  ))}
                </NativeSelect>
                <Button
                  type="submit"
                  size="sm"
                  disabled={
                    createTask.isPending || !selectedProjectId || !prompt.trim()
                  }
                >
                  {createTask.isPending ? (
                    <LoaderCircle className="size-3.5 animate-spin" />
                  ) : (
                    <ListChecks className="size-3.5" />
                  )}
                  Create and start planning
                </Button>
              </div>
            </div>
          </form>

          <div className="space-y-1">
            {tasksQuery.isLoading ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Loading tasks...
              </p>
            ) : null}
            {tasksQuery.isError ? (
              <p className="px-2 py-3 text-sm text-muted-foreground">
                Tasks will appear when the backend responds.
              </p>
            ) : null}
            {!tasksQuery.isLoading &&
            !tasksQuery.isError &&
            (tasksQuery.data?.length ?? 0) === 0 ? (
              <div className="flex min-h-64 flex-col items-center justify-center rounded-lg px-6 text-center">
                <div className="mb-3 flex size-10 items-center justify-center rounded-lg bg-secondary text-muted-foreground">
                  <ListChecks className="size-5" />
                </div>
                <p className="text-sm font-medium text-foreground">
                  No tasks yet
                </p>
                <p className="mt-1 max-w-60 text-sm text-muted-foreground">
                  Describe work above to start a plan for the selected project.
                </p>
              </div>
            ) : null}
            {(tasksQuery.data ?? []).map((task) => {
              const done = task.lifecycleStatus === TaskLifecycleStatus.DONE
              return (
                <article
                  key={task.id}
                  className="rounded-lg border border-border bg-card p-3"
                >
                  <div className="flex items-start gap-3">
                    {done ? (
                      <CheckCircle2 className="mt-0.5 size-4 text-emerald-400" />
                    ) : (
                      <Circle className="mt-0.5 size-4 text-muted-foreground" />
                    )}
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-2">
                        <h2 className="truncate text-sm font-medium">
                          {task.title || "Untitled task"}
                        </h2>
                        <span
                          className={cn(
                            "rounded-md border border-border px-1.5 py-0.5 text-xs text-muted-foreground",
                            task.lifecycleStatus ===
                              TaskLifecycleStatus.BLOCKED && "text-amber-400"
                          )}
                        >
                          {formatTaskStatus(task.lifecycleStatus)}
                        </span>
                      </div>
                      <p className="mt-1 truncate text-xs text-muted-foreground">
                        {task.project?.name || "Project"} ·{" "}
                        {formatUpdatedAt(task.updatedAt)}
                      </p>
                      {task.diagnostics.length > 0 ? (
                        <p className="mt-2 text-xs text-muted-foreground">
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
