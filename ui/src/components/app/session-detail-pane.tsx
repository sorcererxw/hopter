import { useEffect, useMemo, useRef, useState } from "react"
import {
  Bot,
  ChevronDown,
  ChevronRight,
  FileText,
  Lightbulb,
  LoaderCircle,
  Wrench,
} from "lucide-react"
import { useNavigate, useSearchParams } from "react-router-dom"

import { SessionComposer } from "@/components/app/session-composer"
import { parseReferencedFiles } from "@/components/app/session-derived"
import {
  SessionInspectorPane,
  type InspectorSelectedDiff,
} from "@/components/app/session-inspector-pane"
import { SessionRichText } from "@/components/app/session-rich-text"
import { useWorkspaceShell } from "@/components/app/workspace-shell-context"
import { WorkspaceTopbar } from "@/components/app/workspace-topbar"
import { useProjects } from "@/features/projects/use-projects"
import {
  useCreateSession,
  fetchSessionTranscriptPage,
  useSendSessionInput,
  useSessionMeta,
  useSessions,
  useSessionTranscript,
} from "@/features/sessions/use-sessions"
import {
  SessionTranscriptItemKind,
  type Session,
  type SessionMeta,
  type SessionTranscriptPage,
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

export function SessionWorkspacePane({ sessionId }: { sessionId: string }) {
  const navigate = useNavigate()
  const { eventStreamState, posture, toggleRail, toolbarMode } =
    useWorkspaceShell()
  const sessionMetaQuery = useSessionMeta(sessionId)
  const transcriptPollInterval = useMemo(
    () =>
      eventStreamState === "connected"
        ? sessionMetaQuery.data
          ? shouldPollSessionState(sessionMetaQuery.data.status)
            ? 5_000
            : 10_000
          : 5_000
        : sessionMetaQuery.data
          ? shouldPollSessionState(sessionMetaQuery.data.status)
            ? 1500
            : 5000
          : 1500,
    [eventStreamState, sessionMetaQuery.data]
  )
  const latestTranscriptQuery = useSessionTranscript(
    sessionId,
    Boolean(sessionMetaQuery.data),
    undefined,
    transcriptPollInterval
  )
  const sendInput = useSendSessionInput()
  const [prompt, setPrompt] = useState("")
  const [optimisticPendingInput, setOptimisticPendingInput] = useState("")
  const [inspectorOpen, setInspectorOpen] = useState(true)
  const [activeTab, setActiveTab] = useState<"summary" | "review">("review")
  const [inspectorMode, setInspectorMode] = useState<"code" | "diff">("code")
  const [selectedDiff, setSelectedDiff] =
    useState<InspectorSelectedDiff | null>(null)
  const [selectedPath, setSelectedPath] = useState<string | null>(null)
  const [transcriptVisible, setTranscriptVisible] = useState(false)
  const transcriptScrollRef = useRef<HTMLDivElement | null>(null)
  const transcriptContentRef = useRef<HTMLDivElement | null>(null)
  const shouldStickToBottomRef = useRef(true)
  const lastScrollHeightRef = useRef(0)
  const lastSessionIdRef = useRef(sessionId)
  const lastActivityCountRef = useRef(0)
  const prependSnapshotRef = useRef<{
    scrollHeight: number
  } | null>(null)
  const [transcriptPages, setTranscriptPages] = useState<
    SessionTranscriptPage[]
  >([])
  const [isFetchingPreviousPage, setIsFetchingPreviousPage] = useState(false)

  const session = useMemo(
    () => buildSessionDetail(sessionMetaQuery.data, transcriptPages),
    [sessionMetaQuery.data, transcriptPages]
  )
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
  const shouldShowWorkingStatus = Boolean(
    optimisticPendingInput ||
    sendInput.isPending ||
    (session && shouldShowThinkingState(session.status))
  )
  useEffect(() => {
    if (!optimisticPendingInput) {
      return
    }

    const normalizedPending = normalizeTranscriptText(optimisticPendingInput)
    const transcriptHasPending = transcriptItems.some(
      (item) =>
        item.kind === SessionTranscriptItemKind.USER_MESSAGE &&
        normalizeTranscriptText(item.body).startsWith(normalizedPending)
    )
    const serverHasPending =
      session?.lastInputHint &&
      normalizeTranscriptText(session.lastInputHint).startsWith(
        normalizedPending
      )

    if (transcriptHasPending || serverHasPending) {
      setOptimisticPendingInput("")
    }
  }, [optimisticPendingInput, session?.lastInputHint, transcriptItems])
  const activityItems = useMemo(() => {
    const items: ActivityItem[] = transcriptItems.map((item) => ({
      item,
      kind: "transcript" as const,
      key: item.id,
    }))

    if (optimisticPendingInput) {
      items.push({
        kind: "pending-input" as const,
        key: "optimistic-pending-input",
        text: optimisticPendingInput,
      })
    } else if (session && showPendingInputHint) {
      items.push({
        kind: "pending-input" as const,
        key: "pending-input",
        text: session.lastInputHint,
      })
    }

    if (session && shouldShowWorkingStatus) {
      const localRoundInFlight =
        sendInput.isPending || Boolean(optimisticPendingInput)
      items.push({
        kind: "thinking" as const,
        key: "thinking",
        summary: localRoundInFlight
          ? "Codex is working on your latest message…"
          : session.summary?.trim() || "Codex is thinking…",
      })
    } else if (session) {
      items.push({
        kind: "round-status" as const,
        key: "round-status",
        state: shouldShowAttentionState(session.status)
          ? "attention"
          : "finished",
        summary: shouldShowAttentionState(session.status)
          ? session.attentionReason?.trim() || "This round needs attention."
          : "This round has finished.",
      })
    }

    return items
  }, [
    optimisticPendingInput,
    sendInput.isPending,
    session,
    shouldShowWorkingStatus,
    showPendingInputHint,
    transcriptItems,
  ])
  const transcriptPageCount = transcriptPages.length
  const lastActivityKey = activityItems.at(-1)?.key ?? ""
  const hasMoreBefore =
    transcriptPages[0]?.hasMoreBefore ??
    sessionMetaQuery.data?.hasMoreBefore ??
    false
  const isLoadingInitialTranscript =
    latestTranscriptQuery.isLoading && activityItems.length === 0

  useEffect(() => {
    if (posture !== "wide") {
      setInspectorOpen(false)
    }
  }, [posture])

  useEffect(() => {
    if (!latestTranscriptQuery.data) {
      setTranscriptPages([])
      return
    }
    setTranscriptPages([latestTranscriptQuery.data])
  }, [latestTranscriptQuery.data, sessionId])

  useEffect(() => {
    setSelectedDiff(null)
    setSelectedPath(null)
    setOptimisticPendingInput("")
    prependSnapshotRef.current = null
  }, [sessionId])

  useEffect(() => {
    if (isLoadingInitialTranscript) {
      setTranscriptVisible(false)
      return
    }

    const frame = window.requestAnimationFrame(() => {
      setTranscriptVisible(true)
    })

    return () => window.cancelAnimationFrame(frame)
  }, [activityItems.length, isLoadingInitialTranscript, sessionId])

  useEffect(() => {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    const nextCount = activityItems.length
    const sessionChanged = lastSessionIdRef.current !== sessionId
    const countChanged = nextCount !== lastActivityCountRef.current
    const lastKeyChanged =
      !sessionChanged && countChanged && lastActivityKey !== ""

    if (sessionChanged || (lastKeyChanged && shouldStickToBottomRef.current)) {
      container.scrollTop = container.scrollHeight
    }

    lastSessionIdRef.current = sessionId
    lastActivityCountRef.current = nextCount
  }, [activityItems.length, lastActivityKey, sessionId])

  useEffect(() => {
    const container = transcriptScrollRef.current
    const content = transcriptContentRef.current
    if (!container || !content || typeof ResizeObserver === "undefined") {
      return
    }

    lastScrollHeightRef.current = container.scrollHeight

    const observer = new ResizeObserver(() => {
      const nextScrollHeight = container.scrollHeight
      const grew = nextScrollHeight > lastScrollHeightRef.current
      lastScrollHeightRef.current = nextScrollHeight

      if (
        !grew ||
        prependSnapshotRef.current ||
        !shouldStickToBottomRef.current
      ) {
        return
      }

      container.scrollTop = container.scrollHeight
    })

    observer.observe(content)

    return () => observer.disconnect()
  }, [sessionId])

  useEffect(() => {
    const container = transcriptScrollRef.current
    const snapshot = prependSnapshotRef.current
    if (!container || !snapshot) {
      return
    }
    if (isFetchingPreviousPage) {
      return
    }
    if (transcriptPageCount < 2) {
      return
    }

    const delta = container.scrollHeight - snapshot.scrollHeight
    container.scrollTop += delta
    prependSnapshotRef.current = null
  }, [transcriptPageCount, isFetchingPreviousPage])

  function handleTranscriptScroll() {
    const container = transcriptScrollRef.current
    if (!container) {
      return
    }

    const distanceFromBottom =
      container.scrollHeight - container.scrollTop - container.clientHeight
    shouldStickToBottomRef.current = distanceFromBottom < 120

    if (container.scrollTop <= 80 && hasMoreBefore && !isFetchingPreviousPage) {
      const beforeCursor = transcriptPages[0]?.nextBeforeCursor
      if (!beforeCursor) {
        return
      }
      prependSnapshotRef.current = {
        scrollHeight: container.scrollHeight,
      }
      setIsFetchingPreviousPage(true)
      void fetchSessionTranscriptPage(sessionId, beforeCursor)
        .then((page) => {
          if (!page) {
            return
          }
          setTranscriptPages((current) => [page, ...current])
        })
        .finally(() => {
          setIsFetchingPreviousPage(false)
        })
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-background">
      <WorkspaceTopbar
        leadingAction={posture === "phone" ? "back" : "toggle-rail"}
        onLeadingAction={() => {
          if (posture === "phone") {
            navigate("/")
            return
          }

          toggleRail()
        }}
        title={session?.title || "Thread"}
        projectName={session?.project?.name || "Local"}
        resumeCommand={sessionMetaQuery.data?.resumeCommand}
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
          if (posture === "wide") {
            setInspectorOpen(true)
          }
        }}
        onToggleInspector={
          posture === "wide"
            ? () => setInspectorOpen((current) => !current)
            : undefined
        }
        showInspectorToggle={posture === "wide"}
        showReview
        syncState={eventStreamState}
        toolbarMode={toolbarMode}
      />

      {sessionMetaQuery.isLoading ? (
        <CenteredTranscriptLoader />
      ) : sessionMetaQuery.isError || !session ? (
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
              className="workspace-scrollbar relative flex-1 overflow-y-auto px-6 py-4"
            >
              <div
                ref={transcriptContentRef}
                className={cn(
                  "mx-auto max-w-[720px] space-y-5 transition-opacity duration-200 ease-out",
                  transcriptVisible ? "opacity-100" : "opacity-0"
                )}
              >
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
                  isFetchingPreviousPage={isFetchingPreviousPage}
                  isLoadingInitialTranscript={isLoadingInitialTranscript}
                  onSelectDiff={(diff) => {
                    setSelectedDiff(diff)
                    setSelectedPath(null)
                    setActiveTab("review")
                    setInspectorMode("diff")
                    if (posture === "wide") {
                      setInspectorOpen(true)
                    }
                  }}
                  onSelectPath={(path) => {
                    setSelectedPath(path)
                    setSelectedDiff(null)
                    setActiveTab("summary")
                    setInspectorMode("code")
                    if (posture === "wide") {
                      setInspectorOpen(true)
                    }
                  }}
                />
                <ArtifactStrip session={session} />
              </div>
              {!transcriptVisible ? (
                <div className="pointer-events-none absolute inset-x-0 top-0 flex min-h-full items-center justify-center">
                  <InitialTranscriptLoader />
                </div>
              ) : null}
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
                setPrompt("")
                setOptimisticPendingInput(normalizedPrompt)
                try {
                  await sendInput.mutateAsync({
                    input: normalizedPrompt,
                    sessionId,
                  })
                } catch (error) {
                  setOptimisticPendingInput("")
                  setPrompt(normalizedPrompt)
                  throw error
                }
              }}
              submitTestId="session-followup-submit"
              value={prompt}
            />
          </div>

          {posture === "wide" && inspectorOpen ? (
            <SessionInspectorPane
              activeTab={activeTab}
              mode={inspectorMode}
              onClose={() => setInspectorOpen(false)}
              onModeChange={setInspectorMode}
              onTabChange={setActiveTab}
              selectedDiff={selectedDiff}
              selectedPath={selectedPath}
              session={session}
            />
          ) : null}
        </div>
      )}
    </div>
  )
}

