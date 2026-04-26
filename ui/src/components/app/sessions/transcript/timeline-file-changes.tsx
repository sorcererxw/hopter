import { useEffect, useMemo, useState } from "react"
import { useTranslation } from "react-i18next"

import { CodeContainer } from "@/components/app/shared"
import { useTheme } from "@/components/theme-provider"
import { type SessionTranscriptItem } from "@/gen/proto/hopter/v1/session_pb"
import {
  highlightCodeToTokens,
  type HighlightLanguage,
} from "@/lib/shiki/highlighter"
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
            <span className="shrink-0 text-muted">
              {change.kindLabel}
            </span>
            <span className="min-w-0 truncate font-mono text-foreground underline decoration-border underline-offset-4">
              {formatFileChangePath(change.path)}
            </span>
            {change.additions || change.deletions ? (
              <span className="flex shrink-0 items-center gap-1 font-sans text-sm tabular-nums">
                <span className={DIFF_ADD_CLASS}>
                  +{change.additions}
                </span>
                <span className={DIFF_DELETE_CLASS}>
                  -{change.deletions}
                </span>
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
        <CodeContainer
          as="pre"
          className="mb-4 max-h-96 rounded-none border-0 bg-transparent px-0 py-0 break-words whitespace-pre-wrap"
        >
          <DiffCodeBlock
            diff={change.diff}
            filePath={change.movePath ?? change.path}
          />
        </CodeContainer>
      </TranscriptDisclosureItem>
    </div>
  )
}

// DiffCodeBlock renders diff text line-by-line with semantic coloring for additions, deletions, and hunks.
function DiffCodeBlock({
  diff,
  filePath,
}: {
  diff?: string
  filePath?: string
}) {
  const { t } = useTranslation()
  const rows = useMemo(() => parseDiffRows(diff), [diff])
  const highlightLanguage = useMemo(
    () => inferDiffSourceLanguage(filePath),
    [filePath]
  )
  const highlightedRows = useHighlightedDiffRows(rows, highlightLanguage)

  if (rows.length === 0) {
    return <>{t("artifact.noDiffContent")}</>
  }

  return (
    <>
      {rows.map((row, index) => (
        <span
          className={cn(
            "-mx-4 flex min-w-full items-start border-l-4",
            diffLineClassName(row.line)
          )}
          key={`${index}-${row.line}`}
        >
          <span
            className={cn(
            "w-10 shrink-0 pr-2 text-right text-muted select-none",
              diffLineNumberClassName(row.line)
            )}
          >
            {row.oldLineNumber ?? ""}
          </span>
          <span
            className={cn(
              "w-10 shrink-0 border-r border-border pr-2 text-right text-muted select-none",
              diffLineNumberClassName(row.line)
            )}
          >
            {row.newLineNumber ?? ""}
          </span>
          <span className="w-7 shrink-0 px-2 text-right select-none">
            {row.marker}
          </span>
          <span className="min-w-0 flex-1 px-2">
            <HighlightedDiffCodeContent
              fallback={row.code}
              tokens={highlightedRows[index]}
            />
          </span>
        </span>
      ))}
    </>
  )
}

type DiffRow = {
  code: string
  line: string
  marker?: string
  newLineNumber?: number
  oldLineNumber?: number
}

// parseDiffRows converts unified diff hunks into rows with old/new line numbers.
function parseDiffRows(diff?: string): DiffRow[] {
  const lines = diff?.trim().split("\n") ?? []
  let oldLineNumber: number | undefined
  let newLineNumber: number | undefined

  return lines.map((line) => {
    const hunkMatch = line.match(/^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/)
    if (hunkMatch) {
      oldLineNumber = Number(hunkMatch[1])
      newLineNumber = Number(hunkMatch[2])
      return { code: line, line }
    }

    if (oldLineNumber === undefined || newLineNumber === undefined) {
      return { code: line, line }
    }

    if (line.startsWith("+") && !line.startsWith("+++")) {
      const row = { code: line.slice(1), line, marker: "+", newLineNumber }
      newLineNumber += 1
      return row
    }

    if (line.startsWith("-") && !line.startsWith("---")) {
      const row = { code: line.slice(1), line, marker: "-", oldLineNumber }
      oldLineNumber += 1
      return row
    }

    if (line.startsWith("\\ No newline at end of file")) {
      return { code: line, line }
    }

    const row = {
      code: line.startsWith(" ") ? line.slice(1) : line,
      line,
      marker: line.startsWith(" ") ? " " : undefined,
      newLineNumber,
      oldLineNumber,
    }
    oldLineNumber += 1
    newLineNumber += 1
    return row
  })
}

