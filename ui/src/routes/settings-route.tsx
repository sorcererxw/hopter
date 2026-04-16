import type { ReactNode } from "react"
import { useState } from "react"
import {
  Archive,
  ArrowLeft,
  BarChart3,
  Brush,
  FolderTree,
  Gauge,
  GitBranch,
  Monitor,
  Server,
  Settings,
  SlidersHorizontal,
} from "lucide-react"
import { useNavigate } from "react-router-dom"

import { useHostStatus } from "@/features/host/use-host-status"
import { useProjects } from "@/features/projects/use-projects"
import { useSessions } from "@/features/sessions/use-sessions"
import { cn } from "@/lib/utils"

const NAV_ITEMS = [
  { id: "general", icon: Settings, label: "常规" },
  { id: "appearance", icon: Brush, label: "Appearance" },
  { id: "config", icon: SlidersHorizontal, label: "配置" },
  { id: "usage", icon: BarChart3, label: "使用情况" },
  { id: "mcp", icon: Server, label: "MCP 服务器" },
  { id: "git", icon: GitBranch, label: "Git" },
  { id: "env", icon: Monitor, label: "环境" },
  { id: "worktree", icon: FolderTree, label: "工作树" },
  { id: "archived", icon: Archive, label: "已归档线程" },
] as const

type SettingsSection =
  | "general"
  | "appearance"
  | "config"
  | "usage"
  | "mcp"
  | "git"
  | "env"
  | "worktree"
  | "archived"

export function SettingsRoute() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SettingsSection>("general")
  const { data: hostStatus } = useHostStatus()
  const { data: projects } = useProjects()
  const { data: sessions } = useSessions()

  return (
    <div className="flex h-screen overflow-hidden bg-background text-foreground">
      <aside className="flex w-[300px] shrink-0 flex-col border-r border-white/7 bg-sidebar px-3 py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-4 inline-flex items-center gap-2 rounded-xl px-3 py-2 text-[14px] text-[#9b9b9b] transition hover:bg-white/6 hover:text-white"
        >
          <ArrowLeft className="size-4" />
          <span>返回应用</span>
        </button>

        <div className="space-y-1">
          {NAV_ITEMS.map(({ icon: Icon, id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={cn(
                "flex w-full items-center gap-3 rounded-xl px-4 py-3 text-left text-[15px] transition",
                activeSection === id
                  ? "bg-white/9 text-white"
                  : "text-[#9a9a9a] hover:bg-white/6 hover:text-white"
              )}
            >
              <Icon className="size-4" />
              <span>{label}</span>
            </button>
          ))}
        </div>

        <div className="mt-auto rounded-[20px] border border-white/8 bg-white/4 px-4 py-4 text-sm text-[#9a9a9a]">
          <div className="mb-2 flex items-center gap-2 text-white">
            <Gauge className="size-4" />
            <span>Host</span>
          </div>
          <p>{hostStatus?.hostId || "Local daemon"}</p>
          <p className="mt-2 text-[#777]">
            {projects?.length ?? 0} 个项目 · {sessions?.length ?? 0} 个线程
          </p>
        </div>
      </aside>

      <main className="thin-scrollbar min-w-0 flex-1 overflow-y-auto bg-background px-10 py-8">
        {activeSection === "general" ? (
          <div className="mx-auto max-w-5xl">
            <h1 className="mb-8 text-[40px] font-semibold text-white">常规</h1>
            <SettingsPanel>
              <SettingRow
                control={<ValueBadge>VS Code</ValueBadge>}
                description="默认打开文件和文件夹的位置。"
                label="默认打开目标"
              />
              <SettingRow
                control={<ValueBadge>自动检测</ValueBadge>}
                description="应用 UI 语言。"
                label="语言"
              />
              <SettingRow
                control={<ValueBadge>带代码命令的步骤</ValueBadge>}
                description="选择线程中命令输出的显示量。"
                label="线程详细信息"
              />
              <SettingRow
                control={<ToggleBadge enabled />}
                description="在主窗口关闭后仍保留菜单栏入口。"
                label="Show in menu bar"
              />
              <SettingRow
                control={<ValueBadge>Off</ValueBadge>}
                description="全局快捷键，保留空白表示关闭。"
                label="Popout Window hotkey"
              />
              <SettingRow
                control={<ToggleBadge enabled />}
                description="在 Codex 运行线程时让设备保持唤醒。"
                label="运行时防止系统休眠"
              />
              <SettingRow
                control={<ValueBadge>Standard</ValueBadge>}
                description="跨线程和子代理的推理速度配置。"
                label="Speed"
              />
            </SettingsPanel>
          </div>
        ) : null}

        {activeSection === "appearance" ? (
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-8 text-[40px] font-semibold text-white">Appearance</h1>
            <SettingsPanel>
              <SettingRow
                control={<ValueBadge>Dark</ValueBadge>}
                description="使用与当前工作区一致的深色主题。"
                label="Theme"
              />
              <SettingRow
                control={<ValueBadge>Space Grotesk</ValueBadge>}
                description="正文与导航使用统一的 UI 字体。"
                label="Interface font"
              />
              <SettingRow
                control={<ValueBadge>JetBrains Mono</ValueBadge>}
                description="代码、日志和工件预览使用等宽字体。"
                label="Code font"
              />
            </SettingsPanel>
          </div>
        ) : null}

        {activeSection === "usage" ? (
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-8 text-[40px] font-semibold text-white">使用情况</h1>
            <div className="grid gap-4 md:grid-cols-3">
              <MetricCard label="项目" value={`${projects?.length ?? 0}`} />
              <MetricCard label="线程" value={`${sessions?.length ?? 0}`} />
              <MetricCard
                label="Host 状态"
                value={hostStatus ? formatHostStatus(hostStatus.status) : "unknown"}
              />
            </div>
          </div>
        ) : null}

        {activeSection === "mcp" ? (
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-8 text-[40px] font-semibold text-white">MCP 服务器</h1>
            <SettingsPanel>
              <SettingRow
                control={<ValueBadge>Codex</ValueBadge>}
                description="当前 v1 控制平面将 Codex 作为主后端。"
                label="Primary backend"
              />
              <SettingRow
                control={<ValueBadge>{hostStatus ? "available" : "pending"}</ValueBadge>}
                description="服务状态从 Go host 接口读取。"
                label="Backend availability"
              />
            </SettingsPanel>
          </div>
        ) : null}

        {activeSection !== "general" &&
        activeSection !== "appearance" &&
        activeSection !== "usage" &&
        activeSection !== "mcp" ? (
          <div className="mx-auto max-w-4xl">
            <h1 className="mb-8 text-[40px] font-semibold text-white">
              {NAV_ITEMS.find((item) => item.id === activeSection)?.label}
            </h1>
            <div className="rounded-[28px] border border-white/8 bg-white/4 px-6 py-5 text-[15px] leading-8 text-[#9a9a9a]">
              这个分组已经切入新的视觉系统，但还没有接入更多后端能力。当前活跃工作流仍然集中在主工作区、项目打开和会话继续上。
            </div>
          </div>
        ) : null}
      </main>
    </div>
  )
}

