import { PatchDiff } from "@pierre/diffs/react"
import { useTranslation } from "react-i18next"

import {
  CodeContainer,
  workspaceSoftCardClassName,
} from "@/components/app/shared"
import { useTheme } from "@/components/theme-provider"
import { type SessionTranscriptItem } from "@/gen/proto/hopter/v1/session_pb"
import { cn } from "@/lib/utils"

import { TranscriptDisclosureItem } from "./timeline-disclosure"

type ParsedFileChange = {
  additions: number
  deletions: number
  diff?: string
  disclosureKey: string
  kind: FileChangeKind
  kindLabel: string
  path: string
  movePath?: string
}

type FileChangeKind = "added" | "deleted" | "edited" | "moved"

const DIFF_ADD_CLASS = "text-green-700 dark:text-green-300"
const DIFF_DELETE_CLASS = "text-red-700 dark:text-red-300"
const DIFF_CODE_CARD_CLASS =
  "mt-2 max-h-96 overflow-x-hidden px-0 py-0 text-muted shadow-none"
const COMPLETED_DIFF_CODE_CARD_CLASS = cn(
  DIFF_CODE_CARD_CLASS,
  "-mx-4 rounded-none border-0"
)

// FileChangeGroupEntry renders one or more file changes inline inside the transcript flow.
export function FileChangeGroupEntry({
  items,
  projectRootPath,
}: {
  items: SessionTranscriptItem[]
  projectRootPath?: string
}) {
  const { t } = useTranslation()
  const changes = parseFileChangeItems(items, t)

  return (
    <div className="min-w-0" data-testid="session-transcript-file-change">
      <div className="space-y-2">
        {changes.map((change) => (
          <FileChangeRow
            change={change}
            key={`${change.disclosureKey}-${change.path}-${change.kindLabel}`}
            projectRootPath={projectRootPath}
          />
        ))}
      </div>
    </div>
  )
}

// CompletedMessageChangedFiles renders the summarized changed-files card attached to a completed answer.
export function CompletedMessageChangedFiles({
  items,
  projectRootPath,
}: {
  items: SessionTranscriptItem[]
  projectRootPath?: string
}) {
  const { t } = useTranslation()
  const changes = parseFileChangeItems(items, t)
  const additions = changes.reduce((sum, change) => sum + change.additions, 0)
  const deletions = changes.reduce((sum, change) => sum + change.deletions, 0)

  if (changes.length === 0) {
    return null
  }

  return (
    <div
      className={cn("mt-3 min-w-0 overflow-hidden", workspaceSoftCardClassName)}
      data-testid="session-transcript-completed-message-files"
    >
      <div className="flex items-center gap-2 px-4 py-3 text-muted">
        <span>{t("transcript.filesChanged", { count: changes.length })}</span>
        {changes.length > 1 ? (
          <span className="flex shrink-0 items-center gap-1 text-sm">
            <span className={DIFF_ADD_CLASS}>+{additions}</span>
            <span className={DIFF_DELETE_CLASS}>-{deletions}</span>
          </span>
        ) : null}
      </div>
      <div className="divide-y divide-border border-t border-border">
        {changes.map((change) => (
          <div
            key={`${change.disclosureKey}-${change.path}-${change.kindLabel}-${change.movePath ?? ""}`}
            className="px-4 py-2"
          >
            <CompletedMessageChangedFileRow
              change={change}
              projectRootPath={projectRootPath}
            />
          </div>
        ))}
      </div>
    </div>
  )
}

// FileChangeRow renders a single expandable file-change line with diff stats and optional diff body.
function FileChangeRow({
  change,
  projectRootPath,
}: {
  change: ParsedFileChange
  projectRootPath?: string
}) {
  const pathLabel = formatRelativeFileChangePath(change.path, projectRootPath)

  return (
    <div className="min-w-0">
      <TranscriptDisclosureItem
        buttonClassName="w-full gap-2 text-base text-muted hover:text-foreground"
        disclosureKey={`file-change:${change.disclosureKey}`}
        iconClassName="size-3"
        label={
          <>
            <span className="shrink-0 text-muted transition group-hover:text-foreground">
              {change.kindLabel}
            </span>
            <span className="min-w-0 truncate font-mono text-foreground underline decoration-border underline-offset-4">
              {pathLabel}
            </span>
            {change.additions || change.deletions ? (
              <span className="flex shrink-0 items-center gap-1 font-sans text-sm tabular-nums">
                <span className={DIFF_ADD_CLASS}>+{change.additions}</span>
                <span className={DIFF_DELETE_CLASS}>-{change.deletions}</span>
              </span>
            ) : null}
          </>
        }
        title={pathLabel}
      >
        <CodeContainer className={DIFF_CODE_CARD_CLASS}>
          <DiffCodeBlock
            additions={change.additions}
            deletions={change.deletions}
            diff={change.diff}
            filePath={change.path}
            kind={change.kind}
            projectRootPath={projectRootPath}
          />
        </CodeContainer>
      </TranscriptDisclosureItem>
    </div>
  )
}

