import { useMemo, useState } from "react"
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  FileText,
  FolderGit2,
  Sparkles,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { SessionInspectorPane } from "@/components/app/session-inspector-pane"
import { WorkspaceTopbar } from "@/components/app/workspace-topbar"
import { useProjects } from "@/features/projects/use-projects"
import {
  useCreateSession,
  useSendSessionInput,
  useSession,
} from "@/features/sessions/use-sessions"
import { formatArtifactKind, formatSessionStatus, formatUpdatedAt } from "@/lib/format/proto"

function deriveTitle(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  return normalized.slice(0, 72)
}

const HOME_SUGGESTIONS = [
  "Build a playable Tetris flow in this project.",
  "Create a one-page summary of this app and its architecture.",
  "Make a plan to finish the next milestone in this repo.",
]

export function HomeWorkspacePane() {
  const navigate = useNavigate()
  const createSession = useCreateSession()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const [selectedProjectIdState, setSelectedProjectIdState] = useState("")
  const [prompt, setPrompt] = useState("")
  const selectedProjectId = selectedProjectIdState || projects?.[0]?.id || ""

  const selectedProject = useMemo(
    () => projects?.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  )

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        title="新线程"
        tag={selectedProject?.name}
        onOpenProject={() => navigate("/projects/new")}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="thin-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full max-w-5xl flex-col items-center justify-center px-6 py-10">
            <div className="mb-5 flex size-18 items-center justify-center rounded-[28px] border border-white/10 bg-white/4">
              <Bot className="size-9 text-[#f0f0f0]" />
            </div>

            <h2 className="text-center text-5xl font-semibold tracking-tight text-white">
              开始构建
            </h2>

            <label className="relative mt-4 inline-flex items-center rounded-2xl border border-white/10 bg-white/4 px-4 py-3 text-[18px] text-[#8e8e8e]">
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectIdState(event.target.value)}
                className="min-w-56 appearance-none bg-transparent pr-8 text-center outline-none"
              >
                <option value="">
                  {projectsLoading ? "加载项目中…" : "选择项目"}
                </option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-4 size-4 text-[#777]" />
            </label>

            <div className="mt-10 grid w-full max-w-5xl gap-3 xl:grid-cols-3">
              {HOME_SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => setPrompt(suggestion)}
                  className="rounded-[28px] border border-white/8 bg-white/4 px-5 py-5 text-left transition hover:bg-white/8"
                >
                  <div className="mb-4 flex size-10 items-center justify-center rounded-2xl bg-white/6 text-[#dddddd]">
                    <Sparkles className="size-5" />
                  </div>
                  <p className="text-[17px] leading-8 text-[#efefef]">{suggestion}</p>
                </button>
              ))}
            </div>

            {!selectedProjectId ? (
              <div className="mt-8 rounded-2xl border border-dashed border-white/10 bg-white/2 px-5 py-4 text-sm text-[#8a8a8a]">
                先打开一个项目，再从这个工作区直接创建会话。
              </div>
            ) : null}
          </div>
        </div>

        <SessionComposer
          busy={createSession.isPending}
          disabled={!selectedProjectId}
          modelLabel="GPT-5.4"
          placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
          projectLabel={selectedProject?.name || "本地"}
          branchLabel="main"
          onValueChange={setPrompt}
          onSubmit={async () => {
            if (!selectedProjectId || !prompt.trim()) {
              return
            }

            const normalizedPrompt = prompt.trim()
            const session = await createSession.mutateAsync({
              projectId: selectedProjectId,
              prompt: normalizedPrompt,
              title: deriveTitle(normalizedPrompt),
            })

            setPrompt("")

            if (session?.id) {
              navigate(`/sessions/${session.id}`)
            }
          }}
          value={prompt}
        />
      </div>
    </div>
  )
}