function SettingsPanel({ children }: { children: ReactNode }) {
  return (
    <div className="overflow-hidden rounded-[28px] border border-white/8 bg-[#1f1f1f]">
      {children}
    </div>
  )
}

function SettingRow({
  control,
  description,
  label,
}: {
  control: ReactNode
  description: string
  label: string
}) {
  return (
    <div className="flex items-start justify-between gap-6 border-b border-white/7 px-6 py-5 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="text-[18px] text-white">{label}</p>
        <p className="mt-2 max-w-2xl text-[14px] leading-7 text-[#8b8b8b]">
          {description}
        </p>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function ValueBadge({ children }: { children: ReactNode }) {
  return (
    <div className="rounded-2xl border border-white/10 bg-white/6 px-4 py-2.5 text-[14px] text-[#ececec]">
      {children}
    </div>
  )
}

function ToggleBadge({ enabled = false }: { enabled?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-8 w-14 items-center rounded-full p-1 transition",
        enabled ? "bg-sky-500" : "bg-white/10"
      )}
    >
      <div
        className={cn(
          "size-6 rounded-full bg-white transition",
          enabled ? "translate-x-6" : "translate-x-0"
        )}
      />
    </div>
  )
}

function MetricCard({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-[28px] border border-white/8 bg-white/4 px-6 py-5">
      <p className="text-[13px] uppercase tracking-[0.14em] text-[#7a7a7a]">{label}</p>
      <p className="mt-3 text-[34px] font-semibold text-white">{value}</p>
    </div>
  )
}

function formatHostStatus(value: number) {
  switch (value) {
    case 1:
      return "healthy"
    case 2:
      return "degraded"
    case 3:
      return "unavailable"
    default:
      return "unknown"
  }
}
