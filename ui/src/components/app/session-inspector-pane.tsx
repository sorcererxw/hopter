import { X } from "lucide-react"
import { ArtifactKind } from "@/gen/proto/orchd/v1/common_pb"

import { SessionRichText } from "@/components/app/session-rich-text"
import type { Session } from "@/gen/proto/orchd/v1/session_pb"
import {
  formatArtifactKind,
  formatSessionStatus,
  formatUpdatedAt,
} from "@/lib/format/proto"
import { cn } from "@/lib/utils"

type InspectorTab = "summary" | "review"
type InspectorMode = "code" | "diff"

export type InspectorSelectedDiff = {
  additions: number
  deletions: number
  diff?: string
  kindLabel: string
  path: string
}

type SessionInspectorPaneProps = {
  activeTab: InspectorTab
  mode: InspectorMode
  onClose: () => void
  onModeChange: (mode: InspectorMode) => void
  onTabChange: (tab: InspectorTab) => void
  selectedDiff?: InspectorSelectedDiff | null
  session: Session
}

function tokenizeLine(line: string) {
  const keywords = new Set([
    "thread",
    "project",
    "status",
    "updated_at",
    "summary",
    "true",
    "false",
    "null",
    "undefined",
  ])

  if (line.trim().startsWith("//")) {
    return <span style={{ color: "#6a9955" }}>{line}</span>
  }

  const result: Array<{ text: string; color: string }> = []
  let i = 0

  while (i < line.length) {
    if (line[i] === "`") {
      let j = i + 1
      while (j < line.length && line[j] !== "`") {
        j += 1
      }
      j += 1
      result.push({
        color: "var(--workspace-inline-code-text)",
        text: line.slice(i, j),
      })
      i = j
      continue
    }

    if (line[i] === "'" || line[i] === '"') {
      const quote = line[i]
      let j = i + 1
      while (j < line.length && line[j] !== quote) {
        if (line[j] === "\\") {
          j += 1
        }
        j += 1
      }
      j += 1
      result.push({ color: "#ce9178", text: line.slice(i, j) })
      i = j
      continue
    }

    if (/[a-zA-Z_]/.test(line[i])) {
      let j = i + 1
      while (j < line.length && /[a-zA-Z0-9_./-]/.test(line[j])) {
        j += 1
      }
      const word = line.slice(i, j)
      let color = "#d4d4d4"
      if (keywords.has(word.replace(/:$/, ""))) {
        color = "#569cd6"
      } else if (
        word.includes(".proto") ||
        word.includes(".go") ||
        word.includes(".md")
      ) {
        color = "#9cdcfe"
      }
      result.push({ color, text: word })
      i = j
      continue
    }

    result.push({ color: "#d4d4d4", text: line[i] })
    i += 1
  }

  return (
    <>
      {result.map((token, index) => (
        <span key={`${token.text}-${index}`} style={{ color: token.color }}>
          {token.text}
        </span>
      ))}
    </>
  )
}

export function SessionInspectorPane({
  activeTab,
  mode,
  onClose,
  onModeChange,
  onTabChange,
  selectedDiff,
  session,
}: SessionInspectorPaneProps) {
  const reviewLabel = "summary.md"

  return (
    <aside className="hidden h-full w-[404px] shrink-0 border-l border-border bg-card lg:flex lg:flex-col">
      <div className="flex items-center gap-1 border-b border-border bg-popover px-3 py-2">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          <InspectorTabButton
            active={activeTab === "summary"}
            onClick={() => onTabChange("summary")}
          >
            Summary
          </InspectorTabButton>
          <InspectorTabButton
            active={false}
            onClick={() => onTabChange("review")}
          >
            Review
          </InspectorTabButton>
          <InspectorTabButton
            active={activeTab === "review"}
            onClick={() => onTabChange("review")}
          >
            {reviewLabel}
          </InspectorTabButton>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <ModeButton
            active={mode === "code"}
            onClick={() => onModeChange("code")}
          >
            Code
          </ModeButton>
          <ModeButton
            active={mode === "diff"}
            onClick={() => onModeChange("diff")}
          >
            Diff
          </ModeButton>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-muted-foreground transition hover:bg-accent hover:text-muted-foreground"
          >
            <X className="size-3.5" />
          </button>
        </div>
      </div>

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto">
        {activeTab === "summary" ? (
          <div className="space-y-4 p-4">
            <div className="rounded-lg border border-border bg-card">
              <div className="border-b border-border px-4 py-3 text-xs font-medium text-muted-foreground">
                Current state
              </div>
              <SessionRichText
                text={session.summary || "No summary yet."}
                className="px-4 py-4 text-sm leading-6"
              />
            </div>

            <div className="rounded-lg border border-border bg-card">
              <InfoRow
                label="Status"
                value={formatSessionStatus(session.status)}
              />
              <InfoRow
                label="Project"
                value={session.project?.name || "Unassigned"}
              />
              <InfoRow
                label="Updated"
                value={formatUpdatedAt(session.updatedAt)}
              />
              <InfoRow
                label="Attention"
                multiline
                value={
                  session.attentionRequired
                    ? session.attentionReason || "User action required"
                    : "No attention required"
                }
              />
            </div>
          </div>
        ) : mode === "code" ? (
          <CodeModePane session={session} />
        ) : (
          <DiffModePane selectedDiff={selectedDiff} session={session} />
        )}
      </div>
    </aside>
  )
}

