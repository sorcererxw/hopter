import { useMemo, useState } from "react"
import {
  Bot,
  ChevronDown,
  FileText,
  PenLine,
  Sparkles,
} from "lucide-react"
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
import {
  SessionTranscriptItemKind,
  type Session,
  type SessionTranscriptItem,
} from "@/gen/proto/orchd/v1/session_pb"
import {
  formatArtifactKind,
  formatSessionStatus,
} from "@/lib/format/proto"

function deriveTitle(prompt: string) {
  const normalized = prompt.trim().replace(/\s+/g, " ")
  return normalized.slice(0, 72)
}

const HOME_SUGGESTIONS: Array<{
  icon: LucideIcon
  text: string
  tone: string
}> = [
  {
    icon: Sparkles,
    text: "Build a classic Snake game in this repo.",
    tone: "text-ws-text-sub",
  },
  {
    icon: FileText,
    text: "Create a one-page summary of this app.",
    tone: "text-orange-400",
  },
  {
    icon: PenLine,
    text: "Create a plan to finish the next milestone.",
    tone: "text-amber-400",
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
    <div className="flex h-full min-h-0 flex-col bg-ws-page">
      <WorkspaceTopbar
        title="New Thread"
        tag={selectedProject?.name}
        onOpenProject={() => navigate("/projects/new")}
      />

      <div className="flex min-h-0 flex-1 flex-col">
        <div className="workspace-scrollbar flex-1 overflow-y-auto">
          <div className="mx-auto flex min-h-full w-full max-w-[820px] flex-col items-center justify-center px-6 pt-6 pb-20">
            <div className="mb-4 flex size-14 items-center justify-center rounded-2xl border border-ws-border-strong bg-ws-hover">
              <Bot className="size-7 text-ws-text" />
            </div>

            <h2 className="text-[22px] font-medium text-ws-text">
              Start building
            </h2>

            <label className="relative mt-1 inline-flex items-center gap-1 text-sm text-ws-text-muted">
              <select
                value={selectedProjectId}
                onChange={(event) =>
                  setSelectedProjectIdState(event.target.value)
                }
                className="min-w-52 appearance-none bg-transparent pr-5 text-center outline-none"
              >
                <option value="">
                  {projectsLoading ? "Loading projects..." : "Select project"}
                </option>
                {projects?.map((project) => (
                  <option key={project.id} value={project.id}>
                    {project.name}
                  </option>
                ))}
              </select>
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-ws-text-muted" />
            </label>

            <div className="mt-8 grid w-full max-w-[700px] gap-3 md:grid-cols-3">
              {HOME_SUGGESTIONS.map(({ icon: Icon, text, tone }) => (
                <button
                  key={text}
                  type="button"
                  onClick={() => setPrompt(text)}
                  className="flex items-center gap-3 rounded-2xl border border-ws-tool-border bg-ws-tool p-4 text-left transition hover:bg-ws-hover md:flex-col md:items-start"
                >
                  <Icon className={`size-4 shrink-0 ${tone}`} />
                  <span className="text-[12.5px] leading-[1.55] text-ws-text-sub">
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
  const transcriptItems = useMemo(() => {
    return (session?.transcriptItems ?? []).filter(
      (item) => item.body.trim().length > 0
    )
  }, [session?.transcriptItems])
  const showPendingInputHint = useMemo(() => {
    if (!session) {
      return false
    }

    const normalizedHint = normalizeTranscriptText(session.lastInputHint)
    if (!normalizedHint) {
      return false
    }

    return !transcriptItems.some(
      (item) =>
        item.kind === SessionTranscriptItemKind.USER_MESSAGE &&
        normalizeTranscriptText(item.body).startsWith(normalizedHint)
    )
  }, [session, transcriptItems])
  const activityItems = useMemo(() => {
    const items: ActivityItem[] = transcriptItems.map((item) => ({
      item,
      kind: "transcript" as const,
      key: item.id,
    }))

    if (session && showPendingInputHint) {
      items.push({
        kind: "pending-input" as const,
        key: "pending-input",
        text: session.lastInputHint,
      })
    }

    return items
  }, [session, showPendingInputHint, transcriptItems])

  return (
    <div className="flex h-full min-h-0 flex-col bg-ws-page">
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
        <div className="flex flex-1 items-center justify-center px-6 text-[13px] text-ws-text-muted">
          Loading thread...
        </div>
      ) : sessionQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-2xl border border-ws-border bg-ws-hover-soft px-6 py-4 text-xs text-ws-text-muted">
            This thread is temporarily unavailable.
          </div>
        </div>
      ) : (
        <div className="flex min-h-0 flex-1">
          <div className="flex min-w-0 flex-1 flex-col">
            <div className="workspace-scrollbar flex-1 overflow-y-auto px-6 py-4">
              <div className="mx-auto max-w-[720px] space-y-5">
                <ArtifactPills session={session} />

                {session.attentionRequired ? (
                  <div className="rounded-2xl border border-amber-300/15 bg-amber-300/8 px-4 py-3">
                    <div className="mb-1 text-[12px] text-amber-100/80">
                      Attention
                    </div>
                    <p className="text-[13px] leading-6 text-amber-50/85">
                      {session.attentionReason ||
                        "This session requires user input."}
                    </p>
                  </div>
                ) : null}

                <TranscriptTimeline items={activityItems} />
                <ArtifactStrip session={session} />

                {formatSessionStatus(session.status).toLowerCase() !==
                "completed" ? (
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
                await sendInput.mutateAsync({
                  input: normalizedPrompt,
                  sessionId,
                })
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

function ArtifactPills({ session }: { session: Session }) {
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
          className="inline-flex items-center gap-2 rounded-md border border-ws-border bg-ws-hover px-3 py-1.5 text-xs text-ws-text-sub transition hover:bg-ws-active"
        >
          <FileText className="size-3.5 text-ws-text-muted" />
          <span>{artifact.label}</span>
        </button>
      ))}
    </div>
  )
}

function ArtifactStrip({ session }: { session: Session }) {
  if (session.artifacts.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      {session.artifacts.slice(0, 2).map((artifact) => (
        <div
          key={artifact.id}
          className="rounded-2xl border border-ws-border bg-ws-surface px-4 py-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-[13px] text-ws-text">
                {artifact.label}
              </div>
              <div className="mt-1 text-xs text-ws-text-muted">
                {formatArtifactKind(artifact.kind)}
              </div>
            </div>
            {artifact.downloadUrl ? (
              <a
                href={artifact.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md border border-ws-border bg-ws-tag px-2.5 py-1 text-[11px] text-ws-text-sub transition hover:bg-ws-hover"
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

type ActivityItem =
  | {
      item: SessionTranscriptItem
      kind: "transcript"
      key: string
    }
  | {
      key: string
      kind: "pending-input"
      text: string
    }

function TranscriptTimeline({ items }: { items: ActivityItem[] }) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="space-y-3">
      <div className="text-[11px] font-semibold tracking-[0.08em] text-ws-text-muted uppercase">
        Activity
      </div>
      {items.map((item) =>
        item.kind === "transcript" ? (
          <TranscriptItemCard key={item.key} item={item.item} />
        ) : (
          <PendingInputCard key={item.key} text={item.text} />
        )
      )}
    </div>
  )
}

function PendingInputCard({ text }: { text: string }) {
  return (
    <div className="flex justify-end">
      <div className="max-w-[560px] rounded-2xl border border-ws-border-strong bg-ws-hover px-4 py-3">
        <div className="mb-2 text-xs text-ws-text-muted">
          You
        </div>
        <SessionRichText
          text={text}
          className="space-y-3 text-[13.5px] leading-7 text-ws-text"
        />
      </div>
    </div>
  )
}

function TranscriptItemCard({ item }: { item: SessionTranscriptItem }) {
  const label = item.title || transcriptItemLabel(item.kind)

  switch (item.kind) {
    case SessionTranscriptItemKind.USER_MESSAGE:
      return (
        <div className="flex justify-end">
          <div className="max-w-[560px] rounded-2xl border border-ws-border-strong bg-ws-hover px-4 py-3">
            <div className="mb-2 text-xs text-ws-text-muted">
              {label}
            </div>
            <SessionRichText
              text={item.body}
              className="space-y-3 text-[13.5px] leading-7 text-ws-text"
            />
          </div>
        </div>
      )
    case SessionTranscriptItemKind.AGENT_MESSAGE:
      return (
        <div className="rounded-2xl border border-ws-border bg-ws-surface px-4 py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs text-ws-text-muted">
              {label}
            </div>
            <TranscriptStatus status={item.status} />
          </div>
          <SessionRichText
            text={item.body}
            className="space-y-3 text-[13.5px] leading-7 text-ws-text"
          />
        </div>
      )
    case SessionTranscriptItemKind.REASONING:
      return (
        <div className="rounded-2xl border border-dashed border-ws-border bg-ws-hover-soft px-4 py-4">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="text-xs text-ws-text-muted">
              {label}
            </div>
            <TranscriptStatus status={item.status} />
          </div>
          <SessionRichText
            text={item.body}
            className="space-y-3 text-[13px] leading-7 text-ws-text-sub"
          />
        </div>
      )
    default:
      return (
        <div className="rounded-2xl border border-ws-border bg-ws-surface px-4 py-4">
          <div className="mb-3 flex items-center justify-between gap-3">
            <div className="text-xs text-ws-text-sub">
              {label}
            </div>
            <TranscriptStatus status={item.status} />
          </div>
          <pre className="workspace-scrollbar m-0 overflow-x-auto font-mono text-xs leading-6 break-words whitespace-pre-wrap text-ws-text">
            {item.body}
          </pre>
        </div>
      )
  }
}

function TranscriptStatus({ status }: { status: string }) {
  if (!status.trim()) {
    return null
  }

  return (
    <span className="rounded-md border border-ws-border bg-ws-tag px-2 py-0.5 text-[10px] tracking-[0.08em] text-ws-text-muted uppercase">
      {status}
    </span>
  )
}

function transcriptItemLabel(kind: SessionTranscriptItemKind) {
  switch (kind) {
    case SessionTranscriptItemKind.USER_MESSAGE:
      return "You"
    case SessionTranscriptItemKind.AGENT_MESSAGE:
      return "Codex"
    case SessionTranscriptItemKind.REASONING:
      return "Thinking"
    case SessionTranscriptItemKind.TOOL_CALL:
      return "Tool call"
    case SessionTranscriptItemKind.COMMAND_EXECUTION:
      return "Command"
    case SessionTranscriptItemKind.FILE_CHANGE:
      return "File change"
    default:
      return "Activity"
  }
}

function normalizeTranscriptText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 pb-2 text-xs text-ws-text-muted">
      <div className="flex items-center gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-ws-text-muted" />
        <span className="size-1.5 animate-pulse rounded-full bg-ws-text-muted [animation-delay:140ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-ws-text-muted [animation-delay:280ms]" />
      </div>
      <span>Thinking...</span>
    </div>
  )
}