function buildSessionDetail(
  meta: SessionMeta | undefined,
  pages:
    | Array<
        | {
            items?: SessionTranscriptItem[]
          }
        | undefined
      >
    | undefined
): Session | undefined {
  if (!meta) {
    return undefined
  }

  const transcriptItems = (pages ?? []).flatMap((page) => page?.items ?? [])

  return {
    id: meta.id,
    title: meta.title,
    project: meta.project,
    status: meta.status,
    summary: meta.summary,
    attentionRequired: meta.attentionRequired,
    attentionReason: meta.attentionReason,
    lastInputHint: meta.lastInputHint,
    updatedAt: meta.updatedAt,
    artifacts: meta.artifacts,
    transcriptItems,
    backendKey: meta.backendKey,
  } as Session
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
      kind: "thinking"
      summary: string
    }
  | {
      key: string
      kind: "round-status"
      state: "finished" | "attention"
      summary: string
    }
  | {
      key: string
      kind: "pending-input"
      text: string
    }

type TimelineItem =
  | {
      item: SessionTranscriptItem
      kind: "transcript"
      key: string
    }
  | {
      key: string
      kind: "thinking"
      summary: string
    }
  | {
      key: string
      kind: "round-status"
      state: "finished" | "attention"
      summary: string
    }
  | {
      key: string
      kind: "pending-input"
      text: string
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "command-group"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "file-change-group"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "tool-group"
    }
  | {
      items: SessionTranscriptItem[]
      key: string
      kind: "thought-group"
    }

