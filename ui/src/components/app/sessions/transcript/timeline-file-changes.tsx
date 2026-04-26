import { PatchDiff } from "@pierre/diffs/react"
import { useTranslation } from "react-i18next"

import { CodeContainer } from "@/components/app/shared"
import { useTheme } from "@/components/theme-provider"
import { type SessionTranscriptItem } from "@/gen/proto/hopter/v1/session_pb"

import { TranscriptDisclosureItem } from "./timeline-disclosure"

type ParsedFileChange = {
  additions: number
  deletions: number
  diff?: string
  kindLabel: string
  path: string
  movePath?: string
}

const DIFF_ADD_CLASS = "text-green-700 dark:text-green-300"
const DIFF_DELETE_CLASS = "text-red-700 dark:text-red-300"

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
      className="mt-3 min-w-0 overflow-hidden rounded-xl border border-border bg-surface"
      data-testid="session-transcript-completed-message-files"
    >
      <div className="flex items-center gap-2 border-b border-border bg-overlay px-3 py-2 text-foreground">
        <span>{t("transcript.filesChanged", { count: changes.length })}</span>
        {changes.length > 1 ? (
          <span className="flex shrink-0 items-center gap-1 text-sm">
            <span className={DIFF_ADD_CLASS}>+{additions}</span>
            <span className={DIFF_DELETE_CLASS}>-{deletions}</span>
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
        buttonClassName="w-full gap-2 py-0.5 text-base text-muted hover:text-foreground"
        iconClassName="ml-auto size-3"
        label={
          <>
            <span className="shrink-0 text-muted">{change.kindLabel}</span>
            <span className="min-w-0 truncate font-mono text-foreground underline decoration-border underline-offset-4">
              {formatFileChangePath(change.path)}
            </span>
            {change.additions || change.deletions ? (
              <span className="flex shrink-0 items-center gap-1 font-sans text-sm tabular-nums">
                <span className={DIFF_ADD_CLASS}>+{change.additions}</span>
                <span className={DIFF_DELETE_CLASS}>-{change.deletions}</span>
              </span>
            ) : null}
          </>
        }
        title={change.path}
      >
        <CodeContainer className="mt-1 max-h-96 overflow-x-hidden px-0 py-0">
          <DiffCodeBlock diff={change.diff} filePath={change.path} />
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
        buttonClassName="w-full items-center gap-3 px-3 py-2 text-muted hover:bg-surface-tertiary hover:text-foreground"
        iconClassName="size-3"
        label={
          <>
            <span className="min-w-0 break-all text-foreground">
              {pathLabel}
            </span>
            <span className="flex shrink-0 items-center gap-1 font-sans text-sm tabular-nums">
              <span className={DIFF_ADD_CLASS}>+{change.additions}</span>
              <span className={DIFF_DELETE_CLASS}>-{change.deletions}</span>
            </span>
            <span className="flex-1" />
          </>
        }
        title={pathLabel}
      >
        <CodeContainer className="mb-4 max-h-96 overflow-x-hidden rounded-none border-0 bg-transparent px-0 py-0">
          <DiffCodeBlock
            diff={change.diff}
            filePath={change.movePath ?? change.path}
          />
        </CodeContainer>
      </TranscriptDisclosureItem>
    </div>
  )
}

const diffThemeByResolvedTheme = {
  dark: "github-dark-default",
  light: "github-light-default",
} as const

const diffUnsafeCss = `
:host {
  display: block;
  min-width: 0;
  color: inherit;
  font-family: var(--font-mono), "JetBrains Mono", ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
  font-size: 0.875rem;
  line-height: 1.5rem;
}

pre {
  margin: 0;
  border: 0;
  background: transparent;
  max-width: 100%;
  white-space: pre-wrap;
  overflow-wrap: anywhere;
  word-break: break-word;
}

[data-diffs-header] {
  display: none;
}

[data-line-type="addition"] {
  color: rgb(134 239 172);
}

[data-line-type="deletion"] {
  color: rgb(252 165 165);
}

[data-line-type="metadata"] {
  color: rgb(161 161 170);
}
`

// DiffCodeBlock delegates unified diff parsing, line numbering, and syntax highlighting to @pierre/diffs.
function DiffCodeBlock({
  diff,
  filePath,
}: {
  diff?: string
  filePath?: string
}) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const patch = normalizeSingleFilePatch(diff, filePath)

  if (!patch) {
    return <>{t("artifact.noDiffContent")}</>
  }

  return (
    <PatchDiff
      className="block min-w-0 w-full"
      disableWorkerPool
      options={{
        collapsed: false,
        diffIndicators: "classic",
        diffStyle: "unified",
        disableBackground: true,
        disableFileHeader: true,
        hunkSeparators: "metadata",
        overflow: "wrap",
        theme: diffThemeByResolvedTheme[resolvedTheme],
        themeType: resolvedTheme,
        unsafeCSS: diffUnsafeCss,
      }}
      patch={patch}
    />
  )
}

function normalizeSingleFilePatch(diff?: string, filePath?: string) {
  const trimmed = diff?.trim()
  if (!trimmed || !/^@@ /m.test(trimmed)) {
    return undefined
  }

  if (/^diff --git /m.test(trimmed) || /^---\s+\S/m.test(trimmed)) {
    return trimmed
  }

  const path = formatRelativeFileChangePath(filePath || "file")
  return [`--- ${path}`, `+++ ${path}`, trimmed].join("\n")
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
