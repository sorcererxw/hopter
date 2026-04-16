import { useState, type ReactNode } from "react"
import {
  Archive,
  ArrowLeft,
  BarChart2,
  Brush,
  FolderTree,
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
  { id: "general", label: "General", icon: Settings },
  { id: "appearance", label: "Appearance", icon: Brush },
  { id: "config", label: "Config", icon: SlidersHorizontal },
  { id: "usage", label: "Usage", icon: BarChart2 },
  { id: "mcp", label: "MCP Servers", icon: Server },
  { id: "git", label: "Git", icon: GitBranch },
  { id: "env", label: "Environment", icon: Monitor },
  { id: "worktree", label: "Worktree", icon: FolderTree },
  { id: "archived", label: "Archived Threads", icon: Archive },
] as const

type SettingsSection = (typeof NAV_ITEMS)[number]["id"]

export function SettingsRoute() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SettingsSection>("general")
  const { data: hostStatus } = useHostStatus()
  const { data: projects } = useProjects()
  const { data: sessions } = useSessions()

  return (
    <div className="flex h-screen bg-[#0f0f0f] text-[#d0d0d0]">
      <div className="flex w-[220px] shrink-0 flex-col border-r border-white/7 bg-[#141414] py-4">
        <button
          type="button"
          onClick={() => navigate(-1)}
          className="mb-3 flex items-center gap-2 px-4 py-2 text-[13px] text-[#888] transition hover:text-[#ccc]"
        >
          <ArrowLeft className="size-[14px]" />
          <span>Back to app</span>
        </button>

        <div className="px-2 space-y-0.5">
          {NAV_ITEMS.map(({ icon: Icon, id, label }) => (
            <button
              key={id}
              type="button"
              onClick={() => setActiveSection(id)}
              className={cn(
                "flex w-full items-center gap-2.5 rounded-md px-3 py-2 text-left transition",
                activeSection === id
                  ? "bg-white/10 text-[#e0e0e0]"
                  : "text-[#888] hover:bg-white/6 hover:text-[#d0d0d0]"
              )}
            >
              <Icon className={cn("size-[14px]", activeSection === id ? "text-[#888]" : "text-[#555]")} />
              <span className="text-[13px]">{label}</span>
            </button>
          ))}
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-12 py-8">
        {activeSection === "general" ? (
          <div className="w-full">
            <SectionTitle>General</SectionTitle>

            <SettingRow
              label="Default open target"
              description="Where to open files and folders by default"
              control={<SelectField value="VS Code" />}
            />
            <SettingRow
              label="Language"
              description="Application UI language"
              control={<SelectField value="Auto-detect" />}
            />
            <SettingRow
              label="Thread verbosity"
              description="Choose how much command output to display in threads"
              control={<SelectField value="Steps with code commands" />}
            />
            <SettingRow
              label="Show in menu bar"
              description="Keep the workspace in the menu bar when the main window closes"
              control={<ToggleSwitch enabled />}
            />
            <SettingRow
              label="Keep system awake while running"
              description="Prevent sleep while Codex is actively working"
              control={<ToggleSwitch enabled />}
            />
            <SettingRow
              label="Speed"
              description="Choose how quickly inference runs across threads and follow-ups"
              control={<SelectField value="Standard" />}
            />
          </div>
        ) : null}

        {activeSection === "appearance" ? (
          <div className="max-w-2xl">
            <SectionTitle>Appearance</SectionTitle>

            <SettingRow
              label="Theme"
              description="Choose the workspace theme"
              control={<SelectField value="Dark" />}
            />
            <SettingRow
              label="Interface font"
              description="Primary UI font"
              control={<SelectField value="Inter" />}
            />
            <SettingRow
              label="Code font"
              description="Font used for code and logs"
              control={<SelectField value="JetBrains Mono" />}
            />
          </div>
        ) : null}

        {activeSection === "usage" ? (
          <div className="max-w-2xl">
            <SectionTitle>Usage</SectionTitle>

            <SettingRow
              label="Projects"
              description="Repos currently registered in the workspace"
              control={<StatBadge value={`${projects?.length ?? 0}`} />}
            />
            <SettingRow
              label="Threads"
              description="Sessions available for re-entry"
              control={<StatBadge value={`${sessions?.length ?? 0}`} />}
            />
            <SettingRow
              label="Host status"
              description="Current state reported by the Go host service"
              control={<SelectField value={formatHostStatus(hostStatus?.status)} />}
            />
          </div>
        ) : null}

        {activeSection === "mcp" ? (
          <div className="max-w-2xl">
            <SectionTitle>MCP Servers</SectionTitle>

            <SettingRow
              label="Primary backend"
              description="The active control plane uses Codex as the source of truth"
              control={<SelectField value="Codex" />}
            />
            <SettingRow
              label="Host availability"
              description="Backend availability from the Go host interface"
              control={<SelectField value={hostStatus ? "available" : "pending"} />}
            />
          </div>
        ) : null}

        {!["general", "appearance", "usage", "mcp"].includes(activeSection) ? (
          <div className="max-w-2xl">
            <SectionTitle>{NAV_ITEMS.find((item) => item.id === activeSection)?.label}</SectionTitle>
            <div className="rounded-lg border border-white/8 bg-white/4 px-5 py-4 text-[13px] leading-7 text-[#777]">
              This section has been visually rebuilt, but the active product loop is still the
              workspace shell, project picker, and session continuation flow.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return <h1 className="mb-8 text-[22px] text-[#e8e8e8]">{children}</h1>
}

function SelectField({ value }: { value: string }) {
  return (
    <div className="flex min-w-[160px] items-center gap-2 rounded-lg border border-white/10 bg-white/7 px-3 py-2 text-[13px] text-[#c8c8c8]">
      <span className="flex-1">{value}</span>
      <span className="text-[#666]">▾</span>
    </div>
  )
}

function ToggleSwitch({ enabled = false }: { enabled?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-[22px] w-10 items-center rounded-full p-0.5 transition",
        enabled ? "bg-sky-500" : "bg-white/12"
      )}
    >
      <div
        className={cn(
          "size-[18px] rounded-full bg-white transition",
          enabled ? "translate-x-[18px]" : "translate-x-0"
        )}
      />
    </div>
  )
}

function StatBadge({ value }: { value: string }) {
  return (
    <div className="rounded-lg border border-white/10 bg-white/7 px-3 py-2 text-[13px] text-[#e0e0e0]">
      {value}
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
    <div className="flex items-start justify-between gap-8 border-b border-white/6 py-5 last:border-b-0">
      <div className="flex-1 pr-8">
        <div className="mb-1 text-[14px] text-[#e0e0e0]">{label}</div>
        <div className="text-[12.5px] leading-6 text-[#666]">{description}</div>
      </div>
      <div className="shrink-0">{control}</div>
    </div>
  )
}

function formatHostStatus(status?: number) {
  switch (status) {
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