function isTranscriptActivityItem(
  item: ActivityItem
): item is Extract<ActivityItem, { kind: "transcript" }> {
  return item.kind === "transcript"
}

function TranscriptTimeline({
  items,
  isFetchingPreviousPage,
  isLoadingInitialTranscript,
  onSelectDiff,
  onSelectPath,
}: {
  items: ActivityItem[]
  isFetchingPreviousPage: boolean
  isLoadingInitialTranscript: boolean
  onSelectDiff: (diff: InspectorSelectedDiff) => void
  onSelectPath: (path: string) => void
}) {
  const timelineItems = groupTimelineItems(items)

  if (timelineItems.length === 0 && !isLoadingInitialTranscript) {
    return null
  }

  return (
    <div className="space-y-5" data-testid="session-transcript">
      {isFetchingPreviousPage ? <TranscriptLoadingRow /> : null}
      {timelineItems.map((item) => {
        switch (item.kind) {
          case "transcript":
            return (
              <TranscriptEntry
                key={item.key}
                item={item.item}
                onSelectDiff={onSelectDiff}
                onSelectPath={onSelectPath}
              />
            )
          case "thinking":
            return <ThinkingEntry key={item.key} summary={item.summary} />
          case "round-status":
            return (
              <RoundStatusEntry
                key={item.key}
                state={item.state}
                summary={item.summary}
              />
            )
          case "pending-input":
            return <PendingInputEntry key={item.key} text={item.text} />
          case "command-group":
            return <CommandGroupEntry key={item.key} items={item.items} />
          case "file-change-group":
            return (
              <FileChangeGroupEntry
                key={item.key}
                items={item.items}
                onSelectDiff={onSelectDiff}
              />
            )
          case "tool-group":
            return <ToolGroupEntry key={item.key} items={item.items} />
          case "thought-group":
            return (
              <ThoughtProcessGroupEntry
                key={item.key}
                items={item.items}
                onSelectDiff={onSelectDiff}
                onSelectPath={onSelectPath}
              />
            )
        }
      })}
    </div>
  )
}

