import { X } from "lucide-react"
import { ArtifactKind } from "@/gen/proto/orchd/v1/common_pb"

import { SessionRichText } from "@/components/app/session-rich-text"
import type { Session } from "@/gen/proto/orchd/v1/session_pb"
import { formatArtifactKind, formatSessionStatus, formatUpdatedAt } from "@/lib/format/proto"
import { cn } from "@/lib/utils"

type InspectorTab = "summary" | "review"
type InspectorMode = "code" | "diff"

type SessionInspectorPaneProps = {
  activeTab: InspectorTab
  mode: InspectorMode
  onClose: () => void
  onModeChange: (mode: InspectorMode) => void
  onTabChange: (tab: InspectorTab) => void
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
      result.push({ color: "var(--workspace-inline-code-text)", text: line.slice(i, j) })
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
      } else if (word.includes(".proto") || word.includes(".go") || word.includes(".md")) {
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
  session,
}: SessionInspectorPaneProps) {
  const reviewLabel = "summary.md"

  return (
    <aside className="hidden h-full w-[404px] shrink-0 border-l border-ws-border bg-ws-surface lg:flex lg:flex-col">
      <div className="flex items-center gap-1 border-b border-ws-border bg-ws-panel px-3 py-2">
        <div className="flex min-w-0 items-center gap-1 overflow-x-auto">
          <InspectorTabButton active={activeTab === "summary"} onClick={() => onTabChange("summary")}>
            Summary
          </InspectorTabButton>
          <InspectorTabButton active={false} onClick={() => onTabChange("review")}>
            Review
          </InspectorTabButton>
          <InspectorTabButton active={activeTab === "review"} onClick={() => onTabChange("review")}>
            {reviewLabel}
          </InspectorTabButton>
        </div>

        <div className="ml-auto flex items-center gap-1">
          <ModeButton active={mode === "code"} onClick={() => onModeChange("code")}>
            Code
          </ModeButton>
          <ModeButton active={mode === "diff"} onClick={() => onModeChange("diff")}>
            Diff
          </ModeButton>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded text-ws-text-muted transition hover:bg-ws-hover hover:text-ws-text-sub"
          >
            <X className="size-[13px]" />
          </button>
        </div>
      </div>

      <div className="workspace-scrollbar min-h-0 flex-1 overflow-y-auto">
        {activeTab === "summary" ? (
          <div className="space-y-4 p-4">
            <div className="rounded-2xl border border-ws-border bg-ws-surface">
              <div className="border-b border-ws-border px-4 py-3 text-xs text-ws-text-muted">
                Current state
              </div>
              <SessionRichText
                text={session.summary || "No summary yet."}
                className="space-y-3 px-4 py-4 text-[13px] leading-7 text-ws-text"
              />
            </div>

            <div className="rounded-2xl border border-ws-border bg-ws-surface">
              <InfoRow label="Status" value={formatSessionStatus(session.status)} />
              <InfoRow label="Project" value={session.project?.name || "Unassigned"} />
              <InfoRow label="Updated" value={formatUpdatedAt(session.updatedAt)} />
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
          <DiffModePane session={session} />
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
          className="flex items-start px-0 transition hover:bg-ws-hover-soft"
        >
          <div className="w-12 shrink-0 select-none pr-4 text-right font-mono text-xs leading-5 text-ws-text-off">
            {index + 1}
          </div>
          <pre className="m-0 flex-1 whitespace-pre-wrap pr-4 font-mono text-xs leading-5 text-ws-text">
            {tokenizeLine(line)}
          </pre>
        </div>
      ))}
    </div>
  )
}

function DiffModePane({ session }: { session: Session }) {
  const changedArtifacts = session.artifacts.filter(
    (artifact) => artifact.kind === ArtifactKind.CHANGED_FILES
  )

  if (changedArtifacts.length === 0) {
    return (
      <div className="p-4">
        <div className="rounded-2xl border border-dashed border-ws-border bg-ws-hover-soft px-4 py-5 text-xs leading-6 text-ws-text-muted">
          No changed-files artifact yet. When the backend emits file changes or review metadata,
          the diff view will render them here.
        </div>
      </div>
    )
  }

  return (
    <div className="space-y-3 p-4">
      {changedArtifacts.map((artifact) => (
        <div
          key={artifact.id}
          className="rounded-2xl border border-ws-border bg-ws-surface px-4 py-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <p className="truncate text-[13px] text-ws-text">
                {artifact.label}
              </p>
              <p className="mt-1 text-xs text-ws-text-muted">
                {formatArtifactKind(artifact.kind)}
              </p>
            </div>
            <span className="rounded-md border border-ws-border bg-ws-tag px-2 py-1 text-[11px] text-ws-text-sub">
              {artifact.contentType || "metadata"}
            </span>
          </div>

          {artifact.downloadUrl ? (
            <a
              href={artifact.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center rounded-md border border-ws-border bg-ws-hover px-2.5 py-1 text-[11px] text-ws-text-sub transition hover:bg-ws-active"
            >
              Download artifact
            </a>
          ) : (
            <p className="mt-4 text-xs leading-6 text-ws-text-muted">
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
        "truncate rounded-md px-3 py-1.5 text-[12px] transition",
        active
          ? "border-b border-ws-code bg-ws-hover text-ws-text"
          : "text-ws-text-muted hover:bg-ws-hover hover:text-ws-text-sub"
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
        "rounded-md px-2.5 py-1 text-[12px] transition",
        active
          ? "bg-ws-hover text-ws-text"
          : "text-ws-text-muted hover:bg-ws-hover hover:text-ws-text-sub"
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
    <div className="border-b border-ws-border px-4 py-3 last:border-b-0">
      <p className="text-[11px] font-semibold uppercase tracking-[0.06em] text-ws-text-muted">
        {label}
      </p>
      <p
        className={cn(
          "mt-2 text-[13px] text-ws-text",
          multiline ? "leading-7" : "truncate"
        )}
      >
        {value}
      </p>
    </div>
  )
}
