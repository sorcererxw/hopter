import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Lightbulb,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { parseReferencedFiles } from "@/components/app/session-derived"
import {
  SessionInspectorPane,
  type InspectorSelectedDiff,
} from "@/components/app/session-inspector-pane"
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
import { formatArtifactKind, formatSessionStatus } from "@/lib/format/proto"
import { cn } from "@/lib/utils"

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
      <WorkspaceTopbar title="New Thread" projectName={selectedProject?.name} />

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
  const [selectedDiff, setSelectedDiff] =
    useState<InspectorSelectedDiff | null>(null)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const lastSessionIdRef = useRef(sessionId)
  const lastActivityCountRef = useRef(0)

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

  useEffect(() => {
    setSelectedDiff(null)
  }, [sessionId])

  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    const nextCount = activityItems.length
    const sessionChanged = lastSessionIdRef.current !== sessionId
    const countChanged = nextCount !== lastActivityCountRef.current

    if (sessionChanged || (countChanged && shouldStickToBottomRef.current)) {
      container.scrollTop = container.scrollHeight
    }

    lastSessionIdRef.current = sessionId
    lastActivityCountRef.current = nextCount
  }, [activityItems.length, sessionId])

  function handleTranscriptScroll() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom < 120
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        title={session?.title || "Thread"}
        projectName={session?.project?.name || "Local"}
        sessionId={sessionId}
        inspectorOpen={inspectorOpen}
        onCommit={() => {
          // TODO: wire commit action
        }}
        onCommitAndReview={() => {
          setActiveTab("review")
          setInspectorOpen(true)
        }}
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
            <div
              ref={transcriptScrollRef}
              onScroll={handleTranscriptScroll}
              className="workspace-scrollbar flex-1 overflow-y-auto px-6 py-4"
            >
              <div className="mx-auto max-w-[720px] space-y-5">
                <ArtifactPills session={session} />

                {session.attentionRequired ? (
                  <div className="rounded-lg border border-amber-300/15 bg-amber-300/8 px-4 py-3">
                    <div className="mb-1 text-sm font-semibold text-amber-100/80">
                      Attention
                    </div>
                    <p className="text-base leading-7 font-medium text-amber-50/85">
                      {session.attentionReason ||
                        "This session requires user input."}
                    </p>
                  </div>
                ) : null}

                <TranscriptTimeline
                  items={activityItems}
                  onSelectDiff={(diff) => {
                    setSelectedDiff(diff)
                    setActiveTab("review")
                    setInspectorMode("diff")
                    setInspectorOpen(true)
                  }}
                />
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
              selectedDiff={selectedDiff}
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

function TranscriptTimeline({
  items,
  onSelectDiff,
}: {
  items: ActivityItem[]
  onSelectDiff: (diff: InspectorSelectedDiff) => void
}) {
  if (items.length === 0) {
    return null
  }

  return (
    <div className="space-y-5" data-testid="session-transcript">
      {items.map((item) =>
        item.kind === "transcript" ? (
          <TranscriptEntry
            key={item.key}
            item={item.item}
            onSelectDiff={onSelectDiff}
          />
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

function TranscriptEntry({
  item,
  onSelectDiff,
}: {
  item: SessionTranscriptItem
  onSelectDiff: (diff: InspectorSelectedDiff) => void
}) {
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
      return <FileChangeEntry item={item} onSelectDiff={onSelectDiff} />
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
    <div className="flex gap-3" data-testid="session-transcript-agent">
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
    <div className="flex gap-3" data-testid="session-transcript-reasoning">
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
    <div className="flex gap-3" data-testid="session-transcript-tool">
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
    <div className="min-w-0" data-testid="session-transcript-command">
      <div className="min-w-0">
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

function FileChangeEntry({
  item,
  onSelectDiff,
}: {
  item: SessionTranscriptItem
  onSelectDiff: (diff: InspectorSelectedDiff) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const changes = parseFileChangeBody(item.body)
  const count = changes.length

  return (
    <div className="min-w-0" data-testid="session-transcript-file-change">
      <div className="min-w-0">
        <button
          type="button"
          onClick={() => setExpanded((prev) => !prev)}
          className="group flex w-full items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          {expanded ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronRight className="size-3" />
          )}
          <span>{`Changed ${count} file${count === 1 ? "" : "s"}`}</span>
          <ChevronRight
            className={cn(
              "ml-auto size-3 transition",
              expanded ? "opacity-0" : "opacity-0 group-hover:opacity-100"
            )}
          />
        </button>
        {expanded ? (
          <div className="mt-2 space-y-1.5">
            {changes.map((change) => (
              <button
                key={`${change.path}-${change.kindLabel}`}
                type="button"
                onClick={() => onSelectDiff(change)}
                className="group flex w-full items-center gap-3 rounded-md px-2 py-2 text-left transition hover:bg-accent"
              >
                <span className="shrink-0 text-xs text-muted-foreground">
                  {change.kindLabel}
                </span>
                <span className="min-w-0 truncate font-mono text-sm text-ws-code">
                  {change.path}
                </span>
                {change.additions || change.deletions ? (
                  <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                    +{change.additions} -{change.deletions}
                  </span>
                ) : null}
                <ChevronRight className="size-3 shrink-0 text-muted-foreground opacity-0 transition group-hover:opacity-100" />
              </button>
            ))}
          </div>
        ) : null}
      </div>
    </div>
  )
}

type ParsedFileChange = InspectorSelectedDiff & {
  movePath?: string
}

function parseFileChangeBody(body: string): ParsedFileChange[] {
  const trimmed = body.trim()
  if (!trimmed) {
    return []
  }

  try {
    const parsed = JSON.parse(trimmed) as {
      changes?: Array<{
        additions?: number
        deletions?: number
        diff?: string
        kind?: string
        movePath?: string
        path?: string
      }>
    }

    return (parsed.changes ?? [])
      .filter(
        (change) =>
          typeof change.path === "string" && change.path.trim().length > 0
      )
      .map((change) => ({
        additions: change.additions ?? 0,
        deletions: change.deletions ?? 0,
        diff: change.diff,
        kindLabel: describeFileChangeKind(change.kind),
        movePath: change.movePath,
        path: change.path!.trim(),
      }))
  } catch {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.*?)(?:\s+\(([^)]+)\))?$/)
        const path = match?.[1]?.trim() || line
        const kind = match?.[2]?.trim() || ""
        return {
          additions: 0,
          deletions: 0,
          kindLabel: describeFileChangeKind(kind),
          path,
        }
      })
  }
}

function describeFileChangeKind(kind: string | undefined) {
  switch ((kind || "").toLowerCase()) {
    case "add":
    case "added":
    case "create":
    case "created":
      return "Added"
    case "delete":
    case "deleted":
      return "Deleted"
    case "move":
    case "rename":
    case "renamed":
      return "Moved"
    case "update":
    case "updated":
    case "edit":
    case "edited":
    case "modify":
    case "modified":
      return "Edited"
    default:
      return "Edited"
  }
}

function normalizeTranscriptText(value: string) {
  return value.trim().replace(/\s+/g, " ")
}

function TypingIndicator() {
  return (
    <div className="flex items-center gap-2 pb-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full" />
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full [animation-delay:140ms]" />
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full [animation-delay:280ms]" />
      </div>
      <span>Thinking...</span>
    </div>
  )
}