function TranscriptLoadingRow() {
  return (
    <div
      className="flex items-center justify-center py-2"
      data-testid="session-transcript-loading"
    >
      <div className="inline-flex size-8 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm">
        <LoaderCircle className="size-4 animate-spin" />
      </div>
    </div>
  )
}

function InitialTranscriptLoader() {
  return (
    <div
      className="inline-flex size-12 items-center justify-center rounded-full border border-border bg-card/90 text-muted-foreground shadow-sm"
      data-testid="session-transcript-loading-initial"
    >
      <LoaderCircle className="size-5 animate-spin" />
    </div>
  )
}

function CenteredTranscriptLoader() {
  return (
    <div className="flex flex-1 items-center justify-center px-6">
      <InitialTranscriptLoader />
    </div>
  )
}

function groupTimelineItems(items: ActivityItem[]): TimelineItem[] {
  const timelineItems: TimelineItem[] = []
  let cursor = 0

  while (cursor < items.length) {
    const current = items[cursor]

    if (!isTranscriptActivityItem(current)) {
      timelineItems.push(current)
      cursor += 1
      continue
    }

    if (isThoughtProcessTranscriptItem(current.item)) {
      const thoughtItems: SessionTranscriptItem[] = [current.item]
      let next = cursor + 1
      while (next < items.length) {
        const candidate = items[next]
        if (
          !isTranscriptActivityItem(candidate) ||
          !isThoughtProcessTranscriptItem(candidate.item)
        ) {
          break
        }
        thoughtItems.push(candidate.item)
        next += 1
      }

      const previousItem = cursor > 0 ? items[cursor - 1] : null
      if (
        previousItem &&
        previousItem.kind !== "thinking" &&
        (!isTranscriptActivityItem(previousItem) ||
          previousItem.item.kind === SessionTranscriptItemKind.AGENT_MESSAGE)
      ) {
        timelineItems.push({
          items: thoughtItems,
          key: thoughtItems.map((item) => item.id).join(":"),
          kind: "thought-group",
        })
        cursor = next
        continue
      }
    }

    if (current.item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION) {
      const groupedItems: SessionTranscriptItem[] = [current.item]
      let next = cursor + 1
      while (next < items.length) {
        const candidate = items[next]
        if (
          !isTranscriptActivityItem(candidate) ||
          candidate.item.kind !== SessionTranscriptItemKind.COMMAND_EXECUTION
        ) {
          break
        }
        groupedItems.push(candidate.item)
        next += 1
      }
      timelineItems.push({
        items: groupedItems,
        key: groupedItems.map((item) => item.id).join(":"),
        kind: "command-group",
      })
      cursor = next
      continue
    }

    if (current.item.kind === SessionTranscriptItemKind.FILE_CHANGE) {
      const groupedItems: SessionTranscriptItem[] = [current.item]
      let next = cursor + 1
      while (next < items.length) {
        const candidate = items[next]
        if (
          !isTranscriptActivityItem(candidate) ||
          candidate.item.kind !== SessionTranscriptItemKind.FILE_CHANGE
        ) {
          break
        }
        groupedItems.push(candidate.item)
        next += 1
      }
      timelineItems.push({
        items: groupedItems,
        key: groupedItems.map((item) => item.id).join(":"),
        kind: "file-change-group",
      })
      cursor = next
      continue
    }

    if (current.item.kind === SessionTranscriptItemKind.TOOL_CALL) {
      const groupedItems: SessionTranscriptItem[] = [current.item]
      let next = cursor + 1
      while (next < items.length) {
        const candidate = items[next]
        if (
          !isTranscriptActivityItem(candidate) ||
          candidate.item.kind !== SessionTranscriptItemKind.TOOL_CALL
        ) {
          break
        }
        groupedItems.push(candidate.item)
        next += 1
      }
      timelineItems.push({
        items: groupedItems,
        key: groupedItems.map((item) => item.id).join(":"),
        kind: "tool-group",
      })
      cursor = next
      continue
    }

    timelineItems.push(current)
    cursor += 1
  }

  return timelineItems
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

function ThinkingEntry({ summary }: { summary: string }) {
  return (
    <div className="min-w-0" data-testid="session-transcript-thinking">
      <div className="min-w-0 rounded-lg border border-border bg-card px-4 py-3">
        <TypingIndicator label={summary} />
      </div>
    </div>
  )
}

function RoundStatusEntry({
  state,
  summary,
}: {
  state: "finished" | "attention"
  summary: string
}) {
  return (
    <div className="min-w-0" data-testid="session-transcript-round-status">
      <div className="min-w-0 rounded-lg border border-border bg-card px-4 py-3 text-xs text-muted-foreground">
        <div className="flex items-center gap-2">
          <span
            className={cn(
              "size-1.5 rounded-full",
              state === "attention" ? "bg-amber-400" : "bg-sky-400"
            )}
          />
          <span>{summary}</span>
        </div>
      </div>
    </div>
  )
}

function TranscriptEntry({
  item,
  onSelectDiff,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectDiff: (diff: InspectorSelectedDiff) => void
  onSelectPath: (path: string) => void
}) {
  switch (item.kind) {
    case SessionTranscriptItemKind.USER_MESSAGE:
      return <UserMessageEntry item={item} />
    case SessionTranscriptItemKind.AGENT_MESSAGE:
      return <AgentMessageEntry item={item} onSelectPath={onSelectPath} />
    case SessionTranscriptItemKind.REASONING:
      return <ReasoningEntry item={item} onSelectPath={onSelectPath} />
    case SessionTranscriptItemKind.TOOL_CALL:
      return <ToolCallEntry item={item} />
    case SessionTranscriptItemKind.COMMAND_EXECUTION:
      return <CommandEntry item={item} />
    case SessionTranscriptItemKind.FILE_CHANGE:
      return <FileChangeGroupEntry items={[item]} onSelectDiff={onSelectDiff} />
    default:
      return <AgentMessageEntry item={item} onSelectPath={onSelectPath} />
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

function AgentMessageEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: (path: string) => void
}) {
  return (
    <div className="min-w-0" data-testid="session-transcript-agent">
      <div className="min-w-0">
        <SessionRichText text={item.body} onLocalPathClick={onSelectPath} />
      </div>
    </div>
  )
}

function ReasoningEntry({
  item,
  onSelectPath,
}: {
  item: SessionTranscriptItem
  onSelectPath: (path: string) => void
}) {
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
            onLocalPathClick={onSelectPath}
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

function ToolGroupEntry({ items }: { items: SessionTranscriptItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const count = items.length

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={`Used ${count} tools`}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-tool"
    >
      <div className="space-y-2">
        {items.map((item) => (
          <pre
            key={item.id}
            className="workspace-scrollbar overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground/70"
          >
            {item.body}
          </pre>
        ))}
      </div>
    </TranscriptBatchEntry>
  )
}

function ThoughtProcessGroupEntry({
  items,
  onSelectDiff,
  onSelectPath,
}: {
  items: SessionTranscriptItem[]
  onSelectDiff: (diff: InspectorSelectedDiff) => void
  onSelectPath: (path: string) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const summary = summarizeThoughtProcess(items)

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={summary}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-thought-group"
    >
      <div className="space-y-4 border-l border-border pl-4">
        {items.map((item) => (
          <TranscriptEntry
            key={item.id}
            item={item}
            onSelectDiff={onSelectDiff}
            onSelectPath={onSelectPath}
          />
        ))}
      </div>
    </TranscriptBatchEntry>
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
          className="group flex w-full items-center gap-1.5 text-sm text-muted-foreground transition hover:text-foreground"
        >
          <span>{label}</span>
          <ChevronRight
            className={cn(
              "ml-auto size-3 transition",
              expanded
                ? "rotate-90 opacity-100"
                : "opacity-0 group-hover:opacity-100"
            )}
          />
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

function CommandGroupEntry({ items }: { items: SessionTranscriptItem[] }) {
  const [expanded, setExpanded] = useState(false)
  const count = items.length

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={`Ran ${count} commands`}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-command"
    >
      <div className="space-y-2">
        {items.map((item) => (
          <pre
            key={item.id}
            className="workspace-scrollbar overflow-x-auto rounded-lg bg-muted p-3 font-mono text-xs leading-5 break-words whitespace-pre-wrap text-foreground/70"
          >
            {item.body}
          </pre>
        ))}
      </div>
    </TranscriptBatchEntry>
  )
}

function FileChangeGroupEntry({
  items,
  onSelectDiff,
}: {
  items: SessionTranscriptItem[]
  onSelectDiff: (diff: InspectorSelectedDiff) => void
}) {
  const [expanded, setExpanded] = useState(false)
  const changes = items.flatMap((item) => parseFileChangeBody(item.body))
  const count = changes.length

  return (
    <TranscriptBatchEntry
      expanded={expanded}
      label={`Changed ${count} files`}
      onToggle={() => setExpanded((prev) => !prev)}
      testId="session-transcript-file-change"
    >
      <div className="space-y-1.5">
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
    </TranscriptBatchEntry>
  )
}

function TranscriptBatchEntry({
  children,
  expanded,
  label,
  onToggle,
  testId,
}: {
  children: React.ReactNode
  expanded: boolean
  label: string
  onToggle: () => void
  testId: string
}) {
  return (
    <div className="min-w-0" data-testid={testId}>
      <div className="min-w-0">
        <button
          type="button"
          onClick={onToggle}
          className="group inline-flex max-w-full items-center gap-2 text-sm font-medium text-muted-foreground transition hover:text-foreground"
        >
          <span className="font-medium">{label}</span>
          <span className="rounded-md border border-border bg-secondary px-2 py-0.5 text-xs text-foreground/85 transition group-hover:bg-accent">
            {expanded ? "Collapse" : "Expand"}
          </span>
          <ChevronRight
            className={cn(
              "size-3 shrink-0 transition",
              expanded
                ? "rotate-90 opacity-100"
                : "opacity-60 group-hover:opacity-100"
            )}
          />
        </button>
        {expanded ? <div className="mt-2">{children}</div> : null}
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

function shouldShowThinkingState(status: Session["status"]) {
  const normalized = formatSessionStatus(status).toLowerCase()
  return normalized === "pending" || normalized === "running"
}

function isThoughtProcessTranscriptItem(item: SessionTranscriptItem) {
  return (
    item.kind === SessionTranscriptItemKind.REASONING ||
    item.kind === SessionTranscriptItemKind.TOOL_CALL ||
    item.kind === SessionTranscriptItemKind.COMMAND_EXECUTION ||
    item.kind === SessionTranscriptItemKind.FILE_CHANGE
  )
}

function shouldShowAttentionState(status: Session["status"]) {
  const normalized = formatSessionStatus(status).toLowerCase()
  return normalized === "failed" || normalized === "degraded"
}

function summarizeThoughtProcess(items: SessionTranscriptItem[]) {
  let reasoningCount = 0
  let toolCount = 0
  let commandCount = 0
  let fileChangeCount = 0

  for (const item of items) {
    switch (item.kind) {
      case SessionTranscriptItemKind.REASONING:
        reasoningCount += 1
        break
      case SessionTranscriptItemKind.TOOL_CALL:
        toolCount += 1
        break
      case SessionTranscriptItemKind.COMMAND_EXECUTION:
        commandCount += 1
        break
      case SessionTranscriptItemKind.FILE_CHANGE:
        fileChangeCount += 1
        break
    }
  }

  const parts = [
    reasoningCount > 0
      ? `${reasoningCount} thought${reasoningCount === 1 ? "" : "s"}`
      : null,
    toolCount > 0 ? `${toolCount} tool${toolCount === 1 ? "" : "s"}` : null,
    commandCount > 0
      ? `${commandCount} command${commandCount === 1 ? "" : "s"}`
      : null,
    fileChangeCount > 0
      ? `${fileChangeCount} file change${fileChangeCount === 1 ? "" : "s"}`
      : null,
  ].filter(Boolean)

  if (parts.length === 0) {
    return "Thought process"
  }

  return `Thought process: ${parts.join(", ")}`
}

function TypingIndicator({ label = "Thinking..." }: { label?: string }) {
  return (
    <div className="flex items-center gap-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-1">
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full" />
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full [animation-delay:140ms]" />
        <span className="bg-primary-muted size-1.5 animate-pulse rounded-full [animation-delay:280ms]" />
      </div>
      <span>{label}</span>
    </div>
  )
}

function shouldPollSessionState(status: Session["status"]) {
  const normalized = formatSessionStatus(status).toLowerCase()
  return (
    normalized === "pending" ||
    normalized === "running" ||
    normalized === "waiting approval"
  )
}
