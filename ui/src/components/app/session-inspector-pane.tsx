import { FileCode2, FileStack, TextCursor, X } from "lucide-react"

import type { Session } from "@/gen/proto/orchd/v1/session_pb"
import { formatArtifactKind, formatSessionStatus, formatUpdatedAt } from "@/lib/format/proto"
import { cn } from "@/lib/utils"

type InspectorTab = "summary" | "review"

type SessionInspectorPaneProps = {
  activeTab: InspectorTab
  onClose: () => void
  onTabChange: (tab: InspectorTab) => void
  session: Session
}

export function SessionInspectorPane({
  activeTab,
  onClose,
  onTabChange,
  session,
}: SessionInspectorPaneProps) {
  return (
    <aside className="hidden h-full w-[40rem] shrink-0 border-l border-white/8 bg-[#161616] xl:flex xl:flex-col">
      <div className="flex items-center gap-1 border-b border-white/8 bg-[#1a1a1a] px-3 py-2.5">
        <InspectorTabButton
          active={activeTab === "summary"}
          icon={TextCursor}
          label="Summary"
          onClick={() => onTabChange("summary")}
        />
        <InspectorTabButton
          active={activeTab === "review"}
          icon={FileStack}
          label="Review"
          onClick={() => onTabChange("review")}
        />
        <div className="ml-auto flex items-center gap-2">
          <span className="rounded-full bg-white/6 px-3 py-1 text-[12px] text-[#d6d6d6]">
            {session.title || "Untitled"}
          </span>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex size-8 items-center justify-center rounded-xl text-[#727272] transition hover:bg-white/6 hover:text-[#d8d8d8]"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>

      <div className="thin-scrollbar min-h-0 flex-1 overflow-y-auto">
        {activeTab === "summary" ? (
          <div className="space-y-6 p-5">
            <div className="rounded-[20px] border border-white/8 bg-[#212121] p-5">
              <div className="mb-3 flex items-center gap-2 text-[12px] text-[#8b8b8b]">
                <FileCode2 className="size-4" />
                <span>Current state</span>
              </div>
              <div className="space-y-4 text-[14px] leading-7 text-[#e7e7e7]">
                {session.summary ? (
                  session.summary.split(/\n{2,}/).map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))
                ) : (
                  <p className="text-[#8a8a8a]">会话还没有产出摘要。</p>
                )}
              </div>
            </div>

            <div className="rounded-[20px] border border-white/8 bg-[#1a1a1a]">
              <InfoRow label="Status" value={formatSessionStatus(session.status)} />
              <InfoRow label="Project" value={session.project?.name || "未分配"} />
              <InfoRow label="Updated" value={formatUpdatedAt(session.updatedAt)} />
              <InfoRow
                label="Attention"
                value={
                  session.attentionRequired
                    ? session.attentionReason || "需要用户处理"
                    : "No attention required"
                }
                multiline
              />
            </div>
          </div>
        ) : (
          <div className="space-y-4 p-5">
            <div className="rounded-[20px] border border-white/8 bg-[#1a1a1a] px-5 py-4">
              <div className="flex items-center justify-between text-[13px] text-[#cfcfcf]">
                <span>{session.artifacts.length} 个工件</span>
                <span className="text-[#7d7d7d]">{formatUpdatedAt(session.updatedAt)}</span>
              </div>
            </div>

            {session.artifacts.length > 0 ? (
              session.artifacts.map((artifact) => (
                <div
                  key={artifact.id}
                  className="rounded-[20px] border border-white/8 bg-[#1f1f1f] px-5 py-4"
                >
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <p className="text-[15px] font-medium text-[#efefef]">
                        {artifact.label}
                      </p>
                      <p className="mt-1 text-[12px] text-[#868686]">
                        {formatArtifactKind(artifact.kind)}
                      </p>
                    </div>
                    <span className="rounded-full bg-white/6 px-3 py-1 text-[11px] text-[#a5a5a5]">
                      {artifact.contentType || "metadata"}
                    </span>
                  </div>

                  <div className="mt-4 text-[12px] leading-6 text-[#898989]">
                    {artifact.downloadUrl ? (
                      <a
                        href={artifact.downloadUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="text-[#d6d6d6] underline decoration-white/20 underline-offset-4 transition hover:text-white"
                      >
                        Download artifact
                      </a>
                    ) : (
                      <span>该工件目前只返回元数据。</span>
                    )}
                  </div>
                </div>
              ))
            ) : (
              <div className="rounded-[20px] border border-dashed border-white/10 bg-white/2 px-5 py-6 text-[14px] text-[#868686]">
                后端开始返回摘要、文件变化、测试结果或截图后，这里会显示审查面板。
              </div>
            )}
          </div>
        )}
      </div>
    </aside>
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
        "inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[13px] transition",
        active
          ? "text-[#efefef]"
          : "text-[#7b7b7b] hover:bg-white/6 hover:text-[#d0d0d0]"
      )}
    >
      <Icon className="size-4" />
      <span>{label}</span>
      {active ? <span className="h-0.5 w-10 rounded-full bg-white/85" /> : null}
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
    <div className="border-b border-white/7 px-5 py-4 last:border-b-0">
      <p className="text-[12px] uppercase tracking-[0.12em] text-[#777]">{label}</p>
      <p
        className={cn(
          "mt-2 text-[14px] text-[#e0e0e0]",
          multiline ? "leading-7" : "truncate"
        )}
      >
        {value}
      </p>
    </div>
  )
}
