import { useMemo, useState } from "react"
import { Bot, ChevronDown } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { WorkspaceTopbar } from "@/components/app/workspace-topbar"
import { useProjects } from "@/features/projects/use-projects"
import {
  useCreateSession,
  useSessions,
} from "@/features/sessions/use-sessions"

function deriveTitle(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  return normalized.slice(0, 72)
}

export function HomeWorkspacePane() {
  const navigate = useNavigate()
  const { eventStreamState, toggleRail, toolbarMode } = useWorkspaceShell()
  const [searchParams, setSearchParams] = useSearchParams()
  const createSession = useCreateSession()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: sessions } = useSessions(
    undefined,
    eventStreamState === "connected" ? 10_000 : 3_000
  )
  const [selectedBackendKeyState, setSelectedBackendKeyState] = useState("")
  const [prompt, setPrompt] = useState("")
  const selectedProjectId =
    searchParams.get("projectId") || projects?.[0]?.id || ""
  const fallbackProject = useMemo(() => {
    if (!selectedProjectId) {
      return undefined
    }

    const project = sessions?.find(
      (session) => session.project?.id === selectedProjectId
    )?.project

    if (!project) {
      return undefined
    }

    return {
      id: project.id,
      name: project.name,
      rootPath: project.rootPath,
      defaultBackend: "codex",
    }
  }, [selectedProjectId, sessions])
  const projectOptions = useMemo(() => {
    if (!fallbackProject) {
      return projects ?? []
    }

    if ((projects ?? []).some((project) => project.id === fallbackProject.id)) {
      return projects ?? []
    }

    return [fallbackProject, ...(projects ?? [])]
  }, [fallbackProject, projects])

  const selectedProject = useMemo(
    () => projectOptions.find((project) => project.id === selectedProjectId),
    [projectOptions, selectedProjectId]
  )
  const selectedBackendKey =
    selectedBackendKeyState || selectedProject?.defaultBackend || "codex"

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        leadingAction="toggle-rail"
        onLeadingAction={toggleRail}
        projectName={selectedProject?.name}
        syncState={eventStreamState}
        title="New Thread"
        toolbarMode={toolbarMode}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="workspace-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col items-center justify-center px-6 pt-6 pb-20">
            <div className="mb-4 flex size-14 items-center justify-center rounded-lg border border-ws-border-strong bg-accent">
              <Bot className="size-7 text-foreground" />
            </div>

            <h2 className="text-2xl font-medium text-foreground">
              Start building
            </h2>

            <label className="relative mt-1 inline-flex items-center gap-1 text-sm text-muted-foreground">
              <select
                value={selectedProjectId}
                onChange={(event) => {
                  const nextProjectId = event.target.value
                  setSearchParams((current) => {
                    const next = new URLSearchParams(current)
                    if (nextProjectId) {
                      next.set("projectId", nextProjectId)
                    } else {
                      next.delete("projectId")
                    }
                    return next
                  })
                }}
                className="min-w-52 appearance-none bg-transparent pr-5 text-center outline-none"
              >
                <option value="">
                  {projectsLoading ? "Loading projects..." : "Select project"}
                </option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-muted-foreground" />
            </label>

            <label className="relative mt-2 inline-flex items-center gap-1 text-xs tracking-wider text-ws-text-muted uppercase">
              <select
                value={selectedBackendKey}
                onChange={(event) =>
                  setSelectedBackendKeyState(event.target.value)
                }
                className="min-w-32 appearance-none bg-transparent pr-5 text-center outline-none"
              >
                <option value="codex">codex</option>
                <option value="copilot">copilot</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-ws-text-muted" />
            </label>
          </div>
        </div>

        <SessionComposer
          busy={createSession.isPending}
          composerTestId="home-session-composer"
          disabled={!selectedProjectId}
          inputTestId="home-session-prompt-input"
          placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
          projectLabel={selectedProject?.name || "Local"}
          branchLabel="main"
          onValueChange={setPrompt}
          onSubmit={async () => {
            if (!selectedProjectId || !prompt.trim()) {
              return
            }

            const normalizedPrompt = prompt.trim()
            const session = await createSession.mutateAsync({
              backendKey: selectedBackendKey,
              projectId: selectedProjectId,
              prompt: normalizedPrompt,
              title: deriveTitle(normalizedPrompt),
            })

            setPrompt("")

            if (session?.id) {
              setSearchParams((current) => {
                const next = new URLSearchParams(current)
                next.delete("projectId")
                return next
              })
              navigate(`/sessions/${session.id}`)
            }
          }}
          submitTestId="home-session-submit"
          value={prompt}
        />
      </div>
    </div>
  )
}
