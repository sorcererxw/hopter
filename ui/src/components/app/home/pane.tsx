import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SessionComposer } from "@/components/app/sessions/composer"
import {
  rememberSessionComposerSelection,
  resolveSessionComposerSelection,
} from "@/components/app/sessions/composer"
import { WorkspacePageToolbar } from "@/components/app/workspace"
import { useWorkspaceShell } from "@/components/app/workspace"
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useProjects } from "@/features/projects/use-projects"
import {
  agentSelectionPreferenceFromConfig,
  useConfig,
  useUpdateConfig,
} from "@/features/config/use-config"
import { useCreateSession, useSessions } from "@/features/sessions/use-sessions"

function deriveTitle(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  return normalized.slice(0, 72)
}

export function HomeWorkspacePane() {
  const { t } = useTranslation()
  const navigate = useNavigate()
  const { eventStreamState, posture } = useWorkspaceShell()
  const [searchParams, setSearchParams] = useSearchParams()
  const createSession = useCreateSession()
  const configQuery = useConfig()
  const updateConfig = useUpdateConfig()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const { data: sessions } = useSessions(
    undefined,
    eventStreamState === "connected" ? 10_000 : 3_000
  )
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
  const isPhoneCompose =
    posture === "phone" && searchParams.get("compose") === "1"
  const initialComposerSelection = resolveSessionComposerSelection(
    agentSelectionPreferenceFromConfig(configQuery.data)
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspacePageToolbar
        forceBack={isPhoneCompose}
        showOverflowMenu={false}
        title={t("home.newSession")}
      />

      <div className="flex min-h-0 flex-1 flex-col items-center justify-center px-6 pb-8">
        <div className="w-full max-w-[720px]">
          <div className="mb-8 text-center">
            <h2 className="text-4xl leading-tight font-medium tracking-tight text-foreground">
              {t("home.startNewSession")}
            </h2>
          </div>

          <SessionComposer
            busy={createSession.isPending}
            composerTestId="home-session-composer"
            disabled={!selectedProjectId}
            inputTestId="home-session-prompt-input"
            initialSelection={initialComposerSelection}
            placeholder={t("home.askAnything")}
            placement="inline"
            projectLabel={selectedProject?.name || t("home.localProject")}
            branchLabel="main"
            onValueChange={setPrompt}
            onSubmit={async ({
              attachments,
              codexFastMode,
              model,
              reasoningEffort,
            }) => {
              if (
                !selectedProjectId ||
                (!prompt.trim() && attachments.length === 0)
              ) {
                return
              }

              const normalizedPrompt = prompt.trim()
              const session = await createSession.mutateAsync({
                attachments,
                backendKey: "codex",
                codexFastMode,
                model,
                projectId: selectedProjectId,
                prompt: normalizedPrompt,
                reasoningEffort,
                title:
                  deriveTitle(normalizedPrompt) ||
                  attachments[0]?.label ||
                  undefined,
              })

              setPrompt("")

              if (session?.id) {
                rememberSessionComposerSelection(session.id, {
                  codexFastMode,
                  model,
                  reasoningEffort,
                })
                updateConfig.mutate({
                  agent: {
                    defaultBackend: "codex",
                    defaultCodexFastMode: codexFastMode,
                    defaultModel: model,
                    defaultReasoningEffort: reasoningEffort,
                  },
                  expectedRevision: configQuery.data?.revision ?? 0n,
                })
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

          <div className="mt-4 flex items-center justify-start">
            <Select
              value={selectedProjectId}
              disabled={projectsLoading && projectOptions.length === 0}
              onValueChange={(nextProjectId) => {
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
            >
              <SelectTrigger
                aria-label={t("home.selectProject")}
                className="min-w-40 max-w-80"
              >
                <SelectValue
                  placeholder={
                    projectsLoading
                      ? t("app.settings.loading")
                      : t("home.selectProject")
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectGroup>
                  {projectOptions.map((project) => (
                    <SelectItem key={project.id} value={project.id}>
                      {project.name}
                    </SelectItem>
                  ))}
                </SelectGroup>
              </SelectContent>
            </Select>
          </div>
        </div>
      </div>
    </div>
  )
}
