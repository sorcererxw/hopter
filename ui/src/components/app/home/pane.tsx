import { useMemo, useState } from "react"
import { useTranslation } from "react-i18next"
import { useNavigate, useSearchParams } from "react-router-dom"
import { Check, ChevronDown } from "lucide-react"
import { Label, ListBox, Select, Tooltip } from "@heroui/react"

import { SessionComposer } from "@/components/app/sessions/composer"
import {
  rememberSessionComposerSelection,
  resolveSessionComposerSelection,
} from "@/components/app/sessions/composer"
import { WorkspacePageToolbar } from "@/components/app/workspace"
import { useWorkspaceShell } from "@/components/app/workspace"
import { useProjects } from "@/features/projects/use-projects"
import {
  agentSelectionPreferenceFromConfig,
  buildAgentSelectionConfigPatch,
  useConfig,
  useUpdateConfig,
} from "@/features/config/use-config"
import { useCreateSession, useSessions } from "@/features/sessions/use-sessions"

function deriveTitle(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  return normalized.slice(0, 72)
}

// HomeWorkspacePane is the "new session" surface. It reuses the same composer
// as session detail, but with project selection and initial session creation.
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
  const [projectSelectOpen, setProjectSelectOpen] = useState(false)
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
    // Preserve a selected project that only exists in recent session metadata
    // while the canonical project list is still loading or catching up.
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
            footerStart={
              <div className="min-w-0">
                <Tooltip isOpen={projectSelectOpen ? false : undefined}>
                  <Tooltip.Trigger className="min-w-0">
                    <Select
                      isDisabled={
                        projectsLoading && projectOptions.length === 0
                      }
                      onOpenChange={setProjectSelectOpen}
                      onSelectionChange={(key) => {
                        if (key == null) {
                          return
                        }
                        const nextProjectId = String(key)
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
                      selectedKey={selectedProjectId || null}
                      variant="secondary"
                    >
                      <Select.Trigger
                        aria-label={t("home.selectProject")}
                        className="h-8 w-auto max-w-44 min-w-0 justify-start gap-1 rounded-full border-0 bg-transparent px-2.5 text-muted shadow-none hover:bg-surface-tertiary hover:text-foreground focus-visible:border-transparent focus-visible:ring-0"
                      >
                        <Select.Value>
                          <span className="min-w-0 truncate">
                            {selectedProject?.name ||
                              (projectsLoading
                                ? t("app.settings.loading")
                                : t("home.selectProject"))}
                          </span>
                        </Select.Value>
                        <Select.Indicator>
                          <ChevronDown className="size-3 text-muted" />
                        </Select.Indicator>
                      </Select.Trigger>
                      <Select.Popover
                        placement="bottom start"
                        className="min-w-40 rounded-2xl bg-overlay p-1 shadow-2xl"
                      >
                        <ListBox>
                          {projectOptions.map((project) => (
                            <ListBox.Item
                              key={project.id}
                              id={project.id}
                              textValue={project.name}
                            >
                              <Label>{project.name}</Label>
                              <ListBox.ItemIndicator>
                                <Check className="size-3.5" />
                              </ListBox.ItemIndicator>
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </Tooltip.Trigger>
                  <Tooltip.Content placement="top" showArrow>
                    {t("home.selectProject")}
                  </Tooltip.Content>
                </Tooltip>
              </div>
            }
            inputTestId="home-session-prompt-input"
            initialSelection={initialComposerSelection}
            placeholder={t("home.askAnything")}
            placement="inline"
            projectLabel={selectedProject?.name || t("home.localProject")}
            branchLabel="main"
            onSelectionChange={(selection) => {
              const currentFastMode =
                configQuery.data?.agent?.defaultCodexFastMode ?? false
              if (selection.codexFastMode === currentFastMode) {
                return
              }
              updateConfig.mutate({
                agent: buildAgentSelectionConfigPatch(configQuery.data, {
                  codexFastMode: selection.codexFastMode,
                }),
                expectedRevision: configQuery.data?.revision ?? 0n,
              })
            }}
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
                // Persist the chosen agent controls against the new session id
                // so the follow-up composer opens with the same selection.
                rememberSessionComposerSelection(session.id, {
                  codexFastMode,
                  model,
                  reasoningEffort,
                })
                updateConfig.mutate({
                  agent: buildAgentSelectionConfigPatch(configQuery.data, {
                    codexFastMode,
                    model,
                    reasoningEffort,
                  }),
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
        </div>
      </div>
    </div>
  )
}
