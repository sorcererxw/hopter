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

import { useTheme } from "@/components/theme-provider"
import { CardTitle } from "@/components/ui/card"
import { Button } from "@/components/ui/button"
import { useLogout } from "@/features/auth/use-auth"
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
type SelectOption = {
  label: string
  value: string
}

const THEME_OPTIONS: SelectOption[] = [
  { label: "System", value: "system" },
  { label: "Dark", value: "dark" },
  { label: "Light", value: "light" },
]

export function SettingsRoute() {
  const navigate = useNavigate()
  const [activeSection, setActiveSection] = useState<SettingsSection>("general")
  const { resolvedTheme, theme, setTheme } = useTheme()
  const logout = useLogout()
  const { data: hostStatus } = useHostStatus()
  const { data: projects } = useProjects()
  const { data: sessions } = useSessions()

  return (
    <div className="flex h-dvh bg-background text-foreground">
      <div className="flex w-56 shrink-0 flex-col border-r border-border bg-sidebar py-4">
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={() => navigate(-1)}
          className="mb-3 justify-start gap-2 px-4 text-muted-foreground"
        >
          <ArrowLeft className="size-3.5" />
          <span>Back to app</span>
        </Button>

        <div className="space-y-0.5 px-2 text-sm font-medium">
          {NAV_ITEMS.map(({ icon: Icon, id, label }) => (
            <Button
              key={id}
              type="button"
              variant={activeSection === id ? "secondary" : "ghost"}
              size="sm"
              onClick={() => setActiveSection(id)}
              className={cn(
                "h-auto w-full justify-start gap-2.5 px-3 py-2 text-left",
                activeSection === id
                  ? "text-foreground"
                  : "text-muted-foreground"
              )}
            >
              <Icon
                className={cn(
                  "size-3.5",
                  activeSection === id
                    ? "text-muted-foreground"
                    : "text-muted-foreground"
                )}
              />
              <span>{label}</span>
            </Button>
          ))}
        </div>
      </div>

      <div className="thin-scrollbar flex-1 overflow-y-auto px-12 py-8 text-sm font-medium text-foreground">
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
            <SettingRow
              label="Session"
              description="Clear the current browser session and close terminals owned by this tab"
              control={
                <Button
                  type="button"
                  variant="secondary"
                  onClick={async () => {
                    await logout.mutateAsync()
                    navigate("/login")
                  }}
                >
                  Log out
                </Button>
              }
            />
          </div>
        ) : null}

        {activeSection === "appearance" ? (
          <div className="max-w-2xl">
            <SectionTitle>Appearance</SectionTitle>

            <SettingRow
              label="Theme"
              description={`Choose the workspace theme${theme === "system" ? ` (currently following ${resolvedTheme})` : ""}`}
              control={
                <SelectField
                  onChange={(value) =>
                    setTheme(value as "dark" | "light" | "system")
                  }
                  options={THEME_OPTIONS}
                  value={theme}
                />
              }
            />
            <SettingRow
              label="Interface font"
              description="Primary UI font"
              control={<SelectField value="Geist" />}
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
              control={
                <SelectField value={formatHostStatus(hostStatus?.status)} />
              }
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
              control={
                <SelectField value={hostStatus ? "available" : "pending"} />
              }
            />
          </div>
        ) : null}

        {!["general", "appearance", "usage", "mcp"].includes(activeSection) ? (
          <div className="max-w-2xl">
            <SectionTitle>
              {NAV_ITEMS.find((item) => item.id === activeSection)?.label}
            </SectionTitle>
            <div className="rounded-lg border border-border bg-muted px-5 py-4 text-base leading-7 text-muted-foreground">
              This section has been visually rebuilt, but the active product
              loop is still the workspace shell, project picker, and session
              continuation flow.
            </div>
          </div>
        ) : null}
      </div>
    </div>
  )
}

function SectionTitle({ children }: { children: ReactNode }) {
  return (
    <CardTitle className="mb-8 text-2xl text-foreground">{children}</CardTitle>
  )
}

function SelectField({
  onChange,
  options,
  value,
}: {
  onChange?: (value: string) => void
  options?: SelectOption[]
  value: string
}) {
  if (options && onChange) {
    return (
      <label className="relative block min-w-40">
        <select
          value={value}
          onChange={(event) => onChange(event.target.value)}
          className="h-10 w-full appearance-none rounded-lg border border-border bg-accent px-3 py-2 pr-8 text-foreground transition outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        >
          {options.map((option) => (
            <option key={option.value} value={option.value}>
              {option.label}
            </option>
          ))}
        </select>
        <span className="pointer-events-none absolute inset-y-0 right-3 flex items-center text-muted-foreground">
          ▾
        </span>
      </label>
    )
  }

  return (
    <div className="flex min-w-40 items-center gap-2 rounded-lg border border-border bg-accent px-3 py-2 text-muted-foreground">
      <span className="flex-1">{value}</span>
      <span className="text-muted-foreground">▾</span>
    </div>
  )
}

function ToggleSwitch({ enabled = false }: { enabled?: boolean }) {
  return (
    <div
      className={cn(
        "flex h-5.5 w-10 items-center rounded-full p-0.5 transition",
        enabled ? "bg-sky-500" : "bg-secondary"
      )}
    >
      <div
        className={cn(
          "size-4.5 rounded-full bg-white transition",
          enabled ? "translate-x-[18px]" : "translate-x-0"
        )}
      />
    </div>
  )
}

function StatBadge({ value }: { value: string }) {
  return (
    <div className="rounded-lg border border-border bg-accent px-3 py-2 text-foreground">
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
    <div className="flex items-start justify-between gap-8 border-b border-border py-5 last:border-b-0">
      <div className="flex-1 pr-8">
        <div className="mb-1 text-foreground">{label}</div>
        <div className="font-normal leading-6 text-muted-foreground">
          {description}
        </div>
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