// CompletedMessageChangedFileRow renders a file change inside the attached post-answer file summary card.
function CompletedMessageChangedFileRow({
  change,
  projectRootPath,
}: {
  change: ParsedFileChange
  projectRootPath?: string
}) {
  const pathLabel = change.movePath
    ? `${formatRelativeFileChangePath(change.path, projectRootPath)} → ${formatRelativeFileChangePath(change.movePath, projectRootPath)}`
    : formatRelativeFileChangePath(change.path, projectRootPath)

  return (
    <div className="min-w-0">
      <TranscriptDisclosureItem
        buttonClassName="w-full items-center gap-3 text-muted hover:text-foreground"
        disclosureKey={`completed-file-change:${change.disclosureKey}`}
        iconClassName="size-3"
        label={
          <>
            <span className="min-w-0 break-all text-foreground">{pathLabel}</span>
            <span className="flex shrink-0 items-center gap-1 font-sans text-sm tabular-nums">
              <span className={DIFF_ADD_CLASS}>+{change.additions}</span>
              <span className={DIFF_DELETE_CLASS}>-{change.deletions}</span>
            </span>
          </>
        }
        title={pathLabel}
      >
        <CodeContainer className={COMPLETED_DIFF_CODE_CARD_CLASS}>
          <DiffCodeBlock
            additions={change.additions}
            deletions={change.deletions}
            diff={change.diff}
            filePath={change.movePath ?? change.path}
            kind={change.kind}
            projectRootPath={projectRootPath}
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
  additions,
  deletions,
  diff,
  filePath,
  kind,
  projectRootPath,
}: {
  additions?: number
  deletions?: number
  diff?: string
  filePath?: string
  kind?: FileChangeKind
  projectRootPath?: string
}) {
  const { t } = useTranslation()
  const { resolvedTheme } = useTheme()
  const patch = normalizeSingleFilePatch(diff, filePath, {
    deletedFallbackLabel: t("artifact.deletedFileDiffUnavailable", {
      count: deletions ?? 0,
    }),
    additions,
    deletions,
    kind,
    projectRootPath,
  })

  if (!patch) {
    return <>{t("artifact.noDiffContent")}</>
  }

  return (
    <PatchDiff
      className="block w-full min-w-0"
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

function normalizeSingleFilePatch(
  diff?: string,
  filePath?: string,
  options?: {
    additions?: number
    deletedFallbackLabel?: string
    deletions?: number
    kind?: FileChangeKind
    projectRootPath?: string
  }
) {
  const trimmed = diff?.trim()
  const deletedLike =
    options?.kind === "deleted" ||
    ((options?.deletions ?? 0) > 0 && (options?.additions ?? 0) === 0)

  if (!trimmed || !/^@@ /m.test(trimmed)) {
    if (deletedLike) {
		const deletedPatch = buildDeletedFilePatchFromRawDiff(
			trimmed,
			filePath,
			options?.projectRootPath
		)
		if (deletedPatch) {
			return deletedPatch
		}
		return buildDeletedFileFallbackPatch(
			filePath,
			options?.deletedFallbackLabel || "Deleted file content unavailable.",
			options?.projectRootPath
		)
	}
    return undefined
  }

  if (/^diff --git /m.test(trimmed) || /^---\s+\S/m.test(trimmed)) {
    return trimmed
  }

  const path = formatRelativeFileChangePath(
    filePath || "file",
    options?.projectRootPath
  )
  return [`--- ${path}`, `+++ ${path}`, trimmed].join("\n")
}

function buildDeletedFilePatchFromRawDiff(
  diff: string | undefined,
  filePath: string | undefined,
  projectRootPath: string | undefined
) {
  const rawLines = diff?.split(/\r?\n/)
  const deletionLines = rawLines
    ?.filter((line) => line.startsWith("-") && !line.startsWith("---"))
    .map((line) => line)

  if (
    (!deletionLines || deletionLines.length === 0) &&
    rawLines &&
    rawLines.length > 0
  ) {
    const contentLines = rawLines.filter(
      (line) =>
        !line.startsWith("diff --git ") &&
        !line.startsWith("index ") &&
        !line.startsWith("+++ ") &&
        !line.startsWith("--- ") &&
        !line.startsWith("@@ ")
    )

    if (contentLines.length > 0) {
      return buildDeletedFilePatch(
        filePath,
        projectRootPath,
        contentLines.map((line) => `-${line}`)
      )
    }
  }

  if (!deletionLines || deletionLines.length === 0) {
    return undefined
  }

  return buildDeletedFilePatch(filePath, projectRootPath, deletionLines)
}

function buildDeletedFilePatch(
  filePath: string | undefined,
  projectRootPath: string | undefined,
  deletionLines: string[]
) {
  const path = formatRelativeFileChangePath(filePath || "file", projectRootPath)
  return [
    `--- ${path}`,
    "+++ /dev/null",
    `@@ -1,${deletionLines.length} +0,0 @@`,
    ...deletionLines,
  ].join("\n")
}

function buildDeletedFileFallbackPatch(
  filePath: string | undefined,
  label: string,
  projectRootPath: string | undefined
) {
  const path = formatRelativeFileChangePath(filePath || "file", projectRootPath)
  return [`--- ${path}`, "+++ /dev/null", "@@ -1,1 +0,0 @@", `-${label}`].join(
    "\n"
  )
}

function parseFileChangeItems(
  items: SessionTranscriptItem[],
  t: ReturnType<typeof useTranslation>["t"]
) {
  return items.flatMap((item) =>
    parseFileChangeBody(item.body, t).map((change, index) => ({
      ...change,
      disclosureKey: `${item.id}:${index}`,
    }))
  )
}

// parseFileChangeBody parses structured or fallback plain-text file-change payloads into a uniform shape.
function parseFileChangeBody(
  body: string,
  t: ReturnType<typeof useTranslation>["t"]
): Omit<ParsedFileChange, "disclosureKey">[] {
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
      .map((change) => {
        const kind = normalizeFileChangeKind(change.kind)
        return {
          additions: change.additions ?? 0,
          deletions: change.deletions ?? 0,
          diff: change.diff,
          kind,
          kindLabel: describeFileChangeKind(kind, t),
          movePath: change.movePath,
          path: change.path!.trim(),
        }
      })
  } catch {
    return trimmed
      .split("\n")
      .map((line) => line.trim())
      .filter(Boolean)
      .map((line) => {
        const match = line.match(/^(.*?)(?:\s+\(([^)]+)\))?$/)
        const path = match?.[1]?.trim() || line
        const kind = normalizeFileChangeKind(match?.[2]?.trim() || "")
        return {
          additions: 0,
          deletions: 0,
          kind,
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
  switch (normalizeFileChangeKind(kind)) {
    case "added":
      return t("artifact.status.added")
    case "deleted":
      return t("artifact.status.deleted")
    case "moved":
      return t("artifact.status.moved")
    case "edited":
      return t("artifact.status.edited")
    default:
      return t("artifact.status.edited")
  }
}

function normalizeFileChangeKind(kind: string | undefined): FileChangeKind {
  const normalized = (kind || "").toLowerCase()
  const compact = normalized.replace(/[\s_-]+/g, "")

  switch (compact) {
    case "add":
    case "added":
    case "create":
    case "created":
    case "addfile":
    case "addedfile":
    case "createfile":
    case "createdfile":
    case "fileadd":
    case "fileadded":
    case "filecreate":
    case "filecreated":
      return "added"
    case "delete":
    case "deleted":
    case "remove":
    case "removed":
    case "unlink":
    case "deletefile":
    case "deletedfile":
    case "removefile":
    case "removedfile":
    case "unlinkfile":
    case "filedelete":
    case "filedeleted":
    case "fileremove":
    case "fileremoved":
    case "fileunlink":
      return "deleted"
    case "move":
    case "rename":
    case "renamed":
    case "movefile":
    case "renamefile":
    case "renamedfile":
    case "filemove":
    case "filerename":
    case "filerenamed":
      return "moved"
    case "update":
    case "updated":
    case "edit":
    case "edited":
    case "modify":
    case "modified":
    case "updatefile":
    case "updatedfile":
    case "editfile":
    case "editedfile":
    case "modifyfile":
    case "modifiedfile":
    case "fileupdate":
    case "fileupdated":
    case "fileedit":
    case "fileedited":
    case "filemodify":
    case "filemodified":
      return "edited"
    default:
      return "edited"
  }
}

// formatRelativeFileChangePath trims absolute prefixes so changed-file paths read relative to the repo root.
function formatRelativeFileChangePath(path: string, projectRootPath?: string) {
  const normalized = path.trim().replaceAll("\\", "/")
  if (!normalized) {
    return path
  }

  const projectRelativePath = relativeToProjectRoot(normalized, projectRootPath)
  if (projectRelativePath) {
    return projectRelativePath
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

  return normalized
}

function relativeToProjectRoot(path: string, projectRootPath?: string) {
  const root = projectRootPath?.trim().replaceAll("\\", "/").replace(/\/+$/, "")
  if (!root) {
    return undefined
  }

  const roots = new Set([
    root,
    root.replace(/^\/+/, ""),
    root.startsWith("/") ? root : `/${root}`,
  ])

  for (const candidate of roots) {
    if (!candidate) {
      continue
    }
    if (path === candidate) {
      return "."
    }
    if (path.startsWith(`${candidate}/`)) {
      return path.slice(candidate.length + 1)
    }
  }

  return undefined
}
