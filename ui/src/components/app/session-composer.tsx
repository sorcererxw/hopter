import { useMemo, useState, type FormEvent } from "react"
import { LoaderCircle, SendHorizonal } from "lucide-react"

import { Button } from "@/components/ui/button"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { useProjects } from "@/features/projects/use-projects"
import { cn } from "@/lib/utils"

type SessionComposerProps = {
  busy?: boolean
  initialProjectId?: string
  mode: "create" | "follow-up"
  onSubmit: (payload: { projectId?: string; prompt: string; title?: string }) => Promise<void> | void
}

export function SessionComposer({
  busy = false,
  initialProjectId,
  mode,
  onSubmit,
}: SessionComposerProps) {
  const { data: projects } = useProjects()
  const [projectId, setProjectId] = useState(initialProjectId ?? "")
  const [title, setTitle] = useState("")
  const [prompt, setPrompt] = useState("")

  const preferredProjectId = useMemo(() => {
    if (initialProjectId) {
      return initialProjectId
    }

    return projects?.[0]?.id ?? ""
  }, [initialProjectId, projects])
  const selectedProjectId = projectId || preferredProjectId

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()

    if (!prompt.trim()) {
      return
    }

    await onSubmit({
      projectId: mode === "create" ? selectedProjectId : undefined,
      prompt: prompt.trim(),
      title: mode === "create" && title.trim().length > 0 ? title.trim() : undefined,
    })

    setPrompt("")
    if (mode === "create") {
      setTitle("")
    }
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3" data-testid="session-composer">
      {mode === "create" ? (
        <div className="grid gap-3 md:grid-cols-[minmax(0,1fr)_220px]">
          <Input
            data-testid="session-title-input"
            placeholder="Optional title, e.g. Build a playable Tetris"
            value={title}
            onChange={(event) => setTitle(event.target.value)}
          />
          <label className="flex items-center rounded-lg border border-border bg-background px-3 text-sm text-muted-foreground focus-within:ring-2 focus-within:ring-ring/40">
            <span className="mr-2 shrink-0">Project</span>
            <select
              data-testid="session-project-select"
              className="h-10 min-w-0 flex-1 bg-transparent text-sm text-foreground outline-none"
              value={selectedProjectId}
              onChange={(event) => setProjectId(event.target.value)}
            >
              <option value="">Select a project</option>
              {projects?.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      <Textarea
        data-testid="session-prompt-input"
        value={prompt}
        onChange={(event) => setPrompt(event.target.value)}
        placeholder={
          mode === "create"
            ? "Ask Codex to create or continue something in this project…"
            : "Continue steering the current session…"
        }
        className="min-h-32 resize-y"
      />

      <div className="flex items-center justify-between gap-3">
        <p className="text-xs text-muted-foreground">
          {mode === "create"
            ? "The first runnable rebuild shell is wired to create sessions from the workspace."
            : "Follow-up input stays in the same shell so you can keep iterating without context switching."}
        </p>
        <Button
          data-testid={mode === "create" ? "session-create-submit" : "session-followup-submit"}
          type="submit"
          disabled={busy || !prompt.trim() || (mode === "create" && !selectedProjectId)}
          className={cn("min-w-32", busy && "opacity-80")}
        >
          {busy ? <LoaderCircle className="size-4 animate-spin" /> : <SendHorizonal className="size-4" />}
          {mode === "create" ? "Start session" : "Send input"}
        </Button>
      </div>
    </form>
  )
}
