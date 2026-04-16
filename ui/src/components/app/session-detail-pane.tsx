import { useMemo, useState } from "react"
import {
  Bot,
  ChevronDown,
  FileText,
  FolderGit2,
  PenLine,
  Sparkles,
} from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { SessionInspectorPane } from "@/components/app/session-inspector-pane"
import { SessionRichText } from "@/components/app/session-rich-text"
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

const HOME_SUGGESTIONS: Array<{ icon: LucideIcon; text: string; tone: string }> = [
  {
    icon: Sparkles,
    text: "Build a classic Snake game in this repo.",
    tone: "text-[#888]",
  },
  {
    icon: FileText,
    text: "Create a one-page summary of this app.",
    tone: "text-[#d4845c]",
  },
  {
    icon: PenLine,
    text: "Create a plan to finish the next milestone.",
    tone: "text-[#c9a84c]",
  },
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
    <div className="flex h-full min-h-0 flex-col bg-[#0f0f0f]">
      <WorkspaceTopbar
        title="New Thread"
        tag={selectedProject?.name}
        onOpenProject={() => navigate("/projects/new")}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="thin-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-3xl flex-col items-center justify-center px-6 pb-20">
            <div className="mb-4 flex size-14 items-center justify-center rounded-lg border border-white/10 bg-white/7">
              <Bot className="size-7 text-[#d8d8d8]" />
            </div>

            <h2 className="text-[22px] font-medium text-[#e0e0e0]">Start building</h2>

            <label className="relative mt-1 inline-flex items-center text-[14px] text-[#666]">
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectIdState(event.target.value)}
                className="min-w-60 appearance-none bg-transparent pr-6 text-center outline-none"
              >
                <option value="">{projectsLoading ? "Loading projects…" : "Select project"}</option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-[#666]" />
            </label>

            <div className="mt-8 flex w-full max-w-xl flex-col gap-3 md:flex-row">
              {HOME_SUGGESTIONS.map(({ icon: Icon, text, tone }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setPrompt(text)}
                  className="flex flex-1 items-center gap-3 rounded-lg border border-white/7 bg-white/4 p-4 text-left transition hover:bg-white/7 md:flex-col md:items-start"
                >
                  <Icon className={`size-4 shrink-0 ${tone}`} />
                  <span className="text-[12.5px] leading-6 text-[#aaa]">{text}</span>
                </button>
              ))}
            </div>
          </div>
        </div>

        <SessionComposer
          busy={createSession.isPending}
          disabled={!selectedProjectId}
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
  const [inspectorMode, setInspectorMode] = useState<"code" | "diff">("code")

  const session = sessionQuery.data

  return (
    <div className="flex h-full min-h-0 flex-col bg-[#0f0f0f]">
      <WorkspaceTopbar
        title={session?.title || "Thread"}
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
        <div className="flex flex-1 items-center justify-center px-6 text-[13px] text-[#666]">
          Loading thread…
        </div>
      ) : sessionQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-lg border border-white/8 bg-white/3 px-6 py-4 text-[12px] text-[#777]">
            This thread is temporarily unavailable.
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="thin-scrollbar flex-1 overflow-y-auto px-6 py-4">
              <div className="mx-auto max-w-2xl space-y-5">
                <div className="flex items-center gap-2 text-[12px] text-[#555]">
                  <span>{2 + (session.attentionRequired ? 1 : 0)} messages</span>
                  <ChevronDown className="size-3" />
                </div>

                <AssistantBlock session={session} />

                {session.attentionRequired ? (
                  <div className="rounded-lg border border-amber-300/15 bg-amber-300/6 px-4 py-3">
                    <div className="mb-1 text-[12px] text-amber-100/80">Attention</div>
                    <p className="text-[13px] leading-6 text-amber-50/85">
                      {session.attentionReason || "This session requires user input."}
                    </p>
                  </div>
                ) : null}

                {session.lastInputHint ? (
                  <div className="flex justify-end">
                    <div className="max-w-xl rounded-lg border border-white/10 bg-white/8 px-4 py-3 text-[13.5px] leading-7 text-[#e0e0e0]">
                      {session.lastInputHint}
                    </div>
                  </div>
                ) : null}

                <ArtifactStrip session={session} />

                {(formatSessionStatus(session.status) || "").toLowerCase() !== "completed" ? (
                  <div className="flex items-center gap-2 pb-2 text-[12px] text-[#444]">
                    <div className="flex items-center gap-1">
                      <span className="size-1.5 animate-pulse rounded-full bg-[#444]" />
                      <span className="size-1.5 animate-pulse rounded-full bg-[#444] [animation-delay:140ms]" />
                      <span className="size-1.5 animate-pulse rounded-full bg-[#444] [animation-delay:280ms]" />
                    </div>
                    <span>Thinking…</span>
                  </div>
                ) : null}
              </div>
            </div>

            <SessionComposer
              busy={sendInput.isPending}
              placeholder="Ask Codex anything, @ to add files, / for commands, $ for skills"
              projectLabel={session.project?.name || "Local"}
              branchLabel="main"
              settingsLabel="Custom (config.toml)"
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
              mode={inspectorMode}
              onClose={() => setInspectorOpen(false)}
              onModeChange={setInspectorMode}
              onTabChange={setActiveTab}
              session={session}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function AssistantBlock({
  session,
}: {
  session: NonNullable<ReturnType<typeof useSession>["data"]>
}) {
  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-2 rounded-md bg-white/4 px-3 py-1.5 text-[12px] text-[#666]">
        <span>{formatUpdatedAt(session.updatedAt)}</span>
        <span>·</span>
        <span>{formatSessionStatus(session.status).toLowerCase()}</span>
      </div>

      <div className="rounded-lg border border-white/8 bg-white/3 px-5 py-4">
        <div className="mb-3 inline-flex items-center gap-2 rounded-md bg-white/5 px-2.5 py-1 text-[12px] text-[#888]">
          <FolderGit2 className="size-3.5" />
          <span>{session.project?.name || "Local project"}</span>
        </div>

        <SessionRichText
          text={session.summary || "Codex is working…"}
          className="space-y-3 text-[13.5px] leading-7 text-[#d6d6d6]"
        />
      </div>
    </div>
  )
}

function ArtifactStrip({
  session,
}: {
  session: NonNullable<ReturnType<typeof useSession>["data"]>
}) {
  return (
    <div className="rounded-lg border border-white/8 bg-white/3 px-5 py-4">
      <div className="mb-3 flex items-center justify-between gap-3">
        <div className="flex items-center gap-2 text-[13px] text-[#cfcfcf]">
          <FileText className="size-4 text-[#777]" />
          <span>Artifacts</span>
        </div>
        <span className="text-[12px] text-[#666]">{session.artifacts.length} items</span>
      </div>

      {session.artifacts.length > 0 ? (
        <div className="space-y-3">
          {session.artifacts.map((artifact) => (
            <div key={artifact.id} className="rounded-md border border-white/7 bg-white/4 px-4 py-3">
              <p className="text-[13px] text-[#e0e0e0]">{artifact.label}</p>
              <p className="mt-1 text-[12px] text-[#666]">{formatArtifactKind(artifact.kind)}</p>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-[12px] leading-6 text-[#666]">
          Review artifacts appear here when the backend emits summaries, file changes,
          test results, or screenshots.
        </p>
      )}
    </div>
  )
}