export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate()
  const sessionQuery = useSession(sessionId)
  const sendInput = useSendSessionInput()
  const [prompt, setPrompt] = useState("")
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<"summary" | "review">("summary")

  const session = sessionQuery.data

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        title={session?.title || "会话"}
        tag={session?.project?.name}
        inspectorOpen={inspectorOpen}
        onOpenProject={() => navigate("/projects/new")}
        onOpenReview={() => {
          setActiveTab("review")
          setInspectorOpen(true)
        }}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        showInspectorToggle
        showReview
      />

      {sessionQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center px-6 text-[#8d8d8d]">
          正在加载会话…
        </div>
      ) : sessionQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-[28px] border border-white/10 bg-white/3 px-6 py-5 text-sm text-[#8d8d8d]">
            当前会话暂时不可用。等 Go 服务返回数据后，这里会自动恢复。
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="thin-scrollbar flex-1 overflow-y-auto">
              <div className="mx-auto flex max-w-4xl flex-col gap-6 px-6 py-6">
                <div className="flex items-center gap-2 text-[12px] text-[#6f6f6f]">
                  <span>{formatUpdatedAt(session.updatedAt)}</span>
                  <span>·</span>
                  <span>{formatSessionStatus(session.status)}</span>
                </div>

                {session.lastInputHint ? (
                  <div className="flex justify-end">
                    <div className="max-w-2xl rounded-[28px] border border-white/10 bg-white/7 px-5 py-4 text-[16px] leading-8 text-[#efefef]">
                      {session.lastInputHint}
                    </div>
                  </div>
                ) : null}

                <div className="space-y-4 rounded-[30px] border border-white/8 bg-[#151515] px-6 py-5">
                  <div className="inline-flex items-center gap-2 rounded-full bg-white/6 px-3 py-1.5 text-[12px] text-[#8f8f8f]">
                    <FolderGit2 className="size-4" />
                    <span>{session.project?.name || "本地项目"}</span>
                  </div>

                  <div className="space-y-4 text-[15px] leading-8 text-[#e7e7e7]">
                    {session.summary ? (
                      session.summary.split(/\n{2,}/).map((paragraph, index) => (
                        <p key={index}>{paragraph}</p>
                      ))
                    ) : (
                      <p className="text-[#8a8a8a]">
                        这个会话还没有输出摘要。你可以直接在下面继续引导它。
                      </p>
                    )}
                  </div>
                </div>

                {session.attentionRequired ? (
                  <div className="rounded-[28px] border border-amber-400/20 bg-amber-400/8 px-5 py-4">
                    <div className="mb-2 flex items-center gap-2 text-[13px] font-medium text-amber-100">
                      <AlertTriangle className="size-4" />
                      <span>需要注意</span>
                    </div>
                    <p className="text-[14px] leading-7 text-amber-50/90">
                      {session.attentionReason || "后端标记了一个需要你处理的状态。"}
                    </p>
                  </div>
                ) : null}

                <div className="rounded-[28px] border border-white/8 bg-[#171717] px-5 py-4">
                  <div className="mb-4 flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-[13px] text-[#d7d7d7]">
                      <FileText className="size-4 text-[#8c8c8c]" />
                      <span>Artifacts</span>
                    </div>
                    <span className="text-[12px] text-[#727272]">
                      {session.artifacts.length} 项
                    </span>
                  </div>

                  {session.artifacts.length > 0 ? (
                    <div className="space-y-3">
                      {session.artifacts.map((artifact) => (
                        <div
                          key={artifact.id}
                          className="rounded-2xl border border-white/7 bg-white/3 px-4 py-3"
                        >
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-[14px] font-medium text-[#efefef]">
                                {artifact.label}
                              </p>
                              <p className="mt-1 text-[12px] text-[#7f7f7f]">
                                {formatArtifactKind(artifact.kind)}
                              </p>
                            </div>
                            {artifact.downloadUrl ? (
                              <a
                                href={artifact.downloadUrl}
                                target="_blank"
                                rel="noreferrer"
                                className="text-[12px] text-[#d0d0d0] underline decoration-white/15 underline-offset-4 transition hover:text-white"
                              >
                                下载
                              </a>
                            ) : null}
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : (
                    <p className="text-[14px] leading-7 text-[#858585]">
                      一旦后端开始发布摘要、文件变化、测试结果或截图元数据，这里会出现在会话流里。
                    </p>
                  )}
                </div>
              </div>
            </div>

            <SessionComposer
              busy={sendInput.isPending}
              placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
              projectLabel={session.project?.name || "本地"}
              branchLabel={formatSessionStatus(session.status)}
              settingsLabel="当前会话"
              onValueChange={setPrompt}
              onSubmit={async () => {
                if (!prompt.trim()) {
                  return
                }

                const normalizedPrompt = prompt.trim()
                await sendInput.mutateAsync({ input: normalizedPrompt, sessionId })
                setPrompt("")
              }}
              value={prompt}
            />
          </div>

          {inspectorOpen ? (
            <SessionInspectorPane
              activeTab={activeTab}
              onClose={() => setInspectorOpen(false)}
              onTabChange={setActiveTab}
              session={session}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}
