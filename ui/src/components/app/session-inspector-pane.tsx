import { ChevronRight, FileCode2, FileStack, X } from "lucide-react"
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

export function SessionInspectorPane({
  activeTab,
  mode,
  onClose,
  onModeChange,
  onTabChange,
  session,
}: SessionInspectorPaneProps) {
  return (
    <aside className="hidden h-full w-[27rem] shrink-0 border-l border-white/8 bg-[#141414] lg:flex lg:flex-col">
      <div className="flex items-center gap-1 border-b border-white/7 bg-[#1a1a1a] px-3 py-2">
        <InspectorTabButton
          active={activeTab === "summary"}
          icon={FileCode2}
          label="Summary"
          onClick={() => onTabChange("summary")}
        />
        <InspectorTabButton
          active={activeTab === "review"}
          icon={FileStack}
          label="Review"
          onClick={() => onTabChange("review")}
        />

        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            onClick={() => onModeChange("code")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] transition",
              mode === "code"
                ? "bg-white/8 text-[#d8d8d8]"
                : "text-[#888] hover:bg-white/7"
            )}
          >
            Code
          </button>
          <button
            type="button"
            onClick={() => onModeChange("diff")}
            className={cn(
              "rounded-md px-2.5 py-1 text-[12px] transition",
              mode === "diff"
                ? "bg-white/8 text-[#d8d8d8]"
                : "text-[#888] hover:bg-white/7"
            )}
          >
            Diff
          </button>
          <button
            type="button"
            onClick={onClose}
            className="flex size-6 items-center justify-center rounded-md text-[#666] transition hover:bg-white/7 hover:text-[#aaa]"
          >
            <X className="size-[13px]" />
          </button>
        </div>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {activeTab === "summary" ? (
          <div className="space-y-4 p-4">
            <div className="rounded-lg border border-white/8 bg-[#171717]">
              <div className="border-b border-white/7 px-4 py-3 text-[12px] text-[#666]">
                Current state
              </div>
              <SessionRichText
                text={session.summary || "No summary yet."}
                className="space-y-3 px-4 py-4 text-[13px] leading-7 text-[#cfcfcf]"
              />
            </div>

            <div className="rounded-lg border border-white/8 bg-[#171717]">
              <InfoRow label="Status" value={formatSessionStatus(session.status)} />
              <InfoRow label="Project" value={session.project?.name || "Unassigned"} />
              <InfoRow label="Updated" value={formatUpdatedAt(session.updatedAt)} />
              <InfoRow
                label="Attention"
                value={
                  session.attentionRequired
                    ? session.attentionReason || "User action required"
                    : "No attention required"
                }
                multiline
              />
            </div>
          </div>
        ) : (
          <div className="space-y-3 p-4">
            {mode === "code" ? (
              <CodeModePane session={session} />
            ) : (
              <DiffModePane session={session} />
            )}
          </div>
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
    <div className="overflow-hidden rounded-lg border border-white/8 bg-[#171717]">
      <div className="border-b border-white/7 px-4 py-3 text-[12px] text-[#888]">
        summary.md
      </div>
      <div className="max-h-[540px] overflow-auto py-2">
        {lines.map((line, index) => (
          <div key={`${line}-${index}`} className="flex items-start px-0 hover:bg-white/[0.03]">
            <div className="w-10 shrink-0 select-none pr-3 text-right font-mono text-[11px] leading-6 text-[#444]">
              {index + 1}
            </div>
            <pre className="m-0 flex-1 whitespace-pre-wrap pr-4 font-mono text-[12px] leading-6 text-[#cfcfcf]">
              {line}
            </pre>
          </div>
        ))}
      </div>
    </div>
  )
}

function DiffModePane({ session }: { session: Session }) {
  const changedArtifacts = session.artifacts.filter(
    (artifact) => artifact.kind === ArtifactKind.CHANGED_FILES
  )

  if (changedArtifacts.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-white/10 bg-white/2 px-4 py-5 text-[12px] leading-6 text-[#666]">
        No changed-files artifact yet. When the backend emits file changes or review metadata,
        the diff view will render them here.
      </div>
    )
  }

  return (
    <div className="space-y-3">
      {changedArtifacts.map((artifact) => (
        <div key={artifact.id} className="rounded-lg border border-white/8 bg-[#171717] px-4 py-4">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="text-[13px] text-[#e0e0e0]">{artifact.label}</p>
              <p className="mt-1 text-[12px] text-[#666]">{formatArtifactKind(artifact.kind)}</p>
            </div>
            <span className="rounded-md bg-white/6 px-2 py-1 text-[11px] text-[#888]">
              {artifact.contentType || "metadata"}
            </span>
          </div>

          {artifact.downloadUrl ? (
            <a
              href={artifact.downloadUrl}
              target="_blank"
              rel="noreferrer"
              className="mt-4 inline-flex items-center gap-1 text-[12px] text-[#c8c8c8] transition hover:text-white"
            >
              <span>Download artifact</span>
              <ChevronRight className="size-3" />
            </a>
          ) : (
            <p className="mt-4 text-[12px] leading-6 text-[#666]">
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
  icon: Icon,
  label,
  onClick,
}: {
  active: boolean
  icon: typeof FileCode2
  label: string
  onClick: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-2 rounded-md px-3 py-1.5 text-[12px] transition",
        active ? "bg-white/8 text-[#e0e0e0]" : "text-[#666] hover:bg-white/7 hover:text-[#aaa]"
      )}
    >
      <Icon className="size-[13px]" />
      <span>{label}</span>
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
    <div className="border-b border-white/7 px-4 py-3 last:border-b-0">
      <p className="text-[11px] uppercase tracking-[0.06em] text-[#555]">{label}</p>
      <p className={cn("mt-2 text-[13px] text-[#d6d6d6]", multiline ? "leading-7" : "truncate")}>
        {value}
      </p>
    </div>
  )
}
