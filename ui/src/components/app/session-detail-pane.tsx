import { useMemo, useState } from "react"
import { Bot, ChevronDown, FileText, FolderGit2, PenLine, Sparkles } from "lucide-react"
import type { LucideIcon } from "lucide-react"
import { useNavigate } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { parseReferencedFiles } from "@/components/app/session-derived"
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
    tone: "text-[var(--workspace-text-secondary)]",
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
    <div className="flex h-full min-h-0 flex-col bg-[var(--workspace-page-bg)]">
      <WorkspaceTopbar
        title="New Thread"
        tag={selectedProject?.name}
        onOpenProject={() => navigate("/projects/new")}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="workspace-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col items-center justify-center px-6 pb-20 pt-6">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-[color:var(--workspace-border-strong)] bg-[var(--workspace-hover-bg)]">
              <Bot className="size-7 text-[var(--workspace-text-primary)]" />
            </div>

            <h2 className="text-[22px] font-medium text-[var(--workspace-text-primary)]">
              Start building
            </h2>

            <label className="relative mt-1 inline-flex items-center gap-1 text-[14px] text-[var(--workspace-text-muted)]">
              <select
                value={selectedProjectId}
                onChange={(event) => setSelectedProjectIdState(event.target.value)}
                className="min-w-52 appearance-none bg-transparent pr-5 text-center outline-none"
              >
                <option value="">{projectsLoading ? "Loading projects..." : "Select project"}</option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-[var(--workspace-text-muted)]" />
            </label>

            <div className="mt-8 grid w-full max-w-[700px] gap-3 md:grid-cols-3">
              {HOME_SUGGESTIONS.map(({ icon: Icon, text, tone }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setPrompt(text)}
                  className="flex items-center gap-3 rounded-[1rem] border border-[color:var(--workspace-tool-border)] bg-[var(--workspace-tool-bg)] p-4 text-left transition hover:bg-[var(--workspace-hover-bg)] md:flex-col md:items-start"
                >
                  <Icon className={`size-4 shrink-0 ${tone}`} />
                  <span className="text-[12.5px] leading-[1.55] text-[var(--workspace-text-secondary)]">
                    {text}
                  </span>
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
  const [activeTab, setActiveTab] = useState<"summary" | "review">("review")
  const [inspectorMode, setInspectorMode] = useState<"code" | "diff">("code")

  const session = sessionQuery.data
  const visibleMessageCount = useMemo(() => {
    if (!session) {
      return 0
    }

    return 1 + (session.lastInputHint ? 1 : 0) + (session.artifacts.length > 0 ? 1 : 0)
  }, [session])

  return (
    <div className="flex h-full min-h-0 flex-col bg-[var(--workspace-page-bg)]">
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
        <div className="flex flex-1 items-center justify-center px-6 text-[13px] text-[var(--workspace-text-muted)]">
          Loading thread...
        </div>
      ) : sessionQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-[1rem] border border-[color:var(--workspace-border)] bg-[var(--workspace-hover-bg-soft)] px-6 py-4 text-[12px] text-[var(--workspace-text-muted)]">
            This thread is temporarily unavailable.
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="workspace-scrollbar flex-1 overflow-y-auto px-6 py-4">
              <div className="mx-auto max-w-[720px] space-y-5">
                <div className="flex items-center gap-2 text-[12px] text-[var(--workspace-text-muted)]">
                  <span>{visibleMessageCount} messages</span>
                  <ChevronDown className="size-3" />
                </div>

                <ArtifactPills session={session} />
                <AssistantBlock session={session} />

                {session.attentionRequired ? (
                  <div className="rounded-[1rem] border border-amber-300/15 bg-amber-300/8 px-4 py-3">
                    <div className="mb-1 text-[12px] text-amber-100/80">Attention</div>
                    <p className="text-[13px] leading-6 text-amber-50/85">
                      {session.attentionReason || "This session requires user input."}
                    </p>
                  </div>
                ) : null}

                {session.lastInputHint ? (
                  <div className="flex justify-end">
                    <div className="max-w-[520px] rounded-[1rem] border border-[color:var(--workspace-border-strong)] bg-[var(--workspace-hover-bg)] px-4 py-3 text-[13.5px] leading-7 text-[var(--workspace-text-primary)]">
                      {session.lastInputHint}
                    </div>
                  </div>
                ) : null}

                <ArtifactStrip session={session} />

                {formatSessionStatus(session.status).toLowerCase() !== "completed" ? (
                  <TypingIndicator />
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
  const summary = session.summary || "Codex is working..."

  return (
    <div className="space-y-4">
      <div className="inline-flex items-center gap-2 rounded-md bg-[var(--workspace-hover-bg)] px-3 py-1.5 text-[12px] text-[var(--workspace-text-secondary)]">
        <span>{formatUpdatedAt(session.updatedAt)}</span>
        <span>•</span>
        <span>{formatSessionStatus(session.status).toLowerCase()}</span>
      </div>

      <div className="inline-flex items-center gap-2 rounded-md bg-[var(--workspace-tag-bg)] px-2.5 py-1 text-[12px] text-[var(--workspace-text-secondary)]">
        <FolderGit2 className="size-3.5" />
        <span>{session.project?.name || "Local project"}</span>
      </div>

      <ReviewMessage text={summary} />
    </div>
  )
}

function ReviewMessage({ text }: { text: string }) {
  const blocks = text
    .split(/\n{2,}/)
    .map((block) => block.trim())
    .filter(Boolean)

  return (
    <div className="space-y-5">
      {blocks.map((block, index) => {
        const lines = block.split("\n").map((line) => line.trimEnd()).filter(Boolean)
        const firstLine = lines[0]?.trim().toLowerCase() || ""
        const hasDiagramLikeRows = lines.slice(1).some((line) => /^(→|->)/.test(line.trim()))
        const isInsetCard =
          firstLine === "architecture" || (lines.length >= 4 && hasDiagramLikeRows)

        if (isInsetCard) {
          return (
            <div
              key={`${block}-${index}`}
              className="rounded-[1rem] border border-[color:var(--workspace-border)] bg-[var(--workspace-hover-bg-soft)] px-4 py-4"
            >
              <div className="mb-3 text-[12px] text-[var(--workspace-text-muted)]">
                {lines[0]}
              </div>
              <pre className="m-0 whitespace-pre-wrap font-mono text-[13px] leading-7 text-[var(--workspace-text-secondary)]">
                {lines.slice(1).join("\n")}
              </pre>
            </div>
          )
        }

        return (
          <SessionRichText
            key={`${block}-${index}`}
            text={block}
            className="space-y-3 text-[14px] leading-8 text-[var(--workspace-text-primary)]"
          />
        )
      })}
    </div>
  )
}

function ArtifactPills({
  session,
}: {
  session: NonNullable<ReturnType<typeof useSession>["data"]>
}) {
  const referencedFiles = parseReferencedFiles(session.summary || "")
  const fallbackPills =
    session.artifacts.length === 0
      ? referencedFiles.length > 0
        ? [
            {
              id: "referenced-files",
              label: `Referenced ${referencedFiles.length} file${referencedFiles.length === 1 ? "" : "s"}`,
            },
          ]
        : []
      : []

  const pills = session.artifacts.slice(0, 4).map((artifact) => ({
    id: artifact.id,
    label: artifact.label,
  }))

  const visiblePills = pills.length > 0 ? pills : fallbackPills

  if (visiblePills.length === 0) {
    return null
  }

  return (
    <div className="flex flex-wrap gap-2">
      {visiblePills.map((artifact) => (
        <button
          key={artifact.id}
          type="button"
          className="inline-flex items-center gap-2 rounded-md border border-[color:var(--workspace-border)] bg-[var(--workspace-hover-bg)] px-3 py-1.5 text-[12px] text-[var(--workspace-text-secondary)] transition hover:bg-[var(--workspace-active-bg)]"
        >
          <FileText className="size-3.5 text-[var(--workspace-text-muted)]" />
          <span>{artifact.label}</span>
        </button>
      ))}
    </div>
  )
}

function ArtifactStrip({
  session,
}: {
  session: NonNullable<ReturnType<typeof useSession>["data"]>
}) {
  if (session.artifacts.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {session.artifacts.slice(0, 2).map((artifact) => (
        <div
          key={artifact.id}
          className="rounded-[1rem] border border-[color:var(--workspace-border)] bg-[var(--workspace-surface-bg)] px-4 py-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] text-[var(--workspace-text-primary)]">
                {artifact.label}
              </div>
              <div className="mt-1 text-[12px] text-[var(--workspace-text-muted)]">
                {formatArtifactKind(artifact.kind)}
              </div>
            </div>
            {artifact.downloadUrl ? (
              <a
                href={artifact.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md border border-[color:var(--workspace-border)] bg-[var(--workspace-tag-bg)] px-2.5 py-1 text-[11px] text-[var(--workspace-text-secondary)] transition hover:bg-[var(--workspace-hover-bg)]"
              >
                Open
              </a>
            ) : null}
          </div>
        </div>
      ))}
    </div>
  )
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 pb-2 text-[12px] text-[var(--workspace-text-muted)]">
      <div className="flex items-center gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-[var(--workspace-text-muted)]" />
        <span className="size-1.5 animate-pulse rounded-full bg-[var(--workspace-text-muted)] [animation-delay:140ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-[var(--workspace-text-muted)] [animation-delay:280ms]" />
      </div>
      <span>Thinking...</span>
    </div>
  )
}
