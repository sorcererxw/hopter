import { useMemo, useState } from "react"
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileCode,
  FileText,
  Lightbulb,
  Terminal,
  Wrench,
} from "lucide-react"
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

export function HomeWorkspacePane() {
  const navigate = useNavigate()
  const createSession = useCreateSession()
  const { data: projects, isLoading: projectsLoading } = useProjects()
  const [selectedBackendKeyState, setSelectedBackendKeyState] = useState("")
  const [selectedProjectIdState, setSelectedProjectIdState] = useState("")
  const [prompt, setPrompt] = useState("")
  const selectedProjectId = selectedProjectIdState || projects?.[0]?.id || ""

  const selectedProject = useMemo(
    () => projects?.find((project) => project.id === selectedProjectId),
    [projects, selectedProjectId]
  )
  const selectedBackendKey =
    selectedBackendKeyState || selectedProject?.defaultBackend || "codex"

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        title="New Thread"
        projectName={selectedProject?.name}
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
              <ChevronDown className="pointer-events-none absolute right-0 size-3 text-muted-foreground" />
            </label>

            <label className="relative mt-2 inline-flex items-center gap-1 text-xs uppercase tracking-wider text-ws-text-muted">
              <select
                value={selectedBackendKey}
                onChange={(event) => setSelectedBackendKeyState(event.target.value)}
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

export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
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
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        title={session?.title || "Thread"}
        projectName={session?.project?.name || "Local"}
        sessionId={sessionId}
        inspectorOpen={inspectorOpen}
        onOpenReview={() => {
          setActiveTab("review")
          setInspectorOpen(true)
        }}
        onToggleInspector={() => setInspectorOpen((current) => !current)}
        showInspectorToggle
        showReview
      />

      {sessionQuery.isLoading ? (
        <div className="flex flex-1 items-center justify-center px-6 text-sm text-muted-foreground">
          Loading thread...
        </div>
      ) : sessionQuery.isError || !session ? (
        <div className="flex flex-1 items-center justify-center px-6">
          <div className="rounded-lg border border-border bg-muted px-6 py-4 text-sm text-foreground">
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
                  <div className="rounded-lg border border-amber-300/15 bg-amber-300/8 px-4 py-3">
                    <div className="mb-1 text-sm font-semibold text-amber-100/80">
                      Attention
                    </div>
                    <p className="text-base font-medium leading-7 text-amber-50/85">
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
              composerTestId="session-composer"
              inputTestId="session-prompt-input"
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
              submitTestId="session-followup-submit"
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
          className="inline-flex items-center gap-2 rounded-md border border-border bg-accent px-3 py-1.5 text-xs text-muted-foreground transition hover:bg-accent"
        >
          <FileText className="size-3.5 text-muted-foreground" />
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
          className="rounded-lg border border-border bg-card px-4 py-4"
        >
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <div className="truncate text-sm text-foreground">
                {artifact.label}
              </div>
              <div className="mt-1 text-xs text-muted-foreground">
                {formatArtifactKind(artifact.kind)}
              </div>
            </div>
            {artifact.downloadUrl ? (
              <a
                href={artifact.downloadUrl}
                target="_blank"
                rel="noreferrer"
                className="shrink-0 rounded-md border border-border bg-secondary px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent"
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
    <div className="space-y-5" data-testid="session-transcript">
      {items.map((item) =>
        item.kind === "transcript" ? (
          <TranscriptEntry key={item.key} item={item.item} />
        ) : (
          <PendingInputEntry key={item.key} text={item.text} />
        )
      )}
    </div>
  )
}

function PendingInputEntry({ text }: { text: string }) {
  return (
    <div className="flex justify-end" data-testid="session-transcript-pending">
      <div className="max-w-[85%]">
        <SessionRichText
          text={text}
          className="rounded-lg bg-accent px-4 py-3"
        />
      </div>
    </div>
  )
}

function TranscriptEntry({ item }: { item: SessionTranscriptItem }) {
  switch (item.kind) {
    case SessionTranscriptItemKind.USER_MESSAGE:
      return <UserMessageEntry item={item} />
    case SessionTranscriptItemKind.AGENT_MESSAGE:
      return <AgentMessageEntry item={item} />
    case SessionTranscriptItemKind.REASONING:
      return <ReasoningEntry item={item} />
    case SessionTranscriptItemKind.TOOL_CALL:
      return <ToolCallEntry item={item} />
    case SessionTranscriptItemKind.COMMAND_EXECUTION:
      return <CommandEntry item={item} />
    case SessionTranscriptItemKind.FILE_CHANGE:
      return <FileChangeEntry item={item} />
    default:
      return <AgentMessageEntry item={item} />
  }
}

function UserMessageEntry({ item }: { item: SessionTranscriptItem }) {
  return (
    <div className="flex justify-end" data-testid="session-transcript-user">
      <div className="max-w-[85%]">
        <SessionRichText
          text={item.body}
          className="rounded-lg bg-accent px-4 py-3"
        />
      </div>
    </div>
  )
}

function AgentMessageEntry({ item }: { item: SessionTranscriptItem }) {
  return (
    <div className="flex gap-3">
      <div className="mt-1 flex size-6 shrink-0 items-center justify-center rounded-full bg-accent">
        <Bot className="size-3.5 text-foreground/60" />
      </div>
      <div className="min-w-0 flex-1">
        <SessionRichText text={item.body} />
      </div>
    </div>
  )
}

function ReasoningEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const label = item.title || "Thinking"
  const preview = item.body.split("\n")[0]?.slice(0, 120) || ""

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Lightbulb className="size-3.5 text-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm text-foreground/70 transition hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <span className="font-medium">{label}</span>
          {!expanded && preview ? (
            <span className="truncate text-muted-foreground">— {preview}</span>
          ) : null}
        </button>
        {expanded ? (
          <SessionRichText
            text={item.body}
            className="mt-2 text-foreground/70"
          />
        ) : null}
      </div>
    </div>
  )
}

function ToolCallEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const label = item.title || "Tool call"

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Wrench className="size-3.5 text-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm text-foreground/70 transition hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <span className="font-medium">{label}</span>
        </button>
        {expanded ? (
          <pre className="workspace-scrollbar mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground/70">
            {item.body}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

function CommandEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const label = item.title || "Command"

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <Terminal className="size-3.5 text-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm text-foreground/70 transition hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <span className="font-medium">{label}</span>
        </button>
        {expanded ? (
          <pre className="workspace-scrollbar mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground/70">
            {item.body}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

function FileChangeEntry({ item }: { item: SessionTranscriptItem }) {
  const [expanded, setExpanded] = useState(false)
  const label = item.title || "File change"

  return (
    <div className="flex gap-3">
      <div className="mt-0.5 flex size-6 shrink-0 items-center justify-center rounded-full bg-muted">
        <FileCode className="size-3.5 text-foreground/50" />
      </div>
      <div className="min-w-0 flex-1">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="flex items-center gap-1.5 text-sm text-foreground/70 transition hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <span className="font-medium">{label}</span>
        </button>
        {expanded ? (
          <pre className="workspace-scrollbar mt-2 overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground/70">
            {item.body}
          </pre>
        ) : null}
      </div>
    </div>
  )
}

function normalizeTranscriptText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span className="size-1.5 animate-pulse rounded-full bg-primary-muted" />
        <span className="size-1.5 animate-pulse rounded-full bg-primary-muted [animation-delay:140ms]" />
        <span className="size-1.5 animate-pulse rounded-full bg-primary-muted [animation-delay:280ms]" />
      </div>
      <span>Thinking...</span>
    </div>
  )
}
