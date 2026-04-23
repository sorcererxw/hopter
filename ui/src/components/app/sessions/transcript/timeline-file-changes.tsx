import { useTranslation } from "react-i18next"

import { CodeContainer } from "@/components/app/shared"
import { type SessionTranscriptItem } from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

import { TranscriptDisclosureItem } from "./timeline-disclosure"

type ParsedFileChange = {
  additions: number
  deletions: number
  diff?: string
  kindLabel: string
  path: string
  movePath?: string
}

// FileChangeGroupEntry renders one or more file changes inline inside the transcript flow.
export function FileChangeGroupEntry({
  items,
}: {
  items: SessionTranscriptItem[]
}) {
  const { t } = useTranslation()
  const changes = items.flatMap((item) => parseFileChangeBody(item.body, t))

  return (
    <div className="min-w-0" data-testid="session-transcript-file-change">
      <div className="space-y-1">
        {changes.map((change) => (
          <FileChangeRow
            change={change}
            key={`${change.path}-${change.kindLabel}`}
          />
        ))}
      </div>
    </div>
  )
}

// CompletedMessageChangedFiles renders the summarized changed-files card attached to a completed answer.
export function CompletedMessageChangedFiles({
  items,
}: {
  items: SessionTranscriptItem[]
}) {
  const { t } = useTranslation()
  const changes = items.flatMap((item) => parseFileChangeBody(item.body, t))
  const additions = changes.reduce((sum, change) => sum + change.additions, 0)
  const deletions = changes.reduce((sum, change) => sum + change.deletions, 0)

  if (changes.length === 0) {
    return null
  }

  return (
    <div
      className="mt-3 min-w-0 overflow-hidden rounded-xl border border-border bg-card"
      data-testid="session-transcript-completed-message-files"
    >
      <div className="flex items-center gap-2 border-b border-border bg-popover px-4 py-3 text-foreground">
        <span>{t("transcript.filesChanged", { count: changes.length })}</span>
        {changes.length > 1 ? (
          <span className="flex shrink-0 items-center gap-1 text-sm">
            <span className="text-emerald-600">+{additions}</span>
            <span className="text-destructive">-{deletions}</span>
          </span>
        ) : null}
      </div>
      <div className="divide-y divide-border">
        {changes.map((change) => (
          <CompletedMessageChangedFileRow
            change={change}
            key={`${change.path}-${change.kindLabel}-${change.movePath ?? ""}`}
          />
        ))}
      </div>
    </div>
  )
}

// FileChangeRow renders a single expandable file-change line with diff stats and optional diff body.
function FileChangeRow({ change }: { change: ParsedFileChange }) {
  return (
    <div className="min-w-0">
      <TranscriptDisclosureItem
        buttonClassName="w-full gap-2 py-0.5 text-base text-muted-foreground hover:text-foreground"
        iconClassName="ml-auto size-3"
        label={
          <>
            <span className="shrink-0 text-muted-foreground">
              {change.kindLabel}
            </span>
            <span className="min-w-0 truncate font-mono text-foreground underline decoration-border underline-offset-4">
              {formatFileChangePath(change.path)}
            </span>
            {change.additions || change.deletions ? (
              <span className="flex shrink-0 items-center gap-1 font-mono text-sm">
                <span className="text-emerald-600">+{change.additions}</span>
                <span className="text-destructive">-{change.deletions}</span>
              </span>
            ) : null}
          </>
        }
        title={change.path}
      >
        <CodeContainer
          as="pre"
          className="mt-1 max-h-96 break-words whitespace-pre-wrap"
        >
          <DiffCodeBlock diff={change.diff} />
        </CodeContainer>
      </TranscriptDisclosureItem>
    </div>
  )
}