type HighlightToken = {
  bgColor?: string
  color?: string
  content: string
  fontStyle?: number
}

type HighlightLine = HighlightToken[]

const shikiThemeByResolvedTheme = {
  dark: "github-dark-default",
  light: "github-light-default",
} as const

// useHighlightedDiffRows highlights changed source content using the original file language.
function useHighlightedDiffRows(
  rows: DiffRow[],
  language: HighlightLanguage
): Array<HighlightLine | undefined> {
  const { resolvedTheme } = useTheme()
  const [highlightedRows, setHighlightedRows] = useState<
    Array<HighlightLine | undefined>
  >([])

  useEffect(() => {
    let cancelled = false
    const sourceRows = rows.filter((row) => shouldHighlightDiffRow(row))
    const source = sourceRows.map((row) => row.code).join("\n")

    if (!source.trim()) {
      setHighlightedRows([])
      return
    }

    void highlightCodeToTokens(
      source,
      language,
      shikiThemeByResolvedTheme[resolvedTheme]
    )
      .then((result) => {
        if (cancelled) {
          return
        }

        const nextRows: Array<HighlightLine | undefined> = []
        let tokenLineIndex = 0
        for (const row of rows) {
          if (shouldHighlightDiffRow(row)) {
            nextRows.push(result.tokens[tokenLineIndex] as HighlightLine)
            tokenLineIndex += 1
          } else {
            nextRows.push(undefined)
          }
        }
        setHighlightedRows(nextRows)
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedRows([])
        }
      })

    return () => {
      cancelled = true
    }
  }, [language, resolvedTheme, rows])

  return highlightedRows
}

function shouldHighlightDiffRow(row: DiffRow) {
  return row.oldLineNumber !== undefined || row.newLineNumber !== undefined
}

function HighlightedDiffCodeContent({
  fallback,
  tokens,
}: {
  fallback: string
  tokens?: HighlightLine
}) {
  if (!tokens) {
    return <>{fallback || " "}</>
  }
  if (tokens.length === 0) {
    return <> </>
  }
  return (
    <>
      {tokens.map((token, tokenIndex) => (
        <span key={`${tokenIndex}-${token.content}`} style={tokenStyle(token)}>
          {token.content}
        </span>
      ))}
    </>
  )
}

function tokenStyle(token: HighlightToken) {
  const style: Record<string, string> = {}
  if (token.color) {
    style.color = token.color
  }
  if (token.bgColor) {
    style.backgroundColor = token.bgColor
  }
  if (token.fontStyle) {
    if (token.fontStyle & 1) {
      style.fontStyle = "italic"
    }
    if (token.fontStyle & 2) {
      style.fontWeight = "700"
    }
    if (token.fontStyle & 4) {
      style.textDecoration = "underline"
    }
  }
  return style
}

function inferDiffSourceLanguage(filePath?: string): HighlightLanguage {
  const normalized = filePath?.trim().toLowerCase() || ""
  const ext = normalized.split(".").pop() || ""
  switch (ext) {
    case "ts":
      return "ts"
    case "tsx":
      return "tsx"
    case "js":
    case "mjs":
    case "cjs":
      return "js"
    case "jsx":
      return "jsx"
    case "go":
      return "go"
    case "json":
      return "json"
    case "md":
    case "markdown":
      return "markdown"
    case "css":
      return "css"
    case "html":
      return "html"
    case "yaml":
    case "yml":
      return "yaml"
    case "toml":
      return "toml"
    case "sh":
    case "zsh":
    case "bash":
      return "bash"
    case "proto":
      return "proto"
    default:
      return "text"
  }
}

// diffLineClassName maps a diff line prefix to the matching visual treatment.
function diffLineClassName(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return "border-green-600 bg-green-400/15 text-green-700 dark:text-green-300"
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return "border-red-600 bg-red-400/15 text-red-700 dark:text-red-300"
  }
  if (line.startsWith("@@")) {
    return "border-transparent bg-surface-tertiary text-muted"
  }
  return "border-transparent"
}

// diffLineNumberClassName tints old/new gutters to match changed rows.
function diffLineNumberClassName(line: string) {
  if (line.startsWith("+") && !line.startsWith("+++")) {
    return DIFF_ADD_CLASS
  }
  if (line.startsWith("-") && !line.startsWith("---")) {
    return DIFF_DELETE_CLASS
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