function CodeModePane({ session }: { session: Session }) {
  const lines = [
    `thread: ${session.title || "Untitled"}`,
    `project: ${session.project?.name || "Unassigned"}`,
    `status: ${formatSessionStatus(session.status)}`,
    `updated_at: ${formatUpdatedAt(session.updatedAt)}`,
    "",
    "summary:",
    ...(session.summary || "No summary yet.").split("\n"),
  ]

  return (
    <div className="h-full overflow-auto py-2">
      {lines.map((line, index) => (
        <div
          key={`${line}-${index}`}
          className="flex items-start px-0 transition hover:bg-muted"
        >
          <div className="w-12 shrink-0 pr-4 text-right font-mono text-xs leading-5 text-muted-foreground select-none">
            {index + 1}
          </div>
          <pre className="m-0 flex-1 pr-4 font-mono text-xs leading-5 whitespace-pre-wrap text-foreground">
            {tokenizeLine(line)}
          </pre>
        </div>
      ))}
    </div>
  )
}

function DiffModePane({
  selectedDiff,
  session,
}: {
  selectedDiff?: InspectorSelectedDiff | null
  session: Session
}) {
  if (selectedDiff) {
    return (
      <div className="space-y-4 p-4">
        <div className="rounded-lg border border-border bg-card px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate font-mono text-sm text-ws-code">
                {selectedDiff.path}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {selectedDiff.kindLabel}
                {selectedDiff.additions || selectedDiff.deletions
                  ? `  +${selectedDiff.additions} -${selectedDiff.deletions}`
                  : ""}
              </p>
            </div>
          </div>
        </div>

        {selectedDiff.diff ? (
          <pre className="workspace-scrollbar overflow-x-auto rounded-lg border border-border bg-card p-4 font-mono text-xs leading-6 whitespace-pre">
            {selectedDiff.diff}
          </pre>
        ) : (
          <div className="rounded-lg border border-dashed border-border bg-muted px-4 py-5 text-sm leading-6 text-foreground/70">
            This file change does not currently include inline diff content.
          </div>
        )}
      </div>
    )
  }

  const changedArtifacts = session.artifacts.filter(
    (artifact) => artifact.kind === ArtifactKind.CHANGED_FILES
  )

  if (changedArtifacts.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-lg border border-dashed border-border bg-muted px-4 py-5 text-sm leading-6 text-foreground/70">
          No changed-files artifact yet. When the backend emits file changes or
          review metadata, the diff view will render them here.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      {changedArtifacts.map((artifact) => (
        <div
          key={artifact.id}
          className="rounded-lg border border-border bg-card px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-sm text-foreground">
                {artifact.label}
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                {formatArtifactKind(artifact.kind)}
              </p>
            </div>
            <span className="rounded-md border border-border bg-secondary px-2 py-1 text-xs text-muted-foreground">
              {artifact.contentType || "metadata"}
            </span>
          </div>

          {artifact.downloadUrl ? (
            <a
              href={artifact.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center rounded-md border border-border bg-accent px-2.5 py-1 text-xs text-muted-foreground transition hover:bg-accent"
            >
              Download artifact
            </a>
          ) : (
            <p className="mt-4 text-xs leading-6 text-muted-foreground">
              This artifact currently exposes metadata only.
            </p>
          )}
        </div>
      ))}
    </div>
  )
}

function InspectorTabButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "truncate rounded-md px-3 py-1.5 text-sm transition",
        active
          ? "border-b border-ws-code bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function ModeButton({
  active,
  children,
  onClick,
}: {
  active: boolean
  children: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-md px-2.5 py-1 text-sm transition",
        active
          ? "bg-accent text-foreground"
          : "text-muted-foreground hover:bg-accent hover:text-foreground"
      )}
    >
      {children}
    </button>
  )
}

function InfoRow({
  label,
  multiline = false,
  value,
}: {
  label: string
  multiline?: boolean
  value: string
}) {
  return (
    <div className="border-b border-border px-4 py-3 last:border-b-0">
      <p className="text-xs font-semibold tracking-wider text-muted-foreground uppercase">
        {label}
      </p>
      <p
        className={cn(
          "mt-1.5 text-sm leading-6 text-foreground",
          multiline ? "" : "truncate"
        )}
      >
        {value}
      </p>
    </div>
  )
}
