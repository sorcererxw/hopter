import { useMemo, useState } from "react"
import { ChevronDown } from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { WorkspacePageToolbar } from "@/components/app/workspace-page-toolbar"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { useProjects } from "@/features/projects/use-projects"
import { useCreateSession, useSessions } from "@/features/sessions/use-sessions"

function deriveTitle(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  return normalized.slice(0, 72)
}

export function HomeWorkspacePane() {
  const navigate = useNavigate()
  const { eventStreamState, posture } = useWorkspaceShell()
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
  const isPhoneCompose =
    posture === "phone" && searchParams.get("compose") === "1"

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspacePageToolbar forceBack={isPhoneCompose} title="New Session" />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-8">
        <div className="w-full max-w-[720px]">
          <div className="mb-8 text-center">
            <h2 className="text-4xl leading-tight font-medium tracking-tight text-foreground">
              Start a new session
            </h2>
          </div>

          <SessionComposer
            busy={createSession.isPending}
            composerTestId="home-session-composer"
            disabled={!selectedProjectId}
            inputTestId="home-session-prompt-input"
            placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
            placement="inline"
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
                  next.delete("compose")
                  next.delete("projectId")
                  return next
                })
                navigate(`/sessions/${session.id}`)
              }
            }}
            submitTestId="home-session-submit"
            value={prompt}
          />

          <div className="mt-4 flex items-center justify-center gap-1 text-base text-muted-foreground">
            <label className="relative inline-flex items-center">
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
                className="appearance-none bg-transparent pr-4 text-center font-medium text-foreground outline-none"
              >
                <option value="">
                  {projectsLoading ? "Loading…" : "Select project"}
                </option>
                {projectOptions.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-muted-foreground" />
            </label>

            <span className="text-muted-foreground">·</span>

            <label className="relative inline-flex items-center">
              <select
                value={selectedBackendKey}
                onChange={(event) =>
                  setSelectedBackendKeyState(event.target.value)
                }
                className="appearance-none bg-transparent pr-4 text-center font-medium text-foreground outline-none"
              >
                <option value="codex">codex</option>
                <option value="copilot">copilot</option>
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-muted-foreground" />
            </label>
          </div>
        </div>
      </div>
    </div>
  )
}