// CompletedMessageChangedFileRow renders a file change inside the attached post-answer file summary card.
function CompletedMessageChangedFileRow({
  change,
}: {
  change: ParsedFileChange
}) {
  const pathLabel = change.movePath
    ? `${formatRelativeFileChangePath(change.path)} → ${formatRelativeFileChangePath(change.movePath)}`
    : formatRelativeFileChangePath(change.path)

  return (
    <div className="min-w-0">
      <TranscriptDisclosureItem
        buttonClassName="w-full items-center gap-3 px-4 py-3 text-muted-foreground hover:bg-accent/40 hover:text-foreground"
        iconClassName="size-3"
        label={
          <>
            <span className="min-w-0 break-all text-foreground">
              {pathLabel}
            </span>
            <span className="flex shrink-0 items-center gap-1 text-sm">
              <span className="text-emerald-600">+{change.additions}</span>
              <span className="text-destructive">-{change.deletions}</span>
            </span>
            <span className="flex-1" />
          </>
        }
        title={pathLabel}
      >
        <CodeContainer
          as="pre"
          className="mb-4 max-h-96 rounded-none border-0 bg-transparent px-0 py-0 break-words whitespace-pre-wrap"
        >
          <DiffCodeBlock diff={change.diff} />
        </CodeContainer>
      </TranscriptDisclosureItem>
    </div>
  )
}

// DiffCodeBlock renders diff text line-by-line with semantic coloring for additions, deletions, and hunks.
function DiffCodeBlock({ diff }: { diff?: string }) {
  const { t } = useTranslation()
  const lines = diff?.trim().split("\n") ?? []
  if (lines.length === 0) {
    return <>{t("artifact.noDiffContent")}</>
  }

  return (
    <>
      {lines.map((line, index) => (
        <span
          className={cn("-mx-4 block min-w-full px-4", diffLineClassName(line))}
          key={`${index}-${line}`}
        >
          {line || " "}
        </span>
      ))}
    </>
  )
}

// diffLineClassName maps a diff line prefix to the matching visual treatment.
function diffLineClassName(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "bg-emerald-500/10 text-emerald-700 dark:text-emerald-200"
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "bg-destructive/10 text-destructive"
  }
  if (line.startsWith("@@")) {
    return "bg-accent text-muted-foreground"
  }
  return ""
}

// parseFileChangeBody parses structured or fallback plain-text file-change payloads into a uniform shape.
function parseFileChangeBody(
  body: string,
  t: ReturnType<typeof useTranslation>["t"]
): ParsedFileChange[] {
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
        kindLabel: describeFileChangeKind(change.kind, t),
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
          kindLabel: describeFileChangeKind(kind, t),
          path,
        }
      })
  }
}

// describeFileChangeKind converts backend file-change verbs into localized UI labels.
function describeFileChangeKind(
  kind: string | undefined,
  t: ReturnType<typeof useTranslation>["t"]
) {
  switch ((kind || "").toLowerCase()) {
    case "add":
    case "added":
    case "create":
    case "created":
      return t("artifact.status.added")
    case "delete":
    case "deleted":
      return t("artifact.status.deleted")
    case "move":
    case "rename":
    case "renamed":
      return t("artifact.status.moved")
    case "update":
    case "updated":
    case "edit":
    case "edited":
    case "modify":
    case "modified":
      return t("artifact.status.edited")
    default:
      return t("artifact.status.edited")
  }
}

// formatFileChangePath reduces a file path to the shortest useful leaf label for compact rows.
function formatFileChangePath(path: string) {
  const normalized = path.trim()
  if (!normalized) {
    return path
  }

  const segments = normalized.split(/[\\/]/)
  return segments.at(-1) || normalized
}

// formatRelativeFileChangePath trims absolute prefixes so changed-file paths read relative to the repo root.
function formatRelativeFileChangePath(path: string) {
  const normalized = path.trim().replaceAll("\\", "/")
  if (!normalized) {
    return path
  }

  const segments = normalized.split("/")
  const repoRootMarkers = new Set([
    "cmd",
    "docs",
    "fixtures",
    "idl",
    "internal",
    "packages",
    "scripts",
    "site",
    "storage",
    "test",
    "ui",
  ])
  const markerIndex = segments.findIndex((segment) =>
    repoRootMarkers.has(segment)
  )

  if (markerIndex >= 0) {
    return segments.slice(markerIndex).join("/")
  }

  if (normalized.startsWith("/repo/")) {
    return normalized.slice("/repo/".length)
  }

  if (normalized.startsWith("repo/")) {
    return normalized.slice("repo/".length)
  }

  return normalized.replace(/^\/+/, "")
}
